# The BoekBrug Accounting Decision Matrix

**A census, not a plan.** Every row below names a decision the pipeline actually makes on a real
document, and cites the module that makes it and the lifecycle gate that holds it in place. Both
citations are verified mechanically against this repository by the `[BESLISMATRIX]` lifecycle
gate, which reads this file, resolves every module path and every gate tag in the table, and goes
red when one of them stops existing. Four rows were wrong when the table was first written — named
from memory, pointing at modules that had been renamed — and the check is why that was found
instead of shipped.

## The seventh column

A decision matrix normally has six: input, condition, rule, output, confidence, exception. This one
has a seventh, and it is the column that changed how the work was ranked:

> **How does the owner find out that this row applies to them?**

Three features in a row were built, shipped and gated, and then measured as reaching nobody —
because the capability existed and the LIST did not. The reader had learned to split a mixed-rate
invoice, and the forty documents held before it learned that stayed held. The ledger account could
be set, and the 550 invoices waiting for one were spread over 101 supplier pages. The unverifiable
btw could be identified, and the 28 invoices carrying it were named nowhere. In each case the
answer was not a better rule. It was a list.

So a row with an empty seventh column is not finished, however green its gate.

## What is deliberately NOT in this table

Verified absent from this repository at the time of writing, each for a stated reason:

| Not built | Verified by | Why not |
|---|---|---|
| A persistent journal / ledger-entry table | no migration creates one | Every amount is currently derived from the documents on demand, and the derivation is gated. The trigger that would change this is named below. |
| A manual journal entry (memoriaalboeking) | no API route accepts one, and `[VAKWOORD]` fails if `/dashboard/memoriaal` is ever given a door | The condition, stated in advance: **the first entry a real owner needs that is not represented by a document** — a depreciation adjustment, a provision, an opening balance, a correction. Until then a journal table would be a second source of truth for figures that already have one. |
| Currency conversion | no exchange-rate code anywhere | A conversion needs the rate on the invoice date, which this app does not have. A foreign invoice is HELD and named instead ([VREEMDE-VALUTA]) — a converted figure, once stored, is indistinguishable from a read one. |
| Peppol transport (sending over the network) | no access-point client | The UBL the network requires is built and gated ([SI-UBL]). What is missing is a commercial access-point contract, not code. This is a decision for the owner, not an engineering gap. |
| Owner-written rules ("always book X to 4300") | no rule engine | Five learning loops already exist (bottom section) and are measured working. A rule language would be a sixth way to say the same things, with the owner maintaining it. |
| A firm-level rule an accountant sets across clients | no such scope on any rule or memory | Every memory in this app is scoped to ONE administration, and that is not an oversight: an accountant with 43 clients genuinely needs "our office books Google Ireland this way", and equally, a rule of theirs may never book in a client's administration without the client — [ZELF-EERST] and [VOORSTEL] both say the owner decides. So the buildable version is a default for the accountant's own PROPOSALS, not an auto-booking. The trigger to build it: **the first accountant who corrects the same thing across three or more clients** — until then it is a rule language with nobody's habits in it. |
| Inventory, payroll | no such modules | Out of scope by product decision. |

## The table

Column 3 is the module that decides. Column 4 is the gate that stops the decision being quietly
removed. Column 5 is the seventh column: what the owner sees, in the Dutch they actually read.

### A. What is this document?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| Is it an invoice at all? | `ai.ts` | `[LEES]` | Het staat in de wachtrij met de reden erbij; een geweigerd bestand blijft bewaard en genoemd. |
| Is it the owner's OWN sales invoice? | `own-document.ts` | `[EIGEN-FACTUUR]` | De rij zegt welk kenmerk van jou erop staat (KVK, btw-nummer of IBAN). |
| …recognised by the number this app issued | `own-document.ts` | `[EIGEN-NUMMER]` | Dezelfde rij noemt het eigen factuurnummer. |
| Was it drawn up by the customer (self-billing)? | `zelffacturering.ts` | `[ZELFFACTUUR]` | De rij vraagt of dit jouw verkoop is of jouw inkoop. |
| Is it a creditnota — by type, by number, by the printed word? | `creditnota-signal.ts` | `[CREDIT-WOORD]` | Het woord uit de kop staat in de reden. |
| Is it a payment reminder of an invoice already booked? | `reminder-original.ts` | `[HERINNERING-NOOIT]` | De rij noemt het oorspronkelijke factuurnummer. |
| Is it a bank statement rather than an invoice? | `ai.ts` | `[STATEMENT-RECONCILE]` | De wachtrij noemt het een rekeningoverzicht. |
| Is it a Belastingdienst letter, and which kind? | `tax-letter.ts` | `[AANSLAG]` | De soort staat op de rij en is corrigeerbaar. |
| Is it a netted platform settlement (Mollie)? | `mollie-settlement.ts` | `[MOLLIE-AFREKENING]` | De afrekening toont de bruto omzet, de kosten en de uitbetaling apart. |
| Does one file hold several invoices? | `multi-invoice-pdf.ts` | `[MULTI-INVOICE]` | De reden noemt de nummers die niet zijn overgenomen. |
| Is it an offerte or proforma, which is no turnover? | `ubl-export.ts` | `[OFFERTE-IS-GEEN-PROFORMA]` | Een offerte staat op het offertescherm, nooit in de omzet. |
| Which screen answers a word from the profession? | `vakwoorden.ts` | `[VAKWOORD]` | /dashboard/crediteuren, /saldibalans, /debiteuren … komen uit op het scherm dat het al beantwoordt. |

