// src/lib/cron-heartbeat.ts
// [CRON-HARTSLAG] Leeft de machine nog? De pure helft staat hier en is getest;
// het wegschrijven is één best-effort functie eronder.
// Run: npx tsx --test src/lib/cron-heartbeat.test.ts
//
// Zes crons draaien onbewaakt. Valt er één stil — een ontbrekende CRON_SECRET, een deploy die
// vercel.json niet meenam, een plan-limiet, een 500 die blijft terugkomen — dan merkt niemand
// het: geen scherm, geen uitblijvende mail die iemand mist, geen getal dat verandert.
//
// Bij quarter-close is dat het ergst én het traagst zichtbaar: hij draait VIER KEER PER JAAR.
// Een stil kapotte quarter-close ontdek je een jaar later, met de vraag "waarom heeft mijn
// boekhouder nooit iets ontvangen?" — precies de belofte van dit product.

/** De crons uit vercel.json, met hun bedoelde ritme in uren. */
export const CRON_JOBS = {
  "email-sync": 2,
  reconcile: 1,
  // [ONTVANGEN-DRAIN] De hersteldoorloop van receive-first, elk kwartier. De directe kick na een
  // upload doet het gewone geval; deze maakt de belofte waar als die kick nooit begon. Eén uur is
  // de bovengrens die telt: /api/intake veegt elke claim van die eigenaar ouder dan een uur weg,
  // dus een drain die langer wegblijft dan dat laat een document achter waarvan de claim al is
  // opgeruimd. Vier passes per uur houdt daar ruime afstand van.
  //
  // Hij is met opzet VAAK STIL: zolang de vlag uit staat komt er niets in wacht_op_lezen terecht en
  // doet elke pass nul werk. Dat is de gezonde toestand, niet een storing — wat bewaakt wordt is
  // dat de pass zelf gebeurde, want valt hij om NA het aanzetten, dan blijft een document waarvan
  // de eigenaar "Ontvangen" hoorde geruisloos liggen.
  "intake-drain": 1,
  // [ENABLEBANKING] De bankfeed. Draait dagelijks omdat de bank maar een handvol opvragingen per
  // dag per rekening toestaat — vaker draaien levert niets op en zet de feed juist stil. Valt
  // hij om, dan komen er geen banktransacties meer binnen terwijl het scherm er normaal uitziet:
  // precies het stille falen waarvoor deze hartslag bestaat.
  "bank-sync": 24,
  reminders: 24,
  recurring: 24,
  "retention-purge": 168,
  // Vier keer per jaar. Deze ziet er dus bijna altijd "stil" uit — de oordeelfunctie hieronder
  // houdt daar rekening mee, anders zou hij permanent alarm slaan en daarmee waardeloos worden.
  "quarter-close": 2184,
  // [DEADLINE] De laatste week vóór de BTW-deadline, ook vier keer per jaar (de 24e van
  // jan/apr/jul/okt). Zelfde ritme en dus dezelfde stilte als quarter-close hierboven — en
  // dezelfde reden om hem te bewaken: valt hij om, dan is het gevolg een ondernemer die te laat
  // indient en dat pas merkt aan de boete, drie maanden nadat hij het had kunnen weten.
  "btw-deadline": 2184,
  // [DAGSTART] Het ochtendbericht aan de boekhouder. Dagelijks, en het is met opzet vaak STIL —
  // hij spreekt alleen over werk dat NIEUW is en over een deadline die een band is overgestoken.
  // Een run zonder berichten is dus de gezonde normaaltoestand, niet een storing; wat hier bewaakt
  // wordt is dat de run zelf gebeurde.
  "accountant-daily": 24,
  // [OCHTEND] De ochtendmail aan de ondernemer. Dagelijks en met opzet meestal STIL — hij spreekt
  // alleen over gisteren gebeurde feiten (binnengekomen betalingen, aangekomen inkomende
  // facturen), dus een run zonder mails is de gezonde normaaltoestand. Bewaakt wordt dat de run
  // zelf gebeurde: valt hij stil, dan verdwijnt het dagelijkse terugkeermoment geruisloos.
  ochtend: 24,
  // [BETAALHERINNERING] De herinnering aan wat de ondernemer ZELF moet betalen. Dagelijks, en met
  // opzet vaak stil: hij spreekt alleen over een vervaldatum die vandaag een grens oversteekt. Een
  // run zonder meldingen is dus de gezonde normaaltoestand — bewaakt wordt dat de run gebeurde,
  // want valt hij om, dan mist de eigenaar geen scherm maar een betaaltermijn.
  "payment-due": 24,
  // [MOLLIE-AFREKENING] Mollie's settlements: the fee as a cost, the payout line as a transfer.
  // Daily, after the bank feed. Silent for every owner without a new settlement.
  "mollie-settlements": 24,
} as const;

