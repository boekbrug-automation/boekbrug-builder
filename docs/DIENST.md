# DIENST — the dienstverlener as BoekBrug's segment

A study, 9 September 2026, on the owner's question: dienstverleners (consultants, IT freelancers,
designers, marketeers, coaches, trainers, interim professionals, copywriters, therapists) look like
the largest group of small businesses and may fit BoekBrug better than the trades — is that so,
and what would the app have to do for them? Sources at the end; every figure is from a public
source unless marked as an estimate. Most Dutch vendor and government pages are blocked from this
environment, so figures rest on search snippets; the direction is solid, the last digit is not.

## 1. Size: the largest segment, and the one that is growing

| Group (KVK, registered zzp'ers, 2026) | Count | Share of 1.8M |
|---|---|---|
| Specialistische zakelijke dienstverlening | ~381,000 | ~21% |
| ICT | ~79,000 | ~4% |
| Bouw | ~224,000 | ~12% |
| Zorg | ~200,000 (derived) | ~11% |

Advies + ICT alone is ~460,000 people before creatives and media, roughly twice bouw. CBS (main
income only) counts 1.2M zzp'ers, 62,000 fewer in 2025, with the decline concentrated in bouw and
zorg (each about −20,000 in a year) and explicitly linked to DBA enforcement; ICT, media and
overige zakelijke dienstverlening grew. **The white-collar dienstverlener is the largest and the
most resilient segment.** Caveat: the gap between 1.8M registered and 1.2M main-income says many
registered dienstverleners are part-time, which lowers willingness to pay.

## 2. How they differ from the trades — and why that is good news for BoekBrug

| | Trade (bouw, garage, schoonmaak) | Dienstverlener |
|---|---|---|
| Unit of work | a job with parts, a vehicle, a location | an opdracht of hours, sometimes a fixed price |
| The leak | parts and meerwerk not on the invoice | hours not invoiced, scope creep, late month-end invoicing |
| Costs | materials, subcontractors, fuel | almost none per job; margin ≈ hours × rate minus time |
| Documents | werkbon, offerte, bon | offerte, urenstaat, contract (DBA) |
| Extra tax load | btw on materials, verlegd in bouw | EU clients (verlegd + ICP), urencriterium, DBA |
| Tooling today | garage/planning software, nothing for money | Moneybird, Jortt, Tellow, e-Boekhouden with hours built in |

The trades needed things BoekBrug did not have (vehicles, parts, locations, visits). The
dienstverlener needs what BoekBrug's Core already is: customers, hours, offertes, invoices, the
aangifte, the accountant. **The dienstverlener is closer to the Core than any trade is.** That is
the owner's intuition, and the data supports it.

The counterweight: it is also the segment every package already serves with hours and projects.
BoekBrug does not win there on "we have hours too". It wins only on the thesis: **the money that
leaks between the hours and the invoice, shown and stopped**, plus one thing nobody offers (§5).

## 3. Their working model, in numbers

- Hours × rate is the spine: IT consultants ~34 declarable hours a week at ~€108; other consultants
  ~€121; all-zzp average ~€83. Declarable share 60–80%; the other 20–40% (acquisition, admin,
  learning) still counts for the urencriterium, so both kinds of hours must be recorded and kept
  apart.
- Projects with offertes and deelfacturen; aanbetalingen of 25–50% are normal (consumers max 50%);
  advice in the field for anything over two weeks: 40/40/20, not one invoice at the end.
- Retainers and strippenkaarten: coaches, trainers and support-type freelancers sell bundles of
  4/10/20 hours paid up front, or a monthly abonnement. That is a prepaid balance hours draw
  down against, with an expiry.
- Reiskosten charged to the client are revenue (btw applies, or verlegging with the rest).
- EU clients: btw verlegd, the client's VAT number on the invoice, the amount in the aangifte and
  in the Opgaaf ICP for the same period.
- Wet DBA since 1 January 2025: enforcement is on the opdrachtgever, which is why clients drop
  zzp'ers; the zzp'er's own exposure is losing zelfstandigenaftrek and mkb-winstvrijstelling
  retroactively. 2026: no verzuimboetes, vergrijpboetes possible; 2027 announced as normal
  enforcement. The rechtsvermoeden law (below €38/hour the worker may claim employment) was
  adopted in June 2026, in force around 1 January 2027. "70% from one client" and "three clients"
  are VAR-era folklore, not law; what counts is extern ondernemerschap: number of clients, own
  rate, acquisition, own investments.
- 2026 fiscal: urencriterium 1,225 hours; zelfstandigenaftrek €1,200 (2027: €900);
  mkb-winstvrijstelling 12.7%.

## 4. What the market offers, and what is table stakes

Moneybird: hours with timer, projects with an hours budget and remaining view, unbilled hours
into an invoice, no kilometres. Jortt: hours and projects free, urencriterium report with direct
and indirect hours. Tellow: hours in the mobile app. e-Boekhouden: hours per project and activity,
one click to invoice. SnelStart: nothing built in. Rompslomp and MoneyMonk: hours plus a km log
tied to client and project. Simplicate and Gripp (bureau tier, from ~€245 a month): offerte →
project budget → hours → onderhanden werk → nacalculatie.

Table stakes for a dienstverlener: hours per client/opdracht, a billable flag, a budget with a
remaining view, one tap from unbilled hours to an invoice, offerte → opdracht → (deel)factuur, an
urencriterium report, a km log on the client. Open in the zzp tier: prepaid bundles with
drawdown, work-in-progress value, meerwerk flagging, and a DBA dossier.

## 5. Where BoekBrug stands today

| Need | In the app | Gap |
|---|---|---|
| Hours per opdracht → invoice | uren screen, attach to work, readiness, verzamelfactuur | no billable/non-billable flag; every hour is presumed billable |
| Urencriterium | 1,225-hour meter on the uren screen | counts only recorded hours; non-billable hours have no home |
| Opdracht with agreed hours and budget | DIENST skin: referentie, afgesproken uren; over-budget signal | no maandbedrag/retainer on this skin (the schoonmaak skin has it) |
| Strippenkaart / prepaid bundle | — | a prepaid balance that hours draw down against, with expiry |
| Offerte → opdracht → deelfactuur | offertes, aanbetaling, final invoice settles it, [OFFERTE-WERK] turns the accepted offerte into the opdracht | — |
| Reiskosten | reiskosten line kind (per km) on the opdracht; [RITTEN] the kilometre log per trip, with the year's deduction | billing a logged trip to a customer is still a second step |
| EU clients | verlegde-btw.ts, icp.ts, ICP in the aangifte | — |
| Unbilled hours signal | hours without a rate on Vandaag and Werk; [UREN-OUD] priced hours older than 30 days, in euros | — |
| Retainer overuse | — | hours against the bundle, and the moment it is exceeded |
| DBA dossier | [OPDRACHTGEVER] per client: revenue, share, hours, invoices | tariff history and contracts |
| Month-end batch invoicing | verzamelfactuur per client, recurring invoices | a "factureer alle klare uren" moment at month end |

Everything in the left column exists and is gated. Everything in the right column is small next
to what the trades needed, because it is arithmetic on rows the app already has.

## 6. The leaks BoekBrug can measure for them from day one

- Hours worked but not invoiced (with a rate, on no invoice, older than N days) in euros.
- Hours on an opdracht beyond its agreed hours (scope creep) in euros.
- Reiskosten lines on work that never reached an invoice.
- Days from the last hour on an opdracht to its invoice.
- Revenue share per opdrachtgever this year (the DBA number the owner should know).

## 7. Built on 9 September (the owner's decision: build the four, as the primary segment)

| Item | What it is | Where |
|---|---|---|
| [DECLARABEL] | A billable flag on every hour. Own time (acquisitie, administratie, leren) counts in full for the urencriterium and never for an invoice; the criterion panel names both halves; own time no longer raises the missing-rate warning. | `time_entries.billable`, `uren.ts`, the hours screen |
| [RETAINER] | maandbedrag + einddatum on the dienstverlening opdracht — the schoonmaak contract's arithmetic, billed per period under the optimistic lock, with the sixty-day renewal countdown. | `werk.ts` (DIENST skin) |
| [STRIPPENKAART] | Hours sold up front: invoiced once while the row STAYS OPEN, the balance (sold, used, left) on the work, the overrun stated in hours and never acted on. Prepaid hours are never "waiting for an invoice". | `werk.ts`, `stampBundle`, the work door |
| [UREN-OUD] | Hours worked, priced, and still on no invoice after thirty days — in euros, on Vandaag and on the Werk screen, leading to the hours screen. The segment's largest leak. | `werk-stand.ts`, `workSignals` |
| [OFFERTE-WERK] | The accepted offerte becomes the opdracht: its client, its lines and its amount as the begroting. One offerte becomes one piece of work, and it is archived the moment it does, so there is one door to the money. Deleting the work reopens it. | `werk.ts`, `/api/werk`, the work screen |
| [OPDRACHTGEVER] | Who this year's money came from: per client the revenue, the share, the hours, the invoices; the count and the largest share. Facts only — no threshold, no verdict, because there is no rule to check against. | `opdrachtgevers.ts`, `/api/opdrachtgevers`, the Jaar screen |
| [TARIEF-KLANT] | The rate agreed with a customer, on the customer, offered when an hour is written for them. Fills an empty field only; a rate we filled in follows the switch to another customer instead of standing under a name that never agreed it. The hours screen also names the declarabel share as a percentage. | `clients.default_hourly_rate`, `uren.ts`, the hours screen |
| [ONDERHANDEN-WERK] | What was worked and not yet invoiced on the last day of the book year, per customer. "Not yet invoiced" is a question about the INVOICE's date: December hours billed in January are onderhanden werk on 31 December. Unpriced hours are counted and named, never valued. | `onderhanden-werk.ts`, `/api/onderhanden-werk`, the Jaar screen |
| [RITTEN] | The kilometre log. Per trip: date, from, to, purpose, distance, and what the customer pays per kilometre. The year gives the business kilometres and the deduction at the statutory rate for THAT year — a law, looked up by year, never stored on a row. | `mileage_entries`, `ritten.ts`, `/api/ritten`, the hours screen |

What was deliberately NOT built: a timer (the hours screen says why in its own header), a
kostprijs per hour (the owner prices as they like), and any judgement about schijnzelfstandigheid.

## 8. Recommendation

1. **Put dienstverleners in the test, beside bouw, not after it.** Two cohorts of five in the same
   four to six weeks. They are more numerous, easier to reach online, cheaper to onboard (no
   parts, no vehicles, no locations), and their leak is measurable from the first week. If the
   money BoekBrug finds is larger or clearer for one cohort, that decides the order of the
   verticals — with data, not with a hunch.
2. **Build nothing before the test.** The DIENST skin, the uren screen, the offerte, the
   aanbetaling, the ICP and the verlegging are enough to run it.
3. **If dienstverleners win, the first batch after the test is four small things**, in this order:
   a billable flag on hours (fixes the urencriterium too); a maandbedrag and a strippenkaart
   balance on the DIENST opdracht (the schoonmaak contract code does most of it); the "unbilled
   hours older than 30 days, in euros" signal; the DBA dossier per opdrachtgever from the
   invoices the app already holds.
4. **Positioning for them** is the same sentence: BoekBrug verbindt Werk en Geld. For a
   dienstverlener the Werk is hours, and the sentence reads: "Je hebt 14 uur gewerkt die nog op
   geen factuur staan — € 1.512."

## Sources

CBS: "Afname aantal zzp'ers na jarenlange stijging" (2025); "Aantal zzp'ers in 2025 gedaald met
62 duizend" (2026); FAQ "Wat voor werk doen zzp'ers". KVK via ZiPconomy: Q1 2026 (381k SZD, 224k
bouw, ICT 79,135) and Q2 2026 (1,805,194) monitors. Accountant.nl: "Minder zzp'ers, meer vast
personeel in bouw en zorg" (2026). Rijksoverheid: handhaving per 1 januari 2025; geen boetes in
2025; kabinetsbrief 6 maart 2026 (VBAR withdrawn, Zelfstandigenwet 2028). Eerste Kamer 36.783
(rechtsvermoeden uurtarief). KVK: uurtarief lager dan 38 euro. ZiPconomy (Feb 2025): Belastingdienst
weegt ondernemerschap zelden mee. ZZP Nederland: hoeveel opdrachtgevers. Ondernemersplein:
zelfstandigenaftrek 2027. Belastingdienst: mkb-winstvrijstelling, urencriterium, diensten aan
EU-afnemers, tijdvak Opgaaf ICP. Moore DRV: kilometervergoeding 2026. Knab: uurtarief
IT-consultant, niet-declarabele uren, aanbetaling. Accountant.nl (Knab 2025): helft van zzp'ers
krijgt te laat betaald. Moneybird blog and helpcenter (55% on time; uren; budget; kilometers not
supported). Jortt, Tellow, e-Boekhouden, SnelStart kennisplein, Rompslomp, MoneyMonk, Simplicate,
Gripp product pages. Werkbon.nl (5–15% lost revenue, unsourced). Juridisch Advies voor Bedrijven
(meerwerk zonder handtekening, 2026). Winstwaker (strippenkaart).
