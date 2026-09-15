// src/lib/oauth-log.test.ts — run: npx tsx --test src/lib/oauth-log.test.ts
//
// [OAUTH-GEEN-TOKEN-IN-LOG] The refresh path logged the provider's whole answer. A token endpoint
// answers with credentials — and the branch that logged the most was the one for "no access_token
// came back", which is precisely where a rotated refresh_token or an id_token still sits.
import test from "node:test";
import assert from "node:assert/strict";
import { safeOAuthLog } from "./email-integration";

const GEHEIM = [
  "access_token", "refresh_token", "id_token", "client_secret", "code", "assertion",
];

test("[OAUTH-GEEN-TOKEN-IN-LOG] no credential value survives, whatever the shape", () => {
  const antwoord = {
    token_type: "Bearer",
    expires_in: 3599,
    refresh_token: "1//09-THIS-IS-A-LIVE-CREDENTIAL",
    id_token: "eyJhbGciOiJSUzI1NiIsImtpZCI6IlLIVE",
    access_token: "ya29.a0-LIVE",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
  };
  const log = JSON.stringify(safeOAuthLog(antwoord));
  for (const waarde of [antwoord.refresh_token, antwoord.id_token, antwoord.access_token])
    assert.ok(!log.includes(waarde), `the log still contains ${waarde.slice(0, 12)}…`);
  // The names are kept: "what did it send back?" stays answerable without the values.
  assert.match(log, /refresh_token/, "the key NAMES are what makes the log useful");
});

test("[OAUTH-GEEN-TOKEN-IN-LOG] the documented error fields are kept — that is the whole point", () => {
  // RFC 6749 §5.2. Without these a reader cannot tell a dead grant from a rate limit, and the
  // needs_reauth decision downstream is the thing the owner actually feels.
  const log = safeOAuthLog('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}');
  assert.equal(log.error, "invalid_grant");
  assert.match(String(log.error_description), /expired or revoked/);
});

test("[OAUTH-GEEN-TOKEN-IN-LOG] an unparseable body is reported by size, never by content", () => {
  // An HTML error page or a truncated response is exactly where a surprise payload hides.
  const log = safeOAuthLog("<html><body>Bearer ya29.a0-LIVE-IN-AN-ERROR-PAGE</body></html>");
  const tekst = JSON.stringify(log);
  assert.ok(!tekst.includes("ya29"), "a non-JSON body must not be printed");
  assert.equal(typeof log.bodyBytes, "number");
});

test("[OAUTH-GEEN-TOKEN-IN-LOG] junk in, no throw out — a logger may never break the path it logs", () => {
  for (const rommel of [null, undefined, 42, "", "not json at all", { }, [1, 2]])
    assert.doesNotThrow(() => JSON.stringify(safeOAuthLog(rommel)), String(rommel));
});

test("[OAUTH-GEEN-TOKEN-IN-LOG] a credential-shaped key added next month is still not printed", () => {
  // The rule is allow-list, not deny-list: a provider that starts returning `device_secret`
  // must not need a code change here to stay out of the log.
  const log = JSON.stringify(safeOAuthLog({ device_secret: "SECRET-VALUE", error: "invalid_grant" }));
  assert.ok(!log.includes("SECRET-VALUE"), "only the documented error fields are copied by value");
  assert.match(log, /device_secret/, "…and its presence is still reported by name");
  for (const k of GEHEIM) {
    const l = JSON.stringify(safeOAuthLog({ [k]: "LIVE-" + k }));
    assert.ok(!l.includes("LIVE-" + k), `${k} leaked`);
  }
});
