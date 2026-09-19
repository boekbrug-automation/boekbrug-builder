'use client'

// src/app/dashboard/upload/UploadClient.tsx
// [UPLOAD-HUB] The single upload surface. Pick or drop MANY files at once (photos, PDFs, bank
// statements); each is POSTed to /api/intake — the same router the whole app uses — which decides
// the destination (factuur / bon / bankafschrift / bestand). We show a live result PER file, so the
// owner sees exactly what happened to each, and never has to hunt across screens to upload.
//
// Money-truth is unchanged: nothing is auto-paid here. An invoice/receipt lands in the verify queue
// (a suggestion the human confirms); a bank statement is imported + auto-matches the near-certain
// payments (reversible); everything else is filed in bestanden. Duplicates are blocked (with a
// "toch toevoegen" escape only for an uncertain semantic match).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
// [BESTANDEN-WIJS] De regel over wanneer er een link MAG staan, en hoe hij eruitziet — apart
// gehouden omdat een regel die in JSX staat een regel is die niemand test.
import { bestandenDeepLink, targetFromIntake } from '@/lib/bestanden-deeplink'
// [SIZE-SHRINK] Alleen de beslissing, geen compressor — dit bestand blijft licht.
import { shouldOfferShrink } from '@/lib/tools/upload-shrink'
// [INTAKE-IMG-NORMALIZE] Convert a picked HEIC/HEIF/WebP/BMP/TIFF (or an oversized JPG/PNG)
// to a bounded JPEG in the browser BEFORE upload — otherwise an iPhone invoice reaches the
// reader as an "unsupported type" and is silently filed away as unreadable. Same shared
// converter the multi-page combine uses, so both paths agree on the bytes that reach the reader.
import { MAX_INTAKE_UPLOAD_BYTES } from '@/lib/image-normalize-client'
// [UPLOAD-PLAFOND] One shared fit-and-send — see upload-fit.ts.
import { sendWithFit } from '@/lib/upload-fit'
// [MULTI-PAGE] "Eén factuur, meerdere pagina's" — combine the photos of ONE paper invoice into a
// single PDF in the browser, then send it as ONE file (same /api/intake → one invoice), instead of
// N separate invoices. Same combiner the ZZP intake button uses.
import { combineImagesToPdf } from '@/lib/combine-images-pdf'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, COLUMN } from '@/lib/design/tokens'
// [UPLOAD-ERRORS] Eén vertaler van HTTP-status → wat de eigenaar leest én of er een knop verschijnt.
// Puur en getest, want een knop die niets kan opleveren is erger dan geen knop.
import { describeUploadFailure } from '@/lib/upload-failure'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [PAGINA-VOLGORDE] The order of the pages of one paper invoice, decided in one place and shown
// in one tray — the same on Inkomend. See src/lib/page-order.ts for why a plain sort is wrong.
import { usePageTray } from '@/lib/use-page-tray'
import PageTray from '@/components/intake/PageTray'
import type { MessageKey } from '@/lib/i18n/messages'
import { failureText } from '@/lib/server-message'
// [MELDING-WEG] The X on a finished row, and the duplicate's place in the owner's language.
import { DismissX } from '@/components/ui/DismissX'
import { duplicateWhere } from '@/lib/duplicate-sentence'
// [ONTVANGEN-WAAR] Dezelfde component als op Inkomend — niet een tweede vraag, een tweede eindpunt
// of een tweede besluitstaat. Het document is de bron van waarheid; dit is een extra plek waar
// dezelfde open vraag zichtbaar wordt. Zonder dit moest de eigenaar naar Inkomend om te zien dat
// wij iets van hem nodig hebben, terwijl hij nog op het scherm staat waar hij net heeft geüpload.
import DuplicateQuestions from '@/components/intake/DuplicateQuestions'

const FONT = "'Roboto', -apple-system, sans-serif"
// Same accept set as the app's intake button: images + PDF + bank-statement formats + the
// spreadsheet exports a shop uploads monthly (kassa Z-report, PIN/kas grootboek).
const ACCEPT = 'image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt,.940,.xls,.xlsx,.csv'
// [SIZE-GUARD] Enforced in the browser so a too-big file fails instantly with a clear reason,
// instead of the owner waiting through a full upload over a slow mobile link only to be refused.
//
// [UPLOAD-PLAFOND] The cap is no longer "the server's 10 MB". The binding limit is the PLATFORM's
// request-body ceiling — well under half that — and it refuses before our route runs, so the
// server's number was never the one an upload had to meet. MAX_INTAKE_UPLOAD_BYTES now carries the
// real one, and "a too-big PDF is the one case we simply can't send" is no longer true either:
// fitForUpload runs pdfcompress on it automatically.
// [MULTI-PAGE] Cap the pages of one paper invoice, mirroring the intake button.
const MAX_PAGES = 20

// [ONTVANGEN-WAAR] 'received' is niet 'done' met een ander woord ervoor.
//
// Onder receive-first antwoordt /api/intake `received: true` zodra de overdracht DUURZAAM is: het
// bestand staat er, de rij staat er, en de eigenaar mag weglopen. Wat er NIET is, is een uitslag —
// de lezing draait daarna, in de achtergrond. Deze pagina kende dat verschil niet en zette elke
// 200 op 'done': groene rand, vinkje, en een telling onder "verwerkt". Drie keer een uitspraak
// doen die op dat moment niemand kan waarmaken.
//
// Er komt met opzet GEEN polling bij om de regel later alsnog groen te maken. Het doel hier is dat
// het scherm hetzelfde zegt als de database, niet dat het scherm een taak volgt.
type Status = 'queued' | 'busy' | 'received' | 'done' | 'duplicate' | 'error'
interface Item {
  id: string
  file: File
  status: Status
  destination?: 'invoice' | 'receipt' | 'bank' | 'document' | 'turnover' | 'ledger' | 'statement' | 'reminder'
  // [AUTO-ADVANCE-HONESTY] The app verified AND booked this invoice itself
  // ([AUTO-ADVANCE] in /api/intake) — status 'received'. It is therefore NOT in the
  // verify queue this page links to, but on Inkoopfacturen. Kept separate from
  // `destination` because the destination IS still an invoice; only the place it
  // waits differs — and that is exactly what the owner needs to be told.
  autoVerified?: boolean
  message?: string
  canForce?: boolean
  force?: boolean   // set on a "toch toevoegen" retry → sends force=true to override a semantic dup
  // [SIZE-SHRINK] Boven het plafond én een PDF, dus verkleinen is het aanbieden waard. De melding
  // hieronder zei altijd al "splits een grote PDF" en gaf geen enkele manier om dat te doen —
  // dit is wat die zin een knop maakt. De afbeeldingen in het document gaan omlaag, de tekst
  // blijft tekst, dus de lezer aan de andere kant kan er nog steeds iets uit halen.
  tooBig?: boolean
  shrinking?: boolean
  // [DUP-ARCHIVED] De upload botste op een factuur die de eigenaar zelf genegeerd heeft. Die staat
  // in Genegeerd en is dus in geen enkele gewone lijst te vinden — bied terugzetten aan, want bij
  // een byte-hash-duplicaat (identiek bestand) is dat de ENIGE weg vooruit: die poort is met opzet
  // niet te forceren, dus zonder deze knop zit de eigenaar klem.
  archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }
  restoring?: boolean
  preview?: string  // objectURL for an image → inline thumbnail so the owner verifies without opening
  vendor?: string | null      // extracted — shown inline so you see WHAT the file is at a glance
  total?: number | null
  number?: string | null
  rateLimited?: boolean       // a 429 (too many at once) → retry after a short wait, not a real error
  // [UNREAD-HONESTY] /api/intake antwoordt `ok: true, could_not_read: true` wanneer het bestand wél
  // veilig is opgeslagen maar NIET gelezen kon worden (onscherpe foto, mislukte AI-lezing). Dat is
  // geen fout — het bestand staat er — maar ook geen "klaar": dit is juist het bestand waar de
  // eigenaar iets mee moet. De pagina las dit veld niet, dus zo'n regel kreeg de groene rand van een
  // geslaagde upload en telde in het overzicht mee als "1 bestand". Kleur en telling zeiden geslaagd
  // terwijl de tekst ernaast zei dat we het niet konden lezen.
  couldNotRead?: boolean
  // [UPLOAD-ERRORS] Zie describeUploadFailure: een 402 (maandtegoed op) en een 413 (te groot) kunnen
  // per definitie niet slagen bij opnieuw proberen, dus dan hoort er geen knop te staan.
  fairUse?: boolean
  noRetry?: boolean
  // [MULTI-INVOICE] How many different invoices this ONE file appeared to contain. Only one was
  // read, so this row is a WARNING even though the upload succeeded — the others exist nowhere.
  multiInvoice?: number
  // [BESTANDEN-WIJS] Waar dit bestand terecht is gekomen, zodat de rij ernaartoe kan LINKEN in
  // plaats van het pad als dode tekst af te drukken. /api/intake stuurt dit al mee — bij een
  // opgeslagen document als `document_id`, bij een geweigerd duplicaat als `existing.id` — met in
  // zijn eigen commentaar de reden: "structured target so the client can deep-link + focus".
  target?: { documentId: string; folderId: string | null }
}

