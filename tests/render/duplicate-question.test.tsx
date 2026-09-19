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
  // [ONTVANGEN-WAAR] Was "Toch toevoegen". That names a stubborn click; this names the assertion
  // the owner is actually making, which is what justifies a second cost and a second voorbelasting.
  // The stored decision is still `add_anyway` — see the boundary test further down.
  assert.equal(copy.addLabel, "Dit is echt een andere factuur");
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
    // With or without props: the upload screen hands it the fresh handoffs to watch for, Inkomend
    // has none to hand. Matching `<DuplicateQuestions />` exactly would make adding a prop look
    // like removing the panel.
    assert.match(src, /<DuplicateQuestions[\s/>]/, `[ONTVANGEN-WAAR] ${name} imports it but never renders it`);
  }

  // No upload-specific duplicate machinery crept in alongside it. Read the CODE: the mount is
  // explained in a comment above it, and a comment naming the endpoint is not a call to it.
  const uploadCode = upload.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const second of ["duplicate-questions", "duplicate-decision", "wacht_op_besluit", "keep_existing", "add_anyway"]) {
    assert.ok(!uploadCode.includes(second),
      `[ONTVANGEN-WAAR] the upload screen is talking to the decision lifecycle directly ("${second}") instead of through the shared panel`);
  }

  // And what it DOES hand over is the thing that makes discovery possible: the documentIds of the
  // handoffs that just happened here. Without them the panel cannot tell a question it is waiting
  // for from one that belongs to yesterday.
  assert.match(upload, /awaitDocumentIds=\{received\.map\(/,
    "[ONTVANGEN-WAAR] the panel is mounted but is not told what was just received");
});

// ── [ONTVANGEN-WAAR] The question that did not exist yet when the panel first looked ───────────
//
// The lifecycle that was broken, in full:
//
//   /dashboard/upload opens   → the panel asks once and is handed []
//   the owner uploads         → "Ontvangen ✓ — BoekBrug verwerkt dit verder."
//   the reader runs           → it finds a semantic duplicate
//   the document reaches        wacht_op_besluit
//   the panel                 → had already loaded [] and never asked again
//
// Driven here through the REAL modules the runtime uses — the route's row shape, buildQuestions,
// the stop rule, and the shared panel rendering the result. What this cannot execute is the React
// effect that ties them together: there is no DOM test environment in this repo, so the wiring
// itself is asserted on the source at the bottom of this file, and only the wiring.

test("[ONTVANGEN-WAAR] a question created AFTER the first look is discovered, and then we stop", async () => {
  const { buildQuestions } = await import("@/lib/duplicate-questions-read");
  const { keepRechecking } = await import("@/lib/duplicate-recheck");

  // The document the owner just handed over. It is in wacht_op_LEZEN — not a question yet.
  const awaited = ["doc-fresh"];

  // Round 0 — the panel's first load, at mount, before the upload. The server has nothing.
  const first = buildQuestions([], { byId: new Map(), unavailable: false });
  const firstIds = first.map((q) => q.documentId);
  // `assert.equal` on the length, not `deepEqual` on the array: node's types declare deepEqual as
  // an `asserts actual is T`, so comparing against `[]` narrows `first` to `never[]` and every
  // read of it after that line stops type-checking.
  assert.equal(first.length, 0, "there is genuinely nothing to ask yet");
  assert.equal(
    keepRechecking({ attempt: 1, awaited, answered: firstIds }), true,
    "…so the window stays open — this is the exact moment the old panel gave up forever",
  );

  // Round 1 — the background reader has now held the document for the owner. Same route shape.
  const rows = [{ id: "doc-fresh", file_name: "bon.pdf", duplicate_candidate_invoice_id: "inv-14" }];
  const found = {
    byId: new Map([["inv-14", {
      id: "inv-14", invoice_number: "F-2026-14", client_name: "Jansen Groothandel",
      total_inc_btw: 500, amount_paid: 200, status: "received",
      accountant_status: null, invoice_type: "factuur",
    }]]),
    unavailable: false,
  };
  const now = buildQuestions(rows, found);
  assert.equal(now.length, 1, "the question exists now");
  assert.equal(now[0].documentId, "doc-fresh");

  // …and the window closes on success rather than running to its end.
  assert.equal(keepRechecking({ attempt: 2, awaited, answered: now.map((q) => q.documentId) }), false,
    "found what we were waiting for — stop, do not keep asking");

  // The SAME shared panel renders it, with the money context beside it.
  const { default: DuplicateQuestions } = await import("@/components/intake/DuplicateQuestions");
  const html = renderToStaticMarkup(
    <DuplicateQuestions awaitDocumentIds={awaited} />,
  );
  assert.equal(html, "", "still nothing while the first load is in flight — no flash of an empty box");

  // Rendering the loaded state is what the panel does with that list; prove the copy it produces.
  const copy = questionCopy(t, now[0]);
  assert.deepEqual(copy.contextLines, ["€ 500,00", "€ 200,00 betaald · € 300,00 open"]);
  assert.equal(copy.keepLabel, "Bestaande houden");
  assert.equal(copy.addLabel, "Dit is echt een andere factuur");
});

