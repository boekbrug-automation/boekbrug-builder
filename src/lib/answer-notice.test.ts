// src/lib/answer-notice.test.ts
// Run: npx tsx --test src/lib/answer-notice.test.ts
//
// [KANTOOR-LINKS] The six outcomes an answer's notification can have, and the one write it must
// never make. Driven through a fake PostgREST so the filters themselves are asserted: the whole
// point of this module is WHICH rows it demands, and a test that only checked the return value
// would pass just as happily on a query that asked for any open question about any invoice.

import test from "node:test";
import assert from "node:assert/strict";

import { answerNoticeLink, notificationLinkFor } from "./answer-notice";

const CLIENT = "ac22189e-7052-4c48-b4ec-90947cf92ecc";
const ACCOUNTANT = "88d752ab-ad59-4991-8f3d-280dafc42b61";
const ANDERE_BOEKHOUDER = "5f7c1d22-3a44-4c55-9d66-77e88f99a012";
const INVOICE = "73b7bba0-a1c9-4d3f-a838-ee5527687473";

interface Row { [k: string]: unknown }
interface Recorded { table: string; filters: Array<[string, unknown]>; or?: string; limit?: number }

/**
 * A PostgREST small enough to read: `.eq()` pairs and one `.or()`, applied over fixture rows, with
 * a failure injectable per table. Every query the module makes is recorded so the test can assert
 * WHAT it asked for, not only what it did with the answer.
 */
