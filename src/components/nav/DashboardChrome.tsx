// src/components/nav/DashboardChrome.tsx
// [SUBNAV] Route-aware host for the shared sub-page header. Mounted ONCE in
// src/app/dashboard/layout.tsx, before {children}, so any dashboard page can
// inherit a consistent top bar without drawing its own.
//
// Title resolution, in priority order:
//   1. A dynamic config a page registered via useSubPageHeader() — used for
//      routes whose title/actions aren't a static path→label mapping
//      (/dashboard/invoice/[id] → "Factuur 263323", a client name, …).
//   2. STATIC_TITLES — exact path → fixed label, for pages already migrated onto
//      the shared bar. Added in the same change that removes a page's old chrome.
//   3. PATTERN_TITLES — a base label for a dynamic route TEMPLATE, so the bar
//      shows instantly (e.g. "Factuur") before the page's effect fills in the
//      concrete title. Prevents an empty-bar flash on first paint.
// If none match, render nothing (pages that keep their own full DashboardHeader —
// the two homes — or their own Drive header — bestanden).
//
// Exact-path matching for STATIC_TITLES avoids prefix collisions (e.g.
// "/dashboard/bank" vs its child "/dashboard/bank/categoriseren").

"use client";

import { usePathname } from "next/navigation";
import SubPageHeader from "./SubPageHeader";
import { useSubPageHeaderConfig } from "./SubPageHeaderContext";
import type { Role } from "@/lib/navigation";
// [KADER] The bar wraps EVERY screen, so its names are the one piece of Dutch an owner reading
// another language could never get away from. The map holds KEYS now; the words live in the
// catalogue and are looked up at render, in the owner's own language.
import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MessageKey } from "@/lib/i18n/messages";

