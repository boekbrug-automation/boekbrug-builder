// src/lib/ochtend-digest.ts
// [OCHTEND] The owner's morning line: what the administration did while they slept — and the
// decision, made here and nowhere else, to usually say NOTHING.
//
// ── WHY THIS EXISTS ──
// The app now works overnight: bank-sync pulls the statement, auto-confirm books the certain
// matches, e-mail-sync stages incoming invoices, Mollie rings when a customer pays. All of that
// lands in bell notifications — which are read only by someone already in the app. The one channel
// that reaches an owner who did NOT open the app is e-mail, and until this module the app never
// used it to say the only thing a freelancer never tires of hearing: money came in.
//
// ── WHAT KEEPS IT FROM BECOMING SPAM (the design constraint, not an afterthought) ──
//   · At most ONE mail per day, in the morning, about YESTERDAY — never a stream of pings.
//   · A quiet day produces NO mail at all. Not "no news today" — nothing. An empty digest
//     teaches the reader to delete unread, which then costs the one mail that mattered.
//   · A mail is EARNED BY AN EVENT: payments that were RECORDED against outgoing invoices, or
//     incoming invoices that ARRIVED. No event, no mail — still true, and the rule this file
//     exists to protect.
//   · One click target. The mail is a doorway, not a report.
//
// ── [OCHTEND-TAKEN] AND THE ONE THING THAT CHANGED ──
//
// This header used to end that list with "No nagging about open work... Standing state belongs
// on the dashboard", and that was right when it was written: the app had nothing worth asking
// for. It does now — invoices waiting for a ledger account, payments with no document, a
// quarter that cannot be filed, a waiting link still looking. All of it sits on screens an owner
// who has not opened the app does not see, and e-mail is the only channel that reaches them.
//
// So the mail carries TASKS. What did NOT change is why the old rule existed: a mail that nags
// often enough is deleted unread, and then it costs the one mail that mattered. Both halves are
// kept by one decision — TASKS RIDE ALONG, THEY NEVER SUMMON. A day with no event still produces
// no mail, however much work is open. Standing state may fill a mail that something else already
// justified; it may not generate one.
//
// The second half of the owner's complaint was that the mail is not ORGANISED. It was two
// stacked blocks. It is now three named sections in the order a morning is read: what came in,
// what needs you, one button.
//
// Pure module: the cron fetches and this file decides + composes, so the quiet-by-default rule
// is testable without a database. UI text is Dutch — this mail addresses the owner the way every
// other owner-facing mail in this app does.

import { escapeHtml } from "./escape-html";
// [MERK-KOP] The wordmark and the way home. Text, never an image — see the note in that file.
import { merkKop, merkVoet } from "./mail-merk";
import { formatDateNL, formatEuroNL } from "./format-nl";
// [CENT] The one cent-rounder — a second definition is how two screens disagree about a total.
import { round2 } from "./invoice-totals";

/** One payment recorded yesterday against an OUTGOING invoice. */
export interface OchtendPayment {
  invoiceNumber: string | null;
  clientName: string | null;
  amount: number;
}

/**
 * [POST-WAARD] One incoming invoice that arrived yesterday — the FACTS, not a count.
 *
 * The mail used to say "1 nieuwe inkomende factuur staat voor je klaar" and open the home
 * screen. The owner's own words: what did I gain from a mail with general information, whose
 * button lands on the front page and not on the invoice it is about — an invoice I cannot even
 * identify, because the mail names nothing. So the mail names it: who, how much, when it is
 * due — and the button opens THAT invoice.
 */
export interface OchtendIncoming {
  id: string;
  supplierName: string | null;
  /** Stored total, or null when the reader has not established one yet. Never invented here. */
  amount: number | null;
  /** 'YYYY-MM-DD' or null. */
  dueDate: string | null;
}

/**
 * [OCHTEND-TAKEN] One thing the owner has to do, as a COUNT and a door.
 *
 * Never a sentence about how the app works and never an amount the app is unsure of: a task is
 * "7 facturen wachten op een grootboekrekening", which is checkable at a glance and wrong in a
 * way the owner would notice. `bedrag` rides along only where the money is the point of the task.
 */
