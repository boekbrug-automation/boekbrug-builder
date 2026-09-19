// [CRON-HARTSLAG] Pure node test — run: npx tsx --test src/lib/cron-heartbeat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { judgeCron, cronsNeedingAttention, cronHealthNote, CRON_JOBS, alreadyRanToday } from "./cron-heartbeat";

const NU = Date.parse("2026-07-30T12:00:00.000Z");
const gelede = (uur: number) => new Date(NU - uur * 3_600_000).toISOString();
const run = (uur: number, ok: boolean | null = true) => ({ job: "x", started_at: gelede(uur), ok });

test("elke cron uit vercel.json staat in het register, en andersom", () => {
  // [DAGSTART] Stond hier als een hardgecodeerde lijst van zeven namen. Dat vangt precies het
  // verkeerde: wie een cron TOEVOEGT aan vercel.json en het register vergeet, krijgt geen rood —
  // hij krijgt een cron die draait en die de hartslag niet kent, dus die stil kan sterven zonder
  // dat iets het merkt. Dat is de storing waar dit hele bestand voor bestaat.
  //
  // Afgeleid uit vercel.json is de vergelijking dus de bewaking, en niet een tweede lijst die
  // dezelfde fout kan maken als de eerste.
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string }[] };
  const uitVercel = vercel.crons
    .map((c) => c.path.replace(/^\/api\/cron\//, ""))
    .sort();
  assert.deepEqual(
    Object.keys(CRON_JOBS).sort(), uitVercel,
    "vercel.json en CRON_JOBS lopen uiteen — een cron die in maar één van de twee staat, draait " +
      "zonder bewaking of wordt bewaakt zonder te draaien",
  );

  assert.equal(CRON_JOBS["reconcile"], 1);
  assert.equal(CRON_JOBS["email-sync"], 2);
  // [ENABLEBANKING] Dagelijks: de bank staat maar een handvol opvragingen per dag per rekening toe.
  assert.equal(CRON_JOBS["bank-sync"], 24);
  // [DAGSTART] Het ochtendbericht aan de boekhouder — dagelijks, en met opzet vaak stil.
  assert.equal(CRON_JOBS["accountant-daily"], 24);
  // [OCHTEND] De ochtendmail aan de ondernemer — dagelijks, en meestal stil by design.
  assert.equal(CRON_JOBS["ochtend"], 24);
});

test("een verse geslaagde run is gewoon goed", () => {
  assert.equal(judgeCron("reconcile", run(0.5), NU), "ok");
  assert.equal(judgeCron("email-sync", run(1), NU), "ok");
  assert.equal(judgeCron("reminders", run(20), NU), "ok");
});

test("nooit gedraaid is een ANDERE storing dan gefaald", () => {
  // Dit is de storing die livegang stuk maakt: de bedrading klopt niet. Een ontbrekende
  // CRON_SECRET geeft 401 op élke cron, en op Hobby laat een te frequente cron de deploy falen.
  assert.equal(judgeCron("reconcile", null, NU), "nooit-gedraaid");
  assert.equal(judgeCron("reconcile", { job: "reconcile", started_at: null, ok: null }, NU), "nooit-gedraaid");
});

test("halverwege gestorven is óók een andere storing dan gefaald", () => {
  // ok = null betekent: begonnen, nooit afgerond. Time-out of crash. Wat hij tot dat punt deed
  // staat wél in de database — dat vraagt om iets anders dan een run die zelf 'mislukt' meldde.
  assert.equal(judgeCron("reconcile", run(0.2, null), NU), "afgebroken");
  assert.equal(judgeCron("reconcile", run(0.2, false), NU), "gefaald");
});

