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
    needle: "from \"./decision\"",
    where: "src",
    ceiling: 99,
    note: "One policy definition. Meant to grow for the same reason.",
  },
  {
    key: "requireOwner",
    klass: "transitional",
    decides: "refuses a sales member at a door that was never rebuilt for them",
    needle: "requireOwner",
    where: "api",
    ceiling: 31,
    note: "Correct and deliberate (owner-only.ts explains the choice per route), but it is a " +
      "role test where the platform now has permissions. Each route migrated to " +
      "requirePermission lowers this by one; none may be added.",
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
    ceiling: 3,
    note: "A navigation hint, not a boundary — the middleware header says so, and RLS is what " +
      "actually gives a member nothing. It becomes scope-derived once permissions cover screens.",
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
