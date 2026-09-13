// src/content/legal/pricing-commitments.test.ts
// [KANTOOR-STAFFEL] What the Terms promise about price, guarded the way exit-commitments.test.ts
// guards the shutdown clause — and for the same reason.
//
// These clauses were written at zero paying customers. That is the only moment they are free to
// write, and precisely what makes them easy to lose later: a future rewrite of §5.5 or §5.8 that
// narrows them produces no error, no failing build, and no visible change until the day an office
// asks whether its limit can be taken away. By then the answer cannot be given any more.
//
// Two distinct things are asserted here:
//   1. the grandfathering promise of §5.5.1 still says what it says;
//   2. the §5.8 price table still matches src/lib/accountant-pricing.ts.
//
// (2) is the regression that already happened once in this repo. In July 2026 the published Terms
// quoted plans of € 25 and € 45 while the database knew a different four-tier model — two copies
// of one fact, drifting apart unnoticed. The table is generated now, and this test is what proves
// the generated version is the one that reaches /voorwaarden.
//
// Asserts the RENDERED document, like company.test.ts and exit-commitments.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

import { ACCOUNTANT_BANDS, ACCOUNTANT_PRICING_ACTIVE, inclBtw } from "@/lib/accountant-pricing";
import { readFileSync } from "node:fs";

import voorwaarden from "./algemene-voorwaarden";

test("the grandfathering clause exists and is not scoped to paying users", () => {
  assert.ok(
    voorwaarden.includes("**5.5.1 Een grens die je al hebt, raak je niet meer kwijt.**"),
    "§5.5.1 — the promise that an existing limit is never lowered",
  );
  // The load-bearing half. "We warn you before we take something away" is a different, weaker
  // promise, and it is the one this clause was written to replace.
  assert.ok(
    voorwaarden.includes("van een bestaande gebruiker pakken wij een grens **niet af**"),
    "§5.5.1 must say in its own words that an existing limit is not taken away at all",
  );
  // It has to cover BOTH limit systems, or it silently protects the ondernemer and not the office.
  assert.ok(
    voorwaarden.includes("voor iedere grens uit §5.2 en voor de grens van 10 gekoppelde klanten uit §5.8"),
    "the clause must name both the fair-use limits and the accountant boundary",
  );
});

test("the grandfathering promise names the three ways it could be eroded, and refuses all three", () => {
  // Each of these is a real mechanism someone could reach for later while still claiming to honour
  // the clause: announce it, phase it in, or fold it into a bigger revision.
  assert.ok(
    voorwaarden.includes("niet met aankondiging, niet na een overgangstermijn, niet bij een latere herziening"),
    "§5.5.1 must close the announcement, transition-period and revision routes explicitly",
  );
});

test("the Terms record why the promise was made at zero customers", () => {
  // Not decoration. It is what lets a later reader tell the difference between a promise made from
  // strength and one extracted after the fact — and it is the sentence a future rewrite drops first.
  assert.ok(
    voorwaarden.includes("**5.5.2 Waarom dit er staat op het moment dat het niets kost.**"),
    "§5.5.2 — the note that this was written before there was a reason to want it narrower",
  );
});

test("the accountant price table in the Terms matches the code that defines it", () => {
  for (const band of ACCOUNTANT_BANDS) {
    if (band.monthlyExclBtw === 0) continue;
    const excl = `€ ${band.monthlyExclBtw.toFixed(2).replace(".", ",")}`;
    const incl = `€ ${inclBtw(band.monthlyExclBtw).toFixed(2).replace(".", ",")}`;
    assert.ok(voorwaarden.includes(excl), `§5.8 must show ${excl} — it is in ACCOUNTANT_BANDS`);
    assert.ok(voorwaarden.includes(incl), `§5.8 must show ${incl} next to it`);
  }
});

test("the pricing placeholder is always substituted, never shipped raw", () => {
  // The failure this catches is a legal page publishing "[TARIEF-STAFFEL]" to an office — the same
  // class of failure company.test.ts catches for the identity placeholders.
  assert.ok(!voorwaarden.includes("[TARIEF-STAFFEL]"), "the token must be replaced before rendering");
});

test("while the price is inactive, the Terms say so rather than implying it applies", () => {
  // A published table an office reads as live, with no charge behind it, is not a kindness — it is
  // a price nobody agreed to. The two have to move together.
  if (!ACCOUNTANT_PRICING_ACTIVE) {
    assert.ok(
      voorwaarden.includes("**5.8.1 Deze staffel is voorbereid, niet actief.**"),
      "§5.8.1 must state the table is prepared and not active while the code says the same",
    );
    assert.ok(
      voorwaarden.includes("is het portaal in zijn geheel kosteloos, ook boven de 10"),
      "§5.8.1 must say the portal is free above the boundary too while the price is inactive",
    );
  }
});

