// tests/render/security-screens.test.tsx
// [RENDER-GATE] Does the security screen survive one render, with rows that reach every branch?
//
// Run: npm run test:render
//
// The reasoning for this whole directory is in money-screens.test.tsx: tsc, eslint, next build and
// the Playwright smoke test are all blind to a /dashboard/* screen that throws on every render.
//
// What this file adds on top of "it renders" is the one assertion the pure test cannot make. The
// rule in src/lib/security-overview.ts — never say "alleen jij" on a read that did not finish — is
// tested there as a value. Here it is tested as a SENTENCE, because a panel that computed the same
// answer correctly and then rendered the wrong string would pass every test in that file. Handing
// this component an incomplete read and asserting that the reassuring sentence is absent is the
// only place those two can be checked against each other.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard/beveiliging",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

const owner = { kind: "owner" as const, revokeId: null, name: "Kiwi Diensten", email: "kiwi@example.nl", since: null };

test("[BEVEILIGING] the access panel renders every kind of holder", async () => {
  const { ToegangPaneel } = await import("../../src/components/beveiliging/ToegangPaneel");
  const { translator } = await import("../../src/lib/i18n/t");

  const html = renderToStaticMarkup(
    React.createElement(ToegangPaneel, {
      holders: [
        owner,
        { kind: "bookkeeper", revokeId: "link-1", name: "Boekhouder BV", email: "bh@example.nl", since: "2026-01-15" },
        // A member we could not put a name to. The row must still appear — the fact that someone is
        // there does not depend on our being able to spell them.
        { kind: "member", revokeId: "m-1", name: null, email: null, since: "2026-04-01" },
      ],
      complete: true,
      count: 3,
      t: translator("nl"),
      manageHref: "/dashboard/settings/team",
    }),
  );

  assert.ok(html.length > 0, "the panel rendered nothing at all");
  assert.match(html, /Kiwi Diensten/, "the owner is on his own list");
  assert.match(html, /Boekhouder BV/);
  assert.match(html, /Naam niet gelezen/, "a nameless row says so instead of vanishing");
  assert.match(html, /3 mensen/, "the count is stated when every source answered");
  assert.match(html, /15-01-2026/, "the bookkeeper's start date is on the row");
});

test("[BEVEILIGING] an incomplete read never renders the reassuring sentence", () => {
  // THE ONE THAT MATTERS. "Alleen jij" is a promise. Made on a read that half-failed it is worse
  // than no screen at all, because the owner stops looking — on the screen he opened precisely to
  // check whether anyone else is in his books.
  return (async () => {
    const { ToegangPaneel } = await import("../../src/components/beveiliging/ToegangPaneel");
    const { translator } = await import("../../src/lib/i18n/t");

    const render = (complete: boolean, count: number | null) =>
      renderToStaticMarkup(
        React.createElement(ToegangPaneel, {
          holders: [owner],
          complete,
          count,
          t: translator("nl"),
          manageHref: "/dashboard/settings/team",
        }),
      );

    const broken = render(false, null);
    assert.doesNotMatch(broken, /Alleen jij/, "a failed read is being reported as a private administration");
    assert.match(broken, /misschien niet compleet/, "…and it must say what actually happened");
    // No number either: a count printed over an incomplete list is the same lie with digits.
    assert.doesNotMatch(broken, /mensen kunnen bij/);

    // And when everything did answer, the promise IS made — otherwise the screen warns forever and
    // the warning stops meaning anything.
    const whole = render(true, 1);
    assert.match(whole, /Alleen jij/);
    assert.doesNotMatch(whole, /misschien niet compleet/);
  })();
});

test("[BEVEILIGING] the screen itself renders, in its three load states", async () => {
  const { default: BeveiligingClient } = await import("../../src/app/dashboard/beveiliging/BeveiligingClient");

  // Effects never run under renderToStaticMarkup, so this is the "reading" state — which is exactly
  // the one every visitor sees first, and the one a crash would take down before anything else.
  const html = renderToStaticMarkup(React.createElement(BeveiligingClient));
  assert.ok(html.length > 0, "the security screen rendered nothing");
  assert.match(html, /Beveiliging|beveiliging|administratie/, "the screen has no words on it");
});

