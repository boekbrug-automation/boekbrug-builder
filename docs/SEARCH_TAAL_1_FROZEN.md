# [SEARCH-TAAL-1] — frozen finding set

**Status: FROZEN. Not authorised for implementation.**
Engineer 1 holds the write lane for Financial Truth Closure. Launch deadline: 11 October 2026.

Measured against `main = 49a7c131fa9c9ccbdae45a5a567f64a5ac3a4f99` on 2026-09-23, immediately after
`[UPLOAD-TRUTH-1]` closed. Every line/number below was hand-verified against that tree — not taken
from an agent report, because the adversarial pass on the previous slice returned "0 survived" and
seven of the findings it refuted were real.

## Why it is frozen rather than scheduled

All four findings are real and none of them is financial. They do not outrank, and must not displace:

- document or evidence loss;
- wrong money;
- wrong payment / bank / cash truth;
- wrong btw;
- false readiness;
- a financial workflow with no safe completion path.

A machine code on a search result is a bad sentence. It is not a wrong number.

## The freeze

Scope is exactly the four findings below, as measured. Do **not** add to it:

- MIME charset (fixture green, historical `??????` cause disproven — no fix without a live regression);
- push-notification language (UPLOAD-TRUTH-P2);
- retroactive notices for the historical intake-door rows;
- `selectDrainCandidates` — stays with Engineer 1 as F-08;
- new search architecture;
- new screens;
- migrations.

If SEARCH-TAAL-1 is reopened before launch, implement **all four together** in the accepted order.
Splitting the family again is what produced the half-translated state in the first place.

## Accepted execution order: 3 → 2 → 1 → 4

Numbered by finding, not by the order they were discovered.

The gate goes first on purpose. Fixing it turns twelve currently-invisible Dutch strings red, and
those failures then name the work in finding 2. Fixing finding 2 first leaves the gate blind, and
the next hard-coded sentence lands unseen — the same way these twelve did.

---

## Finding 3 — the `[TAAL]` gate cannot see a text node containing a JSX expression

Highest leverage, therefore first.

`src/lib/lifecycle-gates.test.ts:8500` — `test("[TAAL] the translated screens have no Dutch of their
own left")`. It scans 85 screens. `src/components/search/SearchBar.tsx` is one of them (listed at
line 8565), so coverage is not the problem.

Its two text-node patterns are:

```
/> *([A-ZÉ][^<>{}\n]{3,70}?) *</g
/>\s*\n\s+([A-ZÉ][^<>{}]{3,150}?)\s*\n\s*[<{]/g
```

Both character classes exclude `{` and `}`. So a rendered text node that contains a JSX expression
is invisible to the gate — and `>Label ({count})<` is the most common heading shape in this codebase.

The section labels are invisible for a **second, stacked** reason: the Dutch-shape filter accepts
either two lowercase words (`[a-zé] [a-zé]`) or a single capitalised word **alone and anchored**
(`^[A-Z][a-zé]{3,}$`). `Facturen ({groups.invoices.length})` is neither. Fixing only the character
class leaves the five section labels still unseen.

**Measured: 12 Dutch strings invisible inside the 85 gated screens.**

| File | Invisible string |
|---|---|
| `src/app/dashboard/incoming/IncomingInvoicesClient.tsx` | `Je {providerName}-koppeling is verlopen. Er komen geen nieuwe facturen meer binnen totdat je opnieuw verbindt.` |
| " | `Vervangen door {invoice.superseded_by_number}` |
| " | `Deels betaald · € {remaining.toFixed(2)} open` |
| `src/app/dashboard/vandaag/VandaagClient.tsx` | `Geen facturen gevonden voor "{rawV}".` |
| `src/components/onboarding/OnboardingWizard.tsx` | `Welkom bij BoekBrug, {firstName}!` |
| `src/components/search/SearchBar.tsx` | `Geen resultaten voor{" "}` · `Alle resultaten voor "{query.trim()}"` |
| " | `Facturen ({…})` · `Bestanden ({…})` · `Klanten ({…})` · `Bankmutaties ({…})` · `Kasboekingen ({…})` |

Proof it is blindness and not redness: the full gate set on this exact tree is **901 pass, 0 fail**.

Note for whoever fixes this: allowing braces into the text-node patterns will also start matching
JSX that is not screen text (a generic between `>` and `<`, for one — the gate already carries an
exemption list for `Promise`, `Record`, `Array`). The asymmetry to aim at is already in the gate: its
template-literal pattern allows braces (`[^\`]`), and its own comment cites
`` `Bijna klaar, ${firstName}!` `` as the sentence that pattern exists to catch. The *same sentence*
written as a JSX text node — `Welkom bij BoekBrug, {firstName}!`, `OnboardingWizard.tsx:989` — passes.
One sentence shape is guarded and the other is not, for no reason anyone chose.

## Finding 2 — hard-coded Dutch in `SearchBar`

`src/components/search/SearchBar.tsx` already imports `useLocale` and `translator` and calls `t()` in
twelve places. It is half-translated, which AGENTS.md names as worse than untranslated: the screen
still looks right in Dutch, so nothing points at the gap.

