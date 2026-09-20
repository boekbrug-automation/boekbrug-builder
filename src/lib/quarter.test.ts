// [QUARTER] Pure node test — run: npx tsx src/lib/quarter.test.ts
import { lastCompletedQuarter, quarterFromParams, quarterKeyOf, quarterLabelOf, quartersPresent, matchesQuarter, crossQuarterPayment, isPeriodStarted, currentQuarter } from "./quarter";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

console.log("\n— lastCompletedQuarter —");
check("mid-Q3 (Jul) → Q2 same year", JSON.stringify(lastCompletedQuarter(at("2026-07-13"))) === JSON.stringify({ year: 2026, quarter: 2 }));
check("mid-Q1 (Feb) → Q4 previous year", JSON.stringify(lastCompletedQuarter(at("2026-02-10"))) === JSON.stringify({ year: 2025, quarter: 4 }));
check("start of Q1 (1 Jan) → Q4 previous year", JSON.stringify(lastCompletedQuarter(at("2026-01-01"))) === JSON.stringify({ year: 2025, quarter: 4 }));
check("Q4 (Nov) → Q3 same year", JSON.stringify(lastCompletedQuarter(at("2026-11-20"))) === JSON.stringify({ year: 2026, quarter: 3 }));

// [TZ] The boundary this used to get wrong. 00:30 Amsterdam on 1 January is 31 December 23:30 UTC,
// so reading getUTCMonth() put the owner in December and returned Q3 — a whole quarter wrong, on
// the night the year turns. These pin the Amsterdam day in both winter (UTC+1) and summer (UTC+2).
check(
  "1 Jan 00:30 Amsterdam (= 31 Dec 23:30 UTC) → Q4 of the year that just ended",
  JSON.stringify(lastCompletedQuarter(new Date("2025-12-31T23:30:00Z"))) === JSON.stringify({ year: 2025, quarter: 4 }),
);
check(
  "31 Dec 23:30 Amsterdam (= 22:30 UTC) is still Q4 → Q3",
  JSON.stringify(lastCompletedQuarter(new Date("2025-12-31T22:30:00Z"))) === JSON.stringify({ year: 2025, quarter: 3 }),
);
check(
  "1 Jul 00:30 Amsterdam CEST (= 30 Jun 22:30 UTC) → Q2, the quarter that just closed",
  JSON.stringify(lastCompletedQuarter(new Date("2026-06-30T22:30:00Z"))) === JSON.stringify({ year: 2026, quarter: 2 }),
);
check(
  "30 Jun 23:30 Amsterdam CEST (= 21:30 UTC) is still Q2 → Q1",
  JSON.stringify(lastCompletedQuarter(new Date("2026-06-30T21:30:00Z"))) === JSON.stringify({ year: 2026, quarter: 1 }),
);

console.log("\n— quarterFromParams: valid params win —");
{
  const params = new Map([["year", "2026"], ["quarter", "1"]]);
  const yq = quarterFromParams((k) => params.get(k) ?? null, at("2026-07-13"));
  check("explicit year/quarter honoured", yq.year === 2026 && yq.quarter === 1);
}

console.log("\n— quarterFromParams: missing/invalid → last completed —");
{
  const empty = quarterFromParams(() => null, at("2026-07-13"));
  check("no params → last completed (Q2 2026)", empty.year === 2026 && empty.quarter === 2);
  const bad = new Map([["year", "1999"], ["quarter", "9"]]);
  const yq = quarterFromParams((k) => bad.get(k) ?? null, at("2026-07-13"));
  check("out-of-range → last completed, never the absurd value", yq.year === 2026 && yq.quarter === 2);
}

console.log("\n— [BANK-QUARTER] quarterKeyOf / label / present / matches —");
{
  check("Jan → Q1", quarterKeyOf("2026-01-15") === "2026-Q1");
  check("Jun → Q2", quarterKeyOf("2026-06-20") === "2026-Q2");
  check("Jul → Q3", quarterKeyOf("2026-07-01") === "2026-Q3");
  check("Dec → Q4", quarterKeyOf("2026-12-31") === "2026-Q4");
  check("null → null", quarterKeyOf(null) === null);
  check("unparseable → null", quarterKeyOf("nonsense") === null);
  check("invalid month → null", quarterKeyOf("2026-13-01") === null);

  check("label 2026-Q2 → 'Q2 2026'", quarterLabelOf("2026-Q2") === "Q2 2026");

  const present = quartersPresent(["2026-06-20", "2026-06-21", "2026-02-10", null, "2025-11-01"]);
  check("distinct quarters, newest first", present.map((p) => p.key).join(",") === "2026-Q2,2026-Q1,2025-Q4");
  check("counts per quarter", present[0].count === 2 && present[1].count === 1);
  check("null dates excluded from the quarter list", !present.some((p) => p.key === null as unknown));

  check("'all' matches everything", matchesQuarter("2026-02-10", "all") === true);
  check("a Q2 payment matches Q2", matchesQuarter("2026-06-20", "2026-Q2") === true);
  check("a Q1 payment does NOT match Q2", matchesQuarter("2026-02-10", "2026-Q2") === false);
  check("a dateless row is fail-safe visible in any quarter", matchesQuarter(null, "2026-Q2") === true);
}