// ─── [DOORLOPEND] The numbering verdict ──────────────────────────────────────────────

const series = (over: Record<string, unknown> = {}) => ({
  type: "factuur", year: 2026, first: 1, last: 3, issued: 3,
  missing: [] as number[], burnedAtEnd: 0 as number | null, duplicates: [] as string[], ...over,
});

test("[DOORLOPEND] a clean series says so in one line, and never in a warning box", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: { series: [series()], unreadable: [], clean: true, unaccounted: 0, countersRead: true },
        t: translator("nl"),
      }),
    );
    assert.match(html, /loopt door/, "the healthy answer must be on the screen — a check nobody sees buys no confidence");
    assert.doesNotMatch(html, /amber/, "a green box the size of a warning teaches people to skim this spot");
    assert.doesNotMatch(html, /ontbreken/);
  })();
});

test("[DOORLOPEND] a gap names the numbers, and a burned end says the counter is ahead", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: {
          series: [series({ missing: [2], last: 4 }), series({ type: "creditnota", burnedAtEnd: 1 })],
          unreadable: ["2026/0009"],
          clean: false,
          unaccounted: null,
          countersRead: true,
        },
        t: translator("nl"),
      }),
    );
    // The number itself, because "er ontbreekt iets" is not something an owner can act on.
    assert.match(html, /nummer 2 is nooit uitgereikt/);
    // The end-of-series case, which a hole-scan cannot see at all.
    assert.match(html, /teller staat hoger/);
    // Both series named separately, so the owner knows which one to look at.
    assert.match(html, /Facturen 2026/);
    assert.match(html, /Creditnota/);
    // Unreadable numbers are shown as themselves — an owner recognises his own imported history.
    assert.match(html, /2026\/0009/);
    // And a next step, because a finding with none is a screen that worries someone and leaves him.
    assert.match(html, /kun je niet opnieuw gebruiken/);
  })();
});

test("[DOORLOPEND] half a check is never reported as a whole one", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    // Clean as far as we could see, but the counters did not answer — so the end of the series is
    // unchecked, which is exactly where a burned number is likeliest to sit.
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: { series: [series({ burnedAtEnd: null })], unreadable: [], clean: true, unaccounted: null, countersRead: false },
        t: translator("nl"),
      }),
    );
    assert.match(html, /loopt door/);
    assert.match(html, /einde van de reeks konden we nu niet nakijken/, "the unchecked half must be named");

    // And "we could not check" is its own answer, never a quiet clean one.
    const failed = renderToStaticMarkup(
      React.createElement(NummeringUitslag, { report: null, t: translator("nl") }),
    );
    assert.match(failed, /konden je nummering nu niet nakijken/);
    assert.doesNotMatch(failed, /loopt door/, "a failed check must never render the reassuring sentence");
  })();
});

test("[REEKS-ZONDER-FACTUUR] a series with nothing in it gets its own sentence", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    // The production shape: invoices in one series, and a creditnota counter standing above zero
    // with no creditnota under it. "Aan het eind van de reeks" presupposes a reeks; this one has
    // none, and the owner's answer to it ("that was a draft I threw away") is a different answer.
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: {
          series: [
            series(),
            series({ type: "creditnota", first: null, last: null, issued: 0, burnedAtEnd: 2 }),
          ],
          unreadable: [], clean: false, unaccounted: 2, countersRead: true,
        },
        t: translator("nl"),
      }),
    );
    assert.match(html, /geen enkel document in deze reeks/, "the empty-series sentence must be the one shown");
    assert.doesNotMatch(html, /teller staat hoger dan je hoogste factuur/,
      "the end-of-series sentence talks about a highest invoice this series does not have");
    assert.match(html, /Creditnota/, "the owner must know WHICH series");
  })();
});

// ─── [GELD-INVARIANT] Do the books agree with themselves? ────────────────────────────

// money-invariants.ts was complete, considered and tested — and nothing called it. No screen, no
// route, no cron. A money audit that runs nowhere is the exact defect that file warns about in its
// own header: computed, and told to no one.
//
// These render the verdict, because the rule is tested as VALUES elsewhere and a component that
// computed the right answer and printed the wrong sentence would pass every test over there.

