// src/lib/audit.ts
// [BOEK-SECURITY-2] Audit logging helper — v2 — May 2026
// [BOEK-FOUNDATION-TYPES] Use Supabase Json type for jsonb columns — May 2026
// [BRIDGE-EXTRACT] + 'document.duplicate_blocked' added to AuditAction union — Jun 2026
// [BOEK-SAFECORE] + 'invoice.arithmetic_blocked' added to AuditAction union — Jun 2026
// =====================================================
// التغييرات في v2:
//   + أُضيف 'invoice.duplicated' للـ AuditAction union
//   + أُضيف 'creditnota.created' (بدلاً من invoice.creditnota_created)
//     للاتساق مع الـ ٤٠ historical rows في DB
//   + Json type cast للـ jsonb columns
// =====================================================
// يسجّل critical actions في audit_logs (GDPR compliance)
// كل writes تمر عبر service_role
// Non-fatal: لو الـ audit log فشل، العملية الأساسية تستمر
// =====================================================

import { createPipelineClient } from '@/lib/supabase-pipeline'
import type { Database } from '@/types/database.types'

// [BOEK-FOUNDATION-TYPES] Json type matches Supabase jsonb column type
type Json = Database['public']['Tables']['audit_logs']['Row']['old_value']

// ── Types ─────────────────────────────────────────────

/**
 * Discrete action codes — lowercase dot-notation.
 * Group prefix indicates domain (invoice., accountant., document., user., email.)
 *
 * NOTE: Some actions match the existing 40 historical audit rows for consistency:
 *   - 'invoice.duplicated', 'invoice.updated', 'invoice.deleted'
 *   - 'creditnota.created' (NOT 'invoice.creditnota_created')
 */
