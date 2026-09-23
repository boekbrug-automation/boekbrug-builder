// src/lib/archive-expand.ts
// [ARCHIEF-OPEN] Een zip-bijlage vervangen door de documenten die erin zitten.
// [ARCHIEF-WAAR] …and saying, for every one of them, what became of it.
//
// Het OORDEEL staat in archive-attachment.ts en is puur; dit bestand doet alleen het uitpakken,
// met jszip (al een dependency). De scheiding is met opzet: de plafonds en de weigerredenen zijn
// het deel dat getest moet worden en dat een mens moet kunnen nalezen, en die horen niet verstopt
// te zitten achter een bibliotheekaanroep.
//
// De uitgepakte bestanden gaan het pad in ALSOF ze los aan de mail hingen: dezelfde classificatie,
// dezelfde dubbelpoorten, dezelfde verificatierij. Een archief is een envelop, geen achterdeur.
//
// ── WHAT CHANGED WITH [ARCHIEF-WAAR] ──
//
// The first version returned a "consumed" key for every archive it touched, and the sync marked
// that key complete before a single member had been read — even when the zip could not be opened
// at all. The watermark then walked past mail whose contents existed nowhere. This module no
// longer decides completion. It opens ONE archive and reports three things the caller turns into
// durable truth: the members (each with a stable key), the refusals (each with the key the owner
// will see it under), and whether the archive as a whole was refused. Whether the archive is DONE
// is decided by the sync, from what actually happened to each member.

import JSZip from "jszip";
import {
  planArchive,
  isOpenableArchive,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  ARCHIVE_OWNER_ACTION,
  type ArchiveEntry,
} from "./archive-attachment";

/** Zo min mogelijk van de mailbijlage — genoeg om er een nieuwe van te maken. */
export interface ExpandableAttachment {
  messageId: string;
  filename: string;
  mimeType: string;
  /** base64 (of base64url, zoals Gmail levert). */
  data: string;
  size?: number;
  /** Set on everything that comes OUT of an archive. */
  fromArchive?: boolean;
  /** The `${messageId}:${filename}` key of the archive a member came out of. */
  archiveKey?: string;
}

/**
 * Something inside (or about) an archive that did not go on to the reader.
 *
 * `key` is the registry key the refusal is stored under, and it is chosen so that a refusal can
 * never collide with a member: a member refusal uses the member's own key, a whole-archive refusal
 * uses the archive's key — which is also the key of the old "cannot read .zip" row, so writing the
 * refusal replaces that stale reason instead of standing next to it.
 */
export interface ArchiveRefusal {
  key: string;
  filename: string;
  reason: string;
  /** True when the whole archive was refused: then there are no members at all. */
  whole: boolean;
}

export interface OpenedArchive<T> {
  /** `${messageId}:${filename}` of the archive itself. */
  archiveKey: string;
  members: T[];
  refusals: ArchiveRefusal[];
  /** True when nothing inside the archive may go on — corrupt, too big, too many, empty. */
  refusedWhole: boolean;
}

/** base64url → Buffer. Gmail levert `-`/`_`; Outlook gewoon base64. */
function toBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  heic: "image/heic", webp: "image/webp", xml: "application/xml", ubl: "application/xml",
  csv: "text/csv", txt: "text/plain",
  // [ARCHIEF-OPEN] Zonder deze twee komt een kassa-xlsx uit de zip als application/octet-stream
  // en herkent de spreadsheetlezer hem niet meer — uitgepakt en dan alsnog onleesbaar.
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * [ARCHIEF-WAAR] The name a member is known by — to the owner, and as its registry key.
 *
 * The FULL path inside the archive, not the basename. Two till exports that both put a
 * `dagafsluiting.pdf` in different folders of one zip are two documents; keyed on the basename they
 * were one key, and the second was counted as already handled the moment the first was. Readable
 * to the owner too: the envelope's name, then where in it the file sat.
 */
export function archiveMemberName(archiveFilename: string, entryPath: string): string {
  const base = archiveFilename.replace(/\.zip$/i, "");
  const path = entryPath.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  return `${base} — ${path}`;
}

/** What reading one member's bytes produced. */
export type MemberBytes =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "too_big" | "unreadable" };

/**
 * [ARCHIEF-WAAR] Inflate one entry while COUNTING what actually comes out.
 *
 * The plan upstream trusts the sizes the zip's own index declares, and a hostile zip can declare
 * anything. jszip checks a declared size only after it has inflated the whole entry into memory, so
 * "declared 1 KB, actually 2 GB" would be discovered by the process running out of memory. Reading
 * the entry as a stream and stopping the moment the real byte count passes `limit` bounds the
 * memory by the limit itself (plus one inflate chunk), whatever the index says.
 */
