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

import { questionCopy, questionsHeading, type DuplicateQuestion } from "@/lib/duplicate-question";
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
