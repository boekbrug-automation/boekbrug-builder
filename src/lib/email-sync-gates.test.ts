// [EMAIL-SYNC] Pure node test — run: npx tsx --test src/lib/email-sync-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// The email sync is the door most invoices actually arrive through, and it is the one door with
// nobody standing at it. Its gates live inside one very large async function that reaches Gmail,
// Outlook, Storage, the AI and four tables, so no unit test calls them — which is why two of them
// had been quietly wrong for as long as they had existed.
//
// Both were invisible for the same reason: they fail by returning a normal-looking value.
//
//   · The byte-hash gate read `const { data: existingByHash } = …`. supabase-js answers a failed
//     read with { data: null, error }, and null here means "this file is new". A read that could
//     not run therefore imported the identical file again — same cost, same voorbelasting, twice —
//     with nothing saying so. The manual doors have a human who at least sees a confusing message;
//     here there is no one.
//
//   · When the (user_id, content_hash) unique index then refused the second document row, the
//     generic error branch deleted the storage object, set document_id and pdf_url to null, and
//     saved the invoice anyway. The closing package resolves the evidence PDF through
//     invoices.document_id, so that is a cost in the books with no paper behind it — the state
//     /api/intake calls unacceptable in its own [R1] note, produced by the door next to it.
//
// A source-level gate is the honest instrument for code a unit test cannot reach. It does not
// prove the sync behaves; it proves the specific lines that make it honest are still there, so a
// refactor cannot silently undo them the way one already undid the [IBAN-CHECK-HONEST] throw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SYNC = readFileSync("src/lib/email-integration.ts", "utf8");

/** The source of one `const { … } = await supabase.from('X')…` read, by the variable it binds. */
function readBinding(varName: string): string {
  const at = SYNC.indexOf(`const { data: ${varName}`);
  assert.notEqual(at, -1, `the read binding ${varName} must still exist — this gate is worthless otherwise`);
  return SYNC.slice(at, at + 700);
}

test("[DEDUP-READ-HONEST] the sync's two hard dedup gates cannot mistake a failed read for 'new'", () => {
  for (const { name, flagged } of [
    { name: "existingByHash", flagged: "hashErr" },
    { name: "existingByMessage", flagged: "messageErr" },
  ]) {
    const src = readBinding(name);
    assert.match(
      src, new RegExp(`error:\\s*${flagged}`),
      `the ${name} gate must destructure its error — without it "we could not look" reads as "not a duplicate"`,
    );
    assert.match(
      src, new RegExp(`if\\s*\\(${flagged}\\)[\\s\\S]{0,400}?dedupCheckFailed\\s*=\\s*true`),
      `${name}'s error must actually set dedupCheckFailed — destructuring it and dropping it is the same silence`,
    );
  }
});

test("[DEDUP-READ-HONEST] the flag is declared before the first gate that can set it", () => {
  // It used to sit halfway down, beside the semantic probes, so the two gates that run FIRST had no
  // way to report a failed read even in principle. Order is the whole fix here.
  const decl = SYNC.indexOf("let dedupCheckFailed = false");
  const firstGate = SYNC.indexOf("const { data: existingByHash");
  assert.notEqual(decl, -1, "dedupCheckFailed must still be declared");
  assert.ok(decl < firstGate, "dedupCheckFailed is declared AFTER the byte-hash gate — that gate cannot report");
});

test("[DEDUP-READ-HONEST] a failed check reaches the card instead of dying in a variable", () => {
  assert.match(
    SYNC, /if \(dedupCheckFailed\)[\s\S]{0,300}?markDuplicateCheckUnavailable/,
    "dedupCheckFailed must be turned into the needs-review marker the queue prints",
  );
});

test("[EVIDENCE-KEEP] a hash collision links to the stored document instead of booking without paper", () => {
  const at = SYNC.indexOf("const isHashCollision");
  assert.notEqual(at, -1, "the sync must still distinguish a duplicate-key refusal from a real failure");
  const block = SYNC.slice(at, at + 1600);

  assert.match(block, /23505/, "the collision test must key on the SQLSTATE, not only on a message");
  assert.match(block, /content_hash/, "it must resolve the document that already holds these bytes");
  assert.match(
    block, /documentId = recovered\.id/,
    "the invoice must point at the document that exists — an invoice with no document_id has unreachable evidence",
  );

  // Ordering is the substance: the generic branch nulls documentId, so it must not run first.
  const recoverAt = block.indexOf("if (recovered)");
  const genericAt = block.indexOf("} else if (docErr || !doc)");
  assert.ok(recoverAt !== -1 && genericAt !== -1, "both branches must be present");
  assert.ok(
    recoverAt < genericAt,
    "the recovery branch must come BEFORE the generic failure branch, or the invoice loses its paper anyway",
  );
});

