// src/lib/profile-read.ts
// [PROFILE-READ] Three answers to "who is this?", kept apart — pure, no I/O.
// Run: npx tsx --test src/lib/profile-read.test.ts
//
// ── WHY THIS EXISTS ──
// The gate reads `profiles` three times on the way to the home: the middleware, /dashboard/page.tsx
// and /onboarding/page.tsx. All three used `.single()` and looked only at `data`, so a read that
// FAILED and a row that is MISSING were the same null — and the three readers drew three different
// conclusions from it. The middleware let the request through as if onboarding were done, the home
// page redirected to the wizard as if it were not, and the wizard INSERTED a fresh step-1 profile
// as if the person had just registered. One refused or timed-out read walked a completed owner back
// into a wizard, over a profile that exists.
//
// supabase-js never throws: `{ data: null, error }` is the only shape a failure has. So the
// distinction has to be drawn where the answer is read, and drawn once — here.
//
// ── THE THREE ANSWERS ──
//   row      the profile, exactly as stored.
//   missing  the read SUCCEEDED and there is no row: a fresh account whose trigger did not fire.
//            The one case in which creating a profile is right.
//   failed   we could not look. Never "missing": creating a row on top of a read that failed is the
//            write nobody asked for, and sending the person into the wizard is the redirect nobody
//            asked for. The caller says so and stops ([NO-SILENT-EMPTY]).
//
// `.maybeSingle()` answers "missing" as `data: null` with no error. `.single()` reports the same
// case as PGRST116 ("JSON object requested, multiple (or no) rows returned"); that code is read as
// missing too, so a caller that still uses `.single()` gets the same three answers.

/** PostgREST's code for "the object you asked for is not there" — a fact about the data, not a failure. */
export const NO_ROWS_CODE = "PGRST116";

/** The part of a supabase-js error this decision needs. Structural, so no client type is imported. */
export interface ReadError {
  code?: string | null;
  message?: string | null;
}

export type ProfileRead<T> =
  | { kind: "row"; row: T }
  | { kind: "missing" }
  | { kind: "failed"; code: string | null; message: string };

/**
 * One read, three answers. `error` is judged before `data`: a row that arrives beside an error is
 * not a row anyone verified, and supabase-js does not produce that pair on a successful read.
 *
 * Generic on the RESPONSE rather than on the row: a supabase-js response is a union (a success with
 * `error: null`, a failure with `data: null`), and inferring the row through `T | null` from that
 * union lands on `never` or keeps the null. Indexing the response's own `data` and dropping its
 * null is exact for a typed client and for an untyped one alike.
 */
export function classifyProfileRead<R extends { data: unknown; error: ReadError | null | undefined }>(
  res: R,
): ProfileRead<NonNullable<R["data"]>> {
  const { data, error } = res;
  if (error) {
    if (error.code === NO_ROWS_CODE) return { kind: "missing" };
    return { kind: "failed", code: error.code ?? null, message: error.message ?? "unknown error" };
  }
  if (data === null || data === undefined) return { kind: "missing" };
  return { kind: "row", row: data as NonNullable<R["data"]> };
}
