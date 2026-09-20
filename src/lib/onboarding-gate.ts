// src/lib/onboarding-gate.ts
// [ONBOARDING-GATE] Does this request get past the onboarding check? The whole rule, no I/O.
// Run: npx tsx --test src/lib/onboarding-gate.test.ts
//
// ── WHY THIS IS A SEPARATE, TESTED FILE AND NOT FOUR LINES IN THE MIDDLEWARE ──
// The middleware has no tests of its own (see src/lib/mfa.ts for the same reasoning about the
// other gate that lives there). The first version of the [PROFILE-READ] correction let a FAILED
// profile read fall through on every /dashboard route, on the argument that /dashboard/page.tsx
// classifies the same read again and refuses honestly. That argument holds for the home and for
// nothing else: /dashboard/bank, /dashboard/facturen, /dashboard/kas and the rest rely on THIS
// gate and never re-read onboarding_done. One unreadable profile therefore opened every deep
// route as though the gate had passed — fail-open, on a deep link, which is exactly the shape a
// gate must not have. A missing row fell through the same way, past the wizard that creates it.
//
// ── THE RULE ──
//   row, onboarding_done = true   → allow
//   row, onboarding_done = false  → /onboarding
//   missing                       → /onboarding (the wizard creates the row — see onboarding/page.tsx)
//   failed                        → never an onboarding decision, and never a deeper route:
//                                   · exactly /dashboard  → allow. That page classifies the read
//                                     itself and throws to its error boundary when it fails, which
//                                     is the honest screen ("Er ging iets mis", with a retry).
//                                   · anything deeper     → /dashboard, so the same honest screen
//                                     answers the deep link instead of a page that trusted the gate.
//
// Never /onboarding on a failed read: that is the original bug — a completed owner walked into the
// wizard because a read timed out. The home is the one place that can fail without deciding.
//
// The invariant every branch below serves:
//   an unreadable profile is never read as onboarding state, and never opens a deeper dashboard
//   route as though the gate had succeeded.

import type { ProfileRead } from "./profile-read";

/** Where an unreadable profile is sent to fail honestly, and the one path that may continue on it. */
export const HOME_PATH = "/dashboard";
export const ONBOARDING_PATH = "/onboarding";

export type OnboardingGate =
  | { action: "allow" }
  | { action: "redirect"; to: typeof ONBOARDING_PATH | typeof HOME_PATH };

const ALLOW: OnboardingGate = { action: "allow" };
const TO_ONBOARDING: OnboardingGate = { action: "redirect", to: ONBOARDING_PATH };
const TO_HOME: OnboardingGate = { action: "redirect", to: HOME_PATH };

/** The one column this decision reads. `null` is "not done": the trigger writes false, never null. */
export interface OnboardingRow {
  onboarding_done: boolean | null;
}

export function onboardingGate(args: { read: ProfileRead<OnboardingRow>; pathname: string }): OnboardingGate {
  const { read, pathname } = args;
  // A trailing slash is the same page; Next normalises it, but this gate does not depend on that.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  switch (read.kind) {
    case "row":
      return read.row.onboarding_done === true ? ALLOW : TO_ONBOARDING;
    case "missing":
      return TO_ONBOARDING;
    case "failed":
      return path === HOME_PATH ? ALLOW : TO_HOME;
  }
}
