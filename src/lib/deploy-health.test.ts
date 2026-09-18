// [DEPLOY-HEALTH] Pure node test — run: npx tsx --test src/lib/deploy-health.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkEnv, envVerdict, missingEnv, ENV_CHECKS } from "./deploy-health";

const VOL: Record<string, string> = Object.fromEntries(
  ENV_CHECKS.map((c) => [c.key, "een-echte-waarde"]),
);
const zonder = (...keys: string[]) => {
  const e = { ...VOL };
  for (const k of keys) delete e[k];
  return e;
};

test("een complete omgeving is gezond", () => {
  const r = checkEnv(VOL);
  assert.equal(envVerdict(r), "gezond");
  assert.deepEqual(missingEnv(r), []);
});

test("een ontbrekende STILLE variabele is 'let-op', niet 'gezond'", () => {
  // DIT IS DE HELE REDEN VOOR DIT BESTAND. Zonder CRON_SECRET antwoorden alle zes crons 401 en
  // doen niets — geen scherm verandert, geen mail blijft uit die iemand mist. Een installatie in
  // die toestand ziet er volkomen gezond uit, en dat mag dit rapport niet bevestigen.
  const r = checkEnv(zonder("CRON_SECRET"));
  assert.equal(envVerdict(r), "let-op");
  assert.equal(missingEnv(r)[0].key, "CRON_SECRET");
  assert.ok(/401/.test(missingEnv(r)[0].gevolg), "het gevolg moet concreet zijn, niet 'ontbreekt'");
});

test("een ontbrekende BLOKKERENDE variabele weegt zwaarder dan een stille", () => {
  const r = checkEnv(zonder("SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"));
  assert.equal(envVerdict(r), "kapot");
  assert.equal(missingEnv(r)[0].severity, "blokkeert", "blokkerend eerst");
  assert.equal(missingEnv(r)[1].severity, "stil");
});

test("een optionele variabele maakt de installatie niet ziek", () => {
  const r = checkEnv(zonder("SNELSTART_SUBSCRIPTION_KEY", "STRIPE_SECRET_KEY"));
  assert.equal(envVerdict(r), "gezond");
  assert.equal(missingEnv(r).length, 2, "hij wordt wél gemeld, alleen niet als storing");
});

test("een half ingevulde omgeving telt niet als ingevuld", () => {
  // Precies wat er gebeurt als iemand .env.example kopieert en er niet doorheen gaat.
  for (const rommel of ["", "   ", "undefined", "null", "${SUPABASE_KEY}", "your-key-here", "TODO_vul_in"]) {
    const r = checkEnv({ ...VOL, CRON_SECRET: rommel });
    assert.equal(
      envVerdict(r),
      "let-op",
      `${JSON.stringify(rommel)} mag niet als ingevulde CRON_SECRET tellen`,
    );
  }
});

test("het rapport bevat NOOIT een waarde", () => {
  // Een gezondheidsrapport dat sleutels lekt is zelf het lek. Dit rapport is bedoeld om na een
  // deploy op te vragen, dus het moet veilig zijn om te bekijken en te delen.
  const geheim = "sk_live_dit_mag_nergens_verschijnen";
  const r = checkEnv({ ...VOL, STRIPE_SECRET_KEY: geheim, CRON_SECRET: geheim });
  const alles = JSON.stringify(r);
  assert.ok(!alles.includes(geheim), "geen waarde in het rapport");
  assert.ok(!alles.includes("dit_mag_nergens"), "ook geen fragment ervan");
  // Alleen de sleutelNAAM, de ernst, het gevolg en aanwezig true/false.
  for (const item of r) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["aanwezig", "gevolg", "key", "severity"],
      "geen extra velden waar een waarde in kan sluipen",
    );
  }
});

test("elke check legt uit wat er STUKGAAT, niet dat er iets ontbreekt", () => {
  for (const c of ENV_CHECKS) {
    assert.ok(c.gevolg.length > 25, `${c.key}: "ontbreekt" is geen uitleg`);
    assert.ok(!/^ontbreekt/i.test(c.gevolg), `${c.key}: zeg het gevolg, niet de toestand`);
  }
});

