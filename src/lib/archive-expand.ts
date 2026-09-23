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
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import {
  judgeEntry,
  planArchive,
  isOpenableArchive,
  MAX_ENTRIES,
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
  /** As DECLARED by the directory — a pre-filter only; the counted bytes are what hold. */
  declaredSize: number;
  localHeaderOffset: number;
}

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

/** A 64-bit field as a number. Past 2^53 no size or offset in an archive we could open is real. */
function u64(buf: Buffer, at: number): number {
  const v = buf.readBigUInt64LE(at);
  return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
}

/**
 * [ARCHIEF-WAAR] The ZIP64 extended-information extra field (header 0x0001, APPNOTE 4.5.3) of one
 * directory record. It holds, IN THIS ORDER and ONLY for the fields the record left as a placeholder:
 * uncompressed size (8), compressed size (8), local-header offset (8), disk number (4). Null when a
 * value the record needs is missing, or the extra area itself does not parse.
 */
function readZip64Extra(
  extra: Buffer,
  need: { uncompressed: boolean; compressed: boolean; offset: boolean; disk: boolean },
): { uncompressed?: number; compressed?: number; offset?: number; disk?: number } | null {
  for (let p = 0; p + 4 <= extra.length;) {
    const id = extra.readUInt16LE(p);
    const start = p + 4;
    const end = start + extra.readUInt16LE(p + 2);
    if (end > extra.length) return null;
    if (id === 0x0001) {
      const out: { uncompressed?: number; compressed?: number; offset?: number; disk?: number } = {};
      let q = start;
      for (const field of ["uncompressed", "compressed", "offset"] as const) {
        if (!need[field]) continue;
        if (q + 8 > end) return null;
        out[field] = u64(extra, q);
        q += 8;
      }
      if (need.disk) {
        if (q + 4 > end) return null;
        out.disk = extra.readUInt32LE(q);
      }
      return out;
    }
    p = end;
  }
  return null; // a placeholder with no ZIP64 field to resolve it
}

/** What the directory walk found, plus the view JSZip must be given (see ZIP64 below). */
interface Directory {
  entries: RawEntry[];
  shift: number;
  /** A copy for JSZip without the ZIP64 extensible data sector, or null to hand it the original. */
  jszipView: Buffer | null;
}

/**
 * [ARCHIEF-WAAR] Read the central directory ourselves.
 *
 * JSZip exposes one entry per (JSZip-normalised) name, so an archive holding two entries at one path
 * shows up as one — the other copy is simply not there to ask about. The central directory still
 * lists both. Returns null when the directory cannot be walked; the caller then refuses the archive,
 * because a name check that did not run has not proven anything.
 *
 * "Walked" means ACCOUNTED FOR: the records must end exactly where the directory says it ends. An
 * end record that under-counts its entries is read by JSZip as far as the count goes and no
 * further, so a record past the count is a file nothing downstream ever sees.
 *
 * [ARCHIEF-WAAR] ZIP64 (APPNOTE 4.3.14–4.3.16, 4.5.3). A writer may use ZIP64 for a small archive
 * too: 32-bit placeholders (0xFFFF / 0xFFFFFFFF) in the ordinary records, real values in ZIP64
 * records. Reading the placeholder as a size refused a 179-byte archive as "larger than 25 MB".
 *   · The ZIP64 end record is found through its LOCATOR, and it is variable-length: it is the record
 *     whose own size field makes it end exactly at the locator. Its extensible data sector must be
 *     whole blocks (id 2, size 4, data). Where the classic end record carries a real value, it must
 *     agree with the ZIP64 one. The locator's offset must agree with where the record really is,
 *     after the same shift the directory has.
 *   · Every placeholder in a directory record is resolved from that record's ZIP64 extra field.
 *   · Missing or inconsistent ZIP64 data is not guessed around: null, and the archive is refused as
 *     damaged — which is then true.
 *   · JSZip (3.x) cannot read an extensible data sector at all: its loop over it never advances. So
 *     when one is present and valid, JSZip is handed a copy without it. The sector sits after the
 *     directory, so no member offset moves.
 */