test("twee gemiste slagen is een patroon, één is ruis", () => {
  // Vercel spreidt aanroepen binnen het uur, dus één gemiste slag zegt niets.
  assert.equal(judgeCron("reconcile", run(1.9), NU), "ok", "1,9 uur bij een uurcron: nog binnen de marge");
  assert.equal(judgeCron("reconcile", run(2.1), NU), "te-lang-stil");
  assert.equal(judgeCron("email-sync", run(3.9), NU), "ok");
  assert.equal(judgeCron("email-sync", run(4.1), NU), "te-lang-stil");
});

test("quarter-close slaat geen alarm omdat hij vier keer per jaar draait", () => {
  // Zonder deze marge zou hij permanent rood staan en daarmee waardeloos worden — een alarm dat
  // altijd afgaat, leert mensen alarmen te negeren.
  assert.equal(judgeCron("quarter-close", run(24 * 60), NU), "ok", "twee maanden stil is normaal");
  assert.equal(judgeCron("quarter-close", run(24 * 200), NU), "te-lang-stil", "ruim een half jaar niet");
});

test("een onleesbare tijdstempel wordt niet stilzwijgend goedgekeurd", () => {
  assert.equal(judgeCron("reconcile", { job: "reconcile", started_at: "geen datum", ok: true }, NU), "afgebroken");
});

test("de lijst met aandacht bevat alleen wat niet in orde is", () => {
  const alles = cronsNeedingAttention(
    {
      "email-sync": run(1),
      reconcile: run(0.5),
      // [ONTVANGEN-DRAIN] Elk kwartier, dus een run van een kwartier oud is vers. Hij doet met
      // opzet vaak NUL werk — zolang de vlag uit staat komt er niets in wacht_op_lezen — en juist
      // daarom telt alleen dat de pass gebeurde.
      "intake-drain": run(0.25),
      // [ENABLEBANKING] De bankfeed hoort er ook bij. Ontbreekt hij hier, dan telt hij als
      // nooit-gedraaid — precies de kant waar deze functie bewust op faalt (zie hieronder).
      "bank-sync": run(2),
      reminders: run(2),
      recurring: run(2),
      "retention-purge": run(10),
      "quarter-close": run(24 * 30),
      // [DEADLINE] De laatste-week-herinnering vóór de BTW-deadline. Zelfde ritme als
      // quarter-close hierboven — vier keer per jaar — dus een run van een maand oud is voor deze
      // twee de gezonde toestand en niet een stilte om alarm over te slaan.
      "btw-deadline": run(24 * 30),
      // [DAGSTART] Het ochtendbericht aan de boekhouder. Dagelijks; een run van twee uur oud is
      // gewoon vers. Dat hij vaak GEEN bericht stuurt is geen storing — bewaakt wordt dat de run
      // zelf gebeurde, niet dat er iets uit kwam.
      "accountant-daily": run(2),
      // [OCHTEND] Zelfde vorm: dagelijks, vaak zonder mails, en dat is de gezonde toestand.
      ochtend: run(2),
      // [BETAALHERINNERING] De herinnering aan wat de ondernemer zelf moet betalen. Dagelijks, en
      // net als de twee hierboven meestal stil: hij spreekt alleen over een vervaldatum die vandaag
      // een grens oversteekt. Valt hij om, dan mist de eigenaar geen scherm maar een betaaltermijn.
      "payment-due": run(2),
      // [MOLLIE-AFREKENING] Dagelijks, na de bankfeed, en stil voor iedere eigenaar zonder nieuwe
      // afrekening — bewaakt wordt dat de run gebeurde.
      "mollie-settlements": run(2),
    },
    NU,
  );
  assert.deepEqual(alles, [], "een gezonde machine geeft een lege lijst");

  const kapot = cronsNeedingAttention({ reconcile: run(50), "email-sync": null }, NU);
  const jobs = kapot.map((k) => k.job).sort();
  // Alles wat ontbreekt telt als nooit-gedraaid — dat is de juiste kant om op te falen: liever
  // een keer te veel kijken dan een cron die stil ligt en niemand die het weet.
  assert.ok(jobs.includes("reconcile") && jobs.includes("email-sync"));
  assert.equal(kapot.find((k) => k.job === "reconcile")?.health, "te-lang-stil");
  assert.equal(kapot.find((k) => k.job === "email-sync")?.health, "nooit-gedraaid");
});