test("the Terms admit the bands were not tested with an office", () => {
  // The honest disclosure. It is the one sentence in §5.8 that a confident rewrite would delete,
  // and deleting it turns a documented guess into an implied market rate.
  assert.ok(
    voorwaarden.includes("Wij hebben nog geen enkel kantoor over deze bedragen gesproken"),
    "§5.8.1 must keep saying the amounts are derived, not validated",
  );
});

test("the payment trigger stays growth, never the passage of time", () => {
  // The promise that makes the free tier trustworthy: no expiring trial hiding inside it.
  assert.ok(
    voorwaarden.includes("het moment van betalen door groei, niet door het verstrijken van tijd"),
    "§5.8 must keep the growth-not-time commitment",
  );
  assert.ok(voorwaarden.includes("Er is geen proefperiode die afloopt en geen maand-na-een-jaar"));
});

// ─── [GRENS-BLIJFT] The clause is not only written down — it runs ────────────────────────────
//
// The three tests above prove §5.5.1 still SAYS what it says. They were green for months while the
// promise had no mechanism at all: FAIR_USE_LIMITS is a flat constant, and every reader took
// whatever it said today. Lower one `free:` number and every existing account silently gets the
// lower one — the clause breached, with the clause itself still on the page.
//
// A promise that only exists in the Terms is the shape this whole test file was written to catch,
// one level down.

/** Source with comments stripped — these files explain the mistake the gate looks for. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("[GRENS-BLIJFT] the readers that decide what an ACCOUNT gets ask for its entitlement", () => {
  // Two readers decide what an account is actually held to. Both must go through entitledLimit();
  // reading FAIR_USE_LIMITS straight is the breach.
  const usage = code("src/lib/fair-use-usage.ts");
  assert.match(
    usage, /return entitledLimit\(key, "free", accountStartedAt\);/,
    "limitForPlan() is back to the published limit — that is the ceiling that PAUSES an action, so " +
      "this is where §5.5.1 is either kept or quietly broken",
  );

  const fairUse = code("src/lib/fair-use.ts");
  assert.match(
    fairUse, /const ceiling = entitledLimit\(limit\.key, plan, accountStartedAt\);/,
    "evaluateFairUse() measures against the published limit again — the owner would be told he is " +
      "over a limit he was promised he still had",
  );

  // And the date has to REACH them, or the argument is decoration. planAndStartFor carries it out
  // of the profiles row the gate already reads.
  const gate = code("src/lib/fair-use-gate.ts");
  assert.match(gate, /export async function planAndStartFor\(/);
  assert.match(gate, /accountStartedAt: resolved\.startedAt,/, "the reservation no longer receives the date");
  assert.match(
    gate, /limit: entitledLimit\(params\.metric,/,
    "the 402 answer names the published limit again — a refusal that quotes a number the owner is " +
      "not held to tells him the promise was not kept",
  );
});

test("[GRENS-BLIJFT] the history is append-only, dated, and carries its reason", () => {
  const history = code("src/lib/fair-use-history.ts");
  // Every entry must be datable and explainable. A change with no announcement date cannot be
  // applied at all (§5.5.1 keys on the announcement), and one with no reason is unreadable in five
  // years — which is when somebody will need it.
  for (const field of ["announcedOn", "was", "note"]) {
    assert.match(history, new RegExp(`${field}[?]?:`), `LimitChange lost its ${field}`);
  }
  assert.match(history, /export const LIMIT_CHANGES: readonly LimitChange\[\]/);

  // The generosity direction, which is the whole safety argument: an account that cannot be dated,
  // or a broken row in our own list, must never cost somebody a ceiling.
  assert.match(history, /if \(announced !== null && started !== null && started > announced\) continue;/,
    "an unreadable date now excludes the account from a limit it may be entitled to");
});

test("[GRENS-BLIJFT] what we PUBLISH stays today's offer, not somebody's kept limit", () => {
  // The other half, and it is easy to get backwards. /prijzen and /eerlijk-gebruik describe what we
  // offer NOW to someone who has no account yet. Feeding a personal entitlement into those pages
  // would advertise one visitor's grandfathered ceiling to everyone.
  const fairUse = code("src/lib/fair-use.ts");
  const table = fairUse.slice(fairUse.indexOf("export function fairUseTableMarkdown"));
  assert.doesNotMatch(table.slice(0, table.indexOf("}")), /entitledLimit/,
    "the published table started resolving a personal entitlement");
  assert.match(fairUse, /accountStartedAt === undefined/,
    "formatLimit lost the distinction between the published limit and this account's");
});
