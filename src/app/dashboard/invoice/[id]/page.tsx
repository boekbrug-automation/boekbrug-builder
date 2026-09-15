'use client'

// src/app/dashboard/invoice/[id]/page.tsx
// BOEK-005: skeleton loading
// [BOEK-031] add creditnota button for sent invoices — May 2026
// [BOEK-031] Design System v1.0 applied — Material You (ZZP page) — May 2026

import { useState, useEffect, useRef } from 'react'
import { deliveryFailure } from '@/lib/invoice-delivery'
import { M3, STICKY_BELOW_HEADER, columnInner, COLUMN } from '@/lib/design/tokens'
// [KOMMA-INVOER] The one comma-safe money field — see its header for what type="number" did.
import DecimalInput from '@/components/ui/DecimalInput'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, notFound, useSearchParams, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { InvoiceActions } from '@/components/invoice/InvoiceActions'
import { InvoiceReminders } from '@/components/invoice/InvoiceReminders'
import { InvoiceDetailSkeleton } from '@/components/ui/Skeletons'
import { InvoiceTypeBadge, type InvoiceType } from '@/components/invoice/InvoiceTypeBadge'
import { crossQuarterPayment } from '@/lib/quarter'
import type { InvoiceRow, InvoiceLineRow, ProfileRow } from '@/types/rows'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [OFFERTE-AKKOORD] De datum waarop de klant antwoordde — dezelfde weergave als overal.
// [AKKOORD-VERLOPEN] Of het akkoord ná de geldigheidsdatum binnenkwam — zie offerte-akkoord.ts.
import { answeredAfterExpiry } from '@/lib/offerte-akkoord'
import { formatDateNL } from '@/lib/format-nl'
// [DOC-VERSE-LINK] Where "open the original" points: our own route, signed at the moment of the
// tap. Never a url fetched in advance — see the header of document-preview.ts.
import { fileOpenHref } from '@/lib/document-preview'
// [DEEL-CREDIT] Hoeveel er is gecrediteerd en hoeveel er nog kan — dezelfde regels als de route.
import { creditedTotalsFrom } from '@/lib/credited-invoices'
// [KETEN] The life of one invoice, read as a chain — see factuurketen.ts. Used here from the
// CREDITNOTA's end: its screen never said which invoice it corrects, though its PDF always did.
import { factuurketen, origineelVan, type KetenDocument } from '@/lib/factuurketen'
import { creditableRemaining, buildCreditSelection, type LineSelection } from '@/lib/partial-credit'

// [PDF-LAZY] Eén lazy BROK, niet twee losse imports. Hier stond `dynamic()` om PDFDownloadLink
// heen terwijl InvoicePDF er twaalf regels hoger gewoon statisch werd geïmporteerd — en die ene
// import trekt @react-pdf/renderer (~1,4 MB) alsnog in de eerste download van dit scherm. Precies
// de val die de kop van PdfDownloadButton.tsx beschrijft en die daar op de PUBLIEKE pagina al was
// opgelost; hier stond hij nog. Renderer én document zitten nu samen in PdfPreviewButton, dat pas
// wordt opgehaald wanneer de ondernemer de PDF echt opvraagt.
const PdfDocumentButton = dynamic(() => import('@/components/invoice/PdfPreviewButton'), {
  ssr: false,
  loading: () => null,
})

// [STATUS] Deze kaart was de "Design System"-kopie van de statuskleuren, en won daarmee terecht
// van vijf andere — maar het waren er acht in totaal. Woord én kleur komen nu uit
// src/lib/invoice-status.ts. Eén verschil is bewust NIET overgenomen: 'received' stond hier op
// hetzelfde blauw als 'sent', wat leest als "dit is afgehandeld", terwijl het een rekening is die
// je nog moet betalen. InvoiceRow had daar amber voor, mét reden. Zie de kop van die module.

// [DS] NL formatting — fixed, never changes
// [PRIJS-KOLOM] De prijskolom draait via unit-price-display.ts, zodat dit scherm en de PDF
// dezelfde prijs tonen — en een prijs die vermenigvuldigd het regeltotaal oplevert.
import { formatUnitPriceNL } from '@/lib/unit-price-display'
import { statusChip } from '@/lib/invoice-status'
// [KLANT-EXTRA] Dezelfde leesdefinitie als de PDF: wat het document draagt, laat dit scherm zien.
import { clientExtraLines } from '@/lib/client-extra-lines'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'

const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
// [TZ] timeZone PINNED. This formats invoice_date / due_date / payment_date — all DATE-ONLY
// columns, so `new Date(...)` is midnight UTC and an unpinned format renders a day early west of
// UTC. It feeds the copy/share text of a legal invoice, which is the last place to be a day off.
const NL_DATE   = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam' })

const CREDITABLE_STATUSES = ['sent', 'paid', 'overdue', 'received', 'processing', 'processed']

