// [FAIR-USE] Pure node test — run: npx tsx --test src/lib/fair-use-usage.test.ts
//
// Getest wordt wat zonder database te testen valt: de periodesleutel, de vertaling van plan
// naar grens, de meting uit nagebootste tabellen, en de faalrichting. De atomaire optelling
// zelf woont in fair_use_usage.sql en heeft daar een CONTROLE-blok.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COUNTED_METRICS,
  currentPeriod,
  exceededMessage,
  limitForPlan,
  measureUsage,
  consumeFairUseUpTo,
} from "./fair-use-usage";
import { FAIR_USE_LIMITS, evaluateFairUse, fairUseLimit } from "./fair-use";

test("de periodesleutel is de kalendermaand in UTC", () => {
  assert.equal(currentPeriod(new Date("2026-07-26T12:00:00.000Z")), "2026-07");
  assert.equal(currentPeriod(new Date("2026-01-01T00:00:00.000Z")), "2026-01");
  // De maandgrens hangt niet af van de tijdzone van de server: één minuut vóór middernacht
  // UTC op 31 december hoort nog bij december, ook als het ergens al januari is.
  assert.equal(currentPeriod(new Date("2026-12-31T23:59:59.000Z")), "2026-12");
  assert.equal(currentPeriod(new Date("2027-01-01T00:00:00.000Z")), "2027-01");
});

test("alleen wat per maand gebeurt wordt geteld; de rest wordt gemeten", () => {
  assert.deepEqual([...COUNTED_METRICS], ["aiDocuments", "invoicesSent"]);
  for (const key of COUNTED_METRICS) {
    assert.equal(fairUseLimit(key).perMonth, true);
  }
  // De gemeten metrieken staan bewust NIET in de teller — een geteld getal kan uit de pas
  // lopen met de werkelijkheid, een gemeten getal niet.
  for (const limit of FAIR_USE_LIMITS.filter((l) => !l.perMonth)) {
    assert.equal((COUNTED_METRICS as readonly string[]).includes(limit.key), false);
  }
});

test("alleen het gratis plan krijgt een harde grens mee", () => {
  assert.equal(limitForPlan("aiDocuments", "free"), fairUseLimit("aiDocuments").free);
  // 0 betekent in de database: tellen, maar niet begrenzen. Wie betaalt loopt niet
  // halverwege de maand tegen een muur.
  assert.equal(limitForPlan("aiDocuments", "plus"), 0);
  assert.equal(limitForPlan("aiDocuments", "boekhouder"), 0);
});

test("de melding bij overschrijding komt letterlijk uit de gepubliceerde tekst", () => {
  for (const limit of FAIR_USE_LIMITS) {
    assert.equal(exceededMessage(limit.key), limit.onExceed);
  }
});

// ── Meten ────────────────────────────────────────────────────────────────────

/** Minimale nabootsing van de Supabase-querybouwer die measureUsage gebruikt. */
function fakeClient(tables: {
  usage_counters?: Array<{ metric: string; count: number }>;
  documents?: Array<{ file_size: number | null }>;
  email_connections?: number;
  /** Tabellen die een fout gooien — om de faalrichting te testen. */
  broken?: string[];
}) {
  return {
    from(table: string) {
      if (tables.broken?.includes(table)) {
        throw new Error(`tabel ${table} bestaat niet`);
      }
      // [VOL-GELEZEN] De documents-lezing loopt door fetchAllRows, dus de nabootsing moet ECHT
      // pagineren: .order().range(from, to) geeft een venster terug, en een korte pagina betekent
      // "dit was de laatste". Een stub die altijd alles teruggeeft, hoe je hem ook aanroept, zou
      // groen blijven terwijl de echte query weer bij duizend rijen stopt — dan test hij niets.
      const chain = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) =>
          opts?.head
            ? { eq: () => Promise.resolve({ count: tables.email_connections ?? 0 }) }
            : chain,
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        range: (from: number, to: number) =>
          Promise.resolve({ data: (tables.documents ?? []).slice(from, to + 1), error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: tables.usage_counters ?? [] }),
      };
      return chain;
    },
  };
}

