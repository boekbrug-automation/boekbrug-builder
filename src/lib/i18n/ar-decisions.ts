// src/lib/i18n/ar-decisions.ts
// [AR-TERMEN] The settled Arabic vocabulary — what has been decided, so nobody decides it twice.
//
// ── WHY THIS FILE EXISTS ──
//
// The Arabic interface was reviewed twice by a native speaker, term by term, against what each
// control actually DOES rather than against the Dutch word alone. Those rulings are decisions, not
// preferences: they cost a person's afternoon each time, and a word that drifts back costs the same
// afternoon again. A decision that lives only in a merged diff is a decision nobody can look up.
//
// So the vocabulary lives here, in the shape a test can read, and the gate [AR-TERMEN] holds it.
// Anyone adding a key that reuses one of these Dutch sources gets the settled wording or a red
// test; anyone who thinks a ruling is wrong changes it HERE, once, where the reason is written.
//
// ── WHAT IS NOT HERE, AND WHY ──
//
// Rulings that depend on the sentence around them are not mechanical and are not listed: an Arabic
// negation particle inside an assembled sentence, a gendered adjective following a noun that
// varies, a plural that the app already splits into two keys. Those were read one by one and left
// as they are. Listing them here would be a rule that lies.
//
// [TAAL] The values are Arabic because they ARE the Arabic interface; everything around them is
// English, as AGENTS.md asks.

/**
 * One Arabic wording per Dutch source. Reviewed in section ب of the audit: these are Dutch strings
 * that the interface had been saying two or three different ways in Arabic.
 *
 * The invariant the gate enforces: every message key carrying one of these Dutch sources carries
 * exactly the Arabic beside it. Not "one of these" — that one.
 */
