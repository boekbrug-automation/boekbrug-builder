// src/app/prijzen/page.tsx
// [BILLING] De prijzenpagina. Publiek en indexeerbaar: een bezoeker moet kunnen zien wat
// BoekBrug kost zonder een account te maken.
//
// ⚠️ GEEN BEDRAG WORDT HIER INGETYPT. Alles komt uit src/lib/plan.ts, dat het op zijn beurt
// afleidt uit fair-use.ts (de grenzen die de voorwaarden §5 en /eerlijk-gebruik
// publiceren) en uit bewaarkluis.ts. Op de billing-tak stonden de bedragen in de <title>,
// in de OG-beschrijving én in de tekst afzonderlijk overgetypt, en waren ze al uit elkaar
// gelopen met de bindende voorwaarden. Eén bron, dus.
//
// Eerlijkheidsregels die hier het strengst gelden (docs/growth-plan-2026.md §8): alleen
// functies die BESTAAN mogen erop. Geen "binnenkort". Bank is het IMPORTEREN van een
// afschrift; BoekBrug EXPORTEERT UBL en BEREIDT de BTW-aangifte VOOR — het doet geen
// aangifte.
//
// Er is geen `?reden=`-melding meer op deze pagina. Die hoorde bij een betaalmuur die
// mensen hierheen stuurde als hun proefperiode afliep. Wij sturen niemand weg, dus er is
// niets uit te leggen.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { PLUS, KLUIS } from '@/lib/plan'
import { FAIR_USE_LIMITS, formatLimit, fairUseLimit, ACCOUNTANT_FREE_CLIENTS } from '@/lib/fair-use'
import { BEWAARPLICHT_YEARS, KLUIS_GRACE_MONTHS, eur, KLUIS_PREPAY_YEAR_PRICE_EUR, KLUIS_YEAR_PRICE_EUR, KLUIS_SHUTDOWN_NOTICE_DAYS } from '@/lib/bewaarkluis'
import { BELOFTE_KOP, BELOFTE_KOP_2, BELOFTE_UITLEG } from '@/lib/belofte'
import SubscribeButton from './SubscribeButton'
import { isAnnualBillingConfigured } from '@/lib/billing'

export const metadata: Metadata = {
  title: 'Prijzen — gratis uitproberen, Plus om op te draaien | BoekBrug',
  description:
    `Gratis uitproberen: ${fairUseLimit('invoicesSent').free} facturen en ` +
    `${fairUseLimit('aiDocuments').free} door de AI gelezen documenten per maand. ` +
    `Plus kost ${PLUS.priceLabel} per maand of ${PLUS.annualPriceLabel} per jaar ${PLUS.btwNote}. ` +
    `Geen proefperiode, geen automatische afschrijving, en nooit een slot op je eigen administratie.`,
  keywords: ['boekbrug prijzen', 'gratis boekhoudprogramma zzp', 'boekhouden zzp kosten', 'bewaarplicht 7 jaar'],
  alternates: {
    canonical: '/prijzen',
    languages: { 'nl-NL': '/prijzen', 'en-GB': '/en/prijzen', ar: '/ar/prijzen', 'tr-TR': '/tr/prijzen' },
  },
  openGraph: {
    title: 'BoekBrug — gratis uitproberen, Plus om je zaak op te draaien',
    description:
      `Plus kost ${PLUS.priceLabel} per maand of ${PLUS.annualPriceLabel} per jaar — ` +
      `twaalf maanden voor de prijs van negen.`,
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }

// Alleen functies die vandaag in de app zitten. Houd deze lijst eerlijk.
const INCLUDED = [
  'Facturen maken, versturen en opvolgen (met betaalverzoek)',
  'Bonnetjes en inkoopfacturen scannen met AI',
  'Facturen automatisch ophalen uit je e-mail',
  'Bankafschrift importeren en automatisch matchen',
  'Kasboek en dagomzet',
  'BTW-aangifte voorbereiden (incl. KOR)',
  'De brug naar je boekhouder — één knop, alles compleet',
  'De compliance-kluis: je administratie per jaar geordend en exporteerbaar',
]

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
}