export interface OchtendTaak {
  /** Stable key — the gate uses it, and it keeps two tasks from saying the same thing twice. */
  soort:
    | "te_beoordelen"      // documents in the verify queue
    | "bank_te_beslissen"  // bank lines waiting for a decision
    | "grootboek"          // booked purchase invoices with no cost account
    | "betaald_geen_stuk"  // [BETAALD-GEEN-STUK] money gone, nothing linked
    | "wacht_op_bankregel" // [WACHTKOPPELING] a payment recorded before the statement
    | "te_laat";           // your own invoices past their due date
  /** How many. A task with 0 never reaches the mail. */
  aantal: number;
  /** The euros at stake, when that is what makes the task worth doing. */
  bedrag?: number | null;
  /** Where it is done — a path inside the app. */
  pad: string;
}

export interface OchtendInput {
  /** Yesterday, as the Amsterdam calendar day the mail is about ('YYYY-MM-DD'). */
  gisteren: string;
  payments: OchtendPayment[];
  /** Incoming invoices that arrived/were staged yesterday (e-mail sync, upload, intake). */
  newIncoming: OchtendIncoming[];
  /**
   * [OCHTEND-TAKEN] What is waiting for the owner today. Optional, and an empty list is the
   * normal answer on a tidy administration.
   */
  taken?: OchtendTaak[];
  /** Absolute base URL for the one click target, e.g. https://boekbrug.nl */
  baseUrl: string;
}

export interface OchtendMail {
  subject: string;
  html: string;
  /** Where the button lands — a path inside the app. Exposed so a test can hold it to the facts. */
  target: string;
}

/**
 * [POST-WAARD] The page a single arrived invoice opens on: the pay screen, focused on that row.
 * The same deep link the dashboard's attention list and the bell use (focus-scroll.ts), so a
 * mail, a bell and a tile cannot come to send the owner to three different places for one invoice.
 */
export function incomingInvoiceTarget(id: string): string {
  return `/dashboard/incoming/manage?focus=${encodeURIComponent(id)}`;
}

/** Sum of yesterday's recorded payments, rounded by the one cent-rounder ([CENT]). */
function paymentsTotal(payments: OchtendPayment[]): number {
  return round2(payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0));
}

/**
 * [OCHTEND-TAKEN] The Dutch for each task, and the order they are read in.
 *
 * Ordered by what it costs to leave undone, not by how many there are. A btw amount nobody can
 * reclaim and an invoice already past its due date cost real money today; a missing ledger
 * account costs an accountant an hour in April. The count never reorders the list — a task with
 * forty rows is not more urgent than one with two, it is just longer.
 */
const TAAK_TEKST: Readonly<Record<OchtendTaak["soort"], { enkel: string; meer: string; rang: number }>> = {
  te_laat:             { enkel: "factuur is te laat betaald door je klant", meer: "facturen zijn te laat betaald door je klanten", rang: 1 },
  betaald_geen_stuk:   { enkel: "betaling aan een bekende leverancier zonder factuur",  meer: "betalingen aan bekende leveranciers zonder factuur", rang: 2 },
  bank_te_beslissen:   { enkel: "bankregel wacht op jouw beslissing",       meer: "bankregels wachten op jouw beslissing", rang: 3 },
  te_beoordelen:       { enkel: "document wacht op je controle",            meer: "documenten wachten op je controle", rang: 4 },
  wacht_op_bankregel:  { enkel: "betaling wacht nog op de bankregel",       meer: "betalingen wachten nog op de bankregel", rang: 5 },
  grootboek:           { enkel: "factuur heeft nog geen grootboekrekening", meer: "facturen hebben nog geen grootboekrekening", rang: 6 },
};

/** At most this many tasks in one mail. The rest is on the dashboard, where a list belongs. */
export const MAX_TAKEN = 4;

/**
 * The tasks that earn a place, in order. A task with no rows is not a task.
 *
 * Exported so the gate and the test hold the same list the mail does.
 */
export function takenVoorMail(taken: readonly OchtendTaak[]): OchtendTaak[] {
  return [...taken]
    .filter((t) => Number.isFinite(t.aantal) && t.aantal > 0 && TAAK_TEKST[t.soort] != null)
    .sort((a, b) => TAAK_TEKST[a.soort].rang - TAAK_TEKST[b.soort].rang)
    .slice(0, MAX_TAKEN);
}