export type CronJob = keyof typeof CRON_JOBS;

export type CronHealth =
  | "ok"
  | "nog-niet-langs"
  | "nooit-gedraaid"
  | "afgebroken"
  | "gefaald"
  | "te-lang-stil";

export interface CronRunRow {
  job: string;
  started_at: string | null;
  ok: boolean | null;
}

/**
 * Het oordeel over één cron.
 *
 * `nowMs` wordt meegegeven — geen klok in een pure functie, en het maakt de test exact.
 *
 * De vier storingen zijn bewust NIET één 'kapot': ze vragen om verschillend handelen.
 *   nooit-gedraaid → de bedrading klopt niet (CRON_SECRET, vercel.json, plan-limiet)
 *   afgebroken     → hij begon en stierf halverwege (time-out, geheugen, crash)
 *   gefaald        → hij kwam tot het einde en gaf zelf aan dat het misging
 *   te-lang-stil   → hij liep ooit goed en is daarna niet meer langs geweest
 */
export function judgeCron(
  job: CronJob,
  run: CronRunRow | null,
  nowMs: number,
  /**
   * Sinds wanneer wordt er überhaupt vastgelegd — de vroegste rij in cron_runs.
   *
   * ZONDER DIT LIEGT DEZE FUNCTIE, en dat is precies wat er gebeurde. Elf minuten na het
   * toepassen van de migratie meldde de gezondheidscheck dat reminders, recurring,
   * retention-purge en quarter-close "NOOIT GEDRAAID" hadden, met CRON_SECRET als vermoedelijke
   * oorzaak — terwijl email-sync en reconcile op datzelfde moment mét diezelfde sleutel netjes
   * hadden gedraaid. De waarheid was veel saaier: reminders draait om 07:00 en recurring om
   * 06:00 (allebei al voorbij toen we begonnen te kijken), retention-purge op maandag, en
   * quarter-close op 5 oktober.
   *
   * Een cron van wie de beurt nog niet is langsgekomen sinds we meten, is niet stuk. Hem
   * "nooit gedraaid" noemen is een bewering die de data niet draagt — en erger, hij stuurt je
   * naar een variabele die aantoonbaar klopt. Een alarm dat afgaat zonder oorzaak leert mensen
   * alarmen te negeren.
   *
   * Ontbreekt deze waarde (geen enkele rij), dan valt hij terug op het oude gedrag.
   */
  watchingSinceMs?: number | null,
): CronHealth {
  if (!run || !run.started_at) {
    // Korter aan het kijken dan zijn eigen ritme? Dan weten we het simpelweg nog niet.
    if (typeof watchingSinceMs === "number" && Number.isFinite(watchingSinceMs)) {
      const gekekenMs = nowMs - watchingSinceMs;
      if (gekekenMs < CRON_JOBS[job] * 3_600_000) return "nog-niet-langs";
    }
    return "nooit-gedraaid";
  }
  if (run.ok === null) return "afgebroken";
  if (run.ok === false) return "gefaald";

  const startedMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedMs)) return "afgebroken";

  // Twee keer het bedoelde ritme: één gemiste slag is ruis (Vercel spreidt aanroepen binnen het
  // uur), twee gemiste slagen is een patroon.
  const marge = CRON_JOBS[job] * 2 * 3_600_000;
  return nowMs - startedMs > marge ? "te-lang-stil" : "ok";
}

/** Vraagt iets aandacht? Handig als één regel in een monitoringcheck. */
export function cronsNeedingAttention(
  runsByJob: Partial<Record<CronJob, CronRunRow | null>>,
  nowMs: number,
  watchingSinceMs?: number | null,
): Array<{ job: CronJob; health: CronHealth }> {
  const uit: Array<{ job: CronJob; health: CronHealth }> = [];
  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    const health = judgeCron(job, runsByJob[job] ?? null, nowMs, watchingSinceMs);
    // 'nog-niet-langs' is geen storing maar een lege waarneming — die hoort niet in een lijst
    // die om aandacht vraagt, anders staat er iets rood dat niemand kan oplossen.
    if (health !== "ok" && health !== "nog-niet-langs") uit.push({ job, health });
  }
  return uit;
}

