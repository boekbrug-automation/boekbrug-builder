// lib/documents.ts
// Document management helpers (BOEK-010)
// Upload → Supabase Storage, metadata → documents table
// Server-only — nooit importeren in Client Components

import { trashedDuplicateCleared } from "./trashed-dedup";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "./supabase-server";
import { inferDocType } from "./documents-utils";
import { readDocumentReferences, referencesRefusal } from "./document-references";
import type { DocumentReference } from "./document-references";
// [BRIDGE-EXTRACT] byte-hash dedup — één bestand → één hash → één record
import { computeContentHashFromFile } from "./content-hash";
import { logAuditAction } from "./audit";
import { removeOriginals, signedUrl, storeOriginal } from "./document-storage";

export { inferDocType } from "./documents-utils";

// ─── [BRIDGE-EXTRACT] Folder breadcrumb ──────────────────────────────────────

/**
 * Build the full folder path for a folder, walking parent_id up to the root.
 * Used to tell the user EXACTLY where a duplicate file already lives, e.g.
 * "2026 / Q1 / Facturen" instead of just the leaf name.
 *
 * Returns the path segments root→leaf. Empty array when folderId is null
 * (file sits at the root with no folder). Capped at 10 hops as a cycle guard.
 *
 * eslint-disable: supabase client type is inferred; depth-bounded loop.
 */
export async function buildFolderBreadcrumb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  folderId: string | null
): Promise<string[]> {
  if (!folderId) return [];

  const segments: string[] = [];
  let currentId: string | null = folderId;
  let guard = 0;

  while (currentId && guard < 10) {
    const { data: folder } = await supabase
      .from("folders")
      .select("name, parent_id")
      .eq("id", currentId)
      .eq("user_id", userId)
      .maybeSingle() as { data: { name: string; parent_id: string | null } | null };

    if (!folder) break;
    segments.unshift(folder.name);          // prepend → root ends up first
    currentId = folder.parent_id ?? null;
    guard++;
  }

  return segments;
}


// ─── Types ─────────────────────────────────────────────────────────────────────

// [BOEK-033] All file types allowed — ZZP uploads any business document
// Only restriction: file size max 50MB
export const ALLOWED_TYPES = new Set<string>([]); // empty = allow all

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build storage path — always private to the owner: userId/2026/Q1/20260514_file.pdf
 *
 * [FIN-UNIFY] Sharing is a metadata flag (documents.shared), NOT a storage layout.
 * The accountant reads the SAME object via RLS + a service_role-signed URL — there is
 * never a second physical copy. The old `shared/` path branch (and the sharedOnly
 * listing that read it) has been retired to keep exactly one definition of "shared".
 */
export function buildStoragePath(
  userId: string,
  fileName: string,
  year: number,
  quarter: number
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Prefix filename with today's date: YYYYMMDD_filename
  const today = new Date();
  const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  // [H1] Insert a short random token so two DIFFERENT files with the same name
  // uploaded the same day into the same quarter don't collide on one object key
  // (upload uses upsert:false → the second would otherwise fail). The content-hash
  // dedup gate still blocks true duplicates before we ever reach this path.
  const namedFile = `${datePrefix}_${randomUUID().slice(0, 8)}_${safe}`;

  return `${userId}/${year}/Q${quarter}/${namedFile}`;
}

// ─── Upload ────────────────────────────────────────────────────────────────────