export const AR_SETTLED: ReadonlyArray<readonly [nl: string, ar: string]> = [
  ["1 dag te laat", "متأخرة يومًا واحدًا"],
  ["Aantal", "الكمية"],
  ["Al toegevoegd", "أُضيف مسبقًا"],
  ["Artikelen", "المنتجات"],
  ["Automatische incasso", "خصم مباشر تلقائي"],
  ["BTW", "الضريبة"],
  ["btw", "الضريبة"],
  ["BTW ({pct}%)", "الضريبة ({pct}%)"],
  ["BTW ({rate}%)", "الضريبة ({rate}%)"],
  ["Bank", "البنك"],
  ["Bedrag excl. BTW", "المبلغ بدون btw"],
  ["Betaling ongedaan maken?", "التراجع عن الدفعة؟"],
  ["Bevestigd", "مؤكَّد"],
  ["Bevestigen", "تأكيد"],
  ["Bezig…", "جارٍ التنفيذ…"],
  ["Boekhouder", "المحاسب"],
  ["Bon", "إيصال"],
  ["Btw", "الضريبة"],
  ["BTW-nummer", "رقم btw"],
  ["Btw-nummer", "رقم btw"],
  ["BTW nummer", "رقم btw"],
  ["BTW-nummer (optioneel)", "رقم btw (اختياري)"],
  ["BTW-nummer klant", "رقم btw للعميل"],

  // ── The compound btw labels, and why there are 43 of them here ──
  //
  // The register is settled: a SHORT LABEL keeps the Dutch term, a SENTENCE spells the tax out.
  // «مبلغ btw» on a column header, «ضريبة القيمة المضافة» in prose — the third pass expanded 41
  // sentences that way and they stand.
  //
  // The rule was already recorded for «Excl. BTW» and «Incl. BTW». It did not hold, because this
  // list matches an EXACT Dutch source and the same compound is written 43 different ways —
  // `Prijs (excl. BTW)`, `Excl. btw: {bedrag}`, `Aanschafwaarde (ex btw)`. Every one of those
  // slipped past a gate that was watching for `Excl. BTW`, and a reviewer working through 3942
  // rows expanded all 43 without ever being shown the ruling.
  //
  // So each Dutch source is listed. Verbose on purpose: a rule that covers one spelling of a
  // phrase is a rule that fails on the day someone writes the phrase differently.
  ["({amount} excl.)", "({amount} بدون الضريبة)"],
  ["{rate}% BTW", "{rate}% btw"],
  ["{tarief}% btw", "btw {tarief}%"],
  ["{tarief}% BTW", "{tarief}% btw"],
  ["Aanschafwaarde (ex btw)", "قيمة الشراء (بدون btw)"],
  ["Aanschafwaarde (incl. btw)", "قيمة الشراء (شاملة btw)"],
  ["BTW {tarief}%", "ضريبة {tarief}%"],
  ["BTW = {bedrag}", "btw = {bedrag}"],
  ["BTW die je terugkrijgt", "btw التي تستردها"],
  ["BTW gedetecteerd", "btw المكتشفة"],
  ["BTW regel {n}", "btw للسطر {n}"],
  ["BTW te betalen (5g)", "btw المستحقة (5g)"],
  ["BTW verschuldigd (5a)", "btw المستحقة (5a)"],
  ["BTW-bedrag", "مبلغ btw"],
  ["BTW-methode", "طريقة btw"],
  ["BTW-tarief", "نسبة btw"],
  ["BTW:", "btw:"],
  ["Concept BTW-aangifte", "مسودة إقرار btw"],
  ["Concept BTW-aangifte Q{q} {jaar}", "مسودة إقرار btw للربع Q{q} {jaar}"],
  ["Excl. BTW = {bedrag}", "بدون btw = {bedrag}"],
  ["Excl. btw: {bedrag}", "بدون btw: {bedrag}"],
  ["Incl. btw: {bedrag}", "شامل الضريبة: {bedrag}"],
  ["Kosten (excl. btw)", "التكاليف (بدون الضريبة)"],
  ["Motorrijtuigenbelasting (kost, zonder btw)", "ضريبة المركبات (تكلفة، بدون btw)"],
  ["Na korting excl. BTW", "بعد الخصم، بدون ضريبة"],
  ["Omzet (excl. btw)", "الإيراد (بدون الضريبة)"],
  ["Omzet incl.", "الإيراد شامل btw"],
  ["Omzet, inclusief btw", "الإيراد شامل btw"],
  ["Prijs (excl. BTW)", "السعر (بدون btw)"],
  ["Prijs (incl. BTW)", "السعر (شامل الضريبة)"],
  ["Prijs ex btw", "السعر بدون btw"],
  ["Prijs excl. (€)", "السعر بدون ضريبة (€)"],
  ["Prijs incl. (€)", "السعر شامل الضريبة (€)"],
  ["Subtotaal excl. BTW", "المجموع الفرعي بدون ضريبة"],
  ["Totaal (incl. BTW)", "الإجمالي (شامل btw)"],
  ["Totaal excl.", "الإجمالي بدون الضريبة"],
  ["Totaal incl.", "الإجمالي شامل الضريبة"],
  ["Totaal incl. btw", "الإجمالي شامل btw"],
  ["Totaal incl. BTW", "الإجمالي شامل الضريبة"],
  ["Totale omzet (incl.)", "إجمالي الإيراد (شامل btw)"],
  ["Uurtarief (ex btw)", "تعرفة الساعة (بدون btw)"],
  ["Vast btw-tarief", "نسبة btw ثابتة"],
  ["waarvan {bedrag} btw", "منها {bedrag} btw"],
  ["Bevestig", "تأكيد"],
  ["Bevestigen", "تأكيد"],
  ["Btw-tarief", "نسبة btw"],
  ["Combineer {n} pagina's → één factuur", "ادمج {n} صفحة ← فاتورة واحدة"],
  ["Concept BTW te betalen", "btw المبدئية للدفع"],
  ["Concept BTW terug te ontvangen", "btw المبدئية المستردة"],
  ["Controleren…", "جارٍ التحقق…"],
  ["Dit is een creditnota", "هذا إشعار دائن"],
  ["Documenten", "المستندات"],
  ["Excl. BTW", "بدون btw"],
  ["Excl. btw", "بدون الضريبة"],
  ["Facturering", "الفوترة"],
  ["Factuur {number}", "الفاتورة {number}"],
  ["Geannuleerd", "ملغى"],
  ["Geen facturen gevonden", "لم يُعثر على فواتير"],
  ["Geen facturen in Q{q} {jaar}", "لا فواتير في الربع {q} {jaar}"],
  ["Geen klant", "بدون عميل"],
  ["Geen klanten gevonden voor “{zoekterm}”", "لا عملاء مطابقون لـ “{zoekterm}”"],
  ["Geen verbinding", "لا يوجد اتصال"],
  ["Gefactureerd", "مفوتر"],
  ["Grootboek", "دفتر الأستاذ"],
  ["Herinner", "ذكِّر"],
  ["Ik stuur en ontvang facturen", "أنا أرسل الفواتير وأستقبلها"],
  ["In behandeling", "قيد المعالجة"],
  ["Incl. BTW", "شامل btw"],
  ["Ink.", "وارد"],
  ["Ja, markeer als betaald", "نعم، علّمها كمدفوعة"],
  ["Jouw Bedrijf BV", "Jouw Bedrijf BV"],
  ["Kies een klant…", "اختر عميلًا…"],
  ["Klaar", "جاهز"],
  ["Klant uitnodigen", "دعوة عميل"],
  ["Klant", "العميل"],
  ["Klanten zoeken", "البحث عن العملاء"],
  ["Kosten (excl. BTW)", "التكاليف (بدون btw)"],
  ["Laden...", "جارٍ التحميل…"],
  ["Leeg laten = alles betaald ({amount})", "اتركه فارغًا = دُفع الكل ({amount})"],
  ["Lespakket", "باقة الدروس"],
  ["Logboek", "سجل النشاط"],
  ["Medewerker", "الموظف"],
  ["Mijn werkplek", "مساحة عملي"],
  ["Naar Dagomzet", "إلى «إيراد اليوم»"],
  ["Naar Inkoopfacturen", "إلى «فواتير المشتريات»"],
  ["Niet gelukt", "لم ينجح"],
  ["Niet gevonden", "لم يُعثر عليه"],
  ["Nog geen facturen voor deze klant.", "لا توجد فواتير لهذا العميل بعد."],
  ["Nog niet klaar", "غير جاهز بعد"],
  ["Omzet (excl. BTW)", "الإيراد (بدون btw)"],
  ["Omzet", "الإيراد"],
  ["Ongedaan maken", "تراجع"],
  ["Ontkoppelen mislukt", "فشل إلغاء الربط"],
  ["Ontkoppelen mislukt.", "فشل إلغاء الربط."],
  ["Open in Mijn bestanden", "افتح في «ملفاتي»"],
  ["Openstaand", "مستحق"],
  ["Openstaande facturen", "الفواتير غير المسدَّدة"],
  ["Opnieuw", "إعادة المحاولة"],
  ["Pagina {n}", "الصفحة {n}"],
  ["Pin", "بطاقة"],
  ["Plan", "الخطة"],
  ["Privé", "خاص"],
  ["QR naar betaalpagina", "رمز QR لصفحة الدفع"],
  ["Selectie wissen", "مسح التحديد"],
  ["Staat op een factuur", "مُدرَجة في فاتورة"],
  ["Te betalen", "مستحقة الدفع"],
  ["Te bevestigen", "بانتظار التأكيد"],
  ["Te doen", "المهام"],
  ["Terugdraaien", "التراجع عن العملية"],
  ["Uitg.", "صادر"],
  ["Verifiëren", "تحقّق"],
  ["Versturen naar {name}?", "إرسال إلى {name}؟"],
  ["Versturen...", "جارٍ الإرسال…"],
  ["Verwerkt", "تمت المعالجة"],
  ["Verwijderen", "حذف"],
  ["Verwijderen...", "جارٍ الحذف…"],
  ["Voldaan", "مسدَّدة"],
  ["Voorbelasting (5b)", "الضريبة القابلة للخصم (5b)"],
  ["Vorig jaar", "السنة السابقة"],
  ["Vorig kwartaal", "الربع السابق"],
  ["Wat moet er nog gebeuren", "ما الذي يجب فعله بعد"],
  ["Wie ben jij?", "مَن أنت؟"],
  ["Zoek klant op naam of e-mail…", "ابحث عن عميل بالاسم أو البريد الإلكتروني…"],
  ["Zoeken…", "جارٍ البحث…"],
  ["Zonder klant", "بدون عميل"],
  ["factuur", "فاتورة"],
  ["zonder nummer", "بدون رقم"],
  ["{applied} genoteerd · nog {remaining} open", "سُجّل {applied} · لا يزال {remaining} مفتوحًا"],
  ["{count} geselecteerd", "{count} محدَّد"],
  ["{n} dagen te laat", "أيام التأخر: {n}"],
  ["{n} dagen verlopen", "متأخر {n} يومًا"],
  ["{n} facturen", "{n} فاتورة"],];

