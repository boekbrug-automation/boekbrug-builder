// src/lib/belofte-ar.ts
// [BELOFTE-AR] The promise in Arabic — a translation of belofte.ts, nothing more.
//
// WHY THIS FILE EXISTS AT ALL
// The app has published 53 Arabic articles and an /ar/blog for months, and an Arabic pricing
// page — and no Arabic PRODUCT page. So an Arabic-reading entrepreneur could read us explain
// bookkeeping, and could read what it costs, and had nowhere to learn what the thing IS. The
// blog was doing acquisition into a door that was not there.
//
// AGENTS.md records that the first accountants using this product read Arabic. This is the same
// audience from the other side: people who must file a Dutch BTW return and are least served by
// a market that is Dutch-only — and who pay the highest price for a lost receipt, because they
// are least able to argue with the Belastingdienst afterwards.
//
// THE RULE, IDENTICAL TO belofte-en.ts: THIS IS A TRANSLATION, NEVER A SECOND OPINION.
// Every string here has a counterpart in belofte.ts. Change one and change the other, in the
// same commit. If the Arabic ever says something the Dutch does not, the Arabic is wrong — even
// if it reads better. The Dutch is what the terms, the app and the accountant see.
//
// AND IT MUST NOT PROMISE MORE. BELOFTE_GERUST is a contractual line (voorwaarden §5.2): free,
// no expiring trial, never auto-charged. Its Arabic twin carries the same three, no softer and
// no wider.
//
// [AR-TERMEN] The Dutch legal words stay Dutch inside the Arabic, exactly as they do inside the
// app: `btw`, `KVK`, `ZZP`, `Belastingdienst`. An owner reads those words on a letter from the
// tax office; translating them here would teach a vocabulary that appears nowhere they look.
// `btw` is written lowercase inside Arabic — one form, and a gate asserts it.

/** The promise, in two sentences. The first takes work away, the second gives one task back. */
export const BELOFTE_KOP_AR = "لستَ مضطراً لمسك الدفاتر." as const;
export const BELOFTE_KOP_2_AR = "يكفي ألّا يضيع منك شيء." as const;

/** The explanation: what the owner does, and what happens by itself afterwards. */
export const BELOFTE_UITLEG_AR =
  "الفواتير تُنشئها هنا. والباقي تصوّره، أو تدعه يصل إلى بريدك. " +
  "وفي نهاية الربع يكون كل شيء جاهزاً لمحاسبك — مرتّباً، كاملاً، يُسحب بزرّ واحد.";

/**
 * The reassurance under a button. Each part is a contractual commitment, not a marketing line:
 * "free" and "never auto-charged" are voorwaarden §5.2, and "no trial" is why `trial_ends_at`
 * deliberately does not exist in billing_subscription.sql.
 */
export const BELOFTE_GERUST_AR =
  "أول 90 يوماً بكل شيء · ثم تتابع مجاناً · ولا خصم تلقائي أبداً" as const;

/** The one task the owner keeps, in three steps. */
export const BELOFTE_STAPPEN_AR: readonly { kop: string; tekst: string }[] = [
  {
    kop: "صوّر أو حوّل",
    tekst: "إيصال من جيبك، أو فاتورة شراء في بريدك. نقرأ منها المبلغ والـ btw والمورّد.",
  },
  {
    kop: "وبنكك معها",
    tekst: "ارفع كشف حسابك. تُربط المدفوعات بالفاتورة الصحيحة من تلقاء نفسها.",
  },
  {
    kop: "الربع جاهز",
    tekst: "ترى بالضبط ما ينقص. وإذا اكتمل، سحبه محاسبك دفعةً واحدة.",
  },
] as const;

/** The problem, in the words of whoever has it. */
export const PROBLEEM_KOP_AR = "المشكلة" as const;
export const PROBLEEM_1_AR =
  "إيصالات في جيب معطف، فواتير في بريدك، كشف بنكي في مكان ما على حاسوب. " +
  "وكل ثلاثة أشهر يجب أن يخرج من ذلك إقرار btw — والـ Belastingdienst يتوقّع منك " +
  "أن تستطيع إظهاره بعد سبع سنوات.";
export const PROBLEEM_2_VET_AR = "الحلّ ليس أن تتعلّم أنت المحاسبة.";
export const PROBLEEM_2_AR =
  " الحلّ أن لا يختفي شيء بين اللحظة التي تستلم فيها ورقة واللحظة التي يحتاجها فيها محاسبك. " +
  "كل ما يفعله هذا التطبيق يخدم تلك الجملة الواحدة.";
