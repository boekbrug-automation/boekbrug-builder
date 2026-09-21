// tests/render/kwartaal-factuur-tabs.test.tsx
// Run: node --experimental-test-module-mocks --import tsx --test tests/render/kwartaal-factuur-tabs.test.tsx
//
// [KWT-TABS] What the tab strip above the accountant's quarter invoices actually PUTS IN THE DOM.
// period-invoice-tabs.test.ts proves the rules — which view a row is in, which view a key press
// means, what a failed read may not claim. These prove the half a data test cannot see: the ARIA
// wiring that turns three buttons into a tab set, the number that must not be drawn, and the
// one-line strip that keeps a phone header from becoming a second wall.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

import FactuurTabs from "../../src/components/kantoor/FactuurTabs";
import { VoorstelFormulier } from "../../src/app/dashboard/clients/[id]/VoorstelFormulier";
import { translator } from "../../src/lib/i18n/t";
import { INVOICE_TAB_KEYS, invoiceTabId, invoiceTabPanelId } from "../../src/lib/period-invoice-tabs";

const KOP = "kwt-facturen-kop";
const TELLING = { debiteuren: 12, crediteuren: 8, voldaan: 31 };

function render(over: Partial<React.ComponentProps<typeof FactuurTabs>> = {}) {
  return renderToStaticMarkup(
    React.createElement(FactuurTabs, {
      active: "debiteuren",
      counts: TELLING,
      onSelect: () => true,
      t: translator("nl"),
      dir: "ltr",
      labelledBy: KOP,
      ...over,
    }),
  );
}

/** Every `<button role="tab" …>` opening tag, in document order. */
function tabs(html: string): string[] {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
}

/** Visible text of the strip, one tab per line. */
function labels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

// ─── A tab set, not three buttons that look like one ──────────────────────────────────────────

test("[KWT-TABS] the strip is a real tablist with three real tabs", () => {
  const html = render();
  assert.match(html, /role="tablist"/, "three buttons in a row are not a tab set");
  assert.equal(tabs(html).length, 3, "a view is missing from the strip");
  // Named by the heading it belongs to, so a screen reader says what these three tabs are FOR.
  assert.match(html, new RegExp(`role="tablist"[^>]*aria-labelledby="${KOP}"`));
  assert.match(html, /aria-orientation="horizontal"/);
});

test("[KWT-TABS] exactly one tab is selected, and it is the one asked for", () => {
  for (const key of INVOICE_TAB_KEYS) {
    const html = render({ active: key });
    const geselecteerd = tabs(html).filter((b) => b.includes('aria-selected="true"'));
    assert.equal(geselecteerd.length, 1, `${key}: ${geselecteerd.length} tabs claim to be selected`);
    assert.ok(geselecteerd[0].includes(`id="${invoiceTabId(key)}"`), `${key} is not the selected tab`);
    // The other two say so out loud. A missing aria-selected reads as "not selected" to some
    // screen readers and as nothing at all to others.
    assert.equal(tabs(html).filter((b) => b.includes('aria-selected="false"')).length, 2);
  }
});

test("[KWT-TABS] every tab points at its own panel, by an id the screen also spells", () => {
  const html = render();
  for (const key of INVOICE_TAB_KEYS) {
    assert.match(html, new RegExp(`id="${invoiceTabId(key)}"`), `${key} has no id to be labelled by`);
    assert.match(
      html,
      new RegExp(`aria-controls="${invoiceTabPanelId(key)}"`),
      `${key} controls no panel — the pairing a screen reader needs is gone`,
    );
  }
  // The screen writes the other half. If these two ever stop agreeing, the association is silently
  // broken and nothing on screen changes — which is why both sides come from one module.
  const paneel = readPage();
  assert.match(paneel, /id=\{invoiceTabPanelId\(actieveTab\)\}/, "the panel no longer carries the shared id");
  assert.match(paneel, /aria-labelledby=\{invoiceTabId\(actieveTab\)\}/, "the panel is no longer named by its tab");
});

test("[KWT-TABS] the strip is one tab stop, with the arrows moving inside it", () => {
  // Roving tabindex. Without it the accountant presses Tab three times to get PAST the strip on
  // every screen, which is the cost of three ordinary buttons dressed as tabs.
  for (const key of INVOICE_TAB_KEYS) {
    const html = render({ active: key });
    assert.equal(tabs(html).filter((b) => /tabindex="0"/i.test(b)).length, 1, `${key}: not one stop`);
    assert.equal(tabs(html).filter((b) => /tabindex="-1"/i.test(b)).length, 2, `${key}: extra stops`);
  }
});

