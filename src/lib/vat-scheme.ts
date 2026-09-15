// src/lib/vat-scheme.ts
// [KASSTELSEL] The owner's BTW-basis election and the per-quarter resolution rule.
// Pure; no I/O. Run: npx tsx src/lib/vat-scheme.test.ts
//
//   factuurstelsel (accrual)  — BTW lands in the quarter of the INVOICE date (the default,
//                               and how BoekBrug has always computed).
//   kasstelsel (cash basis)   — the BTW you OWE lands in the quarter the sales invoice is PAID.
//                                 [KAS-VOORBELASTING] The deduction does NOT move with it:
//                                 voorbelasting is deducted in the period of the purchase invoice
//                                 on both schemes ("De factuurdatum bepaalt in welk tijdvak u de
//                                 btw aftrekt" — Belastingdienst).
//
// The election lives on profiles.vat_scheme + profiles.vat_scheme_since. The `since` date is
// load-bearing: a bare global flag would, on the recompute-on-read truth layer, retroactively
// rewrite an ALREADY-FILED quarter the moment the owner switches schemes (a wrong number in a
// closed period). So each quarter is resolved under the scheme in force FOR THAT QUARTER.

export type VatScheme = "factuur" | "kas";

export function isVatScheme(v: unknown): v is VatScheme {
  return v === "factuur" || v === "kas";
}

/** Normalize a raw profile value to a scheme, defaulting to 'factuur' (the always-safe default). */
export function getVatScheme(raw: unknown): VatScheme {
  return raw === "kas" ? "kas" : "factuur";
}

/**
 * The scheme that applies to a SINGLE quarter. The owner's current scheme (`profileScheme`)
 * only takes effect for quarters whose start is on/after `since`; earlier quarters keep the
 * prior scheme (the opposite of the current one), so switching to kas never re-declares a
 * factuur quarter and vice-versa. When `since` is absent, the current scheme applies to all
 * quarters (a fresh election with no history to protect). Pure; dates are ISO 'YYYY-MM-DD'.
 */
export function resolveSchemeForQuarter(
  profileScheme: VatScheme,
  since: string | null | undefined,
  quarterStart: string,
): VatScheme {
  if (profileScheme === "factuur") return "factuur"; // default owner: always accrual, no history
  if (!since) return profileScheme;                  // kas with no effective date → applies throughout
  // kas takes effect only from `since`; a quarter starting before it stays on the prior scheme.
  return quarterStart >= since.slice(0, 10) ? "kas" : "factuur";
}
