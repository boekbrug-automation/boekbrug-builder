// [VRAAG-EERST] Pure node test — run: npx tsx --test src/lib/accountant-invoice-question-flow.test.ts
//
// The order that broke in production: the quarter screen wrote the status first and asked for the
// words afterwards, and the door refuses a question without words. These tests pin the repaired
// order on the pure flow, with the dialog and the POST handed in, so it holds without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import {
  askInvoiceQuestion, INVOICE_QUESTION_ROUTE, type InvoiceQuestionBody,
} from "./accountant-invoice-question-flow";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";

/** A POST that records what it was handed and answers as told. */
function recorder(reply: { ok: boolean; status: number } | null | Error) {
  const calls: InvoiceQuestionBody[] = [];
  const post = async (body: InvoiceQuestionBody) => {
    calls.push(body);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { calls, post };
}

test("[VRAAG-EERST] cancelling the dialog writes nothing", async () => {
  const { calls, post } = recorder({ ok: true, status: 200 });
  const out = await askInvoiceQuestion({ clientId: CLIENT, invoiceId: INVOICE, prompt: async () => null, post });
  assert.deepEqual(out, { kind: "cancelled" });
  assert.deepEqual(calls, [], "a dismissed dialog must not reach the server");
});

test("[VRAAG-EERST] a question without words is not sent", async () => {
  for (const empty of ["", "   ", "\n\t ", undefined]) {
    const { calls, post } = recorder({ ok: true, status: 200 });
    const out = await askInvoiceQuestion({ clientId: CLIENT, invoiceId: INVOICE, prompt: async () => empty, post });
    assert.deepEqual(out, { kind: "cancelled" }, `empty question ${JSON.stringify(empty)} was treated as a question`);
    assert.deepEqual(calls, [], `empty question ${JSON.stringify(empty)} reached the server`);
  }
});

test("[VRAAG-EERST] the dialog closes before anything is sent", async () => {
  const order: string[] = [];
  const out = await askInvoiceQuestion({
    clientId: CLIENT,
    invoiceId: INVOICE,
    prompt: async () => { order.push("prompt"); return "Klopt het tarief?"; },
    post: async () => { order.push("post"); return { ok: true, status: 200 }; },
  });
  assert.equal(out.kind, "asked");
  assert.deepEqual(order, ["prompt", "post"], "the write must wait for the dialog");
});

test("[VRAAG-EERST] a question is sent once, to the question route, with the three fields", async () => {
  const { calls, post } = recorder({ ok: true, status: 200 });
  const out = await askInvoiceQuestion({
    clientId: CLIENT, invoiceId: INVOICE, prompt: async () => "  Klopt het tarief?  ", post,
  });
  assert.deepEqual(out, { kind: "asked", question: "Klopt het tarief?" });
  assert.equal(calls.length, 1, "exactly one write");
  assert.deepEqual(calls[0], { clientId: CLIENT, invoiceId: INVOICE, question: "Klopt het tarief?" });
  assert.equal(INVOICE_QUESTION_ROUTE, "/api/accountant/invoice-question");
});

test("[VRAAG-EERST] a refused or unreachable write is reported, so no question state is shown", async () => {
  const refused = recorder({ ok: false, status: 400 });
  assert.deepEqual(
    await askInvoiceQuestion({ clientId: CLIENT, invoiceId: INVOICE, prompt: async () => "Waarom?", post: refused.post }),
    { kind: "failed", question: "Waarom?", status: 400 },
  );
  const down = recorder(new Error("network"));
  assert.deepEqual(
    await askInvoiceQuestion({ clientId: CLIENT, invoiceId: INVOICE, prompt: async () => "Waarom?", post: down.post }),
    { kind: "failed", question: "Waarom?", status: null },
  );
  const nothing = recorder(null);
  assert.deepEqual(
    await askInvoiceQuestion({ clientId: CLIENT, invoiceId: INVOICE, prompt: async () => "Waarom?", post: nothing.post }),
    { kind: "failed", question: "Waarom?", status: null },
  );
  assert.equal(refused.calls.length + down.calls.length + nothing.calls.length, 3, "each attempt wrote exactly once");
});
