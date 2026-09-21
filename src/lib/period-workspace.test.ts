// src/lib/period-workspace.test.ts
// Run: npx tsx --test src/lib/period-workspace.test.ts
//
// [KANTOOR-PERIODE] What the period workspace is allowed to say, and — mostly — what it is not.
// Every failure this pins is silent: a finding that quietly moved into the wrong quarter, a source
// that failed and left a confident empty list behind it, a `.slice()` that deleted work.

import test from "node:test";
import assert from "node:assert/strict";

import {
  allItemsOf,
  buildScopeView,
  buildWorkspace,
  hiddenGroupItemCount,
  MAX_GROUPS_PER_SCOPE,
  MAX_ITEMS_PER_GROUP,
  scopeHasContent,
  workspaceHasContent,
  type MoneyFinding,
  type ScopeView,
  type WorkItem,
  type WorkspaceSources,
} from "./period-workspace";
import { translator } from "./i18n/t";
import { MESSAGES } from "./i18n/messages";

const t = translator("nl");
const CLIENT = "ac22189e-7052-4c48-b4ec-90947cf92ecc";
const INVOICE = "73b7bba0-a1c9-4d3f-a838-ee5527687473";
const D = MESSAGES as Record<string, { nl: string }>;

/** The two findings this client really has in production, with their real sentences. */
const OVERALLOCATED: MoneyFinding = {
  kind: "transaction_overallocated",
  entityId: "36318b64",
  message: "Een bankregel van € 2.485,13 is over facturen verdeeld voor € 2.524,99 — € 39,86 meer dan er is overgemaakt.",
  accountantMessage: "Bankregel van € 2.485,13 is over facturen verdeeld voor € 2.524,99 — € 39,86 meer dan er is overgemaakt.",
};
const DUPLICATE: MoneyFinding = {
  kind: "duplicate_live_pair",
  entityId: "dup-a",
  message: "2034753 van CAN Vleesgroothandel B.V. staat 2 keer in de administratie … Bewaar het origineel …",
  accountantMessage: "2034753 van CAN Vleesgroothandel B.V. staat 2 keer in de administratie (openstaand en in de wachtrij); dezelfde kost telt dubbel in kosten en voorbelasting.",
};
const DRAWER: MoneyFinding = {
  kind: "drawer_negative",
  entityId: "2026-02-11",
  message: "Je kasboek staat op 11 februari 2026 € 40,00 onder nul.",
  accountantMessage: "Het kasboek staat op 11 februari 2026 € 40,00 onder nul.",
};

function sources(over: Partial<WorkspaceSources> = {}): WorkspaceSources {
  return {
    clientId: CLIENT,
    year: 2026,
    quarter: 3,
    readiness: { ok: true, value: { missing: [], risks: [] } },
    geld: { ok: true, value: { violations: [], drawer: [], drawerChecked: true } },
    nummering: { ok: true, value: { series: [], unreadable: [], countersRead: true } },
    vragen: { ok: true, value: [] },
    ...over,
  };
}

const scope = (views: ScopeView[], name: ScopeView["scope"]) => views.find((v) => v.scope === name)!;
const texts = (view: ScopeView) => allItemsOf(view).map((i) => i.text);

// ── 1 · 2 · 3 — readiness, verbatim and nothing else ─────────────────────────

test("[KANTOOR-PERIODE] 1 · a readiness gap appears under the selected quarter, word for word", () => {
  const views = buildWorkspace(
    sources({ readiness: { ok: true, value: { missing: [{ title: "Bankafschrift ontbreekt" }], risks: [] } } }),
    t,
  );
  assert.deepEqual(texts(scope(views, "kwartaal")), ["Bankafschrift ontbreekt"]);
  // …and nowhere else. A gap is about THIS period and may not leak into an administration-wide
  // block where it would read as a standing problem.
  for (const other of ["administratie", "nummering", "kas"] as const) {
    assert.deepEqual(texts(scope(views, other)), [], other);
  }
});

test("[KANTOOR-PERIODE] 2 · a readiness risk appears word for word too", () => {
  const views = buildWorkspace(
    sources({ readiness: { ok: true, value: { missing: [], risks: [{ title: "12 van 90 kassadagen geïmporteerd" }] } } }),
    t,
  );
  assert.deepEqual(texts(scope(views, "kwartaal")), ["12 van 90 kassadagen geïmporteerd"]);
});

