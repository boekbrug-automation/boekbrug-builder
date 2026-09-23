// src/lib/archive-expand.test.ts
// [ARCHIEF-OPEN] Uitpakken met echte zips, niet met een nagebootste bibliotheek.
// [ARCHIEF-WAAR] openArchive reports members and refusals under their own keys and never decides
// completion — that is the sync's job, from what became of each member.
// Run: npx tsx --test src/lib/archive-expand.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { openArchive, archiveMemberName, readMemberBounded, type ExpandableAttachment } from "./archive-expand";
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
  const keys = new Set(r.members.map((m) => `${m.messageId}:${m.filename}`));
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
  assert.equal(refusal.key, "m1:dag — readme.exe", "a member refusal is keyed like a member");
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
  assert.match(r.refusals[0].reason, /beschadigd|wachtwoord/);
  assert.ok(r.refusals[0].reason.includes(ARCHIVE_OWNER_ACTION));
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
