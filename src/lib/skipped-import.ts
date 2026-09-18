// src/lib/skipped-import.ts
// [OBSERVABILITY] Welke documenten tellen als "overgeslagen bij import"? Pure, geen I/O.
// Run: npx tsx --test src/lib/skipped-import.test.ts
//
// WAAROM DIT EEN EIGEN BESTAND IS
// Het paneel "Overgeslagen bij import (en waarom)" is de enige plek waar de app toegeeft dat
// er iets binnenkwam dat zij niet kon lezen. Het is dus precies de plek die niet mag liegen —
// en het loog, doordat de SCHRIJVER en de LEZER een andere waarde gebruikten:
//
//   · /api/intake schreef `ai_doc_type: v.document_kind ?? "other"`, óók wanneer de AI het
//     document niet had kunnen lezen (het wist dat zelfs: `ai_processed: !couldNotRead`);
//   · /api/email/skipped las `.eq('ai_doc_type', 'could_not_read')`.
//
// Een gefotografeerde bon die niet te lezen was, kwam dus netjes in bestanden te staan en werd
// door niets geteld. Het paneel meldde "Niets overgeslagen — alles wat binnenkwam is verwerkt".
// Dat is de zin die een ondernemer laat ophouden met zoeken.
//
// Twee kanten van dezelfde waarheid horen niet in twee bestanden los van elkaar te leven, dus
// staan ze hier — met een test die faalt zodra iemand er één verplaatst.

/**
 * De `ai_doc_type`-waarde voor een bestand dat is BEWAARD maar niet GELEZEN.
 * Elke opnameweg die dat overkomt, hoort deze waarde weg te schrijven.
 */
export const DOC_TYPE_COULD_NOT_READ = "could_not_read" as const;

/**
 * Bewaard, maar het bestandstype kon sowieso niet worden verwerkt (bijv. een formaat waar geen
 * lezer voor is). Een andere diagnose dan hierboven — de ondernemer moet er hetzelfde mee: even
 * kijken — dus telt hij mee in hetzelfde paneel.
 */
export const DOC_TYPE_UNSUPPORTED = "unsupported_type" as const;

/**
 * [HERINNERING-NOOIT] Een betalingsherinnering die is BEWAARD en GELEZEN, maar bewust nooit een
 * factuur is geworden. Staat NIET in SKIPPED_DOC_TYPES: het is geen leesfout. Het paneel toont hem
 * apart, en alleen zolang hij aan geen factuur hangt (invoice_id is null) — dan is het origineel
 * niet in de boeken en kan de eigenaar hem bewust vanaf het bestand boeken.
 */
export const DOC_TYPE_REMINDER = "reminder" as const;

/**
 * [ONTVANGEN] BEWAARD, en wij moeten hem nog lezen.
 *
 * Dit is geen mislukking en geen overslaan: het is de normale toestand van elk document tussen
 * "Ontvangen — je kunt verder" en het moment dat de lezer eraan toe is. De reden dat het een EIGEN
 * waarde is en niet `could_not_read`, is dat die twee tegengestelde dingen zeggen tegen de
 * eigenaar én tegen ons:
 *
 *   could_not_read  → wij hebben het geprobeerd en het lukte niet. Hoort in "Overgeslagen bij
 *                     import", met de knop "Lees opnieuw" ernaast.
 *   wacht_op_lezen  → wij zijn nog niet begonnen. Hoort NERGENS in dat paneel, want er is niets
 *                     overgeslagen; het staat gewoon in de rij.
 *
 * Zou elk vers geüpload bestand als could_not_read binnenkomen, dan meldt dat paneel bij iedere
 * foto "overgeslagen bij import" over een bestand waar niets mis mee is. Een paneel dat bij elke
 * normale handeling alarm slaat, is een paneel dat niemand meer leest.
 */
export const DOC_TYPE_WACHT_OP_LEZEN = "wacht_op_lezen" as const;