export default function InvoiceDetailPage() {
  const router = useRouter()
  const taal = useLocale()
  const t = translator(taal)
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  // [ACC-INVOICE-VIEW] viewer's own profile — reliable "self" side for the
  // Van/Aan cards. On an incoming invoice the sender_id points at an external
  // party with no profiles row, so we cannot derive the ZZP'er from it.
  const [viewerProfile, setViewerProfile] = useState<ProfileRow | null>(null)
  // [ACC-INVOICE-VIEW] original-PDF fetch state — documents bucket is private,
  // so we fetch a fresh signed URL from the existing Wave 3 file route rather
  // than linking the raw (relative, expiring) pdf_url.
  const [loading, setLoading] = useState(true)
  const [notFoundState, setNotFoundState] = useState(false)
  // [ACTING-FOR] De medewerker die deze factuur maakte — leeg als de eigenaar hem zelf maakte.
  const [makerNaam, setMakerNaam] = useState<string | null>(null)

  // [BOEK-031] linked creditnota — toon als er al een bestaat
  // Alleen de kolommen die de lookup ophaalt — geen volledige factuurrij beloven.
  // [CREDITNOTA-REF] The invoice THIS creditnota corrects (null unless this is a creditnota).
  const [correctedInvoice, setCorrectedInvoice] =
    useState<{ invoice_number: string | null; invoice_date: string | null } | null>(null)
  // [DEEL-CREDIT] A LIST. There used to be at most one creditnota per invoice and this held it;
  // now an invoice can be credited in parts, and the query below would have thrown on the second
  // one (maybeSingle → PGRST116) rather than showing it.
  // [DEEL-CREDIT] Of de creditnota-lezing HEEFT gekeken. Een lege lijst en een mislukte lezing
  // geven allebei `linkedCreditnotas.length === 0`, en dat verschil is hier geld: alGecrediteerd
  // wordt dan 0, dus het scherm meldt dat de HELE factuur nog terug kan terwijl er al een deel van
  // terug is — en het toont de bewerkknop op een factuur waar een creditnota naar verwijst.
  const [creditnotasGelezen, setCreditnotasGelezen] = useState(true)
  const [linkedCreditnotas, setLinkedCreditnotas] =
    useState<Pick<InvoiceRow, 'id' | 'invoice_number' | 'status' | 'created_at' | 'total_inc_btw'>[]>([])

  // [COHERENCE-CREDITNOTA] The dedicated creditnota action. It POSTs to
  // /api/invoice/creditnota — the ONE route that copies the original's lines
  // negatively, stores original_invoice_id (so "Gecrediteerd via …" shows and no
  // second creditnota can be made), mints a CR- number, and delivers the PDF.
  // The old banner navigated to a BLANK /invoice/new form where handleCredit was
  // never invoked: the owner retyped everything and handleSubmit wrote a
  // creditnota with original_invoice_id=null — an orphan that severed the link and
  // allowed unlimited duplicate legal credits. This dialog calls the route directly.
  // [FACTUUR-BIJLAGE] Het eigen bestand dat met deze factuurmail meegaat — een werkbon, een
  // urenstaat, een pakbon. Gekozen vlak voor het versturen, want dat is het moment waarop je
  // eraan denkt.
  const [bijlage, setBijlage] = useState<{ id: string; file_name: string; file_size: number; trashed?: boolean | null } | null>(null)
  // Weet dit scherm zeker WAT er als bijlage meegaat?
  //
  // Alleen dan mag het meepraten. De verstuurroute kent drie standen: een id (dit bestand), null
  // (geen bijlage) en de sleutel helemaal weglaten (neem wat er op de factuur staat). Zou het
  // scherm bij twijfel `null` sturen, dan wist een verkoopmedewerker — die de documentenrij van
  // zijn werkgever via RLS niet mag lezen — de bijlage van zijn baas door alleen maar op
  // Versturen te drukken. Bij twijfel zwijgt het scherm dus, en beslist de factuur.
  const [bijlageBekend, setBijlageBekend] = useState(false)
  const [bijlageZoek, setBijlageZoek] = useState('')
  const [bijlageTreffers, setBijlageTreffers] = useState<{ id: string; file_name: string; file_size: number }[]>([])
  const [bijlageZoekt, setBijlageZoekt] = useState(false)

  const [showCreditDialog, setShowCreditDialog] = useState(false)
  // [DEEL-CREDIT] Per regel-id het aantal dat wordt gecrediteerd. Leeg = de hele factuur, en dat
  // is de STAND waarin de dialoog opent: het gewone geval blijft één klik.
  const [creditQty, setCreditQty] = useState<Record<string, number>>({})
  const [creditPartial, setCreditPartial] = useState(false)
  useCloseOnBack(!!showCreditDialog, () => { if (!creatingCredit) setShowCreditDialog(false) })
  // …and it obeys the same refusal the backdrop does: while the creditnota is being minted
  // there is a number in flight, and dismissing would leave the owner not knowing whether it
  // exists. `!creatingCredit` is the SAME condition the backdrop click checks.
  const [creditReason, setCreditReason] = useState('')
  const [creatingCredit, setCreatingCredit] = useState(false)
  const [creditError, setCreditError] = useState<string | null>(null)

  // [BOEK-031] Send flow state — May 2026
  const [showSendModal, setShowSendModal] = useState(false)
  useCloseOnBack(!!showSendModal, () => setShowSendModal(false))
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // [FACTUUR-A] Delivery recovery banner — read ?delivery= once on mount — June 2026
  const searchParams = useSearchParams()
  const pathname = usePathname()
  // [REACT] Afgeleid van de URL — geen effect nodig. Een effect zou een tweede renderronde
  // kosten en de waarschuwing één frame later tonen dan de pagina eronder.
  const deliveryParam = searchParams.get('delivery')
  const deliveryFromUrl: 'pdf_failed' | 'email_failed' | null =
    deliveryParam === 'pdf_failed' || deliveryParam === 'email_failed' ? deliveryParam : null
  const [dismissedDelivery, setDismissedDelivery] = useState(false)
  const deliveryWarning = dismissedDelivery ? null : deliveryFromUrl
  const [resending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)



  // [COHERENCE-CREDITNOTA] ?action=credit (from the Facturen list's "credit a paid
  // invoice" flow) auto-opens the creditnota dialog once the invoice has loaded. Fires at
  // most ONCE (creditAutoOpenedRef) so it can't reopen after the user dismisses it or when
  // the invoice re-renders, and strips the query param afterwards. Guarded synchronously on
  // the invoice's own type/status so it never opens on a creditnota or a non-creditable
  // status; the server route remains the authority for the actual write.
  const creditAutoOpenedRef = useRef(false)
  useEffect(() => {
    if (
      invoice &&
      !creditAutoOpenedRef.current &&
      searchParams.get('action') === 'credit' &&
      invoice.invoice_type !== 'creditnota' &&
      invoice.direction !== 'incoming' &&
      !!invoice.status && CREDITABLE_STATUSES.includes(invoice.status)
    ) {
      creditAutoOpenedRef.current = true
      setCreditReason('')
      setCreditError(null)
      setShowCreditDialog(true)
      // Drop the param so a later re-render / setInvoice can't reopen the dialog.
      window.history.replaceState(null, '', pathname)
    }
  }, [invoice, searchParams, pathname])

  // [NAVIGATION] Back is now provided by the shared sub-page header, which
  // resolves the canonical parent via getParentPath with the page's search params
  // — so the "opened from a client's kwartaal" context (?from=client&clientId=…)
  // is preserved there, not here.

  // [FACTUUR-A] Resend handler — calls /api/invoice/send with resend:true — June 2026
  // Re-delivers PDF+email; does NOT touch invoice_number or status.
  // [ACC-INVOICE-VIEW] Open the original supplier PDF via the existing Wave 3
  // signed-URL route (same mechanism BRIDGE-POLISH used for the incoming
  // management surface). The documents bucket is private and pdf_url is stored
  // inconsistently (raw path or an expired signed URL), so we never link it
  // directly — we ask the route for a fresh signed URL keyed by invoice id.
  async function handleResend() {
    setResending(true)
    setSendError(null)

    const res = await fetch('/api/invoice/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // [FACTUUR-BIJLAGE] Ook hier, en juist hier. Opnieuw versturen droeg de bijlage van de
      // eerste keer mee zonder dat er een weg was om hem te wijzigen of weg te halen; belandde
      // dat bestand in de prullenbak, dan weigerde élke poging en zat de factuur vast.
      body: JSON.stringify({ invoiceId, resend: true, ...(bijlageBekend ? { attachment_document_id: bijlage?.id ?? null } : {}) }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSendError(failureText(res.status, data, t('detail.fout.opnieuwVersturen')))
      setResending(false)
      return
    }

    // [VERSTUURD-EERLIJK] res.ok is TRUE on a failed delivery — the route already minted the
    // number, so it answers 200 and names the failure in `warning`. This handler read neither, and
    // it is the worst place in the app not to: on a resend that ALSO failed it set
    // dismissedDelivery, stripping the ?delivery= banner that was the owner's only warning, and
    // then showed a green "opnieuw verstuurd". The one screen whose whole job is recovering from a
    // failed e-mail was hiding the evidence of the second failure.
    const mislukt = deliveryFailure(await res.json().catch(() => ({})))
    if (mislukt) {
      setSendError(mislukt === 'email_failed'
        ? t('detail.fout.mailNietVerstuurd')
        : t('detail.fout.pdfNietGemaakt'))
      setResending(false)
      return // banner stays, URL keeps ?delivery= — nothing here has been resolved
    }

    // Success — hide banner + clean ?delivery= from URL
    setDismissedDelivery(true)
    setResendSuccess(true)
    setResending(false)
    router.replace(pathname) // strips query params
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single()

      if (!invoiceData) {
        setNotFoundState(true)
        setLoading(false)
        return
      }

      setInvoice(invoiceData)

      // [INVOICE-DETAIL-NULL-GUARD] On an incoming invoice the sender_id points
      // at an external party with NO profiles row (often null) — querying
      // profiles.eq('id', null) throws a Postgres 22P02 "invalid input syntax for
      // uuid: null" and floods the console. Guard it: only fetch the sender
      // profile when sender_id is a real value; otherwise resolve to null.
      const senderProfilePromise = invoiceData.sender_id
        ? supabase.from('profiles').select('*').eq('id', invoiceData.sender_id).single()
        : Promise.resolve({ data: null })

      const [{ data: senderProfile }, { data: linesData }, { data: ownProfile }] = await Promise.all([
        senderProfilePromise,
        supabase.from('invoice_lines').select('*').eq('invoice_id', invoiceId),
        supabase.from('profiles').select('*').eq('id', user.id).single(),
      ])

      if (senderProfile) setProfile(senderProfile)
      if (linesData) setLines(linesData)
      if (ownProfile) setViewerProfile(ownProfile) // [ACC-INVOICE-VIEW]

      // [FACTUUR-BIJLAGE] Wat er al als bijlage op deze factuur staat, teruglezen.
      //
      // De kolom werd geschreven en nergens gelezen, en dat kost meer dan een leeg veld. De
      // verstuurroute valt terug op wat er op de factuur staat, dus het bestand ging gewoon mee —
      // alleen zag de ondernemer daar niets van. Twee gevolgen, en het tweede is het ergste:
      //
      //   · hij weet niet WELK bestand zijn klant krijgt, terwijl hij op Versturen drukt;
      //   · en hij kan het er niet af halen. Belandt dat bestand later in de prullenbak, dan
      //     weigert elke nieuwe verzending met "kies een ander bestand" — en er was geen scherm
      //     waarop je een ander bestand kon kiezen. De factuur was niet meer te versturen.
      //
      // `trashed` doet mee in de lezing en wordt niet weggefilterd: juist dát geval moet zichtbaar
      // zijn, want het is het geval waarin de ondernemer moet ingrijpen.
      const bijlageId = (invoiceData as { attachment_document_id?: string | null }).attachment_document_id ?? null
      if (!bijlageId) {
        setBijlageBekend(true)
      } else {
        const { data: bijlageDoc, error: bijlageErr } = await supabase
          .from('documents')
          .select('id, file_name, file_size, trashed')
          .eq('id', bijlageId)
          .maybeSingle()
        if (!bijlageErr && bijlageDoc) {
          setBijlage(bijlageDoc as { id: string; file_name: string; file_size: number; trashed?: boolean | null })
          setBijlageBekend(true)
        }
        // Niet kunnen lezen laat `bijlageBekend` op false staan: het scherm zwijgt dan over de
        // bijlage en de verstuurroute houdt wat er op de factuur staat. Zie de uitleg bij de state.
      }

      // [ACTING-FOR] Wie maakte deze factuur? Alleen relevant als dat NIET de kijker zelf was —
      // dan is het de medewerker die hem namens de eigenaar heeft uitgegeven. created_by werd
      // geschreven en nergens gelezen; dit is de leesbare kant ervan.
      //
      // De naam komt uit /api/company/members, die alleen (oud-)teamleden van de AANROEPER
      // teruggeeft. Er wordt dus nooit een losse uuid naar een naam vertaald, en de aanroep
      // gebeurt alleen in het geval dat hij iets kan opleveren.
      const maker = (invoiceData as { created_by?: string | null }).created_by
      if (maker && maker !== user.id) {
        try {
          const res = await fetch('/api/company/members')
          if (res.ok) {
            const json = await res.json()
            const lid = (json?.leden ?? []).find((l: { member_id?: string }) => l.member_id === maker)
            if (lid?.naam) setMakerNaam(lid.naam)
          }
        } catch { /* een naam is een extraatje — nooit een reden om het scherm te breken */ }
      }

      // [BOEK-031] Is deze factuur al gecrediteerd? The creditnota stores its link to the
      // original in `original_invoice_id` (the real FK the creditnota route writes + guards
      // on). The old lookup used `receiver_id` — a USER-id FK, not the invoice link — so it
      // was ALWAYS null: the "Gecrediteerd via …" banner never appeared and the "Creditnota"
      // button stayed on an already-credited invoice, dead-ending on the server's 409.
      if (CREDITABLE_STATUSES.includes(invoiceData.status) && invoiceData.invoice_type === 'factuur') {
        const { data: creditnota, error: creditFout } = await supabase
          .from('invoices')
          // [DEEL-CREDIT] With the amount, and as a list: what matters is no longer whether one
          // exists but how much of the invoice they cover together.
          .select('id, invoice_number, status, created_at, total_inc_btw')
          .eq('original_invoice_id', invoiceId)
          .eq('invoice_type', 'creditnota')
          .order('created_at', { ascending: true })

        // [NO-SILENT-EMPTY] Mislukt deze lezing, dan weten we niet hoeveel er al terug is — en
        // "we weten het niet" mag hier niet als "nul" op het scherm komen. De route en de database
        // bewaken hetzelfde plafond, dus een verkeerde klik wordt alsnog geweigerd; wat dit
        // voorkomt is het verkeerde BEDRAG dat de eigenaar leest voordat hij klikt.
        if (creditFout) {
          console.error('[DEEL-CREDIT] creditnota-lezing mislukt — bedragen niet getoond', { invoiceId, creditFout })
          setCreditnotasGelezen(false)
        } else if (creditnota) setLinkedCreditnotas(creditnota)
      }

      // [CREDITNOTA-REF] The other direction: when THIS invoice is a creditnota, resolve the
      // invoice it corrects, so the downloadable PDF can name it. Art. 219 Richtlijn 2006/112/EG
      // only equates a corrective document with an invoice when it refers specifically and
      // unambiguously to the initial one — without this the page-rendered PDF named only itself,
      // while the mailed one (rendered server-side) now does carry the reference.
      if (invoiceData.invoice_type === 'creditnota' && invoiceData.original_invoice_id) {
        const { data: corrected } = await supabase
          .from('invoices')
          .select('invoice_number, invoice_date')
          .eq('id', invoiceData.original_invoice_id)
          .maybeSingle()
        if (corrected) setCorrectedInvoice(corrected)
      } else if (invoiceData.invoice_type === 'creditnota') {
        // [CREDITNOTA-EXTERN] A standalone creditnota names the invoice it corrects itself: the
        // number and date the owner typed for an invoice issued outside BoekBrug. select('*')
        // above carries the two columns wherever the migration has run; absent, nothing is claimed.
        const ext = invoiceData as { credited_invoice_number?: string | null; credited_invoice_date?: string | null }
        if (ext.credited_invoice_number?.trim()) {
          setCorrectedInvoice({ invoice_number: ext.credited_invoice_number.trim(), invoice_date: ext.credited_invoice_date ?? null })
        }
      }

      setLoading(false)
    }
    load()
  }, [invoiceId])

  if (notFoundState) notFound()

  // [BOEK-031] Send draft — calls /api/invoice/send (number + status + email) — May 2026
  async function handleSendInvoice() {
    setSending(true)
    setSendError(null)

    const res = await fetch('/api/invoice/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // [FACTUUR-BIJLAGE] De sleutel reist alleen mee als dit scherm de waarheid kent — zie
      // `bijlageBekend`. Meegestuurd is hij BEPALEND, null inbegrepen: dat is wat "Weghalen" doet.
      body: JSON.stringify({ invoiceId, ...(bijlageBekend ? { attachment_document_id: bijlage?.id ?? null } : {}) }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSendError(failureText(res.status, data, t('bewerk.fout.verzenden')))
      setSending(false)
      return
    }

    // Use API response data directly — avoids Supabase read-after-write lag
    // The API already committed the new number + status + type to DB
    const responseData = await res.json().catch(() => ({}))
    setInvoice((prev) => (prev === null ? prev : {
      ...prev,
      status: 'sent',
      invoice_number: responseData.invoice_number ?? prev.invoice_number,
      invoice_type: responseData.invoice_type ?? prev.invoice_type,
    }))

    // [SEND-PDF-HONEST] pdf_failed = the number was issued but the PDF/email did NOT go out. Don't
    // silently close as if delivered — keep the modal open with an honest resend prompt.
    //
    // [VERSTUURD-EERLIJK] This line used to name pdf_failed and `delivered === false` but NOT
    // email_failed — exactly the half-fix FacturenClient carried until it was found there. The
    // three spellings are one question now, and one module answers it.
    const nietBezorgd = deliveryFailure(responseData)
    if (nietBezorgd) {
      setSendError(nietBezorgd === 'email_failed'
        ? t('detail.fout.mailNietVerstuurd')
        : t('detail.fout.pdfNietGemaakt'))
      setSending(false)
      return
    }

    setShowSendModal(false)
    setSending(false)
  }

  // [COHERENCE-CREDITNOTA] Create the creditnota via the dedicated route. No blank
  // form, no re-entry: the server copies the original invoice's lines negatively and
  // preserves the original_invoice_id link. On success we land on the new creditnota;
  // the original's detail then shows "Gecrediteerd via …" and the create-banner is
  // gone (canCreateCreditnota turns off), so a second credit is impossible.
  async function createCreditnota() {
    setCreatingCredit(true)
    setCreditError(null)
    try {
      const res = await fetch('/api/invoice/creditnota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_invoice_id: invoiceId,
          reason: creditReason.trim(),
          // [CREDIT-NAMENS] Namens wie, als dit niet je eigen administratie is. De route gelooft
          // dit niet op zijn woord: hij haalt er de machtiging bij en weigert zonder.
          ...(isOwner ? {} : { namens_klant_id: invoice?.sender_id ?? undefined }),
          // [DEEL-CREDIT] Alleen meesturen als er ECHT een deel is gekozen. Laat het veld weg en
          // de route doet precies wat hij altijd deed: de hele factuur. Zo is "alles crediteren"
          // niet een selectie die toevallig alles bevat, maar letterlijk hetzelfde verzoek.
          ...(creditSelection ? { lines: creditSelection } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreditError(failureText(res.status, data, t('detail.fout.creditnota')))
        setCreatingCredit(false)
        return
      }
      // Navigate to the freshly-created, correctly-linked creditnota.
      router.replace(
        data.creditnota_id ? `/dashboard/invoice/${data.creditnota_id}` : '/dashboard/facturen'
      )
    } catch {
      setCreditError(t('detail.onbekendeFout'))
      setCreatingCredit(false)
    }
  }

  // [STATUS] Woord én kleur in één keer, uit de gedeelde module.
  const statusCfg = invoice
    ? statusChip(invoice.status, taal)
    : null

  // [ACC-INVOICE-DETAIL] Owner = the logged-in viewer whose id equals the
  // invoice's sender_id (the party who issued it). An accountant opening a
  // client's outgoing invoice has a different id, so isOwner is false for them.
  // Identity-based, not query-param based: cannot be spoofed or absent.
  const isOwner = !!invoice && viewerProfile?.id === invoice.sender_id

  // [DEEL-CREDIT] Hoeveel er al is teruggegeven, en hoeveel er nog terug KAN. Dezelfde functies
  // die de route en de database gebruiken — één plafond, drie plekken die het bewaken.
  const alGecrediteerd = creditedTotalsFrom(
    linkedCreditnotas.map((c) => ({ original_invoice_id: invoiceId, total_inc_btw: c.total_inc_btw })),
  ).get(invoiceId) ?? 0
  const nogTeCrediteren = creditableRemaining(invoice?.total_inc_btw, alGecrediteerd)

  // [KETEN] The chain as this page can see it: this document, plus the invoice it corrects when
  // that one was read. Nothing else is loaded for it — a link we cannot see is never claimed, so a
  // creditnota written against an invoice issued outside BoekBrug gets the number the owner typed
  // and no "Bekijken" that would lead nowhere.
  const ketenDocs: KetenDocument[] = invoice
    ? [
        {
          id: invoice.id,
          invoice_number: invoice.invoice_number ?? null,
          invoice_type: invoice.invoice_type ?? null,
          invoice_date: invoice.invoice_date ?? null,
          total_inc_btw: invoice.total_inc_btw ?? null,
          original_invoice_id: (invoice as { original_invoice_id?: string | null }).original_invoice_id ?? null,
        },
        ...((invoice as { original_invoice_id?: string | null }).original_invoice_id && correctedInvoice
          ? [{
              id: String((invoice as { original_invoice_id?: string | null }).original_invoice_id),
              invoice_number: correctedInvoice.invoice_number ?? null,
              invoice_type: 'factuur',
              invoice_date: correctedInvoice.invoice_date ?? null,
              total_inc_btw: null,
            } as KetenDocument]
          : []),
      ]
    : []
  const gecorrigeerdeFactuur =
    invoice?.invoice_type === 'creditnota' && ketenDocs.length > 0
      ? origineelVan(factuurketen(ketenDocs[0], ketenDocs))
      : null
  // The number and date the banner shows: from the linked invoice when there is one, otherwise the
  // two the owner typed for an invoice this administration never held ([CREDITNOTA-EXTERN]).
  const gecorrigeerdNummer = gecorrigeerdeFactuur?.nummer ?? correctedInvoice?.invoice_number ?? null
  const gecorrigeerdDatum = gecorrigeerdeFactuur?.datum ?? correctedInvoice?.invoice_date ?? null
  const volledigGecrediteerd = alGecrediteerd > 0 && nogTeCrediteren <= 0

  // [DEEL-CREDIT] Wat er nu gekozen staat, en wat dat kost. `null` betekent "de hele factuur" en
  // reist als een verzoek zonder selectie — precies het verzoek van voor deze functie.
  const creditSelection: LineSelection[] | null = !creditPartial
    ? null
    : lines
        .map((l) => ({ id: String(l.id), quantity: creditQty[String(l.id)] ?? 0 }))
        .filter((r) => Math.abs(r.quantity) > 0)
  // Dezelfde functie die de route gebruikt om het echte bedrag uit te rekenen, dus wat hier staat
  // is wat er straks op de creditnota komt — en niet een tweede schatting ernaast.
  const creditPreview = buildCreditSelection({
    lines: lines.map((l) => ({ ...l, id: String(l.id) })),
    selection: creditSelection,
    discountType: invoice?.discount_type,
    discountValue: invoice?.discount_value,
  })
  const creditPast = creditPreview.totalIncBtw <= nogTeCrediteren + 0.005
  const creditLeeg = creditPartial && (creditSelection?.length ?? 0) === 0

  // [CREDIT-NAMENS] De boekhouder corrigeert wat HIJ heeft uitgereikt, en verder niets.
  //
  // Hier stond "nooit de boekhouder", en dat was één regel te breed. Een gemachtigde boekhouder
  // maakt facturen op naam van zijn klant en verstuurt ze; ging er één fout, dan lag de enige
  // wettelijke weg terug bij de klant — bij precies de ondernemer die zijn facturatie uit handen
  // had gegeven. De grens die WEL klopt is dezelfde die canAccessInvoice() al trekt: eigen werk.
  // Een factuur die de klant zelf maakte blijft van de klant, en dat is geen tekortkoming maar de
  // betekenis van het mandaat (zie canSendInvoice in acting-for.ts).
  //
  // Dit scherm is optimistisch, zoals elk scherm hier: de route toetst rol, koppeling, soort en
  // intrekking opnieuw, en de database bewaakt het plafond. Een ingetrokken machtiging levert dus
  // geen creditnota op — de knop staat er nog, het antwoord is 403.
  const eigenUitgifteAlsBoekhouder =
    !!invoice && !isOwner && !!viewerProfile?.id && invoice.created_by === viewerProfile.id

  const canCreateCreditnota =
    invoice &&
    (isOwner || eigenUitgifteAlsBoekhouder) &&
    invoice.invoice_type !== 'creditnota' &&
    invoice.direction !== 'incoming' && // [ACC-INVOICE-VIEW] creditnota only on own outgoing invoices
    !!invoice.status && CREDITABLE_STATUSES.includes(invoice.status) &&
    // [DEEL-CREDIT] Zolang er nog iets te crediteren valt. Vroeger stond hier "en er is er nog
    // geen" — de aanname dat een creditnota altijd de hele factuur is.
    nogTeCrediteren > 0 &&
    // …en zolang we WETEN hoeveel dat is. Zonder de lezing is nogTeCrediteren het volle bedrag,
    // en dan biedt dit scherm aan om een tweede keer terug te geven wat al terug is.
    creditnotasGelezen

  // [HERSTEL] A sent invoice is fully editable while nothing is attached to it — the market
  // rule, with the locks in invoice-editable.ts. This screen shows the button only for what it
  // can see itself (paid, credited, incoming); the PUT route checks EVERYTHING (bank link, kas,
  // verwerkt, filed quarter) and refuses with the reason. Saving automatically delivers the
  // corrected version to the customer — the edit screen says so.
  const canCorrectSent =
    invoice &&
    isOwner &&
    invoice.invoice_type === 'factuur' &&
    invoice.direction !== 'incoming' &&
    (invoice.status === 'sent' || invoice.status === 'overdue') &&
    // [DEEL-CREDIT] ANY credit blocks the edit, partial included — and that is not the same
    // question as "may it still be credited". A creditnota refers to the invoice AS IT WAS;
    // rewriting the invoice underneath it leaves a correction that corrects something that no
    // longer exists. The PUT route refuses this too (sentEditBlockers); this only hides the button.
    linkedCreditnotas.length === 0 &&
    // Een mislukte lezing is geen "er is er geen". Deze knop bewerkt een VERZONDEN factuur en
    // levert de correctie automatisch bij de klant af; hem tonen omdat we niet konden kijken is
    // precies de volgorde die de toelichting hierboven verbiedt.
    creditnotasGelezen &&
    !((invoice.amount_paid ?? 0) > 0)

  // [ACC-INVOICE-VIEW] Direction is the single source of truth. Only an explicit
  // 'incoming' flips the view; NULL/legacy/anything else renders as outgoing
  // (the safe, unchanged default that covers every normal invoice).
  const isIncoming = invoice?.direction === 'incoming'

  // [ACC-INVOICE-VIEW] Party blocks derived from direction.
  //   outgoing:  Van = ZZP'er (own profile)        | Aan = customer (client_*)
  //   incoming:  Van = supplier (client_* fields)  | Aan = ZZP'er (own profile)
  // On incoming, the supplier lives in client_* (there are no supplier_* columns),
  // and the ZZP'er is the logged-in viewer (sender_id points at an external party).
  const selfBlock = {
    name: viewerProfile?.company_name || viewerProfile?.full_name,
    lines: [
      viewerProfile?.company_name || viewerProfile?.full_name,
      viewerProfile?.address,
      [viewerProfile?.postal_code, viewerProfile?.city].filter(Boolean).join(' '),
      viewerProfile?.kvk_number ? `KVK: ${viewerProfile.kvk_number}` : null,
      viewerProfile?.btw_number ? `BTW: ${viewerProfile.btw_number.toUpperCase()}` : null,
    ],
  }
  const counterpartyBlock = {
    name: invoice?.client_name || '—',
    lines: [
      invoice?.client_name || '—',
      // [KLANT-EXTRA] De vrije klantregels, direct onder de naam — precies waar de PDF ze
      // drukt. Zonder ze toont dit scherm een AAN-blok dat het document tegenspreekt, en de
      // eigenaar concludeert dat zijn "t.a.v."-regel verloren is gegaan terwijl hij op de
      // factuur gewoon staat.
      ...clientExtraLines(invoice ?? undefined),
      invoice?.client_address,
      [invoice?.client_postal_code, invoice?.client_city].filter(Boolean).join(' '),
      invoice?.client_btw_number ? `BTW: ${invoice.client_btw_number.toUpperCase()}` : null,
      invoice?.client_email,
    ],
  }
  const vanBlock = isIncoming ? counterpartyBlock : selfBlock
  const aanBlock = isIncoming ? selfBlock : counterpartyBlock

  // [FACTUUR-BIJLAGE] Eén blok, twee plekken: de verstuurbevestiging van een concept én de
  // opnieuw-versturen-melding van een factuur die al de deur uit is.
  //
  // Het stond alleen op de eerste. Dat leek genoeg — je kiest een bijlage bij het versturen — maar
  // het zijn juist de LATERE verzendingen waarin er iets aan mankeert: het bestand is opgeruimd,
  // of het was het verkeerde. Zonder dit blok op de tweede plek stond daar een knop die weigerde
  // met "kies een ander bestand", op een scherm zonder enige manier om dat te doen.
  const bijlageKiezer = !bijlageBekend ? null : (
    <div style={{ marginBottom: 16, paddingTop: 12, borderTop: '1px solid #F1F3F4' }}>
      {bijlage ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            <span style={{ color: '#5F6368' }}>📎</span>
            <span style={{ flex: 1, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bijlage.file_name}
            </span>
            <button
              type="button"
              onClick={() => { setBijlage(null); setBijlageZoek(''); setBijlageTreffers([]) }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: '#70757a' }}
            >
              {t('bijlage.weghalen')}
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#70757a', margin: '4px 0 0' }}>{t('bijlage.staatOpFactuur')}</p>
          {/* Het geval waarin de ondernemer moet ingrijpen: het bestand ligt in de prullenbak, dus
              de verstuurroute weigert. Zeggen wat er is en wat eraan te doen — de weigering
              hierachter komt vóór het factuurnummer, dus er raakt niets zoek. */}
          {bijlage.trashed ? (
            <p style={{ fontSize: 12, color: '#B3261E', margin: '4px 0 0', lineHeight: 1.5 }}>
              {t('bijlage.inPrullenbak')}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <label htmlFor="bijlage-zoek" style={{ display: 'block', fontSize: 13, color: '#5F6368', marginBottom: 6 }}>
            {t('bijlage.meesturen')}
          </label>
          <input
            id="bijlage-zoek"
            type="text"
            value={bijlageZoek}
            placeholder={t('bijlage.zoekHint')}
            onChange={async (e) => {
              const q = e.target.value
              setBijlageZoek(q)
              if (q.trim().length < 2) { setBijlageTreffers([]); return }
              setBijlageZoekt(true)
              try {
                const r = await fetch(`/api/bestanden?search=${encodeURIComponent(q.trim())}`)
                const d = await r.json().catch(() => ({}))
                setBijlageTreffers(Array.isArray(d?.documents) ? d.documents.slice(0, 6) : [])
              } catch {
                // Zoeken dat niet lukt laat de lijst leeg; versturen kan gewoon door, want
                // een bijlage is nooit verplicht.
                setBijlageTreffers([])
              } finally {
                setBijlageZoekt(false)
              }
            }}
            style={{ width: '100%', minHeight: 40, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 12px', fontSize: 15, boxSizing: 'border-box' }}
          />
          {bijlageZoekt && <p style={{ fontSize: 12, color: '#70757a', margin: '6px 0 0' }}>{t('bijlage.zoeken')}</p>}
          {bijlageTreffers.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => { setBijlage(d); setBijlageTreffers([]) }}
              style={{ display: 'block', width: '100%', textAlign: 'start', background: 'none', border: 'none', borderBottom: '1px solid #F1F3F4', padding: '8px 0', cursor: 'pointer', fontSize: 13.5, color: '#202124' }}
            >
              {d.file_name}
            </button>
          ))}
        </>
      )}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA' }}>

      {/* [DS] Context toolbar — [SUBNAV] back + generic "Factuur" title come from
          the shared sub-page header; this bar keeps the invoice-specific context
          (number + type badge + status chip + actions + PDF) and sticks directly
          below the shared bar. */}
      <div style={{
        position: 'sticky', top: STICKY_BELOW_HEADER, zIndex: 10,
        backgroundColor: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px',
      }}>
        {/* [BAR-ALIGN] This bar already centred its content — but at the column's
            OUTER width, while the body below spends 16px of that on its gutters.
            The factuurnummer therefore started one gutter left of the card under
            it and the PDF button ended one gutter right of it. columnInner is the
            width the reader actually sees. */}
        {/* [DETAIL-BAR] Layout staat in globals.css (.inv-detail-bar*), niet inline —
            anders wint de inline style van de wrap-regel onder 520px en scrolt de
            hele pagina weer zijwaarts. */}
        <div className="inv-detail-bar" style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto' }}>
          <div className="inv-detail-bar-left">
            {loading ? (
              <div style={{ height: 16, width: 144, backgroundColor: '#f1f3f4', borderRadius: 9999 }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 style={{ fontSize: 16, fontWeight: 700, color: '#202124', margin: 0 }}>
                  {invoice?.invoice_number || t('status.draft')}
                </h1>
                {invoice?.invoice_type && invoice?.invoice_type !== 'factuur' && (
                  <InvoiceTypeBadge type={invoice.invoice_type as InvoiceType} size="xs" />
                )}
                {/* [ACTING-FOR] Gemaakt door een MEDEWERKER, niet door de eigenaar zelf.
                    De eigenaar deelt het recht uit om facturen op zijn naam en BTW-nummer uit
                    te geven; bij een controle is zo'n factuur niet van de zijne te onderscheiden.
                    Dan hoort hier te staan wie hem maakte. Verschijnt alleen als het iemand
                    anders was — anders is het ruis op elke eigen factuur. */}
                {makerNaam && (
                  <span
                    title={t('detail.aangemaaktDoor', { name: makerNaam })}
                    style={{ fontSize: 11, fontWeight: 500, borderRadius: 9999, padding: '3px 10px', background: '#F3E5F5', color: '#6A1B9A', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>person</span>
                    {makerNaam}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="inv-detail-bar-right">
            {!loading && statusCfg && (
              <>
                {/* [DS] Status chip — Material You pill */}
                <span style={{
                  fontSize: 12, fontWeight: 500,
                  padding: '4px 12px',
                  borderRadius: 9999,
                  backgroundColor: statusCfg.bg,
                  color: statusCfg.color,
                  whiteSpace: 'nowrap',
                }}>
                  {statusCfg.label}
                </span>
                <InvoiceActions
                  invoiceId={invoiceId}
                  invoiceNumber={invoice?.invoice_number ?? ''}
                  status={invoice?.status ?? ''}
                  direction={invoice?.direction ?? undefined} /*[BOEK-020]*/
                  invoiceType={invoice?.invoice_type} /*[BETAALVERZOEK]*/
                />
                {/* [ACC-INVOICE-VIEW] Outgoing: generate the invoice PDF.
                    Incoming: InvoicePDF assumes outgoing (Van=profile/Aan=client)
                    and would emit a wrong document — show the original supplier
                    PDF from pdf_url instead. */}
                {!isIncoming && invoice && profile && (
                  <PdfDocumentButton
                    invoice={{
                      ...invoice,
                      // [CREDITNOTA-REF] undefined on a normal factuur — the PDF prints the
                      // reference line only for a creditnota that has one.
                      original_invoice_number: correctedInvoice?.invoice_number,
                      original_invoice_date: correctedInvoice?.invoice_date,
                    }}
                    lines={lines}
                    profile={profile}
                    download={`${invoice.invoice_number || 'concept'}.pdf`}
                    label={`↓ ${t('nieuw.pdf.knop')}`}
                    busyLabel={t('nieuw.actie.pdfBezig')}
                    failedLabel={t('nieuw.actie.pdfMislukt')}
                    style={{
                      backgroundColor: '#1A73E8', color: 'white', fontSize: 13, fontWeight: 500,
                      padding: '8px 16px', borderRadius: 9999, border: 'none', cursor: 'pointer',
                      textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  />
                )}
                {isIncoming && invoice?.pdf_url && (
                  /* [DOC-VERSE-LINK] A plain link, and it has to be one.
                     
                     This button used to fetch a signed url and then call window.open(). Both halves
                     were wrong, and the second is why it did nothing at all: window.open() after an
                     `await` is no longer inside the user gesture, so the browser blocks it — and it
                     blocks it by returning null, not by throwing. So the catch never ran, the error
                     sentence never appeared, and the owner tapped a blue button that did nothing.
                     Reported on invoice 720154, a camera-scanned purchase invoice whose file is
                     perfectly present.
                     
                     The first half was a stopwatch: the url was signed on the fetch and lives 300
                     seconds. fileOpenHref carries NO url — it points at our own route, which signs
                     at the moment of the tap and redirects. That is the same escape hatch the
                     document sheet already uses; this screen simply never adopted it. */
                  <a
                    href={fileOpenHref(invoiceId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      backgroundColor: '#1A73E8',
                      color: 'white',
                      fontSize: 13,
                      fontWeight: 500,
                      padding: '8px 16px',
                      borderRadius: 9999,
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)',
                    }}
                  >
                    {`↓ ${t('detail.origineelPdf')}`}
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <InvoiceDetailSkeleton />
      ) : (
        <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 80 }}>

          {/* [FACTUUR-A] Delivery recovery banner — shows when ?delivery=pdf_failed|email_failed — June 2026 */}
          {deliveryWarning && (
            <div style={{ backgroundColor: '#FEF7E0', borderInlineStart: '4px solid #F9AB00', borderRadius: '0 16px 16px 0', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1 }}>
                  <span style={{ color: M3.warning, flexShrink: 0, fontSize: 16 }}>⚠</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#7C4D00', margin: 0 }}>
                      {t('detail.bezorgingMislukt')}
                    </p>
                    <p style={{ fontSize: 12, color: '#7C4D00', margin: '2px 0 0', opacity: 0.85 }}>
                      {deliveryWarning === 'pdf_failed'
                        ? t('detail.bezorging.pdf')
                        : t('detail.bezorging.email')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleResend}
                  disabled={resending}
                  style={{ flexShrink: 0, backgroundColor: '#F9AB00', color: '#202124', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: resending ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: resending ? 0.6 : 1 }}
                >
                  {resending ? t('bewerk.verzendenBezig') : `↻ ${t('lijst.opnieuwVersturen')}`}
                </button>
              </div>
              {/* [FACTUUR-BIJLAGE] Wat er meegaat, en de mogelijkheid om er iets anders van te
                  maken — vóór de knop wordt ingedrukt, want dit is de enige plek waar een al
                  verstuurde factuur nog een keer de deur uit gaat. */}
              {bijlageKiezer}
            </div>
          )}

          {/* [FACTUUR-A] Resend success — toast-like — June 2026 */}
          {resendSuccess && (
            <div style={{ backgroundColor: '#E6F4EA', borderRadius: 16, padding: '10px 16px' }}>
              <p style={{ fontSize: 13, color: '#137333', margin: 0 }}>
                ✓ {t('detail.opnieuwVerzonden')}
              </p>
            </div>
          )}

          {/* [REMINDERS] Per-invoice reminder history + pause (outgoing sent/overdue only) */}
          <InvoiceReminders
            invoiceId={invoiceId}
            direction={invoice?.direction}
            status={invoice?.status}
            remindersPaused={invoice?.reminders_paused}
          />

          {/* [BOEK-031] Send banner — only for draft invoices — May 2026 */}
          {invoice?.status === 'draft' && (
            <div style={{ backgroundColor: '#D3E3FD', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#1967D2' }}>↗</span>
                <p style={{ fontSize: 12, color: '#1967D2', margin: 0 }}>
                  <strong>{t('detail.klaar')}</strong> {t('detail.definitief')}
                </p>
              </div>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={sending}
                style={{ flexShrink: 0, marginInlineStart: 12, backgroundColor: '#1A73E8', color: 'white', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: sending ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: sending ? 0.6 : 1 }}
              >
                {sending ? t('bewerk.verzendenBezig') : `✉ ${t('bewerk.verstuurFactuur')}`}
              </button>
            </div>
          )}

          {/* [BOEK-031] Send error message */}
          {sendError && (
            <div style={{ backgroundColor: '#FCE8E6', borderRadius: 16, padding: '12px 16px' }}>
              <p style={{ fontSize: 13, color: '#B3261E', margin: 0 }}>{sendError}</p>
            </div>
          )}

          {/* [OFFERTE-AKKOORD] Wat de KLANT antwoordde, en wanneer.
              Dit is het enige stukje van dit scherm dat niet door de ondernemer of de app is
              gezet maar door iemand buiten het bedrijf — en daarom precies wat er staat bij een
              meningsverschil over wat er is afgesproken. */}
          {invoice?.offerte_response === 'accepted' && (
            <div style={{ backgroundColor: '#E6F4EA', borderRadius: 16, padding: '12px 16px' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#137333', margin: 0 }}>
                {t('detail.offerte.akkoord')}
              </p>
              <p style={{ fontSize: 12, color: '#137333', margin: '2px 0 0', opacity: 0.9 }}>
                {invoice?.offerte_response_name
                  ? t('detail.offerte.doorOp', {
                      naam: invoice?.offerte_response_name ?? '',
                      datum: formatDateNL(invoice?.offerte_responded_at ?? null),
                    })
                  : t('detail.offerte.op', { datum: formatDateNL(invoice?.offerte_responded_at ?? null) })}
              </p>
              {/* [AKKOORD-VERLOPEN] answeredAfterExpiry existed, was documented as "de ondernemer
                  ziet het en beslist", was tested — and was called from nowhere. So the owner saw a
                  plain acceptance for a quote whose price had expired, and the screen with the
                  "omzetten naar factuur" button was exactly where they would not learn it. The app
                  still refuses nothing: the answer is valid, and whether last quarter's price is
                  still honoured is the owner's call. It just stops being invisible. */}
              {answeredAfterExpiry({
                invoice_type: invoice?.invoice_type ?? null,
                status: invoice?.status ?? null,
                due_date: invoice?.due_date ?? null,
                offerte_response: invoice?.offerte_response ?? null,
                offerte_responded_at: invoice?.offerte_responded_at ?? null,
              }) && (
                <p style={{ fontSize: 12, fontWeight: 600, color: '#B06000', margin: '6px 0 0' }}>
                  {t('detail.offerte.naVervaldatum', { datum: formatDateNL(invoice?.due_date ?? null) })}
                </p>
              )}
            </div>
          )}
          {invoice?.offerte_response === 'declined' && (
            <div style={{ backgroundColor: '#F1F3F4', borderRadius: 16, padding: '12px 16px' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#3c4043', margin: 0 }}>
                {t('detail.offerte.afgewezen')}
              </p>
              <p style={{ fontSize: 12, color: '#5f6368', margin: '2px 0 0' }}>
                {invoice?.offerte_response_name
                  ? t('detail.offerte.doorOp', {
                      naam: invoice?.offerte_response_name ?? '',
                      datum: formatDateNL(invoice?.offerte_responded_at ?? null),
                    })
                  : t('detail.offerte.op', { datum: formatDateNL(invoice?.offerte_responded_at ?? null) })}
              </p>
            </div>
          )}

          {/* [KETEN] On a CREDITNOTA: the invoice it corrects. The reference was written into the
              PDF (art. 219 Richtlijn 2006/112/EG asks a corrective document to refer specifically
              to the initial one) and was nowhere on the screen of the person holding it. */}
          {invoice?.invoice_type === 'creditnota' && gecorrigeerdNummer && (
            <div style={{ backgroundColor: '#E8F0FE', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#174EA6', margin: 0 }}>
                {gecorrigeerdDatum
                  ? t('detail.creditHoortBij', { number: gecorrigeerdNummer, date: formatDateNL(gecorrigeerdDatum) })
                  : t('detail.creditHoortBijZonderDatum', { number: gecorrigeerdNummer })}
              </p>
              {gecorrigeerdeFactuur && (
                <button onClick={() => router.push(`/dashboard/invoice/${gecorrigeerdeFactuur.id}`)}
                  style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, color: '#174EA6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  {t('detail.bekijken')} →
                </button>
              )}
            </div>
          )}

          {/* [DS] Creditnota banner — al een creditnota gekoppeld
              [DEEL-CREDIT] Er kunnen er meer zijn, en dan is de vraag niet WELKE maar HOEVEEL er
              samen van de factuur af is. Een factuur die deels is gecrediteerd staat nog open voor
              de rest — dat moet erbij staan, anders leest deze balk als "afgehandeld". */}
          {linkedCreditnotas.map((cn) => (
            <div key={cn.id} style={{ backgroundColor: '#F9DEDC', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#B3261E' }}>↩</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#B3261E', margin: 0 }}>{t('detail.gecrediteerdVia', { number: cn.invoice_number ?? '' })}</p>
                  <p style={{ fontSize: 11, color: '#B3261E', margin: '2px 0 0', opacity: 0.8 }}>
                    {NL_NUMBER.format(Math.abs(cn.total_inc_btw ?? 0))}
                  </p>
                </div>
              </div>
              <button onClick={() => router.push(`/dashboard/invoice/${cn.id}`)}
                style={{ fontSize: 12, fontWeight: 500, color: '#B3261E', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                {t('detail.bekijken')} →
              </button>
            </div>
          ))}
          {linkedCreditnotas.length > 0 && (
            <div style={{ backgroundColor: volledigGecrediteerd ? '#F9DEDC' : '#FEF7E0', borderRadius: 16, padding: '12px 16px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: volledigGecrediteerd ? '#B3261E' : '#EA8600', margin: 0 }}>
                {volledigGecrediteerd
                  ? t('detail.geannuleerd')
                  : t('detail.deelsGecrediteerd', {
                      credited: NL_NUMBER.format(alGecrediteerd),
                      open: NL_NUMBER.format(nogTeCrediteren),
                    })}
              </p>
            </div>
          )}

          {/* [DS] Creditnota aanmaken banner — warning tonal */}
          {canCreateCreditnota && (
            <div style={{ backgroundColor: '#FEF7E0', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⚠️</span>
                <p style={{ fontSize: 12, color: '#EA8600', margin: 0 }}>
                  <strong>{t('detail.foutIn')}</strong> {t('detail.nooitVerwijderen')}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginInlineStart: 12 }}>
                {/* [HERSTEL] Bewerken opens the ordinary edit screen; saving automatically
                    delivers the corrected version to the customer. Only while nothing is
                    attached to the invoice — otherwise only the creditnota button remains. */}
                {canCorrectSent && (
                  <button
                    onClick={() => router.push(`/dashboard/invoice/${invoiceId}/edit`)}
                    style={{ backgroundColor: 'white', color: '#EA8600', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: '1px solid #F9AB00', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >✎ {t('act.bewerken')}</button>
                )}
                <button
                  onClick={() => { setCreditReason(''); setCreditError(null); setShowCreditDialog(true) }}
                  style={{ backgroundColor: '#EA4335', color: 'white', fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 9999, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)' }}
                >↩ {t('status.credit')}</button>
              </div>
            </div>
          )}

          {/* [DS] Van / Aan / Details — Material You card */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
              {[
                {
                  title: t('nieuw.klant.van'),
                  lines: vanBlock.lines,
                },
                {
                  title: t('nieuw.klant.aan'),
                  lines: aanBlock.lines,
                },
                {
                  title: t('bank.details'),
                  lines: [
                    t('detail.rij.nummer', { value: invoice?.invoice_number || '—' }),
                    t('detail.rij.datum', { value: invoice?.invoice_date ? NL_DATE.format(new Date(invoice?.invoice_date)) : '—' }),
                    t('detail.rij.vervaldatum', { value: invoice?.due_date ? NL_DATE.format(new Date(invoice?.due_date)) : '—' }),
                    // [CROSS-QUARTER] Show the real settlement date when we recorded one, so
                    // "when did this get paid" is answered on the invoice itself.
                    invoice?.payment_date ? t('detail.rij.betaaldOp', { value: NL_DATE.format(new Date(invoice?.payment_date)) }) : '',
                    // [BESTE] The customer opened the pay or offerte page — stamped once by that page.
                    // Untyped until the generated types catch up with invoices_first_viewed.sql.
                    (invoice as { first_viewed_at?: string | null } | null)?.first_viewed_at
                      ? t('detail.rij.bekekenOp', { value: NL_DATE.format(new Date((invoice as { first_viewed_at?: string | null }).first_viewed_at as string)) })
                      : '',
                  ]
                },
              ].map(section => (
                <div key={section.title}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#70757a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{section.title}</p>
                  {section.lines.filter(Boolean).map((line, i) => (
                    <p key={i} style={{ fontSize: 13, color: i === 0 ? '#202124' : '#5F6368', fontWeight: i === 0 ? 600 : 400, margin: '2px 0' }}>{line}</p>
                  ))}
                </div>
              ))}
            </div>
            {/* [CROSS-QUARTER] When the money moved in a different quarter than the invoice
                date, say so plainly — and make explicit that the btw quarter did NOT move,
                so the owner is never confused into thinking their aangifte shifted. */}
            {invoice?.status === 'paid' && (() => {
              const xq = crossQuarterPayment(invoice?.invoice_date, invoice?.payment_date)
              if (!xq) return null
              return (
                <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: '#FFF3E0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#B26A00', marginTop: 1 }} aria-hidden>event_available</span>
                  <div style={{ fontSize: 12.5, color: '#7A4B00', lineHeight: 1.5 }}>
                    <strong>{t('detail.kwartaal.betaaldIn', { quarter: xq.paidQuarterLabel })}</strong> {t('detail.kwartaal.uitleg', { quarter: xq.bookedQuarterLabel })}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* [DS] Factuurregels — Material You card */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F3F4' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('nieuw.regels.factuur')}</h2>
            </div>
            {/* [GEEN-REGELS] Geen kolomkoppen boven nul rijen.
                
                Gemeld op factuur 720154: een ingelezen inkoopfactuur heeft in deze app geen losse
                regels — alleen de bedragen — en het scherm tekende er niettemin een tabelkop
                boven. Een kop met vijf kolommen en niets eronder leest als "de regels zijn kwijt",
                en dat is precies wat er NIET aan de hand is. De zin zegt wat er wél is vastgelegd
                en waar de regels staan. */}
            {lines.length === 0 && (
              <p style={{ padding: '14px 20px', margin: 0, fontSize: 13, color: '#5F6368', lineHeight: 1.55 }}>
                {isIncoming ? t('detail.regels.alleenBedragen') : t('detail.regels.geen')}
              </p>
            )}
            {/* Header row — [LINES-LAYOUT] raster + uitlijning staan in globals.css
                (.inv-lines-*), niet inline: anders wint de inline style van de
                media query en houdt de telefoon het brede raster. */}
            {lines.length > 0 && (
            <div className="inv-lines-head" style={{ padding: '8px 20px', backgroundColor: '#F8F9FA' }}>
              {[t('nieuw.regel.omschrijving'), t('nieuw.regel.aantal'), t('detail.kolom.prijs'), 'BTW', t('ink.totaal')].map((h, i) => (
                <p key={h} className={i === 0 ? 'inv-lines-desc' : 'inv-lines-total'} style={{ fontSize: 11, fontWeight: 600, color: '#70757a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{h}</p>
              ))}
            </div>
            )}
            {lines.map((line, index) => (
              <div key={index} className="inv-lines-row" style={{ padding: '12px 20px', borderTop: '1px solid #F1F3F4' }}>
                <p className="inv-lines-desc" style={{ fontSize: 14, color: '#202124', margin: 0 }}>{line.description}</p>
                <p className="inv-lines-qty" style={{ fontSize: 14, color: '#5F6368', margin: 0 }}>{line.quantity}</p>
                <p className="inv-lines-price" style={{ fontSize: 14, color: '#5F6368', margin: 0, fontFamily: 'Roboto Mono, monospace' }}>{formatUnitPriceNL(line.unit_price, line.quantity, line.line_total)}</p>
                <p className="inv-lines-btw" style={{ fontSize: 14, color: '#5F6368', margin: 0 }}>{line.btw_rate}%</p>
                <p className="inv-lines-total" style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0, fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(line.line_total ?? 0)}</p>
              </div>
            ))}
          </div>

          {/* [DS] Totalen */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <div style={{ maxWidth: 280, marginInlineStart: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                <span>{t('nieuw.totaal.subtotaal')}</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice?.total_ex_btw ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                <span>BTW</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice?.btw_amount ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: invoice?.invoice_type === 'creditnota' ? '#B3261E' : '#202124', paddingTop: 8, borderTop: '1px solid #F1F3F4' }}>
                <span>{t('nieuw.totaal.incl')}</span>
                <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(invoice?.total_inc_btw ?? 0)}</span>
              </div>
            </div>
          </div>

          {/* [DS] Betalingsinformatie — [ACC-INVOICE-VIEW] outgoing only;
              on incoming the IBAN belongs to the supplier (in the original PDF),
              not the ZZP'er's own profile. */}
          {!isIncoming && profile?.iban && invoice?.invoice_type !== 'creditnota' && (
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#70757a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{t('nieuw.betaalinfo')}</p>
              <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
                {t('detail.betaal.op')}{' '}
                <strong style={{ color: '#202124', fontFamily: 'Roboto Mono, monospace' }}>{profile.iban}</strong>{' '}
                {t('detail.betaal.ovv')} <strong style={{ color: '#202124' }}>{invoice?.invoice_number}</strong>
              </p>
            </div>
          )}

          {/* [FACTUUR-A] Terugbetaling block removed — PDF carries authoritative legal text — June 2026 */}

        </div>
      )}

      {/* [BOEK-031] Send confirmation modal — TODO: extract to shared CenteredModal — May 2026 */}
      {showSendModal && invoice && (
        <div onClick={() => setShowSendModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="sheet-scroll" onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              {t('bewerk.versturenNaar', { name: invoice.client_name ?? '' })}
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 16, lineHeight: 1.5 }}>
              {t('detail.bevestig')}
            </p>
            <dl style={{ fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('bewerk.modal.nummer')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>
                {invoice.invoice_number || t('bewerk.modal.nummerBijVerzending')}
              </dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('bewerk.modal.email')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>{invoice.client_email}</dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('bewerk.modal.bedrag')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>€{(invoice.total_inc_btw ?? 0).toFixed(2)}</dd>
            </dl>
            <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
              ⚠ {t('bewerk.modal.waarschuwing')}
            </p>

            {/* [FACTUUR-BIJLAGE] Eén eigen bestand mee. Het staat hier en niet op het
                bewerkscherm, omdat je er pas aan denkt op het moment dat je verstuurt — en omdat
                dit het scherm is waarop de mail écht weggaat. */}
            {bijlageKiezer}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSendModal(false)}
                disabled={sending}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: sending ? 'default' : 'pointer' }}>
                {t('nieuw.actie.annuleren')}
              </button>
              <button onClick={handleSendInvoice}
                disabled={sending}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1A73E8', color: 'white', fontSize: 14, fontWeight: 600, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1 }}>
                {sending ? t('bewerk.verzendenBezig') : t('lijst.versturen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [COHERENCE-CREDITNOTA] Creditnota confirmation — replaces the dead blank-form
          navigation. Confirming calls /api/invoice/creditnota, which copies this
          invoice's lines negatively and preserves the link. No re-entry, no orphans. */}
      {showCreditDialog && invoice && (
        <div onClick={() => !creatingCredit && setShowCreditDialog(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="sheet-scroll" onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              {invoice.invoice_number ? t('detail.credit.titel', { number: invoice.invoice_number }) : t('detail.credit.titelZonder')}
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 16, lineHeight: 1.5 }}>
              {t('detail.credit.uitleg')}
            </p>
            <dl style={{ fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('detail.credit.klant')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>{invoice.client_name}</dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('detail.teCrediteren')}</dt>
              <dd style={{ color: '#B3261E', fontWeight: 600, margin: 0 }}>
                −{NL_NUMBER.format(creditPreview.totalIncBtw)}
              </dd>
              {alGecrediteerd > 0 && (
                <>
                  <dt style={{ color: '#5F6368', margin: 0 }}>{t('detail.credit.alGecrediteerd')}</dt>
                  <dd style={{ color: '#5F6368', margin: 0 }}>{NL_NUMBER.format(alGecrediteerd)}</dd>
                  <dt style={{ color: '#5F6368', margin: 0 }}>{t('detail.credit.nogMogelijk')}</dt>
                  <dd style={{ color: '#5F6368', margin: 0 }}>{NL_NUMBER.format(nogTeCrediteren)}</dd>
                </>
              )}
            </dl>

            {/* [DEEL-CREDIT] Alles of een deel. De dialoog opent op ALLES, want dat is verreweg het
                gewone geval en dat mag geen klik duurder worden. Wie een deel kiest, kiest per
                regel hoeveel — en ziet het bedrag meelopen, uitgerekend met dezelfde functie die
                de route straks gebruikt. */}
            {lines.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'inline-flex', borderRadius: 9999, border: '1px solid #E0E0E0', overflow: 'hidden', marginBottom: 10 }}>
                  {[false, true].map((deel) => (
                    <button
                      key={String(deel)}
                      type="button"
                      onClick={() => {
                        setCreditPartial(deel)
                        // Openen op "alles gekozen" — een lijst met overal nul is een lege dialoog
                        // waarin de knop niets doet en niemand ziet waarom.
                        if (deel) {
                          setCreditQty(Object.fromEntries(lines.map((l) => [String(l.id), Number(l.quantity ?? 0)])))
                        }
                      }}
                      style={{
                        fontSize: 13, fontWeight: 500, padding: '7px 14px', border: 'none', cursor: 'pointer',
                        backgroundColor: creditPartial === deel ? '#1A73E8' : 'white',
                        color: creditPartial === deel ? 'white' : '#5F6368',
                      }}
                    >
                      {deel ? t('detail.credit.deel') : t('detail.credit.alles')}
                    </button>
                  ))}
                </div>
                {creditPartial && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {lines.map((l) => {
                      const id = String(l.id)
                      const max = Number(l.quantity ?? 0)
                      return (
                        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ flex: 1, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.description}
                          </span>
                          <span style={{ color: '#5F6368', fontSize: 12 }}>
                            {t('detail.credit.van', { max: String(max) })}
                          </span>
                          <DecimalInput
                            /* [KOMMA-INVOER] Was <input type="number">, which in Chromium reads a
                               typed 0,5 as "05" — five. Crediting half a unit was impossible and
                               silently became the whole line, on a creditnota. */
                            value={creditQty[id] ?? 0}
                            allowNegative
                            ariaLabel={t('detail.credit.aantal')}
                            onChange={(typed) => {
                              // Begrensd op wat er geleverd is, in de richting van de regel: een
                              // creditregel ([MIN-REGEL]) is negatief en blijft dat.
                              const veilig = !Number.isFinite(typed)
                                ? 0
                                : Math.sign(typed) !== 0 && Math.sign(typed) !== Math.sign(max)
                                  ? 0
                                  : Math.abs(typed) > Math.abs(max) ? max : typed
                              setCreditQty((prev) => ({ ...prev, [id]: veilig }))
                            }}
                            style={{ width: 76, minHeight: 36, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 8px', fontSize: 14 }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#5F6368', marginBottom: 6 }}>
              {t('detail.credit.reden')}
            </label>
            <input
              type="text"
              value={creditReason}
              onChange={e => setCreditReason(e.target.value)}
              placeholder={t('detail.creditReden')}
              disabled={creatingCredit}
              style={{ width: '100%', minHeight: 44, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 12px', fontSize: 16, color: '#202124', boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit' }}
            />
            {/* Een knop die uit staat zonder te zeggen waarom is een doodlopende weg. */}
            {creditLeeg && (
              <p style={{ fontSize: 12, color: '#EA8600', marginBottom: 16 }}>{t('detail.credit.kiesRegel')}</p>
            )}
            {!creditPast && !creditLeeg && (
              <p style={{ fontSize: 12, color: '#B3261E', marginBottom: 16 }}>
                {t('detail.credit.teVeel', { max: NL_NUMBER.format(nogTeCrediteren) })}
              </p>
            )}
            {creditError && (
              <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
                {creditError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreditDialog(false)}
                disabled={creatingCredit}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: creatingCredit ? 'default' : 'pointer' }}>
                {t('nieuw.actie.annuleren')}
              </button>
              <button onClick={createCreditnota}
                disabled={creatingCredit || creditLeeg || !creditPast}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#EA4335', color: 'white', fontSize: 14, fontWeight: 600, cursor: creatingCredit || creditLeeg || !creditPast ? 'default' : 'pointer', opacity: creatingCredit || creditLeeg || !creditPast ? 0.6 : 1 }}>
                {creatingCredit ? t('detail.credit.bezig') : `↩ ${t('detail.credit.maken')}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}