// lib/bestanden.ts
// [BOEK-033] Mijn bestanden — Drive experience
// Business logic: folder tree, contents, search, move, create, year structure
// Server-only — nooit importeren in Client Components
//
// [BOEK-033 Phase 1] Every DB function accepts an optional `ctx` parameter.
//   - 'user'     (default) → createServerSupabaseClient — RLS, user session
//   - 'pipeline'           → createPipelineClient — service_role, no session
//   The caller passes a context STRING, never a client object. It does not
//   know how clients are built (repository pattern). Background jobs
//   (BOEK-011 email sync) call with ctx='pipeline'; everything else defaults.
//
// [BOEK-033] createPipelineClient is shared infrastructure — NOT owned here.
//   It lives in src/lib/supabase-pipeline.ts (built in a separate conversation).
//   This file only imports it.

import { createServerSupabaseClient } from "./supabase-server";
import { createPipelineClient } from "./supabase-pipeline";

// [BOEK-033 Phase 1] Context decides which Supabase client backs a call.
export type BestandenContext = "user" | "pipeline";

async function resolveClient(ctx: BestandenContext = "user") {
  if (ctx === "pipeline") {
    // service_role — bypasses RLS, for background jobs without a user session
    return createPipelineClient();
  }
  // default — RLS-bound server client, user session
  return await createServerSupabaseClient();
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export type FolderType =
  | "year" | "quarter" | "month"
  | "bank" | "facturen" | "kosten"
  | "shared" | "custom" | "imported";

export interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
  starred?: boolean;
  is_system: boolean;
  folder_type: FolderType | null;
}

export interface FolderNode extends FolderRow {
  children: FolderNode[];
}

export interface BestandRow {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  doc_type: string | null;
  period: string | null;
  year: number | null;
  notes: string | null;
  invoice_id: string | null;
  created_at: string;
  folder_id: string | null;
  ai_processed: boolean | null;
  ai_doc_type: string | null;
  ai_suggested_folder: string | null;
  source: string | null;
  starred?: boolean;
  trashed?: boolean;
  trashed_at?: string | null;
  // [BRUG-FILES-SHARED] visible to the linked accountant when true.
  shared?: boolean;
}

