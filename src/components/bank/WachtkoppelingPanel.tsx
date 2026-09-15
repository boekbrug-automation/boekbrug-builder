'use client'

// src/components/bank/WachtkoppelingPanel.tsx
// [WACHTKOPPELING] "Ik heb dit betaald — de bank laat het over twee dagen zien."
//
// The table has been on production since yesterday and the API is tested, and until now there was
// no way to reach either: the capability existed and the door did not. That is the failure this
// session has diagnosed five times and then committed four times, and this is the first of the
// four being closed.
//
// It lives on /bank because that is where the owner already goes to look at money that has or has
// not arrived — and because a proposal, when one turns up, is about a line on this very screen.
//
// [NO-SILENT-EMPTY] Nothing renders until the read answers. "Nothing is waiting" and "we could not
// look" are opposite answers and the first is the dangerous one.
//
// [TAAL] The component holds no language of its own: every sentence about a waiting payment comes
// from wachtkoppeling.ts and grote-stap.ts, and a server refusal is rendered through failureText —
// never the raw error string. Those two modules are Dutch-source and not yet keyed, so this panel
// reads Dutch under every interface language; keying them is a follow-up, not a claim made here.

import { useEffect, useState } from 'react'
import { formatEuroNL, amsterdamToday } from '@/lib/format-nl'
import { wachtZin, type Wachtkoppeling } from '@/lib/wachtkoppeling'
import { beoordeelStap, groteStapZin } from '@/lib/grote-stap'
import DateFieldNL from '@/components/ui/DateFieldNL'
import { useDialog } from '@/components/ui/Dialog'
import { failureText, type ServerFailure } from '@/lib/server-message'

interface Voorstel { wachtId: string; transactionId: string; reasons: string[] }

export interface WachtPayload {
  wachtend: Wachtkoppeling[]
  verlopen: Wachtkoppeling[]
  voorstellen: Voorstel[]
  ambigu: { wachtId: string }[]
  bankUnavailable?: boolean
}