/**
 * Pairs that must stay APART. Reviewed in section أ: one Arabic word had been serving two Dutch
 * meanings, and the ruling was that the meanings differ enough to need two words.
 *
 * Each carries the reason, because the next reader's instinct will be to unify them — that is
 * exactly what produced the drift the audit found.
 */
export const AR_DELIBERATE_SPLITS: ReadonlyArray<{
  readonly key: string; readonly ar: string; readonly why: string;
}> = [
  { key: "ss.doorsturenMislukt", ar: "فشل إعادة التوجيه",
    why: "doorsturen is narrower than versturen: forwarding an existing message, not sending one" },
  { key: "mfa.uitzetten", ar: "تعطيل",
    why: "uitzetten switches a setting off; stoppen ends a running thing. Not the same act" },
  { key: "ink.beheer", ar: "الإدارة",
    why: "Beheer is the noun (a place you go), Beheren the verb (a thing you do) — Arabic keeps both" },
  { key: "kassa.bon", ar: "إيصال",
    why: "a bon is a receipt, never an invoice; conflating them would mislabel what the owner scanned" },
  { key: "mfa.apparaatVerwijderen", ar: "حذف",
    why: "verwijderen deletes the record; weghalen only takes something out of a context (إزالة)" },
  { key: "oneind.leeg", ar: "لم يُعثر على فواتير",
    why: "a search that found nothing is not the same as having no invoices at all (لا توجد فواتير)" },
  { key: "ink.leeg", ar: "لم يُعثر على فواتير", why: "same Dutch as oneind.leeg, so the same wording" },
  { key: "wh.sub.verschuldigd", ar: "مستحق الدفع",
    why: "verschuldigd is owed and payable; openstaand is merely outstanding (المستحق)" },
  { key: "jaar.kanttekeningen.titel", ar: "ملاحظات جانبية",
    why: "kanttekeningen are marginal remarks or reservations, not the plain notities of a client card" },
  { key: "bank.inlezen", ar: "جارٍ الاستيراد…",
    why: "inlezen imports a file into the books; lezen only reads one (جارٍ القراءة…)" },
  { key: "bank.rematch.geboekt", ar: "دفعات رُبطت تلقائياً.",
    why: "plural; the singular sibling keeps دفعة, because Arabic agrees with number and the app has both keys" },
  { key: "cat.teDoen", ar: "معاملات متبقية",
    why: "plural; cat.teDoenEen is the singular, for the same reason" },
  { key: "prul.nietVerwijderdActie",
    ar: "افصل الملف عن ذلك أولًا، أو احذف ذلك القيد. بعدها يمكنك حذفه من هنا — بهذا لا تبقى إدارتك بقيد بلا مستند داعم.",
    why: "its Dutch is `losmaken` — detaching a file from a booking, not the interface action called «إلغاء الربط». Ruled to keep «افصل»: the unlink wording is scoped to `ontkoppelen`, and «ألغِ ربط الملف عن ذلك» is heavy Arabic for a lighter act" },
  { key: "beh.gezond.nooitGedraaid", ar: "لم يُشغَّل قط",
    why: "nooit gedraaid is about a job that never RAN; nog nooit is a plain never" },
];

