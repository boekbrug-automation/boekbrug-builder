// src/lib/vakwoorden.ts
// [VAKWOORD] The words a boekhouder types, landing on the screens that already hold them.
//
// Five times in this repo the same failure has been measured: the capability existed and the LIST
// did not. This is that failure in its smallest and cheapest form — the capability exists, the
// screen exists, and only the WORD is missing.
//
// A Dutch accountant opening an unfamiliar package does not browse. They look for the nouns of
// their profession: debiteuren, crediteuren, saldibalans, journaalposten, rapportages. BoekBrug
// has every one of those things, under the names the ENTREPRENEUR uses — "Mijn facturen",
// "Inkomend", "Waarheid". Those names are right and are not changing: the owner is who the screen
// is addressed to, and renaming their app into accountancy vocabulary would be the wrong trade.
//
// So the bridge goes the other way. The profession's word becomes a door onto the screen that
// already answers it. Nothing is duplicated, nothing is renamed, and an accountant who types
// /dashboard/crediteuren arrives at the purchase invoices instead of at a 404 — which they would
// otherwise read, correctly by their own lights, as "this package has no crediteuren".
//
// ── THE RULE THAT KEEPS THIS HONEST ──
//
// A door may only be opened onto a screen that ACTUALLY ANSWERS THE WORD. A redirect is a claim:
// it says "you asked for X, here is X". Pointing `memoriaal` at the grootboek would be worse than
// the 404, because the 404 is true and the redirect is not — the accountant would go looking for
// the memoriaalboeking on a page that has none, and conclude the screen is broken rather than the
// feature absent.
//
// That is why NOT_A_DOOR exists below and why a gate asserts those words have no route. The list
// of what this app does not have is part of what it does have.
//
// Pure data. Run: npx tsx --test src/lib/vakwoorden.test.ts

export interface Vakwoord {
  /** The URL segment under /dashboard, and the word itself. */
  woord: string;
  /** The screen that already answers it. */
  naar: string;
  /** Why that screen IS the answer — checked by a human once, then held by the gate. */
  omdat: string;
}

/**
 * Every profession word that has a real answer in this app.
 *
 * The entrepreneur-facing name of each target is in brackets: that mismatch is the entire reason
 * this table exists, and seeing both makes each row checkable at a glance.
 */
export const VAKWOORDEN: readonly Vakwoord[] = [
  { woord: "debiteuren",          naar: "/dashboard/facturen",  omdat: "uitgaande facturen met hun openstaande bedragen ['Mijn facturen']" },
  { woord: "crediteuren",         naar: "/dashboard/incoming",  omdat: "inkoopfacturen met wat er nog te betalen staat ['Inkomend']" },
  { woord: "journaal",            naar: "/dashboard/grootboek", omdat: "het journaal is een tabblad van het grootboekscherm" },
  { woord: "journaalposten",      naar: "/dashboard/grootboek", omdat: "zelfde scherm, het meervoud dat men even vaak typt" },
  { woord: "saldibalans",         naar: "/dashboard/grootboek", omdat: "de saldibalans is het eerste tabblad daar" },
  { woord: "proefbalans",         naar: "/dashboard/grootboek", omdat: "proef- en saldibalans is één overzicht, en dat staat daar" },
  { woord: "grootboekrekeningen", naar: "/dashboard/grootboek", omdat: "de rekeningen mét hun saldi staan op dat scherm" },
  { woord: "rapportages",         naar: "/dashboard/waarheid",  omdat: "resultaat, omzet en kosten over een periode ['Waarheid']" },
  { woord: "boekjaar",            naar: "/dashboard/jaar",      omdat: "het jaar als geheel, met de auditfile ['Jaaroverzicht']" },
  { woord: "bonnetjes",           naar: "/dashboard/upload",    omdat: "hier gaat een bon het systeem in ['Uploaden']" },
  { woord: "omzetbelasting",      naar: "/dashboard/aangifte",  omdat: "de btw-aangifte per tijdvak ['Aangifte']" },
] as const;

/**
 * Words this app has NO answer for, which therefore get no door.
 *
 * Listed rather than merely absent, because "we deliberately have nothing here" and "nobody
 * thought of it" are different states and only one of them is a decision. Each is a row in
 * docs/BoekBrug_Accounting_Decision_Matrix.md under what is not built, with the trigger that
 * would change it.
 */
export const NOT_A_DOOR: readonly { woord: string; waarom: string }[] = [
  { woord: "memoriaal", waarom: "er is geen memoriaalboeking — een deur ernaartoe zou beweren van wel" },
  { woord: "memoriaalboekingen", waarom: "hetzelfde; het staat als niet-gebouwd in de beslismatrix" },
  { woord: "voorraad", waarom: "voorraadbeheer is bewust geen onderdeel van dit product" },
  { woord: "salarisadministratie", waarom: "loon is bewust geen onderdeel van dit product" },
] as const;

/** The screen a profession word opens, or null when this app has no honest answer for it. */
export function vakwoordNaar(woord: string): string | null {
  const hit = VAKWOORDEN.find((v) => v.woord === woord.toLowerCase().trim());
  return hit ? hit.naar : null;
}
