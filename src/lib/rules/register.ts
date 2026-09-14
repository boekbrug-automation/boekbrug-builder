// src/lib/rules/register.ts
// [REGEL-DEUR] Which doors must ask which rule — derived from the repository, never listed.
// Pure data + one pure derivation. No I/O beyond reading source files in the gate.
//
// ── WHAT THIS IS, AND WHAT IT REFUSES TO BE ─────────────────────────────────────────────────
//
// The Rules survey measured the gap precisely, and it was not a shortage of rules: 111 of the
// 139 modules that carry a decision are already pure, and 151 of the 670 route refusals already
// delegate to one. Two things were missing, and only two:
//
//   · a rule cannot say whether it BLOCKS or merely warns — the caller decides, so one shape
//     becomes a 409 in a route and a grey button in a screen;
//   · nothing records WHICH DOORS must ask a given rule, so a rule can be written, gated, and
//     reach no call site at all. factuurstaat.ts and autonomy-scope.ts are both in that state
//     today: pure, argued, gated, and imported by nothing in the product.
//
// This file closes the second one. It is not a rule engine and it holds no business logic: every
// rule named here already exists, in the module named as its owner.
//
// ── THE ONE DESIGN CONSTRAINT, AND WHY IT IS NOT NEGOTIABLE ─────────────────────────────────
//
// The obvious shape is `doorsThatMustAsk: ["api/email/upload", "api/intake", …]`. That replaces
// one problem — a rule with no caller — with a worse one: a door name spelled wrong in a
// register, which reads exactly like a door that is covered. The list would then be the thing
// everyone trusts and nobody re-derives.
//
// So a door set is a QUERY, never a list. `protects` says what the rule stands in front of —
// "a write into invoices whose body sets direction:'incoming'" — and the gate runs that query
// over src/ on every run. A new door that performs the write is IN the set the moment it is
// written, whether or not anyone remembered this file.
//
// `excused` is the only list, and it is the opposite of a door list: it names the files the
// query FINDS and that legitimately do not ask, each with the reason. The gate checks it in both
// directions, so an excuse for a file that no longer performs the write goes red rather than
// standing next to reasons that still hold.
//
// This is not a new mechanism. [EEN-SCHRIJFPAD] has worked exactly this way since Phase 0 — it
// walks src/, finds every write of the paid state, and compares that derived set against
// BETAALD_SCHRIJVERS. What this file adds is that the shape stops being one gate's private idea.
//
// ── WHAT THIS CANNOT PROVE, SAID HERE RATHER THAN DISCOVERED LATER ──────────────────────────
//
// Five ways a door/rule relationship can be false, and how far this reaches:
//
//   1. the door path does not resolve ............ proved (the query only yields real files)
//   2. the door does not call the rule ........... proved (needle over comment-stripped source)
//   3. it calls a different helper instead ....... proved (the needle names the owner's export)
//   4. the door moved or was renamed ............. proved (the query re-runs; excuses go stale)
//   5. the call sits in unreachable code ......... NOT fully provable without a parser
//
// For (5) this reaches two things and no further: the call is not inside a comment, and — where
// the rule IS an order — it appears BEFORE the write it guards. A call in a branch that can
// never run would still pass. That is a real limit and it is written down here, because a
// register that overclaims its own coverage is the failure this whole layer exists to end.

/** A rule that already exists somewhere in this app, named so a door can be held to it. */
export type RuleId =
  /** [LEVERANCIER-INTAKE] Is this supplier's account number the one we know for them? */
  | "iban-change"
  /** [PAY-SLEUTEL-ALTIJD] Is this booking the same one we already made? */
  | "manual-pay-key";

/**
 * How the set of doors is DERIVED. Never a list of paths.
 *
 * `writes` is the shape [EEN-SCHRIJFPAD] proved: a `.update/.insert/.upsert({…})` whose NEAREST
 * PRECEDING `.from("…")` names the table, and whose body matches. The nearest-preceding rule is
 * load-bearing — a file may touch five tables, and "does this file mention invoices" answered for
 * 33 files, nearly all of them readers.
 */
