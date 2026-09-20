// [VRAAG-EIGENAAR] Pure node test — run: npx tsx --test src/lib/accountant-links.test.ts
// An owner with TWO accountants is the designed shape. Every outcome of the link read is kept apart,
// and each question is answered to its own asker.
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyAccountantLinks, linkStateOf, answerTargetFor, messagesDoorHref, provenAccountantIds } from "./accountant-links";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("[VRAAG-EIGENAAR] the four outcomes of the link read are never collapsed", () => {
  assert.deepEqual(classifyAccountantLinks({ data: null, error: { message: "boom" } }), { state: "failed" });
  assert.deepEqual(classifyAccountantLinks({ data: null, error: null }), { state: "failed" }, "no rows and no error is not a count either");
  assert.deepEqual(classifyAccountantLinks({ data: [], error: null }), { state: "known", ids: [] });
  assert.deepEqual(classifyAccountantLinks({ data: [{ accountant_id: A }], error: null }), { state: "known", ids: [A] });
  assert.deepEqual(classifyAccountantLinks({ data: [{ accountant_id: A }, { accountant_id: B }], error: null }), { state: "known", ids: [A, B] });
  assert.deepEqual(classifyAccountantLinks({ data: [{ accountant_id: A }, { accountant_id: A }, { accountant_id: null }], error: null }), { state: "known", ids: [A] }, "duplicates and empties are not links");
});

test("[VRAAG-EIGENAAR] two accountants: each question is answered to ITS asker, never to the first link", () => {
  const links = classifyAccountantLinks({ data: [{ accountant_id: A }, { accountant_id: B }], error: null });
  assert.deepEqual(answerTargetFor(A, links), { ok: true, accountantId: A });
  assert.deepEqual(answerTargetFor(B, links), { ok: true, accountantId: B });
  assert.equal(linkStateOf(A, links), "linked");
  assert.equal(linkStateOf(B, links), "linked");
});

test("[VRAAG-EIGENAAR] an asker who is no longer linked keeps the question and loses the answer button", () => {
  const links = classifyAccountantLinks({ data: [{ accountant_id: A }], error: null });
  assert.equal(linkStateOf(GONE, links), "unlinked");
  assert.deepEqual(answerTargetFor(GONE, links), { ok: false, reason: "unlinked" });
  assert.deepEqual(answerTargetFor(null, links), { ok: false, reason: "unlinked" }, "a row without an asker can be answered by nobody");
});

test("[VRAAG-EIGENAAR] a failed link read is 'unknown' — never 'not linked', never 'linked'", () => {
  const links = classifyAccountantLinks({ data: null, error: { message: "timeout" } });
  assert.equal(linkStateOf(A, links), "unknown");
  assert.deepEqual(answerTargetFor(A, links), { ok: false, reason: "unknown" });
});

test("[VRAAG-EIGENAAR] the Berichten door: exactly one link opens that thread, anything else opens the inbox", () => {
  assert.equal(messagesDoorHref({ state: "known", ids: [A] }), `/dashboard/messages/${A}`);
  assert.equal(messagesDoorHref({ state: "known", ids: [A, B] }), "/dashboard/messages", "two offices: the owner chooses, the code does not");
  assert.equal(messagesDoorHref({ state: "known", ids: [] }), "/dashboard/messages");
  assert.equal(messagesDoorHref({ state: "failed" }), "/dashboard/messages");
  assert.equal(messagesDoorHref({ state: "known", ids: ["a&b"] }), "/dashboard/messages/a%26b", "the id is encoded");
});

test("[VRAAG-EIGENAAR] names may be fetched only for ids the owner's own rows or links prove", () => {
  const links = classifyAccountantLinks({ data: [{ accountant_id: A }], error: null });
  const ids = provenAccountantIds([{ accountantId: GONE }, { accountantId: A }, { accountantId: null }], links);
  assert.deepEqual([...ids].sort(), [A, GONE].sort(), "the asker of a visible question is proven by the row itself, the link by the link table");
  assert.deepEqual(provenAccountantIds([], { state: "failed" }), [], "a failed read proves nothing extra");
  assert.deepEqual(provenAccountantIds([{ accountantId: B }], { state: "failed" }), [B], "…but a visible row still does");
});
