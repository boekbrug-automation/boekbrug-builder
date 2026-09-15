// src/app/voor-boekhouders/page.tsx
// [KANTOOR-VOORDEUR] The front door for an administratiekantoor.
//
// ── WHY THIS PAGE EXISTS ──
// The bookkeeper channel was the only one with working plumbing and no entrance. An office could
// be INVITED by a client (/api/accountant/invite, the /register role picker, the whole portal
// under /dashboard/accountant) but could not find out what BoekBrug is without already being in
// it. docs/growth-plan-2026.md §6.2 lists exactly this as the open hand-off: "the plumbing
// exists; it needs a front door and an incentive."
//
// It matters more than one page usually does because of who the reader is. An office decides for
// its whole book: one administratiekantoor with fifty ZZP clients is fifty entrepreneurs, and
// MARKTPOSITIE_2026.md §9 says a single meeting with such an office is worth more office contact
// than a year of SEO. The entrepreneur-facing pages cannot do this job — they answer "what do I
// stop having to do", and an office asks the opposite question: "what will this cost me in time,
// and what does it let a client do inside an administration I am responsible for."
//
// ── THE RULE THIS PAGE IS UNDER ──
// Same one as /prijzen, and stricter here: ONLY WHAT EXISTS. No "binnenkort". A professional
// reader checks, and one unmet promise on this page costs the whole channel — an office that
// finds a claim untrue does not file a complaint, it stops answering. So §"Wat BoekBrug niet
// doet" is on the page on purpose: XAF, RGS, filing to the Belastingdienst and Peppol are the
// four things an office WILL ask about, and it is better to answer them here, correctly, than to
// be found out in a demo. Every one of those four is verified in code, not remembered:
// docs/MARKTPOSITIE_2026.md re-verified them on 14 August 2026 and src/lib/ubl-export.ts:7 still
// says what it says. Since 25 August 2026 the XAF/RGS answer is YES with a stated limit: the
// export lives in src/lib/xaf-export.ts and carries verified RGS references on the main accounts
// only — the FAQ text below says exactly that much.
//
// [XAF-GEEN-XSD] That comment used to say the export "validates against the official 3.2 XSD",
// and the FAQ said so to the reader. It does not, and it never did: there is no .xsd anywhere in
// this repo, no validator runs, and xaf-export.test.ts asserts the output with regexes. The claim
// came from a sentence in a comment and was believed by the sentence below it.
//
// What the file DOES verify is real and is now what the FAQ says instead: every journal entry
// balances before it is written, the file-level debit/credit assertion stands between the journals
// and the download, and an entry that cannot be balanced is REFUSED rather than patched
// (xaf-export.ts:521,554). That is a stronger claim than schema-validity in the only way that
// matters to an accountant — a schema-valid file can still carry a wrong number — and it has the
// advantage of being true. The limit is stated out loud, like the other three.
// Same day, the Peppol answer became "beide bestaan": UblBuildOptions.peppol builds the BIS 3.0
// identity of the same invoice ([SI-UBL], conformance-tested), while sending over the network
// still needs an access-point contract — and the FAQ says that limit out loud too.
//
// ── NO AMOUNT IS TYPED HERE ──
// The ladder comes from src/lib/accountant-pricing.ts and the free boundary from
// src/lib/fair-use.ts — the same constants the Terms render from. In July 2026 the Terms and the
// database each knew a different price and neither knew about the other; that is the defect this
// import prevents from happening a third time.
//
// Dutch, and deliberately not translated: per AGENTS.md the accountant module has one audience,
// a boekhouder reading Dutch administraties under Dutch law.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { ACCOUNTANT_FREE_CLIENTS } from '@/lib/fair-use'
import { OFFICE_GETS, OFFICE_NEVER_GETS, REJECTED_MODELS } from '@/lib/office-offer'
import {
  ACCOUNTANT_BANDS,
  ACCOUNTANT_PRICING_ACTIVE,
  REFERRAL_RATE_HYPOTHESIS,
  euro,
  firstPaidBand,
  inclBtw,
  referralCeilingExclBtw,
} from '@/lib/accountant-pricing'

