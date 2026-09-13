// src/app/dashboard/settings/facturering/page.tsx
// [BILLING] Welk plan geldt er, en de deur naar Stripe's portaal.
//
// Dit is ook de pagina waar Stripe de klant naartoe terugstuurt na een gelukte betaling:
// de webhook die het account op 'active' zet kan een seconde later landen dan de browser,
// vandaar de melding bovenaan.
//
// Hier wordt geen enkele abonnementskolom geschreven. De pagina leest wat de webhook heeft
// gecachet en laat al het andere over aan Stripe's gehoste portaal — één scherm waar de
// klant zijn kaart wijzigt, btw-facturen ophaalt en opzegt, zonder het ons te hoeven vragen.
//
// Toon: deze pagina mag nooit lezen als een aanmaning. Verreweg de meeste accounts horen
// hier permanent "Gratis" te zien staan, en dat is de bedoelde eindtoestand — geen gebrek,
// geen tussenstap naar iets beters. De enige reden dat Plus bestaat is dat een handvol
// zware gebruikers ons echt geld kost.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { decidePlan, type PlanDecision } from '@/lib/subscription'
import { daysLeftOnGrant, grantStanding, type PlanGrantRow } from '@/lib/plan-grants'
import { PLUS } from '@/lib/plan'
import { FAIR_USE_LIMITS, NEAR_LIMIT_RATIO, evaluateFairUse, formatLimit } from '@/lib/fair-use'
import { measureUsage } from '@/lib/fair-use-usage'
import { limitsPlanFor } from '@/lib/subscription'
import ManageSubscriptionButton from './ManageSubscriptionButton'
import { COLUMN } from '@/lib/design/tokens'
import { serverTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/t'

export const dynamic = 'force-dynamic'

type BillingProfile = {
  role?: string | null
  /** [GRENS-BLIJFT] Sinds wanneer dit account bestaat — §5.5.1 hangt eraan. Zie fair-use-history.ts. */
  created_at?: string | null
  subscription_status?: string | null
  subscription_plan?: string | null
  current_period_end?: string | null
  stripe_customer_id?: string | null
}

const dateNL = (iso: string | null | undefined) => {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  // [TZ] timeZone PINNED — this formats a subscription TIMESTAMP, so without it the renewal date
  // shifts a day for anyone whose device sits west of UTC (and differs between server and client).
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }).format(new Date(ms))
}

