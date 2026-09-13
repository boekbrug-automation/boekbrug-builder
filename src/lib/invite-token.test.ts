// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/invite-token.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { hashInviteToken } from "./invite-token";

test("[ACTING-FOR] the same secret always yields the same hash, from either route", () => {
  // This is the whole reason the function exists: the route that CREATES an invitation and the
  // route that ACCEPTS one must agree exactly, forever, from two different files. The day they
  // disagree, every invitation dies silently as "niet (meer) geldig".
  const secret = "xK3n_9pQr-2sT4uV6wX8yZ0aB1cD3eF5gH7iJ9kL1mN";
  assert.equal(hashInviteToken(secret), hashInviteToken(secret));
  assert.match(hashInviteToken(secret), /^[0-9a-f]{64}$/, "not a hex sha-256");
});

test("[ACTING-FOR] the hash is not the secret", () => {
  const secret = "xK3n_9pQr-2sT4uV6wX8yZ0aB1cD3eF5gH7iJ9kL1mN";
  const hash = hashInviteToken(secret);
  assert.notEqual(hash, secret);
  assert.ok(!hash.includes(secret.slice(0, 8)), "part of the secret survived into the stored value");
});

test("[ACTING-FOR] surrounding whitespace is forgiven, case is not", () => {
  const secret = "AbCdEf123";
  // A token travels through a URL and a mail client and comes back with a stray space often
  // enough that whitespace must not be the difference between a working link and a dead one.
  assert.equal(hashInviteToken(` ${secret}\n`), hashInviteToken(secret));
  // …but case carries entropy. base64url is case-sensitive; folding it would throw half of it away.
  assert.notEqual(hashInviteToken(secret.toLowerCase()), hashInviteToken(secret));
});

test("[ACTING-FOR] two different secrets never collide into one invitation", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) seen.add(hashInviteToken(`secret-${i}`));
  assert.equal(seen.size, 500);
});
