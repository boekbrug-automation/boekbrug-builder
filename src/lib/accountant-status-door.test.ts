// [BOEKHOUDER-DEUR] Pure node test for accountant-status-door.ts — run: npx tsx accountant-status-door.test.ts
//
// The database half of this contract is proved where it lives, against a real PostgreSQL
// (tests/sql/accountant_status_door.test.sql): that NO session may write the column, that the
// server door may, and that the deliberate undo survives the freeze. None of that can be shown
// here, and none of what is here can be shown there.
//
// What this file proves is the DOOR'S OWN decisions, by running them: which callers are refused,
// in which order, whether a refusal writes anything, and — the one that carries the whole
// attribution idea — that the accountant recorded is the one the SESSION says is calling, and can
// be nothing else, because the door takes no such parameter to be lied to with.
//
// The clients are stubs, and deliberately record every write: a door that refuses but writes
// anyway would pass an assertion about its return value and fail the app.
import { setAccountantStatus, attributionFor, isAccountantStatus, ACCOUNTANT_STATUSES, LOCKED } from "./accountant-status-door";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const ACCOUNTANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const INVOICE = "11111111-1111-1111-1111-111111111111";

type Written = { accountant_status: unknown; accountant_id: unknown };

/** A session client: it knows who is calling and what they may see. */
function session(opts: {
  userId?: string | null;
  links?: { zzper_id: string }[];
  linkError?: string;
  invoice?: { id: string; sender_id: string | null; receiver_id: string | null } | null;
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
              data: opts.invoice === undefined ? { id: INVOICE, sender_id: null, receiver_id: CLIENT } : opts.invoice,
              error: opts.invoiceError ? { message: opts.invoiceError } : null,
            }),
          }),
        }),
      };
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** A service-role client that records what it was asked to write. */
function pipeline(rows: { id: string }[] = [{ id: INVOICE }]) {
  const writes: Written[] = [];
  const client = {
    from: () => ({
      update: (payload: Written) => {
        writes.push(payload);
        return { eq: () => ({ select: async () => ({ data: rows, error: null }) }) };
      },
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, writes };
}

async function run() {
  console.log("[BOEKHOUDER-DEUR] the door's own decisions");

  // ── The vocabulary, and the one value that carries an actor ──
  check("the four words are the database's four", ACCOUNTANT_STATUSES.join(",") === "te_verwerken,in_behandeling,verwerkt,vraag");
  check("'verwerkt' is the locking value", LOCKED === "verwerkt");
  check("a known word is recognised", isAccountantStatus("vraag"));
  check("an unknown word is not", !isAccountantStatus("afgekeurd"));
  check("only the lock carries an actor", attributionFor("verwerkt", ACCOUNTANT) === ACCOUNTANT);
  for (const other of ["te_verwerken", "in_behandeling", "vraag"] as const) {
    check(`'${other}' carries none`, attributionFor(other, ACCOUNTANT) === null);
  }
  check("and the undo carries none", attributionFor(null, ACCOUNTANT) === null);

  // ── 3 + 4: an authorized accountant sets the lock, attributed to themselves ──
  {
    const p = pipeline();
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" });
    check("an authorized accountant may set the lock", r.ok === true);
    check("…attributed to the authenticated caller", r.ok && r.accountantId === ACCOUNTANT);
    check("…and that is what was written", p.writes.length === 1 && p.writes[0].accountant_id === ACCOUNTANT);
    check("…together with the status, in ONE write", p.writes[0].accountant_status === "verwerkt");
  }

  // ── 5: the actor cannot be supplied. The door reads it; there is no parameter to forge. ──
  {
    const p = pipeline();
    const IMPOSTOR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    // Everything a caller controls is set to the impostor. The session still says who is calling.
    await setAccountantStatus({
      session: session({ userId: ACCOUNTANT }),
      pipeline: p.client,
      invoiceId: INVOICE,
      clientId: CLIENT,
      status: "verwerkt",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ accountantId: IMPOSTOR, accountant_id: IMPOSTOR, actorId: IMPOSTOR } as any),
    });
    check("a supplied actor is ignored — the session decides", p.writes[0].accountant_id === ACCOUNTANT);
  }

  // ── 6: the undo, and it clears both columns ──
  {
    const p = pipeline();
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: null });
    check("an authorized accountant may undo", r.ok === true);
    check("…the status is cleared", p.writes[0].accountant_status === null);
    check("…and the attribution with it", p.writes[0].accountant_id === null);
  }

  // ── 7: every refusal, and none of them writes ──
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
    check(`…and nothing was written (${reason})`, p.writes.length === 0);
  }

  // A row that moved out of reach between the read and the write is reported, not claimed.
  {
    const p = pipeline([]);
    const r = await setAccountantStatus({ session: session({}), pipeline: p.client, invoiceId: INVOICE, clientId: CLIENT, status: "verwerkt" });
    check("a zero-row write is an honest refusal, not a success", !r.ok && r.reason === "nothing_written");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void run();