test("de duurste vergeten variabelen staan als 'stil' geclassificeerd", () => {
  // Niet als 'blokkeert': ze breken niets zichtbaars, en juist dat maakt ze duur.
  const byKey = Object.fromEntries(ENV_CHECKS.map((c) => [c.key, c]));
  assert.equal(byKey["CRON_SECRET"].severity, "stil");
  assert.equal(byKey["NEXT_PUBLIC_APP_URL"].severity, "stil");
});

test("het webhook-geheim alarmeert alleen als afrekenen AAN staat", () => {
  // De eerste echte meting meldde "iemand betaalt, de webhook wordt geweigerd" op een installatie
  // waar STRIPE_SECRET_KEY óók ontbrak — er kon dus niemand afrekenen, en er was geen betaling die
  // zoek kon raken. Een alarm dat afgaat zonder dat het ergens over kan gaan, leert mensen alarmen
  // te negeren; daarna missen ze het alarm dat er wél toe doet.
  const uit = checkEnv(zonder("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"));
  const wh = uit.find((r) => r.key === "STRIPE_WEBHOOK_SECRET")!;
  assert.equal(wh.severity, "optioneel", "afrekenen staat uit → geen stille storing");
  assert.equal(envVerdict(uit), "gezond");
  assert.ok(/nog in te stellen/.test(wh.gevolg), "en de tekst zegt wat het wél is");

  // Maar zodra afrekenen AAN staat, is het weer wat het was: geld binnen, toegang niet.
  const aan = checkEnv(zonder("STRIPE_WEBHOOK_SECRET"));
  const wh2 = aan.find((r) => r.key === "STRIPE_WEBHOOK_SECRET")!;
  assert.equal(wh2.severity, "stil");
  assert.equal(envVerdict(aan), "let-op");
  assert.ok(/Het geld is binnen/.test(wh2.gevolg));
});

// ── [EB-TESTER] De drie variabelen van de bankkoppeling ───────────────────────────────────────
//
// De uitrol heeft er drie: twee sleutels die zeggen DAT er een bankkoppeling is, en een lijst die
// zegt WIE erbij mag. De derde ontbrak in dit contract, en dat is precies het soort gat waar dit
// bestand voor bestaat — niet omdat er dan iets stuk gaat, maar omdat de STORING ONZICHTBAAR IS:
// met sleutels en zonder lijst weigert canUseEnableBanking() iedereen, en een afwezige bankkaart
// ziet er exact zo uit als een bankkaart die terecht verborgen is.

test("[EB-TESTER] alle drie afwezig: de bankkoppeling staat uit, en dat is geen alarm", () => {
  const r = checkEnv(zonder("ENABLEBANKING_APPLICATION_ID", "ENABLEBANKING_PRIVATE_KEY", "ENABLEBANKING_TESTERS"));
  assert.equal(
    envVerdict(r),
    "gezond",
    "een installatie zonder bankkoppeling mag geen let-op krijgen over een lijst die nergens voor dient",
  );
  const testers = r.find((x) => x.key === "ENABLEBANKING_TESTERS")!;
  assert.equal(testers.severity, "optioneel");
  assert.match(testers.gevolg, /zodra je de bankkoppeling aanzet/);
});

test("[EB-TESTER] sleutels aanwezig, lijst leeg: stil, dus let-op", () => {
  const r = checkEnv(zonder("ENABLEBANKING_TESTERS"));
  const testers = r.find((x) => x.key === "ENABLEBANKING_TESTERS")!;
  assert.equal(testers.severity, "stil", "met sleutels en zonder lijst ziet NIEMAND de bankkaart, ook de eigenaar niet");
  assert.equal(
    envVerdict(r),
    "let-op",
    "het rapport mag geen groen geven over een deur die voor iedereen dicht zit",
  );
  assert.ok(missingEnv(r).some((m) => m.key === "ENABLEBANKING_TESTERS"), "en hij moet bij naam genoemd worden");
});