test("de stand combineert getelde en gemeten metrieken", async () => {
  const usage = await measureUsage(
    fakeClient({
      usage_counters: [
        { metric: "aiDocuments", count: 37 },
        { metric: "invoicesSent", count: 8 },
        // Een metriek die niet geteld hoort te worden moet worden genegeerd, ook als hij
        // ooit per ongeluk in de tabel belandt.
        { metric: "storageMb", count: 999_999 },
      ],
      documents: [{ file_size: 1024 * 1024 * 3 }, { file_size: 1024 * 1024 * 2 }, { file_size: null }],
      email_connections: 1,
    }),
    "user-1",
    new Date("2026-07-26T00:00:00.000Z"),
  );

  assert.equal(usage.aiDocuments, 37);
  assert.equal(usage.invoicesSent, 8);
  assert.equal(usage.storageMb, 5, "gemeten uit documents, niet uit de teller");
  assert.equal(usage.mailboxes, 1);
  assert.equal(
    usage.administrations,
    undefined,
    "administraties worden niet gemeten zolang de functie niet bestaat",
  );

  // [PROEF-WERKPLEK] En die stand gaat door evaluateFairUse heen — maar NIET meer als "binnen de
  // grens". 37 gelezen documenten en 8 facturen was ruim binnen het oude gratis plan (50 en 100)
  // en ligt boven het nieuwe (10 en 5). Dat is geen regressie maar de beslissing zelf: gratis is
  // de proefwerkplek, niet de goedkope versie. Wat deze test bewaakt is dat de METING ongemoeid
  // blijft — die telt wat er gebeurd is en velt geen oordeel — en dat het oordeel erna klopt.
  const status = evaluateFairUse(usage);
  assert.equal(status.withinLimits, false, "37 gelezen documenten past niet in de proefwerkplek");
  assert.deepEqual(status.exceeded.sort(), ["aiDocuments", "invoicesSent"]);
  // Dezelfde stand op Plus: geen plafond, dus niets overschreden. Dat is het hele verschil tussen
  // de twee plannen, in één regel.
  assert.equal(evaluateFairUse(usage, "plus").withinLimits, true);
});

test("een onbereikbare tabel kost niemand een handeling", async () => {
  // Regel 2 en 3 uit fair-use.ts: onze storing mag nooit de gebruiker raken. Een ontbrekende
  // meting leest als 0 en dus nooit als overschrijding.
  const usage = await measureUsage(
    fakeClient({ broken: ["usage_counters", "documents", "email_connections"] }),
    "user-1",
  );
  assert.equal(usage.aiDocuments, undefined);
  assert.equal(usage.storageMb, undefined);
  assert.equal(usage.mailboxes, undefined);
  assert.equal(evaluateFairUse(usage).withinLimits, true);
});

test("[VOL-GELEZEN] voorbij duizend bestanden telt de opslag nog steeds alles", async () => {
  // DE BUG: measureUsage las documents met één plain select. PostgREST kapt elk antwoord stil af
  // op ~1000 rijen — geen fout, geen vlag — dus telde de som bij een eigenaar met meer bestanden
  // alleen de eerste duizend op. Te LAAG is de gevaarlijke kant: de grens wordt nooit bereikt, de
  // eigenaar hoort dat hij ruim zit, en de meter op zijn scherm bevestigt het.
  //
  // 2.500 bestanden van precies 1 MB. Ongepagineerd zou dit 1000 zeggen.
  const documents = Array.from({ length: 2500 }, () => ({ file_size: 1024 * 1024 }));
  const usage = await measureUsage(fakeClient({ documents }), "user-1", new Date("2026-07-26T00:00:00.000Z"));
  assert.equal(usage.storageMb, 2500, "de som stopte bij de eerste pagina");
});

test("[VOL-GELEZEN] een exact volle laatste pagina eindigt netjes", async () => {
  // De randgevallen van de pager: precies 1000 (één volle pagina, dan een lege) en precies 2000.
  // Een pager die op "korte pagina" stopt moet hier één extra ronde doen en niet blijven hangen.
  for (const n of [1000, 2000]) {
    const documents = Array.from({ length: n }, () => ({ file_size: 1024 * 1024 }));
    const usage = await measureUsage(fakeClient({ documents }), "u", new Date("2026-07-26T00:00:00.000Z"));
    assert.equal(usage.storageMb, n, `${n} bestanden telden niet volledig mee`);
  }
});

test("de prullenbak telt niet mee in de opslag", async () => {
  // Wie opruimt hoort dat meteen terug te zien; anders voelt opruimen zinloos. De filter
  // zit in de query (trashed is null of false), dus hier bewijzen we alleen dat wat de
  // query teruggeeft ook is wat er wordt opgeteld.
  const usage = await measureUsage(
    fakeClient({ documents: [{ file_size: 1024 * 1024 * 10 }] }),
    "user-1",
  );
  assert.equal(usage.storageMb, 10);
});

test("een lege administratie zit netjes binnen elke grens", async () => {
  const usage = await measureUsage(fakeClient({}), "nieuwe-gebruiker");
  assert.equal(usage.storageMb, 0);
  assert.equal(usage.mailboxes, 0);
  const status = evaluateFairUse(usage);
  assert.equal(status.withinLimits, true);
  assert.deepEqual(status.nearLimit, []);
});