/**
 * De Nederlandse uitleg bij een oordeel — en, belangrijker, wat het waarschijnlijk IS.
 *
 * ── WAAROM ER EEN TWEEDE ARGUMENT BIJ IS GEKOMEN ──
 *
 * Bij "nooit gedraaid" stond hier één vaste zin: de oorzaak is "vrijwel altijd dat CRON_SECRET niet
 * in de omgeving staat — dan antwoordt elke cron 401 en doet niets". Dat is een goede gok als álle
 * taken stilstaan, en aantoonbaar onjuist zodra er één stilstaat tussen tien die wél draaien.
 *
 * En zo stond het op het scherm: acht taken op "ok", met tijden van een paar uur geleden, en
 * daarnaast de bewering dat de sleutel waarmee die acht net waren binnengekomen ontbrak. Het
 * scherm sprak zichzelf tegen, en de zin stuurde de lezer naar omgevingsvariabelen die in orde
 * waren — een halfuur zoeken op precies de plek waar niets te vinden is, wat het tegendeel is van
 * wat deze functie belooft.
 *
 * `othersRan` is daarom geen extraatje maar het bewijs waar de zin op hoort te rusten: draaide er
 * in dezelfde periode een andere cron, dan zijn de sleutel én vercel.json bewezen in orde en ligt
 * het aan deze taak zelf. Niet meegegeven → de oude, algemene zin, want dan is er niets bekend.
 */
export function cronHealthNote(
  job: CronJob,
  health: CronHealth,
  /** Draaide er ÉÉN andere cron in dezelfde periode? Bewijs, geen sfeerbeeld. */
  othersRan?: boolean,
): string {
  switch (health) {
    case "ok":
      return `${job}: draait zoals bedoeld.`;
    case "nog-niet-langs":
      return `${job}: zijn beurt is nog niet langsgekomen sinds we begonnen met meten. Dat is geen storing — kom terug na zijn volgende geplande moment.`;
    case "nooit-gedraaid":
      // Andere crons draaiden wél → de sleutel en vercel.json zijn bewezen in orde, en de lezer
      // naar de omgeving sturen kost hem een halfuur op de verkeerde plek.
      return othersRan === true
        ? `${job}: heeft NOOIT gedraaid, terwijl andere taken in dezelfde periode wél zijn langsgekomen. CRON_SECRET en vercel.json zijn daarmee in orde — het ligt aan deze taak zelf. Kijk of hij vóór zijn hartslagregel al terugkeert (bijvoorbeeld omdat er niets is ingesteld om te doen), en of zijn pad in vercel.json klopt.`
        : `${job}: heeft NOOIT gedraaid, en geen enkele andere taak ook. Op dit project (Vercel Pro, waar crons per minuut mogen) is de oorzaak dan vrijwel altijd dat CRON_SECRET niet in de omgeving staat — dan antwoordt elke cron 401 en doet niets. Kijk anders of vercel.json wel is meegedeployd. (Op Hobby zou een cron vaker dan 1x per dag de deploy laten falen; hier speelt dat niet.)`;
    case "afgebroken":
      return `${job}: begonnen maar nooit afgerond — het proces is halverwege gestopt (time-out of crash). Wat hij tot dat punt had gedaan, staat wél in de database.`;
    case "gefaald":
      return `${job}: de laatste run meldde zelf dat het misging. De reden staat in cron_runs.error.`;
    case "te-lang-stil":
      return `${job}: liep ooit goed en is daarna meer dan twee slagen niet langs geweest.`;
  }
}

// ── Het wegschrijven ──────────────────────────────────────────────────────────────────────────

/**
 * Opent een run: schrijft de startregel met ok = NULL.
 *
 * WAAROM EEN APARTE STARTREGEL, EN NIET ALLEEN AAN HET EIND SCHRIJVEN
 * Een cron die halverwege sterft — een time-out van 300s, geheugen op, een harde crash — komt nooit
 * bij de eindregel. Wordt er alleen aan het eind geschreven, dan laat zo'n run GEEN spoor na en
 * ziet hij eruit als "nooit gedraaid" of, twee slagen later, als "te lang stil".
 *
 * Voor reconcile is dat twee uur vertraging. Voor quarter-close, die vier keer per jaar draait, is
 * de marge een half jaar — dus een vastgelopen kwartaalafsluiting zou pas het volgende seizoen
 * opvallen. Precies de storing die dit hele mechanisme moest vangen.
 *
 * Met een startregel blijft ok = NULL staan als de run sterft, en dat is de toestand 'afgebroken':
 * begonnen, nooit afgerond. Wat de cron tot dat punt had gedaan staat wél in de database, dus het
 * vraagt om iets anders dan een run die zelf 'mislukt' meldde.
 *
 * Retourneert het id van de startregel, of null als het schrijven niet lukte (dan slaat
 * finishCronRun over — best effort, de cron zelf mag hier nooit op vallen).
 */