// ─── A count is a claim ───────────────────────────────────────────────────────────────────────

test("[KWT-TABS] the counts are drawn beside the view they belong to", () => {
  const html = render();
  assert.deepEqual(labels(html), ["Debiteuren 12", "Crediteuren 8", "Voldaan 31"]);
});

test("[KWT-TABS] a read that did not answer draws no number, not a zero", () => {
  // The defect this forbids: a failed invoice read rendering «Crediteuren 0» — a statement that
  // this client booked no purchase invoices this quarter, made by a dead socket.
  const html = render({ counts: null });
  assert.deepEqual(labels(html), ["Debiteuren", "Crediteuren", "Voldaan"]);
  assert.doesNotMatch(html, />\s*0\s*</, "a zero appeared where nothing was known");
  // …and a quarter that genuinely is empty still says zero, because that one is true.
  const leeg = render({ counts: { debiteuren: 0, crediteuren: 0, voldaan: 0 } });
  assert.deepEqual(labels(leeg), ["Debiteuren 0", "Crediteuren 0", "Voldaan 0"]);
});

// ─── The screen's language, not the component's ───────────────────────────────────────────────

test("[KWT-TABS] the strip holds no language of its own", () => {
  const ar = render({ t: translator("ar"), dir: "rtl" });
  assert.deepEqual(labels(ar), ["الذمم المدينة 12", "الذمم الدائنة 8", "مسدَّدة 31"]);
  for (const nl of ["Debiteuren", "Crediteuren", "Voldaan"])
    assert.ok(!ar.includes(nl), `«${nl}» survived into the Arabic strip`);

  const en = render({ t: translator("en") });
  assert.deepEqual(labels(en), ["Receivables 12", "Payables 8", "Settled 31"]);

  // The count itself is a Latin numeral in every language — the accountant reconciles these
  // against a Dutch bank statement, so the digits have to read the same in all three.
  assert.ok(ar.includes("12") && ar.includes("31"));
});

// ─── Mobile: one line, at every width ─────────────────────────────────────────────────────────

test("[KWT-TABS] no label breaks into a second line, and no tab is dropped to fit", () => {
  // At 320px three Arabic labels with counts do not fit. A strip that wraps turns the header into
  // exactly the vertical wall this change exists to remove, and a strip that hides the third tab
  // puts a whole view out of reach. It scrolls sideways instead.
  const html = render({ t: translator("ar"), dir: "rtl", counts: { debiteuren: 1284, crediteuren: 967, voldaan: 3311 } });
  assert.equal(tabs(html).length, 3, "a view was dropped to make the strip fit");
  assert.match(html, /role="tablist"[^>]*style="[^"]*overflow-x:auto/, "the strip cannot scroll sideways");
  for (const [i, b] of tabs(html).entries()) {
    assert.match(b, /white-space:nowrap/, `tab ${i} may wrap onto a second line`);
    assert.match(b, /flex-shrink:0/, `tab ${i} may be squeezed until its label wraps`);
  }
});

// ─── Activation is a request, and focus follows the answer ────────────────────────────────────