export const metadata: Metadata = {
  title: 'Voor boekhouders — je klant levert compleet aan | BoekBrug',
  description:
    `Het boekhoudersportaal van BoekBrug: zie van al je klanten in één scherm wat er nog ` +
    `ontbreekt, vraag stukken op, en werk de stapel weg die het kwartaal tegenhoudt. ` +
    `Gratis tot en met ${ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten.`,
  keywords: [
    'boekhoudprogramma voor boekhouders',
    'administratiekantoor software',
    'klantadministratie zzp aanleveren',
    'boekhouder portaal',
  ],
  alternates: { canonical: '/voor-boekhouders' },
  openGraph: {
    title: 'BoekBrug voor boekhouders — je klant levert compleet aan',
    description:
      `Zie van al je klanten in één scherm wat er nog ontbreekt. Gratis tot en met ` +
      `${ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten.`,
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
}

const h2: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: '#202124',
  margin: '0 0 12px',
  lineHeight: 1.3,
}

const body: React.CSSProperties = {
  fontSize: 16,
  color: '#5f6368',
  lineHeight: 1.7,
  margin: '0 0 14px',
  maxWidth: 660,
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-block',
  background: '#1a73e8',
  color: '#fff',
  fontSize: 16,
  fontWeight: 600,
  padding: '12px 22px',
  borderRadius: 9999,
  textDecoration: 'none',
}

const btnGhost: React.CSSProperties = {
  display: 'inline-block',
  background: '#fff',
  color: '#1a73e8',
  fontSize: 16,
  fontWeight: 600,
  padding: '12px 22px',
  borderRadius: 9999,
  border: '1px solid #d3e3fd',
  textDecoration: 'none',
}

/**
 * The screens an office actually gets, described by what is on them. Every entry is a route that
 * exists under /dashboard/accountant today — keep it that way.
 */
const SCHERMEN: ReadonlyArray<{ titel: string; uitleg: string }> = [
  {
    titel: 'Eén werkboard in plaats van vier deuren',
    uitleg:
      'Het scherm dat je opent zegt meteen wat er wacht: hoeveel stukken een kwartaal ' +
      'tegenhouden, welke klant nog niets heeft aangeleverd, en wat er openstaat. Geen tegels ' +
      'waar je achter moet klikken om te ontdekken of er werk ligt.',
  },
  {
    titel: 'Van al je klanten in één overzicht: wat ontbreekt er nog',
    uitleg:
      'Per klant een stand — klaar, bijna, of aandacht — met de koppen van wat er mist. Niet ' +
      'alleen hoeveel stukken, maar welke. Je ziet in één blik welke administratie je vandaag ' +
      'kunt afronden en welke je nog niet hoeft te openen.',
  },
  {
    titel: 'Stukken opvragen zonder een mail te typen',
    uitleg:
      'Mist er een bon of een inkoopfactuur, dan vraag je die op vanuit het scherm waar je hem ' +
      'mist. De klant krijgt het verzoek in zijn eigen omgeving te zien, niet als los mailtje ' +
      'dat onderin zijn inbox verdwijnt.',
  },
  {
    titel: 'De stapel die het kwartaal tegenhoudt, zelf wegwerken',
    uitleg:
      'Documenten die op een beslissing wachten kun je zelf afhandelen in plaats van erop te ' +
      'wachten. Wat jij bevestigt, staat vast in de administratie van de klant.',
  },
  {
    titel: 'Waar staat het geld van je klanten',
    uitleg:
      'Eén debiteurenoverzicht over je klanten heen: wat is verstuurd, wat is betaald, wat staat ' +
      'te lang open. Dit is meestal het eerste wat een ondernemer aan jou vraagt.',
  },
  {
    titel: 'Factureren namens een klant — als hij je gemachtigd heeft',
    uitleg:
      'Met een machtiging maak en verstuur je facturen in naam van de klant, uit zijn eigen ' +
      'doorlopende nummerreeks. Zonder machtiging kan het niet, ook niet per ongeluk.',
  },
]

