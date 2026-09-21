// src/lib/period-context.test.ts
// Run: npx tsx --test src/lib/period-context.test.ts
//
// [KANTOOR-PERIODE] The one race the quarter screen can lose: an answer about the period the
// accountant has just LEFT, rendered underneath the period they are looking at now.
//
// Every test below runs the same script, because it is the script that actually happens on a slow
// connection: load Q3 → switch to Q2 → the Q3 request finally answers. Two things must hold at
// every step, for each of the three period-scoped sources:
//
//   · the Q3 answer NEVER appears under Q2 — not for one render;
//   · the late Q3 answer NEVER overwrites the Q2 answer that is already there.
//
// Nothing here waits, sleeps or orders anything by time: the resolutions are written in the wrong
// order ON PURPOSE.

import test from "node:test";
import assert from "node:assert/strict";

import { acceptStamped, periodIdentity, readFor, stampFor, type Stamped } from "./period-context";
import { buildWorkspace, PENDING_READ, allItemsOf, type ScopeView } from "./period-workspace";
import { translator } from "./i18n/t";
import { MESSAGES } from "./i18n/messages";

const t = translator("nl");
const D = MESSAGES as Record<string, { nl: string }>;
const CLIENT = "ac22189e-7052-4c48-b4ec-90947cf92ecc";
const ANDERE_KLANT = "88d752ab-ad59-4991-8f3d-280dafc42b61";

const Q3 = { clientId: CLIENT, year: 2026, quarter: 3 };
const Q2 = { clientId: CLIENT, year: 2026, quarter: 2 };
const q3 = periodIdentity(Q3);
const q2 = periodIdentity(Q2);

/**
 * The screen, reduced to the only two operations it performs on an asynchronous answer: WRITE what
 * came back, and READ what may be shown. `op` is the period on the screen at that moment.
 */
function screen<T>() {
  let held: Stamped<T> | null = null;
  return {
    /** An answer lands. It is about `about`; the accountant is looking at `op`. */
    arrives(about: { clientId: string; year: number; quarter: number }, value: T, op: string) {
      held = acceptStamped(held, stampFor(about, value), op);
    },
    /** What the screen may render while looking at `op`. `null` = still reading. */
    shows(op: string): T | null {
      return readFor(held, op);
    },
  };
}

test("[KANTOOR-PERIODE] identity is the client AND the year AND the quarter", () => {
  assert.notEqual(q3, q2, "two quarters of one client shared an identity");
  assert.notEqual(periodIdentity({ ...Q3, clientId: ANDERE_KLANT }), q3, "two clients shared an identity");
  assert.notEqual(periodIdentity({ ...Q3, year: 2025 }), q3, "two years shared an identity");
  // The same period asked twice is the same identity — that is what makes an answer usable at all.
  assert.equal(periodIdentity({ clientId: CLIENT, year: 2026, quarter: 3 }), q3);
});

// ── the race, once per source ────────────────────────────────────────────────

test("[KANTOOR-PERIODE] readiness · a late Q3 report never appears under Q2, and never overwrites it", () => {
  const readiness = screen<{ missing: { title: string }[]; risks: { title: string }[] }>();
  const Q3_RAPPORT = { missing: [{ title: "Bankafschrift Q3 ontbreekt" }], risks: [] };
  const Q2_RAPPORT = { missing: [{ title: "Bon Q2 ontbreekt" }], risks: [] };

  // 1 · Q3 is loaded and on the screen.
  readiness.arrives(Q3, Q3_RAPPORT, q3);
  assert.deepEqual(readiness.shows(q3), Q3_RAPPORT);

  // 2 · the accountant switches to Q2. Q3's report is still the only thing in state — and it is
  //     not shown. Pending, not empty, and certainly not a Q2 fact.
  assert.equal(readiness.shows(q2), null, "the Q3 report rendered under the Q2 heading");

  // 3 · Q2 answers.
  readiness.arrives(Q2, Q2_RAPPORT, q2);
  assert.deepEqual(readiness.shows(q2), Q2_RAPPORT);

  // 4 · …and only NOW does the abandoned Q3 request come back. It is dropped.
  readiness.arrives(Q3, Q3_RAPPORT, q2);
  assert.deepEqual(readiness.shows(q2), Q2_RAPPORT, "the late Q3 report overwrote Q2");
});

test("[KANTOOR-PERIODE] open questions · the Q3 invoice rows never answer for Q2", () => {
  const facturen = screen<{ rows: { id: string; accountant_status: string | null }[]; error: boolean }>();
  const Q3_RIJEN = { rows: [{ id: "inv-q3", accountant_status: "vraag" }], error: false };
  const Q2_RIJEN = { rows: [{ id: "inv-q2", accountant_status: null }], error: false };

  facturen.arrives(Q3, Q3_RIJEN, q3);
  assert.deepEqual(facturen.shows(q3), Q3_RIJEN);
  assert.equal(facturen.shows(q2), null, "Q3 rows were readable as Q2 rows");
  facturen.arrives(Q2, Q2_RIJEN, q2);
  facturen.arrives(Q3, Q3_RIJEN, q2);
  assert.deepEqual(facturen.shows(q2), Q2_RIJEN, "the late Q3 rows overwrote Q2");
});