/** Wat /api/intake terugstuurt, voor zover deze pagina het leest. Expliciet opgeschreven omdat het
 *  verschil tussen "geen veld" en "geen JSON" hier betekenis heeft (zie [UPLOAD-ERRORS]). */
interface IntakeResponse {
  /** [ONTVANGEN-WAAR] The receive-first road sets this; the synchronous road never does. */
  received?: boolean
  destination?: Item['destination']
  message?: string
  auto_verified?: boolean
  could_not_read?: boolean
  vendor?: string | null
  total_inc_btw?: number | null
  invoice_number?: string | null
  duplicate?: boolean
  error?: string
  canForce?: boolean
  archived?: Item['archived']
  // [MULTI-INVOICE] Eén bestand met meerdere factuurnummers erin; de route noemt de nummers.
  multipleInvoices?: { numbers?: string[] }
  // [BESTANDEN-WIJS] De twee vormen waarin de route zegt waar het bestand staat. Los gelezen door
  // targetFromIntake, zodat de duplicaat-vorm niet opnieuw vergeten kan worden.
  document_id?: string
  folder_id?: string | null
  existing?: { id?: string; folder_id?: string | null; folder_name?: string | null; folder_path?: string[] }
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// Destination → how the owner reads it (label key + emoji + colour). Labels are message
// keys, rendered through t() so the component itself holds no language.
const DEST: Record<string, { label: MessageKey; icon: string; color: string }> = {
  invoice:  { label: 'up.dest.factuur', icon: '🧾', color: M3.primary },
  receipt:  { label: 'up.dest.bon',     icon: '🧾', color: M3.primary },
  bank:     { label: 'up.dest.bank',    icon: '🏦', color: '#0B8043' },
  turnover: { label: 'up.dest.kassaOmzet', icon: '🛒', color: '#0B8043' },
  ledger:   { label: 'up.dest.controleCheck', icon: '🔗', color: '#7B1FA2' },
  document: { label: 'up.dest.bestand', icon: '📁', color: M3.neutral },
  // [STATEMENT-RECONCILE] Een leveranciersoverzicht wordt niet geboekt (dat zou de losse
  // facturen dubbel tellen) maar gebruikt als volledigheidscontrole: welke factuur mis ik?
  statement: { label: 'up.dest.overzicht', icon: '🔎', color: M3.warn },
  // [HERINNERING-NOOIT] Een betalingsherinnering wordt bewaard en aan zijn factuur gekoppeld,
  // nooit geboekt — hij herhaalt een factuur die er al hoort te zijn.
  reminder: { label: 'up.dest.herinnering', icon: '🔔', color: M3.warn },
}

let idc = 0
const nextId = () => `f${++idc}-${Date.now()}`

// [UPLOAD-ERRORS] Alle uitkomst-vlaggen van de vorige poging gaan bij een herkansing terug op nul.
// Bleven ze staan, dan hield een geslaagde tweede poging de kleur en de knopregels van de mislukking
// waaruit ze kwam. Op modulehoogte, zodat het object stabiel is en de useCallbacks hun geheugen
// houden. `as const` niet: patch() verwacht een gewone Partial<Item>, geen readonly variant.
const RESET_ON_RETRY: Partial<Item> = {
  message: undefined, rateLimited: false, fairUse: false, noRetry: false, couldNotRead: false,
  // [SIZE-SHRINK] Ook deze twee, om dezelfde reden als de rest: een tweede poging kan op iets
  // ANDERS stuklopen (verbinding weg, 429), en dan zou "Verklein en probeer opnieuw" op een regel
  // staan waar de grootte het probleem niet is. De grootte wordt elke poging opnieuw vastgesteld.
  tooBig: false, shrinking: false,
}

interface ReprocSummary { scanned: number; considered: number; booked: number; turnoverDays: number; ledgerDays: number; review: number; skipped: number; failed: number; capped: boolean }
interface ReprocResult { file: string; status: 'booked' | 'review' | 'skip' | 'error'; type?: string; message: string }

export default function UploadClient() {
  const t = translator(useLocale())
  const [items, setItems] = useState<Item[]>([])
  const [dragActive, setDragActive] = useState(false)
  const pending = useRef<Item[]>([])   // FIFO queue (source of truth for the runner)
  const running = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  // [BLOB-CLEANUP] Every preview is an objectURL; without revoking them a big batch leaks blobs in
  // memory until the tab closes (heavy on a phone). We keep the URLs alive while their result row is
  // on screen (the thumbnail + "Bekijk bestand" link use them) and revoke ALL of them on unmount.
  const objectUrls = useRef<string[]>([])
  useEffect(() => () => { for (const u of objectUrls.current) URL.revokeObjectURL(u) }, [])

  // [BLOB-CLEANUP] …maar "op unmount" is op deze pagina niet vaak. Wie een ochtend bonnen verwerkt
  // blijft hier staan en doet batch na batch; elke foto houdt intussen zijn volledige bytes in het
  // geheugen vast, want een objectURL is een harde referentie. Op een telefoon met tweehonderd
  // bonnen is dat honderden MB's die pas vrijkomen als het tabblad dichtgaat.
  //
  // De lijst leegmaken is dus niet alleen opruimen op het scherm — het is de enige plek waar dit
  // geheugen tussentijds terug kan. Daarom hoort de knop hier en niet alleen bij de opmaak.
  // [QUEUE-PURITY] Het intrekken gebeurt BUITEN de state-updater, om dezelfde reden als bij
  // retryAllFailed: React mag een updater meer dan eens aanroepen voor één klik. Twee keer intrekken
  // is op zich onschadelijk, maar de ref eronder muteren niet — en een updater met neveneffecten is
  // hier al een keer duur geweest.
  // [MELDING-WEG] ONE rule for taking rows away, whether it is one row (the X) or every finished
  // one (Lijst opruimen): the rows that go, and the revoke of exactly their previews.
  const dropRows = useCallback((goes: (i: Item) => boolean) => {
    const keep = items.filter((i) => !goes(i))
    if (keep.length === items.length) return
    // Alleen de URL's van rijen die ECHT weggaan. Een rij die nog in de wachtrij staat heeft zijn
    // preview straks nog nodig — en na "toch toevoegen" DELEN twee rijen dezelfde URL, dus de vraag
    // is niet "gaat deze rij weg" maar "blijft er nog iemand naar kijken".
    const kept = new Set(keep.map((i) => i.preview).filter((u): u is string => !!u))
    const gone = items
      .map((i) => i.preview)
      .filter((u): u is string => !!u && !kept.has(u))
    for (const u of gone) URL.revokeObjectURL(u)
    objectUrls.current = objectUrls.current.filter((u) => !gone.includes(u))
    setItems(keep)
  }, [items])
  const clearFinished = useCallback(() => dropRows((i) => i.status !== 'queued' && i.status !== 'busy'), [dropRows])
  // [MELDING-WEG] The X on a row. Only a FINISHED row has one: a queued or busy row is still in the
  // runner's queue, and taking it off the screen would not take it out of the upload — the file
  // would go up invisibly and its outcome would land nowhere.
  const removeItem = useCallback((id: string) => dropRows((i) => i.id === id), [dropRows])

  // [MULTI-PAGE] Collect the photos of ONE paper invoice, combine → one PDF → one invoice.
  const [mpMode, setMpMode] = useState(false)
  // [PAGINA-VOLGORDE] The tray — pages, thumbnails, order and what the last add did — is one
  // shared piece of state, identical to the one on /dashboard/incoming.
  const tray = usePageTray(MAX_PAGES)
  const [combining, setCombining] = useState(false)
  const [mpError, setMpError] = useState<string | null>(null)
  const mpFileRef = useRef<HTMLInputElement>(null)
  const mpCameraRef = useRef<HTMLInputElement>(null)
  // [REPROCESS] Book the kassa/grootboek/dagomzet files already sitting in bestanden — no re-upload.
  const [reproc, setReproc] = useState<{ busy: boolean; done: boolean; summary?: ReprocSummary; results?: ReprocResult[]; error?: string }>({ busy: false, done: false })
  // [MELDING-WEG] The reprocess rows an owner has read and taken away — by their position in the
  // run's own list, which does not shift when a row above is hidden. Reset with every new run.
  const [reprocHidden, setReprocHidden] = useState<Set<number>>(new Set())
  const runReprocess = useCallback(async () => {
    setReproc({ busy: true, done: false })
    setReprocHidden(new Set())
    try {
      const res = await fetch('/api/documents/reprocess', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      // [UI-HONESTY] A rejected run (401/429/500) returns no summary, and the result
      // block only renders WITH a summary — so the button used to go quiet and the
      // owner was left believing nothing needed booking. Say what happened instead.
      if (!res.ok || !data?.summary) {
        setReproc({ busy: false, done: true, error: failureText(res.status, data, t('up.fout.boekenOpnieuw')) })
        return
      }
      setReproc({ busy: false, done: true, summary: data.summary, results: data.results })
    } catch {
      setReproc({ busy: false, done: true, error: t('up.fout.boekenVerbinding') })
    }
  }, [t])

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)))
  }, [])

  // Process the FIFO queue ONE file at a time — each intake does an AI read, so sequential keeps us
  // within the rate limit and gives an honest, ordered progress. New drops append and are picked up
  // by the already-running loop (guarded so only one loop ever runs).
  const kick = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (pending.current.length > 0) {
        const item = pending.current.shift()!
        patch(item.id, { status: 'busy' })
        try {
          // [UPLOAD-PLAFOND] Shrinking is no longer a button the owner has to find: fitForUpload
          // runs the SAME pdfcompress pass automatically, and sendWithFit answers a platform 413
          // by squeezing harder and sending again. The manual "Verklein" affordance below stays
          // for the one case that is left — a document that is still too big after all of that.
          const { response: res, sent: uploadFile, fit } = await sendWithFit(item.file, (f) => {
            const fd = new FormData()
            fd.append('file', f)
            if (item.force) fd.append('force', 'true') // "toch toevoegen" override for a semantic dup
            return fetch('/api/intake', { method: 'POST', body: fd })
          })
          // [SIZE-GUARD] Only reached when the automatic pass could not get under the budget.
          // The cap is read from the shared constant, never written out: the two sentences here
          // said "max 10 MB" long after the real ceiling had become 4 MB, so the number the owner
          // was given was one no upload could actually meet.
          if (!fit.fits && !res.ok) {
            const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
            const isPdf = shouldOfferShrink(uploadFile, MAX_INTAKE_UPLOAD_BYTES)
            patch(item.id, {
              status: 'error',
              tooBig: isPdf,
              message: isPdf
                ? t('up.teGrootVerkleinen', { size: mb(uploadFile.size), max: mb(MAX_INTAKE_UPLOAD_BYTES) })
                : t('up.teGrootSplits', { size: mb(uploadFile.size), max: mb(MAX_INTAKE_UPLOAD_BYTES) }),
            })
            continue
          }
          // [UPLOAD-ERRORS] `null` bij een onleesbare body, geen `{}`. Dat onderscheid is het hele
          // punt: een 413 of 504 komt van het PLATFORM en heeft een HTML-body, dus `data.error`
          // bestond daar nooit — en juist daardoor viel elk zo'n geval in de algemene zin "Lezen
          // mislukt", over een bestand waar niets mis mee was.
          const data = (await res.json().catch(() => null)) as IntakeResponse | null
          if (res.ok && data?.received === true) {
            // [ONTVANGEN-WAAR] Durable, and nothing more is known yet. No destination (the reader
            // decides that later), no extracted fields, no auto_verified — claiming any of them
            // here would be inventing an outcome. Our own sentence, not the server's, because this
            // screen may be read in Arabic.
            patch(item.id, { status: 'received', message: t('up.ontvangen'), target: targetFromIntake(data) ?? undefined })
          } else if (res.ok) {
            patch(item.id, {
              status: 'done', destination: data?.destination, message: data?.message,
              autoVerified: data?.auto_verified === true,
              // [UNREAD-HONESTY] Opgeslagen maar niet gelezen — apart van 'klaar' gehouden.
              couldNotRead: data?.could_not_read === true,
              multiInvoice: data?.multipleInvoices?.numbers?.length,
              vendor: data?.vendor ?? null, total: data?.total_inc_btw ?? null, number: data?.invoice_number ?? null,
              target: targetFromIntake(data) ?? undefined,
            })
          } else if (res.status === 409 && data?.duplicate) {
            // [MELDING-WEG] [TAAL] "Dit bestand staat al in: …" came from the server, in Dutch, on a
            // screen the owner may read in Arabic. The PLACE is structured (existing.folder_path);
            // the sentence around it is the catalogue's. The archived and the semantic case keep the
            // server's sentence — duplicateWhere says why.
            const where = duplicateWhere(data)
            patch(item.id, {
              status: 'duplicate', message: where ? t(where.key, where.params) : failureText(res.status, data, t('up.alToegevoegd')), canForce: !!data.canForce,
              // [DUP-ARCHIVED] alleen gezet als de bestaande factuur écht in Genegeerd staat
              archived: data.archived ?? undefined,
              // [BESTANDEN-WIJS] Bij een duplicaat wijst de link naar het bestand dat er AL staat —
              // dat is het bestand waar de melding over gaat.
              target: targetFromIntake(data) ?? undefined,
            })
          } else {
            // [UPLOAD-ERRORS] Eén vertaler voor álle overige statussen — 402 fair use, 413 te groot,
            // 429 te snel, 504 te lang, 5xx storing — zodat de melding en de knop bij de oorzaak
            // passen in plaats van bij het gemiddelde. Getest in src/lib/upload-failure.test.ts.
            patch(item.id, { status: 'error', ...describeUploadFailure(res.status, data?.error) })
          }
        } catch {
          patch(item.id, { status: 'error', message: t('up.fout.lezen') })
        }
        // Gentle spacing between AI reads — smooths bursts so fewer files trip an error.
        await new Promise((r) => setTimeout(r, 250))
      }
    } finally {
      running.current = false
    }
  }, [patch, t])

  const addFiles = useCallback((files: FileList | File[] | null) => {
    const arr = files ? Array.from(files) : []
    if (arr.length === 0) return
    const newItems: Item[] = arr.map((file) => {
      // An objectURL for every file: shown as an inline thumbnail for images, and opened by the
      // "bekijk" link for any file — so the owner recognises/checks each one without leaving the page.
      const preview = URL.createObjectURL(file)
      objectUrls.current.push(preview) // [BLOB-CLEANUP] revoked on unmount
      return { id: nextId(), file, status: 'queued' as Status, preview }
    })
    setItems((prev) => [...prev, ...newItems])
    pending.current.push(...newItems)
    void kick()
  }, [kick])

  // [MULTI-PAGE] Add photos to the "one invoice, many pages" tray. Only images belong here
  // (a paper invoice is photographed); a picked non-image is ignored so the tray stays clean.
  const addMpPages = useCallback((fl: FileList | null) => {
    if (!fl || fl.length === 0) return
    const imgs = Array.from(fl).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(f.name))
    if (imgs.length === 0) { setMpError(t('up.kiesFotos')); return }
    // [PAGINA-VOLGORDE] Order, re-picks and overflow are one decision, taken in page-order.ts and
    // REPORTED by the tray — which also ends the [MP-PURE-UPDATER] hazard this handler carried:
    // nothing here is computed inside a state updater any more.
    tray.add(imgs)
    setMpError(null)
  }, [tray, t])

  // Combine the collected pages into ONE PDF in the browser, then hand that single PDF to the
  // normal upload queue → /api/intake extracts ONE invoice from all pages (the multi-page path).
  const combineAndUpload = useCallback(async () => {
    if (tray.pages.length === 0 || combining) return
    setCombining(true); setMpError(null)
    try {
      const pdf = await combineImagesToPdf(tray.files)
      addFiles([pdf])
      setMpMode(false); tray.reset()
    } catch (e) {
      // combineImagesToPdf names the failing page ("Pagina 2 kon niet…") — surface it as-is so the
      // owner knows which photo to redo; keep the other pages in the tray for a quick retry.
      // combineImagesToPdf names either the failing page ("Pagina 2 kon niet…") or why the set
      // cannot fit one upload ("Deze 20 pagina's passen samen niet…") — both are actionable.
      setMpError(e instanceof Error && /^(Pagina|Deze \d+ pagina)/.test(e.message) ? e.message : t('up.combinerenMislukt'))
    } finally {
      setCombining(false)
    }
  }, [tray, combining, addFiles, t])

  // Re-try a file that failed (a transient AI error or a rate-limit that has since cleared).
  const retry = useCallback((item: Item) => {
    const again: Item = { ...item, status: 'queued', ...RESET_ON_RETRY }
    patch(item.id, { status: 'queued', ...RESET_ON_RETRY, message: t('up.opnieuwWachtrij') })
    pending.current.push(again)
    void kick()
  }, [kick, patch, t])

  // [QUEUE-PURITY] De wachtrij wordt hier gevuld BUITEN de state-updater. Dit stond vroeger binnen
  // setItems(prev => …), en dat is precies de plek waar het niet mag: React mag zo'n updater meer dan
  // eens aanroepen voor dezelfde klik — StrictMode doet het in ontwikkeling standaard, en bij het
  // opnieuw baseren van een onderbroken update kan het in productie ook. Elke extra aanroep duwde
  // dezelfde bestanden nóg een keer in pending.current, dus het bestand ging twee keer omhoog en de
  // tweede keer kwam terug als "dit bestand staat al in je bestanden" — op precies het bestand dat de
  // eigenaar aan het herstellen was. Een updater hoort puur te zijn; het duwen is een neveneffect.
  const retryAllFailed = useCallback(() => {
    // [UPLOAD-ERRORS] Alleen wat een herkansing KAN halen. Een 402 (maandtegoed op) en een 413 (te
    // groot) gaan niet mee: die zouden gegarandeerd hetzelfde antwoord terugbrengen, en dan telt het
    // overzicht ze opnieuw als mislukt terwijl de eigenaar denkt dat hij iets heeft geprobeerd.
    const failed = items.filter((i) => i.status === 'error' && !i.noRetry)
    if (failed.length === 0) return
    for (const f of failed) pending.current.push({ ...f, status: 'queued', ...RESET_ON_RETRY })
    // Dezelfde lijst voor de rijen die "in wachtrij" gaan heten als voor de rijen die er echt in
    // liggen — anders kan de melding op het scherm en de inhoud van de wachtrij uit elkaar lopen.
    const queued = new Set(failed.map((f) => f.id))
    setItems((prev) => prev.map((i) => (queued.has(i.id) ? { ...i, status: 'queued' as Status, ...RESET_ON_RETRY, message: t('up.opnieuwWachtrij') } : i)))
    void kick()
  }, [items, kick, t])

  // [SIZE-SHRINK] "Verklein en probeer opnieuw" — de PDF gaat door de compressor en de kleinere
  // versie gaat als nieuwe poging de wachtrij in.
  //
  // [PDF-LAZY] pdfcompress en pdf-lib worden hier binnengehaald, niet bovenaan het bestand. Dit is
  // het uploadscherm van een ingelogde eigenaar dat elke dag opengaat; wie nooit tegen het plafond
  // aanloopt hoort er ook nooit een byte van te downloaden. Eén gewone import bovenaan zou dat
  // stilletjes ongedaan maken — precies wat /factuur-maken 1,4 MB kostte.
  const shrinkAndRetry = useCallback(async (item: Item) => {
    patch(item.id, { shrinking: true, message: t('up.bezigVerkleinen') })
    try {
      const { compressToFit } = await import('@/lib/tools/pdfcompress')
      const { file, fits, before, after } = await compressToFit(item.file, MAX_INTAKE_UPLOAD_BYTES)

      if (!fits) {
        // [UI-HONESTY] Niet stilletjes alsnog uploaden wat de server toch weigert. Zeggen hoever
        // het kwam is bruikbaarder dan het nog een keer laten mislukken.
        patch(item.id, {
          shrinking: false,
          tooBig: false,
          // [UPLOAD-PLAFOND] Het plafond komt uit de gedeelde constante. Deze zin noemde 10 MB
          // toen de echte grens al 4 MB was — een getal waar geen enkele upload aan kón voldoen.
          message: t('up.verkleinenNietGenoeg', { before: (before / 1024 / 1024).toFixed(1), after: (after / 1024 / 1024).toFixed(1), max: (MAX_INTAKE_UPLOAD_BYTES / 1024 / 1024).toFixed(1) }),
        })
        return
      }

      // De kleinere versie is een NIEUWE poging op een eigen regel, net als "toch toevoegen":
      // de uitkomst hoort bij de poging die hem veroorzaakt, niet bij de regel die faalde.
      const retry: Item = { id: nextId(), file, status: 'queued' }
      setItems((prev) => [...prev, retry])
      pending.current.push(retry)
      patch(item.id, {
        shrinking: false,
        tooBig: false,
        message: t('up.verkleind', { before: (before / 1024 / 1024).toFixed(1), after: (after / 1024 / 1024).toFixed(1) }),
      })
      void kick()
    } catch {
      patch(item.id, { shrinking: false, message: t('up.verkleinenLukteNiet') })
    }
  }, [patch, kick, t])

  // "Toch toevoegen" — re-submit an uncertain semantic duplicate with force=true as a NEW attempt.
  const forceAdd = useCallback((item: Item) => {
    // De nieuwe poging erft de preview van het origineel: het is hetzelfde bestand, dus de miniatuur
    // en "Bekijk bestand →" horen er ook op te staan. Zonder dit kreeg juist de regel met de échte
    // uitkomst geen afbeelding en geen link — de regel waarop de eigenaar wil kunnen controleren.
    const retry: Item = { id: nextId(), file: item.file, status: 'queued', force: true, preview: item.preview }
    setItems((prev) => [...prev, retry])
    pending.current.push(retry)
    // [UI-HONESTY] De oorspronkelijke regel blijft staan als wat hij is: geweigerd als duplicaat.
    // Hier stond `status: 'done'` met "Toch toegevoegd", gezet op het moment van KLIKKEN — dus vóór
    // de upload. Mislukte die daarna (429, leesfout, verbinding weg), dan bleef een groene regel een
    // toevoeging claimen die nooit gebeurde, en telde het overzicht hem als geslaagd mee. De uitkomst
    // hoort op de nieuwe regel, en nergens anders.
    //
    // canForce en archived gaan wél weg: beide knoppen zijn nu uitgewerkt. Nog een keer forceren zou
    // een derde regel maken, en alsnog "terugzetten uit Genegeerd" zou de teruggezette factuur NAAST
    // de zojuist geforceerde zetten — twee facturen voor één papier.
    patch(item.id, {
      canForce: false,
      archived: undefined,
      message: t('up.tochToegevoegdRegel'),
    })
    void kick()
  }, [kick, patch, t])

  // [DUP-ARCHIVED] "Terugzetten" — de upload werd geweigerd omdat deze factuur al bestaat, maar
  // in Genegeerd. Opnieuw uploaden lost dat niet op (en kan bij identieke bytes ook niet); de
  // bestaande factuur terugzetten wél. Zet hem terug in de controlewachtrij, waar hij hoort.
  const restoreIgnored = useCallback(async (item: Item) => {
    const target = item.archived
    if (!target || item.restoring) return
    patch(item.id, { restoring: true })
    try {
      const res = await fetch(`/api/email/confirm/${target.invoice_id}`, { method: 'PATCH' })
      if (res.ok) {
        // Klaar: de knop verdwijnt (archived weg) en de regel vertelt wat er nu geldt.
        patch(item.id, {
          status: 'done', destination: 'invoice', restoring: false, archived: undefined, canForce: false,
          message: t('up.teruggezet'),
        })
      } else {
        // [UI-HONESTY] Een 409 betekent dat hij niet (meer) in Genegeerd staat. Nooit "gelukt" zeggen.
        const data = await res.json().catch(() => ({}))
        patch(item.id, { restoring: false, message: failureText(res.status, data, t('up.fout.terugzettenVervers')) })
      }
    } catch {
      patch(item.id, { restoring: false, message: t('up.fout.terugzettenVerbinding') })
    }
  }, [patch, t])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const busyCount = items.filter((i) => i.status === 'queued' || i.status === 'busy').length
  const done = items.filter((i) => i.status === 'done')
  // [ONTVANGEN-WAAR] Apart van `done`, en dus buiten countBy, autoBooked, toVerify en het vinkje.
  // Dit zijn de bestanden die we HEBBEN; wat ze worden weet nog niemand.
  const received = items.filter((i) => i.status === 'received')
  const dups = items.filter((i) => i.status === 'duplicate')
  const errs = items.filter((i) => i.status === 'error')
  // [UNREAD-HONESTY] Opgeslagen maar NIET gelezen — een eigen categorie, niet "klaar" en niet "fout".
  // Deze regels vielen onder countBy('document') en verdwenen zo in "1 bestand", terwijl dit juist de
  // bestanden zijn waar de eigenaar nog iets mee moet.
  const unread = done.filter((i) => i.couldNotRead)
  const countBy = (d: string) => done.filter((i) => i.destination === d && !i.couldNotRead).length
  // [UPLOAD-ERRORS] Alleen wat een herkansing kan halen telt voor de "alles opnieuw"-knop.
  const retryable = errs.filter((i) => !i.noRetry).length
  // [AUTO-ADVANCE-HONESTY] Invoices split by WHERE they now wait: auto-booked ones sit
  // on Inkoopfacturen, the rest in the verify queue. The summary used to lump both into
  // "X factuur/bon" with a single "Naar Te verifiëren →", so a batch the app fully
  // handled itself pointed at an empty queue.
  const autoBooked = done.filter((i) => i.autoVerified).length
  const toVerify = done.filter(
    (i) => (i.destination === 'invoice' || i.destination === 'receipt') && !i.autoVerified,
  ).length
  // [MULTI-INVOICE] Files that imported one invoice and silently left others behind. Counted
  // separately from the plain successes, because "klaar" is exactly what they are NOT.
  const multiFiles = done.filter((i) => i.multiInvoice).length
  const anyResult = done.length + received.length + dups.length + errs.length > 0

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>
        {/* [HEADER-SYSTEM] Title "Uploaden" + back live in the shared sub-page bar;
            the in-body h1 was removed. The descriptive subtitle stays. */}
        <div style={{ margin: '16px 0 8px' }}>
          <p style={{ fontSize: 13.5, color: M3.neutral, marginTop: 4, lineHeight: 1.5 }}>
            {t('up.alles')} <strong>{t('up.allesMeerdere')}</strong>{t('up.allesRest')}
          </p>
        </div>

        {/* [ONTVANGEN-WAAR] De open vraag, op het scherm waar de eigenaar nog staat. Boven de
            dropzone, want een vraag over een bestand dat er al is gaat vóór het volgende bestand.
            Staat er niets open, dan tekent de component niets.

            De documentIds van wat we zojuist hebben AFGEGEVEN gaan mee. Alleen met die lijst kan
            het paneel een vraag vinden die nog niet bestond toen het voor het eerst keek — en
            precies dat is het geval hier: de lezer draait ná het antwoord "Ontvangen". Het raam
            is begrensd en sluit zichzelf; zie duplicate-recheck.ts. */}
        <DuplicateQuestions
          awaitDocumentIds={received.map((i) => i.target?.documentId).filter((id): id is string => !!id)}
        />

        {/* Drop zone + pickers */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragActive ? M3.primary : M3.outlineVariant}`,
            background: dragActive ? '#EAF2FE' : M3.surface,
            borderRadius: 18, padding: '28px 18px', textAlign: 'center', transition: 'all .12s ease', marginTop: 8,
          }}
        >
          <div style={{ fontSize: 34 }}>📤</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: '8px 0 2px' }}>
            {t('up.sleep')}
          </p>
          <p style={{ fontSize: 12.5, color: M3.neutral, marginBottom: 16 }}>
            {t('up.kiesHieronder')}
          </p>

          <input ref={fileRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); if (fileRef.current) fileRef.current.value = '' }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); if (cameraRef.current) cameraRef.current.value = '' }} />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => fileRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', background: M3.primary, color: M3.onPrimary, fontFamily: FONT, fontSize: 14.5, fontWeight: 600 }}>
              📎 {t('up.bestandenKiezen')}
            </button>
            <button onClick={() => cameraRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', background: M3.primaryContainer, color: '#041E49', fontFamily: FONT, fontSize: 14.5, fontWeight: 600 }}>
              📷 {t('up.fotosMaken')}
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: '#8e8e93', margin: '14px 4px 0', lineHeight: 1.45 }}>
            {t('up.selecteerUitleg')}
          </p>
        </div>

        {/* [MULTI-PAGE] "Eén factuur, meerdere pagina's" — combine the photos of ONE paper invoice
            into a single PDF so it lands as ONE invoice, not one per page. */}
        <div style={{ marginTop: 14, background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: 14 }}>
          {!mpMode ? (
            <>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, margin: 0 }}>{t('up.meerderePaginas')}</p>
              <p style={{ fontSize: 12.5, color: M3.neutral, margin: '4px 0 10px', lineHeight: 1.5 }}>
                {t('up.paginasSamen')} <strong>{t('up.eenFactuurStrong')}</strong> {t('up.andersAparte')}
              </p>
              <button onClick={() => { setMpMode(true); setMpError(null) }}
                style={{ background: M3.primaryContainer, color: '#041E49', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                📄 {t('up.paginasSamenvoegen')}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, margin: 0 }}>{t('up.eenFactuur')}</p>
                <button onClick={() => { setMpMode(false); tray.reset(); setMpError(null) }}
                  style={{ background: 'transparent', border: 'none', color: M3.neutral, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                  {t('lijst.annuleren')}
                </button>
              </div>
              <p style={{ fontSize: 12.5, color: M3.neutral, margin: '4px 0 10px', lineHeight: 1.5 }}>
                {t('up.volgordeUitleg')} <strong>{t('up.eenFactuurStrong')}</strong>.
              </p>

              <input ref={mpFileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => { addMpPages(e.target.files); if (mpFileRef.current) mpFileRef.current.value = '' }} />
              <input ref={mpCameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
                onChange={(e) => { addMpPages(e.target.files); if (mpCameraRef.current) mpCameraRef.current.value = '' }} />

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => mpFileRef.current?.click()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, cursor: 'pointer', background: M3.surface, color: M3.onSurface, fontFamily: FONT, fontSize: 13.5, fontWeight: 600 }}>
                  📎 {t('up.fotosKiezen')}
                </button>
                <button onClick={() => mpCameraRef.current?.click()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, cursor: 'pointer', background: M3.surface, color: M3.onSurface, fontFamily: FONT, fontSize: 13.5, fontWeight: 600 }}>
                  📷 {t('up.paginaFotograferen')}
                </button>
              </div>

              {/* [PAGINA-VOLGORDE] The same tray as Inkomend — thumbnails, and an order the owner
                  can correct. Both screens bind one paper invoice; one control for both. */}
              <PageTray
                pages={tray.pages}
                notice={tray.notice}
                accent={M3.primary}
                disabled={combining}
                onMove={tray.move}
                onRemove={tray.remove}
              />

              {mpError && <p style={{ fontSize: 12, color: M3.error, margin: '8px 0 0', lineHeight: 1.4 }}>{mpError}</p>}

              <button onClick={combineAndUpload} disabled={combining || tray.pages.length === 0}
                style={{ marginTop: 12, width: '100%', background: combining || tray.pages.length === 0 ? '#C7C7CC' : M3.primary, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: combining || tray.pages.length === 0 ? 'default' : 'pointer', fontFamily: FONT }}>
                {combining ? t('up.bezigSamenvoegen') : tray.pages.length > 0 ? (tray.pages.length === 1 ? t('up.combineerEen') : t('up.combineer', { n: tray.pages.length })) : t('up.voegEerstToe')}
              </button>
            </>
          )}
        </div>

        {/* [REPROCESS] Book kassa/grootboek/dagomzet files you already uploaded earlier — no re-upload. */}
        <div style={{ marginTop: 14, background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, margin: 0 }}>{t('up.eerder')}</p>
          <p style={{ fontSize: 12.5, color: M3.neutral, margin: '4px 0 10px', lineHeight: 1.5 }}>
            {t('up.reproc.uitleg')}
          </p>
          <button onClick={runReprocess} disabled={reproc.busy}
            style={{ background: reproc.busy ? '#70757a' : '#0B8043', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: reproc.busy ? 'default' : 'pointer', fontFamily: FONT }}>
            {reproc.busy ? `🔄 ${t('up.reproc.bezig')}` : `🔄 ${t('up.reproc.boek')}`}
          </button>

          {reproc.done && reproc.error && (
            <p style={{ fontSize: 13, color: M3.error, margin: '10px 0 0', lineHeight: 1.5 }}>{reproc.error}</p>
          )}

          {reproc.done && reproc.summary && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: M3.onSurface, margin: '0 0 6px' }}>
                {reproc.summary.booked > 0
                  ? (reproc.summary.ledgerDays
                    ? t('up.reproc.geboektLedger', { booked: reproc.summary.booked, days: reproc.summary.turnoverDays, ledgerDays: reproc.summary.ledgerDays })
                    : t('up.reproc.geboekt', { booked: reproc.summary.booked, days: reproc.summary.turnoverDays }))
                  : t('up.reproc.geenNieuwe')}
                {reproc.summary.review > 0 && <span style={{ color: M3.warn }}> · {t('up.reproc.nakijken', { n: reproc.summary.review })}</span>}
                {reproc.summary.failed > 0 && <span style={{ color: M3.error }}> · {t('up.nMislukt', { n: reproc.summary.failed })}</span>}
              </p>
              {/* [MELDING-WEG] Each row read can be taken away on its own — the same X as the upload
                  rows above. Keyed on the run's own index, so hiding one does not renumber the rest. */}
              {(reproc.results ?? []).map((r, idx) => ({ r, idx })).filter(({ r, idx }) => r.status !== 'skip' && !reprocHidden.has(idx)).slice(0, 40).map(({ r, idx }) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <p style={{ flex: 1, minWidth: 0, fontSize: 12, margin: '2px 0', color: r.status === 'booked' ? M3.success : r.status === 'review' ? M3.warn : r.status === 'error' ? M3.error : M3.neutral, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.status === 'booked' ? '✓' : r.status === 'review' ? '⚠️' : '✗'} {r.file} — {r.message}
                  </p>
                  <DismissX label={t('melding.weghalen')} onClick={() => setReprocHidden((prev) => new Set(prev).add(idx))} style={{ width: 32, height: 32 }} />
                </div>
              ))}
              {reproc.summary.booked > 0 && (
                <Link href="/dashboard/dagomzet" style={{ display: 'inline-block', marginTop: 8, fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '7px 14px' }}>
                  {t('up.naarDagomzet')} →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Progress banner */}
        {items.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: M3.neutral }}>
              {/* [ONTVANGEN-WAAR] Deze regel zei "Klaar — {n} bestand(en) verwerkt" zodra er niets
                  meer in de wachtrij stond. Voor een receive-first-batch is dat precies de zin die
                  niet waar is: de overdracht is klaar, de verwerking begint dan pas. De
                  samenvatting eronder had het al goed en sprak deze regel dus tegen, twee
                  alinea's uit elkaar. Drie toestanden, niet twee. */}
              {busyCount > 0
                ? t('up.bezigVerwerken', { done: items.length - busyCount, total: items.length })
                : received.length > 0
                  ? t('up.nOntvangen', { n: received.length })
                  : t('up.klaarVerwerkt', { n: items.length })}
            </span>
            {/* [BLOB-CLEANUP] De lijst opruimen zonder de pagina te verlaten. Naast het schoonvegen
                van het scherm is dit de enige plek waar het geheugen van de vorige batch tussentijds
                terugkomt: elke miniatuur houdt zijn volledige bestand vast tot de URL is ingetrokken.
                Rijen die nog in de wachtrij staan blijven staan — die zijn nog niet af. */}
            {items.length - busyCount > 0 && (
              <button onClick={clearFinished}
                style={{ background: 'transparent', border: `1px solid ${M3.outlineVariant}`, color: M3.neutral, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                {t('up.opruimen')}
              </button>
            )}
          </div>
        )}

        {/* Per-file result list */}
        {items.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => {
              const d = it.destination ? DEST[it.destination] : null
              // [MULTI-INVOICE] A file that held several invoices imported fine — and still lost
              // the others. A green edge would read as "done"; it is the one 'done' row the owner
              // must act on, so it wears the warning colour.
              const border =
                it.status === 'error' ? M3.error
                : it.status === 'duplicate' ? M3.warn
                // [UNREAD-HONESTY] Opgeslagen, maar niet gelezen → dezelfde aandachtskleur als een
                // duplicaat en als een bestand met meerdere facturen, niet het groen van geslaagd.
                // Het bestand is veilig, maar er moet nog iets gebeuren, en dat is wat de rand
                // hoort te zeggen.
                : it.status === 'done' ? (it.couldNotRead || it.multiInvoice ? M3.warn : M3.success)
                // [ONTVANGEN-WAAR] Bewaard, nog niet gelezen. Niet het groen van een uitslag en
                // niet het oranje van een probleem — er is geen probleem, er is nog geen uitslag.
                : it.status === 'received' ? M3.primary
                : M3.outlineVariant
              const isImg = it.file.type.startsWith('image/')
              // The at-a-glance summary of WHAT the file is (so you don't open each one).
              const extracted = [it.vendor, it.total != null ? eur.format(it.total) : null, it.number ? t('up.nr', { n: it.number }) : null]
                .filter(Boolean).join('  ·  ')
              return (
                <div key={it.id} style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderInlineStart: `4px solid ${border}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Thumbnail (image) or a status/type glyph — recognise the file instantly. */}
                    {isImg && it.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.preview} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8, flexShrink: 0, background: '#F1F3F4' }} />
                    ) : (
                      <div style={{ width: 46, height: 46, borderRadius: 8, background: '#F1F3F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                        {it.status === 'queued' ? '⏳' : it.status === 'busy' ? '🔄'
                          : it.status === 'received' ? '📥'
                          : it.status === 'done' ? (it.couldNotRead ? '⚠️' : (d?.icon ?? '📄'))
                          : it.status === 'duplicate' ? '⚠️' : '📄'}
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.file.name}
                      </p>
                      {/* Extracted identity for a recognised invoice: leverancier · bedrag · nummer. */}
                      {it.status === 'done' && extracted && (
                        <p style={{ fontSize: 12.5, fontWeight: 600, color: M3.onSurface, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{extracted}</p>
                      )}
                      <p style={{ fontSize: 12, color: it.status === 'error' ? (it.rateLimited || it.fairUse ? M3.warn : M3.error) : it.status === 'duplicate' || it.couldNotRead || it.multiInvoice ? M3.warn : M3.neutral, margin: '2px 0 0', lineHeight: 1.4 }}>
                        {it.status === 'queued' ? (it.message || t('up.inWachtrij'))
                          : it.status === 'busy' ? t('up.bezigLezen')
                          : it.message || (d ? t(d.label) : t('up.klaar'))}
                      </p>
                      {/* [UPLOAD-VERIFY] Open the file itself to check it — without leaving the page. */}
                      {it.preview && (it.status === 'done' || it.status === 'error' || it.status === 'duplicate') && (
                        <a href={it.preview} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-block', marginTop: 4, fontSize: 12, fontWeight: 600, color: M3.primary, textDecoration: 'none' }}>
                          {t('up.bekijkBestand')} →
                        </a>
                      )}
                      {/* [BESTANDEN-WIJS] En WAAR het staat. De regel erboven zegt het pad in
                          woorden ("Dit bestand staat al in: 2026 / Q2 / april / Facturen") en liet
                          de eigenaar die mappen daarna met de hand aflopen. Deze link opent de map
                          en licht het bestand op — /dashboard/bestanden doet dat al voor ?folder=
                          en ?focus=, er wees alleen nooit iets naartoe.

                          Naast de preview-link, niet in plaats daarvan: die opent het BESTAND, deze
                          wijst zijn PLEK. Na een upload zijn dat twee verschillende vragen. */}
                      {bestandenDeepLink(it.target) && (
                        <>
                          {it.preview && <span style={{ color: M3.outlineVariant, margin: '0 6px' }}>·</span>}
                          <Link href={bestandenDeepLink(it.target) as string}
                            style={{ display: 'inline-block', marginTop: 4, fontSize: 12, fontWeight: 600, color: M3.primary, textDecoration: 'none' }}>
                            {t('up.wijsInBestanden')} →
                          </Link>
                        </>
                      )}
                    </div>
                    {it.status === 'done' && it.couldNotRead ? (
                      // [UNREAD-HONESTY] "Bestand" zou hier klinken als afgehandeld. Het bestand
                      // staat er inderdaad — maar ongelezen, en dát is wat de eigenaar moet weten.
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#8A5A00', background: '#FEF7E0', borderRadius: 999, padding: '3px 10px' }}>
                        {t('up.nietGelezen')}
                      </span>
                    ) : it.status === 'done' && d ? (
                      // [AUTO-ADVANCE-HONESTY] The badge names the OUTCOME, not just the type:
                      // "Factuur" on a row the app already booked reads as "still to do".
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: it.multiInvoice ? '#7C5800' : it.autoVerified ? '#0B5A28' : d.color, background: it.multiInvoice ? '#FEE8C4' : it.autoVerified ? '#E6F4EA' : '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
                        {it.multiInvoice ? t('up.nFacturen', { n: it.multiInvoice }) : it.autoVerified ? t('up.autoGeboekt') : t(d.label)}
                      </span>
                    ) : null}
                    {/* [MELDING-WEG] Read it, take it away. A duplicate's work is done the moment the
                        owner knows the file is already there; the same holds for a finished or a
                        failed row once its retry or its link has been used. Not on a queued or busy
                        row — see removeItem. */}
                    {it.status !== 'queued' && it.status !== 'busy' && (
                      <DismissX label={t('melding.weghalen')} onClick={() => removeItem(it.id)} />
                    )}
                  </div>
                  {/* Actions row: retry a failure, or override an uncertain duplicate. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {/* [UPLOAD-ERRORS] Geen knop waar opnieuw proberen gegarandeerd hetzelfde
                        antwoord geeft (402 maandtegoed, 413 te groot). Een knop die niets kan
                        opleveren laat de eigenaar denken dat de app stuk is. */}
                    {it.status === 'error' && !it.noRetry && (
                      <button onClick={() => retry(it)}
                        style={{ marginTop: 8, background: 'transparent', color: M3.primary, border: `1px solid ${M3.primaryContainer}`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                        ↻ {t('inkoop.opnieuwProberen')}
                      </button>
                    )}
                    {/* Bij fair use is de uitweg geen herhaling maar een keuze — en die staat op
                        /prijzen. De server stuurt dat adres zelf mee; hier stond het nergens. */}
                    {it.status === 'error' && it.fairUse && (
                      <Link href="/prijzen"
                        style={{ marginTop: 8, background: M3.primaryContainer, color: '#041E49', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>
                        {t('up.mogelijkheden')} →
                      </Link>
                    )}
                    {/* [UNREAD-HONESTY] Het bestand is bewaard maar niet gelezen. De handeling die
                        wél helpt is een betere foto — niet dezelfde nog een keer. */}
                    {it.status === 'done' && it.couldNotRead && (
                      <Link href="/dashboard/bestanden"
                        style={{ marginTop: 8, background: '#FEF7E0', color: '#8A5A00', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>
                        {t('up.bekijkBestanden')} →
                      </Link>
                    )}
                    {/* [SIZE-SHRINK] Te groot én een PDF → verkleinen is de handeling die hier
                        werkt. De melding vroeg altijd al om iets ("splits een grote PDF"); dit is
                        het gereedschap ernaast in plaats van een opdracht zonder middel. */}
                    {it.status === 'error' && it.tooBig && (
                      <button onClick={() => void shrinkAndRetry(it)} disabled={it.shrinking}
                        style={{ marginTop: 8, background: M3.primary, color: '#fff', border: 'none', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: it.shrinking ? 'default' : 'pointer', opacity: it.shrinking ? 0.6 : 1, fontFamily: FONT }}>
                        {it.shrinking ? t('up.bezigVerkleinen') : t('up.verkleinProbeer')}
                      </button>
                    )}
                    {/* [DUP-ARCHIVED] De bestaande factuur staat in Genegeerd → terugzetten is de
                        handeling die hier werkt. Eerst, want bij een identiek bestand is het de enige. */}
                    {it.status === 'duplicate' && it.archived && (
                      <button onClick={() => restoreIgnored(it)} disabled={it.restoring}
                        style={{ marginTop: 8, background: M3.primary, color: '#fff', border: 'none', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: it.restoring ? 'default' : 'pointer', fontFamily: FONT, opacity: it.restoring ? 0.6 : 1 }}>
                        {it.restoring ? t('act.bezig') : t('up.terugzettenGenegeerd')}
                      </button>
                    )}
                    {it.status === 'duplicate' && it.canForce && (
                      <button onClick={() => forceAdd(it)}
                        style={{ marginTop: 8, background: 'transparent', color: M3.warn, border: `1px solid #E0C48A`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                        {t('up.tochToevoegen')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Summary + where things landed */}
        {anyResult && busyCount === 0 && (
          <div style={{ marginTop: 18, background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: 16 }}>
            {/* [UNREAD-HONESTY] Het vinkje is een uitspraak, geen versiering. Staat er nog iets open
                — niet gelezen, dubbel, of mislukt — dan is de batch wél af maar niet schoon, en dan
                hoort er geen ✓ boven te staan dat de eigenaar laat ophouden met kijken. */}
            <p style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>
              {unread.length + dups.length + errs.length > 0 ? t('up.klaarAandacht')
                : received.length > 0 ? t('up.ontvangenKop')
                : t('up.klaarVink')}
            </p>
            <p style={{ fontSize: 13, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
              {received.length > 0 && <>{t('up.nOntvangen', { n: received.length })} · </>}
              {autoBooked > 0 && <><strong style={{ color: M3.success }}>{t('up.nAutoGeboekt', { n: autoBooked })}</strong> · </>}
              {toVerify > 0 && <>{t('up.nTeControleren', { n: toVerify })} · </>}
              {countBy('bank') > 0 && <>{t('up.nBankafschrift', { n: countBy('bank') })} · </>}
              {countBy('turnover') > 0 && <>{t('up.nKassaOmzet', { n: countBy('turnover') })} · </>}
              {countBy('ledger') > 0 && <>{t('up.nControleCheck', { n: countBy('ledger') })} · </>}
              {countBy('document') > 0 && <>{t('up.nBestand', { n: countBy('document') })} · </>}
              {countBy('statement') > 0 && <>{t('up.nRekeningoverzicht', { n: countBy('statement') })} · </>}
              {countBy('reminder') > 0 && <>{t('up.nHerinnering', { n: countBy('reminder') })} · </>}
              {/* Eigen post, want dit is een getal waar de eigenaar nog iets mee moet en dat
                  vroeger onzichtbaar opging in "X bestand". */}
              {unread.length > 0 && <span style={{ color: M3.warn }}>{t('up.nNietGelezen', { n: unread.length })} · </span>}
              {multiFiles > 0 && <span style={{ color: M3.warn }}>{t('up.nMeerdereFacturen', { n: multiFiles })} · </span>}
              {dups.length > 0 && <>{t('up.nDubbel', { n: dups.length })} · </>}
              {errs.length > 0 && <span style={{ color: M3.error }}>{t('up.nMislukt', { n: errs.length })}</span>}
            </p>
            {/* [UNREAD-HONESTY] Wat "niet gelezen" betekent en wat eraan te doen is — één keer,
                zoals het blok hieronder dat voor "automatisch geboekt" doet. */}
            {unread.length > 0 && (
              <p style={{ fontSize: 12.5, color: '#8A5A00', background: '#FEF7E0', border: '1px solid #F3D99B', borderRadius: 10, padding: '10px 12px', margin: '0 0 12px', lineHeight: 1.5 }}>
                {unread.length === 1 ? t('up.unreadEen') : t('up.unreadMeer', { n: unread.length })}
              </p>
            )}
            {/* [UPLOAD-ERRORS] De knop telt alleen wat een herkansing kan halen. Stond hier eerst
                errs.length, dus ook een 402 of 413 werd meegeteld in "Alle N opnieuw proberen" —
                en die kwamen gegarandeerd als mislukt terug. */}
            {retryable > 0 && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={retryAllFailed}
                  style={{ background: M3.error, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  ↻ {t('up.alleOpnieuw', { n: retryable })}
                </button>
                <p style={{ fontSize: 11.5, color: M3.neutral, margin: '6px 2px 0', lineHeight: 1.45 }}>
                  {t('up.misluktUitleg')}
                </p>
              </div>
            )}
            {/* [AUTO-ADVANCE-HONESTY] What "automatisch geboekt" means, once — booked as
                a purchase invoice, nothing paid, and checkable on Inkoopfacturen. */}
            {autoBooked > 0 && (
              <p style={{ fontSize: 12.5, color: '#0B5A28', background: '#E6F4EA', border: '1px solid #B7E1C4', borderRadius: 10, padding: '10px 12px', margin: '0 0 12px', lineHeight: 1.5 }}>
                {autoBooked === 1 ? t('up.autoGeboektEen') : t('up.autoGeboektMeer', { n: autoBooked })}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {autoBooked > 0 && (
                <Link href="/dashboard/incoming/manage?filter=auto" style={{ fontSize: 13, fontWeight: 600, color: '#0B5A28', textDecoration: 'none', background: '#E6F4EA', borderRadius: 999, padding: '8px 14px' }}>
                  {t('up.naarInkoop')} →
                </Link>
              )}
              {toVerify > 0 && (
                <Link href="/dashboard/incoming" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  {t('up.naarVerifieren')} →
                </Link>
              )}
              {countBy('bank') > 0 && (
                <Link href="/dashboard/bank" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  {t('up.naarBank')} →
                </Link>
              )}
              {countBy('turnover') > 0 && (
                <Link href="/dashboard/dagomzet" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  {t('up.naarDagomzet')} →
                </Link>
              )}
              {/* [UNREAD-HONESTY] Ook de niet-gelezen bestanden staan in Bestanden. Nu unread uit
                  countBy('document') is gehaald, zou een batch met alléén onleesbare bestanden
                  anders zónder weg erheen eindigen — precies de batch die er een nodig heeft. */}
              {(countBy('document') > 0 || unread.length > 0 || countBy('statement') > 0 || countBy('reminder') > 0) && (
                <Link href="/dashboard/bestanden" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  {t('up.naarBestanden')} →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