/** The four questions an office asks that BoekBrug has to answer with "nee". */
const NIET: ReadonlyArray<{ vraag: string; antwoord: string }> = [
  {
    // [WERK-GEDAAN-DEUR] De helft van "wat levert het mij op?" die over geld gaat. Elk kantoor
    // vraagt hem, en het antwoord is nee — dat hier niet zeggen laat het lijken alsof er nog over
    // te praten valt, en dat is het soort stilte waar een gesprek later op stukloopt.
    vraag: 'Krijg ik een vergoeding of marge als ik klanten aanbreng?',
    antwoord:
      'Nee. Er is geen commissie, geen marge en geen wederverkoop, en er is er ook geen in de maak — ' +
      'noch gebouwd, noch geprijsd. Twee redenen, en de tweede is de jouwe: een betaalde aanbeveling ' +
      'is voor je klant minder waard dan een onbetaalde, en je zou hem moeten melden. De rekensom ' +
      'staat onder "En wat levert het jou op?" hierboven.',
  },
  {
    vraag: 'Doet BoekBrug de aangifte?',
    antwoord:
      'Nee. Het scherm BEREIDT de BTW-aangifte voor — het rekent de rubrieken uit en laat zien ' +
      'waar ze vandaan komen. Verzenden naar de Belastingdienst doet het niet. ' +
      // [RUBRIEK-1E] De grens, hardop, om dezelfde reden als bij XAF en Peppol hierboven: een
      // kantoor dat een niet-genoemde beperking in een demo tegenkomt, stopt met antwoorden.
      'Welke rubrieken: 1a, 1b, 1c, 1e, 2a, 3b, 4a en 4b. Rubriek 3a (uitvoer buiten de EU) en 3c ' +
      '(afstandsverkopen) niet — die rekent het concept nog niet uit, ook als het land van de klant ' +
      'is vastgelegd. 0%-omzet die niet als levering binnen de EU herkend is, staat daarom in 1e, met een ' +
      'notitie bij het concept die dat benoemt. De bedragen kloppen; de indeling van die ene ' +
      'rubriek beoordeel jij.',
  },
  {
    vraag: 'Is er een XAF-auditbestand of RGS-rekeningschema?',
    antwoord:
      'Ja: per klant en per jaar is er een XML Auditfile Financieel 3.2 én 4.0 (het schema dat de ' +
      'Belastingdienst vanaf 2027 als enige accepteert), met verkoopboek, ' +
      'inkoopboek, bank, kas en dagomzet als sluitende boekingen. Elke journaalpost telt ' +
      'debet = credit voordat hij in het bestand komt, het bestandstotaal sluit, en een post die ' +
      'niet sluitend te maken is wordt GEWEIGERD in plaats van rechtgetrokken — die staat er dan ' +
      'als document bij, niet als verzonnen boeking. Wat wij niet doen: het bestand tegen de ' +
      'officiële XSD laten valideren; dat controleer je zelf bij het inlezen. De hoofdrekeningen ' +
      'dragen hun RGS-referentiecode; wat de app niet kan plaatsen staat benoemd op ' +
      'Vraagposten in plaats van gegokt op een rekening. ' +
      'Een volledig RGS-schema op detailniveau is er nog niet.',
  },
  {
    vraag: 'Is de UBL-export Peppol/SI-UBL?',
    antwoord:
      'Beide bestaan. De standaard-export is UBL 2.1 zonder CustomizationID — bewust soepel, ' +
      'bedoeld om te IMPORTEREN in Exact Online, SnelStart, Twinfield of Yuki. Daarnaast is elke ' +
      'factuur als Peppol BIS 3.0-document te downloaden (vereist het BTW-nummer van de klant ' +
      'als elektronisch adres). Verzenden ÓVER het Peppol-netwerk doet BoekBrug nog niet — daar ' +
      'is een accesspoint-contract voor nodig.',
  },
  {
    vraag: 'Kan ik mijn hele bestaande klantenbestand overzetten?',
    antwoord:
      'Alleen klant voor klant, via een koppeling die de klant zelf accepteert. Er is geen ' +
      'bulkimport van administraties.',
  },
]