const finding = (over: Record<string, unknown> = {}) => ({
  kind: "paid_without_payments",
  entityId: "inv-1",
  euros: 1210,
  message: "Factuur 20260046 staat op betaald, maar er staat geen enkele betaling tegenover (€ 1.210,00).",
  accountantMessage: "20260046: € 1.210,00 als betaald, geen betaling ertegenover.",
  ...over,
});

test("[GELD-INVARIANT] books that agree say so in one line, and never in a warning box", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [], drawer: [], drawerChecked: true },
        t: translator("nl"),
      }),
    );
    assert.match(html, /Geen enkel verschil gevonden/, "the healthy answer must be on the screen — a check nobody sees buys no confidence");
    assert.doesNotMatch(html, /amber/, "a green box the size of a warning teaches people to skim this spot");
    assert.doesNotMatch(html, /oneens/);
  })();
});

test("[GELD-INVARIANT] a difference is stated in the rule's own words, with a next step", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: {
          headline: "",
          violations: [finding()],
          drawer: [finding({ kind: "drawer_negative", entityId: "2026-02-11", message: "De kaslade staat op 11-02-2026 onder nul (€ 40,00 negatief)." })],
          drawerChecked: true,
        },
        t: translator("nl"),
      }),
    );
    // The sentence comes from the rule because it names the two figures that disagree — summarising
    // it on the screen would lose exactly that.
    assert.match(html, /20260046 staat op betaald/);
    assert.match(html, /€ 1\.210,00/, "the euros are what decide whether this waits until Monday");
    assert.match(html, /kaslade staat op 11-02-2026 onder nul/, "the drawer axis is shown alongside, not instead");
    // And a next step, because a finding with none worries someone and leaves him there.
    assert.match(html, /niet automatisch/);
  })();
});

test("[GELD-INVARIANT] half a check is never reported as a whole one", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    // Clean as far as we could see, but the drawer half did not run — and the till is exactly
    // where a missing movement hides best.
    const half = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [], drawer: [], drawerChecked: false },
        t: translator("nl"),
      }),
    );
    assert.match(half, /Geen enkel verschil gevonden/);
    assert.match(half, /kaslade konden we nu niet nakijken/, "the unchecked half must be named");

    // And "we could not check" is its own answer, never a quiet clean one.
    const failed = renderToStaticMarkup(
      React.createElement(GeldUitslag, { audit: null, t: translator("nl") }),
    );
    assert.match(failed, /konden je boeken nu niet nakijken/);
    assert.doesNotMatch(failed, /Geen enkel verschil gevonden/, "a failed check must never render the reassuring sentence");
  })();
});

// ─── [KANTOOR-RUST] The same two checks, read by the accountant ──────────────────────

// On /dashboard/clients/[id]/kwartaal the boekhouder reads these panels about a CLIENT's series and
// books. There a healthy check says nothing, a finding names its numbers without addressing the
// owner, the rationale opens on demand — and a check that could NOT run still says so.

test("[KANTOOR-RUST] to the accountant a clean series is silent, and half a check is not", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const clean = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: { series: [series()], unreadable: [], clean: true, unaccounted: 0, countersRead: true },
        t: translator("nl"),
        audience: "accountant",
      }),
    );
    assert.equal(clean, "", "a healthy series must render NOTHING to the accountant");

    // Half a check is still named: without the counters the end of the series is unchecked.
    const half = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: { series: [series({ burnedAtEnd: null })], unreadable: [], clean: true, unaccounted: null, countersRead: false },
        t: translator("nl"),
        audience: "accountant",
      }),
    );
    assert.match(half, /einde van de reeks konden we nu niet nakijken/);
    assert.doesNotMatch(half, /loopt door/, "the owner's reassuring line is not the accountant's");

    // And "we could not check" is its own sentence, in the accountant's voice.
    const failed = renderToStaticMarkup(
      React.createElement(NummeringUitslag, { report: null, t: translator("nl"), audience: "accountant" }),
    );
    assert.match(failed, /kon nu niet worden nagekeken/);
    assert.match(failed, /zegt niets over de administratie/, "a failed check must not read as a clean one");
    assert.doesNotMatch(failed, /\bje\b/, "the failed-check sentence addresses the owner");
  })();
});

