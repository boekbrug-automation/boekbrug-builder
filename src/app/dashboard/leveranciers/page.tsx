// src/app/dashboard/leveranciers/page.tsx
// [LEVERANCIER-SALDO] "Wat je nog moet betalen" — per leverancier, op een datum.
//
// ── WAAROM DIT SCHERM BESTAAT ──
//
// Een foto van het pakket van een groothandel: hun scherm "Openstaande verkoopfacturen",
// gefilterd op klant 13168 — Kiwi Food Market. Twee facturen, gegroepeerd onder de klantnaam,
// elk met vervaldatum en een Vervallen-vinkje, en eronder een subtotaal: € 2.383,65. Boven de
// lijst een PEILDATUM.
//
// Dat zijn dezelfde twee facturen die BoekBrug als INKOOPfacturen heeft. De app had de regels en
// had ze nog nooit per leverancier opgeteld — terwijl dat het ene getal is waar een winkelier aan
// de telefoon naar gevraagd wordt, en het getal waar een boekhouder de crediteurenstand op
// controleert. /vandaag toont dezelfde facturen als losse taken; dit scherm is de STAND.
//
// ── EN WAAROM ER EEN CONTROLE ONDER STAAT ──
//
// Op diezelfde foto stond factuur 2034488 OPEN en vervallen. In BoekBrug stond hij op 'betaald',
// afgevinkt op 29 augustus — acht dagen ná de laatste bankregel die de app heeft. Niets was stuk:
// een handmatige afvinking is een geldige registratie (payment-evidence.ts noemt hem al bij naam
// en toont hem anders dan een bankbewijs). Wat ontbrak is dat er daarna nooit meer naar gekeken
// wordt. Het paneel onderaan doet dat: het houdt elke afgevinkte betaling tegen het afschrift dat
// de app werkelijk heeft, en zegt wat het niet kan zien in plaats van te zwijgen.
//
// [NO-SILENT-EMPTY] Elke mislukte lezing hierboven maakt het scherm LEEG met een reden, nooit een
// geruststellend "niets openstaand" — dat is precies het getal waar iemand op afgaat.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import { createServerSupabaseClient } from '@/lib/supabase-server'
// [LEVERANCIER-LAND] The recorded country per supplier, in its own tolerant read.
import { readSupplierCountries } from '@/lib/supplier-country'
import { getSessionUser } from '@/lib/session-user'
import { fetchAllRows, fetchAllRowsForIds } from '@/lib/supabase-paginate'
import { amsterdamToday } from '@/lib/format-nl'
import { counterpartKey } from '@/lib/bank-identity'
import { supplierBalances, type SettlementRow, type SupplierInvoiceRow } from '@/lib/supplier-balances'
import { corroboratePayments, type PaymentClaim, type SupplierDebit } from '@/lib/payment-corroboration'
import { buildCorroborationPanel, buildSupplierBalancePanel } from '@/lib/supplier-balance-copy'
// [LEVERANCIER-SAMENVOEGEN] Welke twee rijen aantoonbaar één bedrijf zijn — en welke niet. De
// beslissing is puur (supplier-merge.ts) en kijkt nooit naar namen; hier worden alleen de rijen
// gelezen die ze nodig heeft.
import { findMergeCandidates, type MergeSupplier } from '@/lib/supplier-merge'
import { buildSupplierMergePanel } from '@/lib/supplier-merge-copy'
import { getServerLocale } from '@/lib/i18n/server'
import LeveranciersClient, { type SupplierListCard } from './LeveranciersClient'

interface InvoiceRow {
  id: string
  invoice_number: string | null
  client_name: string | null
  supplier_id: string | null
  invoice_date: string | null
  due_date: string | null
  status: string | null
  invoice_type: string | null
  total_inc_btw: number | null
  amount_paid: number | null
  // [LEVERANCIER-SAMENVOEGEN] Het rekeningnummer dat op DIT papier stond. suppliers heeft een
  // UNIQUE (user_id, iban), dus twee rijen kunnen nooit allebei hetzelfde nummer dragen — het
  // bewijs dat ze één partij zijn moet dus uit de facturen komen.
  vendor_iban: string | null
}