test("[IBAN-CHECK-HONEST] the fraud lookup still has no catch to swallow its own signal", () => {
  // The instance this gate remembers: two `if (error) throw` lines written so a failed supplier
  // lookup could not read as "no IBAN on record", and a `catch { return null }` three lines below
  // that returned exactly the null they were written to prevent. Both the throws and the comments
  // survived; only the behaviour was gone. iban-change.test.ts proves the OUTCOME with a stub —
  // this proves the shape, because the shape is what a refactor restores by reflex.
  const src = readFileSync("src/lib/iban-change.ts", "utf8");
  const at = src.indexOf("export async function knownIbanForVendor");
  assert.notEqual(at, -1, "knownIbanForVendor must still exist");
  const body = src.slice(at, src.indexOf("export async function detectIbanChange"));
  assert.match(body, /if \(error\) throw/, "a failed read must still leave as a throw");
  assert.doesNotMatch(
    body, /\bcatch\b/,
    "knownIbanForVendor must not catch: its only caller turns the throw into a stated 'unavailable', " +
      "and a catch here silently restores the bug where a skipped fraud check reads as a clean one",
  );
});

// ─── [BON-EMAIL] The two doors must agree about a receipt ─────────────────────
// A kassabon photographed at the counter and the same bon forwarded by e-mail are the same piece
// of paper, and the app has to treat them the same way. It did not: AttachmentClassification
// mapped the reader's answer into the sync's own shape and dropped is_paid, paid_method, paid_date,
// paid_evidence and paid_card_last4 on the way, so the sync could not tell a receipt from a bill.
// Money already out of the till stood in "nog te betalen", was dunned, and could be paid twice.
//
// The fix is not "add five lines to the mapper" — that is the instance. The fix is that ONE
// function answers the payment question and both doors call it. These gates hold that shape.

const INTAKE = readFileSync("src/app/api/intake/route.ts", "utf8");

/** The _intake_* markers a file actually WRITES (assignments, not mentions in prose). */
function writtenMarkers(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/[.\[]"?(_intake_[a-z0-9_]+)"?\]?\s*=/g)) out.add(m[1]);
  for (const m of src.matchAll(/\b(_intake_[a-z0-9_]+)\s*:/g)) out.add(m[1]);
  return out;
}

test("[BON-EMAIL] the e-mail sync writes every intake marker the camera path writes", () => {
  const fromIntake = writtenMarkers(INTAKE);
  // A floor: an empty set would make the subset check below vacuously true.
  assert.ok(fromIntake.size >= 5, `parsed ${fromIntake.size} markers from intake — the scan broke`);
  assert.ok(fromIntake.has("_intake_kind") && fromIntake.has("_intake_suggest"), "the two that decide the screen must be among them");

  const fromSync = writtenMarkers(SYNC);
  const missing = [...fromIntake].filter((k) => !fromSync.has(k)).sort();
  assert.deepEqual(
    missing, [],
    `the e-mail sync does not write: ${missing.join(", ")}.\n` +
      `The verify queue reads these to offer "Markeer als betaald", to pre-fill the method, and to ` +
      `relax the invoice-number axis for a bon. A marker written on one door and not the other means ` +
      `the same receipt behaves differently depending on how it arrived.`,
  );
});

test("[BON-EMAIL] both doors ask the SAME function whether it was paid", () => {
  for (const [name, src] of [["intake", INTAKE], ["email sync", SYNC]] as const) {
    assert.match(
      src, /paymentSuggestion|decideFromAi/,
      `${name} must reach the shared payment decision in intake-router.ts, not carry its own copy — ` +
        `two copies of that reasoning is exactly how these doors drifted apart`,
    );
  }
  // And the sync must pass the reader's payment fields into it. Passing the object without them is
  // the [BON-BETAALWIJZE] failure again: a call that satisfies the types and delivers nothing.
  const call = /paymentSuggestion\(\{([\s\S]*?)\n\s*\}\)/.exec(SYNC);
  assert.ok(call, "the sync must call paymentSuggestion with an object literal");
  for (const field of ["document_kind", "is_paid", "paid_method", "paid_date", "paid_evidence", "paid_card_last4"]) {
    assert.match(call[1], new RegExp(`${field}\\s*:`), `the sync's paymentSuggestion call omits ${field}`);
  }
});