/** Upload a file and insert its metadata record. Returns the document id. */
export async function uploadDocument(
  userId: string,
  file: File,
  opts: {
    invoiceId?: string;
    notes?: string;
    year: number;
    quarter: number;
    // [I#1] Destination folder chosen by the owner (the file manager uploads INTO
    // the folder the user is browsing). Without this the row defaults to folder_id
    // NULL (root) and the file silently leaves the folder on the next refresh.
    folderId?: string | null;
    // [BESTANDEN-DUP] When true, skip the byte-hash duplicate gate and upload
    // anyway. The personal file manager (Mijn bestanden) is the user's own
    // space — after an explicit "upload again" confirmation, they may keep a
    // second copy (e.g. archiving a file that also exists as an invoice).
    allowDuplicate?: boolean;
  }
): Promise<{
  id: string;
  error?: string;
  duplicate?: boolean;
  // [BRIDGE-EXTRACT] When duplicate=true, tells the UI WHERE the file already lives
  existing?: {
    id: string;
    file_name: string;
    folder_id: string | null;       // [BESTANDEN-DUP] target for "open de map" (?folder={id})
    folder_name: string | null;
    folder_path: string[];          // root→leaf breadcrumb, e.g. ["2026","Q1","Facturen"]
  };
}> {
  // [BOEK-033] All file types allowed — only size limit enforced
  if (file.size > MAX_FILE_SIZE) {
    return { id: "", error: "Bestand te groot (max 50MB)" };
  }

  const supabase = await createServerSupabaseClient();

  // [BRIDGE-EXTRACT] Byte-hash dedup gate — BEFORE Storage upload and DB insert.
  // Hash the raw file bytes (deterministic: identical bytes → identical hash).
  // Cross-path: documents from email / manual invoice / Mijn bestanden all carry
  // content_hash, so we catch the same file regardless of how it arrived.
  // Reject (Layer 1: stop the bleeding) — references are Layer 2.
  const contentHash = await computeContentHashFromFile(file);

  // [BESTANDEN-DUP] Skip the gate entirely when the user explicitly confirmed
  // "upload again". We still store content_hash below so future dedup works.
  if (!opts.allowDuplicate) {
    // [BRIDGE-EXTRACT] Fetch enough to tell the user WHERE the file already is.
    const { data: existingDoc } = await supabase
      .from("documents")
      .select("id, file_name, folder_id, trashed")
      .eq("user_id", userId)
      .eq("content_hash", contentHash)
      .limit(1)
      .maybeSingle();

    // [DUP-TRASHED] Een rij in de prullenbak houdt zijn content_hash vast, en deze poort las de
    // kolom niet eens — dus een weggegooid bestand blokkeerde zijn eigen her-upload voorgoed, met
    // een melding die wees naar een map waar het niet meer staat. trashed-dedup.ts somt de
    // deuren op die dit al deelden; uploadDocument was de vijfde, en de gemiste. Zelfde helper,
    // zelfde regel: alleen een AANTOONBAAR weggegooide rij geeft de sleutel vrij.
    if (existingDoc && (await trashedDuplicateCleared(supabase, userId, existingDoc))) {
      // De sleutel is vrij; de upload loopt verder als een vers bestand.
    } else if (existingDoc) {
      // [BRIDGE-EXTRACT] Full folder path (root→leaf) — folders nest, so the leaf
      // name alone ("Facturen") is ambiguous. Walk parent_id up the chain.
      const folderPath = await buildFolderBreadcrumb(
        supabase,
        userId,
        existingDoc.folder_id ?? null
      );
      const folderName = folderPath.length ? folderPath[folderPath.length - 1] : null;

      // Non-fatal audit — never blocks the response
      await logAuditAction({
        userId,
        action: "document.duplicate_blocked",
        entityType: "document",
        entityId: existingDoc.id,
        newValue: { file_name: file.name, content_hash: contentHash, path: "mijn_bestanden" },
      });

      // Build a Dutch message that points the user to the existing file.
      const where = folderPath.length
        ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
        : "Dit bestand is al toegevoegd";

      return {
        id: "",
        error: where,
        duplicate: true,
        existing: {
          id: existingDoc.id,
          file_name: existingDoc.file_name,
          folder_id: existingDoc.folder_id ?? null,
          folder_name: folderName,
          folder_path: folderPath,
        },
      };
    }
  }

  const path = buildStoragePath(userId, file.name, opts.year, opts.quarter);

  // 1. Upload to Storage
  const { error: storageError } = await storeOriginal(supabase, path, file, { upsert: false });

  if (storageError) {
    return { id: "", error: storageError.message };
  }

  // [BOEK-015] P4 fix: ensure profile exists before insert to prevent FK constraint error
  // This handles the case where user deleted their profile but kept their auth session
  const { data: profileExists } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();

  if (!profileExists) {
    // Get user data from auth to create profile
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      // Silent insert — ignore errors (race condition or already exists)
      try {
        await supabase.from("profiles").insert({
          id: userId,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name ?? null,
          onboarding_step: 1,
          onboarding_done: false,
          role: "zzper",
        });
      } catch {
        // silent — profile may already exist
      }
    }
  }

  // [BRUG-UPLOAD-DELEN] Did the owner drop this file INTO "Gedeeld met boekhouder"?
  //
  // The magic folder was built for exactly one act — putting a document where the accountant can
  // reach it — and the bestanden PATCH route honours that: a MOVE into folder_type='shared' sets
  // shared=true, which is the flag the accountant's RLS reads. An UPLOAD into that same folder went
  // straight through this insert, which never wrote the flag. So the owner opened the shared folder,
  // dropped the file, saw it sitting there, and the accountant received nothing. Silent, and in the
  // one direction where silence is worst: the owner believes the document has been handed over.
  //
  // This is not "upload now shares by default" — the rule the header of /api/files states still
  // holds everywhere else. It shares when the owner puts the file in the folder whose entire
  // purpose is sharing, which is the same declaration a move makes.
  let sharedOnUpload = false;
  if (opts.folderId) {
    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .select("folder_type")
      .eq("id", opts.folderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (folderError) {
      // Not fatal — a file that lands unshared is recoverable with one tap, a failed upload is not.
      // Logged because the owner will believe it was shared, and that belief is the whole defect.
      console.error("[BRUG-UPLOAD-DELEN] kon de doelmap niet lezen — het bestand wordt niet gedeeld", {
        folderId: opts.folderId, error: folderError.message,
      });
    }
    sharedOnUpload = folder?.folder_type === "shared";
  }

  // 2. Insert metadata — file_url stores the storage path (signed URL on read)
  const { data, error: dbError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      file_name: file.name,
      file_url: path,                            // raw path — signed on read
      file_size: file.size,
      file_type: file.type,
      doc_type: inferDocType(file.type),
      period: `${opts.year}-Q${opts.quarter}`,
      year: opts.year,
      invoice_id: opts.invoiceId ?? null,
      notes: opts.notes ?? null,
      folder_id: opts.folderId ?? null,          // [I#1] honour the chosen folder (else NULL = root)
      content_hash: contentHash,                 // [BRIDGE-EXTRACT] byte-hash for cross-path dedup
      // [BRUG-UPLOAD-DELEN] The period stamped above is this upload's own quarter, which is exactly
      // what the PATCH route falls back to when a document has no better one — so the closing
      // package places it the same way whether it was shared by a move or by being uploaded here.
      shared: sharedOnUpload,
    })
    .select("id")
    .single();

  if (dbError) {
    // Rollback storage upload
    await removeOriginals(supabase, [path]);
    return { id: "", error: dbError.message };
  }

  // [FIN-UNIFY] Upload does not share BY ITSELF — sharing is an explicit act on the
  // documents.shared flag. [BRUG-UPLOAD-DELEN] Dropping a file into "Gedeeld met boekhouder" IS
  // that act, and it is the only case where this insert sets the flag; every other upload lands
  // unshared exactly as before. No accountant notification is emitted here either way: the /brug
  // screen and the closing package read the flag, and adding a notification is a product decision
  // rather than a bug fix.
  return { id: data.id };
}