interface LinkRow {
  invoice_id: string | null
  amount_applied: number | null
  paid_on: string | null
  method: string | null
  transaction_id: string | null
}

interface BankRow {
  date: string | null
  amount: number | null
  counterpart_name: string | null
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ peildatum?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const locale = await getServerLocale()
  const today = amsterdamToday()
  const asked = (await searchParams).peildatum
  // De peildatum komt uit de URL, precies zoals het pakket op de foto hem in een veld heeft staan.
  // Alleen een echte ISO-datum telt; alles anders is vandaag. Een onleesbare parameter mag nooit
  // stilletjes een ANDERE datum boven een bedrag zetten.
  const asOf = typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today

  let readFailed: string | null = null

  // ── De inkoopfacturen ────────────────────────────────────────────────────────────────────
  // [VOL-GELEZEN] Gepagineerd. PostgREST kapt stil op ~1000 rijen, en dit scherm belooft een
  // TOTAAL: een winkel voorbij de duizend inkoopfacturen zou een te lage crediteurenstand zien,
  // met niets op het scherm dat zegt dat er iets miste.
  let invoiceRows: InvoiceRow[] = []
  try {
    invoiceRows = await fetchAllRows<InvoiceRow>((from, to) =>
      supabase
        .from('invoices')
        .select('id, invoice_number, client_name, supplier_id, invoice_date, due_date, status, invoice_type, total_inc_btw, amount_paid, vendor_iban')
        .eq('receiver_id', user.id)
        .eq('direction', 'incoming')
        .neq('status', 'archived')
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (e) {
    readFailed = e instanceof Error ? e.message : String(e)
  }

  // ── De betaalregels ──────────────────────────────────────────────────────────────────────
  // Ze doen hier twee dingen tegelijk: ze maken de PEILDATUM echt (betaald ná die datum telt niet
  // mee) en ze zijn het onderwerp van de controle onderaan. Gelezen per factuur-id, want
  // bank_tx_invoices heeft geen datumfilter dat de facturen van deze eigenaar afbakent.
  let linkRows: LinkRow[] = []
  if (!readFailed && invoiceRows.length > 0) {
    try {
      linkRows = await fetchAllRowsForIds<LinkRow, string>(
        invoiceRows.map((r) => r.id),
        (chunk, from, to) =>
          supabase
            .from('bank_tx_invoices')
            .select('invoice_id, amount_applied, paid_on, method, transaction_id')
            .in('invoice_id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
      )
    } catch (e) {
      readFailed = e instanceof Error ? e.message : String(e)
    }
  }

  // ── De bankregels die eruit gingen ───────────────────────────────────────────────────────
  // Alleen afschrijvingen: de vraag is wat er naar leveranciers vertrok. En alleen wat de app
  // werkelijk heeft — de dekking hieronder komt uit dezelfde lezing, zodat het venster waarover
  // vergeleken wordt en het venster dat op het scherm staat per definitie hetzelfde zijn.
  let bankRows: BankRow[] = []
  if (!readFailed) {
    try {
      bankRows = await fetchAllRows<BankRow>((from, to) =>
        supabase
          .from('bank_transactions')
          .select('date, amount, counterpart_name')
          .eq('user_id', user.id)
          .lt('amount', 0)
          .order('id', { ascending: true })
          .range(from, to),
      )
    } catch (e) {
      readFailed = e instanceof Error ? e.message : String(e)
    }
  }

  if (readFailed) {
    console.error('[LEVERANCIER-SALDO] read failed — the screen refuses rather than showing a low total', {
      userId: user.id, error: readFailed,
    })
    return <LeveranciersClient balance={null} corroboration={null} asOf={asOf} today={today} />
  }

  // ── Eén sleutel voor beide kanten ────────────────────────────────────────────────────────
  // counterpartKey is de normalisatie die de rest van de app al gebruikt om een bankregel aan een
  // tegenpartij te knopen ("GROOTHANDEL M.H. BAL V.O.F." en "GROOTHANDEL M.H. BAL" zijn één
  // partij). supplier_id zou preciezer zijn op de factuurkant, maar een bankregel HEEFT geen
  // supplier_id — en twee verschillende sleutels aan weerszijden van een vergelijking is precies
  // hoe je een tekort verzint dat er niet is.
  const keyOf = (name: string | null) => counterpartKey(name)

  const invoices: SupplierInvoiceRow[] = invoiceRows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    supplierKey: keyOf(r.client_name),
    supplierName: r.client_name,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    status: r.status,
    invoiceType: r.invoice_type,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }))

