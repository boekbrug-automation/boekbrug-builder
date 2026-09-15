// src/lib/logboek.ts
// [LOGBOEK] One row of audit_logs, turned into something a screen can render. Pure — no I/O, no
// React, no Supabase client. Run: npx tsx --test src/lib/logboek.test.ts
//
// ── WHY THIS EXISTS ──
//
// audit_logs is written from 60 files in 89 distinct actions, and not one of those rows has ever
// been rendered anywhere. That was survivable while the owner was the only person writing: what
// had happened in the administration was what they had just done themselves, and the notification
// they got at that moment was enough. It stopped being survivable when a mandated bookkeeper could
// issue invoices under the owner's BTW number, remind their customers and confirm their purchase
// invoices — every one of those rows carries the BOOKKEEPER in user_id, because user_id is the
// ACTOR. The owner, who stays liable for all of it (art. 35a Wet OB, art. 52 AWR), could see
// exactly none of it. audit_logs_client_read.sql opened the read side for that case; this module is
// the other half — the rules that turn a row into a sentence, a category and a link, with nothing
// in them that needs a database, a session or a browser.
//
// ── THE ONE RULE THIS FILE ENFORCES: NOTHING IS EVER DROPPED ──
//
// toLogboekEntry has no failure path. It does not return null, does not throw, and does not skip a
// row it cannot phrase. An audit trail that hides what it has no words for is not an audit trail:
// the gaps are invisible, so the owner reads what is left as the complete story. A row whose action
// nobody ever wrote a sentence for still comes back as an entry — hasSentence() reports that there
// is no sentence, the copy layer renders 'log.onbekend' ("Handeling vastgelegd") next to the raw
// action name, and the row is on the screen with its timestamp intact. "We cannot phrase this" and
// "this never happened" are different answers, and the screen has to be able to give the first one.
//
// ── WHY audit.ts IS NOT IMPORTED HERE, NOT EVEN FOR ITS TYPE ──
//
// audit.ts imports supabase-pipeline, which builds the SERVICE_ROLE client. This module is meant to
// be safe inside a client component. `import type` is erased under isolatedModules, so it would be
// harmless today — but the next reader who needs one VALUE from that module rather than a type
// would not notice they had just pulled the service-role client into a browser bundle. The link to
// audit.ts is therefore made by the test, which reads the AuditAction union out of the file and
// fails when the two drift apart. A gate with no runtime edge at all.

import type { MessageKey } from "./i18n/messages";

/**
 * The audit_logs columns this module reads. A structural subset of the row, so a caller may select
 * exactly these six and nothing more: old_value/new_value can hold a 10KB blob per row (see the
 * size cap in audit.ts) and this screen never shows their contents.
 *
 * `user_id` is the ACTOR — who performed the action — and not the administration it happened in.
 * That single fact is the reason this feature exists; see the header.
 */
export interface AuditRowLike {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string | null;
  user_id: string | null;
}

/**
 * The four buckets the owner can filter on. Money, paper, who-may-see-what, and everything else.
 *
 * 'system' is a real kind and not a synonym for "broken": it is where an action lands that nobody
 * has classified yet. The filter row on screen names only the first three ('log.filter.geld',
 * '.document', '.toegang') plus 'log.filter.alles' — so a system row is reachable under Alles and
 * nowhere else. That is deliberate. The alternative, filing an unclassified action under Geld
 * because most actions are money, would claim the app understands a row it does not.
 */
export type LogboekKind = "money" | "document" | "access" | "system";

/** Every kind, in the order the filter row shows them. 'system' has no chip of its own — see above. */
export const LOGBOEK_KINDS: readonly LogboekKind[] = ["money", "document", "access", "system"];

/** One line of the trail, ready to render. Every field is a fact about the row, or null. */
export interface LogboekEntry {
  id: string;
  /** The raw action, kept verbatim: it is what the screen falls back to when there is no sentence. */
  action: string;
  /** Always 'log.' + action. Ask hasSentence() before rendering it — see toLogboekEntry. */
  messageKey: string;
  kind: LogboekKind;
  /** created_at, untouched. Null stays null: a row with no timestamp says nothing about when. */
  at: string | null;
  href: string | null;
  byOther: boolean;
}

/** Every sentence in this trail lives under one prefix. */
const MESSAGE_PREFIX = "log.";

