// src/lib/archive-expand.test.ts
// [ARCHIEF-OPEN] Uitpakken met echte zips, niet met een nagebootste bibliotheek.
// [ARCHIEF-WAAR] openArchive reports members and refusals under their own keys and never decides
// completion — that is the sync's job, from what became of each member.
// Run: npx tsx --test src/lib/archive-expand.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { openArchive, archiveMemberName, archiveMemberKey, readMemberBounded, type ExpandableAttachment } from "./archive-expand";
import { ARCHIVE_OWNER_ACTION, MAX_ENTRY_BYTES } from "./archive-attachment";

async function zipBytes(files: Record<string, string | Uint8Array>, compress = true): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: "nodebuffer", compression: compress ? "DEFLATE" : "STORE" });
}
async function zipB64(files: Record<string, string | Uint8Array>): Promise<string> {
  return (await zipBytes(files)).toString("base64");
}

const attachment = (filename: string, data: string, messageId = "m1"): ExpandableAttachment => ({
  filename, mimeType: "application/zip", data, messageId, size: 0,
});

test("[ARCHIEF-OPEN] de dagafsluiting komt eruit als een leesbaar document", async () => {
  // De echte naam van productie, 29 keer, 28 dagen achter elkaar.
  const data = await zipB64({ "dagafsluiting.pdf": "%PDF-1.4 nep" });
  const r = await openArchive(attachment("Jouw dagafsluiting - 220826 1912.zip", data));

  assert.equal(r.refusedWhole, false);
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0].filename, "Jouw dagafsluiting - 220826 1912 — dagafsluiting.pdf");
  assert.equal(r.members[0].mimeType, "application/pdf", "a PDF goes on as a PDF, not as a zip");
  assert.equal(Buffer.from(r.members[0].data, "base64").toString(), "%PDF-1.4 nep");
  assert.equal(r.members[0].fromArchive, true);
  assert.equal(r.members[0].archiveKey, "m1:Jouw dagafsluiting - 220826 1912.zip");
  assert.equal(r.members[0].messageId, "m1", "a member stays in the message it arrived in");
  assert.equal(r.members[0].size, 12, "size is the counted bytes, not the declared ones");
});

test("[ARCHIEF-WAAR] two members with the same basename stay two keys", async () => {
  // Keyed on the basename, the second till report counted as handled the moment the first was.
  const data = await zipB64({
    "winkel-a/dagafsluiting.pdf": "%PDF A",
    "winkel-b/dagafsluiting.pdf": "%PDF B",
  });
  const r = await openArchive(attachment("dag.zip", data));
  assert.equal(r.members.length, 2);
  const names = r.members.map((m) => m.filename).sort();
  assert.deepEqual(names, ["dag — winkel-a/dagafsluiting.pdf", "dag — winkel-b/dagafsluiting.pdf"]);
  const keys = new Set(r.members.map((m) => m.memberKey));
  assert.equal(keys.size, 2, "one key per member, never shared");
  const bodies = r.members.map((m) => Buffer.from(m.data, "base64").toString()).sort();
  assert.deepEqual(bodies, ["%PDF A", "%PDF B"]);
});

test("[ARCHIEF-WAAR] the member name is readable and stable", () => {
  assert.equal(archiveMemberName("Jouw dag.zip", "map/bon.jpg"), "Jouw dag — map/bon.jpg");
  assert.equal(archiveMemberName("x.ZIP", "./a\\b.pdf"), "x — a/b.pdf");
  assert.equal(archiveMemberName("x.zip", "/abs.pdf"), "x — abs.pdf");
  // The same input gives the same key on every sync — that is what makes a keep known next time.
  assert.equal(archiveMemberName("x.zip", "a/b.pdf"), archiveMemberName("x.zip", "a/b.pdf"));
});

test("[ARCHIEF-WAAR] archive chrome is dropped silently, an unsupported file is refused with a way out", async () => {
  const data = await zipB64({
    "dagafsluiting.pdf": "%PDF nep",
    "__MACOSX/._dagafsluiting.pdf": "x",
    ".DS_Store": "x",
    "readme.exe": "x",
  });
  const r = await openArchive(attachment("dag.zip", data));
  assert.equal(r.members.length, 1, "only the PDF goes on");
  assert.equal(r.refusals.length, 1, "chrome is not a document; the exe is");
  const [refusal] = r.refusals;
  assert.equal(refusal.whole, false);
  assert.equal(refusal.key, archiveMemberKey("m1", "dag.zip", "readme.exe"), "a member refusal is keyed like a member");
  assert.equal(refusal.filename, "dag — readme.exe");
  assert.match(refusal.reason, /Uploaden/, "the reason tells the owner what to do");
});

