// src/lib/access/register.ts
// [EEN-POORT] Every way this app answers "may this actor do this", classified and COUNTED.
// Run: npx tsx --test src/lib/access/register.test.ts
//
// ── WHY A REGISTER AND NOT JUST A NEW ENGINE ────────────────────────────────────────────────
//
// The value of one authorization model does not begin when it is written. It begins when the old
// paths are measured and closed. A canonical resolver standing beside eight legacy mechanisms is
// a ninth mechanism, and "temporarily" is how four of them stayed for a year.
//
// So this file does the unglamorous half: it names every mechanism, says what it IS, and pins a
// CEILING on how far it reaches. The gate measures the repository and fails when a ceiling is
// exceeded. Ceilings only ever come down — that is the whole mechanism, and it is the same
// ratchet [RUSTIG] uses on words on screen.
//
// ── THE FOUR CLASSES ────────────────────────────────────────────────────────────────────────
//
//   canonical    — this is the answer. New code uses it; its reach may grow.
//   transitional — correct, in the right place, and destined to be folded in. Reach may not grow.
//   legacy       — works, but is a second answer to a question that has one. Reach must shrink.
//   forbidden    — must not exist. Ceiling zero.
//
// ── WHAT IS DELIBERATELY NOT LEGACY ─────────────────────────────────────────────────────────
//
// RLS, and the caller guards inside the SECURITY DEFINER money functions, are NOT duplicate
// policies. They are ENFORCEMENT LAYERS under the same policy, and defence in depth is the
// design: the application decides whether an actor may perform an action, the database decides
// whether a connection may touch a tenant's rows. Removing either would not simplify anything;
// it would remove a floor. They are counted here so their reach is visible, and their class says
// so.

/** What a mechanism is, in the migration. */
export type AccessClass = "canonical" | "transitional" | "legacy" | "forbidden";

export interface AccessMechanism {
  /** The name a reader will grep for. */
  key: string;
  klass: AccessClass;
  /** What it decides, in one sentence. */
  decides: string;
  /**
   * How its reach is measured: a needle, and where to look. Counted in FILES, not call sites —
   * a file is the unit somebody migrates, and a call-site count would move on a refactor that
   * changed nothing.
   */
  needle: string;
  where: "src" | "api" | "migrations";
  /**
   * The most files this may appear in. Measured on 13 September 2026 and only ever lowered.
   * A raise is not a code change; it is a decision to widen a mechanism, and it belongs in a
   * commit message that says why.
   */
  ceiling: number;
  /** Why the ceiling is where it is, and what would lower it. */
  note: string;
}