### B. What does it say?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| The three amounts, and the printed total kept apart | `invoice-totals.ts` | `[SUBTOTAAL]` | De controle laat het gelezen bedrag naast het document zien. |
| The per-rate split, when the supplier printed one | `btw-split.ts` | `[DOCCHECK-SPLIT]` | De splitsing is zichtbaar en corrigeerbaar op de factuur. |
| The split rebuilt from the invoice's own lines | `factuurregels.ts` | `[REGELS]` | Stilzwijgend: de factuur telt niet meer mee als ongecontroleerd. |
| Which invoices nothing has been able to check | `btw-ongecontroleerd.ts` | `[BTW-ONGECONTROLEERD]` | Een blok op het jaarscherm noemt bedrag en leveranciers. |
| The supplier's KVK, btw number and IBAN | `intake-supplier.ts` | `[LEVERANCIER-INTAKE]` | De leverancier staat op de factuur en is te wijzigen. |
| Invoice date, due date, delivery date | `safecore.ts` | `[FACTUUR-DATUMS]` | De datums staan op de rij en zijn te corrigeren. |
| The currency, read and never assumed | `vreemde-valuta.ts` | `[VREEMDE-VALUTA]` | De rij zegt dat de bedragen niet in euro's staan. |
| The supplier's own e-invoice inside the PDF | `e-invoice.ts` | `[E-FACTUUR]` | De rij zegt dat de leverancier zelf andere bedragen noemt. |

### C. Is the reading true?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| Do excl + btw equal the total? | `import-health.ts` | `[NAREKENEN]` | De checklist noemt het verschil in euro's. |
| Is the total printed in the document's own characters? | `amount-grounding.ts` | `[GEGROND]` | De reden zegt dat het bedrag niet in de tekst voorkomt. |
| Is it printed WHERE a total is printed? | `document-verify.ts` | `[DOCCHECK]` | De reden zegt dat het bedrag niet op de plek van een totaal staat. |
| Is a zero BTW explained by the document? | `zero-btw.ts` | `[NUL-BTW-STIL]` | De rij zegt dat er € 0 voorbelasting is geboekt. |
| Do the base and the BTW point the same way? | `creditnota-signal.ts` | `[TEGENTEKEN]` | De rij wordt tegengehouden met die reden. |
| Was a base stored as zero because it could not be read? | `read-amounts.ts` | `[NUL-GRONDSLAG]` | De reden noemt de terugval met zoveel woorden. |

### D. Whose money moved?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| Which invoice does this bank line pay? | `bank-matching.ts` | `[BANK-KOPPELEN]` | Het bankscherm toont het voorstel met de reden. |
| One payment for several invoices | `bank-matching.ts` | `[SOM-KLOPT]` | De regel noemt alle facturen die samen kloppen. |
| A part payment, and what stays open | `partial-payment.ts` | `[PARTIAL-PAY]` | Het openstaande restant staat op de factuur. |
| A reversed incasso puts the invoice back to open | `bank-storno.ts` | `[STORNO]` | De melding noemt de betaling die is teruggedraaid. |
| Is this invoice already settled? | `double-pay-check.ts` | `[AL-GEBOEKT]` | Het scherm zegt het in plaats van een keuzelijst te tonen. |
| Is this document already in the books? | `archived-duplicate.ts` | `[DUBBEL-ZICHTBAAR]` | De rij noemt de factuur waar hij op lijkt. |
| Did money leave with no document behind it? | `betaling-zonder-stuk.ts` | `[BETAALD-GEEN-STUK]` | Een blok in de wachtrij: bedrag, leverancier, en dat er niets aan gekoppeld is. |
| Which invoice did NOT arrive, on the supplier's rhythm? | `supplier-cadence.ts` | `[RITME]` | Hetzelfde blok in de wachtrij, als verwachting geformuleerd. |

