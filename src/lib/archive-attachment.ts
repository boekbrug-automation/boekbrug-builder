// src/lib/archive-attachment.ts
// [ARCHIEF-OPEN] Een bijlage die zelf geen document is, maar er een paar bevat. Puur, geen I/O.
// Run: npx tsx --test src/lib/archive-attachment.test.ts
//
// ── WAT HIER GEMETEN IS, VOORDAT ER IETS GEBOUWD WERD ──
//
// De e-mailsync sloeg 410 bijlagen over. Dat getal las als "de PDF-regel gooit echte facturen
// weg", en dat was het niet. Uitgesplitst op productie:
//
//   126  not_invoice          — de lezer keek ernaar en zei nee (113 daarvan waren PDF)
//   ~68  rekeningoverzicht    — een overzicht van meerdere facturen, zelf geen factuur
//    40  .zip / .gz           — niet te openen
//    15  zelfde factuurnummer — de dubbelpoort deed zijn werk
//    10  logo / te klein      — terecht
//
// Eén categorie verliest een écht document, en dat zijn de archieven. En daarbinnen zit geen
// willekeur: 29 van de 40 heten `Jouw dagafsluiting - DDMMYY HHMM.zip` en komen ELKE DAG binnen,
// 28 losse dagen tussen 6 augustus en 2 september. De overige 11 zijn DMARC-rapporten
// (`...!boekbrug.nl!...xml.gz`) en horen inderdaad genegeerd te worden.
//
// ── WAAROM DIT MEER IS DAN EEN BIJLAGE ──
//
// Die dagafsluiting is de kassakant van de kaartomzet. Zonder hem heeft daily_turnover NUL dagen
// in Q1 en Q3, terwijl er in diezelfde kwartalen € 253.439 aan pos_income op de bank binnenkomt.
// financial-result.ts onderdrukt een kaartuitbetaling alleen tegen een dag die de kassa dekt; is
// die dag er niet, dan valt het bedrag door naar omzet ZONDER tarief — en dat is een `missing`
// op de klaar-kaart die het kwartaal blokkeert.
//
// De keten is dus: een .zip die we niet openen → geen kassadag → omzet zonder tarief → geen
// aangifte. Het duurste gevolg in dit hele pakket, veroorzaakt door één containerformaat.
//
// ── WAT DIT BESTAND WEL EN NIET DOET ──
//
// Het PAKT UIT en oordeelt verder niets. Wat eruit komt gaat door exact dezelfde poorten als een
// gewone bijlage: dezelfde lezer, dezelfde dubbelcontrole, dezelfde verificatierij. Een archief is
// hier een envelop, geen nieuwe opnameweg — anders zou een zip een manier worden om langs een
// controle te komen die op een losse bijlage wél staat.
//
// En het is wantrouwig, want een archief is invoer van buiten:
//   · een plafond op het AANTAL bestanden en op de UITGEPAKTE omvang (een zip-bom is klein op
//     schijf en oneindig daarna);
//   · geen archief in een archief — één laag, en dieper wordt geweigerd met een reden;
//   · alleen de extensies die de intake toch al leest; de rest wordt geweigerd MET reden, want
//     "stil overslaan" is precies wat deze 410 regels waren.

/** Eén bestand uit een archief. */
export interface ArchiveEntry {
  filename: string;
  bytes: number;
}

/** Wat er met een archief moet gebeuren. */
export type ArchiveVerdict =
  | { take: true }
  /**
   * `silent` marks the refusals that are archive chrome, not documents (a `__MACOSX/` shadow copy,
   * `.DS_Store`). They are refused like any other entry, but nobody is told: a panel line per
   * shadow file is exactly the noise that makes the owner stop reading the panel.
   */
  | { take: false; reason: string; silent?: boolean };

/**
 * [ARCHIEF-WAAR] The MIME the mail walkers give a zip they admit. The value is only a routing tag
 * inside the sync — nothing reads a zip as a document — so one fixed string is enough.
 */
export const ARCHIVE_MIME = "application/zip";

/**
 * [ARCHIEF-WAAR] The owner's way out, appended to every refusal that is about a real file. A
 * refusal that only says "no" leaves the owner with a file they know exists and nowhere to put it.
 */
const ZELF_UITPAKKEN = "pak het zelf uit en voeg de bestanden toe bij Uploaden";

/**
 * Plafonds. Ruim genoeg voor een dagafsluiting (één PDF van een paar honderd kB) en krap genoeg
 * dat een kwaadaardig archief niets kost.
 */
export const MAX_ENTRIES = 25;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/**
 * [ARCHIEF-WAAR] The same 10 MB a single mail attachment may be. An envelope may not be a way to
 * reach the reader with a file the mail door would have refused on its own.
 */
export const MAX_ENTRY_BYTES = 10 * 1024 * 1024;