test("[KWT-TABS] the strip asks to activate and obeys the answer, for mouse and key alike", () => {
  // A refusal that still moved the keyboard would leave aria-selected on one tab and the focus
  // ring on another. renderToStaticMarkup runs no handlers, so the wiring is read at the source —
  // the decision itself is a pure function with its own exhaustive test.
  const strip = readFile("src/components/kantoor/FactuurTabs.tsx");
  assert.match(strip, /onSelect: \(key: InvoiceTabKey\) => boolean \| Promise<boolean>/,
    "activation stopped reporting whether it happened");
  assert.match(strip, /const geaccepteerd = await onSelect\(key\)/,
    "the strip no longer waits for the answer — an async refusal would move focus anyway");
  assert.match(strip, /tabRefs\.current\[invoiceTabFocusAfter\(key, active, geaccepteerd\)\]\?\.focus\(\)/,
    "focus is placed without consulting the answer");
  // One path for both. A separate onClick that called onSelect directly is how the mouse and the
  // keyboard start disagreeing about which tab is current.
  assert.match(strip, /onClick=\{\(\) => \{ void ga\(section\.key\) \}\}/, "the mouse bypasses the shared path");
  assert.match(strip, /onKeyDown=\{onKey\}/);
  assert.doesNotMatch(strip, /onClick=\{\(\) => onSelect\(/, "the mouse activates without obeying the answer");
});

// ─── An unsent proposal outlives the row it was typed in ──────────────────────────────────────

test("[KWT-TABS] the proposal form renders the draft it is handed, so a remount shows the typing", () => {
  // This is the whole of fix 3 in one render. The row unmounts whenever another view is shown —
  // by a click, by an arrow key, by Back, by Forward, by a ?focus= deep link resolving elsewhere —
  // and none of those but the first can be intercepted. Because the screen owns the draft, the
  // form that comes back is handed what was typed, exactly as below.
  const concept = {
    ex: "123,45", btw: "25,92", inc: "149,37",
    datum: "2026-07-14", vervalt: "2026-08-14",
    reden: "Het bedrag hoort bij de vorige maand.",
  };
  const html = renderToStaticMarkup(
    React.createElement(VoorstelFormulier, {
      clientId: "c-1",
      invoice: { id: "i1", total_ex_btw: 1, btw_amount: 1, total_inc_btw: 1, invoice_date: "2026-01-01", due_date: "2026-02-01" },
      t: translator("nl") as never,
      DateField: ({ value }: { value: string }) => React.createElement("input", { readOnly: true, value }),
      concept,
      onConcept: () => {},
      onClose: () => {},
      onSent: () => {},
      onError: () => {},
    } as never),
  );
  for (const [veld, waarde] of Object.entries(concept))
    assert.ok(html.includes(waarde), `${veld} is not on the screen — the draft was rendered from the invoice, not from what was typed`);
  // …and the invoice's own numbers are NOT what is shown: a remount that re-prefilled from the
  // row would look perfectly fine and would have silently thrown the correction away.
  assert.doesNotMatch(html, /value="1"/, "the form fell back to the invoice and lost the typing");

  // The form may not keep a second copy of any of it, or there would be two answers to what the
  // accountant typed and the one that survives a remount would be the empty one.
  const form = readFile("src/app/dashboard/clients/[id]/VoorstelFormulier.tsx");
  for (const veld of ["ex", "btw", "inc", "datum", "vervalt", "reden"])
    assert.doesNotMatch(form, new RegExp(`useState\\(.*\\b${veld}\\b`, "i"), `${veld} went back into the form's own state`);
  assert.match(form, /const \{ ex, btw, inc, datum, vervalt, reden \} = concept/, "the form stopped reading the handed-in draft");
});

// ─── The screen around it ─────────────────────────────────────────────────────────────────────

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

function readPage(): string {
  return readFile("src/app/dashboard/clients/[id]/kwartaal/page.tsx");
}

test("[KWT-TABS] the quarter screen renders one panel, and Batch 3 stays outside it", () => {
  const page = readPage();
  // One view at rest. The three stacked lists are gone: nothing maps over all the sections any
  // more, and the panel is handed the rows of the selected one.
  assert.match(page, /const zichtbareRijen = invoiceTabRows\(shown, actieveTab\)/);
  assert.match(page, /zichtbareRijen\.map\(invoice => \{/, "the panel no longer renders one view's rows");
  assert.doesNotMatch(page, /SECTIONS\.map\(/, "all three lists are stacked again");

  // …and the work, the figures and the actions are ABOVE the card the tabs live in. A tab is for
  // arranging siblings; a finding the accountant has to click to discover is a finding buried.
  const paneel = page.indexOf('role="tabpanel"');
  assert.ok(paneel > 0, "there is no tabpanel — this gate is measuring nothing");
  for (const boven of ["<Aandachtspunten", "bh.kwt.omzet", "bh.kwt.kosten", "bh.kwt.btwSaldo", "bh.kwt.documenten", "bh.kwt.pakketDownload"]) {
    const at = page.indexOf(boven);
    assert.ok(at > 0, `${boven} is gone from the quarter screen`);
    assert.ok(at < paneel, `${boven} moved inside the tab panel — Batch 3 put it in the open`);
  }
});