test("een run die nooit afsluit blijft 'afgebroken' — daarvoor bestaat de startregel", () => {
  // De crons schreven eerst ALLEEN bij succes. Een cron die halverwege sterft (time-out van 300s,
  // geheugen op, harde crash) kwam dan nooit bij die regel en liet dus GEEN spoor na: hij zag eruit
  // als "nooit gedraaid", of twee slagen later als "te lang stil".
  //
  // Voor reconcile is dat twee uur vertraging. Voor quarter-close, met een marge van een half jaar,
  // zou een vastgelopen kwartaalafsluiting pas het volgende seizoen opvallen — precies de storing
  // die dit mechanisme moest vangen. Nu opent beginCronRun een regel met ok = null, en blijft die
  // staan als de run sterft.
  const halverwegeGestorven = { job: "quarter-close", started_at: gelede(1), ok: null };
  assert.equal(judgeCron("quarter-close", halverwegeGestorven, NU), "afgebroken");
  // En hij wordt ONMIDDELLIJK gezien, niet pas na de marge.
  assert.notEqual(judgeCron("quarter-close", halverwegeGestorven, NU), "ok");
});

test("de write-only-bij-succes-vorm komt niet terug", () => {
  // Vangnet: zou iemand recordCronRun opnieuw invoeren, dan is de startregel overbodig geworden
  // en verdwijnt 'afgebroken' stilletjes weer uit de werkelijkheid.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./cron-heartbeat") as Record<string, unknown>;
  assert.ok(typeof mod.beginCronRun === "function", "de startregel hoort te bestaan");
  assert.ok(typeof mod.finishCronRun === "function");
  assert.equal(mod.recordCronRun, undefined, "één schrijfmoment is niet genoeg — zie de test hierboven");
});

test("een cron van wie de beurt nog niet is langsgekomen, is niet stuk", () => {
  // DIT WAS EEN ECHTE LEUGEN OP PRODUCTIE. Elf minuten na het toepassen van cron_runs meldde de
  // gezondheidscheck dat reminders (07:00), recurring (06:00), retention-purge (maandag) en
  // quarter-close (5 oktober) "NOOIT GEDRAAID" hadden — met CRON_SECRET als vermoedelijke oorzaak,
  // terwijl email-sync en reconcile op datzelfde moment mét diezelfde sleutel netjes hadden
  // gedraaid. De waarheid: hun beurt was gewoon nog niet langsgekomen sinds we begonnen te meten.
  const elfMinuten = NU - 11 * 60_000;
  assert.equal(judgeCron("reminders", null, NU, elfMinuten), "nog-niet-langs");
  assert.equal(judgeCron("quarter-close", null, NU, elfMinuten), "nog-niet-langs");
  assert.equal(judgeCron("retention-purge", null, NU, elfMinuten), "nog-niet-langs");

  // En het vraagt GEEN aandacht — anders staat er iets rood dat niemand kan oplossen.
  const aandacht = cronsNeedingAttention({}, NU, elfMinuten);
  assert.deepEqual(aandacht, [], "elf minuten meten levert geen enkele storing op");
});

test("maar na zijn ritme is 'niet langsgekomen' wél een storing", () => {
  // De grens is het ritme van de cron zelf. Kijk je langer dan dat en is hij nooit verschenen,
  // dan is er echt iets mis met de bedrading.
  const tweeDagen = NU - 48 * 3_600_000;
  assert.equal(judgeCron("reminders", null, NU, tweeDagen), "nooit-gedraaid", "dagelijks, twee dagen niets");
  assert.equal(judgeCron("reconcile", null, NU, tweeDagen), "nooit-gedraaid", "elk uur, twee dagen niets");
  // quarter-close draait elk kwartaal; twee dagen zegt daar nog steeds niets.
  assert.equal(judgeCron("quarter-close", null, NU, tweeDagen), "nog-niet-langs");

  const aandacht = cronsNeedingAttention({}, NU, tweeDagen).map((a) => a.job);
  assert.ok(aandacht.includes("reminders") && aandacht.includes("reconcile"));
  assert.ok(!aandacht.includes("quarter-close"), "die mag pas na een kwartaal iets zeggen");
});

