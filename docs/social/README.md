# Marketing copy, and why it has a gate

A thirty-day social campaign was drafted against this product by an outside tool and then checked
against the code. This directory holds what came out of that: the corpus of approved posts, and the
gate that decides whether a post may be published.

## What the audit found

Two rounds, 74 agents, 98 product claims across the plan's 30 days, its stories and its reusable
sections.

| | |
|---|---|
| Claims checked | 98 |
| True as written | 56 |
| Needed a qualifier | 30 |
| Flatly false | 10 |
| Verdicts overturned by the adversarial pass | **28** |

Then every one of the 51 posts was rewritten to be true, and the rewrites were counter-read. Not
one post survived unchanged: 30 were rewritten, 21 corrected, **none passed as written**.

And then the number that decided how this directory works:

> The corrections introduced **206 new false claims** and **95 screen names the app does not use**.

The rate did not fall between rounds. That is not a quality problem in any one round — it is what
happens when each round writes fresh prose about a product whose behaviour is precise. Fresh prose
invents. Reviewing harder does not repair a process that re-derives the facts every time it runs.

## So the facts are not re-derived

Two things in the product are already correct, already reviewed, and already owned:

- `src/lib/belofte.ts` — the promise, in the exact words legal and product agreed on. It also
  carries its own boundaries: never "het kwartaal doet zichzelf", always `staat klaar` and never
  `is gedaan`, and "klaar voor je boekhouder" rather than "je boekhouder haalt het op". Those
  sentences are constraints on the campaign, not suggestions.
- `src/lib/i18n/messages.ts` — every word the interface can show, which is the only correct source
  for any sentence that names a screen, a tab, a button or a field.

Copy is written **from** those, not corrected **towards** them.

## The gate

`src/lib/social-copy.ts` holds the rules, `src/lib/social-copy.test.ts` proves each rule still
catches the sentence it was written for, and `scripts/check-social-copy.mts` runs them over a
corpus:

```bash
npx tsx scripts/check-social-copy.mts                       # checks docs/social/posts.json
SOCIAL_COPY=path/to/draft.json npx tsx scripts/check-social-copy.mts
```

The rules run inside `npm run gates` whether or not anyone remembers the script, because the test
lives next to the module.

It enforces two things:

1. **A post declares the interface terms it names**, in `uiTerms`, and each one must exist word for
   word in `messages.ts`. This is AGENTS.md's rule for the interface — *a sentence that points at a
   button names the button as it is written* — applied to marketing. Guessing which words in a
   Dutch sentence are button names is unreliable; making the author declare them is not.
2. **Sentences already settled as false are refused**, each with the reason and the evidence
   attached, because a bare blocklist gets deleted by the next person who thinks it is too strict.

What it cannot do: decide whether a post is *true*. It knows whether a post names things that exist
and whether it repeats a known falsehood. Those two classes cover every defect the audit found more
than once. The rest still needs someone who knows the product.

It also knows **whose** screen a label is on. A draft written here told a zzp'er to look at
"Kwartaal"; the word is real, so the vocabulary check passed it — but `nav-destinations.ts` puts it
on the accountant's bar, and the owner's is `Start · Facturen · Vandaag · Inkomend · Bestanden`.
Existence was not the whole question, and the rule that catches it was earned by that mistake.

Three times the gate corrected a human-or-model judgement that had already been reported as settled
— most usefully that "Openstaand" *is* a real interface word (four keys), so a finding that the
copy pointed at a word nobody would find was itself wrong. Only the invoice list's **tab** is
called Verzonden.

## What was false, and what it became

The ten blocking defects, and what the product actually does:

| Where | The plan said | The product |
|---|---|---|
| Day 5, Day 7 | you describe work in plain language and AI fills the invoice | No such feature. `generateInvoiceFromPrompt` exists in `src/lib/ai.ts:3163` with no caller and no route; `ai.ts:16` calls it *"onbereikbare code"*. Replaced by the real path: **Werk / Uren → Maak factuur →** one verzamelfactuur with the client's agreed rate already filled in. |
| Day 4, Day 13 | "Even controleren. Opslaan." | There is no Opslaan button on either path, and the public scan deliberately **stores nothing** — which is a selling point, not an omission. |
| Day 9 | "Te laat? Stuur een vriendelijke herinnering." | The owner has no send button. Reminders are **automatic and tiered**, ending in an ingebrekestelling with incassokosten; the switch is *Stuur automatisch betalingsherinneringen*, on by default for new accounts, and only invoices falling due **after** the account started are chased. |
| Day 10, Day 11, story 11 | a plain CSV is not read as transactions | CSV **is** parsed (`src/lib/bank-csv.ts`), and `boekbrug.nl/tools` advertises it. Publishing the plan would have contradicted the company's own website — and the story quiz had the wrong answer key. |
| Day 12 | Gmail only; never claim Outlook | Outlook is a first-class second path, one of exactly two buttons. |
| Day 12 | "We lezen alleen factuur-bijlagen. Nooit persoonlijke e-mails." | The grant is read access to the whole mailbox with an internal filter. Never promise less than you ask for. |
| Day 15 | "Bij Financieel overzicht zie je…" | No screen by that name exists; it survives only in comments about its removal. |
| Day 20 | "Gratis invoice creator" | English name for a Dutch screen. |
| Day 26 | "Klant akkoord? Eén klik. Offerte → Factuur." | One-click conversion was removed on purpose and a test guards the removal; you get a pre-filled form. |
| §15 | forbid "directe bankkoppeling" because there is none | The right call for the wrong reason: the PSD2 integration is built, but not contracted, so the panel hides itself. |

Two prohibitions the plan was missing, and both belong in any future brief: never imply the app
**files** the aangifte (it prepares and exports), and never call a cost **guaranteed deductible**.

## What the plan never mentioned

- **The unified intake** (`/api/intake`) — one entry that decides by itself whether a file is a bank
  statement, a purchase invoice, a receipt or a document. It is the closest thing the product has to
  the promise "alleen niets kwijtraken", and thirty days of content never named it.
- **UBL / e-factuur export**, attached to a sent invoice on a best-effort basis.
- **The navigation adapts to the trade**: a shop sees Kassa, a dienstverlener sees Werk, a
  freelancer sees Facturen. The plan writes for one persona; the product already knows three.
- **`BELOFTE_GERUST`** — *"Je eerste 90 dagen met alles erop · daarna gratis verder · nooit
  automatisch afgeschreven"* — a contractual commitment, and a far stronger call to action than the
  plan's "Probeer BoekBrug gratis".

## Producing the assets

Anything under `/dashboard` needs a logged-in demo tenant (`SHOT_EMAIL` / `SHOT_PASSWORD`, seeded
by `scripts/seed-demo-account.sql`) and a browser that can reach Supabase. The public surface needs
neither, so the free tools, the calculators and `/factuur-maken` can be captured anywhere —
including a box whose egress policy blocks Supabase.

One consequence worth planning around: the receipt-scan demo the plan leans on for days 4, 13 and 20
cannot be filmed without Supabase, because the public scanner's rate limiter is fail-closed.

`scripts/capture-screenshots.mjs` covers six public screens and five dashboard ones; the plan asks
for eighteen. `scripts/record-clips.mts` already produces 24 clips, four of which need a session.
See `docs/SOCIAL_CLIPS.md`.

## Adding a post

Add an entry to `posts.json`, declare every interface term you name in `uiTerms`, and run the gate.
If a term is refused, the app does not say it that way — change the copy, not the term.