### E. Where does it book?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| Which cost account (grootboek)? | `grootboek.ts` | `[GROOTBOEK]` | Een lijst per leverancier op het jaarscherm, met een voorstel per groep. |
| The journal entry itself, per source document | `xaf-export.ts` | `[JOURNAAL-BRON]` | Het journaal op /dashboard/grootboek, met per boeking de regels die eronder zitten. |
| The saldibalans and the grootboekkaart | `grootboekkaart.ts` | `[JOURNAAL-BRON]` | Saldibalans op /dashboard/grootboek; één tik opent de kaart van die rekening. |
| Is this a cost or an asset to depreciate? | `asset-candidates.ts` | `[BEDRIJFSMIDDEL]` | Het jaarscherm noemt de kandidaten met bedrag. |
| Depreciation over the asset's years | `depreciation.ts` | `[BEDRIJFSMIDDEL]` | Het resultaat toont de afschrijving als aparte post. |
| Cash basis or accrual (kasstelsel) | `aangifte.ts` | `[XAF-STELSEL]` | Het stelsel staat in de instellingen en op het aangiftescherm. |
| Is this 21 % actually deductible voorbelasting? | `btw-soort.ts` | `[GEEN-BTW-SOORT]` | De rij zegt waarom de btw niet terugvraagbaar is. |
| BTW shifted to the owner (rubriek 2a and back in 5b) | `verlegde-btw.ts` | `[VERLEGD-NAAR-MIJ]` | De aangifte toont beide rubrieken met hetzelfde bedrag. |
| An untaxed amount that is not a rate (statiegeld) | `untaxed-amount.ts` | `[NUL-POST]` | De post staat apart op de factuurcontrole. |

### F. Does it book itself?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| Confident and clean → booked without a tap | `auto-advance.ts` | `[POORT-OPBRENGST]` | "Wat is automatisch verwerkt" toont elke rij, met ongedaan maken. |
| The owner switch: nothing books itself | `owner-only.ts` | `[ZELF-EERST]` | De schakelaar staat in de instellingen en wordt als reden genoemd. |
| Why THIS document is waiting | `why-waiting.ts` | `[WAAROM-WACHT]` | Eén zin op de kaart in de wachtrij. |
| Every refusal owes a sentence | `hold-reasons.ts` | `[WAAROM-VASTGEHOUDEN]` | De lijst met redenen op het beheerscherm. |
| Every booking is written to the logbook | `audit.ts` | `[LOGBOEK]` | Het logboek in Nederlandse zinnen, nooit als code. |

### G. What does the tax office see?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| The quarter's aangifte, per rubriek | `aangifte.ts` | `[RUBRIEK-1E]` | Het aangiftescherm toont elke rubriek met het bedrag. |
| May this quarter be filed at all? | `readiness.ts` | `[SNEL-BORD]` | Het bord noemt per signaal wat er nog mist. |
| A correction after filing (suppletie) | `btw-filing.ts` | `[SUPPLETIE]` | Het scherm noemt het verschil met wat er is ingediend. |
| KOR: no btw on the invoice, none reclaimed | `kor-invoice.ts` | `[KOR-FACTUUR]` | De factuur draagt de KOR-zin, het aangiftescherm is uit. |
| The auditfile (XAF 3.2 and 4.0) | `xaf-export.ts` | `[XAF-4]` | De export staat in het kwartaalpakket. |

### H. What does it remember?

| Decision | Decided in | Held by | How the owner learns it applies to them |
|---|---|---|---|
| The category a counterparty was given before | `bank-categories.ts` | `[GEHEUGEN]` | De regel zegt "onthouden van eerder", en zwijgt als dat is tegengesproken. |
| The supplier's own btw rate, for a split we could not read | `vendor-vat-rate.ts` | `[TARIEF-GEHEUGEN]` | De splitsing noemt de leverancier als bron. |
| The supplier's known IBAN, as a fraud handle | `supplier-known-iban.ts` | `[SUPPLIER-IBAN]` | De rij zegt dat het rekeningnummer is veranderd. |
| What the reader has learned since a document was held | `geleerd-sindsdien.ts` | `[GELEERD-SINDSDIEN]` | Een lijst bij de genegeerde documenten, met terugzetten. |
| Which reading errors keep recurring | `reading-memory.ts` | `[READING-MEMORY]` | Het leeskwaliteitspaneel op het beheerscherm. |

## How to use this file

- **Adding a decision to the pipeline?** Add its row. If you cannot fill in the last column, the
  work is not finished — decide where the owner meets it before you decide how it is computed.
- **Deleting a gate?** Find its row first. A gate with a row here is holding a decision someone
  relied on; `scripts/gate-yield.ts` says how often it was the only thing holding a document, and
  a zero there is the start of that conversation, not the end of it.
- **Renaming a module?** This file is not documentation about the code, it is checked against it.
  `[BESLISMATRIX]` reads the table below and fails on a path or a tag that no longer resolves, so
  a rename either updates this row or goes red — the one thing a census must not do is quietly
  describe a repository that no longer exists.

Rows: 58 decisions across 8 stages, each citing a module and a gate that exist.
