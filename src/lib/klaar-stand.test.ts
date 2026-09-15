// [KLAAR-STAND] Pure node test — run: npx tsx src/lib/klaar-stand.test.ts
// The line the dashboard button shows, from the readiness verdict. Pure, no I/O.
import { klaarRegel } from "./klaar-stand";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— the three verdicts —");
check("ready → the state, no count",
  klaarRegel({ status: "ready", missing: [], risks: [] }).key === "start.klaar.ready");
check("ready is green", klaarRegel({ status: "ready" }).kleur === "#137333");
check("almost → its own key",
  klaarRegel({ status: "almost", missing: [1, 2], risks: [3] }).key === "start.klaar.almost");
check("attention → its own key",
  klaarRegel({ status: "attention", missing: [1], risks: [] }).key === "start.klaar.attention");

console.log("\n— the count is missing PLUS risks: on a button they are one number —");
check("2 missing + 1 risk = 3",
  klaarRegel({ status: "almost", missing: [1, 2], risks: [3] }).params.count === 3);
check("risks alone still count",
  klaarRegel({ status: "attention", missing: [], risks: [1, 2] }).params.count === 2);
check("neither list present → 0, not a crash",
  klaarRegel({ status: "almost" }).params.count === 0);
check("a non-array list is not counted",
  klaarRegel({ status: "almost", missing: "kapot" as unknown, risks: [1] }).params.count === 1);

console.log("\n— [NO-SILENT-EMPTY] an absent or unknown verdict is NEVER rendered as one —");
check("null → the question stays", klaarRegel(null).key === "start.waarheid.sub");
check("undefined → the question stays", klaarRegel(undefined).key === "start.waarheid.sub");
check("null is 'unknown', so the dot is not drawn", klaarRegel(null).stand === "unknown");
check("a status this app does not know is not a verdict",
  klaarRegel({ status: "brandnew" }).key === "start.waarheid.sub");
check("a non-string status is not a verdict",
  klaarRegel({ status: 3 }).key === "start.waarheid.sub");
// The one that matters most: nothing may turn an unmeasured quarter green.
check("no unknown input can produce the ready key", [null, undefined, {}, { status: "" }, { status: "READY" }]
  .every((b) => klaarRegel(b as never).key !== "start.klaar.ready"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