test("[KANTOOR-RUST] a gap is named to the accountant without the owner's voice, and the why folds", () => {
  return (async () => {
    const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const html = renderToStaticMarkup(
      React.createElement(NummeringUitslag, {
        report: {
          series: [
            series({ missing: [2], last: 4 }),
            series({ type: "creditnota", burnedAtEnd: 1 }),
            series({ type: "creditnota", year: 2025, first: null, last: null, issued: 0, burnedAtEnd: 2 }),
          ],
          unreadable: ["2026/0009"],
          clean: false,
          unaccounted: null,
          countersRead: true,
        },
        t: translator("nl"),
        audience: "accountant",
      }),
    );
    // The finding itself, with its numbers — the protected half.
    assert.match(html, /nummer 2 is nooit uitgereikt/);
    assert.match(html, /teller staat hoger dan de hoogste factuur/);
    assert.match(html, /geen document in deze reeks/);
    assert.match(html, /2026\/0009/);
    // Never the owner addressed, never "je boekhouder" to the boekhouder.
    assert.doesNotMatch(html, /boekhouder/, "the accountant is told to note something for their accountant");
    assert.doesNotMatch(html, /\bje\b|\bjouw\b/, "the accountant reads a sentence written to the owner");
    // The rationale is there, behind a <details>, and only there.
    assert.match(html, /<details>[\s\S]*Belastingdienst accepteert een gat[\s\S]*<\/details>/);
    assert.match(html, /<summary[^>]*>Waarom\?<\/summary>/);
  })();
});

test("[KANTOOR-RUST] to the accountant books that agree are silent, a difference is named, the why folds", () => {
  return (async () => {
    const { GeldUitslag } = await import("../../src/components/beveiliging/GeldPaneel");
    const { translator } = await import("../../src/lib/i18n/t");
    const clean = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [], drawer: [], drawerChecked: true },
        t: translator("nl"),
        audience: "accountant",
      }),
    );
    assert.equal(clean, "", "books that agree must render NOTHING to the accountant");

    const half = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [], drawer: [], drawerChecked: false },
        t: translator("nl"),
        audience: "accountant",
      }),
    );
    assert.match(half, /kaslade konden we nu niet nakijken/, "the unchecked drawer must be named");
    assert.doesNotMatch(half, /Geen enkel verschil gevonden/);

    const failed = renderToStaticMarkup(
      React.createElement(GeldUitslag, { audit: null, t: translator("nl"), audience: "accountant" }),
    );
    assert.match(failed, /boeken konden nu niet worden nagekeken/);
    assert.doesNotMatch(failed, /\bje\b/);

    // The finding as the route hands it over: the owner's sentence and the accountant's, from the
    // same rule. The panel picks by audience and edits neither.
    const both = finding({
      message: "Factuur 20260046 staat op betaald, maar er staat geen enkele betaling tegenover (€ 1.210,00). Dit getal staat in je aangifte.",
      accountantMessage: "20260046: status betaald, € 1.210,00 zonder betaling ertegenover.",
    });
    const diff = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [both], drawer: [], drawerChecked: true },
        t: translator("nl"),
        audience: "accountant",
      }),
    );
    // The accountant's sentence, euros included — never the owner's.
    assert.match(diff, /20260046: status betaald/);
    assert.match(diff, /€ 1\.210,00/);
    assert.doesNotMatch(diff, /staat in je aangifte/, "the owner's sentence reached the accountant");
    assert.doesNotMatch(diff, /\bje\b/);
    // The why, folded, and without "leg het voor aan je boekhouder".
    assert.match(diff, /<details>[\s\S]*niet automatisch hersteld[\s\S]*<\/details>/);
    assert.doesNotMatch(diff, /boekhouder/);

    // And the owner still reads the owner's sentence — the presentation is role-aware, not rewritten.
    const owner = renderToStaticMarkup(
      React.createElement(GeldUitslag, {
        audit: { headline: "", violations: [both], drawer: [], drawerChecked: true },
        t: translator("nl"),
      }),
    );
    assert.match(owner, /staat in je aangifte/);
    assert.doesNotMatch(owner, /20260046: status betaald/);
  })();
});

