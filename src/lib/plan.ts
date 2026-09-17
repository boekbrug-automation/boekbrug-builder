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
// `priceLabel` met een ander bedrag dan de bindende voorwaarden publiceerden, terwijl de
// checkout de klant dwingt die voorwaarden te accepteren. Twee bedragen in één koopproces is
// precies het gat waar de klant gelijk in krijgt, want onduidelijkheid in je eigen algemene
// voorwaarden wordt tegen jou uitgelegd. Eén bron, dus: als de grens of de prijs verandert,
// verandert hij overal mee. Welke bedragen dat vandaag zijn staat daarom hier niet — het
// overtypen ervan in een comment is dezelfde fout, alleen trager zichtbaar.
//
// WAT WIJ NIET VERKOPEN, en waarom dat hier staat:
//   • Geen proefperiode, en sinds [EERLIJK-WOORD] klopt die zin weer. Er heeft een tijd een
//     proefmaand op Plus gestaan (30 dagen, via trial_period_days) TERWIJL deze regel hier
//     bleef staan — twee beschrijvingen van hetzelfde aanbod, waarvan er één op de
//     verkooppagina stond en één in de voorwaarden. Nu is er weer precies één ding om te
//     proberen: het gratis plan zelf, de proefwerkplek. Een proefklok die stil begint te lopen
//     bij registratie is nog steeds het gedrag waar dit product zich van wil onderscheiden.
//   • Geen betaalmuur. Overschrijding pauzeert alleen de handeling die geld kost.
//   • Het boekhoudersportaal is gratis tot en met ACCOUNTANT_FREE_CLIENTS gekoppelde klanten
//     (fair-use.ts). Daarboven geldt een STAFFEL per kantoor (accountant-pricing.ts), die is
//     voorbereid maar NIET actief: zolang zij niet is aangekondigd is het portaal in zijn
//     geheel kosteloos, ook boven de grens (voorwaarden §5.8.1). Geen klok, geen proefperiode:
//     de grens loopt over KLANTEN, niet over tijd. Er is bewust geen bedrag van die staffel in
//     dit bestand overgetypt — wie het nodig heeft, leest accountant-pricing.ts.

import { PLUS_ANNUAL_PRICE_EUR, PLUS_PRICE_EUR, fairUseLimit } from "@/lib/fair-use";
import {
  BEWAARPLICHT_YEARS,
  KLUIS_PREPAY_YEAR_PRICE_EUR,
  KLUIS_YEAR_PRICE_EUR,
  eur,
} from "@/lib/bewaarkluis";

/** Nederlandse notatie van een bedrag, twee decimalen: "€ 19,99", "€ 179,91". */
function euroLabel(amount: number): string {
  return `€ ${amount.toFixed(2).replace(".", ",")}`;
}

/**
 * Het enige betaalde plan voor de ondernemer, in twee betaaltermijnen — per maand of per jaar.
 * ÉÉN product, niet twee: dezelfde grenzen, dezelfde functies, alleen een ander moment van
 * afrekenen. Nodig zodra iemand zijn onderneming op BoekBrug draait — nooit automatisch.
 */
export const PLUS = {
  id: "plus",
  name: "BoekBrug Plus",
  /** Weergavestring, Nederlandse notatie. Afgeleid — nooit hier ingetypt. */
  priceLabel: euroLabel(PLUS_PRICE_EUR),
  period: "per maand",
  /** [JAARPRIJS] Hetzelfde plan, per jaar vooruit: twaalf maanden voor de prijs van negen. */
  annualPriceLabel: euroLabel(PLUS_ANNUAL_PRICE_EUR),
  annualPeriod: "per jaar",
  /** Nederlandse consumentenprijzen zijn inclusief btw; de Stripe-prijs moet dat ook zijn. */
  btwNote: "incl. btw",
  /**
   * [JAARPRIJS] Opzeggen kan altijd, per direct, zonder opzegtermijn.
   *
   * Dit zei "maandelijks opzegbaar", en dat was waar toen er één termijn bestond. Voor wie per
   * jaar betaalt is het onwaar op de manier die telt: hij leest "maandelijks" en denkt dat hij
   * na een maand van zijn jaarbedrag af is. Hetzelfde Plus, twee betaaltermijnen — dus de zin
   * beschrijft de handeling (opzeggen kan altijd) en niet de termijn, en wat er daarna met je
   * toegang gebeurt staat in de zin ernaast en in voorwaarden §5.4.
   */
  cancelNote: "altijd opzegbaar",
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
 * [EERLIJK-WOORD] Het aanbod in één zin, klaar om te plakken op elke plek waar iemand wordt
 * gevraagd zich te binden.
 *
 * DE VORIGE ZIN BESCHREEF EEN ANDER PRODUCT. Hij begon met "Gratis voor de ondernemer" en
 * noemde Plus iets voor wie "boven het eerlijk gebruik" uitkomt — de vorm waarin gratis het
 * hoofdplan was en Plus de uitzondering. Sinds de beslissing van 17 september is het andersom:
 * gratis is de proefwerkplek en Plus is waarop je je onderneming draait. Een verkoopzin die de
 * oude vorm blijft zeggen belooft iets wat de app niet meer doet, en dat is precies het soort
 * verschil waarin een klant gelijk krijgt.
 *
 * Alle getallen zijn afgeleid. Er staat er niet één overgetypt in deze zin.
 */
export const OFFER_NL =
  `Gratis uitproberen: ${fairUseLimit("invoicesSent").free} facturen en ` +
  `${fairUseLimit("aiDocuments").free} door de AI gelezen documenten per maand. ` +
  `Draai je er je onderneming op, dan is dat Plus: ${PLUS.priceLabel} ${PLUS.period} of ` +
  `${PLUS.annualPriceLabel} ${PLUS.annualPeriod} ${PLUS.btwNote}, ruim onder eerlijk gebruik. ` +
  `Geen proefperiode, geen automatische afschrijving, geen betaalmuur voor je eigen gegevens.`;

/** Korte vorm voor een ondertitel of een knop. */
export const OFFER_SHORT_NL =
  `Gratis uitproberen · Plus ${PLUS.priceLabel} p/m of ${PLUS.annualPriceLabel} p/j · ` +
  `nooit automatisch afgeschreven`;