test("[ARCHIEF-WAAR] a corrupt archive is refused WHOLE, under the archive's own key, with a way out", async () => {
  // DE regel. Deze 410 overgeslagen bijlagen bestonden doordat "overslaan" geen zin opleverde.
  const r = await openArchive(attachment("stuk.zip", Buffer.from("dit is geen zip").toString("base64"), "msg-2"));
  assert.equal(r.members.length, 0);
  assert.equal(r.refusedWhole, true);
  assert.equal(r.refusals.length, 1);
  assert.equal(r.refusals[0].key, "msg-2:stuk.zip");
  assert.equal(r.refusals[0].whole, true);
  assert.match(r.refusals[0].reason, /beschadigd/);
  // [ARCHIEF-WAAR] review: a broken zip cannot be unpacked by the owner either — the action is a
  // sound copy from the sender (see the review-round tests below).
  assert.match(r.refusals[0].reason, /afzender/);
});

test("[ARCHIEF-OPEN] een archief in een archief blijft dicht, en zegt dat", async () => {
  const inner = await zipBytes({ "factuur.pdf": "%PDF" });
  const outer = await zipB64({ "binnenin.zip": inner, "echt.pdf": "%PDF" });
  const r = await openArchive(attachment("buiten.zip", outer));
  assert.equal(r.members.length, 1, "only the loose document");
  assert.match(r.members[0].filename, /echt\.pdf$/);
  assert.equal(r.refusals.length, 1);
  assert.match(r.refusals[0].reason, /archief in een archief/);
  assert.ok(r.refusals[0].reason.includes(ARCHIVE_OWNER_ACTION));
});

test("[ARCHIEF-OPEN] te veel bestanden → niets erdoor, en dat is expres", async () => {
  // Half uitpakken levert een administratie op waarvan niemand weet welk deel erin zit.
  const many: Record<string, string> = {};
  for (let i = 0; i < 30; i++) many[`f${i}.pdf`] = "%PDF";
  const r = await openArchive(attachment("veel.zip", await zipB64(many)));
  assert.equal(r.members.length, 0);
  assert.equal(r.refusedWhole, true);
  assert.match(r.refusals[0].reason, /meer dan 25/);
  assert.ok(r.refusals[0].reason.includes(ARCHIVE_OWNER_ACTION));
});

test("[ARCHIEF-OPEN] an empty archive is refused whole and says so", async () => {
  const r = await openArchive(attachment("leeg.zip", await zipB64({})));
  assert.equal(r.refusedWhole, true);
  assert.match(r.refusals[0].reason, /leeg/);
});

/**
 * A zip whose index LIES: the entry inflates to `realBytes`, the index says it is 100 bytes.
 * Built from a real DEFLATE zip by patching the uncompressed-size field in the local header
 * (offset 22) and in the central directory record (offset 24) — the two places a reader looks.
 */
async function lyingZip(realBytes: number): Promise<string> {
  const buf = await zipBytes({ "bom.pdf": new Uint8Array(realBytes) });
  const LOCAL = 0x04034b50, CENTRAL = 0x02014b50;
  assert.equal(buf.readUInt32LE(0), LOCAL, "fixture: local header at 0");
  buf.writeUInt32LE(100, 22);
  let patched = 0;
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === CENTRAL) {
      buf.writeUInt32LE(100, i + 24);
      patched++;
    }
  }
  assert.equal(patched, 1, "fixture: exactly one central directory record patched");
  return buf.toString("base64");
}

test("[ARCHIEF-WAAR] a zip that lies about its size is stopped by the COUNTED bytes", async () => {
  // Declared 100 bytes, inflates past the 10 MB member ceiling. The plan trusts the index, so the
  // only thing between this entry and the process's memory is the counter in readMemberBounded.
  const data = await lyingZip(MAX_ENTRY_BYTES + 1024 * 1024);
  assert.ok(Buffer.from(data, "base64").length < 100_000, "fixture: small on the wire");
  const r = await openArchive(attachment("bom.zip", data));
  assert.equal(r.members.length, 0, "nothing past the ceiling reaches the reader");
  assert.equal(r.refusals.length, 1);
  assert.equal(r.refusals[0].whole, false);
  assert.match(r.refusals[0].reason, /te groot/);
});