/**
 * [AR-FASE2] The third pass: everything that is not a button.
 *
 * 3942 rows — headings, field labels, placeholders, screen-reader text, tooltips, toasts, errors
 * and explanations — each classified by the role it plays on screen, because a heading and a
 * warning are different registers and a reviewer told which one it is answers differently. Rows
 * already settled above were excluded from the sheet, so nobody was asked to re-decide them.
 *
 * It produced 872 corrected values: 375 orthographic, 493 real rewordings — plural agreement after
 * a numeral, «خصم مباشر» for a direct debit where «خصم تلقائي» could be read as an automatic
 * DISCOUNT in a bookkeeping app, and a great many sentences simply said better.
 *
 * ── WHAT THIS PASS DID NOT SETTLE, WHICH IS THE PART WORTH READING ──
 *
 * Three patterns look like rules waiting to be finished, and none of them is one. In each case the
 * reviewer SAW the remaining rows and left them, so "completing" the pattern would overrule the
 * person whose judgement the pass exists to capture:
 *
 *   · tanween. 375 corrections wrote «ـًا» — and 33 reviewed rows kept «ـاً». Mixed on purpose or
 *     not, it is not a rule, and there is no gate.
 *   · quotation marks. 109 values use «…» and 5 keep "…", all five reviewed.
 *   · plural straight after a numeral placeholder. Many became «{n} فاتورة»; 18 stayed
 *     «{n} فواتير», every one of them reviewed.
 *
 * Do not normalise any of the three. If one should become a rule, that is a question for the
 * reviewer, and the answer belongs here.
 *
 * ── AND 43 ROWS ARE HELD, NOT APPLIED ──
 *
 * The pass proposed expanding the compound btw labels — «مبلغ btw», «نسبة btw», «بدون btw»,
 * «شامل btw» — to «ضريبة القيمة المضافة». Those compounds were settled in the previous pass as
 * keeping the term, and AR_SETTLED matches an exact Dutch source, so 43 keys carrying the same
 * compound under a slightly different Dutch string slipped past the gate. They were reverted to
 * the wording the previous pass approved, and the question — whether Arabic should spell the tax
 * out in LABELS as it already does in prose — goes back to the reviewer as one decision instead of
 * being made 43 times by accident.
 *
 * That is the whole reason this file exists: the pass that reviews 3942 rows cannot hold the
 * previous pass's 105 rulings in its head, and a gate can.
 */