/**
 * Which bucket each action DOMAIN — the part before the first dot — belongs to.
 *
 * Matched on the whole first segment rather than with startsWith, and that is not pedantry: a
 * `startsWith("invoice")` rule files a future 'invoices_bulk.*' or 'invoiced.*' under Geld without
 * anyone deciding it should be, which is the app asserting it understands a row it has never seen.
 *
 * Two of these are judgement calls worth naming, because a reader will otherwise think they are
 * mistakes:
 *
 *   · bank.connect_started / connected / disconnected are, strictly, ACCESS decisions — they hand
 *     a third party read access to a bank account. They stay under Geld because the domain is the
 *     unit of classification here: a rule the owner can predict ("everything the bank does is under
 *     Geld") beats a rule that is right three times and surprising the fourth.
 *   · snelstart.* is a bookkeeping coupling, and 'snelstart.pushed' moves bookings into the
 *     administration proper. Money.
 *
 * Anything not on this list is 'system' — the safe default, and the only honest one for an action
 * this file has never been told about.
 */
const KIND_BY_DOMAIN: Readonly<Record<string, LogboekKind | undefined>> = {
  // Money, or the figures an aangifte is built out of.
  invoice: "money",
  creditnota: "money",
  offerte: "money",
  bank: "money",
  cash: "money",
  btw: "money",
  turnover: "money",
  // [KASSA] A shop without a kassa rings its revenue up here, and that revenue goes straight into
  // rubriek 1a/1b. It belongs in the same bucket as the Z-report it stands in for — an owner
  // filtering his logbook on money must see the sale that made the day.
  till: "money",
  ledger: "money",
  // [KASBOEK-LEZEN] Onder Geld, ook al is er niets geboekt. De filter beantwoordt "waar is aan mijn
  // geld gezeten" — en een kasboek dat is ingelezen is precies het moment waarop iemand de lade
  // langs de administratie legt. Onder 'systeem' zou hij verdwijnen tussen de aanmeldingen.
  kasboek: "money",
  supplier: "money",
  // [WACHTKOPPELING] Een betaling die de eigenaar al deed en die de bank nog niet liet zien. Onder
  // Geld en nergens anders: het gaat over euro's die het account hebben verlaten, ook al is de
  // bankregel er nog niet — en het filter beantwoordt "waar is aan mijn geld gezeten".
  wachtkoppeling: "money",
  snelstart: "money",
  // [WERK] The trade's own work: a werkorder, rit, klus or opdracht opened, moved, invoiced,
  // removed. Filed under money: the row carries no amount, but what it records is the piece of
  // work an invoice will be made of — the owner looking for "what happened to that job" looks
  // where the invoice is.
  work: "money",
  // Paper: what is filed, not what is owed. 'article' is the invoice-line catalogue — templates,
  // so no invoice or total moves when one is deleted; see [ARTIKELEN-WIPE] in audit.ts.
  document: "document",
  folder: "document",
  article: "document",
  // Who may see, and who may act on the owner's behalf.
  accountant: "access",
  // [PAKKET-LINK] Een deel-link geeft iemand ZONDER account een compleet kwartaal te lezen. Dat
  // is precies de vraag die deze bak beantwoordt — "wie mag wat zien" — en het is de enige plek
  // waar de eigenaar dat terugvindt, want de ontvanger heeft geen account om het aan te hangen.
  package: "access",
  member: "access",
  user: "access",
  email: "access",
};

/**
 * The bucket an action belongs to. Total: every string gets an answer, including "" and a string
 * with no dot in it at all.
 */
export function logboekKindOf(action: string): LogboekKind {
  const dot = action.indexOf(".");
  const domain = dot === -1 ? action : action.slice(0, dot);
  return KIND_BY_DOMAIN[domain] ?? "system";
}

/**
 * Every action that HAS a Dutch sentence, written out as the literal message key.
 *
 * Three things are bought by writing them out instead of composing 'log.' + action at runtime:
 *
 *   1. MessageKey is `keyof typeof MESSAGES`, so tsc proves at build time that all 89 keys really
 *      exist. A sentence deleted from messages.ts fails the build here, rather than turning into a
 *      blank line on the owner's screen months later.
 *   2. The [TAAL] gate in lifecycle-gates.test.ts scans production files for the keys they render
 *      and reports every catalogue entry that nothing reaches as an orphan. A key that is only ever
 *      built by concatenation is invisible to it, so 89 real sentences would read as dead weight
 *      and the next tidy-up would delete them.
 *   3. hasSentence() can then answer for ANY string the database hands it — including the 40
 *      historical rows that predate this union — without reading the catalogue at runtime.
 *
 * The order is audit.ts's own, headings included, so the two lists can be compared by eye. The test
 * does it properly, in both directions.
 */