test("[KANTOOR-PERIODE] 3 · the owner's `detail` and `fix` never reach the accountant", () => {
  // readiness' items carry more than a title; the extra is written TO THE OWNER ("voeg het
  // origineel toe") and its `fix` href is an owner route. Handing either to the boekhouder was
  // the defect [KANTOOR-RUST] removed from the Brug, and it may not come back through here.
  const vies = {
    title: "Bon ontbreekt",
    detail: "Voeg het origineel toe bij je inkoopfacturen.",
    fix: { href: "/dashboard/incoming" },
  };
  const views = buildWorkspace(
    sources({ readiness: { ok: true, value: { missing: [vies as { title: string }], risks: [] } } }),
    t,
  );
  const items = allItemsOf(scope(views, "kwartaal"));
  assert.deepEqual(items.map((i) => i.text), ["Bon ontbreekt"]);
  assert.ok(!JSON.stringify(items).includes("origineel"), "the owner's detail travelled along");
  assert.ok(!JSON.stringify(items).includes("/dashboard/incoming"), "the owner route travelled along");
  // What it MAY carry is the accountant's own approved target for a client-fixable gap.
  assert.equal(items[0].href, `/dashboard/accountant/opvragen?clientId=${CLIENT}&q=3&year=2026`);
  // A reconciliation risk is the accountant's own check — Opvragen excludes those, so no target.
  const risky = buildWorkspace(
    sources({ readiness: { ok: true, value: { missing: [], risks: [{ title: "Kasverschil" }] } } }),
    t,
  );
  assert.equal(allItemsOf(scope(risky, "kwartaal"))[0].href, undefined);
});

// ── 4 · 5 — the money findings keep their voice and their span ───────────────

test("[KANTOOR-PERIODE] 4 · Geld speaks with findingText(…, 'accountant'), never the owner's sentence", () => {
  const views = buildWorkspace(sources({ geld: { ok: true, value: { violations: [OVERALLOCATED, DUPLICATE], drawer: [], drawerChecked: true } } }), t);
  const gezien = texts(scope(views, "administratie"));
  assert.deepEqual(gezien, [OVERALLOCATED.accountantMessage, DUPLICATE.accountantMessage]);
  for (const zin of gezien) {
    assert.ok(!/\bje\b|\bjouw\b/i.test(zin), `the owner's voice reached the accountant: ${zin}`);
  }
});

test("[KANTOOR-PERIODE] 5 · an administration-wide finding never becomes a claim about Q3", () => {
  // /api/money-audit compares invoices with their payments across the WHOLE administration and
  // returns no date at all. Placing € 39,86 under "Q3 2026" would assert a period nobody computed
  // — and an accountant would file on it.
  for (const quarter of [1, 2, 3, 4]) {
    const views = buildWorkspace(
      { ...sources({ geld: { ok: true, value: { violations: [OVERALLOCATED], drawer: [], drawerChecked: true } } }), quarter },
      t,
    );
    assert.deepEqual(texts(scope(views, "kwartaal")), [], `Q${quarter}`);
    assert.deepEqual(texts(scope(views, "administratie")), [OVERALLOCATED.accountantMessage], `Q${quarter}`);
    // …and it is given no destination: entityId here is a BANK TRANSACTION, and the accountant
    // has no bank surface. A link would be a promise of a screen that does not exist.
    assert.equal(allItemsOf(scope(views, "administratie"))[0].href, undefined);
  }
});

// ── 7 · 8 — the drawer is its own quarter ────────────────────────────────────

test("[KANTOOR-PERIODE] 7 · a drawer finding is labelled current-quarter, never the selected one", () => {
  // money-audit/route.ts computes the drawer from amsterdamYear()/the current Amsterdam quarter.
  // Reading a Q1 screen must therefore not put a drawer finding under Q1.
  const views = buildWorkspace(
    { ...sources({ geld: { ok: true, value: { violations: [], drawer: [DRAWER], drawerChecked: true } } }), quarter: 1 },
    t,
  );
  assert.deepEqual(texts(scope(views, "kas")), [DRAWER.accountantMessage]);
  assert.deepEqual(texts(scope(views, "kwartaal")), []);
  assert.deepEqual(texts(scope(views, "administratie")), []);
});