console.log("\n— [CROSS-QUARTER] crossQuarterPayment —");
{
  const q1toQ2 = crossQuarterPayment("2026-02-10", "2026-05-03");
  check("Q1 invoice paid in Q2 → marker with paid=Q2, booked=Q1",
    q1toQ2?.paidQuarterLabel === "Q2 2026" && q1toQ2?.bookedQuarterLabel === "Q1 2026");
  check("same quarter (both Q2) → null (no marker)", crossQuarterPayment("2026-04-01", "2026-06-20") === null);
  check("paid earlier quarter than booked (prepaid) still marks the difference",
    crossQuarterPayment("2026-05-01", "2026-02-01")?.paidQuarterLabel === "Q1 2026");
  check("crosses the year boundary (Q4 invoice paid next Q1)",
    crossQuarterPayment("2025-12-20", "2026-01-05")?.paidQuarterLabel === "Q1 2026");
  check("no payment_date (unpaid) → null", crossQuarterPayment("2026-02-10", null) === null);
  check("no invoice_date → null", crossQuarterPayment(null, "2026-05-03") === null);
  check("unparseable payment_date → null (never a false marker)", crossQuarterPayment("2026-02-10", "nonsense") === null);
  check("both null → null", crossQuarterPayment(null, null) === null);
}


console.log("\n— [KLAAR-TOEKOMST] isPeriodStarted / currentQuarter, on the Amsterdam day —");
{
  const q = (year: number, quarter: 1 | 2 | 3 | 4) => ({ year, quarter });
  check("mid-Q3 2026: Q3 2026 (the open quarter) has started", isPeriodStarted(q(2026, 3), at("2026-08-15")));
  check("mid-Q3 2026: Q2 2026 has started", isPeriodStarted(q(2026, 2), at("2026-08-15")));
  check("mid-Q3 2026: Q4 2026 has NOT started", !isPeriodStarted(q(2026, 4), at("2026-08-15")));
  check("mid-Q3 2026: Q1 2027 has NOT started", !isPeriodStarted(q(2027, 1), at("2026-08-15")));
  check("mid-Q3 2026: Q4 2025 has started", isPeriodStarted(q(2025, 4), at("2026-08-15")));
  check("currentQuarter mid-Q3 → Q3", JSON.stringify(currentQuarter(at("2026-08-15"))) === JSON.stringify({ year: 2026, quarter: 3 }));

  // New Year in Europe/Amsterdam, both sides of midnight — the boundary the device clock got wrong.
  check("1 Jan 00:30 Amsterdam (= 31 Dec 23:30 UTC): Q1 2026 has started",
    isPeriodStarted(q(2026, 1), new Date("2025-12-31T23:30:00Z")));
  check("31 Dec 23:30 Amsterdam (= 22:30 UTC): Q1 2026 has NOT started",
    !isPeriodStarted(q(2026, 1), new Date("2025-12-31T22:30:00Z")));
  check("31 Dec 23:30 Amsterdam: Q4 2025 has started", isPeriodStarted(q(2025, 4), new Date("2025-12-31T22:30:00Z")));
  // A quarter transition in summer time (UTC+2).
  check("1 Jul 00:30 CEST (= 30 Jun 22:30 UTC): Q3 2026 has started",
    isPeriodStarted(q(2026, 3), new Date("2026-06-30T22:30:00Z")));
  check("30 Jun 23:30 CEST (= 21:30 UTC): Q3 2026 has NOT started",
    !isPeriodStarted(q(2026, 3), new Date("2026-06-30T21:30:00Z")));
  check("the picker's current quarter and this rule agree on the same instant",
    isPeriodStarted(currentQuarter(new Date("2026-06-30T22:30:00Z")), new Date("2026-06-30T22:30:00Z")));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