// ── Tot zover reserveren ─────────────────────────────────────────────────────
//
// De sync krijgt veertig bijlagen binnen terwijl er nog drie binnen de maandgrens passen.
// Alles-of-niets zou die drie ook weigeren; de gepubliceerde belofte is het omgekeerde. Wat
// hieronder wordt vastgelegd is precies de fout die dit stuk rekenwerk kan maken: MEER
// toekennen dan er was. Elke test hier eindigt daarom op een getal, niet op een boolean.

/** Een nagebootste teller met een echte stand en een echte grens. */
function fakeCounter(opts: { used: number; limit: number; throws?: boolean }) {
  const calls: number[] = [];
  let used = opts.used;
  const consume = async (p: { amount?: number }) => {
    const amount = Math.max(1, p.amount ?? 1);
    calls.push(amount);
    if (opts.throws) {
      return { allowed: true, used: 0, remaining: -1, reason: "counter_unavailable" as const, period: "2026-08" };
    }
    if (opts.limit > 0 && used + amount > opts.limit) {
      // Precies wat fair_use_consume() doet bij een weigering: niets ophogen, en de ruimte
      // teruggeven die er nog wél was.
      return { allowed: false, used, remaining: Math.max(0, opts.limit - used), reason: "exceeded" as const, period: "2026-08" };
    }
    used += amount;
    return { allowed: true, used, remaining: opts.limit > 0 ? opts.limit - used : -1, reason: "within_limit" as const, period: "2026-08" };
  };
  return { consume, calls, usedNow: () => used };
}

test("past de hele batch, dan is er maar één aanroep nodig", async () => {
  const teller = fakeCounter({ used: 10, limit: 50 });
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "free", wanted: 40 },
    teller.consume,
  );
  assert.equal(r.granted, 40);
  assert.deepEqual(teller.calls, [40]);
  assert.equal(teller.usedNow(), 50);
});

test("past de batch niet, dan wordt precies de resterende ruimte gereserveerd", async () => {
  // 47 van de 50 op. Er passen er nog drie, en drie is het antwoord — niet nul en niet veertig.
  const teller = fakeCounter({ used: 47, limit: 50 });
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "free", wanted: 40 },
    teller.consume,
  );
  assert.equal(r.granted, 3);
  assert.deepEqual(teller.calls, [40, 3], "eerst de hele batch geprobeerd, daarna de ruimte");
  assert.equal(teller.usedNow(), 50, "de teller staat op de grens, nooit erboven");
});

test("zit de grens vol, dan is het antwoord nul en wordt er niets opgehoogd", async () => {
  const teller = fakeCounter({ used: 50, limit: 50 });
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "free", wanted: 12 },
    teller.consume,
  );
  assert.equal(r.granted, 0);
  assert.equal(r.reason, "exceeded");
  assert.equal(teller.usedNow(), 50);
  assert.deepEqual(teller.calls, [12], "geen tweede aanroep als er geen ruimte was");
});

test("wie betaalt loopt hier tegen niets aan", async () => {
  // limit 0 = tellen zonder begrenzen (limitForPlan voor plus en boekhouder).
  const teller = fakeCounter({ used: 4000, limit: 0 });
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "plus", wanted: 40 },
    teller.consume,
  );
  assert.equal(r.granted, 40);
  assert.equal(teller.usedNow(), 4040, "wel geteld");
});

test("een onbereikbare teller houdt niemands post tegen", async () => {
  const teller = fakeCounter({ used: 999, limit: 50, throws: true });
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "free", wanted: 40 },
    teller.consume,
  );
  assert.equal(r.granted, 40, "faalt OPEN — onze storing raakt de gebruiker niet");
  assert.equal(r.reason, "counter_unavailable");
});

test("niets willen kost geen enkele aanroep", async () => {
  // De gewone gang van zaken: de sync vindt geen nieuwe post. Dat mag geen query worden,
  // want deze cron draait voor elke gekoppelde mailbox de hele dag door.
  const teller = fakeCounter({ used: 0, limit: 50 });
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "free", wanted: 0 },
    teller.consume,
  );
  assert.equal(r.granted, 0);
  assert.deepEqual(teller.calls, []);
});

test("een verloren race geeft nul terug, nooit een niet-geboekte reservering", async () => {
  // Tussen de eerste weigering en de tweede poging is iemand anders erdoorheen gelopen, dus
  // ook de tweede poging wordt geweigerd. Dan is het antwoord nul: liever een document te
  // weinig lezen dan er een lezen dat niet op de teller staat.
  let n = 0;
  const consume = async () => {
    n += 1;
    return n === 1
      ? { allowed: false, used: 45, remaining: 5, reason: "exceeded" as const, period: "2026-08" }
      : { allowed: false, used: 50, remaining: 0, reason: "exceeded" as const, period: "2026-08" };
  };
  const r = await consumeFairUseUpTo(
    { userId: "u", metric: "aiDocuments", plan: "free", wanted: 40 },
    consume,
  );
  assert.equal(r.granted, 0);
  assert.equal(n, 2);
});
