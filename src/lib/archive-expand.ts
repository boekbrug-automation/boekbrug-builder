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
import { inflateRawSync } from "node:zlib";
import {
  judgeEntry,
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
  /**
   * [ARCHIEF-WAAR] The registry key of a member — see archiveMemberKey. Set on everything that comes
   * out of an archive; a loose attachment has none and keeps `${messageId}:${filename}`.
   */
  memberKey?: string;
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
 * [ARCHIEF-WAAR] The one spelling of a path inside an archive.
 *
 * A zip may spell one location several ways: `map\b.pdf`, `map//b.pdf`, `./map/b.pdf`,
 * `/map/b.pdf`, `x/../map/b.pdf`, or the same letters in two Unicode forms. JSZip itself folds some
 * of these onto one entry when it loads the archive (and then keeps only the last), others it keeps
 * apart. This rule folds ALL of them, so it is at least as strict as JSZip's: two entries that JSZip
 * merges always land in the same group here, and a group with more than one entry is examined
 * instead of silently losing one.
 */
export function normalizeMemberPath(entryPath: string): string {
  const out: string[] = [];
  for (const seg of entryPath.normalize("NFC").replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * [ARCHIEF-WAAR] The name a member is SHOWN by: the envelope's name, then where in it the file sat.
 * The full path, not the basename — two `dagafsluiting.pdf` in different folders are two documents.
 * This is a display name only. It is NOT the registry key: see archiveMemberKey.
 */
export function archiveMemberName(archiveFilename: string, entryPath: string): string {
  const base = archiveFilename.replace(/\.zip$/i, "");
  return `${base} — ${normalizeMemberPath(entryPath)}`;
}

/**
 * [ARCHIEF-WAAR] The registry key of a member.
 *
 * A loose attachment is keyed `${messageId}:${filename}`, and the provider decides the filename —
 * so any key built the same way from a member's display name can be produced by a loose attachment
 * too: a loose `bundle — invoice.pdf` and `bundle.zip`'s `invoice.pdf` were one key, and the member
 * was skipped as "already handled" the moment the loose file was. Two archives in one message
 * collided the same way (`a.zip` → `b — c.pdf`, `a — b.zip` → `c.pdf`).
 *
 * So a member key lives in its own namespace and encodes its three parts without ambiguity:
 *   · it starts with `zip:[` — a loose key starts with the provider's message id (hex for Gmail,
 *     base64url for Graph), which never is `zip`;
 *   · the rest is JSON of [messageId, archive filename, normalised path] — JSON of a string array is
 *     injective, so no two different (message, archive, path) triples share a key, whatever the
 *     names contain.
 * The `:dubbel` suffix stays unambiguous: a member key ends in `"]`, never in `:dubbel`.
 */
export function archiveMemberKey(messageId: string, archiveFilename: string, entryPath: string): string {
  return `zip:${JSON.stringify([messageId, archiveFilename, normalizeMemberPath(entryPath)])}`;
}

/** One record of the zip's own central directory, read without JSZip. */
interface RawEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * [ARCHIEF-WAAR] Read the central directory ourselves.
 *
 * JSZip exposes one entry per (JSZip-normalised) name, so an archive holding two entries at one path
 * shows up as one — the other copy is simply not there to ask about. The central directory still
 * lists both. Returns null when the directory cannot be walked; the caller then refuses the archive,
 * because a name check that did not run has not proven anything.
 */
function readCentralDirectory(buf: Buffer): { entries: RawEntry[]; shift: number } | null {
  const EOCD = 0x06054b50, CENTRAL = 0x02014b50, Z64_LOCATOR = 0x07064b50, Z64_EOCD = 0x06064b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let recordStart = eocd;
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== Z64_LOCATOR) return null;
    const z = loc - 56;
    if (z < 0 || buf.readUInt32LE(z) !== Z64_EOCD) return null;
    count = Number(buf.readBigUInt64LE(z + 32));
    cdSize = Number(buf.readBigUInt64LE(z + 40));
    cdOffset = Number(buf.readBigUInt64LE(z + 48));
    recordStart = z;
  }
  // The directory ends where the end record begins. Bytes prepended to the archive (a self-extractor
  // stub, a mail gateway's banner) shift every stored offset by the same amount.
  const cdStart = recordStart - cdSize;
  if (cdStart < 0) return null;
  const shift = cdStart - cdOffset;
  const entries: RawEntry[] = [];
  let pos = cdStart;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL) return null;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const utf8 = (buf.readUInt16LE(pos + 8) & 0x0800) !== 0;
    const raw = buf.subarray(pos + 46, pos + 46 + nameLen);
    entries.push({
      name: raw.toString(utf8 ? "utf8" : "latin1"),
      method: buf.readUInt16LE(pos + 10),
      compressedSize: buf.readUInt32LE(pos + 20),
      localHeaderOffset: buf.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, shift };
}

/** Inflate one raw entry, bounded. Null when it cannot be read within `limit`. */
function readRawEntry(buf: Buffer, e: RawEntry, shift: number, limit: number): Buffer | null {
  try {
    const at = e.localHeaderOffset + shift;
    if (at < 0 || at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return null;
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + e.compressedSize);
    if (data.length !== e.compressedSize) return null;
    if (e.method === 0) return data.length <= limit ? Buffer.from(data) : null;
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: limit });
    return null;
  } catch {
    return null; // a broken stream, or more than `limit` bytes: either way not comparable
  }
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
// [ARCHIEF-WAAR] A broken file cannot be unpacked by the owner either, so "pak het zelf uit" sends
// them to a step that fails. What CAN work is a sound copy from whoever sent it. A locked archive is
// different: it is intact, and whoever has the password can unpack it — that path stays.
const NIET_TE_LEZEN =
  "dit bestand in het archief is beschadigd — vraag de afzender om een nieuwe kopie; lukt uitpakken bij jou wel, voeg het dan toe bij Uploaden";