export async function beginCronRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  job: CronJob,
  startedAt: string,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("cron_runs")
      .insert({ job, started_at: startedAt, ok: null })
      .select("id")
      .single();
    // 42P01 = de tabel bestaat nog niet. Normale toestand vóór de migratie, geen fout.
    if (error) {
      if (error.code !== "42P01") console.error("[CRON-HARTSLAG] startregel mislukt", { job, error });
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error("[CRON-HARTSLAG] startregel mislukt", { job, error: String(e) });
    return null;
  }
}

/**
 * Sluit de run af: zet ok, de uitkomst en het eindtijdstip op de startregel.
 *
 * BEST EFFORT, en dat is hier geen luiheid maar de juiste keuze: het bijhouden van de hartslag mag
 * nooit de cron zelf laten vallen. Het werk dat de cron deed is echt gedaan, ook als het opschrijven
 * niet lukte — dan blijft de regel op ok = NULL staan en meldt de gezondheidscheck 'afgebroken'.
 * Dat is een keer te veel kijken, nooit een gemiste storing.
 */
export async function finishCronRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  runId: string | null,
  outcome: { ok: boolean; result?: unknown; error?: string },
): Promise<void> {
  if (!runId) return;
  try {
    const { error } = await client
      .from("cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        ok: outcome.ok,
        result: outcome.result ?? null,
        error: outcome.error ? String(outcome.error).slice(0, 500) : null,
      })
      .eq("id", runId);
    if (error && error.code !== "42P01") {
      console.error("[CRON-HARTSLAG] afsluiten mislukt — regel blijft op 'afgebroken' staan", { runId, error });
    }
  } catch (e) {
    console.error("[CRON-HARTSLAG] afsluiten mislukt", { runId, error: String(e) });
  }
}

/**
 * [CRON-EENMAAL] Heeft deze cron vandaag (Amsterdamse dag) al een GESLAAGDE ronde gedraaid?
 *
 * ── WAAROM DIT BESTAAT ──
 * `beginCronRun`/`finishCronRun` is een HARTSLAG, geen slot. Hij schrijft op dát er gedraaid is;
 * hij houdt een tweede ronde nergens tegen. Voor het meeste werk hier is dat prima, want het is
 * convergerend: reconcile boekt wat nog niet geboekt is en vindt bij een tweede ronde niets meer,
 * en recurring en reminders worden door een unieke index in de database fysiek tegengehouden.
 *
 * Maar een MELDING is geen van beide. Er is geen unieke index op `notifications` (nagekeken: die
 * tabel heeft alleen haar primaire sleutel), en een tweede ronde stuurt hem gewoon nog een keer.
 * Twee crons rustten hun idempotentie daarom op een aanname over de PLANNER — hun eigen kop zegt
 * het met zoveel woorden: "runs exactly once per quarter IS its idempotency — no dedup state".
 * Dat is een eigenschap van Vercel, niet van deze code: een cron-platform levert 'at least once',
 * een functie die time-out krijgt wordt opnieuw geprobeerd, en de route is met het secret ook met
 * de hand aan te roepen. Dan krijgt een ondernemer dezelfde aangifteherinnering twee keer.
 *
 * ── DE FAALRICHTING ──
 * Best effort, en bewust naar ÉÉN VERZENDING TE VEEL: een onleesbare of ontbrekende cron_runs-tabel
 * blokkeert nooit het werk. Deze wacht is een hoffelijkheid bovenop een hoffelijkheid — hij mag
 * geen aangiftedeadline tegenhouden omdat een logtabel hikt.
 *
 * Eén implementatie, want vier kopieën van dezelfde vraag drijven uit elkaar en dan is er één cron
 * waar de tweede ronde wél doorheen komt.
 */
export async function alreadyRanToday(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  job: CronJob,
  /** Middernacht van de Amsterdamse dag, als UTC-instant (amsterdamMidnightUtc). */
  dayStartUtc: Date,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("cron_runs")
      .select("id")
      .eq("job", job)
      .eq("ok", true)
      .gte("started_at", dayStartUtc.toISOString())
      .limit(1);
    // Een leesfout is geen bewijs dat er niet gedraaid is — en fail-open is hier de juiste kant.
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