/** "7 facturen hebben nog geen grootboekrekening" — the count and the noun agree. */
export function taakZin(t: OchtendTaak): string {
  const tekst = TAAK_TEKST[t.soort];
  const staart = Number.isFinite(t.bedrag as number) && (t.bedrag as number) > 0
    ? ` · ${formatEuroNL(t.bedrag as number)}`
    : "";
  return `${t.aantal} ${t.aantal === 1 ? tekst.enkel : tekst.meer}${staart}`;
}

/**
 * Decide whether yesterday earned a mail, and compose it if so. `null` means: stay quiet.
 *
 * The subject leads with the money when there is money — that is the line that gets a mail
 * opened at 07:30 — and with the arrivals when there is only staging work to report.
 */
export function planOchtendMail(input: OchtendInput): OchtendMail | null {
  const betalingen = input.payments.filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  const inkomend = (input.newIncoming ?? []).filter((i) => typeof i.id === "string" && i.id.length > 0);

  // [OCHTEND-TAKEN] TASKS RIDE ALONG, THEY NEVER SUMMON. The quiet-by-default rule is unchanged
  // and is checked BEFORE the tasks are even looked at: a day with no event produces no mail,
  // however much work is open. Standing state may fill a mail something else already justified;
  // it may not generate one. That is the whole of what keeps this from becoming the daily nag
  // that gets deleted unread — and then costs the one mail that mattered.
  if (betalingen.length === 0 && inkomend.length === 0) return null;

  const taken = takenVoorMail(input.taken ?? []);

  const totaal = paymentsTotal(betalingen);
  const naam = (i: OchtendIncoming) => i.supplierName?.trim() ? i.supplierName.trim() : "Onbekende leverancier";
  const bedragVan = (i: OchtendIncoming) => Number.isFinite(i.amount as number) ? formatEuroNL(i.amount as number) : null;
  // The sum of the arrivals whose amount is known — and only when EVERY amount is known, so the
  // subject never states a total that is missing a document.
  const inkomendTotaal = inkomend.every((i) => Number.isFinite(i.amount as number))
    ? round2(inkomend.reduce((s, i) => s + (i.amount as number), 0))
    : null;

  // [POST-WAARD] The subject carries the facts, so the mailbox preview alone answers "do I need
  // to act". Money first when there is money; otherwise the arrival itself: who, how much, when.
  const subject = betalingen.length > 0
    ? `${formatEuroNL(totaal)} binnengekomen ${formatDateNL(input.gisteren)}`
    : inkomend.length === 1
      ? [naam(inkomend[0]), bedragVan(inkomend[0]), inkomend[0].dueDate ? `vervalt ${formatDateNL(inkomend[0].dueDate)}` : null]
          .filter(Boolean).join(" · ")
      : `${inkomend.length} nieuwe inkomende facturen${inkomendTotaal != null ? ` · samen ${formatEuroNL(inkomendTotaal)}` : ""}`;

  // [POST-WAARD] When something is waiting, the subject says so: the mailbox preview alone has to
  // answer "do I need to act today". The money still leads when there is money — that is the line
  // that gets a mail opened at 07:30 — and the task rides behind it.
  const onderwerp = taken.length > 0 ? `${subject} · ${taken.length === 1 ? "1 ding" : `${taken.length} dingen`} voor jou` : subject;

  const betaalRegels = betalingen
    .map((p) => {
      const wie = p.clientName?.trim() ? escapeHtml(p.clientName.trim()) : "Onbekende betaler";
      const nr = p.invoiceNumber?.trim() ? ` · factuur ${escapeHtml(p.invoiceNumber.trim())}` : "";
      return `<li style="margin: 2px 0;">${wie}${nr} — <strong>${formatEuroNL(p.amount)}</strong></li>`;
    })
    .join("\n");

  const betaalBlok = betalingen.length > 0
    ? `
        <p style="color: #202124; font-size: 16px; margin: 0 0 4px;">
          <strong>${formatEuroNL(totaal)}</strong> binnengekomen op ${betalingen.length === 1 ? "1 factuur" : `${betalingen.length} facturen`}:
        </p>
        <ul style="color: #555; padding-inline-start: 18px; margin: 4px 0 0;">
          ${betaalRegels}
        </ul>`
    : "";

  // Every arrival is a line the owner can act on, and each line is its own door.
  const inkomendRegels = inkomend
    .map((i) => {
      const bedrag = bedragVan(i);
      const vervalt = i.dueDate ? ` · vervalt ${formatDateNL(i.dueDate)}` : "";
      const href = `${escapeHtml(input.baseUrl)}${incomingInvoiceTarget(i.id)}`;
      return `<li style="margin: 2px 0;"><a href="${href}" style="color: #1A73E8; text-decoration: none;">${escapeHtml(naam(i))}</a>` +
        ` — ${bedrag ? `<strong>${bedrag}</strong>` : "bedrag nog niet gelezen"}${vervalt}</li>`;
    })
    .join("\n");

  const inkomendBlok = inkomend.length > 0
    ? `
        <p style="color: #202124; font-size: 16px; margin: ${betalingen.length > 0 ? "14px" : "0"} 0 4px;">
          ${inkomend.length === 1 ? "1 nieuwe inkomende factuur" : `${inkomend.length} nieuwe inkomende facturen`}:
        </p>
        <ul style="color: #555; padding-inline-start: 18px; margin: 4px 0 0;">
          ${inkomendRegels}
        </ul>`
    : "";

  // [OCHTEND-TAKEN] The section the owner's complaint was about: the mail said what happened and
  // never what to do. Each line is a count, a noun that agrees with it, and its own door.
  const takenRegels = taken
    .map((t) => {
      const href = `${escapeHtml(input.baseUrl)}${t.pad}`;
      return `<li style="margin: 3px 0;"><a href="${href}" style="color: #1A73E8; text-decoration: none;">${escapeHtml(taakZin(t))}</a></li>`;
    })
    .join("\n");

  const takenBlok = taken.length > 0
    ? `
        <h3 style="color: #202124; font-size: 15px; margin: 22px 0 6px;">Dit wacht op jou</h3>
        <ul style="color: #555; padding-inline-start: 18px; margin: 4px 0 0;">
          ${takenRegels}
        </ul>`
    : "";

  // Where the button lands. Payments are done — nothing to do there — so an arrival wins when
  // there is one. One arrival: that invoice. Several: the pay screen that lists them. Payments
  // only: the sales list where the money now shows as received.
  // [OCHTEND-TAKEN] The button lands on the thing that needs DOING. Payments are finished — there
  // is nothing to do there — and a task outranks an arrival for the same reason: the arrival is
  // already in the list above, with its own link, while the top task is what the owner opened the
  // mail to find. With no task the old order stands: one arrival opens that invoice, several open
  // the pay screen, payments alone open the sales list where the money now shows.
  const topTaak = taken[0] ?? null;
  const target = topTaak
    ? topTaak.pad
    : inkomend.length === 1
      ? incomingInvoiceTarget(inkomend[0].id)
      : inkomend.length > 1
        ? "/dashboard/incoming/manage"
        : "/dashboard/facturen";
  const knop = topTaak
    ? "Pak dit op"
    : inkomend.length === 1 ? "Open deze factuur" : inkomend.length > 1 ? "Bekijk de facturen" : "Open BoekBrug";

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      ${merkKop(input.baseUrl)}
      <h2 style="color: #202124; font-size: 18px; margin: 0 0 12px;">Je administratie, ${formatDateNL(input.gisteren)}</h2>
      <h3 style="color: #5f6368; font-size: 13px; text-transform: uppercase; letter-spacing: 0.4px; margin: 0 0 8px;">Gisteren</h3>
      ${betaalBlok}
      ${inkomendBlok}
      ${takenBlok}
      <p style="margin: 18px 0 0;">
        <a href="${escapeHtml(input.baseUrl)}${target}"
           style="display: inline-block; background: #1A73E8; color: #FFFFFF; text-decoration: none; border-radius: 8px; padding: 10px 20px; font-size: 14px;">
          ${knop}
        </a>
      </p>
      ${merkVoet(input.baseUrl, "Je krijgt dit bericht alleen op dagen dat er iets gebeurde. Uitzetten kan onder Instellingen.")}
    </div>`;

  return { subject: onderwerp, html, target };
}
