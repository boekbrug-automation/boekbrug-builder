// src/lib/duplicate-question.ts
// [ONTVANGEN-BESLUIT] What the owner is shown, and what the screen is handed.
//
// A component holds no language of its own (AGENTS.md), so the copy is assembled here and the
// panel renders what it is given. That is also what keeps this answerable in Arabic: the panel
// lays out a heading, a sentence and two buttons, and never decides what any of them say.
//
// The machine state is not shown. "wacht_op_besluit" is our word for it; the owner's question is
// "deze factuur lijkt al te bestaan", and the two answers are the two things they can do about it.

import type { Translator } from "@/lib/i18n/t"
import type { Betaalstand } from "@/lib/factuurstaat"
import { formatEuroNL } from "@/lib/format-nl"

/**
 * What the panel was handed, as a state rather than a list.
 *
 * `unknown` exists because the alternative is a lie. A failed read used to leave the panel absent,
 * and an absent panel says exactly what an empty one says: nothing is waiting for you. The owner
 * then never looks again. Three states, and the screen says which one it is in.
 */
export type QuestionsState =
  | { kind: "loading" }
  /** The read failed. NOT zero questions — we do not know how many there are. */
  | { kind: "unknown" }
  | { kind: "loaded"; questions: DuplicateQuestion[]; candidatesUnavailable: boolean }

/**
 * [ONTVANGEN-WAAR] What is true about the invoice already in the books.
 *
 * Facts, in the vocabulary the app already has — no sentences, and nothing the screen has to
 * interpret. `payment` is `betaalstandVan`'s own answer, `onbekend` included, so a total nobody
 * could read stays a total nobody could read all the way to the screen.
 */
/**
 * [ONTVANGEN-WAAR] WHICH SCREEN can actually show this invoice.
 *
 * Not a cosmetic label — it decides where the link goes, and the two screens hold disjoint sets:
 *
 *   · `/dashboard/incoming`        loads status 'processing' and status 'archived'
 *   · `/dashboard/incoming/manage` loads status 'received' and 'paid' — `.in('status', […])`
 *
 * The hard semantic gate filters on NO status, so its candidate can be any of the four. The panel
 * linked every one of them to `manage`, which means a question that correctly said «Staat in
 * Genegeerd» offered, one line below, a link to a screen that cannot contain that invoice. The
 * owner lands on a list, finds nothing, and the app has just contradicted itself about a document
 * it is asking them to make a money decision on.
 *
 * `unknown` is a real member and produces NO link. A wrong destination is worse than none: it
 * looks like it worked.
 */
export type CandidateWhere = "queue" | "books" | "archived" | "unknown"

export interface CandidateFacts {
  /** total_inc_btw, or null when it could not be read. */
  total: number | null
  payment: Betaalstand
  /** What is still owed. Null when the total could not be read. */
  outstanding: number | null
  /** Which screen holds this invoice. `archived` is also what Genegeerd means to the owner. */
  where: CandidateWhere
  /** accountant_status = 'verwerkt'. Stated, never changed from here. */
  accountantProcessed: boolean
}

/**
 * The deep link for a candidate, or null when we cannot name a screen that holds it.
 *
 * `/dashboard/incoming?focus=` is the right door for BOTH queue and archived, and needs nothing
 * new: [ZOEK-LANDT] on that screen already switches to the Genegeerd tab for an archived row,
 * expands the card, scrolls to it, and says so out loud when the id is on neither list. Which also
 * settles the Terugzetten gap without a third mutation path in this panel — the restore action
 * lives on that card, and the owner now arrives at it.
 */
export function candidateHref(invoiceId: string, where: CandidateWhere): string | null {
  const id = encodeURIComponent(invoiceId)
  if (where === "queue" || where === "archived") return `/dashboard/incoming?focus=${id}`
  if (where === "books") return `/dashboard/incoming/manage?focus=${id}`
  return null
}

/** One open question, as the API hands it over. */
export interface DuplicateQuestion {
  documentId: string
  fileName: string
  /** The invoice the reader believes this duplicates, when it could name one and it is readable. */
  candidate:
    | ({ invoiceId: string; invoiceNumber: string | null; vendor: string | null } & Partial<CandidateFacts>)
    | null
}

export interface QuestionCopy {
  heading: string
  sentence: string
  keepLabel: string
  addLabel: string
  /**
   * [ONTVANGEN-WAAR] The short business truth about the existing invoice — the amount, what the
   * money did, and the two situations the owner cannot see from any list. Zero to three lines, and
   * a line only exists when the fact behind it is known.
   */
  contextLines: string[]
  /** Absent when there is no candidate to look at. */
  candidateLink: { href: string; label: string } | null
  busyLabel: string
  failureText: string
}

/** The calm sentence shown instead of the list when the read itself did not come back. */
export function questionsUnknownText(t: T): string {
  return t("ink.vraag.nietGeladen")
}

/**
 * Shown once above the questions when the candidate lookup failed.
 *
 * Without it, a question whose invoice could not be read looks identical to one the reader never
 * found an invoice for — and the owner would answer a "keep the existing one" they were never
 * shown. The question still stands; this says what is missing from beside it.
 */
export function candidatesUnavailableText(t: T): string {
  return t("ink.vraag.geenDetails")
}

// The app's own translator type, not a loose function shape: the [TAAL] gates check that every
// key used exists, and they can only do that if the key type is the real one.
type T = Translator