test("zonder meetvenster blijft het oude gedrag staan", () => {
  // Is er nog geen enkele rij, dan is er ook geen venster — dan kan er niets anders worden gezegd.
  assert.equal(judgeCron("reminders", null, NU), "nooit-gedraaid");
  assert.equal(judgeCron("reminders", null, NU, null), "nooit-gedraaid");
});

test("de uitleg noemt de oorzaken die je een halfuur zoeken schelen", () => {
  const n = cronHealthNote("reconcile", "nooit-gedraaid");
  // Op Pro is CRON_SECRET vrijwel altijd de oorzaak; die hoort dus vooraan te staan.
  assert.ok(/CRON_SECRET/.test(n));
  assert.ok(n.indexOf("CRON_SECRET") < n.indexOf("Hobby"), "de relevante oorzaak eerst");
  assert.ok(/vercel\.json/.test(n));
  // En elk oordeel heeft een zin — geen enkele valt door de mand.
  for (const h of ["ok", "nooit-gedraaid", "afgebroken", "gefaald", "te-lang-stil"] as const) {
    assert.ok(cronHealthNote("reconcile", h).length > 10, `${h} heeft uitleg nodig`);
  }
});

// ── [CRON-EENMAAL] Het slot dat de hartslag NIET is ────────────────────────────────────────────
//
// De hartslag schrijft op dát er gedraaid is; hij houdt niets tegen. Voor een MELDING is dat het
// verschil tussen één en twee: `notifications` heeft geen unieke index, dus een tweede ronde
// stuurt hem gewoon nog een keer.

/** Een minimale nep-client die precies teruggeeft wat PostgREST zou teruggeven. */
function nepClient(antwoord: { data: unknown[] | null; error: { message: string } | null }) {
  const gezien: Record<string, unknown> = {};
  const ketting = {
    select: () => ketting,
    eq: (kolom: string, waarde: unknown) => { gezien[kolom] = waarde; return ketting; },
    gte: (kolom: string, waarde: unknown) => { gezien[kolom] = waarde; return ketting; },
    limit: () => Promise.resolve(antwoord),
  };
  return { client: { from: (t: string) => { gezien.table = t; return ketting; } }, gezien };
}

const DAG = new Date("2026-08-29T22:00:00.000Z"); // middernacht Amsterdam op 30 augustus

test("[CRON-EENMAAL] een geslaagde ronde van vandaag houdt de tweede tegen", async () => {
  const { client, gezien } = nepClient({ data: [{ id: "r1" }], error: null });
  assert.equal(await alreadyRanToday(client, "ochtend", DAG), true);
  // De vraag die gesteld wordt is: deze job, GESLAAGD, sinds middernacht.
  assert.equal(gezien.table, "cron_runs");
  assert.equal(gezien.job, "ochtend");
  assert.equal(gezien.ok, true, "een mislukte of afgebroken ronde telt niet als 'gedraaid'");
  assert.equal(gezien.started_at, DAG.toISOString());
});

test("[CRON-EENMAAL] geen ronde vandaag laat de cron gewoon draaien", async () => {
  const { client } = nepClient({ data: [], error: null });
  assert.equal(await alreadyRanToday(client, "quarter-close", DAG), false);
});