test("[BON-EMAIL] the reader's payment fields survive the classification mapper", () => {
  // The five that were dropped. They are read from `result` — the same Claude call the camera path
  // uses — so their absence here was the whole of the gap.
  for (const field of ["is_paid", "paid_method", "paid_date", "paid_evidence", "paid_card_last4"]) {
    assert.match(
      SYNC, new RegExp(`result\\.${field}`),
      `AttachmentClassification drops result.${field} — the sync cannot act on what it never copied`,
    );
  }
});

test("[BON-EMAIL] a paid suggestion is never auto-booked as an unpaid debt", () => {
  // Auto-advance lands an invoice as 'received' — booked and UNPAID — which is the one status a
  // settled bon must not get. /api/intake gates on !decision.suggestPaid; the sync must too.
  // [MAILTEKST] The window is wider than it was because a body-rendered invoice is refused first,
  // between `const autoAdv` and this clause. The invariant is unchanged: a paid suggestion still
  // has to appear in the same expression that decides whether to auto-advance.
  // [WAAROM-VASTGEHOUDEN] De vorm is veranderd, de invariant niet. `!pay.suggestPaid` zat in
  // dezelfde uitdrukking als `!classification.uncertain`, en die twee gaven één naam aan twee heel
  // verschillende oorzaken — de lezer die twijfelde, en een perfect gelezen factuur met een
  // betaalspoor. De eigenaar las daarbij "de lezer was niet zeker genoeg" over een document
  // waarover niemand twijfelde. Nu een eigen tak met een eigen naam, vóór de kwaliteitspoorten.
  // [REGEL-BESLIST] Derde vormverandering, en de eerste die de twee deuren gelijk maakt. De deur
  // bouwt het besluit niet meer: hij geeft het FEIT door — dezelfde voorwaarde, dezelfde naam —
  // en de regel weigert erop, boven elke kwaliteitspoort. De cameradeur noemde ditzelfde feit
  // 'not_eligible'; sinds deze wijziging noemen beide het hetzelfde, wat deze assertie ("as the
  // camera path is") eindelijk letterlijk waar maakt in plaats van bij benadering.
  assert.match(
    SYNC, /const candidacy[\s\S]{0,400}?pay\.suggestPaid && !settlePlan\.settle\s*\n\s*\? 'paid_mark_not_settled'/,
    "the sync's auto-advance must be held back by a paid suggestion, as the camera path is",
  );
  // And the refusal that precedes it: mail we assembled into a document never books itself.
  assert.match(
    SYNC, /attachment\.fromBody === true\s*\n\s*\? 'from_email_body'/,
    "a body-rendered invoice is held before any quality consideration",
  );
  // The fact is handed to the rule, not acted on here. Without this the two assertions above pass
  // over a door that computes `candidacy` and then ignores it.
  assert.match(SYNC, /const autoAdv = shouldAutoAdvanceInvoice\(\{\s*\n\s*ownerReviewsEverything/,
    "the sync builds its own hold decision again instead of handing the facts over");
  assert.match(SYNC, /\n\s*candidacy,\n/, "the candidacy fact is computed and never passed");
});

test("[BON-EMAIL] the markers are written for EVERY row, not only flagged ones", () => {
  // The subtle half. The sync's _safecore block runs only when something is wrong (`if (!verdict.ok
  // || dedupNote || isReminder || …)`), so markers written inside it would reach problem rows only
  // — and a clean kassabon, the common case, would go back to being booked as a bill.
  //
  // This file indents one level per block, so the marker write living at the loop's own level (six
  // spaces) is the checkable form of "outside that block". Crude, and it is precisely the mistake
  // that was made here once already.
  assert.match(
    SYNC, /^ {6}if \(bonKind === 'receipt' \|\| pay\.suggestPaid\) \{/m,
    "the marker block must sit at the loop's own level — nested one deeper it only reaches flagged rows",
  );
});