| Line | Hard-coded Dutch | Catalogue key |
|---|---|---|
| 410 | `Facturen ({n})` | `zoek.cat.facturen` — **exists** |
| 429 | `Bestanden ({n})` | `zoek.cat.bestanden` — **exists** |
| 448 | `Klanten ({n})` | `zoek.cat.klanten` — **exists** |
| 467 | `Bankmutaties ({n})` | `zoek.cat.bank` — **exists** |
| 486 | `Kasboekingen ({n})` | `zoek.cat.kas` — **exists** |
| 399 | `Geen resultaten voor` | `zoek.geenResultaten` — **exists** |
| 515 | `Alle resultaten voor "…"` | none yet |

The five category keys are already used by `src/app/dashboard/zoeken/ZoekenClient.tsx:372-376`. So the
same five categories are translated on the results page and Dutch in the dropdown above it. An owner
reading Arabic opens the dropdown to an Arabic placeholder and an Arabic "recent", then five Dutch
headings.

`[KNOP-IN-ZIN]` check before writing: `Facturen` and `Bestanden` are also nav destinations. If the
nav still says `Facturen` untranslated, a *sentence pointing at it* must say `Facturen` too — but
these are section headings over their own results, not sentences naming a control, and the results
page already translates them. Translating them here removes an inconsistency rather than creating one.

## Finding 1 — search prints machine codes as document subtitles

`src/app/api/search/route.ts:467`

```ts
subtitle: doc.ai_doc_type ?? doc.doc_type ?? "document",
```

A `[SERVER-ZIN]` violation: a machine code is not a sentence, on any screen. It is Dutch-language
independent — the owner reading Dutch sees English machine words too.

Production, non-trashed documents at the time of measurement — every one of these appears verbatim as
a search subtitle:

| `ai_doc_type` | rows |
|---|---|
| `invoice` | 633 |
| `receipt` | 16 |
| `could_not_read` | 12 |
| `reminder` | 6 |
| `(null)` → falls back to `doc_type` | 5 |
| `unsupported_type` | 5 |
| `other` | 3 |
| `ubl_invoice` | 3 |
| `kassa_zrapport` | 1 |
| `grootboek_export` | 1 |

The sharpest case is the one `[UPLOAD-TRUTH-1]` just created: the owner receives "Een bestand konden
we niet lezen", searches for the file, and the result reads `could_not_read`. The sentence for that
exact code already exists and is already translated — `IncomingInvoicesClient.tsx:156` maps it to
`t('ink.reden.onleesbaar')` = "kon niet gelezen worden — staat in je bestanden", with `ar` and `en`.
Search simply does not use it.

Fix shape: one small pure module mapping `ai_doc_type` → catalogue key, the same shape as
`src/lib/notification-copy.ts` (recognised codes translate, everything else keeps a safe fallback).
The API returns the key or the code; the screen resolves it. No new screen, no schema change.

## Finding 4 — the dropdown truncates in silence, under a button that claims completeness

The API is honest. `src/app/api/search/route.ts:169-175` asks for one row past every cap
(`[ZOEK-EERLIJK]`), and line 430 records `truncated[group] = true` after ranking and de-duplication.

Dropdown caps (`route.ts:167`, the `full=1` flag absent): invoices 8, documents 4, clients 5,
bank 6, cash 6.

- `src/app/dashboard/zoeken/ZoekenClient.tsx:369` renders the warning: `t('zoek.afgekapt')`.
- `src/components/search/SearchBar.tsx` contains **zero** references to `truncated`.

And the one thing on screen at that moment asserts the opposite. `SearchBar.tsx:502-515` renders
`Alle resultaten voor "…"` whenever `totalCount > 0` — "all results" over four of however many
documents matched.

The gate that should catch this is `lifecycle-gates.test.ts:23095`,
`test("[ZOEK-EERLIJK] search never truncates in silence, never limits arbitrarily, and always
lands")`. It reads `ZoekenClient.tsx` and never reads `SearchBar.tsx`. Its own opening comment quotes
the reported symptom — *"I searched for it in the search bar and it did not open it, or open where it
is."* — the search **bar**, which is the surface it does not check for the truncation half.

Findings 1 and 4 are the same family as the report that opened this whole line of work: a search for
invoice `2600999` returned two rows and the app said nothing about either.

## Re-verification

The measurements above are reproducible read-only. Nothing here mutates anything.

```bash
# Finding 3: the twelve invisible strings, and that the gates are green anyway
npx tsx --test src/lib/lifecycle-gates.test.ts   # expect: pass 901, fail 0

# Findings 2 and 4: the hard-coded strings and the missing truncation read
grep -n 'Geen resultaten voor\|Alle resultaten voor' src/components/search/SearchBar.tsx
grep -n 'SectionLabel>' src/components/search/SearchBar.tsx
grep -c truncated src/components/search/SearchBar.tsx        # expect: 0

# Finding 1: the subtitle, and the translated sentence that already exists for the same code
sed -n 467p src/app/api/search/route.ts
sed -n 156p src/app/dashboard/incoming/IncomingInvoicesClient.tsx
```

Prior art, and not a duplicate of it: `docs/SEARCH_ENGINE_AUDIT.md` (2026-07-15) covers result
wiring, dead link parameters and the error state. None of the four findings here appears in it.
