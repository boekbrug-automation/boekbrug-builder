// src/lib/ontvangen-crash.test.ts
// [ONTVANGEN] The rules a crash must not be able to break.
//
// Each of these is a rule the code does not yet have a caller for, or one that is easy to undo by
// accident. They are written now, before the stored branch exists, so that wiring it cannot
// quietly violate them — a regression that arrives after the mistake is a post-mortem, not a gate.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/** Comment-free source, so a sentence describing a rule is never mistaken for the rule. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

// ── Decision 5: after Ontvangen, deleting the evidence is forbidden ───────────────────────────

test("[ONTVANGEN] the strict receive path never deletes what it accepted", () => {
  // The synchronous processor rolls back — deletes the blob and the row — when a later write
  // fails. That was right while the owner was still waiting and we had promised nothing.
  //
  // After "Ontvangen — je kunt verder" it is forbidden. A downstream failure is OUR problem; it
  // is not permission to forget evidence the owner already handed over. The rollbacks that remain
  // in store-raw-incoming.ts are the ones that run BEFORE we say Ontvangen, and they exist to
  // avoid the opposite fault: bytes in storage with no row to find them by.
  const receive = code("src/lib/store-raw-incoming.ts")

  // Every remove() in that file must be reachable only on a path that returns `failed` — i.e.
  // where no Ontvangen was ever said. Counting them pins that: three rollbacks, all pre-handoff.
  const removes = receive.match(/storage\.from\("documents"\)\.remove\(/g) ?? []
  assert.equal(removes.length, 2,
    "a remove() was added or lost in the receive path — every one of them must run BEFORE Ontvangen")

  // And each is immediately followed by a failure return, never by a success.
  for (const m of receive.matchAll(/storage\.from\("documents"\)\.remove\(\[[^\]]*\]\)[^\n]*\n([\s\S]{0,200})/g)) {
    assert.match(m[1], /return \{ kind: "failed"/,
      "bytes were removed on a path that does not report failure — that is a deletion after a promise")
  }
})

test("[ONTVANGEN] the receive contract still has exactly one success shape per outcome", () => {
  const receive = code("src/lib/store-raw-incoming.ts")
  for (const kind of ["created", "existing", "failed"]) {
    assert.ok(receive.includes(`kind: "${kind}"`), `the ${kind} outcome disappeared`)
  }
})

// ── Decision 2/3: a 23505 is a replay only when the document proves it ────────────────────────

test("[ONTVANGEN] a uniqueness conflict is adopted only on the document's own evidence", () => {
  // Swallowing any 23505 would report success for a booking that never happened — the conflict
  // could have come from any other uniqueness rule on invoices.
  const reread = code("src/app/api/documents/[id]/read-as-invoice/route.ts")
  const branch = reread.indexOf('code === "23505"')
  assert.ok(branch > 0, "[ONTVANGEN] the 23505 branch moved — re-point this gate")
  const end = reread.indexOf("if (!booked)", branch)
  assert.ok(end > branch, "[ONTVANGEN] the branch's end marker moved — re-point this gate")
  const body = reread.slice(branch, end)

  assert.match(body, /findInvoiceForDocument\(doc\.id, user\.id, pipeline\)/,
    "the conflict must be resolved by asking for an invoice that names THIS document and owner")
  assert.match(body, /existing\.kind === "found"/, "…and adopted only when one is actually found")
  assert.doesNotMatch(body, /gate\.release\(\)/,
    "the reading DID happen and cost a model call — a lost race is not a refund")
})

test("[ONTVANGEN] the resume lookup asks the forward link, never the reverse one", () => {
  // Production has one invoice whose document's invoice_id is null. Asking documents.invoice_id
  // would answer "no invoice exists" for it, and a retry would mint a second one.
  const placement = code("src/lib/document-placement.ts")
  const fn = placement.indexOf("export async function findInvoiceForDocument")
  assert.ok(fn > 0, "[ONTVANGEN] findInvoiceForDocument moved — re-point this gate")
  const body = placement.slice(fn)
  assert.match(body, /\.from\("invoices"\)/, "the question is asked of invoices…")
  assert.match(body, /\.eq\("document_id", documentId\)/, "…by the forward link…")
  assert.match(body, /\.eq\("receiver_id", ownerId\)/, "…and scoped to the owner")
  assert.doesNotMatch(body.slice(0, body.indexOf("export ", 10) + 1 || undefined), /invoice_id.*IS NULL|\.is\("invoice_id"/,
    "the reverse link must not be consulted here")
})

// ── Decision 6: the payment key is derived, never random ─────────────────────────────────────

test("[ONTVANGEN] no settlement may key its idempotency on chance", () => {
  // randomUUID() makes every retry a booking apply_manual_payment has never seen, which is a
  // second payment for one bon. The RPC's replay machinery is correct; the caller was the defect.
  const settle = code("src/lib/settlement-key.ts")
  assert.doesNotMatch(settle, /randomUUID|Math\.random|Date\.now/,
    "an idempotency key that varies per attempt is not an idempotency key")
  assert.match(settle, /createHash\("sha1"\)/, "…it is derived from what is being settled")
})

// ── Decision P0: the allowance is reserved against the document, in one transaction ───────────

test("[ONTVANGEN] the allowance mark and the counter move together, or not at all", () => {
  // The crash catch/finally cannot see. If these were two statements in the application, a death
  // between them would leave the counter raised and the document unaware — and the next retry
  // would raise it again.
  const sql = readFileSync("supabase/migrations/ontvangen_fair_use_per_document.sql", "utf8")
  const fn = sql.indexOf("CREATE OR REPLACE FUNCTION public.fair_use_consume_for_document")
  assert.ok(fn > 0, "[ONTVANGEN] the consume function moved — re-point this gate")
  const end = sql.indexOf("COMMENT ON FUNCTION public.fair_use_consume_for_document", fn)
  assert.ok(end > fn, "[ONTVANGEN] the function's end marker moved — re-point this gate")
  const body = sql.slice(fn, end)

  // The increment and the mark are both in the function body, and the mark comes after the
  // increment with no RETURN between them.
  const inc = body.indexOf("SET count = v_new")
  const mark = body.indexOf("SET intake_ai_counted_period = p_period")
  assert.ok(inc > 0 && mark > inc, "the mark must be written after the increment, in the same body")
  assert.doesNotMatch(body.slice(inc, mark), /RETURN QUERY|RETURN;/,
    "nothing may return between raising the counter and marking the document")

  // The replay arm must not increment anything.
  //
  // [LIFECYCLE-VENSTER] Bounded on the first statement of the ORDINARY path, not on `inc`. Cutting
  // to the increment ran straight past this arm's RETURN and swallowed the counter INSERT that
  // belongs to the other branch — the window measured more than it claimed, which is the mistake
  // AGENTS.md names and the second time today I have made it.
  const replayStart = body.indexOf("IF v_counted IS NOT NULL THEN")
  const ordinaryStart = body.indexOf("INSERT INTO public.usage_counters")
  assert.ok(replayStart > 0 && ordinaryStart > replayStart,
    "[ONTVANGEN] the replay arm's bounds moved — re-point this gate, do not widen it")
  const replayArm = body.slice(replayStart, ordinaryStart)
  assert.doesNotMatch(replayArm, /SET count|INSERT INTO public\.usage_counters/,
    "a replay must never move the counter")

  // And the refusal arm must leave no mark.
  const refuse = body.indexOf("IF p_limit > 0 AND v_new > p_limit THEN")
  assert.ok(refuse > 0)
  assert.doesNotMatch(body.slice(refuse, inc), /intake_ai_counted_period/,
    "a refusal reserves nothing, so it must mark nothing")

  // The release decrements the STORED period, never the current one.
  const rel = sql.indexOf("CREATE OR REPLACE FUNCTION public.fair_use_release_for_document")
  const relEnd = sql.indexOf("COMMENT ON FUNCTION public.fair_use_release_for_document", rel)
  assert.ok(rel > 0 && relEnd > rel, "[ONTVANGEN] the release function moved — re-point this gate")
  assert.match(sql.slice(rel, relEnd), /WHERE c\.user_id = p_user_id AND c\.period = v_counted/,
    "the release must give back the month it was taken in, not the month we are in now")
})

test("[ONTVANGEN] the unique boundary is partial, and not wrapped in a transaction", () => {
  const sql = readFileSync("supabase/migrations/ontvangen_uniek_document_per_factuur.sql", "utf8")
  assert.match(sql, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_invoices_document_id/)
  assert.match(sql, /WHERE document_id IS NOT NULL/,
    "a full index would claim a rule that [REGEL-FACTUUR] and every outgoing invoice break")
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\b/m,
    "CONCURRENTLY cannot run inside a transaction block — wrapping it makes the migration fail")
})