// Exact route → fixed page title (static, migrated pages).
const STATIC_TITLES = new Map<string, MessageKey>([
  ["/dashboard/vandaag", "chrome.vandaag"],
  ["/dashboard/brug", "chrome.brug"],
  ["/dashboard/kas", "chrome.kas"],
  ["/dashboard/aangifte", "chrome.aangifte"],
  ["/dashboard/dagomzet", "chrome.dagomzet"],
  ["/dashboard/upload", "chrome.uploaden"],
  // [RESULT→WAARHEID] /dashboard/resultaat is a server redirect to /dashboard/waarheid, so this
  // chrome never renders for it — the title entry would be dead config. See that page's header.
  ["/dashboard/artikelen", "chrome.artikelen"],
  // [IB-JAAR] First-paint label; the page itself registers its translated title.
  ["/dashboard/jaar", "chrome.jaaroverzicht"],
  ["/dashboard/grootboek", "chrome.grootboek"],
  ["/dashboard/kluis", "chrome.kluis"],
  // [LOGBOEK] Plain Dutch, like every other entry in this map — this registry is not translated.
  // It is the FIRST-PAINT label only: a page that registers a title through useSubPageHeader wins
  // over this map (see the resolution order at the top of the file), so the log screen can present
  // t('log.titel') in the owner's own language without ever flashing a bar with no name on it.
  // Without an entry here at all the bar renders NOTHING — a real screen with no back button and
  // no heading, the failure already documented for settings/facturering below.
  ["/dashboard/logboek", "chrome.logboek"],
  // [BEVEILIGING] Same reasoning as the log entry above: without a line here the sub-page bar
  // renders nothing — a real screen with no name and no way back.
  ["/dashboard/beveiliging", "chrome.beveiliging"],
  // [BRUG-RETOUR] De vragen van de boekhouder aan de ondernemer.
  ["/dashboard/vragen", "chrome.vragen"],
  // [DEUR] Vier schermen die hier ontbraken, met precies het gevolg dat twee regels hierboven al
  // beschrijven: zonder entry rendert de balk NIETS. Boven 640px is er geen onderbalk, dus daar was
  // er geen weg terug — en de Kassa is voor een baliezaak het drukst bezochte scherm van de app.
  //
  // Ze wijzen naar hun EIGEN schermtitel, niet naar een nieuwe chrome.*-sleutel met hetzelfde woord
  // erin: die vier pagina's droegen die naam al in een <h1> boven hun uitleg, en dat kopje is in
  // dezelfde wijziging weggehaald — anders staat de naam er twee keer. Eén scherm, één sleutel, dus
  // ze kunnen niet uit elkaar gaan lopen.
  //
  // De ouderregel voor settings/team staat in navigation.ts (het is een instellingenkind); de
  // andere drie horen bij de home en krijgen die al via de veilige fallback.
  ["/dashboard/kassa", "kassa.titel"],
  ["/dashboard/voertuigen", "vtg.titel"],
  // [WERK] The trade's own work screen; its title is the generic word, the trade's noun is inside.
  ["/dashboard/werk", "werk.titel"],
  ["/dashboard/bedrijfsmiddelen", "bm.titel"],
  ["/dashboard/settings/team", "team.titel"],
  // [UREN-DEUR] Het urenscherm bestond, was vertaald en getest, en had geen enkele link naar zich
  // toe — en dus ook geen titel. Beide zijn hier gerepareerd: de tegel staat op de home (zie
  // ZzpDashboard) en de balk weet nu hoe dit scherm heet.
  ["/dashboard/uren", "uren.titel"],
  ["/dashboard/klaar", "chrome.klaar"],
  ["/dashboard/quarterly", "chrome.kwartaaloverzicht"],
  ["/dashboard/waarheid", "chrome.waarheid"],
  ["/dashboard/bank", "chrome.bank"],
  ["/dashboard/bank/categoriseren", "chrome.categoriseren"],
  ["/dashboard/settings", "chrome.instellingen"],
  // [NAV] Without this entry the bar rendered nothing here — see the parent rule
  // for facturering in src/lib/navigation.ts.
  ["/dashboard/settings/facturering", "chrome.facturering"],
  ["/dashboard/messages", "chrome.berichten"],
  ["/dashboard/werkplek", "chrome.werkplek"],
  // [UITNODIGING] /dashboard/clients/invite is nu een pure doorverwijzing naar beheer — een
  // titel voor een pagina die nooit rendert is dode configuratie.
  ["/dashboard/clients/beheer", "chrome.klantenBeheren"],
  // [ROLE-PARITY] /dashboard/accountant/werkplek now redirects to the home (its
  // tools live there as a tile grid), so it no longer needs a sub-page title.
  // The board registers its refresh button via useSubPageHeader; this is its title.
  ["/dashboard/accountant/agenda", "chrome.agenda"],
  // [PROEFDOSSIER] Het voorbeelddossier — de bewijsplek vóór de eerste klant.
  ["/dashboard/accountant/voorbeeld", "chrome.voorbeeld"],
  // [MANDAAT] Factureren namens een klant die daarvoor gemachtigd heeft.
  ["/dashboard/accountant/factuur", "chrome.factuurNamens"],
  // [DEBITEUREN] De chase-lijst over alle gemachtigde klanten heen.
  ["/dashboard/accountant/debiteuren", "chrome.openstaand"],
  // [OPVRAGEN] Eén bericht met precies wat er nog mist in een kwartaal.
  ["/dashboard/accountant/opvragen", "chrome.opvragen"],
  // [BEVESTIGEN] De stapel die het kwartaal van een klant tegenhoudt.
  ["/dashboard/accountant/bevestigen", "chrome.bevestigen"],
  // [KANTOORGIDS] De eigen vermelding in de gids die ondernemers zonder boekhouder te zien krijgen.
  ["/dashboard/accountant/gids", "chrome.kantoorgids"],
  // HAS-ACTIONS pages: the shared bar gives back + title; the page keeps its own
  // search/filter/sort controls as a secondary sticky toolbar offset below it.
  ["/dashboard/facturen", "chrome.mijnFacturen"],
  ["/dashboard/klanten", "chrome.mijnKlanten"],
  // [LEVERANCIER-SALDO] De crediteurenstand: wat er per leverancier nog openstaat, op een datum.
  ["/dashboard/leveranciers", "chrome.leveranciers"],
  ["/dashboard/incoming/manage", "chrome.inkoopfacturen"],
  ["/dashboard/incoming", "chrome.inkomend"],
  // Base label; the page overrides it via useSubPageHeader with the concrete
  // type (Nieuwe factuur / Nieuwe offerte / Creditnota) once mounted.
  ["/dashboard/invoice/new", "chrome.nieuweFactuur"],
]);

