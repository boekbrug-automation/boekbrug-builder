// npx tsx --test src/lib/dba-lines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dossierRowPhrases, dossierSummaryPhrases } from "./dba-lines";
import { MESSAGES } from "./i18n/messages";
import type { OpdrachtgeverDossier, OpdrachtgeverDossierRow } from "./opdrachtgevers";

const money = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;

const row = (over: Partial<OpdrachtgeverDossierRow> = {}): OpdrachtgeverDossierRow => ({
  key: "k1", name: "Bakker BV", revenue: 1000, share: 100, hours: 0, invoices: 1,
  firstInvoice: "2026-03-01", lastInvoice: "2026-03-01",
  since: "2023-04-11", monthsActive: 12, wonThisYear: false, agreedRate: 65, ...over,
});

const dossier = (over: Partial<OpdrachtgeverDossier> = {}): OpdrachtgeverDossier => ({
  year: 2026, revenue: 1000, clients: 1, rows: [row()], largestShare: 100,
  wonThisYear: 0, rateSpread: null, ...over,
});

test("[DBA-DOSSIER] the row says how long, how often and at what price", () => {
  assert.deepEqual(dossierRowPhrases(row(), money), [
    { key: "dba.sinds", params: { jaar: "2023" } },
    { key: "dba.maanden", params: { n: 12 } },
    { key: "dba.tarief", params: { bedrag: "€ 65,00" } },
  ]);
});

test("[DBA-DOSSIER] won this year replaces 'since', never stands beside it", () => {
  const parts = dossierRowPhrases(row({ wonThisYear: true, since: "2026-02-01" }), money);
  assert.equal(parts[0].key, "dba.nieuw");
  assert.ok(!parts.some((p) => p.key === "dba.sinds"), "one answer to one question");
});

test("[DBA-DOSSIER] an unknown part is left out, never filled with a stand-in", () => {
  const bare = dossierRowPhrases(row({ since: null, monthsActive: 0, agreedRate: null }), money);
  assert.deepEqual(bare, [], "no 'sinds —', and above all no € 0 per uur");
});

test("[DBA-DOSSIER] one month is one month, and zero months says nothing", () => {
  assert.deepEqual(
    dossierRowPhrases(row({ since: null, monthsActive: 1, agreedRate: null }), money),
    [{ key: "dba.maandEen" }],
  );
  assert.deepEqual(dossierRowPhrases(row({ since: null, monthsActive: 0, agreedRate: null }), money), []);
});

test("[DBA-DOSSIER] a rate of zero is a recorded rate and would be a claim — the module never sees one", () => {
  // opdrachtgevers.ts refuses to record 0 as an agreed rate; if that ever changed, this is the
  // line that would print "€ 0,00 per uur" beside a real opdrachtgever's name.
  const parts = dossierRowPhrases(row({ agreedRate: 0 }), money);
  assert.ok(parts.some((p) => p.key === "dba.tarief"), "0 is not null, so it WOULD be printed");
});

test("[DBA-DOSSIER] the summary is silent when there is nothing to state", () => {
  assert.deepEqual(dossierSummaryPhrases(dossier(), money), []);
});

test("[DBA-DOSSIER] acquisition, singular and plural", () => {
  assert.deepEqual(dossierSummaryPhrases(dossier({ wonThisYear: 1 }), money), [{ key: "dba.gewonnenEen" }]);
  assert.deepEqual(dossierSummaryPhrases(dossier({ wonThisYear: 3 }), money), [
    { key: "dba.gewonnen", params: { n: 3 } },
  ]);
});

test("[DBA-DOSSIER] a range is a range, one figure everywhere is stated as one figure", () => {
  assert.deepEqual(dossierSummaryPhrases(dossier({ rateSpread: { low: 65, high: 82.5 } }), money), [
    { key: "dba.tariefBereik", params: { laag: "€ 65,00", hoog: "€ 82,50" } },
  ]);
  assert.deepEqual(dossierSummaryPhrases(dossier({ rateSpread: { low: 65, high: 65 } }), money), [
    { key: "dba.tariefGelijk", params: { bedrag: "€ 65,00" } },
  ]);
});

test("[DBA-DOSSIER] both facts stand together when both are there", () => {
  const parts = dossierSummaryPhrases(dossier({ wonThisYear: 2, rateSpread: { low: 50, high: 90 } }), money);
  assert.deepEqual(parts.map((p) => p.key), ["dba.gewonnen", "dba.tariefBereik"]);
});

test("[TAAL] every key this module can emit exists, in Dutch", () => {
  const emitted = new Set<string>();
  for (const r of [
    row(), row({ wonThisYear: true }), row({ monthsActive: 1 }),
    row({ since: null, monthsActive: 0, agreedRate: null }),
  ]) for (const p of dossierRowPhrases(r, money)) emitted.add(p.key);
  for (const d of [
    dossier({ wonThisYear: 1 }), dossier({ wonThisYear: 2 }),
    dossier({ rateSpread: { low: 1, high: 2 } }), dossier({ rateSpread: { low: 1, high: 1 } }),
  ]) for (const p of dossierSummaryPhrases(d, money)) emitted.add(p.key);

  assert.equal(emitted.size, 9, "every branch above must have produced its key");
  for (const key of emitted) {
    const entry = (MESSAGES as Record<string, { nl?: string }>)[key];
    assert.ok(entry, `${key} is missing from the catalogue`);
    assert.ok((entry.nl ?? "").trim().length > 0, `${key} has no Dutch — the source language is required`);
  }
});