export const ACCESS_REGISTER: readonly AccessMechanism[] = [
  {
    key: "resolveActingFor",
    klass: "canonical",
    decides: "who is acting, on whose behalf, with which role",
    needle: "resolveActingFor",
    where: "src",
    ceiling: 3,
    note: "The pure rule. Its two server doors (acting-for-server.ts) and the middleware are the " +
      "only callers; everything else goes through getActingFor / resolveActingContext.",
  },
  {
    key: "resolveActingContext",
    klass: "canonical",
    decides: "the same question, in the shape the platform names",
    needle: "resolveActingContext",
    where: "src",
    ceiling: 99,
    note: "The promotion of getActingFor. Its reach is meant to GROW — every route migrated off a " +
      "legacy mechanism lands here, so this ceiling is a formality and not a limit.",
  },
  {
    key: "authorize",
    klass: "canonical",
    decides: "may this actor perform this permission on this resource",
    // Every file that asks the catalogue anything — requirePermission, requireOwnerPermission,
    // can(), or authorize() over a context it already proved. The old needle looked for a relative
    // import that only exists INSIDE access/, which the counter excludes, so it measured zero
    // forever and could never show the migration moving.
    needle: "@/lib/access/",
    where: "src",
    ceiling: 99,
    note: "One policy definition. Meant to grow — and it is the counterweight to requireOwner " +
      "above: twelve files on 14 September 2026, every one of them a money or aangifte door.",
  },
  {
    key: "requireOwner",
    klass: "transitional",
    decides: "refuses a sales member at a door that was never rebuilt for them",
    // CALL-SHAPED, and that is not cosmetic: the bare word `requireOwner` is a prefix of
    // `requireOwnerPermission`, so every route migrated to the canonical door went on counting as
    // legacy. A ratchet that cannot fall is a comment.
    needle: "requireOwner(",
    where: "api",
    ceiling: 25,
    note: "Correct and deliberate (owner-only.ts explains the choice per route), but it is a " +
      "role test where the platform now has permissions. Six money routes came off it first — " +
      "pay-toggle, payment/move, bank/allocate, bank/storno, bank/line-invoice and " +
      "mollie/terugbetaling, all through requireOwnerPermission(), same sentence, named " +
      "capability. Each further route lowers this by one; none may be added.",
  },
  {
    key: "canAccessInvoice",
    klass: "transitional",
    decides: "may this actor open or finish THIS invoice",
    needle: "canAccessInvoice(",
    where: "src",
    ceiling: 5,
    note: "A second spelling of `invoice.read` / `invoice.send` / `invoice.credit`, and it is the " +
      "SAME rule — decision.test.ts asserts authorize() and canAccessInvoice() agree for all " +
      "three roles on every combination. /invoice/send and /invoice/creditnota, the two that mint " +
      "and reverse money, already ask the catalogue instead. The four read-ish routes left " +
      "(betaalverzoek, duplicate, [id], send-offerte) follow one at a time; the fifth file is the " +
      "rule itself.",
  },
  {
    key: "canSendInvoice",
    klass: "transitional",
    decides: "may this actor send THIS invoice",
    needle: "canSendInvoice(",
    where: "src",
    ceiling: 1,
    note: "One file left: its own definition in acting-for.ts, kept because acting-for.test.ts " +
      "pins the rule authorize() is asserted equal to. Nothing calls it any more, and this " +
      "ceiling says nothing may start.",
  },
  {
    key: "canConfirmForClientServer",
    klass: "transitional",
    decides: "does this client's CONFIRMING mandate reach this accountant",
    needle: "canConfirmForClientServer",
    where: "src",
    ceiling: 1,
    note: "The proof lookup for the second mandate kind. One file left — acting-for-server.ts, " +
      "where it is defined — because the only caller is now resolveActingContext(), which hands " +
      "it to the catalogue as `expense.approve` (MANDATE_PROOF). A route calling it directly " +
      "again would be a second answer to a question the catalogue now owns.",
  },
  {
    key: "company_members-raw",
    klass: "legacy",
    decides: "membership, read straight from the table",
    needle: "from(\"company_members\")",
    where: "src",
    ceiling: 2,
    note: "Two files may READ the table, and only one may interpret it. acting-for-server.ts is " +
      "the canonical door. The middleware is the second, and it must query for itself — it runs " +
      "before the server client exists — but it no longer DECIDES: it used to hard-code " +
      "role 'verkoop', skipping three of resolveActingFor's five rules, and now hands the whole " +
      "row to that rule. A third reader would be a third answer; this ceiling can never rise.",
  },
  {
    key: "mayOpenControl",
    klass: "transitional",
    decides: "who may open the commercial console",
    needle: "mayOpenControl",
    where: "src",
    ceiling: 3,
    note: "An env-var allow-list, outside the membership model entirely — which is right while the " +
      "console is read-mostly and its operator is not a tenant. It becomes a permission the day " +
      "the console writes anything a tenant can see.",
  },
  {
    key: "canAccessScreen",
    klass: "transitional",
    decides: "which screens a sales member may open",
    needle: "canAccessScreen",
    where: "src",
    ceiling: 2,
    note: "A navigation hint, not a boundary — the middleware header says so, and RLS is what " +
      "actually gives a member nothing. It becomes scope-derived once permissions cover screens. " +
      "Down from three the day the gate started measuring CODE instead of prose: the third file " +
      "(/api/invoice/continuity) only mentioned it in a comment, so the register had been " +
      "reporting a reach one file wider than the real one.",
  },
  {
    key: "rls-policy",
    klass: "canonical",
    decides: "may this CONNECTION read or write this tenant's rows",
    needle: "CREATE POLICY",
    where: "migrations",
    ceiling: 99,
    note: "An enforcement LAYER, not a second policy. It answers a different question from " +
      "authorize() and both answers are needed — see the header. Grows with the schema.",
  },
  {
    key: "rpc-caller-guard",
    klass: "canonical",
    decides: "may this caller act for this p_user_id inside a money function",
    needle: "auth.uid() IS NOT NULL AND auth.uid() <>",
    where: "migrations",
    ceiling: 99,
    note: "The floor under every money RPC, and the reason a service-role client cannot quietly " +
      "act for a stranger. An enforcement layer; grows with the money functions.",
  },
  {
    key: "frontend-organization",
    klass: "forbidden",
    decides: "nothing — it is the client naming its own tenant",
    needle: "headers().get(\"x-organization",
    where: "src",
    ceiling: 0,
    note: "An acting organization supplied by the browser is not a fact. Ceiling zero, forever.",
  },
];