  const settlements: SettlementRow[] = linkRows
    .filter((l): l is LinkRow & { invoice_id: string } => !!l.invoice_id)
    .map((l) => ({ invoiceId: l.invoice_id, amountApplied: l.amount_applied, paidOn: l.paid_on }))

  const balance = supplierBalances({ invoices, asOf, settlements })

  // [LEVERANCIER-NIEUW] Balance key → the supplier most of its invoices are linked to. The
  // creditors list groups on the printed name; the registry row may spell it differently. The
  // link is the fact, the name is the fallback — and a key with no linked invoice at all is what
  // the screen offers to ADD.
  const lineSupplier: Record<string, string> = {}
  {
    const votes = new Map<string, Map<string, number>>()
    for (const r of invoiceRows) {
      const key = keyOf(r.client_name)
      if (!key || !r.supplier_id) continue
      const tally = votes.get(key) ?? new Map<string, number>()
      tally.set(r.supplier_id, (tally.get(r.supplier_id) ?? 0) + 1)
      votes.set(key, tally)
    }
    for (const [key, tally] of votes) {
      lineSupplier[key] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
  }

  // ── [LEVERANCIER-SAMENVOEGEN] Twee rijen die aantoonbaar één bedrijf zijn ────────────────
  //
  // De registry, de aliassen en de naamkiezer repareren de TOEKOMST: de volgende factuur van een
  // bedrijf dat de eigenaar ooit corrigeerde komt onder de juiste rij. Geen van drieën raakt het
  // VERLEDEN aan. Twee rijen die al bestaan blijven twee, dit scherm tekent twee regels, en het
  // openstaande bedrag staat verdeeld over de helften.
  //
  // Wat hier gebeurt is alleen LEZEN en VOORSTELLEN. De eigenaar kan geen paar zelf samenstellen:
  // de app biedt uitsluitend paren aan die al een KVK-nummer of een rekeningnummer delen, en de
  // server beslist bij het indrukken opnieuw op wat hij zelf leest. Zonder die twee halve
  // grendels zou dit precies het paar kunnen aanbieden dat nooit aangeboden mag worden — BALKIP
  // B.V. naast GROOTHANDEL M.H. BAL V.O.F., twee bedrijven met één familienaam.
  //
  // Een mislukte lezing levert GEEN paneel op, en dat is de goede kant om op te falen: het paneel
  // dat er niet is stelt niets voor, terwijl een paneel op halve gegevens een samenvoeging kan
  // voorstellen waarvan het bewijs juist in het ontbrekende deel stond.
  let mergePanel: ReturnType<typeof buildSupplierMergePanel> = null
  // [LEVERANCIER-BEWERKEN] The registry itself, as the owner may edit it. Null = the read failed,
  // which the screen says in so many words — a list that is empty because the database was
  // unreachable must never read as "you have no suppliers".
  let supplierCards: SupplierListCard[] | null = null
  if (!readFailed) {
    try {
      const { data: supplierRows, error: supplierErr } = await supabase
        .from('suppliers')
        .select('id, name, iban, kvk_number, btw_number, auto_incasso, default_btw_rate, default_category, created_at, updated_at')
        .eq('user_id', user.id)
        .order('name', { ascending: true })
      if (supplierErr) throw new Error(supplierErr.message)
      // [LEVERANCIER-LAND] The country in its OWN read: newer than some installations, and a list
      // that fails over one column would read as "you have no suppliers". Unreadable here is "not
      // recorded" for every row, which is the Netherlands — what every supplier was before.
      const landen = await readSupplierCountries(supabase, user.id)
      const rows = (supplierRows ?? []) as {
        id: string; name: string; iban: string | null; kvk_number: string | null
        btw_number: string | null; auto_incasso: boolean | null; created_at: string; updated_at: string
        default_btw_rate: number | null; default_category: string | null
      }[]
      const candidates: MergeSupplier[] = rows.map((row) => {
        const mine = invoiceRows.filter((i) => i.supplier_id === row.id)
        return {
          id: row.id,
          name: row.name,
          iban: row.iban,
          kvk: row.kvk_number,
          btw: row.btw_number,
          createdAt: row.created_at,
          invoiceCount: mine.length,
          invoiceIbans: mine.map((i) => i.vendor_iban ?? '').filter((v) => v.length > 0),
        }
      })
      mergePanel = buildSupplierMergePanel(findMergeCandidates(candidates), locale)
      supplierCards = rows.map((row) => ({
        id: row.id,
        name: row.name,
        iban: row.iban,
        kvk: row.kvk_number,
        btw: row.btw_number,
        autoIncasso: row.auto_incasso === true,
        defaultBtwRate: row.default_btw_rate ?? null,
        defaultCategory: row.default_category ?? null,
        country: landen.byId.get(row.id) ?? null,
        invoiceCount: invoiceRows.filter((i) => i.supplier_id === row.id).length,
        // The balance list groups on the name key (see keyOf above), so this is how a balance line
        // finds its editable row: same key, same company.
        balanceKey: keyOf(row.name) ?? '',
        // Only a date the trigger stamped is a real "last changed"; a row never edited shows nothing.
        updatedOn: row.updated_at !== row.created_at ? row.updated_at.slice(0, 10) : null,
      }))
    } catch (e) {
      console.error('[LEVERANCIER-SAMENVOEGEN] the suppliers could not be read — no offers shown', {
        userId: user.id, error: e instanceof Error ? e.message : String(e),
      })
      mergePanel = null
      supplierCards = null
    }
  }

  // ── De dekking: precies zo ver als de bankregels reiken ──────────────────────────────────
  // Niet uit bank_statement_periods: die tabel kent alleen de afschriften die als BESTAND zijn
  // ingelezen, en op deze administratie beslaat dat één maand van de acht. De eerlijke uitspraak
  // is "zo ver reiken de banktransacties die BoekBrug heeft", en dat is ook precies de zin die de
  // ondernemer iets kan doen: het volgende afschrift inlezen.
  const dates = bankRows.map((b) => b.date).filter((d): d is string => !!d).sort()
  const coverage = { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }

  const invoiceById = new Map(invoices.map((i) => [i.id, i]))
  const claims: PaymentClaim[] = linkRows
    .filter((l): l is LinkRow & { invoice_id: string } => !!l.invoice_id)
    .map((l) => {
      const inv = invoiceById.get(l.invoice_id)
      return {
        invoiceId: l.invoice_id,
        invoiceNumber: inv?.invoiceNumber ?? null,
        supplierName: inv?.supplierName ?? null,
        supplierKey: inv?.supplierKey ?? null,
        // Een regel zonder bedrag heeft zijn factuur VOLLEDIG voldaan — dezelfde lezing als
        // bank-line-budget.ts en payment-evidence.ts. Nul zou hem uit de vergelijking laten
        // verdwijnen alsof er niets geclaimd was.
        amountApplied: l.amount_applied ?? Math.abs(inv?.totalIncBtw ?? 0),
        paidOn: l.paid_on,
        method: l.method,
        transactionId: l.transaction_id,
      }
    })

  const debits: SupplierDebit[] = bankRows
    .filter((b): b is BankRow & { date: string } => !!b.date)
    .map((b) => ({ supplierKey: keyOf(b.counterpart_name), date: b.date, amount: Math.abs(b.amount ?? 0) }))

  const corroboration = corroboratePayments({ claims, debits, coverage })

  return (
    <LeveranciersClient
      balance={buildSupplierBalancePanel(balance, locale, today)}
      corroboration={buildCorroborationPanel(corroboration, locale)}
      merge={mergePanel}
      suppliers={supplierCards}
      lineSupplier={lineSupplier}
      asOf={asOf}
      today={today}
    />
  )
}
