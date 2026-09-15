<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Language: English in the code, Dutch on the screen

**Everything a developer reads is English. Everything a Dutch entrepreneur reads stays Dutch.**
That line runs straight through the repo, and it is not a style preference — the product is a
Dutch bookkeeping app for Dutch freelancers, so its words on screen are part of what it is.

English — no exceptions:

- identifiers: functions, variables, types, constants, parameters, object fields;
- file and directory names under `src/lib/`;
- comments and doc comments, however long;
- test names (`test("…")`) and assertion messages;
- commit messages and PR titles/bodies;
- new documentation in `docs/`.

Dutch — these are content, not code, and translating them would change the product:

- UI text, button labels, screen headings, error messages shown to a user;
- PDF and e-mail text, and everything in `src/content/legal/`;
- URL segments (`/dashboard/verkoop`, `/dashboard/klanten`) — a user reads those;
- values stored in the database (`role = 'verkoop'`, unit names like `"uur"`, `"stuks"`) —
  renaming those is a migration, not a rename;
- Dutch domain terms that have no English equivalent in this context: `btw`, `kvk`, `iban`,
  `aangifte`, `creditnota`, `zzp`. Keep them as they are; do not invent translations.

When a Dutch sentence has to live inside an English file, say why in one line — see the note at
the top of `src/lib/owner-only.ts`.

**This rule is forward-looking.** Large parts of the existing codebase are still Dutch inside.
Do not start a mass rename. Convert a file to English when you are already changing it for
another reason, and keep the rename in its own commit so the real change stays readable.

## The screen has more than one language now — the documents still do not

The app has published in four languages since the blog was built: 53 articles each in `nl`, `en`,
`ar` and `tr`, with an `/ar/blog` route and a locale table that knows Arabic is right-to-left. The
product was Dutch-only for a structural reason, not a linguistic one — that table lived in
`src/lib/blog.ts`, which reads the filesystem and may never be imported by a screen. It now lives
in `src/lib/i18n/locale.ts`, and `blog.ts` re-exports it.

So "Dutch on the screen" becomes: **Dutch is the SOURCE language of everything on screen, and the
screen may be shown in another one.**

- New user-facing text goes in `src/lib/i18n/messages.ts`, written in Dutch first. Dutch is
  required per key; other languages are optional and a gap falls back to Dutch — never to a key,
  never to a blank. A bookkeeping app with `sent.action.view` on a button is worse than one in a
  language the owner reads less comfortably.
- **A noun inside a sentence is not a parameter.** `Een verstuurde {woord} pas je niet aan` works
  in Dutch and breaks Arabic agreement and Turkish suffix harmony. Give the document type its own
  key per sentence.
- **A sentence that points at a button names the button as it is written.** While the nav still
  says `Facturen`, the Arabic sentence says `Facturen` too — otherwise the owner hunts for a word
  that is nowhere in the interface.
- **A component holds no language of its own.** Copy lives in a pure module (see
  `invoice-sent-notice.ts`), the component renders what it is handed, and text direction travels
  with the words on the same object. One hard-coded string left in a component is how a
  translation stays permanently half-finished — the screen still looks right in Dutch, so nothing
  points at the gap.
- Use `textAlign: 'end'` and `paddingInlineStart`, never `right`/`paddingLeft`. Physical sides are
  wrong in exactly one language, which is the one nobody checks.

**What is never translated, in any language:** the invoice PDF, the e-mail that carries it, the
e-factuur XML, and everything in `src/content/legal/`. Those are read by a Dutch customer, an
accountant and the Belastingdienst — not by the owner's language setting. Translating them would
change what the documents ARE, and would leave an owner sending a Dutch company a bill it cannot
book. Database values and URL segments stay Dutch for the reasons already given above.

The `[TAAL]` gates in `lifecycle-gates.test.ts` enforce the mechanical half of this: the vocabulary
stays importable, every key used exists, every key declared is rendered, and the translated panel
carries no Dutch of its own.

**The accountant module (`src/modules/accountant/`) is translated too — and that is a reversal.**
It used to be deliberately Dutch-only, on the argument that the boekhouder is a Dutch professional
reading Dutch administraties under Dutch law, and that the owner's language setting describes the
OWNER. The note ended: *"If a non-Dutch accountant ever becomes a real audience, that is a product
decision first and a translation second."* That decision has been made — the first accountants
using this product read Arabic — so the module is translated, and the two halves of the old
argument are settled like this:

- **The accountant has their own language setting, not the owner's.** They are a logged-in user
  with a profile of their own, so `preferred_language` on THEIR row is what their screens follow.
  Nothing an owner picks reaches an accountant's interface, which was the real objection.
- **What they read is still Dutch where the law reads it.** The administratie, the invoice, the
  e-factuur, the auditfile and every amount stay exactly what they were. A translated button above
  a Dutch document is not a translated document — see the never-translated list above, which the
  accountant module obeys in full.

Accountant screens therefore follow the same rule as every other screen: Dutch is the source
language, keys live in `messages.ts`, and a component holds no language of its own.

# More than one session works on this repo

`main` moves while you work: another session merges its own branch, and sometimes it touches the
same file you do. That happened twice on 31 July, once with a real conflict in
`src/app/register/page.tsx`.