test("[ONTVANGEN-WAAR] the panel asks again, and it is bounded — not a poller", () => {
  const src = readFileSync("src/components/intake/DuplicateQuestions.tsx", "utf8");
  const bare = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  // The wiring: the bounded schedule drives the same `load`, and nothing else does.
  assert.match(bare, /nextRecheckDelayMs\(\{ attempt: 0, awaited, answered: \[\] \}\)/,
    "the first look must come from the module, not from a literal delay in the component");
  assert.match(bare, /nextRecheckDelayMs\(\{ attempt, awaited, answered \}\)/,
    "and so must every look after it, or the stop rule is decorative");
  assert.match(bare, /if \(awaited\.length === 0\) return/,
    "a screen with no fresh handoff must arm nothing at all");
  assert.match(bare, /return \(\) => \{ cancelled = true; if \(timer\) clearTimeout\(timer\); \}/,
    "unmounting must stop the window");

  // The engines this slice refuses. setTimeout is allowed and setInterval is not, and that IS the
  // distinction: one runs a finite number of times, the other runs until the tab closes.
  for (const engine of ["setInterval", "EventSource", "WebSocket", "requestAnimationFrame"]) {
    assert.ok(!bare.includes(engine), `[ONTVANGEN-WAAR] ${engine} in the panel — that is job tracking`);
  }
});

test("[ONTVANGEN-WAAR] the durable endpoint is still the only source, and the decision is unrenamed", () => {
  const src = readFileSync("src/components/intake/DuplicateQuestions.tsx", "utf8");
  const bare = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  // One question source. A second endpoint is how two screens start disagreeing about what the
  // owner already answered.
  const reads = bare.match(/fetch\("\/api\/[^"]*"/g) ?? [];
  assert.deepEqual(reads, ['fetch("/api/documents/duplicate-questions"'],
    "exactly one read, and it is the durable one");
  assert.match(bare, /fetch\(`\/api\/documents\/\$\{documentId\}\/duplicate-decision`/,
    "answering still goes through the existing decision door");

  // [ONTVANGEN-WAAR] §E — the OWNER-facing word changed; the durable machine decision did not.
  assert.match(bare, /"keep_existing" \| "add_anyway"/, "the stored decisions are untouched");
  assert.match(bare, /answer\(q\.documentId, "add_anyway"\)/,
    "the renamed button still posts add_anyway — the migration and the backend know that word");
});

test("[ONTVANGEN-WAAR] the top batch line does not call a received batch processed", () => {
  // This line sat two paragraphs above a summary that already had it right: it said "Klaar — 1
  // bestand(en) verwerkt" the moment the queue emptied, while the summary underneath said the file
  // had only been received. The screen contradicted itself, and the confident half was the wrong one.
  const src = readFileSync("src/app/dashboard/upload/UploadClient.tsx", "utf8");
  assert.match(
    src,
    /busyCount > 0[\s\S]{0,200}received\.length > 0[\s\S]{0,80}t\('up\.nOntvangen'[\s\S]{0,120}t\('up\.klaarVerwerkt'/,
    "three states — busy, received, finished — and 'verwerkt' is reachable only by the last",
  );
  // The order matters as much as the branch: `received` is tested BEFORE the finished line, or a
  // batch holding both falls straight through into "verwerkt" again.
  assert.ok(
    src.indexOf("t('up.nOntvangen', { n: received.length })") < src.indexOf("t('up.klaarVerwerkt'"),
    "the received branch must be reached first",
  );
  assert.equal(t("up.nOntvangen", { n: 2 }), "2 ontvangen — we verwerken ze");
  for (const lie of ["verwerkt", "Klaar"]) {
    assert.ok(!t("up.nOntvangen", { n: 1 }).includes(lie), `the batch line claims "${lie}"`);
  }
});

test("[ONTVANGEN-WAAR] the shared intake button ends a receive-first handoff as Ontvangen", () => {
  // The progress phase stopped saying "Wordt gelezen", but the FINAL state still said "Klaar".
  // "You handed it to BoekBrug, your work is done" and "the AI has finished" are different
  // statements, and only the first one is provable at that moment.
  const btn = readFileSync("src/components/intake/IntakeButton.tsx", "utf8");
  const bare = btn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  assert.match(bare, /const isReceived = data\.received === true/,
    "the receive-first fact is read from the field the route actually promises");
  assert.match(bare, /patchRow\(rowId, \{ phase: isReceived \? 'received' : 'done' \}\)/,
    "a received handoff may not end on the same phase as a finished read");
  assert.match(bare, /r\.phase === 'received' \? t\('int\.voortgang\.ontvangen'\)/);
  assert.equal(t("int.voortgang.ontvangen"), "Ontvangen ✓");
  assert.notEqual(t("int.voortgang.ontvangen"), t("int.voortgang.klaar"));

  // The bar fills (the handoff IS over) but stays primary — green is for a finished read only.
  const progress = readFileSync("src/components/intake/IntakeProgress.tsx", "utf8");
  assert.match(progress, /const full = [^\n]*r\.phase === 'received'/, "a received row is not left hanging");
  assert.match(progress, /const fill = [^\n]*r\.phase === 'done' \? M3\.success/,
    "…and only 'done' earns the green");
  assert.doesNotMatch(progress, /received' \? M3\.success/);

  // No live tracking was added here either to make the row eventually turn green.
  for (const engine of ["setInterval", "EventSource", "WebSocket"]) {
    assert.ok(!bare.includes(engine), `[ONTVANGEN-WAAR] ${engine} in the intake button`);
  }
});