test("[ARCHIEF-WAAR] the whole-archive ceiling is on counted bytes too, and refuses all of it", async () => {
  // Injected limits so the proof does not need a 25 MB fixture: 3 honest members of 4 KB against
  // a total of 10 KB. The third passes the total → the archive is refused whole, including the two
  // already read. Half an archive is an administration nobody can reason about.
  const four = "x".repeat(4096);
  const data = await zipB64({ "a.pdf": four, "b.pdf": four, "c.pdf": four });
  const r = await openArchive(attachment("groot.zip", data), { entryBytes: 8192, totalBytes: 10_240 });
  assert.equal(r.refusedWhole, true);
  assert.equal(r.members.length, 0);
  assert.equal(r.refusals.length, 1);
  assert.equal(r.refusals[0].key, "m1:groot.zip");
  assert.match(r.refusals[0].reason, /groter dan 25 MB/);
});

test("[ARCHIEF-WAAR] readMemberBounded stops at the limit and returns bytes under it", async () => {
  const z = await JSZip.loadAsync(await zipBytes({ "a.pdf": "y".repeat(5000) }));
  const entry = z.file("a.pdf")!;
  assert.deepEqual(await readMemberBounded(entry, 4999), { ok: false, reason: "too_big" });
  const ok = await readMemberBounded(entry, 5000);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.bytes.length, 5000, "exactly at the limit is still allowed");
});