test("[KANTOOR-PERIODE] 8 · a drawer that did not run says so, in the sentence it already had", () => {
  const views = buildWorkspace(sources({ geld: { ok: true, value: { violations: [], drawer: [], drawerChecked: false } } }), t);
  assert.deepEqual(scope(views, "kas").notices, [D["geld.ladeNietGecontroleerd"].nl]);
  assert.ok(scopeHasContent(scope(views, "kas")), "the unchecked drawer vanished into silence");
});

// ── 9 · 10 · 12 — one source failing may not erase another ───────────────────

test("[KANTOOR-PERIODE] 9 · a failed Geld read keeps readiness, and says Geld is unknown", () => {
  const views = buildWorkspace(
    sources({
      geld: { ok: false },
      readiness: { ok: true, value: { missing: [{ title: "Bankafschrift ontbreekt" }], risks: [] } },
    }),
    t,
  );
  assert.deepEqual(texts(scope(views, "kwartaal")), ["Bankafschrift ontbreekt"]);
  assert.deepEqual(scope(views, "administratie").notices, [D["geld.nietGelezenAcc"].nl]);
  // The drawer travels in the same answer, so it is unknown too — never silently "fine".
  assert.deepEqual(scope(views, "kas").notices, [D["geld.nietGelezenAcc"].nl]);
});

test("[KANTOOR-PERIODE] 10 · a failed readiness keeps the known money findings", () => {
  const views = buildWorkspace(
    sources({ readiness: { ok: false }, geld: { ok: true, value: { violations: [DUPLICATE], drawer: [], drawerChecked: true } } }),
    t,
  );
  assert.deepEqual(texts(scope(views, "administratie")), [DUPLICATE.accountantMessage]);
  assert.deepEqual(scope(views, "kwartaal").notices, [D["bh.opvr.fout.lezen"].nl]);
});

test("[KANTOOR-PERIODE] 12 · an invoice read that failed is not 'no open questions'", () => {
  const views = buildWorkspace(sources({ vragen: { ok: false } }), t);
  const kw = scope(views, "kwartaal");
  assert.deepEqual(texts(kw), []);
  assert.ok(kw.notices.includes(D["bh.kwt.leesfout"].nl), "the unread invoice list passed as an empty one");
});

test("[KANTOOR-PERIODE] an open question is identity plus its existing status word, and opens the row", () => {
  const views = buildWorkspace(
    sources({ vragen: { ok: true, value: [{ id: INVOICE, invoice_number: "20260010", client_name: "Afamia Supermarkt" }] } }),
    t,
  );
  const item = allItemsOf(scope(views, "kwartaal"))[0];
  assert.equal(item.text, "Vraag · 20260010 · Afamia Supermarkt");
  assert.equal(item.href, `/dashboard/clients/${CLIENT}/kwartaal?q=3&year=2026&focus=${INVOICE}`);
  // An invoice with no number is still a row: identity degrades, it never disappears.
  const naamloos = buildWorkspace(
    sources({ vragen: { ok: true, value: [{ id: INVOICE, invoice_number: null, client_name: null }] } }),
    t,
  );
  assert.equal(allItemsOf(scope(naamloos, "kwartaal"))[0].text, "Vraag");
});

// ── 11 — clean and fully read is silence ─────────────────────────────────────

test("[KANTOOR-PERIODE] 11 · clean and fully read produces nothing at all", () => {
  const views = buildWorkspace(sources(), t);
  assert.equal(workspaceHasContent(views), false, "a clean, fully-read quarter still filled a block");
  for (const v of views) assert.equal(scopeHasContent(v), false, v.scope);
});

// ── 13 · 14 — forty findings, and not one of them lost ───────────────────────

function manyItems(n: number, groups: number): WorkItem[] {
  return Array.from({ length: n }, (_, i) => ({
    source: "geld" as const,
    scope: "administratie" as const,
    groupKey: `soort-${i % groups}`,
    text: `bevinding ${i}`,
    sourceIdentity: `id-${i}`,
  }));
}

