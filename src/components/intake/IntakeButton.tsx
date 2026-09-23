'use client'

// src/components/intake/IntakeButton.tsx
// [SMART-INTAKE-B] Shared "+ Toevoegen" entry — one tap to add a document by
// CAMERA or FILE, routed to /api/intake (the unified router decides the
// destination: invoice / receipt / bank / document). Material You styling
// (ZZP/owner surfaces). The /incoming surface (iOS-styled) has its own inline
// variant; this component is for the Dashboard + werkplek.
//
// Two inputs, one direction (incoming intake): a photo (camera) or a file
// (gallery/PDF/bank statement). Both POST the same way; the server classifies.
// No money write here — the server routes; receipts enter the verify queue as a
// suggestion, never auto-paid.

import { useRef, useState } from 'react'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'

// [INTAKE-QUEUE] Hoeveel foto's er tegelijk verwerkt mogen worden. Drie: genoeg om door te
// fotograferen zonder te wachten, laag genoeg om een mobiele upload niet te laten kruipen.
const MAX_PARALLEL_INTAKE = 3
import { useRouter } from 'next/navigation'
import { combineImagesToPdf } from '@/lib/combine-images-pdf'
// [INTAKE-IMG-NORMALIZE] A lone HEIC/HEIF/WebP/BMP/TIFF (an iPhone photo) reaches the reader as an
// "unsupported type" and is filed as unreadable — losing the invoice. Normalize to a bounded JPEG
// before upload. A PDF (incl. the multi-page combine's output) passes through untouched.
// [UPLOAD-PLAFOND] Fitting an image OR a PDF to the upload budget, and surviving a platform 413,
// is one shared decision now — see upload-fit.ts. This file used to normalize the image itself and
// refuse everything else.
import { sendWithFit } from '@/lib/upload-fit'
// [INTAKE-VOORTGANG] The send goes over XHR so the bytes can be counted as they leave; the dialog
// shows them. fetch has no upload progress — see upload-xhr.ts.
import { postFormWithProgress } from '@/lib/upload-xhr'
import { IntakeProgress, type ProgressPhase } from './IntakeProgress'
// [UPLOAD-ERRORS] Eén vertaler van HTTP-status → wat de eigenaar leest, gedeeld met
// /dashboard/upload. Puur en getest; zonder dit las een 402 of 413 hier als "Toevoegen mislukt".
import { describeUploadFailure } from '@/lib/upload-failure'
import { useToast } from '@/components/ui/Toast'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, sheetPaddingBottom } from '@/lib/design/tokens'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [EERLIJK-GEBRUIK-UITLEG] De uitleg bij een bereikte maandgrens — één plek, gedeeld met het
// beleid en Instellingen, zodat de drie nooit andere getallen noemen.
import { fairUseNotice, type FairUseNotice } from '@/lib/fair-use-notice'
import FairUseModal from '@/components/ui/FairUseModal'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"

type Variant = 'card' | 'fab' | 'compact'

