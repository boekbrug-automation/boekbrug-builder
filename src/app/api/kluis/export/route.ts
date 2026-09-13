// src/app/api/kluis/export/route.ts
// [KLUIS] Compliance-kluis export — a ZIP of one fiscal year's administratie:
// every stored document for that year + a manifest (index.csv) + a README that
// states the 7-year bewaarplicht. Owner-only (session/RLS): documents are fetched
// scoped by user_id and downloaded from the owner's own storage, so no cross-user
// access is possible. This embodies the open-door principle — the whole year exports
// cleanly, for the accountant or the owner, at any time.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import JSZip from 'jszip'
import { keepThroughYear } from '@/lib/compliance-vault'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getOriginal } from '@/lib/document-storage'

export const dynamic = 'force-dynamic'

// Bounds so one export can't exhaust server memory. Honest if we hit them: the
// README records exactly what was left out (never a silent truncation).
const MAX_FILES = 500
const MAX_TOTAL_BYTES = 150 * 1024 * 1024 // 150 MB

// CSV cell that is safe to open in Excel/LibreOffice. Two protections:
//  1. Delimiter/quote/newline escaping (RFC-4180 quoting).
//  2. FORMULA-INJECTION neutralisation: a cell starting with = + - @ (or a
//     tab/CR that some tools treat as a formula lead) is prefixed with a single
//     quote, so a malicious client/file name like `=HYPERLINK(...)` can't execute
//     in the ACCOUNTANT's spreadsheet. This export is third-party-facing.
const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const eur = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ','))
// A storage path may contain slashes/odd chars — keep a safe, readable file name.
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'bestand'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  // [DIEP-3] Bounded like its siblings — the day-end audit found this one uncapped.
  const limited = await checkRateLimit({ userId: user.id, endpoint: 'kluis-export', ...RATE_LIMITS.HEAVY_EXPORT });
  if (!limited.allowed) return rateLimitResponse(limited);

  const yearRaw = req.nextUrl.searchParams.get('year')
  const year = Number(yearRaw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Ongeldig jaar' }, { status: 400 })
  }

  // The year's records — owner-scoped. [PAGINATION] Page past the ~1000-row PostgREST cap:
  // a full year of a busy administratie can exceed it, and a silent truncation would drop
  // documents/invoices from the 7-year archive AND its manifest — the exact opposite of the
  // "whole year exports cleanly, nothing left out" promise the README makes.
  const [documents, invoices] = await Promise.all([
    fetchAllRows<{
      file_name: string | null; file_url: string | null; file_type: string | null;
      doc_type: string | null; period: string | null; invoice_id: string | null; created_at: string | null;
    }>((from, to) =>
      supabase
        .from('documents')
        .select('file_name, file_url, file_type, doc_type, period, invoice_id, created_at')
        .eq('user_id', user.id)
        .eq('year', year)
        .eq('trashed', false)
        // [PAGINATION-STABLE] Final tiebreak on the PRIMARY KEY: created_at/file_url can tie
        // (bulk imports, null file_url), and a non-unique order across separate page requests
        // would duplicate or SKIP rows at the 1000-boundary — a silent hole in the legal
        // archive. The id tiebreak makes the page order total + deterministic.
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<{
      invoice_number: string | null; invoice_date: string | null; direction: string | null;
      invoice_type: string | null; client_name: string | null; total_ex_btw: number | null;
      btw_amount: number | null; total_inc_btw: number | null; status: string | null;
    }>((from, to) =>
      supabase
        .from('invoices')
        .select('invoice_number, invoice_date, direction, invoice_type, client_name, total_ex_btw, btw_amount, total_inc_btw, status')
        // [TRUST-ARCHIVE] BOTH directions. Outgoing invoices are the owner's as
        // sender_id; incoming (purchase) invoices are stored with sender_id NULL and
        // receiver_id = the owner, so a sender_id-only query silently dropped every
        // purchase record — while the README claimed 'in en uit'. The .or matches the
        // invoices RLS policy (sender_id = auth.uid() OR receiver_id = auth.uid()), so
        // it stays owner-scoped. Without incoming, the accountant cannot reconstruct
        // voorbelasting from the 7-year archive.
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .gte('invoice_date', `${year}-01-01`)
        .lte('invoice_date', `${year}-12-31`)
        // [PAGINATION-STABLE] Tiebreak on the PRIMARY KEY — invoice_date/invoice_number are
        // non-unique (and invoice_number nullable), so without id a same-date cluster
        // straddling the 1000-boundary could drop invoices from the archive.
        .order('invoice_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])

  const docs = documents ?? []
  const invs = invoices ?? []
  if (docs.length === 0 && invs.length === 0) {
    return NextResponse.json({ error: `Geen stukken gevonden voor ${year}.` }, { status: 404 })
  }

  const zip = new JSZip()
  const root = zip.folder(`administratie-${year}`)!
  const docFolder = root.folder('documenten')!

  // ── documents: download each from the owner's storage, note failures honestly ──
  const manifest: string[] = ['Bestand;Type;Kwartaal;Gekoppelde factuur;Toegevoegd;Status']
  const skipped: string[] = []
  let usedBytes = 0
  let added = 0
  const usedNames = new Set<string>()

  for (const d of docs) {
    let status = 'ok'
    let name = safeName(d.file_name || 'bestand')
    if (added >= MAX_FILES) {
      status = `overgeslagen (limiet ${MAX_FILES} bestanden bereikt)`
      skipped.push(`${d.file_name} (${status})`)
    } else if (!d.file_url) {
      status = 'geen bestand'
    } else {
      const { data: blob, error } = await getOriginal(supabase, d.file_url)
      if (error || !blob) {
        status = 'niet gevonden in opslag'
        skipped.push(`${d.file_name} (${status})`)
      } else {
        const buf = Buffer.from(await blob.arrayBuffer())
        if (usedBytes + buf.length > MAX_TOTAL_BYTES) {
          status = `overgeslagen (max ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB per export)`
          skipped.push(`${d.file_name} (${status})`)
        } else {
          // De-dupe identical names so NO file silently overwrites another (that would
          // be data loss reported as "ok"). Loop until the candidate name is unused —
          // a single check could still collide with an already-generated "N-name".
          if (usedNames.has(name)) {
            const base = name
            let n = 2
            do { name = `${n}-${base}`; n++ } while (usedNames.has(name))
          }
          usedNames.add(name)
          docFolder.file(name, buf)
          usedBytes += buf.length
          added++
        }
      }
    }
    manifest.push([
      csvCell(status === 'ok' ? name : d.file_name),
      csvCell(d.doc_type ?? ''),
      csvCell(d.period ?? ''),
      csvCell(d.invoice_id ?? ''),
      csvCell(d.created_at ? String(d.created_at).slice(0, 10) : ''),
      csvCell(status),
    ].join(';'))
  }

  // ── invoices manifest (the financial records themselves) ──
  const invLines: string[] = ['Factuurnummer;Datum;Richting;Type;Klant;Excl. BTW;BTW;Incl. BTW;Status']
  const sortedInv = [...invs].sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''))
  for (const i of sortedInv) {
    invLines.push([
      csvCell(i.invoice_number ?? ''),
      csvCell(i.invoice_date ?? ''),
      csvCell(i.direction === 'outgoing' ? 'uit' : i.direction === 'incoming' ? 'in' : ''),
      csvCell(i.invoice_type ?? ''),
      csvCell(i.client_name ?? ''),
      csvCell(eur(i.total_ex_btw)),
      csvCell(eur(i.btw_amount)),
      csvCell(eur(i.total_inc_btw)),
      csvCell(i.status ?? ''),
    ].join(';'))
  }

  root.file('documenten-index.csv', '﻿' + manifest.join('\r\n') + '\r\n')
  root.file('facturen-index.csv', '﻿' + invLines.join('\r\n') + '\r\n')

  const readme = [
    `Administratie ${year} — geëxporteerd uit BoekBrug`,
    ``,
    `Deze map bevat je stukken over ${year}:`,
    `  • documenten/            — je bankafschriften, bonnen en overige documenten`,
    `  • documenten-index.csv   — overzicht van die documenten`,
    `  • facturen-index.csv     — al je facturen (in en uit) over ${year}`,
    ``,
    `Bewaarplicht: de Belastingdienst vraagt je administratie 7 jaar te bewaren.`,
    `De stukken over ${year} bewaar je dus tot en met ${keepThroughYear(year)}.`,
    ``,
    `Documenten in dit bestand: ${added}${skipped.length ? ` (overgeslagen: ${skipped.length})` : ''}.`,
    // [TRUST-ARCHIVE] Honest, split count — no single conflated total. Only factuur/
    // creditnota are fiscale stukken; offertes/pro-forma's and concepten are listed
    // for completeness but flagged so the accountant isn't misled.
    (() => {
      const isFiscal = (t: string | null) => t === 'factuur' || t === 'creditnota'
      const uit = invs.filter((i) => i.direction === 'outgoing' && isFiscal(i.invoice_type)).length
      const inn = invs.filter((i) => i.direction === 'incoming' && isFiscal(i.invoice_type)).length
      const concept = invs.filter(
        (i) => i.status === 'draft' || i.invoice_type === 'offerte' || i.invoice_type === 'pro_forma'
      ).length
      return `Facturen in het overzicht: ${uit} uitgaand, ${inn} inkomend` +
        (concept ? ` (+ ${concept} concept/offerte — niet-fiscaal, ter info)` : '') + '.'
    })(),
    ...(skipped.length ? ['', 'Overgeslagen bestanden:', ...skipped.map((s) => `  - ${s}`)] : []),
    ``,
    `BoekBrug — je financiële waarheid, altijd exporteerbaar.`,
  ].join('\n')
  root.file('LEESMIJ.txt', readme)

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return new NextResponse(content as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="boekbrug-administratie-${year}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