export function readMemberBounded(entry: JSZip.JSZipObject, limit: number): Promise<MemberBytes> {
  return new Promise((resolve) => {
    let settled = false;
    let total = 0;
    const chunks: Uint8Array[] = [];
    const finish = (r: MemberBytes) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    // internalStream is jszip's public-but-untyped streaming reader (zipObject.js).
    const stream = (entry as unknown as {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        stream.pause();
        finish({ ok: false, reason: "too_big" });
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => finish({ ok: false, reason: "unreadable" }));
    stream.on("end", () => finish({ ok: true, bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))) }));
    stream.resume();
  });
}

/** Refusal sentences for what can only be learned while reading the bytes. */
const TE_GROOT_ECHT =
  "te groot om automatisch te lezen (meer dan 10 MB) — splits de PDF of maak er een foto van en voeg die toe bij Uploaden";
const NIET_TE_LEZEN = `dit bestand kon niet uit het archief worden gelezen — ${ARCHIVE_OWNER_ACTION}`;
const KAPOT = `het archief kon niet worden geopend (beschadigd of met een wachtwoord beveiligd) — ${ARCHIVE_OWNER_ACTION}`;
const TE_GROOT_GEHEEL = `het archief is uitgepakt groter dan 25 MB — ${ARCHIVE_OWNER_ACTION}`;

/** Ceilings, injectable so a test can prove them without building a 25 MB fixture. */
export interface ArchiveLimits {
  entryBytes: number;
  totalBytes: number;
}
const DEFAULT_LIMITS: ArchiveLimits = { entryBytes: MAX_ENTRY_BYTES, totalBytes: MAX_TOTAL_BYTES };

/**
 * [ARCHIEF-WAAR] Open ONE zip and report every member and every refusal, each under its own key.
 *
 * Never throws and never decides completion. All-or-nothing on the archive-wide ceilings: if the
 * real, counted bytes of the whole archive pass `totalBytes`, the members already read are dropped
 * and the archive is refused whole — half an archive is an administration nobody can reason about.
 */
export async function openArchive<T extends ExpandableAttachment>(
  att: T,
  limits: ArchiveLimits = DEFAULT_LIMITS,
): Promise<OpenedArchive<T>> {
  const archiveKey = `${att.messageId}:${att.filename}`;
  const wholeRefusal = (reason: string): OpenedArchive<T> => ({
    archiveKey,
    members: [],
    refusals: [{ key: archiveKey, filename: att.filename, reason, whole: true }],
    refusedWhole: true,
  });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(toBuffer(att.data));
  } catch {
    return wholeRefusal(KAPOT);
  }

  const files = Object.values(zip.files).filter((f) => !f.dir);
  const entries: ArchiveEntry[] = files.map((f) => ({
    filename: f.name,
    // The DECLARED size from the zip's index — cheap, and enough to refuse an honest oversize
    // before inflating anything. readMemberBounded below is what holds against a dishonest one.
    bytes: Number((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
  }));

  const plan = planArchive(entries);
  if (plan.refusedWhole) return wholeRefusal(plan.refusedWhole);

  const refusals: ArchiveRefusal[] = [];
  for (const s of plan.skipped) {
    if (s.silent) continue; // archive chrome (__MACOSX, .DS_Store): refused, but not a document
    const naam = archiveMemberName(att.filename, s.filename);
    refusals.push({ key: `${att.messageId}:${naam}`, filename: naam, reason: s.reason, whole: false });
  }

  const members: T[] = [];
  let totalRead = 0;
  for (const wanted of plan.take) {
    const f = files.find((x) => x.name === wanted.filename);
    if (!f) continue;
    const naam = archiveMemberName(att.filename, f.name);
    const key = `${att.messageId}:${naam}`;
    const remaining = limits.totalBytes - totalRead;
    const read = await readMemberBounded(f, Math.min(limits.entryBytes, remaining));
    if (!read.ok) {
      // Over the WHOLE-archive budget is an archive-level refusal, not a member one: the index
      // lied about the total, and the rule above says nothing of it goes on.
      if (read.reason === "too_big" && remaining < limits.entryBytes) return wholeRefusal(TE_GROOT_GEHEEL);
      refusals.push({
        key, filename: naam, whole: false,
        reason: read.reason === "too_big" ? TE_GROOT_ECHT : NIET_TE_LEZEN,
      });
      continue;
    }
    totalRead += read.bytes.length;
    members.push({
      ...att,
      fromArchive: true,
      archiveKey,
      filename: naam,
      mimeType: mimeFor(f.name),
      data: read.bytes.toString("base64"),
      size: read.bytes.length,
    } as T);
  }
  return { archiveKey, members, refusals, refusedWhole: false };
}

/** Is this attachment an archive the sync opens? Re-exported so callers need one import. */
export { isOpenableArchive };