/**
 * Words retired by the review, with what replaced them. Whole labels, matched exactly: «إعادة»
 * alone is retired while «إعادة الإرسال» and «إعادة المحاولة» are the words that replaced others.
 */
export const AR_RETIRED: Readonly<Record<string, string>> = {
  "مرة أخرى": "إنشاء نسخة",
  "تكرار": "جدولة الفاتورة",
  "اعرض الفاتورة": "عرض الفاتورة",
  "أعد المحاولة": "إعادة المحاولة",
  "حاول مرة أخرى": "إعادة المحاولة",
  "إعادة": "إعادة المحاولة أو إعادة الإرسال، حسب السياق",
  "فصل": "إلغاء الربط",
  "فكّ الربط": "إلغاء الربط",
  "تثبيت": "حفظ، أو إقفال اليوم",
  "قيّد": "تسجيل",
  "جارٍ العمل…": "جارٍ التنفيذ…",
  "أظهر": "إظهار",
  "اعرض": "عرض",
  "أكّد": "تأكيد",
  "ألغِ": "إلغاء",
  "احذف": "حذف",
  "زَامن": "مزامنة",
  "زامن": "مزامنة",
};

/**
 * The retired wordings that must not survive INSIDE a sentence either, because they are the NAME
 * of a control rather than an ordinary verb. A sentence that points at a button names the button
 * as it is written (AGENTS.md); «فشل فكّ الربط» above a button reading «إلغاء الربط» sends the
 * owner hunting for a word that is nowhere in the interface.
 *
 * This list is short on purpose, and the reason is worth writing down once. Most of AR_RETIRED is
 * retired AS A LABEL only, and is perfectly good Arabic inside prose: «حاول مرة أخرى» closes 85
 * error messages correctly, «أعد المحاولة» closes 35 more. Checking AR_RETIRED by substring would
 * condemn all 120 and force them into a register the reviewer did not ask for. So the substring
 * rule holds only for wordings that name a thing, and each entry earns its place by being one.
 *
 * Two unlink verbs are deliberately NOT here, and both were measured before being left out:
 *   · «فصل» appears in 11 values, 7 of them «منفصل/منفصلة» meaning separate — a different word
 *     that happens to share three letters. Listing it would condemn seven correct sentences.
 *   · «افصل» appears in prul.nietVerwijderdActie, whose Dutch is `losmaken`, not `ontkoppelen`.
 *     That sentence is the same defect and has not been ruled on yet, so the rule that would catch
 *     it is not armed. This list grows when that ruling arrives — not before, because a gate that
 *     is red on purpose is a gate everyone learns to skip.
 */
