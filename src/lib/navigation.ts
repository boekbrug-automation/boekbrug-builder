// src/lib/navigation.ts
// [NAVIGATION-CORE] Unified navigation parents — May 2026
// Every page has one declared parent. Change here, works everywhere.
//
// Two exports groups:
//   1. Pure functions  — usable in server + client components
//   2. React hooks     — 'use client' only (bottom of file, clearly marked)

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wie er kijkt, voor de navigatie.
 *
 * [MEDEWERKER] 'medewerker' is nieuw, en het is GEEN nieuwe rol in de database: een
 * verkoopmedewerker heeft profiles.role = 'zzper' en is gewoon een gebruiker die voor iemand
 * anders werkt (zie acting-for.ts). Dit type beschrijft alleen wat de NAVIGATIE moet weten, en dat
 * verschilt wél: zijn thuis is het verkoopbord, niet de home van de eigenaar — die werpt hem
 * terug. Zonder dit onderscheid wees elke terugknop op zijn schermen naar een deur die dichtslaat.
 */
export type Role = 'zzper' | 'accountant' | 'medewerker'

type ParentRule = {
  match: RegExp
  parent: (
    pathname: string,
    role: Role,
    search?: URLSearchParams | null
  ) => string
}

// ─────────────────────────────────────────────────────────────────────────────
// Home path — root per role
// ─────────────────────────────────────────────────────────────────────────────