// ─── [KASBOEK-NAAST-KAS] Het kasboek van de boekhouder, naast de kas ─────────────────

// De lijst waarop een ondernemer beslist welk bedrag hij in zijn kas bijboekt. Twee dingen mogen
// hier nooit op het scherm komen: het HELE bedrag van een regel waarvan de app een deel al kent
// (dat boekt dubbel en verlaagt het saldo), en een knop bij een uitgave die de app wél kent en het
// kasboek niet (die hangt meestal aan een factuur met een bon eronder).

const kasDag = (over: Record<string, unknown> = {}) => ({
  date: "2026-04-08", fileSpent: 1754.35, appSpent: 698.97, delta: 1055.38,
  verdict: "ontbreekt" as const,
  description: "hano 006220 en 006305 : 1.591,83 ,,  famzfood : 162,52",
  fileReceived: 341.9, appReceived: 341.9, ...over,
});

const vergelijking = (over: Record<string, unknown> = {}) => ({
  period: { from: "2026-04-01", to: "2026-06-30" },
  openingBalance: 1018.32, closingBalance: 3850.35,
  headline: "84 van de 91 dagen kloppen, op 7 dagen mist je kas samen € 20.974,15 aan uitgaven.",
  summary: { days: 91, missingDays: 7, missingTotal: 20974.15, extraDays: 0, extraTotal: 0, equalDays: 84 },
  days: [kasDag()], warnings: [], ...over,
});

test("[KASBOEK-NAAST-KAS] alleen het verschil staat op de knop, nooit het hele bedrag", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking(), keuze: { "2026-04-08": "kosten" },
        onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    assert.match(html, /Boek € 1\.055,38 als/, "het verschil, niet de 1.754,35 van de regel");
    assert.doesNotMatch(html, /Boek € 1\.754,35/, "het hele bedrag boeken zet de 698,97 er een tweede keer in");
    // Beide kanten staan erbij, zodat de eigenaar ziet WAAROM het 1.055,38 is.
    assert.match(html, /kasboek € 1\.754,35/);
    assert.match(html, /je kas € 698,97/);
    // En de omschrijving van de boekhouder, ongewijzigd — het enige spoor van wat dit was.
    assert.match(html, /famzfood/);
  })();
});

test("[KASBOEK-NAAST-KAS] een uitgave die de app kent en het kasboek niet, krijgt geen knop", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking({ days: [kasDag({ verdict: "app_meer", fileSpent: 0, appSpent: 250, delta: -250, description: null })] }),
        keuze: {}, onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    assert.doesNotMatch(html, /type="checkbox"/, "hier valt niets te boeken");
    assert.match(html, /halen hem niet weg/, "…en zeker niets te wissen: die boeking heeft vaak een bon");
  })();
});

test("[KASBOEK-NAAST-KAS] de kop noemt eerst wat er klopt, en het blad zijn eigen gaten", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking({ warnings: ["Regel 40 (2026-05-03): begint met 1200,00 terwijl 2026-05-01 eindigde op 1450,00."] }),
        keuze: {}, onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    assert.match(html, /84 van de 91 dagen kloppen/);
    // De waarschuwing van het blad staat BOVEN de lijst: hij zegt iets over elke regel eronder.
    const waarschuwingOp = html.indexOf("begint met 1200,00");
    const lijstOp = html.indexOf("famzfood");
    assert.ok(waarschuwingOp !== -1 && waarschuwingOp < lijstOp, "een gat in de keten hoort boven de dagen te staan");
  })();
});

test("[KASBOEK-NAAST-KAS] niets te doen wordt ook gezegd", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking({ days: [], headline: "Alle 91 dagen kloppen: je kas zegt hetzelfde als het kasboek van je boekhouder." }),
        keuze: {}, onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    assert.match(html, /Elke dag in dit kasboek komt overeen/);
    assert.doesNotMatch(html, /Boek \d/, "geen knop als er niets te boeken valt");
    // De zin gaat over de DAGEN en claimt niets over de saldi — zie de test hieronder.
    assert.doesNotMatch(html, /niets te doen/, "dat zou ook over de openingsstand gaan");
  })();
});