export type AuditAction =
  // Level 1 — Financial (critical)
  | 'invoice.created'
  | 'invoice.updated'
  // [VOORSTEL] The accountant's correction proposal and the client's answer to it.
  // [GROOTBOEK] The cost account an invoice was put on. It decides where the money lands in the
  // auditfile, so changing it belongs in the trail like any other booking decision.
  | 'invoice.ledger_account_set'
  // [WACHTKOPPELING] Een betaling die de eigenaar al deed, vóór de bankregel er was.
  | 'wachtkoppeling.created'
  | 'wachtkoppeling.linked'
  | 'wachtkoppeling.withdrawn'
  | 'invoice.correction_proposed'
  | 'invoice.correction_accepted'
  | 'invoice.correction_declined'
  | 'invoice.deleted'
  | 'invoice.duplicated'              // ← v2: matches historical data
  // [HERSTEL] A SENT invoice was edited in place (same number) — allowed only while nothing is
  // attached to it (no payment, bank/kas link, creditnota, verwerkt-lock or filed quarter), and
  // the customer automatically receives the corrected document. This row is the trail that makes
  // rewriting an issued document honest: the FULL pre-edit header and lines live in old_value,
  // what replaced them in new_value — totals alone would record an address fix as "no change".
  | 'invoice.corrected'
  | 'invoice.dedup_override'          // ← [INTAKE-FORCE] owner added despite a semantic-duplicate match ("toch toevoegen")
  | 'invoice.status_changed'
  // [OFFERTE-VERSTUREN] De offerte is als OFFERTE naar de klant gemaild — geen nummer, geen
  // conversie. Eigen actie en niet 'invoice.status_changed', omdat dit de enige regel is waaruit
  // later blijkt dát er een voorstel de deur uit is gegaan en wanneer: de offerte zelf draagt geen
  // nummer en geen verzendspoor, en bij een geschil over "wat is er aangeboden" is dit het bewijs.
  | 'offerte.sent'
  // [OFFERTE-AKKOORD] De KLANT heeft ja of nee gezegd, via de link in de offertemail. De enige
  // regel in dit logboek die niet door de ondernemer of de app is gezet maar door iemand buiten
  // het bedrijf — en daarom precies de regel die bewijst wat er is afgesproken en wanneer. De
  // ingetypte naam gaat mee: die is niet te verifiëren, en dat is een reden om hem VAST te leggen
  // zoals hij is getypt, niet om hem weg te laten.
  | 'offerte.answered'
  | 'invoice.auto_verified'           // ← [AUTO-ADVANCE] app moved a clean, confident invoice processing→received without a tap
  | 'invoice.auto_paid'               // ← [BON-AUTO] app settled a kassabon whose PAPER printed the tender line ("Kontant"/"Bankpas")
  // [TWEEDE-KANS] The owner asked the app to read a stored file again — one it had kept because it
  // could not read it. Its own action because it is the only way an invoice enters the books from a
  // document that was already filed as unreadable, and an auditor asking "where did this cost come
  // from, and why did it appear months after the file did" has no other answer.
  | 'invoice.reread_from_document'
  | 'invoice.reimported'              // ← [REIMPORT] owner re-read a queued invoice's PDF with the current extractor
  | 'invoice.btw_rows_read'          // ← [SPLIT-ALSNOG] owner re-read a document for its btw specification ONLY — no figure changed
  | 'bank.auto_confirmed'             // ← [BANK-AUTO-CONFIRM] app booked a near-certain bank↔invoice match without a tap
  | 'bank.auto_confirmed_batch'       // ← [BANK-BATCH] app booked a provably-exact multi-invoice batch payment
  | 'bank.confirmed_batch'            // ← [SOM-KLOPT-ÉÉN] the OWNER booked a suggested same-supplier sum as one batch
  | 'bank.confirmed'                  // ← [BANK-CONFIRM] owner confirmed a bank↔invoice match (invoice fully paid)
  | 'bank.partial_payment'            // ← [PARTIAL-PAY] a deelbetaling booked against an invoice (still openstaand)
  // [BETAALPLAN] One payment deliberately spread by the OWNER over several invoices, with an
  // amount per invoice. Distinct from bank.auto_confirmed_batch, which is the app booking a batch
  // it could prove: this one is a human decision about which invoice got which euros, and when a
  // quarter is questioned that difference is the whole question.
  | 'bank.payment_allocated'
  | 'bank.overpayment_residue'        // ← [PARTIAL-PAY-RESIDUE] payment exceeded the balance; the excess was NOT booked
  | 'invoice.partial_payment'         // ← [MANUAL-PARTIAL-PAY] owner recorded a deelbetaling by hand (invoice stays openstaand)
  | 'bank.unlinked'                   // ← [BANK-UNLINK] owner undid a bank↔invoice match (invoice back to unpaid)
  | 'bank.attachment_added'           // ← [BIJLAGE-BIJ-REGEL] owner attached a file to a bank line (no booking)
  | 'bank.attachment_removed'         // ← [BIJLAGE-BIJ-REGEL] owner removed such a file
  | 'bank.line_deleted'               // ← [REGEL-WEG] owner deleted an unlinked bank line; its identity is in old_value
  | 'bank.storno_applied'             // ← [STORNO] owner confirmed a reversed incasso: origin unlinked, both lines set aside
  // [KAS-AUTO-BOOK] The other answer to the "even controleren" flag. 'bank.unlinked' records the
  // owner rejecting an amount-only booking; this records them ACCEPTING one, which until now left
  // no trace at all — the flag simply stayed up forever. It matters more than it looks: under the
  // kasstelsel an amount-only match may book itself only because it is reversible until the
  // aangifte, so who confirmed it, and when relative to the filing, is the evidence that the review
  // actually happened.
  | 'bank.match_checked'              // ← [KAS-AUTO-BOOK] owner confirmed an amount-only auto-booking is the right invoice
  // [ORIGINEEL] The client supplied the original document for an invoice that had none — the answer
  // to the accountant's "opvragen". Its own action because it is the only write in the app that
  // adds EVIDENCE to a booked invoice without touching a single figure, and an auditor asking
  // "when did the proof for this line arrive, and was it before or after the aangifte" has no
  // other way to know.
  | 'invoice.document_attached'       // ← [ORIGINEEL] an original was attached to an existing invoice
  | 'invoice.document_replaced'       // ← [BETER-EXEMPLAAR] a better copy of the SAME paper replaced it; the old row is KEPT
  // [FACTUURVRAAG] The accountant asked their client about ONE invoice. Its own action because it
  // is the only accountant write that is a QUESTION rather than an assertion about the books — and
  // because a status that says 'vraag' with no record of who asked, when, or about which client's
  // administration is the shape this whole feature exists to replace.
  | 'accountant.invoice_question'     // ← [FACTUURVRAAG] accountant asked the client about one invoice
  // [BANK-IGNORE-AUDIT] Ignoring a bank line moves a financial record out of every queue that
  // could still explain it — the matcher, auto-confirm, auto-categorize, the nightly sweep, and
  // every categorize read. It also deletes the [VOORBELASTING-RISK] warning for that line, since
  // undocumentedCount is pending-scoped. That is the most consequential one-tap disposition in
  // the bank folder, and it was the only one writing no audit row at all: six bank actions were
  // logged, this one silently. An auditor asking "who set this line aside, and when" had nothing.
  | 'bank.ignored'                    // ← [BANK-IGNORE] owner set an unmatched line aside ('not_found')
  | 'bank.restored'                   // ← [BANK-IGNORE] owner took it back into the active list
  // [BANK-REMATCH] Distinct from 'bank.restored' on purpose: that one records a line the owner
  // picked back up by hand, this one records lines the "probeer alles opnieuw" pass reactivated
  // because an invoice had since arrived. Same state change, different author — and only the
  // second one needs the run's whole id list to explain why several lines moved at once.
  | 'bank.rematch_restored'           // ← [BANK-REMATCH] a forced re-match put set-aside lines back
  | 'bank.overapplied'                // ← [BANK-OVERAPPLIED-LOUD] Σ amount_applied exceeds the bank line (concurrent confirms) — flagged, never silent
  | 'bank.overapplied_check_failed'   // ← …and when that check could not RUN. Without this row, 'no alarm' meant both 'the sum is fine' and 'we never looked'.
  | 'creditnota.created'              // ← v2: matches historical data
  | 'invoice.archived'                 // ← [INVOICE-REMOVE] owner removed an invoice from the books (kept 7 years, reversible)
  | 'invoice.restored'                 // ← [INVOICE-REMOVE] owner put an archived invoice back
  | 'invoice.payment_moved'             // ← [MOVE-PAYMENT] owner moved a booked payment from one invoice to another (atomic; newValue carries both ids and both resulting amount_paid)
  | 'invoice.duplicate_dismissed'
  // [MULTI-INVOICE] De eigenaar overrulede het vermoeden dat één bestand meerdere facturen bevat
  // ("nee, dit is één factuur"). Een eigen actie en geen hergebruik van duplicate_dismissed: dat
  // gaat over twee facturen die hetzelfde zijn, dit over één bestand dat er meer zou bevatten —
  // en het spoor moet later kunnen zeggen wie besloot dat die andere facturen niet bestaan.
  | 'invoice.multi_invoice_dismissed'       // ← [SUPERSEDE] owner answered the duplicate warning the other way: "no, this is a different invoice". Its own act, never inferred from a plain confirm - that tap means the amounts are right, not that two documents were compared.
  | 'invoice.superseded'               // ← [SUPERSEDE] owner said "deze vervangt die": the corrected re-issue replaced the old invoice, which was archived. newValue carries superseded_by_id — the id-exact link both ways, which the display column (superseded_by_number) deliberately does not.
  | 'invoice.numbering_configured'     // ← [FACTUUR-B] start point set/changed
  | 'invoice.numbering_change_blocked' // ← [FACTUUR-B] locked change refused (Art. 35)
  | 'invoice.arithmetic_blocked'       // ← [BOEK-SAFECORE] auto-import held in 'processing': excl+BTW≠incl, illegal rate, or NaN/∞/≤0/bad-date
  // [KAS-SPOOR] The cash drawer's three doors, which landed no audit row at all.
  //
  // Every other money write in this app is on this list — the bank confirm, the pay-toggle, an
  // amount correction, an imported turnover day AND its removal, a filed quarter, a deleted bank
  // statement. The drawer was the one ledger missing, and it is the one where that is least
  // defensible:
  //   · it is the only ledger the owner writes BY HAND, with no bank statement and no supplier
  //     document standing behind the row — the audit row is the only witness there is;
  //   · a delete is a HARD delete (cash_entries keeps no reversal row), so once the line is gone
  //     nothing anywhere says it existed. Removing a turnover day has had its own action since
  //     [DAGOMZET-AUDIT] for exactly this reason, and a cash movement is the same kind of money;
  //   · and the beginsaldo is an input to EVERY eindsaldo in the owner's whole history, including
  //     quarters already filed. It is changed from a small link on the Kas screen, and moving it is
  //     enough to turn a drawer the negative-cash gate refuses a filing on into one it passes.
  //
  // That last one is why these are Level 1. The app BLOCKS a BTW-aangifte on this drawer
  // (readiness.ts, and /api/btw/file via loadDrawerWitness). Accusing an owner on the strength of a
  // number that anyone could move without leaving a trace is half a gate; and the owner who did
  // nothing wrong had no way to show that either.
  | 'cash.entry_added'                 // ← [KAS-SPOOR] a manual cash movement (sale, expense, storting/opname, prive)
  | 'cash.entry_removed'               // ← [KAS-SPOOR] a cash movement deleted; oldValue is the only record that it existed
  | 'cash.opening_balance_set'         // ← [KAS-SPOOR] the drawer's starting float changed; oldValue carries what it was
  | 'turnover.auto_imported'           // ← [SHEET-INTAKE] app booked a clean kassa Z-report into daily_turnover from the upload page
  // [KASBOEK-LEZEN] Een kasboek van de boekhouder is GELEZEN en geteld — en met opzet niet geboekt
  // (zie het blok in /api/intake). De naam zegt dat: 'read_only', want een spoor dat een import
  // suggereert waar niets is geboekt, is een spoor dat later verkeerd wordt gelezen.
  | 'kasboek.imported_read_only'
  // [KASBOEK-NAAST-KAS] En de tegenhanger: de eigenaar heeft ZELF dagen aangevinkt uit dat kasboek
  // en die als kasuitgave laten boeken. Dít is wél geld, en het spoor moet dat zeggen — anders
  // staat er straks een uitgave in de lade waarvan niemand kan zien waar hij vandaan kwam.
  | 'kasboek.gap_booked'
  // [DAGOMZET-AUDIT] Removing a booked day is a REVERSAL out of the BTW-authoritative table, not
  // an import. It shared 'turnover.auto_imported' with the write that creates the day, so the
  // trail could not answer "which turnover days were removed" — the two were distinguishable only
  // by a `via` field inside the JSON payload. A reversal of money deserves its own name.
  | 'turnover.day_removed'             // ← [COHERENCE-TURNOVER-DELETE] owner removed one booked turnover day (wrong date / wrong period)
  // [KASSA] A shop without a till rings its revenue up here, and these two are the ONLY trail that
  // it happened. There is no Z-report behind them, no bank line and no supplier document — what the
  // day says is what the owner tapped, exactly the argument that put cash.entry_added on this list.
  // The void gets its own name for the reason turnover.day_removed does: money going back out of
  // the BTW-authoritative day is a reversal, not a smaller sale, and "which tickets were voided" is
  // a question the trail has to be able to answer on its own.
  | 'till.ticket_rung'                 // ← [KASSA] owner rang up one ticket; newValue carries its lines and the day's new total
  | 'till.ticket_voided'               // ← [KASSA] owner voided a ticket; oldValue is the only record that those lines existed
  | 'turnover.day_entered'             // ← [KASSA] owner typed a whole day's takings by hand (no till, no Z-report)
  | 'ledger.auto_imported'             // ← [SHEET-INTAKE] app stored a PIN/kas grootboek export into ledger_daily (reconciliation witness)
  | 'btw.filed'                        // ← [TRUTH-FILED] owner froze a quarter's BTW-aangifte snapshot as ingediend
  | 'btw.filed_despite_warnings'       // ← [FILING-GATE] owner froze the snapshot while readiness blockers were still open (acknowledged)
  | 'btw.filing_unlocked'              // ← [FILING-UNLOCK-AUDIT] owner removed a filing (quarter unlocked); oldValue carries the snapshot that was deleted
  | 'btw.correction_carried'           // ← [SUPPLETIE-VERREKEND] owner declared an earlier quarter's ≤€1.000 correction in a later aangifte; newValue carries the amount and the target quarter
  // Level 2 — Accountant relationships
  | 'accountant.client_invited'
  | 'accountant.client_linked'
  | 'accountant.client_unlinked'
  | 'accountant.invoice_status_set'
  // [MANDAAT] De klant machtigt zijn boekhouder om facturen op zijn naam uit te reiken (art. 35
  // lid 1 Wet OB), of trekt dat in. Dit hoort in het auditspoor en niet alleen in de tabel: de
  // ondernemer blijft zelf aansprakelijk voor elke factuur die onder zijn nummer uitgaat, dus de
  // vraag "wanneer heb ik dit gegeven, en wie heeft het beëindigd" moet jaren later nog een
  // antwoord hebben.
  | 'accountant.invoice_mandate_granted'
  | 'accountant.invoice_mandate_revoked'
  // [OPVRAGEN] De boekhouder vroeg zijn klant om de ontbrekende stukken van een kwartaal. In het
  // spoor omdat het antwoord op "waarom is dit kwartaal zo laat ingediend" vaak precies hier ligt:
  // wanneer is er gevraagd, en hoe vaak.
  | 'accountant.documents_requested'
  // [BEVESTIGEN] De boekhouder heeft een inkoopfactuur van zijn klant bevestigd (processing →
  // received). Hoort in het spoor omdat de aansprakelijkheid NIET meeverhuist (art. 52 AWR): de
  // vraag "wie heeft dit geboekt, en wanneer" moet jaren later nog een antwoord hebben, ook als
  // de machtiging allang is ingetrokken en de kolom confirmed_by is overschreven.
  | 'accountant.invoice_confirmed'
  // [VRAAG-MACHTIGING] De boekhouder heeft zijn klant om een machtiging gevraagd. Staat hier niet
  // alleen als spoor: deze rij IS de wachttijd. Twee keer vragen is zeuren, en de vorige vraag
  // moet ergens duurzaam staan zonder daar een tabel voor op te tuigen.
  | 'accountant.mandate_requested'
  // [WAARSCHUWING] De 30-dagenbrief van voorwaarden art. 5.7.5 is verstuurd. Dit is het enige
  // spoor dat later kan aantonen DAT er is gewaarschuwd voordat er iets werd gewist — de kolom
  // purge_warning_sent_at kan worden overschreven, een auditregel niet.
  // [ACTING-FOR] Een herinnering die MET DE HAND is verstuurd (de cron logt in invoice_reminders,
  // niet hier). Aan de andere kant zit een klant van de ondernemer; wie op die knop drukte hoort
  // dus terug te vinden te zijn — zeker als dat een medewerker was en niet de eigenaar zelf.
  | 'invoice.reminder_sent'
  // [ACTING-FOR] Wie mag er onder MIJN BTW-nummer factureren?
  //
  // Dit is de zwaarste bevoegdheid die een eigenaar kan weggeven: een verkoopmedewerker geeft
  // facturen uit met het nummer, de naam en het BTW-id van zijn baas, en dat is bij een controle
  // niet te onderscheiden van de baas zelf. Zowel het geven als het intrekken hoort dus
  // aantoonbaar te zijn — een bevoegdheid zonder spoor is achteraf een woord tegen een woord.
  | 'member.invited'
  | 'member.joined'
  | 'member.revoked'
  // [BEWIJS] Wat de boekhouder van zijn klant HEEFT OPGEHAALD.
  //
  // De vertrouwensgrens was afgedwongen maar niet aantoonbaar: de klant kon nergens zien
  // wat zijn boekhouder had ingezien of gedownload. Precies dát is het verschil dat dit
  // product verkoopt tegenover een gedeelde OneDrive-map — en het was een bewering, geen
  // feit. Een gedeelde map laat ook niets zien; het verschil bestaat pas als het te tonen is.
  //
  // Alleen de OPHAALHANDELING wordt vastgelegd, nooit de inhoud: entity_id is de eigenaar
  // plus het kwartaal, en sanitizeForAudit strijkt sowieso alles wat er niet in hoort.
  | 'retention.warning_sent'
  | 'accountant.package_downloaded'   // ← het kwartaalpakket (ZIP) opgehaald
  // [PAKKET-LINK] Hetzelfde feit, maar opgehaald via een deel-link door een boekhouder ZONDER
  // account. Apart van de regel hierboven omdat er geen ingelogde gebruiker achter zit: het
  // token is de credential, en de eigenaar is de enige die het kan terugzien.
  | 'package.link_downloaded'
  // [PAKKET-LINK] De ondernemer overhandigde zijn kwartaal, en aan wie. Dit is zijn eigen spoor:
  // "naar wie heb ik mijn boeken gestuurd, en wanneer" — bij een deel-link de enige plek waar dat
  // staat, want de ontvanger heeft geen account om het aan te hangen.
  | 'package.link_shared'
  | 'package.link_revoked'
  | 'accountant.export_downloaded'    // ← een CSV/UBL-export opgehaald
  // [AUTO-INCASSO] The owner declaring that a supplier collects its own invoices. It belongs at
  // this level because of what follows from it: from that moment the app books that supplier's
  // invoices as PAID once their vervaldatum has passed, without anyone having watched the money
  // leave. The individual bookings are audited as 'invoice.status_changed' like every other
  // payment; this row is the MANDATE they all rest on, and the only place that answers "since when
  // was the app allowed to assume this, and who said so".
  | 'supplier.auto_incasso_on'
  | 'supplier.auto_incasso_off'
  // [LEVERANCIER-BEWERKEN] The owner edited the master record; old_value/new_value hold the fields that moved.
  | 'supplier.updated'
  // [LEVERANCIER-NIEUW] The owner added a supplier by hand, or adopted one the balance showed.
  | 'supplier.created'
  | 'supplier.deleted'
  // [LEVERANCIER-SAMENVOEGEN] Two supplier rows declared one company, and the invoices of one moved
  // under the other's name. At this level because it REWRITES what already-booked invoices say
  // about who sent them — the identity key the IBAN-change check, the incasso mandate and the
  // crediteurenstand all resolve through. The row records WHY it was allowed (a shared KVK or a
  // shared account, and the value itself), so "who decided these were one company, on what" has an
  // answer that is not a name that looked similar.
  | 'supplier.merged'
  // Level 3 — Files
  | 'document.uploaded'
  | 'document.duplicate_blocked'      // ← [BRIDGE-EXTRACT] byte-hash dedup: re-upload of identical file refused
  | 'document.deleted'
  | 'document.bulk_deleted'
  | 'document.restored'
  // [HERINNERING-NOOIT] A payment reminder kept as a file and never booked; names the invoice it
  // was matched to, or says none was. The trail behind "waar is die herinnering gebleven".
  | 'document.reminder_filed'
  // [WERK] The trade's own work: a werkorder, rit, klus or opdracht opened, moved, invoiced, removed.
  // Level 3: the row carries no money; the invoice it becomes is logged by the invoice actions.
  | 'work.created'
  | 'work.status_changed'
  | 'work.invoiced'
  | 'work.deleted'
  // [WERK-BEURT] A beurt ticked off on repeating work.
  | 'work.visit_recorded'
  // [ARTIKELEN-WIPE] The owner emptying their whole article catalogue in one action. Level 3 and
  // not Level 1 on purpose: articles are TEMPLATES — invoice_lines copied their text, price and
  // btw-rate at the moment a line was made — so no invoice, total or aangifte moves by a cent.
  // What is destroyed is the list itself, permanently, which is exactly what an audit row is for.
  | 'article.bulk_deleted'
  // [VAK-BRUG] The owner filled an empty price list from his trade's template in one action. Same
  // level and same reasoning as its sibling above: articles are TEMPLATES, so no invoice, total or
  // aangifte moves. What the trail records is that these lines came from a SJABLOON rather than
  // from him — which is the question worth being able to answer later, because the template chose
  // the btw-rate and he chose only the price.
  | 'article.seeded_from_vak'
  | 'folder.created'
  | 'folder.deleted'
  | 'folder.renamed'
  // Level 4 — Security / account
  | 'user.password_changed'
  | 'user.email_changed'
  | 'user.account_deletion_requested'
  | 'user.data_purged'                // ← [A1] retention purge erased a deactivated account's files after the 7-year bewaarplicht ran out. IRREVERSIBLE — this is the only record that it happened.
  | 'email.connection_created'
  | 'email.connection_revoked'
  // [AFZENDERREGEL] Een regel die post ONGEZIEN tegenhoudt is een besluit met gevolgen —
  // aanmaken én opheffen horen allebei in het spoor, zodat achteraf te zien is sinds wanneer
  // er niets meer van een adres binnenkwam.
  | 'email.sender_rule_created'
  | 'email.sender_rule_deleted'
  // Level 5 — Boekhoudkoppelingen
  | 'snelstart.connected'             // ← [SNELSTART] maatwerksleutel gekoppeld (of vervangen)
  | 'snelstart.disconnected'          // ← [SNELSTART] koppeling verbroken, sleutel uit Vault
  | 'snelstart.pushed'                // ← [SNELSTART] facturen als boeking naar de administratie gestuurd
  | 'snelstart.hold_acknowledged'     // ← [PUSH-ACK] eigenaar tikte een voorbehoud af: "ik weet het, stuur toch door"
  // [ENABLEBANKING] De PSD2-bankkoppeling. Alle drie worden vastgelegd omdat het hier om
  // LEESTOEGANG TOT EEN BANKREKENING gaat: wie die heeft gegeven, wanneer, en wanneer hij weer
  // is ingetrokken, is precies wat een auditor (of de eigenaar zelf) achteraf moet kunnen zien.
  // 'connect_started' staat er apart naast 'connected' omdat een poging die BIJ DE BANK strandt
  // anders geen enkel spoor achterlaat — en dat is nu juist de gebeurtenis die je wilt kunnen
  // terugvinden als iemand vraagt waarom er een koppeling in de lucht hing.
  | 'bank.connect_started'            // ← [ENABLEBANKING] eigenaar begon een bankkoppeling (requisitie aangemaakt)
  | 'bank.connected'                  // ← [ENABLEBANKING] toestemming gegeven bij de bank; rekeningen gekoppeld
  | 'bank.disconnected'               // ← [ENABLEBANKING] koppeling ingetrokken; de feed stopt

