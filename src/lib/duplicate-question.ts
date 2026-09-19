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
export interface CandidateFacts {
  /** total_inc_btw, or null when it could not be read. */
  total: number | null
  payment: Betaalstand
  /** What is still owed. Null when the total could not be read. */
  outstanding: number | null
  /** The invoice sits in Genegeerd — invisible in every ordinary list. */
  archived: boolean
  /** accountant_status = 'verwerkt'. Stated, never changed from here. */
  accountantProcessed: boolean
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
  if (c.archived) lines.push(t("ink.vraag.staatInGenegeerd"))
  if (c.accountantProcessed) lines.push(t("ink.vraag.alVerwerkt"))

  return lines
}

export function questionCopy(t: T, q: DuplicateQuestion): QuestionCopy {
  // [ONTVANGEN-WAAR] A fully settled invoice is not a maybe. "Deze factuur lijkt al te bestaan" is
  // the right hedge while the money is still open — the reader may be wrong — but once the bill is
  // demonstrably paid, the softer sentence reads as doubt about a fact we can prove, and doubt is
  // what makes someone pay twice. Same question, same two answers; a firmer first line.
  const settled = q.candidate?.payment === "betaald" || q.candidate?.payment === "teveel_betaald"
  return {
    heading: q.fileName,
    sentence: settled ? t("ink.vraag.dubbelBetaald") : t("ink.vraag.dubbel"),
    keepLabel: t("ink.vraag.bestaande"),
    // [ONTVANGEN-WAAR] The owner-facing name of the decision, which the durable state keeps
    // calling `add_anyway`. "Toch toevoegen" describes a stubborn click; what the owner is
    // actually asserting is that the reader got it wrong and this is a different bill. Naming the
    // assertion is what makes the consequence — a second cost, a second voorbelasting — visible at
    // the moment of choosing. The stored decision is untouched: see duplicate-decision.ts.
    addLabel: t("ink.vraag.andereFactuur"),
    contextLines: candidateContextLines(t, q),
    candidateLink: q.candidate
      ? {
          // The same deep link the notification uses, so "bekijk de bestaande" lands on the row
          // rather than on a list the owner then has to search.
          href: `/dashboard/incoming/manage?focus=${q.candidate.invoiceId}`,
          label: t("ink.vraag.bekijkBestaande"),
        }
      : null,
    busyLabel: t("ink.vraag.bezig"),
    failureText: t("ink.vraag.mislukt"),
  }
}
