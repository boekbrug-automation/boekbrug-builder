// tests/render/periode-werkblad.test.tsx
// Run: node --experimental-test-module-mocks --import tsx --test tests/render/periode-werkblad.test.tsx
//
// [KANTOOR-PERIODE] What the attention block actually PUTS ON THE SCREEN. period-workspace.test.ts
// proves the projection; these prove the rendering — the half where a green card, a global count
// or a `.slice()` would appear, none of which a data test can see.

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
    usePathname: () => "/dashboard/clients/x/kwartaal",
    useParams: () => ({}),
    notFound: () => { throw new Error("notFound"); },
    redirect: (to: string) => { throw new Error("redirect " + to); },
  },
});

const CLIENT = "ac22189e-7052-4c48-b4ec-90947cf92ecc";

/** Visible text, with the folds marked so "reachable behind a disclosure" is assertable. */
function visible(html: string): string {
  return html
    .replace(/<details>/g, "\n[DICHT]\n")
    .replace(/<\/details>/g, "\n[/DICHT]\n")
    .replace(/<\/(p|div|h1|h2|li|section|summary|button|span|a)>/g, "$&\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&middot;/g, "·")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

async function render(sourcesOver: Record<string, unknown>) {
  const { buildWorkspace } = await import("../../src/lib/period-workspace");
  const { translator } = await import("../../src/lib/i18n/t");
  const { default: Aandachtspunten } = await import("../../src/components/kantoor/Aandachtspunten");
  const t = translator("nl");
  const views = buildWorkspace(
    {
      clientId: CLIENT,
      year: 2026,
      quarter: 3,
      readiness: { ok: true, value: { missing: [], risks: [] } },
      geld: { ok: true, value: { violations: [], drawer: [], drawerChecked: true } },
      nummering: { ok: true, value: { series: [], unreadable: [], countersRead: true } },
      vragen: { ok: true, value: [] },
      ...sourcesOver,
    } as never,
    t,
  );
  return renderToStaticMarkup(
    React.createElement(Aandachtspunten as never, { views, t, kwartaalLabel: "Q3 2026" }),
  );
}

const money = (kind: string, entityId: string, accountantMessage: string) => ({
  kind, entityId, message: `EIGENAAR ${accountantMessage}`, accountantMessage,
});

// ── 11 — clean is silence, not a green card ─────────────────────────────────

test("[KANTOOR-PERIODE] 11 · clean and fully read renders nothing whatsoever", async () => {
  const html = await render({});
  assert.equal(html, "", "a clean quarter still painted a block");
});

test("[KANTOOR-PERIODE] no green 'alles goed' anywhere, in any state", async () => {
  // A box the size of a warning, in the spot a warning will appear, is how a reader learns to skim
  // that spot. The healthy state is the absence of the block.
  for (const state of [
    {},
    { geld: { ok: true, value: { violations: [money("overpaid", "i1", "Factuur X staat op betaald voor te veel.")], drawer: [], drawerChecked: true } } },
  ]) {
    const text = visible(await render(state));
    for (const groen of ["alles goed", "in orde", "geen aandachtspunten", "niets te doen", "klaar"]) {
      assert.ok(!text.toLowerCase().includes(groen), `"${groen}" appeared: ${text}`);
    }
  }
});

// ── 15 — no global count, no percentage, no progress ────────────────────────

test("[KANTOOR-PERIODE] 15 · the heading never counts, and nothing on the block is a score", async () => {
  const html = await render({
    geld: {
      ok: true,
      value: {
        violations: [
          money("overpaid", "i1", "Factuur A staat op betaald voor te veel."),
          money("negative_paid", "i2", "Factuur B heeft een negatief betaald bedrag."),
          money("btw_arithmetic", "i3", "Factuur C telt niet op."),
        ],
        drawer: [], drawerChecked: true,
      },
    },
  });
  const text = visible(html);
  assert.ok(text.includes("Aandachtspunten"), text);
  // The heading is the word alone — never "3 aandachtspunten", never "3 van 5".
  assert.doesNotMatch(text, /\d+\s*aandachtspunt/i, text);
  assert.doesNotMatch(text, /\d+\s*van\s*\d+/i, text);
  assert.doesNotMatch(text, /%/, text);
  assert.doesNotMatch(text, /\bvoortgang\b|\bafgerond\b|\bopgelost\b/i, text);
});

// ── 5 · 7 — the spans are visible as spans ──────────────────────────────────

test("[KANTOOR-PERIODE] each span is named, and a money finding sits under the administration", async () => {
  const text = visible(await render({
    readiness: { ok: true, value: { missing: [{ title: "Bankafschrift ontbreekt" }], risks: [] } },
    geld: {
      ok: true,
      value: {
        violations: [money("transaction_overallocated", "tx1", "Bankregel van € 2.485,13 is over facturen verdeeld voor € 2.524,99 — € 39,86 meer dan er is overgemaakt.")],
        drawer: [money("drawer_negative", "2026-02-11", "Het kasboek staat op 11 februari 2026 € 40,00 onder nul.")],
        drawerChecked: true,
      },
    },
  }));
  const regels = text.split("\n");
  const na = (kop: string) => regels.slice(regels.indexOf(kop) + 1).find((r) => r.length > 2)!;

  assert.equal(na("Q3 2026"), "Bankafschrift ontbreekt");
  assert.match(na("Administratiebreed"), /€ 39,86/);
  assert.equal(na("Kas · huidig kwartaal"), "Het kasboek staat op 11 februari 2026 € 40,00 onder nul.");
  // The € 39,86 must not be readable as a Q3 fact: it sits under its own heading, below the
  // quarter's block, and the quarter's block does not contain it.
  assert.ok(regels.indexOf("Administratiebreed") > regels.indexOf("Q3 2026"));
  assert.ok(!na("Q3 2026").includes("39,86"));
});

// ── 6 — the numbering sentence is the panel's own ───────────────────────────

test("[KANTOOR-PERIODE] 6 · the numbering line matches the existing panel, word for word", async () => {
  const { NummeringUitslag } = await import("../../src/components/beveiliging/NummeringPaneel");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");
  const serie = {
    type: "creditnota", year: 2026, first: null, last: null, issued: 0,
    missing: [], burnedAtEnd: 1, duplicates: [],
  };

  const paneel = visible(renderToStaticMarkup(
    React.createElement(NummeringUitslag as never, {
      report: { series: [serie], unreadable: [], clean: false, unaccounted: null, countersRead: true },
      t, audience: "accountant",
    }),
  ));
  const werkblad = visible(await render({
    nummering: { ok: true, value: { series: [serie], unreadable: [], countersRead: true } },
  }));

  // The panel prints the label bold on its own line; the workspace joins them. Compare on words.
  const woorden = (s: string) => s.replace(/\s+/g, " ").trim();
  const paneelZin = woorden(paneel.split("\n").filter((r) => r.includes("toegekend")).join(" "));
  const werkbladZin = woorden(werkblad.split("\n").filter((r) => r.includes("toegekend")).join(" "));
  assert.ok(paneelZin.length > 20, paneel);
  assert.ok(werkbladZin.includes("Creditnota's 2026"), werkblad);
  assert.ok(
    werkbladZin.includes(paneelZin.replace("Creditnota's 2026 ", "")),
    `panel: ${paneelZin}\nworkspace: ${werkbladZin}`,
  );
});

// ── 13 · 14 — forty findings, folded, and every one reachable ───────────────

test("[KANTOOR-PERIODE] 13 · 14 · forty findings fold, and not one is lost", async () => {
  const violations = Array.from({ length: 40 }, (_, i) =>
    money(`soort-${i % 10}`, `e${i}`, `Bevinding nummer ${i} met een bedrag van € ${i},00.`),
  );
  const html = await render({ geld: { ok: true, value: { violations, drawer: [], drawerChecked: true } } });
  const text = visible(html);

  // Every one of the forty is in the document — folded or not.
  for (let i = 0; i < 40; i++) {
    assert.ok(text.includes(`Bevinding nummer ${i} `), `finding ${i} disappeared`);
  }
  // At rest — before any fold is opened — the wall is bounded.
  const atRest = text.split("[DICHT]")[0];
  const zichtbaar = atRest.split("\n").filter((r) => r.startsWith("Bevinding nummer")).length;
  assert.ok(zichtbaar <= 24, `${zichtbaar} findings at rest`);
  assert.ok(zichtbaar < 40, "nothing was folded");
  // And what is folded says how much it holds, in the count key the werkboard already uses.
  assert.match(text, /\+\d+ meer/, text.slice(0, 400));
});

// ── links: only the proven ones, and never a dead affordance ────────────────

test("[KANTOOR-PERIODE] an item with no exact target is text, not a broken link", async () => {
  const html = await render({
    geld: { ok: true, value: { violations: [money("duplicate_live_pair", "dup", "2034753 staat 2 keer in de administratie.")], drawer: [], drawerChecked: true } },
  });
  assert.ok(html.includes("2034753 staat 2 keer"), "the finding vanished");
  assert.ok(!html.includes("<a "), "a finding with no destination was rendered as a link");
});

test("[KANTOOR-PERIODE] a client-fixable gap opens Opvragen for this client-period", async () => {
  const html = await render({ readiness: { ok: true, value: { missing: [{ title: "Bon ontbreekt" }], risks: [] } } });
  assert.ok(html.includes(`href="/dashboard/accountant/opvragen?clientId=${CLIENT}&amp;q=3&amp;year=2026"`), html);
  // …and never the readiness item's own owner route.
  assert.ok(!html.includes("/dashboard/incoming"), html);
});

// ── the block writes nothing, ever ──────────────────────────────────────────

test("[KANTOOR-PERIODE] the block renders no form, no button and no write affordance", async () => {
  const html = await render({
    readiness: { ok: true, value: { missing: [{ title: "Bon ontbreekt" }], risks: [{ title: "Kasverschil" }] } },
    geld: { ok: true, value: { violations: [money("overpaid", "i1", "Factuur X.")], drawer: [], drawerChecked: false } },
  });
  for (const schrijf of ["<form", "<input", "<button", "<select", "type=\"checkbox\""]) {
    assert.ok(!html.includes(schrijf), `${schrijf} appeared on a read-only block`);
  }
  // The unchecked drawer is still on the screen, in its own span.
  assert.ok(visible(html).includes("Kas · huidig kwartaal"), visible(html));
});