const SENTENCE_KEYS: readonly MessageKey[] = [
  // Level 1 — Financial (critical)
  "log.invoice.created", "log.invoice.updated",
  "log.invoice.ledger_account_set",
  "log.wachtkoppeling.created",
  "log.wachtkoppeling.linked",
  "log.wachtkoppeling.withdrawn",
  "log.invoice.correction_proposed", "log.invoice.correction_accepted", "log.invoice.correction_declined",
  "log.invoice.deleted", "log.invoice.duplicated",
  "log.invoice.corrected", "log.invoice.dedup_override", "log.invoice.status_changed",
  "log.offerte.sent", "log.offerte.answered", "log.invoice.auto_verified", "log.invoice.auto_paid",
  "log.invoice.reread_from_document", "log.invoice.reimported", "log.invoice.btw_rows_read",
  "log.bank.auto_confirmed",
  "log.bank.auto_confirmed_batch", "log.bank.confirmed_batch", "log.bank.confirmed", "log.bank.partial_payment",
  "log.bank.payment_allocated", "log.bank.overpayment_residue", "log.invoice.partial_payment",
  "log.bank.unlinked", "log.bank.attachment_added", "log.bank.attachment_removed", "log.bank.line_deleted", "log.bank.storno_applied", "log.bank.match_checked", "log.invoice.document_attached", "log.invoice.document_replaced",
  "log.accountant.invoice_question", "log.bank.ignored", "log.bank.restored",
  "log.bank.rematch_restored", "log.bank.overapplied", "log.bank.overapplied_check_failed", "log.creditnota.created",
  "log.invoice.archived", "log.invoice.restored", "log.invoice.payment_moved",
  "log.invoice.duplicate_dismissed", "log.invoice.multi_invoice_dismissed",
  "log.invoice.superseded", "log.invoice.numbering_configured",
  "log.invoice.numbering_change_blocked", "log.invoice.arithmetic_blocked", "log.cash.entry_added",
  "log.cash.entry_removed", "log.cash.opening_balance_set", "log.turnover.auto_imported",
  "log.article.seeded_from_vak",
  "log.turnover.day_removed", "log.turnover.day_entered",
  "log.till.ticket_rung", "log.till.ticket_voided",
  "log.ledger.auto_imported", "log.kasboek.imported_read_only", "log.kasboek.gap_booked", "log.btw.filed",
  "log.btw.filed_despite_warnings", "log.btw.filing_unlocked", "log.btw.correction_carried",
  // Level 2 — Accountant relationships
  "log.accountant.client_invited", "log.accountant.client_linked", "log.accountant.client_unlinked",
  "log.accountant.invoice_status_set", "log.accountant.invoice_mandate_granted",
  "log.accountant.invoice_mandate_revoked", "log.accountant.documents_requested",
  "log.accountant.invoice_confirmed", "log.accountant.mandate_requested",
  "log.invoice.reminder_sent", "log.member.invited", "log.member.joined", "log.member.revoked",
  "log.retention.warning_sent", "log.accountant.package_downloaded",
  // [PAKKET-LINK] De overdracht aan een boekhouder ZONDER account: verstuurd, opgehaald,
  // ingetrokken. Bij een deel-link is dit spoor de enige plek waar de eigenaar terugziet naar
  // wie zijn boeken zijn gegaan — de ontvanger heeft geen account om het aan te hangen.
  "log.package.link_shared", "log.package.link_downloaded", "log.package.link_revoked",
  "log.accountant.export_downloaded", "log.supplier.auto_incasso_on",
  "log.supplier.auto_incasso_off",
  // [LEVERANCIER-SAMENVOEGEN] Twee leveranciersrijen tot één verklaard. Dit is de enige regel die
  // terugvindbaar maakt WAAROM dat mocht — een gedeeld KVK-nummer of een gedeeld rekeningnummer —
  // en dat is precies de vraag die iemand stelt als een crediteurenstand er anders uitziet dan
  // vorige maand.
  "log.supplier.merged",
  "log.supplier.updated",
  "log.supplier.created",
  "log.supplier.deleted",
  // Level 3 — Files
  "log.document.uploaded", "log.document.duplicate_blocked", "log.document.deleted",
  "log.document.bulk_deleted", "log.document.restored", "log.document.reminder_filed",
  "log.work.created", "log.work.status_changed", "log.work.invoiced", "log.work.deleted", "log.work.visit_recorded",
  "log.article.bulk_deleted",
  "log.folder.created", "log.folder.deleted", "log.folder.renamed",
  // Level 4 — Security / account
  "log.user.password_changed", "log.user.email_changed", "log.user.account_deletion_requested",
  "log.user.data_purged", "log.email.connection_created", "log.email.connection_revoked",
  "log.email.sender_rule_created", "log.email.sender_rule_deleted",
  // Level 5 — Boekhoudkoppelingen
  "log.snelstart.connected", "log.snelstart.disconnected", "log.snelstart.pushed",
  "log.snelstart.hold_acknowledged", "log.bank.connect_started", "log.bank.connected",
  "log.bank.disconnected",
];

