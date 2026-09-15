# What the browser downloads, measured

Measured 11 September 2026 against a production build (`next build` + `next start`), by reading the
`<script>` tags the server actually emits per route and summing the files they point at. Not
estimated, and not read off the build log — the build log for this Next version prints no sizes.

Re-measure with the same method before trusting any number here again:

```bash
npx next build && npx next start -p 3111 &
curl -s http://127.0.0.1:3111/login \
  | grep -o '/_next/static/chunks/[A-Za-z0-9_.-]*\.js' | sort -u
# then sum the matching files under .next/static/chunks
```

## The measurements

| Route | Total JS (raw) | Of which the message catalogue |
| --- | --- | --- |
| `/` | 913 kB | — |
| `/login` | **1.978 kB** | **819 kB** |
| `/bankafschrift-naar-excel` | 941 kB | — |

Every page also carries 832 kB of framework and shared runtime (`rootMainFiles` + polyfills),
which is included in the totals above and is not something this app chooses.

Over the wire the numbers are smaller, and that is the number that matters: the catalogue chunk is
819 kB raw and **240 kB gzipped**. SheetJS, for comparison, is 266 kB raw and 88 kB gzipped.

## Finding 1 — fixed: the spreadsheet writer on a public page

`/bankafschrift-naar-excel` statically imported `@/lib/xlsx-adapter`, so every visitor to that
public page downloaded SheetJS (88 kB served) before they could do anything. It is used by exactly
one thing on that page: the `.xlsx` download button at the very end of the flow, beside a CSV
button that needs none of it.

The import moved into the click handler. `[SHEET-LAAT]` in `lifecycle-gates.test.ts` holds it there
and refuses a static SheetJS import from any client screen — the same shape as `[PDF-LAZY]`, whose
lesson this repeats: a deferral is worth nothing unless the IMPORT moves.

**A measurement error worth recording, because it nearly shipped as a claim.** The first reading
blamed a pair of 820 kB chunks on SheetJS, because grepping the minified chunks for `xlsx` matched
them. Those chunks contain no SheetJS at all: they hold this app's UI copy, and the word `.xlsx`
appears there in sentences like "…xlsx of .csv". A minified library has to be identified by its own
symbols (`sheet_to_json`, `book_new`, `aoa_to_sheet`), never by a word that also appears in prose.

## Finding 2 — open: the login page ships all four languages

`/login` is 1.978 kB, and 819 kB of that (240 kB served) is `src/lib/i18n/messages.ts` — every one
of ~2.350 keys in nl, ar, en and tr. A visitor reading Dutch downloads the Arabic, English and
Turkish of every string in the app to see a form with two fields.

It is not login's fault and not login-specific: any screen that calls `translator(useLocale())`
pulls the whole map, because the map is one module. Login is simply the first screen anyone meets,
which is why it shows up here.

**This is deliberately not fixed yet, and the reason is worth writing down.** Splitting the
catalogue per locale is an architectural change to the single most heavily gated file in this repo,
and it collides with work another session is landing in that same file several times a day (the
Arabic vocabulary decisions). Doing it in the middle of that is how two sessions produce a merge
that automerges cleanly and is wrong — the failure AGENTS.md names in as many words.

When it IS done, the shape that fits this codebase:

- keep `messages.ts` as the authored source and the thing every gate reads — nothing about the
  `[TAAL]`, `[AR-TERMEN]` or `[KNOP-IN-ZIN]` rules should have to change;
- emit one module per locale at build time, and have `translator(locale)` load the locale it was
  asked for, with Dutch statically imported since it is the required fallback;
- the win is bounded and should be measured, not assumed: Dutch alone is roughly a quarter of the
  map, so a Dutch-reading visitor would drop from 240 kB to somewhere near 60-80 kB served, and the
  totals above are the before-figures to compare against.

Until then the cost is real but paid once per visit, on a cached asset, and the app is correct —
which is the right order of priorities for a product that is about to be shown to accountants.