test("[ARCHIEF-OPEN] een gewone PDF-, afbeelding- en xml-member houdt zijn type", async () => {
  const data = await zipB64({ "bon.jpg": "JPEGnep", "ubl.xml": "<Invoice/>", "sheet.xlsx": "PK" });
  const r = await openArchive(attachment("dag.zip", data));
  const byName = Object.fromEntries(r.members.map((m) => [m.filename, m.mimeType]));
  assert.equal(byName["dag — bon.jpg"], "image/jpeg");
  assert.equal(byName["dag — ubl.xml"], "application/xml");
  assert.equal(byName["dag — sheet.xlsx"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

// ── [ARCHIEF-WAAR] review round 1 ─────────────────────────────────────────────────────────────

/** Rewrite every occurrence of one entry name inside a real zip (same length), in both headers. */
function renameEntry(buf: Buffer, from: string, to: string): Buffer {
  assert.equal(from.length, to.length, "fixture: same-length rename keeps every offset valid");
  const out = Buffer.from(buf);
  const a = Buffer.from(from), b = Buffer.from(to);
  let i = 0, n = 0;
  while ((i = out.indexOf(a, i)) !== -1) { b.copy(out, i); i += a.length; n++; }
  assert.equal(n, 2, "fixture: renamed in the local header and in the central directory");
  return out;
}

test("[ARCHIEF-WAAR] two entries with the SAME path are refused whole — one of them would be invisible", async () => {
  // JSZip keeps one entry per name, so the other copy would be silently dropped.
  const buf = renameEntry(await zipBytes({ "invoice.pdf": "%PDF one", "invoicf.pdf": "%PDF two" }), "invoicf.pdf", "invoice.pdf");
  const r = await openArchive(attachment("twee.zip", buf.toString("base64")));
  assert.equal(r.refusedWhole, true);
  assert.equal(r.members.length, 0);
  assert.equal(r.refusals[0].key, "m1:twee.zip");
  assert.match(r.refusals[0].reason, /dezelfde naam/);
  assert.match(r.refusals[0].reason, /afzender/);
});

test("[ARCHIEF-WAAR] two paths that normalise to one name, with DIFFERENT bytes, are refused whole", async () => {
  // `map\b.pdf` and `map/b.pdf` are two entries to JSZip and one key to us.
  const buf = renameEntry(await zipBytes({ "map/b.pdf": "%PDF one", "mapXb.pdf": "%PDF two" }), "mapXb.pdf", "map\\b.pdf");
  const r = await openArchive(attachment("pad.zip", buf.toString("base64")));
  assert.equal(r.refusedWhole, true, "two different documents may not share one key");
  assert.equal(r.members.length, 0);
  assert.match(r.refusals[0].reason, /dezelfde naam/);
});

test("[ARCHIEF-WAAR] two paths that normalise to one name, with IDENTICAL bytes, are one document", async () => {
  // A backslash spelling: JSZip keeps `a\b.pdf` and `a/b.pdf` apart, so only OUR normalisation
  // can see they are one path.
  const buf = renameEntry(await zipBytes({ "a/b.pdf": "%PDF same", "aXb.pdf": "%PDF same" }), "aXb.pdf", "a\\b.pdf");
  const r = await openArchive(attachment("pad.zip", buf.toString("base64")));
  assert.equal(r.refusedWhole, false);
  assert.equal(r.members.length, 1, "the same bytes under two spellings of one path are one document");
  assert.equal(r.members[0].filename, "pad — a/b.pdf");
});

test("[ARCHIEF-WAAR] a member key cannot be produced by a loose attachment or by another archive", async () => {
  const one = await openArchive(attachment("bundle.zip", await zipB64({ "invoice.pdf": "%PDF 1" })));
  const two = await openArchive(attachment("a.zip", await zipB64({ "b — c.pdf": "%PDF 2" })));
  const three = await openArchive(attachment("a — b.zip", await zipB64({ "c.pdf": "%PDF 3" })));
  const key = (m: { memberKey?: string }) => m.memberKey;
  assert.ok(key(one.members[0]), "a member carries its own key");
  assert.notEqual(key(one.members[0]), "m1:bundle — invoice.pdf", "not the key a loose 'bundle — invoice.pdf' has");
  assert.notEqual(key(two.members[0]), key(three.members[0]), "not the key of another archive's member");
  assert.equal(two.members[0].filename, three.members[0].filename, "fixture: the display names DO collide");
});

test("[ARCHIEF-WAAR] a corrupt archive asks the sender for a sound copy; a locked one keeps the manual path", async () => {
  const corrupt = await openArchive(attachment("stuk.zip", Buffer.from("dit is geen zip").toString("base64")));
  assert.match(corrupt.refusals[0].reason, /beschadigd/);
  assert.match(corrupt.refusals[0].reason, /afzender/, "the one action that can work on a broken file");
  assert.doesNotMatch(corrupt.refusals[0].reason, /pak het zelf uit/, "unpacking a broken zip fails for the owner too");

  const locked = await zipBytes({ "a.pdf": "%PDF" });
  locked.writeUInt16LE(locked.readUInt16LE(6) | 1, 6); // general-purpose flag bit 0: encrypted
  const cd = locked.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  locked.writeUInt16LE(locked.readUInt16LE(cd + 8) | 1, cd + 8);
  const r = await openArchive(attachment("slot.zip", locked.toString("base64")));
  assert.equal(r.refusedWhole, true);
  assert.match(r.refusals[0].reason, /wachtwoord/);
  assert.ok(r.refusals[0].reason.includes(ARCHIVE_OWNER_ACTION), "a locked zip CAN be unpacked by whoever has the password");
});

test("[ARCHIEF-WAAR] a member whose compressed bytes are broken asks the sender for a sound copy", async () => {
  const buf = await zipBytes({ "a.pdf": "x".repeat(4000), "b.pdf": "%PDF fine" });
  // Overwrite a.pdf's compressed data (right after its local header) with an invalid deflate block.
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  buf.fill(0xff, 30 + nameLen + extraLen, 30 + nameLen + extraLen + 8);
  const r = await openArchive(attachment("half.zip", buf.toString("base64")));
  const bad = r.refusals.find((x) => x.filename.endsWith("a.pdf"));
  assert.ok(bad, "fixture: the broken member is refused");
  assert.match(bad.reason, /afzender/);
});

// ── [ARCHIEF-WAAR] review round 2 — duplicate copies and the archive's ceilings ───────────────

/** A real zip whose central directory lists `copies` entries under ONE name, all with `body`. */
async function sameNameZip(copies: number, body: string | ((i: number) => string)): Promise<Buffer> {
  const files: Record<string, string> = {};
  for (let i = 1; i <= copies; i++) files[`c${i}.pdf`] = typeof body === "function" ? body(i) : body;
  let buf = await zipBytes(files);
  for (let i = 2; i <= copies; i++) buf = renameEntry(buf, `c${i}.pdf`, "c1.pdf");
  return buf;
}

test("[ARCHIEF-WAAR] more raw entries than the ceiling is refused, even when JSZip merges them into one", async () => {
  // Four directory records, one name: JSZip shows ONE file, so a count taken after the merge passes.
  const buf = await sameNameZip(4, "%PDF same");
  const r = await openArchive(attachment("veel.zip", buf.toString("base64")),
    { entryBytes: 8192, totalBytes: 1 << 20, maxEntries: 3 });
  assert.equal(r.refusedWhole, true, "the ceiling is on what the archive holds, not on what JSZip shows");
  assert.equal(r.members.length, 0);
  assert.match(r.refusals[0].reason, /meer dan 3/);
});

test("[ARCHIEF-WAAR] identical copies whose COMBINED inflated size passes the budget are refused", async () => {
  // Three identical 4 KB copies against a 10 KB archive budget: each copy fits the per-entry ceiling,
  // together they do not. Comparing them may not be a way around the archive-wide ceiling.
  const buf = await sameNameZip(3, "x".repeat(4096));
  const r = await openArchive(attachment("groot.zip", buf.toString("base64")),
    { entryBytes: 8192, totalBytes: 10_240, maxEntries: 25 });
  assert.equal(r.refusedWhole, true);
  assert.equal(r.members.length, 0);
  assert.match(r.refusals[0].reason, /groter dan/);
});

test("[ARCHIEF-WAAR] identical copies that UNDER-DECLARE their size are stopped by the counted budget", async () => {
  // The same three 4 KB copies, but every header claims 100 bytes. The declared-size pre-filter
  // passes them; only the bytes actually inflated during the comparison can stop this.
  const buf = await sameNameZip(3, "x".repeat(4096));
  const LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04]), CENTRAL = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let patched = 0;
  for (let i = buf.indexOf(LOCAL); i !== -1; i = buf.indexOf(LOCAL, i + 4)) { buf.writeUInt32LE(100, i + 22); patched++; }
  for (let i = buf.indexOf(CENTRAL); i !== -1; i = buf.indexOf(CENTRAL, i + 4)) { buf.writeUInt32LE(100, i + 24); patched++; }
  assert.equal(patched, 6, "fixture: three local headers and three directory records under-declare");
  const r = await openArchive(attachment("liegt.zip", buf.toString("base64")),
    { entryBytes: 8192, totalBytes: 10_240, maxEntries: 25 });
  assert.equal(r.refusedWhole, true, "comparing copies may not be a way around the archive-wide ceiling");
  assert.equal(r.members.length, 0);
  assert.match(r.refusals[0].reason, /groter dan/);
});

test("[ARCHIEF-WAAR] permitted identical copies within both ceilings still resolve to ONE document", async () => {
  const buf = await sameNameZip(2, "x".repeat(4096));
  const r = await openArchive(attachment("twee.zip", buf.toString("base64")),
    { entryBytes: 8192, totalBytes: 10_240, maxEntries: 25 });
  assert.equal(r.refusedWhole, false);
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0].size, 4096);
});

test("[ARCHIEF-WAAR] differing copies are still refused under the budget", async () => {
  const buf = await sameNameZip(3, (i) => `%PDF copy ${i}`);
  const r = await openArchive(attachment("drie.zip", buf.toString("base64")),
    { entryBytes: 8192, totalBytes: 10_240, maxEntries: 25 });
  assert.equal(r.refusedWhole, true);
  assert.match(r.refusals[0].reason, /dezelfde naam/);
});

test("[ARCHIEF-WAAR] a directory that under-counts its own entries is refused whole", async () => {
  // Two records, an end record claiming one. JSZip reads one and never sees the second — a file
  // smuggled past every check. The walk must end exactly where the directory says it ends.
  const buf = await zipBytes({ "a.pdf": "%PDF a", "b.pdf": "%PDF b" });
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  buf.writeUInt16LE(1, eocd + 8);
  buf.writeUInt16LE(1, eocd + 10);
  const r = await openArchive(attachment("stil.zip", buf.toString("base64")));
  assert.equal(r.refusedWhole, true, "an inconsistent directory proves nothing and is refused");
  assert.equal(r.members.length, 0);
  assert.match(r.refusals[0].reason, /afzender/, "with an action the owner can take");
});