function fakeDb(tables: Record<string, Row[]>, fail?: Record<string, string>) {
  const seen: Recorded[] = [];
  const client = {
    from(table: string) {
      const q: Recorded = { table, filters: [] };
      seen.push(q);
      const rows = () => {
        if (fail?.[table]) return { data: null, error: { message: fail[table] } };
        let out = tables[table] ?? [];
        for (const [col, val] of q.filters) out = out.filter((r) => String(r[col]) === String(val));
        if (q.or) {
          out = out.filter((r) =>
            q.or!.split(",").some((clause) => {
              const [col, op, ...rest] = clause.split(".");
              return op === "eq" && String(r[col]) === rest.join(".");
            }),
          );
        }
        return { data: q.limit != null ? out.slice(0, q.limit) : out, error: null };
      };
      const builder = {
        select: () => builder,
        eq(col: string, val: unknown) { q.filters.push([col, val]); return builder; },
        or(expr: string) { q.or = expr; return builder; },
        limit(n: number) { q.limit = n; return Promise.resolve(rows()); },
        maybeSingle() { const r = rows(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
        // Anything that writes is a bug in this module, not a case to support.
        insert() { throw new Error("answer-notice wrote to the database"); },
        update() { throw new Error("answer-notice wrote to the database"); },
        upsert() { throw new Error("answer-notice wrote to the database"); },
        delete() { throw new Error("answer-notice wrote to the database"); },
      };
      return builder;
    },
  };
  return { client, seen };
}

/** The world in which the deep link is correct: one open question, from this accountant. */
const OPEN_QUESTION: Row = {
  subject_type: "invoice", subject_id: INVOICE, accountant_id: ACCOUNTANT, status: "vraag",
};
const THE_INVOICE: Row = { id: INVOICE, invoice_date: "2026-08-28", receiver_id: CLIENT, sender_id: null };
const ASK = { senderId: CLIENT, receiverId: ACCOUNTANT, invoiceId: INVOICE };

test("[KANTOOR-LINKS] 1 · an exact open question from this accountant → the invoice, in its quarter", async () => {
  const { client, seen } = fakeDb({
    accountant_subject_status: [OPEN_QUESTION],
    invoices: [THE_INVOICE],
  });
  assert.equal(
    await answerNoticeLink(client, ASK),
    `/dashboard/clients/${CLIENT}/kwartaal?q=3&year=2026&focus=${INVOICE}`,
  );

  // The four facts the question read must demand — all of them, or the link proves nothing.
  const vraag = seen.find((q) => q.table === "accountant_subject_status");
  assert.ok(vraag, "the question was never read");
  assert.deepEqual(
    Object.fromEntries(vraag.filters),
    { subject_type: "invoice", subject_id: INVOICE, accountant_id: ACCOUNTANT, status: "vraag" },
    "the question read does not pin all four facts",
  );
});

test("[KANTOOR-LINKS] 2 · the same invoice, a question from ANOTHER accountant → no deep link", async () => {
  // One administration may have two offices. An open question about this invoice is not proof
  // that the office receiving the answer is the one that asked.
  const { client } = fakeDb({
    accountant_subject_status: [{ ...OPEN_QUESTION, accountant_id: ANDERE_BOEKHOUDER }],
    invoices: [THE_INVOICE],
  });
  assert.equal(await answerNoticeLink(client, ASK), null);
});

test("[KANTOOR-LINKS] 3 · an invoice the client owns but nobody asked about → no deep link", async () => {
  // The attack this closes: attaching any owned invoice to any message and aiming the
  // accountant's notification at an unrelated row.
  const { client } = fakeDb({ accountant_subject_status: [], invoices: [THE_INVOICE] });
  assert.equal(await answerNoticeLink(client, ASK), null);
});

test("[KANTOOR-LINKS] 4 · a question the accountant already cleared → no deep link", async () => {
  for (const status of ["verwerkt", "in_behandeling", "", null]) {
    const { client } = fakeDb({
      accountant_subject_status: [{ ...OPEN_QUESTION, status }],
      invoices: [THE_INVOICE],
    });
    assert.equal(await answerNoticeLink(client, ASK), null, `status ${JSON.stringify(status)}`);
  }
});

test("[KANTOOR-LINKS] 5 · a failed read yields null, never a throw and never a guess", async () => {
  // The caller sends the message first and uses this only for the notification's link, so the
  // one thing this may not do is raise.
  const qFail = fakeDb({ accountant_subject_status: [OPEN_QUESTION], invoices: [THE_INVOICE] }, { accountant_subject_status: "boom" });
  assert.equal(await answerNoticeLink(qFail.client, ASK), null);
  // And it stops there: no invoice read happens on an unproven question.
  assert.ok(!qFail.seen.some((q) => q.table === "invoices"), "the invoice was read without a proven question");

  const iFail = fakeDb({ accountant_subject_status: [OPEN_QUESTION], invoices: [THE_INVOICE] }, { invoices: "boom" });
  assert.equal(await answerNoticeLink(iFail.client, ASK), null);
});

test("[KANTOOR-LINKS] 6 · an invoice that is not the sender's, or has no readable date → no deep link", async () => {
  const someoneElse = fakeDb({
    accountant_subject_status: [OPEN_QUESTION],
    invoices: [{ ...THE_INVOICE, receiver_id: ANDERE_BOEKHOUDER, sender_id: null }],
  });
  assert.equal(await answerNoticeLink(someoneElse.client, ASK), null);

  for (const date of [null, "", "onbekend", "31-12-2026"]) {
    const { client } = fakeDb({
      accountant_subject_status: [OPEN_QUESTION],
      invoices: [{ ...THE_INVOICE, invoice_date: date }],
    });
    assert.equal(await answerNoticeLink(client, ASK), null, JSON.stringify(date));
  }
});

test("[KANTOOR-LINKS] the question is never closed, and nothing else is written", async () => {
  // The fake throws on every write verb. The lifecycle is unchanged: only the accountant clears
  // their own question (invoice_questions.sql gives the client SELECT and nothing more).
  const { client, seen } = fakeDb({
    accountant_subject_status: [OPEN_QUESTION],
    invoices: [THE_INVOICE],
  });
  await answerNoticeLink(client, ASK);
  assert.deepEqual(
    seen.map((q) => q.table),
    ["accountant_subject_status", "invoices"],
    "an unexpected table was touched",
  );
});

test("[KANTOOR-LINKS] a missing identifier is answered without a single read", async () => {
  // The caller only reaches this for a validated UUID travelling owner → accountant, but a
  // module that needs its caller to be careful is one bad refactor from a wrong link.
  const { client, seen } = fakeDb({ accountant_subject_status: [OPEN_QUESTION], invoices: [THE_INVOICE] });
  for (const bad of [
    { ...ASK, invoiceId: "" },
    { ...ASK, senderId: "" },
    { ...ASK, receiverId: "" },
  ]) {
    assert.equal(await answerNoticeLink(client, bad), null, JSON.stringify(bad));
  }
  assert.equal(seen.length, 0, "a read happened for an input that can never produce a link");
});

// ── A client that RAISES, not one that answers `{ error }` ───────────────────
//
// PostgREST failures come back in the result. A fetch that dies on a DNS hiccup, an aborted
// socket, a body that does not parse, a client built wrong — those THROW, and never become
// `{ error }`. The route writes the message before it asks for this link, so an escaping throw
// would answer 500 for a message that is already stored and the person would send it again.

/** A client whose reads raise instead of resolving — optionally only for one table. */
function throwingDb(onlyTable?: string, tables: Record<string, Row[]> = {}) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        limit(n: number) {
          if (!onlyTable || onlyTable === table) throw new Error(`fetch failed (${table})`);
          return Promise.resolve({ data: (tables[table] ?? []).slice(0, n), error: null });
        },
        maybeSingle() {
          if (!onlyTable || onlyTable === table) throw new Error(`fetch failed (${table})`);
          return Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

test("[KANTOOR-LINKS] 1 · the question query THROWS → null, and nothing escapes", async () => {
  const client = throwingDb("accountant_subject_status");
  assert.equal(await answerNoticeLink(client, ASK), null);
});

test("[KANTOOR-LINKS] 2 · the invoice query throws after a valid question → null, and nothing escapes", async () => {
  const client = throwingDb("invoices", { accountant_subject_status: [OPEN_QUESTION] });
  assert.equal(await answerNoticeLink(client, ASK), null);
});

test("[KANTOOR-LINKS] a rejected promise, an async throw and a broken client all resolve to null", async () => {
  // Three more shapes of "it raised", because a try/catch around an await catches all of them and
  // a missing one catches none.
  const rejecting = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.reject(new Error("socket hangup")) }) }) }) }) }) }) };
  assert.equal(await answerNoticeLink(rejecting, ASK), null);

  const noFrom = {};
  assert.equal(await answerNoticeLink(noFrom, ASK), null);

  const nonError = { from() { throw "kapot"; } };
  assert.equal(await answerNoticeLink(nonError, ASK), null);
});