export function getHomePath(role: Role): string {
  if (role === 'accountant') return '/dashboard/accountant'
  // [MEDEWERKER] Zijn enige eigen scherm. /dashboard bestaat voor hem niet: de middleware stuurt
  // hem daar weg (SALES_SCREENS), dus "home" mag daar nooit heen wijzen.
  if (role === 'medewerker') return '/dashboard/verkoop'
  return '/dashboard'
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent rules — declarative, evaluated top-to-bottom, first match wins
// ─────────────────────────────────────────────────────────────────────────────

const PARENT_RULES: ParentRule[] = [
  // ── dagomzet (turnover import) → dashboard home ───────────────────────────
  {
    match: /^\/dashboard\/dagomzet$/,
    parent: () => '/dashboard',
  },

  // ── concept BTW-aangifte → dashboard home ─────────────────────────────────
  {
    match: /^\/dashboard\/aangifte$/,
    parent: () => '/dashboard',
  },

  // ── invoice/[id]/edit → invoice/[id] ──────────────────────────────────────
  {
    match: /^\/dashboard\/invoice\/([^/]+)\/edit$/,
    parent: (pathname) => pathname.replace(/\/edit$/, ''),
  },

  // ── invoice/new → depends on the originating client + role ────────────────
  // Two distinct flows open this page pre-filled for a client, each with its
  // own param name and its own client tree — return the user to where they came
  // from in both cases:
  //   · accountant: ?clientId=  → /dashboard/clients/[id]  (accountant tree)
  //   · ZZP'er:     ?client_id= → /dashboard/klanten/[id]  (owner's own klanten)
  // Otherwise fall back to the role default. Every branch is an explicit
  // ancestor — never a loop.
  {
    match: /^\/dashboard\/invoice\/new$/,
    parent: (_, role, search) => {
      const clientId = search?.get('clientId')
      if (clientId) return `/dashboard/clients/${clientId}`
      const zzpClientId = search?.get('client_id')
      if (zzpClientId) return `/dashboard/klanten/${zzpClientId}`
      // [MEDEWERKER] Niet /dashboard/facturen: dat scherm staat niet in SALES_SCREENS, dus
      // "Terug" landde op een pagina die hem meteen terugwerpt naar zijn bord. Eén tik die twee
      // sprongen doet en op een derde plek eindigt, is erger dan geen tik.
      if (role === 'medewerker') return '/dashboard/verkoop'
      return role === 'accountant'
        ? '/dashboard/accountant'
        : '/dashboard/facturen'
    },
  },

  // ── invoice/[id] (any other) → facturen (zzp) or accountant home ──────────
  // [NAV] Context-aware: when the invoice was opened from a client's kwartaal
  // page (?from=client&clientId=…), "Terug" returns there — preserving q/year
  // so the accountant lands back on the exact filtered view. Otherwise it falls
  // back to the role default. This is loop-safe: every branch is an explicit
  // ancestor href, never history.
  {
    match: /^\/dashboard\/invoice\/[^/]+$/,
    parent: (_, role, search) => {
      const from = search?.get('from')
      const clientId = search?.get('clientId')
      // [VRAAG-DEUR] Opened from a question about this invoice → back to the questions screen.
      if (from === 'vragen') return '/dashboard/vragen'
      if (from === 'client' && clientId) {
        const q = search?.get('q')
        const year = search?.get('year')
        const qs = new URLSearchParams({
          ...(q ? { q } : {}),
          ...(year ? { year } : {}),
        }).toString()
        return `/dashboard/clients/${clientId}/kwartaal${qs ? `?${qs}` : ''}`
      }
      // [MEDEWERKER] Zie de regel hierboven: zijn lijst is het verkoopbord.
      if (role === 'medewerker') return '/dashboard/verkoop'
      return role === 'accountant' ? '/dashboard/accountant' : '/dashboard/facturen'
    },
  },

  // ── clients/[id]/kwartaal → clients/[id] ─────────────────────────────────
  {
    match: /^\/dashboard\/clients\/([^/]+)\/kwartaal$/,
    parent: (pathname) => pathname.replace(/\/kwartaal$/, ''),
  },

  // ── clients/beheer → accountant home ─────────────────────────────────────
  {
    match: /^\/dashboard\/clients\/beheer$/,
    parent: () => '/dashboard/accountant',
  },

  // ── clients/invite (accountant) → clients beheer ─────────────────────────
  // MUST sit above the generic clients/[^/]+ rule below, otherwise 'invite'
  // matches [^/]+ first and this never fires.
  {
    match: /^\/dashboard\/clients\/invite$/,
    parent: () => '/dashboard/clients/beheer',
  },

  // ── clients/[id] (any other) → accountant home ───────────────────────────
  {
    match: /^\/dashboard\/clients\/[^/]+$/,
    parent: () => '/dashboard/accountant',
  },

  // ── accountant/werkplek → accountant home ────────────────────────────────
  {
    match: /^\/dashboard\/accountant\/werkplek$/,
    parent: () => '/dashboard/accountant',
  },

  // ── accountant/agenda (BTW filing agenda) → accountant home ──────────────
  // [AANGIFTE-AGENDA] The daily-driver deadline board sits directly under the
  // accountant home; "Terug" returns there, not to the werkplek launcher.
  {
    match: /^\/dashboard\/accountant\/agenda$/,
    parent: () => '/dashboard/accountant',
  },

  // ── accountant/status (Klaar-overzicht) → accountant home ────────────────
  // [KLAAR-OVERZICHT] The cross-client readiness board — parent is the home.
  {
    match: /^\/dashboard\/accountant\/status$/,
    parent: () => '/dashboard/accountant',
  },

  // ── /dashboard/accountant itself → home (no parent) ──────────────────────
  {
    match: /^\/dashboard\/accountant$/,
    parent: () => '/dashboard/accountant',
  },

  // ── /dashboard itself → home (no parent) ─────────────────────────────────
  {
    match: /^\/dashboard$/,
    parent: () => '/dashboard',
  },

  // ── incoming/manage → where you actually came from ───────────────────────
  // [CONTROL] without a rule it fell through to home, so the primary "Terug"
  // jumped past the verification list to the dashboard. Hence the default below.
  //
  // [NAV-FROM] But the verification list is NOT the only door into this page: the
  // dashboard tiles and Vandaag link STRAIGHT to /incoming/manage, skipping
  // /incoming entirely. For those visitors a fixed parent of '/dashboard/incoming'
  // sent them "back" to a screen they had never seen. So the entry point says where
  // it came from (?from=), exactly like /invoice/[id] does with ?from=client, and
  // Terug honours it. Unmarked links keep the documented default, so nothing that
  // relied on it changes. Every branch is still an explicit ancestor href — never
  // history — so it stays loop-safe.
  {
    match: /^\/dashboard\/incoming\/manage$/,
    parent: (_, role, search) => {
      const from = search?.get('from')
      if (from === 'home') return getHomePath(role)
      if (from === 'vandaag') return '/dashboard/vandaag'
      // [VRAAG-DEUR] Opened from a question about this invoice → back to the questions screen.
      if (from === 'vragen') return '/dashboard/vragen'
      return '/dashboard/incoming'
    },
  },

  // ── settings/facturering → settings ──────────────────────────────────────
  // [NAV] This page had NO parent rule and NO title in DashboardChrome, so the
  // shared bar rendered nothing at all: a real screen with no back button and no
  // heading. Worse than an awkward back target — it is reached from a billing
  // e-mail and from the Stripe return URL, i.e. a cold open in a fresh tab with
  // no history to go back to, and in standalone PWA mode there is no browser
  // back button either. You landed there and stayed there.
  {
    match: /^\/dashboard\/settings\/facturering$/,
    parent: () => '/dashboard/settings',
  },

  // ── settings/team → settings ─────────────────────────────────────────────
  // [DEUR] Same shape as facturering above: no rule and no chrome title, so the bar rendered
  // nothing. Its safe fallback would have been the home, which is wrong twice over — team is a
  // settings child, and it is reached from the settings list.
  {
    match: /^\/dashboard\/settings\/team$/,
    // [FROM-HOME] Two doors: the settings list and the home's Team card. Unmarked → settings, as
    // before; ?from=home → the home. The second-door case the logboek note below spells out — mark
    // it, rather than send one group of visitors back through a screen they never saw.
    parent: (_, role, search) => (search?.get('from') === 'home' ? getHomePath(role) : '/dashboard/settings'),
  },

  // ── bank/categoriseren → bank ────────────────────────────────────────────
  // [NAV] Without this the categorise screen jumped past the bank overview
  // straight to home. Its real parent is the bank page it was opened from.
  {
    match: /^\/dashboard\/bank\/categoriseren$/,
    parent: () => '/dashboard/bank',
  },

  // ── bank/verdelen/[txId] → bank ──────────────────────────────────────────
  // [DEUR] Same reasoning as categoriseren, and worse in one way: this screen had no title in
  // DashboardChrome either, so it rendered no bar at all AND has no back link of its own. The
  // transaction it splits is a bank line, so the bank overview is where you came from.
  {
    match: /^\/dashboard\/bank\/verdelen\/[^/]+$/,
    parent: () => '/dashboard/bank',
  },

  // ── messages/[id] → messages list ────────────────────────────────────────
  // [NAV] A conversation's parent is the inbox, not the dashboard home.
  {
    match: /^\/dashboard\/messages\/[^/]+$/,
    parent: () => '/dashboard/messages',
  },

  // ── klanten/[id] (ZZP own clients) → klanten list ────────────────────────
  // [NAV] Distinct from the accountant's /dashboard/clients tree above.
  {
    match: /^\/dashboard\/klanten\/[^/]+$/,
    parent: () => '/dashboard/klanten',
  },

  // ── kluis (document vault) → werkplek ────────────────────────────────────
  // [NAV] The vault is reached from the ZZP werkplek; that is its parent.
  {
    match: /^\/dashboard\/kluis$/,
    parent: () => '/dashboard/werkplek',
  },

  // ── logboek (the audit trail) → werkplek ─────────────────────────────────
  // [LOGBOEK] Its one door is the werkplek tile (see ITEMS in WerkplekClient.tsx), so Terug
  // returns THERE. Without a rule the catch-all below sends it to the home instead — the same
  // jump-past-the-parent the bank/categoriseren note above describes, and the werkplek is the
  // only screen this visitor actually passed through. If a second door is ever added (from the
  // home, or from Instellingen), mark it with ?from= and branch here exactly like
  // incoming/manage does, rather than making one group of visitors travel back through a
  // screen they never saw.
  {
    match: /^\/dashboard\/logboek$/,
    parent: () => '/dashboard/werkplek',
  },

  // ── all other /dashboard/* → home per role ────────────────────────────────
  // covers: /facturen, /klanten, /bestanden, /incoming, /quarterly,
  //         /settings, /werkplek (zzp), etc.
  {
    match: /^\/dashboard\/.+/,
    parent: (_, role) => getHomePath(role),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// getParentPath — pure function, works everywhere
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical parent path for the given pathname + role.
 *
 * @param pathname  - e.g. '/dashboard/invoice/abc123/edit'
 * @param role      - 'zzper' | 'accountant'
 * @param search    - optional URLSearchParams (for query-param-aware rules)
 * @returns parent path string — safe to use in <Link href={...}>
 *
 * @example
 * getParentPath('/dashboard/invoice/abc/edit', 'zzper')
 * // → '/dashboard/invoice/abc'
 *
 * getParentPath('/dashboard/invoice/new', 'accountant',
 *   new URLSearchParams('clientId=xyz'))
 * // → '/dashboard/clients/xyz'
 *
 * getParentPath('/dashboard/facturen', 'zzper')
 * // → '/dashboard'
 *
 * getParentPath('/dashboard/facturen', 'accountant')
 * // → '/dashboard/accountant'
 */
export function getParentPath(
  pathname: string,
  role: Role,
  search?: URLSearchParams | null
): string {
  for (const rule of PARENT_RULES) {
    if (rule.match.test(pathname)) {
      return rule.parent(pathname, role, search)
    }
  }
  // Safe fallback — unknown path → home
  return getHomePath(role)
}

// ─────────────────────────────────────────────────────────────────────────────
// React hooks — 'use client' only
// These depend on next/navigation and cannot run in server components.
// Import from this same file — the directive is scoped to the exports below
// via a re-export pattern. In practice: put these in a separate file if your
// bundler complains about mixing server/client. The pure functions above
// remain importable in both environments either way.
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: If you encounter "useState/useEffect only in client components" errors,
// move the two functions below to: src/lib/navigation-hooks.ts
// and add 'use client' at the top of that file.
// The pure functions above (getHomePath, getParentPath) stay in this file.