test("[KANTOOR-PERIODE] 13 · forty findings do not become a wall at rest", () => {
  const view = buildScopeView("administratie", manyItems(40, 10));
  assert.ok(view.groups.length <= MAX_GROUPS_PER_SCOPE, `${view.groups.length} groups at rest`);
  const zichtbaar = view.groups.reduce((n, g) => n + g.shown.length, 0);
  assert.ok(zichtbaar <= MAX_GROUPS_PER_SCOPE * MAX_ITEMS_PER_GROUP, `${zichtbaar} findings at rest`);
  assert.ok(zichtbaar < 40, "nothing was folded");
});

test("[KANTOOR-PERIODE] 14 · every folded finding is still there, and counted", () => {
  for (const [n, groups] of [[40, 10], [40, 1], [40, 40], [3, 1], [9, 3]] as const) {
    const view = buildScopeView("administratie", manyItems(n, groups));
    const alles = allItemsOf(view);
    assert.equal(alles.length, n, `${n}/${groups}: a finding was dropped`);
    assert.equal(new Set(alles.map((i) => i.sourceIdentity)).size, n, `${n}/${groups}: a finding was duplicated`);
    // The counts on the folds add up to exactly what is not shown at rest.
    const shown = view.groups.reduce((acc, g) => acc + g.shown.length, 0);
    const folded = view.groups.reduce((acc, g) => acc + g.hidden.length, 0) + hiddenGroupItemCount(view);
    assert.equal(shown + folded, n, `${n}/${groups}: the fold counts do not add up`);
  }
});

test("[KANTOOR-PERIODE] grouping never crosses a scope or a source family", () => {
  // A caller mistake must not be able to move a finding into another span.
  const mixed: WorkItem[] = [
    { source: "geld", scope: "administratie", groupKey: "k", text: "a", sourceIdentity: "1" },
    { source: "kas", scope: "kas", groupKey: "k", text: "b", sourceIdentity: "2" },
  ];
  assert.deepEqual(allItemsOf(buildScopeView("administratie", mixed)).map((i) => i.text), ["a"]);
  assert.deepEqual(allItemsOf(buildScopeView("kas", mixed)).map((i) => i.text), ["b"]);
});

test("[KANTOOR-PERIODE] a fold never spans two source families", () => {
  // A fold says "these are the same kind of thing". Without a namespace, a readiness gap whose
  // grouping key happened to be "vraag" would drop into the open-questions group and read as one.
  const views = buildWorkspace(
    sources({
      readiness: { ok: true, value: { missing: [{ title: "Vraag" }], risks: [{ title: "Vraag" }] } },
      vragen: { ok: true, value: [{ id: INVOICE, invoice_number: "1", client_name: "X" }] },
    }),
    t,
  );
  const kw = scope(views, "kwartaal");
  const keys = [...kw.groups, ...kw.hiddenGroups].map((g) => g.key);
  assert.equal(new Set(keys).size, 3, `three families collapsed into ${keys.length} group(s): ${keys}`);
  for (const g of kw.groups) {
    const families = new Set(allItemsOf({ ...kw, groups: [g], hiddenGroups: [] }).map((i) => i.source));
    assert.equal(families.size, 1, `a group mixes ${[...families]}`);
  }
});

test("[KANTOOR-PERIODE] the order is the order the sources gave, never a ranking", () => {
  // "Biggest first" is a severity judgement and this module does not make those; a stable order
  // also means the block does not reshuffle between two reads that found the same work.
  const views = buildWorkspace(
    sources({ geld: { ok: true, value: { violations: [DUPLICATE, OVERALLOCATED], drawer: [], drawerChecked: true } } }),
    t,
  );
  assert.deepEqual(texts(scope(views, "administratie")), [DUPLICATE.accountantMessage, OVERALLOCATED.accountantMessage]);
});

test("[KANTOOR-PERIODE] an item carries no severity, no amount, no period and no state", () => {
  // The field list is the guarantee: anything else here would be this module inventing a fact.
  const views = buildWorkspace(
    sources({
      geld: { ok: true, value: { violations: [OVERALLOCATED], drawer: [DRAWER], drawerChecked: true } },
      readiness: { ok: true, value: { missing: [{ title: "Bon ontbreekt" }], risks: [] } },
    }),
    t,
  );
  const verboden = ["severity", "euros", "amount", "quarter", "year", "resolved", "score", "status", "done"];
  for (const view of views) {
    for (const item of allItemsOf(view)) {
      for (const veld of Object.keys(item)) {
        assert.ok(!verboden.includes(veld), `${veld} appeared on a work item`);
      }
    }
  }
});