const SENTENCE_KEY_SET: ReadonlySet<string> = new Set<string>(SENTENCE_KEYS);

/**
 * Is there a written sentence for this action?
 *
 * The copy layer asks this before rendering entry.messageKey, and falls back to 'log.onbekend' when
 * the answer is no. It exists because the two things that can be true of an action are genuinely
 * different: one we can phrase, and one we can only NAME. Rendering the key itself would put
 * `log.supplier.auto_incasso_on` on the screen of someone doing their bookkeeping; dropping the row
 * would be worse still. Neither is necessary, because a neutral sentence plus the raw action is
 * always available, and always true.
 */
export function hasSentence(action: string): boolean {
  return SENTENCE_KEY_SET.has(MESSAGE_PREFIX + action);
}

/**
 * The link to what the row is about, or null when there is nothing to open.
 *
 * Only 'invoice'. Of the 24 entity types written across the app (invoice, document, bank_transaction,
 * daily_turnover, profile, cash_entry, accountant_client, folder, …) exactly one has a screen at a
 * URL keyed by the entity_id this column holds: /dashboard/invoice/[id]. There is no per-document or
 * per-folder route — /dashboard/bestanden is a browser, not an addressable page — so a link built
 * for those would 404. A dead link inside an audit trail is not a small cosmetic miss: it teaches
 * the owner that the trail itself is unreliable, at the exact moment they came to it for proof.
 */
function invoiceHref(row: AuditRowLike): string | null {
  if (row.entity_type !== "invoice") return null;
  // A blank entity_id would produce '/dashboard/invoice/', which is not that invoice's page.
  const id = (row.entity_id ?? "").trim();
  if (!id) return null;
  // The column is a uuid, so this encodes nothing today. It is here because the value is DATA, and
  // a path assembled from data without encoding is how a link quietly points somewhere else.
  return `/dashboard/invoice/${encodeURIComponent(id)}`;
}

/**
 * One row → one entry. Always. See the header: there is no input for which this returns null, and
 * no branch that drops a row.
 *
 * `byOther` — the row was performed by someone other than the person reading it. It is a boolean
 * and not a name on purpose: this module is handed no names, and the actor is not necessarily the
 * bookkeeper. Since [ACTING-FOR] an invited medewerker issues invoices under the same BTW number
 * (member.invited / member.joined), so "door je boekhouder" would be a claim the row cannot support.
 * 'log.doorAnder' — "door iemand anders" — says exactly what is known and no more. Whoever wants
 * the name has to join profiles and answer for that join.
 *
 * A null viewerId reads as false rather than true: with no one identified there is nobody for the
 * row to be someone else THAN, and marking every row "by someone else" would be an accusation
 * assembled out of a missing session.
 */
export function toLogboekEntry(row: AuditRowLike, viewerId: string | null): LogboekEntry {
  // The column is NOT NULL and the type says string; this is the one function in the feature that
  // must survive a row it did not expect, and `null` here would print the word "null" as if it were
  // the name of an action.
  const action = typeof row.action === "string" ? row.action : "";

  return {
    id: row.id,
    action,
    messageKey: MESSAGE_PREFIX + action,
    kind: logboekKindOf(action),
    at: row.created_at,
    href: invoiceHref(row),
    byOther: viewerId != null && row.user_id != null && row.user_id !== viewerId,
  };
}