/** The populated panel, as a pure function of what was read — so a render test can drive it. */
export function WachtkoppelingView({
  data, onKoppel, onIntrek, onNieuw,
}: {
  data: WachtPayload
  onKoppel?: (wachtId: string, transactionId: string) => void
  onIntrek?: (wachtId: string) => void
  onNieuw?: () => void
}) {
  const voorstelVoor = new Map(data.voorstellen.map((v) => [v.wachtId, v]))
  const ambiguIds = new Set(data.ambigu.map((a) => a.wachtId))
  const leeg = data.wachtend.length === 0 && data.verlopen.length === 0

  return (
    <section style={{ marginBottom: 16, padding: '13px 15px', borderRadius: 12, background: '#F1F3F4', border: '1px solid #DADCE0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#202124' }}>Al betaald, wacht op de bankregel</h3>
        <button onClick={onNieuw} style={{ fontSize: 12.5, fontWeight: 600, color: '#1A73E8', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          Betaling vastleggen
        </button>
      </div>

      {data.bankUnavailable ? (
        <p role="status" style={{ fontSize: 12.5, color: '#7C5800', margin: '8px 0 0' }}>
          De bankregels konden niet worden gelezen, dus we konden niet nagaan of er al iets binnen is.
        </p>
      ) : null}

      {leeg ? (
        <p style={{ fontSize: 12.5, color: '#5f6368', margin: '8px 0 0' }}>
          Betaal je een factuur voordat de bank hem laat zien? Leg hem hier vast, dan koppelen we hem zodra de regel binnenkomt.
        </p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {data.wachtend.map((w) => {
          const voorstel = voorstelVoor.get(w.id)
          const onduidelijk = ambiguIds.has(w.id)
          return (
            <div key={w.id} style={{ fontSize: 13, color: '#202124', lineHeight: 1.5 }}>
              <div>{wachtZin(w, formatEuroNL)}</div>
              {voorstel ? (
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#137333' }}>Er is een bankregel die hierbij past — {voorstel.reasons.join(' · ')}.</span>
                  <button
                    onClick={() => onKoppel?.(w.id, voorstel.transactionId)}
                    style={{ marginInlineStart: 8, fontSize: 12.5, fontWeight: 600, color: '#1A73E8', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Koppelen
                  </button>
                </div>
              ) : null}
              {onduidelijk ? (
                <div style={{ marginTop: 4, color: '#7C5800' }}>
                  Er passen meerdere bankregels op deze betaling. Kies zelf welke het is.
                </div>
              ) : null}
              <button
                onClick={() => onIntrek?.(w.id)}
                style={{ fontSize: 12, color: '#5f6368', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}
              >
                Intrekken
              </button>
            </div>
          )
        })}

        {data.verlopen.map((w) => (
          <div key={w.id} style={{ fontSize: 12.5, color: '#5f6368', lineHeight: 1.5 }}>
            {wachtZin(w, formatEuroNL)} — er is binnen de termijn geen passende bankregel gekomen.
            <button
              onClick={() => onIntrek?.(w.id)}
              style={{ marginInlineStart: 8, fontSize: 12, color: '#5f6368', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Opruimen
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The fetching wrapper. Renders nothing at all until the read has answered. */
export default function WachtkoppelingPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<WachtPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  // [WACHTKOPPELING] Recording is the whole point of the feature; a panel that can only SHOW
  // waiting payments leaves it as unreachable as it was with no panel at all.
  const [form, setForm] = useState<null | { bedrag: string; betaaldOp: string; tegenpartij: string; richting: 'uit' | 'in' }>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  // [KASSA-DIALOOG] A money decision is never taken in the browser's own chrome.
  const dialog = useDialog()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/wachtkoppeling')
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as WachtPayload
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [tick])

  if (failed) {
    return <p role="status">De wachtende betalingen konden niet worden opgehaald.</p>
  }
  if (!data) return null

  // [WACHTKOPPELING] The booking goes through /api/bank/confirm exactly as it always has; this
  // records the outcome afterwards. Two doors that both pay is how they come to disagree about how
  // much of a payment is still assignable.
  const koppel = async (wachtId: string, transactionId: string) => {
    const w = data.wachtend.find((x) => x.id === wachtId)
    if (!w) return
    const oordeel = beoordeelStap({ soort: 'betaling_ontkoppelen', bedrag: w.bedrag, aantal: w.factuurIds.length })
    const zin = groteStapZin({ soort: 'betaling_ontkoppelen', bedrag: w.bedrag }, oordeel, formatEuroNL)
    if (zin && !(await dialog.confirm({ message: zin, confirmLabel: 'Doorgaan' }))) return
    const body = w.factuurIds.length === 1
      ? { transactionId, invoiceId: w.factuurIds[0] }
      : { transactionId, invoiceIds: w.factuurIds }
    const res = await fetch('/api/bank/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return
    await fetch('/api/wachtkoppeling', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: wachtId, actie: 'gekoppeld', transactionId }),
    })
    setTick((t) => t + 1)
    onChanged?.()
  }

  const intrek = async (wachtId: string) => {
    await fetch('/api/wachtkoppeling', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: wachtId, actie: 'ingetrokken' }),
    })
    setTick((t) => t + 1)
  }

  const bewaar = async () => {
    if (!form) return
    const bedrag = Number(form.bedrag.replace(',', '.'))
    // The amount is the whole record and is never guessed from anything else.
    if (!Number.isFinite(bedrag) || bedrag <= 0) { setFout('Vul het bedrag in dat je hebt betaald.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.betaaldOp)) { setFout('Vul de datum in waarop je betaalde.'); return }
    setBezig(true)
    setFout(null)
    try {
      const res = await fetch('/api/wachtkoppeling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          richting: form.richting, bedrag, betaaldOp: form.betaaldOp,
          tegenpartij: form.tegenpartij.trim() || null, factuurIds: [],
        }),
      })
      if (!res.ok) {
        // [SERVER-ZIN] The route's own sentence only when it is one a person can read.
        const j = (await res.json().catch(() => ({}))) as ServerFailure
        setFout(failureText(res.status, j, 'De betaling kon niet worden bewaard.'))
        return
      }
      setForm(null)
      setTick((t) => t + 1)
      onChanged?.()
    } finally {
      setBezig(false)
    }
  }

  return (
    <>
      <WachtkoppelingView
        data={data}
        onKoppel={koppel}
        onIntrek={intrek}
        onNieuw={() => setForm({ bedrag: '', betaaldOp: amsterdamToday(), tegenpartij: '', richting: 'uit' })}
      />
      {form ? (
        <div style={{ marginBottom: 16, padding: '13px 15px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #DADCE0', display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12.5 }}>
            Bedrag
            <input inputMode="decimal" value={form.bedrag} onChange={(e) => setForm({ ...form, bedrag: e.target.value })}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Betaald op
            <DateFieldNL value={form.betaaldOp} onChange={(iso) => setForm({ ...form, betaaldOp: iso })}
              max={amsterdamToday()}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Aan wie
            <input value={form.tegenpartij} onChange={(e) => setForm({ ...form, tegenpartij: e.target.value })}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 2 }} />
          </label>
          {fout ? <p role="alert" style={{ color: '#B3261E', fontSize: 12.5, margin: 0 }}>{fout}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={bewaar} disabled={bezig} style={{ padding: '8px 14px' }}>Vastleggen</button>
            <button onClick={() => { setForm(null); setFout(null) }} style={{ padding: '8px 14px' }}>Annuleren</button>
          </div>
        </div>
      ) : null}
    </>
  )
}