// ─── List ──────────────────────────────────────────────────────────────────────

/**
 * List a user's OWN documents (newest first, paginated).
 *
 * [FIN-UNIFY] The old `sharedOnly` storage-path filter (and the accountant view that
 * used it) is retired. Accountant access to a client's shared files is granted by the
 * documents.shared flag via RLS, read on /brug and in the closing package — a single
 * source of truth. This helper is owner-scoped only.
 */
export async function listDocuments(
  userId: string,
  opts: {
    year?: number;
    quarter?: number;
    docType?: string;
    limit?: number;
    cursor?: string;        // created_at for pagination
  }
): Promise<{ documents: DocumentRow[]; hasMore: boolean }> {
  const supabase = await createServerSupabaseClient();
  const limit = opts.limit ?? 30;

  let q = supabase
    .from("documents")
    .select(
      "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.year) q = q.eq("year", opts.year);
  if (opts.year && opts.quarter) q = q.eq("period", `${opts.year}-Q${opts.quarter}`);
  if (opts.docType) q = q.eq("doc_type", opts.docType);
  if (opts.cursor) q = q.lt("created_at", opts.cursor);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return {
    documents: (data ?? []) as DocumentRow[],
    hasMore: (data ?? []).length === limit,
  };
}

export interface DocumentRow {
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
}

// ─── Signed URL ────────────────────────────────────────────────────────────────

/** Get a signed URL for a private document (1 hour expiry) */
export async function getDocumentUrl(filePath: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await signedUrl(supabase, filePath, 3600);
  return data?.signedUrl ?? null;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

/** Delete a document from storage + DB */
/**
 * [BEWIJS-VAST] Why a delete was refused, as a code rather than by matching the Dutch sentence.
 *
 * `referenced` is a 409 — the owner can act on it. `check-failed` is a 503 — nothing is wrong with
 * his file, we simply could not verify, and telling him to try again is honest where a 409 would
 * send him hunting for a booking that does not exist.
 */
export type DeleteRefusal = "referenced" | "check-failed";

export async function deleteDocument(
  documentId: string,
  userId: string
): Promise<{ error?: string; code?: DeleteRefusal; references?: DocumentReference[] }> {
  const supabase = await createServerSupabaseClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("file_url")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();

  if (!doc) return { error: "Niet gevonden" };

  // [BEWIJS-VAST] Nothing that the boekhouding still points at is deleted here.
  //
  // The guard sits in this function rather than in the route that calls it, because the route is
  // not the property. Eight foreign keys reference this row; seven are ON DELETE SET NULL and one
  // is CASCADE, so the delete SUCCEEDS and takes the link (or the coverage record) with it — no
  // error, no audit line, and afterwards no way to tell an invoice that never had a scan from one
  // whose scan was thrown away. A second caller of deleteDocument would have to rediscover all of
  // that; a guard here cannot be walked around by adding one.
  const refs = await readDocumentReferences({ client: supabase, documentId });
  if (!refs.ok) {
    // The probe did not run. Refusing is the only answer that cannot destroy evidence: reading a
    // failed count as "no references" is exactly the case this check exists for.
    console.error("[BEWIJS-VAST] reference check failed, refusing delete", { documentId, failed: refs.failed });
    return {
      error:
        "We konden niet nagaan of je boekhouding nog naar dit bestand verwijst, dus is het niet " +
        "verwijderd. Probeer het straks opnieuw — het bestand staat nog in je prullenbak.",
      code: "check-failed",
    };
  }
  if (refs.references.length > 0) {
    // Both shapes: the Dutch sentence for the API's `error` (a log, a curl, an older client) and
    // the catalogue keys for the screen, which renders them in the owner's own language.
    return { error: referencesRefusal(refs.references), code: "referenced", references: refs.references };
  }

  // [I#2] Delete the DB row FIRST and abort on failure — a failed row-delete then
  // touches no storage (no orphaned object). [L8] scope by user_id for defense-in-depth.
  const { error: delErr } = await supabase.from("documents").delete()
    .eq("id", documentId).eq("user_id", userId);
  if (delErr) return { error: delErr.message };

  // Then remove the storage object. A failed remove leaves an orphaned object (a
  // background sweep can reclaim it) but never a dangling row that would sign 404 URLs.
  const { error: rmErr } = await removeOriginals(supabase, [doc.file_url]);
  if (rmErr) return { error: rmErr.message };

  return {};
}