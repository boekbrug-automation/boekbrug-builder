// src/lib/vragen.ts
// [BRUG-RETOUR] De terugweg van de brug — pure logica.
//
// WAAROM DIT BESTAAT
// De boekhouder kan al sinds [READINESS-P3] een document op status 'vraag' zetten
// (/api/accountant/subject-status). Die vraag kwam alleen nergens uit: de klant kreeg
// één notificatie die naar /dashboard/bestanden wees — een map met bestanden, zonder
// vraag, zonder tekst, zonder antwoordknop. De vraag "welke bon mis je?" verliet
// BoekBrug dus en kwam terug via WhatsApp. Precies de wrijving waar dit product voor
// is gebouwd.
//
// DE HONESTHEIDSREGEL DIE DIT BESTAND BEWAAKT
// Een status is een BEWERING VAN DE BOEKHOUDER. De klant mag hem lezen, nooit
// schrijven (RLS: acc_status_client_read_document is SELECT-only). Daarom:
//   · wij markeren een vraag NOOIT zelf als beantwoord — dat zou een bewering van de
//     klant in het vakje van de boekhouder zetten;
//   · een vraag zonder tekst tonen wij als "geen toelichting", niet als een verzonnen
//     vraag;
//   · een vraag over een document dat niet meer te vinden is verdwijnt niet stil —
//     hem verbergen is óók een bewering.
// Antwoorden loopt daarom via /api/messages (het bestaande kanaal met koppelingscheck,
// notificatie en e-mail), en de vraag blijft staan tot de boekhouder hem zelf afvinkt.

/** De statuswaarde die een openstaande vraag markeert (accountant_subject_status.status). */
export const VRAAG_STATUS = 'vraag' as const

// [FACTUURVRAAG] What a question can be ABOUT. The table has allowed both kinds since it was
// created (its CHECK names them), and only the document half was ever built — while the accountant
// surfaces counted invoice questions that nothing could produce. English per AGENTS.md; the Dutch
// identifiers around it are pre-existing and deliberately left alone (forward-looking rule).
export type QuestionSubject = 'document' | 'invoice'

/** Ruwe statusrij zoals hij uit accountant_subject_status komt. */
export interface VraagStatusRow {
  subject_id: string
  status: string
  vraag_text: string | null
  updated_at: string | null
  // Absent on rows read from a document-only query — those are documents by construction, so the
  // default below keeps every existing caller behaving exactly as before.
  subject_type?: string | null
}

/** Het document waar de vraag over gaat, zoals het uit documents komt. */
export interface VraagDocumentRow {
  id: string
  file_name: string | null
  trashed?: boolean | null
}

/**
 * [FACTUURVRAAG] The invoice a question is about, as it comes out of invoices.
 *
 * Deliberately a different row type than the document one rather than a shared "thing with a name":
 * what identifies an invoice to its owner is the number AND the supplier AND the amount, and a
 * question that says only "your file" about a €2.265 purchase invoice is the friction this feature
 * exists to remove.
 */
export interface VraagInvoiceRow {
  id: string
  invoice_number: string | null
  client_name: string | null
  total_inc_btw: number | null
  invoice_date: string | null
}

/** Een openstaande vraag, klaar om te tonen. */
export interface OpenVraag {
  documentId: string
  /** De bestandsnaam, of null als het document niet (meer) te lezen is. */
  documentName: string | null
  /** In de prullenbak — de vraag geldt nog, het bestand ligt alleen apart. */
  documentTrashed: boolean
  /** Het document bestaat niet meer of is niet leesbaar voor deze gebruiker. */
  documentMissing: boolean
  /** De tekst van de boekhouder. null = hij liet geen toelichting achter. */
  question: string | null
  /** Wanneer de vraag voor het laatst is gezet. null = onbekend, en dat tonen wij zo. */
  askedAt: string | null
  // [FACTUURVRAAG] Which kind of thing this question is about. Defaults to 'document' so every
  // existing caller — and every row written before invoices were askable — keeps its exact meaning.
  subjectType?: QuestionSubject
  /**
   * The invoice, when subjectType is 'invoice'. Null for a document question, and null too when the
   * invoice could not be read — which is NOT the same thing, and is why documentMissing above is a
   * field of its own rather than an inference from a null name.
   */
  invoice?: VraagInvoiceRow | null
}