// ── De rand die geen dagvergelijking kan zien ──
//
// Dit is dezelfde blindheid als bij de factuurnummers en de bankdekking: een controle TUSSEN de
// items ziet nooit dat de reeks op de verkeerde stand begint. Bij Kiwi klopte elke dag en stond de
// lade toch € 1.911,18 te laag, want de app opende het kwartaal op −892,86 en het kasboek op
// 1.018,32. Zonder deze regels is dat een volledig groen scherm boven een verkeerd kassaldo.

test("[KASBOEK-NAAST-KAS] een kloppende dagenlijst boven een verkeerde openingsstand is geen groen scherm", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking({
          days: [],
          headline: "Alle 91 dagen kloppen: je kas zegt hetzelfde als het kasboek van je boekhouder.",
          balance: { appOpening: -892.86, fileOpening: 1018.32, openingDelta: 1911.18 },
          findings: [
            "De lade begint in dit kasboek op € 1.018,32 en in de app op −€ 892,86 — € 1.911,18 verschil op de openingsstand. Een kassaldo onder nul kan niet: er is meer uit de lade geboekt dan erin zat.",
          ],
        }),
        keuze: {}, onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    assert.match(html, /1\.911,18/, "het verschil op de openingsstand staat op het scherm");
    assert.match(html, /Een kassaldo onder nul kan niet/, "en waarom een negatieve lade onmogelijk is");
    // De dagen kloppen én de stand klopt niet. Allebei zichtbaar, tegelijk.
    assert.match(html, /Elke dag in dit kasboek komt overeen/);
  })();
});

test("[KASBOEK-NAAST-KAS] de bevindingen staan bóven de dagen, want ze gelden voor allemaal", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking({
          findings: ["In het kasboek staat € 20.974,15 aan contante uitgaven die de app niet kent. Zolang die ontbreken staat je kassaldo te hoog."],
        }),
        keuze: {}, onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    const bevinding = html.indexOf("20.974,15");
    const eersteDag = html.indexOf("famzfood");
    assert.ok(bevinding >= 0 && eersteDag >= 0, "beide staan op het scherm");
    assert.ok(bevinding < eersteDag, "de bevinding over het totaal staat vóór de eerste dagregel");
  })();
});

test("[KASBOEK-NAAST-KAS] zonder bevindingen verschijnt er geen leeg kader", () => {
  return (async () => {
    const { VergelijkingLijst } = await import("../../src/components/kas/KasboekVergelijken");
    const html = renderToStaticMarkup(
      React.createElement(VergelijkingLijst, {
        data: vergelijking({ findings: [] }),
        keuze: {}, onToggle: () => {}, onCategorie: () => {}, onBoek: () => {},
      }),
    );
    assert.doesNotMatch(html, /#F1F3F4/, "een kader zonder inhoud leest als een mislukte lezing");
  })();
});

// ─── [BEHEER] Het operatorscherm ─────────────────────────────────────────────────────────────

test("[BEHEER] het operatorscherm rendert de accounts en koppelingen die het krijgt", () => {
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        vastgehouden: null,
        overview: {
          users: [
            { id: "a", name: "Kiwi Food Market", email: "kiwi@x.nl", role: "zzp", createdAt: "2026-01-05", plan: "plus" },
            { id: "b", name: "B. Boekhouder", email: "b@k.nl", role: "boekhouder", createdAt: "2026-03-01", plan: "boekhouder" },
          ],
          links: [{ accountantName: "B. Boekhouder", clientName: "Kiwi Food Market", since: "2026-04-01" }],
          counts: { total: 2, owners: 1, accountants: 1, links: 1 },
        },
        systeem: { readable: true, allWell: true, attention: [], crons: [
          { job: "reminders", health: "ok", lastRunAt: "2026-09-04T07:00:00Z", hoursAgo: 2, note: null, needsAttention: false } as const,
        ] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: null,
      }),
    );
    assert.match(html, /Kiwi Food Market/);
    assert.match(html, /B\. Boekhouder/);
    assert.match(html, /koppelingen/);
    // Alleen-lezen belofte staat op het scherm zelf.
    assert.match(html, /Alleen-lezen/);
  })();
});

