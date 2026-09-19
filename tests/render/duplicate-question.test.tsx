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
import { readFileSync } from "node:fs";

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

// ── [ONTVANGEN-WAAR] The upload screen tells the same truth the backend tells ──────────────────
//
// Two separate claims, and they fail in opposite directions:
//
//   1. a receive-first answer is DURABLE, not FINISHED. The upload page called every 200 'done' —
//      green edge, ✓, counted under "verwerkt" — while the reader had not run yet. Three
//      statements nobody could back at that moment.
//   2. the question that the reader may raise afterwards lived only on Inkomend. The owner who
//      stayed on the upload screen, where he had just been told "je kunt verder", had no way to
//      see that we needed him after all.

test("[ONTVANGEN-WAAR] a received answer is its own state — never counted as processed", async () => {
  const src = readFileSync("src/app/dashboard/upload/UploadClient.tsx", "utf8");

  // The branch exists and is taken BEFORE the generic ok-branch, or every receive-first answer
  // falls through into 'done' exactly as it used to.
  const receivedBranch = src.indexOf("res.ok && data?.received === true");
  const genericOk = src.indexOf("} else if (res.ok) {");
  assert.ok(receivedBranch > -1, "the receive-first branch is gone — every 200 reads as processed again");
  assert.ok(genericOk > receivedBranch, "the generic ok-branch must come SECOND, or it swallows the received case");

  // 'received' is a status of its own, and `done` is what every tally is built from.
  assert.match(src, /type Status =[^\n]*'received'/, "received must be a first-class status");
  assert.match(src, /const done = items\.filter\(\(i\) => i\.status === 'done'\)/,
    "the tallies must key off 'done' alone, so a received row cannot leak into countBy/autoBooked/toVerify");
  assert.match(src, /const received = items\.filter\(\(i\) => i\.status === 'received'\)/);

  // No green, and no ✓ heading over work that is still ours.
  assert.match(src, /it\.status === 'received' \? M3\.primary/,
    "a received row may not wear the green of a finished read");
  assert.match(src, /received\.length > 0 \? t\('up\.ontvangenKop'\)[\s\S]{0,60}t\('up\.klaarVink'\)/,
    "'Klaar ✓' must not stand above files we are still processing");

  // And emphatically no live job tracking was added to make the row turn green later.
  //
  // Read the CODE, not the prose. The first version of this loop searched the raw file for "poll"
  // and went red on the comment above the Status type, which says there is deliberately NO polling.
  // A gate that cannot tell a promise from its opposite is the trap AGENTS.md describes, in a file
  // that happens not to use code().
  const bare = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const engine of ["setInterval", "EventSource", "WebSocket", "poll"]) {
    assert.ok(!bare.includes(engine),
      `[ONTVANGEN-WAAR] ${engine} appeared in the CODE — this slice is truthfulness, not job tracking`);
  }
});

test("[ONTVANGEN-WAAR] the owner-facing copy says received, and not processed", () => {
  assert.equal(t("up.ontvangen"), "Ontvangen ✓ — BoekBrug verwerkt dit verder.");
  assert.equal(t("up.ontvangenKop"), "Ontvangen ✓ — we verwerken ze");
  // The words this row must NOT claim. "verwerkt dit verder" is a promise about what comes next,
  // so the bare participle is what is checked — not the substring inside that sentence.
  for (const lie of ["Klaar", "gelezen", "geboekt", "geverifieerd"]) {
    assert.ok(!t("up.ontvangen").includes(lie), `the received row claims "${lie}", which nobody knows yet`);
  }

  // [ONTVANGEN-WAAR] The upload PROGRESS phase said "Wordt gelezen — dit kan even duren" from the
  // moment the last byte left. Under receive-first the server is securing the handoff there; the
  // read comes after, in the background. The old sentence promised the very wait this removed.
  assert.equal(t("int.voortgang.bewaren"), "Bewaren…");
  const btn = readFileSync("src/components/intake/IntakeButton.tsx", "utf8");
  assert.match(btn, /r\.phase === 'reading' \? t\('int\.voortgang\.bewaren'\)/);
  assert.ok(!btn.includes("int.voortgang.lezen"), "the retired phrase is still wired up");
});

test("[ONTVANGEN-WAAR] the SAME question component is mounted on the upload screen", () => {
  // One question, one endpoint, one decision state. A second implementation is how two screens
  // start disagreeing about what the owner already answered.
  const upload = readFileSync("src/app/dashboard/upload/UploadClient.tsx", "utf8");
  const incoming = readFileSync("src/app/dashboard/incoming/IncomingInvoicesClient.tsx", "utf8");
  for (const [name, src] of [["upload", upload], ["incoming", incoming]] as const) {
    assert.match(src, /from ['"]@\/components\/intake\/DuplicateQuestions['"]/,
      `[ONTVANGEN-WAAR] ${name} does not import the shared question panel`);
    assert.match(src, /<DuplicateQuestions \/>/, `[ONTVANGEN-WAAR] ${name} imports it but never renders it`);
  }
  // No upload-specific duplicate machinery crept in alongside it.
  for (const second of ["duplicate-questions", "duplicate-decision", "wacht_op_besluit"]) {
    assert.ok(!upload.includes(second),
      `[ONTVANGEN-WAAR] the upload screen is talking to the decision lifecycle directly ("${second}") instead of through the shared panel`);
  }
});