export default function VoorBoekhoudersPage() {
  // [PROVISIE-REKENSOM] The band an office first pays for — the honest size to compare a
  // commission against, and null-safe because a table of only free bands compares against nothing.
  const paidBand = firstPaidBand()
  // An open-ended first paid band (upTo null) has no size to name, so the block renders nothing
  // rather than comparing "bij 0 klanten" — a sum with a made-up left-hand side.
  const paidBandClients = paidBand?.upTo ?? 0

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>

        {/* ── Hero ─────────────────────────────────────────────────
            The promise is about the office's time, not about features. An office does not buy
            software, it buys back the January it spends chasing paper. */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a73e8', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10 }}>
          Voor administratiekantoren
        </div>
        <h1 style={{ fontSize: 38, fontWeight: 800, color: '#202124', margin: '0 0 14px', lineHeight: 1.15, letterSpacing: -0.5, maxWidth: 700 }}>
          Je klant levert compleet aan.<br />
          <span style={{ color: '#1a73e8' }}>Zonder dat jij erachteraan zit.</span>
        </h1>
        <p style={{ ...body, fontSize: 18, marginBottom: 24 }}>
          BoekBrug is de administratie van je klant, gebouwd rond het moment dat hij hem aan jou
          geeft. Hij factureert, scant zijn bonnen en importeert zijn bankafschrift; jij ziet van
          al je klanten tegelijk wat er nog ontbreekt, en vraagt het op waar het mist.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <Link href="/register?rol=accountant" style={btnPrimary}>
            Kantooraccount aanmaken
          </Link>
          <Link href="/beveiliging" style={btnGhost}>
            Hoe het met de gegevens zit
          </Link>
        </div>
        <p style={{ fontSize: 13, color: '#80868b', margin: '0 0 40px' }}>
          Gratis tot en met {ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten. Geen creditcard, geen
          proefperiode die afloopt.
        </p>

        {/* ── Het probleem, in de woorden van het kantoor ────────── */}
        <section style={{ ...card, marginBottom: 32 }}>
          <h2 style={h2}>Het werk zit niet in het boeken</h2>
          <p style={body}>
            Het zit in het achterhalen. Welke klant heeft nog niets gestuurd, welke bon hoort bij
            welke afschrijving, en waarom klopt dit kwartaal niet. Dat is geen boekhoudwerk maar
            administratie óver de administratie, en het valt precies in de weken waarin je het het
            minst kunt hebben.
          </p>
          <p style={{ ...body, margin: 0 }}>
            BoekBrug verplaatst dat werk naar waar het hoort: bij de ondernemer, op het moment dat
            hij de bon in zijn hand heeft. Wat jij overhoudt is de stand — per klant, elke dag,
            zonder erom te vragen.
          </p>
        </section>

        {/* ── Wat je krijgt ──────────────────────────────────────── */}
        <h2 style={{ ...h2, fontSize: 26, marginBottom: 16 }}>Wat er in het portaal zit</h2>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 32 }}>
          {SCHERMEN.map((s) => (
            <section key={s.titel} style={card}>
              <h3 style={{ fontSize: 17, fontWeight: 600, color: '#202124', margin: '0 0 8px', lineHeight: 1.35 }}>
                {s.titel}
              </h3>
              <p style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.65, margin: 0 }}>{s.uitleg}</p>
            </section>
          ))}
        </div>

        {/* ── [CARD-RECON] De pinomzet ─────────────────────────────
            Waarom deze sectie bestaat: MARKTPOSITIE_2026.md §1 stelt vast dat wat dit product
            werkelijk onderscheidt "op geen enkele featurelijst staat — ook niet op die van
            hemzelf". Dit IS die lijst, en dit is precies de lezer die het aangaat: een kantoor
            met horeca- of winkelklanten.

            Onder de regel bovenaan dit bestand — alleen wat er is. De motor is
            src/lib/card-reconcile.ts (Leg A en Leg B, met tests), de bedrading staat in
            docs/RECONCILIATION_TRIANGLE.md. Wat daar onder "nog open" valt, staat hier niet, en
            er staat nergens dat het al bij honderd kantoren draait. */}
        <section style={{ ...card, marginBottom: 32 }}>
          <h2 style={h2}>Voor klanten die veel pinnen</h2>
          <p style={body}>
            De kassa boekt de pinomzet <strong>bruto</strong>. De acquirer betaalt{' '}
            <strong>netto</strong> uit — een dag later, met het weekend samengevoegd. Wie die twee
            rechtstreeks vergelijkt, moet het verschil in een marge laten vallen, en dat verschil
            zijn de transactiekosten. Die verdwijnen dan uit de kosten: de winst staat te hoog en
            de btw erover wordt niet teruggevraagd.
          </p>
          <p style={body}>
            BoekBrug zet de afrekening van de betaalterminal ertussen en maakt er twee exacte
            vergelijkingen van. <strong>Kassa tegen terminal</strong>: allebei bruto, dus een
            verschil is een echt verschil — een ontbrekende bon of een terminal die niet klopt,
            geen afrondingsruis. En <strong>terminal tegen bank</strong>: dat verschil ís de
            transactiekostenpost, en die wordt als kosten geboekt in plaats van weggestreept.
          </p>
          <p style={{ ...body, margin: 0 }}>
            Is de bankuitbetaling er nog niet, dan zegt het scherm dat de pinomzet klopt en dat de
            uitbetaling nog niet gekoppeld is. Er wordt geen bedrag ingevuld dat niemand heeft
            gezien.
          </p>
        </section>

        {/* ── De grens ────────────────────────────────────────────
            This is the section an office reads twice. It is also the one that is hardest to
            claim and easiest to verify, so it is stated plainly and without adjectives. */}
        <section style={{ ...card, marginBottom: 32, borderColor: '#1a73e8' }}>
          <h2 style={h2}>Zien is iets anders dan handelen</h2>
          <p style={body}>
            Een <strong>koppeling</strong> laat je de administratie van een klant inzien. Een{' '}
            <strong>machtiging</strong> laat je erin handelen — factureren in zijn naam, zijn
            klanten mailen, zijn inkoopfacturen vastleggen. Dat zijn twee aparte toestemmingen, en
            de klant geeft ze los van elkaar.
          </p>
          <p style={{ ...body, margin: 0 }}>
            Het verschil staat niet alleen in de tekst: de schermen die handelen weigeren zonder
            machtiging, en de klant kan beide op elk moment intrekken. Een kantoor dat
            verantwoordelijk is voor andermans administratie hoort dat te kunnen aanwijzen in
            plaats van te moeten geloven.
          </p>
        </section>

        {/* ── Prijs ──────────────────────────────────────────────── */}
        <section style={{ ...card, marginBottom: 32 }}>
          <h2 style={h2}>Wat het kost</h2>
          <p style={body}>
            Het portaal is gratis tot en met {ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten. Die
            grens staat vast: een account dat vandaag bestaat, houdt de grens die het had — die
            wordt later niet verlaagd.
          </p>

          <div style={{ overflowX: 'auto', margin: '0 0 16px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 380, fontSize: 15 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start', padding: '10px 12px', borderBottom: '2px solid #e0e0e0', color: '#5f6368', fontWeight: 600 }}>
                    Gekoppelde klanten
                  </th>
                  <th style={{ textAlign: 'start', padding: '10px 12px', borderBottom: '2px solid #e0e0e0', color: '#5f6368', fontWeight: 600 }}>
                    Per kantoor per maand
                  </th>
                </tr>
              </thead>
              <tbody>
                {ACCOUNTANT_BANDS.map((band, i) => {
                  const vanaf = i === 0 ? 1 : (ACCOUNTANT_BANDS[i - 1]!.upTo ?? 0) + 1
                  const bereik =
                    band.upTo === null
                      ? `${vanaf} of meer`
                      : vanaf === 1
                        ? `tot en met ${band.upTo}`
                        : `${vanaf} – ${band.upTo}`
                  return (
                    <tr key={bereik}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f3f4', color: '#202124' }}>
                        {bereik}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f1f3f4', color: '#202124', fontVariantNumeric: 'tabular-nums' }}>
                        {band.monthlyExclBtw === 0 ? (
                          <strong>Gratis</strong>
                        ) : (
                          <>
                            <strong>{euro(band.monthlyExclBtw)}</strong> excl. btw{' '}
                            <span style={{ color: '#80868b' }}>
                              ({euro(inclBtw(band.monthlyExclBtw))} incl.)
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* The single most important paragraph on the page for a professional reader: the
              prices are published as a guess, and saying so is what makes the rest credible. */}
          {!ACCOUNTANT_PRICING_ACTIVE && (
            <div style={{ background: '#f1f3f4', border: '1px solid #e0e0e0', borderRadius: 12, padding: '14px 16px' }}>
              <p style={{ fontSize: 15, color: '#202124', lineHeight: 1.65, margin: '0 0 8px', fontWeight: 600 }}>
                Deze tarieven zijn nog niet actief. Op dit moment betaalt geen enkel kantoor iets,
                ook niet boven {ACCOUNTANT_FREE_CLIENTS} klanten.
              </p>
              <p style={{ fontSize: 14, color: '#5f6368', lineHeight: 1.65, margin: 0 }}>
                Ze staan er zodat je kunt zien wat eraan komt in plaats van het later te horen. Ze
                zijn afgeleid van wat vergelijkbare pakketten rekenen — er is nog met geen enkel
                administratiekantoor over gesproken, en dat verandert ze waarschijnlijk. Voordat er
                iets in rekening wordt gebracht krijg je minstens 30 dagen van tevoren bericht, en
                nooit met terugwerkende kracht. Dat staat zo in de{' '}
                <Link href="/voorwaarden" style={{ color: '#1a73e8' }}>voorwaarden</Link>.
              </p>
            </div>
          )}
        </section>

        {/* ── Wat het niet doet ──────────────────────────────────── */}
        <section style={{ ...card, marginBottom: 32 }}>
          <h2 style={h2}>Wat BoekBrug niet doet</h2>
          <p style={body}>
            De dingen waar je waarschijnlijk naar zou vragen. Beter hier dan halverwege een
            demo.
          </p>
          <dl style={{ margin: 0 }}>
            {NIET.map((n) => (
              <div key={n.vraag} style={{ borderTop: '1px solid #f1f3f4', paddingTop: 14, marginTop: 14 }}>
                <dt style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{n.vraag}</dt>
                <dd style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.65, margin: 0 }}>{n.antwoord}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── [WERK-GEDAAN-DEUR] "En wat levert het mij op?" ───────────────────────── */}
        {/* De vraag die elk kantoor stelt zodra het snapt wat het product doet, en waar deze
            pagina geen antwoord op gaf. Het antwoord bestond wél — /api/work-done telt sinds
            [WERK-GEDAAN] precies deze zes dingen per klant en per kantoor over een zelfgekozen
            periode — maar het stond ACHTER de inlog, en dus onzichtbaar voor precies de
            boekhouder die nog moet beslissen of hij binnenkomt.

            De zinnen hieronder zijn woord voor woord die uit work-done.ts. Dat is geen netheid:
            een kantoor dat hier "facturen uit de e-mail gehaald" leest en straks in de app iets
            anders ziet staan, gaat terecht twijfelen aan het getal ernaast. */}
        <section style={{ ...card, marginBottom: 32 }}>
          <h2 style={h2}>En wat levert het jou op?</h2>
          {OFFICE_GETS.map((voordeel) => (
            <div key={voordeel.heading} style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: '0 0 4px' }}>
                {voordeel.heading}
              </h3>
              <p style={{ ...body, marginTop: 0 }}>{voordeel.body}</p>
            </div>
          ))}
          <p style={{ ...body, marginTop: 18 }}>
            De zes handelingen die geteld worden, over een periode die jij kiest:
          </p>
          <ul style={{ margin: '14px 0 0', paddingInlineStart: 20, fontSize: 15, lineHeight: 1.9, color: '#3c4043' }}>
            <li>facturen uit de e-mail gehaald</li>
            <li>facturen gecontroleerd en geboekt zonder tik</li>
            <li>bankregels ingedeeld op eerdere antwoorden</li>
            <li>bankregels aan de juiste factuur gekoppeld</li>
            <li>kassadagen ingelezen uit een Z-rapport</li>
            <li>dubbele documenten tegengehouden</li>
          </ul>
          <p style={{ ...body, marginTop: 14 }}>
            <strong>Wat wij er níét bij zetten, is wat het waard was.</strong> Wij weten niet wat
            een minuut op jouw kantoor kost, en een verzonnen urenbesparing is een getal dat je in
            een middag onderuit haalt — het eerste cijfer van ons dat niet klopt, is het laatste dat
            je van ons gelooft. Vul je eigen minuten per handeling in en de rekensom is van jou, en
            zichtbaar: jouw minuten × ons aantal.
          </p>

          {/* ── [PROVISIE-REKENSOM] "En een provisie per klant dan?" ──────────────────
              "Nee" op zichzelf leest als "nog niet", dus staat het antwoord er als som. Beide
              bedragen komen uit accountant-pricing.ts, zodat de pagina niet kan blijven staan op
              een tarief dat allang veranderd is — en de provisie is met opzet ruim gerekend: alsof
              élke klant Plus betaalt, terwijl Plus pas geldt boven het eerlijk gebruik. */}
          <div style={{ marginTop: 20, borderTop: '1px solid #f1f3f4', paddingTop: 18 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: '0 0 4px' }}>
              {OFFICE_NEVER_GETS.heading}
            </h3>
            <p style={{ ...body, marginTop: 0 }}>{OFFICE_NEVER_GETS.body}</p>
            <ul style={{ margin: '10px 0 0', paddingInlineStart: 20, fontSize: 14, lineHeight: 1.8, color: '#5f6368' }}>
              {REJECTED_MODELS.map((afgewezen) => (
                <li key={afgewezen.model}>
                  <strong style={{ fontWeight: 600, color: '#3c4043' }}>{afgewezen.model}</strong> —{' '}
                  {afgewezen.reason}
                </li>
              ))}
            </ul>
          </div>

          {paidBand && paidBandClients > 0 && (
            <div style={{ marginTop: 20, borderTop: '1px solid #f1f3f4', paddingTop: 18 }}>
              <p style={{ ...body, marginTop: 0 }}>
                En de som erachter, met onze eigen bedragen, bij {paidBandClients} klanten:
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', margin: '12px 0 0', fontSize: 15 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 0', color: '#5f6368' }}>
                      {Math.round(REFERRAL_RATE_HYPOTHESIS * 100)}% provisie, als ze állemaal Plus
                      betalen
                    </td>
                    <td style={{ padding: '8px 0', textAlign: 'end', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {euro(referralCeilingExclBtw(paidBandClients))} p/m
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', color: '#5f6368', borderTop: '1px solid #f1f3f4' }}>
                      {ACCOUNTANT_PRICING_ACTIVE
                        ? 'Wat het portaal je kost'
                        : 'Wat je nu niet betaalt voor het portaal'}
                    </td>
                    <td style={{ padding: '8px 0', textAlign: 'end', fontWeight: 600, whiteSpace: 'nowrap', borderTop: '1px solid #f1f3f4' }}>
                      {euro(paidBand.monthlyExclBtw)} p/m
                    </td>
                  </tr>
                </tbody>
              </table>
              <p style={{ ...body, marginTop: 12 }}>
                Bedragen excl. btw. De bovenste regel is een <em>plafond</em>: de meeste klanten
                betalen niets, want Plus geldt pas boven het eerlijk gebruik.{' '}
                {ACCOUNTANT_PRICING_ACTIVE
                  ? 'De bovenste regel betalen wij uit de onderste — dat is geld rondpompen, en jij houdt het verschil niet over.'
                  : 'Om je de bovenste regel te kunnen betalen, zouden we de onderste bij je in rekening moeten brengen. Dat is geen verdienmodel, dat is geld rondpompen.'}
              </p>
            </div>
          )}
        </section>

        {/* ── [DPA-BEREIKBAAR] De vraag die elk kantoor als eerste stelt ──────────── */}
        {/* Vijf accountants, dezelfde vraag: mag ik de administratie van mijn klanten hierin
            zetten? Dat is geen gevoelsvraag maar een juridische: het kantoor is
            verwerkingsverantwoordelijke, wij zijn verwerker, en zonder verwerkersovereenkomst
            mag die data hier niet eens naartoe. Die overeenkomst was geschreven en stond in de
            repository — nergens waar een boekhouder hem kon lezen. Nu staat hij er, en deze
            sectie zegt in vier regels wat erin staat. */}
        <section style={{ ...card, marginBottom: 32 }}>
          <h2 style={h2}>Mag je de administratie van je klanten hierin zetten?</h2>
          <p style={body}>
            Ja, en dat is een juridische vraag met een juridisch antwoord. Jouw kantoor is
            verwerkingsverantwoordelijke, BoekBrug is verwerker. De verwerkersovereenkomst (AVG
            art. 28) staat online, is compleet en hoeft alleen nog door beide partijen te worden
            ingevuld en ondertekend.
          </p>
          <dl style={{ margin: 0 }}>
            {[
              {
                vraag: 'Wie raakt de gegevens aan?',
                antwoord:
                  'Negen subverwerkers, allemaal met naam, doel, vestigingsland en grondslag in de overeenkomst. De bankkoppeling (Enable Banking, Finland) en Mollie verwerken in de EU; hosting, opslag, AI en e-mail lopen onder Standard Contractual Clauses. Een nieuwe koppeling die niet in die lijst staat, komt niet door onze build.',
              },
              {
                vraag: 'Wat ziet BoekBrug zelf?',
                antwoord:
                  'De database staat onder Row-Level Security: elke rij hangt aan een eigenaar, en een koppeling met jouw kantoor is een aparte, door de klant gegeven toestemming. Toegang tot productiedata is beperkt tot kritieke onderhoudssituaties. Elke handeling die jij namens een klant doet, komt met jouw naam in zijn logboek — dat hij zelf kan inzien.',
              },
              {
                vraag: 'En als er iets misgaat?',
                antwoord:
                  'Melding aan jou zonder onnodige vertraging, volledige informatie binnen 72 uur, en de melding aan de Autoriteit Persoonsgegevens doen wij. Je hebt auditrecht op onze maatregelen. Het staat allemaal in artikel 9 en 10.',
              },
              {
                vraag: 'Wat is er nog niet klaar?',
                antwoord:
                  'Onze eigen partijgegevens — bedrijfsnaam, KVK en adres — staan nog als "(volgt)" in de overeenkomst omdat de inschrijving loopt. Ze vullen zichzelf zodra dat rond is. Tot die tijd kun je de tekst wel volledig lezen en beoordelen, en dat is precies waarvoor hij er staat.',
              },
            ].map((n) => (
              <div key={n.vraag} style={{ borderTop: '1px solid #f1f3f4', paddingTop: 14, marginTop: 14 }}>
                <dt style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{n.vraag}</dt>
                <dd style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.65, margin: 0 }}>{n.antwoord}</dd>
              </div>
            ))}
          </dl>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
            <Link href="/verwerkersovereenkomst" style={btnPrimary}>Verwerkersovereenkomst lezen</Link>
            <Link href="/privacy" style={btnGhost}>Privacyverklaring</Link>
          </div>
        </section>

        {/* ── Slot ───────────────────────────────────────────────── */}
        <section style={{ ...card, textAlign: 'center' }}>
          <h2 style={{ ...h2, marginBottom: 10 }}>Begin met één klant</h2>
          <p style={{ ...body, margin: '0 auto 20px' }}>
            Maak een kantooraccount aan en nodig één klant uit — of laat een klant die BoekBrug al
            gebruikt jou koppelen. Eén administratie is genoeg om te zien of dit je iets scheelt.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/register?rol=accountant" style={btnPrimary}>
              Kantooraccount aanmaken
            </Link>
            <Link href="/prijzen" style={btnGhost}>
              Wat het je klant kost
            </Link>
          </div>
        </section>

      </main>

      <PublicFooter />
    </div>
  )
}