/**
 * Bouwt de lijst openstaande vragen uit de twee rijenverzamelingen.
 *
 * Alleen rijen met status 'vraag' tellen — 'verwerkt' of 'in_behandeling' is geen vraag
 * aan de klant. Een document dat niet in de meegegeven lijst zit is NIET stil weggelaten:
 * het komt terug met documentMissing = true, zodat het scherm kan zeggen dat er een vraag
 * openstaat over een bestand dat wij niet meer kunnen tonen.
 *
 * Oudste eerst: de vraag die het langst wacht is de vraag die ertoe doet. Rijen zonder
 * datum sluiten achteraan aan — een ontbrekende datum mag nooit als "net gesteld" lezen,
 * maar ook niet als "al weken oud".
 */
export function buildOpenVragen(
  statusRows: readonly VraagStatusRow[],
  documents: readonly VraagDocumentRow[],
): OpenVraag[] {
  const byId = new Map<string, VraagDocumentRow>()
  for (const d of documents) byId.set(d.id, d)

  const open: OpenVraag[] = []
  for (const row of statusRows) {
    if (row.status !== VRAAG_STATUS) continue
    const doc = byId.get(row.subject_id)
    open.push({
      documentId: row.subject_id,
      documentName: doc?.file_name?.trim() || null,
      documentTrashed: doc?.trashed === true,
      documentMissing: !doc,
      question: vraagTekst(row.vraag_text),
      askedAt: row.updated_at ?? null,
      subjectType: 'document',
    })
  }

  return sortOldestFirst(open)
}

/**
 * [FACTUURVRAAG] The same list, for questions about invoices.
 *
 * A separate builder rather than a branch inside buildOpenVragen, for one reason: the two read from
 * different tables under different RLS policies, so the caller already has them apart, and merging
 * them here would mean inventing a shared row shape that neither query produces.
 *
 * The honesty rules are identical and deliberately so. An invoice that cannot be read comes back
 * with invoice: null and documentMissing: true rather than being dropped — a question about
 * something we can no longer show is still an open question, and hiding it is itself an assertion.
 */
export function buildOpenInvoiceVragen(
  statusRows: readonly VraagStatusRow[],
  invoices: readonly VraagInvoiceRow[],
): OpenVraag[] {
  const byId = new Map<string, VraagInvoiceRow>()
  for (const i of invoices) byId.set(i.id, i)

  const open: OpenVraag[] = []
  for (const row of statusRows) {
    if (row.status !== VRAAG_STATUS) continue
    const inv = byId.get(row.subject_id) ?? null
    open.push({
      documentId: row.subject_id,
      documentName: inv ? invoiceLabel(inv) : null,
      documentTrashed: false, // an invoice has no bin; removing one archives it, which reads as missing
      documentMissing: !inv,
      question: vraagTekst(row.vraag_text),
      askedAt: row.updated_at ?? null,
      subjectType: 'invoice',
      invoice: inv,
    })
  }
  return sortOldestFirst(open)
}

/**
 * [FACTUURVRAAG] How an invoice is named to the person who has to answer about it.
 *
 * "Je factuur" is useless to someone with four hundred of them. The supplier is what an owner
 * recognises first, the number is what makes it exactly one invoice, and the amount is what makes
 * them remember it — so all three, and each one only when we actually have it. Never a placeholder
 * that reads like data.
 */
export function invoiceLabel(inv: VraagInvoiceRow): string {
  const parts: string[] = []
  const name = (inv.client_name ?? '').trim()
  if (name) parts.push(name)
  const num = (inv.invoice_number ?? '').trim()
  if (num) parts.push(`factuur ${num}`)
  const amount = typeof inv.total_inc_btw === 'number' && Number.isFinite(inv.total_inc_btw)
    ? new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Math.abs(inv.total_inc_btw))
    : null
  if (amount) parts.push(amount)
  return parts.length > 0 ? parts.join(' · ') : 'Factuur'
}

/** Oudste eerst; rijen zonder datum achteraan. Gedeeld door beide bouwers. */
function sortOldestFirst(open: OpenVraag[]): OpenVraag[] {
  return open.sort((a, b) => {
    if (a.askedAt && b.askedAt) return a.askedAt.localeCompare(b.askedAt)
    if (a.askedAt) return -1
    if (b.askedAt) return 1
    return 0
  })
}