// Base label for a dynamic route TEMPLATE — shown until the page registers a
// concrete title via useSubPageHeader(). Ordered; first match wins. A template
// is added here in the same change that removes that page's bespoke bar, so the
// shared bar never stacks on an existing one.
const PATTERN_TITLES: ReadonlyArray<[RegExp, MessageKey]> = [
  // Invoice edit — page registers "Factuur bewerken · {number}". Listed before
  // the /invoice/[^/]+ pattern so the /edit child isn't swallowed by it.
  [/^\/dashboard\/invoice\/[^/]+\/edit$/, "chrome.factuurBewerken"],
  // Invoice detail — the page keeps its own context toolbar (number/badge/status/
  // actions/PDF) below the shared bar, so the shared title stays generic "Factuur".
  // Excludes /invoice/new (a distinct create page, migrated separately) so it
  // isn't matched here while it still renders its own bar.
  [/^\/dashboard\/invoice\/(?!new$)[^/]+$/, "chrome.factuur"],
  // ZZP client detail — the page registers the client name via useSubPageHeader.
  [/^\/dashboard\/klanten\/[^/]+$/, "chrome.klant"],
  // Conversation — the page registers the partner's name via useSubPageHeader;
  // this base label shows on first paint. The /dashboard/messages LIST is an exact
  // STATIC key ("Berichten"), resolved before patterns, so it is unaffected.
  [/^\/dashboard\/messages\/[^/]+$/, "chrome.gesprek"],
  // [DEUR] Een banktransactie over meerdere facturen verdelen. Dit scherm had geen titel, geen
  // ouderregel én geen eigen terugknop — geen BackLink, geen router.back(), niets: je kwam er via
  // een badge op een factuurregel en stond er vast. Op een geldscherm, midden in een handeling die
  // bepaalt welke factuur als betaald geldt. De ouderregel (→ /dashboard/bank) staat in
  // navigation.ts.
  [/^\/dashboard\/bank\/verdelen\/[^/]+$/, "verd.titel"],
  // Accountant client quarter — registers "Q{q} {year} — {client}" + sort action.
  // Listed before the client-detail pattern below (more specific path first).
  [/^\/dashboard\/clients\/[^/]+\/kwartaal$/, "chrome.kwartaal"],
  // Accountant client detail — registers client name + Ontkoppelen action.
  // NB: /dashboard/clients/beheer and /clients/invite are in STATIC_TITLES, which
  // is resolved BEFORE patterns, so this never overrides those fixed labels.
  [/^\/dashboard\/clients\/[^/]+$/, "chrome.klant"],
];

function patternTitle(pathname: string): MessageKey | undefined {
  for (const [re, key] of PATTERN_TITLES) {
    if (re.test(pathname)) return key;
  }
  return undefined;
}

export default function DashboardChrome({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const ctx = useSubPageHeaderConfig();
  // [KADER] Hooks run before any early return — a bar that renders nothing on this route must not
  // change how many hooks this component called, or React unmounts the whole tree on navigation.
  const locale = useLocale();
  const t = translator(locale);
  if (!pathname) return null;

  // A page that registered its own title already speaks the owner's language; the registry is the
  // first-paint fallback, and now it does too.
  const key = STATIC_TITLES.get(pathname) ?? patternTitle(pathname);
  const title = ctx?.title ?? (key ? t(key) : undefined);
  if (!title) return null;

  return <SubPageHeader title={title} role={role} actions={ctx?.actions} />;
}