/**
 * De extensies die de intake sowieso kan lezen. Alles daarbuiten heeft binnenin niets te zoeken.
 *
 * Dit is met opzet een LIJST en geen afleiding: het is een allowlist over invoer van buiten, en
 * daar is "alles wat niet expliciet mag, mag niet" de juiste vorm. Maar een handlijst veroudert,
 * en deze deed dat meteen — `xls`/`xlsx` ontbraken terwijl /api/intake ze wél leest
 * (handleSpreadsheet) en /api/documents/reprocess ze wél boekt. Een kassa die zijn Z-rapport als
 * xlsx in de zip zet, werd dus geweigerd bij de envelop, en de weigering las als "dit
 * bestandstype kunnen wij niet lezen" over een formaat dat de app prima leest.
 *
 * De gate [ARCHIEF-OPEN] eist daarom dat alles wat reprocess boekt hier langs kan komen. Voeg je
 * daar een formaat toe, dan wordt deze regel dezelfde minuut rood.
 */
const LEESBAAR = /\.(pdf|jpg|jpeg|png|heic|webp|xml|ubl|csv|txt|xls|xlsx)$/i;
/** Een archief in een archief. Eén laag is genoeg; dieper is bijna altijd geen boekhouding. */
const ARCHIEF = /\.(zip|gz|tar|rar|7z|bz2)$/i;
/** Rommel die elk zip-programma erin laat. */
const SYSTEEMROMMEL = /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/i;

/** Is dit bestand zelf een archief dat we mogen openen? */
export function isOpenableArchive(filename: string | null | undefined): boolean {
  return typeof filename === "string" && /\.zip$/i.test(filename.trim());
}

/**
 * Mag dit ene bestand uit het archief door naar de intake?
 *
 * Elke weigering draagt een reden in het Nederlands, want die reden komt op het scherm
 * "Overgeslagen bij import (en waarom)" terecht — zie skipped-import.ts. Een lege weigering is
 * hier precies de fout die dit hele bestand komt repareren.
 */
export function judgeEntry(entry: ArchiveEntry): ArchiveVerdict {
  const naam = entry.filename.trim();
  if (!naam) return { take: false, reason: "een bestand zonder naam in het archief" };
  if (SYSTEEMROMMEL.test(naam)) return { take: false, reason: "systeembestand uit het archief", silent: true };
  if (naam.endsWith("/")) return { take: false, reason: "een map, geen bestand", silent: true };
  if (ARCHIEF.test(naam)) {
    return { take: false, reason: `een archief in een archief pakken we niet uit — ${ZELF_UITPAKKEN}` };
  }
  if (!LEESBAAR.test(naam)) {
    return {
      take: false,
      reason: "dit bestandstype kunnen wij niet lezen — bewaar het als PDF of maak er een foto van en voeg die toe bij Uploaden",
    };
  }
  if (entry.bytes > MAX_ENTRY_BYTES) {
    return {
      take: false,
      reason: "te groot om automatisch te lezen (meer dan 10 MB) — splits de PDF of maak er een foto van en voeg die toe bij Uploaden",
    };
  }
  if (entry.bytes <= 0) return { take: false, reason: "leeg bestand — vraag de afzender het opnieuw te sturen" };
  return { take: true };
}

/** Het resultaat van één archief: wat eruit mag, en wat er is geweigerd en waarom. */
export interface ArchivePlan {
  take: ArchiveEntry[];
  skipped: Array<{ filename: string; reason: string; silent?: boolean }>;
  /** Gezet wanneer het HELE archief is geweigerd; dan is `take` altijd leeg. */
  refusedWhole?: string;
}

/**
 * Beslis wat er uit dit archief mag, zonder het uit te pakken.
 *
 * De volgorde is bewust: eerst de plafonds over het GEHEEL (een zip-bom herken je aan het geheel,
 * niet aan één regel), dan per bestand. Bij overschrijding gaat er niets door — half uitpakken zou
 * een administratie opleveren waarvan niemand weet welk deel er is.
 */
export function planArchive(entries: readonly ArchiveEntry[]): ArchivePlan {
  if (entries.length === 0) {
    return { take: [], skipped: [], refusedWhole: "het archief is leeg — vraag de afzender het opnieuw te sturen" };
  }
  if (entries.length > MAX_ENTRIES) {
    return {
      take: [], skipped: [],
      refusedWhole: `het archief bevat ${entries.length} bestanden (meer dan ${MAX_ENTRIES}), te veel om automatisch te verwerken — ${ZELF_UITPAKKEN}`,
    };
  }
  const totaal = entries.reduce((s, e) => s + Math.max(0, e.bytes), 0);
  if (totaal > MAX_TOTAL_BYTES) {
    return {
      take: [], skipped: [],
      refusedWhole: `het archief is uitgepakt groter dan 25 MB — ${ZELF_UITPAKKEN}`,
    };
  }

  const take: ArchiveEntry[] = [];
  const skipped: Array<{ filename: string; reason: string; silent?: boolean }> = [];
  for (const e of entries) {
    const oordeel = judgeEntry(e);
    if (oordeel.take) take.push(e);
    else skipped.push({ filename: e.filename, reason: oordeel.reason, ...(oordeel.silent ? { silent: true } : {}) });
  }
  return { take, skipped };
}

/** [ARCHIEF-WAAR] Shared with archive-expand.ts, so every refusal names the same way out. */
export const ARCHIVE_OWNER_ACTION = ZELF_UITPAKKEN;
