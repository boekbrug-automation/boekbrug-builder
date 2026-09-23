// src/lib/archive-attachment.test.ts
// [ARCHIEF-OPEN] De envelop opent, en blijft wantrouwig.
// Run: npx tsx --test src/lib/archive-attachment.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  isOpenableArchive, judgeEntry, planArchive, MAX_ENTRIES, MAX_TOTAL_BYTES,
} from "./archive-attachment";

test("[ARCHIEF-OPEN] de dagafsluiting wordt herkend als te openen", () => {
  // De echte bestandsnaam, 29 keer op productie, 28 losse dagen achter elkaar.
  assert.equal(isOpenableArchive("Jouw dagafsluiting - 220826 1912.zip"), true);
  assert.equal(isOpenableArchive("Jouw dagafsluiting - 020926 1915.ZIP"), true);
});

test("[ARCHIEF-OPEN] een DMARC-rapport blijft met rust", () => {
  // De andere 11 van de 40. Die horen NIET open: het zijn geen boekhouddocumenten, en ze elke dag
  // uitpakken zou het overgeslagen-paneel vullen met ruis waar de ondernemer niets mee kan.
  assert.equal(isOpenableArchive("protection.outlook.com!boekbrug.nl!1788048000!1788134400.xml.gz"), false);
  assert.equal(isOpenableArchive("factuur.pdf"), false);
  assert.equal(isOpenableArchive(null), false);
  assert.equal(isOpenableArchive(undefined), false);
});

test("[ARCHIEF-OPEN] wat de intake kan lezen mag eruit", () => {
  for (const naam of ["dagafsluiting.pdf", "factuur.PDF", "bon.jpg", "ubl.xml", "omzet.csv"]) {
    assert.deepEqual(judgeEntry({ filename: naam, bytes: 1000 }), { take: true }, naam);
  }
});

test("[ARCHIEF-OPEN] alles wat geweigerd wordt, draagt een reden", () => {
  // DE regel van dit bestand. Deze 410 bijlagen bestonden omdat "overslaan" geen zin opleverde.
  // Een weigering zonder reden is precies dezelfde fout, één laag dieper.
  const gevallen = [
    { filename: "virus.exe", bytes: 100 },
    { filename: "binnenin.zip", bytes: 100 },
    { filename: "map/", bytes: 0 },
    { filename: "__MACOSX/._factuur.pdf", bytes: 100 },
    { filename: ".DS_Store", bytes: 100 },
    { filename: "leeg.pdf", bytes: 0 },
    { filename: "enorm.pdf", bytes: 20 * 1024 * 1024 },
    { filename: "   ", bytes: 10 },
  ];
  for (const g of gevallen) {
    const v = judgeEntry(g);
    assert.equal(v.take, false, `${g.filename} had geweigerd moeten worden`);
    assert.ok("reason" in v && v.reason.trim().length > 5,
      `${g.filename}: geweigerd zonder bruikbare reden`);
  }
});

test("[ARCHIEF-OPEN] een archief in een archief gaat niet open", () => {
  const v = judgeEntry({ filename: "nog-een.zip", bytes: 100 });
  assert.equal(v.take, false);
  assert.match((v as { reason: string }).reason, /archief in een archief/);
});

test("[ARCHIEF-OPEN] een normaal archief levert zijn documenten", () => {
  const plan = planArchive([
    { filename: "dagafsluiting.pdf", bytes: 240_000 },
    { filename: "__MACOSX/._dagafsluiting.pdf", bytes: 200 },
    { filename: "logo.exe", bytes: 900 },
  ]);
  assert.equal(plan.take.length, 1);
  assert.equal(plan.take[0].filename, "dagafsluiting.pdf");
  assert.equal(plan.skipped.length, 2, "en de andere twee zijn geteld, niet verdwenen");
  assert.equal(plan.refusedWhole, undefined);
});

test("[ARCHIEF-OPEN] een zip-bom komt er niet doorheen, en half ook niet", () => {
  // Een zip-bom is klein op schijf en enorm daarna, dus het plafond staat op het GEHEEL. En bij
  // overschrijding gaat er NIETS door: half uitpakken levert een administratie op waarvan niemand
  // weet welk deel erin zit.
  const bom = planArchive([
    { filename: "a.pdf", bytes: MAX_TOTAL_BYTES },
    { filename: "b.pdf", bytes: MAX_TOTAL_BYTES },
  ]);
  assert.equal(bom.take.length, 0);
  assert.match(bom.refusedWhole ?? "", /groter dan 25 MB/);

  const teVeel = planArchive(
    Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ filename: `f${i}.pdf`, bytes: 100 })),
  );
  assert.equal(teVeel.take.length, 0);
  assert.match(teVeel.refusedWhole ?? "", /te veel/);
});

test("[ARCHIEF-OPEN] een leeg archief zegt dat het leeg is", () => {
  const plan = planArchive([]);
  assert.equal(plan.take.length, 0);
  assert.match(plan.refusedWhole ?? "", /leeg/);
});

test("[ARCHIEF-OPEN] precies op de grens mag nog", () => {
  // Een plafond dat één bestand te vroeg dichtslaat kost een echte dagafsluiting.
  const opDeGrens = planArchive(
    Array.from({ length: MAX_ENTRIES }, (_, i) => ({ filename: `f${i}.pdf`, bytes: 100 })),
  );
  assert.equal(opDeGrens.take.length, MAX_ENTRIES);
  assert.equal(opDeGrens.refusedWhole, undefined);
});

test("[ARCHIEF-WAAR] chrome is refused silently; a real file is refused with a way out", () => {
  // A panel line per `__MACOSX` shadow file is the noise that makes an owner stop reading the
  // panel; a real file refused without an action leaves them with a document and nowhere to put it.
  for (const naam of ["__MACOSX/._factuur.pdf", ".DS_Store", "map/"]) {
    const v = judgeEntry({ filename: naam, bytes: 100 });
    assert.equal(v.take, false);
    assert.equal((v as { silent?: boolean }).silent, true, `${naam} should be silent`);
  }
  for (const naam of ["virus.exe", "binnenin.zip", "enorm.pdf"]) {
    const v = judgeEntry({ filename: naam, bytes: naam === "enorm.pdf" ? 11 * 1024 * 1024 : 100 });
    assert.equal(v.take, false);
    assert.notEqual((v as { silent?: boolean }).silent, true, `${naam} must be shown`);
    assert.match((v as { reason: string }).reason, /Uploaden/, `${naam}: no owner action`);
  }
});