export interface SearchResult extends BestandRow {
  folder_name: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

// The names themselves live in bestanden-shared.ts so Client Components can compare
// against them without importing this server-only module; re-exported here so every
// existing server-side import keeps working unchanged.
import { SHARED_FOLDER_NAME, IMPORTED_FOLDER_NAME } from "./bestanden-shared";
export { SHARED_FOLDER_NAME, IMPORTED_FOLDER_NAME };

const NL_MONTHS: Record<number, string> = {
  1: "januari", 2: "februari", 3: "maart",
  4: "april",   5: "mei",      6: "juni",
  7: "juli",    8: "augustus", 9: "september",
  10: "oktober", 11: "november", 12: "december",
};

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

const QUARTER_LABELS: Record<number, string> = {
  1: "Q1 (jan–mrt)", 2: "Q2 (apr–jun)",
  3: "Q3 (jul–sep)", 4: "Q4 (okt–dec)",
};

// ─── Select fields ───────────────────────────────────────────────────────────────

const FOLDER_SELECT = "id, user_id, name, parent_id, color, created_at, starred, is_system, folder_type";

// ─── Folder Tree ────────────────────────────────────────────────────────────────

export function buildTree(rows: FolderRow[], parentId: string | null): FolderNode[] {
  return rows
    .filter(r => r.parent_id === parentId)
    .sort((a, b) => {
      // System folders first, then alphabetical
      if (a.is_system && !b.is_system) return -1;
      if (!a.is_system && b.is_system) return 1;
      return a.name.localeCompare(b.name, "nl");
    })
    .map(r => ({ ...r, children: buildTree(rows, r.id) }));
}

// ─── ensureYearStructure ─────────────────────────────────────────────────────────

/**
 * Idempotent — creates the full year folder structure if not present.
 * Safe to call multiple times AND concurrently.
 *
 * [BOEK-033] Performance: on the common path (structure already built) this
 * costs ONE query — it reads all system folders, sees the year is complete,
 * and returns. Only a missing/incomplete year triggers per-folder INSERTs.
 * Each INSERT relies on the partial unique indexes; a concurrent duplicate
 * fails with Postgres 23505 (unique_violation), caught and treated as
 * "already exists" — so parallel callers cannot create duplicates.
 *
 * Structure:
 * {year}/
 *   Q1 (jan–mrt)/ Bank/ januari/ {Facturen/ Kosten/} ...
 *   Q2 (apr–jun)/ Bank/ april/   {Facturen/ Kosten/} ...
 *   Q3 (jul–sep)/ Bank/ juli/    {Facturen/ Kosten/} ...
 *   Q4 (okt–dec)/ Bank/ oktober/ {Facturen/ Kosten/} ...
 */
export async function ensureYearStructure(
  userId: string,
  year: number,
  // [BOEK-FOUNDATION-TYPES] System folders require service_role (RLS blocks is_system=true)
  ctx: BestandenContext = "pipeline"
): Promise<void> {
  const supabase = await resolveClient(ctx);

  // ── [BOEK-033] FAST PATH ──────────────────────────────────────────────────
  // Read ALL system folders for this user in ONE query. If the year structure
  // is already complete, return immediately — no INSERTs, no per-folder calls.
  // This is what makes page load fast: a built structure costs 1 query, not ~94.
  const { data: existingRows, error: readError } = await supabase
    .from("folders")
    .select("id, name, parent_id, folder_type")
    .eq("user_id", userId)
    .eq("is_system", true);
  if (readError) throw new Error(readError.message);

  const existing = (existingRows ?? []) as {
    id: string; name: string; parent_id: string | null; folder_type: string | null;
  }[];

  // Index existing folders by "parentId|name" for O(1) lookup.
  const key = (parentId: string | null, name: string) => `${parentId ?? "ROOT"}|${name}`;
  const byKey = new Map<string, string>(); // key → folder id
  for (const f of existing) byKey.set(key(f.parent_id, f.name), f.id);

  // Expected total for a complete year: 1 year + 4 quarters + 4 bank
  // + 12 months + 24 (facturen/kosten) = 45 folders for this year,
  // plus the 2 root folders (shared + imported) = checked separately.
  const yearFolderId = byKey.get(key(null, String(year)));
  const sharedExists = existing.some(f => f.folder_type === "shared" && f.parent_id === null);
  const importedExists = existing.some(f => f.folder_type === "imported" && f.parent_id === null);

  // [M5] Completeness check on the FULL leaf count, not just quarters. A prior run
  // could have been interrupted after creating the 4 quarter rows but before a
  // quarter's Bank/months/Facturen/Kosten — "4 quarters" would then short-circuit
  // forever and leave that subtree permanently missing. Verify every tier; if any
  // leaf is absent we fall through to the idempotent build path, which re-creates
  // only what's missing (INSERT + catch 23505) and self-heals.
  if (yearFolderId && sharedExists && importedExists) {
    const quarterIds = new Set(
      existing.filter(f => f.parent_id === yearFolderId && f.folder_type === "quarter").map(f => f.id)
    );
    const bankCount = existing.filter(
      f => f.folder_type === "bank" && f.parent_id && quarterIds.has(f.parent_id)
    ).length;
    const monthIdSet = new Set(
      existing.filter(f => f.folder_type === "month" && f.parent_id && quarterIds.has(f.parent_id)).map(f => f.id)
    );
    const typeCount = existing.filter(
      f => (f.folder_type === "facturen" || f.folder_type === "kosten") && f.parent_id && monthIdSet.has(f.parent_id)
    ).length;
    // Complete year subtree = 4 quarters + 4 bank + 12 months + 24 (facturen/kosten).
    if (quarterIds.size === 4 && bankCount === 4 && monthIdSet.size === 12 && typeCount === 24) return;
  }

  // ── [BOEK-033] BUILD PATH ─────────────────────────────────────────────────
  // Structure incomplete (new year, or interrupted earlier). Create only the
  // folders that are missing. INSERT + catch 23505 keeps it concurrency-safe.
  async function findOrCreate(
    name: string,
    parentId: string | null,
    folderType: FolderType,
    color?: string
  ): Promise<string> {
    // Already in our snapshot → reuse, no DB call.
    const cached = byKey.get(key(parentId, name));
    if (cached) return cached;

    // Try to insert. A concurrent duplicate fails with 23505 — treated as OK.
    // Supabase JS upsert() cannot target a PARTIAL index, hence INSERT + catch.
    const { error: insertError } = await supabase
      .from("folders")
      .insert({
        user_id: userId,
        name,
        parent_id: parentId,
        is_system: true,
        folder_type: folderType,
        color: color ?? null,
      });
    if (insertError && insertError.code !== "23505") {
      throw new Error(insertError.message);
    }

    // Read back the id (row now guaranteed to exist).
    let q = supabase
      .from("folders")
      .select("id")
      .eq("user_id", userId)
      .eq("name", name)
      .eq("is_system", true);
    if (parentId === null) q = q.is("parent_id", null);
    else q = q.eq("parent_id", parentId);
    const { data, error } = await q.single();
    if (error) throw new Error(error.message);

    byKey.set(key(parentId, name), data.id); // cache for the rest of this run
    return data.id;
  }

  // 1. Year folder
  const yearId = await findOrCreate(String(year), null, "year", "#1A73E8");

  // 2. Quarters
  for (const [q, months] of Object.entries(QUARTER_MONTHS)) {
    const quarterNum = Number(q);
    const quarterId = await findOrCreate(QUARTER_LABELS[quarterNum], yearId, "quarter", "#1A73E8");

    // 2a. Bank folder per quarter
    await findOrCreate("Bank", quarterId, "bank", "#00897B");

    // 2b. Month folders
    for (const month of months) {
      const monthName = NL_MONTHS[month];
      const monthId = await findOrCreate(monthName, quarterId, "month", "#1A73E8");

      // 2c. Facturen + Kosten per month
      await findOrCreate("Facturen", monthId, "facturen", "#34A853");
      await findOrCreate("Kosten", monthId, "kosten", "#E37400");
    }
  }

  // 3. Shared folder (always at root)
  await ensureSharedFolder(userId, ctx);

  // 4. [BOEK-033 Phase 1] Imported-files fallback folder (always at root)
  await ensureImportedFolder(userId, ctx);
}

// ─── ensureSharedFolder ──────────────────────────────────────────────────────────

export async function ensureSharedFolder(userId: string, ctx: BestandenContext = "pipeline"): Promise<string> {
  const supabase = await resolveClient(ctx);

  // [BOEK-033] Fast path — SELECT first. Folder almost always already exists,
  // so this is a single query on the common path (no INSERT attempt).
  const { data: existing } = await supabase
    .from("folders")
    .select("id")
    .eq("user_id", userId)
    .eq("name", SHARED_FOLDER_NAME)
    .is("parent_id", null)
    .eq("is_system", true)
    .maybeSingle();
  if (existing) return existing.id;

  // Not found → INSERT. Concurrent duplicate fails with 23505 — treated as OK.
  const { error: insertError } = await supabase
    .from("folders")
    .insert({
      user_id: userId,
      name: SHARED_FOLDER_NAME,
      parent_id: null,
      is_system: true,
      folder_type: "shared",
      color: "#1A73E8",
    });
  if (insertError && insertError.code !== "23505") {
    throw new Error(insertError.message);
  }

  const { data, error } = await supabase
    .from("folders")
    .select("id")
    .eq("user_id", userId)
    .eq("name", SHARED_FOLDER_NAME)
    .is("parent_id", null)
    .eq("is_system", true)
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ─── ensureImportedFolder ────────────────────────────────────────────────────────

/**
 * [BOEK-033 Phase 1] The "Geïmporteerde bestanden" fallback folder.
 * Files that cannot be classified to {year}/Q{n}/Facturen land here instead
 * of the root. Always at root, is_system=true, folder_type='imported'.
 * Returns the folder id — BOEK-011 uses it as a fallback target.
 */
export async function ensureImportedFolder(userId: string, ctx: BestandenContext = "pipeline"): Promise<string> {
  const supabase = await resolveClient(ctx);

  // [BOEK-033] Fast path — SELECT first.
  const { data: existing } = await supabase
    .from("folders")
    .select("id")
    .eq("user_id", userId)
    .eq("name", IMPORTED_FOLDER_NAME)
    .is("parent_id", null)
    .eq("is_system", true)
    .maybeSingle();
  if (existing) return existing.id;

  // Not found → INSERT. Concurrent duplicate fails with 23505 — treated as OK.
  const { error: insertError } = await supabase
    .from("folders")
    .insert({
      user_id: userId,
      name: IMPORTED_FOLDER_NAME,
      parent_id: null,
      is_system: true,
      folder_type: "imported",
      color: "#5F6368",
    });
  if (insertError && insertError.code !== "23505") {
    throw new Error(insertError.message);
  }

  const { data, error } = await supabase
    .from("folders")
    .select("id")
    .eq("user_id", userId)
    .eq("name", IMPORTED_FOLDER_NAME)
    .is("parent_id", null)
    .eq("is_system", true)
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ─── Create Folder (user-created) ────────────────────────────────────────────────

export async function createFolder(
  userId: string,
  name: string,
  parentId?: string | null,
  color?: string,
  ctx: BestandenContext = "user"
): Promise<FolderRow> {
  const supabase = await resolveClient(ctx);
  const trimmed = name.trim();
  // [L7] A folder must have a non-empty name.
  if (!trimmed) throw new Error("Mapnaam mag niet leeg zijn");
  // [Fo#2] Reserve the system-folder names. The client shows the "Gedeeld"/protected
  // UI based on the folder NAME, while the server auto-shares on folder_type='shared'.
  // A custom folder named "Gedeeld met boekhouder" would therefore look shared (badge,
  // no delete) but never actually share — a silent trust bug. Block the impersonation.
  const reserved = [SHARED_FOLDER_NAME, IMPORTED_FOLDER_NAME].map((s) => s.toLowerCase());
  if (reserved.includes(trimmed.toLowerCase())) {
    throw new Error("Deze mapnaam is gereserveerd");
  }
  const { data, error } = await supabase
    .from("folders")
    .insert({
      user_id: userId,
      name: trimmed,
      parent_id: parentId ?? null,
      is_system: false,
      folder_type: "custom",
      color: color ?? null,
    })
    .select(FOLDER_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as FolderRow;
}

// ─── Rename Folder ───────────────────────────────────────────────────────────────

export async function renameFolder(
  folderId: string,
  userId: string,
  newName: string,
  ctx: BestandenContext = "user"
): Promise<void> {
  const supabase = await resolveClient(ctx);

  // [L7] A folder must keep a non-empty name — reject blank/whitespace renames.
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("Mapnaam mag niet leeg zijn");

  // Guard: never rename system folders
  const { data: folder } = await supabase
    .from("folders").select("is_system").eq("id", folderId).eq("user_id", userId).single();
  if (folder?.is_system) throw new Error("Systeemmappen kunnen niet worden hernoemd");

  const { error } = await supabase
    .from("folders").update({ name: trimmed })
    .eq("id", folderId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Delete Folder ───────────────────────────────────────────────────────────────

export async function deleteFolder(
  folderId: string,
  userId: string,
  ctx: BestandenContext = "user"
): Promise<void> {
  const supabase = await resolveClient(ctx);

  const { data: folder } = await supabase
    .from("folders").select("id, name, is_system")
    .eq("id", folderId).eq("user_id", userId).single();

  if (!folder) throw new Error("Map niet gevonden");
  if (folder.is_system) throw new Error("Systeemmappen kunnen niet worden verwijderd");

  // Move documents to root — [Fo#3] abort on error; never proceed to the delete
  // with children still attached.
  const { error: docErr } = await supabase.from("documents").update({ folder_id: null })
    .eq("folder_id", folderId).eq("user_id", userId);
  if (docErr) throw new Error(docErr.message);

  // Reparent sub-folders to root BEFORE deleting. The folders parent_id FK is
  // ON DELETE CASCADE, so if this step were skipped or failed and we still deleted,
  // the cascade would silently wipe the entire descendant subtree. Abort on error.
  const { error: subErr } = await supabase.from("folders").update({ parent_id: null })
    .eq("parent_id", folderId).eq("user_id", userId);
  if (subErr) throw new Error(subErr.message);

  const { error: delErr } = await supabase.from("folders").delete()
    .eq("id", folderId).eq("user_id", userId);
  if (delErr) throw new Error(delErr.message);
}

// ─── Move Folder ──────────────────────────────────────────────────────────────────

export async function moveFolder(
  folderId: string,
  newParentId: string | null,
  userId: string,
  ctx: BestandenContext = "user"
): Promise<void> {
  const supabase = await resolveClient(ctx);
  if (folderId === newParentId) throw new Error("Kan map niet in zichzelf verplaatsen");

  // [Fo#5] System folders can't be moved (mirrors rename/delete). RLS already blocks
  // the UPDATE, but a 0-row update is NOT an error — without this guard the PATCH
  // route would report { ok: true } for a move that silently did nothing.
  const { data: self } = await supabase
    .from("folders").select("is_system").eq("id", folderId).eq("user_id", userId).maybeSingle();
  if (!self) throw new Error("Map niet gevonden");
  if (self.is_system) throw new Error("Systeemmappen kunnen niet worden verplaatst");

  // [Fo#1] Reject moving a folder INTO ITS OWN DESCENDANT. Such a move builds a
  // parent_id cycle: the whole ring detaches from the root-anchored tree (buildTree
  // only descends from parent_id=null → the subtree becomes invisible/unreachable),
  // and the breadcrumb's upward parent-walk recurses forever → page crash. Walk up
  // from the target's chain; if we reach folderId, the target is a descendant.
  // The lookup also validates ownership (Fo#5): an unknown/foreign parent is rejected.
  if (newParentId) {
    let cursor: string | null = newParentId;
    let guard = 0;
    while (cursor && guard < 100) {
      if (cursor === folderId) throw new Error("Kan een map niet naar een submap van zichzelf verplaatsen");
      const { data: parent } = await supabase
        .from("folders").select("parent_id").eq("id", cursor).eq("user_id", userId).maybeSingle();
      if (!parent) throw new Error("Doelmap niet gevonden");
      cursor = parent.parent_id as string | null;
      guard++;
    }
  }

  const { error } = await supabase
    .from("folders").update({ parent_id: newParentId })
    .eq("id", folderId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Search ───────────────────────────────────────────────────────────────────────

// [SEARCH] Neutralise PostgREST .or()/ILIKE metacharacters. A comma or paren in the
// query broke the .or() grammar; %/_ act as wildcards. Replace them with spaces so a
// query like "factuur, mei (2026)" no longer errors or mis-matches.
function sanitizeLike(q: string): string {
  return q.replace(/[,()%_*\\":]/g, " ").replace(/\s+/g, " ").trim();
}

// [SEARCH] The fuzzy RPCs (search_smart.sql) aren't in the generated Supabase types.
// Narrow cast that keeps `this` bound; returns [] on any error so search never breaks.
type RpcCaller = { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
async function fuzzyRpc(client: unknown, fn: string, query: string): Promise<unknown[]> {
  try {
    const { data, error } = await (client as RpcCaller).rpc(fn, { q: query.trim() });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function searchBestanden(
  userId: string,
  query: string,
  ctx: BestandenContext = "user"
): Promise<SearchResult[]> {
  const supabase = await resolveClient(ctx);
  const q = sanitizeLike(query);
  if (!q) return [];

  // [M3] Neutralise the user term before it is interpolated into the PostgREST
  // `.or()` filter string. Commas and parentheses are STRUCTURAL there (an unescaped
  // ")" or "," breaks out of the ilike list → malformed filter / injected predicates);
  // "%", "_" and "\" are LIKE wildcards/escape that would silently over-match. Strip
  // them so the term is matched literally. (user_id is ANDed outside the OR group, so
  // this was never a cross-tenant leak — but it is query-breakage/DoS hardening.)
  const safe = q.replace(/[,()%_\\]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, ai_suggested_folder, source, starred, trashed, shared")
    .eq("user_id", userId)
    .eq("trashed", false)
    .or(`file_name.ilike.%${safe}%,notes.ilike.%${safe}%,ai_doc_type.ilike.%${safe}%,doc_type.ilike.%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  let docs = (data ?? []) as BestandRow[];

  // [SEARCH] Typo-tolerant fallback when exact/substring found nothing — only for
  // NAME-like queries (a numeric query is exact-match territory; trigram-fuzzy on
  // numbers yields garbage).
  if (docs.length === 0 && /\p{L}/u.test(query)) {
    docs = (await fuzzyRpc(supabase, "search_documents_fuzzy", query)) as BestandRow[];
  }

  const folderIds = [...new Set(docs.map(d => d.folder_id).filter(Boolean))] as string[];
  let folderMap: Record<string, string> = {};
  if (folderIds.length > 0) {
    const { data: folders } = await supabase
      .from("folders").select("id, name").in("id", folderIds);
    folderMap = Object.fromEntries((folders ?? []).map(f => [f.id, f.name]));
  }

  return docs.map(d => ({ ...d, folder_name: d.folder_id ? (folderMap[d.folder_id] ?? null) : null }));
}

// [SEARCH] Folders are findable by name too (previously only documents were).
export interface FolderSearchResult {
  id: string;
  name: string;
  parent_id: string | null;
}

export async function searchFolders(
  userId: string,
  query: string,
  ctx: BestandenContext = "user"
): Promise<FolderSearchResult[]> {
  const supabase = await resolveClient(ctx);
  const q = sanitizeLike(query);
  if (!q) return [];

  const { data, error } = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .eq("user_id", userId)
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(20);

  if (error) throw new Error(error.message);
  let folders = (data ?? []) as FolderSearchResult[];

  // [SEARCH] Typo-tolerant fallback when the exact/substring name match found nothing —
  // name-like queries only (no trigram-fuzzy on numeric queries).
  if (folders.length === 0 && /\p{L}/u.test(query)) {
    folders = (await fuzzyRpc(supabase, "search_folders_fuzzy", query)) as FolderSearchResult[];
  }

  return folders;
}

// ─── Find folder by path ──────────────────────────────────────────────────────────

/**
 * Find a folder id by its path in the year structure.
 * Used by AI classification (BOEK-033) and email import (BOEK-011)
 * to place a file in the correct {year}/Q{n}/{maand}/Facturen folder.
 *
 * Returns null if the path's year structure does not exist.
 * [BOEK-011 note] Callers MUST call ensureYearStructure(userId, path.year)
 * BEFORE this — otherwise a file from an un-opened year returns null.
 * Prefer resolveImportTarget() which handles this ordering for you.
 */
export interface FolderPath {
  year: number;
  quarter?: number;
  month?: number;
  type?: "facturen" | "kosten" | "bank";
}

export async function findFolderByPath(
  userId: string,
  path: FolderPath,
  ctx: BestandenContext = "user"
): Promise<string | null> {
  const supabase = await resolveClient(ctx);

  // Get all system folders for this user
  const { data } = await supabase
    .from("folders")
    .select(FOLDER_SELECT)
    .eq("user_id", userId)
    .eq("is_system", true);

  const folders = (data ?? []) as FolderRow[];

  // Find year folder
  const yearFolder = folders.find(f => f.name === String(path.year) && f.parent_id === null && f.folder_type === "year");
  if (!yearFolder) return null;
  if (!path.quarter) return yearFolder.id;

  // Find quarter folder
  const quarterFolder = folders.find(f =>
    f.parent_id === yearFolder.id &&
    f.folder_type === "quarter" &&
    f.name.startsWith(`Q${path.quarter}`)
  );
  if (!quarterFolder) return yearFolder.id;

  // Bank — goes directly under quarter
  if (path.type === "bank") {
    const bankFolder = folders.find(f => f.parent_id === quarterFolder.id && f.folder_type === "bank");
    return bankFolder?.id ?? quarterFolder.id;
  }

  if (!path.month) return quarterFolder.id;

  // Find month folder
  const NL = NL_MONTHS[path.month];
  const monthFolder = folders.find(f => f.parent_id === quarterFolder.id && f.name === NL);
  if (!monthFolder) return quarterFolder.id;

  if (!path.type) return monthFolder.id;

  // Find type folder (facturen/kosten)
  const typeFolder = folders.find(f =>
    f.parent_id === monthFolder.id &&
    f.name.toLowerCase() === path.type
  );
  return typeFolder?.id ?? monthFolder.id;
}
// ─── resolveImportTarget ──────────────────────────────────────────────────────────

/**
 * [BOEK-033 Phase 1] One-call helper for importers (BOEK-011 email sync).
 *
 * Given an invoice date, this:
 *   1. ensures the year structure for THAT invoice's year exists
 *   2. returns the correct folder id ({year}/Q{n}/{maand}/Facturen)
 *   3. falls back to "Geïmporteerde bestanden" if the date is missing/invalid
 *
 * This is THE function BOEK-011 calls. BOEK-011 owns NO folder logic itself —
 * it passes ctx='pipeline' and an invoice date, gets back a folder_id.
 * Never returns null — a file always has a valid folder_id.
 *
 * @param userId      owner of the files
 * @param invoiceDate ISO date string extracted from invoice CONTENT, or null
 * @param type        'facturen' | 'kosten' | 'bank'
 * @param ctx         'pipeline' for background sync (service_role, no session),
 *                    'user' (default) for foreground/UI calls
 */
export async function resolveImportTarget(
  userId: string,
  invoiceDate: string | null,
  type: "facturen" | "kosten" | "bank",
  ctx: BestandenContext = "user"
): Promise<string> {
  // resolveImportTarget only orchestrates — each helper resolves its own client by ctx.

  // No date → cannot classify → fallback folder
  if (!invoiceDate) {
    return ensureImportedFolder(userId, ctx);
  }

  // [KWARTAAL-VAST] UTC-getters, niet de lokale. `new Date("2026-01-01")` is middernacht UTC, en
  // .getFullYear()/.getMonth() lezen dat in de tijdzone van wie het uitvoert: ten westen van UTC
  // wordt 1 januari dan 31 december, en het stuk komt in het jaar- én kwartaalmapje van het
  // VORIGE jaar te staan — waar de boekhouder het niet zoekt. Vandaag draait dit alleen
  // server-side (UTC), dus het gaat nu goed; dat is een eigenschap van de omgeving, niet van de
  // code. De canonieke afleiding doet het al zo (quarter.ts leest de maand uit de tekst zelf).
  const d = new Date(invoiceDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;

  // Invalid / out-of-range date → fallback
  // (matches BoekBrug_AI_Pipeline_Architecture.md: date outside 2020-2030 → null)
  if (isNaN(d.getTime()) || year < 2020 || year > 2030) {
    return ensureImportedFolder(userId, ctx);
  }

  const quarter = Math.ceil(month / 3);

  // Ensure the structure for THIS invoice's year exists (not the current year).
  // This is the mandatory ordering: ensure BEFORE findFolderByPath.
  await ensureYearStructure(userId, year, ctx);

  const folderId = await findFolderByPath(
    userId,
    { year, quarter, month: type === "bank" ? undefined : month, type },
    ctx
  );

  // Structure was just ensured, so this should not be null — but guard anyway.
  // Never return null; never leave a file's folder_id unset.
  return folderId ?? (await ensureImportedFolder(userId, ctx));
}