// ── The route's seam: a throwing helper may never cost the message ───────────

test("[KANTOOR-LINKS] the notification link is a string for every failure the route can meet", async () => {
  const CONVERSATION = `/dashboard/messages/${CLIENT}`;

  // The happy path still deep-links.
  const good = fakeDb({ accountant_subject_status: [OPEN_QUESTION], invoices: [THE_INVOICE] });
  assert.equal(
    await notificationLinkFor(good.client, ASK, CONVERSATION),
    `/dashboard/clients/${CLIENT}/kwartaal?q=3&year=2026&focus=${INVOICE}`,
  );

  // A plain message asks for nothing and gets the conversation — unchanged behaviour.
  assert.equal(await notificationLinkFor(good.client, null, CONVERSATION), CONVERSATION);

  // And every way the resolution can fail ends on the conversation link, never on a rejection.
  // This is the route's ENTIRE link expression: if this cannot throw, the send cannot be turned
  // into a 500 by a convenience — and a person never answers a stored message by sending it twice.
  const failures: Array<[string, unknown]> = [
    ["question read returns an error", fakeDb({ accountant_subject_status: [OPEN_QUESTION], invoices: [THE_INVOICE] }, { accountant_subject_status: "boom" }).client],
    ["invoice read returns an error", fakeDb({ accountant_subject_status: [OPEN_QUESTION], invoices: [THE_INVOICE] }, { invoices: "boom" }).client],
    ["question read throws", throwingDb("accountant_subject_status")],
    ["invoice read throws", throwingDb("invoices", { accountant_subject_status: [OPEN_QUESTION] })],
    ["the client itself is broken", {}],
    ["no question exists", fakeDb({ accountant_subject_status: [], invoices: [THE_INVOICE] }).client],
  ];
  for (const [name, client] of failures) {
    const link = await notificationLinkFor(client, ASK, CONVERSATION);
    assert.equal(link, CONVERSATION, name);
    assert.equal(typeof link, "string", name);
  }
});