test("[WAAROM-VASTGEHOUDEN] de werklijst zet de duurste reden bovenaan en verzwijgt het onverklaarde deel niet", () => {
  // De twee dingen die dit paneel moet doen en die met een lege lijst allebei onzichtbaar zijn:
  // de reden BOVENAAN (dat is de eerstvolgende verbetering) en het onverklaarde restant APART
  // (dat is wat de ranglijst NIET dekt). Met [] als invoer klopt elke implementatie.
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        overview: { users: [], links: [], counts: { total: 0, owners: 0, accountants: 0, links: 0 } },
        systeem: { readable: true, allWell: true, attention: [], crons: [] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: null,
        vastgehouden: {
          total: 590, advanced: 240, held: 350, recorded: 54, unrecorded: 296,
          reasons: [
            {
              reason: "no_reliable_total",
              label: "Het totaalbedrag was niet betrouwbaar te lezen",
              count: 40, sharePct: 11.4,
              topSuppliers: [{ supplierName: "Dutch Sweets Company B.V.", count: 12 }],
            },
            { reason: "creditnota", label: "Het document is een creditnota — die gaan nooit vanzelf door", count: 14, sharePct: 4, topSuppliers: [] },
          ],
        },
      }),
    );
    const duurste = html.indexOf("Het totaalbedrag was niet betrouwbaar te lezen");
    const goedkoper = html.indexOf("Het document is een creditnota");
    assert.ok(duurste >= 0 && goedkoper >= 0, "beide redenen staan op het scherm");
    assert.ok(duurste < goedkoper, "de duurste reden staat bovenaan — daar begint de volgende verbetering");
    assert.match(html, /296 van de 350 zonder vastgelegde reden/,
      "het onverklaarde deel moet apart staan; opgeteld bij de lijst zou het lijken alsof het werk verklaard is");
    assert.match(html, /Dutch Sweets Company B\.V\./,
      "een reden die zich op één leverancier ophoopt is een sjabloon, en dat is de naam die het werk bespaart");
  })();
});

test("[LEESKWALITEIT] het paneel noemt de leverancier, niet alleen een percentage", () => {
  // De vondst waar dit paneel uit voortkomt: vijf creditnota's van één leverancier, in één zitting
  // rechtgezet. Als percentage was dat 0,9% en dus onzichtbaar; per leverancier is het één sjabloon
  // dat de lezer niet aankan. Het scherm moet die NAAM tonen, anders is er niets gewonnen.
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        vastgehouden: null,
        overview: { users: [], links: [], counts: { total: 0, owners: 0, accountants: 0, links: 0 } },
        systeem: { readable: true, allWell: true, attention: [], crons: [] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: {
          read: 586,
          amountCorrected: 5,
          ibanCorrected: 0,
          afterPayment: 0,
          troubleSuppliers: [{ supplierName: "Dutch Sweets Company B.V.", corrected: 5, read: 12 }],
          recent: [
            {
              invoiceId: "i1", supplierName: "Dutch Sweets Company B.V.",
              atMs: Date.UTC(2026, 7, 3, 9, 20), what: "bedrag" as const,
              amountBefore: "6.8100000000000005", amountAfter: "-6.8100000000000005",
              ibanBefore: null, ibanAfter: null, afterPayment: false,
            },
          ],
        },
      }),
    );
    // Op de KOP en op het aantal, niet alleen op de naam: die naam staat ook in de lijst met
    // losse correcties eronder, dus een match daarop bleef groen terwijl de groepering per
    // leverancier — het hele punt van dit paneel — was weggehaald. Dat is precies gemeten.
    assert.match(html, /Leveranciers met meer dan één verbetering/,
      "de groepering per leverancier is waarom dit paneel bestaat");
    assert.match(html, /Dutch Sweets Company/, "de leverancier hoort met naam op het scherm");
    assert.match(html, /<td[^>]*>12<\/td>/,
      "…met de noemer erbij: 5 van 12 is iets anders dan 5 van 400");
    // Precies de reeks die in productie op dit scherm stond. Het spoor bewaart hem — het scherm
    // hoort er een bedrag van te maken, want hier leest zo'n staart als een fout in de boeken.
    assert.match(html, /6,81/, "…met wat er stond naast wat het werd, als bedrag");
    assert.doesNotMatch(html, /6\.8100000000000005/,
      "de drijvende-komma-staart hoort niet op een scherm over geld");
    assert.match(html, /586/);
    assert.match(html, /niemand opmerkte/, "de eerlijkheidszin hoort erbij: dit is de fout die IEMAND zag");
  })();
});