const KAPOT =
  "het archief is beschadigd en kon niet worden geopend — vraag de afzender om een nieuwe kopie, of om de bestanden los mee te sturen";
const VERGRENDELD =
  `het archief is beveiligd met een wachtwoord — heb je het wachtwoord, ${ARCHIVE_OWNER_ACTION}; anders: vraag de afzender de bestanden zonder wachtwoord te sturen`;
const ZELFDE_NAAM =
  "het archief bevat twee verschillende bestanden met dezelfde naam — vraag de afzender ze met een eigen naam, of los, mee te sturen";
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

  const raw = toBuffer(att.data);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(raw);
  } catch (e) {
    return wholeRefusal(/encrypt/i.test(e instanceof Error ? e.message : "") ? VERGRENDELD : KAPOT);
  }

  // [ARCHIEF-WAAR] Two entries at one path. Grouped on OUR normalised path over the directory's own
  // names — JSZip has already merged some of them, and the copy it dropped is not in `zip.files`.
  // A group is one document only when every entry in it has the same bytes; anything else, or
  // anything that cannot be compared, refuses the archive: two documents may not share one key,
  // and guessing which copy is "the" invoice is not ours to do.
  const directory = readCentralDirectory(raw);
  if (!directory) return wholeRefusal(KAPOT);
  const groups = new Map<string, RawEntry[]>();
  for (const e of directory.entries) {
    if (e.name.endsWith("/") || e.name.endsWith("\\")) continue;
    const verdict = judgeEntry({ filename: e.name, bytes: 1 });
    if (!verdict.take && verdict.silent) continue; // archive chrome is never a document
    const key = normalizeMemberPath(e.name);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const copies = group.map((e) => readRawEntry(raw, e, directory.shift, limits.entryBytes));
    const first = copies[0];
    if (!first || copies.some((c) => !c || !c.equals(first))) return wholeRefusal(ZELFDE_NAAM);
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

  // One outcome per normalised path: a group that survived the check above is the same bytes under
  // two spellings, and it is one document — the first spelling speaks for it.
  const seen = new Set<string>();
  const refusals: ArchiveRefusal[] = [];
  for (const s of plan.skipped) {
    if (s.silent) continue; // archive chrome (__MACOSX, .DS_Store): refused, but not a document
    const path = normalizeMemberPath(s.filename);
    if (seen.has(path)) continue;
    seen.add(path);
    refusals.push({
      key: archiveMemberKey(att.messageId, att.filename, path),
      filename: archiveMemberName(att.filename, path),
      reason: s.reason,
      whole: false,
    });
  }

  const members: T[] = [];
  let totalRead = 0;
  for (const wanted of plan.take) {
    const f = files.find((x) => x.name === wanted.filename);
    if (!f) continue;
    const path = normalizeMemberPath(f.name);
    if (seen.has(path)) continue;
    seen.add(path);
    const naam = archiveMemberName(att.filename, path);
    const key = archiveMemberKey(att.messageId, att.filename, path);
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
      memberKey: key,
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
