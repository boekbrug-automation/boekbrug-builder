// [DIENST-SLEUTEL] Pure node test — run: npx tsx --test src/lib/access/service-role-register.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";

import {
  SERVICE_ROLE_ROUTES, SERVICE_ROLE_CEILINGS, UNPROVEN_ORDER,
  type ServiceRoleClass,
} from "./service-role-register";

// The money line has its own gate ([RLS-UIT] in lifecycle-gates.test.ts), which reads every
// service-role query there and asserts an owner filter. This register is about everything else.
const MONEY_LINE = [
  "src/app/api/invoice", "src/app/api/pay", "src/app/api/documents", "src/app/api/email",
  "src/app/api/mollie", "src/app/api/intake", "src/app/api/aangifte", "src/app/api/readiness",
  "src/app/api/result", "src/app/api/accountant", "src/app/api/btw", "src/app/api/snelstart",
];

function routesHoldingTheKey(): string[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  return walk("src/app/api")
    .filter((f) => f.endsWith("route.ts"))
    .filter((f) => /createPipelineClient|SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8")))
    .filter((f) => !MONEY_LINE.some((r) => f.startsWith(r + "/")))
    .map((f) => f.replace("src/app/api/", "").replace("/route.ts", ""))
    .sort();
}

test("[DIENST-SLEUTEL] every route that holds the service-role key is classified, and nothing else is", () => {
  const measured = routesHoldingTheKey();
  const declared = SERVICE_ROLE_ROUTES.map((r) => r.route).sort();

  const missing = measured.filter((r) => !declared.includes(r));
  assert.deepEqual(missing, [],
    "a route picked up the service-role key and nobody said why. Classify it in " +
      "service-role-register.ts: it either runs without a session, needs a command RLS has no " +
      "policy for, reads the other side of a pairing, is refused by a trigger — or it is a bypass " +
      "that should not exist.");

  const stale = declared.filter((r) => !measured.includes(r));
  assert.deepEqual(stale, [],
    "these are classified but no longer hold the key — remove them and lower the ceiling, that " +
      "is what closing a bypass looks like here");
});

test("[DIENST-SLEUTEL] each class holds exactly the number of routes it is pinned to", () => {
  const counts: Record<string, number> = {};
  for (const r of SERVICE_ROLE_ROUTES) counts[r.klass] = (counts[r.klass] ?? 0) + 1;

  for (const [klass, ceiling] of Object.entries(SERVICE_ROLE_CEILINGS)) {
    const n = counts[klass] ?? 0;
    assert.equal(n, ceiling,
      `${klass} holds ${n} routes and its ceiling says ${ceiling}. ` +
        (klass === "unproven"
          ? "If you closed one, lower this. If you added one, you added a bypass."
          : "Moving a route between classes is a decision; make it visible here."));
  }
  // Nothing may be classified under a name the type does not know.
  for (const r of SERVICE_ROLE_ROUTES) {
    assert.ok(Object.prototype.hasOwnProperty.call(SERVICE_ROLE_CEILINGS, r.klass),
      `${r.route} is classified as ${r.klass}, which has no ceiling`);
  }
});

test("[DIENST-SLEUTEL] a reason is a fact, not a word", () => {
  for (const r of SERVICE_ROLE_ROUTES) {
    assert.ok(r.why.trim().length >= 20,
      `${r.route} says "${r.why}" — a class without the fact behind it is the same silence in a ` +
        "different font");
  }
  assert.ok(UNPROVEN_ORDER.length >= 3, "the order to close the bypasses in went missing");
});

test("[DIENST-SLEUTEL] a route called trusted-server really has no session to use", () => {
  // The class that would be easiest to claim falsely: "there is no session here" is exactly what
  // somebody would write about a route that has one. Each of these must name a credential that is
  // NOT a session — a cron secret, a provider signature, or a per-row token.
  const CREDENTIAL = /CRON_SECRET|constructEvent|stripe-signature|\.eq\(\s*["'`]\w*token["'`]|params\.token|share_token|pay_token/;
  for (const r of SERVICE_ROLE_ROUTES.filter((x) => x.klass === "trusted-server")) {
    const src = readFileSync(`src/app/api/${r.route}/route.ts`, "utf8");
    assert.match(src, CREDENTIAL,
      `${r.route} is classified trusted-server but names no credential of its own — if it has a ` +
        "session, it belongs in another class");
  }
});

test("[DIENST-SLEUTEL] the classes stay the six that were decided", () => {
  // A seventh class is how "we have not looked at this one" becomes a category.
  const klassen: ServiceRoleClass[] = [
    "trusted-server", "system-wide", "rls-gap", "other-party", "guard-trigger", "unproven",
  ];
  assert.deepEqual(Object.keys(SERVICE_ROLE_CEILINGS).sort(), [...klassen].sort());
});
