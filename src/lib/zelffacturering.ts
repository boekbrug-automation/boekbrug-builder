// src/lib/zelffacturering.ts
// [ZELFFACTUUR] The printed word for "this invoice was issued by the customer, not by the seller".
//
// Self-billing (zelffacturering, art. 35 Wet OB / art. 224 EU VAT Directive) inverts who wrote the
// document: the BUYER draws up the invoice on the seller's behalf, under a prior agreement. The
// paper still looks like an ordinary purchase invoice — two parties, a number, a date, a btw
// breakdown — and the app has no way to tell from the layout who typed it.
//
// ── WHY THIS ONE NEEDS ITS OWN HANDLE ──
//
// When the owner is the SELLER, a self-billed invoice is their own turnover arriving in the
// incoming pile. Booked as a cost it is wrong twice: the sale stands again as an expense, and the
// btw the owner OWES is claimed back as voorbelasting. That is the [EIGEN-FACTUUR] case exactly,
// and own-document.ts catches it whenever the document carries the owner's KVK, btw number or
// IBAN — which a self-billed invoice legally must.
//
// But the SECOND line of defence cannot fire here, structurally. [EIGEN-NUMMER] recognises the
// owner's own sales invoices by the number the app itself issued; a self-billed invoice carries
// the CUSTOMER's number series, from a run this app has never seen. So on precisely this document
// class, the fallback that exists for "the reader named the wrong party" is absent — and an owner
// whose profile has no KVK, no btw number and no IBAN filled in has nothing left at all.
//
// The word on the paper is a third handle, and it does not depend on the model naming the parties
// correctly, on the owner's profile being complete, or on a number series we know.
//
// ── WHY IT SCANS THE WHOLE DOCUMENT, AND [CREDIT-WOORD] DOES NOT ──
//
// creditnota-signal.ts reads only the first 600 characters, because "creditnota" appears in the
// small print of a great many ordinary invoices ("bij retour ontvangt u een creditnota") and an
// alarm that fires on half the pile teaches everyone to dismiss it.
//
// These words have no such second life. "Zelffacturering" and "self-billing" do not appear in
// standard payment terms; where they are printed, they are printed because they are true — and
// the legal statement that says so is usually a footer line, not a heading. Scanning the header
// only would miss the normal case.
//
// This DECIDES nothing and moves no amount. It holds the document for one human look.
// Pure. Run: npx tsx --test src/lib/zelffacturering.test.ts

/**
 * The phrases, Dutch first. Each one names the mechanism, not a synonym for "invoice":
 *   · zelffacturering / zelffactuur — the Dutch term of art;
 *   · "uitgereikt door de afnemer" / "opgemaakt door de afnemer" — the legal formula printed on
 *     Dutch self-billed invoices, usually beside the article reference;
 *   · self-billing / self-billed — the English term, which Dutch suppliers print too.
 */
const SELF_BILLING = /\b(zelf[-\s]?factur(?:ering|atie)|zelf[-\s]?factuur|self[-\s]?billing|self[-\s]?billed|(?:uitgereikt|opgemaakt|opgesteld)\s+door\s+(?:de\s+)?(?:afnemer|koper|opdrachtgever))\b/i;

/** "geen zelffacturering", "no self-billing" — a denial is not an announcement. */
const DENIED = /\b(geen|niet|zonder|no)\s+(?:sprake\s+van\s+)?(?:zelf[-\s]?factur(?:ering|atie)|self[-\s]?billing)\b/i;

/**
 * Does this document say, in its own characters, that the CUSTOMER issued it?
 *
 * `text` is the raw text layer as the extraction delivers it. Null or empty is false: a scan with
 * no text layer says nothing here, and nothing is not evidence of the opposite.
 */
export function selfBilledWordInDocument(text: string | null | undefined): boolean {
  if (!text) return false;
  if (DENIED.test(text)) return false;
  return SELF_BILLING.test(text);
}
