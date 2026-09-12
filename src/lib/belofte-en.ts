// src/lib/belofte-en.ts
// [BELOFTE-EN] The promise in English — a translation of belofte.ts, nothing more.
//
// WHY A SECOND FILE AND NOT A TRANSLATION LAYER
// This product has one Dutch homepage and one English one. A full i18n framework for two pages
// is more machinery than content, and the machinery is the part that rots. Two files that must
// move together, with the rule written down, is smaller and harder to get wrong.
//
// THE RULE: THIS FILE IS A TRANSLATION, NEVER A SECOND OPINION.
// Every string below has a counterpart in belofte.ts. Change one and change the other, in the
// same commit. If the English ever says something the Dutch does not, the English is wrong —
// even if it reads better. The Dutch is what the terms, the app and the accountant see.
//
// AND IT MUST NOT PROMISE MORE. BELOFTE_GERUST is a contractual line (voorwaarden §5.2): free,
// no expiring trial, never auto-charged. Its English twin carries the same three, no softer and
// no wider. A marketing sentence that outruns the contract is the one thing this product does
// not do — see the honesty rule at the top of prijzen/page.tsx.
//
// SIMPLE ENGLISH ON PURPOSE. Many entrepreneurs in the Netherlands do not have Dutch OR English
// as a first language; they must still file a Dutch BTW return. Short sentences and common words
// are not a style choice here, they are the point.

/** The promise, in two sentences. First takes work away, second gives one task back. */
export const PROMISE_HEAD = "You don't have to do bookkeeping." as const;
export const PROMISE_HEAD_2 = "You only have to not lose anything." as const;

/** The explanation: what you do, and what happens by itself afterwards. */
export const PROMISE_EXPLAIN =
  "You make invoices here. The rest you photograph, or let it arrive in your e-mail. " +
  "At the end of the quarter everything is ready for your bookkeeper — sorted, complete, " +
  "and collected with one button.";

/** Short version, for tight spaces. */
export const PROMISE_SHORT =
  "Photograph your receipts or let them arrive by e-mail. At the end of the quarter " +
  "everything is ready for your bookkeeper.";

/**
 * The reassurance under a button. Each part is a contractual commitment, not a slogan:
 * "free" and "never automatically charged" are in voorwaarden §5.2, and "no trial" is why
 * `trial_ends_at` deliberately does not exist in billing_subscription.sql.
 */
export const PROMISE_REASSURE =
  "Your first 90 days with everything on · free after that · never charged automatically" as const;

/** The only task left for you. Three steps, because nobody reads more — and these are all. */
export const PROMISE_STEPS: readonly { head: string; text: string }[] = [
  {
    head: "Photograph or forward",
    text:
      "A receipt from your pocket, a supplier invoice in your mail. We read out the amount, the BTW and the supplier.",
  },
  {
    head: "Add your bank",
    text:
      "Upload your bank statement. Payments are matched to the right invoice by themselves.",
  },
  {
    head: "The quarter is ready",
    text:
      "You see exactly what is still missing. When it is complete, your bookkeeper collects it in one go.",
  },
] as const;

/** [PROBLEEM] The problem — the twin of PROBLEEM_* in belofte.ts. Both pages carry it. */
export const PROBLEM_HEAD = "The problem" as const;
export const PROBLEM_1 =
  "Receipts in a pocket, invoices in an inbox, a bank statement somewhere on a laptop. " +
  "Every three months you have to turn that into a BTW return — and the Belastingdienst " +
  "expects you to keep all of it for seven years.";
export const PROBLEM_2_BOLD = "The solution is not that you learn bookkeeping.";
export const PROBLEM_2 =
  " It is that nothing gets lost between the moment you receive a paper and the moment your " +
  "bookkeeper needs it. Everything this app does serves that one sentence.";

/** For the bookkeeper — a different person with a different problem. */
export const PROMISE_BOOKKEEPER =
  "Your client hands over a closed quarter instead of a shoebox. " +
  "You see only what they checked themselves, you collect it per client, " +
  "and the portal is free up to ten linked clients.";

/**
 * [VERTAAL-HINT] What we tell someone who reads neither Dutch nor English.
 *
 * We do NOT publish half-finished Arabic or Turkish pages. A legal-adjacent text that is
 * machine-translated and then presented as ours is a claim we cannot stand behind — and the
 * whole product is built on not claiming what we cannot back. Pointing at the browser's own
 * translation is honest: the reader knows exactly whose translation it is.
 */
export const PROMISE_OTHER_LANGUAGES =
  "Do you read neither Dutch nor English? Use your browser's translate function — " +
  "on a phone, tap the ⋮ menu and choose Translate.";