export interface AuditParams {
  /** Profile ID للمستخدم الذي فعل الـ action */
  userId: string
  /** نوع العملية (انظر AuditAction) */
  action: AuditAction
  /**
   * اسم الـ entity — string حر، لكن استخدم singular للاتساق مع historical data:
   *   'invoice', 'document', 'folder', 'profile', 'accountant_client', 'email_connection'
   */
  entityType: string
  /** ID الـ row المتأثر (اختياري) */
  entityId?: string
  /** القيمة قبل التغيير (للـ updates) — tokens تُحذف تلقائياً */
  oldValue?: Record<string, unknown>
  /** القيمة بعد التغيير — tokens تُحذف تلقائياً */
  newValue?: Record<string, unknown>
  /** IP العميل (من req headers — استخدم getClientIP) */
  ipAddress?: string
}

// ── PII Sanitization ──────────────────────────────────

/**
 * Fields that MUST NEVER be logged in audit trails.
 * Tokens, secrets, passwords, etc.
 */
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'refresh_token',
  'access_token_secret_id',
  'refresh_token_secret_id',
  'password',
  'password_hash',
  'token',
  'secret',
  'api_key',
])

/**
 * Strips forbidden fields from an object before logging.
 * Also caps total JSON size at 10KB per record.
 * [BOEK-FOUNDATION-TYPES] Returns Json type compatible with jsonb columns
 */
