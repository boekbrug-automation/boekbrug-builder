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

// ── The backlog half: a classification nobody is assigned to act on is a note ────────────────

test("[DIENST-SLEUTEL] every unproven route is on the backlog, with an owner and a batch", async () => {
  const { SERVICE_ROLE_BACKLOG, BACKLOG_BATCHES } = await import("./service-role-register");

  const unproven = SERVICE_ROLE_ROUTES.filter((r) => r.klass === "unproven").map((r) => r.route).sort();
  const onBacklog = SERVICE_ROLE_BACKLOG.map((b) => b.route).sort();
  assert.deepEqual(onBacklog, unproven,
    "the backlog and the unproven class have drifted apart — a route with no reason and no owner " +
      "is exactly the permanent state this list exists to prevent");

  for (const b of SERVICE_ROLE_BACKLOG) {
    assert.ok(b.owner.trim().length >= 4 && b.owner !== "UNASSIGNED",
      `${b.route} has no owner — "somebody will" is not an owner`);
    assert.ok(b.evidenceNeeded.trim().length >= 30,
      `${b.route} names no measurement that would let it move; an intention is not evidence`);
    // Nobody may predict a route into a friendlier class before the evidence exists.
    assert.equal(b.expectedClass, "unproven",
      `${b.route} is already marked as landing in ${b.expectedClass}. A row changes class after ` +
        "the measurement, not before it — guessing is how a survey becomes a story.");
  }

  const counts: Record<string, number> = {};
  for (const b of SERVICE_ROLE_BACKLOG) counts[b.batch] = (counts[b.batch] ?? 0) + 1;
  for (const [batch, n] of Object.entries(BACKLOG_BATCHES)) {
    assert.equal(counts[batch] ?? 0, n, `batch ${batch} holds ${counts[batch] ?? 0}, pinned at ${n}`);
  }
  assert.equal(
    Object.values(BACKLOG_BATCHES).reduce((a, b) => a + b, 0),
    unproven.length,
    "the batches do not add up to the unproven class — a route is in no batch, or in two",
  );
});

test("[DIENST-SLEUTEL] every measured RLS gap is judged, and a gap that IS the design says so", async () => {
  const { RLS_GAP_REMEDIATION } = await import("./service-role-register");

  // Every route in the rls-gap class must appear in the remediation list. The reverse is not
  // required: one table can be half-closeable (invitations), which is two rows for one class entry.
  const gapRoutes = new Set(SERVICE_ROLE_ROUTES.filter((r) => r.klass === "rls-gap").map((r) => r.route));
  const judged = new Set(RLS_GAP_REMEDIATION.flatMap((g) => g.routes));
  for (const r of gapRoutes) {
    assert.ok(judged.has(r),
      `${r} is classified rls-gap but the remediation list never judges it — "the command has no ` +
        'policy" is a measurement, not a verdict');
  }

  for (const g of RLS_GAP_REMEDIATION) {
    assert.ok(g.why.trim().length >= 40, `${g.table}.${g.command} is judged without a reason`);
    if (g.verdict === "close-with-policy") {
      assert.ok(g.policyShape.trim().length >= 15,
        `${g.table}.${g.command} is meant to be closed but names no policy shape — then nobody ` +
          "can close it");
    } else {
      assert.equal(g.policyShape, "",
        `${g.table}.${g.command} is the design AND carries a policy shape. Writing that policy ` +
          "would widen access to everyone; the empty string is the point.");
    }
  }
  // Both verdicts must actually occur, or the distinction is decorative.
  const kinds = new Set(RLS_GAP_REMEDIATION.map((g) => g.verdict));
  assert.ok(kinds.has("close-with-policy") && kinds.has("is-the-design"),
    "the remediation list has collapsed to one verdict — the two kinds of gap are the finding");
});

test("[DIENST-SLEUTEL] the limits of the production measurement stay written down", async () => {
  const mod = await import("./service-role-register");
  assert.ok(typeof mod.WRITE_SIDE_NOT_PROVEN === "string" && mod.WRITE_SIDE_NOT_PROVEN.length > 60,
    "the note that read parity is not write safety was removed. It is the one sentence that stops " +
      "a measured read from being reported as a finished migration.");
  const src = readFileSync("src/lib/access/service-role-register.ts", "utf8");
  assert.match(src, /does not prove/i, "the register stopped saying what the measurement did NOT prove");
  assert.match(src, /staging/i, "the register no longer names what WOULD prove the write side");
});