export const AR_RETIRED_EVERYWHERE: Readonly<Record<string, string>> = {
  "فكّ الربط": "إلغاء الربط",
  "فكّ ربط": "إلغاء ربط", // the same name in construct state: «فكّ ربط دفعة جماعية»
  "افكك ربط": "ألغِ ربط",
  "كاسة": "كاشير", // the till, and it names a thing — it lived inside «شاشة الكاسة», never alone
  "رقم BTW": "رقم btw",
  "رقم ضريبة القيمة المضافة": "رقم btw", // the BARE «ضريبة القيمة المضافة» is not retired: it
                                          // names the tax itself in six values and stays there
  "رقم الضريبة": "رقم btw",
};

/**
 * English says VAT. The reviewer's ruling, in their words: use `VAT` wherever `BTW` is merely the
 * Dutch abbreviation for it — sentences, headings and ordinary fields alike — and preserve the
 * legally specific Dutch terms.
 *
 * In practice that is ONE exception, and this pattern is it: «BTW number», the name of the Dutch
 * legal field. An owner who types their btw-nummer into a form labelled "VAT number" has to work
 * out that the two are the same thing, on the one screen where being wrong is expensive.
 *
 * Everything else went: 33 occurrences across 30 values. Before the ruling the app said `VAT` in
 * 163 values and `BTW` in 38, and one sentence — inst.kasstelselUitleg — used BOTH for the same
 * tax, two clauses apart. That sentence is why this is a rule and not a preference.
 *
 * A named Dutch tax form spelled in Dutch («btw-aangifte») would also stay, per the same ruling.
 * None exists in an English value today; if one is added, it needs no entry here because it is not
 * the string this pattern or the gate looks for.
 *
 * [TAAL] This English ruling lives in a file named for Arabic on purpose: it is the record of
 * language decisions, and a second file is one nobody finds when they are about to re-decide.
 */
export const EN_VAT_KEEPS_BTW = /BTW[- ](number|nummer)/i;

/** Dutch forms retired in favour of one form per action, so the source cannot re-teach a split. */
export const NL_RETIRED: Readonly<Record<string, string>> = {
  Ververs: "Vernieuwen", Stuur: "Versturen", "Opnieuw sturen": "Opnieuw versturen",
  "Bekijk factuur": "Factuur bekijken", "Bekijk de factuur": "Factuur bekijken",
  Sluit: "Sluiten", Pauzeer: "Pauzeren", Hervat: "Hervatten", Negeer: "Negeren",
  Bekijk: "Bekijken", Verwijder: "Verwijderen", Annuleer: "Annuleren", Toon: "Tonen",
  Selecteer: "Selecteren",
};