export default async function PrijzenPage({
  searchParams,
}: {
  searchParams: Promise<{ geannuleerd?: string }>
}) {
  const params = await searchParams
  const cancelled = params.geannuleerd === '1'
  const ai = fairUseLimit('aiDocuments')
  // [JAARPRIJS] Read on the SERVER. A missing annual price must cost one button, never the
  // monthly flow — and the price id behind it never crosses to the browser, only this boolean.
  // Offering an annual button that cannot open a checkout is the same broken promise as
  // publishing the amount with no way to buy it, one click later.
  const annualAvailable = isAnnualBillingConfigured()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        {/* [BELOFTE] Ook de prijspagina begint bij wat je NIET hoeft, niet bij wat het kost.
            Iemand die hier landt weet nog niet waarom hij zou betalen als hij niet weet
            waarvoor. Bron: src/lib/belofte.ts. */}
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#202124', margin: '0 0 8px', lineHeight: 1.25 }}>
          {BELOFTE_KOP} <span style={{ color: '#1a73e8' }}>{BELOFTE_KOP_2}</span>
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6, maxWidth: 640 }}>
          {BELOFTE_UITLEG}
        </p>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.6, maxWidth: 620 }}>
          Je probeert het <strong>gratis</strong> uit, en je boekhouder werkt gratis mee tot en
          met {ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten. Geen proefperiode die stilletjes
          afloopt, geen creditcard vooraf, en geen slot op je eigen administratie.
        </p>

        {cancelled && (
          <div
            role="status"
            style={{
              background: '#f1f3f4', border: '1px solid #e0e0e0', color: '#5f6368',
              borderRadius: 12, padding: '14px 16px', marginBottom: 24, fontSize: 15,
            }}
          >
            Je betaling is afgebroken — er is niets in rekening gebracht.
          </div>
        )}

        {/* ── De drie plannen ────────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {/* [EERLIJK-WOORD] Gratis = de proefwerkplek. Deze kaart zei het omgekeerde: "dit is
              het plan waar de meeste gebruikers permanent op horen te blijven". Dat was waar bij
              50 documenten en 2 GB; bij 5 facturen en 50 MB is het een belofte die de app niet
              waarmaakt, en een bezoeker die erop afgaat komt in zijn eerste week klem te zitten. */}
          <section style={{ ...card, borderColor: '#137333', borderWidth: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#137333', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Ondernemer
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              alle functies, om uit te proberen
            </div>
            <Link
              href="/register"
              style={{
                display: 'block', textAlign: 'center', padding: '12px 20px', background: '#137333',
                color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15,
              }}
            >
              Gratis beginnen
            </Link>
            <ul style={{ fontSize: 13.5, color: '#3c4043', margin: '16px 0 0', paddingInlineStart: 18, lineHeight: 1.7 }}>
              {FAIR_USE_LIMITS.filter((l) => l.key !== 'administrations').map((l) => (
                <li key={l.key}>
                  {l.label}: <strong>{formatLimit(l, 'free')}</strong>
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '12px 0 0', lineHeight: 1.6 }}>
              Genoeg om te zien hoe het werkt. Draai je er je zaak op, dan kom je hier overheen —
              zo is het bedoeld. Alles wat je invoert blijft van jou, ook daarna.
            </p>
          </section>

          {/* Plus */}
          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A73E8', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {PLUS.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>{PLUS.priceLabel}</span>
              <span style={{ fontSize: 15, color: '#5f6368' }}>{PLUS.period}</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              {PLUS.btwNote} · {PLUS.cancelNote}
            </div>
            {/* [JAARPRIJS] Twaalf maanden voor de prijs van negen. Het bedrag komt uit plan.ts,
                dat het afleidt uit fair-use.ts — hier wordt niets overgetypt. */}
            {annualAvailable && (
              <p style={{ fontSize: 14.5, fontWeight: 600, color: '#188038', margin: '0 0 12px' }}>
                Of {PLUS.annualPriceLabel} {PLUS.annualPeriod} — twaalf maanden voor de prijs van negen.
              </p>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              <SubscribeButton
                interval="month"
                label={`Plus nemen — ${PLUS.priceLabel} ${PLUS.period}`}
              />
              {annualAvailable && (
                <SubscribeButton
                  interval="year"
                  variant="secondary"
                  label={`Plus per jaar — ${PLUS.annualPriceLabel}`}
                />
              )}
            </div>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              {/* [LIMIET-ZIN] `ai.free`, niet formatLimit(): die geeft "10 per maand" terug, en in
                  een zin die zelf al "per maand" zegt las dat als "meer dan 10 per maand documenten
                  per maand". formatLimit hoort thuis waar een grens LOS staat (de tabel hieronder,
                  het verbruiksscherm), niet middenin een lopende zin. */}
              Dit is het plan om je zaak op te draaien. Geen gepubliceerd plafond op facturen,
              gelezen documenten of opslag — ruim, onder eerlijk gebruik. Twee mailboxen in plaats
              van één. Vanaf meer dan {ai.free} gelezen documenten per maand is Plus het antwoord.
            </p>
          </section>

          {/* Boekhouder */}
          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6368', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Boekhouder
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>tot en met {ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten</div>
            <Link
              href="/register"
              style={{
                display: 'block', textAlign: 'center', padding: '12px 20px', background: '#fff',
                color: '#1A73E8', border: '1.5px solid #1A73E8', borderRadius: 8,
                textDecoration: 'none', fontWeight: 600, fontSize: 15,
              }}
            >
              Portaal openen
            </Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Het volledige portaal, het werkbord en het per klant ophalen van een afgesloten
              kwartaal. Geen proefperiode en geen klok — blijf je onder de{' '}
              {ACCOUNTANT_FREE_CLIENTS}, dan blijft het gratis, ook over vijf jaar. Daarboven een
              tarief per gekoppelde klant; dat is nog niet vastgesteld en gaat pas gelden nadat wij
              het minstens 30 dagen vooraf hebben aangekondigd.{' '}
              <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Voorwaarden §5.8</Link>.
            </p>
          </section>
        </div>

        {/* ── Wat er in alles zit ────────────────────────────────── */}
        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: '0 0 14px' }}>
            Dit zit in álle plannen — ook als je het gratis uitprobeert
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {INCLUDED.map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: '#202124', lineHeight: 1.5 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
            De grenzen staan tot op het getal op{' '}
            <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>/eerlijk-gebruik</Link>.
            Kom je erboven, dan pauzeert alleen de handeling die ons geld kost. Inzien, doorzoeken
            en exporteren van je eigen administratie blijven altijd werken — ook boven de grens,
            ook op Plus, ook nadat je stopt.
          </p>
        </section>

        {/* ── De Bewaarkluis ─────────────────────────────────────── */}
        <section style={{ ...card, marginTop: 16, background: '#FFFBF2', borderColor: '#E8C89A' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C5800', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {KLUIS.name}
          </div>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '8px 0 10px' }}>
            Je stopt met je zaak. Je bewaarplicht stopt niet.
          </h2>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            De Belastingdienst vraagt je administratie <strong>{BEWAARPLICHT_YEARS} jaar</strong> te
            kunnen tonen (art. 52 AWR). Die termijn loopt door als je onderneming stopt, en ook als
            je software stopt. Het is het enige dat een ondernemer nog moet kunnen nadat hij overal
            mee is opgehouden — en precies daar staat meestal niets voor klaar.
          </p>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            Wij houden je archief online: per jaar en kwartaal geordend, doorzoekbaar, en met één
            knop per jaar te exporteren als ZIP met index. Dat kost{' '}
            <strong>{eur(KLUIS_PREPAY_YEAR_PRICE_EUR)} per resterend bewaarjaar</strong>, in één keer
            vooruit. Sluit je vandaag je zaak, dan is dat {eur(BEWAARPLICHT_YEARS * KLUIS_PREPAY_YEAR_PRICE_EUR)}{' '}
            voor de hele termijn — is je jongste boekjaar ouder, dan zijn het minder jaren en dus
            minder geld. Liever niet alles in één keer? Dan kan het ook{' '}
            <strong>{eur(KLUIS_YEAR_PRICE_EUR)} per jaar</strong>.
          </p>
          {/* [KLUIS-UITGANG] Voorwaarden §5.7.6, hier op de verkooppagina.
              De vraag die iedereen stelt bij zeven jaar vooruitbetalen aan een jong bedrijf is
              "en als jullie ermee stoppen?". Het antwoord stond alleen in de voorwaarden, waar
              een twijfelaar het nooit leest — terwijl het het sterkste argument is dat wij hebben.
              Alle getallen komen uit bewaarkluis.ts, zodat pagina en voorwaarden niet uit elkaar
              kunnen lopen. */}
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            <strong>En als wij ermee stoppen?</strong> Zeven jaar vooruit betalen is alleen eerlijk
            met een uitgang die vooraf vastligt. Stoppen wij met de Bewaarkluis, dan kondigen wij
            dat <strong>minstens {KLUIS_SHUTDOWN_NOTICE_DAYS} dagen vooraf</strong> aan, krijgt
            iedere klant <strong>automatisch zijn volledige archief</strong>, en betalen wij het
            niet-verbruikte deel naar rato terug. Dat staat zo in de voorwaarden, niet alleen hier.
          </p>
          <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.65, maxWidth: 660 }}>
            <strong>Wat wij niet verkopen:</strong> wij nemen je bewaarplicht niet over — die blijft
            wettelijk van jou. Wij zijn je tweede exemplaar, nooit je enige; download je eigen kopie
            ook. En de eerste <strong>{KLUIS_GRACE_MONTHS} maanden na je opzegging bewaren wij alles
            gratis</strong>, met een waarschuwing per e-mail ruim vóór er ooit iets weggaat.{' '}
            {/* [KLUIS-10-JAAR] Voorwaarden §5.7.3. De kluis rekent met 7 jaar, maar voor onroerend
                goed is de wettelijke termijn 10. Een dienst die op naleving wordt verkocht mag die
                uitzondering niet weglaten: wie een pand in zijn administratie heeft en op onze
                7 afgaat, staat in jaar 8 met lege handen — precies het scenario dat wij beloven
                te voorkomen. */}
            Eén uitzondering: heb je <strong>onroerend goed</strong> in je administratie, dan geldt
            wettelijk <strong>10 jaar</strong> in plaats van {BEWAARPLICHT_YEARS}. De kluis rekent
            met {BEWAARPLICHT_YEARS}; houd die langere termijn dan zelf aan.{' '}
            <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Voorwaarden §5.7</Link>.
          </p>
        </section>

        {/* ── De vragen die mensen echt stellen ──────────────────── */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>
            Veelgestelde vragen
          </h2>

          <div style={{ display: 'grid', gap: 14 }}>
            <Faq q="Is het gratis plan een proefperiode?">
              Er loopt <strong>geen klok</strong>. Het gratis plan stopt nooit uit zichzelf en je
              laat geen betaalgegevens achter, dus er kan ook nooit iets worden afgeschreven. Wat
              het begrenst is de hoeveelheid per maand: {fairUseLimit('invoicesSent').free} facturen
              versturen en {ai.free} documenten door de AI laten lezen. Dat is genoeg om te zien hoe
              BoekBrug werkt en te weinig om er een jaar op te draaien — zo is het bedoeld. Alle
              grenzen staan op{' '}
              <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>één pagina</Link>.
            </Faq>

            <Faq q="Wat gebeurt er als ik boven een grens kom?">
              Je krijgt een melding bij 80% van een grens, met het exacte aantal — dus vóórdat er
              iets gebeurt. Kom je erboven, dan pauzeert <em>alleen</em> de handeling die ons geld
              kost: een nieuw document automatisch laten uitlezen, een nieuwe factuur versturen.
              Alles wat er al staat blijft leesbaar en exporteerbaar. Daarna kies je zelf: wachten
              tot de volgende maand, of Plus nemen. Zeg je Plus later weer op, dan wordt er niets
              verwijderd en blijft je mailbox gekoppeld — alleen nieuwe groei pauzeert weer.
            </Faq>

            {/* [KANTOOR-STAFFEL] Dit antwoord zei "een tarief per klant". Dat was de vorige
                vorm, en hij is bewust verlaten: §5.8 van de voorwaarden en
                src/lib/accountant-pricing.ts kennen een STAFFEL per kantoor, waarin één klant
                erbij binnen de trede niets kost. Twee beschrijvingen van hetzelfde bedrag lopen
                altijd uiteen — hier waren ze het al niet meer eens met de bindende tekst. */}
            <Faq q="Betaalt mijn boekhouder ook?">
              Tot en met {ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten niet — dan is het portaal
              gratis, zonder klok en zonder proefperiode. Heeft hij er meer, dan geldt een staffel
              per kantoor: binnen een trede kost één klant erbij niets. Die tarieven zijn nog niet
              actief, en zolang wij ze niet minstens 30 dagen vooraf hebben aangekondigd is het
              portaal volledig kosteloos. Wat hij betaalt verandert nooit iets aan wat jij betaalt
              — de staffel staat op{' '}
              <Link href="/voor-boekhouders" style={{ color: '#1a73e8' }}>voor boekhouders</Link>.
            </Faq>

            {/* [EERLIJK-WOORD] Hier stond "Hoe werkt de gratis proefmaand van Plus?". Die
                proefmaand bestaat niet meer — het gratis plan IS de proef — en het antwoord is
                samen met trial_period_days verdwenen. Een verkooppagina die een gratis maand
                blijft beloven die de checkout niet meer geeft, is precies het verschil waarin een
                klant gelijk krijgt. */}
            <Faq q="Wat kost Plus per jaar?">
              {PLUS.annualPriceLabel} {PLUS.annualPeriod} {PLUS.btwNote} — twaalf maanden voor de
              prijs van negen, in één keer vooruit. Precies hetzelfde Plus als de maandvariant van{' '}
              {PLUS.priceLabel}: geen ander pakket en geen andere grenzen. Eén bedrag per jaar, geen
              constructie met gratis maanden erin.
            </Faq>

            {/* [JAARPRIJS] Deze vraag heette "Kan ik maandelijks opzeggen?" en dat antwoord was
                onwaar geworden voor wie per jaar betaalt: hij leest "maandelijks" en denkt dat
                hij na een maand van zijn jaarbedrag af is. Eén Plus, twee termijnen — dus de
                vraag gaat over opzeggen en het antwoord noemt beide termijnen bij naam. */}
            <Faq q="Kan ik opzeggen?">
              Ja, altijd en per direct — je zegt Plus zelf op in je eigen instellingen, geen
              mailtje en geen telefoontje. Je houdt Plus tot het einde van de periode die je al
              hebt betaald: bij maandelijks betalen tot het einde van die maand, bij jaarlijks
              betalen tot het einde van dat jaar. Daarna val je terug op het gratis plan. Een al
              betaalde periode wordt niet automatisch terugbetaald — tenzij de dienst door ons
              toedoen langdurig onbruikbaar was ({''}
              <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Voorwaarden §5.4</Link>).
              Je verliest geen enkel gegeven: er wordt niets verwijderd, je mailbox blijft
              gekoppeld, en alles blijft leesbaar en exporteerbaar. Alleen nieuwe groei boven de
              gratis grenzen pauzeert.
            </Faq>

            <Faq q="Krijg ik een factuur met btw?">
              Ja. Elke betaling levert automatisch een btw-factuur op je naam op, die je zelf kunt
              downloaden. Heb je een btw-nummer, dan zet je dat bij het afrekenen op de factuur.
            </Faq>

            <Faq q="Hoe kan ik betalen?">
              Met iDEAL of creditcard. De betaling loopt via Stripe — je kaartgegevens komen nooit
              bij BoekBrug binnen.
            </Faq>

            <Faq q="Wat als ik helemaal stop met BoekBrug?">
              Je exporteert alles (dat blijft altijd werken, ook op het gratis plan). Daarna bewaren
              wij je administratie nog {KLUIS_GRACE_MONTHS} maanden gratis. Wil je dat het langer
              blijft staan omdat je bewaarplicht doorloopt, dan is daar de Bewaarkluis voor. Wij
              verwijderen nooit iets zonder minstens 30 dagen aankondiging per e-mail.
            </Faq>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