test("[CRON-EENMAAL] een leesfout is geen bewijs dat er al gedraaid is", async () => {
  // De faalrichting, en dit is de hele reden dat deze functie geen `throw` doet. Deze wacht is een
  // hoffelijkheid bovenop een hoffelijkheid: hij mag nooit een aangiftedeadline tegenhouden omdat
  // een logtabel hikt. Eén verzending te veel is de goedkope kant; een gemiste deadline niet.
  const { client } = nepClient({ data: null, error: { message: "timeout" } });
  assert.equal(await alreadyRanToday(client, "btw-deadline", DAG), false);
});

test("[CRON-EENMAAL] een ontbrekende tabel blokkeert de cron evenmin", async () => {
  // Vóór de handmatig toegepaste migratie bestaat cron_runs niet (42P01). Dat is een normale
  // toestand, geen storing — en zeker geen reden om de post niet te versturen.
  const { client } = nepClient({ data: null, error: { message: 'relation "cron_runs" does not exist' } });
  assert.equal(await alreadyRanToday(client, "payment-due", DAG), false);
});

test("[CRON-EENMAAL] een client die gooit laat de cron ook door", async () => {
  const kapot = { from: () => { throw new Error("verbinding weg"); } };
  assert.equal(await alreadyRanToday(kapot, "ochtend", DAG), false);
});

// ─── [HARTSLAG-BEWIJS] Een diagnose die het scherm zelf tegenspreekt ─────────────────────────────
//
// Het beheerscherm toonde acht taken op "ok", met tijden van een paar uur geleden, en daarnaast bij
// bank-sync: "de oorzaak is vrijwel altijd dat CRON_SECRET niet in de omgeving staat — dan
// antwoordt elke cron 401 en doet niets". Die acht waren net binnengekomen mét die sleutel. Het
// scherm sprak zichzelf tegen, en de zin stuurde de lezer een halfuur naar omgevingsvariabelen die
// in orde waren — het tegendeel van wat deze functie belooft te doen.

test("[HARTSLAG-BEWIJS] met andere draaiende taken wijst de uitleg NIET naar de omgeving", () => {
  const note = cronHealthNote("bank-sync", "nooit-gedraaid", true);
  // De sleutel NOEMEN is juist goed — je uitgesloten oorzaak benoemen is wat een diagnose doet.
  // Wat niet mag, is de lezer erheen sturen. (De eerste versie van deze test verbood het woord en
  // sloeg daarmee de zin af die precies het goede zei.)
  assert.match(note, /CRON_SECRET en vercel\.json zijn daarmee in orde/, "de uitgesloten oorzaak moet als uitgesloten worden benoemd");
  assert.match(note, /andere taken/, "het bewijs hoort in de zin te staan, niet alleen de conclusie");
  assert.match(note, /deze taak zelf/, "en de lezer moet weten waar hij dan WEL moet kijken");
});

test("[HARTSLAG-BEWIJS] staat alles stil, dan is de oude gok juist en blijft hij staan", () => {
  const note = cronHealthNote("bank-sync", "nooit-gedraaid", false);
  assert.match(note, /CRON_SECRET/, "als geen enkele taak draaide is de sleutel wél de waarschijnlijke oorzaak");
});

test("[HARTSLAG-BEWIJS] zonder bewijs blijft de algemene zin staan", () => {
  // Niets meegegeven = niets bekend. Dan mag de functie geen van beide beweren en houdt ze de
  // uitleg die het meest voorkomt — precies wat ze deed voordat het bewijs bestond.
  const note = cronHealthNote("bank-sync", "nooit-gedraaid");
  assert.match(note, /CRON_SECRET/);
});

test("[HARTSLAG-BEWIJS] elk oordeel houdt een uitleg, met of zonder bewijs", () => {
  for (const h of ["nooit-gedraaid", "afgebroken", "gefaald", "te-lang-stil", "nog-niet-langs", "ok"] as const) {
    for (const others of [true, false, undefined]) {
      assert.ok(cronHealthNote("reconcile", h, others).length > 10, `${h}/${String(others)} heeft uitleg nodig`);
    }
  }
});
