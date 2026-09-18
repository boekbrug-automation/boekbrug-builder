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

/** One open question, as the API hands it over. */
export interface DuplicateQuestion {
  documentId: string
  fileName: string
  /** The invoice the reader believes this duplicates, when it could name one and it is readable. */
  candidate: { invoiceId: string; invoiceNumber: string | null; vendor: string | null } | null
}

export interface QuestionCopy {
  heading: string
  sentence: string
  keepLabel: string
  addLabel: string
  /** Absent when there is no candidate to look at. */
  candidateLink: { href: string; label: string } | null
  busyLabel: string
  failureText: string
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

export function questionCopy(t: T, q: DuplicateQuestion): QuestionCopy {
  return {
    heading: q.fileName,
    sentence: t("ink.vraag.dubbel"),
    keepLabel: t("ink.vraag.bestaande"),
    addLabel: t("ink.vraag.tochToevoegen"),
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