function sanitizeForAudit(
  obj: Record<string, unknown> | undefined
): Json | undefined {
  if (!obj) return undefined

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_FIELDS.has(key)) continue
    cleaned[key] = value
  }

  // حد الحجم — 10KB أكثر من كافٍ، يمنع DoS عبر large jsonb
  const json = JSON.stringify(cleaned)
  if (json.length > 10_000) {
    return { _truncated: true, _size: json.length, _preview: json.slice(0, 1_000) } as Json
  }

  // [BOEK-FOUNDATION-TYPES] Safe cast — sanitized content is JSON-compatible
  return cleaned as Json
}

/**
 * [AUDIT-ENTITY-REF] audit_logs.entity_id is een `uuid`-kolom, maar niet elke gebeurtenis gaat
 * over één rij. Drie aanroepers gaven een SAMENGESTELDE sleutel mee:
 *
 *     'alle-klanten:Q2 2026'          (de boekhouder downloadt alle klanten)
 *     '<ownerId>:2026-Q2'             (de boekhouder downloadt één kwartaalpakket)
 *     '2026-Q2'                       (de aangifte wordt vastgelegd)
 *
 * Postgres antwoordde daarop met 22P02 (invalid input syntax for type uuid), logAuditAction
 * slikte die fout in een console.error — want een audit-fout mag de hoofdactie nooit breken — en
 * de rij landde NOOIT. Uitgerekend de twee gebeurtenissen waarvan het [BEWIJS]-blok zegt dat ze
 * bestaan omdat "de klant nergens kon zien wat zijn boekhouder had ingezien of gedownload",
 * schreven dus niets. Een audit-spoor dat er niet is, is erger dan geen belofte van een spoor.
 *
 * Het lag niet aan die drie aanroepers maar aan de vorm: een uuid-kolom kan dit niet dragen, en
 * de volgende aanroeper zou in dezelfde val lopen. Daarom staat de reparatie hier, op één plek:
 * een waarde die geen uuid is gaat NIET in entity_id, maar wordt bewaard als `entity_ref` in
 * new_value. De rij landt, en niets van de betekenis gaat verloren.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function splitEntityRef(entityId: string | null | undefined): {
  entityId: string | null
  entityRef: string | null
} {
  const raw = (entityId ?? '').trim()
  if (!raw) return { entityId: null, entityRef: null }
  if (UUID_RE.test(raw)) return { entityId: raw, entityRef: null }
  return { entityId: null, entityRef: raw }
}

// ── Main function ─────────────────────────────────────

/**
 * Records an audit log entry. NON-FATAL — failures are logged but do not throw.
 *
 * Uses service_role via createPipelineClient — bypasses RLS.
 * After BOEK-SECURITY-2 migration, this is the ONLY way to write audit_logs.
 *
 * @example
 *   await logAuditAction({
 *     userId: user.id,
 *     action: 'invoice.created',
 *     entityType: 'invoice',           // singular — matches historical data
 *     entityId: invoice.id,
 *     newValue: invoice,
 *     ipAddress: getClientIP(req),
 *   })
 */
