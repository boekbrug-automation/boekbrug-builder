// src/lib/invite-token.ts
// [ACTING-FOR] One way to turn an invitation secret into the thing the table stores.
// Run: npx tsx --test src/lib/invite-token.test.ts
//
// ── WHY A MODULE FOR FOUR LINES ─────────────────────────────────────────────────────────────
//
// Because two call sites have to agree exactly, forever, and they sit in different files: the
// route that CREATES an invitation hashes the secret before writing it, and the route that ACCEPTS
// one hashes the secret from the link before looking it up. The day those two disagree about
// encoding, trimming or case, every invitation stops working — and it stops working silently, as
// "deze uitnodiging is niet (meer) geldig", which reads exactly like an expired link.
//
// So the hash lives in one function, with one test, and neither route gets to have an opinion.
//
// ── WHY A BARE SHA-256 AND NOT A PASSWORD HASH ──────────────────────────────────────────────
//
// bcrypt/argon2 exist to make GUESSING expensive, for secrets a human chose. This secret is 32
// bytes from randomBytes: there is nothing to guess and no dictionary to run. What is needed here
// is only that a stolen table cannot be turned back into working links, and a one-way function
// does that. A slow hash would also have to be run on every accept attempt, which is a login-
// shaped endpoint — the cost would land on us, not on an attacker.
//
// The secret is not user-chosen, so there is no salt either: an unsalted hash of 32 random bytes
// has no rainbow table, and a per-row salt would make the lookup impossible (you cannot find the
// row without already knowing which row to salt with).

import { createHash } from "node:crypto";

/**
 * The value stored in company_member_invites.token_hash.
 *
 * Trimmed, because a token travels through a URL and a mail client and comes back with whitespace
 * often enough that a leading space must not be the difference between a working invitation and a
 * dead one. Nothing else is normalised: the secret is base64url out of randomBytes, so case is
 * meaningful and lowercasing it would throw away entropy.
 */
export function hashInviteToken(secret: string): string {
  return createHash("sha256").update(secret.trim(), "utf8").digest("hex");
}