**Before you push to `main`: merge `main` into YOUR branch first and run the gates on the
result.**

```bash
git fetch origin main
git merge origin/main          # resolve conflicts here, not on main
npm run gates                  # tsc · unit · render · eslint · build · smoke
```

`npm run gates` runs them in order and stops at the first failure. The individual steps are
`test:unit`, `test:render`, `test:e2e` in package.json; the build runs without secrets
(LIVE_GAAN.md §0).

Why this is not optional: gates on your own branch prove that YOUR change works, not that the
COMBINATION works — and the combination is what gets deployed. A merge that automerges cleanly
can still be broken (two sessions calling the same function differently produce no conflict, but
do produce a failure).

Two things that go with it:

- **A conflict is usually additive.** Two sessions improving the same screen rarely solve the
  same problem. Look at what each side DOES before picking one; the answer is often "keep both".
- **Then check that the merge did not silently eat anything.** An automerge also succeeds when it
  loses your block. Count your own markers (`grep -c "[YOUR-TAG]"`) in the files you touched, and
  look at the built HTML rather than the source where you can.

# A green gate set does not mean the screen opens

`tsc`, `eslint` and `next build` never CALL a component, and the Playwright smoke test only sweeps
the public surface — every path the middleware lets through without a session. So a `/dashboard/*`
screen that throws on every render passes all of them.

That is not hypothetical. `/dashboard/incoming/manage` went through the entire set with a `const`
read seventy lines before it was declared, inside a `.filter()` callback that runs during render.
TypeScript does not model *when* a closure runs, so it type-checked; the build compiled it; the
smoke test never logs in. The screen would have been white with
`Cannot access 'onlyFlagged' before initialization` in the console.

`npm run test:render` (tests/render/) closes that class: it renders the money screens with
`react-dom/server` and asserts the output is not empty. Under a second, no browser, no session, no
database — the components take their data as props. **Hand it rows that exercise the branches**:
the same bug is invisible against an empty list, because `[].filter(cb)` never calls `cb`.

When you add a screen to this line, add it there.

# The Arabic vocabulary is decided, and the decisions are written down

A native speaker reviewed the Arabic interface twice — every word on a button, then every heading,
label, hint, error and explanation — against what each control DOES, not against the Dutch word
alone. Two things came out of it, and both live in `src/lib/i18n/ar-decisions.ts`:

- **one Arabic wording per Dutch source**, for the strings the interface had been saying two or
  three ways;
- **the splits that must stay split**, where one Arabic word had been serving two Dutch meanings —
  a `bon` is a receipt and never an invoice, `doorsturen` is forwarding and not sending, `uitzetten`
  disables a setting while `stoppen` ends a run. Each carries its reason, because the next reader's
  instinct is to unify them, and that instinct is what produced the drift the audit found.

`[AR-TERMEN]` holds both, plus the retired forms in either language. So: **do not re-decide a word
that is in that file.** If you believe a ruling is wrong, change it there, once, where the reason
is written — not in `messages.ts`, where the next person cannot see that anyone decided anything.

And `[KNOP-IN-ZIN]`: a sentence that names a button names what the button currently says. That
broke three times — twice from a rename, once from a button that was removed while the sentence
telling people to press it stayed, in all three languages.

`btw` stays untranslated — it is what the owner reads on a letter from the Belastingdienst — but it
is written ONE way inside Arabic, lowercase, and a gate asserts that rather than listing forms. The
English went the other way and says **`VAT`**, because `BTW` there is only a Dutch abbreviation an
English reader does not know — with one exception, the legal field «BTW number». Two
things sit either side of it and neither is the other: **«الضريبة»** is the bare label for a tax
AMOUNT, and **«رقم btw»** is the identification number. One key was labelling both, two rows apart
in the same panel, because Dutch "BTW" carries both readings.

One trap worth naming, because it cost a round: a retired wording is normally retired **as a
label**, and most of them are perfectly good Arabic inside a sentence — «حاول مرة أخرى» closes 85
error messages correctly. So the retired list is matched on the WHOLE value, and a wording that
names a control has to be listed a second time, in `AR_RETIRED_EVERYWHERE`, to be refused inside
sentences as well. Until that existed, four failures reported «فشل فكّ الربط» above a button
reading «إلغاء الربط» — and `AR_SETTLED` was prescribing the retired wording while `AR_RETIRED`
forbade it, with no test able to see the contradiction. The lists now check each other.

# A lifecycle gate must not mark its own bounds with a comment

Many gates in `src/lib/lifecycle-gates.test.ts` read a file through `code()` and then cut a window
out of it — "the rollback branch is between HERE and THERE" — before asserting over that window.

`code()` strips comments. So a marker that lives in a comment is not in the string being cut, and
`indexOf` returns `-1`. The window then runs to the END of the file, and the gate quietly measures
something far larger than it claims.

That happened to `[UREN-EENMALIG]`, whose window ended at `"[ARTIKEL-LEREN]"` — a comment. For
months the only thing bounding it was a 3000-character ceiling meant as a sanity check, and the
gate went red the moment a second branch was added after the one it was watching. Nothing was
wrong with the code it guarded; the gate had stopped being able to see where it ended.

**Cut on real code, and assert the marker was found.** A `slice` whose second argument may be `-1`
is a gate that passes for the wrong reason on the day it matters.
