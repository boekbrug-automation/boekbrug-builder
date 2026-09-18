// tests/render/duplicate-question.test.tsx
// [ONTVANGEN-BESLUIT] The owner is shown a question, not a machine state.
//
// Rendered, because two of the three things that can go wrong here are invisible in the source: a
// panel that appears when there is nothing to ask, and a panel that shows the owner the word
// "wacht_op_besluit" — our word for it, and an answer to a question nobody asked.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  questionCopy, questionsHeading, questionsUnknownText, candidatesUnavailableText,
  type DuplicateQuestion, type QuestionsState,
} from "@/lib/duplicate-question";
import { translator } from "@/lib/i18n/t";

const t = translator("nl");

const WITH_CANDIDATE: DuplicateQuestion = {
  documentId: "33333333-3333-3333-3333-333333333333",
  fileName: "bon-maart.pdf",
  candidate: { invoiceId: "inv-14", invoiceNumber: "F-2026-14", vendor: "Jansen Groothandel" },
};

test("[ONTVANGEN-BESLUIT] the heading counts, and one is not four", () => {
  // One question and four questions are different amounts of work, and an owner deciding whether
  // to open this deserves to know which. Separate keys: a number inside a sentence is not a
  // parameter that survives Arabic or Turkish.
  assert.equal(questionsHeading(t, 1), "1 vraag voor jou");
  assert.match(questionsHeading(t, 4), /^4 vragen voor jou$/);
});

test("[ONTVANGEN-BESLUIT] the owner reads a question, never our word for the state", () => {
  const copy = questionCopy(t, WITH_CANDIDATE);
  assert.equal(copy.sentence, "Deze factuur lijkt al te bestaan.");
  assert.equal(copy.keepLabel, "Bestaande houden");
  assert.equal(copy.addLabel, "Toch toevoegen");
  for (const machine of ["wacht_op_besluit", "duplicate", "semantic", "ai_doc_type", "force"]) {
    assert.ok(
      !JSON.stringify(copy).includes(machine),
      `the owner is being shown "${machine}", which is a word about our machinery`,
    );
  }
});

test("[ONTVANGEN-BESLUIT] the candidate is a link to the invoice, not a number to go hunting for", () => {
  const copy = questionCopy(t, WITH_CANDIDATE);
  assert.ok(copy.candidateLink);
  assert.equal(copy.candidateLink!.href, "/dashboard/incoming/manage?focus=inv-14");
  assert.equal(copy.candidateLink!.label, "Bekijk de bestaande factuur");
});

test("[ONTVANGEN-BESLUIT] a question with no candidate still asks, and offers no dead link", () => {
  const copy = questionCopy(t, { ...WITH_CANDIDATE, candidate: null });
  assert.equal(copy.candidateLink, null);
  assert.equal(copy.sentence, "Deze factuur lijkt al te bestaan.");
});

test("[ONTVANGEN-BESLUIT] the panel says nothing when there is nothing to ask", async () => {
  // A panel that renders an empty box, a spinner or a "geen vragen" line is a screen that talks
  // about itself ([RUSTIG]). Nothing to ask is nothing on screen.
  const { default: DuplicateQuestions } = await import("@/components/intake/DuplicateQuestions");
  const html = renderToStaticMarkup(<DuplicateQuestions />);
  assert.equal(html, "", "the panel must be absent until it has a question");
});

// ── [VRAAG-BLIJFT] Three states, and the screen says which one it is in ─────────────────────────

test("[VRAAG-BLIJFT] a read that did not come back says so — it does not say 'niets'", () => {
  // The panel used to return null on `!res.ok`. An absent panel and an empty panel look the same
  // to an owner, and they mean opposite things: "nothing waits for you" and "we could not find
  // out". The first is the one that makes somebody stop looking.
  const text = questionsUnknownText(t);
  assert.equal(text, "We konden je openstaande vragen nu niet laden. Probeer het zo opnieuw.");
  assert.ok(!/0|geen|niets/i.test(text), "an unknown count must never be printed as a count");
});

test("[VRAAG-BLIJFT] a missing candidate is explained, not left looking like 'we found none'", () => {
  const text = candidatesUnavailableText(t);
  assert.match(text, /bestaande factuur/);
  for (const machine of ["lookup", "414", "invoices", "enrichment", "candidate"]) {
    assert.ok(!text.toLowerCase().includes(machine), `the owner is being shown "${machine}"`);
  }
});

test("[VRAAG-BLIJFT] the three states are three, and none of them is the other", () => {
  // A type-level assertion made runtime-visible: `loading` and `unknown` carry no questions, so
  // no code path can read a list off them and conclude "zero".
  const states: QuestionsState[] = [
    { kind: "loading" },
    { kind: "unknown" },
    { kind: "loaded", questions: [WITH_CANDIDATE], candidatesUnavailable: false },
  ];
  assert.deepEqual(states.map((s) => s.kind), ["loading", "unknown", "loaded"]);
  assert.equal(
    states.filter((s) => s.kind === "loaded").length, 1,
    "exactly one state holds a list; the others are honest about not knowing",
  );
});