export async function logAuditAction(params: AuditParams): Promise<void> {
  try {
    const supabase = createPipelineClient()

    // [AUDIT-ENTITY-REF] Een niet-uuid verwijzing hoort in new_value, niet in de uuid-kolom —
    // zie splitEntityRef hierboven voor de vier gebeurtenissen die hierdoor nooit landden.
    const { entityId, entityRef } = splitEntityRef(params.entityId)
    const newValue = sanitizeForAudit(params.newValue)
    const newValueWithRef =
      entityRef === null
        ? newValue
        : ({ ...(newValue && typeof newValue === 'object' && !Array.isArray(newValue) ? newValue : { value: newValue }), entity_ref: entityRef } as Json)

    const { error } = await supabase.from('audit_logs').insert({
      user_id:     params.userId,
      action:      params.action,
      entity_type: params.entityType,
      entity_id:   entityId,
      old_value:   sanitizeForAudit(params.oldValue),
      new_value:   newValueWithRef,
      ip_address:  params.ipAddress,
    })

    if (error) {
      console.error('[BOEK-SECURITY-2] Audit log failed', {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        error: error.message,
      })
    }
  } catch (err) {
    // Catch-all — audit يجب ألا يكسر العملية الأساسية أبداً
    console.error('[BOEK-SECURITY-2] Audit log threw', { params, err })
  }
}

// ── IP extraction helper ──────────────────────────────

/**
 * Extracts client IP from Next.js request headers.
 * Works with Vercel + standard reverse proxies.
 * Returns undefined if no IP available (tests, server-side calls, etc.)
 *
 * Accepts NextRequest, Request, or any object with headers.get(name).
 */
export function getClientIP(req: Request): string | undefined {
  // Vercel + reverse proxies → x-forwarded-for
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    // قد يكون قائمة بـ commas — أول واحد هو الـ client الفعلي
    return forwarded.split(',')[0]?.trim() || undefined
  }

  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  return undefined
}