test("[LEESKWALITEIT] niet kunnen kijken leest nooit als nul fouten", () => {
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        vastgehouden: null,
        overview: { users: [], links: [], counts: { total: 0, owners: 0, accountants: 0, links: 0 } },
        systeem: { readable: true, allWell: true, attention: [], crons: [] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: null,
      }),
    );
    assert.match(html, /niet te lezen/, "een mislukte meting moet zichzelf zo noemen");
    assert.doesNotMatch(html, /Gevonden foutpercentage/, "…en zeker geen percentage tonen");
  })();
});

test("[BEHEER] een leeg overzicht zegt dat, in plaats van een kale tabel", () => {
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        vastgehouden: null,
        overview: { users: [], links: [], counts: { total: 0, owners: 0, accountants: 0, links: 0 } },
        systeem: { readable: true, allWell: true, attention: [], crons: [] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: null,
      }),
    );
    assert.match(html, /Nog geen accounts/);
    assert.match(html, /Nog geen koppelingen/);
  })();
});

test("[BEHEER-GEZOND] een gestopte cron staat bovenaan, met hoe lang al", () => {
  // Een gestopte cron geeft geen foutmelding en verandert niets aan het scherm: geen herinneringen
  // meer, geen bankregels meer, geen betaaltermijn die op tijd wordt gemeld — terwijl de rest van
  // deze pagina er normaal uitziet. Dit blok is het enige dat zo'n storing kan tonen.
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    // `as const` zodat job en health de smalle types houden die CronStatus vraagt.
    const gestopt = {
      job: "reminders", health: "te-lang-stil", lastRunAt: "2026-08-31T07:00:00Z", hoursAgo: 96,
      note: "Deze taak hoort dagelijks te draaien.", needsAttention: true,
    } as const;
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        vastgehouden: null,
        overview: { users: [], links: [], counts: { total: 0, owners: 0, accountants: 0, links: 0 } },
        systeem: { readable: true, allWell: false, attention: [gestopt], crons: [
          gestopt,
          // "nog nooit" is een echt antwoord, en het antwoord op "is deze nieuwe cron ooit gedraaid?"
          { job: "payment-due", health: "nog-niet-langs", lastRunAt: null, hoursAgo: null, note: null, needsAttention: false } as const,
        ] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: null,
      }),
    );
    assert.match(html, /aandacht nodig/);
    assert.match(html, /reminders/);
    assert.match(html, /96 uur/, "hoe lang al, niet alleen dat");
    assert.match(html, /nog nooit/, "een taak die nooit draaide zegt dat, in plaats van een leeg vakje");
  })();
});

test("[NO-SILENT-EMPTY] een onleesbare hartslag is geen groene", () => {
  // Op de pagina die bestaat om te zeggen of de machine draait, mag "we konden niet kijken" nooit
  // als "alles goed" renderen — dat is precies de stille storing die dit blok moet tonen.
  return (async () => {
    const { BeheerScherm } = await import("../../src/app/dashboard/beheer/BeheerScherm");
    const html = renderToStaticMarkup(
      React.createElement(BeheerScherm, {
        vastgehouden: null,
        overview: { users: [], links: [], counts: { total: 0, owners: 0, accountants: 0, links: 0 } },
        systeem: { readable: false, allWell: false, attention: [], crons: [] },
        storingen: { readable: true, days: 7, groups: [], total: 0 },
        leeskwaliteit: null,
      }),
    );
    assert.match(html, /niet te lezen/);
    assert.doesNotMatch(html, /achtergrondtaken draaien</, "een onleesbare hartslag meldt geen gezonde machine");
  })();
});

