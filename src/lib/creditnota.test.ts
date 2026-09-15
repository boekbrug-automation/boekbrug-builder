// [CREDITNOTA-REF] Pure node test — run: npx tsx src/lib/creditnota.test.ts
import { creditnotaReferenceLine, creditReferenceOf, checkStandaloneCreditnota } from "./creditnota";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— art. 219: specifically and unambiguously —");
{
  const line = creditnotaReferenceLine({ originalNumber: "2026-041", originalDate: "2026-03-14" })!;
  check("it names the invoice being corrected", /2026-041/.test(line));
  check("…and the date that makes it unambiguous", /14-03-2026/.test(line));
  check("…in Dutch, as a sentence on the document", /^Deze creditnota corrigeert factuur /.test(line));

  check("no date known → still a valid reference on the number alone",
    creditnotaReferenceLine({ originalNumber: "2026-041" }) === "Deze creditnota corrigeert factuur 2026-041.");
}

console.log("\n— what it refuses to say —");
{
  check("no number → NO line, rather than a vague one",
    creditnotaReferenceLine({ originalNumber: null }) === null);
  check("an empty number is not a reference",
    creditnotaReferenceLine({ originalNumber: "   " }) === null);
  check("undefined is handled like absent", creditnotaReferenceLine({ originalNumber: undefined }) === null);
  check("a garbage date is dropped, the number still stands",
    creditnotaReferenceLine({ originalNumber: "2026-041", originalDate: "later" })
      === "Deze creditnota corrigeert factuur 2026-041.");
}

console.log("\n— the date is string surgery, so no timezone can move it —");
{
  const line = creditnotaReferenceLine({ originalNumber: "X", originalDate: "2026-01-01T23:30:00.000Z" })!;
  check("a full timestamp still reads as its own calendar day", /01-01-2026/.test(line));
  check("a date-only value never shifts a day", /31-12-2025/.test(creditnotaReferenceLine({ originalNumber: "X", originalDate: "2025-12-31" })!));
}

console.log("\n— [CREDITNOTA-EXTERN] the reference of a standalone creditnota —");
{
  // Linked first: the row the creditnota route wrote outranks anything typed.
  const linked = creditReferenceOf({ linkedNumber: "2026-041", linkedDate: "2026-03-14", creditedNumber: "X-1", creditedDate: "2025-01-01" });
  check("a linked original wins", linked.originalNumber === "2026-041" && linked.originalDate === "2026-03-14");
  // Typed second: the invoice issued outside BoekBrug, as the owner read it off the paper.
  const typed = creditReferenceOf({ creditedNumber: "  F-2025-0091 ", creditedDate: "2025-11-02" });
  check("the typed number is trimmed and carried with its date", typed.originalNumber === "F-2025-0091" && typed.originalDate === "2025-11-02");
  check("nothing typed, nothing linked → nothing, never a vague line",
    creditReferenceOf({ creditedNumber: "   " }).originalNumber === null);
  check("…and the reference line then stays silent, as before",
    creditnotaReferenceLine({ originalNumber: creditReferenceOf({}).originalNumber }) === null);
  check("the typed reference prints as the legal sentence",
    creditnotaReferenceLine({ originalNumber: typed.originalNumber, originalDate: typed.originalDate }) === "Deze creditnota corrigeert factuur F-2025-0091 van 02-11-2025.");
}

console.log("\n— [CREDITNOTA-EXTERN] the door: a standalone creditnota names its invoice or does not go out —");
{
  check("a factuur is never asked", checkStandaloneCreditnota({ invoiceType: "factuur", originalInvoiceId: null, creditedNumber: null }).ok);
  check("a linked creditnota passes on its link alone", checkStandaloneCreditnota({ invoiceType: "creditnota", originalInvoiceId: "abc", creditedNumber: null }).ok);
  check("a standalone creditnota with a number passes", checkStandaloneCreditnota({ invoiceType: "creditnota", originalInvoiceId: null, creditedNumber: "F-2025-0091" }).ok);
  const refused = checkStandaloneCreditnota({ invoiceType: "creditnota", originalInvoiceId: null, creditedNumber: "  " });
  check("a standalone creditnota without one is refused, by code", !refused.ok && refused.code === "creditnota_zonder_verwijzing");
  check("…with the article named, in the language of the document", !refused.ok && /art\. 219/.test(refused.error) && /factuurnummer/.test(refused.error));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