test("[EB-TESTER] één sleutel is niet genoeg om de lijst stil te maken", () => {
  // Halverwege ingevuld: er kan nog niemand een bank bereiken, dus de lijst is nog niet aan de
  // beurt. Zou dit 'stil' zijn, dan gaat het alarm af tijdens het invullen zelf.
  for (const aanwezig of ["ENABLEBANKING_APPLICATION_ID", "ENABLEBANKING_PRIVATE_KEY"]) {
    const e = zonder("ENABLEBANKING_APPLICATION_ID", "ENABLEBANKING_PRIVATE_KEY", "ENABLEBANKING_TESTERS");
    e[aanwezig] = "een-echte-waarde";
    const testers = checkEnv(e).find((x) => x.key === "ENABLEBANKING_TESTERS")!;
    assert.equal(testers.severity, "optioneel", `met alleen ${aanwezig} is er nog geen deur die dichtblijft`);
  }
});

test("[EB-TESTER] alle drie aanwezig: de bedrading van de uitrol is compleet", () => {
  const r = checkEnv(VOL);
  const eb = r.filter((x) => x.key.startsWith("ENABLEBANKING_"));
  assert.equal(eb.length, 3, "de bankkoppeling heeft drie variabelen, niet twee");
  assert.deepEqual(
    eb.filter((x) => !x.aanwezig),
    [],
    "met alle drie aanwezig mag er niets over de bankkoppeling in het rapport staan",
  );
  assert.equal(envVerdict(r), "gezond");
});

test("[EB-TESTER] een placeholder-testerlijst telt niet als ingevuld", () => {
  // hasValue() is de enige plek waar 'ingevuld' wordt bepaald, en dat moet voor deze sleutel net
  // zo streng zijn als voor de andere — een lijst met `your-uuid-here` erin laat iedereen buiten
  // staan, precies zoals een lege lijst.
  for (const rommel of ["", "   ", "undefined", "null", "${ENABLEBANKING_TESTERS}", "your-uuid-here", "TODO_vul_in", "placeholder"]) {
    const e = { ...VOL, ENABLEBANKING_TESTERS: rommel };
    const testers = checkEnv(e).find((x) => x.key === "ENABLEBANKING_TESTERS")!;
    assert.equal(testers.aanwezig, false, `"${rommel}" mag niet als ingevulde testerlijst tellen`);
    assert.equal(envVerdict(checkEnv(e)), "let-op", `"${rommel}" moet hetzelfde let-op geven als een lege lijst`);
  }
});

test("[EB-TESTER] het rapport bevat geen enkele WAARDE, alleen of hij er is", () => {
  // Een gezondheidsrapport dat sleutels lekt is zelf het lek. Dit test de serialisatie zoals
  // /api/health hem opbouwt: elke variabele krijgt een herkenbare waarde, en geen ervan mag in de
  // JSON terugkomen — niet heel, niet ingekort.
  const geheim: Record<string, string> = Object.fromEntries(
    ENV_CHECKS.map((c, i) => [c.key, `GEHEIM-${i}-${c.key.toLowerCase()}-abcdef0123456789`]),
  );
  geheim["ENABLEBANKING_TESTERS"] = "ac22189e-7052-4c48-b4ec-90947cf92ecc,11111111-2222-3333-4444-555555555555";
  geheim["ENABLEBANKING_PRIVATE_KEY"] = "-----BEGIN PRIVATE KEY-----MIIEvQIBADAN-----END PRIVATE KEY-----";

  const r = checkEnv(geheim);
  const rapport = JSON.stringify({
    oordeel: envVerdict(r),
    mist: missingEnv(r).map((m) => ({ key: m.key, ernst: m.severity, gevolg: m.gevolg })),
    alles: r,
  });

  for (const [key, waarde] of Object.entries(geheim)) {
    assert.ok(!rapport.includes(waarde), `de waarde van ${key} staat in het rapport`);
    // Ook geen fragment: een "eerste acht tekens" is nog steeds een lek.
    assert.ok(!rapport.includes(waarde.slice(0, 8)), `een fragment van ${key} staat in het rapport`);
  }
  // Geen telling, geen "2 testers" — dat is ook informatie over de waarde.
  assert.ok(!/\btesters?\s*:\s*\d/i.test(rapport), "het rapport telt de testers");
  assert.ok(rapport.includes("ENABLEBANKING_TESTERS"), "de NAAM hoort er juist wel in te staan");
});