/**
 * [ONTVANGEN] GELEZEN, en er is één vraag die alleen de eigenaar kan beantwoorden.
 *
 * De lezer denkt dat deze factuur al in de administratie staat — dezelfde factuur, een ander
 * bestand. Vroeger blokkeerde dat het antwoord terwijl de eigenaar nog keek; nu is hij allang weer
 * aan het werk, dus wordt het een duurzame vraag op het document dat er al staat.
 *
 * Ook dit is nadrukkelijk GEEN leesfout, en het onderscheid is niet cosmetisch: de drain mag een
 * infrastructuurstoring vanzelf opnieuw proberen, maar een vraag aan een mens niet. Nog een keer
 * rekenen maakt het antwoord niet anders. Zonder een eigen toestand zou de achtergrondpas dit
 * document eeuwig blijven oppakken en eeuwig op hetzelfde punt stoppen.
 */
export const DOC_TYPE_WACHT_OP_BESLUIT = "wacht_op_besluit" as const;

/**
 * De toestanden waarin een document op IEMAND wacht in plaats van klaar te zijn.
 *
 * Eén lijst, omdat elk scherm dat "is hier nog iets mee aan de hand?" vraagt hem in zijn geheel
 * nodig heeft — en omdat een tweede lijst ergens anders precies de drift is die het overgeslagen-
 * paneel ooit liet liegen (zie de kop van dit bestand).
 */
export const WACHTENDE_DOC_TYPES: readonly string[] = [
  DOC_TYPE_WACHT_OP_LEZEN,
  DOC_TYPE_WACHT_OP_BESLUIT,
];

/** Wacht dit document nog op ons of op de eigenaar? */
export function isWachtendDocType(aiDocType: string | null | undefined): boolean {
  return WACHTENDE_DOC_TYPES.includes((aiDocType ?? "").trim());
}

/**
 * Mag de achtergrondpas dit document zelf nog een keer proberen?
 *
 * Alleen wat op ONS wacht. Een document dat op de eigenaar wacht is niet mislukt en wordt niet
 * beter van nog een poging — het wacht op een mens, en daar is geen rekenkracht voor.
 */
export function mayDrainRetry(aiDocType: string | null | undefined): boolean {
  return (aiDocType ?? "").trim() === DOC_TYPE_WACHT_OP_LEZEN;
}

/**
 * De volledige lijst die het overgeslagen-paneel moet tellen.
 *
 * DIT IS DE ENIGE PLEK waar die lijst staat. Voegt een nieuwe opnameweg ooit een derde reden
 * toe, dan hoort hij hier bij — anders valt hij weer stil buiten beeld, precies zoals
 * 'could_not_read' dat deed.
 */
export const SKIPPED_DOC_TYPES: readonly string[] = [
  DOC_TYPE_COULD_NOT_READ,
  DOC_TYPE_UNSUPPORTED,
];

// [ONTVANGEN] De twee wachttoestanden horen hier NIET bij, en dat is geen omissie. "Overgeslagen"
// betekent: er kwam iets binnen dat wij niet hebben verwerkt. Een document dat nog in de rij staat
// is niet overgeslagen, en een document dat op een antwoord van de eigenaar wacht al helemaal
// niet — dat wacht op hem, niet op ons. Een gate hieronder houdt die twee lijsten uit elkaar.

/**
 * Welke `ai_doc_type` hoort een opgeslagen document te krijgen?
 *
 * `couldNotRead` wint van alles: kon de AI het niet lezen, dan is haar classificatie een gok en
 * mag die de reden niet overschrijven. Zonder die voorrang schreef intake "other" over een
 * onleesbaar bestand heen — de bug die dit bestand bestaat om te voorkomen.
 */
export function docTypeForStoredFile(
  couldNotRead: boolean,
  aiDocumentKind: string | null | undefined,
): string {
  if (couldNotRead) return DOC_TYPE_COULD_NOT_READ;
  const kind = (aiDocumentKind ?? "").trim();
  return kind.length > 0 ? kind : "other";
}

/** Telt dit document mee in "Overgeslagen bij import"? */
export function isSkippedDocType(aiDocType: string | null | undefined): boolean {
  return SKIPPED_DOC_TYPES.includes((aiDocType ?? "").trim());
}