export type DoorQuery =
  | { kind: "writes"; table: string; body: RegExp }
  | { kind: "calls"; needle: RegExp };

export interface RuleEntry {
  /** The question, in one English sentence. */
  question: string;
  /** The module that OWNS the decision. Must resolve to a real file. */
  owner: string;
  /** What the rule stands in front of — the query that yields the doors. */
  protects: DoorQuery;
  /** The real invocation a door must contain. Names the owner's export, not a synonym. */
  mustCall: RegExp;
  /**
   * When the rule IS an order, the marker the call must PRECEDE. Without this, a door that asks
   * the question after it has already acted passes — and for iban-change that is the whole
   * defect: resolution can attach the number printed on this invoice to the supplier, and the
   * check then compares a forged account against itself.
   */
  mustPrecede?: RegExp;
  /** Where the answer actually stops something. Recorded so "display-only" can never hide here. */
  enforcement: "route" | "rpc" | "trigger";
  /** Files the query finds that legitimately do not ask. Path → the reason, in full. */
  excused: Readonly<Record<string, string>>;
}

export const RULE_REGISTER: Readonly<Record<RuleId, RuleEntry>> = {
  "iban-change": {
    question: "Is the account number on this incoming invoice the one we know for this supplier?",
    owner: "src/lib/intake-supplier.ts",
    // Every door that brings a purchase invoice into the books. Derived from the write itself,
    // so a sixth door is in this set the day it is written.
    protects: { kind: "writes", table: "invoices", body: /direction\s*:\s*["']incoming["']/ },
    mustCall: /resolveSupplierAtIntake|detectIbanChange/,
    // The order IS the rule — see intake-supplier.ts's own header.
    mustPrecede: /direction\s*:\s*["']incoming["']/,
    enforcement: "route",
    excused: {
      "src/lib/mollie-settlement-sync.ts":
        "Creates the Mollie FEE invoice, whose supplier is Mollie itself: it calls " +
        "resolveSupplierForImport with a name and no iban argument at all. There is no printed " +
        "account number on a document from a third party to compare against anything, so the " +
        "check has no subject here rather than being skipped. If this door ever starts reading " +
        "a vendor IBAN off a document, this excuse stops being true and must be removed.",
    },
  },

  "manual-pay-key": {
    question: "Is this manual payment the same booking we already made?",
    owner: "src/lib/contracts/idempotency.ts",
    // Every caller of the money RPC that takes the key. A caller that passes null gets no
    // deduplication at all — apply_manual_payment's replay branch is `IF p_client_key IS NOT NULL`.
    protects: { kind: "calls", needle: /apply_manual_payment/ },
    mustCall: /p_client_key:\s*(?!null)/,
    enforcement: "rpc",
    excused: {
      "src/types/database.types.ts":
        "The generated Supabase types. It names p_client_key because it DECLARES the RPC's " +
        "signature, and it calls nothing. Excluding generated types by path pattern instead " +
        "would excuse every future generated file from every rule, silently.",
    },
  },
};

export const RULE_IDS = Object.keys(RULE_REGISTER) as RuleId[];

/**
 * The rules this register deliberately does NOT hold, and why — so a reader does not conclude
 * that two entries is the whole money line.
 *
 * [EEN-SCHRIJFPAD] already derives the doors that write the paid state and compares them against
 * its own excused list, and it has done so since Phase 0. Re-registering that rule here would
 * create the one thing this layer exists to prevent: two answers to one question, drifting apart
 * the first time somebody updates only one of them. It is named here as the precedent this file
 * generalises, and it stays where it is until there is a reason to move it.
 */
export const ENFORCED_ELSEWHERE: Readonly<Record<string, string>> = {
  "paid-state":
    "src/lib/lifecycle-gates.test.ts — [EEN-SCHRIJFPAD] only the named doors write the paid " +
    "state of an invoice. Same derivation, same both-ways excused list, shipped first.",
};