export default function IntakeButton({
  variant = 'card',
  onDone,
}: {
  variant?: Variant
  onDone?: (result: IntakeResult) => void
}) {
  const t = translator(useLocale())
  const router = useRouter()
  // [MOTION] The app-wide snackbar (components/ui/Toast), bound to the name the
  // call sites already used. The local one it replaces could not stack, was
  // never announced to a screen reader, and vanished with the page.
  const showToast = useToast()
  const [open, setOpen] = useState(false)
  // [INTAKE-QUEUE] Hoeveel uploads er OP DIT MOMENT lopen — geen boolean meer.
  //
  // `busy` was één slot: `if (busy) return 'error'` wees een tweede foto ronduit AF, en elke knop
  // stond disabled tot de server klaar was. De trage stap is de AI-lezing, seconden lang, dus wie
  // een stapel bonnen fotografeert stond na elke bon te wachten — en zijn tweede tik verdween
  // zonder melding. De server heeft daar nooit om gevraagd: elk verzoek staat op zichzelf en de
  // dubbelpoort is al race-veilig ([DEDUP-ATOMIC]). De rem zat alleen hier.
  //
  // Een teller in plaats van een slot: de camera komt meteen vrij, de uploads lopen naast elkaar,
  // en het scherm weet nog steeds of er iets loopt (inFlight > 0) voor de knoptekst.
  const [inFlight, setInFlight] = useState(0)
  const busy = inFlight > 0
  // Hoeveel er in deze reeks al binnen zijn — bepaalt of de UITKOMST navigeert of alleen meldt.
  // Zie handleFile: bij één foto verandert er niets aan wat de eigenaar gewend is.
  const batchRef = useRef<{ started: number; done: Array<{ name: string; where: string }> }>({ started: 0, done: [] })
  const [batchSummary, setBatchSummary] = useState<Array<{ name: string; where: string }> | null>(null)
  // [INTAKE-VOORTGANG] One row per file handed over, from the first byte to where it landed. The
  // dialog opens when a file starts and closes itself when nothing is in flight any more — every
  // outcome has its own feedback already (a toast and a move, or a dialog of its own). The X only
  // hides it; the upload is not touched. See IntakeProgress.tsx.
  const [progressRows, setProgressRows] = useState<Array<{ id: string; name: string; phase: ProgressPhase; percent: number; outcome?: string }>>([])
  const [progressOpen, setProgressOpen] = useState(false)
  const rowSeq = useRef(0)
  const patchRow = (id: string, changes: Partial<{ phase: ProgressPhase; percent: number; outcome: string }>) =>
    setProgressRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)))
  // Visible only while something is in flight. Derived, not an effect that closes it: the moment
  // the last upload lands, its own feedback takes over (a toast and a move, or a dialog).
  const progressVisible = progressOpen && inFlight > 0
  // [DUP-MODAL] a duplicate is a decision, not a passing notice — show a modal
  // (stays until dismissed) with a link to the existing invoice, not a toast.
  // [DUP-ARCHIVED] `archived` = de bestaande factuur staat in Genegeerd. Dan is "bestaat al" waar
  // maar onbruikbaar (hij staat in geen enkele gewone lijst), en bij een identiek bestand is
  // terugzetten de enige weg vooruit — de byte-hash-poort is met opzet niet te forceren.
  const [dupModal, setDupModal] = useState<
    // `source` rides along so "Toch toevoegen" re-submits with the SAME provenance it was
    // first sent with — a forced retry of a picked PDF must not turn into a "camera" row.
    { message: string; originalId?: string; canForce?: boolean; archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }; file?: File; source?: 'camera' | 'upload' } | null
  >(null)
  useCloseOnBack(!!dupModal, () => setDupModal(null))
  // [EERLIJK-GEBRUIK-UITLEG] The monthly allowance running out is a decision point, not a
  // status line — see FairUseModal. Its own state beside dupModal, because the two can both
  // be true in one session and neither may swallow the other.
  const [fairUse, setFairUse] = useState<FairUseNotice | null>(null)
  const [restoring, setRestoring] = useState(false)
  // [INTAKE-DEST-MODAL] When a file is NOT an invoice (destination 'document'),
  // the owner needs to KNOW where it landed — a persistent modal (iOS-styled,
  // matching /incoming) with the destination folder + a deep-link that
  // highlights the file in Mijn bestanden. A fleeting toast is not enough: the
  // owner uploads and wonders "where did that go?".
  const [destModal, setDestModal] = useState<
    // [UNREAD-HONESTY] couldNotRead: het bestand is bewaard maar NIET gelezen (onscherpe foto,
    // mislukte AI-lezing). /api/intake zegt dat met could_not_read, en dit scherm negeerde het —
    // kop "Bestand toegevoegd", mapje-icoon, en de eerlijke zin van de server werd hieronder zelfs
    // WEGGEGOOID zodra er een mapnaam was. Zie de modal onderaan.
    { fileName: string; message: string; folderName: string | null; folderId: string | null; documentId: string | null; isDuplicate?: boolean; couldNotRead?: boolean } | null
  >(null)
  // [NAAM-BIJ-BINNENKOMST] The rename, offered where the name is worst. `null` = not renaming;
  // a string = the draft being typed. Kept beside destModal rather than inside it because it is
  // the owner's unsaved intent, and it must never be mistaken for what the server holds.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [nameBusy, setNameBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  // [NAAM-BIJ-BINNENKOMST] Save the new name, or say plainly that it was not saved.
  //
  // Same rule the Bestanden screen already follows: on a failure the OLD name stays on screen. A
  // rename that only succeeded locally is worse than none — the owner walks away believing the
  // file is called something it is not, and then cannot find it.
  async function saveName() {
    const id = destModal?.documentId
    const next = (nameDraft ?? '').trim()
    if (!id || !next || next === destModal?.fileName) { setNameDraft(null); setNameError(null); return }
    setNameBusy(true); setNameError(null)
    try {
      const res = await fetch(`/api/bestanden?id=${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: next }),
      })
      if (!res.ok) { setNameError(t('int.naam.mislukt')); return }
      setDestModal((m) => (m ? { ...m, fileName: next } : m))
      setNameDraft(null)
    } catch {
      // A dropped connection is not a saved name either.
      setNameError(t('int.naam.mislukt'))
    } finally {
      setNameBusy(false)
    }
  }

  // [NAAM-BIJ-BINNENKOMST] One closer for the sheet, because the draft has to die with it. A
  // half-typed name left in state reopens the NEXT upload's sheet already in edit mode, showing a
  // previous file's name over a new file — the one mistake this feature must not introduce.
  const closeDest = () => { setDestModal(null); setNameDraft(null); setNameError(null) }
  useCloseOnBack(!!destModal, closeDest)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // [MULTI-PAGE] "Meerdere pagina's = één factuur" — gather the pages of ONE invoice, combine
  // them into a single multi-page PDF, then send it as ONE file (same /api/intake). The owner
  // opts in, so we never guess whether separate photos are one invoice or several.
  const [mpMode, setMpMode] = useState(false)
  const [mpPages, setMpPages] = useState<File[]>([])
  const [combining, setCombining] = useState(false)
  const mpCameraRef = useRef<HTMLInputElement>(null)
  const mpFileRef = useRef<HTMLInputElement>(null)
  const MAX_PAGES = 20


  // [DUP-ARCHIVED] "Terugzetten" — de upload botste op een factuur die de eigenaar zelf genegeerd
  // heeft. Opnieuw uploaden lost dat niet op (bij identieke bytes kán het niet eens); de bestaande
  // factuur terugzetten wél. Daarna staat hij weer in de controlewachtrij op Inkomend.
  async function restoreIgnored(invoiceId: string) {
    if (restoring) return
    setRestoring(true)
    try {
      const res = await fetch(`/api/email/confirm/${invoiceId}`, { method: 'PATCH' })
      if (res.ok) {
        setDupModal(null)
        showToast(t('int.teruggezet'))
        setTimeout(() => router.push('/dashboard/incoming'), 600)
      } else {
        // [UI-HONESTY] 409 = hij staat niet (meer) in Genegeerd. Nooit een succes tonen dat er niet was.
        const data = await res.json().catch(() => ({}))
        showToast(failureText(res.status, data, t('int.terugzettenVervers')))
      }
    } catch {
      showToast(t('int.fout.terugzetten'))
    } finally {
      setRestoring(false)
    }
  }

  function addMpPages(fl: FileList | null) {
    if (!fl || fl.length === 0) return
    // [MP-FILTER] Same set the upload page accepts — bmp/tiff belong here too: a flatbed scan
    // often arrives as .bmp/.tif with an EMPTY mime, and this filter silently dropped it while
    // /dashboard/upload took it. Two surfaces, one answer to "is this a page?".
    const imgs = Array.from(fl).filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(f.name),
    )
    if (imgs.length === 0) { showToast(t('int.kiesFotos')); return }
    // [MP-PURE-UPDATER] Decide BEFORE updating state. showToast used to fire from inside the
    // setMpPages updater — a reducer must be pure, and React may run it twice (StrictMode /
    // concurrent rendering), which showed the cap warning twice for one pick.
    const merged = [...mpPages, ...imgs]
    const capped = merged.length > MAX_PAGES
    setMpPages(capped ? merged.slice(0, MAX_PAGES) : merged)
    if (capped) showToast(t('int.maxPaginas', { n: MAX_PAGES }))
  }
  function closeMultiPage() { setMpMode(false); setMpPages([]) }
  async function combineAndUpload() {
    if (mpPages.length === 0 || combining || busy) return
    setCombining(true)
    try {
      const pdf = await combineImagesToPdf(mpPages)
      const outcome = await handleFile(pdf) // same single-file path: dedup, extract → one invoice
      if (outcome === 'error') {
        // [MP-RETRY] Transient upload failure — KEEP the pages and reopen the sheet so the owner
        // can retry without re-photographing. (handleFile closed the sheet on entry.)
        setOpen(true)
      } else {
        // 'ok' or 'duplicate' — the invoice landed (or already exists); the pages are done.
        setMpMode(false); setMpPages([])
      }
    } catch (e) {
      // Combine failure names either the failing page ("Pagina 2 kon niet…") or the reason the
      // set cannot fit one upload ("Deze 20 pagina's passen samen niet…"). Both are actionable
      // and specific, so surface them as-is; only a truly unknown error gets the generic line.
      showToast(e instanceof Error && /^(Pagina|Deze \d+ pagina)/.test(e.message) ? e.message : t('int.combinerenMislukt'))
    } finally {
      setCombining(false)
    }
  }

  // [INTAKE-QUEUE] Mag DEZE uitkomst het scherm verplaatsen?
  //
  // Het antwoord hangt niet aan de uitkomst maar aan de reeks. Bij één foto — verreweg het meeste —
  // verandert er niets: de eigenaar wordt gebracht waar zijn factuur landde, precies zoals altijd.
  // Loopt er nog iets, dan zou navigeren de andere uploads achterlaten op een pagina die de
  // gebruiker net verlaten heeft; dan is een melding het eerlijke maximum en komt de samenvatting
  // aan het eind.
  //
  // `inFlight` is hier al met deze upload verlaagd door de finally in handleFile? Nee — deze functie
  // wordt AANGEROEPEN vóór die finally, dus 1 betekent "alleen ik loop nog".
  function mayNavigate(): boolean {
    return inFlight <= 1 && batchRef.current.started <= 1
  }

  /** Onthoud waar dit bestand landde, voor de samenvatting van een reeks — en voor zijn regel in
   *  de voortgangsdialoog, die hetzelfde zegt terwijl de rest nog loopt. */
  function noteLanded(rowId: string, name: string, where: string) {
    batchRef.current.done.push({ name, where })
    patchRow(rowId, { outcome: where })
  }

  // Returns the outcome so the multi-page flow knows whether to KEEP the collected pages
  // (a transient 'error') or clear them ('ok' | 'duplicate' — no point retrying the same pages).
  async function handleFile(file: File, force = false, source: 'camera' | 'upload' = 'camera'): Promise<'ok' | 'duplicate' | 'error'> {
    // [INTAKE-QUEUE] Alleen een plafond, geen slot. Drie tegelijk: genoeg om te blijven
    // fotograferen, weinig genoeg om een mobiele verbinding niet dicht te trekken — vier grote
    // foto's tegelijk over 4G maken élke upload trager in plaats van sneller.
    if (inFlight >= MAX_PARALLEL_INTAKE) {
      showToast(t('int.drieBezig'))
      return 'error'
    }
    setInFlight((n) => n + 1)
    batchRef.current.started += 1
    setOpen(false)
    // [INTAKE-VOORTGANG] A row in the dialog before anything happens to the file. A fresh batch
    // (this is the first of it — `started` was reset to 0 when the last one finished) starts a
    // fresh list, so yesterday's rows do not sit above today's file.
    const rowId = `r${++rowSeq.current}`
    setProgressRows((prev) => (batchRef.current.started === 1 ? [] : prev).concat({ id: rowId, name: file.name, phase: 'fitting', percent: 0 }))
    setProgressOpen(true)
    try {
      // [UPLOAD-PLAFOND] One call that makes the file fit, whatever it is: an image is re-encoded
      // (and an unreadable HEIC rescued), a PDF has its embedded images downsampled while its text
      // stays text. This surface used to normalize the image and then REFUSE a large PDF with
      // "Splits een grote PDF of maak een foto" — an instruction the owner cannot carry out on a
      // phone, for a document the app was already able to shrink on another screen.
      //
      // sendWithFit also answers a platform 413 by squeezing harder and sending once more. The
      // budget is our estimate of somebody else's limit; the retry is what makes a wrong estimate
      // recoverable instead of terminal.
      const { response: res, sent: uploadFile, retried } = await sendWithFit(file, (f) => {
        const fd = new FormData()
        fd.append('file', f)
        // [INTAKE-FORCE] "toch toevoegen" — override a false-positive SEMANTIC duplicate.
        if (force) fd.append('force', 'true')
        // [INTAKE-SOURCE] Where this file actually came from. Every intake used to be recorded as
        // 'camera', so a PDF picked from Files — or a combined multi-page scan — claimed to be a
        // photo in Mijn bestanden and in the audit trail. Both values are in the documents.source
        // CHECK constraint; the server validates and falls back to 'camera'.
        fd.append('source', source)
        // [INTAKE-VOORTGANG] The fit is done by the time send runs, so this is where uploading
        // starts; the browser counts the bytes out, and 'reading' begins when the last one is up.
        patchRow(rowId, { phase: 'uploading', percent: 0 })
        return postFormWithProgress('/api/intake', fd, {
          onProgress: (sent, total) => patchRow(rowId, { percent: Math.round((sent / total) * 100) }),
          onUploaded: () => patchRow(rowId, { phase: 'reading', percent: 100 }),
        })
      })
      if (retried) {
        console.warn('[UPLOAD-PLAFOND] the platform refused the first attempt for size — sent a smaller one', {
          name: file.name, first: file.size, sent: uploadFile.size,
        })
      }
      // [JSON-GUARD] A non-JSON error body (a platform 413, a proxy 502, an HTML error page)
      // made res.json() THROW, which fell through to the generic catch below and replaced the
      // real reason with "probeer opnieuw". Degrade to an empty object instead, exactly as
      // /dashboard/upload does, so the status-code branches below still run.
      const data: IntakeResult = await res.json().catch(() => ({} as IntakeResult))

      if (!res.ok) {
        // A duplicate (409) is a decision point — show a persistent modal, not a
        // fleeting toast. There are TWO kinds of duplicate:
        //   - a file already in Mijn bestanden (data.existing) → reuse the
        //     destination modal so the owner gets a link to WHERE it already is
        //     (highlighted), consistent with a fresh non-invoice upload.
        //   - an invoice duplicate (data.original_id) → link to the invoice in
        //     the incoming manage view.
        let outcome: 'duplicate' | 'error' = 'error'
        // [DUP-ARCHIVED] `data.archived` telt hier mee als reden voor de FACTUUR-modal: een
        // byte-hash-duplicaat van een genegeerde factuur draagt geen original_id/canForce en zou
        // anders in de bestandslocatie-modal belanden ("staat in map X") — precies de melding die
        // de eigenaar niet verder helpt, en zónder de knop die dat wél doet.
        if (res.status === 409 && data.duplicate && (data.original_id || data.canForce || data.archived)) {
          // SEMANTIC invoice duplicate (same invoice, DIFFERENT file — possibly a false
          // positive). Must be checked BEFORE data.existing: the semantic 409 usually ALSO
          // carries `existing` (the original's document), and routing on that first sent it
          // to the file-location modal — hiding the "Toch toevoegen" override and
          // mislabelling a genuinely different file as "al toegevoegd".
          // [INTAKE-QUEUE] Deze modal ONDERBREEKT met opzet, ook tijdens een reeks: hij draagt een
          // beslissing ("Toch toevoegen") die alleen de eigenaar kan nemen, en hem wegstoppen in een
          // samenvatting zou betekenen dat een factuur stil buiten de boeken blijft.
          noteLanded(rowId, file.name, t('int.landed.mogelijkDubbel'))
          setDupModal({ message: failureText(res.status, data, t('int.bestaatAl')), originalId: data.original_id, canForce: !!data.canForce, archived: data.archived, file, source })
          outcome = 'duplicate'
        } else if (res.status === 409 && data.duplicate && data.existing?.id) {
          // BYTE-HASH duplicate of a file (exact same bytes) → show where it already is.
          // [INTAKE-QUEUE] Een blijvende modal onderbreekt het fotograferen. Tijdens een reeks
          // wordt hij daarom een melding — maar de regel in de samenvatting moet zeggen dat dit
          // bestand NIET is toegevoegd. Een afwijzing die alleen als "verwerkt" in het lijstje
          // staat, is precies de stille verdwijning waar deze app tegen is gebouwd.
          noteLanded(rowId, file.name, t('int.landed.dubbel'))
          if (mayNavigate()) setDestModal({
            fileName: file.name,
            message: failureText(res.status, data, t('int.bestandBestaatAl')),
            folderName: data.existing.folder_name ?? null,
            folderId: data.existing.folder_id ?? null,
            documentId: data.existing.id,
            isDuplicate: true,
          })
          else showToast(data.message || t('int.toegevoegd'))
          outcome = 'duplicate'
        } else if (res.status === 409 && data.duplicate) {
          setDupModal({ message: failureText(res.status, data, t('int.bestaatAl')), originalId: data.original_id, canForce: !!data.canForce, archived: data.archived, file, source })
          outcome = 'duplicate'
        } else {
          // [UPLOAD-ERRORS] Dezelfde vertaler als /dashboard/upload. `data.error || 'Toevoegen
          // mislukt'` klopte precies één keer: bij onze eigen 5xx. Een 402 (maandtegoed op) las als
          // een storing terwijl de server de reden én de uitweg meestuurt, en een 413/504 komt van
          // het platform met een HTML-body — dus data.error bestond daar niet eens en de eigenaar
          // kreeg "Toevoegen mislukt" over een bestand waar niets mis mee was.
          // [EERLIJK-GEBRUIK-UITLEG] The fair-use refusal gets a modal, not a toast. It is the
        // most consequential thing this app says: from here documents are stored but no longer
        // READ, so every screen the owner opens afterwards is missing invoices they believe were
        // processed. As a toast it faded in a few seconds and never named the limit at all.
        //
        // Keyed on `reason === 'fair_use'`, never on the 402 status alone — a payment provider
        // answers 402 too, and a monthly-allowance explanation would be nonsense there.
        const fu = fairUseNotice(data)
        if (fu) setFairUse(fu)
        else showToast(describeUploadFailure(res.status, data.error).message)
          outcome = 'error'
        }
        // [INTAKE-VOORTGANG] A duplicate is an answer, not a failure: its row is done, and says so.
        patchRow(rowId, { phase: outcome === 'error' ? 'failed' : 'done' })
        return outcome
      }

      // Destination-aware feedback + navigation.
      onDone?.(data)

      // [ONTVANGEN-WAAR] Receive-first is its own outcome, and the ONLY one where nothing is known
      // yet about what the file is. `received: true` is the fact; `destination: 'received'` is the
      // same fact under the field every other branch here switches on. Read the boolean, because
      // that is what the route promises and what the upload screen also reads.
      const isReceived = data.received === true

      // Route the owner to where the item landed, so they can confirm/see it.
      if (isReceived) {
        // No navigation and no destination sheet: there is nowhere better to be than here. The
        // server's own sentence already says the whole thing ("Ontvangen — je kunt verder…"), so
        // this adds no wording of its own, and the summary line during a photo series says the
        // same as the row: received, not filed.
        showToast(data.message || t('int.ontvangen'))
        noteLanded(rowId, file.name, t('int.landed.ontvangen'))
      } else if (data.destination === 'invoice' || data.destination === 'receipt') {
        showToast(data.message || t('int.toegevoegd'))
        // [AUTO-ADVANCE-HONESTY] An auto-verified invoice is booked ('received') and so
        // is NOT in the verify queue. Sending the owner to /dashboard/incoming — as this
        // did for every invoice — landed them on a queue that does not contain the file
        // they just photographed, right after a toast saying it was processed. Route to
        // the surface that actually holds it, focused on the row.
        const target = data.auto_verified && data.invoice_id
          ? `/dashboard/incoming/manage?focus=${data.invoice_id}`
          : '/dashboard/incoming'
        noteLanded(rowId, file.name, data.destination === 'receipt' ? t('int.landed.bon') : t('int.landed.factuur'))
        if (mayNavigate()) setTimeout(() => router.push(target), 600)
      } else if (data.destination === 'bank') {
        showToast(data.message || t('int.toegevoegd'))
        noteLanded(rowId, file.name, t('int.landed.bank'))
        if (mayNavigate()) setTimeout(() => router.push('/dashboard/bank'), 600)
      } else if (data.destination === 'statement') {
        // [STATEMENT-RECONCILE] Een leveranciersoverzicht wordt niet geboekt maar vergeleken:
        // de uitkomst ("2 van de 9 facturen heb je niet") is het hele punt en mag niet in een
        // toast van drie seconden verdwijnen. Zelfde blijvende modal als een gewoon bestand —
        // die toont de boodschap én de link naar het bestand in Mijn bestanden.
        // [INTAKE-QUEUE] Een blijvende modal onderbreekt het fotograferen; tijdens een reeks komt
        // de zin in de samenvatting te staan.
        noteLanded(rowId, file.name, t('int.landed.overzicht'))
        if (mayNavigate()) setDestModal({
          fileName: file.name,
          message: data.message || t('int.overzichtGecontroleerd'),
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
        })
        else showToast(data.message || t('int.toegevoegd'))
      } else if (data.destination === 'reminder') {
        // [HERINNERING-NOOIT] Een betalingsherinnering wordt bewaard en aan zijn factuur gekoppeld,
        // nooit geboekt. De zin zegt wat er met de factuur is (betaald / open / niet in de boeken)
        // en hoort dus in de blijvende modal, niet in een toast.
        noteLanded(rowId, file.name, t('int.landed.herinnering'))
        if (mayNavigate()) setDestModal({
          fileName: file.name,
          message: data.message || t('int.herinneringBewaard'),
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
        })
        else showToast(data.message || t('int.herinneringBewaard'))
      } else if (data.destination === 'turnover') {
        // [INTAKE-DEST-OMZET] Een kassabestand is GEBOEKTE OMZET — /api/intake schrijft de dagen
        // meteen in daily_turnover en zegt in zijn eigen boodschap "Controleer in Dagomzet".
        // Dat is de zwaarste uitkomst die deze knop kan hebben: er staat geld in de boeken.
        // Toch viel hij hier tot nu toe in de restbak — een toast van drie seconden en
        // router.refresh(), dus de eigenaar bleef staan waar hij stond, zonder weg naar de
        // pagina die hij net gevraagd werd te controleren. Elke andere bestemming brengt hem
        // wél naar waar zijn bestand landde; deze hoort dat als eerste te doen.
        showToast(data.message || t('int.dagomzetGeboekt'))
        noteLanded(rowId, file.name, t('int.landed.dagomzet'))
        if (mayNavigate()) setTimeout(() => router.push('/dashboard/dagomzet'), 600)
      } else if (data.destination === 'ledger') {
        // [INTAKE-DEST-CHECK] Een grootboek-/controlebestand is NADRUKKELIJK GEEN geld: het telt
        // niet mee in de omzet en heeft daarom geen eigen scherm — het werkt door in de
        // reconciliatie en op het klaar-scherm. De uitkomst is dus een ZIN ("14 dagen als
        // controle-check"), geen plaats. Precies zoals bij een leveranciersoverzicht mag die zin
        // niet in een toast verdwijnen: dezelfde blijvende modal, met de link naar het bestand.
        // [INTAKE-QUEUE] Zie hierboven: tijdens een reeks een melding, met de zin in de samenvatting.
        noteLanded(rowId, file.name, t('int.landed.controle'))
        if (mayNavigate()) setDestModal({
          fileName: file.name,
          message: data.message || t('int.ingelezenControle'),
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
        })
        else showToast(data.message || t('int.toegevoegd'))
      } else if (data.destination === 'document') {
        // [INTAKE-DEST-MODAL] Not an invoice → the owner can't guess where it
        // went. Show a persistent modal with the destination + a deep-link that
        // highlights the file in Mijn bestanden. No auto-redirect: the owner
        // decides whether to open it (tap the link) or stay (tap "Klaar").
        // [INTAKE-QUEUE] Een blijvende modal onderbreekt het fotograferen. Alleen tonen als
        // deze upload de enige was; anders melden en in de samenvatting opnemen.
        noteLanded(rowId, file.name, t('int.landed.bestand'))
        if (mayNavigate()) setDestModal({
          // [NAAM-BIJ-BINNENKOMST] The name the server STORED. A photo is wrapped into a PDF at
          // intake ([INTAKE-IMG-PDF]), so `IMG_20260819_211723.jpg` is filed as `.pdf` — and this
          // sheet used to print the browser's File.name, naming a file that is not the one in
          // Bestanden. An owner who went looking would search for the wrong thing.
          fileName: data.file_name || file.name,
          message: data.message || t('int.opgeslagen'),
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
          // [UNREAD-HONESTY] "Geen factuur herkend" en "we konden het niet lezen" zijn twee heel
          // verschillende uitkomsten, en alleen de tweede vraagt om een handeling. De route zegt
          // welke van de twee het is; dit scherm las dat veld niet.
          couldNotRead: data.could_not_read === true,
        })
        else showToast(data.message || t('int.toegevoegd'))
      } else {
        // Restbak. Sinds hierboven alle zeven bestemmingen van /api/intake een eigen tak hebben,
        // komt hier alleen nog een antwoord ZONDER destination — een oudere of onvolledige
        // response. Dan is de boodschap van de server het enige eerlijke dat we hebben.
        showToast(data.message || t('int.toegevoegd'))
        router.refresh()
      }
      // [ONTVANGEN-WAAR] Wat deze rij als EINDstand mag zeggen.
      //
      // De voortgangsfase heette hierboven al geen 'lezen' meer, maar de laatste regel zei nog
      // 'Klaar'. Bij receive-first is dat de verkeerde belofte: de eigenaar gaf het bestand af en
      // dát is af — de lezing begint dan pas. "Je hebt het aan BoekBrug gegeven, jouw werk zit
      // erop" en "de AI is al klaar" zijn twee verschillende uitspraken, en alleen de eerste is op
      // dit moment te bewijzen.
      //
      // Er komt met opzet geen volgsysteem bij om de rij later alsnog op 'Klaar' te zetten; de
      // openstaande vraag, als die er komt, verschijnt in het vragenpaneel.
      patchRow(rowId, { phase: isReceived ? 'received' : 'done' })
      return 'ok'
    } catch {
      showToast(t('int.fout.toevoegen'))
      patchRow(rowId, { phase: 'failed' })
      return 'error'
    } finally {
      // [INTAKE-QUEUE] De teller zakt hier, en NIET eerder: pas als hij nul is, is de reeks klaar
      // en mag de uitkomst het scherm verplaatsen.
      setInFlight((n) => {
        const left = Math.max(0, n - 1)
        // Laatste van een REEKS (meer dan één foto) → één samenvatting, want de losse uitkomsten
        // zijn onderweg alleen als melding langsgekomen. Bij één foto gebeurt hier niets: die heeft
        // zijn eigen modal of navigatie al gehad, precies zoals altijd.
        if (left === 0 && batchRef.current.started > 1) {
          setBatchSummary([...batchRef.current.done])
          router.refresh()
        }
        if (left === 0) batchRef.current = { started: 0, done: [] }
        return left
      })
    }
  }

  // ─── Trigger button (varies by placement) ───────────────────────────────────
  const trigger =
    variant === 'fab' ? (
      <button
        onClick={() => setOpen(true)}
        disabled={inFlight >= MAX_PARALLEL_INTAKE}
        aria-label={t('ink.toevoegen')}
        style={{
          position: 'fixed',
          bottom: 'calc(88px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
          right: 20,
          background: M3.primary, color: M3.onPrimary,
          borderRadius: 16, padding: '16px 20px',
          fontSize: 15, fontWeight: 600, border: 'none',
          cursor: inFlight >= MAX_PARALLEL_INTAKE ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, zIndex: 49,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>
          {busy ? 'hourglass_empty' : 'add_a_photo'}
        </span>
        {t('int.bonFactuur')}
      </button>
    ) : variant === 'compact' ? (
      <button
        onClick={() => setOpen(true)}
        disabled={inFlight >= MAX_PARALLEL_INTAKE}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: M3.primaryContainer, color: M3.onPrimaryContainer,
          borderRadius: R.full, padding: '10px 18px',
          border: 'none', cursor: inFlight >= MAX_PARALLEL_INTAKE ? 'not-allowed' : 'pointer',
          fontFamily: FONT, fontSize: 14, fontWeight: 600,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
          {busy ? 'hourglass_empty' : 'add_a_photo'}
        </span>
        {t('ink.toevoegen')}
      </button>
    ) : (
      // 'card' — matches the Dashboard ActionCard look
      <button
        onClick={() => setOpen(true)}
        disabled={inFlight >= MAX_PARALLEL_INTAKE}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          background: '#fff', borderRadius: R.lg, padding: '18px 16px',
          border: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          cursor: inFlight >= MAX_PARALLEL_INTAKE ? 'not-allowed' : 'pointer', textAlign: 'start', width: '100%',
          fontFamily: FONT,
        }}
      >
        <div style={{ width: 50, height: 50, borderRadius: R.md, background: M3.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 26 }} aria-hidden>
            {busy ? 'hourglass_empty' : 'add_a_photo'}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 2 }}>{t('int.toevoegen')}</p>
          {/* [INTAKE-QUEUE] Tijdens het verwerken blijft de knop BRUIKBAAR — dat is het hele punt.
              De regel zegt daarom wat er loopt in plaats van dat je moet wachten. */}
          <p style={{ fontSize: 13, color: '#5F6368' }}>
            {busy
              ? t('int.wordtGelezen', { n: inFlight })
              : t('int.maakFotoUpload')}
          </p>
        </div>
        <span className="material-symbols-outlined icon-dir" style={{ color: '#80868b', fontSize: 20 }} aria-hidden>chevron_right</span>
      </button>
    )

  return (
    <>
      {trigger}

      {/* Hidden inputs: camera (environment) + file (gallery/PDF/bank) */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, false, 'camera'); e.currentTarget.value = '' }}
      />
      {/* [INTAKE-ACCEPT] The same set /dashboard/upload offers, because /api/intake handles the
          same set: a kassa Z-report / grootboek export (.xls/.xlsx/.csv → handleSpreadsheet) and
          a bank CSV export (ING/Rabo/bunq → the bank pipeline). Those were missing here, so this
          sheet promised "PDF, afbeelding of bankafschrift" while the most common bankafschrift —
          a CSV export — could not even be selected, and a shop could not add its monthly till
          file from the button it is told to use. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt,.940,.xls,.xlsx,.csv"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, false, 'upload'); e.currentTarget.value = '' }}
      />
      {/* [MULTI-PAGE] pages of ONE invoice — camera adds one at a time, file picker several. */}
      <input
        ref={mpCameraRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = '' }}
      />
      <input
        ref={mpFileRef} type="file" accept="image/*" multiple
        style={{ display: 'none' }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = '' }}
      />

      {/* [INTAKE-VOORTGANG] What is happening to the file, from the moment it was picked. */}
      <IntakeProgress
        open={progressVisible}
        title={busy ? t('int.voortgang.titel') : t('int.voortgang.klaarTitel')}
        rows={progressRows.map((r) => ({
          ...r,
          phaseLabel:
            r.phase === 'fitting' ? t('int.voortgang.klaarmaken')
            : r.phase === 'uploading' ? t('int.voortgang.uploaden', { p: r.percent })
            : r.phase === 'reading' ? t('int.voortgang.bewaren')
            // [ONTVANGEN-WAAR] The handoff is complete; the read is not. Not 'Klaar'.
            : r.phase === 'received' ? t('int.voortgang.ontvangen')
            : r.phase === 'done' ? t('int.voortgang.klaar')
            : t('int.voortgang.mislukt'),
        }))}
        closeLabel={t('int.voortgang.sluit')}
        footnote={t('int.voortgang.achtergrond')}
        onClose={() => setProgressOpen(false)}
      />

      {/* Choice sheet */}
      {open && (
        <div
          // [MP-KEEP-PAGES] A tap on the backdrop closes the sheet, but it must NOT throw away
          // pages the owner already photographed: closeMultiPage() empties mpPages, so one stray
          // tap next to the sheet silently destroyed up to 20 photos of a paper invoice, with no
          // warning and no undo. With pages in the tray the backdrop is inert — the explicit
          // "Terug" button inside the sheet is the way out, and it is right there.
          onClick={() => { if (!combining && mpPages.length === 0) { setOpen(false); closeMultiPage() } }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div className="sheet-scroll" onClick={(e) => e.stopPropagation()} style={{ background: M3.surface, borderRadius: '28px 28px 0 0', padding: '24px 20px 32px', paddingBottom: sheetPaddingBottom(32), width: '100%', maxWidth: 480, boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', fontFamily: FONT }}>
            <div style={{ width: 32, height: 4, background: '#DADCE0', borderRadius: 2, margin: '0 auto 20px' }} />

            {!mpMode ? (
              <>
                <p style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, marginBottom: 4, textAlign: 'center' }}>{t('ink.toevoegen')}</p>
                <p style={{ fontSize: 13, color: '#5F6368', textAlign: 'center', marginBottom: 20 }}>
                  {t('int.sheetUitleg')}
                </p>

                <button
                  onClick={() => cameraRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: M3.primary, color: '#fff', borderRadius: R.lg, padding: '18px 16px', border: 'none', cursor: 'pointer', fontFamily: FONT, marginBottom: 12 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }} aria-hidden>photo_camera</span>
                  <div style={{ flex: 1, textAlign: 'start' }}>
                    <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{t('int.fotoMaken')}</p>
                    <p style={{ fontSize: 13, opacity: 0.9 }}>{t('int.fotograferen')}</p>
                  </div>
                </button>

                <button
                  onClick={() => fileRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: M3.primaryContainer, color: M3.onPrimaryContainer, borderRadius: R.lg, padding: '18px 16px', border: 'none', cursor: 'pointer', fontFamily: FONT, marginBottom: 12 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }} aria-hidden>upload_file</span>
                  <div style={{ flex: 1, textAlign: 'start' }}>
                    <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{t('int.bestand')}</p>
                    <p style={{ fontSize: 13, opacity: 0.85 }}>{t('int.pdfBeeld')}</p>
                  </div>
                </button>

                {/* [MULTI-PAGE] A paper invoice of 2+ pages, photographed page by page. */}
                <button
                  onClick={() => setMpMode(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: '#fff', color: M3.onSurface, borderRadius: R.lg, padding: '16px', border: '1.5px solid #DADCE0', cursor: 'pointer', fontFamily: FONT }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 26, color: M3.primary }} aria-hidden>description</span>
                  <div style={{ flex: 1, textAlign: 'start' }}>
                    <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{t('ink.meerderePaginas')}</p>
                    <p style={{ fontSize: 12.5, color: '#5F6368' }}>{t('int.paginasSamen')}</p>
                  </div>
                </button>

                <p style={{ fontSize: 11.5, color: '#8e8e93', textAlign: 'center', margin: '12px 4px 0', lineHeight: 1.45 }}>
                  {t('int.eenPdfUitleg')}
                </p>

                <button onClick={() => { setOpen(false); closeMultiPage() }} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, marginTop: 8 }}>
                  {t('lijst.annuleren')}
                </button>
              </>
            ) : (
              // [MULTI-PAGE] Collector — like a scanner's "add page": snap/pick each page, then combine.
              <>
                <p style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, marginBottom: 4, textAlign: 'center' }}>{t('ink.eenFactuurMeerPaginas')}</p>
                <p style={{ fontSize: 13, color: '#5F6368', textAlign: 'center', marginBottom: 16 }}>
                  {t('int.mpUitleg')}
                </p>

                {mpPages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, maxHeight: '32vh', overflowY: 'auto' }}>
                    {mpPages.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#F1F3F4', borderRadius: 10 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: M3.primary, minWidth: 62 }}>{t('int.pagina', { n: i + 1 })}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#5F6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <button onClick={() => setMpPages((prev) => prev.filter((_, j) => j !== i))} disabled={combining} aria-label={t('ink.verwijderPagina')}
                          style={{ border: 'none', background: 'transparent', color: '#70757a', fontSize: 18, cursor: combining ? 'default' : 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => !combining && mpCameraRef.current?.click()} disabled={combining}
                    style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontWeight: 600, fontSize: 13.5, cursor: combining ? 'default' : 'pointer', fontFamily: FONT }}>
                    📷 {t('int.paginaFotograferen')}
                  </button>
                  <button onClick={() => !combining && mpFileRef.current?.click()} disabled={combining}
                    style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontWeight: 600, fontSize: 13.5, cursor: combining ? 'default' : 'pointer', fontFamily: FONT }}>
                    🖼️ {t('int.paginasKiezen')}
                  </button>
                </div>

                <button onClick={combineAndUpload} disabled={combining || mpPages.length === 0}
                  style={{ width: '100%', padding: '15px', borderRadius: R.lg, border: 'none', fontWeight: 700, fontSize: 15, fontFamily: FONT,
                    background: combining || mpPages.length === 0 ? '#C7C7CC' : M3.primary, color: '#fff',
                    cursor: combining || mpPages.length === 0 ? 'default' : 'pointer' }}>
                  {combining ? t('act.bezig') : mpPages.length > 0 ? (mpPages.length === 1 ? t('int.combineerEen') : t('int.combineer', { n: mpPages.length })) : t('int.voegEerstToe')}
                </button>

                <button onClick={closeMultiPage} disabled={combining}
                  style={{ width: '100%', padding: '13px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 15, fontWeight: 600, border: 'none', cursor: combining ? 'default' : 'pointer', fontFamily: FONT, marginTop: 8 }}>
                  {t('int.terug')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* [DUP-MODAL] Persistent duplicate dialog — stays until dismissed, with
          a link to the existing invoice (same deep-link as notifications). */}
      {fairUse && <FairUseModal notice={fairUse} onClose={() => setFairUse(null)} />}

      {dupModal && (
        <div
          onClick={() => setDupModal(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div className="sheet-scroll" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 24, padding: '28px 24px', width: '100%', maxWidth: 380, boxShadow: '0 12px 40px rgba(0,0,0,0.24)', fontFamily: FONT, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: R.full, background: '#FEE8C4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 30, color: '#7C5800' }} aria-hidden>content_copy</span>
            </div>
            <p style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface, marginBottom: 8 }}>
              {/* [DUP-ARCHIVED] Genegeerd is een ándere situatie dan "bestaat al" — de kop zegt welke. */}
              {dupModal.archived ? t('int.staatGenegeerd') : t('int.bestaatAl')}
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 24, lineHeight: 1.5 }}>{dupModal.message}</p>

            {/* [DUP-ARCHIVED] De handeling die hier werkt, als eerste knop. Bij een identiek bestand
                is dit de enige — de byte-hash-poort kent geen "toch toevoegen". */}
            {dupModal.archived && (
              <button
                onClick={() => restoreIgnored(dupModal.archived!.invoice_id)}
                disabled={restoring}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: M3.primary, color: '#fff', borderRadius: R.full, padding: '14px', border: 'none', cursor: restoring ? 'default' : 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600, marginBottom: 10, opacity: restoring ? 0.6 : 1 }}
              >
                {restoring ? t('act.bezig') : t('int.terugzettenGenegeerd')}
                {!restoring && <span className="material-symbols-outlined icon-dir" style={{ fontSize: 18 }} aria-hidden>undo</span>}
              </button>
            )}

            {dupModal.originalId && !dupModal.archived && (
              <button
                onClick={() => { const id = dupModal.originalId; setDupModal(null); router.push(`/dashboard/incoming/manage?focus=${id}`) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: M3.primary, color: '#fff', borderRadius: R.full, padding: '14px', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600, marginBottom: 10 }}
              >
                {t('int.bestaande')}
                <span className="material-symbols-outlined icon-dir" style={{ fontSize: 18 }} aria-hidden>arrow_forward</span>
              </button>
            )}
            {/* [INTAKE-FORCE] A semantic match can be a false positive (two distinct
                same-day receipts, same vendor/amount, no number). Let the owner add it
                anyway — re-submits with force=true; the exact-same-file gate still holds. */}
            {dupModal.canForce && dupModal.file && (
              <button
                onClick={() => { const f = dupModal.file!; const src = dupModal.source ?? 'camera'; setDupModal(null); handleFile(f, true, src) }}
                style={{ width: '100%', background: 'transparent', color: '#7C5800', borderRadius: R.full, padding: '13px', border: '1px solid #E0C48A', cursor: 'pointer', fontFamily: FONT, fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}
              >
                {t('int.tochAndere')}
              </button>
            )}
            <button
              onClick={() => setDupModal(null)}
              style={{ width: '100%', background: 'transparent', color: M3.primary, borderRadius: R.full, padding: '12px', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600 }}
            >
              {t('bank.begrepen')}
            </button>
          </div>
        </div>
      )}

      {/* [INTAKE-DEST-MODAL] Non-invoice file → persistent modal telling the
          owner WHERE it landed, with a deep-link that highlights it in Mijn
          bestanden. iOS-styled to match the /incoming results modal. */}
      {/* [INTAKE-QUEUE] De samenvatting van een REEKS. Verschijnt alleen wanneer er meer dan één
          foto is gemaakt en alles binnen is — bij één foto blijft alles zoals het was.

          Waarom een lijst en geen "3 toegevoegd ✓": omdat ze niet allemaal hetzelfde zijn
          afgelopen. Een bon kan geboekt zijn, een tweede als dubbel geweigerd, een derde in
          Mijn bestanden beland. Een aantal verbergt precies de regel die aandacht vraagt. */}
      {batchSummary && batchSummary.length > 0 && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setBatchSummary(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('int.watToegevoegd')}
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: sheetPaddingBottom(22), width: '100%', maxWidth: 460, maxHeight: '80vh', overflowY: 'auto' }}
          >
            <p style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: 0 }}>
              {/* [ONTVANGEN-WAAR] Neutraal, en met opzet zonder samenvattend oordeel: de regels
                  hieronder zeggen per bestand wat er is gebeurd — «factuur → …», «bank → …»,
                  «ontvangen → we verwerken dit verder». Een kop die daar één woord overheen legt
                  kan alleen maar minder waar zijn dan de lijst die hij samenvat. */}
              {t('int.batchKop')}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 14px', lineHeight: 1.45 }}>
              {t('int.batchUitleg')}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {batchSummary.map((r, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 11px', borderRadius: 10, background: '#F8F9FA' }}>
                  <span style={{ fontSize: 12.5, color: '#5F6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#202124', whiteSpace: 'nowrap' }}>{r.where}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setBatchSummary(null)}
              style={{ width: '100%', marginTop: 16, padding: '14px', borderRadius: 14, background: M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
            >
              {t('ink.klaar')}
            </button>
          </div>
        </div>
      )}

      {destModal && (
        <div
          onClick={closeDest}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 400 }}
        >
          <div className="sheet-scroll"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px',
              paddingBottom: 'calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
              width: '100%', maxWidth: 430,
            }}
          >
            {/* [UNREAD-HONESTY] "Bestand toegevoegd" is waar én misleidend als we het niet konden
                lezen: er is niets van geboekt, en dit is juist het bestand waar de eigenaar nog iets
                mee moet. De kop zegt dat nu. */}
            <div style={{ fontWeight: 700, fontSize: 19, color: '#202124', marginBottom: 4 }}>
              {destModal.isDuplicate ? t('int.kop.bestaatAl')
                : destModal.couldNotRead ? t('int.kop.nietGelezen')
                : t('int.kop.toegevoegd')}
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              {destModal.isDuplicate ? t('int.alEerder')
                : destModal.couldNotRead ? t('int.veiligNietGelezen')
                : t('int.gebeurd')}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, background: destModal.couldNotRead ? '#FEF7E0' : '#f8f9fa', marginBottom: 20 }}>
              <span style={{ fontSize: 16, lineHeight: '20px' }}>
                {destModal.isDuplicate ? 'ℹ️' : destModal.couldNotRead ? '⚠️' : '📁'}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                {/* [NAAM-BIJ-BINNENKOMST] The name, and the one moment it is worth changing.
                    A phone files IMG_20260819_211723.jpg and the owner is looking straight at it;
                    Bestanden has had a rename for a long time, but finding the file there first
                    means recognising that string among the others. Only offered when the upload
                    actually produced a document to rename. */}
                {nameDraft === null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 2px' }}>
                    <p style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {destModal.fileName}
                    </p>
                    {destModal.documentId && !destModal.isDuplicate && (
                      <button
                        onClick={() => { setNameError(null); setNameDraft(destModal.fileName) }}
                        style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1a73e8', fontFamily: 'inherit' }}
                      >
                        {t('best.naamWijzigen')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ margin: '0 0 6px' }}>
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') { setNameDraft(null); setNameError(null) } }}
                      aria-label={t('int.naam.aria')}
                      autoFocus
                      disabled={nameBusy}
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontWeight: 600, color: '#202124', padding: '7px 9px', borderRadius: 8, border: '1px solid #DADCE0', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button onClick={() => void saveName()} disabled={nameBusy}
                        style={{ background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: nameBusy ? 'default' : 'pointer', opacity: nameBusy ? 0.6 : 1, fontFamily: 'inherit' }}>
                        {t('best.opslaan')}
                      </button>
                      <button onClick={() => { setNameDraft(null); setNameError(null) }} disabled={nameBusy}
                        style={{ background: 'none', color: '#5f6368', border: 'none', padding: '6px 8px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {t('lijst.annuleren')}
                      </button>
                    </div>
                  </div>
                )}
                {/* A rename that did not save keeps the OLD name above and says so here. */}
                {nameError && (
                  <p style={{ fontSize: 12, color: '#B3261E', margin: '0 0 4px', lineHeight: 1.45 }}>{nameError}</p>
                )}
                {/* De mapnaam WON hier van de boodschap, ook wanneer die boodschap "we konden dit
                    document niet lezen — controleer het" was. Precies de zin die de eigenaar moet
                    lezen verdween dus zodra het bestand netjes was opgeborgen. Nu wint de reden, en
                    de plaats staat eronder. */}
                {destModal.couldNotRead ? (
                  <>
                    <p style={{ fontSize: 12, color: '#8A5A00', margin: 0, lineHeight: 1.45 }}>{destModal.message}</p>
                    {destModal.folderName && (
                      <p style={{ fontSize: 12, color: '#1a73e8', margin: '4px 0 0' }}>{t('int.staatIn', { folder: destModal.folderName })}</p>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: 12, color: '#1a73e8', margin: 0 }}>
                    {destModal.folderName ? t('int.bestandStaatIn', { folder: destModal.folderName }) : destModal.message}
                  </p>
                )}
                {destModal.documentId && (
                  <button
                    type="button"
                    onClick={() => {
                      // [BESTANDEN-FOCUS] Root must be the ABSENCE of ?folder=, not an
                      // empty string. BestandenPage inits currentFolderId directly from
                      // params.get("folder"), so ?folder= (empty) becomes "" and breaks
                      // navigation. Omit folder entirely when the file sits at the root.
                      const focus = destModal.documentId
                      const url = destModal.folderId
                        ? `/dashboard/bestanden?folder=${destModal.folderId}&focus=${focus}`
                        : `/dashboard/bestanden?focus=${focus}`
                      closeDest()
                      router.push(url)
                    }}
                    style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#1a73e8', fontSize: 12, fontWeight: 600, textDecoration: 'underline' }}
                  >
                    {t('ink.bekijkBestanden')} →
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={closeDest}
              style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#34a853', color: '#fff', border: 'none',
                fontWeight: 700, fontSize: 16, cursor: 'pointer', fontFamily: FONT,
              }}
            >
              {t('ink.klaar')}
            </button>
          </div>
        </div>
      )}

    </>
  )
}