export default async function FactureringPage({
  searchParams,
}: {
  searchParams: Promise<{ betaald?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ── [WATERVAL] De vertaler, de URL en het profiel kennen elkaar niet ────────
  //
  // Ze stonden op een rij met een `await` ervoor, dus de profiellezing begon pas nadat de vertaler
  // klaar was — terwijl geen van drieën iets van de andere twee wil weten.
  //
  // allSettled voor de derde: die lezing MAG mislukken (de abonnementskolommen komen uit
  // billing_subscription.sql, met de hand toegepast), en dat afvangen is de hele reden voor de try
  // hieronder. Met Promise.all zou een nog niet toegepaste migratie dit scherm laten crashen in
  // plaats van een eerlijk "gratis"-paneel te tonen.
  const [tS, paramsS, profileS, grantsS] = await Promise.allSettled([
    // [TAAL] Servercomponent: de vertaler komt uit de request, niet uit een hook.
    serverTranslator(),
    searchParams,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('profiles')
      .select('role, created_at, subscription_status, subscription_plan, current_period_end, stripe_customer_id')
      .eq('id', user.id)
      .single() as Promise<{ data: BillingProfile | null; error: unknown }>,
    // [TOEKENNING] Lopende toekenningen — de welkomstperiode, een pilot, een verlenging. Eigen
    // belofte in dezelfde allSettled: de tabel komt uit plan_grants.sql (met de hand toegepast),
    // dus deze lezing MAG mislukken en het scherm toont dan gewoon het gratis plan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('plan_grants')
      .select('plan, starts_at, expires_at, revoked_at')
      .eq('user_id', user.id) as Promise<{ data: PlanGrantRow[] | null; error: unknown }>,
  ])

  if (tS.status === 'rejected') throw tS.reason
  if (paramsS.status === 'rejected') throw paramsS.reason
  const t = tS.value
  const params = paramsS.value
  const justPaid = params.betaald === '1'

  let profile: BillingProfile | null = null
  let columnsPresent = true
  try {
    if (profileS.status === 'rejected') throw profileS.reason
    const { data, error } = profileS.value
    if (error) columnsPresent = false
    else profile = data as BillingProfile
  } catch {
    columnsPresent = false
  }

  // Ontbreken de kolommen, dan is het antwoord niet "onbekend" maar gewoon "gratis": dat is
  // wat er dan geldt, en het is de waarheid voor bijna iedereen. Alleen de rol lezen we
  // alsnog, zodat een boekhouder ook zonder migratie het juiste ziet staan.
  // [TOEKENNING] Zelfde faalrichting als hierboven: onleesbaar of nog niet toegepast betekent
  // "geen toekenning", en dan is het antwoord gratis. Dat ontzegt niemand iets — zie decidePlan().
  const nowMs = readClock()
  const grantRows =
    grantsS.status === 'fulfilled' && Array.isArray(grantsS.value?.data) ? grantsS.value.data : []
  const standing = grantStanding(grantRows, nowMs)
  const grantDays = daysLeftOnGrant(standing, nowMs)

  const decision: PlanDecision = decidePlan({
    role: profile?.role ?? null,
    subscriptionStatus: columnsPresent ? profile?.subscription_status ?? null : null,
    currentPeriodEnd: columnsPresent ? profile?.current_period_end ?? null : null,
    grantedPlusUntil: standing.grantedPlusUntil,
    grantOpenEnded: standing.grantOpenEnded,
    nowMs,
  })

  const hasCustomer = Boolean(profile?.stripe_customer_id)

  // [FAIR-USE] De werkelijke stand. Dit is regel 4 uit fair-use.ts — "waarschuwen vóórdat
  // het gebeurt, niet erna" — en die regel kan alleen waar zijn als de gebruiker zijn eigen
  // stand kan zien zonder ernaar te hoeven vragen. Boekhouders kennen geen grenzen, dus
  // voor hen wordt er niets gemeten en niets getoond.
  const usage = decision.plan === 'boekhouder' ? {} : await measureUsage(supabase, user.id)
  const limitsPlan = limitsPlanFor(decision.plan)
  // [GRENS-BLIJFT] Gemeten tegen de grens waar DIT account recht op heeft, niet tegen wat wij
  // vandaag publiceren. §5.5.1: een grens die je al had, verlagen wij niet. Vandaag is dat voor
  // iedereen hetzelfde getal (de lijst met wijzigingen is leeg) — en dat hoort zo te blijven zonder
  // dat iemand hier iets moet aanpassen op de dag dat er wél een wijziging is.
  const startedAt = profile?.created_at ?? null
  const status = evaluateFairUse(usage, limitsPlan, startedAt)

  return (
    /* [HEADER-SYSTEM] The title "Facturering" and the back chevron now come from
       the shared sub-page bar, so the in-body <h1> that repeated it was removed;
       the descriptive line below it stays. The font stack lost its `system-ui`
       fallback — docs/HEADER_SYSTEM.md forbids it, and it was the reason this one
       page rendered in a different typeface on some devices. */
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '24px 16px 64px', fontFamily: 'var(--font-sans), sans-serif' }}>
      <p style={{ fontSize: 15, color: '#5f6368', margin: '0 0 24px' }}>
        {t('plan.uitleg')}
      </p>

      {justPaid && (
        <div
          role="status"
          style={{ background: '#CEEAD6', border: '1px solid #137333', color: '#0d652d', borderRadius: 12, padding: '14px 16px', marginBottom: 20, fontSize: 15, lineHeight: 1.5 }}
        >
          <strong>{t('plan.betaald')}</strong>
          <br />
          {t('plan.betaaldUitleg')}
        </div>
      )}

      <section style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 14, padding: 22 }}>
        <Row label={t('plan.titel')} value={planLabel(decision, profile, t)} />

        {/* [WELKOM-90] Wie in de welkomstperiode zit, hoort te weten tot wanneer — en dat er
            daarna niets gebeurt. Een periode die stil afloopt is precies hoe iemand denkt dat
            hem iets is afgepakt. */}
        {decision.reason === 'toekenning' && standing.grantedPlusUntil !== null && (
          <Row
            label={t('plan.welkomTot')}
            value={`${dateNL(standing.grantedPlusUntil) ?? '—'}${grantDays === null ? '' : ` (${grantDays} ${grantDays === 1 ? 'dag' : 'dagen'})`}`}
          />
        )}

        {profile?.current_period_end && decision.plan === 'plus' && decision.reason !== 'toekenning' && (
          <Row
            label={decision.reason === 'grace_period' ? t('plan.plusLooptTot') : t('plan.volgendeVerlenging')}
            value={dateNL(profile.current_period_end) ?? '—'}
          />
        )}

        {decision.plan !== 'boekhouder' && (
          <Row label={t('plan.prijsPlus')} value={`${PLUS.priceLabel} ${PLUS.period} (${PLUS.btwNote}, ${PLUS.cancelNote})`} />
        )}

        {decision.plan !== 'boekhouder' && (
          <div style={{ marginTop: 20 }}>
            <ManageSubscriptionButton hasSubscription={hasCustomer} />
          </div>
        )}

        <p style={{ fontSize: 13.5, color: '#5f6368', margin: '18px 0 0', lineHeight: 1.6 }}>
          {decision.plan === 'boekhouder' ? (
            <>
              Het boekhoudersportaal is gratis tot en met tien gekoppelde klanten. Daarboven
              komt een tarief per klant, dat pas gaat gelden nadat het minstens 30 dagen vooraf
              is aangekondigd — zie voorwaarden §5.8.
            </>
          ) : (
            <>
              {decision.reason === 'toekenning' && <>{t('plan.welkomDaarna')}{' '}</>}
              {t('plan.jeWordt')} <strong>{t('plan.nooitAfgeschreven')}</strong> {t('plan.geenProefperiode')}{' '}
              <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>
                {t('plan.beleid')}
              </Link>
              .
            </>
          )}
        </p>

        {!columnsPresent && (
          // Eerlijk over de eigen toestand: zonder de migratie kan hier geen abonnement
          // staan, ook niet als er wél voor betaald is. Beter dit te zeggen dan te doen
          // alsof "gratis" hier een meting is.
          <p style={{ fontSize: 13, color: '#7C5800', background: '#FEE8C4', borderRadius: 8, padding: '10px 12px', margin: '16px 0 0', lineHeight: 1.5 }}>
            {t('plan.migratieOntbreekt')}
          </p>
        )}
      </section>

      {decision.plan !== 'boekhouder' && (
        <section style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 14, padding: 22, marginTop: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: '0 0 4px' }}>
            {t('plan.gebruik')}
          </h2>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6 }}>
            {t('plan.maandtellers')}
          </p>

          <div style={{ display: 'grid', gap: 14 }}>
            {FAIR_USE_LIMITS.map((limit) => {
              const raw = usage[limit.key]
              // Niets gemeten (migratie nog niet toegepast, of een functie die niet bestaat)
              // is niet hetzelfde als nul: dan tonen wij een streepje in plaats van te
              // suggereren dat wij iets weten wat wij niet weten.
              const known = typeof raw === 'number' && Number.isFinite(raw)
              const used = known ? Math.max(0, raw) : 0
              const ceiling = limitsPlan === 'plus' ? limit.plus : limit.free
              const pct = ceiling > 0 ? Math.min(100, Math.round((used / ceiling) * 100)) : 0
              const over = status.exceeded.includes(limit.key)
              const near = status.nearLimit.includes(limit.key)
              const kleur = over ? '#B3261E' : near ? '#7C5800' : '#137333'

              return (
                <div key={limit.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, marginBottom: 6 }}>
                    <span style={{ color: '#3c4043', lineHeight: 1.4 }}>{limit.label}</span>
                    <span style={{ color: kleur, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {known
                        ? `${limit.unit === 'MB' ? formatMb(used) : used} / ${formatLimit(limit, limitsPlan, startedAt)}`
                        : `— / ${formatLimit(limit, limitsPlan, startedAt)}`}
                    </span>
                  </div>
                  <div style={{ height: 6, background: '#f1f3f4', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${known ? pct : 0}%`, background: kleur, borderRadius: 3 }} />
                  </div>
                  {(over || near) && (
                    <p style={{ fontSize: 13, color: kleur, margin: '6px 0 0', lineHeight: 1.5 }}>
                      {over
                        ? limit.onExceed
                        : t('plan.bijnaGrens', { pct })}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <p style={{ fontSize: 13, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
            {t('plan.waarschuwenVanaf', { pct: Math.round(NEAR_LIMIT_RATIO * 100) })}{' '}
            <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>{t('plan.beleidVolledig')}</Link>.
          </p>
        </section>
      )}
    </main>
  )
}

/** Opslag leest prettiger in GB zodra het er zijn. */
function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.', ',')} GB` : `${mb} MB`
}

/**
 * De klok, één keer gelezen, buiten de render om.
 *
 * `Date.now()` rechtstreeks in het lichaam van (ook) een server-component wordt door de
 * React-compiler terecht als onzuiver aangemerkt. Hier apart, zodat de renderfunctie zelf
 * puur blijft en er precies één moment is waarop de tijd wordt vastgesteld.
 */
function readClock(): number {
  return new Date().getTime()
}

function planLabel(decision: PlanDecision, profile: BillingProfile | null, t: Translator): string {
  switch (decision.reason) {
    case 'boekhouder':
      // Read by the boekhouder — accountant-facing text is deliberately Dutch-only (AGENTS.md).
      return 'Boekhouder — gratis, altijd'
    case 'active':
      return t('plan.actief', { name: PLUS.name })
    case 'grace_period':
      return profile?.subscription_status === 'past_due'
        ? t('plan.betalingMislukt')
        : t('plan.looptAf')
    case 'toekenning':
      return t('plan.welkomstperiode')
    case 'free':
    default:
      return t('plan.gratis')
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid #f1f3f4', fontSize: 15 }}>
      <span style={{ color: '#5f6368' }}>{label}</span>
      <span style={{ color: '#202124', fontWeight: 500, textAlign: 'end' }}>{value}</span>
    </div>
  )
}
