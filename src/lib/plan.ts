// src/lib/plan.ts
// [BILLING] De weergavefeiten van wat wij verkopen — pure strings, geen Stripe, geen I/O.
//
// Los van billing.ts, en om dezelfde reden als daar: deze strings worden gelezen door
// CLIENT-componenten en door de publieke pagina's, en billing.ts doet `import Stripe from
// "stripe"`. Dat vanuit een 'use client'-bestand importeren sleept de hele Stripe-SDK de
// browserbundel in.
//
// ⚠️ HIER MAG EEN PRIJS NIET WORDEN OVERGETYPT — hij mag hier zelfs niet worden GESCHREVEN.
// Elk bedrag hieronder wordt AFGELEID uit de module die er al over gaat:
//   • het maandbedrag van Plus uit src/lib/fair-use.ts (PLUS_PRICE_EUR), waar ook de
//     grenzen staan die de Algemene Voorwaarden §5 en /eerlijk-gebruik publiceren;
//   • de bedragen van de Bewaarkluis uit src/lib/bewaarkluis.ts.
//
// Dat is geen netheid maar een reparatie. Op de billing-tak stond hier een eigen
// `priceLabel: "€ 12,00"` — terwijl de bindende voorwaarden op DEZE tak € 12,99 publiceren
// en de checkout de klant dwingt die voorwaarden te accepteren. Twee bedragen in één
// koopproces is precies het gat waar de klant gelijk in krijgt, want onduidelijkheid in je
// eigen algemene voorwaarden wordt tegen jou uitgelegd. Eén bron, dus: als de grens of de
// prijs verandert, verandert hij overal mee.
//
// WAT WIJ NIET VERKOPEN, en waarom dat hier staat:
//   • Geen proefperiode. Er is niets om te proberen — de app is gratis en blijft gratis
//     binnen het eerlijk gebruik. Een proefklok die stil begint te lopen bij registratie is
//     precies het gedrag waar dit product zich van wil onderscheiden.
//   • Geen betaalmuur. Overschrijding pauzeert alleen de handeling die geld kost.
//   • Het boekhoudersportaal is gratis tot en met ACCOUNTANT_FREE_CLIENTS gekoppelde klanten
//     (fair-use.ts). Daarboven geldt een STAFFEL per kantoor (accountant-pricing.ts), die is
//     voorbereid maar NIET actief: zolang zij niet is aangekondigd is het portaal in zijn
//     geheel kosteloos, ook boven de grens (voorwaarden §5.8.1). Geen klok, geen proefperiode:
//     de grens loopt over KLANTEN, niet over tijd. Er is bewust geen bedrag van die staffel in
//     dit bestand overgetypt — wie het nodig heeft, leest accountant-pricing.ts.

import { PLUS_PRICE_EUR, fairUseLimit, formatLimit } from "@/lib/fair-use";
import {
  BEWAARPLICHT_YEARS,
  KLUIS_PREPAY_YEAR_PRICE_EUR,
  KLUIS_YEAR_PRICE_EUR,
  eur,
} from "@/lib/bewaarkluis";

/** Nederlandse notatie van een maandbedrag: "€ 12,99". */
/**
 * [PRIJS-MOMENT] Exported, because the billing screen now renders a SECOND price beside the
 * published one — what this account is actually charged. Two spellings of an amount on one card
 * is how a reader starts wondering which of them is the real number.
 */
export function euroLabel(amount: number): string {
  return `€ ${amount.toFixed(2).replace(".", ",")}`;
}

/**
 * Het enige betaalde maandplan voor de ondernemer. Nodig zodra iemand structureel boven het
 * eerlijk gebruik uitkomt — nooit eerder, en nooit automatisch.
 */
/**
 * [PROEFMAAND] De eerste maand Plus is gratis — één keer, voor wie nog nooit een abonnement had.
 *
 * Waarom een proefmaand op PLUS en geen tijdslot op het product zelf: het gratis plan IS het
 * product (zie decidePlan stap 5), dus "probeer de app een maand gratis" is hier al waar zonder
 * enige wijziging. Wat een advertentie nodig heeft is de sterkere belofte — een maand de RUIME
 * grenzen proberen — en die kan veilig, omdat aflopen hier terugvalt naar gratis en nooit naar
 * een slot. Een boekhoudapp die na dag 30 de administratie gijzelt is precies wat wij niet zijn.
 *
 * Ná de proefmaand int Stripe het gewone maandbedrag; opzeggen binnen de maand kost niets.
 * De toestand die Stripe daarbij stuurt ('trialing') wordt al jaren als lopend abonnement
 * genormaliseerd (normalizeStripeStatus) — deze feature zet dus alleen de kraan open die er al was.
 */
export const PLUS_TRIAL_DAYS = 30;

export const PLUS = {
  id: "plus",
  name: "BoekBrug Plus",
  /** Weergavestring, Nederlandse notatie. Afgeleid — nooit hier ingetypt. */
  priceLabel: euroLabel(PLUS_PRICE_EUR),
  period: "per maand",
  /** Nederlandse consumentenprijzen zijn inclusief btw; de Stripe-prijs moet dat ook zijn. */
  btwNote: "incl. btw",
  /** Maandelijks opzegbaar, per direct. Geen opzegtermijn. */
  cancelNote: "maandelijks opzegbaar",
  /** [PROEFMAAND] Eén zin, overal dezelfde: wie hem leest weet wat hij kost en wanneer. */
  trialNote: "de eerste maand gratis — opzeggen binnen die maand kost niets",
} as const;

/** Het archiefproduct. Loopt door nadat de klant is vertrokken — zie bewaarkluis.ts. */
export const KLUIS = {
  id: "bewaarkluis",
  name: "BoekBrug Bewaarkluis",
  perYearLabel: eur(KLUIS_YEAR_PRICE_EUR),
  perYearPrepaidLabel: eur(KLUIS_PREPAY_YEAR_PRICE_EUR),
  period: "per bewaarjaar",
  btwNote: "incl. btw",
  years: BEWAARPLICHT_YEARS,
} as const;

/**
 * Het aanbod in één zin, klaar om te plakken op elke plek waar iemand wordt gevraagd zich
 * te binden. Bevat alles wat een koper moet weten vóór hij klikt: dat het gratis is, waar de
 * grens ligt, wat het daarboven kost, en dat er nooit ongevraagd wordt afgeschreven.
 */
export const OFFER_NL =
  `Gratis voor de ondernemer én voor zijn boekhouder. ` +
  `Boven het eerlijk gebruik (${formatLimit(fairUseLimit("aiDocuments"), "free")} documenten ` +
  `door de AI gelezen) kost Plus ${PLUS.priceLabel} ${PLUS.period} ${PLUS.btwNote}. ` +
  `Geen proefperiode, geen automatische afschrijving, geen betaalmuur voor je eigen gegevens.`;

/** Korte vorm voor een ondertitel of een knop. */
export const OFFER_SHORT_NL =
  `Gratis · Plus ${PLUS.priceLabel} p/m alleen boven het eerlijk gebruik · nooit automatisch afgeschreven`;