/**
 * De vraagtekst zoals hij getoond mag worden.
 *
 * Leeg of alleen spaties → null. Het scherm zegt dan "je boekhouder gaf geen toelichting",
 * en dat is de waarheid. Er wordt hier nooit een vraag verzonnen die niemand heeft gesteld.
 */
export function vraagTekst(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  return t.length > 0 ? t : null
}

/**
 * De eerste regel van het antwoord van de klant.
 *
 * De boekhouder leest het antwoord in zijn gewone berichtenscherm, ver van het document
 * waar hij de vraag over stelde. Zonder deze regel is "ja die heb ik" een raadsel. De
 * naam wordt begrensd zodat een absurd lange bestandsnaam het bericht niet opeet.
 */
export function vraagAntwoordPrefix(documentName: string | null): string {
  const naam = (documentName ?? '').trim()
  if (!naam) return 'Over je vraag:'
  const kort = naam.length > 80 ? `${naam.slice(0, 77)}…` : naam
  return `Over je vraag bij "${kort}":`
}

/**
 * Het volledige bericht dat naar de boekhouder gaat.
 *
 * Leeg antwoord → null, zodat de aanroeper niet per ongeluk een bericht verstuurt dat
 * alleen uit onze eigen kopregel bestaat.
 */
export function bouwAntwoordBericht(documentName: string | null, antwoord: string): string | null {
  const tekst = antwoord.trim()
  if (!tekst) return null
  return `${vraagAntwoordPrefix(documentName)}\n${tekst}`
}

/**
 * [VRAGEN-TELLING] One head-count as supabase-js returns it: `count` is null when nothing was
 * counted, and `error` is the only shape a failure has — it never throws.
 */
export interface CountRead {
  count: number | null
  error: unknown
}

/** How many questions wait — or the honest admission that we could not count them. */
export type OpenQuestionCount = { known: true; count: number } | { known: false }

/**
 * [VRAGEN-TELLING] How many questions wait for the owner, over BOTH kinds /dashboard/vragen lists.
 *
 * The home counted subject_type='document' only, while the questions page has read document AND
 * invoice questions since [FACTUURVRAAG] — so an accountant's question about an invoice reached the
 * owner through a notification and nowhere on the home, the one screen that says "someone is
 * waiting for you".
 *
 * Two reads in, one answer out — and they STAY two reads. The rows arrive through two RLS policies
 * (acc_status_client_read_document, acc_status_client_read_invoice), and one query that needs both
 * fails whole the moment the second policy is not rolled out; the questions page says the same in
 * its own words. This function only adds up what the two reads returned.
 *
 * [NO-SILENT-EMPTY] A failed half makes the WHOLE answer unknown. A count that quietly omits the
 * half that failed is a smaller number presented as the truth — worse than no number, because the
 * banner then stays away from a home that has a question waiting on it. A count that arrived as
 * null without an error is not a count either.
 */
export function openQuestionCount(documents: CountRead, invoices: CountRead): OpenQuestionCount {
  if (documents.error || invoices.error) return { known: false }
  if (typeof documents.count !== 'number' || typeof invoices.count !== 'number') return { known: false }
  return { known: true, count: documents.count + invoices.count }
}

/**
 * De regel die het dashboard toont zodra er vragen openstaan.
 *
 * [TAAL] A KEY and its parameters, not a sentence: the component renders them in the owner's own
 * language. This module held the Dutch itself, which made the banner the one line on the home
 * no translation could reach. Singular and plural are two keys, and there is never a number beside
 * zero — at zero the banner does not appear at all.
 */
export type VragenBannerRegel =
  | { key: 'start.vragen.een'; params: Record<string, never> }
  | { key: 'start.vragen.meer'; params: { n: number } }

export function vragenBannerRegel(aantal: number): VragenBannerRegel | null {
  if (!Number.isFinite(aantal) || aantal <= 0) return null
  return aantal === 1
    ? { key: 'start.vragen.een', params: {} }
    : { key: 'start.vragen.meer', params: { n: aantal } }
}