/** The classes whose reach may never grow. */
export const FROZEN_CLASSES: readonly AccessClass[] = ["transitional", "legacy", "forbidden"];

export function mechanism(key: string): AccessMechanism | undefined {
  return ACCESS_REGISTER.find((m) => m.key === key);
}

/**
 * ── WHICH DOOR ASKS FOR WHICH PROTECTED OPERATION ───────────────────────────────────────────
 *
 * A catalogue nobody asks is a document, not a policy. §38 of the specification says a protected
 * operation may never rest on "there is a session"; this is the measured half of that claim, and
 * the gate reads it both ways:
 *
 *   · every file named here must really contain that permission, spelled exactly — so the list
 *     cannot quietly describe a migration that was reverted;
 *   · every protected operation must appear in exactly ONE of these two maps — so a capability
 *     cannot be forgotten, only declared as not yet having a door, with a reason.
 *
 * Paths, not route URLs: the gate opens the file.
 */
export const PROTECTED_DOORS: Readonly<Record<string, readonly string[]>> = {
  // The number and the mail: one handler, two capabilities, asked for at the two lines where each
  // one happens. Art. 35 makes the number irreversible, which is why finalising has its own name.
  "invoice.finalize": ["src/app/api/invoice/send/route.ts"],
  "invoice.send": ["src/app/api/invoice/send/route.ts"],
  "invoice.credit": ["src/app/api/invoice/creditnota/route.ts"],
  // Two doors say "this invoice is paid": the owner's toggle and the confirm-with-payment on an
  // incoming invoice. Both write through apply_manual_payment ([EEN-SCHRIJFPAD]).
  "payment.create": [
    "src/app/api/invoice/pay-toggle/route.ts",
    "src/app/api/email/confirm/[id]/route.ts",
  ],
  "payment.refund": ["src/app/api/mollie/terugbetaling/route.ts"],
  // Moving a payment between invoices, booking a bank line against one, and undoing a reversed
  // direct debit are the same capability seen from three sides: which invoice does this money sit
  // against.
  "payment.allocate": [
    "src/app/api/invoice/payment/move/route.ts",
    "src/app/api/bank/allocate/route.ts",
    "src/app/api/bank/storno/route.ts",
  ],
  "bank.match": [
    "src/app/api/bank/confirm/route.ts",
    "src/app/api/bank/line-invoice/route.ts",
  ],
  // Filing a quarter declares it AND freezes it; the DELETE is the only thing that undoes the
  // freeze. Three names, one handler, because that is what the product actually does.
  "vat.submit": ["src/app/api/btw/file/route.ts"],
  "period.close": ["src/app/api/btw/file/route.ts"],
  "period.reopen": ["src/app/api/btw/file/route.ts"],
  // The owner approves their own purchase invoices; a mandated accountant approves the client's,
  // and the CONFIRMING switch is what proves it (MANDATE_PROOF).
  "expense.approve": [
    "src/app/api/email/confirm/[id]/route.ts",
    "src/app/api/accountant/bevestig/route.ts",
  ],
};

/**
 * The protected operations that have no door on the catalogue yet, and why.
 *
 * Pinned EXACTLY by the gate, like a frozen class: closing one of these is a visible edit here,
 * and adding one is a decision somebody has to write down rather than a silence.
 */
export const PROTECTED_WITHOUT_DOOR: Readonly<Record<string, string>> = {
  "access.member_invite":
    "/api/invite and the team screen. Inviting a member is guarded by requireOwner today and is " +
    "the next batch: access control itself is exactly where one vocabulary pays off, but it is " +
    "not a money path, so the money paths went first.",
  "access.member_revoke":
    "Same door, same batch. Revoking is the half that must never fail open — it is what the " +
    "owner reaches for when somebody leaves — so it moves together with inviting, not before it.",
  "access.mandate_grant":
    "/api/accountant/invoice-mandate. The grant is already the narrowest path in the app (kind, " +
    "link, role and revocation, all four, on every call) and it proves its own facts; migrating " +
    "it is a rewording, and a rewording of the mandate rule is not something to do in the same " +
    "commit as ten money routes.",
  "access.mandate_revoke":
    "/api/accountant/unlink and unlink-by-client. Same reason, and the same batch as the grant: " +
    "the two halves of one switch do not move separately.",
};