/**
 * The heading counts, because one question and four questions are different amounts of work and an
 * owner deciding whether to open this deserves to know which. Singular and plural are separate
 * keys — a number inside a sentence is not a parameter that survives Arabic or Turkish.
 */
export function questionsHeading(t: T, open: number): string {
  return open === 1 ? t("ink.vraag.kop") : t("ink.vraag.kopMeer", { aantal: open })
}

/**
 * [ONTVANGEN-WAAR] The context lines, derived from facts the app already holds.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────────
 *
 * No machine state. `wacht_op_besluit`, `amount_paid`, `accountant_status` and
 * `possible_duplicate_id` are our words for our own machinery; the owner reads "€ 200,00 betaald ·
 * € 300,00 open". Simple outside, as complicated inside as it has to be.
 *
 * And no matrix. Every case gets the same panel and the same two answers — the facts only decide
 * which lines appear above them. A screen per duplicate variant is how a question that should take
 * four seconds becomes a thing the owner has to learn.
 *
 * ── SILENCE IS A VALID ANSWER ────────────────────────────────────────────────────────────────
 *
 * `onbekend` produces NO payment line. It does not produce "betaalstand onbekend" either: a row
 * telling the owner what we failed to determine is noise beside a decision, and the question above
 * it already stands on its own. Say less, never invent.
 */
export function candidateContextLines(t: T, q: DuplicateQuestion): string[] {
  const c = q.candidate
  if (!c) return []
  const lines: string[] = []

  if (typeof c.total === "number") lines.push(formatEuroNL(c.total))

  switch (c.payment) {
    case "onbetaald":
      // The amount is repeated on purpose: "nog niet betaald" beside a €500 invoice and beside a
      // €5 one are different pieces of news, and the line is read on its own.
      lines.push(
        typeof c.outstanding === "number"
          ? t("ink.vraag.geld.onbetaaldOpen", { open: formatEuroNL(c.outstanding) })
          : t("ink.vraag.geld.onbetaald"),
      )
      break
    case "deels_betaald":
      if (typeof c.total === "number" && typeof c.outstanding === "number") {
        lines.push(t("ink.vraag.geld.deels", {
          betaald: formatEuroNL(c.total - c.outstanding),
          open: formatEuroNL(c.outstanding),
        }))
      }
      break
    case "betaald":
      lines.push(t("ink.vraag.geld.betaald"))
      break
    case "teveel_betaald":
      lines.push(t("ink.vraag.geld.teveel"))
      break
    case "onbekend":
      // Nothing. See the header.
      break
  }

  // The two facts that change where the invoice IS rather than what the money did, and that the
  // owner cannot discover from the list they are looking at.
  if (c.where === "archived") lines.push(t("ink.vraag.staatInGenegeerd"))
  if (c.accountantProcessed) lines.push(t("ink.vraag.alVerwerkt"))

  return lines
}

/**
 * The "bekijk de bestaande factuur" link, or none.
 *
 * `where` is absent on a question built before this field existed, and unknown is the safe reading
 * of absent: no link beats a link to a screen that may not hold the row.
 */
function linkFor(t: T, q: DuplicateQuestion): { href: string; label: string } | null {
  if (!q.candidate) return null
  const href = candidateHref(q.candidate.invoiceId, q.candidate.where ?? "unknown")
  return href ? { href, label: t("ink.vraag.bekijkBestaande") } : null
}

export function questionCopy(t: T, q: DuplicateQuestion): QuestionCopy {
  // [ONTVANGEN-WAAR] ONE sentence, for every payment state. This briefly said "Deze factuur staat
  // al in BoekBrug" when the candidate was settled, and that was wrong in a way worth writing down.
  //
  // A paid candidate is not evidence about IDENTITY. It says something about the invoice already in
  // the books; it says nothing about whether the document just uploaded is that same invoice. The
  // semantic gate is forceable precisely because its match can be a false positive — that is the
  // whole reason this question exists — so dropping the hedge turned risk into certainty and
  // pointed it at the owner's own correct answer ("this really is a different invoice").
  //
  // The exact-bytes gate is the one that IS certain, and it never reaches this panel: it answers
  // 409 synchronously and cannot be forced.
  //
  // The warning the settled case deserves is already underneath, in the context: «Betaald ✓».
  // A fact is a better warning than a firmer adjective.
  return {
    heading: q.fileName,
    sentence: t("ink.vraag.dubbel"),
    keepLabel: t("ink.vraag.bestaande"),
    // [ONTVANGEN-WAAR] The owner-facing name of the decision, which the durable state keeps
    // calling `add_anyway`. "Toch toevoegen" describes a stubborn click; what the owner is
    // actually asserting is that the reader got it wrong and this is a different bill. Naming the
    // assertion is what makes the consequence — a second cost, a second voorbelasting — visible at
    // the moment of choosing. The stored decision is untouched: see duplicate-decision.ts.
    addLabel: t("ink.vraag.andereFactuur"),
    contextLines: candidateContextLines(t, q),
    // [ONTVANGEN-WAAR] The link follows WHERE the invoice is, not a single hard-coded screen.
    // This always pointed at /incoming/manage, which loads only 'received' and 'paid' — so a
    // question that had just said «Staat in Genegeerd» sent the owner to a list that cannot
    // contain it. No link at all when we cannot name a screen: see candidateHref.
    candidateLink: linkFor(t, q),
    busyLabel: t("ink.vraag.bezig"),
    failureText: t("ink.vraag.mislukt"),
  }
}
