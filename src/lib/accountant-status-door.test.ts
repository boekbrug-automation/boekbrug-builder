// [BOEKHOUDER-DEUR] Pure node test for accountant-status-door.ts — run: npx tsx accountant-status-door.test.ts
//
// What the DATABASE refuses is proven in the SQL seam (tests/sql/accountant_status_door.test.sql and
// tests/sql/accountant_invoice_question_sync.test.sql): that NO session may write the column, and that
// the invoice status and the accountant's question row move in one transaction. What THIS file proves
// is the door's own decisions: who may ask, about which invoice, with which words — and that the one
// write it makes is the database function, with the session's identity and nothing supplied by the
// caller.
import { setAccountantStatus, attributionFor, isAccountantStatus, refusalFromRpcError, invoiceLabelOf, ACCOUNTANT_STATUSES, ACCOUNTANT_STATUS_RPC, LOCKED } from "./accountant-status-door";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const ACCOUNTANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const INVOICE = "11111111-1111-1111-1111-111111111111";

type RpcArgs = { p_accountant_id: string; p_client_id: string; p_invoice_id: string; p_status: string | null; p_question: string | null };

/** A session client: it knows who is calling and what they may see. */
function session(opts: {
  userId?: string | null;
  links?: { zzper_id: string }[];
  linkError?: string;
  invoice?: { id: string; sender_id: string | null; receiver_id: string | null; invoice_number?: string | null; client_name?: string | null } | null;
  invoiceError?: string;
}) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.userId === null ? null : { id: opts.userId ?? ACCOUNTANT } } }) },
    from(table: string) {
      if (table === "accountant_clients") {
        return { select: () => ({ eq: async () => ({ data: opts.links ?? [{ zzper_id: CLIENT }], error: opts.linkError ? { message: opts.linkError } : null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.invoice === undefined ? { id: INVOICE, sender_id: null, receiver_id: CLIENT, invoice_number: "2026-014", client_name: "Bakker BV" } : opts.invoice,
              error: opts.invoiceError ? { message: opts.invoiceError } : null,
            }),
          }),
        }),
      };
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** A service-role client that records the ONE call the door makes: the database function. */
function pipeline(opts: { rows?: unknown; error?: string } = {}) {
  const calls: { fn: string; args: RpcArgs }[] = [];
  const client = {
    from: () => { throw new Error("the door must not write a table directly any more — the function moves both rows"); },
    rpc: async (fn: string, args: RpcArgs) => {
      calls.push({ fn, args });
      if (opts.error) return { data: null, error: { message: opts.error } };
      return { data: opts.rows === undefined ? [{ previous_status: "vraag", question_was_open: true, question_status: args.p_status ?? "te_verwerken" }] : opts.rows, error: null };
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

async function run() {
  console.log("[BOEKHOUDER-DEUR] the door's own decisions");

  check("the four words are the database's four", ACCOUNTANT_STATUSES.join(",") === "te_verwerken,in_behandeling,verwerkt,vraag");
  check("'verwerkt' is the locking value", LOCKED === "verwerkt");
  check("a known word is recognised", isAccountantStatus("vraag"));
  check("an unknown word is not", !isAccountantStatus("afgekeurd"));
  check("only the lock carries an actor", attributionFor("verwerkt", ACCOUNTANT) === ACCOUNTANT);
  for (const other of ["te_verwerken", "in_behandeling", "vraag"] as const) {
    check(`'${other}' carries none`, attributionFor(other, ACCOUNTANT) === null);
  }
  check("and the undo carries none", attributionFor(null, ACCOUNTANT) === null);

  {
    const p = pipeline();
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" });
    check("an authorized accountant may set the lock", r.ok === true);
    check("…attributed to the authenticated caller", r.ok && r.accountantId === ACCOUNTANT);
    check("…through the ONE database function", p.calls.length === 1 && p.calls[0].fn === ACCOUNTANT_STATUS_RPC);
    check("…with the session's identity, the client, the invoice and the word", p.calls[0].args.p_accountant_id === ACCOUNTANT && p.calls[0].args.p_client_id === CLIENT && p.calls[0].args.p_invoice_id === INVOICE && p.calls[0].args.p_status === "verwerkt");
    check("…and no question text on a statement that is not a question", p.calls[0].args.p_question === null);
    check("the database's answer travels back: the question was open", r.ok && r.questionWasOpen === true && r.previousStatus === "vraag");
    check("…and the invoice is named for the sentence the caller may say", r.ok && r.invoiceLabel === "Bakker BV · factuur 2026-014");
  }

  {
    const p = pipeline();
    const IMPOSTOR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await setAccountantStatus({
      session: session({ userId: ACCOUNTANT }),
      pipeline: p.client,
      invoiceId: INVOICE,
      clientId: CLIENT,
      status: "verwerkt",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ accountantId: IMPOSTOR, accountant_id: IMPOSTOR, actorId: IMPOSTOR, p_accountant_id: IMPOSTOR } as any),
    });
    check("a supplied actor is ignored — the session decides", p.calls[0].args.p_accountant_id === ACCOUNTANT);
  }

  {
    const p = pipeline({ rows: [{ previous_status: "verwerkt", question_was_open: false, question_status: "te_verwerken" }] });
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: null });
    check("an authorized accountant may undo", r.ok === true);
    check("…the status is cleared", p.calls[0].args.p_status === null);
    check("…and the attribution with it", r.ok && r.accountantId === null);
    check("…and no question was open, says the database", r.ok && r.questionWasOpen === false);
  }

  {
    const p = pipeline({ rows: [{ previous_status: null, question_was_open: false, question_status: "vraag" }] });
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "vraag", question: "  Klopt het tarief?  " });
    check("a question travels with its words", r.ok === true && p.calls[0].args.p_status === "vraag" && p.calls[0].args.p_question === "Klopt het tarief?");
    check("…and the row's status comes back", r.ok && r.questionStatus === "vraag");
  }

  {
    const p = pipeline();
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "vraag", question: "   " });
    check("a question without words is refused before any write", !r.ok && r.reason === "question_required" && p.calls.length === 0);
  }

  const refusals: [string, Parameters<typeof setAccountantStatus>[0], string][] = [
    ["nobody is logged in", { session: session({ userId: null }), pipeline: pipeline().client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" }, "not_authenticated"],
    ["the word is not in the vocabulary", { session: session({}), pipeline: pipeline().client, invoiceId: INVOICE, clientId: CLIENT, status: "afgekeurd" as never }, "unknown_status"],
    ["this accountant is not linked to this client", { session: session({ links: [] }), pipeline: pipeline().client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" }, "not_linked"],
    ["the linkage could not be read", { session: session({ linkError: "boom" }), pipeline: pipeline().client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" }, "link_read_failed"],
    ["the invoice is not visible to them", { session: session({ invoice: null }), pipeline: pipeline().client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" }, "invoice_not_visible"],
    ["the invoice belongs to another client", { session: session({ invoice: { id: INVOICE, sender_id: null, receiver_id: "dddddddd-dddd-dddd-dddd-dddddddddddd" } }), pipeline: pipeline().client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" }, "invoice_not_this_client"],
  ];
  for (const [what, args, reason] of refusals) {
    const p = pipeline();
    const r = await setAccountantStatus({ ...args, pipeline: p.client });
    check(`refused: ${what}`, !r.ok && r.reason === reason);
    check(`…and nothing was written (${reason})`, p.calls.length === 0);
  }

  {
    const p = pipeline({ rows: [] });
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" });
    check("a zero-row answer is an honest refusal, not a success", !r.ok && r.reason === "nothing_written");
  }

  {
    // The function re-checks the scope on its own; when IT refuses, the door reports the same word.
    for (const [msg, reason] of [["not_linked", "not_linked"], ["invoice_not_this_client", "invoice_not_this_client"], ["question_required", "question_required"], ["unknown_status", "unknown_status"], ["deadlock detected", "write_failed"]] as const) {
      check(`the database's '${msg}' is reported as ${reason}`, refusalFromRpcError(msg) === reason);
    }
    const p = pipeline({ error: "not_linked" });
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" });
    check("a refusal raised inside the function is a refusal, never a success", !r.ok && r.reason === "not_linked");
  }

  check("the label names supplier and number", invoiceLabelOf({ client_name: "Bakker BV", invoice_number: "2026-014" }) === "Bakker BV · factuur 2026-014");
  check("…or only what exists", invoiceLabelOf({ client_name: null, invoice_number: "7" }) === "factuur 7" && invoiceLabelOf({ client_name: " ", invoice_number: null }) === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void run();