test("[KANTOOR-PERIODE] reconciled figures · an old quarter's omzet never stands under a new one", () => {
  const cijfers = screen<{ omzet: number; kosten: number; saldo: number }>();
  const Q3_CIJFERS = { omzet: 18450.5, kosten: 9120.25, saldo: 1960.05 };
  const Q2_CIJFERS = { omzet: 7310, kosten: 2405.75, saldo: 1030.9 };

  cijfers.arrives(Q3, Q3_CIJFERS, q3);
  assert.deepEqual(cijfers.shows(q3), Q3_CIJFERS);
  // The most convincing wrong number this app could print: a real, reconciled figure under the
  // wrong heading. While Q2 is being read there is no number to show at all.
  assert.equal(cijfers.shows(q2), null, "Q3's omzet was shown as Q2's omzet");
  cijfers.arrives(Q2, Q2_CIJFERS, q2);
  cijfers.arrives(Q3, Q3_CIJFERS, q2);
  assert.deepEqual(cijfers.shows(q2), Q2_CIJFERS, "the late Q3 figures overwrote Q2");
});

test("[KANTOOR-PERIODE] the same race across CLIENTS, not only quarters", () => {
  const anders = periodIdentity({ clientId: ANDERE_KLANT, year: 2026, quarter: 3 });
  const readiness = screen<{ missing: { title: string }[] }>();
  readiness.arrives(Q3, { missing: [{ title: "Bon van Kiwi ontbreekt" }] }, q3);
  // Same year, same quarter, different administration — the worst one to get wrong.
  assert.equal(readiness.shows(anders), null, "one client's gap was shown on another client's screen");
  readiness.arrives({ clientId: ANDERE_KLANT, year: 2026, quarter: 3 }, { missing: [] }, anders);
  readiness.arrives(Q3, { missing: [{ title: "Bon van Kiwi ontbreekt" }] }, anders);
  assert.deepEqual(readiness.shows(anders), { missing: [] }, "the late answer crossed into another client");
});

// ── pending is not failure, and not emptiness ────────────────────────────────

const scope = (views: ScopeView[], name: ScopeView["scope"]) => views.find((v) => v.scope === name)!;

test("[KANTOOR-PERIODE] while the new period is still being read, the block says nothing at all", () => {
  // Exactly what the screen hands buildWorkspace between the switch and the first Q2 answer.
  const views = buildWorkspace(
    {
      ...Q2,
      readiness: PENDING_READ,
      geld: PENDING_READ,
      nummering: PENDING_READ,
      vragen: PENDING_READ,
    },
    t,
  );
  for (const view of views) {
    assert.deepEqual(allItemsOf(view), [], `${view.scope} showed a finding for a period it had not read`);
    // …and not one read-failure sentence: nothing failed. The answer is simply not back.
    assert.deepEqual(view.notices, [], `${view.scope} called a pending read a failure`);
  }
});

test("[KANTOOR-PERIODE] a read that actually FAILED still says so, in each source's own words", () => {
  const views = buildWorkspace(
    { ...Q2, readiness: { ok: false }, geld: { ok: false }, nummering: { ok: false }, vragen: { ok: false } },
    t,
  );
  assert.deepEqual(scope(views, "kwartaal").notices, [D["bh.opvr.fout.lezen"].nl, D["bh.kwt.leesfout"].nl]);
  assert.deepEqual(scope(views, "administratie").notices, [D["geld.nietGelezenAcc"].nl]);
  assert.deepEqual(scope(views, "nummering").notices, [D["doorlopend.nietGelezenAcc"].nl]);
  assert.deepEqual(scope(views, "kas").notices, [D["geld.nietGelezenAcc"].nl]);
});

test("[KANTOOR-PERIODE] one pending source does not silence the three that did answer", () => {
  // The invoice rows are in, readiness is not: the open question is on the screen, and the quarter
  // block carries no claim whatsoever about readiness — neither findings nor a failure.
  const views = buildWorkspace(
    {
      ...Q2,
      readiness: PENDING_READ,
      geld: { ok: true, value: { violations: [], drawer: [], drawerChecked: true } },
      nummering: { ok: true, value: { series: [], unreadable: [], countersRead: true } },
      vragen: { ok: true, value: [{ id: "inv-1", invoice_number: "2026-0004", client_name: "CAN" }] },
    },
    t,
  );
  const kwartaal = scope(views, "kwartaal");
  assert.equal(allItemsOf(kwartaal).length, 1);
  assert.match(allItemsOf(kwartaal)[0].text, /2026-0004/);
  assert.deepEqual(kwartaal.notices, []);
});

test("[KANTOOR-PERIODE] the race, end to end: a Q3 finding is never rendered beneath Q2", () => {
  const bronnen = screen<{ missing: { title: string }[]; risks: { title: string }[] }>();
  bronnen.arrives(Q3, { missing: [{ title: "Bankafschrift Q3 ontbreekt" }], risks: [] }, q3);

  // Looking at Q3: the finding is there.
  const opQ3 = bronnen.shows(q3);
  const viewsQ3 = buildWorkspace(
    { ...Q3, readiness: opQ3 ? { ok: true, value: opQ3 } : PENDING_READ, geld: PENDING_READ, nummering: PENDING_READ, vragen: PENDING_READ },
    t,
  );
  assert.deepEqual(allItemsOf(scope(viewsQ3, "kwartaal")).map((i) => i.text), ["Bankafschrift Q3 ontbreekt"]);

  // Switched to Q2, Q3's answer still the only one in state: nothing, and no failure notice.
  const opQ2 = bronnen.shows(q2);
  const viewsQ2 = buildWorkspace(
    { ...Q2, readiness: opQ2 ? { ok: true, value: opQ2 } : PENDING_READ, geld: PENDING_READ, nummering: PENDING_READ, vragen: PENDING_READ },
    t,
  );
  const kwartaal = scope(viewsQ2, "kwartaal");
  assert.deepEqual(allItemsOf(kwartaal), [], "a Q3 gap was rendered under the Q2 heading");
  assert.deepEqual(kwartaal.notices, [], "a pending Q2 read was reported as a failed one");
});