// Result shape from /api/intake
export interface IntakeResult {
  ok?: boolean
  // Alle zeven bestemmingen die /api/intake kan teruggeven. Deze lijst was er vijf, en de twee
  // die ontbraken waren geen randgevallen: 'turnover' is GEBOEKTE OMZET.
  // [STATEMENT-RECONCILE] 'statement' = een leveranciersoverzicht: niet geboekt, maar vergeleken
  // met wat we van die leverancier hebben (welke factuur mis ik?).
  // 'turnover' = kassa-omzet, meteen geboekt in daily_turnover → te zien in Dagomzet.
  // 'ledger'   = grootboek/controle-check, nadrukkelijk GEEN geld → werkt door in de reconciliatie.
  // [ONTVANGEN-WAAR] 'received' = receive-first: the handoff is durable and NOTHING else is known.
  // Not a destination in the sense the others are — those all say what the file turned out to be.
  destination?: 'invoice' | 'receipt' | 'bank' | 'document' | 'statement' | 'reminder' | 'turnover' | 'ledger' | 'received'
  /** [ONTVANGEN-WAAR] The receive-first road sets this; the synchronous road never does. */
  received?: boolean
  message?: string
  // [UNREAD-HONESTY] true wanneer het bestand wél is opgeslagen maar NIET gelezen kon worden. Dat is
  // iets anders dan "geen factuur herkend": er is niets van geboekt en er moet nog iets gebeuren.
  // De route stuurt dit al sinds [TRUST-INTAKE]; dit scherm las het niet.
  could_not_read?: boolean
  error?: string
  duplicate?: boolean
  invoice_id?: string
  // [AUTO-ADVANCE-HONESTY] true when the app verified AND booked this invoice itself
  // ([AUTO-ADVANCE] in /api/intake): status 'received', so it is NOT in the verify
  // queue but on Inkoopfacturen. Drives where we send the owner afterwards.
  auto_verified?: boolean
  original_id?: string  // [DUP-MODAL] the existing invoice this duplicates → deep-link
  canForce?: boolean    // [INTAKE-FORCE] a semantic dup that may be overridden ("toch toevoegen")
  // [DUP-ARCHIVED] present ⇒ the invoice this upload collides with sits in Genegeerd. The block
  // itself is unchanged; this only lets the client name the situation and offer "Terugzetten".
  archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }
  suggest_paid?: boolean
  // [MULTI-INVOICE] Present when ONE uploaded file appeared to hold several different invoices.
  // Only one of them was read; `numbers` names what is still missing. Never a block — the
  // invoice imports, held out of auto-booking, and `message` already says what to do.
  multipleInvoices?: { numbers: string[] }
  // [NAAM-BIJ-BINNENKOMST] The name as STORED, which is not always the name that was uploaded:
  // a photo is wrapped into a PDF at intake, so `foto.jpg` is filed as `foto.pdf`. Absent on the
  // paths that do not file a document.
  file_name?: string
  // [INTAKE-DEST-MODAL] present for destination 'document' → deep-link + highlight
  document_id?: string
  folder_id?: string | null
  folder_name?: string | null
  // [INTAKE-DEST-MODAL] present on a 409 duplicate of a general file → deep-link
  // to where the file already lives in Mijn bestanden (highlighted).
  existing?: {
    id: string
    folder_id?: string | null
    folder_name?: string | null
  }
}