function readCentralDirectory(buf: Buffer): Directory | null {
  const EOCD = 0x06054b50, CENTRAL = 0x02014b50, Z64_LOCATOR = 0x07064b50, Z64_EOCD = 0x06064b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const classic = {
    disk: buf.readUInt16LE(eocd + 4),
    cdDisk: buf.readUInt16LE(eocd + 6),
    onDisk: buf.readUInt16LE(eocd + 8),
    count: buf.readUInt16LE(eocd + 10),
    cdSize: buf.readUInt32LE(eocd + 12),
    cdOffset: buf.readUInt32LE(eocd + 16),
  };
  const placeholders =
    classic.disk === MAX16 || classic.cdDisk === MAX16 || classic.onDisk === MAX16 || classic.count === MAX16 ||
    classic.cdSize === MAX32 || classic.cdOffset === MAX32;
  const loc = eocd - 20;
  const hasLocator = loc >= 0 && buf.readUInt32LE(loc) === Z64_LOCATOR;
  if (placeholders && !hasLocator) return null;

  let count = classic.count, cdSize = classic.cdSize, cdOffset = classic.cdOffset;
  let recordStart = eocd;
  let z64Shift: number | null = null;
  let jszipView: Buffer | null = null;
  if (hasLocator) {
    if (buf.readUInt32LE(loc + 4) !== 0 || buf.readUInt32LE(loc + 16) !== 1) return null; // one disk only
    const declared = u64(buf, loc + 8);
    // The variable-length record: the one whose own size field ends it exactly at the locator.
    let z = -1;
    for (let p = loc - 56; p >= Math.max(0, loc - 56 - 0xffff); p--) {
      if (buf.readUInt32LE(p) === Z64_EOCD && p + 12 + u64(buf, p + 4) === loc) { z = p; break; }
    }
    if (z < 0 || u64(buf, z + 4) < 44) return null;
    if (buf.readUInt32LE(z + 16) !== 0 || buf.readUInt32LE(z + 20) !== 0) return null;
    const z64 = { onDisk: u64(buf, z + 24), count: u64(buf, z + 32), cdSize: u64(buf, z + 40), cdOffset: u64(buf, z + 48) };
    if (z64.onDisk !== z64.count) return null;
    // The extensible data sector: whole blocks of id (2) + size (4) + data, nothing left over.
    const sectorEnd = loc;
    for (let q = z + 56; q < sectorEnd;) {
      if (q + 6 > sectorEnd) return null;
      q += 6 + buf.readUInt32LE(q + 2);
      if (q > sectorEnd) return null;
    }
    // A real value in the classic record must agree with its ZIP64 counterpart — the disk numbers
    // included, which the ZIP64 record has just pinned to 0. A classic record that names another
    // disk is a spanned archive, or one whose two records disagree; neither is read.
    if (classic.disk !== MAX16 && classic.disk !== 0) return null;
    if (classic.cdDisk !== MAX16 && classic.cdDisk !== 0) return null;
    if (classic.count !== MAX16 && classic.count !== z64.count) return null;
    if (classic.onDisk !== MAX16 && classic.onDisk !== z64.onDisk) return null;
    if (classic.cdSize !== MAX32 && classic.cdSize !== z64.cdSize) return null;
    if (classic.cdOffset !== MAX32 && classic.cdOffset !== z64.cdOffset) return null;
    count = z64.count; cdSize = z64.cdSize; cdOffset = z64.cdOffset;
    recordStart = z;
    z64Shift = z - declared;
    if (z + 56 < sectorEnd) {
      const head = Buffer.from(buf.subarray(z, z + 56));
      head.writeBigUInt64LE(BigInt(44), 4);
      jszipView = Buffer.concat([buf.subarray(0, z), head, buf.subarray(sectorEnd)]);
    }
  } else if (classic.disk !== 0 || classic.cdDisk !== 0 || classic.onDisk !== classic.count) {
    return null; // a spanned archive; nothing here reads one
  }

  // The directory ends where the end record begins. Bytes prepended to the archive (a self-extractor
  // stub, a mail gateway's banner) shift every stored offset by the same amount — the ZIP64 record's
  // offset in the locator included.
  const cdStart = recordStart - cdSize;
  if (cdStart < 0) return null;
  const shift = cdStart - cdOffset;
  if (shift < 0 || (z64Shift !== null && z64Shift !== shift)) return null;

  const entries: RawEntry[] = [];
  let pos = cdStart;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL) return null;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen + extraLen + commentLen > recordStart) return null;
    const utf8 = (buf.readUInt16LE(pos + 8) & 0x0800) !== 0;
    const raw = buf.subarray(pos + 46, pos + 46 + nameLen);
    let compressedSize = buf.readUInt32LE(pos + 20);
    let declaredSize = buf.readUInt32LE(pos + 24);
    let diskStart = buf.readUInt16LE(pos + 34);
    let localHeaderOffset = buf.readUInt32LE(pos + 42);
    const need = {
      uncompressed: declaredSize === MAX32, compressed: compressedSize === MAX32,
      offset: localHeaderOffset === MAX32, disk: diskStart === MAX16,
    };
    if (need.uncompressed || need.compressed || need.offset || need.disk) {
      const z = readZip64Extra(buf.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen), need);
      if (!z) return null;
      if (need.uncompressed) declaredSize = z.uncompressed!;
      if (need.compressed) compressedSize = z.compressed!;
      if (need.offset) localHeaderOffset = z.offset!;
      if (need.disk) diskStart = z.disk!;
    }
    if (diskStart !== 0) return null;
    entries.push({
      name: raw.toString(utf8 ? "utf8" : "latin1"),
      method: buf.readUInt16LE(pos + 10),
      compressedSize,
      declaredSize,
      localHeaderOffset,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (pos !== recordStart) return null; // records left over, or the count overran the directory
  return { entries, shift, jszipView };
}

/**
 * Inflate one raw entry, bounded by `limit`, and keep only its fingerprint. The inflated bytes are
 * dropped before this returns, so comparing N copies holds one copy in memory, never N.
 */
function fingerprintRawEntry(
  buf: Buffer, e: RawEntry, shift: number, limit: number,
): { ok: true; bytes: number; hash: string } | { ok: false; reason: "too_big" | "unreadable" } {
  try {
    const at = e.localHeaderOffset + shift;
    if (at < 0 || at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return { ok: false, reason: "unreadable" };
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + e.compressedSize);
    if (data.length !== e.compressedSize) return { ok: false, reason: "unreadable" };
    let out: Buffer;
    if (e.method === 0) {
      if (data.length > limit) return { ok: false, reason: "too_big" };
      out = data;
    } else if (e.method === 8) {
      out = inflateRawSync(data, { maxOutputLength: limit });
    } else {
      return { ok: false, reason: "unreadable" };
    }
    return { ok: true, bytes: out.length, hash: createHash("sha256").update(out).digest("hex") };
  } catch (err) {
    // zlib refuses to produce more than `limit` with a RangeError; anything else is a broken stream.
    return { ok: false, reason: err instanceof RangeError ? "too_big" : "unreadable" };
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
  /** Raw directory records (directories excluded) — counted BEFORE JSZip merges any names. */
  maxEntries?: number;
}
const DEFAULT_LIMITS: ArchiveLimits = { entryBytes: MAX_ENTRY_BYTES, totalBytes: MAX_TOTAL_BYTES, maxEntries: MAX_ENTRIES };

/**
 * [ARCHIEF-WAAR] Open ONE zip and report every member and every refusal, each under its own key.
 *
 * Never throws and never decides completion. All-or-nothing on the archive-wide ceilings: if the
 * real, counted bytes of the whole archive pass `totalBytes`, the members already read are dropped
 * and the archive is refused whole — half an archive is an administration nobody can reason about.
 */
export async function openArchive<T extends ExpandableAttachment>(
  att: T,
  given: ArchiveLimits = DEFAULT_LIMITS,
): Promise<OpenedArchive<T>> {
  const limits = { ...DEFAULT_LIMITS, ...given } as Required<ArchiveLimits>;
  const archiveKey = `${att.messageId}:${att.filename}`;
  const wholeRefusal = (reason: string): OpenedArchive<T> => ({
    archiveKey,
    members: [],
    refusals: [{ key: archiveKey, filename: att.filename, reason, whole: true }],
    refusedWhole: true,
  });

  const raw = toBuffer(att.data);
  // [ARCHIEF-WAAR] The directory is walked FIRST: it decides whether the archive is sound, and what
  // JSZip is shown (a ZIP64 extensible sector it cannot read is stripped; see readCentralDirectory).
  const directory = readCentralDirectory(raw);
  if (!directory) return wholeRefusal(KAPOT);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(directory.jszipView ?? raw);
  } catch (e) {
    return wholeRefusal(/encrypt/i.test(e instanceof Error ? e.message : "") ? VERGRENDELD : KAPOT);
  }

  // [ARCHIEF-WAAR] Two entries at one path. Grouped on OUR normalised path over the directory's own
  // names — JSZip has already merged some of them, and the copy it dropped is not in `zip.files`.
  // A group is one document only when every entry in it has the same bytes; anything else, or
  // anything that cannot be compared, refuses the archive: two documents may not share one key,
  // and guessing which copy is "the" invoice is not ours to do.
  const rawFiles = directory.entries.filter((e) => !e.name.endsWith("/") && !e.name.endsWith("\\"));

  // [ARCHIEF-WAAR] The ceilings apply to what the archive HOLDS, before anything is inflated.
  // planArchive below counts what JSZip shows, and JSZip has already merged every entry that shares
  // a name — 26 copies of one name are one file to it. So the count and the declared total are taken
  // here, over the raw records; the counted bytes further down are what hold against a zip that lies.
  if (rawFiles.length > limits.maxEntries) {
    return wholeRefusal(
      `het archief bevat ${rawFiles.length} bestanden (meer dan ${limits.maxEntries}), te veel om automatisch te verwerken — ${ARCHIVE_OWNER_ACTION}`,
    );
  }
  if (rawFiles.reduce((sum, e) => sum + e.declaredSize, 0) > limits.totalBytes) return wholeRefusal(TE_GROOT_GEHEEL);

  // Nothing JSZip sees may be missing from the directory we checked. After the walk above this
  // cannot happen by construction; asserted anyway, because the member loop trusts JSZip's list.
  const onRecord = new Set(rawFiles.map((e) => normalizeMemberPath(e.name)));
  for (const f of Object.values(zip.files)) {
    if (!f.dir && !onRecord.has(normalizeMemberPath(f.name))) return wholeRefusal(KAPOT);
  }

  const groups = new Map<string, RawEntry[]>();
  for (const e of rawFiles) {
    const verdict = judgeEntry({ filename: e.name, bytes: 1 });
    if (!verdict.take && verdict.silent) continue; // archive chrome is never a document
    const key = normalizeMemberPath(e.name);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  // Every copy that is inflated to be compared is inflated FOR REAL, so every copy counts against
  // the archive's budget — comparing may not become a way around the ceiling. One copy is held at a
  // time (fingerprintRawEntry keeps a hash, not the bytes), so memory does not grow with the count.
  let compared = 0;
  let extraCopies = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let firstHash: string | null = null;
    for (const e of group) {
      const remaining = limits.totalBytes - compared;
      const copy = fingerprintRawEntry(raw, e, directory.shift, Math.min(limits.entryBytes, remaining));
      if (!copy.ok) {
        if (copy.reason === "too_big" && remaining < limits.entryBytes) return wholeRefusal(TE_GROOT_GEHEEL);
        return wholeRefusal(ZELFDE_NAAM); // a copy that cannot be compared cannot be told apart
      }
      compared += copy.bytes;
      if (firstHash === null) firstHash = copy.hash;
      else if (copy.hash !== firstHash) return wholeRefusal(ZELFDE_NAAM);
      else extraCopies += copy.bytes;
    }
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
  // The extra identical copies were inflated above and stay on the archive's account; the copy that
  // speaks for its group is read again below and counted there.
  let totalRead = extraCopies;
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
