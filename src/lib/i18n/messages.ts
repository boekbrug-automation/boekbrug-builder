// src/lib/i18n/messages.ts
// [TAAL] The message catalogue. Pure data. Run: npx tsx --test src/lib/i18n/messages.test.ts
//
// Dutch is the SOURCE. Every message is written in Dutch first, because that is the language the
// product's legal strings are correct in, and it is the fallback when a translation is missing —
// so a gap always leaves something true on the screen rather than a key or a blank.
//
// ── TWO RULES THAT KEEP A TRANSLATION FROM DOING HARM ───────────────────────────────────────────
//
// 1. A NOUN INSIDE A SENTENCE IS NOT A PARAMETER. The Dutch copy used to build "Een verstuurde
//    {woord} pas je niet meer aan" by substituting "factuur" or "creditnota". That works in Dutch
//    and breaks everywhere else: Arabic agreement, Turkish suffix harmony and even English
//    articles all depend on the noun. So the document type gets its OWN key per sentence. It costs
//    a few more entries and removes an entire class of mistranslation.
//
// 2. A SENTENCE THAT POINTS AT A BUTTON MUST NAME THE BUTTON AS IT IS WRITTEN. "Facturen" and
//    "Verzonden" are on the screen in Dutch today. An Arabic sentence that translates them sends
//    the owner looking for a word that is nowhere in the interface. So the Arabic keeps the Dutch
//    label and explains around it. When those labels are themselves translated, these strings
//    change with them — and the test below is what will find them.
//
// ── WHAT IS NOT IN HERE, AND WILL NOT BE ────────────────────────────────────────────────────────
//
// The invoice PDF, the e-mail to the customer and the e-factuur XML. Those are read by a Dutch
// customer, an accountant and the Belastingdienst — never by the owner's language setting. They
// stay Dutch in every language. Translating them would change what the documents ARE.
//
// ── TURKISH ─────────────────────────────────────────────────────────────────────────────────────
//
// Deliberately absent for now, and that is a decision, not an oversight. There are 53 Turkish
// blog articles, so the audience is real — but this copy talks about a number that becomes legally
// permanent, and unreviewed Turkish on that subject is worse than Dutch the owner already
// tolerates. The fallback exists exactly for this: `tr` reads Dutch until a Turkish speaker writes
// these lines. Nothing else has to change when they do.

import type { Locale } from './locale'

/** Dutch is required; the rest may be absent and then fall back to it. */
export type Message = { nl: string } & Partial<Record<Locale, string>>

export const MESSAGES = {
  // ─── [STATUS] The word for an invoice's state. One definition, seven former ones ────────────

  'status.draft': { nl: 'Concept', ar: 'مسودة', en: 'Draft' },
  'status.sent': { nl: 'Verzonden', ar: 'مُرسَلة', en: 'Sent' },
  'status.paid': { nl: 'Betaald', ar: 'مدفوعة', en: 'Paid' },
  'status.overdue': { nl: 'Verlopen', ar: 'متأخرة', en: 'Overdue' },
  // 'Te betalen', not 'Ontvangen'. Eleven copies of these labels disagreed about four statuses,
  // and this is the only one where the disagreement was about MEANING rather than wording:
  // "Ontvangen" describes the document, "Te betalen" describes what the owner has to do about it.
  // The second is the useful one on a screen full of incoming bills, and it matches the amber chip
  // — see the note in invoice-status.ts about why an unpaid bill may not look settled.
  'status.received': { nl: 'Te betalen', ar: 'مستحقة الدفع', en: 'To pay' },
  // 'Te verifiëren' over 'In behandeling': it names what is actually waiting — a human still has
  // to check this reading — where "in behandeling" could mean anything is happening.
  'status.processing': { nl: 'Te verifiëren', ar: 'بانتظار التدقيق', en: 'To verify' },
  'status.processed': { nl: 'Verwerkt', ar: 'تمت المعالجة', en: 'Processed' },
  'status.unclear': { nl: 'Onduidelijk', ar: 'غير واضحة', en: 'Unclear' },
  'status.credit': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },

  // 'Alles' is a FILTER, not a status — it is the absence of one, so it has no entry above.
  'filter.all': { nl: 'Alles', ar: 'الكل', en: 'All' },
  'filter.offerte': { nl: 'Offerte', ar: 'عرض سعر', en: 'Quote' },
  // Not a status: the OPPOSITE direction. Money coming to you instead of leaving.
  'chip.toReceive': { nl: 'Te ontvangen', ar: 'مستحقة لك', en: 'To receive' },

  // ─── [NAV] The bar the owner sees on every screen ────────────────────────────────────────────

  'nav.aria': { nl: 'Hoofdnavigatie', ar: 'التنقّل الرئيسي', en: 'Main navigation' },
  'nav.start': { nl: 'Start', ar: 'البداية', en: 'Start' },
  'nav.invoices': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'nav.incoming': { nl: 'Inkomend', ar: 'الوارد', en: 'Incoming' },
  'nav.files': { nl: 'Bestanden', ar: 'الملفات', en: 'Files' },
  'nav.clients': { nl: 'Klanten', ar: 'العملاء', en: 'Clients' },
  'nav.quarter': { nl: 'Kwartaal', ar: 'الربع', en: 'Quarter' },

  // ─── [KADER] De naam van het scherm, in de balk die om ELK scherm heen staat ────────────────
  //
  // DashboardChrome hield deze namen als kale Nederlandse tekst, met een goede reden erbij: het is
  // de eerste-verf-naam, en een scherm dat zijn eigen titel aanmeldt wint ervan. Alleen geldt dat
  // laatste niet voor elk scherm — en waar het niet geldt, staat de naam er niet even, maar altijd.
  // Een Arabische eigenaar las dus een vertaald scherm in een Nederlandse lijst, op elke pagina.
  //
  // De namen staan hier in dezelfde volgorde als in dat bestand, zodat de twee naast elkaar te
  // lezen zijn. Ze blijven bewust KORT: het is een balk, geen zin.
  'chrome.vandaag': { nl: 'Vandaag', ar: 'اليوم', en: 'Today' },
  'chrome.brug': { nl: 'Brug', ar: 'الجسر', en: 'Bridge' },
  'chrome.kas': { nl: 'Kas', ar: 'الصندوق', en: 'Cash' },
  'chrome.aangifte': { nl: 'Aangifte', ar: 'الإقرار الضريبي', en: 'Tax return' },
  'chrome.dagomzet': { nl: 'Dagomzet', ar: 'إيراد اليوم', en: 'Daily turnover' },
  'chrome.uploaden': { nl: 'Uploaden', ar: 'رفع ملف', en: 'Upload' },
  'chrome.artikelen': { nl: 'Artikelen', ar: 'المنتجات', en: 'Items' },
  'chrome.jaaroverzicht': { nl: 'Jaaroverzicht', ar: 'ملخّص السنة', en: 'Year overview' },
  'chrome.grootboek': { nl: 'Grootboek', ar: 'دفتر الأستاذ', en: 'Grootboek' },
  // [DEUR] Kassa, Voertuigen, Team en Uren staan óók in deze balk — maar met hun eigen
  // schermtitel (kassa.titel, vtg.titel, team.titel, uren.titel) en niet met een tweede
  // chrome.*-sleutel ernaast. Eén scherm, één naam: twee sleutels met hetzelfde woord erin is
  // precies hoe een balk en een pagina na een halfjaar anders gaan heten. Zie DashboardChrome.
  'chrome.kluis': { nl: 'Kluis', ar: 'الخزنة', en: 'Vault' },
  'chrome.logboek': { nl: 'Logboek', ar: 'سجل النشاط', en: 'Activity log' },
  'chrome.beveiliging': { nl: 'Beveiliging', ar: 'الأمان', en: 'Security' },
  // De vragen die de BOEKHOUDER aan de ondernemer stelt — vandaar "van je boekhouder".
  'chrome.vragen': { nl: 'Vragen van je boekhouder', ar: 'أسئلة من محاسبك', en: 'Questions from your accountant' },
  'chrome.klaar': { nl: 'Ben ik klaar?', ar: 'هل أنا جاهز؟', en: 'Am I ready?' },
  'chrome.kwartaaloverzicht': { nl: 'Kwartaaloverzicht', ar: 'ملخّص الربع', en: 'Quarter overview' },
  'chrome.waarheid': { nl: 'Waarheid', ar: 'حقيقتك', en: 'Truth' },
  'chrome.bank': { nl: 'Bank', ar: 'البنك', en: 'Bank' },
  'chrome.categoriseren': { nl: 'Wat is dit?', ar: 'ما هذا؟', en: 'What is this?' },
  'chrome.instellingen': { nl: 'Instellingen', ar: 'الإعدادات', en: 'Settings' },
  'chrome.facturering': { nl: 'Facturering', ar: 'الفوترة', en: 'Invoicing' },
  'chrome.berichten': { nl: 'Berichten', ar: 'الرسائل', en: 'Messages' },
  'chrome.werkplek': { nl: 'Mijn werkplek', ar: 'مساحة عملي', en: 'My workspace' },
  'chrome.klantenBeheren': { nl: 'Klanten beheren', ar: 'إدارة العملاء', en: 'Manage clients' },
  'chrome.agenda': { nl: 'Aangifte & status', ar: 'الإقرار والحالة', en: 'Return & status' },
  'chrome.voorbeeld': { nl: 'Voorbeeldklant', ar: 'عميل تجريبي', en: 'Example client' },
  'chrome.factuurNamens': { nl: 'Factuur namens klant', ar: 'فاتورة نيابةً عن عميل', en: 'Invoice on behalf of a client' },
  'chrome.openstaand': { nl: 'Openstaande facturen', ar: 'الفواتير غير المسدَّدة', en: 'Outstanding invoices' },
  'chrome.opvragen': { nl: 'Stukken opvragen', ar: 'طلب المستندات', en: 'Request documents' },
  'chrome.kantoorgids': { nl: 'Kantoorgids', ar: 'دليل المكاتب', en: 'Office directory' },
  'chrome.control': { nl: 'Control Center', ar: 'مركز التحكم', en: 'Control Center' },
  'chrome.bevestigen': { nl: 'Bevestigen', ar: 'تأكيد', en: 'Confirm' },
  // "Mijn", omdat de boekhouder hiernaast ook de facturen van zijn KLANTEN ziet.
  'chrome.mijnFacturen': { nl: 'Mijn facturen', ar: 'فواتيري', en: 'My invoices' },
  'chrome.mijnKlanten': { nl: 'Mijn klanten', ar: 'عملائي', en: 'My clients' },
  'chrome.leveranciers': {
    nl: 'Leveranciers',
    ar: 'المورّدون',
    en: 'Suppliers',
    tr: 'Tedarikçiler',
  },
  'chrome.inkoopfacturen': { nl: 'Inkoopfacturen', ar: 'فواتير المشتريات', en: 'Purchase invoices' },
  'chrome.inkomend': { nl: 'Inkomend', ar: 'الوارد', en: 'Incoming' },
  'chrome.nieuweFactuur': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'chrome.factuurBewerken': { nl: 'Factuur bewerken', ar: 'تعديل الفاتورة', en: 'Edit invoice' },
  'chrome.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'chrome.klant': { nl: 'Klant', ar: 'العميل', en: 'Client' },
  'chrome.gesprek': { nl: 'Gesprek', ar: 'محادثة', en: 'Conversation' },
  'chrome.kwartaal': { nl: 'Kwartaal', ar: 'الربع', en: 'Quarter' },

  // ─── [NIEUW] Het scherm waar een factuur gemaakt wordt ──────────────────────────────────────
  //
  // De meest gebruikte schermvulling van de app, en de eerste hele PAGINA in de catalogus. De
  // volgorde volgt het scherm van boven naar beneden, zodat een vertaler de zinnen in context
  // leest in plaats van als een alfabetische lijst.
  //
  // Wat hier NIET in staat: de placeholder-voorbeelden die een NEDERLANDS formaat tonen —
  // 'NL123456789B01', '1234 AB', 'Straatnaam 1', 'Amsterdam'. Dat zijn geen woorden maar het
  // formaat waarin de Belastingdienst en PostNL het willen zien; een Arabisch voorbeeld zou de
  // ondernemer een postcode laten typen die hier niet bestaat.

  'nieuw.titel.factuur': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  // [NUMMER-VOORUITBLIK] De kop draagt het verwachte nummer zodra het bekend is — de eigenaar moet
  // bij BINNENKOMST weten welk nummer dit document straks krijgt, niet halverwege het formulier.
  // "(verwacht)" reist mee in de kop zelf: een kaal getal daar zou als toezegging lezen, en het
  // nummer valt pas definitief bij verzending.
  'nieuw.titel.factuurMetNummer': {
    nl: 'Nieuwe factuur · {nummer} (verwacht)',
    ar: 'فاتورة جديدة · {nummer} (متوقّع)',
    en: 'New invoice · {nummer} (expected)',
  },
  'nieuw.titel.offerte': { nl: 'Nieuwe offerte', ar: 'عرض سعر جديد', en: 'New quote' },
  'nieuw.type': { nl: 'Type document', ar: 'نوع المستند', en: 'Document type' },
  'nieuw.type.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'nieuw.type.offerte': { nl: 'Offerte', ar: 'عرض سعر', en: 'Quote' },
  'nieuw.type.creditnota': { nl: 'Losse creditnota', ar: 'إشعار دائن مستقل', en: 'Standalone credit note' },

  'nieuw.klant.aan': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'nieuw.klant.van': { nl: 'Van', ar: 'من', en: 'From' },
  'nieuw.klant.zoek': { nl: 'Zoek of typ klantnaam...', ar: 'ابحث أو اكتب اسم العميل...', en: 'Search or type a client name...' },
  'nieuw.klant.bedrijf': { nl: 'Bedrijfsnaam', ar: 'اسم الشركة', en: 'Company name' },
  'nieuw.klant.email': { nl: 'E-mailadres', ar: 'البريد الإلكتروني', en: 'E-mail address' },
  'nieuw.klant.adres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'nieuw.klant.postcode': { nl: 'Postcode', ar: 'الرمز البريدي', en: 'Postcode' },
  'nieuw.klant.stad': { nl: 'Stad', ar: 'المدينة', en: 'City' },
  // [KLANT-LAND] The customer's country as an ISO code; empty reads as the Netherlands.
  'nieuw.klant.land': { nl: 'Land (code, bijv. NL)', ar: 'الدولة (رمز، مثل NL)', en: 'Country (code, e.g. NL)' },
  'nieuw.klant.btw': { nl: 'BTW-nummer klant', ar: 'رقم btw للعميل', en: "Client's VAT number" },
  'nieuw.klant.btwFormaat': { nl: 'Verwacht formaat: NL123456789B01', ar: 'الصيغة المتوقّعة: NL123456789B01', en: 'Expected format: NL123456789B01' },
  // Het PO-nummer blijft een Nederlands voorbeeldformaat — zie de kop van dit blok.
  'nieuw.klant.extraHint': { nl: 'Afdeling of PO-2026-114', ar: 'القسم أو PO-2026-114', en: 'Department or PO-2026-114' },
  'nieuw.klant.extra1': { nl: 'Extra regel 1', ar: 'سطر إضافي 1', en: 'Extra line 1' },
  'nieuw.klant.extra2': { nl: 'Extra regel 2', ar: 'سطر إضافي 2', en: 'Extra line 2' },
  'nieuw.klant.extra3': { nl: 'Extra regel 3', ar: 'سطر إضافي 3', en: 'Extra line 3' },
  'nieuw.klant.extra4': { nl: 'Extra regel 4', ar: 'سطر إضافي 4', en: 'Extra line 4' },
  'nieuw.klant.extraUitleg': {
    nl: 'Deze vier regels komen op het document direct onder de klantnaam te staan. Laat ze leeg als je ze niet nodig hebt.',
    ar: 'هذه الأسطر الأربعة تظهر على المستند مباشرة تحت اسم العميل. اتركها فارغة إن لم تحتجها.',
    en: 'These four lines appear on the document directly under the customer name. Leave them empty if you do not need them.',
  },

  'nieuw.datums': { nl: 'Datums', ar: 'التواريخ', en: 'Dates' },
  'nieuw.datum.factuur': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'nieuw.datum.offerte': { nl: 'Offertedatum', ar: 'تاريخ عرض السعر', en: 'Quote date' },
  'nieuw.datum.verval': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'nieuw.datum.geldig': { nl: 'Geldig tot', ar: 'صالح حتى', en: 'Valid until' },
  'nieuw.datum.lever': { nl: 'Leverdatum', ar: 'تاريخ التسليم', en: 'Delivery date' },
  // Art. 35a lid 1 sub f — waarom dit veld verplicht is op een factuur.
  'nieuw.datum.leverUitleg': {
    nl: 'Leverdatum = datum waarop de levering of dienst is verricht.',
    ar: 'تاريخ التسليم = اليوم الذي تمّ فيه تسليم البضاعة أو أداء الخدمة.',
    en: 'Delivery date = the day the goods or service were actually delivered.',
  },
  'nieuw.termijn': { nl: 'Betalingstermijn in dagen', ar: 'مهلة السداد بالأيام', en: 'Payment term in days' },
  'nieuw.termijn.kort': { nl: 'Betalingstermijn:', ar: 'مهلة السداد:', en: 'Payment term:' },
  'nieuw.termijn.dagen': { nl: 'dagen', ar: 'يومًا', en: 'days' },

  'nieuw.regels.factuur': { nl: 'Factuurregels', ar: 'بنود الفاتورة', en: 'Invoice lines' },
  'nieuw.regels.offerte': { nl: 'Offerteregels', ar: 'بنود عرض السعر', en: 'Quote lines' },
  'nieuw.regel.omschrijving': { nl: 'Omschrijving', ar: 'الوصف', en: 'Description' },
  'nieuw.regel.aantal': { nl: 'Aantal', ar: 'الكمية', en: 'Quantity' },
  'nieuw.regel.artikelcode': { nl: 'Artikelcode', ar: 'رمز الصنف', en: 'Article code' },
  'nieuw.regel.codeHint': { nl: 'Omschrijving of code (bijv. 22)', ar: 'الوصف أو الرمز (مثلًا 22)', en: 'Description or code (e.g. 22)' },
  'nieuw.regel.codeVoorbeeld': { nl: 'code (bijv. 22)', ar: 'رمز (مثلًا 22)', en: 'code (e.g. 22)' },
  'nieuw.regel.prijsExcl': { nl: 'Prijs excl. (€)', ar: 'السعر بدون ضريبة (€)', en: 'Price excl. (€)' },
  'nieuw.regel.prijsIncl': { nl: 'Prijs incl. (€)', ar: 'السعر شامل الضريبة (€)', en: 'Price incl. (€)' },
  'nieuw.regel.vrijgesteld': { nl: 'Vrijgesteld', ar: 'مُعفى', en: 'Exempt' },
  // [VERLEGD-VERKOOP] The verleggingsregeling on a line, and what the owner must fill in for it.
  'nieuw.regel.verlegd': { nl: 'Btw verlegd', ar: 'الضريبة محوَّلة إلى العميل', en: 'VAT reverse-charged' },
  'nieuw.regel.verlegdHint': { nl: 'Btw verlegd naar de klant: het btw-nummer van de klant komt op de factuur.', ar: 'الضريبة محوَّلة إلى العميل: يُطبع رقم btw الخاص بالعميل على الفاتورة.', en: 'VAT shifted to the customer: the customer’s VAT number goes on the invoice.' },
  'nieuw.fout.verlegdZonderBtw': { nl: 'Een regel met btw verlegd vraagt om het btw-nummer van de klant. Vul het in bij de klant.', ar: 'بند بضريبة محوَّلة يتطلب رقم btw الخاص بالعميل. أدخله في بيانات العميل.', en: 'A reverse-charged line needs the customer’s VAT number. Enter it on the customer.' },

  'nieuw.prijsmodus': { nl: 'Prijzen invoeren', ar: 'إدخال الأسعار', en: 'Entering prices' },
  'nieuw.prijsmodus.aria': { nl: 'Prijzen invoeren inclusief of exclusief btw', ar: 'إدخال الأسعار شاملةً الضريبة أو بدونها', en: 'Enter prices including or excluding VAT' },
  'nieuw.prijsmodus.excl': { nl: 'Je typt de prijs zonder btw; wij tellen de btw erbij.', ar: 'تكتب السعر بدون ضريبة القيمة المضافة، ونحن نضيف الضريبة إليه.', en: 'You type the price without VAT; we add the VAT.' },
  'nieuw.prijsmodus.incl': { nl: 'Je typt wat je klant betaalt; wij rekenen de btw eruit.', ar: 'تكتب ما يدفعه العميل، ونحن نستخرج الضريبة منه.', en: 'You type what your customer pays; we work the VAT back out.' },

  'nieuw.korting': { nl: 'Korting', ar: 'خصم', en: 'Discount' },
  // [REGEL-KORTING] De korting die bij één regel hoort, naast de korting op de hele factuur.
  'nieuw.regelKorting': { nl: 'Korting op deze regel', ar: 'خصم على هذا البند', en: 'Discount on this line' },
  'nieuw.regelKorting.weg': { nl: 'Korting weghalen', ar: 'إزالة الخصم', en: 'Remove discount' },
  'nieuw.korting.percentage': { nl: 'Kortingspercentage', ar: 'نسبة الخصم', en: 'Discount percentage' },
  'nieuw.korting.bedrag': { nl: 'Kortingsbedrag', ar: 'مبلغ الخصم', en: 'Discount amount' },
  'nieuw.korting.foutPercentage': { nl: 'Vul een percentage tussen 0 en 100 in.', ar: 'أدخل نسبة بين 0 و100.', en: 'Enter a percentage between 0 and 100.' },
  'nieuw.korting.foutBedrag': { nl: 'Vul een bedrag boven 0 in.', ar: 'أدخل مبلغًا أكبر من 0.', en: 'Enter an amount above 0.' },

  'nieuw.totaal.subtotaal': { nl: 'Subtotaal excl. BTW', ar: 'المجموع الفرعي بدون ضريبة', en: 'Subtotal excl. VAT' },
  'nieuw.totaal.naKorting': { nl: 'Na korting excl. BTW', ar: 'بعد الخصم، بدون ضريبة', en: 'After discount, excl. VAT' },
  'nieuw.totaal.incl': { nl: 'Totaal incl. BTW', ar: 'الإجمالي شامل الضريبة', en: 'Total incl. VAT' },

  'nieuw.betaalinfo': { nl: 'Betalingsinformatie', ar: 'معلومات الدفع', en: 'Payment details' },
  'nieuw.betaalkenmerk': { nl: 'Betalingskenmerk', ar: 'مرجع الدفع', en: 'Payment reference' },
  'nieuw.betaalkenmerk.hint': { nl: 'Kostenplaats of contractnummer', ar: 'مركز التكلفة أو رقم العقد', en: 'Cost centre or contract number' },

  'nieuw.actie.versturen': { nl: 'Opslaan en versturen', ar: 'حفظ وإرسال', en: 'Save and send' },
  'nieuw.actie.offerteOpslaan': { nl: 'Offerte opslaan', ar: 'حفظ عرض السعر', en: 'Save quote' },
  // [OFFERTE-VERSTUREN-NIEUW] De hoofdknop op het opstelscherm: opslaan én meteen als offerte naar
  // de klant mailen, langs de deur die geen nummer kán slaan (/api/invoice/[id]/send-offerte).
  'nieuw.actie.offerteVersturen': { nl: 'Offerte versturen', ar: 'إرسال عرض السعر', en: 'Send quote' },
  'nieuw.offerte.verstuurdTitel': { nl: 'Offerte verstuurd', ar: 'أُرسل عرض السعر', en: 'Quote sent' },
  'nieuw.offerte.naarDetail': { nl: 'Naar de offerte', ar: 'إلى عرض السعر', en: 'To the quote' },
  'nieuw.actie.concept': { nl: 'Opslaan als concept', ar: 'حفظ كمسودة', en: 'Save as draft' },
  'nieuw.actie.bezig': { nl: 'Bezig...', ar: 'جارٍ التنفيذ…', en: 'Working...' },
  'nieuw.actie.laden': { nl: 'Laden...', ar: 'جارٍ التحميل…', en: 'Loading...' },
  'nieuw.actie.versturenBezig': { nl: 'Versturen...', ar: 'جارٍ الإرسال…', en: 'Sending...' },
  'nieuw.actie.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  // [PDF-VOORBEELD] Het document zien vóór het onomkeerbaar is. "Bekijk" en niet "Download": de
  // ondernemer wil kijken, niet een bestand in zijn map. De browser opent zijn eigen viewer.
  // [NUMMER-VOORUITBLIK] Welk nummer deze factuur straks krijgt. Een VERWACHTING, geen belofte:
  // het nummer wordt pas bij verzending toegekend, atomair, uit de doorlopende reeks (art. 35 Wet
  // OB). Verstuurt iemand anders in de tussentijd een factuur, of wijzigt de ondernemer zijn
  // sjabloon in Instellingen, dan is het een ander nummer — en de zin zegt dat, in plaats van een
  // getal te tonen dat als vaststaand leest.
  'nieuw.nummer.volgende': { nl: 'Volgend factuurnummer', ar: 'رقم الفاتورة التالي', en: 'Next invoice number' },
  'nieuw.nummer.verwacht': {
    nl: 'Verwacht — het nummer wordt definitief bij verzending.',
    ar: 'متوقّع — يُخصَّص الرقم نهائيًا عند الإرسال.',
    en: 'Expected — the number becomes final on sending.',
  },
  'nieuw.pdf.knop': { nl: 'PDF', ar: 'PDF', en: 'PDF' },
  'nieuw.actie.pdfBekijken': { nl: 'Bekijk als PDF', ar: 'عرض كـ PDF', en: 'View as PDF' },
  'nieuw.actie.pdfBezig': { nl: 'PDF maken...', ar: 'جارٍ إنشاء PDF...', en: 'Building PDF...' },
  // [NO-SILENT-EMPTY] Een knop die stil niets doet is erger dan een knop die zegt dat het misging.
  'nieuw.actie.pdfMislukt': {
    nl: 'Voorbeeld lukt niet',
    ar: 'تعذّر إنشاء المعاينة',
    en: 'Preview unavailable',
  },
  // Het voorbeeld draagt nog geen nummer, en dat mag niet als een fout lezen: het nummer wordt
  // pas bij verzending toegekend, uit de doorlopende reeks (art. 35 Wet OB).
  'nieuw.pdf.nogGeenNummer': { nl: 'CONCEPT', ar: 'مسودة', en: 'DRAFT' },

  'nieuw.bevestig.titel': { nl: 'Factuur versturen?', ar: 'إرسال الفاتورة؟', en: 'Send the invoice?' },
  // Art. 35 Wet OB, gezegd vóórdat het gebeurt. De <strong> om "definitief nummer" is opgeofferd:
  // een zin met opmaak middenin is in elke taal een andere zin, en dat is precies de reden dat
  // vertalers hem stukgeknipt terugkrijgen. De nadruk zit nu in de woorden zelf.
  'nieuw.bevestig.uitleg': {
    nl: 'Bij verzenden krijgt de factuur een definitief nummer en wordt de PDF per e-mail bezorgd. Dit kan niet ongedaan worden gemaakt.',
    ar: 'عند الإرسال تأخذ الفاتورة رقمًا نهائيًا ويُسلَّم ملف PDF بالبريد الإلكتروني. ولا يمكن التراجع عن ذلك.',
    en: 'On sending, the invoice gets a permanent number and the PDF is delivered by e-mail. This cannot be undone.',
  },
  'nieuw.bevestig.ja': { nl: 'Ja, verstuur', ar: 'نعم، أرسلها', en: 'Yes, send it' },
  'nieuw.bevestig.aan': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'nieuw.bevestig.email': { nl: 'E-mail', ar: 'البريد الإلكتروني', en: 'E-mail' },
  'nieuw.bevestig.bedrag': { nl: 'Bedrag', ar: 'المبلغ', en: 'Amount' },

  'nieuw.fout.velden': { nl: 'Vul de rood gemarkeerde velden in', ar: 'املأ الحقول المُعلَّمة بالأحمر', en: 'Fill in the fields marked red' },
  // [KLANT-LAND] A 0% invoice to a business in another member state needs the customer's btw-id.
  'nieuw.fout.euZonderBtw': { nl: 'Klant in {land} (EU) zonder btw-nummer: vul het in, of reken Nederlandse btw.', ar: 'عميل في {land} (الاتحاد الأوروبي) بلا رقم btw: أدخله، أو احسب الضريبة الهولندية.', en: 'Customer in {land} (EU) without a VAT number: enter it, or charge Dutch VAT.' },
  'nieuw.fout.btwKlant': { nl: 'Het BTW-nummer van de klant lijkt onjuist (verwacht: NL123456789B01)', ar: 'رقم btw للعميل يبدو غير صحيح (المتوقّع: NL123456789B01)', en: "The client's VAT number looks wrong (expected: NL123456789B01)" },
  // [WAARSCHUWING-GEHOORD] Het concept is opgeslagen zonder de korting, dus de factuur zou voor
  // de volle prijs de deur uit gaan. Gezegd VOORDAT het nummer valt: daarna is de factuur wettelijk
  // uitgegeven en is crediteren de enige weg terug.
  'nieuw.fout.kortingNietOpgeslagen': {
    nl: 'De korting is niet opgeslagen — deze factuur zou voor de volle prijs verstuurd worden. Er is nog niets verstuurd; probeer het opnieuw.',
    ar: 'لم يُحفَظ الخصم — كانت هذه الفاتورة سترسل بالسعر الكامل. لم يُرسَل شيء بعد؛ حاول مرة أخرى.',
    en: 'The discount was not saved — this invoice would go out at the full price. Nothing has been sent; please try again.',
  },
  'nieuw.fout.aanmaken': { nl: 'Aanmaken mislukt — probeer opnieuw', ar: 'فشل الإنشاء — حاول مرة أخرى', en: 'Could not create it — please try again' },
  'nieuw.fout.versturen': { nl: 'Verzenden mislukt — de factuur is opgeslagen als concept', ar: 'فشل الإرسال — حُفظت الفاتورة كمسودة', en: 'Sending failed — the invoice was saved as a draft' },
  'nieuw.fout.catalogus': { nl: 'Opslaan in de catalogus lukte niet.', ar: 'تعذّر الحفظ في الكتالوج.', en: 'Could not save it to the catalogue.' },
  // [MIN-REGEL] A credit line inside an invoice is ordinary — a return the supplier settles on the
  // next invoice. Once the credits outweigh the deliveries the document gives money back, and that
  // is a creditnota: its own number series and the other side of the aangifte. "Creditnota" stays
  // Dutch in every language — it is the word on the button the owner has to press next.
  'nieuw.fout.creditnota': {
    nl: 'De creditregels zijn samen meer dan wat je levert, dus dit is een creditnota en geen factuur. Maak er een creditnota van, of vul regels aan tot het totaal niet negatief is.',
    ar: 'قيمة الأسطر الدائنة معًا أكبر مما تسلّمه، فهذا إشعار دائن وليس فاتورة. حوّله إلى إشعار دائن، أو أكمِل الأسطر حتى لا يكون المجموع سالبًا.',
    en: 'The credit lines together exceed what you deliver, so this is a creditnota and not an invoice. Make it a creditnota, or add lines until the total is not negative.',
  },

  'nieuw.banner.vanOfferte': { nl: 'Factuur op basis van offerte', ar: 'فاتورة مبنيّة على عرض سعر', en: 'Invoice based on a quote' },
  // [AANBETALING] The banner on a deposit invoice, and the note on the final one.
  'nieuw.banner.aanbetaling': { nl: 'Aanbetaling {pct}% op de offerte', ar: 'دفعة مقدمة {pct}% على عرض السعر', en: 'Deposit of {pct}% on the quote' },
  'nieuw.banner.aanbetalingUitleg': { nl: 'De offerte blijft open. De eindfactuur verrekent dit bedrag vanzelf.', ar: 'يبقى عرض السعر مفتوحًا. الفاتورة النهائية تخصم هذا المبلغ تلقائيًا.', en: 'The quote stays open. The final invoice settles this amount by itself.' },
  'nieuw.banner.aanbetalingVerrekend': { nl: 'Verrekend: {numbers}', ar: 'تمّت مقاصّته: {numbers}', en: 'Settled: {numbers}' },
  // [AANBETALING-KORTING] The offerte's document discount is on the lines when a deposit is settled.
  'nieuw.banner.kortingAlsRegel': { nl: 'De korting van de offerte staat als regel', ar: 'خصم عرض السعر مُدرج كبند', en: 'The quote’s discount is a line' },
  'nieuw.banner.vervangend': { nl: 'Vervangende factuur', ar: 'فاتورة بديلة', en: 'Replacement invoice' },
  'nieuw.banner.gevonden': { nl: 'We vonden de factuur die je eerder maakte', ar: 'وجدنا الفاتورة التي أنشأتها سابقًا', en: 'We found the invoice you made earlier' },
  'nieuw.banner.overnemen': { nl: 'Overnemen', ar: 'استخدامها', en: 'Use it' },
  'nieuw.banner.opnieuw': { nl: 'Nee, opnieuw beginnen', ar: 'لا، ابدأ من جديد', en: 'No, start over' },


  'nieuw.eenheid.aangepast': { nl: 'Aangepast', ar: 'مخصّص', en: 'Custom' },
  'nieuw.eenheid.bewaar': { nl: 'Bewaar', ar: 'حفظ', en: 'Save' },
  'nieuw.eenheid.annuleer': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'nieuw.catalogus.in': { nl: 'In catalogus', ar: 'في الكتالوج', en: 'In the catalogue' },
  'nieuw.catalogus.bewaar': { nl: 'Bewaar in catalogus', ar: 'احفظ في الكتالوج', en: 'Save to catalogue' },
  'nieuw.catalogus.aanvullen': { nl: 'Aanvullen', ar: 'أضف للكتالوج', en: 'Add to catalogue' },

  // [VERTAAL] De ondernemer typt de omschrijving in zijn eigen taal en de knop zet hem om naar
  // het Nederlands — want de KLANT leest die regel op de factuur. Dat is precies de scheiding uit
  // de kop van dit bestand: het scherm volgt de ondernemer, het document blijft Nederlands.
  'nieuw.vertaal': { nl: 'Vertaal', ar: 'ترجم', en: 'Translate' },
  'nieuw.vertaal.doel': { nl: 'voor professioneel Nederlands', ar: 'لتصبح هولندية احترافية', en: 'for professional Dutch' },
  'nieuw.vertaal.uitleg': { nl: 'Schrijf in uw eigen taal — druk op', ar: 'اكتب بلغتك — ثم اضغط', en: 'Write in your own language — then press' },

  // ─── [LIJST] Het facturenoverzicht — het scherm dat de ondernemer het vaakst opent ──────────

  'lijst.zoek': { nl: 'Zoek op factuurnummer, klant of bedrag…', ar: 'ابحث برقم الفاتورة أو العميل أو المبلغ…', en: 'Search by invoice number, client or amount…' },
  'lijst.zoek.aria': { nl: 'Facturen zoeken', ar: 'البحث في الفواتير', en: 'Search invoices' },
  'lijst.zoek.wissen': { nl: 'Zoekopdracht wissen', ar: 'مسح البحث', en: 'Clear the search' },
  'lijst.zoek.ouder': { nl: 'Zoeken in oudere facturen…', ar: 'جارٍ البحث في الفواتير الأقدم…', en: 'Searching older invoices…' },

  'lijst.leeg': { nl: 'Geen facturen', ar: 'لا توجد فواتير', en: 'No invoices' },
  'lijst.leeg.eerste': { nl: 'Maak je eerste factuur aan', ar: 'أنشئ فاتورتك الأولى', en: 'Create your first invoice' },
  'lijst.nieuw': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'lijst.maak': { nl: 'Maak factuur aan', ar: 'إنشاء الفاتورة', en: 'Create the invoice' },
  // [AANBETALING] A deposit invoice on an accepted offerte.
  'lijst.aanbetaling': { nl: 'Aanbetaling', ar: 'دفعة مقدمة', en: 'Deposit' },
  'lijst.aanbetaling.vraag': { nl: 'Welk percentage van de offerte factureer je nu als aanbetaling?', ar: 'ما نسبة عرض السعر التي تفوترها الآن كدفعة مقدمة؟', en: 'What percentage of the quote do you invoice now as a deposit?' },
  'lijst.aanbetaling.ongeldig': { nl: 'Een aanbetaling is een heel getal van 1 tot 99 procent.', ar: 'الدفعة المقدمة رقم صحيح من 1 إلى 99 بالمئة.', en: 'A deposit is a whole number from 1 to 99 percent.' },
  'lijst.vernieuwen': { nl: 'Vernieuwen', ar: 'تحديث', en: 'Refresh' },
  'lijst.openen': { nl: 'Openen', ar: 'فتح', en: 'Open' },
  'lijst.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'lijst.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'lijst.verwijderen': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'lijst.versturen': { nl: 'Versturen', ar: 'إرسال', en: 'Send' },
  'lijst.opnieuwVersturen': { nl: 'Opnieuw versturen', ar: 'إعادة الإرسال', en: 'Send again' },

  'lijst.betaald': { nl: 'Betaald', ar: 'مدفوعة', en: 'Paid' },
  'lijst.betaaldBedrag': { nl: 'Betaald bedrag', ar: 'المبلغ المدفوع', en: 'Amount paid' },
  'lijst.betaaldatum': { nl: 'Betaaldatum', ar: 'تاريخ الدفع', en: 'Payment date' },
  'lijst.vervaldatum': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'lijst.contant': { nl: 'Contant', ar: 'نقداً', en: 'Cash' },
  'lijst.bank': { nl: 'Bank', ar: 'البنك', en: 'Bank' },
  'lijst.gecrediteerd': { nl: 'Gecrediteerd', ar: 'صدر بها إشعار دائن', en: 'Credited' },
  'lijst.teruggezet': { nl: 'Teruggezet', ar: 'أُعيدت', en: 'Reverted' },
  'lijst.verwijderd': { nl: 'Verwijderd', ar: 'حُذفت', en: 'Deleted' },
  'lijst.betalingBevestigd': { nl: 'Betaling bevestigd ✓', ar: 'تم تأكيد الدفع ✓', en: 'Payment confirmed ✓' },
  'lijst.verwerkt': { nl: 'Factuur is verwerkt', ar: 'تمت معالجة الفاتورة', en: 'The invoice has been processed' },

  'lijst.herhalen': { nl: 'Terugkerende facturen', ar: 'الفواتير المتكرّرة', en: 'Recurring invoices' },
  'lijst.herhalen.stop': { nl: 'Stoppen met herhalen', ar: 'إيقاف الجدولة', en: 'Stop repeating' },
  'lijst.herhalen.stopKort': { nl: 'Stop', ar: 'إيقاف', en: 'Stop' },
  'lijst.herhalen.uitleg': { nl: 'De app zet het concept klaar; versturen blijft aan jou.', ar: 'يُجهّز التطبيق المسودة، ويبقى الإرسال بيدك.', en: 'The app prepares the draft; sending stays with you.' },
  // ── [RUST] De regel die het herhaalpaneel samenvat ───────────────────────────────────────
  // Het paneel eronder is het antwoord op "wat staat er aan en hoe zet ik het uit", en het stond
  // uitgeklapt boven de facturenlijst — met per serie een klant, een cadans en twee knoppen. Dat
  // is een beheerscherm boven een lijst, en de lijst is waarvoor je hier komt.
  //
  // Wat NIET mag verdwijnen is dat er iets loopt: dit is de enige functie in de app die uit
  // zichzelf facturen maakt, en het bestand hierboven legt vast dat zoiets nooit moeilijker uit te
  // zetten mag zijn dan het aan te zetten was. Vandaar de telling in de regel zelf, en één tik naar
  // dezelfde knoppen — niet twee.
  //
  // Loopt er niets meer, dan zegt de regel dát; "0 lopen" laten lezen als rust terwijl er drie
  // gepauzeerde series klaarstaan is precies de stilte die dit paneel moest wegnemen.
  'lijst.herhaal.lopen': { nl: '{n} herhalingen lopen', ar: '{n} تكرارات شغّالة', en: '{n} recurring series are running' },
  'lijst.herhaal.loopt': { nl: '1 herhaling loopt', ar: 'تكرار واحد شغّال', en: '1 recurring series is running' },
  'lijst.herhaal.stil': { nl: '{n} herhalingen staan stil', ar: '{n} تكرارات متوقّفة', en: '{n} recurring series are paused' },
  'lijst.herhaal.stilEen': { nl: '1 herhaling staat stil', ar: 'تكرار واحد متوقّف', en: '1 recurring series is paused' },
  'lijst.herhaal.toon': { nl: 'Toon en beheer ze', ar: 'إظهار وإدارة', en: 'Show and manage them' },
  'lijst.herhaal.verberg': { nl: 'Verberg ze weer', ar: 'أخفِها', en: 'Hide them again' },
  'lijst.herhalen.gestopt': { nl: 'Herhalen gestopt — klaarstaande concepten blijven staan', ar: 'أُوقف التكرار — وتبقى المسودات الجاهزة كما هي', en: 'Repeating stopped — drafts already prepared stay put' },

  'lijst.boekhouder.geen': { nl: 'Geen boekhouder gekoppeld', ar: 'لا يوجد محاسب مرتبط', en: 'No accountant linked' },
  'lijst.boekhouder.stuur': { nl: 'Stuur verzoek naar boekhouder', ar: 'إرسال طلب إلى المحاسب', en: 'Send a request to your accountant' },

  // ── Wat er misging. Elke zin zegt WAT er niet gebeurde en wat de ondernemer nu weet. ──
  'lijst.fout.versturen': { nl: 'Versturen mislukt', ar: 'فشل الإرسال', en: 'Sending failed' },
  'lijst.fout.versturenStraks': { nl: 'Versturen lukte niet. Probeer het zo meteen opnieuw.', ar: 'لم ينجح الإرسال. أعد المحاولة بعد قليل.', en: 'Sending did not work. Try again in a moment.' },
  'lijst.fout.verbinding': { nl: 'Verzenden mislukt — controleer je verbinding', ar: 'فشل الإرسال — تحقّق من اتصالك', en: 'Sending failed — check your connection' },
  'lijst.fout.verwijderen': { nl: 'Verwijderen mislukt — probeer opnieuw', ar: 'فشل الحذف — حاول مرة أخرى', en: 'Deleting failed — please try again' },
  'lijst.fout.verwijderenOffline': { nl: 'Geen verbinding — verwijderen niet gelukt', ar: 'لا يوجد اتصال — لم ينجح الحذف', en: 'No connection — the delete did not go through' },
  // De betaling is het gevoeligste geval: de ondernemer moet weten WAAR hij kan nakijken of hij
  // toch is opgeslagen, want een dubbele bevestiging boekt hem twee keer.
  'lijst.fout.betalingOffline': { nl: 'Geen verbinding — controleer of de betaling is opgeslagen', ar: 'لا يوجد اتصال — تحقّق مما إذا كان الدفع قد حُفظ', en: 'No connection — check whether the payment was saved' },
  'lijst.fout.bevestigen': { nl: 'Bevestigen mislukt — probeer het op de Bank-pagina', ar: 'فشل التأكيد — جرّب من صفحة البنك', en: 'Confirming failed — try it on the Bank page' },
  'lijst.fout.betaalverzoek': { nl: 'Betaalverzoek maken mislukt', ar: 'فشل إنشاء طلب الدفع', en: 'Could not create the payment request' },
  'lijst.fout.herhalen': { nl: 'Herhalen instellen mislukt', ar: 'فشل ضبط التكرار', en: 'Could not set up the repeat' },
  'lijst.fout.stoppen': { nl: 'Stoppen mislukt', ar: 'فشل الإيقاف', en: 'Could not stop it' },
  'lijst.fout.verwijderenVervers': { nl: 'Verwijderen mislukt — ververs de pagina', ar: 'فشل الحذف — أعد تحميل الصفحة', en: 'Deleting failed — refresh the page' },
  'lijst.onbekendeKlant': { nl: 'Onbekende klant', ar: 'عميل غير معروف', en: 'Unknown client' },
  // "Voldaan!" is de KNOP (zet op betaald), "✓ Voldaan" de TOESTAND. Twee sleutels, want in het
  // Arabisch is een gebiedende wijs een ander woord dan een voltooid deelwoord.
  'lijst.voldaan': { nl: 'Voldaan', ar: 'مسدَّدة', en: 'Settled' },
  'lijst.voldaanActie': { nl: 'Voldaan!', ar: 'مسددة', en: 'Settled!' },
  'lijst.fout.nietGevonden': { nl: 'Factuur niet gevonden', ar: 'لم يُعثر على الفاتورة', en: 'Invoice not found' },
  'lijst.fout.klantEmail': { nl: 'Klant e-mail ontbreekt', ar: 'بريد العميل الإلكتروني ناقص', en: "The client's e-mail is missing" },
  'lijst.fout.klantNaam': { nl: 'Klant naam ontbreekt', ar: 'اسم العميل ناقص', en: "The client's name is missing" },

  // ─── [START] Het startscherm — de eerste indruk na inloggen ─────────────────────────────────

  'start.toevoegen': { nl: 'Toevoegen', ar: 'إضافة', en: 'Add' },
  'start.administratie': { nl: 'Mijn administratie', ar: 'إدارتي', en: 'My records' },
  'start.meer': { nl: 'Meer', ar: 'المزيد', en: 'More' },
  'start.tegel.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'start.tegel.inkomend': { nl: 'Inkomend', ar: 'الوارد', en: 'Incoming' },
  'start.tegel.inkoop': { nl: 'Inkoopfacturen', ar: 'فواتير المشتريات', en: 'Purchase invoices' },
  'start.tegel.leveranciers': { nl: 'Leveranciers', ar: 'المورّدون', en: 'Suppliers', tr: 'Tedarikçiler' },
  'start.tegel.bank': { nl: 'Bank', ar: 'البنك', en: 'Bank' },
  'start.tegel.kas': { nl: 'Kas', ar: 'الصندوق', en: 'Cash drawer' },
  'start.cijfers': { nl: 'Cijfers & aangifte', ar: 'الأرقام والإقرار', en: 'Figures & filing' },
  'start.conceptBtw': { nl: 'Concept BTW-aangifte', ar: 'مسودة إقرار btw', en: 'Draft VAT return' },
  'start.tegel.dagomzet': { nl: 'Dagomzet', ar: 'إيراد اليوم', en: 'Daily turnover' },
  'start.tegel.artikelen': { nl: 'Artikelen', ar: 'المنتجات', en: 'Articles' },
  // [UREN-DEUR] De tegel die er nooit was. Zie ZzpDashboard voor waarom hij in het
  // administratieraster hoort en niet ergens anders.
  'start.tegel.uren': { nl: 'Uren', ar: 'الساعات', en: 'Hours' },
  // [IB-JAAR-DEUR] Het eigen jaar van de ondernemer, naast de concept-BTW. De ondertitel noemt
  // allebei de dingen die het scherm oplevert — een label alleen zegt niet waarom je er heen zou
  // gaan, en "jaaroverzicht" kan alles betekenen.
  'start.jaar': { nl: 'Jaaroverzicht', ar: 'ملخّص السنة', en: 'Year overview' },
  // [GROOTBOEK-KAART] Grootboek is the accountant's own word, in every language — the same rule
  // btw and kvk follow. A translation would send them looking for a screen that is not there.
  'start.grootboek': { nl: 'Grootboek', ar: 'دفتر الأستاذ', en: 'Grootboek' },
  'start.grootboek.sub': {
    nl: 'Saldibalans, grootboekkaart en journaalposten',
    ar: 'ميزان المراجعة وبطاقة الحساب والقيود',
    en: 'Trial balance, ledger card and journal entries',
  },
  'start.jaar.sub': {
    nl: 'Cijfers voor je IB-aangifte en je auditfile',
    ar: 'أرقام إقرار ضريبة الدخل وملف التدقيق',
    en: 'Figures for your income-tax return and your audit file',
  },
  'start.tegel.team': { nl: 'Team', ar: 'الفريق', en: 'Team' },
  'start.tegel.werkplek': { nl: 'Mijn werkplek', ar: 'مساحة عملي', en: 'My workspace' },
  'start.nieuweFactuur': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'start.allesUploaden': { nl: 'Alles uploaden', ar: 'رفع الكل', en: 'Upload everything' },
  // "Je waarheid" is de merknaam van het cijferscherm: wat er werkelijk in je zaak gebeurt.
  // Vertaald als betekenis, niet als merk — een onvertaalde naam op de belangrijkste kaart zou
  // precies de kaart onleesbaar laten die het vertrouwen moet dragen.
  'start.waarheid': { nl: 'Je waarheid', ar: 'حقيقتك', en: 'Your truth' },
  'start.waarheid.sub': { nl: 'Status van je kwartaal — en klaar voor de boekhouder', ar: 'وضع ربعك — وجاهز للمحاسب', en: 'Where your quarter stands — ready for the accountant' },
  // [KLAAR-STAND] Het ANTWOORD onder de knop, in plaats van alleen de vraag erop. Drie standen,
  // en de vierde — nog niet gemeten — houdt bewust de zin hierboven: een oordeel dat er niet is,
  // mag er niet uitzien als een oordeel ([NO-SILENT-EMPTY]).
  'start.klaar.ready': { nl: 'Klaar voor je boekhouder', ar: 'جاهز لمحاسبك', en: 'Ready for your accountant' },
  'start.klaar.almost': { nl: 'Bijna klaar — nog {count} punten', ar: 'شارف على الجاهزية — بقيت {count} نقاط', en: 'Almost ready — {count} points left' },
  'start.klaar.attention': { nl: '{count} punten hebben aandacht nodig', ar: '{count} نقاط تحتاج انتباهك', en: '{count} points need attention' },

  // [AFREKENING-DEUR] Hoek 2 van de driehoek: de afrekening van de pinautomaat zelf. De route
  // bestond sinds juli en geen scherm kon hem bereiken. De zin over zelf typen is GEEN noodgreep
  // in een foutmelding maar een gelijkwaardige weg — een bon van een terminal is een handvol
  // getallen, en die weg werkt ook als de lezer plat ligt ([LEZER-STIL]).
  'afr.titel': { nl: 'Afrekening van je pinautomaat', ar: 'تسوية جهاز الدفع', en: 'Your card terminal settlement' },
  'afr.uitleg': { nl: 'De bon die je automaat aan het eind van de dag uitdraait. Hiermee kunnen we je kassa, je automaat en je bank naast elkaar leggen.', ar: 'الإيصال الذي يطبعه جهازك في آخر اليوم. به نضع صندوقك وجهازك وبنكك جنباً إلى جنب.', en: 'The receipt your terminal prints at the end of the day. With it we can line up your till, your terminal and your bank.' },
  'afr.kiesBestand': { nl: 'Foto of PDF kiezen', ar: 'اختر صورة أو PDF', en: 'Choose a photo or PDF' },
  'afr.zelfTypen': { nl: 'Of typ de bon zelf over', ar: 'أو اكتب الإيصال بنفسك', en: 'Or type the receipt yourself' },
  'afr.tekstLabel': { nl: 'Tekst van de bon', ar: 'نصّ الإيصال', en: 'Text of the receipt' },
  'afr.lezen': { nl: 'Lezen', ar: 'اقرأ', en: 'Read' },
  'afr.bezig': { nl: 'Bezig met lezen…', ar: 'جارٍ القراءة…', en: 'Reading…' },
  'afr.fout.lezen': { nl: 'De afrekening kon niet worden gelezen. Je kunt de bon ook zelf overtypen.', ar: 'تعذّرت قراءة التسوية. يمكنك كتابة الإيصال بنفسك.', en: 'The settlement could not be read. You can also type the receipt yourself.' },
  'afr.fout.bewaren': { nl: 'De afrekening kon niet worden bewaard.', ar: 'تعذّر حفظ التسوية.', en: 'The settlement could not be saved.' },
  'afr.bewaard': { nl: 'Afrekening bewaard.', ar: 'حُفظت التسوية.', en: 'Settlement saved.' },
  'afr.transacties': { nl: '{count} transacties op deze afrekening', ar: '{count} معاملة على هذه التسوية', en: '{count} transactions on this settlement' },
  'afr.datum': { nl: 'Datum', ar: 'التاريخ', en: 'Date' },
  'afr.terminal': { nl: 'Terminal-ID', ar: 'معرّف الجهاز', en: 'Terminal ID' },
  'afr.periode': { nl: 'Periode-nummer', ar: 'رقم الفترة', en: 'Period number' },
  'afr.bewaren': { nl: 'Bewaren', ar: 'احفظ', en: 'Save' },
  'afr.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'start.klaar': { nl: 'Ben ik klaar?', ar: 'هل أنا جاهز؟', en: 'Am I ready?' },
  'start.vraag': { nl: 'Bekijk de vraag en antwoord hier', ar: 'اطّلع على السؤال والجواب هنا', en: 'See the question and answer here' },

  'start.allesUploaden.sub': { nl: 'Meerdere bestanden tegelijk — de app sorteert', ar: 'عدة ملفات دفعة واحدة — والتطبيق يرتّبها', en: 'Several files at once — the app sorts them' },
  'start.waarheid.kaartSub': { nl: 'Omzet, winst en BTW — live, elke periode', ar: 'الإيراد والربح والضريبة — مباشرةً، لكل فترة', en: 'Turnover, profit and VAT — live, any period' },
  'start.werkplek.sub': { nl: 'Klanten, bestanden en gegevens', ar: 'العملاء والملفات والبيانات', en: 'Clients, files and details' },
  'start.team.sub': { nl: 'Wie mag er facturen maken voor je bedrijf', ar: 'مَن يحق له إصدار فواتير باسم شركتك', en: 'Who may create invoices for your business' },

  // ─── [WAARHEID-KAART] Het dagoverzicht op het startscherm ───────────────────────────────────

  'waarheid.bank': { nl: 'Bank — op de rekening', ar: 'البنك — في الحساب', en: 'Bank — on the account' },
  'waarheid.kas': { nl: 'Kas — in kassa', ar: 'الصندوق — في الدرج', en: 'Cash — in the till' },
  'waarheid.teBetalen': { nl: 'Te betalen', ar: 'مستحقة الدفع', en: 'To pay' },
  'waarheid.factuur.enkel': { nl: 'factuur', ar: 'فاتورة', en: 'invoice' },
  'waarheid.factuur.meer': { nl: 'facturen', ar: 'فواتير', en: 'invoices' },
  'waarheid.inkoop.enkel': { nl: 'inkoopfactuur', ar: 'فاتورة شراء', en: 'purchase invoice' },
  'waarheid.inkoop.meer': { nl: 'inkoopfacturen', ar: 'فواتير شراء', en: 'purchase invoices' },
  'waarheid.overDatum': { nl: '{n} over datum', ar: '{n} متأخرة', en: '{n} overdue' },
  'waarheid.teOntvangen': { nl: 'Te ontvangen', ar: 'مستحقة لك', en: 'To receive' },
  'waarheid.creditnota': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },
  'waarheid.allesBij': { nl: 'Alles is bij', ar: 'كل شيء محدَّث', en: 'Everything is up to date' },
  'waarheid.nietsOpen': { nl: 'Niets openstaand — geen facturen te betalen of te ontvangen.', ar: 'لا شيء معلّق — لا فواتير للدفع أو التحصيل.', en: 'Nothing outstanding — no invoices to pay or receive.' },
  'waarheid.allesBekijken': { nl: 'Alles bekijken', ar: 'عرض الكل', en: 'View all' },
  'waarheid.nietsTeBetalen': { nl: 'Niets te betalen', ar: 'لا شيء للدفع', en: 'Nothing to pay' },
  'waarheid.nietsOpenKort': { nl: 'Niets openstaand', ar: 'لا شيء معلّق', en: 'Nothing outstanding' },
  'waarheid.alleBekijken': { nl: 'Alle {n} bekijken', ar: 'عرض الكل ({n})', en: 'View all {n}' },
  // Meerdere rekeningen: het aantal in de kop, zodat het totaal eronder verklaard is.
  'waarheid.bankMeerdere': { nl: 'Bank — {n} rekeningen', ar: 'البنك — {n} حسابات', en: 'Bank — {n} accounts' },
  'waarheid.laadfout': { nl: 'Kon je overzicht niet laden', ar: 'تعذّر تحميل نظرتك العامة', en: 'Could not load your overview' },
  'waarheid.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },

  // ─── [DETAIL] De factuurdetailpagina, en het bewerkscherm ───────────────────────────────────
  // Beide hergebruiken de nieuw.*-sleutels voor alles wat het maakscherm ook toont; hier staan
  // alleen de zinnen die alleen dáár bestaan.

  'detail.klaar': { nl: 'Klaar om te verzenden?', ar: 'جاهزة للإرسال؟', en: 'Ready to send?' },
  'detail.bevestig': { nl: 'Bevestig de gegevens voordat je de factuur verstuurt.', ar: 'تحقّق من البيانات قبل إرسال الفاتورة.', en: 'Confirm the details before you send the invoice.' },
  'detail.definitief': { nl: 'De factuur krijgt een definitief nummer.', ar: 'ستأخذ الفاتورة رقمًا نهائيًا.', en: 'The invoice will get a permanent number.' },
  'detail.bezorgingMislukt': { nl: 'De factuur is uitgegeven, maar de bezorging is mislukt', ar: 'صدرت الفاتورة، لكن التسليم فشل', en: 'The invoice was issued, but delivery failed' },
  'detail.geannuleerd': { nl: 'Deze factuur is geannuleerd door een creditnota', ar: 'أُلغيت هذه الفاتورة بإشعار دائن', en: 'This invoice was cancelled by a credit note' },
  'detail.foutIn': { nl: 'Fout in deze factuur?', ar: 'خطأ في هذه الفاتورة؟', en: 'A mistake in this invoice?' },
  'detail.nooitVerwijderen': { nl: 'Verzonden facturen mogen nooit worden verwijderd.', ar: 'الفواتير المُرسَلة لا يجوز حذفها أبدًا.', en: 'Sent invoices may never be deleted.' },
  'detail.teCrediteren': { nl: 'Te crediteren:', ar: 'المبلغ المراد عكسه:', en: 'To credit:' },
  'detail.creditReden': { nl: 'bijv. verkeerd bedrag, geannuleerde opdracht', ar: 'مثلًا: مبلغ خاطئ، أو مهمة أُلغيت', en: 'e.g. wrong amount, cancelled job' },
  // [HERSTEL] A sent invoice is fully editable while nothing is attached to it — the market
  // rule the owner chose after seeing the legal picture. Saving automatically delivers the
  // corrected version to the customer; the number never changes. The old creditnota+draft
  // orchestration is gone; a manual creditnota remains for the locked cases.
  'bewerk.herstel.uitleg': {
    nl: 'Verstuurde factuur — nummer {number} blijft staan. Bij opslaan krijgt je klant automatisch de gecorrigeerde factuur per e-mail, met de melding dat de eerdere versie vervalt.',
    ar: 'فاتورة مُرسَلة — الرقم {number} يبقى. عند الحفظ يستلم عميلك تلقائيًا الفاتورة المصحَّحة بالبريد الإلكتروني، مع تنبيه بأن النسخة السابقة لاغية.',
    en: 'Sent invoice — number {number} stays. On saving, your customer automatically receives the corrected invoice by e-mail, noting that the earlier version is void.',
  },
  'bewerk.herstel.knop': {
    nl: 'Opslaan en gecorrigeerde factuur versturen',
    ar: 'حفظ وإرسال الفاتورة المصححة',
    en: 'Save and send the corrected invoice',
  },
  'bewerk.herstel.bezig': { nl: 'Opslaan en versturen…', ar: 'جارٍ الحفظ والإرسال…', en: 'Saving and sending…' },
  'bewerk.herstel.nietBezorgd': {
    nl: 'De factuur is aangepast, maar de gecorrigeerde versie kon nog niet naar je klant — verstuur hem opnieuw vanaf de factuurpagina.',
    ar: 'عُدّلت الفاتورة، لكن النسخة المصحَّحة لم تصل عميلك بعد — أعد إرسالها من صفحة الفاتورة.',
    en: 'The invoice was updated, but the corrected version could not reach your customer yet — resend it from the invoice page.',
  },
  'detail.onbekendeFout': { nl: 'Onbekende fout — probeer opnieuw', ar: 'خطأ غير معروف — حاول مرة أخرى', en: 'Unknown error — please try again' },

  'bewerk.versturenNaar': { nl: 'Versturen naar {name}?', ar: 'إرسال إلى {name}؟', en: 'Send to {name}?' },
  // [OFFERTE-GEEN-OMZETTING] Sending a quote from its edit screen sends it AS a quote; the invoice
  // comes later, from the sales list. The button it names is written as that list writes it.
  'bewerk.offerteVersturen': { nl: 'Offerte versturen', ar: 'إرسال عرض السعر', en: 'Send the quote' },
  'bewerk.offerteBevestig': {
    nl: 'Deze offerte gaat als offerte naar je klant, zonder factuurnummer. Een factuur maak je later via "Maak factuur aan".',
    ar: 'يُرسَل عرض السعر هذا كعرض سعر إلى عميلك، دون رقم فاتورة. تُنشئ الفاتورة لاحقًا عبر «أنشئ الفاتورة».',
    en: 'This quote goes to your customer as a quote, without an invoice number. You create the invoice later via "Create the invoice".',
  },
  'bewerk.geldigTot': { nl: 'Deze offerte is geldig tot', ar: 'عرض السعر هذا صالح حتى', en: 'This quote is valid until' },
  // [REGELS-GELEZEN] Het bewerkscherm vervangt bij het opslaan ALLE regels door wat het toont. Kon
  // het de bestaande regels niet lezen, dan is een leeg formulier geen leeg formulier maar een
  // knop die de factuur leegmaakt. Deze drie zinnen vervangen dat scherm.
  'bewerk.regelsFout.kop': { nl: 'We konden de regels van deze factuur niet laden.', ar: 'تعذّر تحميل بنود هذه الفاتورة.', en: 'We could not load this invoice’s lines.' },
  'bewerk.regelsFout.uitleg': { nl: 'Bewerken kan daarom nu niet: dit scherm slaat op wat het toont, en het toont ze niet. Aan de factuur is niets veranderd.', ar: 'لذلك لا يمكن التعديل الآن: هذه الشاشة تحفظ ما تعرضه، وهي لا تعرضها. لم يتغيّر شيء في الفاتورة.', en: 'Editing is therefore not possible right now: this screen saves what it shows, and it is not showing them. Nothing about the invoice has changed.' },
  'bewerk.regelsFout.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'bewerk.jouwGegevens': { nl: 'Jouw gegevens', ar: 'بياناتك', en: 'Your details' },
  'bewerk.klantgegevens': { nl: 'Klantgegevens', ar: 'بيانات العميل', en: 'Client details' },
  'bewerk.omschrijvingDienst': { nl: 'Omschrijving dienst', ar: 'وصف الخدمة', en: 'Service description' },
  'bewerk.vulRegels': { nl: 'Vul alle factuurregels correct in', ar: 'املأ جميع بنود الفاتورة بشكل صحيح', en: 'Fill in all invoice lines correctly' },
  'bewerk.vulVerplicht': { nl: 'Vul alle verplichte velden in (*)', ar: 'املأ جميع الحقول الإلزامية (*)', en: 'Fill in all required fields (*)' },

  // ─── [INKOMEND] De inkomende facturen — waar de AI leest en de mens bevestigt ───────────────

  'ink.zoek': { nl: 'Zoek op leverancier, factuurnummer of bedrag…', ar: 'ابحث بالمورّد أو رقم الفاتورة أو المبلغ…', en: 'Search by supplier, invoice number or amount…' },
  'ink.zoek.aria': { nl: 'Inkomende facturen zoeken', ar: 'البحث في الفواتير الواردة', en: 'Search incoming invoices' },
  'ink.zoek.wissen': { nl: 'Zoekopdracht wissen', ar: 'مسح البحث', en: 'Clear the search' },
  'ink.leeg': { nl: 'Geen facturen gevonden', ar: 'لم يُعثر على فواتير', en: 'No invoices found' },
  'ink.allesVerwerkt': { nl: 'Alles verwerkt', ar: 'كل شيء عولج', en: 'Everything processed' },
  'ink.aandacht': { nl: 'Aandacht nodig', ar: 'يحتاج إلى مراجعة', en: 'Needs attention' },
  'ink.evenControleren': { nl: 'Even controleren', ar: 'تحقّق سريع', en: 'A quick check' },
  'ink.klaarBevestigen': { nl: 'Klaar om te bevestigen', ar: 'جاهزة للتأكيد', en: 'Ready to confirm' },
  'ink.bevestigd': { nl: 'Bevestigde inkoopfacturen', ar: 'فواتير المشتريات المؤكَّدة', en: 'Confirmed purchase invoices' },
  'ink.beheer': { nl: 'Beheer', ar: 'الإدارة', en: 'Manage' },
  'ink.selecteer': { nl: 'Selecteren', ar: 'تحديد', en: 'Select' },
  'ink.klaar': { nl: 'Klaar', ar: 'جاهز', en: 'Done' },
  'ink.sluit': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'ink.meldingSluiten': { nl: 'Melding sluiten', ar: 'إغلاق التنبيه', en: 'Close the notice' },
  'ink.toevoegen': { nl: 'Toevoegen', ar: 'إضافة', en: 'Add' },
  'ink.bewerken': { nl: 'Bewerken', ar: 'تعديل', en: 'Edit' },
  'ink.negeer': { nl: 'Negeren', ar: 'تجاهل', en: 'Ignore' },
  'ink.annuleer': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'ink.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'ink.opheffen': { nl: 'Opheffen', ar: 'إلغاء التجاهل', en: 'Undo' },

  // [STATIEGELD-GAT] De knop die het gevonden verschil in het bedrag excl. btw zet. Het WOORD komt
  // van de factuur zelf ({woord}: statiegeld, emballage, fust…) — de eigenaar herkent zijn eigen
  // papier sneller aan het woord dat erop staat dan aan het onze.
  'ink.statiegeld.meetellen': {
    nl: '{bedrag} {woord} meetellen in het bedrag excl. btw',
    ar: 'احتساب {bedrag} ({woord}) ضمن المبلغ بدون ضريبة',
    en: 'Count {bedrag} {woord} into the amount excl. VAT',
  },
  // [LEVERANCIER-VASTLEGGEN] Eén keer opschrijven wie deze leverancier is, in plaats van elke
  // maand dezelfde misgelezen naam verbeteren. De zinnen noemen het GEVOLG ("dan herkent de app
  // hem"), want dat is wat de eigenaar ervan merkt — niet het mechanisme eronder.
  'lev.knop': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'lev.titel': { nl: 'Wie is deze leverancier?', ar: 'مَن هذا المورّد؟', en: 'Who is this supplier?' },
  'lev.uitleg': {
    nl: 'Wat je hier vastlegt, gebruikt de app ook bij de volgende factuur van dit bedrijf — dan hoeft er niets meer geraden te worden.',
    ar: 'ما تُثبِّته هنا يستخدمه التطبيق أيضًا مع الفاتورة التالية من هذه الشركة — فلا يبقى شيء للتخمين.',
    en: 'What you set here is what the app uses on the next invoice from this company — nothing left to guess.',
  },
  'lev.naam': { nl: 'Naam van het bedrijf', ar: 'اسم الشركة', en: 'Company name' },
  'lev.naam.hint': {
    nl: 'Zoals het bedrijf zichzelf noemt — meestal onderaan de factuur, bij de KVK- en btw-gegevens.',
    ar: 'كما تُسمّي الشركة نفسها — غالبًا أسفل الفاتورة، عند بيانات KVK والضريبة.',
    en: 'As the company calls itself — usually at the foot of the invoice, beside the KVK and VAT details.',
  },
  'lev.iban': { nl: 'Rekeningnummer (IBAN)', ar: 'رقم الحساب (IBAN)', en: 'Account number (IBAN)' },
  'lev.iban.hint': {
    nl: 'Hiermee controleert de app of een volgende factuur ineens een ander rekeningnummer draagt. Leeg laten mag.',
    ar: 'به يفحص التطبيق ما إذا كانت فاتورة تالية تحمل رقم حساب مختلفًا فجأة. يمكن تركه فارغًا.',
    en: 'This is what the app compares a later invoice against when the account number suddenly differs. May be left empty.',
  },
  'lev.kvk': { nl: 'KVK-nummer', ar: 'رقم KVK', en: 'KVK number' },
  'lev.kvk.hint': { nl: '8 cijfers. Leeg laten mag.', ar: '8 أرقام. يمكن تركه فارغًا.', en: '8 digits. May be left empty.' },
  'lev.btw': { nl: 'Btw-nummer', ar: 'رقم btw', en: 'VAT number' },
  // [LEVERANCIER-LAND] The supplier's country; outside NL their btw is shifted to the owner (4a/4b).
  'lev.land': { nl: 'Land (code)', ar: 'الدولة (رمز)', en: 'Country (code)' },
  'lev.land.hint': { nl: 'Twee letters (NL, DE, US). Buiten Nederland: de btw is naar jou verlegd, rubriek 4a of 4b.', ar: 'حرفان (NL، DE، US). خارج هولندا: الضريبة محوَّلة إليك، البند 4a أو 4b.', en: 'Two letters (NL, DE, US). Outside the Netherlands: the VAT shifts to you, box 4a or 4b.' },
  'lev.fout.land': { nl: 'Land: gebruik de landcode van twee letters (NL, DE, US).', ar: 'الدولة: استخدم رمز الدولة المكوّن من حرفين (NL، DE، US).', en: 'Country: use the two-letter country code (NL, DE, US).' },
  'lev.btw.hint': {
    nl: 'Staat verplicht op een factuur (art. 35a). Leeg laten mag.',
    ar: 'إلزامي على الفاتورة (المادة 35a). يمكن تركه فارغًا.',
    en: 'Legally required on an invoice (art. 35a). May be left empty.',
  },
  'lev.opslaan': { nl: 'Vastleggen', ar: 'حفظ', en: 'Save' },
  'lev.bezig': { nl: 'Bezig met opslaan...', ar: 'جارٍ الحفظ…', en: 'Saving...' },
  'lev.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'lev.opgeslagen': { nl: 'Leverancier vastgelegd', ar: 'تم تثبيت المورّد', en: 'Supplier saved' },
  // [LEVERANCIER-VASTLEGGEN] Why a supplier form was refused. supplier-pin.ts answers with a CODE
  // and the route says the sentence in the language of whoever is typing; the sentences used to be
  // Dutch literals inside the pure module. Each one names the FIELD.
  'lev.fout.naamLeeg': {
    nl: 'Vul de naam van de leverancier in.',
    en: 'Fill in the supplier\'s name.',
    ar: 'أدخل اسم المورّد.',
  },
  'lev.fout.naamOnbetrouwbaar': {
    nl: 'Dit lijkt geen bedrijfsnaam. Neem de naam over zoals hij op de factuur staat.',
    en: 'This does not look like a company name. Copy the name as it appears on the invoice.',
    ar: 'هذا لا يبدو اسم شركة. انقل الاسم كما هو مكتوب على الفاتورة.',
  },
  'lev.fout.naamSleutel': {
    nl: 'Deze naam levert geen bruikbare sleutel op.',
    en: 'This name does not give a usable key.',
    ar: 'هذا الاسم لا يعطي مفتاحاً صالحاً للتعرّف.',
  },
  'lev.fout.iban': {
    nl: 'De controlecijfers van dit rekeningnummer kloppen niet. Neem het over zoals het op de factuur staat — met een verkeerd nummer waarschuwt de app straks bij élke echte factuur van deze leverancier.',
    en: 'The check digits of this account number are wrong. Copy it as it appears on the invoice — with a wrong number the app will warn on every genuine invoice from this supplier.',
    ar: 'أرقام التحقق في رقم الحساب هذا غير صحيحة. انقله كما هو مكتوب على الفاتورة، فمع رقم خاطئ سيحذّرك التطبيق عند كل فاتورة حقيقية من هذا المورّد.',
  },
  'lev.fout.kvk': {
    nl: 'Een KVK-nummer bestaat uit 8 cijfers.',
    en: 'A KVK number has 8 digits.',
    ar: 'يتكوّن رقم KVK من 8 أرقام.',
  },
  'lev.fout.btw': {
    nl: 'Dit heeft niet de vorm van een btw-nummer. Een Nederlands nummer ziet eruit als NL000000000B00.',
    en: 'This does not have the form of a VAT number. A Dutch number looks like NL000000000B00.',
    ar: 'هذا ليس بصيغة رقم btw. الرقم الهولندي يبدو هكذا: NL000000000B00.',
  },
  'lev.fout.nietIngelogd': {
    nl: 'Je bent niet ingelogd. Log opnieuw in en probeer het nog eens.',
    en: 'You are not signed in. Sign in again and try once more.',
    ar: 'أنت غير مسجّل الدخول. سجّل الدخول مجددًا وأعد المحاولة.',
  },
  'lev.fout.factuurNietGevonden': {
    nl: 'Deze factuur is niet gevonden.',
    en: 'This invoice was not found.',
    ar: 'لم يُعثر على هذه الفاتورة.',
  },
  'lev.fout.nietGevonden': {
    nl: 'Deze leverancier is niet gevonden. Ververs de pagina.',
    en: 'This supplier was not found. Refresh the page.',
    ar: 'لم يُعثر على هذا المورّد. حدّث الصفحة.',
  },
  'lev.fout.bijwerken': {
    nl: 'De leverancier kon niet worden bijgewerkt. Probeer het zo meteen opnieuw.',
    en: 'The supplier could not be updated. Try again in a moment.',
    ar: 'تعذّر تحديث المورّد. أعد المحاولة بعد قليل.',
  },
  'lev.fout.naamOpFactuur': {
    nl: 'De naam kon niet op deze factuur worden gezet.',
    en: 'The name could not be put on this invoice.',
    ar: 'تعذّر وضع الاسم على هذه الفاتورة.',
  },
  'lev.fout.opzoeken': {
    nl: 'De leverancier kon niet worden opgezocht. Probeer het opnieuw.',
    en: 'The supplier could not be looked up. Try again.',
    ar: 'تعذّر البحث عن المورّد. أعد المحاولة.',
  },
  // [LEVERANCIER-BEWERKEN] A number another supplier already carries is a MERGE, not an error.
  'lev.fout.dubbelIban': {
    nl: 'Dit rekeningnummer staat al bij {ander}. Voeg de twee leveranciers samen in plaats van het nummer te verplaatsen.',
    en: 'This account number is already on {ander}. Merge the two suppliers instead of moving the number.',
    ar: 'رقم الحساب هذا مسجّل بالفعل عند {ander}. ادمج المورّدَين بدل نقل الرقم.',
  },
  'lev.fout.dubbelKvk': {
    nl: 'Dit KVK-nummer staat al bij {ander}. Voeg de twee leveranciers samen in plaats van het nummer te verplaatsen.',
    en: 'This KVK number is already on {ander}. Merge the two suppliers instead of moving the number.',
    ar: 'رقم KVK هذا مسجّل بالفعل عند {ander}. ادمج المورّدَين بدل نقل الرقم.',
  },

  // ── [LEVERANCIER-BEWERKEN] The edit sheet on /dashboard/leveranciers ──
  'lev.bewerk.knop': { nl: 'Gegevens aanpassen', en: 'Edit details', ar: 'تعديل البيانات' },
  'lev.bewerk.titel': { nl: 'Leverancier aanpassen', en: 'Edit supplier', ar: 'تعديل المورّد' },
  'lev.bewerk.uitleg': {
    nl: 'Dit geldt voor de volgende facturen. Wat al in de boeken staat, houdt wat erop gedrukt stond.',
    en: 'This applies to the next invoices. What is already in the books keeps what was printed on it.',
    ar: 'هذا يسري على الفواتير القادمة. ما سُجّل في الدفاتر يحتفظ بما كان مطبوعًا عليه.',
  },
  'lev.bewerk.ibanGewijzigd': {
    nl: 'Je vervangt rekeningnummer {oud}. Controleer dit bij de leverancier via een nummer dat je zelf opzoekt.',
    en: 'You are replacing account number {oud}. Check this with the supplier via a number you look up yourself.',
    ar: 'أنت تستبدل رقم الحساب {oud}. تحقّق من ذلك لدى المورّد عبر رقم تبحث عنه بنفسك.',
  },
  'lev.bewerk.incasso': { nl: 'Automatische incasso', en: 'Direct debit', ar: 'خصم مباشر تلقائي' },
  'lev.bewerk.incasso.hint': {
    nl: 'Deze leverancier schrijft zelf af. Zijn facturen worden als betaald geboekt zodra de afschrijving op het afschrift staat.',
    en: 'This supplier collects the money itself. Its invoices are booked as paid once the debit appears on the statement.',
    ar: 'هذا المورّد يخصم المبلغ بنفسه. تُسجَّل فواتيره كمدفوعة حين يظهر الخصم في كشف الحساب.',
  },
  'lev.bewerk.opslaan': { nl: 'Opslaan', en: 'Save', ar: 'حفظ' },
  'lev.bewerk.opgeslagen': {
    nl: 'De gegevens van {naam} zijn opgeslagen.',
    en: 'The details of {naam} have been saved.',
    ar: 'تم حفظ بيانات {naam}.',
  },
  'lev.bewerk.opgeslagenIban': {
    nl: 'Het oude rekeningnummer blijft bewaard. Een factuur met dat nummer wordt nog herkend, en krijgt dan een waarschuwing.',
    en: 'The old account number is kept. An invoice carrying it is still recognised, and then gets a warning.',
    ar: 'يبقى الرقم القديم محفوظًا. الفاتورة التي تحمله تُعرَف كما كانت، ويظهر عندها تحذير.',
  },
  'lev.bewerk.laatstGewijzigd': {
    nl: 'Laatst aangepast op {datum}',
    en: 'Last changed on {datum}',
    ar: 'آخر تعديل في {datum}',
  },
  'leveranciers.lijst.kop': { nl: 'Alle leveranciers', en: 'All suppliers', ar: 'كل المورّدين' },
  'leveranciers.lijst.uitleg': {
    nl: 'Hierop herkent de app de volgende factuur: naam, rekeningnummer, KVK en btw-nummer. Klopt iets niet, pas het hier aan.',
    en: 'The app recognises the next invoice on this: name, account number, KVK and VAT number. If something is wrong, change it here.',
    ar: 'بهذه البيانات يتعرّف التطبيق على الفاتورة القادمة: الاسم ورقم الحساب وKVK ورقم btw. إن كان شيء غير صحيح فعدّله هنا.',
  },
  'leveranciers.lijst.leeg': {
    nl: 'Nog geen leveranciers. Ze verschijnen hier zodra een inkoopfactuur is ingelezen.',
    en: 'No suppliers yet. They appear here once a purchase invoice has been read.',
    ar: 'لا مورّدين بعد. سيظهرون هنا بعد قراءة أول فاتورة مشتريات.',
  },
  'leveranciers.lijst.zonderIban': { nl: 'geen rekeningnummer bekend', en: 'no account number known', ar: 'لا رقم حساب معروف' },
  'leveranciers.lijst.incasso': { nl: 'automatische incasso', en: 'direct debit', ar: 'خصم مباشر' },
  'leveranciers.lijst.nietGelezen': {
    nl: 'De leverancierslijst kon niet worden gelezen. Dit is een storing, geen lege lijst.',
    en: 'The supplier list could not be read. This is a failure, not an empty list.',
    ar: 'تعذّر قراءة قائمة المورّدين. هذا عطل وليس قائمة فارغة.',
  },
  // [LEVERANCIER-STANDAARD] The two defaults the owner sets once per supplier.
  'lev.fout.tarief': {
    nl: 'Kies een btw-tarief dat bestaat: 0, 9 of 21 procent, of laat het leeg.',
    en: 'Pick a VAT rate that exists: 0, 9 or 21 percent, or leave it empty.',
    ar: 'اختر نسبة ضريبة القيمة المضافة موجودة: 0 أو 9 أو 21 بالمئة، أو اتركها فارغة.',
  },
  'lev.fout.categorie': {
    nl: 'Deze categorie kent de app niet. Kies er een uit de lijst, of laat het leeg.',
    en: 'The app does not know this category. Pick one from the list, or leave it empty.',
    ar: 'التطبيق لا يعرف هذا الصنف. اختر واحدًا من القائمة، أو اتركه فارغًا.',
  },
  'lev.bewerk.tarief': { nl: 'Vast btw-tarief', en: 'Fixed VAT rate', ar: 'نسبة btw ثابتة' },
  'lev.bewerk.tarief.hint': {
    nl: 'Staat de btw-uitsplitsing niet op een factuur, dan stelt de app dit tarief voor. Jij bevestigt.',
    en: 'When an invoice lacks its VAT breakdown, the app proposes this rate. You confirm.',
    ar: 'إن لم تكن تفاصيل ضريبة القيمة المضافة على الفاتورة، يقترح التطبيق هذه النسبة. وأنت تؤكّد.',
  },
  'lev.bewerk.tarief.geen': { nl: 'Geen vast tarief', en: 'No fixed rate', ar: 'بلا نسبة ثابتة' },
  'lev.bewerk.categorie': { nl: 'Categorie op het afschrift', en: 'Category on the statement', ar: 'الصنف في كشف الحساب' },
  'lev.bewerk.categorie.hint': {
    nl: 'Een bankregel naar deze leverancier krijgt deze categorie voorgesteld. Zonder keuze is het een zakelijke kost.',
    en: 'A bank line to this supplier is proposed under this category. Without a choice it is a business cost.',
    ar: 'سطر البنك المدفوع لهذا المورّد يُقترح تحت هذا الصنف. بلا اختيار يُعدّ تكلفة عمل.',
  },
  'lev.bewerk.categorie.geen': { nl: 'Geen vaste categorie', en: 'No fixed category', ar: 'بلا صنف ثابت' },
  'leveranciers.lijst.tarief': { nl: '{tarief}% btw', en: '{tarief}% VAT', ar: 'btw {tarief}%' },
  // The bank category vocabulary, translated. Same words as the categorise screen in Dutch.
  'bankcat.omzet': { nl: 'Omzet', en: 'Revenue', ar: 'الإيراد' },
  'bankcat.pos_income': { nl: 'Pinomzet', en: 'Card takings', ar: 'إيراد البطاقات' },
  'bankcat.kosten': { nl: 'Zakelijke kost', en: 'Business cost', ar: 'تكلفة عمل' },
  'bankcat.fee': { nl: 'Bankkosten', en: 'Bank charges', ar: 'رسوم بنكية' },
  'bankcat.prive': { nl: 'Privé', en: 'Private', ar: 'خاص' },
  'bankcat.transfer': { nl: 'Overboeking', en: 'Transfer', ar: 'تحويل' },
  'bankcat.tax': { nl: 'Belasting', en: 'Tax', ar: 'ضريبة' },
  // [LEVERANCIER-NIEUW] Adding a supplier by hand, or adopting one the balance already shows.
  'lev.nieuw.knop': { nl: 'Nieuwe leverancier', en: 'New supplier', ar: 'مورّد جديد' },
  'lev.nieuw.vanRegel': { nl: 'Voeg toe als leverancier', en: 'Add as supplier', ar: 'أضِف كمورّد' },
  'lev.nieuw.titel': { nl: 'Nieuwe leverancier', en: 'New supplier', ar: 'مورّد جديد' },
  'lev.nieuw.uitleg': {
    nl: 'Vanaf nu herkent de app facturen van dit bedrijf op deze gegevens.',
    en: 'From now on the app recognises invoices from this company on these details.',
    ar: 'من الآن يتعرّف التطبيق على فواتير هذه الشركة بهذه البيانات.',
  },
  'lev.nieuw.uitlegRegel': {
    nl: 'De facturen die nu onder deze naam staan, komen onder dit bedrijf te hangen.',
    en: 'The invoices now under this name will be linked to this company.',
    ar: 'الفواتير المسجّلة الآن تحت هذا الاسم ستُربط بهذه الشركة.',
  },
  'lev.nieuw.opslaan': { nl: 'Toevoegen', en: 'Add', ar: 'إضافة' },
  'lev.nieuw.toegevoegd': {
    nl: '{naam} is toegevoegd als leverancier.',
    en: '{naam} has been added as a supplier.',
    ar: 'أُضيف {naam} كمورّد.',
  },
  'lev.nieuw.gekoppeld': {
    nl: '{n} facturen zijn eraan gekoppeld.',
    en: '{n} invoices have been linked to it.',
    ar: 'رُبطت به {n} فاتورة.',
  },
  'lev.fout.bestaatAl': {
    nl: 'Deze leverancier bestaat al als {ander}. Pas die aan in plaats van een tweede te maken.',
    en: 'This supplier already exists as {ander}. Edit that one instead of making a second.',
    ar: 'هذا المورّد موجود بالفعل باسم {ander}. عدّله بدل إنشاء نسخة ثانية.',
  },
  'lev.fout.aanmaken': {
    nl: 'De leverancier kon niet worden toegevoegd. Probeer het zo meteen opnieuw.',
    en: 'The supplier could not be added. Try again in a moment.',
    ar: 'تعذّرت إضافة المورّد. أعد المحاولة بعد قليل.',
  },
  // [LEVERANCIER-VERWIJDEREN] The row goes; the invoices stay and lose only the link.
  'lev.verwijder.knop': { nl: 'Leverancier verwijderen', en: 'Remove supplier', ar: 'حذف المورّد' },
  'lev.verwijder.vraag': {
    nl: 'Weet je het zeker? De facturen blijven staan en raken alleen de koppeling kwijt.',
    en: 'Are you sure? The invoices stay and only lose the link.',
    ar: 'هل أنت متأكد؟ الفواتير تبقى وتفقد الربط فقط.',
  },
  'lev.verwijder.aantal': {
    nl: 'Het gaat om {n} facturen.',
    en: 'That concerns {n} invoices.',
    ar: 'يتعلق الأمر بـ {n} فاتورة.',
  },
  'lev.verwijder.dubbel': {
    nl: 'Is dit een dubbele rij van hetzelfde bedrijf? Voeg dan samen in plaats van te verwijderen.',
    en: 'Is this a duplicate row of the same company? Then merge instead of removing.',
    ar: 'هل هذا صف مكرّر للشركة نفسها؟ إذًا ادمج بدل الحذف.',
  },
  'lev.verwijder.bevestig': { nl: 'Ja, verwijderen', en: 'Yes, remove', ar: 'نعم، احذف' },
  'lev.verwijder.klaar': {
    nl: '{naam} is verwijderd.',
    en: '{naam} has been removed.',
    ar: 'حُذف {naam}.',
  },
  'lev.fout.verwijderen': {
    nl: 'De leverancier kon niet worden verwijderd. Probeer het zo meteen opnieuw.',
    en: 'The supplier could not be removed. Try again in a moment.',
    ar: 'تعذّر حذف المورّد. أعد المحاولة بعد قليل.',
  },
  // [SAMENVOEGEN-EIGENAAR] The owner names the pair and the row that stays.
  'lev.samenvoeg.kop': { nl: 'Samenvoegen met een andere leverancier', en: 'Merge with another supplier', ar: 'دمج مع مورّد آخر' },
  'lev.samenvoeg.uitleg': {
    nl: 'Alleen als dit echt hetzelfde bedrijf is. De facturen gaan naar de gekozen rij; deze rij verdwijnt.',
    en: 'Only if this really is the same company. The invoices go to the chosen row; this row disappears.',
    ar: 'فقط إن كانت هذه الشركة نفسها حقًا. الفواتير تنتقل إلى الصف المختار، وهذا الصف يختفي.',
  },
  'lev.samenvoeg.kies': { nl: 'Kies de leverancier die blijft', en: 'Pick the supplier that stays', ar: 'اختر المورّد الذي يبقى' },
  'lev.samenvoeg.geen': { nl: 'Kies een leverancier…', en: 'Pick a supplier…', ar: 'اختر مورّدًا…' },
  'lev.samenvoeg.vraag': {
    nl: 'De facturen van {dit} komen onder {ander}. Doorgaan?',
    en: 'The invoices of {dit} will be filed under {ander}. Continue?',
    ar: 'فواتير {dit} ستُسجَّل تحت {ander}. هل تتابع؟',
  },
  'lev.samenvoeg.bevestig': { nl: 'Ja, samenvoegen', en: 'Yes, merge', ar: 'نعم، ادمج' },
  // [LEVERANCIER-ZOEKEN] The filter over the registry list. Same matcher as the name picker.
  'leveranciers.zoek': { nl: 'Zoek een leverancier', en: 'Search a supplier', ar: 'ابحث عن مورّد' },
  'leveranciers.zoek.niets': {
    nl: 'Geen leverancier gevonden voor "{term}".',
    en: 'No supplier found for "{term}".',
    ar: 'لم يُعثر على مورّد لـ«{term}».',
  },
  'leveranciers.zoek.aantal': {
    nl: '{n} van {totaal} leveranciers',
    en: '{n} of {totaal} suppliers',
    ar: '{n} من {totaal} مورّدين',
  },
  'lev.fout.opslaan': {
    nl: 'De leverancier kon niet worden opgeslagen. Probeer het zo meteen opnieuw.',
    ar: 'تعذّر حفظ المورّد. حاول مرة أخرى بعد قليل.',
    en: 'The supplier could not be saved. Try again in a moment.',
  },
  // [LEVERANCIER-KIEZEN] De lijst die meeloopt terwijl je een leveranciersnaam typt. De zinnen
  // gaan over het GEVOLG van kiezen — één leverancier in plaats van twee — want dat is het enige
  // wat de eigenaar er later van merkt: zijn crediteurenstand staat op één naam of op twee.
  'lev.kies.kop': {
    nl: 'Leveranciers die je al hebt',
    ar: 'مورّدون لديك بالفعل',
    en: 'Suppliers you already have',
  },
  'lev.kies.meer': {
    nl: 'Nog {n} meer — typ verder om te verfijnen',
    ar: 'وهناك {n} آخرون — تابع الكتابة للتضييق',
    en: '{n} more — keep typing to narrow it down',
  },
  'lev.kies.nieuw': {
    nl: 'Nog geen leverancier met deze naam. Bevestigen maakt er een nieuwe van.',
    ar: 'لا يوجد مورّد بهذا الاسم بعد. التأكيد سيُنشئ مورّدًا جديدًا.',
    en: 'No supplier with this name yet. Confirming will create a new one.',
  },
  'lev.kies.nietGeladen': {
    nl: 'De lijst met leveranciers kon niet worden geladen — je kunt de naam gewoon typen.',
    ar: 'تعذّر تحميل قائمة المورّدين — يمكنك كتابة الاسم كالمعتاد.',
    en: 'The supplier list could not be loaded — you can still type the name.',
  },
  // [LEVERANCIER-BLADEREN] Het knopje dat de lijst opent. Een label, geen zin: het staat op een
  // pictogram van 20 pixels, en een schermlezer moet er iets aan hebben.
  'lev.kies.toon': {
    nl: 'Toon je leveranciers',
    ar: 'عرض مورّديك',
    en: 'Show your suppliers',
  },
  'lev.kies.veld': {
    nl: 'Leverancier — kies een bestaande of typ een nieuwe naam',
    ar: 'المورّد — اختر واحدًا موجودًا أو اكتب اسمًا جديدًا',
    en: 'Supplier — pick an existing one or type a new name',
  },
  // [LEVERANCIER-SAMENVOEGEN] Twee rijen die één bedrijf zijn. De uitleg noemt de VOORWAARDE
  // hardop, want dat is wat deze knop veilig maakt: de app stelt alleen paren voor die al een
  // KVK-nummer of een rekeningnummer delen. Een naam die op elkaar lijkt hoort er niet bij — dat
  // is precies het paar (BALKIP B.V. / GROOTHANDEL M.H. BAL V.O.F.) dat nooit voorgesteld mag
  // worden, en de eigenaar moet kunnen zien dat de app dat weet.
  'lev.merge.kop': {
    nl: 'Twee leveranciers die één bedrijf zijn',
    ar: 'مورّدان هما شركة واحدة',
    en: 'Two suppliers that are one company',
  },
  'lev.merge.uitleg': {
    nl: 'Alleen voorgesteld als beide hetzelfde KVK-nummer of hetzelfde rekeningnummer dragen. Een naam die op elkaar lijkt is geen bewijs: twee verschillende bedrijven kunnen zo heten.',
    ar: 'لا يُقترح إلا إذا حمل الاثنان رقم KVK نفسه أو رقم الحساب نفسه. تشابه الاسم ليس دليلًا: قد تحمل شركتان مختلفتان اسمًا متشابهًا.',
    en: 'Only proposed when both carry the same KVK number or the same bank account. A name that looks alike is not proof: two different companies can be called that.',
  },
  'lev.merge.bewijs.kvk': {
    nl: 'Zelfde KVK-nummer: {waarde}',
    ar: 'رقم KVK نفسه: {waarde}',
    en: 'Same KVK number: {waarde}',
  },
  'lev.merge.bewijs.iban': {
    nl: 'Zelfde rekeningnummer: {waarde}',
    ar: 'رقم الحساب نفسه: {waarde}',
    en: 'Same account number: {waarde}',
  },
  'lev.merge.gevolgEen': {
    nl: '1 factuur komt te staan onder {naam}',
    ar: 'فاتورة واحدة ستُنقل إلى {naam}',
    en: '1 invoice moves under {naam}',
  },
  'lev.merge.gevolgN': {
    nl: '{n} facturen komen te staan onder {naam}',
    ar: '{n} فاتورة ستُنقل إلى {naam}',
    en: '{n} invoices move under {naam}',
  },
  'lev.merge.gevolgGeen': {
    nl: 'Er staan geen facturen meer onder {oud} — alleen de naam verdwijnt',
    ar: 'لم تعد هناك فواتير تحت {oud} — الاسم وحده سيختفي',
    en: 'No invoices are left under {oud} — only the name disappears',
  },
  'lev.merge.knop': { nl: 'Samenvoegen', ar: 'دمج', en: 'Merge' },
  'lev.merge.bezig': { nl: 'Bezig met samenvoegen...', ar: 'جارٍ الدمج...', en: 'Merging...' },
  'lev.merge.klaar': {
    nl: '{oud} staat nu onder {nieuw}',
    ar: '{oud} صار تحت {nieuw}',
    en: '{oud} now sits under {nieuw}',
  },
  'lev.merge.fout': {
    nl: 'Samenvoegen is niet gelukt. Er is niets veranderd.',
    ar: 'لم ينجح الدمج. لم يتغيّر شيء.',
    en: 'The merge did not go through. Nothing was changed.',
  },
  'lev.merge.geweigerd.kvk': {
    nl: 'Deze twee dragen elk een eigen KVK-nummer — dat zijn twee bedrijven.',
    ar: 'كلٌّ من هذين يحمل رقم KVK خاصًا به — إذًا هما شركتان.',
    en: 'These two each carry their own KVK number — that is two companies.',
  },
  'lev.merge.geweigerd.rekening': {
    nl: 'Deze twee dragen elk een eigen rekeningnummer. Haal er eerst één weg bij de leverancier zelf.',
    ar: 'كلٌّ من هذين يحمل رقم حساب خاصًا به. أزل أحدهما أولًا من بيانات المورّد نفسه.',
    en: 'These two each carry their own account number. Remove one at the supplier itself first.',
  },
  'lev.merge.geweigerd.oud': {
    nl: 'Dit scherm is verouderd — ververs de pagina en kijk opnieuw.',
    ar: 'هذه الشاشة قديمة — أعد تحميل الصفحة وانظر من جديد.',
    en: 'This screen is out of date — refresh the page and look again.',
  },
  'ink.factuurBevestigen': { nl: 'Factuur bevestigen', ar: 'تأكيد الفاتورة', en: 'Confirm the invoice' },
  'ink.controleerBedragen': { nl: 'Controleer de bedragen. AI heeft ze automatisch uitgelezen.', ar: 'تحقّق من المبالغ — قرأها الذكاء الاصطناعي تلقائيًا.', en: 'Check the amounts. AI read them automatically.' },
  'ink.afzender': { nl: 'Afzender', ar: 'المُرسِل', en: 'Sender' },
  'ink.bron': { nl: 'Bron', ar: 'المصدر', en: 'Source' },
  'ink.factuurnummer': { nl: 'Factuurnummer', ar: 'رقم الفاتورة', en: 'Invoice number' },
  'ink.bedragExcl': { nl: 'Bedrag excl. BTW', ar: 'المبلغ بدون btw', en: 'Amount excl. VAT' },
  'ink.totaal': { nl: 'Totaal', ar: 'الإجمالي', en: 'Total' },
  'ink.totaalUitleg': { nl: 'Totaalbedrag inclusief BTW — zoals het onderaan de factuur staat', ar: 'الإجمالي شامل ضريبة القيمة المضافة — كما هو مذكور أسفل الفاتورة', en: 'Total including VAT — as printed at the bottom of the invoice' },
  'ink.datumOntbreekt': { nl: 'Factuurdatum ontbreekt — verplicht om te bevestigen.', ar: 'تاريخ الفاتورة ناقص — وهو إلزامي للتأكيد.', en: 'The invoice date is missing — required to confirm.' },
  'ink.isCreditnota': { nl: 'Dit is een creditnota', ar: 'هذا إشعار دائن', en: 'This is a credit note' },
  'ink.creditnota': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },
  // [AANSLAG] The badge on a Belastingdienst letter: which tax, and where it books.
  'ink.aanslag.inkomstenbelasting': { nl: 'Aanslag inkomstenbelasting — privé, geen kost', ar: 'ضريبة الدخل — خاص، ليست تكلفة', en: 'Income tax assessment — private, not a cost' },
  'ink.aanslag.zorgverzekeringswet': { nl: 'Aanslag Zvw — privé, geen kost', ar: 'مساهمة Zvw — خاص، ليست تكلفة', en: 'Zvw assessment — private, not a cost' },
  'ink.aanslag.omzetbelasting': { nl: 'Naheffing omzetbelasting — afdracht, geen kost', ar: 'ضريبة القيمة المضافة — تسوية، ليست تكلفة', en: 'VAT assessment — a settlement, not a cost' },
  'ink.aanslag.motorrijtuigenbelasting': { nl: 'Motorrijtuigenbelasting — kost', ar: 'ضريبة المركبات — تكلفة', en: 'Motor vehicle tax — a cost' },
  'ink.aanslag.overig': { nl: 'Brief Belastingdienst — niet in de kosten', ar: 'رسالة من مصلحة الضرائب — ليست ضمن التكاليف', en: 'Tax office letter — not in costs' },
  'ink.hoeBetaald': { nl: 'Hoe is deze factuur betaald?', ar: 'كيف دُفعت هذه الفاتورة؟', en: 'How was this invoice paid?' },
  'ink.markeerBetaald': { nl: 'Markeer als betaald', ar: 'تحديد كمدفوعة', en: 'Mark as paid' },
  'ink.betaaldBedrag': { nl: 'Betaald bedrag', ar: 'المبلغ المدفوع', en: 'Amount paid' },
  'ink.betaaldatum': { nl: 'Betaaldatum', ar: 'تاريخ الدفع', en: 'Payment date' },
  'ink.anderRekening': { nl: 'Ander rekeningnummer', ar: 'رقم حساب آخر', en: 'A different account number' },
  // [BETAALMOMENT] De vraag vóór de betaalknop, en het antwoord dat de eigenaar mag geven. Een
  // gewisseld rekeningnummer is soms écht — een leverancier stapt over van bank — dus dit vraagt en
  // blokkeert niet, zoals elke andere poort hier. Wat het NIET meer doet is zwijgen.
  'ink.anderRekeningKaal': {
    nl: 'Deze leverancier heeft een ander rekeningnummer dan op eerdere facturen. Bel vóór je betaalt op een nummer dat je zelf opzoekt — niet het nummer op deze factuur.',
    ar: 'رقم حساب هذا المورّد يختلف عمّا في الفواتير السابقة. قبل الدفع اتصل به على رقم تبحث عنه بنفسك — لا الرقم المكتوب على هذه الفاتورة.',
    en: 'This supplier has a different account number than on earlier invoices. Before you pay, call them on a number you look up yourself — not the one on this invoice.',
  },
  'ink.tochBetalen': { nl: 'Ik heb het gecontroleerd', ar: 'تحقّقتُ من ذلك', en: 'I have checked it' },
  'ink.bonVermeldt': { nl: 'De bon vermeldt', ar: 'الإيصال يذكر', en: 'The receipt states' },
  'ink.kassabon': { nl: 'Kassabon — waarschijnlijk al betaald. Controleer en bevestig.', ar: 'إيصال كاشير — على الأرجح مدفوع مسبقًا. تحقّق وأكّد.', en: 'A till receipt — probably already paid. Check and confirm.' },
  'ink.bekijkControles': { nl: 'Bekijk factuur en controles', ar: 'عرض الفاتورة والفحوصات', en: 'View the invoice and its checks' },
  'ink.naarControle': { nl: 'Naar controle', ar: 'إلى المراجعة', en: 'To review' },
  'ink.terugzetten': { nl: 'Terugzetten naar wachtrij', ar: 'إرجاعها إلى قائمة الانتظار', en: 'Put back in the queue' },

  'ink.meerderePaginas': { nl: 'Factuur met meerdere pagina’s', ar: 'فاتورة من عدة صفحات', en: 'A multi-page invoice' },
  'ink.eenFactuurMeerPaginas': { nl: 'Eén factuur, meerdere pagina’s', ar: 'فاتورة واحدة، عدة صفحات', en: 'One invoice, several pages' },
  'ink.neeAndere': { nl: 'Nee, andere factuur', ar: 'لا، فاتورة أخرى', en: 'No, a different invoice' },
  'ink.verwijderPagina': { nl: 'Verwijder pagina', ar: 'حذف الصفحة', en: 'Remove the page' },

  'ink.negeren.titel': { nl: 'Factuur negeren?', ar: 'تجاهل الفاتورة؟', en: 'Ignore this invoice?' },
  'ink.negeren.altijd': { nl: 'Altijd overslaan?', ar: 'تخطّيها دائمًا؟', en: 'Always skip?' },
  'ink.negeren.bezig': { nl: 'Bezig met negeren…', ar: 'جارٍ التجاهل…', en: 'Ignoring…' },
  'ink.afzendersOverslaan': { nl: 'Afzenders die je overslaat', ar: 'المُرسِلون الذين تتخطّاهم', en: 'Senders you skip' },
  'ink.overgeslagen': { nl: 'Overgeslagen bij import', ar: 'ما تُخطّي أثناء الاستيراد', en: 'Skipped during import' },
  'ink.overgeslagenBekijk': { nl: 'Bekijk wat is overgeslagen bij het importeren', ar: 'عرض ما تُخطّي أثناء الاستيراد', en: 'See what was skipped during import' },
  'ink.nietsOvergeslagen': { nl: 'Niets overgeslagen — alles wat binnenkwam is verwerkt.', ar: 'لم يُتخطَّ شيء — كل ما وصل عولج.', en: 'Nothing skipped — everything that arrived was processed.' },
  // De vaste overslaan-redenen. De vierde tak — een door AI geschreven Nederlandse reden uit de
  // database — blijft staan zoals hij is opgeslagen: opgeslagen tekst is data, geen catalogus.
  'ink.reden.onleesbaar': { nl: 'kon niet gelezen worden — staat in je bestanden', ar: 'تعذّرت قراءتها — موجودة في ملفاتك', en: 'could not be read — it is in your files' },
  'ink.reden.geenFactuur': { nl: 'leek geen factuur', ar: 'لم تبدُ فاتورة', en: 'did not look like an invoice' },
  'ink.reden.geenBijlage': { nl: 'e-mail zonder leesbare bijlage', ar: 'رسالة بلا مرفق قابل للقراءة', en: 'an e-mail without a readable attachment' },
  'ink.nietsCorrigeren': { nl: 'Niets om te corrigeren', ar: 'لا شيء للتصحيح', en: 'Nothing to correct' },
  'ink.vakerCorrigeert': { nl: 'Wat je hier vaker corrigeert', ar: 'ما تصحّحه هنا كثيرًا', en: 'What you correct here often' },

  'ink.email.verbind': { nl: 'Verbind je e-mail', ar: 'اربط بريدك الإلكتروني', en: 'Connect your e-mail' },
  'ink.email.automatisch': { nl: 'Facturen komen automatisch binnen — je hoeft niets meer door te sturen.', ar: 'تصل الفواتير تلقائيًا — لن تحتاج إلى إعادة توجيه شيء.', en: 'Invoices arrive automatically — nothing to forward any more.' },
  'ink.email.verwijderen': { nl: 'E-mailverbinding verwijderen', ar: 'حذف ربط البريد الإلكتروني', en: 'Remove the e-mail connection' },
  'ink.email.gestopt': { nl: 'Automatisch inlezen is gestopt', ar: 'توقّفت القراءة التلقائية', en: 'Automatic reading has stopped' },
  'ink.email.ouderOphalen': { nl: 'Mis je een factuur? Oudere e-mails opnieuw ophalen…', ar: 'أتنقصك فاتورة؟ أعد جلب الرسائل الأقدم…', en: 'Missing an invoice? Fetch older e-mails again…' },
  // [BIJLAGE-TERUGWEG] The word "niet" is the whole sentence: the backfill can only serve an
  // invoice that is NOT in this list. An earlier split dropped it and inverted the advice.
  'ink.email.misFactuur': { nl: 'Mis je een factuur die hier niet tussen staat?', ar: 'أتنقصك فاتورة لا تظهر هنا؟', en: 'Missing an invoice that is not in this list?' },
  'ink.ophalenVanaf': { nl: 'Ophalen vanaf', ar: 'الجلب اعتبارًا من', en: 'Fetch from' },
  'ink.opnieuwInlezen': { nl: 'Alle facturen die aandacht nodig hebben opnieuw inlezen', ar: 'أعد قراءة كل الفواتير التي تحتاج انتباهاً', en: 'Re-read every invoice that needs attention' },
  'ink.opnieuwBezig': { nl: 'Bezig met opnieuw inlezen…', ar: 'جارٍ إعادة القراءة…', en: 'Re-reading…' },
  'ink.verifierenBezig': { nl: 'Bezig met verifiëren…', ar: 'جارٍ التدقيق…', en: 'Verifying…' },
  'ink.bekijkBestanden': { nl: 'Bekijk in bestanden', ar: 'عرض في الملفات', en: 'View in files' },

  // ─── [INKOOP] Het beheer van bevestigde inkoopfacturen ──────────────────────────────────────
  // Hergebruikt ink.* waar dezelfde woorden al bestaan; hier alleen wat uniek is voor dit scherm.

  'inkoop.leeg': { nl: 'Geen inkoopfacturen', ar: 'لا فواتير مشتريات', en: 'No purchase invoices' },
  'inkoop.leeg.sub': { nl: 'Bevestigde inkoopfacturen verschijnen hier', ar: 'تظهر هنا فواتير المشتريات المؤكَّدة', en: 'Confirmed purchase invoices appear here' },
  'inkoop.leverancier': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'inkoop.naam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'inkoop.bedrag': { nl: 'Bedrag', ar: 'المبلغ', en: 'Amount' },
  'inkoop.methode': { nl: 'Methode', ar: 'الطريقة', en: 'Method' },
  'inkoop.kenmerk': { nl: 'Kenmerk', ar: 'المرجع', en: 'Reference' },
  'inkoop.factuurdatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'inkoop.vervaldatum': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'inkoop.sorteren': { nl: 'Sorteren', ar: 'ترتيب', en: 'Sort' },
  // [TAAL] De sorteerkeuzes van invoice-sort.ts. Ze stonden als Nederlandse zinnen in die module en
  // drie schermen drukten ze zo af — dus op een Arabisch scherm stond "Toegevoegd (nieuwste eerst)"
  // op de knop terwijl alles eromheen vertaald was. Geen pijlen in het Arabisch: een richting in
  // een zin is precies wat [TAAL] omdraait, en "van hoog naar laag" heeft er geen nodig.
  'sort.toegevoegdNieuwste':  { nl: 'Toegevoegd (nieuwste eerst)',   ar: 'تاريخ الإضافة (الأحدث أولًا)',        en: 'Added (newest first)' },
  'sort.factuurdatumNieuwste': { nl: 'Factuurdatum (nieuwste eerst)', ar: 'تاريخ الفاتورة (الأحدث أولًا)',      en: 'Invoice date (newest first)' },
  'sort.factuurdatumOudste':   { nl: 'Factuurdatum (oudste eerst)',   ar: 'تاريخ الفاتورة (الأقدم أولًا)',      en: 'Invoice date (oldest first)' },
  'sort.vervaldatumVerlopen':  { nl: 'Vervaldatum (eerst verlopen)',  ar: 'تاريخ الاستحقاق (المتأخّر أولًا)',   en: 'Due date (overdue first)' },
  'sort.betaaldatumNieuwste':  { nl: 'Betaaldatum (nieuwste eerst)',  ar: 'تاريخ الدفع (الأحدث أولًا)',         en: 'Payment date (newest first)' },
  'sort.bedragHoogLaag':       { nl: 'Bedrag (hoog → laag)',          ar: 'المبلغ (من الأعلى إلى الأدنى)',      en: 'Amount (high → low)' },
  'sort.bedragLaagHoog':       { nl: 'Bedrag (laag → hoog)',          ar: 'المبلغ (من الأدنى إلى الأعلى)',      en: 'Amount (low → high)' },
  'sort.leverancierAZ':        { nl: 'Leverancier (A–Z)',             ar: 'المورّد (A–Z)',                     en: 'Supplier (A–Z)' },
  'inkoop.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'inkoop.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'inkoop.duidelijk': { nl: 'Duidelijk', ar: 'مفهوم', en: 'Got it' },
  'inkoop.allePeriodes': { nl: 'Toon alle periodes', ar: 'عرض كل الفترات', en: 'Show all periods' },
  'inkoop.opnieuwProberen': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'inkoop.verwerkt': { nl: 'Verwerkt', ar: 'تمت المعالجة', en: 'Processed' },
  'inkoop.voorbereid': { nl: 'Voorbereid', ar: 'مُجهَّزة', en: 'Prepared' },
  'inkoop.automatisch': { nl: 'Automatisch', ar: 'تلقائي', en: 'Automatic' },

  'inkoop.betalen': { nl: 'Betalen', ar: 'ادفع', en: 'Pay' },
  'inkoop.hebJeBetaald': { nl: 'Heb je betaald?', ar: 'هل دفعت؟', en: 'Did you pay?' },
  'inkoop.betalingVerstuurd': { nl: 'Heb je de betaling verstuurd?', ar: 'هل أرسلت الدفعة؟', en: 'Did you send the payment?' },
  'inkoop.jaBetaald': { nl: 'Ja, ik heb betaald', ar: 'نعم، دفعت', en: 'Yes, I paid' },
  'inkoop.nogNiet': { nl: 'Nog niet', ar: 'ليس بعد', en: 'Not yet' },
  'inkoop.tochBetaald': { nl: 'Toch markeren als betaald', ar: 'تحديد كمدفوعة رغم ذلك', en: 'Mark as paid anyway' },
  'inkoop.opBetaald': { nl: 'Op betaald gezet', ar: 'وُضعت كمدفوعة', en: 'Marked as paid' },
  'inkoop.genoteerd': { nl: 'Genoteerd — factuur blijft open als te betalen', ar: 'سُجّل — تبقى الفاتورة مفتوحة كمستحقة للدفع', en: 'Noted — the invoice stays open as payable' },
  'inkoop.mogelijkBetaald': { nl: 'Mogelijk al betaald', ar: 'ربما دُفعت مسبقًا', en: 'Possibly already paid' },
  'inkoop.bonAfgerekend': { nl: 'Bon · al afgerekend', ar: 'إيصال · مسدّد مسبقًا', en: 'Receipt · already settled' },
  'inkoop.waarvoorKost': { nl: 'Waarvoor is deze kost?', ar: 'علامَ هذه التكلفة؟', en: 'What is this cost for?' },
  'inkoop.incassoIngesteld': { nl: 'Automatische incasso ingesteld', ar: 'ضُبط الخصم التلقائي', en: 'Direct debit set up' },
  'inkoop.geboektCredit': { nl: 'Geboekt als creditnota — gaat van je openstaande saldo af', ar: 'قُيّدت كإشعار دائن — تُخصم من رصيدك المفتوح', en: 'Booked as a credit note — comes off your outstanding balance' },
  'inkoop.cijfersLeverancier': { nl: 'Cijfers van de leverancier', ar: 'أرقام المورّد', en: "The supplier's figures" },
  // De belangrijkste geruststelling op dit scherm: deze cijfers zijn niet GELEZEN maar exact wat
  // de leverancier zelf heeft opgestuurd. De zin draagt het waarom, dus hij verhuist als geheel.
  'inkoop.eFactuurUitleg': {
    nl: 'Bedragen uit de e-factuur van de leverancier ({syntax}), niets van een pagina gelezen. Deze hoef je niet na te kijken.',
    ar: 'المبالغ من الفاتورة الإلكترونية للمورّد ({syntax})، لم يُقرأ شيء من صفحة. لا تحتاج لمراجعتها.',
    en: 'Amounts from the supplier’s e-invoice ({syntax}), nothing read off a page. You do not need to check this one.',
  },
  'inkoop.bedragenCorrigeren': { nl: 'Bedragen corrigeren', ar: 'تصحيح المبالغ', en: 'Correct the amounts' },
  'inkoop.bekijkBetaalde': { nl: 'Bekijk de betaalde factuur', ar: 'عرض الفاتورة المدفوعة', en: 'View the paid invoice' },
  'inkoop.bekijkBank': { nl: 'Bekijk op de Bank-pagina', ar: 'عرض في صفحة البنك', en: 'View on the Bank page' },
  'inkoop.betalingVerplaatsen': { nl: 'Betaling verplaatsen', ar: 'نقل الدفعة', en: 'Move the payment' },
  'inkoop.meerdereAnnuleren': { nl: 'Meerdere annuleren', ar: 'إلغاء عدة عناصر', en: 'Cancel several' },
  'inkoop.dubbeleVerwijderen': { nl: 'Deze dubbele verwijderen', ar: 'حذف هذه المكررة', en: 'Remove this duplicate' },
  'inkoop.dubbeleVerwijderd': { nl: 'Dubbele factuur verwijderd', ar: 'أُزيلت الفاتورة المكرّرة', en: 'Duplicate invoice removed' },
  'inkoop.origineelToegevoegd': { nl: 'Origineel toegevoegd. De boekhouder kan de factuur nu controleren.', ar: 'أُضيف المستند الأصلي. يستطيع المحاسب الآن تدقيق الفاتورة.', en: 'Original added. The accountant can now check the invoice.' },
  'inkoop.opnieuwIngelezen': { nl: 'Opnieuw ingelezen.', ar: 'أُعيدت قراءتها.', en: 'Re-read.' },

  // Fouten en offline — elke zin zegt wat er NIET is gebeurd.
  'inkoop.fout.nietOpenen': { nl: 'Deze factuur konden we hier niet openen — zoek hem op in de lijst', ar: 'تعذّر فتح هذه الفاتورة هنا — ابحث عنها في القائمة', en: 'Could not open this invoice here — find it in the list' },
  'inkoop.fout.ophalen': { nl: 'We konden je inkoopfacturen niet ophalen', ar: 'تعذّر جلب فواتير مشترياتك', en: 'Could not fetch your purchase invoices' },
  'inkoop.fout.incassoOphalen': { nl: 'We konden je automatische incasso’s niet ophalen', ar: 'تعذّر جلب خصومك المباشرة', en: 'Could not fetch your direct debits' },
  'inkoop.fout.onvolledig': { nl: 'Dit telt alleen op wat we konden ophalen — er ontbreken facturen.', ar: 'هذا يجمع فقط ما استطعنا جلبه — ثمة فواتير ناقصة.', en: 'This only adds up what we could fetch — invoices are missing.' },
  'inkoop.fout.geenBoeking': { nl: 'Van deze betaling is geen boeking gevonden om te verplaatsen', ar: 'لم يُعثر لهذه الدفعة على قيد لنقله', en: 'No booking was found for this payment to move' },
  'inkoop.fout.nietsOpen': { nl: 'Er stond nog niets open dat al afgeschreven was.', ar: 'لم يكن ثمة شيء مفتوح خُصم مسبقًا.', en: 'Nothing open had already been debited.' },
  'inkoop.fout.matchen': { nl: 'Matchen mislukt — probeer het opnieuw', ar: 'فشلت المطابقة — حاول مرة أخرى', en: 'Matching failed — please try again' },
  'inkoop.fout.instellen': { nl: 'Instellen mislukt — controleer je verbinding', ar: 'فشل الضبط — تحقّق من اتصالك', en: 'Setting up failed — check your connection' },
  'inkoop.fout.narekenen': { nl: 'Narekenen is niet gelukt — controleer je verbinding.', ar: 'فشلت إعادة الحساب — تحقّق من اتصالك.', en: 'Recalculating failed — check your connection.' },
  'inkoop.fout.opnieuwInlezen': { nl: 'Opnieuw inlezen is niet gelukt — controleer je verbinding.', ar: 'فشلت إعادة القراءة — تحقّق من اتصالك.', en: 'Re-reading failed — check your connection.' },
  'inkoop.fout.toevoegen': { nl: 'Toevoegen is niet gelukt — controleer je verbinding.', ar: 'فشلت الإضافة — تحقّق من اتصالك.', en: 'Adding failed — check your connection.' },
  'inkoop.fout.offlineNiets': { nl: 'Geen verbinding — er is niets gewijzigd', ar: 'لا يوجد اتصال — لم يتغيّر شيء', en: 'No connection — nothing was changed' },
  'inkoop.fout.offline': { nl: 'Geen verbinding — probeer opnieuw', ar: 'لا يوجد اتصال — حاول مرة أخرى', en: 'No connection — please try again' },

  // ─── [BANK] Het bankscherm — waar afschriften binnenkomen en betalingen boeken ──────────────

  'bank.zoek': { nl: 'Zoek op naam, omschrijving, IBAN, bedrag of datum', ar: 'ابحث بالاسم أو الوصف أو IBAN أو المبلغ أو التاريخ', en: 'Search by name, description, IBAN, amount or date' },
  'bank.zoek.aria': { nl: 'Transacties zoeken', ar: 'البحث في المعاملات', en: 'Search transactions' },
  'bank.zoek.wissen': { nl: 'Wis zoekopdracht', ar: 'مسح البحث', en: 'Clear the search' },
  'bank.upload.sleep': { nl: 'Sleep je bestand hierheen of klik om te kiezen', ar: 'اسحب ملفك إلى هنا أو انقر للاختيار', en: 'Drag your file here or click to choose' },
  'bank.upload.als': { nl: 'Upload je afschrift als', ar: 'ارفع كشفك بصيغة', en: 'Upload your statement as' },
  'bank.afschriften': { nl: 'Geüploade afschriften', ar: 'الكشوف المرفوعة', en: 'Uploaded statements' },
  'bank.afschrift.verwijderen': { nl: 'Bankafschrift verwijderen', ar: 'حذف كشف الحساب', en: 'Delete the bank statement' },
  'bank.afschrift.verwijderenVraag': { nl: 'Bankafschrift verwijderen?', ar: 'حذف كشف الحساب؟', en: 'Delete this bank statement?' },
  'bank.afschrift.verwijderenZeker': { nl: 'Weet je zeker dat je dit bankafschrift wilt verwijderen?', ar: 'هل أنت متأكد من حذف كشف الحساب هذا؟', en: 'Are you sure you want to delete this bank statement?' },
  'bank.afschrift.verwijderd': { nl: 'Bankafschrift verwijderd ✓', ar: 'حُذف كشف الحساب ✓', en: 'Bank statement deleted ✓' },
  'bank.rustig': { nl: 'Alleen wat jouw aandacht nodig heeft is overgebleven.', ar: 'لم يبقَ إلا ما يحتاج إلى انتباهك.', en: 'Only what needs your attention remains.' },
  'bank.categorie': { nl: 'Geef deze regels een categorie', ar: 'أعطِ هذه البنود تصنيفًا', en: 'Give these lines a category' },

  'bank.koppelen': { nl: 'Koppelen', ar: 'ربط', en: 'Link' },
  'bank.bevestig': { nl: 'Bevestig', ar: 'تأكيد', en: 'Confirm' },
  'bank.bevestigBetaling': { nl: 'Bevestig betaling', ar: 'أكِّد الدفعة', en: 'Confirm the payment' },
  'bank.alBevestigd': { nl: 'Al bevestigd ✓', ar: 'مؤكَّدة مسبقًا ✓', en: 'Already confirmed ✓' },
  'bank.selecteerBevestigen': { nl: 'Selecteer voor bevestigen', ar: 'حدّد للتأكيد', en: 'Select to confirm' },
  'bank.bekijkFactuur': { nl: 'Factuur bekijken', ar: 'عرض الفاتورة', en: 'View the invoice' },
  'bank.andereFactuur': { nl: 'Andere factuur', ar: 'فاتورة أخرى', en: 'A different invoice' },
  'bank.details': { nl: 'Details', ar: 'التفاصيل', en: 'Details' },
  'bank.begrepen': { nl: 'Begrepen', ar: 'فهمت', en: 'Got it' },
  'bank.negeren': { nl: 'Negeren', ar: 'تجاهل', en: 'Ignore' },
  // [BIJLAGE-BIJ-REGEL] · [REGEL-WEG] The owner's own controls on a line.
  'bank.bijlage.toevoegen': { nl: 'Bestand toevoegen', ar: 'إضافة ملف', en: 'Add file' },
  'bank.bijlage.verwijderen': { nl: 'Bijlage verwijderen', ar: 'إزالة المرفق', en: 'Remove attachment' },
  'bank.bijlage.toegevoegd': { nl: 'Bestand bij deze regel bewaard.', ar: 'حُفظ الملف مع هذا السطر.', en: 'File kept with this line.' },
  'bank.bijlage.weg': { nl: 'Bijlage verwijderd.', ar: 'أُزيل المرفق.', en: 'Attachment removed.' },
  'bank.bijlage.teGroot': { nl: 'Bestand te groot (max. 15 MB).', ar: 'الملف كبير جدًا (الحد 15 ميغابايت).', en: 'File too large (max. 15 MB).' },
  'bank.bijlage.soort': { nl: 'Alleen pdf, foto of tekst.', ar: 'فقط PDF أو صورة أو نص.', en: 'PDF, photo or text only.' },
  'bank.fout.bijlage': { nl: 'Bestand bewaren mislukt.', ar: 'فشل حفظ الملف.', en: 'Saving the file failed.' },
  'bank.regelWeg': { nl: 'Regel verwijderen', ar: 'حذف السطر', en: 'Delete line' },
  'bank.regelWegVraag': { nl: 'Deze bankregel definitief verwijderen?', ar: 'حذف هذا السطر البنكي نهائيًا؟', en: 'Delete this bank line for good?' },
  'bank.regelWegJa': { nl: 'Ja, verwijderen', ar: 'نعم، احذف', en: 'Yes, delete' },
  'bank.regelWegKlaar': { nl: 'Regel verwijderd.', ar: 'حُذف السطر.', en: 'Line deleted.' },
  'bank.fout.regelWeg': { nl: 'Verwijderen mislukt.', ar: 'فشل الحذف.', en: 'Deleting failed.' },
  'bank.fout.regelGekoppeld': { nl: 'Deze regel staat (deels) op een factuur — ontkoppel eerst.', ar: 'هذا السطر مرتبط (جزئيًا) بفاتورة — ألغِ ربطه أولًا.', en: 'This line is (partly) on an invoice — unlink it first.' },
  'bank.openFactuur': { nl: 'Open factuur', ar: 'افتح الفاتورة', en: 'Open invoice' },
  // [REGEL-FACTUUR] An invoice from a bank line, no file.
  'bank.lf.knop': { nl: 'Zonder bestand', ar: 'بدون ملف', en: 'Without a file' },
  'bank.lf.titel': { nl: 'Wat was deze betaling?', ar: 'ما كانت هذه الدفعة؟', en: 'What was this payment?' },
  'bank.lf.uitlegInkoop': { nl: 'Je boekt deze regel als inkoop, zonder document.', ar: 'ستسجّل هذا السطر كمشتريات، بلا مستند.', en: 'You book this line as a purchase, without a document.' },
  'bank.lf.uitlegVerkoop': { nl: 'Je boekt deze regel als verkoop, zonder factuur.', ar: 'ستسجّل هذا السطر كمبيعات، بلا فاتورة.', en: 'You book this line as a sale, without an invoice.' },
  'bank.lf.leverancier': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'bank.lf.klant': { nl: 'Klant', ar: 'العميل', en: 'Customer' },
  'bank.lf.omschrijving': { nl: 'Omschrijving', ar: 'الوصف', en: 'Description' },
  'bank.lf.documentElders': { nl: 'Ik heb de factuur of bon ergens anders (papier, mail). Dan mag de btw mee.', ar: 'لدي الفاتورة أو الإيصال في مكان آخر (ورق، بريد). عندها تُحتسب ضريبة القيمة المضافة.', en: 'I have the invoice or receipt elsewhere (paper, mail). Then the btw counts.' },
  'bank.lf.btw': { nl: 'Btw-tarief', ar: 'نسبة btw', en: 'Btw rate' },
  'bank.lf.geenBtwZonderDocument': { nl: 'Zonder document geen btw terug. De kost telt wel.', ar: 'بلا مستند لا تُسترد ضريبة القيمة المضافة. التكلفة تُحتسب.', en: 'No document, no btw back. The cost still counts.' },
  'bank.lf.tariefIngesteld': { nl: '{rate}% — het vaste tarief dat je voor deze leverancier hebt ingesteld.', ar: '{rate}% — النسبة الثابتة التي ضبطتَها لهذا المورّد.', en: '{rate}% — the fixed rate you set for this supplier.' },
  'bank.lf.tariefUitFacturen': { nl: '{rate}% volgens {count} eerdere facturen van deze leverancier.', ar: '{rate}% وفق {count} فواتير سابقة من هذا المورّد.', en: '{rate}% according to {count} earlier invoices from this supplier.' },
  'bank.lf.boek': { nl: 'Boek deze regel', ar: 'سجّل هذا السطر', en: 'Book this line' },
  'bank.lf.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'bank.lf.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bank.lf.klaar': { nl: 'Geboekt. De regel is gekoppeld.', ar: 'سُجّل. السطر مرتبط.', en: 'Booked. The line is linked.' },
  'bank.lf.klaarZonderBtw': { nl: 'Geboekt zonder btw — voeg het document later toe als je het vindt.', ar: 'سُجّل بلا ضريبة القيمة المضافة — أضف المستند لاحقًا إن وجدته.', en: 'Booked without btw — add the document later if you find it.' },
  'bank.lf.alBetaald': { nl: 'Er staat al een betaalde factuur van dit bedrag vlakbij — koppel die, of controleer eerst.', ar: 'توجد فاتورة مدفوعة بهذا المبلغ قريبة — اربطها أو تحقّق أولًا.', en: 'A paid invoice of this amount sits nearby — link that one, or check first.' },
  'bank.fout.lijnFactuur': { nl: 'Boeken mislukt.', ar: 'فشل التسجيل.', en: 'Booking failed.' },
  // [STORNO] A reversed incasso: the credit names the payment it undoes.
  'bank.storno.uitleg': {
    nl: 'Terugboeking van de incasso van {date}. Factuur {number} is dus niet betaald.',
    ar: 'استرجاع للخصم المباشر بتاريخ {date}. الفاتورة {number} إذن غير مدفوعة.',
    en: 'Reversal of the direct debit of {date}. Invoice {number} is therefore not paid.',
  },
  'bank.storno.knop': { nl: 'Factuur weer open zetten', ar: 'إعادة فتح الفاتورة', en: 'Reopen the invoice' },
  'bank.storno.klaar': { nl: 'Factuur staat weer open; beide regels apart gezet.', ar: 'الفاتورة مفتوحة من جديد؛ وُضع السطران جانبًا.', en: 'Invoice open again; both lines set aside.' },
  'bank.fout.storno': { nl: 'Terugdraaien mislukt.', ar: 'فشل التراجع.', en: 'Reversing failed.' },
  'bank.bijlage.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bank.genegeerd': { nl: 'Genegeerd', ar: 'مُتجاهَلة', en: 'Ignored' },
  'bank.genegeerdWeg': { nl: 'Genegeerd — staat niet in de actieve lijst.', ar: 'تُجوهلت — ليست في القائمة النشطة.', en: 'Ignored — not in the active list.' },
  'bank.transactieGenegeerd': { nl: 'Transactie genegeerd', ar: 'تُجوهلت المعاملة', en: 'Transaction ignored' },
  'bank.zonderReden': { nl: 'Zonder reden', ar: 'بلا سبب', en: 'No reason' },
  'bank.geenNummerVerbergen': { nl: 'Geen factuurnummer — verbergen', ar: 'لا رقم فاتورة — إخفاء', en: 'No invoice number — hide it' },
  'bank.geenFactuurVerberg': { nl: 'Dit nummer is geen factuur, verberg het', ar: 'هذا الرقم ليس فاتورة، أخفِه', en: 'This number is not an invoice, hide it' },
  'bank.gecontroleerd': { nl: 'Gecontroleerd — de melding is weg.', ar: 'تم التحقّق — زال التنبيه.', en: 'Checked — the notice is gone.' },
  'bank.teruggezet': { nl: 'Teruggezet', ar: 'أُعيدت', en: 'Put back' },

  'bank.verdelen': { nl: 'Verdelen over facturen', ar: 'توزيعها على الفواتير', en: 'Split across invoices' },
  'bank.meerFacturen': { nl: 'Deze betaling hoort bij meer dan één factuur', ar: 'هذه الدفعة تخص أكثر من فاتورة', en: 'This payment belongs to more than one invoice' },
  'bank.deelBoeken': { nl: 'Alleen dit deel boeken', ar: 'تسجيل هذا الجزء فقط', en: 'Book only this part' },
  'bank.helesBedrag': { nl: 'Toch het hele bedrag op deze factuur', ar: 'المبلغ كاملاً على هذه الفاتورة رغم ذلك', en: 'The whole amount on this invoice anyway' },
  'bank.periodeDekt': { nl: 'De periode die deze betaling dekt', ar: 'الفترة التي تغطّيها هذه الدفعة', en: 'The period this payment covers' },
  'bank.betalingVerplaatsen': { nl: 'Betaling verplaatsen', ar: 'نقل الدفعة', en: 'Move the payment' },
  'bank.vergelijk': { nl: 'Meerdere facturen passen bij deze betaling. Vergelijk', ar: 'عدة فواتير تطابق هذه الدفعة. قارن', en: 'Several invoices match this payment. Compare' },
  'bank.automatischOp': { nl: 'Automatisch gekoppeld op', ar: 'رُبطت تلقائيًا بتاريخ', en: 'Automatically linked on' },
  'bank.gegevensCorrigeren': { nl: 'Gegevens corrigeren', ar: 'تصحيح البيانات', en: 'Correct the details' },
  'bank.toevoegenOfOphalen': { nl: 'Factuur toevoegen of e-mail opnieuw ophalen', ar: 'أضف فاتورة أو أعد جلب البريد', en: 'Add an invoice or re-fetch the e-mail' },
  'bank.toegevoegdGeboekt': { nl: 'Factuur toegevoegd en geboekt — je kunt de betaling nu verdelen.', ar: 'أُضيفت الفاتورة وقُيّدت — يمكنك الآن توزيع الدفعة.', en: 'Invoice added and booked — you can now split the payment.' },
  'bank.maximaal': { nl: 'Er wordt maximaal', ar: 'سيُسجَّل كحدّ أقصى', en: 'At most' },

  'bank.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'bank.fout.bevestigen': { nl: 'Bevestigen mislukt.', ar: 'فشل التأكيد.', en: 'Confirming failed.' },
  'bank.fout.bijwerken': { nl: 'Bijwerken mislukt.', ar: 'فشل التحديث.', en: 'Updating failed.' },
  // [BLIND-GEMATCHT] Wat deze suggestielijst NIET heeft kunnen gebruiken. Nooit beweren dat er
  // niets is onthouden — alleen dat we het nu niet konden lezen.
  'bank.blind.geheugen': { nl: 'We konden nu niet ophalen wat je eerder bevestigde — deze suggesties zijn daardoor voorzichtiger dan normaal.', en: 'We could not fetch what you confirmed before — these suggestions are more cautious than usual.', ar: 'تعذّر جلب ما أكّدته سابقًا — لذلك هذه الاقتراحات أكثر تحفّظًا من المعتاد.' },
  'bank.blind.leverancier': { nl: 'We konden nu niet ophalen van welke rekening je leveranciers factureren — een betaling met alleen een IBAN herkennen we daardoor minder goed.', en: 'We could not fetch which account your suppliers bill from — a payment carrying only an IBAN is harder for us to recognise.', ar: 'تعذّر جلب الحسابات التي يُفوتر منها مورّدوك — لذلك نتعرّف بصعوبة أكبر على دفعة لا تحمل سوى IBAN.' },
  'bank.blind.geweigerd': { nl: 'We konden nu niet ophalen welke suggesties je hebt afgewezen — een afgewezen suggestie kan terugkomen.', en: 'We could not fetch which suggestions you rejected — a rejected one may come back.', ar: 'تعذّر جلب الاقتراحات التي رفضتها — قد يعود اقتراح رفضته.' },
  'bank.fout.matchen': { nl: 'Matchen mislukt.', ar: 'فشلت المطابقة.', en: 'Matching failed.' },
  'bank.fout.negeren': { nl: 'Negeren mislukt.', ar: 'فشل التجاهل.', en: 'Ignoring failed.' },
  'bank.fout.ontkoppelen': { nl: 'Ontkoppelen mislukt.', ar: 'فشل إلغاء الربط.', en: 'Unlinking failed.' },
  'bank.fout.ophalen': { nl: 'Ophalen mislukt.', ar: 'فشل الجلب.', en: 'Fetching failed.' },
  'bank.fout.opslaan': { nl: 'Kon niet opslaan. Probeer het nog een keer.', ar: 'تعذّر الحفظ. حاول مرة أخرى.', en: 'Could not save. Please try again.' },
  'bank.fout.terugzetten': { nl: 'Terugzetten mislukt.', ar: 'فشلت الإعادة.', en: 'Putting back failed.' },
  'bank.fout.opnieuw': { nl: 'Opnieuw proberen is niet gelukt.', ar: 'لم تنجح إعادة المحاولة.', en: 'Retrying did not work.' },
  'bank.fout.automatisch': { nl: 'Automatisch afhandelen mislukt.', ar: 'فشلت المعالجة التلقائية.', en: 'Automatic handling failed.' },
  'bank.fout.factuurOpenen': { nl: 'Kon de factuur niet openen.', ar: 'تعذّر فتح الفاتورة.', en: 'Could not open the invoice.' },
  'bank.fout.factuurOphalen': { nl: 'Deze factuur kon niet worden opgehaald — controleer je verbinding.', ar: 'تعذّر جلب هذه الفاتورة — تحقّق من اتصالك.', en: 'This invoice could not be fetched — check your connection.' },
  'bank.fout.geenFactuur': { nl: 'Geen factuur gevonden voor deze transactie.', ar: 'لم يُعثر على فاتورة لهذه المعاملة.', en: 'No invoice found for this transaction.' },
  // [CIRKEL] De factuur bestaat al in de app — hij wacht alleen op controle.
  'bank.inWachtrij': { nl: 'Factuur {number} staat al in je controlewachtrij — niet opnieuw uploaden.', ar: 'الفاتورة {number} موجودة أصلًا في قائمة المراجعة — لا ترفعها مجددًا.', en: 'Invoice {number} is already in your review queue — no need to upload it again.' },
  'bank.inWachtrijZonderNummer': { nl: 'Deze betaling lijkt te horen bij een factuur die al in je controlewachtrij staat — niet opnieuw uploaden.', ar: 'يبدو أن هذه الدفعة تعود لفاتورة موجودة أصلًا في قائمة المراجعة — لا ترفعها مجددًا.', en: 'This payment appears to belong to an invoice already in your review queue — no need to upload it again.' },
  'bank.verifieerEerst': { nl: 'Verifieer de factuur', ar: 'راجع الفاتورة', en: 'Verify the invoice' },
  'bank.fout.geenBoeking': { nl: 'Geen geboekte betaling gevonden op deze regel.', ar: 'لا قيد دفع على هذا البند.', en: 'No booked payment found on this line.' },
  'bank.fout.geenNummers': { nl: 'Geen factuurnummers meer. Is dit geen factuur? Gebruik Negeren.', ar: 'لم تعد ثمة أرقام فواتير. أليست فاتورة؟ استخدم «تجاهل».', en: 'No invoice numbers left. Not an invoice? Use Ignore.' },
  'bank.fout.alToegewezen': { nl: 'Deze betaling is al volledig toegewezen aan facturen.', ar: 'هذه الدفعة وُزّعت بالكامل على فواتير.', en: 'This payment is already fully assigned to invoices.' },
  'bank.fout.groep': { nl: 'Ontkoppelen van een groepsbetaling kan hier nog niet.', ar: 'إلغاء ربط دفعة جماعية غير ممكن هنا بعد.', en: 'Unlinking a group payment is not possible here yet.' },
  'bank.fout.verwerkt': { nl: 'De boekhouder heeft deze factuur al verwerkt. Vraag eerst om dat ongedaan te maken.', ar: 'المحاسب عالج هذه الفاتورة مسبقًا. اطلب أولًا التراجع عن ذلك.', en: 'The accountant already processed this invoice. First ask to undo that.' },
  'bank.fout.netGedaan': { nl: 'Even wachten — je hebt dit net al gedaan.', ar: 'انتظر قليلًا — فعلت هذا للتو.', en: 'One moment — you just did this.' },
  'bank.fout.bedragNul': { nl: 'Vul een bedrag groter dan nul in.', ar: 'أدخل مبلغاً أكبر من صفر.', en: 'Enter an amount above zero.' },
  'bank.fout.offlineNiets': { nl: 'Geen verbinding — er is niets gewijzigd.', ar: 'لا يوجد اتصال — لم يتغيّر شيء.', en: 'No connection — nothing was changed.' },
  'bank.fout.offline': { nl: 'Geen verbinding — probeer opnieuw.', ar: 'لا يوجد اتصال — حاول مرة أخرى.', en: 'No connection — please try again.' },
  'bank.fout.toevoegen': { nl: 'Toevoegen mislukt — controleer je verbinding.', ar: 'فشلت الإضافة — تحقّق من اتصالك.', en: 'Adding failed — check your connection.' },
  'bank.fout.nietUitgelezen': { nl: 'Transacties niet uitgelezen', ar: 'لم تُقرأ المعاملات', en: 'Transactions not read' },
  'bank.waarschuwing.sluitNiet': { nl: '⚠️ Bankafschrift sluit niet aan — mogelijk ontbreekt een transactie. Zie de melding.', ar: '⚠️ كشف الحساب غير متطابق — قد تنقص معاملة. انظر التنبيه.', en: '⚠️ The statement does not reconcile — a transaction may be missing. See the notice.' },
  'bank.waarschuwing.gat': { nl: '⚠️ Er ontbreekt een stuk bankgeschiedenis — zie de melding.', ar: '⚠️ ثمة فجوة في تاريخ الحساب — انظر التنبيه.', en: '⚠️ A stretch of bank history is missing — see the notice.' },

  // ─── [KAS] Het kasboek ──────────────────────────────────────────────────────────────────────

  'kas.zoek': { nl: 'Zoek in boekingen (omschrijving, categorie, bedrag)…', ar: 'ابحث في القيود (الوصف، التصنيف، المبلغ)…', en: 'Search entries (description, category, amount)…' },
  'kas.zoek.aria': { nl: 'Kasboekingen zoeken', ar: 'البحث في قيود الصندوق', en: 'Search cash entries' },
  'kas.leeg': { nl: 'Geen kasbewegingen in dit kwartaal.', ar: 'لا حركات نقدية في هذا الربع.', en: 'No cash movements this quarter.' },
  'kas.ontvangen': { nl: 'Ontvangen', ar: 'المقبوض', en: 'Received' },
  'kas.uitgegeven': { nl: 'Uitgegeven', ar: 'المصروف', en: 'Spent' },
  'kas.datum': { nl: 'Datum', ar: 'التاريخ', en: 'Date' },
  'kas.beginsaldo': { nl: 'Beginsaldo kwartaal', ar: 'الرصيد الافتتاحي للربع', en: 'Opening balance for the quarter' },
  'kas.eindsaldo': { nl: 'Eindsaldo kwartaal', ar: 'الرصيد الختامي للربع', en: 'Closing balance for the quarter' },
  'kas.beginsaldoKort': { nl: 'Beginsaldo kas:', ar: 'الرصيد الافتتاحي للصندوق:', en: 'Opening cash balance:' },
  'kas.beginsaldoEuro': { nl: 'Beginsaldo kas €', ar: 'الرصيد الافتتاحي للصندوق €', en: 'Opening cash balance €' },
  'kas.beginsaldoNegatief': { nl: 'Beginsaldo moet 0 of hoger zijn', ar: 'يجب أن يكون الرصيد الافتتاحي 0 أو أكثر', en: 'The opening balance must be 0 or higher' },
  'kas.vorigKwartaal': { nl: 'Vorig kwartaal', ar: 'الربع السابق', en: 'Previous quarter' },
  'kas.volgendKwartaal': { nl: 'Volgend kwartaal', ar: 'الربع التالي', en: 'Next quarter' },
  'kas.contantToevoegen': { nl: 'Contant betaalde factuur toevoegen', ar: 'أضف فاتورة دُفعت نقدًا', en: 'Add a cash-paid invoice' },
  // [KAS-SPOOR] Wat dit kwartaal WEL hield en niet meer houdt. Een kasboeking wordt hard verwijderd,
  // dus het auditspoor is de enige plek waar de beweging nog bestaat. De zin zegt er meteen bij dat
  // deze regels NIET in de saldi zitten — anders is de eerste vraag van iedere lezer of het
  // eindsaldo hierboven ze meerekent.
  'kas.verwijderd.titel': {
    nl: 'Verwijderd uit dit kwartaal',
    ar: 'حُذف من هذا الربع',
    en: 'Removed from this quarter',
  },
  'kas.verwijderd.uitleg': {
    nl: 'Deze kasboekingen zijn verwijderd. Ze zitten niet in de saldi hierboven — ze staan hier omdat een kasboek waaruit regels ongemerkt verdwijnen niet te controleren is.',
    ar: 'هذه القيود النقدية حُذفت. وهي ليست ضمن الأرصدة أعلاه — تظهر هنا لأن دفتر الصندوق الذي تختفي منه السطور بلا أثر لا يمكن التحقّق منه.',
    en: 'These cash entries were removed. They are not included in the balances above — they are listed here because a cash book whose lines can vanish unnoticed cannot be checked.',
  },
  'kas.verwijderd.op': {
    nl: 'verwijderd op {datum}',
    ar: 'حُذف بتاريخ {datum}',
    en: 'removed on {datum}',
  },
  'kas.verwijderd.onbekend': {
    nl: 'We konden niet volledig nalezen wat er uit dit kwartaal is verwijderd. Wat hieronder staat kan dus onvolledig zijn.',
    ar: 'لم نتمكّن من قراءة كل ما حُذف من هذا الربع. لذا قد تكون القائمة أدناه ناقصة.',
    en: 'We could not fully read what was removed from this quarter, so the list below may be incomplete.',
  },
  'kas.negatiefSaldo': { nl: 'Negatief saldo — je hebt meer uitgaven dan ontvangsten geboekt.', ar: 'رصيد سالب — قُيّدت مصروفات أكثر من المقبوضات.', en: 'Negative balance — you booked more spending than receipts.' },
  'kas.fout.laden': { nl: 'Kon het kasboek niet laden.', ar: 'تعذّر تحميل دفتر الصندوق.', en: 'Could not load the cash book.' },
  'kas.fout.saldo': { nl: 'We konden je kassaldo niet laden', ar: 'تعذّر تحميل رصيد صندوقك', en: 'Could not load your cash balance' },
  'kas.fout.controle': { nl: 'We konden je kasboek nu niet controleren', ar: 'تعذّر فحص دفتر صندوقك الآن', en: 'Could not check your cash book right now' },
  'kas.fout.verwijderd': { nl: 'Geen verbinding — de boeking is niet verwijderd.', ar: 'لا يوجد اتصال — لم يُحذف القيد.', en: 'No connection — the entry was not deleted.' },
  'kas.fout.verbinding': { nl: 'Verbinding mislukt', ar: 'فشل الاتصال', en: 'Connection failed' },
  'kas.fout.bedragNul': { nl: 'Vul een bedrag groter dan 0 in.', ar: 'أدخل مبلغًا أكبر من 0.', en: 'Enter an amount above 0.' },
  // Drie zinnen met nadruk middenin. De <strong> is opgeofferd (zie nieuw.bevestig.uitleg):
  // opmaak middenin een zin knipt hem stuk voor vertalers, en het woord draagt de nadruk zelf.
  'kas.fout.saldoNiet': { nl: 'Het bedrag hieronder is daarom NIET je echte saldo. Probeer het opnieuw.', ar: 'المبلغ أدناه ليس إذًا رصيدك الحقيقي. حاول مرة أخرى.', en: 'The amount below is therefore NOT your real balance. Try again.' },
  'kas.fout.controleNiet': { nl: 'De controle op een negatief kassaldo is daarom NIET uitgevoerd — dat betekent niet dat er niets aan de hand is. Open het kasboek hieronder en probeer opnieuw.', ar: 'لم يُجرَ إذًا فحص الرصيد السالب — وهذا لا يعني أن كل شيء سليم. افتح دفتر الصندوق أدناه وأعد المحاولة.', en: 'The negative-balance check therefore did NOT run — which does not mean nothing is wrong. Open the cash book below and try again.' },
  'kas.fout.ladenNietLeeg': { nl: 'Kon de boekingen niet laden. Dit is NIET hetzelfde als een lege kas — probeer het opnieuw.', ar: 'تعذّر تحميل القيود. هذا ليس كصندوق فارغ — حاول مرة أخرى.', en: 'Could not load the entries. That is NOT the same as an empty till — try again.' },
  'kas.opnieuw': { nl: 'Opnieuw', ar: 'إعادة المحاولة', en: 'Again' },

  // ─── [VANDAAG] De takenlijst van vandaag ────────────────────────────────────────────────────

  // ── [OFFERTE-OPVOLGING] Offertes die verlopen ────────────────────────────────
  // [CREDIT-TERUG] The creditnotas that still owe the customer money. The button named is the sales list's, as written there.
  'vandaag.terugbetalen': { nl: 'Terug te betalen aan je klant', ar: 'مبالغ يجب ردّها إلى عميلك', en: 'To refund to your customer' },
  'vandaag.terugbetalenUitleg': {
    nl: 'Een creditnota die je nog moet terugstorten. Daarna: Voldaan! op de facturenlijst.',
    ar: 'إشعار دائن ما زال عليك ردّ قيمته. بعدها: «مسددة» في قائمة الفواتير.',
    en: 'A credit note you still have to refund. Then: Settled! on the invoice list.',
  },
  'vandaag.terugbetalenEen': { nl: '1 creditnota', ar: 'إشعار دائن واحد', en: '1 credit note' },
  'vandaag.terugbetalenMeer': { nl: "{n} creditnota's", ar: '{n} إشعارات دائنة', en: '{n} credit notes' },
  'vandaag.terugbetalenLos': {
    nl: 'Factuur buiten BoekBrug — controleer of de klant al betaald had.',
    ar: 'فاتورة خارج BoekBrug — تحقّق مما إذا كان العميل قد دفع بالفعل.',
    en: 'Invoice outside BoekBrug — check whether the customer had already paid.',
  },
  'vandaag.terugbetalenMislukt': {
    nl: "De creditnota's konden niet worden gelezen.",
    ar: 'تعذّرت قراءة الإشعارات الدائنة.',
    en: 'The credit notes could not be read.',
  },
  'vandaag.offertes': { nl: 'Offertes die aandacht vragen', ar: 'عروض أسعار تحتاج انتباهك', en: 'Quotes needing attention' },
  'vandaag.offertesUitleg': {
    nl: 'Geaccepteerd of bijna verlopen',
    ar: 'مقبولة أو توشك أن تنتهي',
    en: 'Accepted, or about to lapse',
  },
  'vandaag.offerteEen': { nl: '1 offerte', ar: 'عرض سعر واحد', en: '1 quote' },
  'vandaag.offerteMeer': { nl: '{n} offertes', ar: '{n} عرض سعر', en: '{n} quotes' },
  'vandaag.offerteAkkoord': {
    nl: 'Akkoord — maak er een factuur van',
    ar: 'تمت الموافقة — أنشئ فاتورة',
    en: 'Accepted — turn it into an invoice',
  },
  'vandaag.offerteVandaag': { nl: 'Verloopt vandaag', ar: 'ينتهي اليوم', en: 'Lapses today' },
  'vandaag.offerteMorgen': { nl: 'Verloopt morgen', ar: 'ينتهي غدًا', en: 'Lapses tomorrow' },
  'vandaag.offerteOver': { nl: 'Verloopt over {n} dagen', ar: 'ينتهي بعد {n} أيام', en: 'Lapses in {n} days' },
  'vandaag.offerteVerlopenEen': { nl: 'Gisteren verlopen', ar: 'انتهى أمس', en: 'Lapsed yesterday' },
  'vandaag.offerteVerlopenMeer': { nl: '{n} dagen verlopen', ar: 'متأخر {n} يومًا', en: 'Lapsed {n} days ago' },
  'vandaag.aandacht': { nl: 'Dit heeft vandaag je aandacht nodig.', ar: 'هذا ما يحتاج إلى انتباهك اليوم.', en: 'This needs your attention today.' },
  // [ZIEL] What the app did by itself this week, and what waits for the owner.
  'vandaag.zelf.deed': { nl: 'Deze week deed BoekBrug {self} van {total} boekingen zelf.', ar: 'هذا الأسبوع سجّل BoekBrug {self} من أصل {total} قيدًا بنفسه.', en: 'This week BoekBrug did {self} of {total} bookings itself.' },
  'vandaag.zelf.niets': { nl: 'Niets wacht op jou.', ar: 'لا شيء ينتظرك.', en: 'Nothing waits for you.' },
  'vandaag.zelf.wachtEen': { nl: 'Eén ding wacht op jou.', ar: 'شيء واحد ينتظرك.', en: 'One thing waits for you.' },
  'vandaag.zelf.wachtMeer': { nl: '{n} dingen wachten op jou.', ar: '{n} أشياء تنتظرك.', en: '{n} things wait for you.' },
  'vandaag.nietsNodig': { nl: 'Niets dat nu je aandacht nodig heeft', ar: 'لا شيء يحتاج إلى انتباهك الآن', en: 'Nothing needs your attention right now' },
  'vandaag.geenVervallen': { nl: 'Geen facturen die binnen 3 dagen vervallen of te laat zijn.', ar: 'لا فواتير تستحق خلال 3 أيام أو متأخرة.', en: 'No invoices due within 3 days or overdue.' },
  'vandaag.teBetalen': { nl: 'Te betalen', ar: 'مستحقة الدفع', en: 'To pay' },
  'vandaag.jijBetalen': { nl: 'Facturen die jij moet betalen', ar: 'فواتير عليك دفعها', en: 'Invoices you need to pay' },
  'vandaag.onbetaald': { nl: 'Verstuurde facturen die nog niet betaald zijn', ar: 'فواتير مُرسَلة لم تُدفع بعد', en: 'Sent invoices not yet paid' },
  'vandaag.controleerKosten': { nl: 'Controleer ze zodat de kosten en BTW-aftrek in je boeken komen.', ar: 'دقّقها لتدخل التكاليف وخصم الضريبة في دفاترك.', en: 'Check them so the costs and VAT deduction reach your books.' },
  'vandaag.geenBetaallijst': { nl: 'Deze staan op geen betaallijst — controleer of betaal ze.', ar: 'ليست على أي قائمة دفع — دقّقها أو ادفعها.', en: 'These are on no payment list — check or pay them.' },
  'vandaag.alBetaald': { nl: 'Al betaald?', ar: 'مدفوعة مسبقاً؟', en: 'Already paid?' },
  'vandaag.deelbetaling': { nl: 'Deelbetaling of andere datum', ar: 'دفعة جزئية أو تاريخ آخر', en: 'Partial payment or a different date' },
  'vandaag.herinner': { nl: 'Herinner je klant', ar: 'ذكِّر عميلك', en: 'Remind your client' },
  'vandaag.verbergen': { nl: 'Verbergen', ar: 'إخفاء', en: 'Hide' },
  'vandaag.verbergenVandaag': { nl: 'Verbergen voor vandaag', ar: 'إخفاء لليوم', en: 'Hide for today' },
  'vandaag.betaaldRestant': { nl: 'Betaald met — vandaag, het restant van', ar: 'دُفعت بـ — اليوم، المتبقّي من', en: 'Paid with — today, the remainder of' },
  'vandaag.betaaldHeel': { nl: 'Betaald met — vandaag, het hele bedrag van', ar: 'دُفعت بـ — اليوم، المبلغ الكامل وقدره', en: 'Paid with — today, the full amount of' },
  'vandaag.betaaldOpen': { nl: 'Betaald met — vandaag, wat er nog openstaat:', ar: 'دُفعت بـ — اليوم، ما زال مستحقًا:', en: 'Paid with — today, what is still outstanding:' },
  'vandaag.fout.ophalen': { nl: 'Er ging iets mis bij het ophalen. Dit betekent NIET dat je niets hoeft te doen — probeer het opnieuw.', ar: 'حدث خطأ أثناء الجلب. هذا لا يعني أنه لا يوجد ما تفعله — حاول مرة أخرى.', en: 'Something went wrong while fetching. That does NOT mean there is nothing to do — try again.' },
  'vandaag.fout.taken': { nl: 'We konden je taken niet laden', ar: 'تعذّر تحميل مهامك', en: 'Could not load your tasks' },

  // ─── [INSTELLINGEN] Het instellingenscherm ──────────────────────────────────────────────────

  'inst.profiel': { nl: 'Jouw profiel', ar: 'ملفك الشخصي', en: 'Your profile' },
  // Een voorbeeldNAAM is geen formaat (anders dan een postcode): hij mag meebewegen met de
  // taal, want zijn enige werk is tonen waar je naam hoort.
  'inst.naamVoorbeeld': { nl: 'Jan de Vries', ar: 'أحمد الحسن', en: 'Jan de Vries' },
  'inst.volledigeNaam': { nl: 'Volledige naam', ar: 'الاسم الكامل', en: 'Full name' },
  'inst.bedrijfsnaam': { nl: 'Bedrijfsnaam', ar: 'اسم الشركة', en: 'Company name' },
  'inst.adres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'inst.postcode': { nl: 'Postcode', ar: 'الرمز البريدي', en: 'Postcode' },
  'inst.stad': { nl: 'Stad', ar: 'المدينة', en: 'City' },
  'inst.stadInvullen': { nl: 'Vul je stad in', ar: 'أدخل مدينتك', en: 'Enter your city' },
  'inst.wachtwoord': { nl: 'Wachtwoord', ar: 'كلمة المرور', en: 'Password' },
  'inst.facturering': { nl: 'Facturering', ar: 'الفوترة', en: 'Billing' },
  'inst.plan': { nl: 'Je plan en je btw-facturen', ar: 'خطتك وفواتير ضريبة القيمة المضافة الخاصة بك', en: 'Your plan and your VAT invoices' },
  'inst.nummering': { nl: 'Factuurnummering', ar: 'ترقيم الفواتير', en: 'Invoice numbering' },
  'inst.kor': { nl: 'Ik gebruik de kleineondernemersregeling (KOR)', ar: 'أستخدم نظام صغار المنشآت (KOR)', en: 'I use the small-business scheme (KOR)' },
  'inst.vrijgesteld': { nl: 'Ik heb (deels) vrijgestelde omzet', ar: 'لدي إيراد مُعفى (جزئيًا)', en: 'I have (partly) exempt turnover' },
  'inst.kasstelsel': { nl: 'Kasstelsel', ar: 'النظام النقدي', en: 'Cash accounting' },
  'inst.factuurstelsel.uitleg': { nl: 'BTW telt op de factuurdatum. De meeste ondernemers gebruiken dit.', ar: 'تُحتسب الضريبة بتاريخ الفاتورة. معظم أصحاب الأعمال يستخدمون هذا.', en: 'VAT counts on the invoice date. Most businesses use this.' },
  'inst.toelichting': { nl: 'Toelichting op je factuur bij 0% of vrijgesteld', ar: 'التوضيح على فاتورتك عند 0% أو الإعفاء', en: 'The note on your invoice at 0% or exempt' },
  'inst.toelichtingVoorbeeld': { nl: 'Vrijgesteld van btw op grond van artikel 11-1-g Wet OB (zorg).', ar: 'مُعفى من الضريبة بموجب المادة 11-1-g من قانون ضريبة المبيعات (رعاية).', en: 'Exempt from VAT under article 11-1-g Wet OB (care).' },
  'inst.herinneringen': { nl: 'Stuur automatisch betalingsherinneringen', ar: 'أرسل تذكيرات الدفع تلقائيًا', en: 'Send payment reminders automatically' },
  // [ZELF-EERST] De autopiloot-schakelaar. De uitleg zegt eerst wat AAN doet en dan wat UIT
  // geeft, omdat uit-zetten hier geen verlies is maar een leerstand: alles eerst zelf zien.
  'inst.autoBoeken': { nl: 'Duidelijke facturen automatisch inboeken', ar: 'قيد الفواتير الواضحة تلقائيًا', en: 'Book clear invoices automatically' },
  'inst.autoBoekenUitleg': { nl: 'Aan: een foutloos gelezen factuur wordt vanzelf geboekt (nooit betaald), altijd terug te draaien. Uit: alles wacht eerst op jouw controle.', ar: 'مفعّل: الفاتورة المقروءة بلا أخطاء تُقيَّد تلقائيًا (لا تُدفع أبدًا)، ويمكن التراجع عنها دائمًا. متوقّف: كل شيء ينتظر تدقيقك أولًا.', en: 'On: a flawlessly read invoice is booked by itself (never paid), always undoable. Off: everything waits for your check first.' },
  'inst.ochtendMail': { nl: 'Ochtendmail over je administratie', ar: 'البريد الصباحي عن إدارتك', en: 'Morning mail about your administration' },
  'inst.ochtendMailUitleg': { nl: 'Eén mail per ochtend, en alleen op dagen dat er iets gebeurde: betalingen die binnenkwamen en nieuwe inkomende facturen.', ar: 'بريد واحد كل صباح، وفقط في الأيام التي حدث فيها شيء: دفعات وصلت وفواتير واردة جديدة.', en: 'One mail each morning, and only on days something happened: payments that came in and new incoming invoices.' },
  'inst.herinnerNa': { nl: 'Herinner na (dagen na vervaldatum)', ar: 'ذكِّر بعد (أيام من تاريخ الاستحقاق)', en: 'Remind after (days past due)' },
  'inst.boekhouder': { nl: 'Jouw boekhouder', ar: 'محاسبك', en: 'Your accountant' },
  'inst.boekhouderKoppelen': { nl: 'Boekhouder koppelen', ar: 'ربط محاسب', en: 'Link an accountant' },
  'inst.ontkoppelen': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Unlink' },
  'inst.team': { nl: 'Team', ar: 'الفريق', en: 'Team' },
  'inst.gevarenzone': { nl: 'Gevarenzone', ar: 'منطقة الخطر', en: 'Danger zone' },
  'inst.accountVerwijderen': { nl: 'Account verwijderen', ar: 'حذف الحساب', en: 'Delete account' },
  'inst.eerstExporteren': { nl: 'Verwijderen is pas mogelijk nadat je je gegevens hebt geëxporteerd.', ar: 'الحذف ممكن فقط بعد تصدير بياناتك.', en: 'Deleting is only possible after you have exported your data.' },

  // ─── [WAARHEID] Het cijferscherm — omzet, kosten, winst, live ───────────────────────────────

  'wh.omzet': { nl: 'Omzet', ar: 'الإيراد', en: 'Turnover' },
  'wh.kosten': { nl: 'Kosten', ar: 'التكاليف', en: 'Costs' },
  'wh.overhouden': { nl: 'Wat je overhoudt', ar: 'ما يتبقّى لك', en: 'What you keep' },
  'wh.overOmzet': { nl: 'Over je omzet', ar: 'على إيرادك', en: 'On your turnover' },
  'wh.overInkopen': { nl: 'Over je inkopen', ar: 'على مشترياتك', en: 'On your purchases' },
  'wh.vorigJaar': { nl: 'Vorig jaar', ar: 'السنة السابقة', en: 'Previous year' },
  'wh.volgendJaar': { nl: 'Volgend jaar', ar: 'السنة التالية', en: 'Next year' },
  'wh.berekenen': { nl: 'Bezig met berekenen…', ar: 'جارٍ الحساب…', en: 'Calculating…' },
  'wh.naarAangifte': { nl: 'Naar de BTW-aangifte van deze periode', ar: 'إلى إقرار ضريبة القيمة المضافة لهذه الفترة', en: "To this period's VAT return" },
  'wh.nogTeDoen': { nl: 'Nog te doen voor een compleet beeld', ar: 'ما بقي لاكتمال الصورة', en: 'Still to do for a complete picture' },
  'wh.teLaag': { nl: 'Tot dan zijn de bedragen hierboven te laag.', ar: 'حتى ذلك الحين المبالغ أعلاه أقل من الحقيقة.', en: 'Until then, the amounts above are too low.' },
  'wh.pinGecontroleerd': { nl: 'Pinbetalingen gecontroleerd', ar: 'مدفوعات البطاقة مُدقَّقة', en: 'Card payments checked' },
  'wh.afrekeningen': { nl: 'Afrekeningen ontvangen', ar: 'كشوف التسوية مستلَمة', en: 'Settlements received' },
  'wh.kostenAutomaat': { nl: 'Kosten van de betaalautomaat', ar: 'تكاليف جهاز الدفع', en: 'Card-terminal costs' },
  'wh.geldTerugMaar': { nl: 'Dit lijkt geld terug, maar', ar: 'يبدو هذا استردادًا، لكن', en: 'This looks like money back, but' },
  'wh.sindsIndiening': { nl: 'Sinds je indiening is de BTW met', ar: 'منذ تقديمك تغيّرت الضريبة بمقدار', en: 'Since your filing, the VAT changed by' },
  'wh.fout.laden': { nl: 'Kon je waarheid niet laden', ar: 'تعذّر تحميل «حقيقتك»', en: 'Could not load your truth' },

  // ─── [BESTANDEN] De bestandenbrowser ────────────────────────────────────────────────────────

  'best.mijn': { nl: 'Mijn bestanden', ar: 'ملفاتي', en: 'My files' },
  'best.mappen': { nl: 'Mappen', ar: 'المجلدات', en: 'Folders' },
  'best.mappenTonen': { nl: 'Mappen tonen', ar: 'إظهار المجلدات', en: 'Show folders' },
  'best.nieuw': { nl: 'Nieuw', ar: 'جديد', en: 'New' },
  'best.nieuweMap': { nl: 'Nieuwe map', ar: 'مجلد جديد', en: 'New folder' },
  'best.uploaden': { nl: 'Bestand uploaden', ar: 'رفع ملف', en: 'Upload a file' },
  'best.uploadenSleep': { nl: 'Bestand uploaden (of sleep een bestand hierheen)', ar: 'ارفع ملفاً (أو اسحبه إلى هنا)', en: 'Upload a file (or drag one here)' },
  'best.gedeeld': { nl: 'Gedeeld', ar: 'مُشارَك', en: 'Shared' },
  'best.prullenbak': { nl: 'Prullenbak', ar: 'سلة المهملات', en: 'Bin' },
  'best.terug': { nl: 'Terug', ar: 'رجوع', en: 'Back' },
  'best.uitklappen': { nl: 'Uitklappen', ar: 'توسيع', en: 'Expand' },
  'best.naamWijzigen': { nl: 'Naam wijzigen', ar: 'إعادة التسمية', en: 'Rename' },

  // ─── [BLAD-GEBAAR] Whose gesture is it — the sheet's, or the document's? ─────────────────────
  //
  // An embedded PDF viewer is its own scroll container: the moment the finger is over it, it takes
  // the gesture and the sheet stops moving. The panel already keeps its two exits outside the
  // scroller so they stay reachable, but that only stopped the wall from HIDING them — it is still
  // a wall, and it appears the moment the document finishes loading.
  //
  // So the document does not take the gesture until it is asked to. These two sentences are the
  // asking, and they are on screen rather than implied: a preview that ignores a tap for reasons
  // the owner cannot see is its own small betrayal.
  'dsh.gebaar.ontgrendel': { nl: 'Tik om in het document te bladeren', ar: 'انقر للتنقّل داخل المستند', en: 'Tap to page through the document' },
  'dsh.gebaar.vergrendel': { nl: 'Klaar met bladeren', ar: 'انتهيت من التصفح', en: 'Done paging' },

  // ─── [NAAM-BIJ-BINNENKOMST] Renaming at the moment the file arrives ──────────────────────────
  //
  // Bestanden has had a rename for a long time; what it did not have was a rename at the ONE
  // moment the name is guaranteed to be useless — a phone camera files IMG_20260819_211723.jpg,
  // and the owner is looking straight at it. Finding it again later means recognising that string
  // among the others.
  'int.naam.aria': { nl: 'Nieuwe bestandsnaam', ar: 'اسم ملف جديد', en: 'New file name' },
  'int.naam.mislukt': {
    nl: 'De naam is niet opgeslagen — het bestand staat nog onder de oude naam in je bestanden.',
    ar: 'لم يُحفظ الاسم — لا يزال الملف بالاسم القديم في ملفاتك.',
    en: 'The name was not saved — the file is still under its old name in your files.',
  },
  'best.leeg': { nl: 'Deze map is leeg', ar: 'هذا المجلد فارغ', en: 'This folder is empty' },
  'best.nogNiets': { nl: 'Nog niets hier', ar: 'لا شيء هنا بعد', en: 'Nothing here yet' },
  'best.nietsGevonden': { nl: 'Niets gevonden', ar: 'لم يُعثر على شيء', en: 'Nothing found' },
  'best.uploadOfMap': { nl: 'Upload een bestand of maak een nieuwe map aan', ar: 'ارفع ملفًا أو أنشئ مجلدًا جديدًا', en: 'Upload a file or create a new folder' },

  // ─── [ZOEKEN] Zoeken door de hele app ───────────────────────────────────────────────────────

  'zoek.alles': { nl: 'Zoek in de hele app — facturen, bestanden, klanten…', ar: 'ابحث في التطبيق كله — فواتير وملفات وعملاء…', en: 'Search the whole app — invoices, files, clients…' },
  'zoek.aria': { nl: 'Zoeken in de hele app', ar: 'البحث في التطبيق كله', en: 'Search the whole app' },
  'zoek.begin': { nl: 'Begin met typen om overal in de app te zoeken.', ar: 'ابدأ الكتابة للبحث في كل التطبيق.', en: 'Start typing to search everywhere in the app.' },
  'zoek.sub': { nl: 'Facturen, bestanden en klanten — op naam, nummer of bedrag.', ar: 'فواتير وملفات وعملاء — بالاسم أو الرقم أو المبلغ.', en: 'Invoices, files and clients — by name, number or amount.' },
  'zoek.geenResultaten': { nl: 'Geen resultaten voor', ar: 'لا نتائج لـ', en: 'No results for' },
  'zoek.probeerAnders': { nl: 'Probeer een andere naam, factuurnummer of bedrag.', ar: 'جرّب اسمًا أو رقم فاتورة أو مبلغًا آخر.', en: 'Try a different name, invoice number or amount.' },
  'zoek.mislukt': { nl: 'Zoeken mislukt', ar: 'فشل البحث', en: 'Search failed' },
  'zoek.verbinding': { nl: 'Controleer je verbinding en probeer het opnieuw.', ar: 'تحقّق من اتصالك وحاول مرة أخرى.', en: 'Check your connection and try again.' },
  'zoek.cat.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'zoek.cat.bestanden': { nl: 'Bestanden', ar: 'الملفات', en: 'Files' },
  'zoek.cat.klanten': { nl: 'Klanten', ar: 'العملاء', en: 'Clients' },
  'zoek.cat.bank': { nl: 'Bankmutaties', ar: 'حركات البنك', en: 'Bank transactions' },
  'zoek.cat.kas': { nl: 'Kasboekingen', ar: 'قيود الصندوق', en: 'Cash entries' },

  // ─── [UPLOAD] De uploadhub ──────────────────────────────────────────────────────────────────

  'up.sleep': { nl: 'Sleep bestanden hierheen', ar: 'اسحب الملفات إلى هنا', en: 'Drag files here' },
  'up.alles': { nl: 'Facturen, bonnen én bankafschriften — alles op één plek. Kies of sleep', ar: 'فواتير وإيصالات وكشوف بنكية — كل شيء في مكان واحد. اختر أو اسحب', en: 'Invoices, receipts and bank statements — all in one place. Choose or drag' },
  'up.eerder': { nl: 'Al eerder geüpload?', ar: 'رُفع سابقًا؟', en: 'Uploaded before?' },
  'up.tochToevoegen': { nl: 'Toch toevoegen — dit is een ander bestand', ar: 'أضِفه رغم ذلك — هذا ملف مختلف', en: 'Add it anyway — this is a different file' },
  'up.nietGelezen': { nl: 'Niet gelezen', ar: 'لم يُقرأ', en: 'Not read' },
  'up.opruimen': { nl: 'Lijst opruimen', ar: 'مسح القائمة', en: 'Clear the list' },
  // [MELDING-WEG] The X on a finished notice — one label for every screen that carries it
  // (the upload hub's rows, Inkomend's results, the bank upload's report).
  'melding.weghalen': { nl: 'Melding weghalen', ar: 'إزالة هذا التنبيه', en: 'Dismiss this notice' },
  // [MELDING-WEG] [TAAL] Where a byte-identical upload already is. The folder names inside {path}
  // are the owner's own folders and stay as stored; the sentence around them is the app's. Came
  // from the server as one Dutch sentence and stood as such on the Arabic screen.
  'up.staatAlIn': { nl: 'Dit bestand staat al in: {path}', ar: 'هذا الملف موجود أصلاً في: {path}', en: 'This file is already in: {path}' },
  'up.alToegevoegdZin': { nl: 'Dit bestand is al toegevoegd', ar: 'هذا الملف أُضيف مسبقاً', en: 'This file has already been added' },
  'up.meerderePaginas': { nl: 'Factuur met meerdere pagina’s?', ar: 'فاتورة متعددة الصفحات؟', en: 'A multi-page invoice?' },
  'up.paginasSamen': { nl: 'Hoort een papieren factuur bij elkaar? Voeg de pagina’s hier samen tot', ar: 'أوراق فاتورة واحدة؟ اجمع الصفحات هنا في', en: 'Pages of one paper invoice? Merge them here into' },
  'up.eenFactuur': { nl: 'Eén factuur, meerdere pagina’s', ar: 'فاتورة واحدة، عدة صفحات', en: 'One invoice, several pages' },
  'up.bekijkBestand': { nl: 'Bekijk bestand', ar: 'عرض الملف', en: 'View the file' },
  // [BESTANDEN-WIJS] Niet "bekijk" maar "waar staat het" — dat is de andere vraag na een upload,
  // en de enige die het scherm tot nu toe met dode tekst beantwoordde.
  'up.wijsInBestanden': {
    nl: 'Toon in Bestanden',
    ar: 'أظهره في الملفات',
    en: 'Show in Files',
  },
  'up.bekijkBestanden': { nl: 'Bekijk in Bestanden', ar: 'عرض في الملفات', en: 'View in Files' },
  'up.naarVerifieren': { nl: 'Naar Te verifiëren', ar: 'إلى «بانتظار التدقيق»', en: 'To the verify queue' },
  'up.mogelijkheden': { nl: 'Bekijk de mogelijkheden', ar: 'اطّلع على الإمكانات', en: 'See what it can do' },

  // ─── [KLANTEN] Het klantenbestand ───────────────────────────────────────────────────────────

  'kl.zoek': { nl: 'Zoek op naam, e-mail, KVK, IBAN...', ar: 'ابحث بالاسم أو البريد أو KVK أو IBAN...', en: 'Search by name, e-mail, KVK, IBAN...' },
  'kl.zoek.aria': { nl: 'Klanten zoeken', ar: 'البحث عن العملاء', en: 'Search clients' },
  'kl.bekijk': { nl: 'Bekijken', ar: 'عرض', en: 'View' },
  // [BESTE] Phone and the agreed payment term on the customer; the open balance on the list.
  'kl.veld.telefoon': { nl: 'Telefoon', ar: 'الهاتف', en: 'Phone' },
  'kl.veld.termijn': { nl: 'Betaaltermijn (dagen)', ar: 'مهلة الدفع (أيام)', en: 'Payment term (days)' },
  // [TARIEF-KLANT] Het tarief van deze klant; vult het lege tariefveld bij zijn uren.
  'kl.veld.uurtarief': { nl: 'Uurtarief (ex btw)', en: 'Hourly rate (ex VAT)', ar: 'تعرفة الساعة (بدون btw)' },
  'uren.tariefVanKlant': { nl: 'Tarief van deze klant ingevuld. Pas het aan als je iets anders afsprak.', en: "This customer's rate filled in. Change it if you agreed something else.", ar: 'تم ملء تعرفة هذا العميل. غيّرها إن اتفقت على غيرها.' },
  'kl.veld.land': { nl: 'Land (code)', ar: 'الدولة (رمز)', en: 'Country (code)' },
  'kl.termijnDagen': { nl: '{days} dagen', ar: '{days} يومًا', en: '{days} days' },
  'kl.open': { nl: '{amount} open', ar: '{amount} مستحق', en: '{amount} open' },
  'kl.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'kl.verwijderd': { nl: 'Klant verwijderd', ar: 'حُذف العميل', en: 'Client deleted' },
  'kl.verwijderenMislukt': { nl: 'Verwijderen lukte niet — de klant staat er nog. Probeer het opnieuw.', ar: 'لم ينجح الحذف — العميل ما يزال موجودًا. حاول مرة أخرى.', en: 'Deleting failed — the client is still there. Try again.' },
  'kl.naamVerplicht': { nl: 'Naam is verplicht', ar: 'الاسم إلزامي', en: 'A name is required' },

  // ─── [BRUG] De brug — het documentenoverzicht per klant/kwartaal ────────────────────────────

  'brug.zoek': { nl: 'Zoek op factuurnummer, leverancier of bedrag…', ar: 'ابحث برقم الفاتورة أو المورّد أو المبلغ…', en: 'Search by invoice number, supplier or amount…' },
  'brug.zoek.aria': { nl: 'Documenten zoeken', ar: 'البحث في المستندات', en: 'Search documents' },
  'brug.leeg': { nl: 'Niets hier', ar: 'لا شيء هنا', en: 'Nothing here' },
  'brug.kiesKlant': { nl: 'Kies een klant om te beginnen', ar: 'اختر عميلًا للبدء', en: 'Choose a client to begin' },
  'brug.alles': { nl: 'Alles', ar: 'الكل', en: 'All' },
  'brug.archief': { nl: 'Toon archief', ar: 'إظهار الأرشيف', en: 'Show archive' },
  'brug.openBestanden': { nl: 'Open in Mijn bestanden', ar: 'افتح في «ملفاتي»', en: 'Open in My files' },
  'brug.cijfersLaden': { nl: 'Cijfers laden…', ar: 'جارٍ تحميل الأرقام…', en: 'Loading figures…' },
  'brug.overzichtLaden': { nl: 'Overzicht laden…', ar: 'جارٍ تحميل النظرة العامة…', en: 'Loading overview…' },
  'brug.fout.cijfers': { nl: 'Cijfers konden niet geladen worden', ar: 'تعذّر تحميل الأرقام', en: 'The figures could not be loaded' },
  'brug.fout.overzicht': { nl: 'Overzicht kon niet geladen worden', ar: 'تعذّر تحميل النظرة العامة', en: 'The overview could not be loaded' },
  'brug.fout.nietCompleet': { nl: 'Wat je hieronder ziet is daarom NIET compleet — een lege map betekent hier niet dat er niets is. Probeer het opnieuw.', ar: 'ما تراه أدناه ليس كاملًا — المجلد الفارغ هنا لا يعني أنه لا شيء فيه. حاول مرة أخرى.', en: 'What you see below is therefore NOT complete — an empty folder here does not mean there is nothing. Try again.' },
  'brug.sluitAan': { nl: 'Niets openstaand — alles sluit aan.', ar: 'لا شيء معلّق — كل شيء متطابق.', en: 'Nothing outstanding — everything reconciles.' },

  // ─── [DAGOMZET] De omzetinzichten ───────────────────────────────────────────────────────────

  'dz.geboekt': { nl: 'Geboekte omzet', ar: 'الإيراد المقيّد', en: 'Booked turnover' },
  'dz.gemiddeld': { nl: 'Gemiddeld per dag', ar: 'المتوسط اليومي', en: 'Average per day' },
  'dz.drukste': { nl: 'Drukste dag', ar: 'أكثر الأيام ازدحامًا', en: 'Busiest day' },
  'dz.opvallend': { nl: 'Opvallende dagen', ar: 'أيام لافتة', en: 'Notable days' },
  'dz.perMaand': { nl: 'Omzet per maand', ar: 'الإيراد الشهري', en: 'Turnover per month' },
  'dz.betaalwijzen': { nl: 'Betaalwijzen', ar: 'طرق الدفع', en: 'Payment methods' },
  'dz.btwVerdeling': { nl: 'BTW-verdeling (aandeel van de netto-omzet)', ar: 'توزيع الضريبة (حصة من صافي الإيراد)', en: 'VAT split (share of net turnover)' },
  'dz.overig': { nl: 'Overig', ar: 'أخرى', en: 'Other' },
  'dz.zeker': { nl: 'Zeker weten?', ar: 'متأكد؟', en: 'Are you sure?' },
  'dz.fout.nietLeeg': { nl: 'Dit is NIET hetzelfde als “nog geen omzet geboekt”. Probeer het opnieuw.', ar: 'هذا ليس كـ«لا إيراد مُسجَّل بعد». حاول مرة أخرى.', en: 'That is NOT the same as “no turnover booked yet”. Try again.' },
  'dz.fout.laden': { nl: 'We konden je geboekte omzet niet laden', ar: 'تعذّر تحميل إيرادك المُسجَّل', en: 'Could not load your booked turnover' },

  // ─── [ARTIKELEN] De artikelcatalogus ────────────────────────────────────────────────────────

  'art.zoek': { nl: 'Zoek op code, omschrijving of bedrag…', ar: 'ابحث بالرمز أو الوصف أو المبلغ…', en: 'Search by code, description or amount…' },
  'art.zoek.aria': { nl: 'Artikelen zoeken', ar: 'البحث في الأصناف', en: 'Search articles' },
  'art.uitleg': { nl: 'Je vaste factuurregels — één keer opslaan, steeds hergebruiken.', ar: 'بنودك الثابتة — احفظها مرة واستعملها دائمًا.', en: 'Your standard invoice lines — save once, reuse always.' },
  // Een voorbeeldomschrijving is als de voorbeeldnaam: hij mag met de taal mee.
  'art.voorbeeld': { nl: 'Transport tafel', ar: 'نقل طاولة', en: 'Table transport' },
  'art.code': { nl: 'Code', ar: 'الرمز', en: 'Code' },
  'art.eenheid': { nl: 'Eenheid', ar: 'الوحدة', en: 'Unit' },
  'art.bewerk': { nl: 'Bewerk', ar: 'عدّل', en: 'Edit' },
  'art.verwijder': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'art.prijsNegatief': { nl: 'Prijs moet 0 of hoger zijn.', ar: 'يجب أن يكون السعر 0 أو أكثر.', en: 'The price must be 0 or higher.' },

  // ─── [KLAAR] Ben ik klaar? — de kwartaalscore ───────────────────────────────────────────────

  'klr.titel': { nl: 'Ben ik klaar?', ar: 'هل أنا جاهز؟', en: 'Am I ready?' },
  'klr.watNog': { nl: 'Wat moet er nog gebeuren', ar: 'ما الذي يجب فعله بعد', en: 'What still needs doing' },
  'klr.waarop': { nl: 'Waar de score op gebaseerd is', ar: 'علامَ تُبنى النتيجة', en: 'What the score is based on' },
  'klr.evenControleren': { nl: 'Even controleren', ar: 'تحقّق سريع', en: 'A quick check' },
  'klr.conceptAangifte': { nl: 'Bekijk de concept-aangifte', ar: 'عرض مسودة الإقرار', en: 'View the draft return' },
  'klr.fout.zegtNiets': { nl: 'Dit zegt NIETS over of je klaar bent — we konden het alleen niet controleren.', ar: 'هذا لا يقول شيئًا عن جاهزيتك — لم نستطع الفحص فحسب.', en: 'This says NOTHING about whether you are ready — we just could not check.' },
  'klr.fout.status': { nl: 'Kon de status niet laden', ar: 'تعذّر تحميل الحالة', en: 'Could not load the status' },

  // ─── [ONBOARDING] De eerste drie minuten van elke eigenaar ──────────────────────────────────
  // Dit is het scherm waar de Arabische ondernemer uit de blogfunnel als eerste landt na de
  // registratie. De belofte "in 3 minuten" moet in zijn eigen taal staan, of hij is weg.

  'onb.wie': { nl: 'Wie ben jij?', ar: 'مَن أنت؟', en: 'Who are you?' },
  'onb.aanpassen': { nl: 'We passen BoekBrug aan op jouw situatie.', ar: 'نكيّف BoekBrug حسب وضعك.', en: 'We adapt BoekBrug to your situation.' },
  'onb.zzp': { nl: "Ik ben ZZP'er", ar: 'أنا صاحب عمل مستقل', en: 'I am self-employed' },
  'onb.boekhouder': { nl: 'Ik ben boekhouder', ar: 'أنا محاسب', en: 'I am an accountant' },
  'onb.drieMinuten': { nl: 'Laten we je account in 3 minuten instellen.', ar: 'لنجهّز حسابك في 3 دقائق.', en: "Let's set up your account in 3 minutes." },
  'onb.jouwBedrijf': { nl: 'Jouw bedrijf', ar: 'شركتك', en: 'Your business' },
  'onb.jouwKantoor': { nl: 'Jouw kantoor', ar: 'مكتبك', en: 'Your office' },
  'onb.bedrijfsnaam': { nl: 'Wat is je bedrijfsnaam?', ar: 'ما اسم شركتك؟', en: 'What is your company name?' },
  'onb.kantoornaam': { nl: 'Naam van je kantoor', ar: 'اسم مكتبك', en: 'The name of your office' },
  'onb.kvk': { nl: 'Wat is je KVK-nummer? (optioneel)', ar: 'ما رقم KVK الخاص بك؟ (اختياري)', en: 'What is your KVK number? (optional)' },
  'onb.kvkKantoor': { nl: 'KVK-nummer van je kantoor (optioneel)', ar: 'رقم KVK لمكتبك (اختياري)', en: "Your office's KVK number (optional)" },
  'onb.btw': { nl: 'Wat is je BTW-nummer? (nodig om facturen te versturen)', ar: 'ما رقم btw؟ (مطلوب لإرسال الفواتير)', en: 'What is your VAT number? (needed to send invoices)' },
  'onb.iban': { nl: 'Wat is je IBAN? (voor betaalverzoeken)', ar: 'ما هو IBAN الخاص بك؟ (لطلبات الدفع)', en: 'What is your IBAN? (for payment requests)' },
  'onb.adres': { nl: 'Wat is je adres? (nodig om facturen te versturen)', ar: 'ما عنوانك؟ (مطلوب لإرسال الفواتير)', en: 'What is your address? (needed to send invoices)' },
  'onb.alleenNaam': { nl: 'Alleen de naam is nodig — de rest kun je later aanpassen.', ar: 'الاسم وحده يكفي — الباقي يمكن تعديله لاحقًا.', en: 'Only the name is needed — the rest can be changed later.' },
  'onb.naamVerplicht': { nl: 'Vul je bedrijfsnaam in om verder te gaan.', ar: 'أدخل اسم شركتك للمتابعة.', en: 'Enter your company name to continue.' },
  'onb.kantoorVerplicht': { nl: 'Vul de naam van je kantoor in om verder te gaan.', ar: 'أدخل اسم مكتبك للمتابعة.', en: "Enter your office's name to continue." },
  'onb.nummer': { nl: 'Met welk factuurnummer wil je beginnen?', ar: 'بأي رقم فاتورة تريد البدء؟', en: 'Which invoice number do you want to start with?' },
  'onb.volgendNummer': { nl: 'Je volgende factuurnummer', ar: 'رقم فاتورتك التالي', en: 'Your next invoice number' },
  // Full sentence with the number as data — the old half-key left ' te beginnen.' hard-coded
  // in the wizard, a split no other word order survives.
  'onb.laatLeeg': { nl: 'Laat leeg om bij {number} te beginnen.', ar: 'اتركه فارغًا للبدء من {number}.', en: 'Leave empty to start at {number}.' },
  'onb.gmail': { nl: 'Wil je je Gmail koppelen?', ar: 'أتريد ربط Gmail؟', en: 'Do you want to connect your Gmail?' },
  'onb.gmailJa': { nl: 'Ja, koppel mijn Gmail', ar: 'نعم، اربط Gmail', en: 'Yes, connect my Gmail' },
  'onb.gmailOpen': { nl: 'Gmail openen…', ar: 'جارٍ فتح Gmail…', en: 'Opening Gmail…' },
  'onb.gmailGelukt': { nl: 'Gmail succesvol gekoppeld!', ar: 'رُبط Gmail بنجاح!', en: 'Gmail connected!' },
  'onb.importeren': { nl: 'We importeren automatisch je facturen.', ar: 'نستورد فواتيرك تلقائياً.', en: 'We import your invoices automatically.' },
  'onb.importerenNiks': { nl: 'We importeren automatisch je facturen. Jij hoeft niets te doen.', ar: 'نستورد فواتيرك تلقائيًا. لا شيء عليك فعله.', en: 'We import your invoices automatically. Nothing for you to do.' },
  'onb.importerenAchtergrond': { nl: 'We importeren je facturen automatisch op de achtergrond.', ar: 'نستورد فواتيرك تلقائيًا في الخلفية.', en: 'We import your invoices automatically in the background.' },
  'onb.eersteKlant': { nl: 'Voeg je eerste klant toe', ar: 'أضف عميلك الأول', en: 'Add your first client' },
  'onb.klantEmail': { nl: 'E-mailadres klant', ar: 'البريد الإلكتروني للعميل', en: "Client's e-mail address" },
  'onb.boekhouderEmail': { nl: 'E-mailadres boekhouder', ar: 'البريد الإلكتروني للمحاسب', en: "Accountant's e-mail address" },
  'onb.hebBoekhouder': { nl: 'Heb je een boekhouder?', ar: 'ألديك محاسب؟', en: 'Do you have an accountant?' },
  'onb.klantMail': { nl: 'Je klant ontvangt een e-mail om zijn account aan te maken.', ar: 'سيصل عميلك بريد لإنشاء حسابه.', en: 'Your client gets an e-mail to create their account.' },
  'onb.slaOver': { nl: 'Sla over', ar: 'تخطّي', en: 'Skip' },
  'onb.slaOverLater': { nl: 'Tik op “Sla over” om dit later in te stellen', ar: 'اضغط «تخطّي» لضبط هذا لاحقًا', en: 'Tap “Skip” to set this up later' },
  'onb.volgende': { nl: 'Volgende', ar: 'التالي', en: 'Next' },
  'onb.naarDashboard': { nl: 'Ga naar mijn dashboard', ar: 'اذهب إلى لوحتي', en: 'Go to my dashboard' },
  'onb.autoVerder': { nl: 'Of wacht even, je gaat automatisch verder…', ar: 'أو انتظر قليلًا وستنتقل تلقائيًا…', en: 'Or wait a moment — you continue automatically…' },
  'onb.opnieuw': { nl: 'Opnieuw beginnen', ar: 'البدء من جديد', en: 'Start over' },
  'onb.opnieuwVraag': { nl: 'Opnieuw beginnen?', ar: 'البدء من جديد؟', en: 'Start over?' },
  'onb.opnieuwUitleg': { nl: 'Je ingevoerde gegevens worden gewist. Gmail blijft gekoppeld.', ar: 'ستُمسح بياناتك المُدخلة. يبقى Gmail مربوطًا.', en: 'Your entered details are cleared. Gmail stays connected.' },
  // One sentence, fields as data. Names the Instellingen screen as its nav label is written
  // per language — the owner must be able to find the word on screen.
  'onb.vulNog': {
    nl: 'Vul nog {fields} in bij Instellingen — dat is wettelijk verplicht op een factuur. Zonder deze gegevens kun je nog geen factuur versturen.',
    ar: 'أكمل إدخال {fields} في «الإعدادات» — فهذه البيانات إلزامية قانونًا على الفاتورة. من دونها لا يمكنك إرسال فواتير بعد.',
    en: 'Still fill in {fields} under Settings — legally required on an invoice. Without these you cannot send invoices yet.',
  },

  // ─── [INTAKE] De bon/factuur-knop op het startscherm ────────────────────────────────────────

  'int.toevoegen': { nl: 'Bon of factuur toevoegen', ar: 'إضافة إيصال أو فاتورة', en: 'Add a receipt or invoice' },
  'int.fotograferen': { nl: 'Bon of factuur fotograferen', ar: 'تصوير إيصال أو فاتورة', en: 'Photograph a receipt or invoice' },
  'int.fotoMaken': { nl: 'Foto maken', ar: 'التقاط صورة', en: 'Take a photo' },
  'int.bestand': { nl: 'Bestand uploaden', ar: 'رفع ملف', en: 'Upload a file' },
  'int.pdfBeeld': { nl: 'PDF, afbeelding of bankafschrift', ar: 'PDF أو صورة أو كشف بنكي', en: 'PDF, image or bank statement' },
  'int.watToegevoegd': { nl: 'Wat is er toegevoegd', ar: 'ما الذي أُضيف', en: 'What was added' },
  'int.drieBezig': { nl: 'Even wachten — er worden er al drie verwerkt.', ar: 'انتظر قليلًا — هناك ثلاثة قيد المعالجة بالفعل.', en: 'One moment — three are already being processed.' },
  // [INTAKE-VOORTGANG] The progress dialog after a file is picked. Three phases, one percentage:
  // only the upload has a number; the fit and the read say what they are without inventing one.
  'int.voortgang.titel': { nl: 'Bezig met toevoegen', ar: 'جارٍ الإضافة', en: 'Adding…' },
  'int.voortgang.klaarTitel': { nl: 'Klaar', ar: 'جاهز', en: 'Done' },
  'int.voortgang.sluit': { nl: 'Sluiten — het toevoegen gaat door', ar: 'إغلاق — تستمر الإضافة', en: 'Close — adding carries on' },
  'int.voortgang.achtergrond': {
    nl: 'Je kunt dit sluiten. Het toevoegen gaat gewoon door, en je hoort waar het bestand terechtkomt.',
    ar: 'يمكنك إغلاق هذه النافذة. تستمر الإضافة في الخلفية، وستُخبَر أين استقرّ الملف.',
    en: 'You can close this. Adding carries on, and you will be told where the file landed.',
  },
  'int.voortgang.klaarmaken': { nl: 'Bestand wordt klaargemaakt…', ar: 'يجري تجهيز الملف…', en: 'Preparing the file…' },
  'int.voortgang.uploaden': { nl: 'Uploaden… {p}%', ar: 'جارٍ الرفع… {p}%', en: 'Uploading… {p}%' },
  'int.voortgang.lezen': { nl: 'Wordt gelezen — dit kan even duren', ar: 'جارٍ القراءة — قد يستغرق ذلك قليلًا', en: 'Being read — this can take a moment' },
  'int.voortgang.klaar': { nl: 'Klaar', ar: 'جاهز', en: 'Done' },
  'int.voortgang.mislukt': { nl: 'Niet gelukt', ar: 'لم ينجح', en: 'Did not succeed' },
  'int.bestaande': { nl: 'Bekijk de bestaande factuur', ar: 'عرض الفاتورة الموجودة', en: 'View the existing invoice' },
  'int.tochAndere': { nl: 'Toch toevoegen — dit is een andere factuur', ar: 'أضِفها رغم ذلك — هذه فاتورة أخرى', en: 'Add it anyway — this is a different invoice' },
  'int.paginasSamen': { nl: 'Meerdere pagina’s → samen één factuur', ar: 'عدة صفحات ← فاتورة واحدة معاً', en: 'Several pages → one invoice together' },
  'int.kiesFotos': { nl: 'Kies foto’s van de pagina’s', ar: 'اختر صور الصفحات', en: 'Choose photos of the pages' },
  'int.teruggezet': { nl: 'Teruggezet — staat weer in je controlewachtrij ✓', ar: 'أُعيدت — عادت إلى قائمة المراجعة لديك ✓', en: 'Put back — in your review queue again ✓' },
  'int.fout.terugzetten': { nl: 'Terugzetten mislukt — controleer je verbinding', ar: 'فشلت الإعادة — تحقّق من اتصالك', en: 'Putting back failed — check your connection' },
  'int.fout.toevoegen': { nl: 'Toevoegen mislukt — probeer opnieuw', ar: 'فشلت الإضافة — حاول مرة أخرى', en: 'Adding failed — please try again' },
  'int.terug': { nl: 'Terug', ar: 'رجوع', en: 'Back' },

  // ─── [DAGOMZET-IMPORT] Het inlezen van omzetbestanden ───────────────────────────────────────

  'dzi.goedkeuren': { nl: 'Goedkeuren', ar: 'موافقة', en: 'Approve' },
  'dzi.afwijzen': { nl: 'Afwijzen', ar: 'رفض', en: 'Reject' },
  'dzi.dagen': { nl: 'Dagen', ar: 'الأيام', en: 'Days' },
  'dzi.uitgaven': { nl: 'Uitgaven', ar: 'المصروفات', en: 'Spending' },
  'dzi.omzetIncl': { nl: 'Omzet incl.', ar: 'الإيراد شامل btw', en: 'Turnover incl.' },
  'dzi.totaleOmzet': { nl: 'Totale omzet (incl.)', ar: 'إجمالي الإيراد (شامل btw)', en: 'Total turnover (incl.)' },
  'dzi.geenDagen': { nl: 'Geen dagen met omzet gevonden in dit bestand.', ar: 'لم يُعثر في هذا الملف على أيام ذات إيراد.', en: 'No days with turnover found in this file.' },
  'dzi.fout.bestand': { nl: 'Er ging iets mis bij het lezen van het bestand', ar: 'حدث خطأ أثناء قراءة الملف', en: 'Something went wrong reading the file' },
  'dzi.fout.grootboek': { nl: 'Er ging iets mis bij het lezen van het grootboek', ar: 'حدث خطأ أثناء قراءة دفتر الأستاذ', en: 'Something went wrong reading the ledger' },
  'dzi.fout.opslaan': { nl: 'Opslaan mislukt', ar: 'فشل الحفظ', en: 'Saving failed' },

  // ─── [CATEGORISEREN] Banktransacties een categorie geven ────────────────────────────────────

  'cat.zoek': { nl: 'Zoek op tegenpartij, omschrijving of bedrag…', ar: 'ابحث بالطرف الآخر أو الوصف أو المبلغ…', en: 'Search by counterparty, description or amount…' },
  'cat.klaar': { nl: 'Alles is gecategoriseerd', ar: 'كل شيء مصنَّف', en: 'Everything is categorised' },
  'cat.geenAandacht': { nl: 'Geen transacties die nog aandacht nodig hebben.', ar: 'لا توجد معاملات تحتاج إلى انتباه بعد.', en: 'No transactions still needing attention.' },
  'cat.nogNiets': { nl: 'Nog niets ingevuld', ar: 'لا شيء مُدخل بعد', en: 'Nothing filled in yet' },
  'cat.zodra': { nl: 'Zodra je transacties een categorie geeft, kun je ze hier wijzigen.', ar: 'حين تعطي معاملاتك تصنيفًا، تستطيع تعديلها هنا.', en: 'Once you categorise transactions, you can change them here.' },
  'cat.vernieuw': { nl: 'Vernieuw de pagina om de volgende te zien.', ar: 'حدّث الصفحة لرؤية التالية.', en: 'Refresh the page to see the next one.' },
  'cat.fout.laden': { nl: 'We konden de banktransacties niet laden. Probeer het opnieuw.', ar: 'تعذّر تحميل معاملات البنك. حاول مرة أخرى.', en: 'Could not load the bank transactions. Try again.' },
  // [ZELFDE-TEGENPARTIJ] One answer reaches the other lines of the same party. Said out loud,
  // because a screen that silently changes rows the owner did not look at is the surprise this
  // whole feature was written to avoid.
  'cat.ookToegepast': {
    nl: 'Ook toegepast op {n} andere regels van dezelfde tegenpartij.',
    ar: 'طُبّق أيضًا على {n} أسطر أخرى للطرف نفسه.',
    en: 'Also applied to {n} other lines from the same counterparty.',
  },
  'cat.ookToegepastEen': {
    nl: 'Ook toegepast op één andere regel van dezelfde tegenpartij.',
    ar: 'طُبّق أيضًا على سطر واحد آخر للطرف نفسه.',
    en: 'Also applied to one other line from the same counterparty.',
  },
  'cat.fout.opslaan': { nl: 'Deze transactie kon niet worden opgeslagen. Probeer het opnieuw.', ar: 'تعذّر حفظ هذه المعاملة. حاول مرة أخرى.', en: 'This transaction could not be saved. Try again.' },
  'cat.fout.automatisch': { nl: 'De automatische verwerking is niet gelukt. Probeer het opnieuw.', ar: 'لم تنجح المعالجة التلقائية. حاول مرة أخرى.', en: 'Automatic processing did not work. Try again.' },

  // ─── [VRAGEN] Vragen van je boekhouder ──────────────────────────────────────────────────────

  'vr.geen': { nl: 'Geen openstaande vragen', ar: 'لا أسئلة معلّقة', en: 'No open questions' },
  // [VOORSTEL] The accountant's correction proposal, on the client's questions screen.
  'vr.voorstel.titel': { nl: 'Correctievoorstel van je boekhouder', ar: 'اقتراح تصحيح من محاسبك', en: 'Correction proposed by your accountant' },
  'vr.voorstel.uitleg': { nl: 'Bij akkoord past de app de factuur zo aan.', ar: 'عند الموافقة، يعدّل التطبيق الفاتورة هكذا.', en: 'On approval the app changes the invoice like this.' },
  'vr.voorstel.akkoord': { nl: 'Akkoord', ar: 'موافق', en: 'Approve' },
  'vr.voorstel.nietAkkoord': { nl: 'Niet akkoord', ar: 'غير موافق', en: 'Decline' },
  'vr.voorstel.klaar': { nl: 'Aangepast. Je boekhouder krijgt bericht.', ar: 'تم التعديل. سيتلقى محاسبك إشعارًا.', en: 'Changed. Your accountant has been told.' },
  'vr.voorstel.afgewezen': { nl: 'Afgewezen. De factuur blijft zoals hij was.', ar: 'مرفوض. تبقى الفاتورة كما كانت.', en: 'Declined. The invoice stays as it was.' },
  'vr.voorstel.verouderd': { nl: 'De factuur is intussen veranderd; dit voorstel vervalt.', ar: 'تغيّرت الفاتورة في هذه الأثناء؛ يسقط هذا الاقتراح.', en: 'The invoice changed meanwhile; this proposal lapses.' },
  'vr.voorstel.fout': { nl: 'Dat lukte niet. Probeer het opnieuw.', ar: 'لم ينجح ذلك. حاول مجددًا.', en: 'That did not work. Try again.' },
  'vr.voorstel.veld.exBtw': { nl: 'Excl. btw', ar: 'بدون الضريبة', en: 'Excl. VAT' },
  'vr.voorstel.veld.btw': { nl: 'Btw', ar: 'الضريبة', en: 'VAT' },
  'vr.voorstel.veld.inc': { nl: 'Totaal', ar: 'الإجمالي', en: 'Total' },
  'vr.voorstel.veld.datum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'vr.voorstel.veld.vervalt': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'vr.jouwAntwoord': { nl: 'Jouw antwoord', ar: 'جوابك', en: 'Your answer' },
  'vr.voorbeeld': { nl: 'Bijvoorbeeld: die bon zit in de map van juni, ik stuur hem vandaag.', ar: 'مثلًا: ذلك الإيصال في مجلد يونيو، سأرسله اليوم.', en: 'For example: that receipt is in the June folder, I will send it today.' },
  'vr.verstuurd': { nl: 'Je antwoord is verstuurd', ar: 'أُرسل جوابك', en: 'Your answer was sent' },
  'vr.misBon': { nl: 'Mist er een bon?', ar: 'هل هناك إيصال مفقود؟', en: 'Missing a receipt?' },
  'vr.voegToe': { nl: 'Voeg hem toe — de app sorteert hem', ar: 'أضِفه — والتطبيق يرتّبه', en: 'Add it — the app sorts it' },
  'vr.fout.ophalen': { nl: 'Kon je vragen niet ophalen', ar: 'تعذّر جلب أسئلتك', en: 'Could not fetch your questions' },

  // ─── [TEAM] Wie mag er factureren ───────────────────────────────────────────────────────────

  'team.titel': { nl: 'Team', ar: 'الفريق', en: 'Team' },
  'team.email': { nl: 'E-mailadres van de medewerker', ar: 'البريد الإلكتروني للموظف', en: "The employee's e-mail address" },
  'team.magFactureren': { nl: 'Mag facturen maken', ar: 'يحق له إنشاء فواتير', en: 'May create invoices' },
  'team.niemand': { nl: 'Niemand. Alleen jij maakt facturen voor je bedrijf.', ar: 'لا أحد. أنت وحدك تُنشئ فواتير شركتك.', en: 'Nobody. Only you create invoices for your business.' },
  'team.nietGeaccepteerd': { nl: 'Nog niet geaccepteerd', ar: 'لم يُقبل بعد', en: 'Not yet accepted' },
  'team.intrekken': { nl: 'Intrekken', ar: 'سحب التفويض', en: 'Revoke' },
  'team.eerder': { nl: 'Eerder', ar: 'سابقًا', en: 'Previously' },
  'team.nietAan': { nl: 'De teamfunctie staat nog niet aan.', ar: 'ميزة الفريق ليست مفعّلة بعد.', en: 'The team feature is not on yet.' },

  // ─── [PRULLENBAK] ───────────────────────────────────────────────────────────────────────────

  'prul.titel': { nl: 'Prullenbak', ar: 'سلة المهملات', en: 'Bin' },
  'prul.leeg': { nl: 'Prullenbak is leeg', ar: 'سلة المهملات فارغة', en: 'The bin is empty' },
  'prul.verschijnen': { nl: 'Verwijderde bestanden verschijnen hier', ar: 'تظهر هنا الملفات المحذوفة', en: 'Deleted files appear here' },
  'prul.herstellen': { nl: 'Herstellen', ar: 'استعادة', en: 'Restore' },
  'prul.permanent': { nl: 'Permanent verwijderen', ar: 'حذف نهائي', en: 'Delete permanently' },
  'prul.legen': { nl: 'Prullenbak legen', ar: 'إفراغ السلة', en: 'Empty the bin' },
  'prul.selectieWissen': { nl: 'Selectie wissen', ar: 'مسح التحديد', en: 'Clear the selection' },

  // ─── [AANGIFTE] De concept-aangifte ─────────────────────────────────────────────────────────
  // De RUBRIEKnamen zelf (5a, 3b) zijn Belastingdienst-terminologie en blijven letterlijk; de
  // zinnen eromheen bewegen mee.

  'aang.rubriek': { nl: 'Rubriek', ar: 'البند', en: 'Section' },
  'aang.omzet': { nl: 'Omzet', ar: 'الإيراد', en: 'Turnover' },
  'aang.5a': { nl: '5a · Verschuldigde omzetbelasting', ar: '5a · ضريبة المبيعات المستحقة', en: '5a · VAT owed' },
  'aang.5b': { nl: '5b · Voorbelasting', ar: '5b · ضريبة المشتريات', en: '5b · Input VAT' },
  'aang.5g.betalen': { nl: '5g · Concept te betalen', ar: '5g · مسودة: للدفع', en: '5g · Draft: to pay' },
  'aang.5g.terug': { nl: '5g · Concept terug te ontvangen', ar: '5g · مسودة: للاسترداد', en: '5g · Draft: to receive back' },
  'aang.ingediendOnbekend': {
    nl: 'We konden niet zien of dit kwartaal al is ingediend. Ververs de pagina voordat je iets wijzigt.',
    ar: 'لم نتمكن من معرفة ما إذا كان هذا الربع قد قُدِّم. أعد تحميل الصفحة قبل أن تغيّر شيئًا.',
    en: 'We could not see whether this quarter has already been filed. Refresh the page before you change anything.',
  },
  'aang.totaal3b': { nl: 'Totaal · gelijk aan 3b', ar: 'الإجمالي · يساوي 3b', en: 'Total · equals 3b' },
  'aang.icp': { nl: 'ICP-opgaaf · aparte aangifte', ar: 'إقرار ICP · إقرار منفصل', en: 'ICP statement · separate filing' },
  'aang.waarop': { nl: 'Waar dit op gebaseerd is', ar: 'علامَ يُبنى هذا', en: 'What this is based on' },
  // [KOR-AANGIFTE-UIT] The panel that stands where the table stood, for an owner in the KOR.
  'aang.kor.titel': { nl: 'KOR actief — geen btw-aangifte', ar: 'KOR نشط — لا إقرار btw', en: 'KOR active — no VAT return' },
  'aang.kor.uitleg': {
    nl: 'Onder de KOR reken je geen btw en trek je geen btw af. De rubrieken staan daarom uit.',
    ar: 'ضمن KOR لا تحسب btw ولا تخصمها. لذلك البنود مطفأة.',
    en: 'Under the KOR you charge no VAT and deduct none. The boxes are therefore switched off.',
  },
  'aang.kor.toch': { nl: 'Toch aan te geven dit kwartaal', ar: 'يجب الإقرار به رغم ذلك هذا الربع', en: 'Still to be declared this quarter' },
  'aang.kor.niets': { nl: 'Niets aan te geven dit kwartaal.', ar: 'لا شيء للإقرار به هذا الربع.', en: 'Nothing to declare this quarter.' },
  'aang.kor.aanvragen': {
    nl: 'Krijg je geen aangifte voor dit tijdvak, vraag die dan aan bij de Belastingdienst.',
    ar: 'إن لم يصلك إقرار لهذه الفترة، فاطلبه من Belastingdienst.',
    en: 'If you receive no return for this period, request one from the Belastingdienst.',
  },
  'aang.verschil': { nl: 'Bekijk het verschil op Waarheid', ar: 'عرض الفرق في «حقيقتك»', en: 'View the difference on Truth' },
  // [TAAL] `aang.jeHebt` was een half zinsdeel: het scherm plakte er `'te betalen'` of
  // `'terug te ontvangen'` achter als letterlijke tekst. Dat werkt in het Nederlands en breekt
  // in het Arabisch (woordvolgorde en congruentie) en het Turks (naamvalsuffixen) — en de helft
  // die niet in de catalogus staat blijft in élke taal Nederlands. Elke zin heeft nu een eigen
  // sleutel, met de richting erin verwerkt in plaats van erachter geplakt.
  'aang.jeHebt': { nl: 'Je hebt', ar: 'لديك', en: 'You have' },
  'aang.ingediend.titel': {
    nl: 'Dit kwartaal is al ingediend ({datum})',
    ar: 'تم تقديم هذا الربع بالفعل ({datum})',
    en: 'This quarter has already been filed ({datum})',
  },
  'aang.ingediend.gelijk.betalen': {
    nl: 'De berekening hieronder komt (nog) precies overeen met wat je hebt ingediend: 5g {bedrag} te betalen.',
    ar: 'الحساب أدناه ما زال مطابقًا تمامًا لما قدّمته: 5g {bedrag} مستحقّة الدفع.',
    en: 'The calculation below still matches exactly what you filed: 5g {bedrag} payable.',
  },
  'aang.ingediend.gelijk.terug': {
    nl: 'De berekening hieronder komt (nog) precies overeen met wat je hebt ingediend: 5g {bedrag} terug te ontvangen.',
    ar: 'الحساب أدناه ما زال مطابقًا تمامًا لما قدّمته: 5g {bedrag} مستحقّة الاسترداد.',
    en: 'The calculation below still matches exactly what you filed: 5g {bedrag} refundable.',
  },
  'aang.ingediend.aangifte.betalen': {
    nl: 'Je hebt {bedrag} te betalen ingediend.',
    ar: 'قدّمت إقرارًا بمبلغ {bedrag} مستحقّ الدفع.',
    en: 'You filed {bedrag} payable.',
  },
  'aang.ingediend.aangifte.terug': {
    nl: 'Je hebt {bedrag} terug te ontvangen ingediend.',
    ar: 'قدّمت إقرارًا بمبلغ {bedrag} مستحقّ الاسترداد.',
    en: 'You filed {bedrag} refundable.',
  },
  'aang.ingediend.verschil.bij': {
    nl: 'Met je huidige gegevens komt daar {bedrag} bij — de cijfers hieronder zijn de HUIDIGE berekening, niet je aangifte.',
    ar: 'ببياناتك الحالية يُضاف إلى ذلك {bedrag} — الأرقام أدناه هي الحساب الحالي، وليست إقرارك.',
    en: 'With your current data {bedrag} is added — the figures below are the CURRENT calculation, not your filing.',
  },
  'aang.ingediend.verschil.af': {
    nl: 'Met je huidige gegevens gaat daar {bedrag} af — de cijfers hieronder zijn de HUIDIGE berekening, niet je aangifte.',
    ar: 'ببياناتك الحالية يُخصم من ذلك {bedrag} — الأرقام أدناه هي الحساب الحالي، وليست إقرارك.',
    en: 'With your current data {bedrag} comes off — the figures below are the CURRENT calculation, not your filing.',
  },
  'aang.ingediend.beslis': {
    nl: 'Wat je daarmee doet (verrekenen of een suppletie) beslis je op de Waarheid-pagina.',
    ar: 'ما تفعله بذلك (مقاصّة أو إقرار تكميلي) تقرّره في صفحة «حقيقتك».',
    en: 'What you do with it (offset or a suppletie) you decide on the Truth page.',
  },
  // Het zelfstandig naamwoord is geen parameter — zie AGENTS.md. Twee sleutels, twee hele zinnen.
  'aang.ic.factuurEen': { nl: '{btw} · 1 factuur', ar: '{btw} · فاتورة واحدة', en: '{btw} · 1 invoice' },
  'aang.ic.factuurMeer': { nl: '{btw} · {aantal} facturen', ar: '{btw} · {aantal} فواتير', en: '{btw} · {aantal} invoices' },
  // [ZELF-INDIENEN] De conceptbanner, opgesplitst. De eerste zin geldt altijd; de tweede hangt
  // ervan af of er een boekhouder gekoppeld is — en die stond er tot nu toe onvoorwaardelijk,
  // waardoor een ondernemer zónder boekhouder las dat iemand anders zijn aangifte zou indienen.
  // Twee hele zinnen, geen zin met een gat erin: welke van de twee er staat verandert wie er iets
  // moet doen, en dat overleeft geen woordvolgorde-substitutie.
  'aang.concept': {
    nl: 'Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte.',
    ar: 'هذه مسودة مبنية على البيانات التي أدخلتها — وليست إقرارًا مُقدَّمًا.',
    en: 'This is a DRAFT based on the data you entered — not a filed return.',
  },
  'aang.conceptBoekhouder': {
    nl: 'Je boekhouder controleert en dient in.',
    ar: 'محاسبك يراجعه ويقدّمه.',
    en: 'Your accountant checks it and files it.',
  },
  'aang.conceptZelf': {
    nl: 'Je dient hem zelf in bij de Belastingdienst — hieronder staat hoe.',
    ar: 'أنت تقدّمه بنفسك إلى مصلحة الضرائب — الخطوات في الأسفل.',
    en: 'You file it yourself with the Belastingdienst — the steps are below.',
  },
  // [ZELF-INDIENEN] De laatste meter, in drie stappen. De rubrieknummers staan er letterlijk in
  // omdat ze letterlijk overgenomen worden: de tabel op ditzelfde scherm draagt dezelfde nummers,
  // en het formulier van de Belastingdienst ook.
  'aang.zelf.titel': { nl: 'Zelf indienen — zo doe je dat', ar: 'التقديم بنفسك — إليك الطريقة', en: 'Filing it yourself — how' },
  'aang.zelf.stap1': {
    nl: 'Log in op Mijn Belastingdienst Zakelijk via',
    ar: 'سجّل الدخول إلى Mijn Belastingdienst Zakelijk عبر',
    en: 'Log in to Mijn Belastingdienst Zakelijk via',
  },
  'aang.zelf.stap2': {
    nl: 'Neem de bedragen hieronder rubriek voor rubriek over — 1a, 1b, 5b en 5g staan er precies zo op het formulier.',
    ar: 'انقل المبالغ أدناه بندًا بندًا — البنود 1a و1b و5b و5g مكتوبة في النموذج بالطريقة نفسها.',
    en: 'Copy the amounts below box by box — 1a, 1b, 5b and 5g appear on the form exactly as they do here.',
  },
  'aang.zelf.stap3': {
    nl: 'Verstuur de aangifte daar, en betaal of ontvang het saldo van 5g.',
    ar: 'أرسل الإقرار هناك، ثم ادفع رصيد 5g أو استلمه.',
    en: 'Submit the return there, then pay or receive the 5g balance.',
  },
  'aang.zelf.markeer': {
    nl: 'Klaar? Markeer dit kwartaal als ingediend',
    ar: 'انتهيت؟ علّم هذا الربع كمُقدَّم',
    en: 'Done? Mark this quarter as filed',
  },
  // [DEADLINE] Drie hele zinnen, want ze zeggen drie verschillende dingen tegen iemand die moet
  // handelen. "nog 0 dagen" en "vandaag" zijn hetzelfde feit en maar één ervan zet iemand in
  // beweging, dus vandaag heeft zijn eigen zin.
  'aang.deadline.nog': {
    nl: 'Indienen vóór {datum} — nog {dagen} dagen.',
    ar: 'يجب التقديم قبل {datum} — بقي {dagen} يومًا.',
    en: 'File before {datum} — {dagen} days left.',
  },
  'aang.deadline.vandaag': {
    nl: 'Vandaag is de laatste dag om dit kwartaal in te dienen.',
    ar: 'اليوم آخر يوم لتقديم هذا الربع.',
    en: 'Today is the last day to file this quarter.',
  },
  'aang.deadline.voorbij': {
    nl: 'De uiterste datum ({datum}) is voorbij en dit kwartaal staat nog niet als ingediend.',
    ar: 'انقضى الموعد النهائي ({datum}) وهذا الربع غير مُسجَّل كمُقدَّم بعد.',
    en: 'The deadline ({datum}) has passed and this quarter is not marked as filed.',
  },

  // ─── [CONCEPTEN] De wachtrij met klaargezette e-mails ───────────────────────────────────────

  'dq.onderwerp': { nl: 'Onderwerp', ar: 'الموضوع', en: 'Subject' },
  'dq.onderwerpPh': { nl: 'Onderwerp van de e-mail…', ar: 'موضوع الرسالة…', en: 'Subject of the e-mail…' },
  'dq.bericht': { nl: 'Bericht', ar: 'الرسالة', en: 'Message' },
  'dq.berichtPh': { nl: "Schrijf hier je bericht, of gebruik 'AI opstellen'…", ar: "اكتب رسالتك هنا، أو استخدم «صياغة بالذكاء الاصطناعي»…", en: "Write your message here, or use 'AI draft'…" },
  'dq.kiesKlant': { nl: 'Kies een klant…', ar: 'اختر عميلًا…', en: 'Choose a client…' },
  'dq.puntToevoegen': { nl: 'Punt toevoegen…', ar: 'أضف بندًا…', en: 'Add a point…' },
  'dq.geenPunten': { nl: 'Nog geen openstaande punten voor deze klant.', ar: 'لا بنود معلّقة لهذا العميل بعد.', en: 'No open points for this client yet.' },
  'dq.nietGevonden': { nl: 'Niet gevonden', ar: 'لم يُعثر عليه', en: 'Not found' },
  'dq.netwerkfout': { nl: 'Netwerkfout. Probeer het opnieuw.', ar: 'خطأ في الشبكة. حاول مرة أخرى.', en: 'Network error. Try again.' },

  // ─── [KWARTAAL-KAART] Het kwartaaloverzicht per klant ───────────────────────────────────────

  'kw.inkomsten': { nl: 'Inkomsten incl. BTW', ar: 'الإيرادات شاملة الضريبة', en: 'Income incl. VAT' },
  'kw.uitgaven': { nl: 'Uitgaven incl. BTW', ar: 'المصروفات شاملة الضريبة', en: 'Spending incl. VAT' },
  'kw.teBetalen5g': { nl: 'BTW te betalen (5g)', ar: 'btw المستحقة (5g)', en: 'VAT to pay (5g)' },
  'kw.teBetalen5gKort': { nl: 'Te betalen (5g)', ar: 'مستحق (5g)', en: 'To pay (5g)' },
  'kw.klant': { nl: 'Klant', ar: 'العميل', en: 'Client' },
  'kw.openstaand': { nl: 'Openstaand', ar: 'مستحق', en: 'Outstanding' },
  'kw.nietIngediend': { nl: 'Nog niet als ingediend gemarkeerd', ar: 'لم يُعلَّم كمُقدَّم بعد', en: 'Not yet marked as filed' },
  'kw.btwMet': { nl: 'De BTW is met', ar: 'تغيّرت الضريبة بمقدار', en: 'The VAT changed by' },
  'kw.geenKlanten': { nl: 'Geen klanten gekoppeld', ar: 'لا عملاء مرتبطون', en: 'No clients linked' },
  'kw.laadFout': { nl: 'Dit kwartaal konden we niet ophalen; dat zegt niets over je cijfers zelf.', ar: 'تعذّر جلب هذا الربع؛ وهذا لا يقول شيئًا عن أرقامك نفسها.', en: 'We could not load this quarter; that says nothing about your figures themselves.' },
  'kw.klantenLaadFout': { nl: 'Je klantenlijst konden we niet ophalen; dat zegt niets over je koppelingen zelf.', ar: 'تعذّر جلب قائمة عملائك؛ وهذا لا يقول شيئًا عن ارتباطاتك نفسها.', en: 'We could not load your client list; that says nothing about your links themselves.' },
  'kw.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'kw.nodigUit': { nl: 'Klant uitnodigen', ar: 'دعوة عميل', en: 'Invite a client' },
  'kw.nodigUitUitleg': { nl: 'Nodig een klant uit om kwartaaloverzichten te bekijken', ar: 'ادعُ عميلًا لعرض ملخصات الأرباع', en: 'Invite a client to view quarterly overviews' },
  'kw.dashboard': { nl: 'Dashboard', ar: 'لوحة التحكم', en: 'Dashboard' },

  // ─── [KOP] De vaste kop: meldingen, profielmenu, uitloggen ──────────────────────────────────

  'kop.meldingen': { nl: 'Meldingen', ar: 'التنبيهات', en: 'Notifications' },
  'kop.geenMeldingen': { nl: 'Geen meldingen', ar: 'لا تنبيهات', en: 'No notifications' },
  'kop.allesGelezen': { nl: 'Alles gelezen', ar: 'تمت قراءة الكل', en: 'All read' },
  'kop.berichten': { nl: 'Berichten', ar: 'الرسائل', en: 'Messages' },
  'kop.profielmenu': { nl: 'Profielmenu', ar: 'قائمة الحساب', en: 'Profile menu' },
  'kop.instellingen': { nl: 'Instellingen', ar: 'الإعدادات', en: 'Settings' },
  'kop.uitloggen': { nl: 'Uitloggen', ar: 'تسجيل الخروج', en: 'Log out' },

  // ─── [ZOEKBALK] ─────────────────────────────────────────────────────────────────────────────

  'zb.zoeken': { nl: 'Zoeken', ar: 'بحث', en: 'Search' },
  'zb.openen': { nl: 'Zoeken openen', ar: 'فتح البحث', en: 'Open search' },
  'zb.recent': { nl: 'Recent', ar: 'الأخيرة', en: 'Recent' },
  'zb.resultaten': { nl: 'Zoekresultaten', ar: 'نتائج البحث', en: 'Search results' },

  // ─── [PLAN] Facturering & eerlijk gebruik ───────────────────────────────────────────────────

  'plan.titel': { nl: 'Plan', ar: 'الخطة', en: 'Plan' },
  'plan.uitleg': { nl: 'Welk plan er voor je geldt, en waar je je btw-facturen vindt.', ar: 'أي خطة تنطبق عليك، وأين تجد فواتير ضريبة القيمة المضافة الخاصة بك.', en: 'Which plan applies to you, and where your VAT invoices are.' },
  'plan.gebruik': { nl: 'Je gebruik deze maand', ar: 'استهلاكك هذا الشهر', en: 'Your usage this month' },
  'plan.prijsPlus': { nl: 'Prijs van Plus', ar: 'سعر Plus', en: 'The price of Plus' },
  'plan.beleid': { nl: 'Lees het beleid eerlijk gebruik', ar: 'اقرأ سياسة الاستخدام العادل', en: 'Read the fair-use policy' },
  'plan.beleidVolledig': { nl: 'Het volledige beleid', ar: 'السياسة كاملة', en: 'The full policy' },
  'plan.betaald': { nl: 'Bedankt — je betaling is gelukt.', ar: 'شكرًا — تم دفعك بنجاح.', en: 'Thank you — your payment went through.' },
  'plan.jeWordt': { nl: 'Je wordt', ar: 'ستصبح', en: 'You become' },

  // ─── [VERPLAATSEN] ──────────────────────────────────────────────────────────────────────────

  'mv.naar': { nl: 'Verplaatsen naar', ar: 'نقل إلى', en: 'Move to' },
  'mv.hier': { nl: 'Hier verplaatsen', ar: 'نقل إلى هنا', en: 'Move here' },
  'mv.hoofdmap': { nl: 'Hoofdmap', ar: 'المجلد الرئيسي', en: 'Root folder' },
  'mv.zoek': { nl: 'Zoek een map…', ar: 'ابحث عن مجلد…', en: 'Search for a folder…' },
  'mv.zoekAria': { nl: 'Mappen zoeken', ar: 'البحث في المجلدات', en: 'Search folders' },
  'mv.geen': { nl: 'Geen mappen gevonden.', ar: 'لم يُعثر على مجلدات.', en: 'No folders found.' },

  // ─── [VERKOOP] Het scherm van de verkoopmedewerker ──────────────────────────────────────────
  // De medewerker die namens de eigenaar factureert kan net zo goed Arabischtalig zijn.

  'vk.jouwFacturen': { nl: 'Jouw facturen', ar: 'فواتيرك', en: 'Your invoices' },
  'vk.maken': { nl: 'Facturen maken', ar: 'إنشاء الفواتير', en: 'Creating invoices' },
  'vk.laadFout': { nl: 'We konden je facturen nu niet ophalen — de bedragen hieronder kunnen onvolledig zijn. Ververs de pagina om het opnieuw te proberen.', ar: 'تعذّر جلب فواتيرك الآن — قد تكون المبالغ أدناه ناقصة. أعد تحميل الصفحة للمحاولة مجددًا.', en: 'We could not load your invoices right now — the amounts below may be incomplete. Refresh the page to try again.' },
  'vk.namens': { nl: 'Je maakt facturen namens', ar: 'تُنشئ الفواتير باسم', en: 'You create invoices on behalf of' },
  'vk.staatOpen': { nl: 'Staat open', ar: 'مستحق', en: 'Outstanding' },
  'vk.teLaat': { nl: 'Te laat', ar: 'متأخر', en: 'Overdue' },
  'vk.geenFacturen': { nl: 'Je hebt nog geen facturen gemaakt. Begin met de knop hierboven.', ar: 'لم تُنشئ فواتير بعد. ابدأ بالزر أعلاه.', en: 'You have not created any invoices yet. Start with the button above.' },

  // ─── [VERSTUURD] The confirmation after an invoice actually goes out ─────────────────────────

  'sent.factuur.title': {
    nl: 'Factuur verstuurd',
    ar: 'تم إرسال الفاتورة',
    en: 'Invoice sent',
  },
  'sent.creditnota.title': {
    nl: 'Creditnota verstuurd',
    ar: 'تم إرسال الإشعار الدائن',
    en: 'Credit note sent',
  },

  'sent.factuur.lead': {
    nl: 'Factuur {number} is onderweg naar {name}.',
    ar: 'الفاتورة {number} في طريقها إلى {name}.',
    en: 'Invoice {number} is on its way to {name}.',
  },
  'sent.creditnota.lead': {
    nl: 'Creditnota {number} is onderweg naar {name}.',
    ar: 'الإشعار الدائن {number} في طريقه إلى {name}.',
    en: 'Credit note {number} is on its way to {name}.',
  },
  'sent.factuur.leadNoName': {
    nl: 'Factuur {number} is verstuurd.',
    ar: 'تم إرسال الفاتورة {number}.',
    en: 'Invoice {number} has been sent.',
  },
  'sent.creditnota.leadNoName': {
    nl: 'Creditnota {number} is verstuurd.',
    ar: 'تم إرسال الإشعار الدائن {number}.',
    en: 'Credit note {number} has been sent.',
  },

  // Art. 35 Wet OB. The one thing on this panel the owner cannot undo, so it is stated before the
  // reassurance — in every language.
  'sent.factuur.fixed': {
    nl: 'Nummer {number} ligt vast. Een verstuurde factuur pas je niet meer aan — een fout corrigeer je met een creditnota.',
    ar: 'الرقم {number} صار نهائيًا. لا يمكن تعديل فاتورة مُرسَلة — يُصحَّح الخطأ بإشعار دائن.',
    en: 'Number {number} is now permanent. A sent invoice is never edited — a mistake is corrected with a credit note.',
  },
  'sent.creditnota.fixed': {
    nl: 'Nummer {number} ligt vast. Een verstuurde creditnota pas je niet meer aan.',
    ar: 'الرقم {number} صار نهائيًا. لا يمكن تعديل إشعار دائن مُرسَل.',
    en: 'Number {number} is now permanent. A sent credit note is never edited.',
  },
  // Only reachable for a factuur: converting is what an offerte does, and it becomes a factuur.
  'sent.factuur.fixedConverted': {
    nl: 'Je offerte is nu factuur {number}. Dat nummer ligt vast: een verstuurde factuur pas je niet meer aan — een fout corrigeer je met een creditnota.',
    ar: 'أصبح عرض السعر الفاتورة {number}. هذا الرقم نهائي: الفاتورة المُرسَلة لا تُعدَّل — الخطأ يُصحَّح بإشعار دائن.',
    en: 'Your quote is now invoice {number}. That number is permanent: a sent invoice is never edited — a mistake is corrected with a credit note.',
  },

  'sent.factuur.numberLabel': { nl: 'Factuurnummer', ar: 'رقم الفاتورة', en: 'Invoice number' },
  'sent.creditnota.numberLabel': { nl: 'Creditnotanummer', ar: 'رقم الإشعار الدائن', en: 'Credit note number' },
  'sent.row.to': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'sent.row.sentTo': { nl: 'Verstuurd naar', ar: 'أُرسلت إلى', en: 'Sent to' },
  'sent.row.amount': { nl: 'Bedrag', ar: 'المبلغ', en: 'Amount' },

  'sent.check.heading': {
    nl: 'Zo controleer je het zelf',
    ar: 'كيف تتحقّق بنفسك',
    en: 'How to check it yourself',
  },
  // Rule 2 in the header, now applied properly. This sentence used to spell "Facturen" and
  // "Verzonden" literally in every language, because those words were Dutch on the screen and
  // an owner told to look for a translated word would have found nothing.
  //
  // The tab and the status are translated now, so the literals would be the wrong half of the
  // rule — pointing at labels that no longer exist. They are PARAMETERS instead, filled from
  // nav.invoices and status.sent, so this sentence names whatever the screen actually says and
  // cannot drift from it again in any language.
  'sent.factuur.checkList': {
    nl: 'De factuur staat nu bij {tab} met de status {status}.',
    ar: 'الفاتورة الآن ضمن قائمة {tab} بالحالة {status}.',
    en: 'The invoice is now under {tab} with the status {status}.',
  },
  'sent.creditnota.checkList': {
    nl: 'De creditnota staat nu bij {tab} met de status {status}.',
    ar: 'الإشعار الدائن الآن ضمن قائمة {tab} بالحالة {status}.',
    en: 'The credit note is now under {tab} with the status {status}.',
  },
  'sent.check.pdf': {
    nl: 'Open hem om de PDF te bekijken — dat is hetzelfde bestand dat de klant heeft gekregen.',
    ar: 'افتحه لمعاينة ملف PDF — وهو نفس الملف الذي وصله العميل.',
    en: 'Open it to view the PDF — that is the same file the customer received.',
  },
  'sent.check.reply': {
    nl: 'Antwoordt de klant op deze mail, dan komt dat binnen op {email}.',
    ar: 'إذا ردّ العميل على هذه الرسالة، فسيصل الرد إلى {email}.',
    en: 'If the customer replies to this e-mail, it arrives at {email}.',
  },
  // The honest limit that makes the three lines above worth trusting.
  'sent.check.failed': {
    nl: 'Was het versturen mislukt, dan had je dit scherm niet gezien maar een herstelscherm.',
    ar: 'ولو فشل الإرسال لما ظهرت لك هذه الشاشة بل شاشة إصلاح.',
    en: 'Had the send failed, you would be looking at a recovery screen instead of this one.',
  },

  'sent.action.view': { nl: 'Factuur bekijken', ar: 'عرض الفاتورة', en: 'View the invoice' },
  'sent.action.new': { nl: 'Nog een factuur maken', ar: 'إنشاء فاتورة أخرى', en: 'Create another invoice' },

  // ── [TAAL] Shared components — a component holds no language of its own ────────────────────
  // InvoiceActions: the action row + delete confirm + betaalverzoek sheet on the detail page.
  'act.bewerken': { nl: 'Bewerken', ar: 'تعديل', en: 'Edit' },
  'act.verwijderen': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'act.betaalverzoek': { nl: 'Betaalverzoek', ar: 'طلب دفع', en: 'Payment request' },
  'act.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'act.bvMislukt': { nl: 'Betaalverzoek maken mislukt', ar: 'فشل إنشاء طلب الدفع', en: 'Creating the payment request failed' },
  'act.verwijderenMislukt': { nl: 'Verwijderen mislukt', ar: 'فشل الحذف', en: 'Deleting failed' },
  'act.verwijderTitel': { nl: 'Factuur verwijderen?', ar: 'حذف الفاتورة؟', en: 'Delete this invoice?' },
  'act.verwijderUitleg': {
    nl: 'Je staat op het punt factuur {number} permanent te verwijderen. Dit kan niet ongedaan worden gemaakt.',
    ar: 'أنت على وشك حذف الفاتورة {number} نهائيًا. لا يمكن التراجع عن هذا.',
    en: 'You are about to permanently delete invoice {number}. This cannot be undone.',
  },
  'act.verwijderBezig': { nl: 'Verwijderen…', ar: 'جارٍ الحذف…', en: 'Deleting…' },
  'act.verwijderJa': { nl: 'Ja, verwijderen', ar: 'نعم، احذف', en: 'Yes, delete' },
  'act.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'act.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'act.bv.titel': { nl: 'Betaalverzoek voor {number}', ar: 'طلب دفع للفاتورة {number}', en: 'Payment request for {number}' },
  'act.bv.uitleg': {
    nl: 'Deel deze link met je klant. Ze betalen {amount} vanuit hun eigen bank, met kenmerk {reference}. Staat de betaling op je bankafschrift, dan herkent BoekBrug haar bij deze factuur en bevestig jij met één tik.',
    ar: 'شارك هذا الرابط مع عميلك. يدفع {amount} من بنكه، بالمرجع {reference}. وعندما تظهر الدفعة في كشف حسابك، يتعرّف عليها BoekBrug عند هذه الفاتورة وتؤكد أنت بلمسة واحدة.',
    en: 'Share this link with your customer. They pay {amount} from their own bank, with reference {reference}. Once the payment is on your bank statement, BoekBrug recognises it against this invoice and you confirm with one tap.',
  },
  'act.bv.qrAlt': { nl: 'QR naar betaalpagina', ar: 'رمز QR لصفحة الدفع', en: 'QR to the payment page' },
  'act.bv.kopieer': { nl: 'Kopieer link', ar: 'نسخ الرابط', en: 'Copy link' },
  // [BESTE] Share the pay link the way a customer actually receives it: in WhatsApp.
  'act.bv.whatsapp': { nl: 'Deel via WhatsApp', ar: 'شارك عبر واتساب', en: 'Share via WhatsApp' },
  'act.bv.gekopieerd': { nl: 'Gekopieerd', ar: 'تم النسخ', en: 'Copied' },
  'act.bv.disclaimer': {
    nl: 'BoekBrug verwerkt de betaling niet — het geld gaat direct naar je eigen IBAN ({iban}).',
    ar: 'BoekBrug لا يعالج الدفعة — المال يذهب مباشرة إلى IBAN حسابك ({iban}).',
    en: 'BoekBrug does not process the payment — the money goes straight to your own IBAN ({iban}).',
  },

  // UblExportButton
  'ublx.mislukt': { nl: 'UBL exporteren mislukt', ar: 'فشل تصدير UBL', en: 'UBL export failed' },
  'ublx.onbekend': { nl: 'Onbekende fout', ar: 'خطأ غير معروف', en: 'Unknown error' },
  'ublx.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'ublx.klaar': { nl: 'Gedownload ✓', ar: 'تم التنزيل ✓', en: 'Downloaded ✓' },
  'ublx.knop': { nl: 'UBL exporteren', ar: 'تصدير UBL', en: 'Export UBL' },
  'ublx.peppol.knop': { nl: 'Peppol-versie', ar: 'نسخة Peppol', en: 'Peppol version' },
  'ublx.peppol.tip': { nl: 'Dezelfde factuur als Peppol BIS 3.0-bestand (vereist het BTW-nummer van de klant)', ar: 'الفاتورة نفسها كملف Peppol BIS 3.0 (يتطلب رقم btw الخاص بالعميل)', en: 'The same invoice as a Peppol BIS 3.0 file (requires the client BTW number)' },
  'ublx.tip': {
    nl: 'Exporteer als UBL 2.1 (e-factuur) voor je boekhoudprogramma',
    ar: 'صدّر بصيغة UBL 2.1 (فاتورة إلكترونية) لبرنامج المحاسبة لديك',
    en: 'Export as UBL 2.1 (e-invoice) for your accounting software',
  },

  // InvoiceReminders: the per-invoice reminder panel.
  'herin.titel': { nl: 'Betalingsherinneringen', ar: 'تذكيرات الدفع', en: 'Payment reminders' },
  'herin.gepauzeerd': {
    nl: 'Automatische herinneringen zijn gepauzeerd voor deze factuur.',
    ar: 'التذكيرات التلقائية موقوفة مؤقتًا لهذه الفاتورة.',
    en: 'Automatic reminders are paused for this invoice.',
  },
  'herin.actief': {
    nl: 'Deze factuur volgt je herinneringsschema (zie Instellingen).',
    ar: 'هذه الفاتورة تتبع جدول التذكيرات الخاص بك (انظر الإعدادات).',
    en: 'This invoice follows your reminder schedule (see Settings).',
  },
  // [HERIN-WAARHEID] De stand die dit paneel nooit kende. `herin.actief` hierboven werd getoond
  // ongeacht profiles.reminders_enabled, en die schakelaar staat standaard uit — dus de zin
  // "volgt je herinneringsschema" was voor vrijwel iedereen onwaar. Deze zegt wat er werkelijk
  // gebeurt (namelijk niets) en noemt in dezelfde adem de knop die het aanzet, zoals hij in de
  // navigatie geschreven staat.
  'herin.uit': {
    nl: 'Automatische herinneringen staan uit — deze factuur wordt niet vanzelf opgevolgd.',
    ar: 'التذكيرات التلقائية متوقفة — لن تتم متابعة هذه الفاتورة تلقائيًا.',
    en: 'Automatic reminders are off — this invoice will not be chased on its own.',
  },
  'herin.aanzetten': { nl: 'Aanzetten bij Instellingen', ar: 'تفعيلها من الإعدادات', en: 'Turn on in Settings' },
  // [NO-SILENT-EMPTY] Een mislukte lezing mag hier nooit lezen als "staat aan". Dat is precies de
  // bewering die dit paneel jarenlang verkeerd deed.
  'herin.onbekend': {
    nl: 'We konden niet nakijken of automatische herinneringen aanstaan.',
    ar: 'لم نتمكّن من التحقّق مما إذا كانت التذكيرات التلقائية مفعّلة.',
    en: 'We could not check whether automatic reminders are on.',
  },
  'herin.hervatten': { nl: 'Hervatten', ar: 'استئناف', en: 'Resume' },
  'herin.pauzeren': { nl: 'Pauzeren', ar: 'إيقاف مؤقت', en: 'Pause' },
  'herin.verstuurd': { nl: 'Verstuurd', ar: 'التذكيرات المُرسَلة', en: 'Sent' },
  // [TAAL] Arabic counts its nouns by number band (2 → dual, 3–10 → plural, 11+ → singular
  // accusative), which one {days} slot cannot serve. "بعد {days} يوم" is the app-Arabic
  // convention that stays readable across all bands; the day-word never inflects wrongly.
  'herin.naDagen': {
    nl: 'Herinnering na {days} dagen',
    ar: 'تذكير بعد {days} يومًا',
    en: 'Reminder after {days} days',
  },
  'herin.naDag': { nl: 'Herinnering na 1 dag', ar: 'تذكير بعد يوم واحد', en: 'Reminder after 1 day' },
  'herin.mislukt': { nl: ' — mislukt', ar: ' — فشل', en: ' — failed' },

  // InvoiceRow: the bank-reconciliation badges and partial-payment chip.
  'rij.inAfschrift': { nl: 'In bankafschrift', ar: 'في كشف البنك', en: 'In bank statement' },
  'rij.inAfschriftTip': {
    nl: 'Deze betaling staat in je bankafschrift',
    ar: 'هذه الدفعة موجودة في كشف حسابك البنكي',
    en: 'This payment is in your bank statement',
  },
  'rij.betalingGevonden': { nl: 'Betaling gevonden', ar: 'عُثر على دفعة', en: 'Payment found' },
  'rij.mogelijkeBetaling': { nl: 'Mogelijke betaling', ar: 'دفعة محتملة', en: 'Possible payment' },
  'rij.veiligTip': {
    nl: 'Deze betaling staat in je bankafschrift en hoort bij deze factuur — tik om te bevestigen',
    ar: 'هذه الدفعة في كشف حسابك البنكي وتخص هذه الفاتورة — انقر للتأكيد',
    en: 'This payment is in your bank statement and belongs to this invoice — tap to confirm',
  },
  'rij.controleTip': {
    nl: 'Er staat een betaling in je bankafschrift die hierbij zou kunnen horen — controleer het op de Bank-pagina',
    ar: 'توجد دفعة في كشف حسابك البنكي قد تخص هذه الفاتورة — تحقّق منها في صفحة البنك',
    en: 'A payment in your bank statement may belong to this invoice — check it on the Bank page',
  },
  'rij.vervangenDoor': { nl: 'Vervangen door {number}', ar: 'استُبدلت بـ {number}', en: 'Replaced by {number}' },
  'rij.deelsOpen': { nl: 'Deels · {amount} open', ar: 'جزئي · {amount} متبقٍ', en: 'Partial · {amount} open' },
  'rij.deelsTip': {
    nl: 'Deelbetaling: {paid} van {total} betaald',
    ar: 'دفعة جزئية: {paid} من أصل {total} مدفوع',
    en: 'Partial payment: {paid} of {total} paid',
  },

  // InvoiceDocumentSheet: the paper + our reading of it, on one screen.
  'dsh.aria': { nl: 'Factuur bekijken', ar: 'عرض الفاتورة', en: 'View invoice' },
  'dsh.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'dsh.onbekendeLeverancier': { nl: 'Onbekende leverancier', ar: 'مورّد غير معروف', en: 'Unknown supplier' },
  'dsh.zonderNummer': { nl: 'zonder nummer', ar: 'بدون رقم', en: 'without a number' },
  'dsh.watGelezen': { nl: 'Wat wij hebben gelezen', ar: 'ما قرأناه نحن', en: 'What we read' },
  // [CONTROLES-INKLAPPEN] Wat er achter het pijltje zit. Een knop zonder belofte wordt niet
  // ingedrukt, en het aantal is precies de belofte: negen vinkjes uitklappen is iets anders dan één.
  // ── [SPLIT-ALSNOG] De controle die niet kon lopen, alsnog laten lopen ────────────────────────
  // Op een factuur die btw-tarieven mengt is de gedrukte specificatie het ENIGE wat het btw-bedrag
  // kan tegenspreken (zie btw-split.ts). Stond die er niet, dan zei het blad "konden we niet
  // nagaan" en verder niets — een doodlopende regel boven een bedrag dat de eigenaar aftrekt.
  'dsh.btwSpec.lees': {
    nl: 'Btw-specificatie nalezen',
    ar: 'مراجعة تفاصيل الضريبة',
    en: 'Read the btw specification',
  },
  'dsh.btwSpec.bezig': {
    nl: 'Bezig met nalezen\u2026',
    ar: 'جارٍ المراجعة…',
    en: 'Reading\u2026',
  },
  // [NO-SILENT-EMPTY] Twee verschillende uitkomsten, twee verschillende zinnen: "er staat er geen
  // op" is een BEVINDING en "het lukte niet" is een storing. Ze op één zin laten uitkomen is
  // precies hoe een niet-uitgevoerde controle als een schone leest.
  'dsh.btwSpec.geen': {
    nl: 'Op dit document staat geen btw-specificatie per tarief. Vergelijk het btw-bedrag zelf met de factuur.',
    ar: 'لا يوجد على هذا المستند تفصيل للضريبة حسب النسبة. قارن مبلغ الضريبة بنفسك مع الفاتورة.',
    en: 'This document prints no per-rate btw specification. Compare the btw amount with the invoice yourself.',
  },
  'dsh.btwSpec.mislukt': {
    nl: 'Nalezen lukte nu niet. Er is niets gewijzigd \u2014 probeer het zo meteen opnieuw.',
    ar: 'تعذّرت إعادة القراءة الآن. لم يتغيّر شيء \u2014 جرّب بعد قليل.',
    en: 'Could not read it just now. Nothing was changed \u2014 try again in a moment.',
  },
  'dsh.controlesTonen': {
    nl: 'toon alle {n}',
    ar: 'عرض الكل ({n})',
    en: 'show all {n}',
  },
  'dsh.factuurdatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'dsh.totaalIncl': { nl: 'Totaal incl. btw', ar: 'الإجمالي شامل btw', en: 'Total incl. VAT' },
  'dsh.btw': { nl: 'Btw', ar: 'الضريبة', en: 'VAT' },
  'dsh.exclBtw': { nl: 'Excl. btw', ar: 'بدون الضريبة', en: 'Excl. VAT' },
  'dsh.laden': { nl: 'Bestand wordt geladen…', ar: 'جارٍ تحميل الملف…', en: 'Loading the file…' },
  'dsh.nietOpenen': { nl: 'Kon het bestand niet openen', ar: 'تعذّر فتح الملف', en: 'Could not open the file' },
  'dsh.nietOpenenVerbinding': {
    nl: 'Kon het bestand niet openen — controleer je verbinding',
    ar: 'تعذّر فتح الملف — تحقّق من اتصالك',
    en: 'Could not open the file — check your connection',
  },
  // [BETER-EXEMPLAAR] Een beter exemplaar van HETZELFDE papier — niet een herziene factuur.
  'dsh.vervangBestand': {
    nl: 'Beter exemplaar',
    ar: 'نسخة أفضل',
    en: 'Better copy',
  },
  'dsh.vervang.vraag': {
    nl: 'Bestand vervangen door een beter exemplaar?',
    ar: 'استبدال الملف بنسخة أفضل؟',
    en: 'Replace the file with a better copy?',
  },
  'dsh.vervang.uitleg': {
    nl: 'Alleen voor hetzelfde papier, bijvoorbeeld een scherpe pdf in plaats van je foto. De bedragen blijven staan; het oude bestand blijft bewaard. Andere bedragen van de leverancier? Gebruik dan "Deze vervangt factuur X".',
    ar: 'فقط للمستند نفسه، مثل ملف PDF واضح بدل صورتك. تبقى المبالغ كما هي ويبقى الملف القديم محفوظًا. هل المبالغ مختلفة من المورّد؟ استخدم حينها «Deze vervangt factuur X».',
    en: 'Only for the same paper, such as a sharp pdf instead of your photo. The amounts stay; the old file is kept. Different amounts from the supplier? Then use "Deze vervangt factuur X".',
  },
  'dsh.vervang.gelukt': {
    nl: 'Bestand vervangen. Het oude staat nog in Mijn bestanden.',
    ar: 'استُبدل الملف. لا يزال القديم في «ملفاتي».',
    en: 'File replaced. The old one is still in Mijn bestanden.',
  },
  'dsh.kloptNiet': { nl: 'Klopt niet — corrigeren', ar: 'غير صحيح — صحّحه', en: 'Not right — correct it' },
  'dsh.nieuwTabblad': { nl: 'Openen in nieuw tabblad', ar: 'فتح في تبويب جديد', en: 'Open in a new tab' },
  'dsh.factuurAlt': { nl: 'Factuur {number}', ar: 'الفاتورة {number}', en: 'Invoice {number}' },

  // InvoiceCorrectionModal: the ONE editor for a booked purchase invoice.
  'corr.aria': { nl: 'Factuur corrigeren', ar: 'تصحيح الفاتورة', en: 'Correct invoice' },
  'corr.titel': { nl: 'Factuur corrigeren', ar: 'تصحيح الفاتورة', en: 'Correct invoice' },
  'corr.uitleg': {
    nl: 'Neem over wat er op de factuur staat. Wat je hier verbetert, is wat je boekhouder straks ziet.',
    ar: 'انقل ما هو مكتوب على الفاتورة. ما تصحّحه هنا هو ما سيراه محاسبك لاحقًا.',
    en: 'Copy what the invoice itself says. What you correct here is what your accountant will see.',
  },
  'corr.leverancier': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'corr.factuurnummer': { nl: 'Factuurnummer', ar: 'رقم الفاتورة', en: 'Invoice number' },
  'corr.factuurdatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'corr.vervaldatum': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'corr.iban': { nl: 'IBAN van de leverancier', ar: 'IBAN المورّد', en: "Supplier's IBAN" },
  'corr.kenmerk': { nl: 'Betaalkenmerk', ar: 'مرجع الدفع', en: 'Payment reference' },
  // [AANSLAG] The kind of Belastingdienst letter, correctable by the owner.
  'corr.soort.label': { nl: 'Soort document', ar: 'نوع المستند', en: 'Document kind' },
  'corr.soort.factuur': { nl: 'Gewone inkoopfactuur', ar: 'فاتورة شراء عادية', en: 'Ordinary purchase invoice' },
  'corr.soort.inkomstenbelasting': { nl: 'Aanslag inkomstenbelasting (privé)', ar: 'ضريبة الدخل (خاص)', en: 'Income tax assessment (private)' },
  'corr.soort.zorgverzekeringswet': { nl: 'Aanslag Zvw (privé)', ar: 'مساهمة Zvw (خاص)', en: 'Zvw assessment (private)' },
  'corr.soort.omzetbelasting': { nl: 'Naheffing omzetbelasting (afdracht)', ar: 'ضريبة القيمة المضافة (تسوية)', en: 'VAT assessment (settlement)' },
  'corr.soort.motorrijtuigenbelasting': { nl: 'Motorrijtuigenbelasting (kost, zonder btw)', ar: 'ضريبة المركبات (تكلفة، بدون btw)', en: 'Motor vehicle tax (a cost, no btw)' },
  'corr.soort.overig': { nl: 'Andere brief Belastingdienst', ar: 'رسالة أخرى من مصلحة الضرائب', en: 'Other tax office letter' },
  'corr.splitUitleg': { nl: 'BTW-specificatie zoals op de factuur — één regel per tarief. Laat alles leeg om de specificatie te wissen.', ar: 'تفصيلة ضريبة القيمة المضافة كما على الفاتورة — سطر لكل نسبة. اترك الكل فارغًا لمسح التفصيلة.', en: 'VAT specification as printed — one row per rate. Leave everything empty to clear it.' },
  'corr.grondslag': { nl: 'Grondslag', ar: 'الأساس', en: 'Base' },
  'corr.btwBedrag': { nl: 'BTW-bedrag', ar: 'مبلغ btw', en: 'VAT amount' },
  // [BTW-TARIEF] Eén tik in plaats van hoofdrekenen. Het TARIEF wordt gevraagd, nooit geraden:
  // uit een bedrag exclusief valt geen tarief af te leiden, en een geraden btw is een geraden
  // voorbelasting. Elke zin een eigen sleutel — een getal is een parameter, een woord niet.
  'corr.tarief.vraag': {
    nl: 'Btw ontbreekt. Welk tarief staat er op de factuur?',
    en: 'The VAT is missing. Which rate does the invoice show?',
    ar: 'مبلغ الضريبة ناقص. ما النسبة المذكورة في الفاتورة؟',
  },
  'corr.tarief.nu': {
    nl: 'Nu gerekend met {tarief}% btw. Klopt dat niet? Kies het juiste tarief.',
    en: 'Currently calculated at {tarief}% VAT. Not right? Pick the correct rate.',
    ar: 'يُحتسب حاليًا بنسبة {tarief}٪. غير صحيح؟ اختر النسبة الصحيحة.',
  },
  'corr.tarief.knop': {
    nl: '{tarief}% — btw wordt {btw}',
    en: '{tarief}% — VAT becomes {btw}',
    ar: '{tarief}٪ — تصبح الضريبة {btw}',
  },
  'corr.tarief.uitleg': {
    nl: 'Het tarief raden wij niet: hetzelfde bedrag kan 9% of 21% zijn. Klopt het niet? Tik het bedrag over.',
    en: 'We do not guess the rate: the same amount can be 9% or 21%. Not right? Type the amount over it.',
    ar: 'لا نخمّن النسبة: المبلغ نفسه قد يكون ٩٪ أو ٢١٪. غير صحيح؟ اكتب المبلغ فوقه.',
  },
  // [NUL-POST] Statiegeld, emballage, europallets: bedragen op de factuur waar geen btw op zit.
  // Elk Nederlands boekhoudpakket (jortt, Silvasoft, SnelStart, Acumulus) boekt zo'n post als een
  // aparte 0%-regel. De zin legt uit WAAROM het veld er is, want zonder die uitleg leest het als
  // nog een bedrag dat ergens bij moet — en dat is het juist niet.
  'corr.onbelastUitleg': {
    nl: 'Statiegeld, emballage of pallets op de factuur? Daar zit geen btw op. Vul dat bedrag hier in — het zit al in het bedrag excl. BTW, dus je totaal verandert er niet van.',
    ar: 'تأمين فوارغ أو عبوات أو منصّات نقل على الفاتورة؟ لا ضريبة عليها. أدخل ذلك المبلغ هنا — هو أصلًا ضمن المبلغ بدون ضريبة، فلن يتغيّر إجماليك.',
    en: 'Deposits, packaging or pallets on the invoice? Those carry no VAT. Enter that amount here — it is already inside the amount excluding VAT, so your total does not change.',
  },
  'corr.onbelastLabel': {
    nl: 'Bedrag zonder btw (statiegeld, emballage, pallets)',
    ar: 'مبلغ بدون ضريبة القيمة المضافة (تأمين فوارغ، عبوات، منصّات)',
    en: 'Amount without VAT (deposits, packaging, pallets)',
  },
  'corr.onbelastPlaceholder': {
    nl: 'Bijvoorbeeld 12,60',
    ar: 'مثلًا 12,60',
    en: 'For example 12,60',
  },
  'corr.bedragUitleg': {
    nl: 'Neem het totaal en de BTW over zoals ze onderaan de factuur staan — het bedrag exclusief rekent zichzelf uit.',
    ar: 'انقل الإجمالي ومبلغ ضريبة القيمة المضافة كما هما مكتوبان أسفل الفاتورة — المبلغ بدون الضريبة يُحسب تلقائيًا.',
    en: 'Copy the total and the VAT exactly as printed at the bottom of the invoice — the ex-VAT amount computes itself.',
  },
  'corr.totaalIncl': { nl: 'Totaal (incl. BTW)', ar: 'الإجمالي (شامل btw)', en: 'Total (incl. VAT)' },
  'corr.btw': { nl: 'BTW', ar: 'الضريبة', en: 'VAT' },
  'corr.exclBtw': { nl: 'Bedrag excl. BTW', ar: 'المبلغ بدون btw', en: 'Amount excl. VAT' },
  'corr.creditTitel': { nl: 'Dit is een creditnota', ar: 'هذا إشعار دائن', en: 'This is a credit note' },
  'corr.creditUitleg': {
    nl: ' — geld dat jou toekomt. Vink aan bij “Creditnota” of een negatief totaal; de bedragen worden dan als minbedrag opgeslagen.',
    ar: '— مال مستحق لك. حدّد «Creditnota» أو إجماليًا سالبًا؛ تُحفظ المبالغ حينها كمبالغ سالبة.',
    en: ' — money owed to you. Tick for “Creditnota” or a negative total; the amounts are then stored as a minus amount.',
  },
  // [STATIEGELD-GAT] De knop op de correctie-modal. Kort, want de zin eronder (uit statiegeld.ts)
  // noemt het bedrag, het woord van de factuur en wat het bedrag excl. btw wordt.
  // [BETAALNOTITIE] Een eigen tekst ACHTER het kenmerk, voor deze ene betaling.
  'notitie.label': {
    nl: 'Eigen tekst erbij (optioneel)',
    ar: 'نص خاص بك (اختياري)',
    en: 'Add your own text (optional)',
  },
  'notitie.voorbeeld': {
    nl: 'Bijv. termijn 1 van 2',
    ar: 'مثال: القسط 1 من 2',
    en: 'e.g. termijn 1 van 2',
  },
  'notitie.ruimte': {
    nl: 'Komt achter het kenmerk te staan. Nog {n} tekens ruimte.',
    ar: 'يُكتب بعد المرجع. يتبقّى {n} حرفًا.',
    en: 'Goes after the reference. {n} characters left.',
  },
  // [KENMERK-VAN-WIE] Waar het kenmerk vandaan komt, en waarom het geen invulveld is. GEVRAAGD
  // naar aanleiding van het termijnbetalen: "kan ik er 'eerste deel' bij schrijven?"
  'kenmerk.vanLeverancier': {
    nl: 'Dit kenmerk staat op de factuur van de leverancier — daarmee vindt hij jouw betaling terug. Verander het niet zelf.',
    ar: 'هذا المرجع مكتوب على فاتورة المورّد — به يتعرّف على دفعتك. لا تغيّره بنفسك.',
    en: "This reference comes from the supplier's invoice — it is how they find your payment. Do not change it yourself.",
  },
  'kenmerk.corrigeer': {
    nl: 'Staat het er verkeerd? Corrigeer het op de factuur',
    ar: 'هل هو مكتوب خطأً؟ صحّحه على الفاتورة',
    en: 'Wrong on the invoice? Correct it there',
  },
  'kenmerk.naBetaling': {
    nl: 'Deze factuur staat niet meer op te betalen, dus het kenmerk kan hier niet meer worden gecorrigeerd.',
    ar: 'لم تعد هذه الفاتورة قيد الدفع، لذا لا يمكن تصحيح المرجع هنا.',
    en: 'This invoice is no longer awaiting payment, so the reference can no longer be corrected here.',
  },
  // [DEEL-BETALEN] Een factuur in termijnen betalen. GEMELD op Enka Horeca B.V. (€ 3.819,82):
  // "ik wil deze betalen, maar voorlopig maar een deel."
  'deel.label': {
    nl: 'Hoeveel betaal je nu?',
    ar: 'كم ستدفع الآن؟',
    en: 'How much are you paying now?',
  },
  'deel.rest': {
    nl: 'Daarna blijft {bedrag} openstaan. Zodra je bank de betaling doorgeeft, rekent de app het bij op deze factuur.',
    ar: 'بعدها يبقى {bedrag} مستحقًا. حالما يُبلّغ بنكك عن الدفعة، يحتسبها التطبيق على هذه الفاتورة.',
    en: 'After that {bedrag} stays open. As soon as your bank reports the payment, the app books it against this invoice.',
  },
  'deel.alles': {
    nl: 'Hiermee is de factuur helemaal betaald.',
    ar: 'بهذا تُدفع الفاتورة بالكامل.',
    en: 'This pays the invoice in full.',
  },
  'corr.statiegeld.meetellen': {
    nl: 'Statiegeld meetellen in het bedrag excl. btw',
    ar: 'احتساب التأمين (statiegeld) ضمن المبلغ بدون ضريبة',
    en: 'Count the deposit into the amount excl. VAT',
  },
  'corr.statiegeld': {
    nl: 'Statiegeld, emballage of een retour op de factuur? Die tellen mee in het bedrag exclusief, mét hun teken.',
    ar: 'statiegeld (رهن عبوات) أو مرتجعات على الفاتورة؟ تُحسب ضمن المبلغ بدون الضريبة، بإشارتها.',
    en: 'Deposit (statiegeld), packaging or a return on the invoice? They count inside the ex-VAT amount, with their sign.',
  },
  // [CORRECTIE-TIJDVAK] Shown when the app could not read WHICH quarters are filed. Translated,
  // unlike the notice itself: this sentence is about the app failing, not about the aangifte.
  // [KETEN] On a CREDITNOTA's own screen: which invoice it corrects. Two keys and not one with an
  // empty {date} — "bij factuur CR-101 van ." is a sentence no language repairs.
  'detail.creditHoortBij': {
    nl: 'Deze creditnota hoort bij factuur {number} van {date}',
    ar: 'هذا الإشعار الدائن يخصّ الفاتورة {number} بتاريخ {date}',
    en: 'This credit note belongs to invoice {number} of {date}',
  },
  'detail.creditHoortBijZonderDatum': {
    nl: 'Deze creditnota hoort bij factuur {number}',
    ar: 'هذا الإشعار الدائن يخصّ الفاتورة {number}',
    en: 'This credit note belongs to invoice {number}',
  },
  'corr.tijdvakNietGelezen': {
    nl: 'We konden niet nagaan of het btw-tijdvak van deze factuur al is ingediend.',
    ar: 'تعذّر علينا التحقّق مما إذا كانت فترة ضريبة القيمة المضافة لهذه الفاتورة قد قُدِّمت بالفعل.',
    en: 'We could not check whether the VAT period of this invoice has already been filed.',
  },
  'corr.nietsGewijzigd': { nl: 'Er is niets gewijzigd.', ar: 'لم يتغيّر شيء.', en: 'Nothing was changed.' },
  'corr.mislukt': {
    nl: 'Corrigeren mislukt — er is niets gewijzigd',
    ar: 'فشل التصحيح — لم يتغيّر شيء',
    en: 'Correction failed — nothing was changed',
  },
  'corr.misluktVerbinding': {
    nl: 'Corrigeren mislukt — controleer je verbinding',
    ar: 'فشل التصحيح — تحقّق من اتصالك',
    en: 'Correction failed — check your connection',
  },
  'corr.gecorrigeerd': { nl: 'Factuur gecorrigeerd', ar: 'تم تصحيح الفاتورة', en: 'Invoice corrected' },
  'corr.opslaanBezig': { nl: 'Opslaan…', ar: 'جارٍ الحفظ…', en: 'Saving…' },
  'corr.opslaan': { nl: 'Correctie opslaan', ar: 'حفظ التصحيح', en: 'Save correction' },
  'corr.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },

  // SubPageHeader + DateFieldNL: one aria-label each.
  'nav.terug': { nl: 'Terug', ar: 'رجوع', en: 'Back' },
  'datum.kies': { nl: 'Kies een datum', ar: 'اختر تاريخاً', en: 'Pick a date' },

  // InfiniteList: empty/error/loading/end states of every infinite invoice list.
  'oneind.leeg': { nl: 'Geen facturen gevonden', ar: 'لم يُعثر على فواتير', en: 'No invoices found' },
  'oneind.vernieuwen': { nl: 'Vernieuwen…', ar: 'جارٍ التحديث…', en: 'Refreshing…' },
  'oneind.opnieuw': { nl: 'Opnieuw', ar: 'إعادة المحاولة', en: 'Retry' },
  'oneind.opnieuwAria': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'oneind.laden': { nl: 'Laden…', ar: 'جارٍ التحميل…', en: 'Loading…' },
  'oneind.alles': { nl: 'Alle facturen geladen', ar: 'تم تحميل كل الفواتير', en: 'All invoices loaded' },

  // Dashboard error boundary + 404.
  'fout.titel': { nl: 'Er is iets misgegaan', ar: 'حدث خطأ ما', en: 'Something went wrong' },
  'fout.uitleg': {
    nl: 'De pagina kon niet worden geladen. Probeer het opnieuw.',
    ar: 'تعذّر تحميل الصفحة. حاول مرة أخرى.',
    en: 'The page could not be loaded. Please try again.',
  },
  'fout.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'fout.naarDashboard': { nl: 'Naar dashboard', ar: 'إلى لوحة التحكم', en: 'To dashboard' },
  'fout404.titel': { nl: 'Niet gevonden', ar: 'لم يُعثر عليه', en: 'Not found' },
  'fout404.uitleg': {
    nl: 'Deze factuur, klant of pagina bestaat niet.',
    ar: 'هذه الفاتورة أو هذا العميل أو هذه الصفحة غير موجودة.',
    en: 'This invoice, customer or page does not exist.',
  },

  // ManageSubscriptionButton (settings/facturering).
  'abo.beheer': { nl: 'Beheer abonnement', ar: 'إدارة الاشتراك', en: 'Manage subscription' },
  'abo.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'abo.nietOpenen': {
    nl: 'Kon het abonnementenbeheer niet openen.',
    ar: 'تعذّر فتح إدارة الاشتراك.',
    en: 'Could not open subscription management.',
  },
  'abo.geenVerbinding': {
    nl: 'Geen verbinding. Probeer het opnieuw.',
    ar: 'لا يوجد اتصال. حاول مرة أخرى.',
    en: 'No connection. Please try again.',
  },

  // KlantDetailClient: the customer detail screen.
  'kld.nieuweFactuur': { nl: '+ Nieuwe factuur', ar: '+ فاتورة جديدة', en: '+ New invoice' },
  'kld.geenEmail': { nl: 'Geen e-mail', ar: 'لا بريد إلكتروني', en: 'No e-mail' },
  'kld.gefactureerd': { nl: 'Gefactureerd', ar: 'مفوتر', en: 'Invoiced' },
  'kld.openstaand': { nl: 'Openstaand', ar: 'مستحق', en: 'Outstanding' },
  'kld.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'kld.gegevens': { nl: 'Gegevens', ar: 'البيانات', en: 'Details' },
  'kld.adres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'kld.telefoon': { nl: 'Telefoon', ar: 'الهاتف', en: 'Phone' },
  'kld.termijn': { nl: 'Betaaltermijn', ar: 'مهلة الدفع', en: 'Payment term' },
  'kld.notities': { nl: 'Notities', ar: 'ملاحظات', en: 'Notes' },
  'kld.notitiesHint': {
    nl: 'Context over deze klant — afspraken, voorkeuren, afwijkende tarieven…',
    ar: 'معلومات عن هذا العميل — اتفاقات، تفضيلات، أسعار خاصة…',
    en: 'Context about this customer — agreements, preferences, special rates…',
  },
  // ── [BETAALGEDRAG] How this customer pays, computed instead of typed ──────────────────────────
  // The screen used to ask the owner to write "betaalgedrag" into a free-text note (kld.notitiesHint)
  // for a customer whose every invoice date, due date and bank-matched payment date the app holds.
  // Wording for client-payment-behaviour-copy.ts; the engine holds no sentence of its own.
  'betaalgedrag.kop': { nl: 'Betaalgedrag', ar: 'سلوك الدفع', en: 'Payment behaviour' },
  'betaalgedrag.traag': {
    nl: 'Betaalt gemiddeld na {dagen} dagen — dat is {over} dagen na de vervaldatum.',
    ar: 'يدفع بعد {dagen} يوماً في المتوسط — أي بعد تاريخ الاستحقاق بـ {over} يوماً.',
    en: 'Pays after {dagen} days on average — {over} days past the due date.',
  },
  'betaalgedrag.vroeg': {
    nl: 'Betaalt gemiddeld na {dagen} dagen — dat is {voor} dagen vóór de vervaldatum.',
    ar: 'يدفع بعد {dagen} يوماً في المتوسط — أي قبل تاريخ الاستحقاق بـ {voor} يوماً.',
    en: 'Pays after {dagen} days on average — {voor} days before the due date.',
  },
  'betaalgedrag.opTijd': {
    nl: 'Betaalt gemiddeld na {dagen} dagen: precies op de vervaldatum.',
    ar: 'يدفع بعد {dagen} يوماً في المتوسط: في تاريخ الاستحقاق بالضبط.',
    en: 'Pays after {dagen} days on average: exactly on the due date.',
  },
  'betaalgedrag.basisAllemaal': {
    nl: 'Op basis van {aantal} betaalde facturen, allemaal op tijd.',
    ar: 'استناداً إلى {aantal} فواتير مدفوعة، جميعها في وقتها.',
    en: 'Based on {aantal} paid invoices, all on time.',
  },
  'betaalgedrag.basis': {
    nl: 'Op basis van {aantal} betaalde facturen, waarvan {telaat} te laat. Langste: {traagste} dagen over de termijn.',
    ar: 'استناداً إلى {aantal} فواتير مدفوعة، منها {telaat} متأخرة. الأطول: {traagste} يوماً بعد المهلة.',
    en: 'Based on {aantal} paid invoices, {telaat} of them late. Longest: {traagste} days past the term.',
  },
  'betaalgedrag.openstaand': {
    nl: 'Nu openstaand: {aantal} facturen van samen {bedrag}. De oudste staat {dagen} dagen over de vervaldatum.',
    ar: 'مستحق الآن: {aantal} فواتير بمجموع {bedrag}. أقدمها متأخرة {dagen} يومًا عن تاريخ الاستحقاق.',
    en: 'Open right now: {aantal} invoices totalling {bedrag}. The oldest is {dagen} days past due.',
  },
  'betaalgedrag.openstaandEen': {
    nl: 'Nu openstaand: één factuur van {bedrag}, {dagen} dagen over de vervaldatum.',
    ar: 'مستحق الآن: فاتورة واحدة بقيمة {bedrag}، متأخرة {dagen} يومًا عن تاريخ الاستحقاق.',
    en: 'Open right now: one invoice of {bedrag}, {dagen} days past due.',
  },
  'betaalgedrag.caveat.zonderDatum': {
    nl: '{zonder} betaalde facturen tellen niet mee: er staat geen betaaldatum bij.',
    ar: '{zonder} فواتير مدفوعة غير محتسبة: لا تحمل تاريخ دفع.',
    en: '{zonder} paid invoices do not count: they carry no payment date.',
  },
  'betaalgedrag.caveat.zonderDatumEen': {
    nl: 'Eén betaalde factuur telt niet mee: er staat geen betaaldatum bij.',
    ar: 'فاتورة مدفوعة واحدة غير محتسبة: لا تحمل تاريخ دفع.',
    en: 'One paid invoice does not count: it carries no payment date.',
  },
  'betaalgedrag.caveat.onmogelijk': {
    nl: '{onmogelijk} facturen zijn betaald vóór hun eigen factuurdatum — die datum klopt niet.',
    ar: '{onmogelijk} فواتير دُفعت قبل تاريخ إصدارها — التاريخ غير صحيح.',
    en: '{onmogelijk} invoices were paid before their own invoice date — that date is wrong.',
  },
  'betaalgedrag.caveat.onmogelijkEen': {
    nl: 'Eén factuur is betaald vóór zijn eigen factuurdatum — die datum klopt niet.',
    ar: 'فاتورة واحدة دُفعت قبل تاريخ إصدارها — التاريخ غير صحيح.',
    en: 'One invoice was paid before its own invoice date — that date is wrong.',
  },
  // ── [LEVERANCIER-SALDO] Wat de winkel nog moet betalen, per leverancier ──────────────────
  //
  // Deze schermtaal komt van een foto van het pakket van een groothandel: hun "Openstaande
  // verkoopfacturen", gefilterd op klant 13168 — Kiwi Food Market. Dezelfde twee facturen die
  // BoekBrug als INKOOPfacturen heeft. De woorden hier beschrijven onze kant van precies dat.
  //
  // [TAAL] Een zelfstandig naamwoord in een zin is geen parameter: "vervallen" en "openstaand"
  // krijgen hun eigen sleutel per zin, want de Arabische en Turkse vormen verschillen per zin.
  'leveranciers.titel': {
    nl: 'Wat je nog moet betalen',
    ar: 'ما عليك دفعه',
    en: 'What you still owe',
    tr: 'Ödemeniz gerekenler',
  },
  'leveranciers.leeg': {
    nl: 'Er staat op dit moment niets open bij een leverancier.',
    ar: 'لا يوجد حاليًا أي مبلغ مستحق لأي مورّد.',
    en: 'Nothing is outstanding with a supplier right now.',
    tr: 'Şu anda hiçbir tedarikçiye ödenmemiş borcunuz yok.',
  },
  'leveranciers.totaal': {
    nl: 'Totaal openstaand',
    ar: 'إجمالي المستحق',
    en: 'Total outstanding',
    tr: 'Toplam ödenmemiş',
  },
  'leveranciers.peildatum': {
    nl: 'Stand op {datum}',
    ar: 'الوضع بتاريخ {datum}',
    en: 'As at {datum}',
    tr: '{datum} itibarıyla',
  },
  // De gevaarlijkste zin op dit scherm, en daarom staat hij er. Zonder gedateerde betaalregels is
  // het cijfer dat van VANDAAG, welke peildatum er ook boven staat.
  'leveranciers.basisHuidig': {
    nl: 'Dit is de stand van nu. Voor een stand op een datum in het verleden hebben we betaaldata per factuur nodig, en die ontbreken hier.',
    ar: 'هذا هو الوضع الحالي. لعرض الوضع في تاريخ سابق نحتاج تواريخ السداد لكل فاتورة، وهي غير متوفّرة هنا.',
    en: 'This is the position right now. A position on an earlier date needs a payment date per invoice, and those are missing here.',
    tr: 'Bu, şu anki durumdur. Geçmiş bir tarihteki durum için fatura başına ödeme tarihi gerekir; burada yoklar.',
  },
  'leveranciers.vervallen': {
    nl: 'waarvan {bedrag} vervallen',
    ar: 'منها {bedrag} متأخرة',
    en: 'of which {bedrag} overdue',
    tr: 'bunun {bedrag} tutarı vadesi geçmiş',
  },
  'leveranciers.oudste': {
    nl: 'oudste vervaldatum {datum}',
    ar: 'أقدم تاريخ استحقاق {datum}',
    en: 'oldest due date {datum}',
    tr: 'en eski vade {datum}',
  },
  'leveranciers.aantalFacturen': {
    nl: '{aantal} facturen',
    ar: '{aantal} فاتورة',
    en: '{aantal} invoices',
    tr: '{aantal} fatura',
  },
  'leveranciers.eenFactuur': {
    nl: '1 factuur',
    ar: 'فاتورة واحدة',
    en: '1 invoice',
    tr: '1 fatura',
  },
  'leveranciers.peildatumLabel': {
    nl: 'Peildatum',
    ar: 'تاريخ الرصد',
    en: 'As at date',
    tr: 'Referans tarihi',
  },
  'leveranciers.toon': {
    nl: 'Tonen',
    ar: 'إظهار',
    en: 'Show',
    tr: 'Göster',
  },
  'leveranciers.naarBank': {
    nl: 'Naar je bankafschriften',
    ar: 'إلى كشوفك البنكية',
    en: 'To your bank statements',
    tr: 'Banka ekstrelerinize',
  },
  'leveranciers.nietGelezen': {
    nl: 'We konden je inkoopfacturen nu niet lezen, dus staat hier geen bedrag. Dat betekent niet dat er niets openstaat. Probeer zo opnieuw.',
    ar: 'تعذّرت قراءة فواتير الشراء الآن، لذلك لا يظهر مبلغ هنا. هذا لا يعني أن لا شيء مستحق. أعد المحاولة بعد قليل.',
    en: 'We could not read your purchase invoices just now, so no amount is shown. That does not mean nothing is outstanding. Try again shortly.',
    tr: 'Alış faturalarınız şu anda okunamadı, bu yüzden burada tutar yok. Bu, borcunuz olmadığı anlamına gelmez. Birazdan tekrar deneyin.',
  },
  'leveranciers.ouderdom': {
    nl: 'Ouderdom',
    ar: 'التقادم',
    en: 'Aging',
    tr: 'Yaşlandırma',
  },
  'leveranciers.ouderdom.nietVervallen': {
    nl: 'Nog niet vervallen',
    ar: 'لم تستحقّ بعد',
    en: 'Not yet due',
    tr: 'Henüz vadesi gelmedi',
  },
  'leveranciers.ouderdom.zonderDatum': {
    nl: 'Zonder vervaldatum',
    ar: 'بدون تاريخ استحقاق',
    en: 'No due date',
    tr: 'Vade tarihi yok',
  },
  'leveranciers.onbevestigd': {
    nl: 'Daarnaast wachten {aantal} inkoopfacturen nog op je bevestiging. Die tellen hier bewust niet mee: ze zijn door de app gelezen en door niemand nagekeken.',
    ar: 'إضافةً إلى ذلك، هناك {aantal} فاتورة شراء تنتظر تأكيدك. هي غير محتسبة هنا عن قصد: قرأها التطبيق ولم يراجعها أحد.',
    en: 'On top of this, {aantal} purchase invoices are still waiting for your confirmation. They are deliberately not counted here: the app read them and nobody checked them.',
    tr: 'Ayrıca {aantal} alış faturası hâlâ onayınızı bekliyor. Bunlar bilinçli olarak sayılmadı: uygulama okudu, kimse kontrol etmedi.',
  },
  'leveranciers.zonderLeverancier': {
    nl: '{aantal} openstaande facturen ({bedrag}) konden we niet aan een leverancier koppelen. Ze tellen wel mee in het totaal.',
    ar: 'تعذّر ربط {aantal} فاتورة مفتوحة ({bedrag}) بأي مورّد. لكنها محتسبة ضمن الإجمالي.',
    en: '{aantal} open invoices ({bedrag}) could not be tied to a supplier. They do count in the total.',
    tr: '{aantal} açık fatura ({bedrag}) bir tedarikçiye bağlanamadı. Toplama dâhildirler.',
  },
  // ── [BETAALD-MAAR-WAAR] De betalingen die het afschrift nog niet kan bevestigen ───────────
  'betaalcheck.titel': {
    nl: 'Betalingen die we nog niet konden controleren',
    ar: 'دفعات لم نتمكّن من التحقّق منها بعد',
    en: 'Payments we could not check yet',
    tr: 'Henüz kontrol edemediğimiz ödemeler',
  },
  'betaalcheck.naDekking': {
    nl: 'Je hebt {aantal} facturen afgevinkt als betaald met een datum ná je nieuwste bankafschrift ({datum}). We kunnen ze pas nakijken als je het volgende afschrift inleest.',
    ar: 'وضعتَ علامة «مدفوعة» على {aantal} فاتورة بتاريخ بعد آخر كشف بنكي لديك ({datum}). لا يمكننا التحقّق منها حتى تُدخِل الكشف التالي.',
    en: 'You ticked {aantal} invoices as paid with a date after your newest bank statement ({datum}). We can only check them once you import the next statement.',
    tr: '{aantal} faturayı, en yeni banka ekstrenizden ({datum}) sonraki bir tarihle ödendi olarak işaretlediniz. Bir sonraki ekstreyi aktarana kadar kontrol edemeyiz.',
  },
  'betaalcheck.naDekkingEen': {
    nl: 'Je hebt 1 factuur afgevinkt als betaald met een datum ná je nieuwste bankafschrift ({datum}). We kunnen hem pas nakijken als je het volgende afschrift inleest.',
    ar: 'وضعتَ علامة «مدفوعة» على فاتورة واحدة بتاريخ بعد آخر كشف بنكي لديك ({datum}). لا يمكننا التحقّق منها حتى تُدخِل الكشف التالي.',
    en: 'You ticked 1 invoice as paid with a date after your newest bank statement ({datum}). We can only check it once you import the next statement.',
    tr: '1 faturayı, en yeni banka ekstrenizden ({datum}) sonraki bir tarihle ödendi olarak işaretlediniz. Bir sonraki ekstreyi aktarana kadar kontrol edemeyiz.',
  },
  'betaalcheck.geenAfschrift': {
    nl: 'Er is nog geen bankafschrift ingelezen, dus we kunnen geen enkele afgevinkte betaling nakijken.',
    ar: 'لم يُدخَل أي كشف بنكي بعد، لذا لا يمكننا التحقّق من أي دفعة مؤشَّرة.',
    en: 'No bank statement has been imported yet, so we cannot check a single ticked payment.',
    tr: 'Henüz hiçbir banka ekstresi aktarılmadı; bu yüzden işaretlenmiş hiçbir ödemeyi kontrol edemiyoruz.',
  },
  'betaalcheck.geenDatum': {
    nl: 'Bij {aantal} betalingen staat geen datum. Zonder datum kunnen we ze nergens tegen afzetten.',
    ar: 'هناك {aantal} دفعة بلا تاريخ. بدون تاريخ لا يمكننا مقارنتها بشيء.',
    en: '{aantal} payments carry no date. Without one there is nothing to hold them against.',
    tr: '{aantal} ödemede tarih yok. Tarih olmadan hiçbir şeyle karşılaştıramayız.',
  },
  'betaalcheck.voorDekking': {
    nl: '{aantal} afgevinkte betalingen liggen vóór je oudste afschrift ({datum}). Die blijven ongecontroleerd tenzij je een ouder afschrift inleest.',
    ar: '{aantal} دفعة مؤشَّرة تقع قبل أقدم كشف لديك ({datum}). ستبقى دون تحقّق ما لم تُدخِل كشفًا أقدم.',
    en: '{aantal} ticked payments fall before your oldest statement ({datum}). They stay unchecked unless you import an older one.',
    tr: '{aantal} işaretli ödeme, en eski ekstrenizden ({datum}) öncesine düşüyor. Daha eskisini aktarmazsanız kontrolsüz kalırlar.',
  },
  'betaalcheck.tekort': {
    nl: 'Volgens je boeken betaalde je {geclaimd} aan {leverancier}, terwijl je afschrift over dezelfde periode {betaald} laat vertrekken. Verschil: {verschil}.',
    ar: 'حسب دفاترك دفعتَ {geclaimd} إلى {leverancier}، بينما يُظهر كشفك خروج {betaald} في الفترة نفسها. الفرق: {verschil}.',
    en: 'Your books say you paid {geclaimd} to {leverancier}, while your statement shows {betaald} leaving over the same period. Difference: {verschil}.',
    tr: 'Defterlerinize göre {leverancier} firmasına {geclaimd} ödediniz; ekstreniz aynı dönemde {betaald} çıkış gösteriyor. Fark: {verschil}.',
  },
  'betaalcheck.klopt': {
    nl: 'Alles wat je als betaald hebt afgevinkt, past binnen wat er in die periode van je rekening is gegaan.',
    ar: 'كل ما أشّرتَه كمدفوع يقع ضمن ما خرج فعليًا من حسابك في تلك الفترة.',
    en: 'Everything you ticked as paid fits inside what actually left your account in that period.',
    tr: 'Ödendi olarak işaretlediğiniz her şey, o dönemde hesabınızdan çıkanın içinde kalıyor.',
  },
  'betaalgedrag.absent.geenFacturen': {
    nl: 'Nog geen facturen voor deze klant.',
    ar: 'لا توجد فواتير لهذا العميل بعد.',
    en: 'No invoices for this customer yet.',
  },
  'betaalgedrag.absent.nogNietsBetaald': {
    nl: 'Nog geen betaalde factuur, dus nog geen betaalgedrag.',
    ar: 'لا توجد فاتورة مدفوعة بعد، فلا سلوك دفع بعد.',
    en: 'No paid invoice yet, so no payment behaviour yet.',
  },
  'betaalgedrag.absent.geenBetaaldata': {
    nl: 'Bij de betaalde facturen staat geen betaaldatum, dus valt er niets te meten.',
    ar: 'الفواتير المدفوعة لا تحمل تاريخ دفع، فلا شيء يمكن قياسه.',
    en: 'The paid invoices carry no payment date, so there is nothing to measure.',
  },
  'betaalgedrag.absent.teWeinig': {
    nl: 'Nog te weinig betaalde facturen om iets te zeggen over het betaalgedrag.',
    ar: 'عدد الفواتير المدفوعة غير كافٍ للقول شيء عن سلوك الدفع.',
    en: 'Too few paid invoices to say anything about payment behaviour.',
  },
  'kld.opslaanMislukt': {
    nl: 'Opslaan mislukt — probeer opnieuw.',
    ar: 'فشل الحفظ — حاول مرة أخرى.',
    en: 'Saving failed — please try again.',
  },
  'kld.opslaanBezig': { nl: 'Opslaan…', ar: 'جارٍ الحفظ…', en: 'Saving…' },
  'kld.notitieOpslaan': { nl: 'Notitie opslaan', ar: 'حفظ الملاحظة', en: 'Save note' },
  'kld.geschiedenis': { nl: 'Factuurgeschiedenis', ar: 'سجل الفواتير', en: 'Invoice history' },
  'kld.nogGeen': {
    nl: 'Nog geen facturen voor deze klant.',
    ar: 'لا توجد فواتير لهذا العميل بعد.',
    en: 'No invoices for this customer yet.',
  },
  'kld.concept': { nl: 'Concept', ar: 'مسودة', en: 'Draft' },

  // Messages screen.
  // [BESTE] The customer card: every package opens the invoice from the customer, and offers the
  // customer's own edit from the same card.
  'kld.bewerken': { nl: 'Gegevens bewerken', ar: 'تعديل البيانات', en: 'Edit details' },
  'ber.zoek': { nl: 'Zoek op naam of bericht…', ar: 'ابحث بالاسم أو الرسالة…', en: 'Search by name or message…' },
  'ber.zoekAria': { nl: 'Berichten zoeken', ar: 'البحث في الرسائل', en: 'Search messages' },
  'ber.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'ber.ophaalFout': {
    nl: 'We konden je berichten nu niet ophalen. Probeer het zo meteen opnieuw.',
    ar: 'تعذّر جلب رسائلك الآن. حاول بعد قليل.',
    en: 'We could not fetch your messages right now. Please try again shortly.',
  },
  'ber.ophaalFoutEerlijk': {
    nl: 'Berichten niet opgehaald; dat zegt niets over of er berichten zijn. Probeer zo opnieuw.',
    ar: 'لم تُجلب الرسائل؛ وهذا لا يعني شيئًا عن وجود رسائل. حاول بعد قليل.',
    en: 'Messages not fetched; that says nothing about whether there are any. Try again shortly.',
  },
  'ber.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'ber.leeg': { nl: 'Nog geen berichten', ar: 'لا رسائل بعد', en: 'No messages yet' },
  'ber.leegHint': {
    nl: 'Stuur een bericht via de pagina van een klant of boekhouder',
    ar: 'أرسل رسالة من صفحة عميل أو محاسب',
    en: 'Send a message from a customer or accountant page',
  },
  'ber.nietsGevonden': {
    nl: 'Geen berichten gevonden voor “{query}”.',
    ar: 'لا رسائل مطابقة لـ «{query}».',
    en: 'No messages found for “{query}”.',
  },
  'ber.onbekend': { nl: 'Onbekend', ar: 'غير معروف', en: 'Unknown' },
  'ber.afgekapt': {
    nl: 'We tonen je meest recente gesprekken — oudere berichten staan er nog, maar passen niet in dit overzicht.',
    ar: 'نعرض أحدث محادثاتك — الرسائل الأقدم ما زالت موجودة لكنها لا تتسع في هذه القائمة.',
    en: 'We show your most recent conversations — older messages still exist, they just do not fit this overview.',
  },

  // FeedbackButton: the "something went wrong" flag on every dashboard page.
  'fb.aria': { nl: 'Er ging iets mis — stuur ons een bericht', ar: 'حدث خطأ — أرسل لنا رسالة', en: 'Something went wrong — send us a message' },
  'fb.titel': { nl: 'Er ging iets mis', ar: 'حدث خطأ', en: 'Something went wrong' },
  'fb.sluit': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'fb.uitleg': {
    nl: 'Schrijf kort wat er gebeurde. Een schermafbeelding helpt enorm — vaak zegt die meer dan een zin.',
    ar: 'اكتب باختصار ما حدث. لقطة الشاشة تساعد كثيرًا — وغالبًا تقول أكثر من جملة كاملة.',
    en: 'Briefly describe what happened. A screenshot helps enormously — it often says more than a sentence.',
  },
  'fb.padMee': {
    nl: 'Wij sturen automatisch mee dat je op {path} was.',
    ar: 'نرسل تلقائياً معلومة أنك كنت في {path}.',
    en: 'We automatically include that you were on {path}.',
  },
  'fb.voorbeeld': {
    nl: 'Bijvoorbeeld: ik druk op Bevestigen en de regel komt steeds terug.',
    ar: 'مثلًا: أضغط على «تأكيد» ويعود السطر في كل مرة.',
    en: 'For example: I press Confirm and the line keeps coming back.',
  },
  'fb.teGroot': { nl: 'Die afbeelding is te groot (max 5 MB).', ar: 'الصورة كبيرة جدًا (الحد 5 MB).', en: 'That image is too large (max 5 MB).' },
  'fb.nietLezen': {
    nl: 'We konden die afbeelding niet lezen. Probeer een andere.',
    ar: 'تعذّرت قراءة هذه الصورة. جرّب صورة أخرى.',
    en: 'We could not read that image. Try another one.',
  },
  'fb.bedankt': { nl: 'Bedankt — je melding is binnen.', ar: 'شكرًا — وصلتنا رسالتك.', en: 'Thanks — your report has arrived.' },
  'fb.mislukt': {
    nl: 'Versturen lukte niet. Probeer het zo meteen opnieuw — je bericht is nog niet bij ons.',
    ar: 'فشل الإرسال. حاول بعد قليل — رسالتك لم تصلنا بعد.',
    en: 'Sending failed. Try again shortly — your message has not reached us.',
  },
  'fb.andereAfbeelding': { nl: 'Andere afbeelding', ar: 'صورة أخرى', en: 'Different image' },
  'fb.afbeeldingToevoegen': { nl: 'Afbeelding toevoegen', ar: 'إضافة صورة', en: 'Add image' },
  'fb.versturenBezig': { nl: 'Versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'fb.versturen': { nl: 'Versturen', ar: 'إرسال', en: 'Send' },

  // Verkoop: the honest end of a seller link (access revoked by the employer).
  'vkp.titel': {
    nl: 'Je maakt geen facturen meer voor {bedrijf}',
    ar: 'لم تعد تُنشئ فواتير لـ {bedrijf}',
    en: 'You no longer create invoices for {bedrijf}',
  },
  'vkp.uitlegMetDatum': {
    nl: '{bedrijf} heeft je toegang op {datum} ingetrokken. Dat is een keuze van je werkgever en er is niets misgegaan met je account.',
    ar: 'سحب {bedrijf} صلاحية وصولك بتاريخ {datum}. هذا قرار صاحب العمل ولا يوجد أي خلل في حسابك.',
    en: '{bedrijf} revoked your access on {datum}. That is your employer’s choice and nothing is wrong with your account.',
  },
  'vkp.uitleg': {
    nl: '{bedrijf} heeft je toegang ingetrokken. Dat is een keuze van je werkgever en er is niets misgegaan met je account.',
    ar: 'سحب {bedrijf} صلاحية وصولك. هذا قرار صاحب العمل ولا يوجد أي خلل في حسابك.',
    en: '{bedrijf} revoked your access. That is your employer’s choice and nothing is wrong with your account.',
  },
  'vkp.nietWegKop': { nl: 'Je facturen zijn niet verwijderd.', ar: 'لم تُحذف فواتيرك.', en: 'Your invoices were not deleted.' },
  'vkp.nietWegRest': {
    nl: ' Ze horen bij de boekhouding van {bedrijf} en staan daar gewoon — met de nummers die ze bij het versturen hebben gekregen.',
    ar: ' هي جزء من دفاتر {bedrijf} وما زالت موجودة هناك — بالأرقام التي حصلت عليها عند الإرسال.',
    en: ' They belong to {bedrijf}’s books and are still there — with the numbers they received when sent.',
  },
  'vkp.vraag': {
    nl: 'Klopt dit niet? Vraag het aan {bedrijf} — alleen zij kunnen de toegang terugzetten. Je eigen account blijft van jou en werkt gewoon.',
    ar: 'هل هذا غير صحيح؟ اسأل {bedrijf} — هم وحدهم يستطيعون إعادة الصلاحية. حسابك الشخصي يبقى لك ويعمل كالمعتاد.',
    en: 'Does this seem wrong? Ask {bedrijf} — only they can restore the access. Your own account remains yours and keeps working.',
  },
  'vkp.werkgever': { nl: 'je werkgever', ar: 'صاحب العمل', en: 'your employer' },

  // Kluis: the compliance vault (year cards + the Bewaarkluis offer).
  'kluis.introArchief': {
    nl: 'Je archief per jaar: 7 jaar te bewaren voor de Belastingdienst, hier doorzoekbaar en per jaar te exporteren.',
    ar: 'أرشيفك حسب السنة: يُحفظ 7 سنوات لـ Belastingdienst (مصلحة الضرائب)، قابل للبحث هنا ويُصدَّر حسب السنة.',
    en: 'Your archive per year: to be kept 7 years for the Belastingdienst, searchable here and exportable per year.',
  },
  'kluis.introBoekhouden': {
    nl: 'Je administratie per jaar: 7 jaar te bewaren voor de Belastingdienst, hier klaar om met één knop te exporteren voor je boekhouder.',
    ar: 'دفاترك حسب السنة: تُحفظ 7 سنوات لـ Belastingdienst (مصلحة الضرائب)، جاهزة هنا لتصديرها بزر واحد لمحاسبك.',
    en: 'Your administration per year: to be kept 7 years for the Belastingdienst, ready here to export for your accountant with one button.',
  },
  'kluis.betaaldKop': { nl: 'Bedankt — je Bewaarkluis is geregeld.', ar: 'شكرًا — تم إعداد خزانة الحفظ (Bewaarkluis).', en: 'Thank you — your Bewaarkluis is arranged.' },
  'kluis.betaaldRest': {
    nl: 'Je btw-factuur staat klaar in je e-mail. Je archief blijft staan voor de resterende bewaarjaren, en exporteren blijft altijd werken.',
    ar: 'فاتورة ضريبة القيمة المضافة في بريدك الإلكتروني. يبقى أرشيفك محفوظًا لسنوات الحفظ المتبقية، والتصدير يعمل دائمًا.',
    en: 'Your VAT invoice is in your e-mail. Your archive stays for the remaining retention years, and exporting keeps working.',
  },
  'kluis.welkomKop': { nl: 'Welkom. Breng je administratie binnen.', ar: 'أهلاً بك. أدخِل دفاترك.', en: 'Welcome. Bring in your administration.' },
  'kluis.welkomUitleg': {
    nl: 'Upload je bonnen, facturen en bankafschriften, los of in één keer. Wij zetten ze per jaar en kwartaal op hun plek, doorzoekbaar, en elk jaar is met één knop als ZIP te exporteren.',
    ar: 'ارفع إيصالاتك وفواتيرك وكشوف بنكك، واحدة واحدة أو دفعة واحدة. نضعها في مكانها حسب السنة والربع، قابلة للبحث، وكل سنة تُصدَّر كملف ZIP بزر واحد.',
    en: 'Upload your receipts, invoices and bank statements, one by one or all at once. We file them per year and quarter, searchable, and each year can be exported as a ZIP with one button.',
  },
  // The arrow is directional and travels WITH the words: in Arabic "forward" points left.
  'kluis.welkomKnop': { nl: 'Bestanden toevoegen →', ar: 'إضافة ملفات ←', en: 'Add files →' },
  'kluis.leeg': {
    nl: 'Nog geen stukken in de kluis. Zodra je facturen verstuurt of bankafschriften en bonnen uploadt, verschijnen ze hier — netjes per jaar en kwartaal.',
    ar: 'لا مستندات في الخزانة بعد. حالما ترسل فواتير أو ترفع كشوف بنك وإيصالات، ستظهر هنا — مرتبة حسب السنة والربع.',
    en: 'No records in the vault yet. As soon as you send invoices or upload bank statements and receipts, they appear here — neatly per year and quarter.',
  },
  'kluis.exportMislukt': { nl: 'Export mislukt', ar: 'فشل التصدير', en: 'Export failed' },
  'kluis.bewarenTm': { nl: 'Bewaren t/m {year}', ar: 'الحفظ حتى {year}', en: 'Keep through {year}' },
  'kluis.nogJaar': { nl: ' · nog {years} jaar', ar: ' · السنوات المتبقية: {years}', en: ' · {years} more years' },
  'kluis.ditJaarAf': { nl: ' · dit jaar afloopt', ar: ' · ينتهي هذه السنة', en: ' · ends this year' },
  'kluis.verlopen': {
    nl: 'Bewaarplicht verlopen (sinds {year}) — mag weg',
    ar: 'انتهى واجب الحفظ (منذ {year}) — يمكن حذفه',
    en: 'Retention duty expired (since {year}) — may go',
  },
  'kluis.exporteerJaar': { nl: 'Exporteer jaar', ar: 'تصدير السنة', en: 'Export year' },
  'kluis.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'kluis.statUit': { nl: 'Facturen uit', ar: 'فواتير صادرة', en: 'Invoices out' },
  'kluis.statIn': { nl: 'Facturen in', ar: 'فواتير واردة', en: 'Invoices in' },
  'kluis.statAfschriften': { nl: 'Bankafschriften', ar: 'كشوف بنكية', en: 'Bank statements' },
  'kluis.statDocumenten': { nl: 'Documenten', ar: 'المستندات', en: 'Documents' },
  'kluis.qFact': { nl: '{count} fact.', ar: '{count} فاتورة', en: '{count} inv.' },
  'kluis.qGeenAfschr': { nl: '⚠ geen afschr.', ar: '⚠ لا كشوف', en: '⚠ no stmts.' },
  'kluis.qAfschr': { nl: '{count} afschr.', ar: '{count} كشف', en: '{count} stmts.' },
  'kluis.cardKop': { nl: 'Als je ooit stopt', ar: 'إذا توقفت يومًا', en: 'If you ever stop' },
  'kluis.cardUitleg': {
    nl: 'Je bewaarplicht loopt door als je onderneming of je BoekBrug-abonnement stopt. Na opzeggen bewaren wij je administratie nog {maanden} maanden kosteloos; exporteren blijft werken.',
    ar: 'واجب الحفظ يستمر إن توقف مشروعك أو اشتراكك في BoekBrug. بعد الإلغاء نحتفظ بإدارتك {maanden} شهرًا إضافيًا مجانًا؛ ويبقى التصدير يعمل.',
    en: 'Your retention duty continues when your business or your BoekBrug subscription stops. After cancelling we keep your administration {maanden} more months for free; exporting keeps working.',
  },
  'kluis.cardGeregeldKop': { nl: 'Je Bewaarkluis is geregeld.', ar: 'خزانة الحفظ (Bewaarkluis) مفعّلة.', en: 'Your Bewaarkluis is arranged.' },
  'kluis.cardGeregeldRest': {
    nl: ' Wij bewaren je administratie tot en met {year}. Je hoeft verder niets te doen — en exporteren blijft die hele tijd gewoon werken.',
    ar: ' نحفظ دفاترك حتى نهاية {year}. لا يلزمك فعل أي شيء آخر — والتصدير يعمل طوال تلك المدة.',
    en: ' We keep your administration through {year}. Nothing further is needed — and exporting keeps working the whole time.',
  },
  'kluis.cardVerstreken': {
    nl: 'Je bewaarplicht voor deze administratie is verstreken (t/m {year}). Je hoeft hier niets voor te betalen.',
    ar: 'انتهى واجب الحفظ لهذه الدفاتر (حتى {year}). لا يلزمك دفع أي شيء.',
    en: 'Your retention duty for this administration has expired (through {year}). There is nothing to pay here.',
  },
  'kluis.cardAanbod': {
    nl: 'Daarna online houden — geordend, doorzoekbaar, per jaar te exporteren? Daar is de Bewaarkluis voor. Je jongste boekjaar is {jaar}, dus je moet tot en met {tot} kunnen leveren.',
    ar: 'تريد إبقاءها متاحة بعد ذلك — مرتبة وقابلة للبحث وتُصدَّر حسب السنة؟ لهذا وُجدت خزانة الحفظ (Bewaarkluis). أحدث سنة مالية لديك هي {jaar}، فيجب أن تستطيع التسليم حتى نهاية {tot}.',
    en: 'Keep them online after that — ordered, searchable, exportable per year? That is what the Bewaarkluis is for. Your latest fiscal year is {jaar}, so you must be able to deliver through {tot}.',
  },
  'kluis.cardStatJaren': { nl: 'Resterende bewaarjaren', ar: 'سنوات الحفظ المتبقية', en: 'Remaining retention years' },
  'kluis.cardStatVooruit': { nl: 'Eenmalig vooruit', ar: 'دفعة واحدة مقدّمًا', en: 'One-time upfront' },
  'kluis.cardStatVooruitSub': { nl: 'in plaats van {bedrag} per jaar', ar: 'بدل {bedrag} سنويًا', en: 'instead of {bedrag} per year' },
  'kluis.cardStatArchief': { nl: 'Je archief weegt', ar: 'حجم أرشيفك', en: 'Your archive weighs' },
  'kluis.cardStatStukken': { nl: '{count} stukken', ar: '{count} مستند', en: '{count} records' },
  'kluis.cardKnop': { nl: 'Bewaarkluis regelen — {bedrag} eenmalig', ar: 'تفعيل خزانة الحفظ — {bedrag} لمرة واحدة', en: 'Arrange Bewaarkluis — {bedrag} one-time' },
  'kluis.cardFout': { nl: 'Er ging iets mis. Probeer het opnieuw.', ar: 'حدث خطأ ما. حاول مرة أخرى.', en: 'Something went wrong. Please try again.' },
  'kluis.cardGeenVerbinding': {
    nl: 'Geen verbinding. Controleer je internet en probeer opnieuw.',
    ar: 'لا يوجد اتصال. تحقّق من الإنترنت وحاول مجددًا.',
    en: 'No connection. Check your internet and try again.',
  },
  'kluis.cardVoetnoot': {
    nl: 'Wij nemen je bewaarplicht niet over: bewaar altijd je eigen kopie. Alles hier blijft van jou en is altijd te exporteren. Stoppen wij ooit: 90 dagen vooraf bericht, je archief toegestuurd, het niet-verbruikte deel terug.',
    ar: 'نحن لا نتولى واجب الحفظ عنك: احتفظ دائمًا بنسختك الخاصة. كل ما هنا يبقى ملكك ويمكن تصديره دائمًا. وإن توقفنا يومًا: إشعار قبل 90 يومًا، ويصلك أرشيفك، ويُردّ الجزء غير المستهلك.',
    en: 'We do not take over your retention duty: always keep your own copy. Everything here stays yours and can always be exported. Should we ever stop: 90 days\' notice, your archive sent to you, the unused part refunded.',
  },

  // Verdelen: one payment across several invoices.
  'verd.titel': { nl: 'Betaling verdelen', ar: 'توزيع الدفعة', en: 'Split payment' },
  // [TAAL] Two keys, not a {richting} parameter: the direction noun would break agreement.
  'verd.uitGeld': {
    nl: 'Geld dat wegging — kies welke facturen hiermee betaald zijn.',
    ar: 'مال خرج — اختر أي الفواتير دُفعت به.',
    en: 'Money that went out — choose which invoices it paid.',
  },
  'verd.inGeld': {
    nl: 'Geld dat binnenkwam — kies welke facturen hiermee betaald zijn.',
    ar: 'مال دخل — اختر أي الفواتير دُفعت به.',
    en: 'Money that came in — choose which invoices it paid.',
  },
  'verd.alVerdeeld': {
    nl: 'Deze betaling van {amount} is al helemaal verdeeld over facturen.',
    ar: 'هذه الدفعة البالغة {amount} وُزّعت بالكامل على فواتير.',
    en: 'This payment of {amount} is already fully split across invoices.',
  },
  'verd.alVerdeeldUitleg': {
    nl: 'Er valt hier niets meer toe te wijzen. Klopt de verdeling niet, ontkoppel dan eerst een factuur op de bankpagina — dan komt dat bedrag hier weer vrij.',
    ar: 'لا شيء متبقٍ للتوزيع هنا. إن كان التوزيع خاطئًا، فألغِ ربط فاتورة في صفحة البنك أولًا — فيتحرر ذلك المبلغ هنا من جديد.',
    en: 'There is nothing left to assign. If the split is wrong, first unlink an invoice on the bank page — that amount then becomes available here again.',
  },
  'verd.terugBank': { nl: 'Terug naar de bank', ar: 'العودة إلى البنك', en: 'Back to the bank' },
  'verd.geboekt.titel': { nl: 'Deze bankregel is al geboekt', ar: 'سطر البنك هذا محجوز بالفعل', en: 'This bank line is already booked' },
  'verd.geboekt.titelGenegeerd': { nl: 'Deze bankregel is genegeerd', ar: 'تم تجاهل سطر البنك هذا', en: 'This bank line was ignored' },
  'verd.geboekt.uitleg': { nl: 'Dit is er op geboekt — elke koppeling draai je op de factuur met één tik terug.', ar: 'هذا ما سُجّل عليه — يمكنك التراجع عن أي ربط من الفاتورة بنقرة واحدة.', en: 'This is what was booked on it — undo any link from the invoice with one tap.' },
  'verd.geboekt.genegeerdUitleg': { nl: 'Je hebt deze regel eerder als "geen factuur" gemarkeerd. Terughalen kan vanuit de banklijst.', ar: 'سبق أن علّمت هذا السطر كـ«ليس فاتورة». يمكن استرجاعه من قائمة البنك.', en: 'You previously marked this line as "not an invoice". You can restore it from the bank list.' },
  'verd.geboekt.zonderNummer': { nl: 'Factuur zonder nummer', ar: 'فاتورة بلا رقم', en: 'Invoice without a number' },
  'verd.onbekendeTegenpartij': { nl: 'Onbekende tegenpartij', ar: 'طرف مقابل غير معروف', en: 'Unknown counterparty' },
  'verd.geenOmschrijving': { nl: 'geen omschrijving', ar: 'بلا وصف', en: 'no description' },
  'verd.nogTeVerdelen': { nl: 'Nog te verdelen', ar: 'المتبقي للتوزيع', en: 'Still to split' },
  // [NO-SILENT-EMPTY] Een bedrag dat we niet konden vaststellen, gezegd als zodanig. Hier stond
  // een 0, en een 0 op een bewijsscherm is geen ontbrekend getal maar een verkeerd getal.
  'verd.bedragOnbekend': { nl: 'bedrag niet te lezen', ar: 'تعذّرت قراءة المبلغ', en: 'amount could not be read' },
  'verd.alGekoppeld': {
    nl: '{amount} van deze betaling was al gekoppeld.',
    ar: '{amount} من هذه الدفعة كان مرتبطًا من قبل.',
    en: '{amount} of this payment was already linked.',
  },
  'verd.zoek': { nl: 'Zoek op leverancier of factuurnummer…', ar: 'ابحث بالمورّد أو رقم الفاتورة…', en: 'Search by supplier or invoice number…' },
  'verd.zoekAria': { nl: 'Facturen zoeken', ar: 'البحث في الفواتير', en: 'Search invoices' },
  // [TAAL] Two keys per direction, same agreement argument as above.
  'verd.geenInkoop': {
    nl: 'Geen enkele inkoopfactuur staat open. Staat hij er nog niet in, voeg hem dan eerst toe — deze betaling blijft zolang staan.',
    ar: 'لا توجد أي فاتورة مشتريات مفتوحة. إن لم تكن مُدخلة بعد فأضفها أولًا — هذه الدفعة تبقى في الانتظار.',
    en: 'No purchase invoice is open at all. If it is not in yet, add it first — this payment stays put meanwhile.',
  },
  'verd.geenVerkoop': {
    nl: 'Geen enkele verkoopfactuur staat open. Staat hij er nog niet in, voeg hem dan eerst toe — deze betaling blijft zolang staan.',
    ar: 'لا توجد أي فاتورة مبيعات مفتوحة. إن لم تكن مُدخلة بعد فأضفها أولًا — هذه الدفعة تبقى في الانتظار.',
    en: 'No sales invoice is open at all. If it is not in yet, add it first — this payment stays put meanwhile.',
  },
  'verd.geenMatch': { nl: 'Geen factuur die daaraan voldoet.', ar: 'لا توجد فاتورة تطابق ذلك.', en: 'No invoice matches that.' },
  'verd.factuurWoord': { nl: 'factuur', ar: 'فاتورة', en: 'invoice' },
  'verd.kiezenAria': { nl: '{name} kiezen', ar: 'اختيار {name}', en: 'Choose {name}' },
  'verd.credit': { nl: 'creditnota — gaat eraf', ar: 'إشعار دائن — يُخصم', en: 'credit note — comes off' },
  'verd.zonderNummer': { nl: 'zonder nummer', ar: 'بدون رقم', en: 'without a number' },
  'verd.nogOpen': { nl: 'nog open {amount}', ar: 'متبقٍ {amount}', en: '{amount} still open' },
  'verd.bedragAria': { nl: 'Bedrag voor {name}', ar: 'المبلغ لـ {name}', en: 'Amount for {name}' },
  'verd.blijftOpen': { nl: 'blijft {amount} open', ar: 'يبقى {amount} مفتوحًا', en: '{amount} stays open' },
  'verd.nietGeboekt': { nl: 'De verdeling is niet geboekt.', ar: 'لم يُسجَّل التوزيع.', en: 'The split was not booked.' },
  'verd.misgegaan': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'verd.afgeboektEen': { nl: '1 factuur afgeboekt.', ar: 'سُوّيت فاتورة واحدة.', en: '1 invoice settled.' },
  'verd.afgeboekt': { nl: '{count} facturen afgeboekt.', ar: 'سُوّيت {count} فاتورة.', en: '{count} invoices settled.' },
  'verd.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'verd.geboekt': { nl: 'Geboekt', ar: 'مسجّلة', en: 'Booked' },
  'verd.boekEen': { nl: 'Boek 1 factuur', ar: 'تسجيل فاتورة واحدة', en: 'Book 1 invoice' },
  'verd.boek': { nl: 'Boek {count} facturen', ar: 'تسجيل {count} فاتورة', en: 'Book {count} invoices' },
  'verd.voetnoot': {
    nl: 'Een factuur die deels betaald is, blijft voor de rest openstaan; er wordt niets weggeschreven. De rest van de betaling blijft ook staan, en ontkoppelen kan altijd.',
    ar: 'الفاتورة المدفوعة جزئيًا يبقى باقيها مفتوحًا؛ لا يُشطب شيء. وباقي الدفعة يبقى أيضًا، وإلغاء الربط ممكن دائمًا.',
    en: 'An invoice that is partly paid stays open for the rest; nothing is written off. The rest of the payment stays too, and unlinking is always possible.',
  },

  // BankConnectPanel: the Enable Banking connect card on the bank page.
  'bkc.nogNiet': { nl: 'nog niet', ar: 'ليس بعد', en: 'not yet' },
  'bkc.verlopen': {
    nl: 'De toestemming is verlopen — koppel opnieuw om transacties te blijven ontvangen.',
    ar: 'انتهت صلاحية الإذن — أعد الربط ليستمر وصول المعاملات.',
    en: 'The consent has expired — reconnect to keep receiving transactions.',
  },
  'bkc.verlooptVandaag': { nl: 'De toestemming verloopt vandaag — koppel opnieuw.', ar: 'ينتهي الإذن اليوم — أعد الربط.', en: 'The consent expires today — reconnect.' },
  'bkc.verlooptMorgen': { nl: 'De toestemming verloopt morgen — koppel opnieuw.', ar: 'ينتهي الإذن غدًا — أعد الربط.', en: 'The consent expires tomorrow — reconnect.' },
  'bkc.verlooptOver': {
    nl: 'De toestemming verloopt over {days} dagen — koppel opnieuw.',
    ar: 'ينتهي الإذن بعد {days} يوم — أعد الربط.',
    en: 'The consent expires in {days} days — reconnect.',
  },
  'bkc.geldigDagen': {
    nl: 'Toestemming geldig tot en met {days} dagen vanaf nu.',
    ar: 'الإذن صالح لمدة {days} يومًا من الآن.',
    en: 'Consent valid through {days} days from now.',
  },
  'bkc.geldigTot': { nl: 'Toestemming geldig tot {date}.', ar: 'الإذن صالح حتى {date}.', en: 'Consent valid until {date}.' },
  'bkc.laatstOpgehaald': { nl: 'Laatst opgehaald: {time}', ar: 'آخر جلب: {time}', en: 'Last fetched: {time}' },
  'bkc.pending': { nl: 'Nog niet afgerond bij je bank.', ar: 'لم يكتمل بعد لدى بنكك.', en: 'Not yet completed at your bank.' },
  'bkc.expired': { nl: 'De toestemming is verlopen.', ar: 'انتهت صلاحية الإذن.', en: 'The consent has expired.' },
  'bkc.error': { nl: 'Er ging iets mis bij het ophalen.', ar: 'حدث خطأ أثناء الجلب.', en: 'Something went wrong while fetching.' },
  'bkc.revoked': { nl: 'Losgekoppeld.', ar: 'مفصول.', en: 'Disconnected.' },
  'bkc.banklijstFout': { nl: 'De banklijst kon niet geladen worden.', ar: 'تعذّر تحميل قائمة البنوك.', en: 'The bank list could not be loaded.' },
  'bkc.koppelenMislukt': { nl: 'Koppelen mislukt.', ar: 'فشل الربط.', en: 'Connecting failed.' },
  'bkc.ophalenMislukt': { nl: 'Ophalen mislukt.', ar: 'فشل الجلب.', en: 'Fetching failed.' },
  'bkc.metWaarschuwingenEen': {
    nl: '{inserted} nieuwe transacties. Let op: 1 regel kon niet gelezen worden.',
    ar: '{inserted} معاملة جديدة. تنبيه: سطر واحد تعذّرت قراءته.',
    en: '{inserted} new transactions. Note: 1 line could not be read.',
  },
  'bkc.metWaarschuwingen': {
    nl: '{inserted} nieuwe transacties. Let op: {warnings} regels konden niet gelezen worden.',
    ar: '{inserted} معاملة جديدة. تنبيه: {warnings} سطرًا تعذّرت قراءتها.',
    en: '{inserted} new transactions. Note: {warnings} lines could not be read.',
  },
  'bkc.teSnel': {
    nl: 'Je bank staat een beperkt aantal opvragingen per dag toe. Morgen halen we automatisch de rest op.',
    ar: 'بنكك يسمح بعدد محدود من الاستعلامات يوميًا. غدًا نجلب الباقي تلقائيًا.',
    en: 'Your bank allows a limited number of requests per day. Tomorrow we fetch the rest automatically.',
  },
  'bkc.opgehaald': { nl: '{inserted} nieuwe transacties opgehaald.', ar: 'جُلبت {inserted} معاملة جديدة.', en: '{inserted} new transactions fetched.' },
  'bkc.geenNieuwe': { nl: 'Geen nieuwe transacties bij je bank.', ar: 'لا توجد معاملات جديدة لدى بنكك.', en: 'No new transactions at your bank.' },
  'bkc.ontkoppelenMislukt': { nl: 'Ontkoppelen mislukt.', ar: 'فشل إلغاء الربط.', en: 'Disconnecting failed.' },
  'bkc.ontkoppeld': {
    nl: 'Bank ontkoppeld. Je transacties blijven bewaard.',
    ar: 'فُصل البنك. معاملاتك تبقى محفوظة.',
    en: 'Bank disconnected. Your transactions remain stored.',
  },
  'bkc.koppelKop': { nl: 'Koppel je bank', ar: 'اربط بنكك', en: 'Connect your bank' },
  'bkc.koppelSub': {
    nl: 'Dan komen je transacties automatisch binnen en hoef je geen afschrift meer te uploaden.',
    ar: 'فتصل معاملاتك تلقائياً ولا تحتاج إلى رفع كشوف بعد الآن.',
    en: 'Your transactions then arrive automatically and you no longer upload statements.',
  },
  'bkc.kiesBank': { nl: 'Kies je bank', ar: 'اختر بنكك', en: 'Choose your bank' },
  'bkc.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bkc.leesrechten': {
    nl: 'Je logt straks in bij je eigen bank. BoekBrug krijgt alleen leesrechten op je transacties — nooit de mogelijkheid om geld over te maken.',
    ar: 'ستسجّل الدخول لدى بنكك مباشرة. يحصل BoekBrug على صلاحية قراءة معاملاتك فقط — لا إمكانية تحويل أموال أبدًا.',
    en: 'You will log in at your own bank. BoekBrug only gets read access to your transactions — never the ability to transfer money.',
  },
  'bkc.bankenLaden': { nl: 'Banken laden…', ar: 'جارٍ تحميل البنوك…', en: 'Loading banks…' },
  'bkc.geenBanken': {
    nl: 'Er zijn nu geen banken beschikbaar. Upload je afschrift zoals je gewend bent.',
    ar: 'لا بنوك متاحة حاليًا. ارفع كشفك كما اعتدت.',
    en: 'No banks are available right now. Upload your statement as you are used to.',
  },
  'bkc.rekening': { nl: 'Rekening', ar: 'حساب', en: 'Account' },
  'bkc.bijgewerktTm': { nl: ' · bijgewerkt t/m {date}', ar: ' · محدَّث حتى {date}', en: ' · updated through {date}' },
  'bkc.opnieuwKoppelen': { nl: 'Opnieuw koppelen', ar: 'إعادة الربط', en: 'Reconnect' },
  'bkc.dagLimiet': {
    nl: 'Je bank staat een beperkt aantal opvragingen per dag toe.',
    ar: 'بنكك يسمح بعدد محدود من الاستعلامات يومياً.',
    en: 'Your bank allows a limited number of requests per day.',
  },
  'bkc.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'bkc.ververs': { nl: 'Vernieuwen', ar: 'تحديث', en: 'Refresh' },
  'bkc.ontkoppelen': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Disconnect' },
  'bkc.afschriftNodig': {
    nl: 'Je transacties komen nu automatisch binnen. Het originele bankafschrift krijgen we niet van je bank — upload dat per kwartaal, dan is het pakket voor je boekhouder compleet.',
    ar: 'معاملاتك تصل الآن تلقائيًا. كشف الحساب الأصلي لا يصلنا من بنكك — ارفعه كل ربع سنة، فيكتمل الملف لمحاسبك.',
    en: 'Your transactions now arrive automatically. The original bank statement we do not get from your bank — upload it per quarter, and your accountant\'s package is complete.',
  },

  // SnelStartCard: the SnelStart link card on Settings. SnelStart's own menu names
  // (Onderhoud → Maatwerk) stay Dutch in every language — a sentence that points at a
  // button names the button as it is written.
  'ss.uitleg': {
    nl: 'Stuur je gecontroleerde facturen en bonnen rechtstreeks als inkoop- en verkoopboeking naar je SnelStart-administratie. Alleen gecontroleerde facturen gaan mee, elk maar één keer.',
    ar: 'أرسل فواتيرك وإيصالاتك المدقَّقة مباشرة كقيود مشتريات ومبيعات إلى إدارة SnelStart لديك. تذهب الفواتير المدقَّقة فقط، وكل واحدة مرة واحدة.',
    en: 'Send your checked invoices and receipts straight to your SnelStart administration as purchase and sales bookings. Only checked invoices go along, each only once.',
  },
  'ss.sleutelOud': {
    nl: 'SnelStart accepteert je maatwerksleutel niet meer. Maak in SnelStart een nieuwe sleutel aan en plak die hieronder.',
    ar: 'لم يعد SnelStart يقبل مفتاحك المخصص. أنشئ مفتاحًا جديدًا في SnelStart والصقه أدناه.',
    en: 'SnelStart no longer accepts your custom key. Create a new key in SnelStart and paste it below.',
  },
  'ss.sleutel': { nl: 'Maatwerksleutel', ar: 'المفتاح المخصص (maatwerksleutel)', en: 'Custom key (maatwerksleutel)' },
  'ss.sleutelHint': { nl: 'Plak hier je sleutel uit SnelStart', ar: 'الصق هنا مفتاحك من SnelStart', en: 'Paste your key from SnelStart here' },
  'ss.sleutelWaar': {
    nl: 'In SnelStart: Onderhoud → Maatwerk → maak een koppelsleutel aan. De sleutel geldt voor één administratie en wordt versleuteld bewaard.',
    ar: 'في SnelStart: ‏Onderhoud ← Maatwerk ← أنشئ مفتاح ربط. المفتاح يخص إدارة واحدة ويُحفظ مشفَّراً.',
    en: 'In SnelStart: Onderhoud → Maatwerk → create a link key. The key covers one administration and is stored encrypted.',
  },
  'ss.adminNaam': { nl: 'Naam van de administratie (optioneel)', ar: 'اسم الإدارة (اختياري)', en: 'Administration name (optional)' },
  'ss.adminNaamHint': { nl: 'Bijv. Bakkerij 2026', ar: 'مثلًا: Bakkerij 2026', en: 'E.g. Bakery 2026' },
  'ss.controleren': { nl: 'Controleren…', ar: 'جارٍ التحقق…', en: 'Checking…' },
  'ss.koppelen': { nl: 'Koppelen met SnelStart', ar: 'الربط مع SnelStart', en: 'Connect with SnelStart' },
  'ss.koppelenMislukt': { nl: 'Koppelen mislukt', ar: 'فشل الربط', en: 'Connecting failed' },
  'ss.gekoppeldKies': {
    nl: 'SnelStart is gekoppeld. Kies nu op welke rekeningen geboekt moet worden.',
    ar: 'تم الربط مع SnelStart. اختر الآن الحسابات التي سيُسجَّل عليها.',
    en: 'SnelStart is connected. Now choose which accounts to book onto.',
  },
  'ss.gekoppeld': { nl: '✓ Gekoppeld', ar: '✓ مربوط', en: '✓ Connected' },
  'ss.doorgestuurd': { nl: '{count} doorgestuurd', ar: '{count} أُعيد توجيهها', en: '{count} forwarded' },
  'ss.zonderBevestiging': {
    nl: '{count} zonder bevestiging — controleer in SnelStart',
    ar: '{count} بلا تأكيد — تحقّق في SnelStart',
    en: '{count} without confirmation — check in SnelStart',
  },
  'ss.mislukt': { nl: '{count} mislukt', ar: '{count} فشلت', en: '{count} failed' },
  'ss.wachtAkkoord': { nl: '{count} wacht op je akkoord', ar: '{count} بانتظار موافقتك', en: '{count} awaiting your approval' },
  'ss.wachtKop': { nl: 'Wacht op je akkoord', ar: 'بانتظار موافقتك', en: 'Awaiting your approval' },
  'ss.wachtUitleg': {
    nl: 'Deze facturen zouden een boeking worden, maar er staat nog een voorbehoud op. Kijk op het papier en stuur ze door als het klopt — daarna kan je boekhouder ze niet meer terugdraaien.',
    ar: 'هذه الفواتير كانت ستصبح قيودًا، لكن ما زال عليها تحفّظ. انظر إلى الورقة وأرسلها إن كانت صحيحة — بعدها لا يستطيع محاسبك التراجع عنها.',
    en: 'These invoices would become bookings, but a reservation still stands. Look at the paper and forward them if it is right — after that your accountant cannot reverse them.',
  },
  'ss.akkoordBezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'ss.akkoordKnop': { nl: 'Ik weet het, stuur toch door', ar: 'أنا متأكد، أرسلها رغم ذلك', en: 'I know — send it anyway' },
  'ss.akkoordMislukt': { nl: 'Akkoord opslaan mislukt', ar: 'فشل حفظ الموافقة', en: 'Saving the approval failed' },
  'ss.akkoordVast': {
    nl: 'Akkoord vastgelegd — deze factuur gaat mee met de volgende keer doorsturen.',
    ar: 'سُجّلت الموافقة — سترافق هذه الفاتورة الإرسال القادم.',
    en: 'Approval recorded — this invoice goes along with the next forward.',
  },
  'ss.geenVoorbehoud': { nl: 'Er stond geen voorbehoud meer open.', ar: 'لم يعد هناك أي تحفظ مفتوح.', en: 'No reservation remained open.' },
  'ss.geenVerbindingAkkoord': {
    nl: 'Geen verbinding — er is niets vastgelegd.',
    ar: 'لا اتصال — لم يُسجَّل شيء.',
    en: 'No connection — nothing was recorded.',
  },
  'ss.kiesEerst': {
    nl: 'Kies eerst de rekeningen waarop geboekt moet worden.',
    ar: 'اختر أولًا الحسابات التي سيُسجَّل عليها.',
    en: 'First choose the accounts to book onto.',
  },
  'ss.inkoopOp': { nl: 'Inkoop boeken op', ar: 'تسجيل المشتريات على', en: 'Book purchases onto' },
  'ss.verkoopOp': { nl: 'Verkoop boeken op', ar: 'تسجيل المبيعات على', en: 'Book sales onto' },
  'ss.kiesRekening': { nl: 'Kies een rekening…', ar: 'اختر حسابًا…', en: 'Choose an account…' },
  'ss.grootboekenMislukt': { nl: 'Grootboeken ophalen mislukt', ar: 'فشل جلب حسابات الأستاذ', en: 'Fetching ledger accounts failed' },
  'ss.opslaanBezig': { nl: 'Opslaan…', ar: 'جارٍ الحفظ…', en: 'Saving…' },
  'ss.rekeningenOpslaan': { nl: 'Rekeningen opslaan', ar: 'حفظ الحسابات', en: 'Save accounts' },
  'ss.opslaanMislukt': { nl: 'Opslaan mislukt', ar: 'فشل الحفظ', en: 'Saving failed' },
  'ss.rekeningenOpgeslagen': { nl: 'Rekeningen opgeslagen.', ar: 'حُفظت الحسابات.', en: 'Accounts saved.' },
  'ss.boekenBezig': { nl: 'Bezig met boeken…', ar: 'جارٍ التسجيل…', en: 'Booking…' },
  'ss.nietsTeVersturen': { nl: 'Niets te versturen', ar: 'لا شيء للإرسال', en: 'Nothing to send' },
  'ss.stuurDoorEen': { nl: 'Stuur 1 factuur door', ar: 'أرسل فاتورة واحدة', en: 'Forward 1 invoice' },
  'ss.stuurDoor': { nl: 'Stuur {count} facturen door', ar: 'أرسل {count} فاتورة', en: 'Forward {count} invoices' },
  'ss.doorsturenMislukt': { nl: 'Doorsturen mislukt', ar: 'فشل إعادة التوجيه', en: 'Forwarding failed' },
  'ss.nogTeGaan': { nl: ' Nog {count} te gaan.', ar: ' بقي {count}.', en: ' {count} to go.' },
  'ss.deelsGelukt': { nl: '{pushed} geboekt, {failed} niet gelukt.', ar: 'سُجّلت {pushed}، وفشلت {failed}.', en: '{pushed} booked, {failed} failed.' },
  'ss.geboektEen': { nl: '1 factuur geboekt in SnelStart.', ar: 'سُجّلت فاتورة واحدة في SnelStart.', en: '1 invoice booked in SnelStart.' },
  'ss.geboekt': { nl: '{count} facturen geboekt in SnelStart.', ar: 'سُجّلت {count} فاتورة في SnelStart.', en: '{count} invoices booked in SnelStart.' },
  'ss.ontkoppelen': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Disconnect' },
  'ss.ontkoppeld': { nl: 'De koppeling met SnelStart is verbroken.', ar: 'قُطع الربط مع SnelStart.', en: 'The SnelStart link is disconnected.' },
  'ss.laatstDoorgestuurd': { nl: 'Laatst doorgestuurd op {time}.', ar: 'آخر إعادة توجيه في {time}.', en: 'Last forwarded on {time}.' },
  'ss.zonderNummer': { nl: 'Zonder nummer', ar: 'بدون رقم', en: 'Without a number' },

  // [MOLLIE] Instellingenkaart: iDEAL-betaallinks via het eigen Mollie-account van de eigenaar.
  'mollie.titel': { nl: 'iDEAL-betalingen (Mollie)', ar: 'مدفوعات iDEAL ‏(Mollie)', en: 'iDEAL payments (Mollie)' },
  'mollie.uitleg': { nl: 'Koppel je eigen Mollie-account: je klanten krijgen dan een "Betaal met iDEAL"-knop op elke factuur. Het geld gaat rechtstreeks naar jouw Mollie-account en de factuur wordt automatisch op betaald gezet.', ar: 'اربط حساب Mollie الخاص بك: يحصل عملاؤك عندها على زر «ادفع عبر iDEAL» في كل فاتورة. يذهب المال مباشرة إلى حساب Mollie الخاص بك وتُعلَّم الفاتورة كمدفوعة تلقائيًا.', en: 'Connect your own Mollie account: your customers then get a "Pay with iDEAL" button on every invoice. The money goes straight to your Mollie account and the invoice is marked paid automatically.' },
  'mollie.sleutel': { nl: 'Mollie API-sleutel', ar: 'مفتاح Mollie API', en: 'Mollie API key' },
  'mollie.sleutelHint': { nl: 'Te vinden in je Mollie-dashboard onder Developers → API-sleutels (live_…).', ar: 'تجده في لوحة Mollie تحت Developers ← API-keys ‏(live_…).', en: 'Found in your Mollie dashboard under Developers → API keys (live_…).' },
  'mollie.koppel': { nl: 'Koppelen', ar: 'ربط', en: 'Connect' },
  'mollie.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'mollie.gekoppeld': { nl: 'Gekoppeld sinds {date}. Klanten zien de iDEAL-knop op de betaalpagina.', ar: 'مرتبط منذ {date}. يرى العملاء زر iDEAL في صفحة الدفع.', en: 'Connected since {date}. Customers see the iDEAL button on the payment page.' },
  'mollie.ontkoppel': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Disconnect' },
  'mollie.mislukt': { nl: 'Koppelen is niet gelukt.', ar: 'لم ينجح الربط.', en: 'Connecting failed.' },

  // Bestanden shared components (tree, cards, upload, preview, bulk bar).
  'bst.uitklappen': { nl: 'Uitklappen', ar: 'توسيع', en: 'Expand' },
  'bst.naamWijzigen': { nl: 'Naam wijzigen', ar: 'إعادة التسمية', en: 'Rename' },
  'bst.verwijderen': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'bst.meerOpties': { nl: 'Meer opties', ar: 'خيارات أكثر', en: 'More options' },
  'bst.gedeeldStop': {
    nl: 'Gedeeld met boekhouder — tik om te stoppen',
    ar: 'مُشارَك مع المحاسب — انقر للإيقاف',
    en: 'Shared with your accountant — tap to stop',
  },
  'bst.delen': { nl: 'Delen met boekhouder', ar: 'مشاركة مع المحاسب', en: 'Share with your accountant' },
  'bst.nietDelen': { nl: 'Niet meer delen', ar: 'إيقاف المشاركة', en: 'Stop sharing' },
  'bst.openMap': { nl: 'Open map: {folder}', ar: 'افتح المجلد: {folder}', en: 'Open folder: {folder}' },
  'bst.openMijn': { nl: 'Open in Mijn bestanden', ar: 'افتح في «ملفاتي»', en: 'Open in My files' },
  'bst.mijnBestanden': { nl: 'Mijn bestanden', ar: 'ملفاتي', en: 'My files' },
  'bst.uploadMislukt': { nl: 'Upload mislukt', ar: 'فشل الرفع', en: 'Upload failed' },
  'bst.onbekendeFout': { nl: 'Onbekende fout', ar: 'خطأ غير معروف', en: 'Unknown error' },
  'bst.loslaten': { nl: 'Loslaten om te uploaden', ar: 'أفلت للرفع', en: 'Release to upload' },
  'bst.typenMax': {
    nl: 'Alle bestandstypen — max 50MB · meerdere bestanden tegelijk',
    ar: 'كل أنواع الملفات — الحد الأقصى 50MB · عدة ملفات معًا',
    en: 'All file types — max 50MB · multiple files at once',
  },
  'bst.sleep': {
    nl: 'Sleep bestanden of tik om te uploaden',
    ar: 'اسحب الملفات أو انقر للرفع',
    en: 'Drag files or tap to upload',
  },
  'bst.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'bst.previewNiet': { nl: 'Preview niet beschikbaar', ar: 'المعاينة غير متاحة', en: 'Preview not available' },
  'bst.geselecteerd': { nl: '{count} geselecteerd', ar: '{count} محدَّد', en: '{count} selected' },
  'bst.selectieWissen': { nl: 'Selectie wissen', ar: 'مسح التحديد', en: 'Clear selection' },

  // ─── [PAY-REDEN] Waarom afboeken of terugdraaien niet lukte ─────────────────────────────────
  //
  // One line per code /api/invoice/pay-toggle can refuse with. Three screens ask that route and
  // each used to answer differently — /vandaag showed the bare code, so a shop owner read
  // "invoice_already_paid" on their phone, in Dutch as well as in Arabic. The mapping lives in
  // pay-toggle-reason.ts; these are the words.
  //
  // Each line is a REASON, not an apology: it says what happened and, where the owner can do
  // something, what. "Ververs de pagina" is an instruction; "er ging iets mis" is not, and is used
  // only where nothing better is true.
  'pay.reden.verwerkt': {
    nl: 'Je boekhouder heeft deze factuur al verwerkt',
    ar: 'محاسبك عالج هذه الفاتورة بالفعل',
    en: 'Your accountant has already processed this invoice',
  },
  // ── [HAND-DUBBEL] Ditzelfde factuurnummer staat al ergens anders betaald ─────────────────────
  // Geen storing en geen verbod: een VRAAG. Welke van twee lezingen de echte factuur is, is een
  // vraag over papier — en op het Enka-paar was de kopie die ons goed leek juist de verkeerde.
  // De server stuurt hier een geschreven zin mee die de bedragen van beide rijen noemt; deze
  // sleutel is wat er staat als die zin er onverhoopt niet is.
  'pay.reden.dubbelAlBetaald': {
    nl: 'Dit factuurnummer staat al betaald in je administratie. Leg de factuur ernaast voordat je deze ook afboekt.',
    ar: 'رقم الفاتورة هذا مسجّل كمدفوع بالفعل في إدارتك. راجع الفاتورة قبل تسجيل هذه أيضًا.',
    en: 'This invoice number already stands paid in your administration. Put the invoice beside it before booking this one too.',
  },
  'ink.dubbelBetaald.kop': {
    nl: 'Dit nummer staat al betaald',
    ar: '\u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645 \u0645\u0633\u062c\u0651\u0644 \u0643\u0645\u062f\u0641\u0648\u0639',
    en: 'This number already stands paid',
  },
  'ink.dubbelBetaald.tochBoeken': {
    nl: 'Toch afboeken',
    ar: '\u0633\u062c\u0651\u0644\u0647\u0627 \u0631\u063a\u0645 \u0630\u0644\u0643',
    en: 'Book it anyway',
  },
  'pay.reden.alBetaald': {
    nl: 'Deze factuur staat al als betaald',
    ar: 'هذه الفاتورة مُسجَّلة كمدفوعة بالفعل',
    en: 'This invoice is already marked as paid',
  },
  'pay.reden.nietGevonden': {
    nl: 'Deze factuur is niet gevonden',
    ar: 'لم يتم العثور على هذه الفاتورة',
    en: 'This invoice was not found',
  },
  'pay.reden.nietBetaald': {
    nl: 'Er staat geen betaling op deze factuur',
    ar: 'لا توجد دفعة مسجّلة على هذه الفاتورة',
    en: 'There is no payment on this invoice',
  },
  'pay.reden.nietAfboekbaar': {
    nl: 'Deze factuur kan nu niet als betaald worden gemarkeerd',
    ar: 'لا يمكن تسجيل هذه الفاتورة كمدفوعة الآن',
    en: 'This invoice cannot be marked as paid right now',
  },
  'pay.reden.statusVeranderd': {
    nl: 'De status is inmiddels veranderd — ververs de pagina',
    ar: 'تغيَّرت الحالة في هذه الأثناء — أعد تحميل الصفحة',
    en: 'The status has changed in the meantime — refresh the page',
  },
  'pay.reden.sessieVerlopen': {
    nl: 'Je sessie is verlopen — log opnieuw in',
    ar: 'انتهت جلستك — سجّل الدخول من جديد',
    en: 'Your session has expired — log in again',
  },
  'pay.reden.bedragOngeldig': {
    nl: 'Het ingevoerde bedrag is niet geldig',
    ar: 'المبلغ المُدخَل غير صالح',
    en: 'The amount entered is not valid',
  },
  'pay.reden.datumOngeldig': {
    nl: 'De betaaldatum kan niet kloppen — controleer het jaartal',
    ar: 'تاريخ الدفع لا يمكن أن يكون صحيحًا — تحقّق من السنة',
    en: 'The payment date cannot be right — check the year',
  },
  'pay.reden.deelKasOnmogelijk': {
    nl: 'Een deelbetaling kan op dit moment alleen via bank worden genoteerd',
    ar: 'يمكن تسجيل الدفعة الجزئية حاليًا عبر البنك فقط',
    en: 'A partial payment can only be recorded by bank at the moment',
  },
  'pay.reden.referentieBotst': {
    nl: 'Deze betaling is met dezelfde referentie al op een andere factuur vastgelegd — ververs de pagina',
    ar: 'هذه الدفعة سُجِّلت بالمرجع نفسه على فاتورة أخرى — أعد تحميل الصفحة',
    en: 'This payment was already recorded under the same reference on another invoice — refresh the page',
  },
  'pay.reden.leesFout': {
    nl: 'We konden de gekoppelde betalingen niet lezen — er is niets gewijzigd',
    ar: 'تعذّرت قراءة الدفعات المرتبطة — لم يتغيّر شيء',
    en: 'We could not read the linked payments — nothing was changed',
  },
  'pay.reden.terugdraaienMislukt': {
    nl: 'Terugdraaien is niet gelukt — er is niets gewijzigd',
    ar: 'لم ينجح التراجع — لم يتغيّر شيء',
    en: 'Undoing did not succeed — nothing was changed',
  },
  'pay.reden.algemeen': {
    nl: 'Bijwerken is niet gelukt — ververs de pagina',
    ar: 'لم ينجح التحديث — أعد تحميل الصفحة',
    en: 'Updating did not succeed — refresh the page',
  },

  // ── [TAAL-BLIND] The 472 strings the first scanner could not see — multi-line text
  // nodes and strings inside JSX expressions. Translated in one sweep; the extended gate
  // patterns above the SCREENS list are what keeps this from regrowing.
  'art.alles.bevestig': {
    nl: 'Alles verwijderen',
    ar: 'حذف الكل',
    en: 'Delete everything',
  },
  'art.alles.gebruikt': {
    nl: '{n} van deze artikelen heb je eerder op een factuur gebruikt.',
    ar: 'عدد البنود التي سبق أن استعملتها على فاتورة: {n}.',
    en: 'You have previously used {n} of these articles on an invoice.',
  },
  'art.alles.knop': {
    nl: 'Alle {n} artikelen verwijderen',
    ar: 'حذف كل البنود ({n})',
    en: 'Delete all {n} articles',
  },
  'art.alles.titel': {
    nl: 'Alle {n} artikelen verwijderen?',
    ar: 'هل تريد حذف كل البنود ({n})؟',
    en: 'Delete all {n} articles?',
  },
  'art.alles.uitleg': {
    nl: 'Je facturen veranderen hier niet van — een artikel is een sjabloon, de tekst en het bedrag staan al op de factuur zelf.',
    ar: 'فواتيرك لن تتغيّر — البند مجرد قالب، فالنص والمبلغ محفوظان على الفاتورة نفسها.',
    en: 'Your invoices do not change — an article is a template; the text and the amount are already on the invoice itself.',
  },
  'art.alles.weg': {
    nl: 'De lijst zelf is daarna weg en komt niet terug.',
    ar: 'القائمة نفسها ستُحذف بعد ذلك ولن تعود.',
    en: 'The list itself will then be gone and will not come back.',
  },
  'art.archiveer': {
    nl: 'Archiveer',
    ar: 'أرشفة',
    en: 'Archive',
  },
  'art.bewerken': {
    nl: 'Artikel bewerken',
    ar: 'تعديل البند',
    en: 'Edit article',
  },
  'art.bijgewerkt': {
    nl: 'Artikel bijgewerkt',
    ar: 'حُدِّث البند',
    en: 'Article updated',
  },
  'art.btwLabel': {
    nl: '{rate}% BTW',
    ar: '{rate}% btw',
    en: '{rate}% VAT',
  },
  'art.btwTarief': {
    nl: 'BTW-tarief',
    ar: 'نسبة btw',
    en: 'VAT rate',
  },
  'art.fout.leegmaken': {
    nl: 'Leegmaken mislukt — er is niets verwijderd.',
    ar: 'فشل الإفراغ — لم يُحذف شيء.',
    en: 'Emptying failed — nothing was deleted.',
  },
  'art.fout.leegmakenVerbinding': {
    nl: 'Leegmaken mislukt — controleer je verbinding',
    ar: 'فشل الإفراغ — تحقّق من اتصالك',
    en: 'Emptying failed — check your connection',
  },
  'art.fout.opslaan': {
    nl: 'Kon niet opslaan.',
    ar: 'تعذّر الحفظ.',
    en: 'Could not save.',
  },
  'art.fout.verwijderen': {
    nl: 'Verwijderen mislukt — probeer opnieuw.',
    ar: 'فشل الحذف — حاول مرة أخرى.',
    en: 'Deleting failed — please try again.',
  },
  'art.gearchiveerd': {
    nl: 'gearchiveerd',
    ar: 'مؤرشف',
    en: 'archived',
  },
  'art.geenGevonden': {
    nl: 'Geen artikel gevonden.',
    ar: 'لم يُعثر على بند.',
    en: 'No article found.',
  },
  'art.herstel': {
    nl: 'Herstel',
    ar: 'استعادة',
    en: 'Restore',
  },
  'art.keerGebruikt': {
    nl: '{n}× gebruikt',
    ar: 'عدد مرات الاستعمال: {n}',
    en: 'used {n}×',
  },
  'art.leeg': {
    nl: 'Nog geen artikelen. Voeg je eerste vaste factuurregel toe.',
    ar: 'لا بنود بعد. أضف أول بند فاتورة ثابت لديك.',
    en: 'No articles yet. Add your first standard invoice line.',
  },
  'art.nieuw': {
    nl: '+ Nieuw',
    ar: '+ جديد',
    en: '+ New',
  },
  'art.nieuwArtikel': {
    nl: 'Nieuw artikel',
    ar: 'بند جديد',
    en: 'New article',
  },
  'art.omschrijving': {
    nl: 'Omschrijving *',
    ar: 'الوصف *',
    en: 'Description *',
  },
  'art.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'art.perEenheid': {
    nl: 'per {unit}',
    ar: 'لكل {unit}',
    en: 'per {unit}',
  },
  'art.prijsExcl': {
    nl: 'Prijs (excl. BTW)',
    ar: 'السعر (بدون btw)',
    en: 'Price (excl. VAT)',
  },
  'art.toegevoegd': {
    nl: 'Artikel toegevoegd',
    ar: 'أُضيف البند',
    en: 'Article added',
  },
  'art.verwijderd': {
    nl: 'Artikel verwijderd',
    ar: 'حُذف البند',
    en: 'Article deleted',
  },
  'art.verwijderdEen': {
    nl: '1 artikel verwijderd',
    ar: 'حُذف بند واحد',
    en: '1 article deleted',
  },
  'art.verwijderdMeer': {
    nl: '{n} artikelen verwijderd',
    ar: 'عدد البنود المحذوفة: {n}',
    en: '{n} articles deleted',
  },
  'art.verwijderUitleg': {
    nl: 'Facturen waarop dit artikel al staat, blijven ongewijzigd.',
    ar: 'الفواتير التي يظهر عليها هذا البند تبقى كما هي.',
    en: 'Invoices that already carry this article stay unchanged.',
  },
  'art.verwijderVraag': {
    nl: 'Dit artikel verwijderen?',
    ar: 'هل تريد حذف هذا البند؟',
    en: 'Delete this article?',
  },
  'bank.afschrift.verwijderenUitleg': {
    nl: 'Zorg dat je de juiste versie hebt geüpload. Dit kan niet ongedaan worden gemaakt. Je transacties blijven behouden.',
    ar: 'تأكد أنك رفعت النسخة الصحيحة. لا يمكن التراجع عن هذا. تبقى معاملاتك محفوظة.',
    en: 'Make sure you have uploaded the correct version. This cannot be undone. Your transactions are kept.',
  },
  'bank.alle': {
    nl: 'Alle',
    ar: 'الكل',
    en: 'All',
  },
  'bank.auto.bezig': {
    nl: 'Ik handel {count} zekere betalingen voor je af…',
    ar: 'أُعالج لك {count} دفعة مؤكدة…',
    en: 'Handling {count} certain payments for you…',
  },
  'bank.auto.bezigEen': {
    nl: 'Ik handel 1 zekere betaling voor je af…',
    ar: 'أُعالج لك دفعة مؤكدة واحدة…',
    en: 'Handling 1 certain payment for you…',
  },
  'bank.auto.gedaan': {
    nl: 'Ik heb {count} betalingen automatisch afgehandeld',
    ar: 'عالجت {count} دفعة تلقائيًا',
    en: 'I handled {count} payments automatically',
  },
  'bank.auto.gedaanEen': {
    nl: 'Ik heb 1 betaling automatisch afgehandeld',
    ar: 'عالجت دفعة واحدة تلقائيًا',
    en: 'I handled 1 payment automatically',
  },
  'bank.auto.klaar': {
    nl: '{count} zekere betalingen klaar om af te handelen',
    ar: '{count} دفعة مؤكدة جاهزة للمعالجة',
    en: '{count} certain payments ready to handle',
  },
  'bank.auto.klaarEen': {
    nl: '1 zekere betaling klaar om af te handelen',
    ar: 'دفعة مؤكدة واحدة جاهزة للمعالجة',
    en: '1 certain payment ready to handle',
  },
  // [AFHANDELEN-NOEMT] Eén regel per betaling die deze knop gaat boeken, mét het factuurnummer.
  // De knop markeert facturen als betaald; tot nu toe stond er alleen HOEVEEL, en de enige vraag
  // die een ondernemer ervoor heeft — "welke, en zit de verkeerde ertussen?" — had geen antwoord
  // op het scherm.
  // [NIET-DEZE-FACTUUR] De knop die tot nu toe niet bestond. De kaart bood één factuur en één
  // knop — Bevestig betaling — en er was geen manier om te zeggen dat het voorstel FOUT was. De
  // zin zegt wat er gebeurt, niet wat de app ervan vindt: het voorstel verdwijnt, er wordt niets
  // geboekt, en het is terug te draaien.
  'bank.nietDeze': { nl: 'Niet deze factuur', ar: 'ليست هذه الفاتورة', en: 'Not this invoice' },
  'bank.nietDeze.weg': {
    nl: 'Weggehaald — deze factuur wordt niet meer voorgesteld bij deze betaling.',
    ar: 'أُزيلت — لن تُقترح هذه الفاتورة بعد الآن لهذه الدفعة.',
    en: 'Removed — this invoice is no longer suggested for this payment.',
  },
  'bank.nietDeze.terug': { nl: 'Ongedaan maken', ar: 'تراجع', en: 'Undo' },
  'bank.nietDeze.nietBewaard': {
    nl: 'Weggehaald voor nu. De app kan dit nog niet onthouden, dus na verversen staat hij er weer.',
    ar: 'أُزيلت الآن فقط. لا يستطيع التطبيق تذكّر هذا بعد، فستعود بعد تحديث الصفحة.',
    en: 'Removed for now. The app cannot remember this yet, so it will be back after a refresh.',
  },
  'bank.auto.wordtGeboektOp': {
    nl: 'wordt geboekt op factuur {nummer}',
    ar: 'ستُسجّل على الفاتورة {nummer}',
    en: 'will be booked on invoice {nummer}',
  },
  'bank.auto.uitleg': {
    nl: 'Nummer én bedrag exact in je bankafschrift? Dan koppel ik zelf en zet ik op betaald. De rest is aan jou. Ongedaan maken kan altijd.',
    ar: 'الرقم والمبلغ مطابقان تمامًا في كشف حسابك؟ عندها أربط وأضع كمدفوع بنفسي. الباقي لك. التراجع ممكن دائمًا.',
    en: 'Number and amount exactly in your bank statement? Then I link and mark as paid myself. The rest is yours. Undo is always possible.',
  },
  'bank.autoGeboekt': {
    nl: '{count} facturen automatisch gekoppeld ✓ — zie "Bevestigd"',
    ar: 'رُبطت {count} فاتورة تلقائيًا ✓ — انظر «مؤكَّد»',
    en: '{count} invoices linked automatically ✓ — see "Confirmed"',
  },
  'bank.autoGeboektEen': {
    nl: '1 factuur automatisch gekoppeld ✓ — zie "Bevestigd"',
    ar: 'رُبطت فاتورة واحدة تلقائيًا ✓ — انظر «مؤكَّد»',
    en: '1 invoice linked automatically ✓ — see "Confirmed"',
  },
  'bank.automatischOpRest': {
    nl: '(geen factuurnummer in het afschrift). Even controleren of dit de juiste factuur is.',
    ar: '(لا رقم فاتورة في الكشف). تحقّق سريعًا أن هذه هي الفاتورة الصحيحة.',
    en: '(no invoice number in the statement). Take a moment to check this is the right invoice.',
  },
  'bank.bankGekoppeld': {
    nl: 'Je bank is gekoppeld. We halen je transacties op…',
    ar: 'رُبط بنكك. نجلب معاملاتك الآن…',
    en: 'Your bank is connected. We are fetching your transactions…',
  },
  'bank.bankGekoppeldMeer': {
    nl: 'Je bank is gekoppeld ({count} rekeningen). We halen je transacties op…',
    ar: 'رُبط بنكك (الحسابات: {count}). نجلب معاملاتك الآن…',
    en: 'Your bank is connected ({count} accounts). We are fetching your transactions…',
  },
  'bank.batch.mismatch': {
    nl: 'Samen {total}, maar er is {bank} afgeschreven (verschil {diff}). Controleer welke facturen bij deze betaling horen.',
    ar: 'المجموع {total}، لكن المخصوم {bank} (الفرق {diff}). تحقّق أي فواتير تخص هذه الدفعة.',
    en: 'Together {total}, but {bank} was debited (difference {diff}). Check which invoices belong to this payment.',
  },
  'bank.batch.mismatchEen': {
    nl: '{total}, maar er is {bank} afgeschreven (verschil {diff}). Controleer welke factuur bij deze betaling hoort.',
    ar: '{total}، لكن المخصوم {bank} (الفرق {diff}). تحقّق أي فاتورة تخص هذه الدفعة.',
    en: '{total}, but {bank} was debited (difference {diff}). Check which invoice belongs to this payment.',
  },
  'bank.batch.ontbreekt': {
    nl: '{matched} van {total} facturen staan in je administratie. De factuurnummers staan in je bankafschrift — koppel de ontbrekende.',
    ar: '{matched} من {total} فاتورة موجودة في إدارتك. أرقام الفواتير في كشف حسابك — اربط الناقصة.',
    en: '{matched} of {total} invoices are in your administration. The invoice numbers are in your bank statement — link the missing ones.',
  },
  'bank.batch.ties': {
    nl: 'Samen {amount} — precies gelijk aan de afschrijving. Alle {count} factuurnummers staan in je bankafschrift.',
    ar: 'المجموع {amount} — مساوٍ تمامًا للمبلغ المخصوم. كل أرقام الفواتير ({count}) موجودة في كشف حسابك.',
    en: 'Together {amount} — exactly equal to the debit. All {count} invoice numbers are in your bank statement.',
  },
  'bank.batch.tiesEen': {
    nl: '{amount} en het factuurnummer staan in je bankafschrift.',
    ar: '{amount} ورقم الفاتورة موجودان في كشف حسابك.',
    en: '{amount} and the invoice number are in your bank statement.',
  },
  'bank.batchBevestigd': {
    nl: '{count} factuur/facturen bevestigd ✓',
    ar: 'أُكِّدت {count} فاتورة ✓',
    en: '{count} invoice(s) confirmed ✓',
  },
  'bank.batchDeels': {
    nl: '{ok} bevestigd · {failed} mislukt',
    ar: 'أُكِّد {ok} · فشل {failed}',
    en: '{ok} confirmed · {failed} failed',
  },
  'bank.bedragNaam': {
    nl: 'bedrag + naam',
    ar: 'المبلغ + الاسم',
    en: 'amount + name',
  },
  'bank.bestandNietHerkend': {
    nl: 'Bestand opgeslagen, maar het is niet als factuur herkend. Controleer het bij Mijn Bestanden.',
    ar: 'حُفظ الملف، لكنه لم يُتعرَّف عليه كفاتورة. راجعه في «ملفاتي».',
    en: 'File saved, but it was not recognised as an invoice. Check it under My files.',
  },
  'bank.betaaldKoppelingLater': {
    nl: 'Factuur betaald (koppeling volgt later).',
    ar: 'دُفعت الفاتورة (يأتي الربط لاحقًا).',
    en: 'Invoice paid (the link will follow later).',
  },
  'bank.betaaldNietVastgelegd': {
    nl: 'Betaald ✓ — maar de bankregel is niet volledig vastgelegd. Komt hij terug: ververs de pagina, anders Negeren.',
    ar: 'مدفوعة ✓ — لكن سطر البنك لم يُسجَّل بالكامل. إن عاد: أعد تحميل الصفحة، وإلا فاستخدم «تجاهل».',
    en: 'Paid ✓ — but the bank line was not fully recorded. If it comes back: refresh the page, otherwise Ignore.',
  },
  'bank.betaaldNogEenOpen': {
    nl: 'Factuur betaald ✓ · nog een factuur open',
    ar: 'دُفعت الفاتورة ✓ · ما زالت فاتورة أخرى مفتوحة',
    en: 'Invoice paid ✓ · another invoice still open',
  },
  'bank.bevestigAantal': {
    nl: 'Bevestig betaling ({count})',
    ar: 'أكِّد الدفعة ({count})',
    en: 'Confirm payment ({count})',
  },
  'bank.bevestigdBetaald': {
    nl: 'Bevestigd en gemarkeerd als betaald ✓',
    ar: 'تم التأكيد والوسم كمدفوعة ✓',
    en: 'Confirmed and marked as paid ✓',
  },
  'bank.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'bank.blijftOver': {
    nl: 'blijft over en wordt niet geboekt — controleer of dit de juiste factuur is.',
    ar: 'يبقى فائضًا ولن يُسجَّل — تحقّق أن هذه هي الفاتورة الصحيحة.',
    en: 'is left over and will not be booked — check this is the right invoice.',
  },
  'bank.controleerBedrag': {
    nl: 'Let op: controleer het bedrag.',
    ar: 'انتبه: تحقّق من المبلغ.',
    en: 'Note: check the amount.',
  },
  'bank.deel.alBetaald': {
    nl: 'Er was al {amount} betaald.',
    ar: 'سبق دفع {amount}.',
    en: '{amount} was already paid.',
  },
  'bank.deel.daarnaOpen': {
    nl: 'Daarna staat nog {amount} open.',
    ar: 'يبقى بعدها {amount} مفتوحًا.',
    en: 'After that, {amount} remains open.',
  },
  'bank.deel.geboekt': {
    nl: 'Deelbetaling: {amount} wordt geboekt.',
    ar: 'دفعة جزئية: سيُسجَّل {amount}.',
    en: 'Partial payment: {amount} will be booked.',
  },
  'bank.deel.voltooid': {
    nl: '{paid} al betaald · {remaining} restant — hiermee is de factuur volledig betaald.',
    ar: '{paid} مدفوع مسبقًا · المتبقي {remaining} — بهذا تُدفع الفاتورة بالكامل.',
    en: '{paid} already paid · {remaining} remaining — with this the invoice is fully paid.',
  },
  'bank.deelGeboektBlijft': {
    nl: 'Deelbetaling geboekt · factuur blijft openstaan',
    ar: 'قُيّدت دفعة جزئية · تبقى الفاتورة مفتوحة',
    en: 'Partial payment booked · the invoice stays open',
  },
  'bank.deelGeboektOpen': {
    nl: 'Deelbetaling geboekt · nog {amount} open',
    ar: 'قُيّدت دفعة جزئية · المتبقي {amount}',
    en: 'Partial payment booked · {amount} still open',
  },
  // ── [SLOT-WAAR] De lezing is geen grens ──────────────────────────────────────────────────────
  // De slotweergave toont de nummers die WIJ in deze betaling hebben gelezen. Hoort er een factuur
  // bij die er niet in staat — omdat de bank haar niet noemt, of omdat wij haar hebben gemist —
  // dan eindigde het scherm daar. De eigenaar zat vast in onze lezing, en dat is precies de fout
  // die dit product bij een LEZING nooit accepteert: zij mag een mens niet begrenzen.
  'bank.slot.meerFacturen': {
    nl: 'Horen er meer facturen bij deze betaling dan hier staan? Verdeel hem zelf over de juiste facturen.',
    ar: 'هل تخصّ هذه الدفعة فواتير أكثر مما هو معروض هنا؟ وزّعها بنفسك على الفواتير الصحيحة.',
    en: 'Does this payment cover more invoices than are listed here? Split it across the right invoices yourself.',
  },
  'bank.slot.meerFacturenKnop': {
    nl: 'Zelf over facturen verdelen',
    ar: 'التوزيع على الفواتير يدويًا',
    en: 'Split across invoices yourself',
  },
  'bank.facturenKoppelen': {
    nl: 'Facturen koppelen ({count})',
    ar: 'ربط فواتير ({count})',
    en: 'Link invoices ({count})',
  },
  'bank.factuurKoppelen': {
    nl: 'Factuur koppelen',
    ar: 'ربط فاتورة',
    en: 'Link an invoice',
  },
  'bank.factuurNummer': {
    nl: 'Factuur {number}',
    ar: 'الفاتورة {number}',
    en: 'Invoice {number}',
  },
  'bank.formaat.bewaard': {
    nl: 'Dit bestand is bewaard voor je boekhouder, maar de transacties konden niet worden uitgelezen voor het overzicht.',
    ar: 'حُفظ هذا الملف للمحاسب، لكن تعذّرت قراءة معاملاته للنظرة العامة.',
    en: 'This file was kept for your accountant, but its transactions could not be read for the overview.',
  },
  // [BANK-CSV-LEESBAAR] CSV staat hier niet meer bij de onleesbare formaten: bank-csv.ts leest
  // hem sinds die module bestaat. Deze zin bleef achter en vertelde de ondernemer dat een
  // bestand dat WEL was ingelezen niet gelezen kon worden. PDF blijft staan — die kan de
  // bankparser echt niet.
  'bank.formaat.omTeKoppelen': {
    nl: 'om de transacties te koppelen. Een PDF-afschrift kan niet worden uitgelezen.',
    ar: 'لربط المعاملات. لا يمكن قراءة كشف بصيغة PDF.',
    en: 'to link the transactions. A PDF statement cannot be read.',
  },
  'bank.formaten': {
    nl: 'CAMT.053 (.xml), MT940 (.940 / .sta / .txt) of CSV',
    ar: 'CAMT.053 (.xml) أو MT940 (.940 / .sta / .txt) أو CSV',
    en: 'CAMT.053 (.xml), MT940 (.940 / .sta / .txt) or CSV',
  },
  'bank.fout.bedragPastNiet': {
    nl: 'Dat bedrag past niet op deze betaling.',
    ar: 'هذا المبلغ لا يناسب هذه الدفعة.',
    en: 'That amount does not fit this payment.',
  },
  'bank.fout.betalingenOphalen': {
    nl: 'Betalingen ophalen mislukt.',
    ar: 'فشل جلب الدفعات.',
    en: 'Fetching the payments failed.',
  },
  'bank.fout.factuurNietOpgehaald': {
    nl: 'Deze factuur kon niet worden opgehaald.',
    ar: 'تعذّر جلب هذه الفاتورة.',
    en: 'This invoice could not be fetched.',
  },
  'bank.fout.geenBestand': {
    nl: 'Deze factuur heeft geen bestand.',
    ar: 'هذه الفاتورة بلا ملف.',
    en: 'This invoice has no file.',
  },
  'bank.fout.geenTransacties': {
    nl: 'Geen transacties gevonden in dit bestand.',
    ar: 'لم يُعثر على معاملات في هذا الملف.',
    en: 'No transactions found in this file.',
  },
  'bank.fout.koppelen': {
    nl: 'Koppelen mislukt.',
    ar: 'فشل الربط.',
    en: 'Linking failed.',
  },
  'bank.fout.nietCorrigeren': {
    nl: 'Deze factuur kan nu niet worden gecorrigeerd.',
    ar: 'لا يمكن تصحيح هذه الفاتورة الآن.',
    en: 'This invoice cannot be corrected right now.',
  },
  'bank.fout.toevoegenNiets': {
    nl: 'Toevoegen mislukt — er is niets opgeslagen.',
    ar: 'فشلت الإضافة — لم يُحفظ شيء.',
    en: 'Adding failed — nothing was saved.',
  },
  'bank.fout.uploaden': {
    nl: 'Uploaden mislukt.',
    ar: 'فشل الرفع.',
    en: 'Uploading failed.',
  },
  'bank.fout.verplaatsen': {
    nl: 'Verplaatsen mislukt — er is niets gewijzigd.',
    ar: 'فشل النقل — لم يتغيّر شيء.',
    en: 'Moving failed — nothing was changed.',
  },
  'bank.geenFactuurUitleg': {
    nl: 'Betalingen zonder factuur. Koppel er een, of negeer de regel als er geen factuur bij hoort (huur, lening).',
    ar: 'دفعات بلا فاتورة. اربط فاتورة، أو تجاهل البند إن لم تكن له فاتورة (إيجار، قرض).',
    en: 'Payments without an invoice. Link one, or ignore the line if no invoice belongs to it (rent, loan).',
  },
  'bank.geenNummer': {
    nl: '(geen nummer)',
    ar: '(بلا رقم)',
    en: '(no number)',
  },
  'bank.geenTransactiesBank': {
    nl: 'Nog geen transacties bij je bank gevonden.',
    ar: 'لم يُعثر بعد على معاملات لدى بنكك.',
    en: 'No transactions found at your bank yet.',
  },
  'bank.gekoppeldDeels': {
    nl: '{ok}/{total} gekoppeld.',
    ar: 'رُبط {ok}/{total}.',
    en: '{ok}/{total} linked.',
  },
  'bank.gekoppeldEen': {
    nl: 'Factuur gekoppeld ✓',
    ar: 'رُبطت الفاتورة ✓',
    en: 'Invoice linked ✓',
  },
  'bank.gekoppeldMeer': {
    nl: '{count} facturen gekoppeld ✓',
    ar: 'رُبطت {count} فاتورة ✓',
    en: '{count} invoices linked ✓',
  },
  'bank.genegeerdGroot': {
    nl: ', waarvan {count} boven de € 500',
    ar: '، منها {count} فوق € 500',
    en: ', of which {count} above € 500',
  },
  'bank.genegeerdGrootEen': {
    nl: ', waarvan één boven de € 500',
    ar: '، منها واحدة فوق € 500',
    en: ', of which one above € 500',
  },
  'bank.genegeerdNaloop': {
    nl: 'Ze tellen nergens mee en je boekhouder ziet ze niet — loop ze na vóór je het kwartaal afsluit.',
    ar: 'لا تُحتسب في شيء ولا يراها المحاسب — راجعها قبل إقفال الربع.',
    en: 'They count nowhere and your accountant does not see them — go over them before you close the quarter.',
  },
  'bank.genegeerdSom': {
    nl: '{count} genegeerde regels van samen {total}',
    ar: '{count} من البنود المتجاهَلة بمجموع {total}',
    en: '{count} ignored lines totalling {total}',
  },
  'bank.genegeerdSomEen': {
    nl: '1 genegeerde regel van samen {total}',
    ar: 'بند متجاهَل واحد بمجموع {total}',
    en: '1 ignored line totalling {total}',
  },
  'bank.geselecteerd': {
    nl: '{count} geselecteerd',
    ar: '{count} محدَّد',
    en: '{count} selected',
  },
  'bank.historie.eenIban': {
    nl: 'Eerder één keer van deze tegenrekening, geboekt als {category}.',
    ar: 'سبق مرة واحدة من هذا الحساب المقابل، وقُيّدت كـ{category}.',
    en: 'Seen once before from this counter-account, booked as {category}.',
  },
  'bank.historie.eenNaam': {
    nl: 'Eerder één keer van deze naam, geboekt als {category}.',
    ar: 'سبق مرة واحدة من هذا الاسم، وقُيّدت كـ{category}.',
    en: 'Seen once before from this name, booked as {category}.',
  },
  'bank.historie.meestIban': {
    nl: 'Eerder {count} keer van deze tegenrekening — {topCount}× als {category}, de rest anders.',
    ar: 'سبق {count} مرة من هذا الحساب المقابل — {topCount}× كـ{category}، والباقي مختلف.',
    en: 'Seen {count} times before from this counter-account — {topCount}× as {category}, the rest differently.',
  },
  'bank.historie.meestNaam': {
    nl: 'Eerder {count} keer van deze naam — {topCount}× als {category}, de rest anders.',
    ar: 'سبق {count} مرة من هذا الاسم — {topCount}× كـ{category}، والباقي مختلف.',
    en: 'Seen {count} times before from this name — {topCount}× as {category}, the rest differently.',
  },
  'bank.historie.steedsIban': {
    nl: 'Eerder {count} keer van deze tegenrekening, steeds geboekt als {category}.',
    ar: 'سبق {count} مرة من هذا الحساب المقابل، وقُيّدت كل مرة كـ{category}.',
    en: 'Seen {count} times before from this counter-account, booked as {category} every time.',
  },
  'bank.historie.steedsNaam': {
    nl: 'Eerder {count} keer van deze naam, steeds geboekt als {category}.',
    ar: 'سبق {count} مرة من هذا الاسم، وقُيّدت كل مرة كـ{category}.',
    en: 'Seen {count} times before from this name, booked as {category} every time.',
  },
  'bank.inlezen': {
    nl: 'Bezig met inlezen…',
    ar: 'جارٍ الاستيراد…',
    en: 'Reading it in…',
  },
  'bank.jaTochKoppelen': {
    nl: 'Ja, toch koppelen',
    ar: 'نعم، اربطها رغم ذلك',
    en: 'Yes, link it anyway',
  },
  'bank.kiesAfschrift': {
    nl: 'Kies bankafschrift',
    ar: 'اختر كشف الحساب',
    en: 'Choose a bank statement',
  },
  'bank.kloptGecontroleerd': {
    nl: 'Klopt, gecontroleerd',
    ar: 'صحيح، تم التحقّق',
    en: 'Correct, checked',
  },
  'bank.koppelingOngedaan': {
    nl: 'Koppeling ongedaan gemaakt.',
    ar: 'أُلغي الربط.',
    en: 'Link undone.',
  },
  'bank.kwartaal': {
    nl: 'Kwartaal:',
    ar: 'الربع:',
    en: 'Quarter:',
  },
  'bank.laatLos': {
    nl: 'Laat los om te uploaden',
    ar: 'أفلِت للرفع',
    en: 'Release to upload',
  },
  'bank.leeg.confirm': {
    nl: 'Niets te bevestigen.',
    ar: 'لا شيء للتأكيد.',
    en: 'Nothing to confirm.',
  },
  'bank.leeg.done': {
    nl: 'Nog niets gekoppeld.',
    ar: 'لم يُربط شيء بعد.',
    en: 'Nothing linked yet.',
  },
  'bank.leeg.geen': {
    nl: 'Nog geen transacties om te koppelen.',
    ar: 'لا توجد معاملات للربط بعد.',
    en: 'No transactions to link yet.',
  },
  'bank.leeg.ignored': {
    nl: 'Niets genegeerd.',
    ar: 'لا شيء متجاهَل.',
    en: 'Nothing ignored.',
  },
  'bank.leeg.klaar': {
    nl: 'Alles afgehandeld.',
    ar: 'كل شيء انتهى.',
    en: 'Everything handled.',
  },
  'bank.leeg.none': {
    nl: 'Geen openstaande transacties zonder factuur.',
    ar: 'لا توجد معاملات مفتوحة بلا فاتورة.',
    en: 'No open transactions without an invoice.',
  },
  'bank.leeg.pin': {
    nl: 'Geen pinontvangsten.',
    ar: 'لا مقبوضات نقاط بيع.',
    en: 'No card takings.',
  },
  'bank.lijktDubbel': {
    nl: 'Deze factuur lijkt al eerder gekoppeld te zijn.',
    ar: 'يبدو أن هذه الفاتورة رُبطت من قبل.',
    en: 'This invoice appears to have been linked before.',
  },
  'bank.maximaalGeboekt': {
    nl: 'op deze factuur geboekt.',
    ar: 'على هذه الفاتورة.',
    en: 'will be booked on this invoice.',
  },
  'bank.namenBijgewerkt': {
    nl: '{count} namen bijgewerkt ✓',
    ar: 'الأسماء المحدَّثة: {count} ✓',
    en: '{count} names updated ✓',
  },
  'bank.namenBijgewerktEen': {
    nl: '1 naam bijgewerkt ✓',
    ar: 'حُدّث اسم واحد ✓',
    en: '1 name updated ✓',
  },
  'bank.namenBijwerken': {
    nl: 'Namen bijwerken',
    ar: 'تحديث الأسماء',
    en: 'Update names',
  },
  'bank.namenUpToDate': {
    nl: 'Alle namen waren al up-to-date.',
    ar: 'كل الأسماء كانت محدَّثة بالفعل.',
    en: 'All names were already up to date.',
  },
  'bank.nFacturen': {
    nl: '{count} facturen',
    ar: '{count} فاتورة',
    en: '{count} invoices',
  },
  'bank.nogOpenBedrag': {
    nl: 'nog {amount} open',
    ar: 'المتبقي {amount}',
    en: '{amount} still open',
  },
  'bank.nogOpenLijst': {
    nl: 'Nog open: {numbers}',
    ar: 'ما زال مفتوحًا: {numbers}',
    en: 'Still open: {numbers}',
  },
  // [AFHANDELEN-STIL] Wat er gebeurde toen er niets gebeurde. De knop kon alleen iets zeggen als de
  // server iets boekte ÉN de teller op nul stond; boekte hij nul, dan bleef het scherm precies
  // staan zoals het stond — met "1 zekere betaling klaar" erboven. De ondernemer tikt dan opnieuw.
  //
  // Waarom de server kan weigeren wat dit scherm zeker noemt: hij weet dingen die de pagina niet
  // ziet — een factuur die de boekhouder heeft vastgezet, een kwartaal dat al is ingediend, een
  // betaling die intussen ergens anders is geboekt. Daarom noemt deze zin geen reden die hij niet
  // kent, en wijst hij naar wat er wél kan.
  'bank.auto.geenGeboekt': {
    nl: 'Niets automatisch geboekt. De betalingen staan hieronder — koppel ze met één tik.',
    ar: 'لم يُسجَّل شيء تلقائيًا. الدفعات بالأسفل — اربطها بلمسة واحدة.',
    en: 'Nothing booked automatically. The payments are below — link them with one tap.',
  },
  'bank.nuAfhandelen': {
    nl: 'Nu afhandelen',
    ar: 'معالجة الآن',
    en: 'Handle now',
  },
  'bank.of': {
    nl: 'of',
    ar: 'أو',
    en: 'or',
  },
  'bank.omschrijvingKop': {
    nl: 'OMSCHRIJVING',
    ar: 'الوصف',
    en: 'DESCRIPTION',
  },
  'bank.ontkoppelen': {
    nl: 'Ontkoppelen',
    ar: 'إلغاء الربط',
    en: 'Unlink',
  },
  'bank.opgehaaldAantal': {
    nl: '{count} transacties opgehaald.',
    ar: 'جُلبت {count} معاملة.',
    en: '{count} transactions fetched.',
  },
  'bank.opgehaaldOnleesbaar': {
    nl: '{inserted} transacties opgehaald · {count} regels konden niet gelezen worden.',
    ar: 'جُلبت {inserted} معاملة · تعذّرت قراءة {count} من البنود.',
    en: '{inserted} transactions fetched · {count} lines could not be read.',
  },
  'bank.opgehaaldOnleesbaarEen': {
    nl: '{inserted} transacties opgehaald · 1 regel kon niet gelezen worden.',
    ar: 'جُلبت {inserted} معاملة · تعذّرت قراءة بند واحد.',
    en: '{inserted} transactions fetched · 1 line could not be read.',
  },
  'bank.opnieuwMatchen': {
    nl: 'Opnieuw matchen',
    ar: 'إعادة المطابقة',
    en: 'Match again',
  },
  'bank.overgeslagenDubbel': {
    nl: 'Overgeslagen (mogelijk dubbel).',
    ar: 'تم التخطي (ربما مكررة).',
    en: 'Skipped (possible duplicate).',
  },
  'bank.overslaan': {
    nl: 'Overslaan',
    ar: 'تخطٍّ',
    en: 'Skip',
  },
  'bank.pinUitleg': {
    nl: 'Pinontvangsten via de betaalautomaat (ING DD&C) — geen factuur, niets te doen.',
    ar: 'مقبوضات نقاط البيع عبر جهاز الدفع (ING DD&C) — لا فاتورة، ولا شيء لفعله.',
    en: 'Card takings via the payment terminal (ING DD&C) — no invoice, nothing to do.',
  },
  'bank.proof.bedrag': {
    nl: 'Dit bedrag komt overeen met je bankafschrift',
    ar: 'هذا المبلغ مطابق لكشف حسابك',
    en: 'This amount matches your bank statement',
  },
  'bank.proof.metNummer': {
    nl: 'Dit bedrag en factuurnummer staan in je bankafschrift',
    ar: 'هذا المبلغ ورقم الفاتورة موجودان في كشف حسابك',
    en: 'This amount and invoice number are in your bank statement',
  },
  'bank.redenVraag': {
    nl: 'Waarom heeft deze regel geen factuur nodig? Een aantekening voor je boekhouder, bij het kwartaal.',
    ar: 'لماذا لا يحتاج هذا البند إلى فاتورة؟ ملاحظة للمحاسب عند الربع.',
    en: 'Why does this line need no invoice? A note for your accountant, at the quarter.',
  },
  'bank.rematch.alles': {
    nl: 'Alle {count} regels opnieuw bekeken — er was niets nieuws te koppelen.',
    ar: 'أُعيد فحص كل البنود ({count}) — لم يكن هناك جديد للربط.',
    en: 'All {count} lines re-examined — there was nothing new to link.',
  },
  'bank.rematch.ambigu': {
    nl: '{count} genegeerde regels hebben nu een mogelijke factuur, maar geen duidelijke — die laat ik staan. Koppel ze zelf onder "Genegeerd".',
    ar: '{count} من البنود المتجاهَلة لها الآن فاتورة محتملة لكن غير واضحة — أتركها كما هي. اربطها بنفسك تحت «المتجاهَل».',
    en: '{count} ignored lines now have a possible invoice, but not a clear one — I leave them be. Link them yourself under "Ignored".',
  },
  'bank.rematch.ambiguEen': {
    nl: '1 genegeerde regel heeft nu een mogelijke factuur, maar geen duidelijke — die laat ik staan. Koppel hem zelf onder "Genegeerd".',
    ar: 'بند متجاهَل واحد له الآن فاتورة محتملة لكن غير واضحة — أتركه كما هو. اربطه بنفسك تحت «المتجاهَلة».',
    en: '1 ignored line now has a possible invoice, but not a clear one — I leave it be. Link it yourself under "Ignored".',
  },
  'bank.rematch.geboekt': {
    nl: 'betalingen zijn automatisch gekoppeld.',
    ar: 'دفعات رُبطت تلقائياً.',
    en: 'payments were linked automatically.',
  },
  'bank.rematch.geboektEen': {
    nl: 'betaling is automatisch gekoppeld.',
    ar: 'رُبطت الدفعة تلقائيًا.',
    en: 'payment was linked automatically.',
  },
  'bank.rematch.gekoppeld': {
    nl: '{count} automatisch gekoppeld',
    ar: 'رُبط تلقائيًا: {count}',
    en: '{count} linked automatically',
  },
  'bank.rematch.hersteld': {
    nl: 'genegeerde regels staan weer in de lijst.',
    ar: 'بند متجاهَل عاد إلى القائمة.',
    en: 'ignored lines are back in the list.',
  },
  'bank.rematch.hersteldEen': {
    nl: 'genegeerde regel staat weer in de lijst.',
    ar: 'بند متجاهَل عاد إلى القائمة.',
    en: 'ignored line is back in the list.',
  },
  'bank.rematch.niets': {
    nl: 'Alles opnieuw bekeken ({count}) — er was niets nieuws te koppelen.',
    ar: 'أُعيد فحص كل شيء ({count}) — لم يكن هناك جديد للربط.',
    en: 'Everything re-examined ({count}) — there was nothing new to link.',
  },
  'bank.rematch.terug': {
    nl: '{count} regels terug in de lijst',
    ar: 'البنود المعادة إلى القائمة: {count}',
    en: '{count} lines back in the list',
  },
  'bank.rematch.terugEen': {
    nl: '1 regel terug in de lijst',
    ar: 'أُعيد بند واحد إلى القائمة',
    en: '1 line back in the list',
  },
  'bank.rematch.titel': {
    nl: 'Kijkt opnieuw naar alle regels — ook de genegeerde — en koppelt wat inmiddels zeker is',
    ar: 'يعيد النظر في كل البنود — حتى المتجاهَلة — ويربط ما صار مؤكداً',
    en: 'Looks at every line again — including the ignored ones — and links what has become certain',
  },
  'bank.rematch.zwak': {
    nl: 'Niets zeker genoeg om zelf te doen — {count} genegeerde regels hebben wel een mogelijke factuur. Kijk bij "Genegeerd".',
    ar: 'لا شيء مؤكد بما يكفي لأفعله بنفسي — {count} من البنود المتجاهَلة لها فاتورة محتملة. انظر «المتجاهَلة».',
    en: 'Nothing certain enough to do on its own — {count} ignored lines do have a possible invoice. Look under "Ignored".',
  },
  'bank.rematch.zwakEen': {
    nl: 'Niets zeker genoeg om zelf te doen — 1 genegeerde regel heeft wel een mogelijke factuur. Kijk bij "Genegeerd".',
    ar: 'لا شيء مؤكد بما يكفي لأفعله بنفسي — بند متجاهَل واحد له فاتورة محتملة. انظر «المتجاهَلة».',
    en: 'Nothing certain enough to do on its own — 1 ignored line does have a possible invoice. Look under "Ignored".',
  },
  'bank.restBlijft': {
    nl: 'De rest blijft op deze betaling staan, zodat je hem koppelt zodra de andere factuur binnen is.',
    ar: 'يبقى الباقي على هذه الدفعة، لتربطه حين تصل الفاتورة الأخرى.',
    en: 'The rest stays on this payment, so you can link it once the other invoice arrives.',
  },
  'bank.saldoSluit': {
    nl: 'Sluit aan tot op de cent: beginsaldo {opening} + {count} mutaties = eindsaldo {closing}. Geen regel ontbreekt.',
    ar: 'متطابق حتى السنت: الرصيد الافتتاحي {opening} + {count} حركة = الرصيد الختامي {closing}. لا ينقص أي بند.',
    en: 'Ties out to the cent: opening balance {opening} + {count} movements = closing balance {closing}. No line is missing.',
  },
  'bank.somVeranderd': {
    nl: 'De som klopt niet meer: een van deze facturen is intussen (deels) betaald. Ververs en kies opnieuw.',
    ar: 'لم يعد المجموع مطابقًا: إحدى هذه الفواتير دُفعت (جزئيًا) في الأثناء. أعد تحميل الصفحة واختر من جديد.',
    en: 'The sum no longer ties: one of these invoices was (partly) paid meanwhile. Refresh and choose again.',
  },
  'bank.samenGekoppeld': {
    nl: '{count} facturen samen gekoppeld aan deze betaling ✓',
    ar: 'رُبطت {count} فاتورة معًا بهذه الدفعة ✓',
    en: '{count} invoices linked together to this payment ✓',
  },
  'bank.selecteerAlle': {
    nl: 'Selecteer alle ({count})',
    ar: 'حدّد الكل ({count})',
    en: 'Select all ({count})',
  },
  'bank.selectieWissen': {
    nl: 'Selectie wissen',
    ar: 'مسح التحديد',
    en: 'Clear selection',
  },
  'bank.slotsBevestigd': {
    nl: '{done}/{total} bevestigd',
    ar: 'أُكِّد {done}/{total}',
    en: '{done}/{total} confirmed',
  },
  'bank.som.klant': {
    nl: '— zelfde klant, geen nummer in de omschrijving. Controleer en koppel ze samen.',
    ar: '— العميل نفسه، ولا رقم في الوصف. تحقّق واربطهما معًا.',
    en: '— same client, no number in the description. Check and link them together.',
  },
  // [CREDIT-VERREKEN] The same recognition, when one of the posten is a creditnota. "De som van
  // 2 facturen" would be wrong twice over: a creditnota is not a factuur, and it is subtracted
  // rather than added — the card prints the arithmetic underneath, and it has to add up.
  'bank.som.kopVerrekend': {
    nl: 'Dit bedrag klopt precies: een factuur met een creditnota eraf',
    ar: 'هذا المبلغ مطابق تمامًا: فاتورة مخصوم منها إشعار دائن',
    en: 'This amount matches exactly: an invoice with a credit note deducted',
  },
  'bank.som.kop': {
    nl: 'Dit bedrag is precies de som van {count} openstaande facturen',
    ar: 'هذا المبلغ هو بالضبط مجموع {count} فاتورة مفتوحة',
    en: 'This amount is exactly the sum of {count} open invoices',
  },
  'bank.som.koppel': {
    nl: 'Koppel deze {count} facturen',
    ar: 'اربط هذه الفواتير ({count})',
    en: 'Link these {count} invoices',
  },
  'bank.som.leverancier': {
    nl: '— zelfde leverancier, geen nummer in de omschrijving. Controleer en koppel ze samen.',
    ar: '— المورّد نفسه، ولا رقم في الوصف. تحقّق واربطهما معًا.',
    en: '— same supplier, no number in the description. Check and link them together.',
  },
  'bank.tab.bevestigd': {
    nl: 'Bevestigd',
    ar: 'مؤكَّد',
    en: 'Confirmed',
  },
  'bank.tab.geenFactuur': {
    nl: 'Geen factuur',
    ar: 'بلا فاتورة',
    en: 'No invoice',
  },
  'bank.tab.pin': {
    nl: 'Pinontvangsten',
    ar: 'مقبوضات نقاط البيع',
    en: 'Card takings',
  },
  'bank.tab.teBevestigen': {
    nl: 'Te bevestigen',
    ar: 'بانتظار التأكيد',
    en: 'To confirm',
  },
  'bank.terugzetten': {
    nl: 'Terugzetten',
    ar: 'إرجاع',
    en: 'Put back',
  },
  'bank.tochKoppelenVraag': {
    nl: 'Toch koppelen?',
    ar: 'الربط رغم ذلك؟',
    en: 'Link anyway?',
  },
  'bank.toegevoegdWachtrij': {
    nl: 'Factuur toegevoegd. Bevestig hem eerst in de controlewachtrij, daarna kun je de betaling verdelen.',
    ar: 'أُضيفت الفاتورة. أكِّدها أولًا في قائمة المراجعة، وبعدها يمكنك توزيع الدفعة.',
    en: 'Invoice added. Confirm it in the review queue first, then you can split the payment.',
  },
  'bank.toeTeWijzen': {
    nl: '{applied} van {total} geboekt · nog {open} toe te wijzen',
    ar: 'قُيّد {applied} من {total} · المتبقي للتوزيع {open}',
    en: '{applied} of {total} booked · {open} still to assign',
  },
  'bank.uncat': {
    nl: '{count} banktransacties nog niet gecategoriseerd',
    ar: '{count} معاملة بنكية لم تُصنَّف بعد',
    en: '{count} bank transactions not yet categorised',
  },
  'bank.uncatEen': {
    nl: '1 banktransactie nog niet gecategoriseerd',
    ar: 'معاملة بنكية واحدة لم تُصنَّف بعد',
    en: '1 bank transaction not yet categorised',
  },
  // [BANK-GELD-NIET-GEBOEKT] Hoevéél geld er buiten de boeken staat, niet alleen hoeveel regels.
  // Voor een winkelier is "299 banktransacties" een klus; "€ 266.834 aan uitgaven" is zijn geld —
  // en dat waren precies de twee getallen bij één eigenaar toen dit werd geschreven.
  //
  // UIT en IN blijven apart. financial-result.ts houdt ze om dezelfde reden gescheiden: "€ 10.000
  // in en € 10.000 uit netten tot nul en zouden lezen als 'niets mist' terwijl het twee
  // onverklaarde feiten zijn." Aparte zinnen per geval, want een bedrag dat er niet is hoort ook
  // niet als "€ 0,00" in de zin te staan.
  'bank.uncatGeld.beide': {
    nl: 'Daarin staat {uit} aan uitgaven en {in} aan ontvangsten.',
    ar: 'يشمل ذلك {uit} من المصروفات و{in} من المقبوضات.',
    en: 'That includes {uit} in payments out and {in} in payments in.',
  },
  'bank.uncatGeld.uit': {
    nl: 'Daarin staat {uit} aan uitgaven.',
    ar: 'يشمل ذلك {uit} من المصروفات.',
    en: 'That includes {uit} in payments out.',
  },
  'bank.uncatGeld.in': {
    nl: 'Daarin staat {in} aan ontvangsten.',
    ar: 'يشمل ذلك {in} من المقبوضات.',
    en: 'That includes {in} in payments in.',
  },
  'bank.uncatUitleg': {
    nl: 'Dit geld telt nog niet mee in je winst & verlies en BTW. Geef het een categorie →',
    ar: 'هذا المال لا يُحتسب بعد في ربحك وخسارتك ولا في الضريبة. أعطه تصنيفًا ←',
    en: 'This money does not yet count in your profit & loss and btw. Give it a category →',
  },
  'bank.upload.dubbel': {
    nl: '{count} dubbel overgeslagen',
    ar: 'تم تخطي {count} مكررة',
    en: '{count} duplicates skipped',
  },
  'bank.upload.gelezen': {
    nl: '{parsed} transacties gelezen · {inserted} nieuw',
    ar: 'قُرئت {parsed} معاملة · {inserted} جديدة',
    en: '{parsed} transactions read · {inserted} new',
  },
  'bank.upload.onleesbaar': {
    nl: '{count} regels konden we niet lezen; die ontbreken in je overzicht. Controleer ze in het bestand, dat bewaard is voor je boekhouder.',
    ar: '{count} من البنود تعذّرت قراءتها؛ وهي ناقصة في نظرتك العامة. راجعها في الملف، المحفوظ للمحاسب.',
    en: '{count} lines we could not read; they are missing from your overview. Check them in the file, which is kept for your accountant.',
  },
  'bank.upload.onleesbaarEen': {
    nl: '1 regel konden we niet lezen; die ontbreekt in je overzicht. Controleer hem in het bestand, dat bewaard is voor je boekhouder.',
    ar: 'بند واحد تعذّرت قراءته؛ وهو ناقص في نظرتك العامة. راجعه في الملف، المحفوظ للمحاسب.',
    en: '1 line we could not read; it is missing from your overview. Check it in the file, which is kept for your accountant.',
  },
  'bank.vergelijkBedrag': {
    nl: 'bedrag',
    ar: 'المبلغ',
    en: 'amount',
  },
  'bank.vergelijkDatum': {
    nl: 'datum',
    ar: 'التاريخ',
    en: 'date',
  },
  'bank.vergelijkEn': {
    nl: 'en',
    ar: 'و',
    en: 'and',
  },
  'bank.vergelijkKies': {
    nl: 'en kies de juiste.',
    ar: 'ثم اختر الصحيحة.',
    en: 'and pick the right one.',
  },
  'bank.vernieuwLijst': {
    nl: 'vernieuw de pagina voor de bijgewerkte lijst',
    ar: 'حدّث الصفحة لرؤية القائمة المحدَّثة',
    en: 'refresh the page for the updated list',
  },
  'bank.verplaats.geenBedrag': {
    nl: 'Geen bedrag vastgelegd, dus verplaatsen kan niet. Ontkoppel hem en boek hem opnieuw.',
    ar: 'لم يُسجَّل مبلغ، فلا يمكن النقل. ألغِ ربطها وسجّلها من جديد.',
    en: 'No amount recorded, so it cannot be moved. Unlink it and book it again.',
  },
  'bank.verplaats.kies': {
    nl: 'Kies de factuur waar hij bij hoort; bedrag, betaaldatum en methode gaan ongewijzigd mee.',
    ar: 'اختر الفاتورة التي تخصها؛ ينتقل المبلغ وتاريخ الدفع والطريقة دون تغيير.',
    en: 'Choose the invoice it belongs to; amount, payment date and method carry over unchanged.',
  },
  'bank.verplaats.opEenFactuur': {
    nl: 'Deze betaling staat nu op een factuur.',
    ar: 'هذه الدفعة الآن على فاتورة.',
    en: 'This payment is currently on an invoice.',
  },
  'bank.verplaats.opEenFactuurVan': {
    nl: 'Deze betaling staat nu op een factuur van {name}.',
    ar: 'هذه الدفعة الآن على فاتورة من {name}.',
    en: 'This payment is currently on an invoice from {name}.',
  },
  'bank.verplaats.opFactuur': {
    nl: 'Deze betaling staat nu op factuur {number}.',
    ar: 'هذه الدفعة الآن على الفاتورة {number}.',
    en: 'This payment is currently on invoice {number}.',
  },
  'bank.verplaats.opFactuurVan': {
    nl: 'Deze betaling staat nu op factuur {number} van {name}.',
    ar: 'هذه الدفعة الآن على الفاتورة {number} من {name}.',
    en: 'This payment is currently on invoice {number} from {name}.',
  },
  'bank.verplaatstNaarFactuur': {
    nl: 'Betaling verplaatst naar factuur {number}.',
    ar: 'نُقلت الدفعة إلى الفاتورة {number}.',
    en: 'Payment moved to invoice {number}.',
  },
  'bank.verplaatstNaarGekozen': {
    nl: 'Betaling verplaatst naar de gekozen factuur.',
    ar: 'نُقلت الدفعة إلى الفاتورة المختارة.',
    en: 'Payment moved to the chosen invoice.',
  },
  'bank.verwerken': {
    nl: 'Verwerken…',
    ar: 'جارٍ المعالجة…',
    en: 'Processing…',
  },
  'bank.vinkAan': {
    nl: 'Vink sterke matches aan',
    ar: 'علّم على المطابقات القوية',
    en: 'Tick the strong matches',
  },
  'bank.voegFacturenToe': {
    nl: 'Voeg die facturen nu toe',
    ar: 'أضف تلك الفواتير الآن',
    en: 'Add those invoices now',
  },
  'bank.voegFactuurToe': {
    nl: 'Voeg die factuur nu toe',
    ar: 'أضف تلك الفاتورة الآن',
    en: 'Add that invoice now',
  },
  'bank.welkDeelFactuur': {
    nl: 'Welk deel hoort op deze factuur?',
    ar: 'أي جزء يخص هذه الفاتورة؟',
    en: 'Which part belongs on this invoice?',
  },
  'bank.welkDeelNummer': {
    nl: 'Welk deel hoort op {number}?',
    ar: 'أي جزء يخص {number}؟',
    en: 'Which part belongs on {number}?',
  },
  // [WAAROM-DEZE] De zes signalen die de kaart wél berekende en niet kon tonen. WHY_KEY dekte er
  // vier van de tien, dus juist de STERKSTE redenen (het rekeningnummer, het geheugen van de
  // ondernemer zelf) waren onzichtbaar en een kandidaat leek op "datum dichtbij" te zijn gekozen.
  // Dat is [NO-SILENT-EMPTY] toegepast op een uitleg: de reden bestond, werd berekend, en kwam er
  // als de zwakste beschikbare uit.
  'bank.why.iban': {
    nl: 'zelfde rekeningnummer', ar: 'رقم الحساب نفسه', en: 'same account number', tr: 'aynı hesap numarası',
  },
  'bank.why.supplierIban': {
    nl: 'rekening van deze leverancier', ar: 'حساب هذا المورّد', en: "this supplier's account", tr: 'bu tedarikçinin hesabı',
  },
  'bank.why.memory': {
    nl: 'zo koppelde je het eerder', ar: 'هكذا ربطتها سابقًا', en: 'you linked it this way before', tr: 'daha önce böyle eşleştirdiniz',
  },
  'bank.why.prepared': {
    nl: 'je zette deze factuur klaar om te betalen', ar: 'جهّزت هذه الفاتورة للدفع', en: 'you queued this invoice for payment', tr: 'bu faturayı ödemeye hazırladınız',
  },
  'bank.why.nearAmount': {
    nl: 'bedrag ligt dicht bij het openstaande', ar: 'المبلغ قريب من المتبقّي', en: 'amount is close to the open one', tr: 'tutar açık tutara yakın',
  },
  'bank.why.partialAmount': {
    nl: 'kleiner dan het openstaande bedrag', ar: 'أقل من المبلغ المتبقّي', en: 'smaller than the open amount', tr: 'açık tutardan küçük',
  },
  // [WAAROM-DEZE] En de kop van de kiezer, als GEEN kandidaat op bedrag matcht. "Meerdere facturen
  // passen bij deze betaling" is dan onwaar: ze staan open bij dezelfde partij, meer niet.
  'bank.vergelijkGeenBedrag': {
    nl: 'Geen van deze facturen heeft dit bedrag — wel open bij deze leverancier. Kies alleen als je zeker weet welke.',
    ar: 'لا توجد فاتورة من هذه الفواتير بهذا المبلغ — لكنها مفتوحة لدى هذا المورّد. اختر واحدة فقط إذا كنت متأكدًا أيّها.',
    en: 'None of these invoices has this amount — they are open with this supplier though. Only choose if you are sure which.',
    tr: 'Bu faturaların hiçbiri bu tutarda değil — ama bu tedarikçide açıklar. Yalnızca hangisi olduğundan eminseniz seçin.',
  },
  // [AL-GEBOEKT] De betaling noemt een factuur die al is afgeboekt.
  'bank.alGeboekt.titel': {
    nl: 'Deze betaling hoort bij een factuur die al is afgeboekt',
    ar: 'هذه الدفعة تخصّ فاتورة سُوّيت بالفعل',
    en: 'This payment belongs to an invoice that is already booked',
    tr: 'Bu ödeme, hâlihazırda işlenmiş bir faturaya ait',
  },
  'bank.alGeboekt.regel': {
    nl: 'Factuur {nummer} · {partij}',
    ar: 'فاتورة {nummer} · {partij}',
    en: 'Invoice {nummer} · {partij}',
    tr: 'Fatura {nummer} · {partij}',
  },
  'bank.alGeboekt.zelfdeBedrag': {
    nl: 'Zelfde bedrag, tot op de cent. Niets te kiezen — kijk alleen of deze factuur niet twee keer is betaald.',
    ar: 'المبلغ نفسه حتى السنت. لا شيء تختاره — تحقّق فقط من أن الفاتورة لم تُدفع مرتين.',
    en: 'Same amount, to the cent. Nothing to choose — just check that this invoice was not paid twice.',
    tr: 'Kuruşuna kadar aynı tutar. Seçilecek bir şey yok — yalnızca faturanın iki kez ödenmediğini kontrol edin.',
  },
  'bank.alGeboekt.anderBedrag': {
    nl: 'Ander bedrag dan de factuur: een deelbetaling of een tweede termijn? Kijk zelf welke klopt.',
    ar: 'مبلغ مختلف عن الفاتورة: دفعة جزئية أم قسط ثانٍ؟ تحقّق بنفسك أيّهما الصحيح.',
    en: 'Different amount than the invoice: a part payment or a second instalment? Check which is right.',
    tr: 'Faturadan farklı tutar: kısmi ödeme mi, ikinci taksit mi? Hangisinin doğru olduğunu kontrol edin.',
  },
  'bank.alGeboekt.verwerkt': {
    nl: 'Je boekhouder heeft deze factuur al verwerkt. Neem contact op voordat je hier iets verandert.',
    ar: 'محاسبك عالج هذه الفاتورة بالفعل. تواصل معه قبل تغيير أي شيء هنا.',
    en: 'Your accountant has already processed this invoice. Contact them before changing anything here.',
    tr: 'Muhasebeciniz bu faturayı zaten işledi. Burada bir şey değiştirmeden önce onunla görüşün.',
  },
  'bank.alGeboekt.waaromGeenKeuze': {
    nl: 'Daarom staan er geen facturen om uit te kiezen: de andere facturen van deze leverancier horen bij andere betalingen.',
    ar: 'لذلك لا توجد فواتير للاختيار: فواتير هذا المورّد الأخرى تخصّ دفعات أخرى.',
    en: 'That is why no invoices are offered: this supplier\'s other invoices belong to other payments.',
    tr: 'Bu yüzden seçilecek fatura yok: bu tedarikçinin diğer faturaları başka ödemelere ait.',
  },
  // ── [SOM-KLOPT] Eén betaling, meerdere genoemde facturen ────────────────────────────────────
  //
  // De zin die hier stond ging over ÉÉN factuur en zei dat het bedrag niet klopte — boven een
  // betaling waarvan de drie genoemde facturen samen exact het bedrag zijn. Nu telt de kaart op.
  'bank.somKlopt.titel': {
    nl: 'Deze betaling hoort bij facturen die al zijn afgeboekt',
    ar: 'هذه الدفعة تخصّ فواتير سُوّيت بالفعل',
    en: 'This payment belongs to invoices that are already settled',
  },
  'bank.somKlopt.titelDeels': {
    nl: 'Deze betaling noemt deze facturen',
    ar: 'هذه الدفعة تذكر هذه الفواتير',
    en: 'This payment quotes these invoices',
  },
  'bank.somKlopt.nogOpen': {
    nl: 'Daarvan staat {nummers} nog open — koppel hem hieronder, dan is deze regel klaar.',
    ar: 'من بينها {nummers} ما زالت مفتوحة — اربطها أدناه ليكتمل هذا السطر.',
    en: 'Of those, {nummers} is still open — link it below and this line is done.',
  },
  'bank.somKlopt.telt': {
    nl: 'Samen {som} — precies het bedrag van deze betaling. Niets te kiezen; controleer alleen of niets twee keer is betaald.',
    ar: 'المجموع {som} — تمامًا مبلغ هذه الدفعة. لا شيء تختاره؛ تحقّق فقط من عدم دفع شيء مرتين.',
    en: 'Together {som} — exactly the amount of this payment. Nothing to choose; only check that nothing was paid twice.',
  },
  // [NO-SILENT-EMPTY] De reden waarom de optelsom er NIET staat. Zonder deze zin viel de kaart terug
  // op een regel over iets anders, zodat de ondernemer nooit te horen kreeg DÁT er niets is opgeteld
  // — stilte op precies het moment dat een geldscherm iets moet toegeven.
  'bank.somKlopt.somOnleesbaar': {
    nl: 'Van één factuur is het bedrag niet gelezen, dus we tellen niets op. Kijk ze zelf na voor je koppelt.',
    ar: 'مبلغ إحدى الفواتير لم يُقرأ، لذلك لا نجمع شيئًا. تحقّق منها بنفسك قبل الربط.',
    en: 'One invoice\'s amount was not read, so we add nothing up. Check them yourself before you link.',
  },
  'bank.somKlopt.teltNiet': {
    nl: 'Samen {som}, deze betaling {betaling}. Het verschil hoort ergens bij: een deelbetaling, of een factuur die nog ontbreekt.',
    ar: 'المجموع {som}، وهذه الدفعة {betaling}. الفرق له سبب: دفعة جزئية، أو فاتورة ما زالت ناقصة.',
    en: 'Together {som}, this payment {betaling}. The difference belongs somewhere: a part payment, or an invoice still missing.',
  },
  // Genoemd én niet gevonden. Dit is de enige regel op de kaart die om iets VRAAGT, dus hij staat
  // apart en noemt de nummers: "voeg hem toe" zonder te zeggen wélke is geen opdracht.
  'bank.somKlopt.ontbreekt': {
    nl: 'Deze betaling noemt ook {nummers}, en die staat nog niet in je administratie. Voeg hem toe, dan klopt deze regel.',
    ar: 'تذكر هذه الدفعة أيضًا {nummers}، وهي ليست في إدارتك بعد. أضفها ليستقيم هذا البند.',
    en: 'This payment also quotes {nummers}, which is not in your administration yet. Add it and this line settles.',
  },
  'bank.alGeboekt.bekijk': {
    nl: 'Factuur bekijken',
    ar: 'عرض الفاتورة',
    en: 'View invoice',
    tr: 'Faturayı görüntüle',
  },
  'bank.why.amount': {
    nl: 'bedrag komt overeen',
    ar: 'المبلغ مطابق',
    en: 'amount matches',
  },
  'bank.why.counterpart': {
    nl: 'zelfde tegenpartij',
    ar: 'الطرف المقابل نفسه',
    en: 'same counterparty',
  },
  'bank.why.date': {
    nl: 'datum dichtbij',
    ar: 'التاريخ قريب',
    en: 'date close by',
  },
  'bank.why.reference': {
    nl: 'nummer in omschrijving',
    ar: 'الرقم في الوصف',
    en: 'number in the description',
  },
  'bank.zoekLeeg': {
    nl: 'Geen transacties gevonden voor “{query}”.',
    ar: 'لم يُعثر على معاملات لـ«{query}».',
    en: 'No transactions found for “{query}”.',
  },
  'bank.zonderInkoop': {
    nl: '{count} betalingen zonder inkoopfactuur',
    ar: '{count} دفعة بلا فاتورة مشتريات',
    en: '{count} payments without a purchase invoice',
  },
  'bank.zonderInkoopEen': {
    nl: '1 betaling zonder inkoopfactuur',
    ar: 'دفعة واحدة بلا فاتورة شراء',
    en: '1 payment without a purchase invoice',
  },
  'bank.zonderInkoopUitleg': {
    nl: 'Betaald, maar zonder factuur — en zonder factuur geen voorbelasting. Voeg hem toe of haal je e-mail opnieuw op; koppelen doen wij.',
    ar: 'مدفوعة لكن بلا فاتورة — وبلا فاتورة لا خصم ضريبة. أضفها أو أعد جلب بريدك؛ الربط علينا.',
    en: 'Paid, but without an invoice — and without an invoice no input VAT. Add it or fetch your e-mail again; we do the linking.',
  },
  'best.aanbevolenLocatie': {
    nl: 'Aanbevolen locatie:',
    ar: 'الموقع الموصى به:',
    en: 'Recommended location:',
  },
  'best.aanbevolenMap': {
    nl: 'Aanbevolen map',
    ar: 'المجلد الموصى به',
    en: 'Recommended folder',
  },
  // Singular form, only ever rendered when the count IS one — so the number is inlined in
  // every language and no placeholder is needed (Arabic says the word, not the digit).
  'best.aantalBestandEen': {
    nl: '1 bestand',
    ar: 'ملف واحد',
    en: '1 file',
  },
  'best.aantalBestanden': {
    nl: '{n} bestanden',
    ar: 'عدد الملفات: {n}',
    en: '{n} files',
  },
  'best.aflopend': {
    nl: 'Aflopend',
    ar: 'تنازلي',
    en: 'Descending',
  },
  'best.aiGebaseerd': {
    nl: 'Gebaseerd op inhoud van het bestand',
    ar: 'استنادًا إلى محتوى الملف',
    en: 'Based on the file’s contents',
  },
  'best.aiSteltVoor': {
    nl: 'AI stelt voor',
    ar: 'اقتراح الذكاء الاصطناعي',
    en: 'AI suggests',
  },
  'best.bekijken': {
    nl: 'Bekijken',
    ar: 'عرض',
    en: 'View',
  },
  'best.berekenen': {
    nl: 'Berekenen…',
    ar: 'جارٍ الحساب…',
    en: 'Calculating…',
  },
  'best.bestandenAantal': {
    nl: 'Bestanden — {n}',
    ar: 'الملفات — {n}',
    en: 'Files — {n}',
  },
  'best.bestandHernoemen': {
    nl: 'Bestand hernoemen',
    ar: 'إعادة تسمية الملف',
    en: 'Rename the file',
  },
  'best.bulkVerwijderen': {
    nl: 'De bestanden gaan naar de prullenbak. Je kunt ze daar terughalen.',
    ar: 'تذهب الملفات إلى سلة المهملات، ويمكنك استعادتها منها.',
    en: 'The files go to the bin. You can retrieve them there.',
  },
  'best.bulkVerwijderenMappen': {
    nl: 'Bestanden gaan naar de prullenbak en kun je terughalen. Geselecteerde mappen worden verwijderd; de bestanden daaruit verhuizen naar je hoofdmap.',
    ar: 'تذهب الملفات إلى سلة المهملات ويمكنك استعادتها. تُحذف المجلدات المحددة؛ وتنتقل ملفاتها إلى مجلدك الرئيسي.',
    en: 'Files go to the bin and can be retrieved. Selected folders are deleted; their files move to your main folder.',
  },
  'best.delenBoekhouder': {
    nl: 'Delen met boekhouder',
    ar: 'مشاركة مع المحاسب',
    en: 'Share with the accountant',
  },
  'best.delenGestopt': {
    nl: 'Delen gestopt',
    ar: 'أُوقفت المشاركة',
    en: 'Sharing stopped',
  },
  'best.downloaden': {
    nl: 'Downloaden',
    ar: 'تنزيل',
    en: 'Download',
  },
  'best.favorieten': {
    nl: 'Favorieten',
    ar: 'المفضّلة',
    en: 'Favourites',
  },
  'best.fout.actie': {
    nl: 'Actie mislukt',
    ar: 'فشل الإجراء',
    en: 'The action failed',
  },
  'best.fout.delen': {
    nl: 'Delen mislukt — probeer opnieuw',
    ar: 'فشلت المشاركة — حاول مرة أخرى',
    en: 'Sharing failed — try again',
  },
  'best.fout.hernoemen': {
    nl: 'Hernoemen mislukt',
    ar: 'فشلت إعادة التسمية',
    en: 'Renaming failed',
  },
  'best.fout.mapAanmaken': {
    nl: 'Map aanmaken mislukt',
    ar: 'فشل إنشاء المجلد',
    en: 'Creating the folder failed',
  },
  'best.fout.mapVerwijderen': {
    nl: 'Map verwijderen mislukt',
    ar: 'فشل حذف المجلد',
    en: 'Deleting the folder failed',
  },
  'best.fout.sommigeAangepast': {
    nl: 'Sommige items niet aangepast — opnieuw geladen',
    ar: 'لم تُعدَّل بعض العناصر — أُعيد التحميل',
    en: 'Some items were not changed — reloaded',
  },
  'best.fout.sommigeGedeeld': {
    nl: 'Sommige bestanden niet gedeeld — opnieuw geladen',
    ar: 'لم تُشارك بعض الملفات — أُعيد التحميل',
    en: 'Some files were not shared — reloaded',
  },
  'best.fout.sommigeVerplaatst': {
    nl: 'Sommige items niet verplaatst — opnieuw geladen',
    ar: 'لم تُنقل بعض العناصر — أُعيد التحميل',
    en: 'Some items were not moved — reloaded',
  },
  'best.fout.sommigeVerwijderd': {
    nl: 'Sommige items niet verwijderd — opnieuw geladen',
    ar: 'لم تُحذف بعض العناصر — أُعيد التحميل',
    en: 'Some items were not deleted — reloaded',
  },
  'best.fout.stoppenDelen': {
    nl: 'Stoppen met delen mislukt',
    ar: 'فشل إيقاف المشاركة',
    en: 'Stopping sharing failed',
  },
  'best.fout.verplaatsen': {
    nl: 'Verplaatsen mislukt',
    ar: 'فشل النقل',
    en: 'Moving failed',
  },
  'best.fout.verplaatstNogHier': {
    nl: 'Verplaatsen mislukt — het bestand staat nog hier',
    ar: 'فشل النقل — الملف ما زال هنا',
    en: 'Moving failed — the file is still here',
  },
  'best.fout.verwijderen': {
    nl: 'Verwijderen mislukt',
    ar: 'فشل الحذف',
    en: 'Deleting failed',
  },
  'best.gebruikt': {
    nl: '{size} gebruikt',
    ar: 'المستخدم: {size}',
    en: '{size} used',
  },
  'best.gedeeldMet': {
    nl: 'Gedeeld met je boekhouder',
    ar: 'شورك مع المحاسب',
    en: 'Shared with your accountant',
  },
  'best.geknipt': {
    nl: '{n} items geknipt — Ctrl+V om te plakken',
    ar: 'عناصر مقصوصة: {n} — Ctrl+V للصق',
    en: '{n} items cut — Ctrl+V to paste',
  },
  'best.geknipt1': {
    nl: '1 item geknipt — Ctrl+V om te plakken',
    ar: 'قُصّ عنصر واحد — Ctrl+V للصق',
    en: '1 item cut — Ctrl+V to paste',
  },
  'best.gekopieerd': {
    nl: '{n} items gekopieerd — Ctrl+V om te plakken',
    ar: 'عناصر منسوخة: {n} — Ctrl+V للصق',
    en: '{n} items copied — Ctrl+V to paste',
  },
  'best.gekopieerd1': {
    nl: '1 item gekopieerd — Ctrl+V om te plakken',
    ar: 'نُسخ عنصر واحد — Ctrl+V للصق',
    en: '1 item copied — Ctrl+V to paste',
  },
  'best.grootte': {
    nl: 'Grootte',
    ar: 'الحجم',
    en: 'Size',
  },
  'best.itemsVerwijderen': {
    nl: '{n} item(s) verwijderen?',
    ar: 'حذف العناصر ({n})؟',
    en: 'Delete {n} item(s)?',
  },
  'best.jaHier': {
    nl: 'Ja, hier plaatsen',
    ar: 'نعم، ضعه هنا',
    en: 'Yes, place it here',
  },
  'best.kiesZelfMap': {
    nl: 'Kies zelf een map',
    ar: 'اختيار مجلد',
    en: 'Choose a folder yourself',
  },
  'best.lijstweergave': {
    nl: 'Lijstweergave',
    ar: 'عرض قائمة',
    en: 'List view',
  },
  'best.mapHernoemen': {
    nl: 'Map hernoemen',
    ar: 'إعادة تسمية المجلد',
    en: 'Rename the folder',
  },
  'best.mapnaam': {
    nl: 'Mapnaam...',
    ar: 'اسم المجلد...',
    en: 'Folder name...',
  },
  'best.mapVerwijderenKnop': {
    nl: 'Map verwijderen',
    ar: 'حذف المجلد',
    en: 'Delete the folder',
  },
  'best.mapVerwijderenTitel': {
    nl: 'Map "{name}" verwijderen?',
    ar: 'حذف المجلد "{name}"؟',
    en: 'Delete the folder "{name}"?',
  },
  'best.mapVerwijderenUitleg': {
    nl: 'De bestanden erin blijven bestaan — die verhuizen naar je hoofdmap.',
    ar: 'تبقى الملفات الموجودة فيه — وتنتقل إلى مجلدك الرئيسي.',
    en: 'The files inside remain — they move to your main folder.',
  },
  'best.naarPrullenbakActie': {
    nl: 'Naar prullenbak',
    ar: 'إلى سلة المهملات',
    en: 'To the bin',
  },
  'best.naarPrullenbakEen': {
    nl: 'Bestand naar prullenbak',
    ar: 'نُقل الملف إلى سلة المهملات',
    en: 'File moved to the bin',
  },
  'best.naarPrullenbakMeer': {
    nl: '{n} bestanden naar prullenbak',
    ar: 'ملفات نُقلت إلى سلة المهملات: {n}',
    en: '{n} files moved to the bin',
  },
  'best.nietMeerDelen': {
    nl: 'Niet meer delen',
    ar: 'إيقاف المشاركة',
    en: 'Stop sharing',
  },
  'best.ongedaan': {
    nl: 'Ongedaan maken',
    ar: 'تراجع',
    en: 'Undo',
  },
  'best.oplopend': {
    nl: 'Oplopend',
    ar: 'تصاعدي',
    en: 'Ascending',
  },
  'best.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'best.raster': {
    nl: 'Rasterweergave',
    ar: 'عرض شبكي',
    en: 'Grid view',
  },
  'best.resultatenVoor': {
    nl: '{n} resultaten voor "{query}"',
    ar: 'نتائج البحث عن "{query}": {n}',
    en: '{n} results for "{query}"',
  },
  'best.smart.gedeeldLeeg': {
    nl: 'Bestanden die je met je boekhouder deelt verschijnen hier',
    ar: 'تظهر هنا الملفات التي تشاركها مع المحاسب',
    en: 'Files you share with your accountant appear here',
  },
  'best.smart.recentLeeg': {
    nl: 'Recent geopende of toegevoegde bestanden verschijnen hier',
    ar: 'تظهر هنا الملفات المفتوحة أو المضافة مؤخرًا',
    en: 'Recently opened or added files appear here',
  },
  'best.smart.sterLeeg': {
    nl: 'Markeer bestanden met een ster om ze hier terug te vinden',
    ar: 'علّم الملفات بنجمة لتجدها هنا',
    en: 'Star files to find them back here',
  },
  'best.sterMarkeren': {
    nl: 'Markeren met ster',
    ar: 'تعليم بنجمة',
    en: 'Mark with a star',
  },
  'best.sterVerwijderen': {
    nl: 'Ster verwijderen',
    ar: 'إزالة النجمة',
    en: 'Remove the star',
  },
  'best.verplaatsen': {
    nl: 'Verplaatsen',
    ar: 'نقل',
    en: 'Move',
  },
  'best.zoeken': {
    nl: 'Zoeken...',
    ar: 'بحث...',
    en: 'Search...',
  },
  'bewerk.akkoordBetaalOp': {
    nl: 'Bij akkoord betaal je op',
    ar: 'عند الموافقة يتم الدفع إلى',
    en: 'On acceptance you pay to',
  },
  'bewerk.datum.leverUitleg': {
    nl: 'De datum waarop de levering of dienst is verricht. Vaak dezelfde als de factuurdatum, maar niet altijd — en hij is wettelijk verplicht op de factuur.',
    ar: 'التاريخ الذي تمّ فيه التسليم أو أداء الخدمة. غالبًا هو نفس تاريخ الفاتورة، لكن ليس دائمًا — وهو إلزامي قانونًا على الفاتورة.',
    en: 'The date the delivery or service was performed. Often the same as the invoice date, but not always — and it is legally required on the invoice.',
  },
  'bewerk.fout.verzenden': {
    nl: 'Verzenden mislukt',
    ar: 'فشل الإرسال',
    en: 'Sending failed',
  },
  'bewerk.modal.bedrag': {
    nl: 'Bedrag:',
    ar: 'المبلغ:',
    en: 'Amount:',
  },
  'bewerk.modal.email': {
    nl: 'E-mail:',
    ar: 'البريد الإلكتروني:',
    en: 'E-mail:',
  },
  'bewerk.modal.nummer': {
    nl: 'Factuurnummer:',
    ar: 'رقم الفاتورة:',
    en: 'Invoice number:',
  },
  'bewerk.modal.nummerBijVerzending': {
    nl: 'Wordt toegekend bij verzending',
    ar: 'يُخصَّص عند الإرسال',
    en: 'Assigned on sending',
  },
  // [HERSTEL] Deze zin zei tot nu toe dat een verstuurde factuur NOOIT meer te wijzigen is en dat
  // een creditnota de enige weg is. Dat is niet meer waar en het was de duurste soort onwaarheid:
  // hij stuurt de ondernemer naar een creditnota — een tweede document, in zijn nummerreeks, in
  // zijn aangifte — voor een tikfout die hij gewoon had mogen herstellen.
  //
  // Wat WEL vastligt is het NUMMER (art. 35 Wet OB, doorlopende reeks zonder gaten). De factuur
  // zelf is bewerkbaar zolang sentEditBlockers geen grendel vindt: niets betaald, geen bank- of
  // kaskoppeling, geen creditnota, niet verwerkt door de boekhouder, kwartaal niet ingediend.
  // Onbekend telt daar als grendel, dus de zin belooft niets wat de server kan weigeren.
  'bewerk.modal.waarschuwing': {
    nl: 'Het factuurnummer ligt na verzending vast. De factuur zelf kun je corrigeren zolang hij niet betaald of verwerkt is — je klant krijgt dan automatisch de gecorrigeerde versie.',
    ar: 'رقم الفاتورة يثبت بعد الإرسال. أما الفاتورة نفسها فيمكنك تصحيحها ما دامت غير مدفوعة وغير مُرحَّلة — وعندها يستلم عميلك النسخة المصحَّحة تلقائيًا.',
    en: 'The invoice number is fixed once sent. The invoice itself you can correct while it is not paid or booked — your customer then automatically receives the corrected version.',
  },
  'bewerk.opslaan': {
    nl: 'Wijzigingen opslaan',
    ar: 'حفظ التغييرات',
    en: 'Save changes',
  },
  'bewerk.opslaanBezig': {
    nl: 'Opslaan...',
    ar: 'جارٍ الحفظ…',
    en: 'Saving...',
  },
  'bewerk.prijsmodus.excl': {
    nl: 'Je typt de prijs zonder btw.',
    ar: 'تكتب السعر بدون ضريبة القيمة المضافة.',
    en: 'You type the price without VAT.',
  },
  'bewerk.prijsmodus.incl': {
    nl: 'Je typt wat je klant betaalt.',
    ar: 'تكتب ما يدفعه عميلك.',
    en: 'You type what your customer pays.',
  },
  'bewerk.profielOnvolledig': {
    nl: 'KVK, BTW of IBAN ontbreekt — vul dit aan in je profiel voor een geldige factuur',
    ar: 'رقم KVK أو رقم btw أو IBAN ناقص — أكمِله في ملفك الشخصي لتكون الفاتورة صالحة',
    en: 'KVK, VAT or IBAN is missing — complete it in your profile for a valid invoice',
  },
  'bewerk.titel.factuur': {
    nl: 'Factuur bewerken',
    ar: 'تعديل الفاتورة',
    en: 'Edit invoice',
  },
  'bewerk.titel.factuurMetNummer': {
    nl: 'Factuur bewerken · {number}',
    ar: 'تعديل الفاتورة · {number}',
    en: 'Edit invoice · {number}',
  },
  'bewerk.titel.offerte': {
    nl: 'Offerte bewerken',
    ar: 'تعديل عرض السعر',
    en: 'Edit quote',
  },
  'bewerk.vastgelegd': {
    nl: 'Deze factuur is verstuurd en wettelijk vastgelegd — wijzigen kan niet meer. Maak een creditnota aan om te corrigeren.',
    ar: 'هذه الفاتورة أُرسلت وثُبّتت قانونيًا — لم يعد التعديل ممكنًا. أنشئ إشعارًا دائنًا (creditnota) للتصحيح.',
    en: 'This invoice has been sent and is legally recorded — it can no longer be changed. Create a credit note to correct it.',
  },
  'bewerk.verstuurFactuur': {
    nl: 'Verstuur factuur',
    ar: 'إرسال الفاتورة',
    en: 'Send invoice',
  },
  'bewerk.verzendenBezig': {
    nl: 'Verzenden...',
    ar: 'جارٍ الإرسال…',
    en: 'Sending...',
  },
  'brug.alleKanalen': {
    nl: 'Q{quarter} {year} · alle kanalen (kassa, bank, kas, facturen)',
    ar: 'Q{quarter} {year} · كل القنوات (الكاشير، البنك، الصندوق، الفواتير)',
    en: 'Q{quarter} {year} · all channels (till, bank, cash, invoices)',
  },
  'brug.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'brug.btw5a': {
    nl: 'BTW verschuldigd (5a)',
    ar: 'btw المستحقة (5a)',
    en: 'VAT due (5a)',
  },
  'brug.btw5b': {
    nl: 'Voorbelasting (5b)',
    ar: 'الضريبة القابلة للخصم (5b)',
    en: 'Input tax (5b)',
  },
  'brug.btw5gBetalen': {
    nl: 'Concept te betalen (5g)',
    ar: 'المبلغ المبدئي للدفع (5g)',
    en: 'Provisional to pay (5g)',
  },
  'brug.btw5gTerug': {
    nl: 'Concept terug te ontvangen (5g)',
    ar: 'المبدئي المسترد (5g)',
    en: 'Provisional to receive back (5g)',
  },
  'brug.conceptBtwBetalen': {
    nl: 'Concept BTW te betalen',
    ar: 'btw المبدئية للدفع',
    en: 'Provisional VAT to pay',
  },
  'brug.conceptBtwTerug': {
    nl: 'Concept BTW terug te ontvangen',
    ar: 'btw المبدئية المستردة',
    en: 'Provisional VAT to receive back',
  },
  'brug.downloadKwartaal': {
    nl: 'Download kwartaal',
    ar: 'تنزيل الربع',
    en: 'Download quarter',
  },
  'brug.en': {
    nl: 'en',
    ar: 'و',
    en: 'and',
  },
  'brug.evenControleren': {
    nl: 'Even controleren',
    ar: 'تحقّق سريع',
    en: 'Worth checking',
  },
  'brug.fout.nietLaden': {
    nl: 'We konden {parts} niet laden',
    ar: 'تعذّر علينا تحميل {parts}',
    en: 'We could not load {parts}',
  },
  'brug.fout.opslaan': {
    nl: 'Opslaan mislukt.',
    ar: 'فشل الحفظ.',
    en: 'Saving failed.',
  },
  'brug.fout.pakket': {
    nl: 'Het pakket kon niet worden gemaakt. Probeer het opnieuw.',
    ar: 'تعذّر إنشاء الحزمة. حاول مرة أخرى.',
    en: 'The package could not be created. Please try again.',
  },
  'brug.fout.pakketOffline': {
    nl: 'Geen verbinding — het pakket is niet gedownload.',
    ar: 'لا يوجد اتصال — لم تُنزَّل الحزمة.',
    en: 'No connection — the package was not downloaded.',
  },
  'brug.fout.statusOffline': {
    nl: 'Geen verbinding — de status is niet opgeslagen.',
    ar: 'لا يوجد اتصال — لم تُحفَظ الحالة.',
    en: 'No connection — the status was not saved.',
  },
  'brug.fout.vraagOffline': {
    nl: 'Geen verbinding — je vraag is niet verstuurd.',
    ar: 'لا يوجد اتصال — لم يُرسَل سؤالك.',
    en: 'No connection — your question was not sent.',
  },
  'brug.fout.vraagOpnieuw': {
    nl: 'Je vraag is niet verstuurd — probeer het opnieuw.',
    ar: 'لم يُرسَل سؤالك — حاول مرة أخرى.',
    en: 'Your question was not sent — please try again.',
  },
  'brug.inkomend': {
    nl: 'Ink.',
    ar: 'وارد',
    en: 'In',
  },
  'brug.kiesKlantOptie': {
    nl: '— Kies een klant —',
    ar: '— اختر عميلًا —',
    en: '— Choose a client —',
  },
  'brug.klaar.bijna': {
    nl: 'Bijna klaar',
    ar: 'شبه جاهز',
    en: 'Almost ready',
  },
  'brug.klaar.nogNiet': {
    nl: 'Nog niet klaar',
    ar: 'غير جاهز بعد',
    en: 'Not ready yet',
  },
  'brug.klaar.voorVerwerking': {
    nl: 'Klaar voor verwerking',
    ar: 'جاهز للمعالجة',
    en: 'Ready for processing',
  },
  'brug.klantenGekoppeld': {
    nl: '{count} klanten gekoppeld',
    ar: 'العملاء المرتبطون: {count}',
    en: '{count} clients linked',
  },
  'brug.kostenExcl': {
    nl: 'Kosten (excl. BTW)',
    ar: 'التكاليف (بدون btw)',
    en: 'Costs (excl. VAT)',
  },
  'brug.moetGebeuren': {
    nl: 'Wat moet er nog gebeuren',
    ar: 'ما الذي يجب فعله بعد',
    en: 'What still needs to happen',
  },
  'brug.omzetExcl': {
    nl: 'Omzet (excl. BTW)',
    ar: 'الإيراد (بدون btw)',
    en: 'Turnover (excl. VAT)',
  },
  'brug.omzetZonderTarief': {
    nl: '{amount} omzet (contant of via de bank) heeft nog geen BTW-tarief — die BTW zit niet in 5a.',
    ar: '{amount} من الإيرادات (نقدًا أو عبر البنك) بلا نسبة ضريبة بعد — هذه الضريبة ليست ضمن 5a.',
    en: '{amount} of turnover (cash or via the bank) has no VAT rate yet — that VAT is not in 5a.',
  },
  'brug.resultaat': {
    nl: 'Resultaat',
    ar: 'النتيجة',
    en: 'Result',
  },
  'brug.status.inBehandeling': {
    nl: 'In behandeling',
    ar: 'قيد المعالجة',
    en: 'In progress',
  },
  'brug.status.teVerwerken': {
    nl: 'Te verwerken',
    ar: 'بانتظار المعالجة',
    en: 'To process',
  },
  'brug.status.verwerkt': {
    nl: 'Verwerkt',
    ar: 'تمت المعالجة',
    en: 'Processed',
  },
  'brug.status.vraag': {
    nl: 'Vraag',
    ar: 'سؤال',
    en: 'Question',
  },
  'brug.tab.documenten': {
    nl: 'Documenten',
    ar: 'المستندات',
    en: 'Documents',
  },
  'brug.tab.kwartaal': {
    nl: 'Kwartaal',
    ar: 'الربع',
    en: 'Quarter',
  },
  'brug.tab.overzicht': {
    nl: 'Overzicht',
    ar: 'نظرة عامة',
    en: 'Overview',
  },
  'brug.uitgaand': {
    nl: 'Uitg.',
    ar: 'صادر',
    en: 'Out',
  },
  'brug.vraag.placeholder': {
    nl: 'Waar gaat deze bon over?',
    ar: 'ما موضوع هذا الإيصال؟',
    en: 'What is this receipt about?',
  },
  'brug.vraag.titel': {
    nl: 'Vraag over dit document',
    ar: 'سؤال عن هذا المستند',
    en: 'Question about this document',
  },
  'brug.vraag.uitleg': {
    nl: 'Je klant ziet deze tekst op zijn scherm en kan er direct op antwoorden.',
    ar: 'يرى عميلك هذا النص على شاشته ويمكنه الرد عليه مباشرة.',
    en: 'Your client sees this text on their screen and can reply to it directly.',
  },
  'brug.vraag.versturen': {
    nl: 'Vraag versturen',
    ar: 'إرسال السؤال',
    en: 'Send the question',
  },
  'brug.zoek.geen': {
    nl: 'Geen documenten gevonden voor “{query}”',
    ar: 'لم يُعثر على مستندات لـ«{query}»',
    en: 'No documents found for “{query}”',
  },
  'brug.zoek.resultaat': {
    nl: '1 resultaat in alle mappen',
    ar: 'نتيجة واحدة في كل المجلدات',
    en: '1 result in all folders',
  },
  'brug.zoek.resultaten': {
    nl: '{count} resultaten in alle mappen',
    ar: 'النتائج في كل المجلدات: {count}',
    en: '{count} results in all folders',
  },
  // [NUMMER-KOPIEREN] Eén tik kopieert een waarde die je anders met de hand moet selecteren.
  // {wat} is het SOORT waarde en {waarde} de waarde zelf — geen zelfstandig naamwoord middenin een
  // zin dat per taal anders vervoegt, maar een label en een getal naast elkaar.
  'kopieer.aria': {
    nl: '{wat} {waarde} kopiëren',
    ar: 'نسخ {wat} {waarde}',
    en: 'Copy {wat} {waarde}',
  },
  'kopieer.gelukt': {
    nl: 'Gekopieerd',
    ar: 'تم النسخ',
    en: 'Copied',
  },
  // [KOPIE-EERLIJK] The sentence names the HAZARD, not the inconvenience. A refused write does not
  // empty the clipboard — it leaves the previous value there — and these screens copy IBANs,
  // amounts and payment references. "It didn't work" would let the owner paste anyway; "the
  // previous one is still on there" tells them why they must not.
  //
  // No parameter, deliberately: naming the field would put a noun inside a sentence (AGENTS.md),
  // and the field name adds nothing here — what matters is that the clipboard is stale.
  'kopieer.mislukt': {
    nl: 'Kopiëren lukte niet — op je klembord staat nog het vorige.',
    ar: 'تعذّر النسخ — لا يزال في الحافظة ما نسخته قبل ذلك.',
    en: 'Copying failed — your clipboard still holds the previous value.',
  },
  // The same fact as a button label, for the buttons that swap their own text instead of raising a
  // message. Short, because it replaces "Kopiëren" in place.
  'kopieer.nietGelukt': {
    nl: 'Niet gelukt',
    ar: 'لم ينجح',
    en: 'Failed',
  },
  // Het SOORT waarde, voor de schermlezer. Eigen sleutel per soort: "Factuurnummer" en "IBAN"
  // vervoegen niet hetzelfde en een van de twee zou in het Arabisch scheef staan.
  'kopieer.wat.factuurnummer': {
    nl: 'Factuurnummer',
    ar: 'رقم الفاتورة',
    en: 'Invoice number',
  },
  // [DUBBEL-GEDEKT] Waarom deze regel niet is ingevuld. Vier zinnen, elk een eigen sleutel: een
  // zelfstandig naamwoord in een zin is geen parameter (AGENTS.md), en deze twee gevallen zeggen
  // iets anders — de ene gaat over één factuur, de andere over een hele uitbetaling.
  'cat.alGeboekt.factuur': {
    nl: 'Een betaalde factuur verklaart dit bedrag al.',
    ar: 'هناك فاتورة مدفوعة تفسّر هذا المبلغ بالفعل.',
    en: 'A paid invoice already accounts for this amount.',
  },
  'cat.alGeboekt.factuurUitleg': {
    nl: 'Waarschijnlijk is dit de betaling ervan. Kies alleen een categorie als het echt een tweede uitgave is — anders staat de kost twee keer in je winst & verlies.',
    ar: 'على الأرجح هذه هي دفعة الفاتورة. لا تختر تصنيفًا إلا إذا كانت فعلًا نفقة ثانية — وإلا ستُسجَّل التكلفة مرتين في أرباحك وخسائرك.',
    en: 'This is most likely the payment of it. Only pick a category if it really is a second expense — otherwise the cost lands in your profit and loss twice.',
  },
  'cat.alGeboekt.mollie': {
    nl: 'Dit lijkt een uitbetaling van Mollie.',
    ar: 'يبدو أنّ هذا تحويل من Mollie.',
    en: 'This looks like a Mollie payout.',
  },
  'cat.alGeboekt.mollieUitleg': {
    nl: 'De facturen die erin zitten staan al als betaald in je boeken. Kies alleen een categorie als je zeker weet dat dit iets anders is.',
    ar: 'الفواتير التي تشملها مسجَّلة أصلًا كمدفوعة في دفاترك. لا تختر تصنيفًا إلا إذا كنت واثقًا أن هذا شيء آخر.',
    en: 'The invoices inside it are already marked paid in your books. Only pick a category if you are sure this is something else.',
  },
  'cat.automatisch': {
    nl: 'automatisch ingevuld',
    ar: 'عُبّئت تلقائيًا',
    en: 'filled in automatically',
  },
  'cat.bevestigen': {
    nl: 'Bevestigen',
    ar: 'تأكيد',
    en: 'Confirm',
  },
  'cat.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'cat.doorJou': {
    nl: 'door jou bevestigd',
    ar: 'أكّدتها بنفسك',
    en: 'confirmed by you',
  },
  'cat.eersteGetoond': {
    nl: 'we tonen de eerste {count}',
    ar: 'نعرض أول {count}',
    en: 'showing the first {count}',
  },
  'cat.herkend': {
    nl: 'herkend',
    ar: 'معروفة',
    en: 'recognised',
  },
  'cat.ingevuld': {
    nl: 'ingevulde transacties',
    ar: 'معاملة معبَّأة',
    en: 'filled-in transactions',
  },
  'cat.introReview': {
    nl: 'Controleer wat we al hebben ingevuld en wijzig een verkeerde categorie.',
    ar: 'راجع ما عبّأناه بالفعل وعدّل أي تصنيف خاطئ.',
    en: 'Check what we already filled in and change a wrong category.',
  },
  'cat.introTodo': {
    nl: 'Geef elke banktransactie een plek. We onthouden je keuze per bedrijf.',
    ar: 'أعطِ كل معاملة بنكية مكانها. نتذكّر اختيارك لكل شركة.',
    en: 'Give every bank transaction a place. We remember your choice per company.',
  },
  'cat.lijktOp': {
    nl: 'lijkt op {name}',
    ar: 'تشبه {name}',
    en: 'looks like {name}',
  },
  'cat.lijktOpEerdere': {
    nl: 'lijkt op eerdere',
    ar: 'تشبه سابقاتها',
    en: 'looks like earlier ones',
  },
  'cat.nogTeDoen': {
    nl: 'Nog {count} transacties te doen',
    ar: 'المتبقي: {count} معاملة',
    en: '{count} transactions still to do',
  },
  'cat.nogTeDoenEen': {
    nl: 'Nog 1 transactie te doen',
    ar: 'بقيت معاملة واحدة',
    en: '1 transaction still to do',
  },
  'cat.onbekend': {
    nl: 'Onbekende transactie',
    ar: 'معاملة غير معروفة',
    en: 'Unknown transaction',
  },
  // [WAAROM-WACHT-CAT] Het label voor een geheugen dat de ANDERE kant op wijst. Kort, want de
  // hele zin staat eronder — maar niet hetzelfde woord als een geheugen waar de app zeker van is.
  'cat.onthoudenAndersom': {
    nl: 'onthouden, maar andersom',
    ar: 'محفوظة، لكن بالاتجاه المعاكس',
    en: 'remembered, but the other way',
  },
  'cat.onthouden': {
    nl: 'onthouden',
    ar: 'محفوظة',
    en: 'remembered',
  },
  'cat.reviewUitleg': {
    nl: 'Tik op een categorie om die te wijzigen en bevestig. Wat de app zelf invulde staat bovenaan.',
    ar: 'انقر على تصنيف لتغييره ثم أكِّد. ما عبّأه التطبيق بنفسه يظهر في الأعلى.',
    en: 'Tap a category to change it and confirm. What the app filled in itself is at the top.',
  },
  'cat.tabReview': {
    nl: 'Ingevuld wijzigen',
    ar: 'تعديل المعبَّأ',
    en: 'Change filled-in',
  },
  'cat.tabTodo': {
    nl: 'Te doen',
    ar: 'المهام',
    en: 'To do',
  },
  'cat.teDoen': {
    nl: 'transacties te doen',
    ar: 'معاملات متبقية',
    en: 'transactions to do',
  },
  'cat.teDoenEen': {
    nl: 'transactie te doen',
    ar: 'معاملة متبقية',
    en: 'transaction to do',
  },
  'cat.voorstel': {
    nl: 'voorstel',
    ar: 'اقتراح',
    en: 'suggestion',
  },
  'cat.wachtrij': {
    nl: 'Er staan er nog {count} in de wachtrij die nog niet geladen zijn.',
    ar: 'ما زال في قائمة الانتظار {count} لم تُحمَّل بعد.',
    en: 'There are {count} more in the queue that have not been loaded yet.',
  },
  'cat.zekereInvullen': {
    nl: '{count} zekere invullen',
    ar: 'تعبئة المؤكدة ({count})',
    en: 'Fill in {count} certain ones',
  },
  'cat.zekereUitleg': {
    nl: 'We vullen alleen transacties in die we zeker weten (onthouden of duidelijk herkend, zoals belasting, overboekingen en bankkosten). De rest laten we aan jou — we verzinnen niets.',
    ar: 'لا نعبّئ إلا المعاملات التي نعرفها يقينًا (محفوظة أو معروفة بوضوح، كالضرائب والتحويلات ورسوم البنك). الباقي نتركه لك — لا نختلق شيئًا.',
    en: 'We only fill in transactions we are sure of (remembered or clearly recognised, such as tax, transfers and bank fees). The rest we leave to you — we invent nothing.',
  },
  'cat.zoekLeeg': {
    nl: 'Geen transacties gevonden voor “{query}”.',
    ar: 'لم يُعثر على معاملات لـ«{query}».',
    en: 'No transactions found for “{query}”.',
  },
  'cat.zoekLeegEerste': {
    nl: 'Geen transacties gevonden voor “{query}” in de eerste {count}.',
    ar: 'لم يُعثر على معاملات لـ«{query}» ضمن أول {count}.',
    en: 'No transactions found for “{query}” in the first {count}.',
  },
  'detail.aangemaaktDoor': {
    nl: 'Aangemaakt door {name}',
    ar: 'أنشأها {name}',
    en: 'Created by {name}',
  },
  'detail.bekijken': {
    nl: 'Bekijken',
    ar: 'عرض',
    en: 'View',
  },
  'detail.betaal.op': {
    nl: 'Gelieve te betalen op',
    ar: 'يُرجى الدفع إلى',
    en: 'Please pay to',
  },
  'detail.betaal.ovv': {
    nl: 'o.v.v.',
    ar: 'مع ذكر',
    en: 'quoting',
  },
  'detail.bezorging.email': {
    nl: 'De e-mail kon niet worden afgeleverd. Het factuurnummer is wel definitief.',
    ar: 'تعذّر تسليم البريد الإلكتروني. لكن رقم الفاتورة نهائي.',
    en: 'The e-mail could not be delivered. The invoice number is final, though.',
  },
  'detail.bezorging.pdf': {
    nl: 'De PDF kon niet worden gegenereerd. Het factuurnummer is wel definitief.',
    ar: 'تعذّر توليد ملف PDF. لكن رقم الفاتورة نهائي.',
    en: 'The PDF could not be generated. The invoice number is final, though.',
  },
  'detail.credit.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'detail.credit.klant': {
    nl: 'Klant:',
    ar: 'العميل:',
    en: 'Client:',
  },
  // ── [DEEL-CREDIT] Een factuur kan in DELEN worden gecrediteerd ────────────────
  'detail.deelsGecrediteerd': {
    nl: 'Deels gecrediteerd: {credited} terug, {open} staat nog open.',
    ar: 'مُقيَّد جزئيًا: أُعيد {credited}، وما زال {open} مفتوحًا.',
    en: 'Partly credited: {credited} returned, {open} still open.',
  },
  'detail.credit.alles': { nl: 'Hele factuur', ar: 'الفاتورة كاملة', en: 'Whole invoice' },
  'detail.credit.deel': { nl: 'Een deel', ar: 'جزء منها', en: 'Part of it' },
  'detail.credit.aantal': { nl: 'Aantal om te crediteren', ar: 'الكمية المراد تقييدها', en: 'Quantity to credit' },
  'detail.credit.van': { nl: 'van {max}', ar: 'من {max}', en: 'of {max}' },
  'detail.credit.alGecrediteerd': { nl: 'Al gecrediteerd', ar: 'المُقيَّد سابقًا', en: 'Already credited' },
  'detail.credit.nogMogelijk': { nl: 'Nog mogelijk', ar: 'المتبقي الممكن', en: 'Still possible' },
  'detail.credit.kiesRegel': {
    nl: 'Kies minstens één regel om te crediteren.',
    ar: 'اختر بندًا واحدًا على الأقل لعكسه.',
    en: 'Choose at least one line to credit.',
  },
  'detail.credit.teVeel': {
    nl: 'Dat is meer dan er nog van deze factuur gecrediteerd kan worden ({max}).',
    ar: 'هذا أكثر مما يمكن عكسه من هذه الفاتورة ({max}).',
    en: 'That is more than can still be credited on this invoice ({max}).',
  },
  'detail.credit.maken': {
    nl: 'Creditnota maken',
    ar: 'إنشاء إشعار دائن',
    en: 'Create credit note',
  },
  'detail.credit.reden': {
    nl: 'Reden (optioneel)',
    ar: 'السبب (اختياري)',
    en: 'Reason (optional)',
  },
  'detail.credit.titel': {
    nl: 'Creditnota maken voor {number}?',
    ar: 'إنشاء إشعار دائن عن {number}؟',
    en: 'Create a credit note for {number}?',
  },
  'detail.credit.titelZonder': {
    nl: 'Creditnota maken voor deze factuur?',
    ar: 'إنشاء إشعار دائن عن هذه الفاتورة؟',
    en: 'Create a credit note for this invoice?',
  },
  'detail.credit.uitleg': {
    nl: 'We maken automatisch een creditnota met dezelfde regels als negatieve bedragen. De originele factuur blijft staan en wordt gemarkeerd als gecrediteerd. Je hoeft niets over te typen.',
    ar: 'نُنشئ تلقائيًا إشعارًا دائنًا بنفس البنود بمبالغ سالبة. تبقى الفاتورة الأصلية كما هي وتُعلَّم بأنها عُكست. لا تحتاج إلى إعادة كتابة أي شيء.',
    en: 'We automatically create a credit note with the same lines as negative amounts. The original invoice stays and is marked as credited. You do not have to retype anything.',
  },
  'detail.fout.creditnota': {
    nl: 'Creditnota aanmaken mislukt — probeer opnieuw',
    ar: 'فشل إنشاء الإشعار الدائن — حاول مرة أخرى',
    en: 'Creating the credit note failed — try again',
  },
  'detail.fout.opnieuwVersturen': {
    nl: 'Opnieuw versturen mislukt',
    ar: 'فشلت إعادة الإرسال',
    en: 'Resending failed',
  },
  // [VERSTUURD-EERLIJK] De PDF-variant hiernaast bestond al; deze niet, en dat is precies waarom
  // vier van de zeven verzendknoppen "verstuurd" zeiden terwijl de mail was blijven staan. Eigen
  // sleutel per oorzaak: bij de ene is er geen document, bij de andere wel — maar niemand kreeg het.
  'detail.fout.mailNietVerstuurd': {
    nl: 'Nummer uitgegeven, maar de e-mail is niet verstuurd — de klant heeft niets. Verstuur opnieuw.',
    ar: 'صدر الرقم، لكن البريد الإلكتروني لم يُرسَل — لم يستلم العميل شيئًا. أعد الإرسال.',
    en: 'Number issued, but the e-mail was not sent — the client has nothing. Send again.',
  },
  'detail.fout.pdfNietGemaakt': {
    nl: 'Nummer uitgegeven, maar de PDF is niet gemaakt — de klant heeft niets. Verstuur opnieuw.',
    ar: 'صدر الرقم، لكن ملف PDF لم يُنشأ — لم يستلم العميل شيئًا. أعد الإرسال.',
    en: 'Number issued, but the PDF was not made — the client has nothing. Send again.',
  },
  // ── [OFFERTE-AKKOORD] Wat de klant antwoordde ────────────────────────────────
  // ── [FACTUUR-BIJLAGE] Een eigen bestand met de factuurmail mee ───────────────
  'bijlage.meesturen': { nl: 'Een bestand meesturen (optioneel)', ar: 'إرفاق ملف (اختياري)', en: 'Send a file along (optional)' },
  'bijlage.zoekHint': { nl: 'Zoek in je bestanden…', ar: 'ابحث في ملفاتك…', en: 'Search your files…' },
  'bijlage.zoeken': { nl: 'Zoeken…', ar: 'جارٍ البحث…', en: 'Searching…' },
  'bijlage.weghalen': { nl: 'Weghalen', ar: 'إزالة', en: 'Remove' },
  // De bijlage die AL op deze factuur staat. Zonder deze regels toont het scherm een leeg
  // keuzeveld terwijl er wel degelijk een bestand meegaat — en dan verstuurt de ondernemer iets
  // anders dan hij denkt.
  'bijlage.staatOpFactuur': {
    nl: 'Gaat mee met deze factuur',
    ar: 'يُرسَل مع هذه الفاتورة',
    en: 'Goes along with this invoice',
  },
  'bijlage.inPrullenbak': {
    nl: 'Dit bestand staat in de prullenbak. Zet het terug of haal de bijlage weg — anders lukt versturen niet.',
    ar: 'هذا الملف في سلة المهملات. أعِده أو أزِل المرفق — وإلا فلن ينجح الإرسال.',
    en: 'This file is in the bin. Restore it or remove the attachment — otherwise sending will fail.',
  },
  'detail.offerte.akkoord': { nl: 'De klant gaat akkoord', ar: 'وافق العميل', en: 'The customer accepted' },
  'detail.offerte.afgewezen': { nl: 'De klant gaat niet akkoord', ar: 'لم يوافق العميل', en: 'The customer declined' },
  'detail.offerte.doorOp': { nl: 'Door {naam}, op {datum}', ar: 'بواسطة {naam}، بتاريخ {datum}', en: 'By {naam}, on {datum}' },
  'detail.offerte.op': { nl: 'Op {datum}', ar: 'بتاريخ {datum}', en: 'On {datum}' },
  // [AKKOORD-VERLOPEN] Het akkoord kwam ná de geldigheidsdatum. Alleen gemeld, nooit geweigerd:
  // het antwoord is geldig, en of de prijs van toen nog geldt is een beslissing van de ondernemer.
  // Zonder deze regel leest het scherm als een gewoon akkoord en wordt er omgezet tegen een prijs
  // die maanden geleden is ingetrokken.
  'detail.offerte.naVervaldatum': {
    nl: 'Let op: dit akkoord kwam ná de geldigheidsdatum van {datum}. Controleer of je prijs nog klopt voordat je de factuur maakt.',
    ar: 'تنبيه: وصلت هذه الموافقة بعد تاريخ سريان العرض ({datum}). تأكّد أن سعرك ما زال صالحًا قبل إصدار الفاتورة.',
    en: 'Note: this acceptance arrived after the quote expired on {datum}. Check that your price still holds before you invoice it.',
  },
  'detail.gecrediteerdVia': {
    nl: 'Gecrediteerd via {number}',
    ar: 'عُكست عبر الإشعار الدائن {number}',
    en: 'Credited via {number}',
  },
  'detail.kolom.prijs': {
    nl: 'Prijs',
    ar: 'السعر',
    en: 'Price',
  },
  'detail.kwartaal.betaaldIn': {
    nl: 'Betaald in {quarter}.',
    ar: 'دُفعت في {quarter}.',
    en: 'Paid in {quarter}.',
  },
  'detail.kwartaal.uitleg': {
    nl: 'Voor de btw telt deze factuur mee in {quarter}: de aangifte volgt de factuurdatum, niet de betaaldatum. Dit laat alleen zien wanneer het geld binnenkwam.',
    ar: 'بالنسبة للضريبة تُحتسب هذه الفاتورة في {quarter}: الإقرار يتبع تاريخ الفاتورة، لا تاريخ الدفع. هذا يبيّن فقط متى وصل المال.',
    en: 'For VAT this invoice counts in {quarter}: the return follows the invoice date, not the payment date. This only shows when the money came in.',
  },
  'detail.opnieuwVerzonden': {
    nl: 'De factuur is opnieuw verzonden.',
    ar: 'أُعيد إرسال الفاتورة.',
    en: 'The invoice was sent again.',
  },
  // [GEEN-REGELS] Een kop met kolommen en nul rijen leest als "de regels zijn kwijt". Bij een
  // ingelezen inkoopfactuur is er niets kwijt: de app bewaart er de BEDRAGEN van, en de regels
  // staan op het papier. Dat is een andere zin dan "deze factuur heeft geen regels", en alleen de
  // eerste is waar.
  'detail.regels.alleenBedragen': {
    nl: 'Van deze factuur zijn alleen de bedragen vastgelegd. De regels staan op het origineel.',
    ar: 'من هذه الفاتورة سُجِّلت المبالغ فقط. البنود موجودة في الأصل.',
    en: 'Only the amounts of this invoice were recorded. The lines are on the original.',
  },
  'detail.regels.geen': {
    nl: 'Er staan geen regels op deze factuur.',
    ar: 'لا توجد بنود على هذه الفاتورة.',
    en: 'There are no lines on this invoice.',
  },
  'detail.origineelPdf': {
    nl: 'Origineel PDF',
    ar: 'ملف PDF الأصلي',
    en: 'Original PDF',
  },
  'detail.rij.betaaldOp': {
    nl: 'Betaald op: {value}',
    ar: 'دُفعت في: {value}',
    en: 'Paid on: {value}',
  },
  // [BESTE] The moment the customer first opened the pay or offerte page — written once, by the
  // public page itself (first-view.ts).
  'detail.rij.bekekenOp': { nl: 'Bekeken door de klant op: {value}', ar: 'اطّلع عليها العميل في: {value}', en: 'Viewed by the customer on: {value}' },
  'detail.rij.datum': {
    nl: 'Datum: {value}',
    ar: 'التاريخ: {value}',
    en: 'Date: {value}',
  },
  'detail.rij.nummer': {
    nl: 'Nummer: {value}',
    ar: 'الرقم: {value}',
    en: 'Number: {value}',
  },
  'detail.rij.vervaldatum': {
    nl: 'Vervaldatum: {value}',
    ar: 'تاريخ الاستحقاق: {value}',
    en: 'Due date: {value}',
  },
  'dq.klant': {
    nl: 'Klant',
    ar: 'العميل',
    en: 'Client',
  },
  'dq.lijstGewist': {
    nl: 'De lijst is gewist.',
    ar: 'مُسحت القائمة.',
    en: 'The list has been cleared.',
  },
  'dq.opstellenMislukt': {
    nl: 'Opstellen mislukt',
    ar: 'فشلت الصياغة',
    en: 'Drafting failed',
  },
  'dq.toevoegenMislukt': {
    nl: 'Toevoegen mislukt',
    ar: 'فشلت الإضافة',
    en: 'Adding failed',
  },
  'dq.verstuurdNaar': {
    nl: '✓ E-mail verstuurd naar {naam}.',
    ar: '✓ أُرسل البريد الإلكتروني إلى {naam}.',
    en: '✓ E-mail sent to {naam}.',
  },
  'dq.verzendenMislukt': {
    nl: 'Verzenden mislukt',
    ar: 'فشل الإرسال',
    en: 'Sending failed',
  },
  'dz.beheerUitleg': {
    nl: 'Een dag met de verkeerde datum of uit een andere periode? Verwijder hem — dat corrigeert je omzet en BTW-aangifte. Daarna importeer je het juiste Z-rapport opnieuw.',
    ar: 'يوم بتاريخ خاطئ أو من فترة أخرى؟ احذفه — فهذا يصحّح إيرادك وإقرار ضريبة القيمة المضافة. ثم استورد تقرير Z الصحيح من جديد.',
    en: 'A day with the wrong date or from another period? Delete it — that corrects your turnover and VAT return. Then import the right Z-report again.',
  },
  'dz.dagenBeheren': {
    nl: 'Geboekte dagen beheren ({n})',
    ar: 'إدارة الأيام المسجّلة ({n})',
    en: 'Manage booked days ({n})',
  },
  'dz.fout.iets': {
    nl: 'Er ging iets mis — probeer opnieuw.',
    ar: 'حدث خطأ — حاول مرة أخرى.',
    en: 'Something went wrong — try again.',
  },
  'dz.fout.verwijderenDag': {
    nl: 'Kon de dag niet verwijderen — probeer opnieuw.',
    ar: 'تعذّر حذف اليوم — حاول مرة أخرى.',
    en: 'Could not delete the day — try again.',
  },
  'dz.geenGeboekt': {
    nl: 'Geen kassa-omzet geboekt in {period}.',
    ar: 'لا إيراد كاشير مُسجَّل في {period}.',
    en: 'No till turnover booked in {period}.',
  },
  'dz.geenPinAantallen': {
    nl: 'geen pin-aantallen in de bank',
    ar: 'لا توجد أعداد PIN في البنك',
    en: 'no PIN counts in the bank',
  },
  'dz.gemPinbon': {
    nl: 'Gem. pinbon',
    ar: 'متوسط إيصال PIN',
    en: 'Avg. card receipt',
  },
  'dz.nee': {
    nl: 'Nee',
    ar: 'لا',
    en: 'No',
  },
  'dz.omzetDagen': {
    nl: 'Omzet ({n} dagen)',
    ar: 'الإيراد ({n} يومًا)',
    en: 'Turnover ({n} days)',
  },
  'dz.ongewoonHoog': {
    nl: 'ongewoon hoog',
    ar: 'مرتفع بشكل غير معتاد',
    en: 'unusually high',
  },
  'dz.ongewoonLaag': {
    nl: 'ongewoon laag',
    ar: 'منخفض بشكل غير معتاد',
    en: 'unusually low',
  },
  'dz.pintransacties': {
    nl: '{n} pintransacties',
    ar: 'معاملات PIN: {n}',
    en: '{n} card transactions',
  },
  'dz.tonen': {
    nl: 'Tonen',
    ar: 'إظهار',
    en: 'Show',
  },
  'dz.verwijderDag': {
    nl: 'Verwijder {date}',
    ar: 'حذف {date}',
    en: 'Delete {date}',
  },
  'dzi.aandachtspuntEen': {
    nl: '1 aandachtspunt',
    ar: 'نقطة واحدة تحتاج انتباهًا',
    en: '1 point of attention',
  },
  'dzi.aandachtspunten': {
    nl: '{n} aandachtspunten',
    ar: 'نقاط تحتاج انتباهًا: {n}',
    en: '{n} points of attention',
  },
  'dzi.alsOmzetGeteld': {
    nl: 'als omzet geteld en verandert je resultaat niet.',
    ar: 'يُحتسب كإيراد ولا يغيّر نتيجتك.',
    en: 'counted as turnover and does not change your result.',
  },
  'dzi.anderBestand': {
    nl: 'Ander bestand kiezen ({name})',
    ar: 'اختيار ملف آخر ({name})',
    en: 'Choose another file ({name})',
  },
  'dzi.bezigLezen': {
    nl: 'Bezig met lezen…',
    ar: 'جارٍ القراءة…',
    en: 'Reading…',
  },
  'dzi.btwGedetecteerd': {
    nl: 'BTW gedetecteerd',
    ar: 'btw المكتشفة',
    en: 'VAT detected',
  },
  'dzi.contant': {
    nl: 'contant {amount}',
    ar: 'نقدًا {amount}',
    en: 'cash {amount}',
  },
  'dzi.controle': {
    nl: 'controle',
    ar: 'فحص',
    en: 'check',
  },
  'dzi.dagenTotaal': {
    nl: '{n} dagen · totaal ontvangen',
    ar: 'الأيام: {n} · إجمالي المقبوض',
    en: '{n} days · total received',
  },
  'dzi.dagTotaal': {
    nl: '{n} dag · totaal ontvangen',
    ar: '{n} يوم · إجمالي المقبوض',
    en: '{n} day · total received',
  },
  'dzi.ditIsEen': {
    nl: 'Dit is een',
    ar: 'يُعَدّ هذا',
    en: 'This is a',
  },
  'dzi.gelezenUit': {
    nl: 'Gelezen uit {name}',
    ar: 'قُرئ من {name}',
    en: 'Read from {name}',
  },
  'dzi.goedkeurenOpslaan': {
    nl: 'Goedkeuren en opslaan',
    ar: 'اعتماد وحفظ',
    en: 'Approve and save',
  },
  'dzi.grootboekUit': {
    nl: 'Grootboek-controle uit {name}',
    ar: 'فحص دفتر الأستاذ من {name}',
    en: 'Ledger check from {name}',
  },
  'dzi.intro1': {
    nl: 'Upload het Z-rapport van de kassa (.xls, .xlsx of .csv). Je ziet eerst precies wat er is gelezen — er wordt niets opgeslagen tot je op',
    ar: 'ارفع تقرير Z من الكاشير (.xls أو .xlsx أو .csv). سترى أولًا ما قُرئ بالضبط — لن يُحفظ شيء حتى تضغط',
    en: 'Upload the till Z-report (.xls, .xlsx or .csv). You first see exactly what was read — nothing is stored until you click',
  },
  'dzi.intro2': {
    nl: ' klikt. Upload je een grootboek-overzicht (OVERZICHT/KASBOEK van de boekhouder), dan wordt dat automatisch herkend en als',
    ar: '. إذا رفعت كشف دفتر أستاذ (OVERZICHT/KASBOEK من المحاسب)، فيُتعرَّف عليه تلقائيًا ويُحفظ بوصفه',
    en: '. If you upload a ledger overview (the accountant’s OVERZICHT/KASBOEK), it is recognised automatically and kept as a',
  },
  'dzi.intro3': {
    nl: 'op je kassa bewaard — niet als omzet.',
    ar: 'على كاشيرك — لا كإيراد.',
    en: 'on your till — not as turnover.',
  },
  'dzi.kiesZ': {
    nl: 'Kies een Z-rapport',
    ar: 'اختر تقرير Z',
    en: 'Choose a Z-report',
  },
  'dzi.klaarBank': {
    nl: '✓ {n} dagen Bank-grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر أستاذ البنك المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of bank ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarBankEen': {
    nl: '✓ 1 dag Bank-grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر أستاذ البنك كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of bank ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarGrootboek': {
    nl: '✓ {n} dagen Grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر الأستاذ المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarGrootboekEen': {
    nl: '✓ 1 dag Grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر الأستاذ كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarKas': {
    nl: '✓ {n} dagen Kas-grootboek (contant) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر أستاذ الصندوق (نقدًا) المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of cash ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarKasEen': {
    nl: '✓ 1 dag Kas-grootboek (contant) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر أستاذ الصندوق (نقدًا) كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of cash ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarOmzet': {
    nl: '✓ {n} dagen dagomzet opgeslagen.',
    ar: '✓ أيام إيراد اليوم المحفوظة: {n}.',
    en: '✓ {n} days of daily turnover saved.',
  },
  'dzi.klaarOmzetEen': {
    nl: '✓ 1 dag dagomzet opgeslagen.',
    ar: '✓ حُفظ يوم واحد من إيراد اليوم.',
    en: '✓ 1 day of daily turnover saved.',
  },
  'dzi.klaarPin': {
    nl: '✓ {n} dagen PIN-grootboek (kaartbetalingen) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر أستاذ PIN (مدفوعات البطاقة) المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of PIN ledger (card payments) saved as a check (does not count as turnover).',
  },
  'dzi.klaarPinEen': {
    nl: '✓ 1 dag PIN-grootboek (kaartbetalingen) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر أستاذ PIN (مدفوعات البطاقة) كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of PIN ledger (card payments) saved as a check (does not count as turnover).',
  },
  'dzi.konGrootboekNietLezen': {
    nl: 'Kon het grootboek niet lezen',
    ar: 'تعذّرت قراءة دفتر الأستاذ',
    en: 'Could not read the ledger',
  },
  'dzi.konNietLezen': {
    nl: 'Kon het bestand niet lezen',
    ar: 'تعذّرت قراءة الملف',
    en: 'Could not read the file',
  },
  'dzi.ledger.bank': {
    nl: 'Bank-grootboek',
    ar: 'دفتر أستاذ البنك',
    en: 'Bank ledger',
  },
  'dzi.ledger.cash': {
    nl: 'Kas-grootboek (contant)',
    ar: 'دفتر أستاذ الصندوق (نقدًا)',
    en: 'Cash ledger (cash)',
  },
  'dzi.ledger.other': {
    nl: 'Grootboek',
    ar: 'دفتر الأستاذ',
    en: 'Ledger',
  },
  'dzi.ledger.pin': {
    nl: 'PIN-grootboek (kaartbetalingen)',
    ar: 'دفتر أستاذ PIN (مدفوعات البطاقة)',
    en: 'PIN ledger (card payments)',
  },
  'dzi.netto': {
    nl: 'netto {amount}',
    ar: 'الصافي {amount}',
    en: 'net {amount}',
  },
  'dzi.nietWoord': {
    nl: 'niet',
    ar: 'لا',
    en: 'not',
  },
  'dzi.opslaanControle': {
    nl: 'Opslaan als controle',
    ar: 'حفظ للمراجعة',
    en: 'Save as a check',
  },
  'dzi.rekening': {
    nl: 'rekening {nr}',
    ar: 'الحساب {nr}',
    en: 'account {nr}',
  },
  'dzi.tegenKassa': {
    nl: 'tegen je kassa (PIN/contant) — het wordt',
    ar: 'لصندوق كاشيرك (PIN/نقدًا) — وهو',
    en: 'against your till (PIN/cash) — it is',
  },
  'ink.aangifteIngediend': {
    nl: 'aangifte al ingediend — dit wordt een correctie',
    ar: 'الإقرار (aangifte) قُدّم بالفعل — سيصبح هذا تصحيحًا',
    en: 'aangifte already filed — this becomes a correction',
  },
  'ink.afgeschrevenOp': {
    nl: 'afgeschreven {date}',
    ar: 'خُصمت في {date}',
    en: 'collected {date}',
  },
  'ink.alleenBedragEen': {
    nl: '1 koppeling is alleen op bedrag herkend (geen factuurnummer in de omschrijving) — controleer die even.',
    ar: 'رُبط واحد على المبلغ فقط (لا رقم فاتورة في الوصف) — تحقّق منه سريعًا.',
    en: '1 link was recognised on amount only (no invoice number in the description) — give it a quick check.',
  },
  'ink.alleenBedragN': {
    nl: '{n} koppelingen zijn alleen op bedrag herkend (geen factuurnummer in de omschrijving) — controleer die even.',
    ar: 'رُبط {n} على المبلغ فقط (لا رقم فاتورة في الوصف) — تحقّق منها سريعًا.',
    en: '{n} links were recognised on amount only (no invoice number in the description) — give them a quick check.',
  },
  'ink.alleenBedragNaam': {
    nl: 'alleen op bedrag en naam herkend — controleer deze',
    ar: 'تم التعرّف عليها بالمبلغ والاسم فقط — تحقّق منها',
    en: 'recognised on amount and name only — check this one',
  },
  'ink.allePeriodes': {
    nl: 'Alle periodes',
    ar: 'كل الفترات',
    en: 'All periods',
  },
  // [TAAL] De rest van het periodemenu. Deze woorden stonden als Nederlandse strings in
  // invoice-period.ts — een pure module die het menu vult boven een volledig vertaald scherm, dus
  // een Arabische eigenaar zag zijn hele lijst in het Arabisch met dit ene menu in het Nederlands.
  // De sleutel hierboven bestond al en werd nooit bereikt: het menu vond altijd eerst het woord.
  //
  // Eén sleutel per keuze en geen zin met {periode} erin: "deze maand" en "dit kwartaal" krijgen
  // in het Arabisch een ander aanwijzend woord, en in het Turks een ander achtervoegsel.
  'ink.periode.dezeMaand': { nl: 'Deze maand', ar: 'هذا الشهر', en: 'This month' },
  'ink.periode.vorigeMaand': { nl: 'Vorige maand', ar: 'الشهر الماضي', en: 'Last month' },
  'ink.periode.ditKwartaal': { nl: 'Dit kwartaal', ar: 'هذا الربع', en: 'This quarter' },
  'ink.periode.vorigKwartaal': { nl: 'Vorig kwartaal', ar: 'الربع السابق', en: 'Last quarter' },
  'ink.periode.ditJaar': { nl: 'Dit jaar', ar: 'هذه السنة', en: 'This year' },
  'ink.periode.vorigJaar': { nl: 'Vorig jaar', ar: 'السنة السابقة', en: 'Last year' },
  'ink.anderePeriodes': {
    nl: 'Je hebt er {facturen} in andere periodes.',
    ar: 'لديك {facturen} في فترات أخرى.',
    en: 'You have {facturen} in other periods.',
  },
  'ink.autoIncasso': {
    nl: 'Automatische incasso',
    ar: 'خصم مباشر تلقائي',
    en: 'Direct debit',
  },
  // ── [RUST] De regel die twee panelen vervangt ────────────────────────────────────────────
  // Dit scherm heet Inkoopfacturen en zijn werk is de LIJST. De scan-melding en de
  // auto-verwerkt-nudge stonden er allebei uitgeklapt boven, samen goed voor een half scherm
  // advies vóór de eerste factuur. Ze zijn niet fout — ze zijn alleen niet het antwoord op de
  // vraag waarmee je dit scherm opent.
  //
  // Een telling is genoeg om te beslissen of je gaat kijken; de panelen zelf staan één tik weg.
  // Bewust KORT: geen werkwoord, geen uitroep, geen kleur die om aandacht vraagt.
  //
  // Wat NIET meevouwt, en dat is de hele grens: alles wat zegt dat dit scherm onvolledig is
  // ([NO-SILENT-EMPTY]) of dat je hier geld twee keer kunt uitgeven ([AUTO-INCASSO]) blijft
  // staan. Dat is geen advies maar een waarschuwing, en een waarschuwing die je moet openklappen
  // is er geen.
  'ink.advies.kloppenNiet': {
    nl: '{n} kloppen niet',
    ar: '{n} غير صحيحة',
    en: '{n} are wrong',
  },
  'ink.advies.kloptNietEen': {
    nl: '1 klopt niet',
    ar: 'واحدة غير صحيحة',
    en: '1 is wrong',
  },
  // [SCAN-WHOLE-BOOK] Dezelfde telling, maar eerlijk begrensd. Zonder deze twee zou de
  // samengevouwen regel '3 kloppen niet' zeggen terwijl er alleen in DEZE lijst is gekeken — een
  // bounded read gepresenteerd als een compleet antwoord, precies de fout waarvoor het paneel
  // eronder zijn eigen zin heeft. Wat opengeklapt waar moest zijn, moet dichtgeklapt ook waar zijn.
  'ink.advies.kloppenNietLijst': {
    nl: '{n} kloppen niet in deze lijst',
    ar: '{n} غير صحيحة في هذه القائمة',
    en: '{n} in this list are wrong',
  },
  'ink.advies.kloptNietEenLijst': {
    nl: '1 klopt niet in deze lijst',
    ar: 'واحدة غير صحيحة في هذه القائمة',
    en: '1 in this list is wrong',
  },
  'ink.advies.autoVerwerkt': {
    nl: '{n} automatisch verwerkt',
    ar: '{n} عولجت تلقائيًا',
    en: '{n} processed automatically',
  },
  'ink.advies.autoVerwerktEen': {
    nl: '1 automatisch verwerkt',
    ar: 'عولجت واحدة تلقائيًا',
    en: '1 processed automatically',
  },
  'ink.advies.open': {
    nl: 'Toon wat hierachter zit',
    ar: 'عرض التفاصيل',
    en: 'Show what is behind this',
  },
  'ink.advies.dicht': {
    nl: 'Verberg dit weer',
    ar: 'إخفاء هذا',
    en: 'Hide this again',
  },
  'ink.autoNudge': {
    nl: '{n} facturen zijn automatisch verwerkt — bekijk',
    ar: 'عولجت {n} فاتورة تلقائياً — اعرضها',
    en: '{n} invoices were processed automatically — view',
  },
  'ink.autoNudgeEen': {
    nl: '1 factuur is automatisch verwerkt — bekijk',
    ar: 'عولجت فاتورة واحدة تلقائياً — اعرضها',
    en: '1 invoice was processed automatically — view',
  },
  'ink.autoVerifiedUitleg': {
    nl: 'Deze factuur was duidelijk leesbaar en is automatisch geverifieerd. Controleer indien je twijfelt.',
    ar: 'كانت هذه الفاتورة واضحة القراءة وتم التحقق منها تلقائيًا. تحقّق إن ساورك شك.',
    en: 'This invoice was clearly legible and was verified automatically. Check it if you are in doubt.',
  },
  'ink.backfill.knop': {
    nl: 'Opnieuw ophalen',
    ar: 'إعادة الجلب',
    en: 'Fetch again',
  },
  'ink.backfill.uitleg': {
    nl: 'Ik scan je e-mail opnieuw vanaf deze datum en haal op wat nog mist. Niets wordt dubbel.',
    ar: 'سأفحص بريدك من جديد اعتبارًا من هذا التاريخ وأجلب ما ينقص. لا شيء يتكرر.',
    en: 'I scan your e-mail again from this date and fetch what is still missing. Nothing is duplicated.',
  },
  'ink.bankMatchMislukt': {
    nl: 'Het bankafschrift kon niet worden gematcht — probeer het straks opnieuw.',
    ar: 'تعذّرت مطابقة كشف الحساب البنكي — حاول بعد قليل.',
    en: 'The bank statement could not be matched — try again in a while.',
  },
  'ink.bankregelTerug': {
    nl: 'Stond er een bankregel tegenover, dan komt die terug bij "Te bevestigen" op de Bank-pagina.',
    ar: 'إن كانت تقابلها حركة بنكية، فستعود إلى «Te bevestigen» في صفحة البنك.',
    en: 'If a bank line stood against it, it returns to "Te bevestigen" on the Bank page.',
  },
  'ink.bedrag.btwIs': {
    nl: 'BTW = {bedrag}',
    ar: 'btw = {bedrag}',
    en: 'VAT = {bedrag}',
  },
  // [TARIEF-GEHEUGEN] De uitsplitsing stond niet op het document; de administratie van de eigenaar
  // weet wat deze leverancier altijd rekent. De zin NOEMT het bewijs — een getal dat de eigenaar
  // kan nalezen, in plaats van een machine die om vertrouwen vraagt.
  'ink.bedrag.tariefGeheugen': {
    nl: 'De BTW-uitsplitsing stond niet op deze factuur. Deze leverancier rekende {aantal} keer eerder {tarief}% — allemaal hetzelfde.',
    ar: 'لم تكن تفاصيل ضريبة القيمة المضافة على هذه الفاتورة. هذا المورّد احتسب {tarief}٪ في {aantal} فاتورة سابقة — كلها بالنسبة نفسها.',
    en: 'The VAT breakdown was not on this invoice. This supplier charged {tarief}% on {aantal} earlier invoices — every one of them.',
  },
  // [LEVERANCIER-STANDAARD] The owner set the rate on the supplier; no count to cite, a decision.
  'ink.bedrag.tariefIngesteld': {
    nl: 'De BTW-uitsplitsing stond niet op deze factuur. Voor deze leverancier heb je {tarief}% ingesteld.',
    ar: 'لم تكن تفاصيل ضريبة القيمة المضافة على هذه الفاتورة. لهذا المورّد ضبطتَ {tarief}٪.',
    en: 'The VAT breakdown was not on this invoice. For this supplier you set {tarief}%.',
  },
  'ink.bedrag.vulSplitsing': {
    nl: 'Vul in: excl. {excl} · BTW {btw}',
    ar: 'املأ: بدون ضريبة {excl} · الضريبة {btw}',
    en: 'Fill in: excl. {excl} · VAT {btw}',
  },
  'ink.bedrag.exclIs': {
    nl: 'Excl. BTW = {bedrag}',
    ar: 'بدون btw = {bedrag}',
    en: 'Excl. VAT = {bedrag}',
  },
  'ink.bedrag.neemOver': {
    nl: 'Neem {bedrag} over',
    ar: 'اعتماد {bedrag}',
    en: 'Take over {bedrag}',
  },
  'ink.bedrag.staatOp': {
    nl: 'Staat dit bedrag op je factuur?',
    ar: 'هل هذا المبلغ مكتوب على فاتورتك؟',
    en: 'Is this amount on your invoice?',
  },
  'ink.bedrag.welkeKlopt': {
    nl: 'Welke klopt volgens de factuur? Het totaal ({bedrag}) blijft staan.',
    ar: 'أيّهما الصحيح حسب الفاتورة؟ الإجمالي ({bedrag}) يبقى كما هو.',
    en: 'Which one matches the invoice? The total ({bedrag}) stays as it is.',
  },
  'ink.bedragenKloppenNiet': {
    nl: 'Bedragen kloppen niet',
    ar: 'المبالغ غير صحيحة',
    en: 'Amounts do not add up',
  },
  // [SUBTOTAAL] De badge voor de ANDERE bevinding die tot nu toe dezelfde woorden kreeg: het
  // bedrag klopt met zichzelf, alleen weten we niet of het het totaal IS. Op Enka Horeca 26713540
  // stond 'Bedragen kloppen niet' boven 1.431,19 + 128,78 = 1.559,97 — exact tot op de cent, en
  // alle drie de getallen stonden op dezelfde kaart. Een waarschuwing die de eigenaar in twee
  // seconden kan weerleggen, leert hem de volgende te overslaan.
  'ink.controleerHetTotaal': {
    nl: 'Controleer het totaal',
    ar: 'تحقّق من الإجمالي',
    en: 'Check the total',
  },
  'ink.beheren': {
    nl: 'Beheren',
    ar: 'إدارة',
    en: 'Manage',
  },
  // [ACTIES-ALTIJD] Het pijltje dat de gevouwen helft van een factuurkaart opent. Een label voor
  // een pictogram van 20 pixels: een schermlezer heeft er anders niets aan, en de tooltip zegt het
  // ook aan wie erover heen gaat.
  'ink.detailsTonen': {
    nl: 'Details tonen',
    ar: 'إظهار التفاصيل',
    en: 'Show details',
  },
  'ink.detailsVerbergen': {
    nl: 'Details verbergen',
    ar: 'إخفاء التفاصيل',
    en: 'Hide details',
  },
  'ink.bekijkPdf': {
    nl: 'Bekijk PDF',
    ar: 'عرض PDF',
    en: 'View PDF',
  },
  'ink.betaaldGemarkeerd': {
    nl: '✓ Factuur gemarkeerd als betaald',
    ar: '✓ عُلّمت الفاتورة كمدفوعة',
    en: '✓ Invoice marked as paid',
  },
  'ink.betaaldIn': {
    nl: 'Betaald in {quarter}',
    ar: 'دُفعت في {quarter}',
    en: 'Paid in {quarter}',
  },
  'ink.betaaldLabel': {
    nl: 'betaald',
    ar: 'مدفوعة',
    en: 'paid',
  },
  'ink.betaaldOp': {
    nl: 'betaald {date}',
    ar: 'دُفعت في {date}',
    en: 'paid {date}',
  },
  'ink.betaaldOpBank': {
    nl: 'Betaald op {date} — via de bank',
    ar: 'دُفعت في {date} — عبر البنك',
    en: 'Paid on {date} — via the bank',
  },
  'ink.betaaldOpContant': {
    nl: 'Betaald op {date} — contant',
    ar: 'دُفعت في {date} — نقدًا',
    en: 'Paid on {date} — in cash',
  },
  'ink.betaaldOpTitel': {
    nl: 'Betaald op {date}',
    ar: 'دُفعت في {date}',
    en: 'Paid on {date}',
  },
  'ink.betaaldUitleg': {
    nl: 'De factuur wordt als betaald gemarkeerd en doorgestuurd naar je boekhouder.',
    ar: 'ستُعلَّم الفاتورة كمدفوعة وتُرسَل إلى المحاسب.',
    en: 'The invoice is marked as paid and forwarded to your accountant.',
  },
  'ink.betaalQr': {
    nl: 'Betaal-QR',
    ar: 'رمز QR للدفع',
    en: 'Payment QR',
  },
  'ink.betalingenOphalenMislukt': {
    nl: 'Betalingen ophalen mislukt — probeer opnieuw',
    ar: 'فشل جلب الدفعات — حاول مرة أخرى',
    en: 'Fetching payments failed — please try again',
  },
  'ink.betalingenTeruggedraaid': {
    nl: '{n} betalingen teruggedraaid ✓',
    ar: 'تم التراجع عن {n} دفعة ✓',
    en: '{n} payments reverted ✓',
  },
  'ink.betalingOngedaan': {
    nl: 'Betaling ongedaan gemaakt',
    ar: 'أُلغي تسجيل الدفعة',
    en: 'Payment undone',
  },
  'ink.betalingTeruggedraaid': {
    nl: 'Betaling teruggedraaid ✓',
    ar: 'تم التراجع عن الدفعة ✓',
    en: 'Payment reverted ✓',
  },
  'ink.betekentNietLeeg': {
    nl: 'Dit betekent niet dat er niets openstaat: we konden het niet lezen. Probeer opnieuw.',
    ar: 'هذا لا يعني أنه لا شيء مفتوح: تعذّرت قراءته. أعد المحاولة بعد قليل.',
    en: 'This does not mean nothing is outstanding: we could not read it. Try again shortly.',
  },
  'ink.bevestigdTeBetalen': {
    nl: 'Bevestigd · te betalen',
    ar: 'مؤكَّدة · مستحقة الدفع',
    en: 'Confirmed · to pay',
  },
  'ink.bevestigVerifieer': {
    nl: 'Bevestig / verifieer',
    ar: 'تأكيد / تدقيق',
    en: 'Confirm / verify',
  },
  'ink.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'ink.bezigMatchen': {
    nl: 'Bezig met matchen…',
    ar: 'جارٍ المطابقة…',
    en: 'Matching…',
  },
  'ink.bezigNarekenen': {
    nl: 'Bezig met narekenen…',
    ar: 'جارٍ إعادة الحساب…',
    en: 'Recalculating…',
  },
  'ink.bezigToevoegen': {
    nl: 'Bezig met toevoegen…',
    ar: 'جارٍ الإضافة…',
    en: 'Adding…',
  },
  'ink.bijgewerkt': {
    nl: 'Bijgewerkt',
    ar: 'تم التحديث',
    en: 'Updated',
  },
  'ink.bijwerkenMislukt': {
    nl: 'Bijwerken mislukt',
    ar: 'فشل التحديث',
    en: 'Updating failed',
  },
  'ink.boekhouderVerwerkt': {
    nl: 'De boekhouder heeft inkoopfactuur {number} al verwerkt. Vraag eerst om dat ongedaan te maken.',
    ar: 'عالج المحاسب فاتورة المشتريات {number} مسبقًا. اطلب أولًا التراجع عن ذلك.',
    en: 'The accountant already processed purchase invoice {number}. First ask to undo that.',
  },
  'ink.bonAutoGeboekt': {
    nl: 'Deze bon is automatisch als betaald geboekt ({details}).',
    ar: 'سُجّل هذا الإيصال كمدفوع تلقائيًا ({details}).',
    en: 'This receipt was automatically booked as paid ({details}).',
  },
  'ink.bonAutoKlopt': {
    nl: 'Klopt het niet? Zet de betaling hieronder terug — er verandert niets aan de factuur zelf.',
    ar: 'أليس صحيحًا؟ تراجع عن الدفعة أدناه — لن يتغيّر شيء في الفاتورة نفسها.',
    en: 'Not right? Undo the payment below — nothing changes on the invoice itself.',
  },
  'ink.bonAutoStaat': {
    nl: 'Op de bon staat "{evidence}".',
    ar: 'مكتوب على الإيصال «{evidence}».',
    en: 'The receipt says "{evidence}".',
  },
  'ink.bonAutoVermeldt': {
    nl: 'De bon vermeldt de betaalwijze zelf.',
    ar: 'الإيصال يذكر طريقة الدفع بنفسه.',
    en: 'The receipt states the payment method itself.',
  },
  'ink.bron.upload': {
    nl: 'Upload',
    ar: 'رفع',
    en: 'Upload',
  },
  'ink.bronnenNietOpgehaald': {
    nl: 'We konden je {sources} niet ophalen',
    ar: 'تعذّر جلب {sources}',
    en: 'We could not fetch your {sources}',
  },
  'ink.bankWachtEen': {
    nl: '1 factuur heeft een gevonden bankkoppeling die op je keuze wacht →',
    ar: 'فاتورة واحدة لها مطابقة بنكية معثور عليها تنتظر قرارك ←',
    en: '1 invoice has a found bank match awaiting your choice →',
  },
  'ink.bankWacht': {
    nl: '{count} facturen hebben een gevonden bankkoppeling die op je keuze wacht →',
    ar: '{count} فاتورة لها مطابقة بنكية مكتشفة تنتظر قرارك ←',
    en: '{count} invoices have a found bank match awaiting your choice →',
  },
  'ink.btw': {
    nl: 'BTW',
    ar: 'الضريبة',
    en: 'VAT',
  },
  'ink.btwPct': {
    nl: 'BTW ({rate}%)',
    ar: 'الضريبة ({rate}%)',
    en: 'VAT ({rate}%)',
  },
  'ink.bulk.aandachtEen': {
    nl: '1 factuur heeft aandacht nodig — open hem los om te controleren',
    ar: 'فاتورة واحدة تحتاج انتباهًا — افتحها منفصلة للتحقق',
    en: '1 invoice needs attention — open it on its own to check it',
  },
  'ink.bulk.aandachtMeer': {
    nl: '{n} facturen hebben aandacht nodig — open ze los om te controleren',
    ar: '{n} فواتير تحتاج إلى انتباه — افتحها منفصلة للتحقق منها',
    en: '{n} invoices need attention — open them on their own to check them',
  },
  'ink.bulk.bevestigEen': {
    nl: 'Bevestig 1 factuur',
    ar: 'تأكيد فاتورة واحدة',
    en: 'Confirm 1 invoice',
  },
  'ink.bulk.bevestigMeer': {
    nl: 'Bevestig {n} facturen',
    ar: 'تأكيد {n} فاتورة',
    en: 'Confirm {n} invoices',
  },
  'ink.bulk.bevestigUitleg': {
    nl: 'De geselecteerde facturen worden geverifieerd en als Crediteur naar je boekhouder gestuurd. De bedragen worden overgenomen zoals uitgelezen.',
    ar: 'ستُدقَّق الفواتير المحددة وتُرسَل إلى المحاسب كدائن (Crediteur). تُعتمد المبالغ كما قُرئت.',
    en: 'The selected invoices are verified and sent to your accountant as a creditor. The amounts are taken over as read.',
  },
  'ink.bulk.bevestigVraag': {
    nl: '{n} facturen bevestigen?',
    ar: 'هل تريد تأكيد {n} فاتورة؟',
    en: 'Confirm {n} invoices?',
  },
  'ink.bulk.bevestigVraagEen': {
    nl: '1 factuur bevestigen?',
    ar: 'هل تريد تأكيد فاتورة واحدة؟',
    en: 'Confirm 1 invoice?',
  },
  'ink.bulk.deelsMislukt': {
    nl: '{ok} geverifieerd · {mislukt} mislukt',
    ar: 'دُقّق {ok} · فشل {mislukt}',
    en: '{ok} verified · {mislukt} failed',
  },
  'ink.bulk.geverifieerdEen': {
    nl: '✓ 1 factuur geverifieerd',
    ar: '✓ دُققت فاتورة واحدة',
    en: '✓ 1 invoice verified',
  },
  'ink.bulk.geverifieerdMeer': {
    nl: '✓ {n} facturen geverifieerd',
    ar: '✓ عدد الفواتير المدققة: {n}',
    en: '✓ {n} invoices verified',
  },
  'ink.bulk.negeerAriaEen': {
    nl: '1 geselecteerde factuur negeren',
    ar: 'تجاهل الفاتورة المحددة',
    en: 'Ignore 1 selected invoice',
  },
  'ink.bulk.negeerAriaMeer': {
    nl: '{n} geselecteerde facturen negeren',
    ar: 'تجاهل الفواتير المحددة ({n})',
    en: 'Ignore {n} selected invoices',
  },
  'ink.bulk.negeerKnop': {
    nl: 'Negeer {n}',
    ar: 'تجاهل {n}',
    en: 'Ignore {n}',
  },
  'ink.bulk.negerenBevestig': {
    nl: 'Ja, negeer {n}',
    ar: 'نعم، تجاهل {n}',
    en: 'Yes, ignore {n}',
  },
  'ink.bulk.negerenUitleg': {
    nl: 'Ze gaan naar Genegeerd en tellen nergens meer mee. Terugzetten kan daar, of meteen hierna met één tik.',
    ar: 'ستنتقل إلى المتجاهَل ولن تُحتسب في شيء. يمكن إرجاعها من هناك، أو مباشرة بعد ذلك بضغطة واحدة.',
    en: 'They go to Ignored and no longer count anywhere. Restore them there, or right after with one tap.',
  },
  'ink.bulk.negerenVraag': {
    nl: '{n} facturen negeren?',
    ar: 'هل تريد تجاهل {n} فاتورة؟',
    en: 'Ignore {n} invoices?',
  },
  'ink.bulk.negerenVraagEen': {
    nl: '1 factuur negeren?',
    ar: 'هل تريد تجاهل فاتورة واحدة؟',
    en: 'Ignore 1 invoice?',
  },
  'ink.bulk.nietMeerInWachtrij': {
    nl: 'Die facturen staan niet meer in de wachtrij — ververs de pagina',
    ar: 'تلك الفواتير لم تعد في قائمة الانتظار — أعد تحميل الصفحة',
    en: 'Those invoices are no longer in the queue — refresh the page',
  },
  'ink.bulk.overgeslagenNote': {
    nl: '{n} met aandacht overgeslagen',
    ar: 'تُخطّي {n} بحاجة إلى انتباه',
    en: '{n} needing attention skipped',
  },
  'ink.bulk.ververs': {
    nl: 'ververs de pagina',
    ar: 'أعد تحميل الصفحة',
    en: 'refresh the page',
  },
  'ink.bundelBetaald': {
    nl: '{n} inkoopfacturen betaald ✓',
    ar: 'دُفعت {n} فاتورة مشتريات ✓',
    en: '{n} purchase invoices paid ✓',
  },
  'ink.bundelMarkeren': {
    nl: '{n} inkoopfacturen markeren als betaald?',
    ar: 'تعليم {n} فاتورة مشتريات كمدفوعة؟',
    en: 'Mark {n} purchase invoices as paid?',
  },
  'ink.bundelMarkerenUitleg': {
    nl: 'De geselecteerde inkoopfacturen van {name} worden allemaal als betaald gemarkeerd.',
    ar: 'ستُعلَّم كل فواتير المشتريات المحددة من {name} كمدفوعة.',
    en: 'The selected purchase invoices from {name} are all marked as paid.',
  },
  // [CREDIT-VERREKEN] The same confirmation when a creditnota was deducted from the transfer.
  // "Als betaald" about a document that pays YOU reads wrong unless the sentence says what
  // happened to it — and leaving it open is how the same credit gets deducted again next month.
  'ink.bundelMarkerenCredit': {
    nl: 'De geselecteerde inkoopfacturen van {name} worden afgerond. De creditnota’s zijn met deze betaling verrekend en gaan mee dicht — anders zou je ze een tweede keer aftrekken.',
    ar: 'ستُغلق فواتير المشتريات المحددة من {name}. وقد تمت مقاصّة الإشعارات الدائنة بهذه الدفعة وتُغلق معها — وإلا لقمتَ بمقاصّتها مرة ثانية.',
    en: 'The selected purchase invoices from {name} are closed. The credit notes were deducted from this payment and close with it — otherwise you would deduct them a second time.',
  },
  'ink.bundelNietGelukt': {
    nl: '{n} betaald ✓ — niet gelukt · {reasons}',
    ar: 'دُفعت {n} ✓ — لم ينجح · {reasons}',
    en: '{n} paid ✓ — failed · {reasons}',
  },
  'ink.categoriserenMislukt': {
    nl: 'Automatisch categoriseren is niet gelukt — de rest is wel bijgewerkt.',
    ar: 'فشل التصنيف التلقائي — البقية حُدّثت.',
    en: 'Automatic categorising did not work — the rest was updated.',
  },
  // ─── [CREDIT-AFHANDELEN] Closing a creditnota — the RIGHT question, where "Heb je
  // betaald?" is hidden on purpose ([CREDIT-NOT-PAYABLE]). Nothing is paid here: the money came
  // BACK (refunded, in cash, or netted off by the supplier), and this only records that it did.
  'ink.credit.afhandelenKnop': {
    nl: 'Verrekend of terugontvangen?',
    en: 'Netted off or received back?',
    ar: 'تمت المقاصة أم استُردّ المبلغ؟',
  },
  'ink.credit.afhandelenVraag': {
    nl: 'Creditnota afhandelen?',
    en: 'Close this credit note?',
    ar: 'إغلاق الإشعار الدائن؟',
  },
  // The two method buttons say "Bank" and "Contant"; here is what they MEAN on a credit — the
  // direction is reversed, so the body has to carry it: this is how the money came back, not how
  // it went out. "Verrekend met een andere factuur" books as Bank: no cash moved, and the drawer
  // must not claim it did.
  'ink.credit.afhandelenUitleg': {
    nl: 'Creditnota {number} wordt afgesloten. Bank: teruggestort of verrekend met een andere factuur. Contant: contant terugontvangen — dat komt in het kasboek als geld IN de la.',
    en: 'Credit note {number} is closed. Bank: refunded or netted against another invoice. Contant: received back in cash — that enters the cash book as money INTO the drawer.',
    ar: 'سيُغلق الإشعار الدائن {number}. البنك: أُعيد إلى حسابك أو تمت مقاصّته مع فاتورة أخرى. نقدًا: استلمته نقدًا — فيُسجَّل في دفتر الصندوق كمال داخل إلى الدرج.',
  },
  'ink.credit.jaAfhandelen': {
    nl: 'Ja, afgehandeld',
    en: 'Yes, settled',
    ar: 'نعم، تمت تسويته',
  },

  'ink.creditKiesJa': {
    nl: 'Bij “ja” wordt het een minbedrag: het gaat van je openstaande saldo af en de btw wordt afgetrokken, niet opgeteld. Staat er “Creditnota” of “Creditfactuur” bovenaan, of een minbedrag onderaan? Dan is het er een.',
    ar: 'مع «نعم» يصبح مبلغًا سالبًا: يُخصم من رصيدك المفتوح وتُطرح ضريبته بدلًا من أن تُضاف. هل كُتب «Creditnota» أو «Creditfactuur» في الأعلى، أو مبلغ سالب في الأسفل؟ فهي إذن إشعار دائن.',
    en: 'With “yes” it becomes a minus amount: it comes off your outstanding balance and the btw is deducted, not added. Does it say “Creditnota” or “Creditfactuur” at the top, or show a minus amount at the bottom? Then it is one.',
  },
  // [CREDIT-AL-VERWERKT] De eerste zin is nieuw, en hij is de reden dat deze melding een vraag
  // opriep: hij vertelde alleen wat er nog GAAT gebeuren (terugstorting, of verrekening met een
  // volgende factuur) en niet wat NU al waar is — de creditnota staat met een minbedrag in de
  // boeken en is dus al van "nog te betalen" af. Gemeten: € 820,29 en € -51,80 samen geven
  // € 768,49, want openAmountSigned() draait het teken om bij total_inc_btw < 0.
  //
  // Zonder die zin las de rij als iets dat nog een handeling nodig had, en de eigenaar zocht naar
  // een knop "verwerkt" die er niet is — en er ook niet hoort te zijn, want er valt niets te
  // verwerken. De zin die de zusterkey (ink.creditGeenBetaling) wél had, staat nu hier ook.
  // [CREDIT-AFHANDELEN] Second rewrite of this sentence, and the history is the argument. First
  // it only described the FUTURE, and the owner went looking for a "processed" button. Then
  // (#256) it said "er is niets te bevestigen" — true for the BOOKS (the minus is already off
  // the balance) but it left the row itself unclosable, and the very next report was "how do I
  // close it?". Both fixes answered the accounting question; the owner was asking a WORKFLOW
  // question. Now it says both facts: the books are already right, and the button underneath is
  // how the row itself is closed once the money actually came back.
  'ink.creditKomtToe': {
    nl: 'Dit komt jou toe: hij staat al met een minbedrag in je boeken, dus er is niets te betalen. De terugstorting herkennen we op je bank. Al terug of verrekend? Sluit hem af met "Verrekend of terugontvangen?".',
    ar: 'هذا مستحق لك: فهو مقيّد أصلًا بمبلغ سالب في دفاترك، فلا شيء لتدفعه. المبلغ المُعاد نتعرّف عليه في بنكك. استلمته أو تمت مقاصّته؟ أغلقه بـ «تمت المقاصة أم استُردّ المبلغ؟».',
    en: 'This is owed to you: it already stands as a negative amount in your books, so there is nothing to pay. We recognise the refund on your bank. Already back or netted off? Close it with "Netted off or received back?".',
  },
  'ink.creditnotaUitleg': {
    nl: 'Creditnota — dit bedrag gaat van je openstaande saldo af en verlaagt de btw die je terugvraagt',
    ar: 'إشعار دائن — هذا المبلغ يُخصم من رصيدك المفتوح ويخفّض ضريبة القيمة المضافة التي تستردها',
    en: 'Credit note — this amount comes off your outstanding balance and lowers the btw you reclaim',
  },
  'ink.creditPositief': {
    nl: 'Creditnota staat positief',
    ar: 'الإشعار الدائن بمبلغ موجب',
    en: 'Credit note stands positive',
  },
  'ink.creditPositiefUitleg': {
    nl: 'Creditnota met een positief bedrag — tik om te corrigeren.',
    ar: 'إشعار دائن بمبلغ موجب — اضغط للتصحيح.',
    en: 'Credit note with a positive amount — tap to correct.',
  },
  'ink.creditUitlegConflict': {
    nl: 'Geboekt als creditnota, maar met een POSITIEF bedrag. Zo telt hij mee in "nog te betalen" en wordt zijn btw opgeteld — allebei andersom dan het hoort.',
    ar: 'مقيّدة كإشعار دائن لكن بمبلغ موجب. فتُحتسب ضمن «ما زال مستحقًا» وتُضاف ضريبتها — وكلاهما بالاتجاه المعاكس لما يجب.',
    en: 'Booked as a credit note, but with a POSITIVE amount. So it counts towards "still to pay" and its btw is added — both the wrong way round.',
  },
  'ink.creditUitlegGeboekt': {
    nl: 'Een creditnota: geld dat jóu toekomt. Niets te betalen — hij staat als minbedrag in de boeken en gaat vanzelf van je openstaande saldo af.',
    ar: 'إشعار دائن: مال مستحق لك أنت. لا شيء لتدفعه — فهو مقيّد بمبلغ سالب ويُخصم تلقائيًا من رصيدك المفتوح.',
    en: 'A credit note: money owed to YOU. Nothing to pay — it stands as a minus amount in the books and comes off your outstanding balance by itself.',
  },
  'ink.creditUitlegLijkt': {
    nl: 'Deze factuur lijkt een creditnota — geld dat jou toekomt in plaats van geld dat je moet betalen.',
    ar: 'تبدو هذه الفاتورة إشعار دائن — مال مستحق لك لا مال عليك دفعه.',
    en: 'This invoice looks like a credit note — money owed to you instead of money you must pay.',
  },
  'ink.creditVraag': {
    nl: 'Is dit een creditnota?',
    ar: 'هل هذا إشعار دائن؟',
    en: 'Is this a credit note?',
  },
  'ink.datumEerst': {
    nl: 'Vul eerst de factuurdatum in — die bepaalt in welk kwartaal deze factuur telt',
    ar: 'املأ تاريخ الفاتورة أولًا — فهو يحدّد في أي ربع تُحتسب هذه الفاتورة',
    en: 'Fill in the invoice date first — it decides which quarter this invoice counts in',
  },
  'ink.deelbetaling': {
    nl: 'Deelbetaling: € {betaald} van € {totaal} ontvangen',
    ar: 'دفعة جزئية: وصل € {betaald} من € {totaal}',
    en: 'Partial payment: € {betaald} of € {totaal} received',
  },
  'ink.deelbetalingGewist': {
    nl: 'De genoteerde deelbetaling van {amount} op inkoopfactuur {number} wordt gewist. De factuur blijft openstaan, voor het volle bedrag.',
    ar: 'ستُمحى الدفعة الجزئية المسجَّلة بقيمة {amount} على فاتورة المشتريات {number}. تبقى الفاتورة مفتوحة بكامل المبلغ.',
    en: 'The noted instalment of {amount} on purchase invoice {number} will be erased. The invoice stays open, for the full amount.',
  },
  'ink.deelbetalingUitleg': {
    nl: 'Deelbetaling: € {paid} van € {total} betaald — tik om de rest te noteren',
    ar: 'دفعة جزئية: دُفع € {paid} من € {total} — انقر لتسجيل الباقي',
    en: 'Partial payment: € {paid} of € {total} paid — tap to note the rest',
  },
  'ink.deelGenoteerd': {
    nl: '{applied} genoteerd · nog {remaining} open',
    ar: 'سُجّل {applied} · لا يزال {remaining} مفتوحًا',
    en: '{applied} noted · {remaining} still open',
  },
  'ink.deelsBetaaldOpen': {
    nl: 'Deels betaald · € {remaining} open',
    ar: 'مدفوعة جزئياً · المتبقي € {remaining}',
    en: 'Partly paid · € {remaining} open',
  },
  'ink.deelsBijgewerkt': {
    nl: 'Deels bijgewerkt',
    ar: 'تم التحديث جزئيًا',
    en: 'Partly updated',
  },
  'ink.dezeLeverancier': {
    nl: 'Deze leverancier',
    ar: 'هذا المورّد',
    en: 'This supplier',
  },
  'ink.dezeLeverancierKlein': {
    nl: 'deze leverancier',
    ar: 'هذا المورّد',
    en: 'this supplier',
  },
  'ink.dubbel.foutVerbinding': {
    nl: 'De melding kon niet worden weggehaald. Probeer het opnieuw.',
    ar: 'لم يُزَل التنبيه. حاول مرة أخرى.',
    en: 'The notice was not removed. Please try again.',
  },
  'ink.dubbel.foutWeghalen': {
    nl: 'De melding kon niet worden weggehaald — probeer het opnieuw.',
    ar: 'تعذّرت إزالة التنبيه — حاول مرة أخرى.',
    en: 'The notice could not be removed — please try again.',
  },
  'ink.dubbel.genoteerd': {
    nl: 'Genoteerd — dit zijn twee verschillende facturen',
    ar: 'سُجّل — هاتان فاتورتان مختلفتان',
    en: 'Noted — these are two different invoices',
  },
  'ink.dubbel.metNr': {
    nl: 'Mogelijk dubbel met factuur {nr}.',
    ar: 'قد تكون مكررة مع الفاتورة {nr}.',
    en: 'Possibly a duplicate of invoice {nr}.',
  },
  'ink.dubbel.zonderNr': {
    nl: 'Mogelijk dubbel met de andere factuur.',
    ar: 'قد تكون مكررة مع الفاتورة الأخرى.',
    en: 'Possibly a duplicate of the other invoice.',
  },
  'ink.eenBetalingAan': {
    nl: 'Eén betaling aan {name}',
    ar: 'دفعة واحدة إلى {name}',
    en: 'One payment to {name}',
  },
  'ink.eenOverboeking': {
    nl: 'Eén overboeking van {amount} aan {name}. Scan met je bankapp of kopieer de gegevens — betalen doe je zelf.',
    ar: 'تحويل واحد بقيمة {amount} إلى {name}. امسح بتطبيق بنكك أو انسخ البيانات — الدفع تقوم به أنت.',
    en: 'One transfer of {amount} to {name}. Scan with your banking app or copy the details — you make the payment yourself.',
  },
  // [OVERSLAG-VERJAART] Deze zin zei "die bijlage halen wij niet nog een keer op", en dat was waar
  // zolang een overslag definitief was. Voor één soort is hij dat niet meer: een bestandstype dat
  // de app inmiddels wél kan openen — een .zip sinds [ARCHIEF-OPEN] — verjaart en wordt bij een
  // volgende sync alsnog opgehaald. De zin moet dat zeggen, want een ondernemer die hem letterlijk
  // leest gaat 29 dagafsluitingen met de hand uploaden die vanzelf binnenkomen.
  'ink.email.echteFactuur': {
    nl: 'Een échte factuur hiertussen halen wij niet opnieuw op — behalve als het een bestandstype is dat wij inmiddels wél kunnen openen, zoals .zip. Voeg hem anders zelf toe uit de e-mail van die datum.',
    ar: 'الفاتورة الحقيقية بين هذه لا نجلبها من جديد — إلا إن كانت من نوع ملفات صرنا نستطيع فتحه، مثل .zip. وإلا فأضفها بنفسك من بريد ذلك التاريخ.',
    en: 'A real invoice among these we do not fetch again — unless it is a file type we can open by now, such as .zip. Otherwise add it yourself from the e-mail of that date.',
  },
  'ink.email.nietTussen': {
    nl: 'Gebruik dan “Oudere e-mails opnieuw ophalen” hierboven.',
    ar: 'فاستخدم «أعد جلب الرسائل الأقدم» أعلاه.',
    en: 'Then use “Fetch older e-mails again” above.',
  },
  'ink.email.verbindProvider': {
    nl: 'Verbind {provider}',
    ar: 'اربط {provider}',
    en: 'Connect {provider}',
  },
  'ink.email.verwijderenBevestig': {
    nl: 'Verbinding verwijderen',
    ar: 'حذف الربط',
    en: 'Remove connection',
  },
  'ink.email.verwijderenUitleg': {
    nl: 'Nieuwe facturen komen dan niet meer automatisch binnen. Facturen die al ingelezen zijn, blijven staan.',
    ar: 'لن تصل الفواتير الجديدة تلقائيًا بعد ذلك. الفواتير المقروءة مسبقًا تبقى كما هي.',
    en: 'New invoices then no longer arrive automatically. Invoices already read in stay in place.',
  },
  'ink.email.verwijderenVraag': {
    nl: 'E-mailverbinding verwijderen?',
    ar: 'هل تريد حذف ربط البريد الإلكتروني؟',
    en: 'Remove the e-mail connection?',
  },
  'ink.exclBtw': {
    nl: 'Excl. BTW',
    ar: 'بدون btw',
    en: 'Excl. VAT',
  },
  'ink.facturenBetalen': {
    nl: '{n} facturen betalen',
    ar: 'دفع {n} فاتورة',
    en: 'Pay {n} invoices',
  },
  'ink.factuurBetaald': {
    nl: 'Inkoopfactuur {number} betaald ✓',
    ar: 'دُفعت فاتورة المشتريات {number} ✓',
    en: 'Purchase invoice {number} paid ✓',
  },
  'ink.factuurNr': {
    nl: 'Factuur {number}',
    ar: 'الفاتورة {number}',
    en: 'Invoice {number}',
  },
  'ink.filter.alle': {
    nl: 'Alle',
    ar: 'الكل',
    en: 'All',
  },
  'ink.filter.automatisch': {
    nl: 'Automatisch verwerkt',
    ar: 'عولجت تلقائيًا',
    en: 'Processed automatically',
  },
  'ink.filter.teBetalen': {
    nl: 'Te betalen',
    ar: 'مستحقة الدفع',
    en: 'To pay',
  },
  // [BESTE] What you must pay, by when — the three buckets Moneybird's "Te betalen" shows.
  'ink.bak.verlopen': { nl: 'Verlopen', ar: 'متأخرة', en: 'Overdue' },
  'ink.bak.dezeWeek': { nl: 'Deze week', ar: 'هذا الأسبوع', en: 'This week' },
  'ink.bak.later': { nl: 'Later', ar: 'لاحقًا', en: 'Later' },
  'ink.filter.zonderOrigineel': {
    nl: 'Zonder origineel',
    ar: 'بدون مستند أصلي',
    en: 'Without original',
  },
  'ink.fotoJa': {
    nl: 'Ja, lees de foto\'s terug',
    ar: 'نعم، أعد قراءة الصور',
    en: 'Yes, read the photos back',
  },
  'ink.fotoMax': {
    nl: 'Per keer rekenen we er maximaal 40 na. Er blijven er dan {n} over voor een volgende ronde.',
    ar: 'في كل مرة نعيد حساب 40 كحد أقصى. سيتبقى بعدها {n} لجولة قادمة.',
    en: 'Per run we recheck at most 40. That leaves {n} for a next round.',
  },
  'ink.fotoNarekenen': {
    nl: '{n} foto\'s ook narekenen?',
    ar: 'إعادة حساب {n} صورة أيضًا؟',
    en: 'Recheck {n} photos too?',
  },
  'ink.fotoNarekenenEen': {
    nl: '1 foto ook narekenen?',
    ar: 'إعادة حساب صورة واحدة أيضًا؟',
    en: 'Recheck 1 photo too?',
  },
  'ink.fotoNietsVerandert': {
    nl: 'Er verandert niets aan je facturen — wij rekenen alleen na.',
    ar: 'لن يتغيّر شيء في فواتيرك — نحن نعيد الحساب فقط.',
    en: 'Nothing changes on your invoices — we only recheck.',
  },
  'ink.fotoUitlegScan': {
    nl: 'Deze facturen zijn een foto of scan: geen tekst om in te zoeken. We kunnen ze opnieuw laten uitlezen en het bedrag daarmee vergelijken.',
    ar: 'هذه الفواتير صورة أو مسح ضوئي: لا نص للبحث فيه. يمكننا إعادة قراءتها ومقارنة المبلغ بذلك.',
    en: 'These invoices are a photo or scan: no text to search in. We can have them read out again and compare the amount against that.',
  },
  'ink.fotoUitlegTweede': {
    nl: 'Dat is een tweede lezing van de foto: zekerder dan niets, maar geen letterlijke tekstcontrole.',
    ar: 'تلك قراءة ثانية للصورة: أوثق من لا شيء، لكنها ليست فحصًا نصيًا حرفيًا.',
    en: 'That is a second reading of the photo: surer than nothing, but not a literal text check.',
  },
  'ink.fout.bevestiging': {
    nl: 'Bevestiging mislukt — factuur staat nog in de wachtrij',
    ar: 'فشل التأكيد — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Confirming failed — the invoice is still in the queue',
  },
  'ink.fout.negeren': {
    nl: 'Negeren mislukt — factuur staat nog in de wachtrij',
    ar: 'فشل التجاهل — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Ignoring failed — the invoice is still in the queue',
  },
  'ink.fout.nogInWachtrij': {
    nl: 'Fout — factuur staat nog in de wachtrij',
    ar: 'خطأ — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Error — the invoice is still in the queue',
  },
  'ink.fout.opnieuw': {
    nl: 'Fout — probeer opnieuw',
    ar: 'خطأ — حاول مرة أخرى',
    en: 'Error — please try again',
  },
  'ink.fout.terugzetten': {
    nl: 'Terugzetten mislukt — probeer opnieuw',
    ar: 'فشل الإرجاع — حاول مرة أخرى',
    en: 'Restoring failed — please try again',
  },
  'ink.fout.verificatie': {
    nl: 'Verificatie mislukt — factuur staat nog in de wachtrij',
    ar: 'فشل التدقيق — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Verification failed — the invoice is still in the queue',
  },
  'ink.gecategoriseerd': {
    nl: '{n} banktransactie(s) automatisch gecategoriseerd — controleer ze op de Bank-pagina.',
    ar: 'صُنّفت {n} حركة بنكية تلقائيًا — راجعها في صفحة البنك.',
    en: '{n} bank transaction(s) categorised automatically — check them on the Bank page.',
  },
  'ink.geenBedragOpFactuur': {
    nl: 'Geen bedrag op deze factuur, dus niets af te boeken. Vul eerst het factuurbedrag in.',
    ar: 'لا مبلغ على هذه الفاتورة، فلا شيء لتسويته. أدخل مبلغ الفاتورة أولًا.',
    en: 'No amount on this invoice, so nothing to settle. Fill in the invoice amount first.',
  },
  'ink.geenBedragVastgelegd': {
    nl: 'Geen bedrag vastgelegd, dus verplaatsen kan niet. Draai hem terug en boek hem opnieuw.',
    ar: 'لم يُسجَّل مبلغ، فلا يمكن النقل. تراجع عنها وسجّلها من جديد.',
    en: 'No amount recorded, so it cannot be moved. Revert it and book it again.',
  },
  'ink.geenDatum': {
    nl: '{n} facturen hebben geen factuurdatum en vallen buiten deze periode.',
    ar: '{n} فاتورة بلا تاريخ فاتورة وتقع خارج هذه الفترة.',
    en: '{n} invoices have no invoice date and fall outside this period.',
  },
  'ink.geenDatumEen': {
    nl: '1 factuur heeft geen factuurdatum en valt buiten deze periode.',
    ar: 'فاتورة واحدة بلا تاريخ فاتورة وتقع خارج هذه الفترة.',
    en: '1 invoice has no invoice date and falls outside this period.',
  },
  'ink.geenGevondenVoor': {
    nl: 'Geen facturen gevonden voor “{query}”.',
    ar: 'لم يُعثر على فواتير لـ«{query}».',
    en: 'No invoices found for “{query}”.',
  },
  // [WIJ-LAZEN] "Geen geldig IBAN gevonden op deze factuur" is een uitspraak over het PAPIER, en
  // die kan deze app niet doen. Gemeten op een gefotografeerde DELMO-factuur: er staan er twee op,
  // allebei geldig (ING en Rabobank), en de lezer maakte van NL94.INGB.066.66.64.293 één cijfer
  // verkeerd. De eigenaar las dus dat zijn leverancier geen rekeningnummer had afgedrukt, terwijl
  // het er twee keer stond. De instructie blijft dezelfde; alleen de schuld verhuist naar waar hij
  // hoort.
  'ink.geenIban': {
    nl: 'Geen leesbaar rekeningnummer op deze factuur. Neem het over uit de PDF en betaal in je bankapp.',
    ar: 'لا رقم حساب مقروء على هذه الفاتورة. انقله من ملف PDF وادفع في تطبيق بنكك.',
    en: 'No readable account number on this invoice. Take it from the PDF and pay in your banking app.',
  },
  'ink.geenInPeriode': {
    nl: 'Geen inkoopfacturen in {period}',
    ar: 'لا فواتير مشتريات في {period}',
    en: 'No purchase invoices in {period}',
  },
  'ink.geenNieuweBetalingen': {
    nl: 'Geen nieuwe betalingen herkend in je bankafschrift.',
    ar: 'لم يُتعرَّف على دفعات جديدة في كشفك البنكي.',
    en: 'No new payments recognised in your bank statement.',
  },
  'ink.geenNummer': {
    nl: '(geen nummer)',
    ar: '(بلا رقم)',
    en: '(no number)',
  },
  'ink.geenOpenTransacties': {
    nl: 'Geen open banktransacties om tegen te matchen.',
    ar: 'لا حركات بنكية مفتوحة للمطابقة معها.',
    en: 'No open bank transactions to match against.',
  },
  'ink.geenOrigineel': {
    nl: '{n} facturen zonder origineel document: daar viel niets naast te leggen. Voeg het toe via de factuur zelf.',
    ar: '{n} فاتورة بلا مستند أصلي: لم يكن هناك ما يُقارن بها. أضفه من الفاتورة نفسها.',
    en: '{n} invoices without an original document: nothing to compare against there. Add it via the invoice itself.',
  },
  'ink.geenOrigineelEen': {
    nl: '1 factuur zonder origineel document: daar viel niets naast te leggen. Voeg het toe via de factuur zelf.',
    ar: 'فاتورة واحدة بلا مستند أصلي: لم يكن ثمة ما يُقارن به. أضفه من الفاتورة نفسها.',
    en: '1 invoice without an original document: nothing to compare against there. Add it via the invoice itself.',
  },
  'ink.geenPassendeFactuur': {
    nl: 'Geen passende factuur: alleen een gecontroleerde factuur van dezelfde soort met minstens {amount} open kan deze betaling ontvangen.',
    ar: 'لا توجد فاتورة مناسبة: لا يمكن أن تستقبل هذه الدفعة إلا فاتورة مدققة من النوع نفسه ومفتوح عليها {amount} على الأقل.',
    en: 'No fitting invoice: only a verified invoice of the same kind with at least {amount} open can receive this payment.',
  },
  'ink.geenQr': {
    nl: 'Geen QR mogelijk',
    ar: 'تعذّر إنشاء رمز QR',
    en: 'No QR possible',
  },
  'ink.geenVerbinding': {
    nl: 'geen verbinding',
    ar: 'لا يوجد اتصال',
    en: 'no connection',
  },
  'ink.geenVervaldatum': {
    nl: 'geen vervaldatum',
    ar: 'لا تاريخ استحقاق',
    en: 'no due date',
  },
  'ink.gekopieerd': {
    nl: '{what} gekopieerd ✓',
    ar: 'نُسخ {what} ✓',
    en: '{what} copied ✓',
  },
  'ink.gekoppeld': {
    nl: '{facturen} gekoppeld',
    ar: 'رُبطت {facturen}',
    en: '{facturen} linked',
  },
  'ink.gekoppeld.autoEen': {
    nl: '1 betaling automatisch gekoppeld.',
    ar: 'رُبط دفع واحد تلقائيًا.',
    en: '1 payment linked automatically.',
  },
  'ink.gekoppeld.autoMeer': {
    nl: '{n} betalingen automatisch gekoppeld.',
    ar: 'عدد الدفعات المربوطة تلقائيًا: {n}.',
    en: '{n} payments linked automatically.',
  },
  'ink.gekoppeld.een': {
    nl: '1 betaling gekoppeld',
    ar: 'رُبط دفع واحد',
    en: '1 payment linked',
  },
  'ink.gekoppeld.meer': {
    nl: '{n} betalingen gekoppeld',
    ar: 'عدد الدفعات المربوطة: {n}',
    en: '{n} payments linked',
  },
  'ink.genegeerdToast': {
    nl: 'Factuur genegeerd',
    ar: 'تم تجاهل الفاتورة',
    en: 'Invoice ignored',
  },
  'ink.geselecteerd': {
    nl: '{n} geselecteerd · {amount}',
    ar: 'المحدد: {n} · {amount}',
    en: '{n} selected · {amount}',
  },
  'ink.geverifieerd': {
    nl: '✓ Factuur geverifieerd',
    ar: '✓ دُققت الفاتورة',
    en: '✓ Invoice verified',
  },
  'ink.geverifieerd.metKoppelingEen': {
    nl: '✓ Geverifieerd · 1 betaling automatisch gekoppeld',
    ar: '✓ دُققت · رُبطت دفعة واحدة تلقائيًا',
    en: '✓ Verified · 1 payment linked automatically',
  },
  'ink.geverifieerd.metKoppelingMeer': {
    nl: '✓ Geverifieerd · {n} betalingen automatisch gekoppeld',
    ar: '✓ دُققت · رُبطت {n} دفعات تلقائيًا',
    en: '✓ Verified · {n} payments linked automatically',
  },
  'ink.gevonden': {
    nl: '{facturen} gevonden',
    ar: 'وُجدت {facturen}',
    en: '{facturen} found',
  },
  'ink.herkendBetaald': {
    nl: '{facturen} herkend in je bankafschrift en op betaald gezet.',
    ar: 'تم التعرّف على {facturen} في كشفك البنكي ووُضعت كمدفوعة.',
    en: '{facturen} recognised in your bank statement and set to paid.',
  },
  'ink.herlees.geenFactuur': {
    nl: 'Dit lijkt geen boekbare factuur',
    ar: 'لا يبدو هذا فاتورة قابلة للتسجيل',
    en: 'This does not look like a bookable invoice',
  },
  'ink.herlees.geenGegevens': {
    nl: 'Bij het opnieuw inlezen vonden we geen factuurgegevens',
    ar: 'عند إعادة القراءة لم نعثر على بيانات فاتورة',
    en: 'On re-reading we found no invoice data',
  },
  'ink.herlees.mislukt': {
    nl: 'Opnieuw inlezen is niet gelukt — probeer het later opnieuw.',
    ar: 'لم تنجح إعادة القراءة — حاول لاحقًا.',
    en: 'Re-reading did not work — try again later.',
  },
  'ink.herlees.naarGenegeerd': {
    nl: 'Hij staat nu bij Genegeerd, met reden “Geen factuur”.\n\nKlopt dat niet? Zet hem daar met één tik terug.',
    ar: 'إنه الآن في «المتجاهَل» بسبب «ليست فاتورة». أليس ذلك صحيحًا؟ أرجعه من هناك بضغطة واحدة.',
    en: 'It is now under Ignored, with reason “Not an invoice”.\n\nNot right? Put it back there with one tap.',
  },
  'ink.herlees.nietGewijzigd': {
    nl: 'De opgeslagen gegevens zijn niet gewijzigd — je kunt hem zelf negeren.',
    ar: 'لم تتغيّر البيانات المحفوظة — يمكنك تجاهلها بنفسك.',
    en: 'The stored data was not changed — you can ignore it yourself.',
  },
  'ink.herleesAlles.gestopt': {
    nl: 'Opnieuw inlezen gestopt',
    ar: 'توقفت إعادة القراءة',
    en: 'Re-reading stopped',
  },
  'ink.herleesAlles.ingelezen': {
    nl: '{n} opnieuw ingelezen',
    ar: 'أُعيدت قراءة {n}',
    en: '{n} re-read',
  },
  'ink.herleesAlles.klaar': {
    nl: 'Opnieuw inlezen klaar',
    ar: 'انتهت إعادة القراءة',
    en: 'Re-reading done',
  },
  'ink.herleesAlles.knop': {
    nl: '↻ Alles met aandacht opnieuw inlezen ({n})',
    ar: '↻ إعادة قراءة كل ما يحتاج انتباهاً ({n})',
    en: '↻ Re-read everything needing attention ({n})',
  },
  'ink.herleesAlles.modelWeg': {
    nl: 'Het leesmodel is niet beschikbaar op dit account.',
    ar: 'نموذج القراءة غير متاح على هذا الحساب.',
    en: 'The reading model is not available on this account.',
  },
  'ink.herleesAlles.nietGelukt': {
    nl: '{n} niet gelukt — probeer die later los opnieuw',
    ar: 'فشل {n} — حاول معها لاحقًا كلٌّ على حدة',
    en: '{n} failed — retry those separately later',
  },
  'ink.herleesAlles.nietGeprobeerd': {
    nl: '{n} niet geprobeerd — ze staan onveranderd in de wachtrij',
    ar: 'لم تُجرَّب {n} — ما تزال في قائمة الانتظار دون تغيير',
    en: '{n} not attempted — they sit unchanged in the queue',
  },
  'ink.herleesAlles.nietWeggezet': {
    nl: '{n} bleek geen boekbare factuur, maar kon niet worden weggezet — bekijk die zelf',
    ar: 'تبيّن أن {n} ليست فاتورة قابلة للتسجيل، لكن تعذّر نقلها — راجعها بنفسك',
    en: '{n} turned out not to be a bookable invoice but could not be put away — look at those yourself',
  },
  'ink.herleesAlles.overgeslagen': {
    nl: '{n} overgeslagen (al bevestigd)',
    ar: 'تُخطّي {n} (مؤكَّدة مسبقًا)',
    en: '{n} skipped (already confirmed)',
  },
  'ink.herleesAlles.uitleg': {
    nl: 'Elke gemarkeerde factuur wordt opnieuw gelezen. Dat kan even duren — je kunt ondertussen niets anders doen op dit scherm.',
    ar: 'ستُعاد قراءة كل فاتورة معلَّمة. قد يستغرق ذلك وقتًا — لا يمكنك فعل شيء آخر على هذه الشاشة أثناء ذلك.',
    en: 'Every flagged invoice is read again. That can take a while — you cannot do anything else on this screen meanwhile.',
  },
  'ink.herleesAlles.voortgang': {
    nl: 'Opnieuw inlezen… ({n}/{totaal})',
    ar: 'جارٍ إعادة القراءة… ({n}/{totaal})',
    en: 'Re-reading… ({n}/{totaal})',
  },
  'ink.herleesAlles.vraag': {
    nl: '{n} facturen opnieuw inlezen?',
    ar: 'هل تريد إعادة قراءة {n} فاتورة؟',
    en: 'Re-read {n} invoices?',
  },
  'ink.herleesAlles.weggezet': {
    nl: '{n} bleek geen boekbare factuur — verplaatst naar Genegeerd (reden: geen factuur)',
    ar: 'تبيّن أن {n} ليست فاتورة قابلة للتسجيل — نُقلت إلى «المتجاهَل» (السبب: ليست فاتورة)',
    en: '{n} turned out not to be a bookable invoice — moved to Ignored (reason: not an invoice)',
  },
  'ink.herleesKnop': {
    nl: 'Opnieuw inlezen',
    ar: 'إعادة القراءة',
    en: 'Read again',
  },
  'ink.incassoAanUitlegKort': {
    nl: 'Geen betaalknop meer; na de vervaldatum zetten we ze vanzelf op betaald.',
    ar: 'لا زر دفع بعد الآن؛ بعد تاريخ الاستحقاق نضعها كمدفوعة تلقائياً.',
    en: 'No pay button any more; after the due date we set them to paid by ourselves.',
  },
  'ink.incassoAanVraag': {
    nl: '{name} zelf laten afschrijven?',
    ar: 'السماح لـ{name} بالخصم بنفسه؟',
    en: 'Let {name} collect by itself?',
  },
  'ink.incassoBlijftStaan': {
    nl: 'Wat al op betaald staat, blijft staan — dit draait niets terug.',
    ar: 'ما هو مدفوع يبقى كما هو — هذا لا يتراجع عن شيء.',
    en: 'Whatever is already set to paid stays put — this reverts nothing.',
  },
  'ink.incassoGeenKnop': {
    nl: 'Geen betaalknop meer bij deze leverancier — anders betaal je wat de bank al afschreef.',
    ar: 'لا زر دفع لدى هذا المورّد بعد الآن — وإلا لدفعت ما خصمه البنك بالفعل.',
    en: 'No pay button any more for this supplier — otherwise you would pay what the bank already collected.',
  },
  'ink.incassoMeteenBetaald': {
    nl: 'Wat de bank al heeft geïncasseerd zetten we meteen op betaald.',
    ar: 'ما خصمه البنك بالفعل نضعه كمدفوع فورًا.',
    en: 'What the bank has already collected we set to paid immediately.',
  },
  'ink.incassoMeteenBetaaldOpen': {
    nl: '{n} open facturen van {name}, samen {amount}. Wat in je bankafschrift staat, zetten we op betaald.',
    ar: '{n} فاتورة مفتوحة من {name}، مجموعها {amount}. ما يظهر في كشفك البنكي نضعه كمدفوع.',
    en: '{n} open invoices from {name}, {amount} together. What appears in your bank statement we set to paid.',
  },
  'ink.incassoOverzicht': {
    nl: 'Je krijgt daarna een overzicht van precies welke facturen zijn verwerkt en welke niet.',
    ar: 'ستحصل بعدها على ملخص يبيّن بالضبط أي الفواتير عولجت وأيها لم تُعالج.',
    en: 'You then get an overview of exactly which invoices were processed and which were not.',
  },
  'ink.incassoResultAan': {
    nl: 'Geen betaalknop meer bij deze leverancier. Nieuwe facturen zetten we na de vervaldatum vanzelf op betaald.',
    ar: 'لا زر دفع لدى هذا المورّد بعد الآن. الفواتير الجديدة نضعها كمدفوعة تلقائيًا بعد تاريخ الاستحقاق.',
    en: 'No pay button any more for this supplier. New invoices we set to paid by ourselves after the due date.',
  },
  'ink.incassoResultUit': {
    nl: 'Facturen van deze leverancier krijgen weer een betaalknop. Wat al op betaald staat, blijft staan.',
    ar: 'ستعود لفواتير هذا المورّد أزرار الدفع. ما هو مدفوع يبقى كما هو.',
    en: 'Invoices from this supplier get a pay button again. Whatever is already set to paid stays put.',
  },
  'ink.incassoUit': {
    nl: '{name} staat niet meer op automatische incasso',
    ar: '{name} لم يعد على الخصم المباشر',
    en: '{name} is no longer on direct debit',
  },
  'ink.incassoUitVraag': {
    nl: 'Automatische incasso uitzetten voor {name}?',
    ar: 'إيقاف الخصم المباشر لـ{name}؟',
    en: 'Turn off direct debit for {name}?',
  },
  'ink.incassoWaarschuwing': {
    nl: 'Facturen die je bank zelf afschrijft staan hieronder daarom gewoon als "te betalen". Betaal ze niet nog een keer.',
    ar: 'لذلك تظهر أدناه الفواتير التي يخصمها بنكك بنفسه كأنها «te betalen». لا تدفعها مرة ثانية.',
    en: 'Invoices your bank collects itself therefore simply stand below as "te betalen". Do not pay them a second time.',
  },
  'ink.incassoWeerKnop': {
    nl: 'Facturen van {name} krijgen weer een betaalknop.',
    ar: 'ستعود لفواتير {name} أزرار الدفع.',
    en: 'Invoices from {name} get a pay button again.',
  },
  'ink.incassoZetAan': {
    nl: 'Zet aan als dit geld vanzelf van je rekening gaat (huur, energie, verzekering). Afvinken hoeft dan niet meer.',
    ar: 'فعّل هذا إذا كان المال يُخصم من حسابك تلقائياً (إيجار، طاقة، تأمين). لن تحتاج بعدها لتعليمها.',
    en: 'Turn on if this money leaves your account by itself (rent, energy, insurance). No more ticking off then.',
  },
  'ink.inclBtw': {
    nl: 'Incl. BTW',
    ar: 'شامل btw',
    en: 'Incl. VAT',
  },
  'ink.inPeriode': {
    nl: '{facturen} in {period}',
    ar: '{facturen} في {period}',
    en: '{facturen} in {period}',
  },
  'ink.instellenMislukt': {
    nl: 'Instellen mislukt — er is niets gewijzigd',
    ar: 'فشل الضبط — لم يتغيّر شيء',
    en: 'Setting up failed — nothing was changed',
  },
  'ink.jaBoekCredit': {
    nl: 'Ja, boek als creditnota',
    ar: 'نعم، سجّلها كإشعار دائن',
    en: 'Yes, book as a credit note',
  },
  'ink.jaDraaiTerug': {
    nl: 'Ja, draai terug',
    ar: 'نعم، تراجع',
    en: 'Yes, revert',
  },
  'ink.jaMarkeerBetaald': {
    nl: 'Ja, markeer als betaald',
    ar: 'نعم، علّمها كمدفوعة',
    en: 'Yes, mark as paid',
  },
  'ink.jaZetAan': {
    nl: 'Ja, zet aan',
    ar: 'نعم، فعّله',
    en: 'Yes, turn on',
  },
  'ink.jaZetUit': {
    nl: 'Ja, zet uit',
    ar: 'نعم، أوقفه',
    en: 'Yes, turn off',
  },
  'ink.kasBijgewerkt': {
    nl: '{n} bijgewerkt',
    ar: 'تم التحديث: {n}',
    en: '{n} updated',
  },
  'ink.kasInBalans': {
    nl: 'Kasboek was al in balans met je contant betaalde facturen.',
    ar: 'كان دفتر الصندوق متوازنًا بالفعل مع فواتيرك المدفوعة نقدًا.',
    en: 'The cash book was already in balance with your cash-paid invoices.',
  },
  'ink.kasMislukt': {
    nl: 'Het kasboek kon niet worden bijgewerkt — probeer het straks opnieuw.',
    ar: 'تعذّر تحديث دفتر الصندوق — حاول بعد قليل.',
    en: 'The cash book could not be updated — try again in a while.',
  },
  'ink.kasregelVervalt': {
    nl: 'De kasboekregel voor deze betaling vervalt daarmee ook.',
    ar: 'وبذلك يُلغى أيضًا قيد دفتر الصندوق لهذه الدفعة.',
    en: 'The cash-book entry for this payment is removed with it.',
  },
  'ink.kasTeruggedraaid': {
    nl: '{n} teruggedraaid',
    ar: 'تم التراجع عن: {n}',
    en: '{n} reversed',
  },
  'ink.kasToegevoegd': {
    nl: '{n} kasboeking toegevoegd',
    ar: 'أُضيفت {n} قيود صندوق',
    en: '{n} cash entries added',
  },
  'ink.kiesBetaalde': {
    nl: 'Kies betaalde facturen om terug te draaien',
    ar: 'اختر فواتير مدفوعة للتراجع عنها',
    en: 'Choose paid invoices to revert',
  },
  'ink.kiesMinimaal': {
    nl: 'Kies minimaal 2 open inkoopfacturen',
    ar: 'اختر فاتورتي مشتريات مفتوحتين على الأقل',
    en: 'Choose at least 2 open purchase invoices',
  },
  'ink.kloptEentjeNiet': {
    nl: 'Klopt er eentje niet? Open hem en tik op "Betaald" om hem terug te zetten.',
    ar: 'أواحدة منها غير صحيحة؟ افتحها وانقر «Betaald» لإعادتها.',
    en: 'Is one of them wrong? Open it and tap "Betaald" to put it back.',
  },
  'ink.komenTerug': {
    nl: 'Deze facturen komen terug op "Te betalen"',
    ar: 'ستعود هذه الفواتير إلى «Te betalen»',
    en: 'These invoices return to "Te betalen"',
  },
  'ink.kop.aandachtEen': {
    nl: '1 factuur heeft je aandacht nodig',
    ar: 'فاتورة واحدة تحتاج انتباهك',
    en: '1 invoice needs your attention',
  },
  'ink.kop.aandachtMeer': {
    nl: '{n} facturen hebben je aandacht nodig',
    ar: '{n} فواتير تحتاج إلى انتباهك',
    en: '{n} invoices need your attention',
  },
  'ink.kop.klaarEen': {
    nl: '1 factuur klaar om te bevestigen',
    ar: 'فاتورة واحدة جاهزة للتأكيد',
    en: '1 invoice ready to confirm',
  },
  'ink.kop.klaarMeer': {
    nl: '{n} facturen klaar om te bevestigen',
    ar: '{n} فواتير جاهزة للتأكيد',
    en: '{n} invoices ready to confirm',
  },
  'ink.kop.klaarNote': {
    nl: '{n} klaar om te bevestigen',
    ar: 'الجاهز للتأكيد: {n}',
    en: '{n} ready to confirm',
  },
  'ink.kopieerLabel': {
    nl: 'Kopieer {label}',
    ar: 'نسخ {label}',
    en: 'Copy {label}',
  },
  'ink.kost.allebei': {
    nl: 'Allebei',
    ar: 'كلاهما',
    en: 'Both',
  },
  'ink.kost.allebei.hint': {
    nl: 'Dient je belaste én je vrijgestelde werk (huur, energie, boekhouder) — de BTW wordt naar verhouding afgetrokken.',
    ar: 'يخدم عملك الخاضع للضريبة وعملك المعفى معًا (الإيجار، الطاقة، المحاسب) — تُخصم الضريبة بالتناسب.',
    en: 'Serves both your taxed and your exempt work (rent, energy, accountant) — the VAT is deducted proportionally.',
  },
  'ink.kost.belast': {
    nl: 'Belast werk',
    ar: 'عمل خاضع للضريبة',
    en: 'Taxed work',
  },
  'ink.kost.belast.hint': {
    nl: 'Alleen voor je BTW-belaste werk — de BTW is volledig aftrekbaar.',
    ar: 'لعملك الخاضع للضريبة فقط — الضريبة قابلة للخصم بالكامل.',
    en: 'Only for your VAT-taxed work — the VAT is fully deductible.',
  },
  'ink.kost.toast.allebei': {
    nl: 'Toegewezen aan allebei — BTW naar verhouding ✓',
    ar: 'خُصّصت لكليهما — الضريبة بالتناسب ✓',
    en: 'Assigned to both — VAT proportionally ✓',
  },
  'ink.kost.toast.belast': {
    nl: 'Toegewezen aan belast werk — BTW volledig aftrekbaar ✓',
    ar: 'خُصّصت للعمل الخاضع للضريبة — الضريبة قابلة للخصم بالكامل ✓',
    en: 'Assigned to taxed work — VAT fully deductible ✓',
  },
  'ink.kost.toast.vrijgesteld': {
    nl: 'Toegewezen aan vrijgesteld werk — geen aftrek ✓',
    ar: 'خُصّصت للعمل المعفى — لا خصم ✓',
    en: 'Assigned to exempt work — no deduction ✓',
  },
  'ink.kost.vrijgesteld': {
    nl: 'Vrijgesteld werk',
    ar: 'عمل معفى',
    en: 'Exempt work',
  },
  'ink.kost.vrijgesteld.hint': {
    nl: 'Alleen voor je vrijgestelde werk — hierop bestaat geen recht op aftrek.',
    ar: 'لعملك المعفى فقط — لا حق في الخصم هنا.',
    en: 'Only for your exempt work — there is no right to deduct here.',
  },
  'ink.kwartaalOnbekend': {
    nl: 'we konden niet nagaan of dit kwartaal al is ingediend',
    ar: 'تعذّر التحقق مما إذا كان هذا الربع قد قُدّم بالفعل',
    en: 'we could not check whether this quarter has already been filed',
  },
  'ink.leegLaten': {
    nl: 'Leeg laten = alles betaald ({amount})',
    ar: 'اتركه فارغًا = دُفع الكل ({amount})',
    en: 'Leave empty = everything paid ({amount})',
  },
  'ink.leegtab.confirmed': {
    nl: 'Nog niets bevestigd',
    ar: 'لم يؤكَّد شيء بعد',
    en: 'Nothing confirmed yet',
  },
  'ink.leegtab.confirmedSub': {
    nl: 'Facturen die je verifieert of markeert als betaald verschijnen hier.',
    ar: 'الفواتير التي تدقّقها أو تعلّمها كمدفوعة تظهر هنا.',
    en: 'Invoices you verify or mark as paid appear here.',
  },
  'ink.leegtab.ignored': {
    nl: 'Geen genegeerde facturen',
    ar: 'لا فواتير متجاهَلة',
    en: 'No ignored invoices',
  },
  'ink.leegtab.ignoredSub': {
    nl: 'Facturen die je negeert komen hier terecht.',
    ar: 'الفواتير التي تتجاهلها تصل إلى هنا.',
    en: 'Invoices you ignore end up here.',
  },
  'ink.leegtab.pending': {
    nl: 'Alles bijgewerkt',
    ar: 'كل شيء محدَّث',
    en: 'Everything up to date',
  },
  'ink.leegtab.pendingSub': {
    nl: 'Nieuwe facturen verschijnen hier zodra ze binnenkomen.',
    ar: 'تظهر الفواتير الجديدة هنا حين تصل.',
    en: 'New invoices appear here as they arrive.',
  },
  'ink.lijktCreditnota': {
    nl: 'Lijkt een creditnota',
    ar: 'يبدو أنها إشعار دائن',
    en: 'Looks like a credit note',
  },
  'ink.lijstNietCompleet': {
    nl: 'Deze lijst is daardoor niet compleet — ga er niet van uit dat wat je hier ziet alles is.',
    ar: 'لذلك هذه القائمة غير كاملة — لا تفترض أن ما تراه هنا هو كل شيء.',
    en: 'This list is therefore not complete — do not assume that what you see here is everything.',
  },
  'ink.markeerBetaaldVraag': {
    nl: 'Inkoopfactuur markeren als betaald?',
    ar: 'تعليم فاتورة المشتريات كمدفوعة؟',
    en: 'Mark purchase invoice as paid?',
  },
  'ink.matchenMetBank': {
    nl: 'Matchen met bank & kas',
    ar: 'مطابقة مع البنك والصندوق',
    en: 'Match with bank & cash',
  },
  'ink.matchenUitleg': {
    nl: 'Koppelt je inkoopfacturen aan het bankafschrift en aan de kas, en werkt alles bij wat zeker is',
    ar: 'يربط فواتير مشترياتك بكشف الحساب البنكي وبالصندوق، ويحدّث كل ما هو مؤكد',
    en: 'Links your purchase invoices to the bank statement and the cash book, and updates everything that is certain',
  },
  'ink.meerdereBetalen': {
    nl: 'Meerdere betalen',
    ar: 'دفع عدة فواتير',
    en: 'Pay several',
  },
  'ink.methodeContant': {
    nl: 'contant',
    ar: 'نقدًا',
    en: 'in cash',
  },
  'ink.methodePas': {
    nl: 'met de pas',
    ar: 'بالبطاقة',
    en: 'by card',
  },
  'ink.mogelijkBetaaldUitleg': {
    nl: 'Je hebt mogelijk al een factuur van dezelfde leverancier voor hetzelfde bedrag betaald:',
    ar: 'ربما دفعت بالفعل فاتورة من المورّد نفسه وبالمبلغ نفسه:',
    en: 'You may already have paid an invoice from the same supplier for the same amount:',
  },
  'ink.mp.alleenFotos': {
    nl: 'Kies foto\'s of afbeeldingen — de pagina\'s van de factuur.',
    ar: 'اختر صورًا — صفحات الفاتورة.',
    en: 'Pick photos or images — the pages of the invoice.',
  },
  'ink.mp.combineerEen': {
    nl: 'Combineer 1 pagina → één factuur',
    ar: 'ادمج صفحة واحدة ← فاتورة واحدة',
    en: 'Combine 1 page → one invoice',
  },
  'ink.mp.combineerMeer': {
    nl: 'Combineer {n} pagina\'s → één factuur',
    ar: 'ادمج {n} صفحة ← فاتورة واحدة',
    en: 'Combine {n} pages → one invoice',
  },
  'ink.mp.combinerenMislukt': {
    nl: 'Combineren mislukt. Maak duidelijkere foto\'s, of voeg de pagina\'s los toe.',
    ar: 'فشل الدمج. التقط صورًا أوضح، أو أضف الصفحات منفصلة.',
    en: 'Combining failed. Take clearer photos, or add the pages separately.',
  },
  'ink.mp.fotograferen': {
    nl: '📷 Pagina fotograferen',
    ar: '📷 تصوير صفحة',
    en: '📷 Photograph a page',
  },
  'ink.mp.kiezen': {
    nl: '🖼️ Pagina’s kiezen',
    ar: '🖼️ اختيار صفحات',
    en: '🖼️ Pick pages',
  },
  'ink.mp.let': {
    nl: 'Eén PDF = één factuur. Zitten er verschillende facturen in één PDF? Voeg elke factuur los toe.',
    ar: 'ملف PDF واحد = فاتورة واحدة. عدة فواتير مختلفة في ملف واحد؟ أضف كل فاتورة على حدة.',
    en: 'One PDF = one invoice. Several different invoices in one PDF? Add each invoice separately.',
  },
  'ink.mp.paginasBewaard': {
    nl: 'De andere pagina\'s blijven bewaard.',
    ar: 'الصفحات الأخرى تبقى محفوظة.',
    en: 'The other pages stay kept.',
  },
  'ink.mp.uitleg': {
    nl: 'Kies of fotografeer elke pagina van dezelfde factuur; we voegen ze samen tot één.',
    ar: 'اختر أو صوّر كل صفحة من الفاتورة نفسها؛ وسندمجها في فاتورة واحدة.',
    en: 'Pick or photograph every page of the same invoice; we merge them into one.',
  },
  'ink.mp.voegEerstToe': {
    nl: 'Voeg eerst pagina\'s toe',
    ar: 'أضف صفحات أولاً',
    en: 'Add pages first',
  },
  // [PAGINA-VOLGORDE] The page tray, shared by Inkomend and Uploaden — one control, one set of
  // words. The order these pages are in becomes the order of a document kept for seven years, so
  // the tray both SHOWS it and lets the owner correct it.
  'mp.volgorde.titel': {
    nl: 'Volgorde van de pagina’s',
    ar: 'ترتيب الصفحات',
    en: 'The order of the pages',
  },
  'mp.volgorde.uitleg': {
    nl: 'In deze volgorde komen ze in de factuur. Klopt het niet? Verplaats een pagina met ↑ of ↓.',
    ar: 'بهذا الترتيب ستدخل الصفحات في الفاتورة. ألا يطابق؟ حرّك الصفحة بـ ↑ أو ↓.',
    en: 'This is the order they go into the invoice. Not right? Move a page with ↑ or ↓.',
  },
  'mp.volgorde.gesorteerd': {
    nl: 'We hebben de pagina’s op nummer gezet. Controleer of dat klopt.',
    ar: 'رتّبنا الصفحات حسب الرقم. تحقّق من صحة الترتيب.',
    en: 'We put the pages in number order. Please check that it is right.',
  },
  'mp.pagina.nr': {
    nl: 'Pagina {n}',
    ar: 'الصفحة {n}',
    en: 'Page {n}',
  },
  'mp.pagina.omhoog': {
    nl: 'Pagina {n} naar voren',
    ar: 'نقل الصفحة {n} إلى الأمام',
    en: 'Move page {n} forward',
  },
  'mp.pagina.omlaag': {
    nl: 'Pagina {n} naar achteren',
    ar: 'نقل الصفحة {n} إلى الخلف',
    en: 'Move page {n} back',
  },
  'mp.pagina.verwijderen': {
    nl: 'Pagina {n} verwijderen',
    ar: 'حذف الصفحة {n}',
    en: 'Remove page {n}',
  },
  'mp.dubbelEen': {
    nl: 'Eén foto stond er al bij — die is overgeslagen.',
    ar: 'صورة واحدة كانت موجودة سلفًا — جرى تخطّيها.',
    en: 'One photo was already there — it was skipped.',
  },
  'mp.dubbelMeer': {
    nl: '{n} foto’s stonden er al bij — die zijn overgeslagen.',
    ar: '{n} صور كانت موجودة سلفًا — جرى تخطّيها.',
    en: '{n} photos were already there — they were skipped.',
  },
  'mp.overflowEen': {
    nl: 'Eén pagina paste er niet meer bij (max {max}). Voeg die als losse factuur toe.',
    ar: 'صفحة واحدة لم يعد لها متّسع (الحد الأقصى {max}). أضفها كفاتورة منفصلة.',
    en: 'One page no longer fitted (max {max}). Add it as a separate invoice.',
  },
  'mp.overflowMeer': {
    nl: '{n} pagina’s pasten er niet meer bij (max {max}). Voeg die als losse factuur toe.',
    ar: '{n} صفحات لم يعد لها متّسع (الحد الأقصى {max}). أضفها كفاتورة منفصلة.',
    en: '{n} pages no longer fitted (max {max}). Add those as a separate invoice.',
  },
  'ink.multi.bevestig': {
    nl: 'Ja, dit is één factuur',
    ar: 'نعم، هذه فاتورة واحدة',
    en: 'Yes, this is one invoice',
  },
  'ink.multi.foutVerbinding': {
    nl: 'De waarschuwing is niet weggehaald. Controleer je verbinding en probeer het opnieuw.',
    ar: 'لم يُزَل التحذير. تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'The warning was not removed. Check your connection and try again.',
  },
  'ink.multi.foutWeghalen': {
    nl: 'De waarschuwing kon niet worden weggehaald — ververs de pagina en probeer het opnieuw.',
    ar: 'تعذّرت إزالة التحذير — أعد تحميل الصفحة وحاول مرة أخرى.',
    en: 'The warning could not be removed — refresh the page and try again.',
  },
  'ink.multi.genoteerd': {
    nl: 'Genoteerd — deze factuur wordt verder op zichzelf beoordeeld',
    ar: 'سُجّل — ستُقيَّم هذه الفاتورة بذاتها من الآن',
    en: 'Noted — this invoice is now judged on its own',
  },
  'ink.multi.nee': {
    nl: 'Nee, dit is één factuur',
    ar: 'لا، هذه فاتورة واحدة',
    en: 'No, this is one invoice',
  },
  'ink.multi.uitleg': {
    nl: 'Dit bestand bevat misschien meer dan één factuur. Bevestig je dat het er één is, dan vervalt de waarschuwing. Een tweede factuur voeg je los toe — die staat nu nergens.',
    ar: 'قد يحتوي هذا الملف على أكثر من فاتورة. إن أكّدت أنها واحدة يزول التحذير. أضف الفاتورة الثانية على حدة — فهي الآن غير موجودة في أي مكان.',
    en: 'This file may hold more than one invoice. If you confirm it is one, the warning goes. A second invoice you add separately — right now it is nowhere.',
  },
  'ink.multi.vraag': {
    nl: 'Bevat dit bestand één factuur?',
    ar: 'هل يحتوي هذا الملف على فاتورة واحدة؟',
    en: 'Does this file hold one invoice?',
  },
  'ink.narekenenLezenMislukt': {
    nl: 'Narekenen is niet gelukt — wij konden je facturen nu niet lezen. Probeer het zo nog eens.',
    ar: 'فشلت إعادة الحساب — تعذّرت قراءة فواتيرك الآن. أعد المحاولة بعد قليل.',
    en: 'Recalculating did not work — we could not read your invoices just now. Try again shortly.',
  },
  'ink.narekenenMislukt': {
    nl: 'Narekenen is niet gelukt. Probeer het zo nog eens.',
    ar: 'فشلت إعادة الحساب. أعد المحاولة بعد قليل.',
    en: 'Recalculating did not work. Try again shortly.',
  },
  'ink.narekenenUitleg': {
    nl: 'Leest je facturen terug uit de documenten zelf en zegt of de bedragen er zo op staan. Verandert niets.',
    ar: 'يعيد قراءة فواتيرك من المستندات نفسها ويخبرك إن كانت المبالغ مذكورة فيها هكذا. لا يغيّر شيئاً.',
    en: 'Reads your invoices back from the documents themselves and says whether the amounts are printed there like that. Changes nothing.',
  },
  'ink.neeGewoneFactuur': {
    nl: 'Nee, gewone factuur — doorgaan',
    ar: 'لا، فاتورة عادية — تابع',
    en: 'No, ordinary invoice — continue',
  },
  'ink.neeNogNiet': {
    nl: 'Nee, nog niet betaald',
    ar: 'لا، لم أدفع بعد',
    en: 'No, not paid yet',
  },
  'ink.negeren.bevestig': {
    nl: 'Ja, negeer',
    ar: 'نعم، تجاهل',
    en: 'Yes, ignore',
  },
  'ink.negeren.uitleg': {
    nl: 'De factuur wordt verplaatst naar Genegeerd. Je kunt hem later terugzetten.',
    ar: 'ستُنقل الفاتورة إلى المتجاهَل. يمكنك إرجاعها لاحقًا.',
    en: 'The invoice is moved to Ignored. You can restore it later.',
  },
  'ink.negeren.waarom': {
    nl: 'Waarom? (optioneel)',
    ar: 'لماذا؟ (اختياري)',
    en: 'Why? (optional)',
  },
  'ink.nFacturen': {
    nl: '{n} facturen',
    ar: '{n} فاتورة',
    en: '{n} invoices',
  },
  'ink.nFactuur': {
    nl: '1 factuur',
    ar: 'فاتورة واحدة',
    en: '1 invoice',
  },
  'ink.nietGelukt': {
    nl: 'Niet gelukt',
    ar: 'لم ينجح',
    en: 'Did not work',
  },
  'ink.nietsNieuws': {
    nl: 'Niets nieuws gevonden',
    ar: 'لم يُعثر على جديد',
    en: 'Nothing new found',
  },
  'ink.nietsTeMatchen': {
    nl: 'Niets om te matchen',
    ar: 'لا شيء للمطابقة',
    en: 'Nothing to match',
  },
  'ink.nogDagen': {
    nl: 'nog {n} dagen',
    ar: 'الأيام المتبقية: {n}',
    en: '{n} days left',
  },
  'ink.nogEenDag': {
    nl: 'nog 1 dag',
    ar: 'بقي يوم واحد',
    en: '1 day left',
  },
  'ink.nogInRij': {
    nl: 'Er stonden er nog {n} in de rij. Draai het nog een keer om die ook na te rekenen.',
    ar: 'بقي في قائمة الانتظار {n}. شغّله مرة أخرى لإعادة حسابها أيضًا.',
    en: 'There were {n} more in the queue. Run it again to recheck those too.',
  },
  'ink.nogOpen': {
    nl: 'nog {amount} open',
    ar: 'المتبقي {amount}',
    en: '{amount} still open',
  },
  'ink.nogOpenstaandKies': {
    nl: 'Nog openstaand: {amount} — kies hieronder hoe je dit deel betaalde',
    ar: 'المتبقي: {amount} — اختر أدناه كيف دفعت هذا الجزء',
    en: 'Still open: {amount} — choose below how you paid this part',
  },
  'ink.nogTeBetalen': {
    nl: 'nog te betalen',
    ar: 'ما زال مستحقًا',
    en: 'still to pay',
  },
  'ink.oauth.mislukt': {
    nl: 'Verbinding mislukt — probeer opnieuw',
    ar: 'فشل الربط — حاول مرة أخرى',
    en: 'Connecting failed — please try again',
  },
  'ink.oauth.verbonden': {
    nl: '{provider} succesvol verbonden!',
    ar: 'رُبط {provider} بنجاح!',
    en: '{provider} connected successfully!',
  },
  'ink.omboekenMislukt': {
    nl: 'Omboeken mislukt — er is niets gewijzigd',
    ar: 'فشلت إعادة القيد — لم يتغيّر شيء',
    en: 'Rebooking failed — nothing was changed',
  },
  'ink.onbekendeAfzender': {
    nl: 'Onbekende afzender',
    ar: 'مُرسِل غير معروف',
    en: 'Unknown sender',
  },
  'ink.onbekendeLeverancier': {
    nl: 'Onbekende leverancier',
    ar: 'مورّد غير معروف',
    en: 'Unknown supplier',
  },
  'ink.ongedaanMaken': {
    nl: 'Ongedaan maken',
    ar: 'تراجع',
    en: 'Undo',
  },
  'ink.ongedaanVraag': {
    nl: 'Betaling ongedaan maken?',
    ar: 'التراجع عن الدفعة؟',
    en: 'Undo the payment?',
  },
  'ink.ontbreekt.een': {
    nl: 'Er lijkt een factuur te ontbreken',
    ar: 'يبدو أن ثمة فاتورة ناقصة',
    en: 'An invoice seems to be missing',
  },
  // [BETAALD-GEEN-STUK] De waarneming: het geld is weg en er hangt geen factuur aan. De zin
  // beweert NIET dat de factuur niet bestaat — hij kan ongelezen in de mailbox zitten. Wat we
  // weten is dat er niets aan gekoppeld is, en dat is wat er staat.
  'ink.betaaldGeenStuk.een': {
    nl: 'Er is 1 betaling aan een bekende leverancier zonder factuur',
    ar: 'هناك دفعة واحدة إلى مورّد معروف بلا فاتورة',
    en: 'There is 1 payment to a known supplier with no invoice',
  },
  'ink.betaaldGeenStuk.meer': {
    nl: 'Er zijn {n} betalingen aan bekende leveranciers zonder factuur',
    ar: 'هناك {n} دفعات إلى مورّدين معروفين بلا فاتورة',
    en: 'There are {n} payments to known suppliers with no invoice',
  },
  'ink.betaaldGeenStuk.regel': {
    nl: '{bedrag} betaald aan {leverancier} — er is geen factuur aan gekoppeld',
    ar: 'دُفع {bedrag} إلى {leverancier} — لا توجد فاتورة مرتبطة به',
    en: '{bedrag} paid to {leverancier} — no invoice is linked to it',
  },
  'ink.ontbreekt.meer': {
    nl: 'Er lijken {n} facturen te ontbreken',
    ar: 'يبدو أن ثمة {n} فاتورة ناقصة',
    en: '{n} invoices seem to be missing',
  },
  'ink.onzeker.datum': {
    nl: 'de factuurdatum',
    ar: 'تاريخ الفاتورة',
    en: 'the invoice date',
  },
  'ink.onzeker.leverancier': {
    nl: 'de leverancier',
    ar: 'المورّد',
    en: 'the supplier',
  },
  'ink.onzeker.nummer': {
    nl: 'het factuurnummer',
    ar: 'رقم الفاتورة',
    en: 'the invoice number',
  },
  'ink.onzeker.zin': {
    nl: 'De AI was niet zeker over {velden}. Controleer en pas aan waar nodig.',
    ar: 'لم يكن الذكاء الاصطناعي متأكّدًا من هذه الحقول: {velden}. تحقّق وعدّل حيث يلزم.',
    en: 'The AI was not sure about {velden}. Check and adjust where needed.',
  },
  'ink.onzekerEen': {
    nl: '1 betaling is gevonden maar te onzeker om zelf te boeken — die bevestig je zelf.',
    ar: 'وُجدت دفعة واحدة لكنها أشد غموضًا من أن تُسجَّل تلقائيًا — تؤكدها بنفسك.',
    en: '1 payment was found but too uncertain to book by itself — you confirm that one yourself.',
  },
  'ink.onzekerN': {
    nl: '{n} betalingen zijn gevonden maar te onzeker om zelf te boeken — die bevestig je zelf.',
    ar: 'وُجدت {n} دفعة لكنها أشد غموضًا من أن تُسجَّل تلقائيًا — تؤكدها بنفسك.',
    en: '{n} payments were found but too uncertain to book by themselves — you confirm those yourself.',
  },
  'ink.opBetaaldGezetEen': {
    nl: '1 factuur op betaald gezet',
    ar: 'وُضعت فاتورة واحدة كمدفوعة',
    en: '1 invoice set to paid',
  },
  'ink.opBetaaldGezetN': {
    nl: '{n} facturen op betaald gezet',
    ar: 'وُضعت {n} فاتورة كمدفوعة',
    en: '{n} invoices set to paid',
  },
  'ink.opgeslagenIn': {
    nl: 'Opgeslagen in',
    ar: 'محفوظ في',
    en: 'Stored in',
  },
  'ink.opnieuwInlezenKnop': {
    nl: 'Opnieuw inlezen',
    ar: 'إعادة القراءة',
    en: 'Re-read',
  },
  // [TAAL] De zin boven de knop, uit reimport-eligibility.ts. Twee sleutels en geen parameter: de
  // bevestigde factuur verhuist naar de controlewachtrij en dat moet VÓÓR de tik gezegd worden —
  // een factuur die van de betaallijst verdwijnt zonder aankondiging leest als een kwijtgeraakte
  // rekening. De wachtrijfactuur blijft waar hij is, en die zin zegt dat niet, want het is niet zo.
  'ink.opnieuwInlezenNaarWachtrij': {
    nl: 'Klopt er iets niet aan deze factuur? Laat hem opnieuw inlezen — hij gaat dan terug naar de controlewachtrij zodat je de nieuwe bedragen bevestigt.',
    ar: 'هل في هذه الفاتورة خطأ؟ أعِد قراءتها — ستعود عندها إلى قائمة المراجعة لتؤكّد المبالغ الجديدة.',
    en: 'Something wrong on this invoice? Have it read again — it then goes back to the review queue so you can confirm the new amounts.',
  },
  'ink.opnieuwInlezenBlijft': {
    nl: 'Klopt er iets niet aan deze factuur? Laat hem opnieuw inlezen.',
    ar: 'هل في هذه الفاتورة خطأ؟ أعِد قراءتها.',
    en: 'Something wrong on this invoice? Have it read again.',
  },
  'ink.opnieuwInlezenMislukt': {
    nl: 'Opnieuw inlezen is niet gelukt — probeer het later opnieuw.',
    ar: 'فشلت إعادة القراءة — حاول لاحقًا مرة أخرى.',
    en: 'Re-reading did not work — try again later.',
  },
  'ink.optioneel': {
    nl: '(optioneel)',
    ar: '(اختياري)',
    en: '(optional)',
  },
  'ink.origineel.alAanwezig': {
    nl: 'Deze factuur heeft al een origineel — ververs de pagina.',
    ar: 'لهذه الفاتورة مستند أصلي بالفعل — أعد تحميل الصفحة.',
    en: 'This invoice already has an original — refresh the page.',
  },
  'ink.origineel.bestaatNiet': {
    nl: 'Deze factuur bestaat niet meer.',
    ar: 'هذه الفاتورة لم تعد موجودة.',
    en: 'This invoice no longer exists.',
  },
  'ink.origineel.bestandstype': {
    nl: 'Dit bestandstype kan niet: stuur een PDF of een foto (JPG, PNG).',
    ar: 'نوع الملف هذا غير مقبول: أرسل PDF أو صورة (JPG، PNG).',
    en: 'This file type is not supported: send a PDF or a photo (JPG, PNG).',
  },
  'ink.origineel.mislukt': {
    nl: 'Toevoegen is niet gelukt — probeer het nog een keer.',
    ar: 'فشلت الإضافة — حاول مرة أخرى.',
    en: 'Adding did not work — try once more.',
  },
  'ink.origineel.teGroot': {
    nl: 'Het bestand is te groot (maximaal 20 MB).',
    ar: 'الملف كبير جدًا (الحد الأقصى 20 MB).',
    en: 'The file is too large (20 MB at most).',
  },
  'ink.origineelToevoegen': {
    nl: 'Origineel toevoegen',
    ar: 'إضافة المستند الأصلي',
    en: 'Add the original',
  },
  'ink.papier.bank': {
    nl: 'dit is met de bank betaald en wordt tegen je bankregel gelegd.',
    ar: 'هذا مدفوع عبر البنك وسيُطابَق مع سطر البنك لديك.',
    en: 'this was paid by bank and will be matched against your bank line.',
  },
  'ink.papier.bankpas': {
    nl: 'bankpas',
    ar: 'بطاقة بنكية',
    en: 'bank card',
  },
  'ink.papier.contant': {
    nl: 'contant',
    ar: 'نقدًا',
    en: 'cash',
  },
  'ink.papier.kas': {
    nl: 'dit is contant betaald en gaat naar je kasboek.',
    ar: 'هذا مدفوع نقدًا وسيذهب إلى دفتر النقد.',
    en: 'this was paid in cash and goes to your cash book.',
  },
  'ink.papier.kloptNiet': {
    nl: 'Klopt dat niet? Kies dan het andere.',
    ar: 'أليس ذلك صحيحًا؟ اختر الآخر إذن.',
    en: 'Not right? Then pick the other one.',
  },
  'ink.papier.pas': {
    nl: '(pas ••••{cijfers})',
    ar: '(بطاقة ••••{cijfers})',
    en: '(card ••••{cijfers})',
  },
  'ink.qrMislukt': {
    nl: 'QR kon niet worden gegenereerd',
    ar: 'تعذّر توليد رمز QR',
    en: 'The QR could not be generated',
  },
  'ink.regels.aanbod': {
    nl: 'Bijlagen van {email} voortaan overslaan? De e-mails blijven in je mailbox; de regel hef je bij Genegeerd weer op.',
    ar: 'تخطّي مرفقات {email} من الآن؟ تبقى الرسائل في بريدك؛ وتلغي القاعدة من «المتجاهَل».',
    en: 'Skip attachments from {email} from now on? The e-mails stay in your mailbox; you lift the rule again under Ignored.',
  },
  'ink.regels.aanbodBevestig': {
    nl: 'Ja, altijd overslaan',
    ar: 'نعم، تخطَّ دائمًا',
    en: 'Yes, always skip',
  },
  'ink.regels.foutLaden': {
    nl: 'Afzenderregels konden niet worden geladen — ververs de pagina',
    ar: 'تعذّر تحميل قواعد المُرسِلين — أعد تحميل الصفحة',
    en: 'Sender rules could not be loaded — refresh the page',
  },
  'ink.regels.foutLezen': {
    nl: 'We konden je regels niet lezen — probeer het zo opnieuw.',
    ar: 'لم نستطع قراءة قواعدك — حاول بعد قليل.',
    en: 'We could not read your rules — try again in a moment.',
  },
  'ink.regels.ingesteld': {
    nl: 'Post van {email} wordt voortaan overgeslagen',
    ar: 'سيُتخطى بريد {email} من الآن',
    en: 'Mail from {email} will be skipped from now on',
  },
  'ink.regels.ingesteldZonder': {
    nl: 'Post van deze afzender wordt voortaan overgeslagen',
    ar: 'سيُتخطى بريد هذا المُرسِل من الآن',
    en: 'Mail from this sender will be skipped from now on',
  },
  'ink.regels.instellenMislukt': {
    nl: 'Regel instellen mislukt — probeer het opnieuw',
    ar: 'فشل ضبط القاعدة — حاول مرة أخرى',
    en: 'Setting the rule failed — please try again',
  },
  'ink.regels.instellenVerbinding': {
    nl: 'Regel instellen mislukt — controleer je verbinding',
    ar: 'فشل ضبط القاعدة — تحقّق من اتصالك',
    en: 'Setting the rule failed — check your connection',
  },
  'ink.regels.opgeheven': {
    nl: 'Post van {email} komt weer binnen',
    ar: 'سيصل بريد {email} من جديد',
    en: 'Mail from {email} arrives again',
  },
  'ink.regels.opheffenMislukt': {
    nl: 'Regel opheffen mislukt — probeer het opnieuw',
    ar: 'فشل إلغاء القاعدة — حاول مرة أخرى',
    en: 'Removing the rule failed — please try again',
  },
  'ink.regels.opheffenVerbinding': {
    nl: 'Regel opheffen mislukt — controleer je verbinding',
    ar: 'فشل إلغاء القاعدة — تحقّق من اتصالك',
    en: 'Removing the rule failed — check your connection',
  },
  'ink.regels.uitleg': {
    nl: 'Bijlagen van deze adressen slaan we over; de e-mails blijven in je mailbox. Zie “Overgeslagen bij import”.',
    ar: 'مرفقات هذه العناوين نتخطّاها؛ والرسائل تبقى في بريدك. انظر «ما تُخطّي أثناء الاستيراد».',
    en: 'Attachments from these addresses we skip; the e-mails stay in your mailbox. See “Skipped during import”.',
  },
  'ink.rekenBoekenNa': {
    nl: 'Reken mijn boeken na',
    ar: 'مراجعة دفاتري',
    en: 'Recheck my books',
  },
  'ink.reread.fout': {
    nl: 'Dat lukte niet — probeer het zo meteen opnieuw.',
    ar: 'لم ينجح ذلك — حاول بعد قليل.',
    en: 'That did not work — try again in a moment.',
  },
  'ink.reread.foutVerbinding': {
    nl: 'Dat lukte niet — controleer je verbinding en probeer het opnieuw.',
    ar: 'لم ينجح ذلك — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'That did not work — check your connection and try again.',
  },
  'ink.reread.kap': {
    nl: 'Dit zijn de {n} nieuwste van {totaal}. De rest vind je bij je bestanden.',
    ar: 'هذه أحدث {n} من أصل {totaal}. الباقي تجده في ملفاتك.',
    en: 'These are the {n} newest of {totaal}. The rest is in your files.',
  },
  'ink.skipped.kap': {
    nl: 'Dit zijn de {n} nieuwste van {totaal} overgeslagen bijlagen.',
    ar: 'هذه أحدث {n} من أصل {totaal} مرفقًا متخطًّى.',
    en: 'These are the {n} newest of {totaal} skipped attachments.',
  },
  'ink.reread.klaar': {
    nl: 'Klaar.',
    ar: 'تم.',
    en: 'Done.',
  },
  'ink.reread.knop': {
    nl: 'Lees opnieuw',
    ar: 'إعادة القراءة',
    en: 'Read again',
  },
  'ink.herinnering.uitleg': {
    nl: 'Herinneringen voor facturen die niet in je boekhouding staan. Vraag de factuur op, of boek de herinnering als factuur.',
    ar: 'تذكيرات بفواتير غير موجودة في دفاترك. اطلب الفاتورة، أو قيّد التذكير كفاتورة.',
    en: 'Reminders for invoices that are not in your books. Ask for the invoice, or book the reminder as the invoice.',
  },
  'ink.herinnering.knop': {
    nl: 'Boek als factuur',
    ar: 'تسجيل كفاتورة',
    en: 'Book as invoice',
  },
  'ink.reread.uitleg': {
    nl: 'Toen onleesbaar, nu misschien niet meer. Probeer opnieuw — niets verandert tot jij het in de wachtrij bevestigt.',
    ar: 'كانت غير مقروءة حينها، وربما لم تعد كذلك. جرّب مجددًا — لا يتغيّر شيء حتى تؤكّده في قائمة الانتظار.',
    en: 'Unreadable then, perhaps not any more. Try again — nothing changes until you confirm it in the queue.',
  },
  'ink.result.auto': {
    nl: 'Automatisch verwerkt',
    ar: 'عولجت تلقائيًا',
    en: 'Processed automatically',
  },
  'ink.result.bank': {
    nl: 'Bankafschrift',
    ar: 'كشف بنكي',
    en: 'Bank statement',
  },
  'ink.result.document': {
    nl: 'In je bestanden',
    ar: 'في ملفاتك',
    en: 'In your files',
  },
  // [BATCH-HERKANSING] A failed file in a batch used to be final — the outcome said "probeer het
  // zo opnieuw" and there was nothing to press. These are the words for the second attempt.
  'ink.result.skipped': {
    nl: 'Niet verstuurd',
    ar: 'لم يُرسَل',
    en: 'Not sent',
  },
  'ink.result.buitenBatch': {
    nl: 'Er kunnen er {max} tegelijk. De rest is nog niet verstuurd — voeg dit bestand er zo bij.',
    ar: 'يمكن إرسال {max} في المرة. البقية لم تُرسل بعد — أضف هذا الملف بعد قليل.',
    en: '{max} can go at a time. The rest were not sent yet — add this file in a moment.',
  },
  'ink.result.opnieuw': {
    nl: 'Opnieuw proberen',
    ar: 'إعادة المحاولة',
    en: 'Try again',
  },
  'ink.result.alleOpnieuwEen': {
    nl: 'Probeer dit bestand opnieuw',
    ar: 'إعادة محاولة هذا الملف',
    en: 'Try this file again',
  },
  'ink.result.alleOpnieuwMeer': {
    nl: 'Probeer deze {n} bestanden opnieuw',
    ar: 'إعادة محاولة هذه الملفات ({n})',
    en: 'Try these {n} files again',
  },
  'ink.result.tochToevoegen': {
    nl: 'Toch toevoegen',
    ar: 'أضفها على أي حال',
    en: 'Add it anyway',
  },
  'ink.result.duplicate': {
    nl: 'Al toegevoegd',
    ar: 'أُضيف مسبقًا',
    en: 'Already added',
  },
  'ink.result.eenToegevoegd': {
    nl: '1 bestand toegevoegd',
    ar: 'أُضيف ملف واحد',
    en: '1 file added',
  },
  'ink.result.error': {
    nl: 'Niet gelukt',
    ar: 'لم ينجح',
    en: 'Did not work',
  },
  'ink.result.gebeurdEen': {
    nl: 'Dit is er met je bestand gebeurd:',
    ar: 'هذا ما حدث لملفك:',
    en: 'This is what happened to your file:',
  },
  'ink.result.gebeurdMeer': {
    nl: 'Dit is er met je bestanden gebeurd:',
    ar: 'هذا ما حدث لملفاتك:',
    en: 'This is what happened to your files:',
  },
  'ink.result.invoice': {
    nl: 'Wacht op je controle',
    ar: 'بانتظار تدقيقك',
    en: 'Awaiting your check',
  },
  'ink.result.ledger': {
    nl: 'Controle-check',
    ar: 'فحص مراجعة',
    en: 'Control check',
  },
  'ink.result.meerToegevoegd': {
    nl: '{n} bestanden toegevoegd',
    ar: 'عدد الملفات المضافة: {n}',
    en: '{n} files added',
  },
  'ink.result.naarInkoop': {
    nl: 'Naar Inkoopfacturen',
    ar: 'إلى «فواتير المشتريات»',
    en: 'To purchase invoices',
  },
  'ink.result.naarBank': {
    nl: 'Naar de bankpagina',
    ar: 'إلى صفحة البنك',
    en: 'To the bank page',
  },
  'ink.result.statement': {
    nl: 'Rekeningoverzicht gecontroleerd',
    ar: 'رُوجع كشف الحساب',
    en: 'Account statement checked',
  },
  'ink.result.reminder': {
    nl: 'Herinnering bewaard, niet geboekt',
    ar: 'حُفظ التذكير ولم يُقيَّد',
    en: 'Reminder filed, not booked',
  },
  'ink.result.turnover': {
    nl: 'Omzet geboekt',
    ar: 'سُجّل الإيراد',
    en: 'Revenue booked',
  },
  'ink.scan.alleenLijst': {
    nl: 'Gecontroleerd: de {n} facturen op dit scherm — je oudere betaalde facturen konden we nu niet nakijken.',
    ar: 'تم الفحص: الفواتير على هذه الشاشة وعددها {n} — تعذّر الآن فحص فواتيرك المدفوعة الأقدم.',
    en: 'Checked: the {n} invoices on this screen — we could not check your older paid invoices just now.',
  },
  'ink.scan.alleenLijstEen': {
    nl: 'Gecontroleerd: de 1 factuur op dit scherm — je oudere betaalde facturen konden we nu niet nakijken.',
    ar: 'تم الفحص: الفاتورة الواحدة على هذه الشاشة — تعذّر الآن فحص فواتيرك المدفوعة الأقدم.',
    en: 'Checked: the 1 invoice on this screen — we could not check your older paid invoices just now.',
  },
  'ink.scan.buitenLijst': {
    nl: '{n} ervan vallen buiten deze lijst (betaald, ouder dan de laatste 200) — zoek op factuurnummer of leverancier.',
    ar: '{n} منها خارج هذه القائمة (مدفوعة، أقدم من آخر 200) — ابحث برقم الفاتورة أو المورّد.',
    en: '{n} of them fall outside this list (paid, older than the latest 200) — search by invoice number or supplier.',
  },
  'ink.scan.buitenLijstEen': {
    nl: 'Eén ervan valt buiten deze lijst (betaald, ouder dan de laatste 200) — zoek op factuurnummer of leverancier.',
    ar: 'واحدة منها خارج هذه القائمة (مدفوعة، أقدم من آخر 200) — ابحث برقم الفاتورة أو المورّد.',
    en: 'One of them falls outside this list (paid, older than the latest 200) — search by invoice number or supplier.',
  },
  'ink.scan.heelBoek': {
    nl: 'Gecontroleerd: al je {n} bevestigde inkoopfacturen.',
    ar: 'تم الفحص: كل فواتير مشترياتك المؤكَّدة وعددها {n}.',
    en: 'Checked: all {n} of your confirmed purchase invoices.',
  },
  'ink.scan.kloppenNiet': {
    nl: '{n} geboekte facturen kloppen niet',
    ar: '{n} فاتورة مقيّدة غير صحيحة',
    en: '{n} booked invoices are wrong',
  },
  'ink.scan.kloptNietEen': {
    nl: '1 geboekte factuur klopt niet',
    ar: 'فاتورة مقيّدة واحدة غير صحيحة',
    en: '1 booked invoice is wrong',
  },
  'ink.scan.teltMee': {
    nl: 'Deze tellen nu mee in je openstaande saldo en in de btw die je terugvraagt.',
    ar: 'هذه تُحتسب الآن في رصيدك المفتوح وفي الضريبة التي تستردها.',
    en: 'These currently count in your outstanding balance and in the btw you reclaim.',
  },
  'ink.papierErbij': {
    nl: 'Factuur bekijken',
    ar: 'عرض الفاتورة',
    en: 'View the invoice',
    tr: 'Faturayı görüntüle',
  },
  'ink.scanBankapp': {
    nl: 'Scan met je bankapp of kopieer de gegevens. Je betaalt in je eigen bank.',
    ar: 'امسح بتطبيق بنكك أو انسخ البيانات. الدفع يتم في بنكك أنت.',
    en: 'Scan with your banking app or copy the details. You pay inside your own bank.',
  },
  'ink.schrijftAf': {
    nl: '{name} schrijft automatisch af',
    ar: '{name} يخصم تلقائياً',
    en: '{name} collects automatically',
  },
  'ink.schrijftVoortaanAf': {
    nl: '{name} schrijft voortaan zelf af',
    ar: '{name} سيجري الخصم بنفسه من الآن فصاعدًا',
    en: '{name} now collects by itself',
  },
  'ink.selecteerKlaar': {
    nl: 'Selecteer klaar ({n})',
    ar: 'تحديد الجاهزة ({n})',
    en: 'Select ready ({n})',
  },
  'ink.sessieVerlopen': {
    nl: 'Sessie verlopen — log opnieuw in',
    ar: 'انتهت الجلسة — سجّل الدخول من جديد',
    en: 'Session expired — log in again',
  },
  'ink.skipped.fout': {
    nl: 'Lijst niet opgehaald; dat zegt niets over wat is overgeslagen. Probeer zo opnieuw.',
    ar: 'لم تُجلب القائمة؛ وهذا لا يقول شيئًا عمّا تم تخطّيه. حاول بعد قليل.',
    en: 'List not fetched; that says nothing about what was skipped. Try again shortly.',
  },
  'ink.standNietOpgehaald': {
    nl: 'De stand kon niet worden opgehaald — we weten niet of er nog open banktransacties zijn.',
    ar: 'تعذّر جلب الحالة — لا نعرف إن كانت لا تزال هناك حركات بنكية مفتوحة.',
    en: 'The state could not be fetched — we do not know whether open bank transactions remain.',
  },
  'ink.sync.bezig': {
    nl: 'Bezig met importeren… {n} opgeslagen, nog ~{rest} te gaan',
    ar: 'جارٍ الاستيراد… حُفظ {n}، بقي نحو {rest}',
    en: 'Importing… {n} saved, ~{rest} to go',
  },
  'ink.sync.controleren': {
    nl: '{n} geïmporteerd — we controleren nog een paar items',
    ar: 'استُورد {n} — ما زلنا نتحقق من بضعة عناصر',
    en: '{n} imported — we are still checking a few items',
  },
  'ink.sync.deelOpgeslagen': {
    nl: '{n} opgeslagen — de rest kon nu niet verwerkt worden, probeer later opnieuw',
    ar: 'حُفظ {n} — تعذّرت معالجة الباقي الآن، حاول لاحقًا',
    en: '{n} saved — the rest could not be processed now, try again later',
  },
  'ink.sync.foutPrefix': {
    nl: 'Fout:',
    ar: 'خطأ:',
    en: 'Error:',
  },
  'ink.sync.knop': {
    nl: 'Synchroniseer',
    ar: 'مزامنة',
    en: 'Synchronise',
  },
  'ink.sync.meerKlaar': {
    nl: '{n} opgeslagen — er staan er nog meer klaar, synchroniseer opnieuw',
    ar: 'حُفظ {n} — ما زال المزيد بانتظارك، أعد المزامنة',
    en: '{n} saved — more are waiting, synchronise again',
  },
  'ink.sync.mislukt': {
    nl: 'Sync mislukt — probeer opnieuw',
    ar: 'فشلت المزامنة — حاول مرة أخرى',
    en: 'Sync failed — please try again',
  },
  'ink.sync.nietLezenEen': {
    nl: '1 bestand konden we niet lezen; het staat in je bestanden, controleer het even.',
    ar: 'ملف واحد لم نستطع قراءته؛ إنه في ملفاتك، تحقّق منه.',
    en: '1 file we could not read; it is in your files, take a quick look.',
  },
  'ink.sync.nietLezenMeer': {
    nl: '{n} bestanden konden we niet lezen — ze staan in je bestanden, controleer ze even.',
    ar: 'تعذّرت قراءة {n} ملفًا — إنها في ملفاتك، تحقّق منها.',
    en: '{n} files we could not read — they are in your files, take a quick look.',
  },
  // [ARCHIEF-OPEN] Een kassa- of grootboekbestand kwam per e-mail binnen, is HERKEND en bewaard,
  // en wacht op één druk op de knop. Bewust een andere zin dan 'nietLezen…': daar staat "we konden
  // het niet lezen", hier staat "we hebben het gelezen en er is niets mee misgegaan". Een
  // ondernemer die dat door elkaar haalt, gaat een bestand controleren dat niets mankeert — of erger,
  // laat een dagafsluiting liggen omdat hij denkt dat er iets kapot is.
  // De zin noemt de knop zoals hij op het scherm staat ("Boek opnieuw", op Uploaden), zodat er
  // in geen enkele taal naar een woord gezocht wordt dat nergens in de app voorkomt.
  'ink.sync.kassaKlaarEen': {
    nl: '1 kassa- of grootboekbestand is bewaard — boek het met "Boek opnieuw" bij Uploaden.',
    ar: 'تم حفظ ملف واحد للصندوق أو دفتر الأستاذ — سجّله عبر "Boek opnieuw" في صفحة Uploaden.',
    en: '1 till or ledger file was kept — book it with "Boek opnieuw" on Uploaden.',
  },
  'ink.sync.kassaKlaarMeer': {
    nl: '{n} kassa- of grootboekbestanden zijn bewaard — boek ze met "Boek opnieuw" bij Uploaden.',
    ar: 'تم حفظ {n} من ملفات الصندوق أو دفتر الأستاذ — سجّلها عبر "Boek opnieuw" في صفحة Uploaden.',
    en: '{n} till or ledger files were kept — book them with "Boek opnieuw" on Uploaden.',
  },
  'ink.sync.nietsVerwerkt': {
    nl: 'Er kon nu niets verwerkt worden — probeer het later opnieuw',
    ar: 'تعذّرت المعالجة الآن — حاول لاحقًا',
    en: 'Nothing could be processed right now — try again later',
  },
  'ink.sync.onderbroken': {
    nl: '{n} opgeslagen — verbinding onderbroken, synchroniseer opnieuw voor de rest',
    ar: 'حُفظ {n} — انقطع الاتصال، أعد المزامنة للباقي',
    en: '{n} saved — connection interrupted, synchronise again for the rest',
  },
  'ink.sync.opnieuwGeprobeerd': {
    nl: '{n} geïmporteerd. {fouten} worden zo opnieuw geprobeerd.',
    ar: 'استُورد {n}. ستُعاد محاولة {fouten} بعد قليل.',
    en: '{n} imported. {fouten} will be retried shortly.',
  },
  'ink.sync.verwerkt': {
    nl: '{n} geïmporteerd. Alles is verwerkt.',
    ar: 'استُورد {n}. عولج كل شيء.',
    en: '{n} imported. Everything processed.',
  },
  'ink.sync.verwerktExtra': {
    nl: '{n} geïmporteerd. Alles is verwerkt ({extra} overgeslagen of al aanwezig).',
    ar: 'استُورد {n}. عولج كل شيء (المتخطى أو الموجود مسبقًا: {extra}).',
    en: '{n} imported. Everything processed ({extra} skipped or already present).',
  },
  'ink.tab.bevestigd': {
    nl: 'Bevestigd',
    ar: 'مؤكَّد',
    en: 'Confirmed',
  },
  'ink.tab.teBevestigen': {
    nl: 'Te bevestigen',
    ar: 'بانتظار التأكيد',
    en: 'To confirm',
  },
  'ink.teLaat': {
    nl: '{n} dagen te laat',
    ar: 'أيام التأخر: {n}',
    en: '{n} days late',
  },
  'ink.teLaatEen': {
    nl: '1 dag te laat',
    ar: 'متأخرة يومًا واحدًا',
    en: '1 day late',
  },
  'ink.telling': {
    nl: '{facturen} · {open} te betalen · {paid} betaald',
    ar: '{facturen} · مستحقة الدفع: {open} · مدفوعة: {paid}',
    en: '{facturen} · {open} to pay · {paid} paid',
  },
  // [AUTO-UITLEG] The same line when the list is a window on a larger archive (the paid query
  // stops at 200): the total in three words, where a whole sentence used to say it.
  'ink.tellingVan': {
    nl: '{facturen} van {total} · {open} te betalen · {paid} betaald',
    ar: '{facturen} من أصل {total} · مستحقة الدفع: {open} · مدفوعة: {paid}',
    en: '{facturen} of {total} · {open} to pay · {paid} paid',
  },
  // [AUTO-UITLEG] What the badges the app awards on its own judgement mean, said once above the
  // list (BadgeLegend). The badge's own label is printed in front of each line from the badge's
  // own key, so these hold the explanation only. They stand AT REST, so each is short by the
  // standard in docs/RUSTIG.md ([RUSTIG] counts): what the app did, on what ground, and what the
  // owner still does. The checks themselves are on every card ([CONTROLES-INKLAPPEN]); the two
  // claims a retranslation may never soften are "niets is betaald" and "vóór je betaalt".
  // The Arabic is the owner's own wording, verbatim; Dutch and English say the same thing.
  'ink.autoUitleg': {
    nl: 'De app las deze factuur en voegde hem automatisch toe nadat de controles slaagden. Controleer de gegevens vóór je betaalt.',
    ar: 'قرأ التطبيق هذه الفاتورة وأضافها تلقائيًا بعد اجتياز الفحوصات الآلية. يُرجى التحقق من المعلومات قبل الدفع.',
    en: 'The app read this invoice and added it automatically after its checks passed. Please check the details before paying.',
  },
  'ink.bonAutoUitleg': {
    nl: 'De app boekte deze bon zelf als betaald: de bon noemt de betaalwijze. Klopt het niet? Zet de betaling terug.',
    ar: 'سجّل التطبيق هذا الإيصال كمدفوع تلقائيًا: الإيصال يذكر طريقة الدفع. أليس صحيحًا؟ تراجع عن الدفعة.',
    en: 'The app booked this receipt as paid itself: the receipt names the payment method. Not right? Undo the payment.',
  },
  'ink.terugdraaien': {
    nl: 'Terugdraaien',
    ar: 'التراجع عن العملية',
    en: 'Revert',
  },
  'ink.teruggeplaatst': {
    nl: 'Inkoopfactuur {number} wordt teruggeplaatst naar \'Te betalen\' en elke genoteerde betaling erop wordt gewist.',
    ar: 'ستُعاد فاتورة المشتريات {number} إلى «Te betalen» وستُحذف كل دفعة مسجَّلة عليها.',
    en: 'Purchase invoice {number} is put back to \'Te betalen\' and every noted payment on it is erased.',
  },
  'ink.teruggezetToast': {
    nl: 'Factuur teruggezet',
    ar: 'أُرجعت الفاتورة',
    en: 'Invoice restored',
  },
  'ink.terugNaarWachtrij': {
    nl: 'Opnieuw ingelezen. De factuur staat nu in de controlewachtrij — bevestig daar de nieuwe bedragen.',
    ar: 'أُعيدت قراءتها. الفاتورة الآن في قائمة المراجعة — أكّد المبالغ الجديدة هناك.',
    en: 'Re-read. The invoice is now in the verification queue — confirm the new amounts there.',
  },
  'ink.terugNietGelukt': {
    nl: '{n} teruggedraaid ✓ — niet gelukt · {reasons}',
    ar: 'تم التراجع عن {n} ✓ — لم ينجح · {reasons}',
    en: '{n} reverted ✓ — failed · {reasons}',
  },
  'ink.teVaakGematcht': {
    nl: 'Te vaak gematcht — probeer het straks opnieuw',
    ar: 'جرت المطابقة مرات كثيرة — حاول بعد قليل',
    en: 'Matched too often — try again in a while',
  },
  'ink.tochAfhandelen': {
    nl: 'Toch afhandelen',
    ar: 'متابعة رغم ذلك',
    en: 'Handle anyway',
  },
  'ink.tochNietBetaald': {
    nl: 'Toch niet betaald — verifieer',
    ar: 'لم تُدفع — تدقيق',
    en: 'Not paid after all — verify',
  },
  'ink.toewijzenMigratie': {
    nl: 'Toewijzen kan nog niet — de BTW-vrijstellingsmigratie staat nog niet op de database',
    ar: 'التخصيص غير ممكن بعد — ترحيل الإعفاء الضريبي لم يُطبَّق على قاعدة البيانات بعد',
    en: 'Assigning is not possible yet — the VAT-exemption migration is not on the database yet',
  },
  'ink.toewijzenMislukt': {
    nl: 'Toewijzen mislukt — er is niets gewijzigd',
    ar: 'فشل التخصيص — لم يتغيّر شيء',
    en: 'Assigning failed — nothing was changed',
  },
  'ink.toonAlle': {
    nl: 'Toon alle facturen',
    ar: 'عرض كل الفواتير',
    en: 'Show all invoices',
  },
  'ink.toonAlleenDeze': {
    nl: 'Toon alleen deze',
    ar: 'عرض هذه فقط',
    en: 'Show only these',
  },
  'ink.totaalLabel': {
    nl: 'totaal',
    ar: 'الإجمالي',
    en: 'total',
  },
  'ink.uiterlijk': {
    nl: 'uiterlijk {date}',
    ar: 'أقصاه {date}',
    en: 'by {date}',
  },
  'ink.upload.foto': {
    nl: 'Foto maken',
    ar: 'التقاط صورة',
    en: 'Take a photo',
  },
  'ink.upload.kies': {
    nl: 'Kies bestanden of sleep hier naartoe',
    ar: 'اختر ملفات أو اسحبها إلى هنا',
    en: 'Pick files or drag them here',
  },
  'ink.upload.mislukt': {
    nl: 'Upload mislukt — probeer opnieuw',
    ar: 'فشل الرفع — حاول مرة أخرى',
    en: 'Upload failed — please try again',
  },
  'ink.upload.misluktOpnieuw': {
    nl: 'Uploaden mislukt — probeer het opnieuw.',
    ar: 'فشل الرفع — حاول مرة أخرى.',
    en: 'Upload failed — please try again.',
  },
  'ink.upload.nietOndersteund': {
    nl: 'Niet ondersteund bestandstype',
    ar: 'نوع ملف غير مدعوم',
    en: 'Unsupported file type',
  },
  'ink.upload.toegevoegdKort': {
    nl: 'Toegevoegd',
    ar: 'أُضيف',
    en: 'Added',
  },
  'ink.upload.types': {
    nl: 'PDF, afbeelding of bankafschrift — meerdere tegelijk (max {max})',
    ar: 'PDF أو صورة أو كشف بنكي — عدة ملفات معًا (بحد أقصى {max})',
    en: 'PDF, image or bank statement — several at once (max {max})',
  },
  'ink.upload.verwerken': {
    nl: 'Verwerken…',
    ar: 'جارٍ المعالجة…',
    en: 'Processing…',
  },
  'ink.upload.voortgang': {
    nl: '{n} van {totaal} verwerkt…',
    ar: 'عولج {n} من {totaal}…',
    en: '{n} of {totaal} processed…',
  },
  'ink.uploadAfschrift': {
    nl: 'Upload een bankafschrift op de Bank-pagina, dan kan de matching zijn werk doen.',
    ar: 'ارفع كشفًا بنكيًا في صفحة البنك ليتسنّى للمطابقة أداء عملها.',
    en: 'Upload a bank statement on the Bank page, then the matching can do its work.',
  },
  'ink.vandaag': {
    nl: 'vandaag',
    ar: 'اليوم',
    en: 'today',
  },
  'ink.vanTelling': {
    nl: '{shown} van {facturen}',
    ar: '{shown} من {facturen}',
    en: '{shown} of {facturen}',
  },
  'ink.verifieren': {
    nl: 'Verifiëren',
    ar: 'تحقّق',
    en: 'Verify',
  },
  'ink.verplaatsenMislukt': {
    nl: 'Verplaatsen mislukt — er is niets gewijzigd',
    ar: 'فشل النقل — لم يتغيّر شيء',
    en: 'Moving failed — nothing was changed',
  },
  'ink.verplaatstNaarFactuur': {
    nl: '{amount} verplaatst naar factuur {number}',
    ar: 'نُقل {amount} إلى الفاتورة {number}',
    en: '{amount} moved to invoice {number}',
  },
  'ink.verplaatstNaarGekozen': {
    nl: '{amount} verplaatst naar de gekozen factuur',
    ar: 'نُقل {amount} إلى الفاتورة المختارة',
    en: '{amount} moved to the chosen invoice',
  },
  'ink.verplaatsUitleg': {
    nl: 'Van inkoopfactuur {number} naar de juiste factuur. Bedrag, betaaldatum en methode gaan ongewijzigd mee.',
    ar: 'من فاتورة المشتريات {number} إلى الفاتورة الصحيحة. ينتقل المبلغ وتاريخ الدفع والطريقة دون تغيير.',
    en: 'From purchase invoice {number} to the right invoice. Amount, payment date and method travel along unchanged.',
  },
  'ink.vervalIncasso': {
    nl: 'Vervaldatum {date} — automatische incasso',
    ar: 'تاريخ الاستحقاق {date} — خصم مباشر',
    en: 'Due date {date} — direct debit',
  },
  'ink.vervalNog': {
    nl: 'Vervaldatum {date} — {left}',
    ar: 'تاريخ الاستحقاق {date} — {left}',
    en: 'Due date {date} — {left}',
  },
  'ink.vervalTeLaat': {
    nl: 'Vervaldatum {date} — {late}',
    ar: 'تاريخ الاستحقاق {date} — {late}',
    en: 'Due date {date} — {late}',
  },
  'ink.vervalVandaag': {
    nl: 'Vervaldatum {date} — vandaag te betalen',
    ar: 'تاريخ الاستحقاق {date} — تُدفع اليوم',
    en: 'Due date {date} — to pay today',
  },
  'ink.vervang.bevestig': {
    nl: 'Ja, vervangen',
    ar: 'نعم، استبدل',
    en: 'Yes, replace',
  },
  'ink.vervang.foutVerbinding': {
    nl: 'Vervangen is niet gelukt. Controleer je verbinding en probeer het opnieuw.',
    ar: 'لم ينجح الاستبدال. تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Replacing did not work. Check your connection and try again.',
  },
  'ink.vervang.genegeerdMetNr': {
    nl: 'Factuur {nr} staat nu bij Genegeerd',
    ar: 'الفاتورة {nr} الآن في «المتجاهَل»',
    en: 'Invoice {nr} is now under Ignored',
  },
  'ink.vervang.genegeerdZonderNr': {
    nl: 'De oude factuur staat nu bij Genegeerd',
    ar: 'الفاتورة القديمة الآن في «المتجاهَل»',
    en: 'The old invoice is now under Ignored',
  },
  'ink.vervang.kanNiet': {
    nl: 'Vervangen kan nu niet',
    ar: 'لا يمكن الاستبدال الآن',
    en: 'Replacing is not possible right now',
  },
  'ink.vervang.knopMetNr': {
    nl: 'Deze vervangt factuur {nr}',
    ar: 'هذه تحلّ محل الفاتورة {nr}',
    en: 'This replaces invoice {nr}',
  },
  'ink.vervang.knopZonderNr': {
    nl: 'Deze vervangt de andere factuur',
    ar: 'هذه تحلّ محل الفاتورة الأخرى',
    en: 'This replaces the other invoice',
  },
  'ink.vervang.mislukt': {
    nl: 'Vervangen mislukt — ververs de pagina en probeer het opnieuw.',
    ar: 'فشل الاستبدال — أعد تحميل الصفحة وحاول مرة أخرى.',
    en: 'Replacing failed — refresh the page and try again.',
  },
  'ink.vervang.uitlegMetNr': {
    nl: 'Factuur {nr} gaat uit je lijst en telt niet meer mee in kosten en voorbelasting. Hij blijft bewaard (7 jaar bewaarplicht) onder Inkomend › Genegeerd.\n\nDeze factuur blijft in de wachtrij.',
    ar: 'الفاتورة {nr} تخرج من قائمتك ولا تُحتسب بعدها في المصاريف وضريبة المشتريات. تبقى محفوظة (واجب الحفظ 7 سنوات) تحت الوارد › المتجاهَل. هذه الفاتورة تبقى في قائمة الانتظار.',
    en: 'Invoice {nr} leaves your list and no longer counts in costs and input VAT. It stays stored (7-year retention duty) under Incoming › Ignored.\n\nThis invoice stays in the queue.',
  },
  'ink.vervang.uitlegZonderNr': {
    nl: 'De andere factuur gaat uit je lijst en telt niet meer mee in kosten en voorbelasting. Hij blijft bewaard (7 jaar bewaarplicht) onder Inkomend › Genegeerd.\n\nDeze factuur blijft in de wachtrij.',
    ar: 'الفاتورة الأخرى تخرج من قائمتك ولا تُحتسب بعدها في المصاريف وضريبة المشتريات. تبقى محفوظة (واجب الحفظ 7 سنوات) تحت الوارد › المتجاهَل. هذه الفاتورة تبقى في قائمة الانتظار.',
    en: 'The other invoice leaves your list and no longer counts in costs and input VAT. It stays stored (7-year retention duty) under Incoming › Ignored.\n\nThis invoice stays in the queue.',
  },
  'ink.vervang.vraagMetNr': {
    nl: 'Vervangt deze factuur {nr}?',
    ar: 'هل تحلّ هذه محل الفاتورة {nr}؟',
    en: 'Does this replace invoice {nr}?',
  },
  'ink.vervang.vraagZonderNr': {
    nl: 'Vervangt deze de andere factuur?',
    ar: 'هل تحلّ هذه محل الفاتورة الأخرى؟',
    en: 'Does this replace the other invoice?',
  },
  'ink.verwijderdGenegeerd': {
    nl: 'Verwijderd — terug te zetten bij Inkomend › Genegeerd',
    ar: 'حُذفت — يمكن استعادتها من «Inkomend › Genegeerd»',
    en: 'Removed — can be restored under Inkomend › Genegeerd',
  },
  'ink.verwijderFactuur': {
    nl: 'Inkoopfactuur {number} verwijderen',
    ar: 'حذف فاتورة المشتريات {number}',
    en: 'Delete purchase invoice {number}',
  },
  'ink.verzoekGestuurd': {
    nl: 'Je verzoek voor inkoopfactuur {number} is naar de boekhouder gestuurd.',
    ar: 'أُرسل طلبك بخصوص فاتورة المشتريات {number} إلى المحاسب.',
    en: 'Your request about purchase invoice {number} has been sent to your accountant.',
  },
  'ink.volledigBetaald': {
    nl: 'Hiermee is de factuur volledig betaald.',
    ar: 'بهذا تكون الفاتورة مدفوعة بالكامل.',
    en: 'With this the invoice is fully paid.',
  },
  'ink.wachtrijOnbekend': {
    nl: 'We konden niet zien wat er klaarstaat',
    ar: 'تعذّر علينا رؤية ما هو في الانتظار',
    en: 'We could not see what is waiting',
  },
  'ink.wordtBetaaldGemarkeerd': {
    nl: 'Inkoopfactuur {number} wordt als betaald gemarkeerd.',
    ar: 'ستُعلَّم فاتورة المشتريات {number} كمدفوعة.',
    en: 'Purchase invoice {number} will be marked as paid.',
  },
  'ink.xqUitleg': {
    nl: 'Btw: telt mee in {booked} (factuurdatum). Betaald in {paid}.',
    ar: 'ضريبة القيمة المضافة: تُحتسب في {booked} (تاريخ الفاتورة). دُفعت في {paid}.',
    en: 'Btw: counts in {booked} (invoice date). Paid in {paid}.',
  },
  'ink.zoekleeg.confirmed': {
    nl: 'Niets voor “{query}” in bevestigd.',
    ar: 'لا شيء مطابق لـ «{query}» في «المؤكَّدة».',
    en: 'Nothing for “{query}” in confirmed.',
  },
  'ink.zoekleeg.ignored': {
    nl: 'Niets voor “{query}” in genegeerd.',
    ar: 'لا شيء مطابق لـ «{query}» في «المتجاهَل».',
    en: 'Nothing for “{query}” in ignored.',
  },
  'ink.zoekleeg.pending': {
    nl: 'Niets voor “{query}” in te verwerken.',
    ar: 'لا شيء مطابق لـ «{query}» في «بانتظار المعالجة».',
    en: 'Nothing for “{query}” in the to-process list.',
  },
  'ink.zonderFactuurdatum': {
    nl: 'Zonder factuurdatum',
    ar: 'بدون تاريخ فاتورة',
    en: 'Without invoice date',
  },
  'ink.zonderNummer': {
    nl: 'zonder nummer',
    ar: 'بدون رقم',
    en: 'without number',
  },
  'inkoop.geenVerbinding': {
    nl: 'Geen verbinding',
    ar: 'لا يوجد اتصال',
    en: 'No connection',
  },
  'inst.bedrijfVoorbeeld': {
    nl: 'Jouw Bedrijf BV',
    ar: 'Jouw Bedrijf BV',
    en: 'Your Company BV',
  },
  'inst.boekhouderUitleg': {
    nl: 'Vul het e-mailadres van je boekhouder in. Hij ontvangt een uitnodiging om je facturen te beheren.',
    ar: 'أدخل البريد الإلكتروني لمحاسبك. سيتلقى دعوة لإدارة فواتيرك.',
    en: 'Enter your accountant\'s e-mail address. He will receive an invitation to manage your invoices.',
  },
  'inst.btwMethode': {
    nl: 'BTW-methode',
    ar: 'طريقة btw',
    en: 'VAT method',
  },
  'inst.btwNummer': {
    nl: 'BTW-nummer',
    ar: 'رقم btw',
    en: 'BTW number',
  },
  'inst.controleerVelden': {
    nl: 'Controleer de gemarkeerde velden',
    ar: 'تحقّق من الحقول المحددة',
    en: 'Check the highlighted fields',
  },
  'inst.definitiefVerwijderen': {
    nl: 'Definitief verwijderen',
    ar: 'حذف نهائي',
    en: 'Delete permanently',
  },
  'inst.eersteFactuur': {
    nl: '✓ Eerste factuur:',
    ar: '✓ الفاتورة الأولى:',
    en: '✓ First invoice:',
  },
  'inst.exporteerGegevens': {
    nl: 'Exporteer mijn gegevens',
    ar: 'تصدير بياناتي',
    en: 'Export my data',
  },
  'inst.exporterenBezig': {
    nl: 'Exporteren...',
    ar: 'جارٍ التصدير…',
    en: 'Exporting...',
  },
  'inst.exportMisluktOpnieuw': {
    nl: 'Export mislukt — probeer opnieuw',
    ar: 'فشل التصدير — حاول مرة أخرى',
    en: 'Export failed — please try again',
  },
  'inst.factuurstelsel': {
    nl: 'Factuurstelsel (standaard)',
    ar: 'نظام الفواتير (القياسي)',
    en: 'Invoice basis (default)',
  },
  'inst.geldtVanaf': {
    nl: 'Geldt vanaf {date} — eerdere kwartalen worden niet opnieuw berekend.',
    ar: 'يسري اعتبارًا من {date} — لا يُعاد حساب الأرباع السابقة.',
    en: 'Applies from {date} — earlier quarters are not recalculated.',
  },
  'inst.gevarenzoneUitleg': {
    nl: 'Exporteer eerst al je gegevens; daarna kun je je account verwijderen. Facturen en administratie blijven wettelijk 7 jaar bewaard (Bewaarplicht) — je account wordt gedeactiveerd, niet gewist.',
    ar: 'صدّر جميع بياناتك أولًا؛ بعدها يمكنك حذف حسابك. تبقى الفواتير والإدارة المالية محفوظة قانونًا 7 سنوات (Bewaarplicht) — يُعطَّل حسابك ولا يُمحى.',
    en: 'Export all your data first; after that you can delete your account. Invoices and administration stay legally kept for 7 years (Bewaarplicht) — your account is deactivated, not erased.',
  },
  'inst.herinneringenUitleg': {
    nl: 'Staat een verstuurde factuur na de vervaldatum nog open, dan mailt BoekBrug je klant automatisch een herinnering met het openstaande bedrag. Een betaalde factuur wordt nooit herinnerd; jij hoeft niets te doen.',
    ar: 'إذا بقيت فاتورة مرسلة مفتوحة بعد تاريخ الاستحقاق، يرسل BoekBrug تلقائيًا إلى عميلك تذكيرًا بالمبلغ المستحق. الفاتورة المدفوعة لا يُذكَّر بها أبدًا؛ لا تحتاج أن تفعل شيئًا.',
    en: 'If a sent invoice is still open after the due date, BoekBrug automatically e-mails your client a reminder with the outstanding amount. A paid invoice is never reminded; you need to do nothing.',
  },
  'inst.herinnerVoorbeeld': {
    nl: 'Bijv. “14, 30”: een vriendelijke herinnering na 14 dagen, een steviger na 30.',
    ar: 'مثلًا «14, 30»: تذكير ودّي بعد 14 يومًا، وتذكير أشد بعد 30.',
    en: 'E.g. “14, 30”: a friendly reminder after 14 days, a firmer one after 30.',
  },
  'inst.jeBoekhouder': {
    nl: 'Je boekhouder',
    ar: 'محاسبك',
    en: 'Your accountant',
  },
  'inst.kasstelselUitleg': {
    nl: 'BTW over je omzet telt op de betaaldatum — voor veel winkels/horeca verplicht. Voorbelasting blijft op de factuurdatum. Gaat in vanaf het huidige kwartaal; eerdere kwartalen blijven ongewijzigd.',
    ar: 'ضريبة إيرادك تُحتسب بتاريخ الدفع — إلزامي لكثير من المتاجر والمطاعم. أمّا ضريبة المشتريات فتبقى بتاريخ الفاتورة. يسري من الربع الحالي؛ وتبقى الأرباع السابقة دون تغيير.',
    en: 'VAT on your turnover counts on the payment date — mandatory for many shops and hospitality. Input VAT stays on the invoice date. Takes effect from the current quarter; earlier quarters stay unchanged.',
  },
  // [KOR-AANGIFTE-UIT] What the switch does now: the return screen goes off, like Moneybird and Exact.
  'inst.korUitleg': {
    nl: 'Onder de KOR reken je geen btw en doe je geen btw-aangifte: het aangiftescherm staat dan uit.',
    ar: 'ضمن KOR لا تحسب ضريبة القيمة المضافة ولا تقدّم إقرار ضريبة القيمة المضافة: شاشة الإقرار تكون حينها مطفأة.',
    en: 'Under the KOR you charge no VAT and file no VAT return: the return screen is then switched off.',
  },
  'inst.kvkNummer': {
    nl: 'KVK-nummer',
    ar: 'رقم KVK',
    en: 'KVK number',
  },
  'inst.machtigen': {
    nl: 'Machtigen',
    ar: 'تفويض',
    en: 'Authorise',
  },
  'inst.mandaatBevestigenTitel': {
    nl: 'Je boekhouder je inkoopfacturen laten bevestigen?',
    ar: 'السماح للمحاسب بتأكيد فواتير مشترياتك؟',
    en: 'Let your accountant confirm your purchase invoices?',
  },
  'inst.mandaatBevestigenUitleg': {
    nl: '{name} mag dan je inkoopfacturen controleren en boeken. Hij kan geen bedragen wijzigen, alleen bevestigen wat er staat. Bij elke bevestiging staat zijn naam en krijg je bericht; je blijft zelf verantwoordelijk.',
    ar: 'سيتمكن {name} حينها من مراجعة فواتير مشترياتك وقيدها. لا يستطيع تغيير المبالغ، فقط تأكيد ما هو مكتوب. مع كل تأكيد يُسجَّل اسمه وتصلك رسالة؛ وتبقى المسؤولية عليك.',
    en: '{name} may then check and book your purchase invoices. They cannot change amounts, only confirm what is there. Every confirmation carries their name and you are notified; you remain responsible.',
  },
  'inst.mandaatFacturenTitel': {
    nl: 'Je boekhouder laten factureren?',
    ar: 'السماح للمحاسب بإصدار الفواتير؟',
    en: 'Let your accountant invoice?',
  },
  'inst.mandaatFacturenUitleg': {
    nl: '{name} mag dan facturen versturen op jouw naam, met jouw nummerreeks en btw-nummer. Van elke factuur krijg je bericht en je blijft er zelf verantwoordelijk voor. Uitzetten kan hier altijd.',
    ar: 'سيتمكن {name} حينها من إرسال فواتير باسمك، بتسلسل أرقامك ورقم btw الخاص بك. تصلك رسالة عن كل فاتورة وتبقى أنت المسؤول عنها. الإيقاف ممكن هنا دائمًا.',
    en: '{name} may then send invoices in your name, with your number sequence and btw number. You are notified of every invoice and you remain responsible for it. You can switch it off here at any time.',
  },
  'inst.nummeringOpgeslagen': {
    nl: 'Nummering opgeslagen ✓',
    ar: 'حُفظ الترقيم ✓',
    en: 'Numbering saved ✓',
  },
  'inst.nummeringOpslaanKnop': {
    nl: 'Nummering opslaan',
    ar: 'حفظ الترقيم',
    en: 'Save numbering',
  },
  'inst.nummeringPlaceholder': {
    nl: 'bijv. 045-2026',
    ar: 'مثلًا 045-2026',
    en: 'e.g. 045-2026',
  },
  'inst.nummeringUitleg': {
    nl: 'Kom je van een ander programma? Vul je volgende factuurnummer in — bijv.',
    ar: 'قادم من برنامج آخر؟ أدخل رقم فاتورتك التالي — مثلًا',
    en: 'Coming from another program? Enter your next invoice number — e.g.',
  },
  'inst.nummeringVast': {
    nl: '🔒 Je nummering staat vast — er is al een factuur verstuurd. Wijzigen kan niet meer (wettelijk verplicht).',
    ar: '🔒 ترقيمك مثبّت — أُرسلت فاتورة بالفعل. لم يعد التغيير ممكنًا (إلزام قانوني).',
    en: '🔒 Your numbering is fixed — an invoice has already been sent. It can no longer be changed (legally required).',
  },
  'inst.ontkoppelenMislukt': {
    nl: 'Ontkoppelen mislukt',
    ar: 'فشل إلغاء الربط',
    en: 'Unlinking failed',
  },
  'inst.ontkoppelTitel': {
    nl: 'Koppeling met je boekhouder verwijderen?',
    ar: 'إزالة الربط مع المحاسب؟',
    en: 'Remove the link with your accountant?',
  },
  'inst.ontkoppelUitleg': {
    nl: '{name} kan je administratie daarna niet meer inzien. Je kunt later opnieuw uitnodigen.',
    ar: 'لن يتمكن {name} بعدها من الاطلاع على إدارتك المالية. يمكنك إرسال دعوة جديدة لاحقًا.',
    en: '{name} will no longer be able to see your administration. You can invite again later.',
  },
  'inst.opnieuwExporteren': {
    nl: 'Opnieuw exporteren',
    ar: 'إعادة التصدير',
    en: 'Export again',
  },
  'inst.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'inst.opslaanBezig': {
    nl: 'Opslaan...',
    ar: 'جارٍ الحفظ…',
    en: 'Saving...',
  },
  'inst.opslaanMislukt': {
    nl: 'Opslaan mislukt — probeer opnieuw',
    ar: 'فشل الحفظ — حاول مرة أخرى',
    en: 'Saving failed — please try again',
  },
  'inst.profielOpgeslagen': {
    nl: 'Profiel opgeslagen ✓',
    ar: 'حُفظ الملف الشخصي ✓',
    en: 'Profile saved ✓',
  },
  'inst.rijBevestigenAan': {
    nl: 'Aan. Je boekhouder controleert en boekt je bonnen en inkoopfacturen; bedragen wijzigen kan hij niet, alleen bevestigen wat er staat. Bij elke bevestiging staat zijn naam.',
    ar: 'مفعّل. يراجع المحاسب إيصالاتك وفواتير مشترياتك ويقيّدها؛ لا يمكنه تغيير المبالغ، فقط تأكيد ما هو مكتوب. ويُسجَّل اسمه مع كل تأكيد.',
    en: 'On. Your accountant checks and books your receipts and purchase invoices; he cannot change amounts, only confirm what is there. His name is recorded with every confirmation.',
  },
  'inst.rijBevestigenTitel': {
    nl: 'Mijn inkoopfacturen bevestigen',
    ar: 'تأكيد فواتير مشترياتي',
    en: 'Confirm my purchase invoices',
  },
  'inst.rijBevestigenUit': {
    nl: 'Uit. Alleen jij bevestigt je inkoopfacturen. Zolang er nog onbevestigde stukken zijn, is je kwartaal niet klaar.',
    ar: 'متوقف. أنت وحدك تؤكد فواتير مشترياتك. وما دامت هناك مستندات غير مؤكدة، فربع سنتك غير جاهز.',
    en: 'Off. Only you confirm your purchase invoices. As long as unconfirmed documents remain, your quarter is not done.',
  },
  'inst.rijFacturenAan': {
    nl: 'Aan. Facturen krijgen jouw nummerreeks en btw-nummer, en je krijgt van elke bericht. Je blijft er zelf verantwoordelijk voor.',
    ar: 'مفعّل. تحمل الفواتير تسلسل أرقامك ورقم btw الخاص بك، وتصلك رسالة عن كل واحدة. وتبقى أنت المسؤول عنها.',
    en: 'On. Invoices carry your number sequence and btw number, and you are notified of each. You remain responsible for them yourself.',
  },
  'inst.rijFacturenTitel': {
    nl: 'Facturen versturen namens mij',
    ar: 'إرسال الفواتير نيابةً عني',
    en: 'Send invoices on my behalf',
  },
  'inst.rijFacturenUit': {
    nl: 'Uit. Je boekhouder kan je administratie wel inzien, maar geen facturen op jouw naam versturen.',
    ar: 'متوقف. يستطيع المحاسب الاطلاع على إدارتك المالية، لكن لا يمكنه إرسال فواتير باسمك.',
    en: 'Off. Your accountant can see your administration, but cannot send invoices in your name.',
  },
  'inst.toelichtingKor': {
    nl: 'Voor de KOR en voor btw verlegd hoef je niets in te vullen — die zet de app er zelf op.',
    ar: 'أما نظام KOR و«btw verlegd» فلا تحتاج إلى كتابة شيء لهما — التطبيق يضيفهما بنفسه.',
    en: 'For the KOR and for btw reverse-charged you need not enter anything — the app adds those itself.',
  },
  'inst.toelichtingPlaceholder': {
    nl: 'Bijv. Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).',
    ar: 'مثلًا: Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).',
    en: 'E.g. Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).',
  },
  'inst.toelichtingUitleg': {
    nl: 'Deze zin komt onder het totaal op elke factuur zonder BTW, zodat de boekhouder van je klant weet waarom er geen BTW op staat. Bijvoorbeeld:',
    ar: 'تظهر هذه الجملة تحت المجموع في كل فاتورة بلا ضريبة القيمة المضافة، ليعرف محاسب عميلك لماذا لا توجد ضريبة. مثلًا:',
    en: 'This sentence appears under the total on every invoice without VAT, so your client’s accountant knows why there is none. For example:',
  },
  'inst.uitnodigen': {
    nl: 'Uitnodigen',
    ar: 'دعوة',
    en: 'Invite',
  },
  'inst.uitnodigingMislukt': {
    nl: 'Uitnodiging mislukt',
    ar: 'فشلت الدعوة',
    en: 'Invitation failed',
  },
  'inst.uitnodigingNietVerzonden': {
    nl: 'De uitnodiging is aangemaakt, maar de e-mail kon niet worden verzonden. Controleer het e-mailadres of deel de uitnodigingslink zelf met je boekhouder.',
    ar: 'أُنشئت الدعوة، لكن تعذّر إرسال البريد الإلكتروني. تحقّق من العنوان أو شارك رابط الدعوة بنفسك مع محاسبك.',
    en: 'The invitation was created, but the e-mail could not be sent. Check the address or share the invitation link with your accountant yourself.',
  },
  'inst.uitnodigingVerstuurd': {
    nl: 'Uitnodiging verstuurd naar {email}',
    ar: 'أُرسلت الدعوة إلى {email}',
    en: 'Invitation sent to {email}',
  },
  'inst.verwijderenBezig': {
    nl: 'Verwijderen...',
    ar: 'جارٍ الحذف…',
    en: 'Deleting...',
  },
  'inst.verwijderUitleg': {
    nl: 'Bevestig met je e-mailadres en wachtwoord. Daarna is je account niet meer toegankelijk; je gegevens blijven wettelijk bewaard (Bewaarplicht ~7 jaar).',
    ar: 'أكِّد ببريدك الإلكتروني وكلمة المرور. بعدها لا يعود حسابك متاحًا؛ وتبقى بياناتك محفوظة قانونًا (Bewaarplicht ~7 سنوات).',
    en: 'Confirm with your e-mail address and password. After that your account is no longer accessible; your data stays legally kept (Bewaarplicht ~7 years).',
  },
  'inst.volgende': {
    nl: '· volgende:',
    ar: '· التالية:',
    en: '· next:',
  },
  'inst.volgendeFactuur': {
    nl: 'Je volgende factuur wordt:',
    ar: 'فاتورتك التالية ستكون:',
    en: 'Your next invoice will be:',
  },
  'inst.vrijgesteldUitleg': {
    nl: 'Voor werk dat is vrijgesteld van BTW (art. 11), zoals zorg of onderwijs; je kiest dan per factuurregel "Vrijgesteld". Vrijgesteld is niet 0%: BTW op inkopen hiervoor vraag je niet terug.',
    ar: 'للعمل المُعفى من الضريبة (المادة 11) كالرعاية أو التعليم؛ تختار حينها «Vrijgesteld» لكل سطر فاتورة. المُعفى ليس 0٪: ضريبة المشتريات له لا تُستردّ.',
    en: 'For work exempt from VAT (art. 11), such as care or education; you then choose "Vrijgesteld" per invoice line. Exempt is not 0%: VAT on purchases for it is not reclaimed.',
  },
  'inst.vulEmail': {
    nl: 'Vul een e-mailadres in',
    ar: 'أدخل عنوان بريد إلكتروني',
    en: 'Enter an e-mail address',
  },
  'inst.vulEmailWachtwoord': {
    nl: 'Vul je e-mailadres en wachtwoord in',
    ar: 'أدخل بريدك الإلكتروني وكلمة المرور',
    en: 'Enter your e-mail address and password',
  },
  'inst.wijzigenMislukt': {
    nl: 'Wijzigen mislukt',
    ar: 'فشل التغيير',
    en: 'Changing failed',
  },
  'int.alEerder': {
    nl: 'Je hebt dit bestand al eerder toegevoegd:',
    ar: 'أضفت هذا الملف من قبل:',
    en: 'You already added this file before:',
  },
  'int.batchUitleg': {
    nl: 'Je kon doorgaan met fotograferen terwijl deze werden gelezen. Dit is waar ze terecht zijn gekomen.',
    ar: 'كان بإمكانك متابعة التصوير أثناء قراءتها. هذا ما آلت إليه.',
    en: 'You could keep photographing while these were read. This is where they ended up.',
  },
  'int.bestaatAl': {
    nl: 'Deze factuur bestaat al',
    ar: 'هذه الفاتورة موجودة مسبقًا',
    en: 'This invoice already exists',
  },
  'int.bestandBestaatAl': {
    nl: 'Dit bestand is al toegevoegd',
    ar: 'هذا الملف أُضيف مسبقًا',
    en: 'This file was already added',
  },
  'int.bestandStaatIn': {
    nl: 'Dit bestand staat in: {folder}',
    ar: 'هذا الملف في: {folder}',
    en: 'This file is in: {folder}',
  },
  'int.bonFactuur': {
    nl: 'Bon/factuur',
    ar: 'إيصال/فاتورة',
    en: 'Receipt/invoice',
  },
  'int.combineer': {
    nl: 'Combineer {n} pagina\'s → één factuur',
    ar: 'ادمج {n} صفحة ← فاتورة واحدة',
    en: 'Combine {n} pages → one invoice',
  },
  'int.combineerEen': {
    nl: 'Combineer 1 pagina → één factuur',
    ar: 'ادمج صفحة واحدة ← فاتورة واحدة',
    en: 'Combine 1 page → one invoice',
  },
  'int.combinerenMislukt': {
    nl: 'Combineren mislukt — voeg de pagina’s los toe',
    ar: 'فشل الدمج — أضف الصفحات منفردة',
    en: 'Combining failed — add the pages separately',
  },
  'int.dagomzetGeboekt': {
    nl: 'Dagomzet geboekt ✓',
    ar: 'قُيّد إيراد اليوم ✓',
    en: 'Daily turnover booked ✓',
  },
  'int.eenPdfUitleg': {
    nl: 'Eén PDF = één factuur. Meerdere verschillende facturen? Voeg ze los toe.',
    ar: 'ملف PDF واحد = فاتورة واحدة. عدة فواتير مختلفة؟ أضفها منفردة.',
    en: 'One PDF = one invoice. Several different invoices? Add them separately.',
  },
  'int.gebeurd': {
    nl: 'Dit is er met je bestand gebeurd:',
    ar: 'هذا ما حدث لملفك:',
    en: 'This is what happened to your file:',
  },
  'int.ingelezenControle': {
    nl: 'Ingelezen als controle-check',
    ar: 'قُرئ كفحص مراجعة',
    en: 'Read in as a cross-check',
  },
  'int.kop.bestaatAl': {
    nl: 'Dit bestand bestaat al',
    ar: 'هذا الملف موجود مسبقًا',
    en: 'This file already exists',
  },
  'int.kop.nietGelezen': {
    nl: 'Bewaard, maar niet gelezen',
    ar: 'حُفظ، لكنه لم يُقرأ',
    en: 'Saved, but not read',
  },
  'int.kop.toegevoegd': {
    nl: 'Bestand toegevoegd',
    ar: 'أُضيف الملف',
    en: 'File added',
  },
  'int.landed.bank': {
    nl: 'bankafschrift → Bank',
    ar: 'كشف بنكي ← البنك',
    en: 'bank statement → Bank',
  },
  'int.landed.bestand': {
    nl: 'bestand → Mijn bestanden',
    ar: 'ملف ← «ملفاتي»',
    en: 'file → My files',
  },
  'int.landed.bon': {
    nl: 'bon → Inkoopfacturen',
    ar: 'إيصال ← «فواتير المشتريات»',
    en: 'receipt → Purchase invoices',
  },
  'int.landed.controle': {
    nl: 'controle-check → ingelezen',
    ar: 'فحص مراجعة ← قُرئ',
    en: 'cross-check → read in',
  },
  'int.landed.dagomzet': {
    nl: 'dagomzet → Dagomzet',
    ar: 'إيراد يومي ← «إيراد اليوم»',
    en: 'daily turnover → Daily turnover',
  },
  'int.landed.dubbel': {
    nl: 'dubbel — niet toegevoegd',
    ar: 'مكرّر — لم يُضف',
    en: 'duplicate — not added',
  },
  'int.landed.factuur': {
    nl: 'factuur → Inkoopfacturen',
    ar: 'فاتورة ← «فواتير المشتريات»',
    en: 'invoice → Purchase invoices',
  },
  'int.landed.mogelijkDubbel': {
    nl: 'mogelijk dubbel — jouw keuze',
    ar: 'ربما مكرّرة — القرار لك',
    en: 'possibly duplicate — your call',
  },
  'int.landed.overzicht': {
    nl: 'rekeningoverzicht → gecontroleerd',
    ar: 'كشف حساب ← رُوجع',
    en: 'account statement → checked',
  },
  'int.landed.herinnering': {
    nl: 'betalingsherinnering → bewaard, niet geboekt',
    ar: 'تذكير بالدفع ← حُفظ ولم يُقيّد',
    en: 'payment reminder → filed, not booked',
  },
  'int.herinneringBewaard': {
    nl: 'Dit is een betalingsherinnering, geen factuur. Hij staat in je bestanden en is niet als kost geboekt.',
    ar: 'هذا تذكير بالدفع وليس فاتورة. حُفظ في ملفاتك ولم يُقيَّد كتكلفة.',
    en: 'This is a payment reminder, not an invoice. It is in your files and was not booked as a cost.',
  },
  'int.maakFotoUpload': {
    nl: 'Maak een foto of upload — AI sorteert het',
    ar: 'التقط صورة أو ارفع ملفاً — الذكاء الاصطناعي يفرزه',
    en: 'Take a photo or upload — AI sorts it',
  },
  'int.maxPaginas': {
    nl: 'Maximaal {n} pagina’s per factuur',
    ar: 'الحد الأقصى للصفحات في الفاتورة: {n}',
    en: 'At most {n} pages per invoice',
  },
  'int.mpUitleg': {
    nl: 'Fotografeer of kies elke pagina van dezelfde factuur. We voegen ze samen tot één factuur.',
    ar: 'صوّر أو اختر كل صفحة من الفاتورة نفسها. سنجمعها في فاتورة واحدة.',
    en: 'Photograph or choose each page of the same invoice. We merge them into one invoice.',
  },
  'int.nVerwerkt': {
    nl: '{n} verwerkt',
    ar: 'عدد المعالَج: {n}',
    en: '{n} processed',
  },
  'int.opgeslagen': {
    nl: 'Opgeslagen in je bestanden',
    ar: 'حُفظ في ملفاتك',
    en: 'Stored in your files',
  },
  'int.overzichtGecontroleerd': {
    nl: 'Rekeningoverzicht gecontroleerd',
    ar: 'رُوجع كشف الحساب',
    en: 'Account statement checked',
  },
  'int.pagina': {
    nl: 'Pagina {n}',
    ar: 'الصفحة {n}',
    en: 'Page {n}',
  },
  'int.paginaFotograferen': {
    nl: 'Pagina fotograferen',
    ar: 'تصوير صفحة',
    en: 'Photograph a page',
  },
  'int.paginasKiezen': {
    nl: 'Pagina\'s kiezen',
    ar: 'اختيار الصفحات',
    en: 'Choose pages',
  },
  'int.sheetUitleg': {
    nl: 'Maak een foto of kies een bestand. De AI herkent en sorteert het automatisch.',
    ar: 'التقط صورة أو اختر ملفًا. يتعرّف عليه الذكاء الاصطناعي ويفرزه تلقائيًا.',
    en: 'Take a photo or choose a file. The AI recognises and sorts it automatically.',
  },
  'int.staatGenegeerd': {
    nl: 'Deze factuur staat in Genegeerd',
    ar: 'هذه الفاتورة في «Genegeerd»',
    en: 'This invoice is in Ignored',
  },
  'int.staatIn': {
    nl: 'Het staat in: {folder}',
    ar: 'موجود في: {folder}',
    en: 'It is in: {folder}',
  },
  'int.terugzettenGenegeerd': {
    nl: 'Terugzetten uit Genegeerd',
    ar: 'استعادة من «متجاهَل»',
    en: 'Put back from Ignored',
  },
  'int.terugzettenVervers': {
    nl: 'Terugzetten mislukt — ververs de pagina',
    ar: 'فشلت الإعادة — أعد تحميل الصفحة',
    en: 'Putting back failed — refresh the page',
  },
  'int.toegevoegd': {
    nl: 'Toegevoegd ✓',
    ar: 'أُضيف ✓',
    en: 'Added ✓',
  },
  'int.veiligNietGelezen': {
    nl: 'Het bestand is veilig opgeslagen, maar we konden er niets uit lezen:',
    ar: 'حُفظ الملف بأمان، لكن تعذّرت قراءة أي شيء منه:',
    en: 'The file is stored safely, but we could not read anything from it:',
  },
  'int.voegEerstToe': {
    nl: 'Voeg eerst pagina\'s toe',
    ar: 'أضف صفحات أولاً',
    en: 'Add pages first',
  },
  'int.wordtGelezen': {
    nl: '{n} wordt gelezen — je kunt gewoon doorgaan',
    ar: 'قيد القراءة: {n} — يمكنك المتابعة كالمعتاد',
    en: '{n} being read — you can just keep going',
  },
  // [AUTO-UITLEG] The legend line above the ledger — the tooltip above keeps its "Automatisch:"
  // lead, the line gets the badge's own lead from the component and so must not repeat it.
  'kas.betalingLegenda': {
    nl: 'De app zette deze regel zelf in het kasboek, voor een contant betaalde factuur. Weghalen kan alleen via die factuur.',
    ar: 'وضع التطبيق هذا السطر بنفسه في دفتر الصندوق لفاتورة مدفوعة نقدًا. لا يمكن إزالته إلا عبر تلك الفاتورة.',
    en: 'The app put this line in the cash book itself, for a cash-paid invoice. It can only be removed via that invoice.',
  },
  'kas.betalingAutomatisch': {
    nl: 'Automatisch: betaling van een contant betaalde factuur. Maak de betaling op de factuur ongedaan om dit te verwijderen.',
    ar: 'تلقائي: دفعة فاتورة مدفوعة نقدًا. لحذفها، ألغِ الدفع على الفاتورة نفسها.',
    en: 'Automatic: payment of a cash-paid invoice. Undo the payment on the invoice to remove this.',
  },
  'kas.boekingen': {
    nl: 'BOEKINGEN',
    ar: 'القيود',
    en: 'ENTRIES',
  },
  'kas.btw': {
    nl: 'BTW:',
    ar: 'btw:',
    en: 'VAT:',
  },
  'kas.cat.betaling': {
    nl: 'Factuurbetaling (contant)',
    ar: 'دفعة فاتورة (نقدًا)',
    en: 'Invoice payment (cash)',
  },
  'kas.cat.kosten': {
    nl: 'Kost',
    ar: 'تكلفة',
    en: 'Cost',
  },
  'kas.cat.omzet': {
    nl: 'Omzet',
    ar: 'الإيراد',
    en: 'Revenue',
  },
  // [KAS-LOON] Contant uitbetaald loon. Een eigen categorie en niet 'Kost', omdat de twee in de
  // boeking verschillen: loon draagt NOOIT btw (financial-result boekt salaris rate-free by
  // construction), terwijl een kost met bon en tarief voorbelasting oplevert. Wie een loon als kost
  // moet boeken, verstopt bovendien een loonverplichting in een algemeen kostentotaal.
  'kas.cat.salaris': {
    nl: 'Loon',
    ar: 'أجر',
    en: 'Wages',
  },
  // [KAS-LOON] Wat deze app WEL en NIET doet met een contant loon. De boeking legt de kasbeweging
  // en de kostenpost vast; de loonaangifte is een aparte verplichting die hier niet gebeurt. Dat
  // hoort er te staan op het moment dat de eigenaar 'Loon' kiest, niet in een handleiding: iemand
  // die zijn loon net heeft geboekt mag niet denken dat hij klaar is.
  'kas.loon.uitleg': {
    nl: 'Loon draagt geen btw, dus hier komt geen tarief bij. Let op: dit legt alleen de kasuitgave vast — de loonaangifte en loonheffingen regel je apart.',
    ar: 'الأجر لا يحمل ضريبة القيمة المضافة، فلا تُضاف نسبة هنا. تنبيه: هذا يسجّل الحركة النقدية فقط — إقرار الأجور واستقطاعاتها تتولّاها بشكل منفصل.',
    en: 'Wages carry no VAT, so no rate is added here. Note: this records the cash payment only — the payroll return and payroll taxes are handled separately.',
  },
  'kas.cat.opname': {
    nl: 'Opname (van bank)',
    ar: 'سحب (من البنك)',
    en: 'Withdrawal (from the bank)',
  },
  'kas.cat.prive': {
    nl: 'Privé',
    ar: 'خاص',
    en: 'Private',
  },
  'kas.cat.storting': {
    nl: 'Storting (naar bank)',
    ar: 'إيداع (إلى البنك)',
    en: 'Deposit (to the bank)',
  },
  'kas.cat.transfer': {
    nl: 'Naar/van bank',
    ar: 'إلى/من البنك',
    en: 'To/from the bank',
  },
  'kas.downloadXlsx': {
    nl: '⬇︎ Download voor boekhouder (.xlsx)',
    ar: '⬇︎ تنزيل للمحاسب (.xlsx)',
    en: '⬇︎ Download for the accountant (.xlsx)',
  },
  'kas.fout.beginsaldoOpslaan': {
    nl: 'Kon beginsaldo niet opslaan',
    ar: 'تعذّر حفظ الرصيد الافتتاحي',
    en: 'Could not save the opening balance',
  },
  'kas.fout.boekingOpslaan': {
    nl: 'Kon de boeking niet opslaan. Probeer opnieuw.',
    ar: 'تعذّر حفظ القيد. حاول مرة أخرى.',
    en: 'Could not save the entry. Please try again.',
  },
  'kas.fout.boekingVerwijderen': {
    nl: 'Kon de boeking niet verwijderen.',
    ar: 'تعذّر حذف القيد.',
    en: 'Could not delete the entry.',
  },
  'kas.geenGevonden': {
    nl: 'Geen boekingen gevonden voor “{query}”.',
    ar: 'لا قيود مطابقة لـ «{query}».',
    en: 'No entries found for “{query}”.',
  },
  'kas.kasboekKnop': {
    nl: '📗 Kasboek per kwartaal — voor de boekhouder',
    ar: '📗 دفتر النقد لكل ربع — للمحاسب',
    en: '📗 Cash book per quarter — for the accountant',
  },
  'kas.kasboekTitel': {
    nl: 'KASBOEK — KWARTAAL',
    ar: 'دفتر الصندوق — الربع',
    en: 'CASH BOOK — QUARTER',
  },
  'kas.kasboekUitleg': {
    nl: 'Dit kasboek wordt live berekend uit je contante omzet en kasboekingen. De omzet telt al één keer in je resultaat; dit overzicht toont alleen het kassaldo, dus niets wordt dubbel geboekt.',
    ar: 'يُحسب دفتر الصندوق هذا مباشرةً من إيرادك النقدي وقيودك النقدية. الإيراد محسوب مرة واحدة في نتيجتك؛ هذا العرض يُظهر رصيد الصندوق فقط، فلا يُسجَّل شيء مرتين.',
    en: 'This cash book is computed live from your cash takings and cash entries. The revenue already counts once in your result; this view shows only the cash balance, so nothing is booked twice.',
  },
  'kas.ledgerLeeg': {
    nl: 'Nog geen kasboekingen. Voeg je eerste contante ontvangst of uitgave toe.',
    ar: 'لا قيود نقدية بعد. أضف أول مقبوض أو مصروف نقدي.',
    en: 'No cash entries yet. Add your first cash receipt or expense.',
  },
  'kas.negatief.blokkeert': {
    nl: 'Zolang dit openstaat, blokkeert de app je BTW-aangifte — juist om te voorkomen dat je iets indient wat niet kan kloppen.',
    ar: 'ما دام هذا معلّقًا يمنع التطبيق تقديم إقرار الضريبة — تحديدًا كي لا تقدّم شيئًا لا يمكن أن يكون صحيحًا.',
    en: 'While this is open the app blocks your VAT return — precisely to keep you from filing something that cannot be right.',
  },
  // [KAS-NEGATIEF-NU] The same dip, in the quarter that is still open. Deliberately a DIFFERENT
  // sentence from kas.negatief.blokkeert: that one is about a quarter whose aangifte the app is
  // refusing right now, and saying it here would be false — nothing is being blocked yet. What is
  // true is that this is the moment it is cheap to fix, while the days are still fresh enough to
  // remember and no filing has been built on them.
  'kas.negatief.nogNietIngediend': {
    nl: 'Dit kwartaal is nog niet ingediend. Los je dit nu op, dan blokkeert het je aangifte straks niet.',
    ar: 'لم يُقدَّم هذا الربع بعد. إن أصلحته الآن فلن يحجب إقرارك لاحقًا.',
    en: 'This quarter has not been filed yet. Fix it now and it will not block your return later.',
  },
  // [KAS-BRUG] De vierde reden, en in een winkel de gewoonste: er is contant geld van de bank
  // gehaald en de opname is nooit in het kasboek geschreven. De app ZIET die opname al — hij staat
  // geclassificeerd op het bankafschrift dat ze zelf heeft ingelezen. Een poort die een aangifte
  // weigert om een getal, terwijl de waarschijnlijkste onschuldige verklaring voor dat getal in haar
  // eigen database ligt, beschuldigt iemand met het bewijs op zak.
  'kas.brug.titel': {
    nl: 'Je hebt contant geld van de bank gehaald dat niet in je kasboek staat',
    ar: 'سحبت نقدًا من البنك ولا يظهر في دفتر الصندوق',
    en: 'You took cash out of the bank that is not in your cash book',
  },
  'kas.brug.uitleg': {
    nl: 'Dit staat wél op je bankafschrift. Hoort dit geld in de kassa? Boek het als opname — dan klopt je kassaldo weer; meestal is dit wat er ontbrak.',
    ar: 'هذا موجود في كشف حسابك البنكي. هل هذا المال يخصّ الصندوق؟ قيّده كسحب — فيعود رصيد الصندوق صحيحًا؛ وغالبًا هذا ما كان ناقصًا.',
    en: 'It is on your bank statement. Does this money belong in the till? Book it as a withdrawal — your cash balance adds up again; usually this is what was missing.',
  },
  'kas.negatief.reden1': {
    nl: 'het beginsaldo staat te laag (het geld dat al in de kassa lag)',
    ar: 'الرصيد الافتتاحي منخفض جدًا (المال الذي كان في الدرج أصلًا)',
    en: 'the opening balance is set too low (the money already in the drawer)',
  },
  'kas.negatief.reden2': {
    nl: 'een contante ontvangst is nog niet geboekt',
    ar: 'ثمة مقبوض نقدي لم يُسجَّل بعد',
    en: 'a cash receipt has not been booked yet',
  },
  'kas.negatief.reden3': {
    nl: 'een uitgave staat op de verkeerde datum — vóór het geld binnenkwam',
    ar: 'ثمة مصروف مسجَّل بتاريخ خاطئ — قبل وصول المال',
    en: 'an expense sits on the wrong date — before the money came in',
  },
  'kas.negatief.titel': {
    nl: 'Je kas stond op {datum} op {bedrag}',
    ar: 'بلغ رصيد النقد لديك بتاريخ {datum} ما قدره {bedrag}',
    en: 'Your cash stood at {bedrag} on {datum}',
  },
  'kas.negatief.uitleg': {
    nl: 'Een kas kan niet onder nul: je kunt geen geld uitgeven dat er niet was. Voor de Belastingdienst is dit het duidelijkste signaal dat er iets ontbreekt. Meestal één van deze drie:',
    ar: 'لا يمكن للنقد أن ينزل تحت الصفر: لا يمكنك إنفاق مال لم يكن موجودًا. بالنسبة لمصلحة الضرائب، هذا أوضح مؤشر على أن شيئًا ناقص. غالبًا واحد من هذه الثلاثة:',
    en: 'A cash drawer cannot go below zero: you cannot spend money that was never there. For the Belastingdienst this is the clearest signal something is missing. Usually one of these three:',
  },
  'kas.omschrijvingOptioneel': {
    nl: 'Omschrijving (optioneel)',
    ar: 'الوصف (اختياري)',
    en: 'Description (optional)',
  },
  'kas.ontvangstenLabel': {
    nl: 'Kasontvangsten',
    ar: 'مقبوضات نقدية',
    en: 'Cash receipts',
  },
  'kas.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'kas.titelSaldo': {
    nl: 'KAS — SALDO IN KASSA',
    ar: 'النقد — الرصيد في الدرج',
    en: 'CASH — BALANCE IN THE DRAWER',
  },
  'kas.totaalMaand': {
    nl: 'Totaal {maand}',
    ar: 'إجمالي {maand}',
    en: 'Total {maand}',
  },
  'kas.uitgaveLabel': {
    nl: 'Kasuitgave',
    ar: 'مصروف نقدي',
    en: 'Cash expense',
  },
  'kas.upload.bezig': {
    nl: 'Bezig met uploaden…',
    ar: 'جارٍ الرفع…',
    en: 'Uploading…',
  },
  'kas.upload.dubbel': {
    nl: 'Deze bon staat er al — hij is eerder toegevoegd.',
    ar: 'هذا الإيصال موجود بالفعل — أُضيف سابقًا.',
    en: 'This receipt is already there — it was added earlier.',
  },
  'kas.upload.knop': {
    nl: '📄 Bon uploaden',
    ar: '📄 رفع إيصال',
    en: '📄 Upload receipt',
  },
  'kas.upload.misging': {
    nl: 'Er ging iets mis bij het uploaden.',
    ar: 'حدث خطأ أثناء الرفع.',
    en: 'Something went wrong during the upload.',
  },
  'kas.upload.mislukt': {
    nl: 'Uploaden mislukt — probeer het opnieuw.',
    ar: 'فشل الرفع — حاول مرة أخرى.',
    en: 'Upload failed — please try again.',
  },
  'kas.upload.naarBestanden': {
    nl: 'Ga naar Mijn bestanden →',
    ar: 'اذهب إلى «ملفاتي» ←',
    en: 'Go to My files →',
  },
  'kas.upload.naarVerifieren': {
    nl: 'Ga naar Te verifiëren →',
    ar: 'اذهب إلى «بانتظار التدقيق» ←',
    en: 'Go to the verify queue →',
  },
  'kas.upload.nietLezen': {
    nl: 'We konden dit document niet lezen. Het staat in je bestanden — controleer het, of upload een duidelijkere foto als het een factuur of bon is.',
    ar: 'لم نستطع قراءة هذا المستند. إنه في ملفاتك — تحقّق منه، أو ارفع صورة أوضح إن كان فاتورة أو إيصالًا.',
    en: 'We could not read this document. It is in your files — check it, or upload a clearer photo if it is an invoice or receipt.',
  },
  'kas.upload.toegevoegd': {
    nl: 'Bon toegevoegd. Bevestig ‘contant betaald’ in Te verifiëren — daarna staat de betaling automatisch in je kasboek.',
    ar: 'أُضيف الإيصال. أكّد «مدفوع نقدًا» في «بانتظار التدقيق» — بعدها يظهر الدفع تلقائيًا في دفتر الصندوق.',
    en: 'Receipt added. Confirm ‘paid in cash’ in the verify queue — the payment then lands in your cash book automatically.',
  },
  'kas.upload.uitleg': {
    nl: 'Foto of PDF van een contant betaalde bon. Wij lezen hem; jij bevestigt ‘contant betaald’ — dan staat hij in je kasboek en blijft de BTW aftrekbaar.',
    ar: 'صورة أو PDF لإيصال مدفوع نقدًا. نحن نقرأه؛ وأنت تؤكّد «مدفوع نقدًا» — فيدخل دفتر الصندوق وتبقى الضريبة قابلة للخصم.',
    en: 'A photo or PDF of a receipt paid in cash. We read it; you confirm ‘paid in cash’ — then it is in your cash book and the VAT stays deductible.',
  },
  'kas.wijzigen': {
    nl: 'wijzigen',
    ar: 'تعديل',
    en: 'change',
  },
  'kl.bewerken': {
    nl: 'Klant bewerken',
    ar: 'تعديل العميل',
    en: 'Edit client',
  },
  'kl.bijgewerkt': {
    nl: 'Klant bijgewerkt',
    ar: 'حُدِّث العميل',
    en: 'Client updated',
  },
  'kl.bijwerken': {
    nl: 'Bijwerken',
    ar: 'تحديث',
    en: 'Update',
  },
  'kl.dezeKlant': {
    nl: 'Deze klant',
    ar: 'هذا العميل',
    en: 'This client',
  },
  'kl.geenGevonden': {
    nl: 'Geen klant gevonden voor "{query}"',
    ar: 'لم يُعثر على عميل مطابق لـ«{query}»',
    en: 'No client found for "{query}"',
  },
  'kl.geenResultaten': {
    nl: 'Geen resultaten',
    ar: 'لا نتائج',
    en: 'No results',
  },
  'kl.leeg': {
    nl: 'Nog geen klanten',
    ar: 'لا عملاء بعد',
    en: 'No clients yet',
  },
  'kl.nieuweKlant': {
    nl: 'Nieuwe klant',
    ar: 'عميل جديد',
    en: 'New client',
  },
  'kl.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'kl.opslaanBezig': {
    nl: 'Opslaan...',
    ar: 'جارٍ الحفظ…',
    en: 'Saving...',
  },
  'kl.toegevoegd': {
    nl: 'Klant toegevoegd',
    ar: 'أُضيف العميل',
    en: 'Client added',
  },
  'kl.veld.btw': {
    nl: 'BTW nummer',
    ar: 'رقم btw',
    en: 'VAT number',
  },
  'kl.veld.kvk': {
    nl: 'KVK nummer',
    ar: 'رقم KVK',
    en: 'KVK number',
  },
  'kl.veld.naam': {
    nl: 'Naam *',
    ar: 'الاسم *',
    en: 'Name *',
  },
  'kl.veld.naamHint': {
    nl: 'Bedrijfsnaam of naam',
    ar: 'اسم الشركة أو الاسم',
    en: 'Company name or name',
  },
  'kl.verwijderUitleg': {
    nl: '{name} verdwijnt uit je klantenlijst. Facturen die je al aan deze klant stuurde, blijven staan.',
    ar: 'سيختفي {name} من قائمة عملائك. الفواتير التي سبق أن أرسلتها لهذا العميل تبقى محفوظة.',
    en: '{name} disappears from your client list. Invoices you already sent to this client stay in place.',
  },
  'kl.verwijderVraag': {
    nl: 'Klant verwijderen?',
    ar: 'هل تريد حذف العميل؟',
    en: 'Delete this client?',
  },
  'kl.voegEersteToe': {
    nl: 'Voeg je eerste klant toe',
    ar: 'أضف عميلك الأول',
    en: 'Add your first client',
  },
  'klr.btwTeBetalen': {
    nl: 'Concept BTW te betalen',
    ar: 'btw المبدئية للدفع',
    en: 'Draft VAT to pay',
  },
  'klr.btwTerug': {
    nl: 'Concept BTW terug te ontvangen',
    ar: 'btw المبدئية المستردة',
    en: 'Draft VAT to receive back',
  },
  'klr.compleet': {
    nl: 'compleet',
    ar: 'مكتمل',
    en: 'complete',
  },
  'klr.download': {
    nl: 'Download voor de boekhouder',
    ar: 'تنزيل للمحاسب',
    en: 'Download for the accountant',
  },
  'klr.fout.pakket': {
    nl: 'Het pakket kon niet worden gemaakt. Probeer het opnieuw.',
    ar: 'تعذّر إنشاء الحزمة. حاول مرة أخرى.',
    en: 'The package could not be created. Please try again.',
  },
  'klr.fout.pakketOffline': {
    nl: 'Geen verbinding — het pakket is niet gedownload.',
    ar: 'لا يوجد اتصال — لم تُنزَّل الحزمة.',
    en: 'No connection — the package was not downloaded.',
  },
  'klr.kwartaalNietBegonnen': {
    nl: 'Dit kwartaal is nog niet begonnen',
    ar: 'هذا الربع لم يبدأ بعد',
    en: 'This quarter has not started yet',
  },
  'klr.nvt': {
    nl: 'n.v.t.',
    ar: 'لا ينطبق',
    en: 'n/a',
  },
  'klr.pakketBezig': {
    nl: 'Pakket maken…',
    ar: 'جارٍ إنشاء الحزمة…',
    en: 'Creating the package…',
  },
  'klr.rubriek.grijs': {
    nl: 'Het grijze label is hoe zwaar het meetelt in je totaalscore.',
    ar: 'التسمية الرمادية تبيّن وزنه في نتيجتك الإجمالية.',
    en: 'The grey label is how heavily it weighs in your total score.',
  },
  'klr.rubriek.kleur': {
    nl: 'Het gekleurde percentage is hoe compleet dit onderdeel is.',
    ar: 'النسبة الملوّنة تبيّن مدى اكتمال هذا الجزء.',
    en: 'The colored percentage is how complete this part is.',
  },
  'klr.status.bijna': {
    nl: 'Bijna klaar',
    ar: 'شبه جاهز',
    en: 'Almost ready',
  },
  'klr.status.klaar': {
    nl: 'Klaar voor de boekhouder',
    ar: 'جاهز للمحاسب',
    en: 'Ready for the accountant',
  },
  'klr.status.nogNiet': {
    nl: 'Nog niet klaar',
    ar: 'غير جاهز بعد',
    en: 'Not ready yet',
  },
  'klr.weegt': {
    nl: 'weegt {n}%',
    ar: 'يشكّل {n}%',
    en: 'weighs {n}%',
  },
  'klr.zipUitleg': {
    nl: 'Eén ZIP: facturen, bonnen, bankafschrift, dagomzet én je concept BTW-aangifte.',
    ar: 'ملف ZIP واحد: الفواتير والإيصالات وكشف البنك وإيراد الأيام ومسودة إقرار btw.',
    en: 'One ZIP: invoices, receipts, bank statement, daily takings and your draft VAT return.',
  },
  'kw.beheerIndiening': {
    nl: 'Beheer je indiening op Waarheid',
    ar: 'أدر تقديمك في «حقيقتك»',
    en: 'Manage your filing on Truth',
  },
  'kw.conceptAangifte': {
    nl: 'Concept BTW-aangifte Q{q} {jaar}',
    ar: 'مسودة إقرار btw للربع Q{q} {jaar}',
    en: 'Draft VAT return Q{q} {jaar}',
  },
  'kw.exportTitel': {
    nl: 'Alleen de facturen (CSV). Voor de volledige BTW-cijfers incl. pin & contant: gebruik het Kwartaalpakket.',
    ar: 'الفواتير فقط (CSV). لأرقام الضريبة الكاملة بما فيها البطاقة والنقد: استخدم حزمة الربع.',
    en: 'Only the invoices (CSV). For the full VAT figures incl. card & cash: use the quarterly package.',
  },
  'kw.csv': { nl: 'CSV', ar: 'CSV', en: 'CSV' },
  'kw.gedaald': {
    nl: 'gedaald',
    ar: 'انخفاضًا',
    en: 'fallen',
  },
  'kw.geenDatumEen': {
    nl: '1 geverifieerde factuur heeft geen datum en telt niet mee in dit kwartaal. Vul de factuurdatum in, anders is je omzet of BTW-aftrek te laag.',
    ar: 'فاتورة مدققة واحدة بلا تاريخ ولا تُحتسب في هذا الربع. املأ تاريخ الفاتورة وإلا كان إيرادك أو خصم الضريبة منخفضًا.',
    en: '1 verified invoice has no date and does not count in this quarter. Fill in the invoice date, or your revenue or VAT deduction runs too low.',
  },
  'kw.geenDatumEenAcc': {
    nl: '1 geverifieerde factuur heeft geen datum en telt niet mee in dit kwartaal. Vul de factuurdatum in, anders is de omzet of BTW-aftrek te laag.',
    ar: 'فاتورة مدققة واحدة بلا تاريخ ولا تُحتسب في هذا الربع. املأ تاريخ الفاتورة وإلا كان الإيراد أو خصم الضريبة منخفضًا.',
    en: '1 verified invoice has no date and does not count in this quarter. Fill in the invoice date, or the revenue or VAT deduction runs too low.',
  },
  'kw.geenDatumMeer': {
    nl: '{n} geverifieerde facturen hebben geen datum en tellen niet mee in dit kwartaal. Vul de factuurdatum in, anders is je omzet of BTW-aftrek te laag.',
    ar: '{n} فاتورة مدققة بلا تاريخ ولا تُحتسب في هذا الربع. املأ تاريخ الفاتورة وإلا كان إيرادك أو خصم الضريبة منخفضًا.',
    en: '{n} verified invoices have no date and do not count in this quarter. Fill in the invoice date, or your revenue or VAT deduction runs too low.',
  },
  'kw.geenDatumMeerAcc': {
    nl: '{n} geverifieerde facturen hebben geen datum en tellen niet mee in dit kwartaal. Vul de factuurdatum in, anders is de omzet of BTW-aftrek te laag.',
    ar: '{n} فاتورة مدققة بلا تاريخ ولا تُحتسب في هذا الربع. املأ تاريخ الفاتورة وإلا كان الإيراد أو خصم الضريبة منخفضًا.',
    en: '{n} verified invoices have no date and do not count in this quarter. Fill in the invoice date, or the revenue or VAT deduction runs too low.',
  },
  'kw.geenFacturenIn': {
    nl: 'Geen facturen in Q{q} {jaar}',
    ar: 'لا فواتير في الربع {q} {jaar}',
    en: 'No invoices in Q{q} {jaar}',
  },
  'kw.gestegen': {
    nl: 'gestegen',
    ar: 'ارتفاعًا',
    en: 'risen',
  },
  'kw.gewijzigdSindsIndiening': {
    nl: 'Let op — dit kwartaal is gewijzigd sinds indiening',
    ar: 'انتبه — تغيّر هذا الربع منذ التقديم',
    en: 'Note — this quarter has changed since filing',
  },
  'kw.inclPin': {
    nl: 'incl. pin & contant',
    ar: 'شامل البطاقة والنقد',
    en: 'incl. card & cash',
  },
  'kw.inclUitstaand': {
    nl: 'Incl. uitstaand',
    ar: 'شاملاً المبالغ المستحقة',
    en: 'Incl. outstanding',
  },
  'kw.indieningOnbekend': {
    nl: 'We konden niet controleren of dit kwartaal al is ingediend. Ververs de pagina.',
    ar: 'لم نستطع التحقق مما إذا كان هذا الربع قد قُدّم. أعد تحميل الصفحة.',
    en: 'We could not check whether this quarter is already filed. Refresh the page.',
  },
  'kw.ingediendOp': {
    nl: '🔒 Ingediend op {datum} · definitief',
    ar: '🔒 قُدّم بتاريخ {datum} · نهائي',
    en: '🔒 Filed on {datum} · final',
  },
  'kw.inkomstenAlles': {
    nl: 'Facturen — inkomsten (betaald én uitstaand)',
    ar: 'الفواتير — إيرادات (المدفوع والمعلّق)',
    en: 'Invoices — income (paid and outstanding)',
  },
  'kw.inkomstenBetaald': {
    nl: 'Facturen — inkomsten (alleen betaald)',
    ar: 'الفواتير — إيرادات (المدفوع فقط)',
    en: 'Invoices — income (paid only)',
  },
  'kw.kwartaalpakket': {
    nl: 'Kwartaalpakket',
    ar: 'حزمة الربع',
    en: 'Quarterly package',
  },
  'kw.markeerIngediend': {
    nl: 'Markeer als ingediend op Waarheid',
    ar: 'علّمه كمقدَّم في «حقيقتك»',
    en: 'Mark as filed on Truth',
  },
  'kw.naVoorbelasting': {
    nl: 'na voorbelasting',
    ar: 'بعد ضريبة المشتريات',
    en: 'after input VAT',
  },
  'kw.omzetExcl': {
    nl: 'Omzet (excl. BTW)',
    ar: 'الإيراد (بدون btw)',
    en: 'Revenue (excl. VAT)',
  },
  'kw.ontvangenBetaald': {
    nl: 'Ontvangen & betaald',
    ar: 'المقبوض والمدفوع',
    en: 'Received & paid',
  },
  'kw.overBedrag': {
    nl: 'over {bedrag}',
    ar: 'عن {bedrag}',
    en: 'over {bedrag}',
  },
  // [EXPORT-EERLIJK] De CSV-export van het kwartaal. Twee zinnen, net als bij het pakket
  // hieronder: de ene zegt dat de SERVER nee zei, de andere dat het bericht er nooit kwam. Voor
  // wie het leest is dat een ander volgende stap — opnieuw proberen, of eerst je verbinding.
  'kw.exportMislukt': {
    nl: 'Export mislukt — er is niets gedownload',
    ar: 'فشل التصدير — لم يُنزَّل أي ملف',
    en: 'Export failed — nothing was downloaded',
  },
  'kw.exportVerbinding': {
    nl: 'Export mislukt — controleer je verbinding',
    ar: 'فشل التصدير — تحقّق من اتصالك',
    en: 'Export failed — check your connection',
  },
  'kw.pakketMislukt': {
    nl: 'Pakket genereren mislukt — probeer opnieuw',
    ar: 'فشل إنشاء الحزمة — حاول مرة أخرى',
    en: 'Generating the package failed — please try again',
  },
  'kw.pakketTitel': {
    nl: 'Download alle facturen, bonnen en het bankafschrift als één ZIP voor je boekhouder',
    ar: 'نزّل كل الفواتير والإيصالات وكشف البنك في ملف ZIP واحد للمحاسب',
    en: 'Download all invoices, receipts and the bank statement as one ZIP for your accountant',
  },
  'kw.pakketTitelKlant': {
    nl: 'Download alle facturen, bonnen en het bankafschrift van deze klant als één ZIP',
    ar: 'نزّل كل فواتير هذا العميل وإيصالاته وكشفه البنكي في ملف ZIP واحد',
    en: 'Download all this client’s invoices, receipts and bank statement as one ZIP',
  },
  'kw.pakketVerbinding': {
    nl: 'Pakket genereren mislukt — controleer je verbinding',
    ar: 'فشل إنشاء الحزمة — تحقّق من اتصالك',
    en: 'Generating the package failed — check your connection',
  },
  'kw.periode1': {
    nl: 'Januari – Maart',
    ar: 'يناير – مارس',
    en: 'January – March',
  },
  'kw.periode2': {
    nl: 'April – Juni',
    ar: 'أبريل – يونيو',
    en: 'April – June',
  },
  'kw.periode3': {
    nl: 'Juli – September',
    ar: 'يوليو – سبتمبر',
    en: 'July – September',
  },
  'kw.periode4': {
    nl: 'Oktober – December',
    ar: 'أكتوبر – ديسمبر',
    en: 'October – December',
  },
  'kw.suppletieMeer': {
    nl: 'Meer dan €1.000 — dien een suppletie in.',
    ar: 'أكثر من €1.000 — قدّم إقرارًا تصحيحيًا (suppletie).',
    en: 'More than €1,000 — file a correction (suppletie).',
  },
  'kw.suppletieNodig': {
    nl: '⚠️ Suppletie nodig',
    ar: '⚠️ يلزم إقرار تصحيحي (suppletie)',
    en: '⚠️ Correction filing needed',
  },
  'kw.suppletieOnder': {
    nl: 'Onder €1.000 — verwerk dit in je volgende aangifte.',
    ar: 'أقل من €1.000 — أدرجه في إقرارك القادم.',
    en: 'Under €1,000 — process this in your next return.',
  },
  'kw.teLaat': {
    nl: '{bedrag} te laat',
    ar: 'متأخر: {bedrag}',
    en: '{bedrag} overdue',
  },
  'kw.uitgavenAlles': {
    nl: 'Facturen — uitgaven (betaald én uitstaand)',
    ar: 'الفواتير — مصروفات (المدفوع والمعلّق)',
    en: 'Invoices — spending (paid and outstanding)',
  },
  'kw.uitgavenBetaald': {
    nl: 'Facturen — uitgaven (alleen betaald)',
    ar: 'الفواتير — مصروفات (المدفوع فقط)',
    en: 'Invoices — spending (paid only)',
  },
  'kw.verschuldigd5a': {
    nl: 'Verschuldigd (5a)',
    ar: 'المستحق (5a)',
    en: 'Due (5a)',
  },
  'kw.verschuldigdTarief': {
    nl: 'Verschuldigd {rate}%',
    ar: 'المستحق {rate}%',
    en: 'Due {rate}%',
  },
  'kw.voorbelasting5b': {
    nl: 'Voorbelasting (5b)',
    ar: 'الضريبة القابلة للخصم (5b)',
    en: 'Input VAT (5b)',
  },
  'kw.zonderTarief': {
    nl: '{bedrag} omzet staat nog zonder BTW-tarief (contant, bank of een niet-gesplitste kassadag); die BTW zit niet in het bedrag hierboven. Ken het tarief toe bij Kas of Dagomzet.',
    ar: '{bedrag} من الإيراد ما يزال بلا نسبة btw (نقد أو بنك أو يوم كاشير غير مقسّم)؛ ضريبته ليست ضمن المبلغ أعلاه. عيّن النسبة في «النقد» أو «إيراد اليوم».',
    en: '{bedrag} of revenue still has no VAT rate (cash, bank or an unsplit till day); its VAT is not in the amount above. Assign the rate under Cash or Daily takings.',
  },
  'lijst.aan': {
    nl: 'Aan',
    ar: 'إلى',
    en: 'To',
  },
  'lijst.aangemaaktDoor': {
    nl: 'Aangemaakt door {name}',
    ar: 'أنشأها {name}',
    en: 'Created by {name}',
  },
  'lijst.betaaldIn': {
    nl: 'Betaald in {quarter}',
    ar: 'دُفعت في {quarter}',
    en: 'Paid in {quarter}',
  },
  'lijst.betaaldVraag': {
    nl: 'Betaald?',
    ar: 'هل دُفعت؟',
    en: 'Paid?',
  },
  // [BULK-PDF] Meerdere facturen in één keer meenemen.
  'lijst.downloadPdf': {
    nl: 'Download pdf',
    ar: 'تنزيل PDF',
    en: 'Download pdf',
  },
  'lijst.download.mislukt': {
    nl: 'Downloaden lukte niet. Probeer het zo meteen opnieuw.',
    ar: 'لم ينجح التنزيل. أعد المحاولة بعد قليل.',
    en: 'The download did not work. Try again in a moment.',
  },
  'lijst.download.deels': {
    nl: 'Van deze facturen zat geen document in de download: {namen}.',
    ar: 'لم تُدرج مستندات هذه الفواتير في التنزيل: {namen}.',
    en: 'No document was included for these invoices: {namen}.',
  },
  'lijst.betaalverzoek': {
    nl: 'Betaalverzoek',
    ar: 'طلب دفع',
    en: 'Payment request',
  },
  'lijst.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'lijst.btw': {
    nl: 'BTW',
    ar: 'الضريبة',
    en: 'VAT',
  },
  'lijst.btwNummer': {
    nl: 'BTW-nummer',
    ar: 'رقم btw',
    en: 'VAT number',
  },
  'lijst.btwPct': {
    nl: 'BTW ({pct}%)',
    ar: 'الضريبة ({pct}%)',
    en: 'VAT ({pct}%)',
  },
  'lijst.bundel.deel': {
    nl: 'Deel deze link met je klant: ze betalen {amount} in één overboeking, met kenmerk',
    ar: 'شارك هذا الرابط مع عميلك: يدفع {amount} في تحويل واحد، بمرجع',
    en: 'Share this link with your client: they pay {amount} in one transfer, with reference',
  },
  'lijst.bundel.herkent': {
    nl: 'Zodra de betaling in je bankafschrift binnenkomt, herkent BoekBrug alle facturen tegelijk.',
    ar: 'بمجرد وصول الدفعة في كشف حسابك البنكي، يتعرّف BoekBrug على كل الفواتير معًا.',
    en: 'As soon as the payment arrives in your bank statement, BoekBrug recognises all the invoices at once.',
  },
  'lijst.bundel.qrAlt': {
    nl: 'QR naar betaalpagina',
    ar: 'رمز QR لصفحة الدفع',
    en: 'QR to the payment page',
  },
  'lijst.bundel.titel': {
    nl: 'Betaalverzoek voor {count} facturen',
    ar: 'طلب دفع يشمل {count} فاتورة',
    en: 'Payment request for {count} invoices',
  },
  'lijst.creditnotaVoldaan': {
    nl: 'Creditnota {number} voldaan ✓',
    ar: 'سُدّد إشعار الدائن {number} ✓',
    en: 'Credit note {number} settled ✓',
  },
  'lijst.deelbetaling.uitleg': {
    nl: 'Deelbetaling: {paid} van {total} betaald — tik om de rest te noteren',
    ar: 'دفعة جزئية: دُفع {paid} من {total} — انقر لتسجيل الباقي',
    en: 'Partial payment: {paid} of {total} paid — tap to record the rest',
  },
  'lijst.deelGenoteerd': {
    nl: '{applied} genoteerd · nog {remaining} open',
    ar: 'سُجّل {applied} · لا يزال {remaining} مفتوحًا',
    en: '{applied} recorded · {remaining} still open',
  },
  'lijst.deelsBetaald': {
    nl: 'Deels betaald · {open} open',
    ar: 'مدفوعة جزئياً · المتبقي {open}',
    en: 'Partly paid · {open} open',
  },
  // [DEEL-CREDIT] Een creditnota voor een DEEL van de factuur. Niet 'Gecrediteerd' — die belooft
  // dat er niets meer openstaat en dat er niet meer wordt aangemaand, en hier is allebei onwaar.
  // Het bedrag staat in de chip zelf: de ondernemer moet kunnen zien waarom het totaal boven de
  // regel niet meer is wat iemand hem schuldig is.
  // [KAS-DUBBELE-KOST] Dezelfde aankoop twee keer in de boeken: een met de hand getypte kasuitgave
  // naast de inkoopfactuur die er al staat. De zin noemt het BEDRAG en niet alleen het feit — de
  // ondernemer moet kunnen beslissen zonder eerst zelf te rekenen.
  'kas.dubbel.titel': {
    nl: 'Deze uitgave staat mogelijk twee keer in je boeken',
    ar: 'قد تكون هذه المصروفات مسجَّلة مرتين في دفاترك',
    en: 'This expense may be in your books twice',
    tr: 'Bu gider defterlerinizde iki kez yer alıyor olabilir',
  },
  'kas.dubbel.uitleg': {
    nl: 'Je hebt deze kosten met de hand in het kasboek gezet én er staat een inkoopfactuur met hetzelfde bedrag. Dan wordt dezelfde aankoop twee keer als kosten afgetrokken.',
    ar: 'أدخلتَ هذه التكلفة يدويًا في دفتر الصندوق، وتوجد أيضًا فاتورة شراء بنفس المبلغ. عندها تُخصم نفس المشتريات كتكلفة مرتين.',
    en: 'You typed this cost into the cash book by hand, and there is a purchase invoice for the same amount. The same purchase is then deducted as a cost twice.',
    tr: 'Bu gideri kasa defterine elle girdiniz ve aynı tutarda bir alış faturası da var. Aynı alım o zaman iki kez gider olarak düşülüyor.',
  },
  'kas.dubbel.regel': {
    nl: '{datum} · {bedrag} contant · factuur {nummer} van {leverancier}',
    ar: '{datum} · {bedrag} نقدًا · الفاتورة {nummer} من {leverancier}',
    en: '{datum} · {bedrag} cash · invoice {nummer} from {leverancier}',
    tr: '{datum} · {bedrag} nakit · {leverancier} firmasından {nummer} numaralı fatura',
  },
  'kas.dubbel.kosten': {
    nl: '{bedrag} dubbel als kosten',
    ar: '{bedrag} مكرَّرة كتكلفة',
    en: '{bedrag} deducted twice',
    tr: '{bedrag} iki kez gider yazıldı',
  },
  'kas.dubbel.btw': {
    nl: '+ {bedrag} btw dubbel teruggevraagd',
    ar: '+ {bedrag} ضريبة مسترَدّة مرتين',
    en: '+ {bedrag} btw reclaimed twice',
    tr: '+ {bedrag} KDV iki kez geri istendi',
  },
  'kas.dubbel.kasDubbel': {
    nl: 'De factuur is óók op contant gezet, dus je kassaldo staat {bedrag} te laag.',
    ar: 'الفاتورة مُعلَّمة أيضًا كمدفوعة نقدًا، لذا رصيد الصندوق أقل بمقدار {bedrag}.',
    en: 'The invoice is marked paid in cash as well, so your drawer balance is {bedrag} too low.',
    tr: 'Fatura da nakit ödendi olarak işaretli, bu yüzden kasa bakiyeniz {bedrag} düşük görünüyor.',
  },
  // Wat de ondernemer eraan doet. Bewust GEEN knop die het zelf oplost: welke van de twee regels
  // de juiste is, is een vraag over papier dat hij heeft en wij niet.
  'kas.dubbel.watNu': {
    nl: 'Dezelfde aankoop? Verwijder dan de kasregel — de factuur blijft staan en houdt de btw aftrekbaar. Echt twee aankopen? Dan laat je het zo.',
    ar: 'نفس المشتريات؟ إذًا احذف سطر الصندوق — تبقى الفاتورة وتحفظ حق خصم الضريبة. عمليتا شراء مختلفتان فعلًا؟ فاتركه كما هو.',
    en: 'The same purchase? Then remove the cash line — the invoice stays and keeps the VAT deductible. Genuinely two purchases? Then leave it.',
    tr: 'Aynı alım mı? Öyleyse kasa satırını silin — fatura kalır ve KDV indirilebilir olmayı sürdürür. Gerçekten iki ayrı alım mı? O zaman öyle bırakın.',
  },
  'kas.dubbel.naarFactuur': {
    nl: 'Factuur bekijken',
    ar: 'عرض الفاتورة',
    en: 'View the invoice',
    tr: 'Faturayı görüntüle',
  },
  // Het paneel toont een handvol regels en zegt eerlijk hoeveel er nog meer zijn. Een lijst van
  // driehonderd amberkleurige regels wordt niet gelezen maar weggescrold, en dan heeft de melding
  // precies het tegenovergestelde gedaan van wat ze moest doen.
  'kas.dubbel.meer': {
    nl: '+ nog {aantal} andere kasregels met dezelfde vraag.',
    ar: '+ {aantal} سطر صندوق آخر عليها نفس السؤال.',
    en: '+ {aantal} more cash lines with the same question.',
    tr: '+ aynı soruyu taşıyan {aantal} kasa satırı daha.',
  },
  'kas.dubbel.nietGecontroleerd': {
    nl: 'We konden niet nakijken of er kosten dubbel in je boeken staan. Probeer het later opnieuw.',
    ar: 'تعذّر التحقق مما إذا كانت هناك تكاليف مكرَّرة في دفاترك. حاول لاحقًا.',
    en: 'We could not check whether any costs are in your books twice. Try again later.',
    tr: 'Defterlerinizde giderlerin iki kez yer alıp almadığını kontrol edemedik. Daha sonra tekrar deneyin.',
  },
  'lijst.deelsGecrediteerd': {
    nl: 'Deels gecrediteerd · {bedrag} terug',
    ar: 'إشعار دائن جزئي · {bedrag} مُعاد',
    en: 'Partly credited · {bedrag} returned',
    tr: 'Kısmen alacaklandırıldı · {bedrag} iade',
  },
  'lijst.deelsGecrediteerd.uitleg': {
    nl: 'Er is voor {bedrag} gecrediteerd op deze factuur. De rest staat nog open en wordt gewoon aangemaand.',
    ar: 'صدر إشعار دائن بمبلغ {bedrag} على هذه الفاتورة. الباقي ما زال مستحقًا وتُرسَل له التذكيرات كالمعتاد.',
    en: 'A creditnota of {bedrag} was made against this invoice. The rest is still owed and is still chased.',
    tr: 'Bu fatura için {bedrag} tutarında alacak dekontu düzenlendi. Kalanı hâlâ açık ve takip ediliyor.',
  },
  'lijst.dezeKlant': {
    nl: 'deze klant',
    ar: 'هذا العميل',
    en: 'this client',
  },
  'lijst.eenBetaallink': {
    nl: 'Eén betaallink voor {client}',
    ar: 'رابط دفع واحد لـ {client}',
    en: 'One payment link for {client}',
  },
  'lijst.elke.jaar': {
    nl: 'Elk jaar',
    ar: 'كل سنة',
    en: 'Every year',
  },
  'lijst.elke.kwartaal': {
    nl: 'Elk kwartaal',
    ar: 'كل ربع سنة',
    en: 'Every quarter',
  },
  'lijst.elke.maand': {
    nl: 'Elke maand',
    ar: 'كل شهر',
    en: 'Every month',
  },
  'lijst.elke.week': {
    nl: 'Elke week',
    ar: 'كل أسبوع',
    en: 'Every week',
  },
  'lijst.emailNietVerstuurd': {
    nl: 'Factuur {number} kreeg een nummer, maar de e-mail is niet verstuurd — verstuur opnieuw',
    ar: 'حصلت الفاتورة {number} على رقم، لكن البريد الإلكتروني لم يُرسَل — أعد الإرسال',
    en: 'Invoice {number} was given a number, but the e-mail was not sent — send again',
  },
  'lijst.emailNietVerstuurdZonder': {
    nl: 'De e-mail is niet verstuurd — verstuur de factuur opnieuw',
    ar: 'لم يُرسَل البريد الإلكتروني — أعد إرسال الفاتورة',
    en: 'The e-mail was not sent — send the invoice again',
  },
  'lijst.exclBtw': {
    nl: 'Excl. BTW',
    ar: 'بدون btw',
    en: 'Excl. VAT',
  },
  'lijst.factuurBetaald': {
    nl: 'Factuur {number} betaald ✓',
    ar: 'الفاتورة {number} مدفوعة ✓',
    en: 'Invoice {number} paid ✓',
  },
  'lijst.fout.hervatten': {
    nl: 'Hervatten mislukt',
    ar: 'فشل الاستئناف',
    en: 'Resuming failed',
  },
  'lijst.fout.offerteVersturen': {
    nl: 'Versturen lukte niet.',
    ar: 'لم ينجح الإرسال.',
    en: 'Sending did not work.',
  },
  'lijst.fout.pauzeren': {
    nl: 'Pauzeren mislukt',
    ar: 'فشل الإيقاف المؤقت',
    en: 'Pausing failed',
  },
  'lijst.fout.verzenden': {
    nl: 'Verzenden mislukt',
    ar: 'فشل الإرسال',
    en: 'Sending failed',
  },
  'lijst.gearchiveerd': {
    nl: 'GEARCHIVEERD',
    ar: 'مؤرشفة',
    en: 'ARCHIVED',
  },
  'lijst.gecrediteerd.uitleg': {
    nl: 'Er is een creditnota voor deze factuur gemaakt — hij wordt niet meer aangemaand en telt niet mee als openstaand.',
    ar: 'صدر إشعار دائن لهذه الفاتورة — لن تُرسَل لها تذكيرات ولا تُحتسب ضمن المستحق.',
    en: 'A creditnota was made for this invoice — it is no longer chased and no longer counts as outstanding.',
  },
  'lijst.gekopieerd': {
    nl: 'Gekopieerd',
    ar: 'تم النسخ',
    en: 'Copied',
  },
  'lijst.geselecteerd': {
    nl: '{count} geselecteerd · {amount}',
    ar: 'المحدد: {count} · {amount}',
    en: '{count} selected · {amount}',
  },
  'lijst.gestart.jaar': {
    nl: 'Herhaalt elk jaar — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل سنة — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every year — the next draft will be ready on {date}',
  },
  'lijst.gestart.kwartaal': {
    nl: 'Herhaalt elk kwartaal — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل ربع سنة — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every quarter — the next draft will be ready on {date}',
  },
  'lijst.gestart.maand': {
    nl: 'Herhaalt elke maand — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل شهر — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every month — the next draft will be ready on {date}',
  },
  'lijst.gestart.week': {
    nl: 'Herhaalt elke week — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل أسبوع — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every week — the next draft will be ready on {date}',
  },
  'lijst.herhaalt.jaar': {
    nl: 'Herhaalt elk jaar',
    ar: 'تتكرر كل سنة',
    en: 'Repeats every year',
  },
  'lijst.herhaalt.kwartaal': {
    nl: 'Herhaalt elk kwartaal',
    ar: 'تتكرر كل ربع سنة',
    en: 'Repeats every quarter',
  },
  'lijst.herhaalt.maand': {
    nl: 'Herhaalt elke maand',
    ar: 'تتكرر كل شهر',
    en: 'Repeats every month',
  },
  'lijst.herhaalt.week': {
    nl: 'Herhaalt elke week',
    ar: 'تتكرر كل أسبوع',
    en: 'Repeats every week',
  },
  'lijst.herhalen.gepauzeerd': {
    nl: 'Herhalen gepauzeerd — er wordt niets meer klaargezet',
    ar: 'أُوقف التكرار مؤقتًا — لن يُجهَّز شيء بعد الآن',
    en: 'Repeating paused — nothing more will be prepared',
  },
  'lijst.herhalen.hervat': {
    nl: 'Herhalen hervat',
    ar: 'استُؤنف التكرار',
    en: 'Repeating resumed',
  },
  // [KNOP-RESULTAAT] A button is named for what it LEAVES BEHIND, not for the verb behind it.
  //
  // These two sat side by side on a sent sales invoice and both read as "again": "Nog een keer"
  // and "Herhalen". One makes a single draft, now, and opens it for editing; the other sets up a
  // series that keeps preparing drafts every week, month, quarter or year. The owner asked which
  // was which — and a label whose own reader has to ask is a label that failed at its one job.
  //
  // So each says its outcome: a COPY, or a SCHEDULE. The state labels below take over once a
  // schedule exists ("Herhaalt elke maand"), which is the same story one step further on.
  'lijst.herhalen.knop': {
    nl: 'Factuur inplannen',
    ar: 'جدولة الفاتورة',
    en: 'Schedule invoice',
  },
  // [BESTE · KNOP-RESULTAAT] The copy every package puts beside a sent invoice — a new concept with
  // the same customer and lines, opened for editing.
  'lijst.kopieMaken': { nl: 'Kopie maken', ar: 'إنشاء نسخة', en: 'Make a copy' },
  'lijst.kopieMaken.mislukt': { nl: 'Kopiëren is niet gelukt.', ar: 'لم ينجح النسخ.', en: 'Copying did not work.' },
  // [BESTE] The money above the list: what is still to come in, and how much of it is late.
  'lijst.kop.openstaand': { nl: 'Openstaand', ar: 'مستحق', en: 'Outstanding' },
  'lijst.kop.teLaat': { nl: 'Te laat', ar: 'متأخر', en: 'Late' },
  'lijst.kop.aantal': { nl: '{n} facturen', ar: '{n} فاتورة', en: '{n} invoices' },
  'lijst.kop.een': { nl: '1 factuur', ar: 'فاتورة واحدة', en: '1 invoice' },
  'lijst.herhalen.pauzeLabel': {
    nl: 'Herhalen gepauzeerd',
    ar: 'التكرار متوقف مؤقتًا',
    en: 'Repeating paused',
  },
  'lijst.hervat': {
    nl: 'Hervatten',
    ar: 'استئناف',
    en: 'Resume',
  },
  'lijst.hervatten': {
    nl: 'Hervatten',
    ar: 'استئناف',
    en: 'Resume',
  },
  'lijst.inclBtw': {
    nl: 'Incl. BTW',
    ar: 'شامل btw',
    en: 'Incl. VAT',
  },
  'lijst.klaar': {
    nl: 'Klaar',
    ar: 'جاهز',
    en: 'Done',
  },
  'lijst.kopieerLink': {
    nl: 'Kopieer link',
    ar: 'نسخ الرابط',
    en: 'Copy link',
  },
  'lijst.kwartaal.uitleg': {
    nl: 'Btw: telt mee in {booked} (factuurdatum). Betaling binnen in {paid}.',
    ar: 'ضريبة القيمة المضافة: تُحتسب في {booked} (تاريخ الفاتورة). وصل الدفع في {paid}.',
    en: 'Btw: counts in {booked} (invoice date). Payment received in {paid}.',
  },
  'lijst.laden': {
    nl: 'Laden...',
    ar: 'جارٍ التحميل…',
    en: 'Loading...',
  },
  'lijst.minimaalTwee': {
    nl: 'Kies minimaal 2 openstaande facturen',
    ar: 'اختر فاتورتين مستحقتين على الأقل',
    en: 'Choose at least 2 open invoices',
  },
  'lijst.nieuwste': {
    nl: 'Nieuwste',
    ar: 'الأحدث',
    en: 'Newest',
  },
  'lijst.offerte.opnieuw': {
    nl: 'Opnieuw versturen',
    ar: 'إعادة الإرسال',
    en: 'Send again',
  },
  'lijst.offerte.versturen': {
    nl: 'Offerte versturen',
    ar: 'إرسال عرض السعر',
    en: 'Send the quote',
  },
  'lijst.offerteVerstuurd': {
    nl: 'De offerte is verstuurd.',
    ar: 'أُرسل عرض السعر.',
    en: 'The quote has been sent.',
  },
  'lijst.opnieuwVerzonden': {
    nl: 'Factuur {number} opnieuw verzonden ✓',
    ar: 'أُعيد إرسال الفاتورة {number} ✓',
    en: 'Invoice {number} sent again ✓',
  },
  'lijst.opnieuwVerzondenZonder': {
    nl: 'Factuur opnieuw verzonden ✓',
    ar: 'أُعيد إرسال الفاتورة ✓',
    en: 'Invoice sent again ✓',
  },
  'lijst.oudste': {
    nl: 'Oudste',
    ar: 'الأقدم',
    en: 'Oldest',
  },
  'lijst.pauzeer': {
    nl: 'Pauzeren',
    ar: 'إيقاف مؤقت',
    en: 'Pause',
  },
  'lijst.pauzeren': {
    nl: 'Pauzeren',
    ar: 'إيقاف مؤقت',
    en: 'Pause',
  },
  'lijst.pay.body': {
    nl: 'Factuur {number} wordt als betaald gemarkeerd en doorgestuurd naar uw accountant. Weet u het zeker?',
    ar: 'ستوضع علامة مدفوعة على الفاتورة {number} وستُحال إلى محاسبك. هل أنت متأكد؟',
    en: 'Invoice {number} will be marked as paid and forwarded to your accountant. Are you sure?',
  },
  'lijst.pay.creditBody': {
    nl: 'Weet u zeker dat u creditnota {number} als voldaan wilt markeren?',
    ar: 'هل أنت متأكد من وضع علامة مسدَّد على إشعار الدائن {number}؟',
    en: 'Are you sure you want to mark credit note {number} as settled?',
  },
  'lijst.pay.creditOngedaanBody': {
    nl: 'Creditnota {number} wordt teruggeplaatst naar \'Verzonden\'.',
    ar: 'سيُعاد إشعار الدائن {number} إلى «مُرسَلة».',
    en: 'Credit note {number} will be put back to \'Sent\'.',
  },
  'lijst.pay.creditOngedaanTitel': {
    nl: 'Voldaan status ongedaan maken?',
    ar: 'التراجع عن حالة التسديد؟',
    en: 'Undo the settled status?',
  },
  'lijst.pay.creditTitel': {
    nl: 'Creditnota als voldaan markeren?',
    ar: 'وضع علامة مسدَّدة على إشعار الدائن؟',
    en: 'Mark the credit note as settled?',
  },
  'lijst.pay.jaBetaald': {
    nl: 'Ja, markeer als betaald',
    ar: 'نعم، علّمها كمدفوعة',
    en: 'Yes, mark as paid',
  },
  'lijst.pay.jaOngedaan': {
    nl: 'Ja, ongedaan maken',
    ar: 'نعم، تراجَع',
    en: 'Yes, undo',
  },
  'lijst.pay.jaVoldaan': {
    nl: 'Ja, voldaan',
    ar: 'نعم، سُدّدت',
    en: 'Yes, settled',
  },
  'lijst.pay.leegAlles': {
    nl: 'Leeg laten = alles betaald ({amount})',
    ar: 'اتركه فارغًا = دُفع الكل ({amount})',
    en: 'Leave empty = everything paid ({amount})',
  },
  'lijst.pay.nogOpen': {
    nl: 'Nog openstaand: {amount} — kies hieronder hoe je dit deel betaalde',
    ar: 'المتبقي: {amount} — اختر أدناه كيف دُفع هذا الجزء',
    en: 'Still open: {amount} — choose below how this part was paid',
  },
  'lijst.pay.ongedaan': {
    nl: 'Ongedaan maken',
    ar: 'تراجع',
    en: 'Undo',
  },
  'lijst.pay.ongedaanBody': {
    nl: 'Factuur {number} wordt teruggeplaatst naar \'Verzonden\'.',
    ar: 'ستُعاد الفاتورة {number} إلى «مُرسَلة».',
    en: 'Invoice {number} will be put back to \'Sent\'.',
  },
  'lijst.pay.ongedaanTitel': {
    nl: 'Betaling ongedaan maken?',
    ar: 'التراجع عن الدفعة؟',
    en: 'Undo the payment?',
  },
  'lijst.pay.titel': {
    nl: 'Factuur markeren als betaald?',
    ar: 'وضع علامة مدفوعة على الفاتورة؟',
    en: 'Mark the invoice as paid?',
  },
  'lijst.pay.volledig': {
    nl: 'Hiermee is de factuur volledig betaald.',
    ar: 'بهذه تكون الفاتورة مسددة بالكامل.',
    en: 'This settles the invoice in full.',
  },
  'lijst.pdfNietGemaakt': {
    nl: 'Factuur {number}: nummer uitgegeven, maar de PDF is niet gemaakt — verstuur opnieuw',
    ar: 'الفاتورة {number}: صدر الرقم، لكن ملف PDF لم يُنشأ — أعد الإرسال',
    en: 'Invoice {number}: number issued, but the PDF was not made — send again',
  },
  'lijst.pdfNietGemaaktZonder': {
    nl: 'De PDF kon niet worden gemaakt — verstuur de factuur opnieuw',
    ar: 'تعذّر إنشاء ملف PDF — أعد إرسال الفاتورة',
    en: 'The PDF could not be created — send the invoice again',
  },
  'lijst.repeat.actiefBody': {
    nl: 'Het volgende concept voor {client} staat klaar op {date}.',
    ar: 'المسودة التالية لـ {client} تكون جاهزة في {date}.',
    en: 'The next draft for {client} will be ready on {date}.',
  },
  'lijst.repeat.actiefTitel': {
    nl: 'Deze factuur herhaalt',
    ar: 'هذه الفاتورة تتكرر',
    en: 'This invoice repeats',
  },
  'lijst.repeat.blijftStaan': {
    nl: 'Concepten die al klaarstaan blijven staan — stoppen raakt alleen de herhaling zelf.',
    ar: 'المسودات الجاهزة تبقى كما هي — الإيقاف يمس التكرار نفسه فقط.',
    en: 'Drafts already prepared stay put — stopping only affects the repeat itself.',
  },
  'lijst.repeat.pauzeBody': {
    nl: 'Er wordt niets klaargezet voor {client} zolang dit op pauze staat. Het schema blijft bewaard.',
    ar: 'لن يُجهَّز شيء لـ {client} ما دام هذا متوقفًا مؤقتًا. يبقى الجدول محفوظًا.',
    en: 'Nothing will be prepared for {client} while this is paused. The schedule stays saved.',
  },
  'lijst.repeat.pauzeTitel': {
    nl: 'Herhalen staat op pauze',
    ar: 'التكرار متوقف مؤقتًا',
    en: 'Repeating is paused',
  },
  'lijst.repeat.stoppenKan': {
    nl: 'Stoppen kan altijd — het herhalen staat bij deze factuur en raakt de facturen die al klaarstaan nooit.',
    ar: 'يمكنك الإيقاف في أي وقت — التكرار مرتبط بهذه الفاتورة ولا يمس الفواتير الجاهزة أبدًا.',
    en: 'You can stop at any time — the repeat belongs to this invoice and never touches invoices already prepared.',
  },
  'lijst.repeat.titel': {
    nl: 'Hoe vaak herhalen?',
    ar: 'كم مرة يتكرر؟',
    en: 'How often should it repeat?',
  },
  'lijst.repeat.uitleg': {
    nl: 'We maken deze factuur voor {client} telkens opnieuw klaar — met dezelfde regels en hetzelfde betaaltermijn. Je krijgt een concept dat je zelf verstuurt.',
    ar: 'نُجهّز هذه الفاتورة لـ {client} من جديد في كل مرة — بالبنود نفسها ومهلة الدفع نفسها. تحصل على مسودة ترسلها بنفسك.',
    en: 'We prepare this invoice for {client} again each time — with the same lines and the same payment term. You get a draft that you send yourself.',
  },
  'lijst.schema.jaar': {
    nl: 'elk jaar · volgende {date}',
    ar: 'كل سنة · التالية في {date}',
    en: 'every year · next {date}',
  },
  'lijst.schema.jaarPauze': {
    nl: 'elk jaar · gepauzeerd',
    ar: 'كل سنة · متوقف مؤقتًا',
    en: 'every year · paused',
  },
  'lijst.schema.kwartaal': {
    nl: 'elk kwartaal · volgende {date}',
    ar: 'كل ربع سنة · التالية في {date}',
    en: 'every quarter · next {date}',
  },
  'lijst.schema.kwartaalPauze': {
    nl: 'elk kwartaal · gepauzeerd',
    ar: 'كل ربع سنة · متوقف مؤقتًا',
    en: 'every quarter · paused',
  },
  'lijst.schema.maand': {
    nl: 'elke maand · volgende {date}',
    ar: 'كل شهر · التالية في {date}',
    en: 'every month · next {date}',
  },
  'lijst.schema.maandPauze': {
    nl: 'elke maand · gepauzeerd',
    ar: 'كل شهر · متوقف مؤقتًا',
    en: 'every month · paused',
  },
  'lijst.schema.week': {
    nl: 'elke week · volgende {date}',
    ar: 'كل أسبوع · التالية في {date}',
    en: 'every week · next {date}',
  },
  'lijst.schema.weekPauze': {
    nl: 'elke week · gepauzeerd',
    ar: 'كل أسبوع · متوقف مؤقتًا',
    en: 'every week · paused',
  },
  'lijst.selecteer': {
    nl: 'Selecteren',
    ar: 'تحديد',
    en: 'Select',
  },
  'lijst.send.bedrag': {
    nl: 'Bedrag',
    ar: 'المبلغ',
    en: 'Amount',
  },
  'lijst.send.bevestig': {
    nl: 'Bevestig de gegevens voordat je de factuur verstuurt.',
    ar: 'تحقّق من البيانات قبل إرسال الفاتورة.',
    en: 'Confirm the details before you send the invoice.',
  },
  'lijst.send.email': {
    nl: 'E-mail',
    ar: 'البريد الإلكتروني',
    en: 'E-mail',
  },
  'lijst.send.nummer': {
    nl: 'Factuurnummer',
    ar: 'رقم الفاتورة',
    en: 'Invoice number',
  },
  'lijst.send.nummerVolgt': {
    nl: 'Wordt toegekend bij verzenden',
    ar: 'يُمنح عند الإرسال',
    en: 'Assigned when sending',
  },
  'lijst.send.titel': {
    nl: 'Versturen naar {name}?',
    ar: 'إرسال إلى {name}؟',
    en: 'Send to {name}?',
  },
  // [HERSTEL] Dezelfde correctie als bewerk.modal.waarschuwing — twee schermen versturen een
  // factuur, en ze mogen niet iets anders beweren over hetzelfde document.
  'lijst.vervangenDoor': {
    nl: 'Vervangen door {number}',
    ar: 'أُستبدلت بـ {number}',
    en: 'Replaced by {number}',
  },
  'lijst.verwerktUitleg': {
    nl: 'De boekhouder heeft factuur {number} al verwerkt. Vraag eerst om dat ongedaan te maken.',
    ar: 'عالج المحاسب الفاتورة {number} مسبقًا. اطلب أولًا التراجع عن ذلك.',
    en: 'The accountant already processed invoice {number}. First ask to undo that.',
  },
  'lijst.verwijderdTerug': {
    nl: 'Verwijderd — terug te zetten onderaan de lijst',
    ar: 'حُذفت — يمكن إعادتها من أسفل القائمة',
    en: 'Deleted — can be restored at the bottom of the list',
  },
  'lijst.verwijderen.aria': {
    nl: 'Factuur {number} verwijderen',
    ar: 'حذف الفاتورة {number}',
    en: 'Delete invoice {number}',
  },
  'lijst.verzoekGestuurd': {
    nl: 'Je verzoek voor factuur {number} is naar de boekhouder gestuurd.',
    ar: 'أُرسل طلبك بخصوص الفاتورة {number} إلى المحاسب.',
    en: 'Your request for invoice {number} has been sent to your accountant.',
  },
  'lijst.verzonden': {
    nl: 'Factuur {number} verzonden ✓',
    ar: 'أُرسلت الفاتورة {number} ✓',
    en: 'Invoice {number} sent ✓',
  },
  'lijst.verzondenZonder': {
    nl: 'Factuur verzonden ✓',
    ar: 'أُرسلت الفاتورة ✓',
    en: 'Invoice sent ✓',
  },
  'lijst.zelfdeKlant': {
    nl: 'Kies facturen van dezelfde klant',
    ar: 'اختر فواتير من العميل نفسه',
    en: 'Choose invoices from the same client',
  },
  'lijst.zoek.geen': {
    nl: 'Geen facturen gevonden voor “{query}”',
    ar: 'لم يُعثر على فواتير لـ «{query}»',
    en: 'No invoices found for “{query}”',
  },
  'nieuw.banner.offerteUitleg': {
    nl: 'geen factuurnummer. Gebruik “Maak factuur aan” als de klant akkoord gaat.',
    ar: 'بلا رقم فاتورة. استخدم «إنشاء الفاتورة» عند موافقة العميل.',
    en: 'no invoice number. Use “Create the invoice” once the client agrees.',
  },
  'nieuw.banner.overnemenVraag': {
    nl: 'Wil je hem hier overnemen? Je factuurnummer krijg je van ons — dat loopt door in je eigen reeks.',
    ar: 'هل تريد استيرادها هنا؟ رقم الفاتورة ستحصل عليه منا — وهو يستمر ضمن سلسلتك الخاصة.',
    en: 'Do you want to take it over here? Your invoice number comes from us — it continues in your own sequence.',
  },
  'nieuw.banner.vanOfferteUitleg': {
    nl: 'gegevens zijn vooringevuld. De offerte wordt gearchiveerd na opslaan.',
    ar: 'البيانات معبّأة مسبقًا. يُؤرشف عرض السعر بعد الحفظ.',
    en: 'details are pre-filled. The quote is archived after saving.',
  },
  'nieuw.banner.vervangendUitleg': {
    nl: 'voor {number}. De oude factuur wordt automatisch gearchiveerd.',
    ar: 'عن {number}. تُؤرشف الفاتورة القديمة تلقائيًا.',
    en: 'for {number}. The old invoice is archived automatically.',
  },
  'nieuw.betaal.opNaamVan': {
    nl: 'Op naam van',
    ar: 'باسم',
    en: 'In the name of',
  },
  'nieuw.credit.linkNa': {
    nl: '— dan blijft de koppeling behouden.',
    ar: '— هكذا يبقى الربط محفوظًا.',
    en: '— that keeps the link intact.',
  },
  'nieuw.credit.linkTekst': {
    nl: 'vanaf de factuur zelf',
    ar: 'من صفحة الفاتورة نفسها',
    en: 'from the invoice itself',
  },
  'nieuw.credit.linkVoor': {
    nl: 'Staat de originele factuur wél in BoekBrug? Crediteer die dan',
    ar: 'هل الفاتورة الأصلية موجودة في BoekBrug؟ اعكِسها إذن',
    en: 'Is the original invoice in BoekBrug after all? Then credit it',
  },
  // [CREDITNOTA-EXTERN] The invoice a standalone creditnota corrects (art. 219 btw-richtlijn).
  'nieuw.credit.verwijzingNummer': { nl: 'Nummer van de gecrediteerde factuur', ar: 'رقم الفاتورة المُعكوسة', en: 'Number of the credited invoice' },
  'nieuw.credit.verwijzingDatum': { nl: 'Datum van die factuur', ar: 'تاريخ تلك الفاتورة', en: 'Date of that invoice' },
  'nieuw.credit.verwijzingHint': {
    nl: 'Verplicht: een creditnota noemt de factuur die ze corrigeert (art. 219 btw-richtlijn).',
    ar: 'إلزامي: الإشعار الدائن يذكر الفاتورة التي يصحّحها (المادة 219 من توجيه ضريبة القيمة المضافة).',
    en: 'Required: a credit note names the invoice it corrects (art. 219 VAT Directive).',
  },
  'nieuw.fout.creditVerwijzing': {
    nl: 'Vul het nummer in van de factuur die deze creditnota corrigeert.',
    ar: 'أدخل رقم الفاتورة التي يصحّحها هذا الإشعار الدائن.',
    en: 'Enter the number of the invoice this credit note corrects.',
  },
  'nieuw.credit.uitleg': {
    nl: 'bedragen worden automatisch negatief. Vul het formulier in zoals een gewone factuur. Gebruik dit voor een factuur die niet in BoekBrug staat.',
    ar: 'تصبح المبالغ سالبة تلقائيًا. املأ النموذج كفاتورة عادية. استخدم هذا لفاتورة غير موجودة في BoekBrug.',
    en: 'amounts automatically become negative. Fill in the form like a normal invoice. Use this for an invoice that is not in BoekBrug.',
  },
  'nieuw.fout.euBtwLengte': {
    nl: 'BTW-nummer {number} heeft niet de lengte van dat EU-land. Controleer het bij de klant (of via VIES) — het bepaalt of de BTW verlegd mag worden en of de klant in de ICP-opgaaf komt.',
    ar: 'رقم btw {number} ليس بطول ذلك البلد الأوروبي. تحقّق منه لدى العميل (أو عبر VIES) — فهو يحدّد إن كان يجوز تحويل الضريبة وإن كان العميل يدخل في بيان ICP-opgaaf.',
    en: 'VAT number {number} does not have that EU country\'s length. Check it with the client (or via VIES) — it decides whether the VAT may be reverse-charged and whether the client goes on the ICP-opgaaf.',
  },
  'nieuw.gegevens.adresKvk': {
    nl: 'adres/KVK',
    ar: 'العنوان/KVK',
    en: 'address/KVK',
  },
  'nieuw.gegevens.btwGeldig': {
    nl: 'geldig BTW-nummer (NL…B01)',
    ar: 'رقم btw صالح (NL…B01)',
    en: 'valid VAT number (NL…B01)',
  },
  'nieuw.gegevens.btwNummer': {
    nl: 'BTW-nummer',
    ar: 'رقم btw',
    en: 'VAT number',
  },
  'nieuw.gegevens.missen': {
    nl: 'Je gegevens missen: {list}. Een factuur is wettelijk pas volledig met deze gegevens.',
    ar: 'بياناتك ناقصة: {list}. الفاتورة لا تكتمل قانونيًا إلا بهذه البيانات.',
    en: 'Your details are missing: {list}. An invoice is only legally complete with these details.',
  },
  'nieuw.klant.euBtwInfo': {
    nl: 'Klant in een ander EU-land: bij een intracommunautaire prestatie zet je 0% BTW. “Btw verlegd” komt dan automatisch op de factuur en de klant komt in je ICP-opgaaf.',
    ar: 'العميل في بلد أوروبي آخر: عند خدمة داخل الاتحاد الأوروبي تختار 0% ضريبة القيمة المضافة. تُطبع «Btw verlegd» تلقائيًا على الفاتورة ويدخل العميل في بيان ICP-opgaaf.',
    en: 'Client in another EU country: for an intra-community supply you set 0% VAT. “Btw verlegd” then appears on the invoice automatically and the client goes on your ICP-opgaaf.',
  },
  'nieuw.klant.euBtwLengte': {
    nl: 'Deze lengte klopt niet voor dat EU-land — controleer via VIES. Het bepaalt de BTW-verlegging én de ICP-opgaaf.',
    ar: 'هذا الطول غير صحيح لذلك البلد الأوروبي — تحقّق عبر VIES. فهو يحدّد تحويل الضريبة وبيان ICP-opgaaf.',
    en: 'This length is not right for that EU country — check via VIES. It decides the VAT reverse charge and the ICP declaration.',
  },
  'nieuw.korting.hintBedrag': {
    nl: 'bijv. 50,00',
    ar: 'مثلًا 50,00',
    en: 'e.g. 50.00',
  },
  'nieuw.korting.hintPercentage': {
    nl: 'bijv. 10',
    ar: 'مثلًا 10',
    en: 'e.g. 10',
  },
  'nieuw.prijsmodus.exclKnop': {
    nl: 'excl. btw',
    ar: 'بدون الضريبة',
    en: 'excl. VAT',
  },
  'nieuw.prijsmodus.inclKnop': {
    nl: 'incl. btw',
    ar: 'شامل الضريبة',
    en: 'incl. VAT',
  },
  'nieuw.regel.exclTussen': {
    nl: '({amount} excl.)',
    ar: '({amount} بدون الضريبة)',
    en: '({amount} excl.)',
  },
  'nieuw.regel.toevoegen': {
    nl: 'Regel toevoegen',
    ar: 'إضافة بند',
    en: 'Add a line',
  },
  'nieuw.regel.totaalExcl': {
    nl: 'Totaal excl.',
    ar: 'الإجمالي بدون الضريبة',
    en: 'Total excl.',
  },
  'nieuw.regel.totaalIncl': {
    nl: 'Totaal incl.',
    ar: 'الإجمالي شامل الضريبة',
    en: 'Total incl.',
  },
  'nieuw.termijn.aantalDagen': {
    nl: '{days} dagen',
    ar: '{days} يوماً',
    en: '{days} days',
  },
  'nieuw.termijn.of': {
    nl: 'of',
    ar: 'أو',
    en: 'or',
  },
  'plan.actief': {
    nl: '{name} — actief',
    ar: '{name} — مفعّل',
    en: '{name} — active',
  },
  'plan.betaaldUitleg': {
    nl: 'Het kan een paar seconden duren voordat je plan hieronder bijgewerkt is. Ververs deze pagina als je het nog niet ziet.',
    ar: 'قد يستغرق تحديث خطتك أدناه بضع ثوانٍ. أعد تحميل هذه الصفحة إن لم ترها بعد.',
    en: 'It can take a few seconds before your plan below is updated. Refresh this page if you do not see it yet.',
  },
  'plan.betalingMislukt': {
    nl: 'Betaling mislukt — we proberen het opnieuw, je houdt Plus',
    ar: 'فشل الدفع — سنحاول مرة أخرى، وتحتفظ بـPlus',
    en: 'Payment failed — we will retry, you keep Plus',
  },
  'plan.bijnaGrens': {
    nl: 'Je zit op {pct}% van deze grens. Er gebeurt nu nog niets — dit is alleen zodat je het weet.',
    ar: 'أنت عند {pct}% من هذا الحد. لا يحدث شيء الآن — هذا فقط لتكون على علم.',
    en: 'You are at {pct}% of this limit. Nothing happens yet — this is only so you know.',
  },
  'plan.geenProefperiode': {
    nl: 'en er is geen proefperiode die stilzwijgend een abonnement wordt. Boven het eerlijk gebruik pauzeert alleen wat ons geld kost; inzien, doorzoeken en exporteren van je administratie blijven altijd werken.',
    ar: 'ولا توجد فترة تجريبية تتحول بصمت إلى اشتراك. فوق الاستخدام العادل يتوقف مؤقتًا فقط ما يكلفنا مالًا؛ أما الاطلاع على إدارتك والبحث فيها وتصديرها فتبقى متاحة دائمًا.',
    en: 'and there is no trial period that silently becomes a subscription. Beyond fair use only what costs us money pauses; viewing, searching and exporting your administration always keep working.',
  },
  // [WELKOM-90] De eerste 90 dagen. Geen "proef": er hangt geen kaart aan en er volgt geen
  // incasso — na afloop geldt gewoon het gratis plan. Daarom heet het hier een welkomstperiode
  // en nergens een proefperiode.
  'plan.welkomstperiode': {
    nl: 'Je eerste 90 dagen — alles van Plus',
    ar: 'أول 90 يوماً — كل ما في Plus',
    en: 'Your first 90 days — everything in Plus',
  },
  'plan.welkomTot': {
    nl: 'Nog tot',
    ar: 'حتى',
    en: 'Until',
  },
  'plan.welkomDaarna': {
    nl: 'Daarna ga je verder op het gratis plan. Er wordt niets afgeschreven en je hoeft niets te doen.',
    ar: 'بعدها تتابع على الخطة المجانية. لا يُخصم شيء ولا يلزمك فعل أي شيء.',
    en: 'After that you continue on the free plan. Nothing is charged and you need to do nothing.',
  },
  'plan.gratis': {
    nl: 'Gratis',
    ar: 'مجاني',
    en: 'Free',
  },
  'plan.looptAf': {
    nl: 'Plus loopt af — je houdt hem tot het einde van de betaalde periode',
    ar: 'ينتهي Plus — تحتفظ به حتى نهاية الفترة المدفوعة',
    en: 'Plus is ending — you keep it until the end of the paid period',
  },
  'plan.maandtellers': {
    nl: 'De maandtellers beginnen op de 1e weer bij nul. Opslag en mailboxen worden gemeten zoals ze nu zijn, niet opgeteld over de maand.',
    ar: 'تعود عدادات الشهر إلى الصفر في اليوم الأول منه. تُقاس المساحة وصناديق البريد كما هي الآن، لا مجموعةً على مدار الشهر.',
    en: 'The monthly counters start again at zero on the 1st. Storage and mailboxes are measured as they are now, not summed over the month.',
  },
  'plan.migratieOntbreekt': {
    nl: 'De abonnementskolommen bestaan nog niet in de database (billing_subscription.sql is nog niet toegepast). Alles werkt, maar een lopend Plus-abonnement kan hier nog niet worden getoond.',
    ar: 'أعمدة الاشتراك غير موجودة بعد في قاعدة البيانات (billing_subscription.sql لم يُطبَّق بعد). كل شيء يعمل، لكن اشتراك Plus الجاري لا يمكن عرضه هنا بعد.',
    en: 'The subscription columns do not exist in the database yet (billing_subscription.sql has not been applied). Everything works, but a running Plus subscription cannot be shown here yet.',
  },
  'plan.nooitAfgeschreven': {
    nl: 'nooit automatisch afgeschreven',
    ar: 'في مأمن من أي خصم تلقائي',
    en: 'exempt from any automatic charge',
  },
  'plan.plusLooptTot': {
    nl: 'Plus loopt tot',
    ar: 'يستمر Plus حتى',
    en: 'Plus runs until',
  },
  'plan.volgendeVerlenging': {
    nl: 'Volgende verlenging',
    ar: 'التجديد التالي',
    en: 'Next renewal',
  },
  'plan.waarschuwenVanaf': {
    nl: 'Wij waarschuwen vanaf {pct}% van een grens, en wat er dan gebeurt staat er per regel bij.',
    ar: 'نحذّرك اعتبارًا من {pct}% من أي حد، وما يحدث عندها مذكور عند كل سطر.',
    en: 'We warn from {pct}% of a limit, and what happens then is stated per line.',
  },
  'start.meldingenFout': {
    nl: 'Meldingen niet opgehaald; dat zegt niets over of er meldingen zijn. Probeer zo opnieuw.',
    ar: 'لم تُجلب الإشعارات؛ وهذا لا يقول شيئًا عن وجود إشعارات. حاول بعد قليل.',
    en: 'Notifications not fetched; that says nothing about whether there are any. Try again shortly.',
  },
  'team.eerderUitleg': {
    nl: 'Deze mensen kunnen niets meer. Ze blijven in de lijst staan omdat de facturen die ze maakten nog bestaan en op naam moeten blijven.',
    ar: 'لم يعد بإمكان هؤلاء فعل شيء. يبقون في القائمة لأن الفواتير التي أنشأوها ما زالت موجودة ويجب أن تبقى منسوبة بالاسم.',
    en: 'These people can no longer do anything. They stay in the list because the invoices they created still exist and must remain attributable by name.',
  },
  'team.ingetrokkenOp': {
    nl: '{name} — ingetrokken op {date}',
    ar: '{name} — سُحب في {date}',
    en: '{name} — revoked on {date}',
  },
  'team.intrekkenMislukt': {
    nl: 'Intrekken mislukt',
    ar: 'فشل السحب',
    en: 'Revoking failed',
  },
  'team.introNa': {
    nl: '— niet je bank, niet je omzet, niet je andere facturen.',
    ar: '— لا حسابك البنكي، ولا إيرادك، ولا فواتيرك الأخرى.',
    en: '— not your bank, not your turnover, not your other invoices.',
  },
  'team.introNadruk': {
    nl: 'alleen wat hij zelf aanmaakt',
    ar: 'فقط ما ينشئه بنفسه',
    en: 'only what he creates himself',
  },
  'team.introVoor': {
    nl: 'Iemand die je hier toevoegt kan verkoopfacturen maken en versturen die uitgaan op jouw naam en BTW-nummer, met jouw doorlopende factuurnummers. Hij ziet',
    ar: 'أي شخص تضيفه هنا يمكنه إنشاء وإرسال فواتير مبيعات تصدر باسمك ورقم btw الخاص بك، وبأرقام فواتيرك المتسلسلة. وهو يرى',
    en: 'Someone you add here can create and send sales invoices that go out in your name and BTW number, with your consecutive invoice numbers. He sees',
  },
  'team.laadMislukt': {
    nl: 'Kon het team niet laden',
    ar: 'تعذّر تحميل الفريق',
    en: 'Could not load the team',
  },
  'team.migratieNa': {
    nl: 'moet nog worden toegepast. Tot dan kun je niemand uitnodigen — verder verandert er niets: je facturen, bank en aangifte werken gewoon door.',
    ar: 'لم يُطبَّق بعد. حتى ذلك الحين لا يمكنك دعوة أحد — ولا يتغير شيء آخر: فواتيرك وبنكك وإقرارك تعمل كالمعتاد.',
    en: 'still needs to be applied. Until then you cannot invite anyone — nothing else changes: your invoices, bank and aangifte keep working.',
  },
  'team.migratieVoor': {
    nl: 'De databasemigratie',
    ar: 'ترحيل قاعدة البيانات',
    en: 'The database migration',
  },
  'team.sinds': {
    nl: 'sinds {date}',
    ar: 'منذ {date}',
    en: 'since {date}',
  },
  'team.uitlegOnderaan': {
    nl: 'Intrekken werkt onmiddellijk. Facturen die hij al verstuurde blijven staan — ze hebben een wettelijk nummer en horen bij je boekhouding.',
    ar: 'السحب فوري. الفواتير التي أرسلها تبقى — فلها رقم قانوني وهي جزء من دفاترك.',
    en: 'Revoking works immediately. Invoices he already sent remain — they carry a legal number and belong to your bookkeeping.',
  },
  'team.uitnodigenMislukt': {
    nl: 'Uitnodigen mislukt',
    ar: 'فشلت الدعوة',
    en: 'Inviting failed',
  },
  'team.uitnodigingUitleg': {
    nl: 'Hij krijgt een e-mail met wat hij aanneemt. Accepteren kan alleen met dít adres — een doorgestuurde link werkt niet. De uitnodiging verloopt na 14 dagen.',
    ar: 'يتلقى بريدًا إلكترونيًا يوضح ما يقبله. لا يمكن القبول إلا بهذا العنوان تحديدًا — الرابط المُعاد توجيهه لا يعمل. تنتهي صلاحية الدعوة بعد 14 يومًا.',
    en: 'He receives an e-mail explaining what he is accepting. Accepting only works with this exact address — a forwarded link does not work. The invitation expires after 14 days.',
  },
  'team.verloopt': {
    nl: 'verloopt {date}',
    ar: 'تنتهي في {date}',
    en: 'expires {date}',
  },
  'up.alleOpnieuw': {
    nl: 'Alle {n} mislukte opnieuw proberen',
    ar: 'إعادة محاولة كل ما فشل ({n})',
    en: 'Retry all {n} failed',
  },
  'up.allesMeerdere': {
    nl: 'meerdere bestanden tegelijk',
    ar: 'عدة ملفات معًا',
    en: 'several files at once',
  },
  'up.allesRest': {
    nl: '; de app leest en sorteert elk bestand automatisch naar de juiste plek.',
    ar: '؛ يقرأ التطبيق كل ملف ويفرزه تلقائيًا إلى مكانه الصحيح.',
    en: '; the app reads each file and sorts it to the right place automatically.',
  },
  'up.alToegevoegd': {
    nl: 'Al toegevoegd',
    ar: 'أُضيف مسبقًا',
    en: 'Already added',
  },
  'up.andersAparte': {
    nl: '— anders wordt elke foto een aparte factuur.',
    ar: '— وإلا صارت كل صورة فاتورة مستقلة.',
    en: '— otherwise each photo becomes a separate invoice.',
  },
  'up.autoGeboekt': {
    nl: 'Automatisch geboekt',
    ar: 'قُيّدت تلقائيًا',
    en: 'Booked automatically',
  },
  'up.autoGeboektEen': {
    nl: 'Eén factuur was zeker genoeg en is meteen geboekt als inkoopfactuur — klaar voor je boekhouder. Er is niets betaald; nakijken kan bij Inkoopfacturen onder “Automatisch verwerkt”.',
    ar: 'فاتورة واحدة كانت مؤكدة بما يكفي وقُيّدت فورًا كفاتورة مشتريات — جاهزة للمحاسب. لم يُدفع شيء؛ راجعها في «فواتير المشتريات» ضمن “Automatisch verwerkt”.',
    en: 'One invoice was certain enough and was booked immediately as a purchase invoice — ready for your accountant. Nothing was paid; review it under “Automatisch verwerkt” on Purchase invoices.',
  },
  'up.autoGeboektMeer': {
    nl: '{n} facturen waren zeker genoeg en zijn meteen geboekt als inkoopfactuur — klaar voor je boekhouder. Er is niets betaald; nakijken kan bij Inkoopfacturen onder “Automatisch verwerkt”.',
    ar: 'فواتير مؤكدة بما يكفي: {n}، وقُيّدت فورًا كفواتير مشتريات — جاهزة للمحاسب. لم يُدفع شيء؛ راجعها في «فواتير المشتريات» ضمن “Automatisch verwerkt”.',
    en: '{n} invoices were certain enough and were booked immediately as purchase invoices — ready for your accountant. Nothing was paid; review them under “Automatisch verwerkt” on Purchase invoices.',
  },
  'up.bestandenKiezen': {
    nl: 'Bestanden kiezen',
    ar: 'اختيار الملفات',
    en: 'Choose files',
  },
  'up.bezigLezen': {
    nl: 'Bezig met lezen…',
    ar: 'جارٍ القراءة…',
    en: 'Reading…',
  },
  'up.bezigSamenvoegen': {
    nl: 'Bezig met samenvoegen…',
    ar: 'جارٍ الدمج…',
    en: 'Merging…',
  },
  'up.bezigVerkleinen': {
    nl: 'Bezig met verkleinen…',
    ar: 'جارٍ التصغير…',
    en: 'Shrinking…',
  },
  'up.bezigVerwerken': {
    nl: 'Bezig met verwerken… {done}/{total} klaar',
    ar: 'جارٍ المعالجة… اكتمل {done}/{total}',
    en: 'Processing… {done}/{total} done',
  },
  'up.combineer': {
    nl: 'Combineer {n} pagina’s → één factuur',
    ar: 'ادمج الصفحات ({n}) ← فاتورة واحدة',
    en: 'Combine {n} pages → one invoice',
  },
  'up.combineerEen': {
    nl: 'Combineer 1 pagina → één factuur',
    ar: 'ادمج صفحة واحدة ← فاتورة واحدة',
    en: 'Combine 1 page → one invoice',
  },
  'up.combinerenMislukt': {
    nl: 'Combineren mislukt — voeg de pagina’s los toe.',
    ar: 'فشل الدمج — أضف الصفحات منفردة.',
    en: 'Combining failed — add the pages separately.',
  },
  'up.dest.bank': {
    nl: 'Bankafschrift',
    ar: 'كشف بنكي',
    en: 'Bank statement',
  },
  'up.dest.bestand': {
    nl: 'Bestand',
    ar: 'ملف',
    en: 'File',
  },
  'up.dest.bon': {
    nl: 'Bon',
    ar: 'إيصال',
    en: 'Receipt',
  },
  'up.dest.controleCheck': {
    nl: 'Controle-check',
    ar: 'فحص مراجعة',
    en: 'Cross-check',
  },
  'up.dest.factuur': {
    nl: 'Factuur',
    ar: 'فاتورة',
    en: 'Invoice',
  },
  'up.dest.kassaOmzet': {
    nl: 'Kassa-omzet',
    ar: 'إيراد الكاشير',
    en: 'Till turnover',
  },
  'up.dest.overzicht': {
    nl: 'Overzicht gecontroleerd',
    ar: 'رُوجع الكشف',
    en: 'Statement checked',
  },
  'up.dest.herinnering': {
    nl: 'Herinnering bewaard, niet geboekt',
    ar: 'حُفظ التذكير ولم يُقيَّد',
    en: 'Reminder filed, not booked',
  },
  'up.eenFactuurStrong': {
    nl: 'één factuur',
    ar: 'فاتورة واحدة',
    en: 'one invoice',
  },
  'up.fotosKiezen': {
    nl: 'Foto’s kiezen',
    ar: 'اختيار الصور',
    en: 'Choose photos',
  },
  'up.fotosMaken': {
    nl: 'Foto’s maken',
    ar: 'التقاط صور',
    en: 'Take photos',
  },
  'up.fout.boekenOpnieuw': {
    nl: 'Boeken is niet gelukt — probeer het zo opnieuw.',
    ar: 'لم ينجح التقييد — أعد المحاولة بعد قليل.',
    en: 'Booking did not work — try again in a moment.',
  },
  'up.fout.boekenVerbinding': {
    nl: 'Boeken is niet gelukt — controleer je verbinding en probeer het opnieuw.',
    ar: 'لم ينجح التقييد — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Booking did not work — check your connection and try again.',
  },
  'up.fout.lezen': {
    nl: 'Lezen mislukt — probeer dit bestand opnieuw.',
    ar: 'فشلت القراءة — أعد محاولة هذا الملف.',
    en: 'Reading failed — try this file again.',
  },
  'up.fout.terugzettenVerbinding': {
    nl: 'Terugzetten mislukt — controleer je verbinding en probeer het opnieuw.',
    ar: 'فشلت الإعادة — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Putting back failed — check your connection and try again.',
  },
  'up.fout.terugzettenVervers': {
    nl: 'Terugzetten mislukt — ververs de pagina en probeer het opnieuw.',
    ar: 'فشلت الإعادة — أعد تحميل الصفحة وحاول مرة أخرى.',
    en: 'Putting back failed — refresh the page and try again.',
  },
  'up.inWachtrij': {
    nl: 'In wachtrij…',
    ar: 'في قائمة الانتظار…',
    en: 'Queued…',
  },
  'up.kiesFotos': {
    nl: 'Kies foto’s van de pagina’s.',
    ar: 'اختر صور الصفحات.',
    en: 'Choose photos of the pages.',
  },
  'up.kiesHieronder': {
    nl: 'of kies ze hieronder — PDF, foto’s, bankafschriften (MT940/CAMT) én kassa-/grootboek-bestanden (Excel)',
    ar: 'أو اخترها أدناه — PDF وصور وكشوف بنكية (MT940/CAMT) وملفات الكاشير/دفتر الأستاذ (Excel)',
    en: 'or choose them below — PDF, photos, bank statements (MT940/CAMT) and till/ledger files (Excel)',
  },
  'up.klaar': {
    nl: 'Klaar',
    ar: 'جاهز',
    en: 'Done',
  },
  'up.klaarAandacht': {
    nl: 'Klaar — met aandachtspunten',
    ar: 'تم — مع نقاط تحتاج انتباهًا',
    en: 'Done — with points of attention',
  },
  'up.klaarVerwerkt': {
    nl: 'Klaar — {n} bestand(en) verwerkt',
    ar: 'تم — الملفات المعالَجة: {n}',
    en: 'Done — {n} file(s) processed',
  },
  'up.klaarVink': {
    nl: 'Klaar ✓',
    ar: 'تم ✓',
    en: 'Done ✓',
  },
  'up.misluktUitleg': {
    nl: 'Mislukt komt meestal door de limiet van 240 documenten per uur of een tijdelijke leesfout — opnieuw proberen lost het vaak op.',
    ar: 'الفشل يكون غالبًا بسبب حدّ 240 مستندًا في الساعة أو خطأ قراءة مؤقت — وإعادة المحاولة تحلّه في الغالب.',
    en: 'Failures are usually the 240-documents-per-hour limit or a temporary read error — retrying often fixes it.',
  },
  'up.naarBank': {
    nl: 'Naar Bank',
    ar: 'إلى البنك',
    en: 'To Bank',
  },
  'up.naarBestanden': {
    nl: 'Naar Bestanden',
    ar: 'إلى «الملفات»',
    en: 'To Files',
  },
  'up.naarDagomzet': {
    nl: 'Naar Dagomzet',
    ar: 'إلى «إيراد اليوم»',
    en: 'To Daily turnover',
  },
  'up.naarInkoop': {
    nl: 'Naar Inkoopfacturen',
    ar: 'إلى «فواتير المشتريات»',
    en: 'To Purchase invoices',
  },
  'up.nAutoGeboekt': {
    nl: '{n} automatisch geboekt',
    ar: 'قُيّد تلقائيًا: {n}',
    en: '{n} booked automatically',
  },
  'up.nBankafschrift': {
    nl: '{n} bankafschrift',
    ar: 'كشوف بنكية: {n}',
    en: '{n} bank statement',
  },
  'up.nBestand': {
    nl: '{n} bestand',
    ar: 'ملفات: {n}',
    en: '{n} file',
  },
  'up.nControleCheck': {
    nl: '{n} controle-check',
    ar: 'فحوص مراجعة: {n}',
    en: '{n} cross-check',
  },
  'up.nDubbel': {
    nl: '{n} dubbel',
    ar: 'مكرّر: {n}',
    en: '{n} duplicate',
  },
  'up.nFacturen': {
    nl: '{n} facturen',
    ar: '{n} فاتورة',
    en: '{n} invoices',
  },
  'up.nKassaOmzet': {
    nl: '{n} kassa-omzet',
    ar: 'إيراد كاشير: {n}',
    en: '{n} till turnover',
  },
  'up.nMeerdereFacturen': {
    nl: '{n} bestand(en) met meerdere facturen',
    ar: 'ملفات فيها عدة فواتير: {n}',
    en: '{n} file(s) with several invoices',
  },
  'up.nMislukt': {
    nl: '{n} mislukt',
    ar: 'فشل: {n}',
    en: '{n} failed',
  },
  'up.nNietGelezen': {
    nl: '{n} niet gelezen',
    ar: 'لم يُقرأ: {n}',
    en: '{n} not read',
  },
  'up.nr': {
    nl: 'nr. {n}',
    ar: 'رقم {n}',
    en: 'no. {n}',
  },
  'up.nRekeningoverzicht': {
    nl: '{n} rekeningoverzicht',
    ar: 'كشوف حساب: {n}',
    en: '{n} account statement',
  },
  'up.nHerinnering': {
    nl: '{n} herinnering',
    ar: 'تذكيرات: {n}',
    en: '{n} reminder',
  },
  'up.nTeControleren': {
    nl: '{n} factuur/bon te controleren',
    ar: 'فواتير/إيصالات للتدقيق: {n}',
    en: '{n} invoice/receipt to check',
  },
  'up.opnieuwWachtrij': {
    nl: 'Opnieuw in wachtrij…',
    ar: 'في قائمة الانتظار من جديد…',
    en: 'Queued again…',
  },
  'up.paginaFotograferen': {
    nl: 'Pagina fotograferen',
    ar: 'تصوير صفحة',
    en: 'Photograph a page',
  },
  'up.paginasSamenvoegen': {
    nl: 'Pagina’s samenvoegen',
    ar: 'دمج الصفحات',
    en: 'Merge pages',
  },
  'up.reproc.bezig': {
    nl: 'Bezig met boeken…',
    ar: 'جارٍ التسجيل…',
    en: 'Booking…',
  },
  'up.reproc.boek': {
    nl: 'Boek mijn opgeslagen bestanden',
    ar: 'تسجيل ملفاتي المحفوظة',
    en: 'Book my stored files',
  },
  'up.reproc.geboekt': {
    nl: '✓ {booked} bestand(en) geboekt — {days} dag(en) kassa-omzet.',
    ar: '✓ الملفات المُقيَّدة: {booked} — أيام إيراد الكاشير: {days}.',
    en: '✓ {booked} file(s) booked — {days} day(s) of till turnover.',
  },
  'up.reproc.geboektLedger': {
    nl: '✓ {booked} bestand(en) geboekt — {days} dag(en) kassa-omzet, {ledgerDays} dag(en) controle-check.',
    ar: '✓ الملفات المُقيَّدة: {booked} — أيام إيراد الكاشير: {days}، أيام فحص المراجعة: {ledgerDays}.',
    en: '✓ {booked} file(s) booked — {days} day(s) of till turnover, {ledgerDays} day(s) of cross-check.',
  },
  'up.reproc.geenNieuwe': {
    nl: 'Geen nieuwe kassa-/grootboek-bestanden gevonden om te boeken.',
    ar: 'لم يُعثر على ملفات كاشير أو دفتر أستاذ جديدة لتقييدها.',
    en: 'No new till/ledger files found to book.',
  },
  'up.reproc.nakijken': {
    nl: '{n} nakijken in Dagomzet',
    ar: 'للمراجعة في «إيراد اليوم»: {n}',
    en: '{n} to review in Daily turnover',
  },
  'up.reproc.uitleg': {
    nl: 'Verwerkt alsnog de kassa-, grootboek- en dagomzetbestanden die al in je bestanden staan maar nog niet geboekt zijn. Veilig om te herhalen: telt nooit dubbel.',
    ar: 'يعالج لاحقًا ملفات الكاشير ودفتر الأستاذ وإيراد اليوم الموجودة في ملفاتك ولم تُقيَّد بعد. تكراره آمن: لا يَعُدّ مرتين أبدًا.',
    en: 'Processes the till, ledger and daily-turnover files already in your files but not yet booked. Safe to repeat: never double-counts.',
  },
  'up.selecteerUitleg': {
    nl: 'Je kunt meerdere foto’s of bestanden in één keer selecteren. Eén PDF = één factuur.',
    ar: 'يمكنك اختيار عدة صور أو ملفات دفعة واحدة. ملف PDF واحد = فاتورة واحدة.',
    en: 'You can select several photos or files at once. One PDF = one invoice.',
  },
  'up.teGrootSplits': {
    nl: 'Bestand te groot ({size} MB) — max {max} MB. Maak er een foto van of splits het document.',
    ar: 'الملف كبير جدًا ({size} MB) — الحد الأقصى {max} MB. التقط له صورة أو قسّم المستند.',
    en: 'File too large ({size} MB) — max {max} MB. Take a photo of it or split the document.',
  },
  'up.teGrootVerkleinen': {
    nl: 'Bestand te groot ({size} MB) — max {max} MB. Verkleinen lukte niet ver genoeg.',
    ar: 'الملف كبير جدًا ({size} MB) — الحد الأقصى {max} MB. التصغير لم يكفِ.',
    en: 'File too large ({size} MB) — max {max} MB. Shrinking did not get far enough.',
  },
  'up.teruggezet': {
    nl: 'Teruggezet — de factuur staat weer in je controlewachtrij op Inkomend.',
    ar: 'أُعيدت — الفاتورة عادت إلى قائمة المراجعة في «الوارد».',
    en: 'Put back — the invoice is in your review queue on Incoming again.',
  },
  'up.terugzettenGenegeerd': {
    nl: 'Terugzetten uit Genegeerd',
    ar: 'استعادة من «متجاهَل»',
    en: 'Put back from Ignored',
  },
  'up.tochToegevoegdRegel': {
    nl: 'Je hebt dit toch toegevoegd — de uitkomst staat op de nieuwe regel hieronder.',
    ar: 'أضفته رغم ذلك — النتيجة في السطر الجديد أدناه.',
    en: 'You added it anyway — the outcome is on the new row below.',
  },
  'up.unreadEen': {
    nl: 'Eén bestand staat veilig in je bestanden, maar kon niet automatisch gelezen worden — er is niets van geboekt. Een factuur of bon? Maak een scherpere foto, of controleer het zelf in Bestanden.',
    ar: 'ملف واحد محفوظ بأمان في ملفاتك، لكن تعذّرت قراءته تلقائيًا — لم يُقيَّد منه شيء. فاتورة أو إيصال؟ التقط صورة أوضح، أو تحقّق منه بنفسك في «الملفات».',
    en: 'One file is safely in your files, but could not be read automatically — nothing was booked from it. An invoice or receipt? Take a sharper photo, or check it yourself in Files.',
  },
  'up.unreadMeer': {
    nl: '{n} bestanden staan veilig in je bestanden, maar konden niet automatisch gelezen worden — er is niets van geboekt. Een factuur of bon? Maak een scherpere foto, of controleer ze zelf in Bestanden.',
    ar: 'ملفات محفوظة بأمان في ملفاتك: {n}، لكن تعذّرت قراءتها تلقائيًا — لم يُقيَّد منها شيء. فاتورة أو إيصال؟ التقط صورة أوضح، أو تحقّق منها بنفسك في «الملفات».',
    en: '{n} files are safely in your files, but could not be read automatically — nothing was booked from them. An invoice or receipt? Take a sharper photo, or check them yourself in Files.',
  },
  'up.verkleind': {
    nl: 'Verkleind van {before} MB naar {after} MB — de kleinere versie staat hieronder.',
    ar: 'صُغّر من {before} MB إلى {after} MB — النسخة الأصغر أدناه.',
    en: 'Shrunk from {before} MB to {after} MB — the smaller version is below.',
  },
  'up.verkleinenLukteNiet': {
    nl: 'Verkleinen lukte niet. Splits het document in delen.',
    ar: 'لم ينجح التصغير. قسّم المستند إلى أجزاء.',
    en: 'Shrinking did not work. Split the document into parts.',
  },
  'up.verkleinenNietGenoeg': {
    nl: 'Verkleinen hielp niet genoeg: {before} MB → {after} MB, nog steeds boven de {max} MB. Splits het document in delen.',
    ar: 'التصغير لم يكفِ: من {before} MB إلى {after} MB، وما زال فوق {max} MB. قسّم المستند إلى أجزاء.',
    en: 'Shrinking did not help enough: {before} MB → {after} MB, still above {max} MB. Split the document into parts.',
  },
  'up.verkleinProbeer': {
    nl: 'Verklein en probeer opnieuw',
    ar: 'تصغير وإعادة المحاولة',
    en: 'Shrink and try again',
  },
  'up.voegEerstToe': {
    nl: 'Voeg eerst pagina’s toe',
    ar: 'أضف صفحات أولاً',
    en: 'Add pages first',
  },
  'up.volgordeUitleg': {
    nl: 'Voeg de pagina’s in volgorde toe. We maken er één PDF van en lezen die als',
    ar: 'أضف الصفحات بالترتيب. سنجمعها في ملف PDF واحد ونقرأه بوصفه',
    en: 'Add the pages in order. We make one PDF of them and read it as',
  },
  'vandaag.afgeboekt': {
    nl: '✓ Afgeboekt als betaald',
    ar: '✓ سُوّيت كمدفوعة',
    en: '✓ Settled as paid',
  },
  'vandaag.bekijken': {
    nl: 'Bekijken',
    ar: 'عرض',
    en: 'View',
  },
  'vandaag.eenFactuur': {
    nl: '1 factuur',
    ar: 'فاتورة واحدة',
    en: '1 invoice',
  },
  'vandaag.meerFacturen': {
    nl: '{n} facturen',
    ar: '{n} فاتورة',
    en: '{n} invoices',
  },
  'vandaag.onbekendePartij': {
    nl: 'Onbekende partij',
    ar: 'طرف غير معروف',
    en: 'Unknown party',
  },
  'vandaag.telaatEen': {
    nl: '1 dag te laat',
    ar: 'متأخرة يومًا واحدًا',
    en: '1 day late',
  },
  'vandaag.telaatMeer': {
    nl: '{n} dagen te laat',
    ar: 'أيام التأخر: {n}',
    en: '{n} days late',
  },
  'vandaag.verificatieEen': {
    nl: '1 factuur wacht op verificatie',
    ar: 'فاتورة واحدة بانتظار التدقيق',
    en: '1 invoice awaits verification',
  },
  'vandaag.verificatieMeer': {
    nl: '{n} facturen wachten op verificatie',
    ar: '{n} فاتورة بانتظار التدقيق',
    en: '{n} invoices await verification',
  },
  'vandaag.vervaltMorgen': {
    nl: 'Vervalt morgen',
    ar: 'تستحق غدًا',
    en: 'Due tomorrow',
  },
  'vandaag.vervaltOver': {
    nl: 'Vervalt over {n} dagen',
    ar: 'تستحق بعد {n} أيام',
    en: 'Due in {n} days',
  },
  'vandaag.vervaltVandaag': {
    nl: 'Vervalt vandaag',
    ar: 'تستحق اليوم',
    en: 'Due today',
  },
  'vandaag.zonderVervalEen': {
    nl: '1 factuur zonder vervaldatum',
    ar: 'فاتورة واحدة بلا تاريخ استحقاق',
    en: '1 invoice without a due date',
  },
  'vandaag.zonderVervalMeer': {
    nl: '{n} facturen zonder vervaldatum',
    ar: '{n} فاتورة بلا تاريخ استحقاق',
    en: '{n} invoices without a due date',
  },
  'vr.antwoordVersturen': {
    nl: 'Antwoord versturen',
    ar: 'إرسال الجواب',
    en: 'Send answer',
  },
  'vr.blijftStaan': {
    nl: 'De vraag blijft hier staan tot je boekhouder hem zelf afvinkt — wij zetten geen vinkje namens hem.',
    ar: 'يبقى السؤال هنا حتى يشطبه المحاسب بنفسه — نحن لا نضع علامة نيابة عنه.',
    en: 'The question stays here until your accountant ticks it off — we never tick it on their behalf.',
  },
  'vr.datumOnbekend': {
    nl: 'Datum onbekend',
    ar: 'التاريخ غير معروف',
    en: 'Date unknown',
  },
  'vr.fout.betekentNiet': {
    nl: 'Dit betekent niet dat er niets openstaat: we konden de lijst niet lezen.',
    ar: 'هذا لا يعني أنه لا شيء معلّق: لم نستطع قراءة القائمة.',
    en: 'This does not mean nothing is open: we could not read the list.',
  },
  'vr.fout.versturen': {
    nl: 'Versturen mislukt. Probeer het opnieuw.',
    ar: 'فشل الإرسال. حاول مرة أخرى.',
    en: 'Sending failed. Please try again.',
  },
  'vr.geen.metBoekhouder': {
    nl: 'Er staat op dit moment niets van je boekhouder open. Zodra er een vraag komt, krijg je er bericht van en staat hij hier.',
    ar: 'لا يوجد حاليًا شيء معلّق من المحاسب. حين يصل سؤال ستتلقى إشعارًا وسيظهر هنا.',
    en: 'Nothing from your accountant is open right now. As soon as a question arrives you get a notification and it appears here.',
  },
  'vr.geen.zonderBoekhouder': {
    nl: 'Je hebt nog geen boekhouder gekoppeld. Zodra dat gebeurt, komen zijn vragen hier binnen.',
    ar: 'لم تربط محاسبًا بعد. حين يحدث ذلك ستصل أسئلته إلى هنا.',
    en: 'You have not linked an accountant yet. Once you do, their questions arrive here.',
  },
  // [KANTOORGIDS] De andere richting van [GEEN-PROVISIE]: een ondernemer zonder boekhouder is
  // precies de lead waar een kantoor anders voor betaalt, en dit is het scherm waarop hij zegt
  // dat hij er geen heeft. Eén zin, één link — geen verkooppraatje op een leeg scherm.
  'vr.geen.zoekBoekhouder': {
    nl: 'Zoek je er een? Bekijk de kantoren die met BoekBrug werken.',
    ar: 'تبحث عن محاسب؟ اطّلع على المكاتب التي تعمل مع BoekBrug.',
    en: 'Looking for one? See the offices that work with BoekBrug.',
  },
  'vr.geenKoppeling': {
    nl: 'Er is op dit moment geen boekhouder aan je account gekoppeld, dus we kunnen je antwoord nergens naartoe sturen.',
    ar: 'لا يوجد حاليًا محاسب مرتبط بحسابك، لذا لا يمكننا إرسال جوابك إلى أي جهة.',
    en: 'No accountant is linked to your account right now, so we have nowhere to send your answer.',
  },
  'vr.geenToelichting': {
    nl: 'Je boekhouder heeft dit bestand als vraag gemarkeerd, maar er geen toelichting bij geschreven. Vraag gerust wat hij precies nodig heeft.',
    ar: 'علّم المحاسب هذا الملف كسؤال، لكنه لم يكتب توضيحًا. لا تتردد في سؤاله عمّا يحتاجه بالضبط.',
    en: 'Your accountant marked this file as a question but wrote no explanation. Feel free to ask what exactly they need.',
  },
  'vr.gevraagdOp': {
    nl: 'Gevraagd op {datum}',
    ar: 'سُئل بتاريخ {datum}',
    en: 'Asked on {datum}',
  },
  'vr.inPrullenbak': {
    nl: 'ligt in je prullenbak',
    ar: 'موجود في سلة مهملاتك',
    en: 'is in your trash',
  },
  'vr.naam.bestandWeg': {
    nl: 'Een bestand dat we niet meer kunnen tonen',
    ar: 'ملف لم يعد بإمكاننا عرضه',
    en: 'A file we can no longer show',
  },
  'vr.naam.factuurWeg': {
    nl: 'Een factuur die we niet meer kunnen tonen',
    ar: 'فاتورة لم يعد بإمكاننا عرضها',
    en: 'An invoice we can no longer show',
  },
  'vr.naam.naamloos': {
    nl: 'Naamloos bestand',
    ar: 'ملف بلا اسم',
    en: 'Unnamed file',
  },
  'vr.uitleg.metNaam': {
    nl: 'Mist {naam} iets bij een van je bestanden, dan staat de vraag hier. Je antwoord komt bij hem of haar binnen als bericht.',
    ar: 'إذا كان ينقص {naam} شيء في أحد ملفاتك، فالسؤال هنا. يصل جوابك إليه كرسالة.',
    en: 'If {naam} is missing something on one of your files, the question is here. Your answer reaches them as a message.',
  },
  'vr.uitleg.zonderNaam': {
    nl: 'Mist je boekhouder iets bij een van je bestanden, dan staat de vraag hier. Je antwoord komt bij je boekhouder binnen als bericht.',
    ar: 'إذا كان ينقص محاسبك شيء في أحد ملفاتك، فالسؤال هنا. يصل جوابك إلى محاسبك كرسالة.',
    en: 'If your accountant is missing something on one of your files, the question is here. Your answer reaches your accountant as a message.',
  },
  'waarheid.aandachtNodig': {
    nl: 'DIT HEEFT JE AANDACHT NODIG',
    ar: 'هذا يحتاج انتباهك',
    en: 'THIS NEEDS YOUR ATTENTION',
  },
  'waarheid.bankBijgewerkt': {
    nl: 'bank bijgewerkt tot {datum}',
    ar: 'البنك محدَّث حتى {datum}',
    en: 'bank updated up to {datum}',
  },
  'waarheid.geenAllesBij': {
    nl: 'Dit is géén "alles is bij" — we konden je cijfers even niet ophalen.',
    ar: 'هذا ليس «كل شيء محدَّث» — لم نستطع جلب أرقامك الآن.',
    en: 'This is NOT an “all caught up” — we just could not fetch your figures.',
  },
  'waarheid.saldoDeels': {
    nl: 'van één rekening is geen saldo bekend',
    ar: 'رصيد أحد الحسابات غير معروف',
    en: 'one account has no known balance',
  },
  'waarheid.saldoOp': {
    nl: 'saldo op {datum}',
    ar: 'الرصيد بتاريخ {datum}',
    en: 'balance on {datum}',
  },
  // [BESTE] Two companions to the bank balance, from the engines Vandaag already runs.
  'waarheid.vrijNaBtw': { nl: 'Vrij na btw-reserve', ar: 'المتاح بعد احتياطي الضريبة', en: 'Free after VAT reserve' },
  'waarheid.over30': { nl: 'Over 30 dagen', ar: 'بعد 30 يوماً', en: 'In 30 days' },
  'waarheid.waarJeStaat': {
    nl: 'WAAR JE STAAT',
    ar: 'أين تقف',
    en: 'WHERE YOU STAND',
  },
  'wh.anderKwartaal': {
    nl: 'Ander kwartaal',
    ar: 'ربع آخر',
    en: 'Another quarter',
  },
  'wh.btw.aanBd': {
    nl: 'aan de Belastingdienst, over deze periode',
    ar: 'لمصلحة الضرائب، عن هذه الفترة',
    en: 'to the tax office, over this period',
  },
  'wh.btw.eerstTarieven': {
    nl: 'eerst tarieven toekennen',
    ar: 'عيّن النسب أولًا',
    en: 'assign rates first',
  },
  'wh.btw.incompleet': {
    nl: 'Nog niet compleet: {bedrag} omzet heeft geen BTW-tarief, dus dit bedrag is te laag.',
    ar: 'غير مكتمل بعد: {bedrag} من الإيراد بلا نسبة ضريبة القيمة المضافة، فهذا المبلغ منخفض.',
    en: 'Not complete yet: {bedrag} of revenue has no VAT rate, so this amount is too low.',
  },
  'wh.btw.moetBetalen': {
    nl: 'BTW die je moet betalen',
    ar: 'ضريبة القيمة المضافة التي عليك دفعها',
    en: 'VAT you must pay',
  },
  'wh.btw.nogNiet': {
    nl: 'BTW — nog niet te zeggen',
    ar: 'ضريبة القيمة المضافة — لا يمكن الجزم بعد',
    en: 'VAT — too early to say',
  },
  'wh.btw.terug': {
    nl: 'BTW die je terugkrijgt',
    ar: 'btw التي تستردها',
    en: 'VAT you get back',
  },
  'wh.btw.vanBd': {
    nl: 'van de Belastingdienst, over deze periode',
    ar: 'من مصلحة الضرائب، عن هذه الفترة',
    en: 'from the tax office, over this period',
  },
  'wh.btw.voorlopig': {
    nl: 'voorlopig',
    ar: 'مؤقتًا',
    en: 'provisional',
  },
  'wh.btw.zonderTariefRest': {
    nl: 'van je omzet heeft nog geen BTW-tarief. Zodra je die tarieven toekent, wordt dit waarschijnlijk een bedrag dat je juist moet betalen. Reken er dus nog niet op.',
    ar: 'من إيرادك ما يزال بلا نسبة ضريبة القيمة المضافة. حين تعيّن تلك النسب سيصبح هذا على الأرجح مبلغًا عليك دفعه أنت. فلا تعتمد عليه بعد.',
    en: 'of your revenue still has no VAT rate. Once you assign those rates, this will likely become an amount you must pay instead. So do not count on it yet.',
  },
  'wh.chip.afgesloten': {
    nl: 'afgesloten periode',
    ar: 'فترة مقفلة',
    en: 'closed period',
  },
  'wh.chip.ingediend': {
    nl: '🔒 Ingediend · definitief',
    ar: '🔒 مقدَّم · نهائي',
    en: '🔒 Filed · final',
  },
  'wh.chip.looptNog': {
    nl: 'loopt nog',
    ar: 'ما يزال جاريًا',
    en: 'still running',
  },
  'wh.chip.onbekend': {
    nl: 'indienstatus onbekend',
    ar: 'حالة التقديم غير معروفة',
    en: 'filing status unknown',
  },
  'wh.div.gewijzigd': {
    nl: 'Let op — dit kwartaal is gewijzigd',
    ar: 'انتبه — تغيّر هذا الربع',
    en: 'Note — this quarter has changed',
  },
  'wh.div.meerBetalen': {
    nl: 'je moet meer betalen',
    ar: 'عليك أن تدفع أكثر',
    en: 'you must pay more',
  },
  'wh.div.meerTerug': {
    nl: 'je krijgt meer terug',
    ar: 'ستسترد أكثر',
    en: 'you get more back',
  },
  'wh.div.onderliggend': {
    nl: 'De cijfers van dit kwartaal zijn veranderd sinds je indiening, maar het BTW-saldo en je resultaat zijn gelijk gebleven. Controleer de onderliggende posten.',
    ar: 'تغيّرت أرقام هذا الربع منذ تقديمك، لكن رصيد الضريبة ونتيجتك بقيا كما هما. راجع البنود الأساسية.',
    en: 'The figures of this quarter changed since your filing, but the VAT balance and your result stayed the same. Check the underlying items.',
  },
  'wh.div.resultaatMet': {
    nl: 'Je resultaat over dit kwartaal is met',
    ar: 'تغيّرت نتيجتك عن هذا الربع بمقدار',
    en: 'Your result for this quarter has by',
  },
  'wh.div.suppletieMeer': {
    nl: 'Dat is meer dan €1.000 — dien een suppletie in bij de Belastingdienst.',
    ar: 'هذا أكثر من €1.000 — قدّم إقرارًا تصحيحيًا (suppletie) لدى مصلحة الضرائب.',
    en: 'That is more than €1,000 — file a correction (suppletie) with the tax office.',
  },
  'wh.div.suppletieOnder': {
    nl: 'Onder €1.000 mag je dit verwerken in je volgende aangifte.',
    ar: 'أقل من €1.000 يجوز إدراجه في إقرارك القادم.',
    en: 'Under €1,000 you may process this in your next return.',
  },
  'wh.div.terwijlGelijk': {
    nl: 'terwijl de BTW gelijk bleef — er is dus niets te corrigeren bij de Belastingdienst, maar je winst voor de inkomstenbelasting is veranderd.',
    ar: 'بينما بقيت الضريبة كما هي — فلا شيء يُصحَّح لدى مصلحة الضرائب، لكن ربحك لضريبة الدخل تغيّر.',
    en: 'while the VAT stayed the same — so nothing to correct with the tax office, but your profit for income tax has changed.',
  },
  'wh.filed.ingediendOp': {
    nl: 'Ingediend op {datum}',
    ar: 'قُدّم بتاريخ {datum}',
    en: 'Filed on {datum}',
  },
  'wh.filed.looptNog': {
    nl: 'Dit kwartaal loopt nog — je kunt het pas na afloop als ingediend markeren.',
    ar: 'هذا الربع ما يزال جاريًا — لا يمكنك تعليمه كمقدَّم إلا بعد انتهائه.',
    en: 'This quarter is still running — you can mark it as filed only after it ends.',
  },
  'wh.filed.markeer': {
    nl: 'Markeer als ingediend bij de Belastingdienst',
    ar: 'علّمه كمقدَّم لدى مصلحة الضرائب',
    en: 'Mark as filed with the tax office',
  },
  'wh.filed.mislukt': {
    nl: 'Markeren als ingediend is niet gelukt — probeer het opnieuw.',
    ar: 'لم ينجح التعليم كمقدَّم — حاول مرة أخرى.',
    en: 'Marking as filed did not work — please try again.',
  },
  'wh.filed.nietGecontroleerd': {
    nl: 'Dit kwartaal is nog niet volledig gecontroleerd.',
    ar: 'هذا الربع لم يُراجَع كاملًا بعد.',
    en: 'This quarter has not been fully checked yet.',
  },
  'wh.filed.ongedaan': {
    nl: 'Indiening ongedaan maken',
    ar: 'التراجع عن التقديم',
    en: 'Undo filing',
  },
  'wh.filed.ongedaanMislukt': {
    nl: 'Indiening ongedaan maken is niet gelukt — probeer het opnieuw.',
    ar: 'لم ينجح التراجع عن التقديم — حاول مرة أخرى.',
    en: 'Undoing the filing did not work — please try again.',
  },
  'wh.filed.opnieuwMislukt': {
    nl: 'Opnieuw indienen is niet gelukt.',
    ar: 'لم تنجح إعادة التقديم.',
    en: 'Re-filing did not work.',
  },
  'wh.filed.tochBevestig': {
    nl: 'Ja, markeer als ingediend',
    ar: 'نعم، علّمه كمقدَّم',
    en: 'Yes, mark as filed',
  },
  'wh.filed.tochVraag': {
    nl: 'Toch als ingediend markeren?',
    ar: 'هل تعلّمه كمقدَّم رغم ذلك؟',
    en: 'Mark as filed anyway?',
  },
  'wh.filed.uitlegLooptNog': {
    nl: 'Dit kwartaal loopt nog. Zodra het is afgelopen kun je het hier als ingediend markeren en leggen we de cijfers vast.',
    ar: 'هذا الربع ما يزال جاريًا. حين ينتهي يمكنك تعليمه هنا كمقدَّم فنثبّت الأرقام.',
    en: 'This quarter is still running. Once it has ended you can mark it as filed here and we freeze the figures.',
  },
  'wh.filed.uitlegOnbekend': {
    nl: 'We konden niet controleren of dit kwartaal al is ingediend, dus vastleggen kan nu niet — anders zou je een eerdere indiening overschrijven. Ververs de pagina.',
    ar: 'لم نستطع التحقق مما إذا كان هذا الربع قد قُدّم، فلا يمكن التثبيت الآن — وإلا لربما استبدلت تقديمًا سابقًا. أعد تحميل الصفحة.',
    en: 'We could not check whether this quarter is already filed, so freezing is not possible now — you might overwrite an earlier filing. Refresh the page.',
  },
  'wh.filed.uitlegVastleggen': {
    nl: 'Dit legt de cijfers van dit kwartaal vast. Komt er later nog een factuur bij, dan zien we het verschil en zeggen we of een suppletie nodig is.',
    ar: 'هذا يثبّت أرقام هذا الربع. إن أُضيفت فاتورة لاحقًا نرى الفرق ونخبرك إن لزم إقرار تصحيحي.',
    en: 'This freezes this quarter’s figures. If an invoice arrives later, we see the difference and tell you whether a correction is needed.',
  },
  'wh.filed.vervangBevestig': {
    nl: 'Ja, vervang',
    ar: 'نعم، استبدل',
    en: 'Yes, replace',
  },
  'wh.filed.vervangUitleg': {
    nl: 'Dit kwartaal staat al als ingediend. Opnieuw indienen vervangt die vastgelegde cijfers.',
    ar: 'هذا الربع معلَّم كمقدَّم مسبقًا. إعادة التقديم تستبدل الأرقام المثبتة.',
    en: 'This quarter is already marked as filed. Filing again replaces those frozen figures.',
  },
  'wh.filed.vervangVraag': {
    nl: 'Vervang je eerdere indiening?',
    ar: 'هل تريد استبدال تقديمك السابق؟',
    en: 'Replace your earlier filing?',
  },
  'wh.intro': {
    nl: 'Eén doorlopend beeld, live berekend uit je facturen, bank en kas. Kies een periode.',
    ar: 'صورة واحدة متصلة، تُحسب مباشرة من فواتيرك وبنكك ونقدك. اختر فترة.',
    en: 'One continuous picture, computed live from your invoices, bank and cash. Pick a period.',
  },
  'wh.lens.ditJaar': {
    nl: 'Dit jaar',
    ar: 'هذه السنة',
    en: 'This year',
  },
  // [JAARSTAND] Het jaar in vier regels, boven het Kwartaaloverzicht. Nederlands is de bron; de
  // reden zelf komt woordelijk uit readiness en wordt NIET vertaald — die zin is al Nederlands en
  // een tweede vertaling ervan zou twee versies van hetzelfde gat opleveren.
  // [KANTOOR-BESLUIT] Het werk van het kantoor, gegroepeerd naar WAT het is in plaats van naar
  // WIENS het is. De zin bij een groep is die van readiness zelf en wordt hier NIET vertaald —
  // hij is al Nederlands, en een tweede vertaling ervan zou twee versies van hetzelfde gat zijn.
  // [WERK-GEDAAN] Wat de app deed, geteld. GEEN uren en GEEN euro's in deze zinnen: wat een minuut
  // waard is, weet dit kantoor en wij niet — zie de weigering in work-done.ts.
  'bh.gedaan.kop': {
    nl: 'Wat BoekBrug voor je deed',
    ar: 'ما فعله BoekBrug من أجلك',
    en: 'What BoekBrug did for you',
  },
  'bh.gedaan.periode': {
    nl: 'Van {van} tot {tot}, over {klanten}.',
    ar: 'من {van} إلى {tot}، عبر {klanten}.',
    en: 'From {van} to {tot}, across {klanten}.',
  },
  'bh.gedaan.klanten': { nl: '{n} klanten', ar: '{n} عميل', en: '{n} clients' },
  'bh.gedaan.klantenEen': { nl: '1 klant', ar: 'عميل واحد', en: '1 client' },
  'bh.gedaan.totaal': {
    nl: '{n} handelingen',
    ar: '{n} إجراء',
    en: '{n} actions',
  },
  'bh.gedaan.uitleg': {
    nl: 'Elk van deze gebeurde anders met de hand. Wat dat je kantoor aan tijd scheelt weet je zelf beter dan wij — daarom rekenen we het niet om.',
    ar: 'كل واحد من هذه كان يتم يدويًا. وما يوفّره ذلك من وقت لمكتبك تعرفه أنت أفضل منا — لذلك لا نحوّله إلى ساعات.',
    en: 'Each of these otherwise happened by hand. What that saves your office you know better than we do — so we do not convert it.',
  },
  // [NO-SILENT-EMPTY] De twee zinnen die nooit als "nul handelingen" mogen lezen.
  'bh.gedaan.nogNiet': {
    nl: 'De telling staat nog niet aan op deze omgeving.',
    ar: 'العدّ غير مفعّل بعد في هذه البيئة.',
    en: 'Counting is not switched on for this environment yet.',
  },
  'bh.gedaan.deelsOnleesbaar': {
    nl: 'Van {n} van je klanten kon dit niet worden geteld — die staan hier niet bij.',
    ar: 'تعذّر احتساب ذلك لـ{n} من عملائك — لذا لا يظهرون هنا.',
    en: 'This could not be counted for {n} of your clients — they are not included here.',
  },
  'bh.werk.soort.kop': {
    nl: 'Het werk, op soort',
    ar: 'الشغل، حسب نوعه',
    en: 'The work, by kind',
  },
  'bh.werk.soort.uitleg': {
    nl: 'Dezelfde handeling bij meerdere klanten staat hier één keer. Tik om die klanten te zien.',
    ar: 'نفس الإجراء عند عدة عملاء يظهر هنا مرة واحدة. اضغط لتعرف من هم.',
    en: 'One line per kind of work, however many clients it covers. Tap to see which.',
  },
  'bh.werk.soort.klanten': {
    nl: '{n} klanten',
    ar: '{n} عملاء',
    en: '{n} clients',
  },
  'bh.werk.soort.klantenEen': {
    nl: '1 klant',
    ar: 'عميل واحد',
    en: '1 client',
  },
  'jaar.stand.kop': {
    nl: 'Het jaar in kwartalen',
    ar: 'السنة على أربعة أرباع',
    en: 'The year, quarter by quarter',
  },
  'jaar.stand.uitleg': {
    nl: 'Zo staat elk kwartaal ervoor. Tik op een kwartaal om het te openen.',
    ar: 'هذه حال كل ربع. اضغط على ربع لفتحه.',
    en: 'Where each quarter stands. Tap one to open it.',
  },
  'jaar.stand.openstaand': {
    nl: '{n} kwartalen kunnen nog niet worden ingediend',
    ar: '{n} أرباع لا يمكن تقديمها بعد',
    en: '{n} quarters cannot be filed yet',
  },
  'jaar.stand.openstaandEen': {
    nl: '1 kwartaal kan nog niet worden ingediend',
    ar: 'ربع واحد لا يمكن تقديمه بعد',
    en: '1 quarter cannot be filed yet',
  },
  'jaar.stand.ingediend': { nl: 'Ingediend', ar: 'مُقدَّم', en: 'Filed' },
  'jaar.stand.klaar': { nl: 'Klaar om in te dienen', ar: 'جاهز للتقديم', en: 'Ready to file' },
  'jaar.stand.loopt': { nl: 'Loopt nog', ar: 'ما زال جاريًا', en: 'Still running' },
  'jaar.stand.blokkeert': { nl: 'Kan nog niet worden ingediend', ar: 'لا يمكن تقديمه بعد', en: 'Cannot be filed yet' },
  // [NO-SILENT-EMPTY] De enige zin die dit paneel mag zeggen over een kwartaal dat het niet
  // heeft kunnen lezen. Nooit 'klaar', nooit een leeg vakje.
  'jaar.stand.onbekend': {
    nl: 'Stand onbekend — dit kwartaal kon niet worden gelezen',
    ar: 'الحالة غير معروفة — تعذّرت قراءة هذا الربع',
    en: 'Status unknown — this quarter could not be read',
  },
  'jaar.stand.bezig': { nl: 'Stand ophalen…', ar: 'جارٍ جلب الحالة…', en: 'Loading status…' },
  'wh.lens.ditKwartaal': {
    nl: 'Dit kwartaal',
    ar: 'هذا الربع',
    en: 'This quarter',
  },
  'wh.lens.vorigKwartaal': {
    nl: 'Vorig kwartaal',
    ar: 'الربع السابق',
    en: 'Last quarter',
  },
  'wh.pin.acquirer': {
    nl: 'Deze commissie stond al op een factuur van de acquirer ({bedrag}) en is daar al als kosten geboekt — hier dus alleen ter controle.',
    ar: 'هذه العمولة كانت مسجّلة مسبقًا على فاتورة المشغّل ({bedrag}) ومسجّلة هناك كمصروف — فهي هنا للمراجعة فقط.',
    en: 'This commission was already on an acquirer invoice ({bedrag}) and is booked as a cost there — shown here only as a check.',
  },
  'wh.pin.commissieDagen': {
    nl: '{n} dag(en) waar de bank-uitbetaling niet bij de kaartomzet van die dag past. Daar is geen commissie geboekt — de uitbetaling hoort waarschijnlijk (deels) bij een andere dag.',
    ar: 'عدد الأيام التي لا تطابق فيها دفعة البنك إيراد البطاقات لذلك اليوم: {n}. لم تُسجَّل عمولة هناك — الدفعة تخص على الأرجح (جزئيًا) يومًا آخر.',
    en: '{n} day(s) where the bank payout does not fit that day’s card takings. No commission was booked there — the payout probably (partly) belongs to another day.',
  },
  'wh.pin.geboekt': {
    nl: 'Hiervan is {bedrag} als kosten verwerkt in het resultaat hierboven — BTW-vrij (vrijstelling betalingsverkeer).',
    ar: 'منها {bedrag} مُدرج كمصروف في النتيجة أعلاه — معفى من ضريبة القيمة المضافة (إعفاء خدمات الدفع).',
    en: 'Of this, {bedrag} is processed as a cost in the result above — VAT-free (payment services exemption).',
  },
  'wh.pin.gemeten': {
    nl: 'gemeten commissie',
    ar: 'العمولة المقيسة',
    en: 'measured commission',
  },
  'wh.pin.incompleteDagen': {
    nl: '{n} dag(en) nog niet compleet — upload de terminal-afrekening of het bankafschrift voor een volledige controle.',
    ar: 'عدد الأيام غير المكتملة بعد: {n} — ارفع تسوية الجهاز أو كشف البنك لمراجعة كاملة.',
    en: '{n} day(s) not complete yet — upload the terminal settlement or the bank statement for a full check.',
  },
  'wh.pin.kasUitleg': {
    nl: 'Onder kasstelsel wordt deze commissie niet automatisch als kosten geboekt: ze is aftrekbaar zodra je de factuur van de acquirer betaalt. Boek die factuur, dan telt ze in de juiste periode mee.',
    ar: 'في النظام النقدي لا تُسجَّل هذه العمولة تلقائيًا كمصروف: فهي قابلة للخصم حين تدفع فاتورة المشغّل (acquirer). سجّل تلك الفاتورة فتُحتسب في الفترة الصحيحة.',
    en: 'Under the cash scheme this commission is not booked as a cost automatically: it is deductible once you pay the acquirer\'s invoice. Book that invoice and it counts in the right period.',
  },
  'wh.pin.mismatch': {
    nl: '{n} dag(en) waar de kassa-PIN ≠ de terminal-afrekening. Beide zijn bruto, dus dit is een echt verschil (ontbrekende bon of terminalstoring) — geen commissie. Controleer die dagen.',
    ar: 'عدد الأيام التي لا يساوي فيها «PIN» الكاشير تسويةَ الجهاز: {n}. كلاهما إجمالي، فهذا فرق حقيقي (إيصال ناقص أو عطل في الجهاز) — لا عمولة. راجع تلك الأيام.',
    en: '{n} day(s) where the till card total ≠ the terminal settlement. Both are gross, so this is a real difference (missing receipt or terminal fault) — not commission. Check those days.',
  },
  'wh.pin.overige': {
    nl: 'De overige {bedrag} stond al op een factuur van de acquirer en is dus niet nog eens geboekt.',
    ar: 'الباقي {bedrag} كان مسجّلًا مسبقًا على فاتورة المشغّل فلم يُسجّل مرة أخرى.',
    en: 'The remaining {bedrag} was already on an acquirer invoice and was therefore not booked again.',
  },
  // [COM-IN-DE-REGEL] The commission the bank line states outright. A separate sentence from
  // wh.pin.geboekt on purpose: that one is about the triangle's derived figure, this one about a
  // number the bank quoted, and a reader must be able to tell which they are looking at.
  'wh.pin.uitBankregel': {
    nl: 'Je bank noemt de commissie zelf op {regels} afrekeningen: {bedrag} over {bruto} bruto ({tarief}).',
    ar: 'بنكك يذكر العمولة بنفسه في {regels} تسوية: {bedrag} من إجمالي {bruto} ({tarief}).',
    en: 'Your bank states the commission itself on {regels} settlements: {bedrag} on {bruto} gross ({tarief}).',
  },
  'wh.pin.uitBankregelGeboekt': {
    nl: 'Dat bedrag is als kosten verwerkt in het resultaat hierboven — BTW-vrij (vrijstelling betalingsverkeer).',
    ar: 'هذا المبلغ مُدرج كمصروف في النتيجة أعلاه — معفى من ضريبة القيمة المضافة (إعفاء خدمات الدفع).',
    en: 'That amount is processed as a cost in the result above — VAT-free (payment services exemption).',
  },
  'wh.pin.uitBankregelNietGeboekt': {
    nl: 'Dit bedrag staat nog NIET in het resultaat hierboven: er is ook een terminal-afrekening voor deze periode, en de commissie boeken we nooit uit twee bronnen tegelijk.',
    ar: 'هذا المبلغ ليس بعدُ في النتيجة أعلاه: توجد أيضًا تسوية جهاز لهذه الفترة، ولا نسجّل العمولة من مصدرين في آن واحد أبدًا.',
    en: 'This amount is NOT yet in the result above: a terminal settlement also exists for this period, and we never book the commission from two sources at once.',
  },
  'wh.pin.uitBankregelOnleesbaar': {
    nl: '{n} afrekening(en) noemden een commissie die niet klopte met het bijgeschreven bedrag. Die zijn niet meegeteld.',
    ar: '{n} من التسويات ذكرت عمولة لا تطابق المبلغ المُودَع. لم تُحتسب.',
    en: '{n} settlement(s) stated a commission that did not match the amount credited. Those are not counted.',
  },
  'wh.pin.geenBron': {
    nl: 'Nog geen terminal-afrekening en geen bank-afrekening die de commissie zelf noemt. Zodra er één is, rekenen we de betaalkosten uit.',
    ar: 'لا توجد بعد تسوية جهاز ولا تسوية بنكية تذكر العمولة بنفسها. حين تتوفر إحداهما نحسب تكاليف الدفع.',
    en: 'No terminal settlement yet, and no bank settlement that states the commission itself. As soon as there is one, we work out the payment costs.',
  },
  'wh.pin.sub': {
    nl: 'kassa · terminal · bank moeten hetzelfde zeggen',
    ar: 'الكاشير · الجهاز · البنك يجب أن تقول الشيء نفسه',
    en: 'till · terminal · bank must say the same thing',
  },
  'wh.pin.vanTerminal': {
    nl: 'van de terminal',
    ar: 'من الجهاز',
    en: 'from the terminal',
  },
  'wh.pin.zodra': {
    nl: 'Zodra de bank-uitbetaling én de terminal-afrekening er allebei zijn, boeken we het verschil als betaalkosten.',
    ar: 'حين يتوفر كل من دفعة البنك وتسوية الجهاز، نسجّل الفرق كتكاليف الدفع.',
    en: 'Once both the bank payout and the terminal settlement are in, we book the difference as payment costs.',
  },
  'wh.sub.kosten': {
    nl: 'wat je uitgaf',
    ar: 'ما أنفقته',
    en: 'what you spent',
  },
  'wh.sub.omzet': {
    nl: 'wat je verdiende',
    ar: 'ما كسبته',
    en: 'what you earned',
  },
  'wh.sub.resultaat': {
    nl: 'omzet − kosten · je winst',
    ar: 'الإيراد − المصاريف · ربحك',
    en: 'revenue − costs · your profit',
  },
  'wh.sub.verschuldigd': {
    nl: 'verschuldigd',
    ar: 'مستحق الدفع',
    en: 'due',
  },
  'wh.sub.voorbelasting': {
    nl: 'voorbelasting',
    ar: 'ضريبة المشتريات',
    en: 'input VAT',
  },
  'wh.todo.bankZonderCategorie': {
    nl: '{delen} aan bankmutaties heeft nog geen categorie. Die tellen niet mee in de cijfers hierboven — pas als je ze codeert, kloppen omzet en kosten.',
    ar: 'حركات بنكية بلا فئة بعد ({delen}). لا تُحتسب في الأرقام أعلاه — لن يصح الإيراد والمصاريف إلا بعد ترميزها.',
    en: '{delen} of bank movements still has no category. They do not count in the figures above — only once you code them do revenue and costs add up.',
  },
  'wh.todo.betaaldatumEen': {
    nl: '1 betaalde factuur mist een betaaldatum. Onder kasstelsel kan die BTW nog niet in de juiste periode worden geplaatst.',
    ar: 'فاتورة مدفوعة واحدة ينقصها تاريخ الدفع. في النظام النقدي لا يمكن وضع ضريبتها في الفترة الصحيحة بعد.',
    en: '1 paid invoice is missing a payment date. Under the cash scheme its VAT cannot yet be placed in the right period.',
  },
  'wh.todo.betaaldatumMeer': {
    nl: '{n} betaalde facturen missen een betaaldatum. Onder kasstelsel kan die BTW nog niet in de juiste periode worden geplaatst.',
    ar: '{n} فاتورة مدفوعة ينقصها تاريخ الدفع. في النظام النقدي لا يمكن وضع ضريبتها في الفترة الصحيحة بعد.',
    en: '{n} paid invoices are missing a payment date. Under the cash scheme that VAT cannot yet be placed in the right period.',
  },
  'wh.todo.categoriseren': {
    nl: 'Categoriseren',
    ar: 'صنّف',
    en: 'Categorise',
  },
  'wh.todo.controleren': {
    nl: 'Controleren',
    ar: 'راجِع',
    en: 'Check',
  },
  'wh.todo.datumInvullen': {
    nl: 'Datum invullen',
    ar: 'املأ التاريخ',
    en: 'Fill in the date',
  },
  'wh.todo.en': {
    nl: 'en',
    ar: 'و',
    en: 'and',
  },
  'wh.todo.eraf': {
    nl: '{bedrag} eraf',
    ar: 'صادر: {bedrag}',
    en: '{bedrag} out',
  },
  'wh.todo.erbij': {
    nl: '{bedrag} erbij',
    ar: 'وارد: {bedrag}',
    en: '{bedrag} in',
  },
  'wh.todo.geenDatumEen': {
    nl: '1 factuur heeft geen datum, dus die telt in geen enkele periode mee.',
    ar: 'فاتورة واحدة بلا تاريخ، فلا تُحتسب في أي فترة.',
    en: '1 invoice has no date, so it counts in no period at all.',
  },
  'wh.todo.geenDatumMeer': {
    nl: '{n} facturen hebben geen datum, dus die tellen in geen enkele periode mee.',
    ar: '{n} فاتورة بلا تاريخ، فلا تُحتسب في أي فترة.',
    en: '{n} invoices have no date, so they count in no period at all.',
  },
  'wh.todo.koppelen': {
    nl: 'Koppelen',
    ar: 'اربط',
    en: 'Link',
  },
  'wh.todo.naarDagomzet': {
    nl: 'Naar Dagomzet',
    ar: 'إلى «إيراد اليوم»',
    en: 'To Daily takings',
  },
  'wh.todo.naarKas': {
    nl: 'Naar Kas',
    ar: 'إلى الصندوق',
    en: 'To Cash',
  },
  'wh.todo.ongecontroleerdEen': {
    nl: '1 inkoopfactuur is nog niet gecontroleerd. Het bedrag telt nog niet mee in je kosten en BTW.',
    ar: 'فاتورة مشتريات واحدة لم تُراجَع بعد. مبلغها لا يُحتسب بعد في مصاريفك وضريبتك.',
    en: '1 purchase invoice has not been checked yet. Its amount does not yet count in your costs and VAT.',
  },
  'wh.todo.ongecontroleerdMeer': {
    nl: '{n} inkoopfacturen zijn nog niet gecontroleerd. Die bedragen tellen nog niet mee in je kosten en BTW.',
    ar: '{n} فاتورة مشتريات لم تُراجَع بعد. مبالغها لا تُحتسب بعد في مصاريفك وضريبتك.',
    en: '{n} purchase invoices have not been checked yet. Those amounts do not yet count in your costs and VAT.',
  },
  'wh.todo.zonderTarief': {
    nl: '{bedrag} omzet heeft nog geen BTW-tarief. Daardoor is de BTW hierboven te laag.',
    ar: '{bedrag} من الإيراد ما يزال بلا نسبة ضريبة القيمة المضافة. لذلك فالضريبة أعلاه منخفضة.',
    en: '{bedrag} of revenue still has no VAT rate. The VAT above is therefore too low.',
  },
  'wh.voet.berekendFactuur': {
    nl: 'Berekend op factuurstelsel. Per kwartaal zie je de cijfers zoals je ze aangeeft.',
    ar: 'محسوب على نظام الفواتير. لكل ربع ترى الأرقام كما تقدّمها.',
    en: 'Computed on the invoice scheme. Per quarter you see the figures as you file them.',
  },
  'wh.voet.berekendKas': {
    nl: 'Berekend op kasstelsel. Per kwartaal zie je de cijfers zoals je ze aangeeft.',
    ar: 'محسوب على النظام النقدي. لكل ربع ترى الأرقام كما تقدّمها.',
    en: 'Computed on the cash scheme. Per quarter you see the figures as you file them.',
  },
  'wh.voet.factuur': {
    nl: 'Op basis van factuurdatum, niet betaaldatum. Dit is dus je fiscale winst, niet wat er op je rekening staat.',
    ar: 'على أساس تاريخ الفاتورة لا تاريخ الدفع. فهذا ربحك الضريبي، لا ما في حسابك.',
    en: 'Based on the invoice date, not the payment date. So this is your fiscal profit, not what is in your account.',
  },
  'wh.voet.grootboek': {
    nl: 'De controle tegen je PIN-grootboek kon niet worden uitgevoerd — verschillen tussen kassa en grootboek zijn hierboven dus niet meegewogen.',
    ar: 'تعذّرت المراجعة مقابل دفتر «PIN» — فروق الكاشير والدفتر إذن غير محسوبة أعلاه.',
    en: 'The check against your card ledger could not run — differences between till and ledger are therefore not weighed in above.',
  },
  'wh.voet.kas': {
    nl: 'Kasstelsel — je omzet telt op de betaaldatum. De voorbelasting telt op de datum van de inkoopfactuur.',
    ar: 'النظام النقدي — إيرادك يُحتسب بتاريخ الدفع. أمّا ضريبة المشتريات فتُحتسب بتاريخ فاتورة الشراء.',
    en: 'Cash scheme — your turnover counts on the payment date. Input VAT counts on the purchase invoice date.',
  },
  'wh.voet.overstap': {
    nl: 'Deze periode loopt door je overstap naar het kasstelsel heen.',
    ar: 'تمتد هذه الفترة عبر انتقالك إلى النظام النقدي.',
    en: 'This period spans your switch to the cash scheme.',
  },
  'wh.voet.overstapPer': {
    nl: 'Deze periode loopt door je overstap naar het kasstelsel heen (per {datum}).',
    ar: 'تمتد هذه الفترة عبر انتقالك إلى النظام النقدي (اعتبارًا من {datum}).',
    en: 'This period spans your switch to the cash scheme (as of {datum}).',
  },
  'wh.voet.schattingEen': {
    nl: 'Bij 1 betaling is de betaaldatum een schatting (handmatig op betaald gezet) — controleer of de periode klopt.',
    ar: 'في دفعة واحدة، تاريخ الدفع تقديري (عُلّمت كمدفوعة يدويًا) — تحقّق من صحة الفترة.',
    en: 'For 1 payment the payment date is an estimate (marked paid manually) — check that the period is right.',
  },
  'wh.voet.schattingMeer': {
    nl: 'Bij {n} betalingen is de betaaldatum een schatting (handmatig op betaald gezet) — controleer of de periode klopt.',
    ar: 'في {n} دفعة، تاريخ الدفع تقديري (عُلّمت كمدفوعة يدويًا) — تحقّق من صحة الفترة.',
    en: 'For {n} payments the payment date is an estimate (marked paid manually) — check that the period is right.',
  },
  'wp.bestanden.sub': {
    nl: 'Bonnen en documenten',
    ar: 'إيصالات ومستندات',
    en: 'Receipts and documents',
  },
  'wp.brug': {
    nl: 'De Brug',
    ar: 'De Brug (الجسر)',
    en: 'De Brug',
  },
  'wp.brug.sub': {
    nl: 'Zie hoe je facturen en documenten verbonden zijn',
    ar: 'اعرف كيف ترتبط فواتيرك بمستنداتك',
    en: 'See how your invoices and documents are connected',
  },
  'wp.facturen': {
    nl: 'Mijn facturen',
    ar: 'فواتيري',
    en: 'My invoices',
  },
  'wp.facturen.sub': {
    nl: 'Verstuur en beheer',
    ar: 'أرسل وأدر',
    en: 'Send and manage',
  },
  'wp.gegevens': {
    nl: 'Mijn gegevens',
    ar: 'بياناتي',
    en: 'My details',
  },
  'wp.gegevens.sub': {
    nl: 'Bedrijf en account',
    ar: 'الشركة والحساب',
    en: 'Company and account',
  },
  'wp.klanten': {
    nl: 'Mijn klanten',
    ar: 'عملائي',
    en: 'My clients',
  },
  'wp.klanten.sub': {
    nl: 'Klantgegevens en history',
    ar: 'بيانات العميل وسجله',
    en: 'Client details and history',
  },
  'wp.kluis': {
    nl: 'Compliance-kluis',
    ar: 'خزنة الامتثال',
    en: 'Compliance vault',
  },
  'wp.kluis.sub': {
    nl: '7 jaar bewaren, klaar voor je boekhouder',
    ar: 'حفظ 7 سنوات، جاهز للمحاسب',
    en: 'Kept for 7 years, ready for your accountant',
  },

  // ── [TAAL-BLIND] The 472 strings the first scanner could not see — multi-line text
  // nodes and strings inside JSX expressions. Translated in one sweep; the extended gate
  // patterns above the SCREENS list are what keeps this from regrowing.
  'aang.correcties': {
    nl: 'Correcties uit eerdere kwartalen',
    ar: 'تصحيحات من أرباع سابقة',
    en: 'Corrections from earlier quarters',
  },
  'aang.correcties.uitleg': {
    nl: 'Deze kwartalen zijn al ingediend en daarna gewijzigd. Het verschil per kwartaal is €1.000 of minder, dus je mag het in deze aangifte verwerken: tel het bij de rubriek op. Wij vullen niets in.',
    ar: 'هذه الأرباع قُدِّمت بالفعل ثم تغيّرت. الفرق في كل ربع €1.000 أو أقل، فيجوز لك معالجته في هذا الإقرار: أضِفه إلى البند. نحن لا نملأ شيئًا.',
    en: 'These quarters were already filed and changed since. The difference per quarter is €1,000 or less, so you may process it in this return: add it to the rubriek. We fill in nothing.',
  },
  'aang.correcties.meer': {
    nl: 'meer te betalen',
    ar: 'مبلغ إضافي مستحق',
    en: 'more to pay',
  },
  'aang.correcties.minder': {
    nl: 'minder te betalen',
    ar: 'مبلغ أقل مستحق',
    en: 'less to pay',
  },
  'aang.correcties.eerderVerwerkt': {
    nl: 'eerder al {amount} verwerkt',
    ar: 'سبق معالجة {amount}',
    en: '{amount} already processed earlier',
  },
  'aang.correcties.verwerkt': {
    nl: 'Verwerkt',
    ar: 'تمت المعالجة',
    en: 'Processed',
  },
  'aang.correcties.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'aang.correcties.onbekend': {
    nl: 'We konden niet van alle eerdere kwartalen nagaan of er nog iets te verrekenen is. Kijk op de Waarheid-pagina voordat je deze aangifte indient.',
    ar: 'تعذّر علينا التحقّق من كل الأرباع السابقة إن كان لا يزال هناك ما يُسوّى. راجع صفحة Waarheid قبل تقديم هذا الـaangifte.',
    en: 'We could not check every earlier quarter for anything still to settle. Look at the Waarheid page before you file this return.',
  },
  'aang.correcties.mislukt': {
    nl: 'Vastleggen mislukt — er is niets gewijzigd. Probeer het zo meteen opnieuw.',
    ar: 'فشل التسجيل — لم يتغيّر شيء. حاول مرة أخرى بعد قليل.',
    en: 'Could not record it — nothing was changed. Try again in a moment.',
  },
  'aang.correcties.geenVerbinding': {
    nl: 'Geen verbinding — er is niets gewijzigd.',
    ar: 'لا يوجد اتصال — لم يتغيّر شيء.',
    en: 'No connection — nothing was changed.',
  },
  'aang.geenVerbinding': {
    nl: 'Geen verbinding — probeer het zo meteen opnieuw.',
    ar: 'لا يوجد اتصال — حاول مرة أخرى بعد قليل.',
    en: 'No connection — try again in a moment.',
  },
  'aang.ladenMislukt': {
    nl: 'Kon de concept-aangifte niet laden. Probeer het zo meteen opnieuw.',
    ar: 'تعذّر تحميل مسودة الإقرار. حاول مرة أخرى بعد قليل.',
    en: 'Could not load the draft return. Try again in a moment.',
  },
  'aang.ladenMisluktKort': {
    nl: 'Kon de concept-aangifte niet laden.',
    ar: 'تعذّر تحميل مسودة الإقرار.',
    en: 'Could not load the draft return.',
  },
  'aang.sessieVerlopen': {
    nl: 'Je sessie is verlopen — log opnieuw in.',
    ar: 'انتهت جلستك — سجّل الدخول من جديد.',
    en: 'Your session has expired — log in again.',
  },
  'abo.beheerUitleg': {
    nl: 'Betaalgegevens wijzigen, btw-facturen downloaden of opzeggen.',
    ar: 'تغيير بيانات الدفع، أو تنزيل فواتير ضريبة القيمة المضافة، أو الإلغاء.',
    en: 'Change payment details, download btw invoices, or cancel.',
  },
  'abo.neem': {
    nl: 'Neem een abonnement',
    ar: 'احصل على اشتراك',
    en: 'Get a subscription',
  },
  'bewerk.betalenOp': {
    nl: 'Betalen op',
    ar: 'يُدفع إلى',
    en: 'Pay to',
  },
  'datum.geenBestaande': {
    nl: 'Dat is geen bestaande datum — gebruik dd-mm-jjjj.',
    ar: 'هذا ليس تاريخًا موجودًا — استخدم dd-mm-jjjj.',
    en: 'That is not an existing date — use dd-mm-jjjj.',
  },
  // [DATE-NL] The bounds the field enforces, said in the owner's language. {datum} is dd-mm-jjjj.
  'datum.voorMinimum': {
    nl: 'Die datum ligt vóór {datum} — controleer het jaartal.',
    en: 'That date is before {datum} — check the year.',
    ar: 'هذا التاريخ يسبق {datum} — تحقّق من السنة.',
    tr: 'Bu tarih {datum} öncesinde — yılı kontrol et.',
  },
  'datum.naMaximum': {
    nl: 'Die datum ligt in de toekomst (na {datum}).',
    en: 'That date is in the future (after {datum}).',
    ar: 'هذا التاريخ في المستقبل (بعد {datum}).',
    tr: 'Bu tarih gelecekte ({datum} sonrası).',
  },
  'lijst.geenBetaalde': {
    nl: 'Geen betaalde facturen',
    ar: 'لا توجد فواتير مدفوعة',
    en: 'No paid invoices',
  },
  'lijst.nogGeen': {
    nl: 'Nog geen facturen',
    ar: 'لا توجد فواتير بعد',
    en: 'No invoices yet',
  },
  'onb.anderProgramma': {
    nl: 'Kom je van een ander programma? Vul je volgende factuurnummer in — wij gaan verder waar jij gebleven bent.',
    ar: 'قادم من برنامج آخر؟ أدخل رقم فاتورتك التالي — ونحن نكمل من حيث توقفت أنت.',
    en: 'Coming from another program? Enter your next invoice number — we pick up where you left off.',
  },
  'onb.nogGeenBoekhouder': {
    nl: 'Nog geen boekhouder? Sla dit gerust over. Je kunt hem later in één klik koppelen, en voor hem is BoekBrug altijd gratis.',
    ar: 'ليس لديك محاسب بعد؟ تجاوز هذه الخطوة بلا تردد. يمكنك ربطه لاحقًا بنقرة واحدة، ويبقى BoekBrug مجانيًا له دائمًا.',
    en: 'No accountant yet? Feel free to skip this. You can connect him later in one click, and for him BoekBrug is always free.',
  },
  'onb.overgenomenUitFactuur': {
    nl: 'We hebben dit overgenomen uit de factuur die je net maakte. Controleer het even en pas aan wat niet klopt.',
    ar: 'أخذنا هذه البيانات من الفاتورة التي أنشأتها للتو. راجعها سريعًا وعدّل ما لا يصح.',
    en: 'We took this from the invoice you just made. Check it briefly and adjust anything that is off.',
  },
  'prul.autoVerwijderd': {
    nl: 'Bestanden in de prullenbak worden na 30 dagen automatisch permanent verwijderd.',
    ar: 'تُحذف الملفات الموجودة في سلة المهملات نهائيًا بشكل تلقائي بعد 30 يومًا.',
    en: 'Files in the bin are automatically deleted permanently after 30 days.',
  },
  'prul.nietOngedaan': {
    nl: 'Dit kan niet ongedaan worden gemaakt. Denk aan de bewaarplicht: de Belastingdienst verwacht dat je administratie zeven jaar bewaard blijft.',
    ar: 'لا يمكن التراجع عن هذا. تذكّر واجب الحفظ: تتوقع مصلحة الضرائب (Belastingdienst) أن تبقى سجلات إدارتك محفوظة سبع سنوات.',
    en: 'This cannot be undone. Mind the retention duty: the Belastingdienst expects your records to be kept for seven years.',
  },
  'prul.verwijderdOp': {
    nl: 'Verwijderd op {date}',
    ar: 'حُذف في {date}',
    en: 'Deleted on {date}',
  },
  'prul.verwijderMislukt': {
    nl: '{count} bestand(en) konden niet worden verwijderd. Ze staan nog in de prullenbak.',
    ar: 'الملفات التي تعذّر حذفها: {count}. ما زالت في سلة المهملات.',
    en: '{count} file(s) could not be deleted. They are still in the bin.',
  },
  // ─── [BEWIJS-VAST] Waarom een definitieve verwijdering wordt geweigerd ──────────────────────
  //
  // Elk van deze regels noemt één ding dat nog naar het bestand verwijst. Ze staan per AANTAL
  // apart, enkelvoud en meervoud, om de reden die bovenaan dit bestand staat: "1 factuur" en
  // "3 facturen" zijn twee zinnen, en in het Arabisch en Turks liggen ze verder uit elkaar dan in
  // het Nederlands. De server kiest de sleutel; het scherm rendert wat het krijgt.
  'prul.ref.factuurBewijs.een': {
    nl: 'een factuur waarvan dit het bewijsstuk is',
    ar: 'فاتورة هذا الملف مستندها الداعم',
    en: 'an invoice this file is the supporting document for',
  },
  'prul.ref.factuurBewijs.meer': {
    nl: '{count} facturen waarvan dit het bewijsstuk is',
    ar: '{count} فواتير هذا الملف مستندها الداعم',
    en: '{count} invoices this file is the supporting document for',
  },
  'prul.ref.factuurBijlage.een': {
    nl: 'een factuur die dit als bijlage heeft meegestuurd',
    ar: 'فاتورة أُرسل معها هذا الملف كمرفق',
    en: 'an invoice that was sent out with this as an attachment',
  },
  'prul.ref.factuurBijlage.meer': {
    nl: '{count} facturen die dit als bijlage hebben meegestuurd',
    ar: '{count} فواتير أُرسل معها هذا الملف كمرفق',
    en: '{count} invoices that were sent out with this as an attachment',
  },
  'prul.ref.bankBijlage.een': {
    nl: 'een bankregel waar dit als bijlage bij hoort',
    ar: 'سطر بنكي هذا الملف مرفق به',
    en: 'a bank line this is attached to',
  },
  'prul.ref.bankBijlage.meer': {
    nl: '{count} bankregels waar dit als bijlage bij hoort',
    ar: '{count} أسطر بنكية هذا مرفق بها',
    en: '{count} bank lines this is attached to',
  },
  'prul.ref.kasboek.een': {
    nl: 'een kasboekregel waar dit de bon van is',
    ar: 'سطر في دفتر الصندوق هذا الملف هو إيصالُه',
    en: 'a cash-book line this file is the receipt for',
  },
  'prul.ref.kasboek.meer': {
    nl: '{count} kasboekregels waar dit de bon van is',
    ar: '{count} أسطر في دفتر الصندوق هذا الملف هو إيصالها',
    en: '{count} cash-book lines this file is the receipt for',
  },
  'prul.ref.dagomzet.een': {
    nl: 'een dagomzet die op dit bestand steunt',
    ar: 'إيراد يوم واحد يستند إلى هذا الملف',
    en: "a day's turnover that rests on this file",
  },
  'prul.ref.dagomzet.meer': {
    nl: '{count} dagomzetten die op dit bestand steunen',
    ar: 'إيرادات {count} أيام تستند إلى هذا الملف',
    en: '{count} daily turnover records that rest on this file',
  },
  'prul.ref.pin.een': {
    nl: 'een pinafrekening die op dit bestand steunt',
    ar: 'تسوية دفع إلكتروني واحدة تستند إلى هذا الملف',
    en: 'a card settlement that rests on this file',
  },
  'prul.ref.pin.meer': {
    nl: '{count} pinafrekeningen die op dit bestand steunen',
    ar: '{count} تسويات دفع إلكتروني تستند إلى هذا الملف',
    en: '{count} card settlements that rest on this file',
  },
  'prul.ref.dagstaat.een': {
    nl: 'een dagstaat die op dit bestand steunt',
    ar: 'كشف يومي واحد يستند إلى هذا الملف',
    en: 'a daily ledger sheet that rests on this file',
  },
  'prul.ref.dagstaat.meer': {
    nl: '{count} dagstaten die op dit bestand steunen',
    ar: '{count} كشوف يومية تستند إلى هذا الملف',
    en: '{count} daily ledger sheets that rest on this file',
  },
  'prul.ref.banktransactie.een': {
    nl: 'een banktransactie die uit dit afschrift is ingelezen',
    ar: 'حركة بنكية واحدة قُرئت من هذا الكشف',
    en: 'a bank transaction that was read from this statement',
  },
  'prul.ref.banktransactie.meer': {
    nl: '{count} banktransacties die uit dit afschrift zijn ingelezen',
    ar: '{count} حركات بنكية قُرئت من هذا الكشف',
    en: '{count} bank transactions that were read from this statement',
  },
  // De enige die niet zegt wat eraan hangt maar wat er VERANDERT: deze verwijzing is ON DELETE
  // CASCADE, dus de dekkingsregel wordt niet losgekoppeld maar weggegooid — en dekking is geen
  // documentatie, het is invoer voor de kas- en bankstanden.
  'prul.ref.dekking.een': {
    nl: 'de dekking van dit bankafschrift — het verwijderen verandert je kas- en bankstanden',
    ar: 'تغطية هذا الكشف البنكي — حذفه يغيّر أرصدة النقدية والبنك لديك',
    en: "this statement's coverage — deleting it changes your cash and bank balances",
  },
  'prul.ref.dekking.meer': {
    nl: 'de dekking van {count} bankafschriftperiodes — het verwijderen verandert je kas- en bankstanden',
    ar: 'تغطية {count} فترات كشوف بنكية — حذفها يغيّر أرصدة النقدية والبنك لديك',
    en: "the coverage of {count} statement periods — deleting it changes your cash and bank balances",
  },
  // [GENEGEERD-TELT] Wat "negeren" met het geld doet, zichtbaar bij de keuze zelf. De hint stond
  // alleen in een title-attribuut — een tooltip die op een telefoon niet bestaat, terwijl drie van
  // de vijf knoppen een bedrag uit de kosten en de btw halen. De redenen worden als LABELS
  // ingevuld, precies zoals ze op de knoppen staan.
  // [ONB-WAAROM] Waarom "Volgende" uit staat. Deze zinnen bestonden wél — als setKvkError in
  // handleNext — maar handleNext kán niet draaien wanneer de knop die hem aanroept juist daarom is
  // uitgeschakeld. De uitleg stond in code die de gebruiker nooit bereikt: hij tikt zeven cijfers,
  // de knop dooft, en het scherm zwijgt.
  'onb.blokBedrijfsnaam': {
    nl: 'Vul je bedrijfsnaam in om verder te gaan.',
    ar: 'أدخل اسم شركتك للمتابعة.',
    en: 'Fill in your company name to continue.',
  },
  'onb.blokKvk': {
    nl: 'Een KVK-nummer bestaat uit 8 cijfers. Laat het veld leeg als je het nu niet bij de hand hebt.',
    ar: 'رقم غرفة التجارة (KVK) يتكوّن من 8 أرقام. اترك الحقل فارغًا إن لم يكن لديك الآن.',
    en: 'A KVK number is 8 digits. Leave the field empty if you do not have it to hand.',
  },
  'onb.blokNummering': {
    nl: 'Dit factuurnummer kunnen we niet lezen. Gebruik bijvoorbeeld 2026001.',
    ar: 'تعذّر قراءة رقم الفاتورة هذا. استخدم مثلًا 2026001.',
    en: 'We cannot read this invoice number. Use 2026001, for example.',
  },
  // [ONB-IBAN] Geen wettelijk gebrek en daarom niet in de lijst hierboven — maar wel het verschil
  // tussen een factuur die aankomt en een factuur die betaald wordt.
  'onb.geenIban': {
    nl: 'Nog geen rekeningnummer ingevuld. Je facturen mogen de deur uit, maar er staat dan geen IBAN op — je klant kan hem niet betalen. Vul je IBAN aan bij Instellingen.',
    ar: 'لم تُدخل رقم حساب بعد. يمكن إرسال فواتيرك، لكنها ستخرج بدون IBAN — ولن يتمكّن عميلك من دفعها. أضف الـ IBAN من الإعدادات.',
    en: 'No bank account number entered yet. Your invoices may go out, but they carry no IBAN then — your customer cannot pay them. Add your IBAN under Instellingen.',
  },
  'onb.tipZoekbalk': {
    nl: '💡 Tip: gebruik de zoekbalk om elke factuur in seconden terug te vinden',
    ar: '💡 نصيحة: استخدم شريط البحث للعثور على أي فاتورة في ثوانٍ',
    en: '💡 Tip: use the search bar to find any invoice in seconds',
  },
  // [BANK-WERK-EERST] De kop waaronder de machinerie van het bankscherm samenvouwt zodra er werk
  // is: de koppeling, de sleepzone en de lijst afschriften. Eén regel in plaats van drie blokken
  // boven het enige waarvoor de ondernemer dit scherm opent.
  // [BANK-STAND] Wat er nú op de ondernemer wacht, in één zin — dezelfde plaats en dezelfde toon
  // als de kopregel van /dashboard/incoming, die deze vorm al had. Wat er stond was een vaste
  // beschrijving van wat het scherm dóét ("Koppel je bank of upload je bankafschrift…"), en die
  // las elke dag hetzelfde, hoeveel of hoe weinig er ook lag.
  //
  // Aparte zinnen per geval en geen zelfstandig naamwoord als parameter: "te bevestigen" en "zonder
  // factuur" zijn twee verschillende handelingen en geen twee waarden van één woord.
  'bank.stand.leeg': {
    nl: 'Nog geen banktransacties. Koppel je bank of upload een afschrift.',
    ar: 'لا حركات بنكية بعد. اربط بنكك أو ارفع كشفًا.',
    en: 'No bank transactions yet. Connect your bank or upload a statement.',
  },
  'bank.stand.klaar': {
    nl: 'Alles afgehandeld. Er wacht geen bankregel meer op je.',
    ar: 'كل شيء منجَز. لا يوجد سطر بنكي ينتظرك.',
    en: 'All handled. No bank line is waiting for you.',
  },
  'bank.stand.bevestigenEen': {
    nl: '1 regel wacht op je bevestiging.',
    ar: 'سطر واحد ينتظر تأكيدك.',
    en: '1 line is waiting for you to confirm it.',
  },
  'bank.stand.bevestigen': {
    nl: '{count} regels wachten op je bevestiging.',
    ar: '{count} أسطر تنتظر تأكيدك.',
    en: '{count} lines are waiting for you to confirm them.',
  },
  'bank.stand.geenFactuurEen': {
    nl: '1 regel heeft nog geen factuur.',
    ar: 'سطر واحد بلا فاتورة بعد.',
    en: '1 line has no invoice yet.',
  },
  'bank.stand.geenFactuur': {
    nl: '{count} regels hebben nog geen factuur.',
    ar: '{count} أسطر بلا فواتير بعد.',
    en: '{count} lines have no invoice yet.',
  },
  'bank.stand.pinEen': {
    nl: '1 pinafrekening wacht op je.',
    ar: 'تسوية دفع إلكتروني واحدة تنتظرك.',
    en: '1 card settlement is waiting for you.',
  },
  'bank.stand.pin': {
    nl: '{count} pinafrekeningen wachten op je.',
    ar: '{count} تسويات دفع إلكتروني تنتظرك.',
    en: '{count} card settlements are waiting for you.',
  },
  'bank.setup.kop': {
    nl: 'Afschriften en koppeling',
    ar: 'الكشوف والربط البنكي',
    en: 'Statements and bank link',
  },
  'bank.setup.aantalEen': {
    nl: '· 1 afschrift',
    ar: '· كشف واحد',
    en: '· 1 statement',
  },
  'bank.setup.aantal': {
    nl: '· {count} afschriften',
    ar: '· {count} كشوف',
    en: '· {count} statements',
  },
  'bank.setup.toevoegen': {
    nl: 'Afschrift toevoegen',
    ar: 'إضافة كشف',
    en: 'Add a statement',
  },
  'bank.redenGevolg': {
    nl: '{uit} halen dit bedrag ook uit je kosten en btw. Bij {in} blijft het gewoon meetellen.',
    en: '{uit} also take this amount out of your costs and VAT. With {in} it keeps counting as before.',
    ar: '{uit} تُخرج هذا المبلغ أيضًا من تكاليفك وضريبتك. أما مع {in} فيبقى محتسبًا كما هو.',
  },
  'prul.nietVerwijderdTitel': {
    nl: 'Dit bestand is nog in gebruik',
    ar: 'هذا الملف ما زال قيد الاستخدام',
    en: 'This file is still in use',
  },
  'prul.nietVerwijderdUitleg': {
    nl: 'Het is niet verwijderd: je boekhouding verwijst er nog naar.',
    ar: 'لم يُحذف: ما زالت محاسبتك تشير إليه.',
    en: 'It was not deleted: your bookkeeping still refers to it.',
  },
  'prul.nietVerwijderdActie': {
    nl: 'Haal het bestand daar eerst los, of verwijder die boeking. Daarna kun je het hier weggooien — zo blijft je administratie niet achter met een boeking zonder bewijsstuk.',
    ar: 'افصل الملف عن ذلك أولًا، أو احذف ذلك القيد. بعدها يمكنك حذفه من هنا — بهذا لا تبقى إدارتك بقيد بلا مستند داعم.',
    en: 'Detach the file there first, or delete that entry. After that you can throw it away here — so your records are never left with an entry that has no supporting document.',
  },
  'prul.controleMisluktTitel': {
    nl: 'Niet verwijderd',
    ar: 'لم يُحذف',
    en: 'Not deleted',
  },
  'prul.controleMislukt': {
    nl: 'We konden niet nagaan of je boekhouding nog naar dit bestand verwijst, dus is het niet verwijderd. Probeer het straks opnieuw — het staat nog in je prullenbak.',
    ar: 'تعذّر علينا التحقق مما إذا كانت محاسبتك ما زالت تشير إلى هذا الملف، لذلك لم يُحذف. حاول لاحقًا — ما زال في سلة المهملات.',
    en: 'We could not check whether your bookkeeping still refers to this file, so it was not deleted. Try again later — it is still in your bin.',
  },
  'prul.verwijderVraagEen': {
    nl: 'Bestand permanent verwijderen?',
    ar: 'حذف الملف نهائيًا؟',
    en: 'Delete this file permanently?',
  },
  'prul.verwijderVraagMeer': {
    nl: '{count} bestanden permanent verwijderen?',
    ar: 'حذف {count} من الملفات نهائيًا؟',
    en: 'Delete {count} files permanently?',
  },
  'vk.herinnerenMislukt': {
    nl: 'Herinneren lukte niet',
    ar: 'تعذّر إرسال التذكير',
    en: 'Sending the reminder failed',
  },
  'vk.herinnerenMisluktVerbinding': {
    nl: 'Herinneren lukte niet — controleer je verbinding',
    ar: 'تعذّر إرسال التذكير — تحقّق من اتصالك',
    en: 'Sending the reminder failed — check your connection',
  },
  'vk.herinneringSturen': {
    nl: 'Herinnering sturen',
    ar: 'إرسال تذكير',
    en: 'Send a reminder',
  },
  'vk.herinneringVerstuurd': {
    nl: 'Herinnering verstuurd ✓',
    ar: 'تم إرسال التذكير ✓',
    en: 'Reminder sent ✓',
  },
  'vk.zonderKlant': {
    nl: 'Zonder klant',
    ar: 'بدون عميل',
    en: 'Without a client',
  },

  // ── [TAAL-REST] The fragments the third scanner pass surfaced: the wizard's error
  // messages (double-quoted, invisible to the single-quote pattern), split sentences around
  // <strong>, template literals with a name in them, and the aangifte's art. 29 paragraphs.
  'onb.sessieVerlopenAfronden': {
    nl: 'Je sessie is verlopen — log opnieuw in om je aanmelding af te ronden.',
    ar: 'انتهت صلاحية جلستك — سجّل الدخول من جديد لإكمال تسجيلك.',
    en: 'Your session has expired — log in again to finish signing up.',
  },
  'onb.afrondenMislukt': {
    nl: 'Afronden mislukt — controleer je verbinding en probeer het opnieuw.',
    ar: 'تعذّر الإكمال — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Finishing failed — check your connection and try again.',
  },
  'onb.nummeringMislukt': {
    nl: 'Kon de nummering niet opslaan — probeer opnieuw of sla over.',
    ar: 'تعذّر حفظ الترقيم — حاول مرة أخرى أو تخطَّ هذه الخطوة.',
    en: 'Could not save the numbering — try again or skip.',
  },
  'onb.emailKloptNiet': {
    nl: 'Dit e-mailadres klopt niet — controleer het of laat het leeg.',
    ar: 'هذا البريد الإلكتروني غير صحيح — تحقّق منه أو اتركه فارغًا.',
    en: 'This e-mail address is not valid — check it or leave it empty.',
  },
  'onb.teVeelUitnodigingen': {
    nl: 'Te veel uitnodigingen achter elkaar — wacht even, of sla deze stap over.',
    ar: 'دعوات كثيرة متتالية — انتظر قليلًا أو تخطَّ هذه الخطوة.',
    en: 'Too many invitations in a row — wait a moment, or skip this step.',
  },
  'onb.uitnodigingMislukt': {
    nl: 'De uitnodiging kon niet verstuurd worden. Probeer het opnieuw of sla over.',
    ar: 'تعذّر إرسال الدعوة. حاول مرة أخرى أو تخطَّ الخطوة.',
    en: 'The invitation could not be sent. Try again or skip.',
  },
  'onb.opslaanMislukt': {
    nl: 'Opslaan mislukt — controleer je verbinding en probeer opnieuw.',
    ar: 'تعذّر الحفظ — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Saving failed — check your connection and try again.',
  },
  'onb.overslaanMislukt': {
    nl: 'Overslaan mislukt — controleer je verbinding en probeer opnieuw.',
    ar: 'تعذّر التخطي — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Skipping failed — check your connection and try again.',
  },
  'onb.sessieVerlopenReset': {
    nl: 'Je sessie is verlopen — log opnieuw in om opnieuw te beginnen.',
    ar: 'انتهت صلاحية جلستك — سجّل الدخول من جديد للبدء من جديد.',
    en: 'Your session has expired — log in again to start over.',
  },
  'onb.resetMislukt': {
    nl: 'Opnieuw beginnen is niet gelukt. Je gegevens staan er nog; probeer het zo opnieuw.',
    ar: 'لم ينجح البدء من جديد. بياناتك ما زالت موجودة؛ حاول بعد قليل.',
    en: 'Starting over did not work. Your data is still there; try again shortly.',
  },
  'onb.resetVerbinding': {
    nl: 'Opnieuw beginnen is niet gelukt — controleer je verbinding.',
    ar: 'لم ينجح البدء من جديد — تحقّق من اتصالك.',
    en: 'Starting over did not work — check your connection.',
  },
  'onb.puntAlles': { nl: 'Alle facturen op één plek', ar: 'كل الفواتير في مكان واحد', en: 'All invoices in one place' },
  'onb.puntAI': { nl: 'AI leest je documenten automatisch', ar: 'الذكاء الاصطناعي يقرأ مستنداتك تلقائيًا', en: 'AI reads your documents automatically' },
  'onb.puntKwijt': { nl: 'Nooit meer een factuur kwijt', ar: 'لن تفقد فاتورة بعد اليوم', en: 'Never lose an invoice again' },
  'onb.zzpDesc': { nl: 'Ik stuur en ontvang facturen', ar: 'أنا أرسل الفواتير وأستقبلها', en: 'I send and receive invoices' },
  'onb.boekhouderDesc': { nl: 'Ik beheer facturen voor klanten', ar: 'أدير الفواتير لعملائي', en: 'I manage invoices for clients' },
  'onb.klaarAccountant': {
    nl: 'Nodig klanten uit en beheer alles op één plek.',
    ar: 'ادعُ عملاءك وأدر كل شيء من مكان واحد.',
    en: 'Invite clients and manage everything in one place.',
  },
  'onb.klaarNogEen': {
    nl: 'Je kunt meteen aan de slag. Eén ding nog voordat je facturen kunt versturen:',
    ar: 'يمكنك البدء فورًا. أمر واحد متبقٍ قبل أن تتمكن من إرسال الفواتير:',
    en: 'You can get started right away. One more thing before you can send invoices:',
  },
  // [ONB-IBAN] Versturen KAN, betaald worden niet. Een eigen zin naast klaarNogEen, want "voordat
  // je facturen kunt versturen" is hier onwaar en stuurt de ondernemer naar het verkeerde veld.
  'onb.klaarNogBetaald': {
    nl: 'Je kunt meteen aan de slag. Eén ding nog voordat je klanten je kunnen betalen:',
    ar: 'يمكنك البدء فورًا. أمر واحد متبقٍ قبل أن يتمكن عملاؤك من الدفع لك:',
    en: 'You can get started right away. One more thing before your customers can pay you:',
  },
  'onb.klaarIngericht': {
    nl: 'BoekBrug is ingericht en klaar voor gebruik.',
    ar: 'تم إعداد BoekBrug وهو جاهز للاستخدام.',
    en: 'BoekBrug is set up and ready to use.',
  },
  'onb.bijnaKlaar': { nl: 'Bijna klaar, {name}!', ar: 'اقتربت من النهاية يا {name}!', en: 'Almost done, {name}!' },
  'onb.jeBentKlaar': { nl: 'Je bent klaar, {name}!', ar: 'أنت جاهز يا {name}!', en: 'You are all set, {name}!' },
  'onb.eersteWordt': { nl: 'Je eerste factuur wordt:', ar: 'ستكون فاتورتك الأولى:', en: 'Your first invoice will be:' },
  'onb.volgendeNummer': { nl: 'De volgende: {number}', ar: 'والتالية: {number}', en: 'The next one: {number}' },
  'onb.alleenNaamUitleg': {
    nl: 'Alleen de naam is verplicht. BTW-nummer en adres heb je nodig om te factureren, je IBAN om betaald te worden — nu invullen, of later bij Instellingen.',
    ar: 'الاسم وحده إلزامي. تحتاج إلى رقم btw والعنوان لإصدار الفواتير، وإلى IBAN كي تُدفع لك — أدخلها الآن أو لاحقًا في «الإعدادات».',
    en: 'Only the name is required. You need the VAT number and address to invoice, and your IBAN to get paid — fill in now, or later under Settings.',
  },
  // Short field NAMES for the missing-fields list — the label keys are full questions.
  'onb.veldBedrijfsnaam': { nl: 'bedrijfsnaam', ar: 'اسم الشركة', en: 'company name' },
  'onb.veldBtw': { nl: 'BTW-nummer', ar: 'رقم btw', en: 'VAT number' },
  'onb.veldKvk': { nl: 'KvK-nummer', ar: 'رقم KVK', en: 'KvK number' },
  'onb.veldAdres': { nl: 'adres', ar: 'العنوان', en: 'address' },
  'aang.art29.terugbetalenKop': {
    nl: '€{amount} voorbelasting terugbetalen',
    ar: 'يجب إعادة €{amount} من ضريبة المشتريات',
    en: '€{amount} input VAT to repay',
  },
  // [BESTE] The pre-filing checklist: what this quarter still misses, each with the screen that
  // fixes it. Never a gate — the owner keeps the say.
  'aang.klaar.kop': { nl: 'Nog te doen voor je indient', ar: 'ما تبقّى قبل التقديم', en: 'Still to do before you file' },
  'aang.klaar.niets': { nl: 'Niets mist voor dit kwartaal.', ar: 'لا شيء ناقص لهذا الربع.', en: 'Nothing is missing for this quarter.' },
  'aang.klaar.mislukt': { nl: 'We konden niet controleren wat er nog mist.', ar: 'لم نتمكن من التحقق مما ينقص.', en: 'We could not check what is still missing.' },
  'aang.klaar.open': { nl: 'Openen', ar: 'فتح', en: 'Open' },
  'aang.art29.openEen': {
    nl: '1 inkoopfactuur staat meer dan een jaar na de vervaldatum open.',
    ar: 'فاتورة شراء واحدة ما زالت مفتوحة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '1 purchase invoice has been open for more than a year past its due date.',
  },
  'aang.art29.openMeer': {
    nl: '{n} inkoopfacturen staan meer dan een jaar na de vervaldatum open.',
    ar: '{n} فاتورة شراء ما زالت مفتوحة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '{n} purchase invoices have been open for more than a year past their due date.',
  },
  'aang.art29.clawbackUitleg': {
    nl: 'De BTW die je hierover aftrok wordt weer verschuldigd (art. 29 lid 7 Wet OB). Wél betaald? Koppel de betaling of zet ze op betaald. Dit bedrag zit niet in de rubrieken hierboven.',
    ar: 'الضريبة التي خصمتها عن هذه تصبح مستحقة من جديد (art. 29 lid 7 Wet OB). دفعتها فعلًا؟ اربط الدفعة أو علّمها كمدفوعة. هذا المبلغ غير مشمول في البنود أعلاه.',
    en: 'The VAT you deducted on these becomes due again (art. 29 lid 7 Wet OB). Actually paid? Link the payment or mark them as paid. This amount is not in the boxes above.',
  },
  'aang.art29.terugvragenKop': {
    nl: '€{amount} BTW terug te vragen',
    ar: 'يمكن استرداد €{amount} من الضريبة',
    en: '€{amount} VAT to reclaim',
  },
  'aang.art29.onbetaaldEen': {
    nl: '1 verkoopfactuur staat meer dan een jaar na de vervaldatum onbetaald.',
    ar: 'فاتورة بيع واحدة ما زالت غير مدفوعة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '1 sales invoice has been unpaid for more than a year past its due date.',
  },
  'aang.art29.onbetaaldMeer': {
    nl: '{n} verkoopfacturen staan meer dan een jaar na de vervaldatum onbetaald.',
    ar: '{n} فاتورة بيع ما زالت غير مدفوعة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '{n} sales invoices have been unpaid for more than a year past their due date.',
  },
  'aang.art29.terugvraagUitleg': {
    nl: 'De BTW die je hierover afdroeg kun je terugvragen (oninbare vordering, art. 29 Wet OB). Dit bedrag zit niet in de rubrieken hierboven — bespreek het tijdvak met je boekhouder.',
    ar: 'الضريبة التي سددتها عن هذه يمكنك استردادها (دين معدوم، art. 29 Wet OB). هذا المبلغ غير مشمول في البنود أعلاه — ناقش الفترة مع المحاسب.',
    en: 'The VAT you paid on these you can reclaim (bad debt, art. 29 Wet OB). This amount is not in the boxes above — discuss the period with your accountant.',
  },
  'aang.icp.uitleg1': {
    nl: 'Leveringen aan ondernemers in de EU (rubriek 3b hierboven) moet je óók per BTW-nummer opgeven.',
    ar: 'التوريدات إلى شركات داخل الاتحاد الأوروبي (البند 3b أعلاه) يجب التصريح بها أيضًا لكل رقم btw على حدة.',
    en: 'Supplies to EU businesses (box 3b above) must also be declared per VAT number.',
  },
  'aang.icp.uitleg2': {
    nl: 'Dit is geen onderdeel van de BTW-aangifte en wordt hier niet ingediend.',
    ar: 'هذا ليس جزءًا من إقرار ضريبة القيمة المضافة ولا يُقدَّم هنا.',
    en: 'This is not part of the VAT return and is not filed here.',
  },
  'aang.berekenen': { nl: 'Berekenen…', ar: 'جارٍ الحساب…', en: 'Calculating…' },
  'lijst.geenMetStatus': {
    nl: 'Geen facturen met status “{status}”',
    ar: 'لا توجد فواتير بالحالة «{status}»',
    en: 'No invoices with status “{status}”',
  },
  'vkp.nogNietVerstuurd': { nl: 'nog niet verstuurd', ar: 'لم تُرسل بعد', en: 'not sent yet' },
  'zoek.kort': { nl: 'Zoeken…', ar: 'جارٍ البحث…', en: 'Search…' },
  'zoek.uitgebreid': {
    nl: 'Zoeken naar facturen, bedragen, bestanden…',
    ar: 'ابحث عن فواتير أو مبالغ أو ملفات…',
    en: 'Search invoices, amounts, files…',
  },

  // ─── [BETAALBEWIJS] Under every "Betaald", how we know ──────────────────────────────────────
  //
  // A payment PROVEN by a bank line and a payment the owner ticked by hand are different facts.
  // The first is corroborated by a third party; the second is a memory. Rendering both as the same
  // word borrows the bank's authority for the tick — and when the tick was a mistake, nothing on
  // the screen ever says so.
  //
  // The direction is not decoration. Money leaves for a purchase invoice and ARRIVES for a sales
  // one, so "afgeschreven naar Kiwi Food Market" under an invoice Kiwi paid describes the owner
  // paying their own customer. Own keys per direction, per rule 1 of this file.

  'betaal.onbekend': {
    nl: 'We konden niet nakijken waar deze betaling vandaan komt.',
    ar: 'تعذّر التحقق من مصدر هذه الدفعة.',
    en: 'We could not check where this payment came from.',
  },
  // Honest, and rare. "Betaald" with nothing recording how is the one case where the app has a
  // status and no evidence at all — saying so is what keeps the other two worth believing.
  'betaal.geen': {
    nl: 'Als betaald gemarkeerd, maar er is geen betaling aan gekoppeld.',
    ar: 'مُعلَّمة كمدفوعة، لكن لا توجد دفعة مرتبطة بها.',
    en: 'Marked as paid, but no payment is linked to it.',
  },

  'betaal.hand': {
    nl: '{bedrag} door jou afgevinkt op {datum} — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت بتاريخ {datum} — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you on {datum} — no bank line is linked to it.',
  },
  'betaal.hand.zonderDatum': {
    nl: '{bedrag} door jou afgevinkt — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you — no bank line is linked to it.',
  },
  'betaal.hand.kas': {
    nl: '{bedrag} door jou contant afgevinkt op {datum} — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت نقدًا بتاريخ {datum} — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you as cash on {datum} — no bank line is linked to it.',
  },
  'betaal.hand.kas.zonderDatum': {
    nl: '{bedrag} door jou contant afgevinkt — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت نقدًا — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you as cash — no bank line is linked to it.',
  },

  // Money OUT — a bill the owner paid.
  'betaal.bank.inkoop': {
    nl: '{bedrag} afgeschreven op {datum} naar {naam}',
    ar: 'خُصم {bedrag} في {datum} إلى {naam}',
    en: '{bedrag} debited on {datum} to {naam}',
  },
  'betaal.bank.inkoop.zonderNaam': {
    nl: '{bedrag} afgeschreven op {datum}',
    ar: 'خُصم {bedrag} في {datum}',
    en: '{bedrag} debited on {datum}',
  },
  'betaal.bank.inkoop.zonderDatum': {
    nl: '{bedrag} afgeschreven naar {naam}',
    ar: 'خُصم {bedrag} إلى {naam}',
    en: '{bedrag} debited to {naam}',
  },
  'betaal.bank.inkoop.kaal': {
    nl: '{bedrag} afgeschreven',
    ar: 'خُصم {bedrag}',
    en: '{bedrag} debited',
  },
  // Money IN — an invoice the owner issued and a customer settled.
  'betaal.bank.verkoop': {
    nl: '{bedrag} bijgeschreven op {datum} van {naam}',
    ar: 'وصل {bedrag} في {datum} من {naam}',
    en: '{bedrag} credited on {datum} from {naam}',
  },
  'betaal.bank.verkoop.zonderNaam': {
    nl: '{bedrag} bijgeschreven op {datum}',
    ar: 'وصل {bedrag} في {datum}',
    en: '{bedrag} credited on {datum}',
  },
  'betaal.bank.verkoop.zonderDatum': {
    nl: '{bedrag} bijgeschreven van {naam}',
    ar: 'وصل {bedrag} من {naam}',
    en: '{bedrag} credited from {naam}',
  },
  'betaal.bank.verkoop.kaal': {
    nl: '{bedrag} bijgeschreven',
    ar: 'وصل {bedrag}',
    en: '{bedrag} credited',
  },

  // The bank's own text, quoted verbatim — it is the string the owner RECOGNISES, and recognition
  // is the whole mechanism here. A tidied version is a string they have never seen.
  // ─── [BINNENGEKOMEN-BEWIJS] Money in that belongs to no invoice ──────────────────────────────
  //
  // The mirror of the openstaand panel, asked of the MONEY. Readiness already counts unexplained
  // receipts, and a count cannot tell three payments of € 5 from three of € 5.000 — the first is
  // tidiness, the second is turnover that was never invoiced (art. 52 AWR). So the SUM is named,
  // and so is the day the most recent one arrived: old is a tidy-up, this week is a gap.

  'binnen.scope.een': {
    nl: '1 ontvangen betaling nagekeken tegen {facturen}.',
    ar: 'رُوجعت دفعة واردة واحدة مقابل {facturen}.',
    en: '1 received payment checked against {facturen}.',
  },
  'binnen.scope.meer': {
    nl: '{count} ontvangen betalingen nagekeken tegen {facturen}.',
    ar: 'رُوجعت {count} دفعة واردة مقابل {facturen}.',
    en: '{count} received payments checked against {facturen}.',
  },
  'binnen.tegen.geen': { nl: 'geen openstaande verkoopfacturen', ar: 'لا فواتير مبيعات مفتوحة', en: 'no open sales invoices' },
  'binnen.tegen.een': { nl: '1 openstaande verkoopfactuur', ar: 'فاتورة مبيعات مفتوحة واحدة', en: '1 open sales invoice' },
  'binnen.tegen.meer': { nl: '{count} openstaande verkoopfacturen', ar: '{count} فاتورة مبيعات مفتوحة', en: '{count} open sales invoices' },

  // Money already in, on an invoice the app still calls open — the same finding as the panel
  // above, said from the other side, and the one the owner can act on in a click.
  'binnen.herkend.een': {
    nl: '1 daarvan lijkt bij een factuur te horen die nog openstaat.',
    ar: 'واحدة منها يبدو أنها تخصّ فاتورة ما زالت مفتوحة.',
    en: '1 of them appears to belong to an invoice that is still open.',
  },
  'binnen.herkend.meer': {
    nl: '{count} daarvan lijken bij facturen te horen die nog openstaan.',
    ar: '{count} منها يبدو أنها تخصّ فواتير ما زالت مفتوحة.',
    en: '{count} of them appear to belong to invoices that are still open.',
  },

  // The figure the app never showed. Never an accusation — a payment with no invoice can be a
  // deposit, a private transfer or a refund, and the owner is the only one who knows which.
  'binnen.onbekend.een': {
    nl: '1 betaling van {bedrag} hoort bij geen enkele factuur in je boeken (laatste op {datum}).',
    ar: 'دفعة واحدة بمبلغ {bedrag} لا تخصّ أي فاتورة في دفاترك (آخرها في {datum}).',
    en: '1 payment of {bedrag} belongs to no invoice in your books (most recent on {datum}).',
  },
  'binnen.onbekend.meer': {
    nl: '{count} betalingen van samen {bedrag} horen bij geen enkele factuur in je boeken (laatste op {datum}).',
    ar: '{count} دفعات بمجموع {bedrag} لا تخصّ أي فاتورة في دفاترك (آخرها في {datum}).',
    en: '{count} payments totalling {bedrag} belong to no invoice in your books (most recent on {datum}).',
  },
  'binnen.onbekend.watNu': {
    nl: 'Koppel ze bij Bank, of maak er een factuur voor als er omzet in zit.',
    ar: 'اربطها في صفحة «البنك»، أو أصدر لها فاتورة إن كانت إيراداً.',
    en: 'Link them under Bank, or invoice them if they are turnover.',
  },

  // ─── [DUBBEL-BEWIJS] The no-double-pay check, saying what it did ─────────────────────────────
  //
  // The check answers "have you already paid this?" and had exactly two answers on screen: a
  // warning, or an ordinary pay dialog. "We could not look" rendered as the second one — the same
  // pixels as a completed search that found nothing. Four separate paths reached it: the invoice
  // unreadable, the paid set unreadable, no amount on the document, no vendor to anchor on.
  //
  // These sentences give the check its third answer, and give the other two the SEARCH behind
  // them. Whole sentences per case rather than a noun parameter: 'rekening'/'rekeningen' is a
  // Dutch plural, and a language with a dual or with suffix harmony cannot be served by swapping
  // the noun into a slot.

  'dubbel.zoek.geen': {
    nl: 'Nagekeken: je hebt deze leverancier de afgelopen {dagen} dagen niet eerder dit bedrag betaald.',
    ar: 'تم التحقّق: لم تدفع لهذا المورّد هذا المبلغ خلال آخر {dagen} يومًا.',
    en: 'Checked: you have not paid this supplier this amount in the past {dagen} days.',
  },
  'dubbel.zoek.een': {
    nl: 'Nagekeken tegen 1 rekening die je deze leverancier de afgelopen {dagen} dagen voor hetzelfde bedrag betaalde.',
    ar: 'تمّت المقارنة مع فاتورة واحدة دفعتها لهذا المورّد بالمبلغ نفسه خلال آخر {dagen} يومًا.',
    en: 'Checked against 1 invoice you paid this supplier for the same amount in the past {dagen} days.',
  },
  'dubbel.zoek.meer': {
    nl: 'Nagekeken tegen {count} rekeningen die je deze leverancier de afgelopen {dagen} dagen voor hetzelfde bedrag betaalde.',
    ar: 'تمّت المقارنة مع {count} فاتورة دفعتها لهذا المورّد بالمبلغ نفسه خلال آخر {dagen} يومًا.',
    en: 'Checked against {count} invoices you paid this supplier for the same amount in the past {dagen} days.',
  },
  'dubbel.zoek.grens': {
    nl: 'We hebben de {count} meest recente bekeken. Betaalde je deze leverancier vaker dit bedrag, dan zitten de oudste er niet bij.',
    ar: 'راجعنا أحدث {count} منها. إن كنت قد دفعت لهذا المورّد هذا المبلغ أكثر من ذلك، فالأقدم ليست ضمنها.',
    en: 'We looked at the {count} most recent. If you paid this supplier this amount more often than that, the oldest are not included.',
  },
  'dubbel.anker.iban': {
    nl: 'De leverancier is herkend aan het IBAN, dus aan een rekeningnummer dat maar op één manier geschreven kan worden.',
    ar: 'جرى التعرّف على المورّد عبر الـIBAN، أي عبر رقم حساب لا يُكتب إلا بصورة واحدة.',
    en: 'The supplier was identified by iban — an account number that can only be written one way.',
  },
  'dubbel.anker.naam': {
    nl: 'De leverancier is herkend aan de naam, niet aan een IBAN. Staat die naam op de twee rekeningen net anders geschreven, dan ziet deze controle ze niet als dezelfde leverancier.',
    ar: 'جرى التعرّف على المورّد بالاسم لا بالـIBAN. فإن كُتب الاسم على الفاتورتين بصيغتين مختلفتين قليلًا، فلن يعتبرهما هذا الفحص مورّدًا واحدًا.',
    en: 'The supplier was identified by name, not by iban. If that name is written even slightly differently on the two invoices, this check does not see them as the same supplier.',
  },

  'dubbel.onbekend.factuur': {
    nl: 'We konden deze rekening zelf niet lezen, dus we hebben niet kunnen nakijken of je hem al betaald hebt.',
    ar: 'لم نتمكّن من قراءة هذه الفاتورة نفسها، فلم نستطع التحقّق ممّا إذا كنت قد دفعتها من قبل.',
    en: 'We could not read this invoice itself, so we could not check whether you have already paid it.',
  },
  'dubbel.onbekend.eerder': {
    nl: 'We konden je eerder betaalde rekeningen niet lezen, dus we hebben niet kunnen nakijken of je deze al betaald hebt.',
    ar: 'لم نتمكّن من قراءة فواتيرك المدفوعة سابقًا، فلم نستطع التحقّق ممّا إذا كنت قد دفعت هذه من قبل.',
    en: 'We could not read your previously paid invoices, so we could not check whether you have already paid this one.',
  },
  'dubbel.onbekend.bedrag': {
    nl: 'Op deze rekening staat geen bruikbaar bedrag. Zonder bedrag kunnen we niet nakijken of je hem al betaald hebt.',
    ar: 'لا يحمل هذا المستند مبلغًا صالحًا للاستعمال. وبلا مبلغ لا يمكننا التحقّق ممّا إذا كنت قد دفعته من قبل.',
    en: 'This invoice carries no usable amount. Without one we cannot check whether you have already paid it.',
  },
  'dubbel.onbekend.leverancier': {
    nl: 'Op deze rekening staat geen leverancier en geen IBAN. Zonder een van die twee kunnen we niet nakijken of je hem al betaald hebt.',
    ar: 'لا يحمل هذا المستند اسم مورّد ولا IBAN. وبدون أحدهما لا يمكننا التحقّق ممّا إذا كنت قد دفعته من قبل.',
    en: 'This invoice carries neither a supplier nor an iban. Without one of the two we cannot check whether you have already paid it.',
  },
  // Covers every way the SCREEN failed to get an answer — a dropped connection, an expired
  // session, a request the route refused. Deliberately does not name which: the owner's next step
  // is the same in all of them, and guessing wrong about the cause is worse than not saying.
  'dubbel.onbekend.netwerk': {
    nl: 'De controle op dubbel betalen is niet uitgevoerd.',
    ar: 'لم يُنفَّذ فحص الدفع المزدوج.',
    en: 'The double-payment check did not run.',
  },
  'dubbel.onbekend.watNu': {
    nl: 'Kijk zelf even na of je deze rekening al betaald hebt voordat je hem afvinkt.',
    ar: 'تحقّق بنفسك مما إذا كنت قد دفعت هذه الفاتورة قبل تعليمها كمدفوعة.',
    en: 'Check for yourself whether you have already paid this invoice before ticking it off.',
  },

  // ─── [DUBBEL-BUNDEL] The same three answers, for a whole set at once ─────────────────────────
  //
  // executeBundlePay marked N supplier invoices paid through /api/invoice/pay-toggle and never
  // called the duplicate check at all. The path that pays the MOST invoices in one tap — and where
  // the owner is reviewing five documents instead of one — had no check, and the dialog said
  // nothing about not having one.
  //
  // Precedence in these sentences is deliberate: a real twin outranks an unchecked row, but an
  // unchecked row is never absorbed into a "we checked them all" count. That absorption is the
  // whole defect, one level up.

  'dubbel.bundel.alarm.een': {
    nl: 'Eén van deze rekeningen lijkt je al betaald te hebben: {nummers}.',
    ar: 'يبدو أنك دفعت إحدى هذه الفواتير من قبل: {nummers}.',
    en: 'One of these invoices looks like one you have already paid: {nummers}.',
  },
  'dubbel.bundel.alarm.meer': {
    nl: '{count} van deze rekeningen lijk je al betaald te hebben: {nummers}.',
    ar: 'يبدو أنك دفعت {count} من هذه الفواتير من قبل: {nummers}.',
    en: '{count} of these invoices look like ones you have already paid: {nummers}.',
  },
  // The same alarm for a set whose documents carry no readable number. It cannot name them, and
  // says so rather than printing a sentence that trails off into nothing.
  'dubbel.bundel.alarm.geenNummer': {
    nl: '{count} van deze rekeningen lijk je al betaald te hebben. We kunnen ze hier niet bij nummer noemen.',
    ar: 'يبدو أنك دفعت {count} من هذه الفواتير من قبل. لا يمكننا تسميتها هنا بالأرقام.',
    en: '{count} of these invoices look like ones you have already paid. We cannot name them by number here.',
  },
  'dubbel.bundel.onbekend.een': {
    nl: 'Van 1 rekening konden we niet nakijken of je hem al betaald hebt.',
    ar: 'هناك فاتورة واحدة لم نتمكّن من التحقّق ممّا إذا كنت قد دفعتها.',
    en: 'For 1 invoice we could not check whether you have already paid it.',
  },
  'dubbel.bundel.onbekend.meer': {
    nl: 'Van {count} rekeningen konden we niet nakijken of je ze al betaald hebt.',
    ar: 'هناك {count} فواتير لم نتمكّن من التحقّق ممّا إذا كنت قد دفعتها.',
    en: 'For {count} invoices we could not check whether you have already paid them.',
  },
  'dubbel.bundel.schoon': {
    nl: 'Alle {count} nagekeken: geen ervan lijkt al betaald.',
    ar: 'تم التحقّق من {count} جميعها: لا يبدو أن أيًا منها مدفوع من قبل.',
    en: 'All {count} checked: none of them looks already paid.',
  },
  'dubbel.bundel.grens': {
    nl: 'We hebben er {count} van de {totaal} nagekeken. Over de rest zeggen we niets, want daar hebben we niet naar gekeken.',
    ar: 'راجعنا {count} من أصل {totaal}. ولا نقول شيئًا عن البقية لأننا لم نطّلع عليها.',
    en: 'We checked {count} of the {totaal}. We say nothing about the rest, because we did not look at them.',
  },
  // The sweep is still running. Its own state on purpose: the owner can tap confirm at any moment,
  // including before the answers land, and a blank space there is the same silence as before —
  // just briefer. It also covers a fetch that never settles, where a blank would be permanent.
  'dubbel.bundel.bezig': {
    nl: 'We kijken nog na of je een van deze rekeningen al betaald hebt.',
    ar: 'ما زلنا نتحقّق ممّا إذا كنت قد دفعت إحدى هذه الفواتير من قبل.',
    en: 'We are still checking whether you have already paid any of these invoices.',
  },
  'dubbel.bundel.watNu': {
    nl: 'Kijk die eerst na voordat je de hele set afvinkt.',
    ar: 'راجع تلك أولًا قبل أن تعلّم المجموعة كلها كمدفوعة.',
    en: 'Check those first before ticking off the whole set.',
  },

  // ─── [CREDIT-BEWIJS] Which credit notes produced "Deels gecrediteerd · € 250" ────────────────
  //
  // Same shape as the instalments above, and the same reason: the chip states a conclusion the
  // owner can only check by going and finding the credit notes. Unlike a bank line, these are
  // documents THEY sent, each with a number on it — so naming them is not evidence the app has to
  // gather, only evidence it was already holding and never showed.

  'credit.samen.een': {
    nl: '{bedrag} teruggegeven met 1 creditnota:',
    ar: 'أُعيد {bedrag} بإشعار دائن واحد:',
    en: '{bedrag} credited back with 1 credit note:',
  },
  'credit.samen.meer': {
    nl: '{bedrag} teruggegeven met {count} creditnota\u2019s:',
    ar: 'أُعيد {bedrag} بـ{count} إشعارات دائنة:',
    en: '{bedrag} credited back with {count} credit notes:',
  },
  'credit.regel': {
    nl: '{nummer} · {datum} — {bedrag}',
    ar: '{nummer} · {datum} — {bedrag}',
    en: '{nummer} · {datum} — {bedrag}',
  },
  'credit.regel.zonderDatum': { nl: '{nummer} — {bedrag}', ar: '{nummer} — {bedrag}', en: '{nummer} — {bedrag}' },
  // A creditnota still in concept has no number yet, and that is the truth rather than a gap:
  // the number falls when it is sent (Art. 35).
  'credit.regel.zonderNummer': {
    nl: 'Concept — nog geen nummer · {bedrag}',
    ar: 'مسودة — بلا رقم بعد · {bedrag}',
    en: 'Draft — no number yet · {bedrag}',
  },

  // [NO-SILENT-EMPTY] The credit read did not answer. Every amount on the list may then be too
  // high, and the withdrawn-invoice chips are missing — so the screen says so rather than letting
  // an invoice the owner formally withdrew look completely chaseable.
  'credit.leesFout': {
    nl: 'We konden niet nakijken welke facturen je hebt gecrediteerd. De bedragen hieronder kunnen te hoog staan.',
    ar: 'تعذّر التحقق من الفواتير التي أصدرت لها إشعارات دائنة. قد تكون المبالغ أدناه أعلى من الواقع.',
    en: 'We could not check which invoices you have credited. The amounts below may be too high.',
  },

  // ─── [DEELBETALING-BEWIJS] The arithmetic behind "nog € X open", written out ─────────────────
  //
  // A partly settled invoice is where a conclusion is hardest to check by hand: the row says
  // "Deels betaald · nog € 460", and the owner has no way to see WHICH instalments produced that
  // without opening their bank and adding up. So the instalments are named, each with its own
  // evidence, and the sum is stated beside the invoice total.

  'deel.samen.meer': {
    nl: '{betaald} van {totaal} voldaan, in {count} betalingen:',
    ar: 'سُدِّد {betaald} من {totaal}، على {count} دفعات:',
    en: '{betaald} of {totaal} settled, in {count} payments:',
  },
  // No key for "one instalment": every payment sentence now carries its own amount, bank and hand
  // alike. A wrapper that prefixed the figure produced it twice on a bank line ("€ 500,00 —
  // € 500,00 bijgeschreven…") and read as two dashes on a hand-recorded one.

  // [NO-SILENT-EMPTY] invoices.amount_paid is a CACHED SUM of the very rows listed above. When the
  // two disagree the screen is showing a remainder no instalment supports, and it may not quietly
  // believe one side: it says both figures and leaves the judgement where it belongs.
  'deel.verschil': {
    nl: 'Let op: de app rekent met {geboekt} betaald, maar de vastgelegde betalingen tellen op tot {geteld}. Laat dit nakijken voordat je hierop afgaat.',
    ar: 'تنبيه: التطبيق يحسب {geboekt} مدفوعًا، بينما مجموع الدفعات المسجَّلة {geteld}. راجع هذا قبل الاعتماد عليه.',
    en: 'Note: the app is working with {geboekt} paid, but the recorded payments add up to {geteld}. Have this checked before relying on it.',
  },
  // The sum could not be checked at all — a legacy link with no amount anywhere. Never silence:
  // an unverifiable total that reads like a verified one is the whole failure mode here.
  'deel.verschil.onmeetbaar': {
    nl: 'Eén van deze betalingen heeft geen vastgelegd bedrag, dus het openstaande saldo is hier niet na te rekenen.',
    ar: 'إحدى هذه الدفعات بلا مبلغ مسجَّل، لذا لا يمكن التحقق من الرصيد المتبقي هنا.',
    en: 'One of these payments has no recorded amount, so the outstanding balance cannot be verified here.',
  },

  // The one case where no figure may be printed: a legacy link with no amount of its own AND no
  // bank row to read one from. "€ 0,00 afgeschreven" would be a number nobody wrote down.
  'betaal.bank.bedragOnbekend': {
    nl: 'Er is een bankbetaling aan deze factuur gekoppeld; het bedrag is hier niet vastgelegd.',
    ar: 'هناك دفعة بنكية مرتبطة بهذه الفاتورة؛ المبلغ غير مسجَّل هنا.',
    en: 'A bank payment is linked to this invoice; the amount is not recorded here.',
  },
  'betaal.bank.omschrijving': { nl: '{regel} — “{tekst}”', ar: '{regel} — «{tekst}»', en: '{regel} — “{tekst}”' },
  'betaal.bank.meer.een': {
    nl: '{regel} (+ 1 andere betaling)',
    ar: '{regel} (+ دفعة أخرى)',
    en: '{regel} (+ 1 other payment)',
  },
  'betaal.bank.meer.meer': {
    nl: '{regel} (+ {count} andere betalingen)',
    ar: '{regel} (+ {count} دفعات أخرى)',
    en: '{regel} (+ {count} other payments)',
  },
  'betaal.bank.deelsHand': {
    nl: '{regel} Een deel is door jou zelf afgevinkt.',
    ar: '{regel} جزء منها علّمته أنت بنفسك.',
    en: '{regel} Part of it was ticked off by you.',
  },

  // ─── [OPENSTAAND-BEWIJS] The panel that states the SEARCH, not the conclusion ───────────────
  //
  // Rule 1 of this file, applied literally: the noun is never a parameter. "inkoopfactuur" and
  // "verkoopfactuur" get their own keys per sentence, because Arabic agreement and Turkish suffix
  // harmony both hang off the noun — and because the two panels are read by the same person in the
  // same session, so they may never collapse into one sentence about two different piles of money.
  //
  // The counted phrases ARE parameters, and that is the exception the rule allows: each is a
  // complete noun phrase built from its own key, carrying its own number and its own agreement, so
  // the frame around it never has to inflect.

  'bewijs.geenOpen.inkoop': {
    nl: 'Er staan geen inkoopfacturen open om na te kijken.',
    ar: 'لا توجد فواتير شراء مفتوحة للمراجعة.',
    en: 'There are no open purchase invoices to check.',
  },
  'bewijs.geenOpen.verkoop': {
    nl: 'Er staan geen verkoopfacturen open om na te kijken.',
    ar: 'لا توجد فواتير مبيعات مفتوحة للمراجعة.',
    en: 'There are no open sales invoices to check.',
  },

  'bewijs.aantal.inkoop.een': {
    nl: '1 openstaande inkoopfactuur',
    ar: 'فاتورة شراء مفتوحة واحدة',
    en: '1 open purchase invoice',
  },
  'bewijs.aantal.inkoop.meer': {
    nl: '{count} openstaande inkoopfacturen',
    ar: '{count} فاتورة شراء مفتوحة',
    en: '{count} open purchase invoices',
  },
  'bewijs.aantal.verkoop.een': {
    nl: '1 openstaande verkoopfactuur',
    ar: 'فاتورة مبيعات مفتوحة واحدة',
    en: '1 open sales invoice',
  },
  'bewijs.aantal.verkoop.meer': {
    nl: '{count} openstaande verkoopfacturen',
    ar: '{count} فاتورة مبيعات مفتوحة',
    en: '{count} open sales invoices',
  },

  // No bank data is NOT a clean bill of health, and this sentence may never be shortened into one.
  'bewijs.geenBank': {
    nl: '{facturen} — nog niet vergeleken met je bank. Er staan geen banktransacties klaar om tegen te houden; importeer je bankafschrift.',
    ar: '{facturen} — لم تُقارَن بعد بحسابك البنكي. لا توجد حركات بنكية جاهزة للمقارنة؛ استورد كشف حسابك.',
    en: '{facturen} — not yet compared with your bank. There are no bank transactions to hold them against; import your bank statement.',
  },

  'bewijs.scope.een': {
    nl: '{facturen} vergeleken met 1 banktransactie{tot}.',
    ar: '{facturen} قُورنت بحركة بنكية واحدة{tot}.',
    en: '{facturen} compared with 1 bank transaction{tot}.',
  },
  'bewijs.scope.meer': {
    nl: '{facturen} vergeleken met {tx} banktransacties{tot}.',
    ar: '{facturen} قُورنت بـ{tx} حركة بنكية{tot}.',
    en: '{facturen} compared with {tx} bank transactions{tot}.',
  },
  // The horizon — where the app stops knowing. The single most trust-building clause on the panel
  // and the cheapest, so it is its own key and never silently dropped by a translation.
  'bewijs.scope.tot': { nl: ' t/m {datum}', ar: ' حتى {datum}', en: ' through {datum}' },

  'bewijs.niets': {
    nl: '{scope} Geen betaling gevonden die bij een van deze facturen past.',
    ar: '{scope} لم نجد أي دفعة تطابق واحدة من هذه الفواتير.',
    en: '{scope} No payment found that matches any of these invoices.',
  },
  'bewijs.raak.een': {
    nl: '{scope} Bij 1 factuur vonden we tóch een betaling die erbij lijkt te passen.',
    ar: '{scope} ومع ذلك وجدنا لدى فاتورة واحدة دفعة يبدو أنها تخصّها.',
    en: '{scope} For 1 invoice we did find a payment that appears to match it.',
  },
  'bewijs.raak.meer': {
    nl: '{scope} Bij {count} facturen vonden we tóch een betaling die erbij lijkt te passen.',
    ar: '{scope} ومع ذلك وجدنا لدى {count} فواتير دفعات يبدو أنها تخصّها.',
    en: '{scope} For {count} invoices we did find a payment that appears to match them.',
  },

  // On a purchase invoice the owner looks for money that LEFT; on a sales invoice for money that
  // ARRIVED. One wrong preposition here is a sentence read twice and believed half.
  'bewijs.hit.inkoop': {
    nl: '{bedrag} op {datum} aan {naam}',
    ar: '{bedrag} في {datum} إلى {naam}',
    en: '{bedrag} on {datum} to {naam}',
  },
  'bewijs.hit.verkoop': {
    nl: '{bedrag} op {datum} van {naam}',
    ar: '{bedrag} في {datum} من {naam}',
    en: '{bedrag} on {datum} from {naam}',
  },
  'bewijs.hit.zonderNaam': { nl: '{bedrag} op {datum}', ar: '{bedrag} في {datum}', en: '{bedrag} on {datum}' },
  // The bank's own text, quoted verbatim: it is the string the owner recognises, and a tidied
  // version of it is a string they have never seen.
  'bewijs.hit.omschrijving': { nl: '{regel} — “{tekst}”', ar: '{regel} — «{tekst}»', en: '{regel} — “{tekst}”' },

  'bewijs.regel.open': { nl: '{bedrag} open', ar: '{bedrag} مستحق', en: '{bedrag} outstanding' },
  'bewijs.regel.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  // A question, never a verdict: both numbers come from a reading, and picking a winner is the
  // overconfidence that produces the wrong number in the first place.
  'bewijs.vraag.inkoop': {
    nl: 'In je bank staat {bewijs}. Klopt het dat deze factuur nog openstaat?',
    ar: 'في حسابك البنكي: {bewijs}. هل صحيح أن هذه الفاتورة ما زالت غير مدفوعة؟',
    en: 'Your bank shows {bewijs}. Is it correct that this invoice is still outstanding?',
  },
  'bewijs.vraag.verkoop': {
    nl: 'In je bank staat {bewijs}. Klopt het dat deze klant nog niet betaald heeft?',
    ar: 'في حسابك البنكي: {bewijs}. هل صحيح أن هذا العميل لم يدفع بعد؟',
    en: 'Your bank shows {bewijs}. Is it correct that this customer has not paid yet?',
  },

  // [NO-SILENT-EMPTY] A proof that could not run may never read as one that found nothing.
  'bewijs.leesFout': {
    nl: 'We konden je openstaande facturen nu niet met je bank vergelijken. Deze lijst klopt met wat er in de app staat, maar is niet tegen je bankafschriften gehouden.',
    ar: 'تعذّرت مقارنة فواتيرك المفتوحة بحسابك البنكي الآن. هذه القائمة مطابقة لما في التطبيق، لكنها لم تُقارَن بكشوف حسابك.',
    en: 'We could not compare your open invoices with your bank just now. This list matches what is in the app, but has not been held against your bank statements.',
  },

  // A bounded check presented as a complete one is exactly the false reassurance this panel
  // exists to remove. Three whole sentences, never a fragment glued to a conjunction.
  'bewijs.beperkt.facturen': {
    nl: 'Niet alles is meegenomen: {count} facturen vielen buiten deze controle.',
    ar: 'لم يُشمل كل شيء: {count} فاتورة خارج نطاق هذا الفحص.',
    en: 'Not everything was included: {count} invoices fell outside this check.',
  },
  'bewijs.beperkt.transacties': {
    nl: 'Niet alles is meegenomen: {count} banktransacties vielen buiten deze controle.',
    ar: 'لم يُشمل كل شيء: {count} حركة بنكية خارج نطاق هذا الفحص.',
    en: 'Not everything was included: {count} bank transactions fell outside this check.',
  },
  // [HERINNER-BEWIJS] The most expensive mistake this product can make, stated to the owner
  // before it is made. A reminder — and on the last tier a statutory aanmaning naming
  // incassokosten — sent to a customer who already paid is not a wrong number on a screen; it is
  // the owner's relationship with the person who pays them. Never a verdict: the app says what it
  // saw and leaves the decision where it belongs.
  // The way past the block. Named as the action it is, not as a dismissal — the owner is not
  // waving a warning away, they are telling the app something it could not know.
  'vk.herinnerToch': { nl: 'Toch herinneren', ar: 'أرسل التذكير على أي حال', en: 'Remind anyway' },
  'bewijs.herinner.geblokkeerd': {
    nl: 'Nog niet verstuurd: in je bank staat {bewijs}. Koppel die betaling bij Bank, of verstuur de herinnering toch als het om iets anders gaat.',
    ar: 'لم تُرسل بعد: في حسابك البنكي {bewijs}. اربط هذه الدفعة في صفحة البنك، أو أرسل التذكير على أي حال إن كانت تخصّ شيئًا آخر.',
    en: 'Not sent yet: your bank shows {bewijs}. Link that payment under Bank, or send the reminder anyway if it is about something else.',
  },
  // [NO-SILENT-EMPTY] The check itself did not run. The reminder still goes out — the owner
  // pressed the button and the app has no ground to refuse — but it may not pretend it looked.
  'bewijs.herinner.nietGecontroleerd': {
    nl: 'Verstuurd. We konden deze factuur niet met je bank vergelijken, dus is niet gecontroleerd of er al betaald is.',
    ar: 'أُرسل. تعذّرت مقارنة هذه الفاتورة بحسابك البنكي، لذلك لم يُتحقق مما إذا كانت مدفوعة.',
    en: 'Sent. We could not compare this invoice with your bank, so whether it was already paid has not been checked.',
  },

  'bewijs.beperkt.beide': {
    nl: 'Niet alles is meegenomen: {facturen} facturen en {transacties} banktransacties vielen buiten deze controle.',
    ar: 'لم يُشمل كل شيء: {facturen} فاتورة و{transacties} حركة بنكية خارج نطاق هذا الفحص.',
    en: 'Not everything was included: {facturen} invoices and {transacties} bank transactions fell outside this check.',
  },

  // ─── [BTW-RESERVERING] The money in the account that is already the tax office's ────────────
  //
  // Every sentence here is about money the owner believes they have. They are deliberately short
  // and without an exclamation mark: the figures do the work, and an alarmed tone on a screen you
  // open every morning is one you learn to ignore inside a week.
  //
  // [TAAL] Where a sentence points at a screen or a button, it names the Dutch word that is
  // actually there — otherwise the reader goes looking for something that is nowhere in the app.

  'btwres.heading': { nl: 'Voor de Belastingdienst', ar: 'لمصلحة الضرائب', en: 'For the tax office' },
  'btwres.reserved': { nl: 'Al van de Belastingdienst', ar: 'مستحق لمصلحة الضرائب', en: 'Already the tax office’s' },
  'btwres.free': { nl: 'Blijft voor jou over', ar: 'يبقى لك', en: 'Left for you' },
  'btwres.short': { nl: 'Je komt tekort', ar: 'لديك عجز', en: 'You are short' },
  'btwres.refundExpected': {
    nl: 'Daarnaast verwacht je € {amount} terug. Dat staat er nog niet op.',
    ar: 'كما تتوقع استرداد € {amount}. لم يصل بعد.',
    en: 'You also expect € {amount} back. It is not in your account yet.',
  },
  'btwres.deadline': {
    nl: '{quarter} moet binnen zijn op {date}',
    ar: '{quarter} يجب تقديمه قبل {date}',
    en: '{quarter} is due on {date}',
  },
  'btwres.deadlineDays': {
    nl: '{quarter} — nog {days} dagen',
    ar: '{quarter} — بقي {days} يوماً',
    en: '{quarter} — {days} days left',
  },
  'btwres.deadlineToday': {
    nl: '{quarter} moet vandaag binnen zijn',
    ar: '{quarter} يجب تقديمه اليوم',
    en: '{quarter} is due today',
  },
  'btwres.deadlinePassed': {
    nl: '{quarter} — de datum is voorbij',
    ar: '{quarter} — انقضى الموعد',
    en: '{quarter} — the date has passed',
  },
  'btwres.toReturn': { nl: 'Naar de aangifte', ar: 'إلى الإقرار', en: 'Go to the VAT return' },

  // The caveats. One per note code in btw-reservation.ts — the Record type makes a missing one a
  // build error, and the gate catches a code quietly dropped while its sentence stays behind.
  'btwres.note.balanceUnknown': {
    nl: 'We kennen je banksaldo niet, dus we kunnen niet zeggen wat er overblijft. Wat je moet betalen weten we wel.',
    ar: 'لا نعرف رصيد حسابك، لذلك لا يمكننا قول ما سيتبقى. أما ما عليك دفعه فنعرفه.',
    en: 'We do not know your bank balance, so we cannot say what is left. What you owe, we do know.',
  },
  'btwres.note.balanceIncomplete': {
    nl: 'Van minstens één rekening kennen we het saldo niet, dus het bedrag hierboven is aan de lage kant.',
    ar: 'لا نعرف رصيد حساب واحد على الأقل، لذا فالمبلغ أعلاه أقل من الحقيقي.',
    en: 'We do not know the balance of at least one account, so the figure above is on the low side.',
  },
  'btwres.note.balanceStale': {
    nl: 'Je saldo komt van je laatste afschrift ({date}) — niet van vandaag.',
    ar: 'رصيدك مأخوذ من آخر كشف حساب ({date}) — وليس من اليوم.',
    en: 'Your balance comes from your latest statement ({date}), not from today.',
  },
  'btwres.note.quarterRunning': {
    nl: 'Dit kwartaal loopt nog. Het bedrag verandert met elke factuur die je stuurt of ontvangt.',
    ar: 'هذا الربع ما زال جارياً. يتغيّر المبلغ مع كل فاتورة ترسلها أو تستلمها.',
    en: 'This quarter is still running. The amount changes with every invoice you send or receive.',
  },
  'btwres.note.purchasesUnverified': {
    nl: 'Er staan nog inkoopfacturen in de wachtrij. Hun btw is nog niet afgetrokken, dus we houden te veel apart.',
    ar: 'ما زالت هناك فواتير شراء في قائمة الانتظار. لم تُخصم ضريبتها بعد، لذا نحجز أكثر من اللازم.',
    en: 'Purchase invoices are still in the queue. Their VAT is not deducted yet, so we set aside too much.',
  },
  'btwres.note.refundSeparate': {
    nl: 'Een teruggaaf tellen we niet mee als geld dat je kunt uitgeven — die is nog niet gestort.',
    ar: 'لا نحتسب الاسترداد كمال يمكنك إنفاقه — فهو لم يُحوَّل بعد.',
    en: 'We do not count a refund as money you can spend — it has not been paid out yet.',
  },
  'btwres.note.returnOverdue': {
    nl: 'Van een kwartaal is de datum voorbij zonder aangifte. Dat bedrag staat dus zeker nog open.',
    ar: 'انقضى موعد أحد الأرباع دون تقديم إقرار. لذا فذلك المبلغ ما زال مستحقًا بالتأكيد.',
    en: 'One quarter’s date has passed without a return. That amount is certainly still outstanding.',
  },
  'btwres.note.uncomputed': {
    nl: 'Van {quarters} konden we het bedrag niet uitrekenen. Dat zit dus niet in het totaal.',
    ar: 'لم نتمكّن من حساب مبلغ {quarters}. لذا فهو غير مدرج في المجموع.',
    en: 'We could not calculate the amount for {quarters}. It is not in the total.',
  },
  'btwres.period': {
    nl: 'Gerekend vanaf {quarter}.',
    ar: 'محسوب اعتبارًا من {quarter}.',
    en: 'Counted from {quarter}.',
  },

  // ─── [VOORUIT] How much money there will be in 7 and in 30 days ────────────────────────────
  // The forecast engine (cashflow-forecast.ts) returns note CODES; cashflow-forecast-copy.ts
  // gives each one a sentence here. The two counted notes carry a singular and a plural.
  'vooruit.titel': { nl: 'Vooruitkijken', ar: 'نظرة إلى الأمام', en: 'Looking ahead' },
  'vooruit.dagen': { nl: '{days} dagen', ar: '{days} يومًا', en: '{days} days' },
  'vooruit.nu': { nl: 'Nu (bank + kas)', ar: 'الآن (البنك + الصندوق)', en: 'Now (bank + drawer)' },
  'vooruit.op': { nl: 'Op {date}', ar: 'في {date}', en: 'On {date}' },
  'vooruit.tekortOp': { nl: 'Tekort op {date}', ar: 'عجز في {date}', en: 'Short on {date}' },
  'vooruit.uit': { nl: 'Te betalen ({count})', ar: 'مستحق الدفع ({count})', en: 'To pay ({count})' },
  'vooruit.uitIncasso': {
    nl: 'Waarvan € {amount} via incasso.',
    ar: 'منها € {amount} بالخصم المباشر.',
    en: 'Of which € {amount} by direct debit.',
  },
  'vooruit.inFacturen': { nl: 'Verwacht van klanten ({count})', ar: 'متوقع من العملاء ({count})', en: 'Expected from customers ({count})' },
  'vooruit.inKassa': { nl: 'Verwachte kassa-omzet', ar: 'إيرادات الصندوق المتوقعة', en: 'Expected till takings' },
  'vooruit.laagste': {
    nl: 'Laagste stand: € {amount} op {date}.',
    ar: 'أدنى رصيد: € {amount} في {date}.',
    en: 'Lowest point: € {amount} on {date}.',
  },
  'vooruit.laagsteTekort': {
    nl: 'Op {date} kom je € {amount} tekort.',
    ar: 'في {date} ينقصك € {amount}.',
    en: 'On {date} you are € {amount} short.',
  },
  'vooruit.naarBetalen': { nl: 'Naar te betalen', ar: 'إلى المستحقات', en: 'Go to payments' },
  'vooruit.note.bankOnbekend': {
    nl: 'We kennen je banksaldo niet. Alleen de bewegingen staan hier.',
    ar: 'لا نعرف رصيد حسابك. تظهر هنا الحركات فقط.',
    en: 'We do not know your bank balance. Only the movements are shown.',
  },
  'vooruit.note.bankDeels': {
    nl: 'Van minstens één rekening kennen we het saldo niet.',
    ar: 'لا نعرف رصيد حساب واحد على الأقل.',
    en: 'We do not know the balance of at least one account.',
  },
  'vooruit.note.bankOud': {
    nl: 'Saldo van je afschrift van {date}, plus de bankregels sindsdien.',
    ar: 'الرصيد من كشف حسابك بتاريخ {date}، مع الحركات البنكية منذ ذلك الحين.',
    en: 'Balance from your statement of {date}, plus the bank lines since.',
  },
  'vooruit.note.bankRekeningen': {
    nl: '{count} rekeningen: bankregels tussen de afschriften tellen niet mee.',
    ar: '{count} حسابات: حركات البنك بين الكشوف غير محسوبة.',
    en: '{count} accounts: bank lines between the statements are not counted.',
  },
  'vooruit.note.kasOnbekend': { nl: 'De kas telt niet mee.', ar: 'إيراد الصندوق غير محتسب.', en: 'The cash drawer is not counted.' },
  'vooruit.note.zonderDatum': {
    nl: '{count} inkoopfacturen zonder vervaldatum (€ {amount}) tellen niet mee.',
    ar: '{count} فواتير شراء بلا تاريخ استحقاق (€ {amount}) غير محسوبة.',
    en: '{count} purchase invoices without a due date (€ {amount}) are not counted.',
  },
  'vooruit.note.zonderDatumEen': {
    nl: 'Eén inkoopfactuur zonder vervaldatum (€ {amount}) telt niet mee.',
    ar: 'فاتورة شراء واحدة بلا تاريخ استحقاق (€ {amount}) غير محسوبة.',
    en: 'One purchase invoice without a due date (€ {amount}) is not counted.',
  },
  'vooruit.note.teLaat': {
    nl: '{count} facturen zijn al over tijd (€ {amount}). Dat geld telt niet mee.',
    ar: '{count} فواتير تجاوزت موعدها (€ {amount}). هذا المال غير محسوب.',
    en: '{count} invoices are already overdue (€ {amount}). That money is not counted.',
  },
  'vooruit.note.teLaatEen': {
    nl: 'Eén factuur is al over tijd (€ {amount}). Dat geld telt niet mee.',
    ar: 'فاتورة واحدة تجاوزت موعدها (€ {amount}). هذا المال غير محسوب.',
    en: 'One invoice is already overdue (€ {amount}). That money is not counted.',
  },
  'vooruit.note.klantZonderDatum': {
    nl: '{count} verkoopfacturen zonder datum (€ {amount}) tellen niet mee.',
    ar: '{count} فواتير بيع بلا تاريخ (€ {amount}) غير محسوبة.',
    en: '{count} sales invoices without a date (€ {amount}) are not counted.',
  },
  'vooruit.note.klantZonderDatumEen': {
    nl: 'Eén verkoopfactuur zonder datum (€ {amount}) telt niet mee.',
    ar: 'فاتورة بيع واحدة بلا تاريخ (€ {amount}) غير محسوبة.',
    en: 'One sales invoice without a date (€ {amount}) is not counted.',
  },
  'vooruit.note.kassaOnbekend': {
    nl: 'Geen kassa-omzet geboekt, dus geen verwachte omzet.',
    ar: 'لا إيرادات كاشير مسجّلة، فلا إيرادات متوقعة.',
    en: 'No till takings booked, so no expected takings.',
  },
  'vooruit.note.kassaDun': {
    nl: 'De kassa-omzet rust op maar {days} geboekte dagen.',
    ar: 'إيرادات الكاشير تستند إلى {days} أيام مسجّلة فقط.',
    en: 'The till takings rest on only {days} booked days.',
  },

  // ─── [LOGBOEK] What happened in this administration, in words ───────────────────────────────
  //
  // 89 kinds of event were already being recorded — from 60 files, into audit_logs — and a
  // migration was written so the owner may read the ones about their OWN books even when their
  // bookkeeper performed them. Nothing ever rendered a single line of it.
  //
  // These sentences are what turns a row into something a person can check. Short, because a
  // logboek is scanned and not read; second person where the owner acted, neutral where the app
  // or someone else did. An action with no sentence here fails the [LOGBOEK] gate rather than
  // reaching the screen as 'invoice.status_changed'.
  'log.invoice.created': { nl: 'Factuur aangemaakt', en: 'Invoice created', ar: 'أُنشئت فاتورة' },
  'log.invoice.updated': { nl: 'Factuur gewijzigd', en: 'Invoice changed', ar: 'عُدّلت فاتورة' },
  // [VOORSTEL] The accountant's correction proposal and the client's answer.
  'log.invoice.ledger_account_set': { nl: 'Grootboekrekening gekozen', en: 'Ledger account chosen', ar: 'اختير حساب دفتر الأستاذ' },
  'log.wachtkoppeling.created': { nl: 'Betaling vastgelegd, wacht op de bankregel', en: 'Payment recorded, waiting for the bank line', ar: 'سُجّلت الدفعة، بانتظار سطر البنك' },
  'log.wachtkoppeling.linked': { nl: 'Wachtende betaling gekoppeld aan de bankregel', en: 'Waiting payment linked to the bank line', ar: 'رُبطت الدفعة المنتظِرة بسطر البنك' },
  'log.wachtkoppeling.withdrawn': { nl: 'Wachtende betaling ingetrokken', en: 'Waiting payment withdrawn', ar: 'سُحبت الدفعة المنتظِرة' },
  'log.invoice.correction_proposed': { nl: 'Correctie voorgesteld aan de klant', en: 'Correction proposed to the client', ar: 'اقتُرح تصحيح للعميل' },
  'log.invoice.correction_accepted': { nl: 'Correctievoorstel van de boekhouder overgenomen', en: 'Accountant’s correction proposal accepted', ar: 'قُبل اقتراح تصحيح المحاسب' },
  'log.invoice.correction_declined': { nl: 'Correctievoorstel van de boekhouder afgewezen', en: 'Accountant’s correction proposal declined', ar: 'رُفض اقتراح تصحيح المحاسب' },
  'log.invoice.deleted': { nl: 'Factuur verwijderd', en: 'Invoice deleted', ar: 'حُذفت فاتورة' },
  'log.invoice.duplicated': { nl: 'Factuur gedupliceerd', en: 'Invoice duplicated', ar: 'نُسخت فاتورة' },
  'log.invoice.corrected': { nl: 'Verstuurde factuur gecorrigeerd — de klant kreeg het nieuwe document', en: 'Sent invoice corrected — the customer received the new document', ar: 'صُحّحت فاتورة مُرسَلة — واستلم العميل المستند الجديد' },
  'log.invoice.dedup_override': { nl: 'Toch toegevoegd, ondanks een mogelijke dubbele', en: 'Added anyway, despite a possible duplicate', ar: 'أُضيفت رغم احتمال التكرار' },
  'log.invoice.status_changed': { nl: 'Status van een factuur gewijzigd', en: 'Invoice status changed', ar: 'تغيّرت حالة فاتورة' },
  'log.offerte.sent': { nl: 'Offerte naar de klant gemaild', en: 'Quote e-mailed to the customer', ar: 'أُرسل عرض سعر إلى العميل' },
  'log.offerte.answered': { nl: 'De klant heeft op je offerte geantwoord', en: 'The customer answered your quote', ar: 'ردّ العميل على عرض السعر' },
  'log.invoice.auto_verified': { nl: 'Inkoopfactuur automatisch bevestigd', en: 'Purchase invoice confirmed automatically', ar: 'تأكّدت فاتورة شراء تلقائيًا' },
  'log.invoice.auto_paid': { nl: 'Kassabon automatisch afgeboekt — de bon vermeldde de betaalwijze', en: 'Receipt settled automatically — the paper stated the payment method', ar: 'سُوّي إيصال تلقائيًا — الورقة ذكرت طريقة الدفع' },
  'log.invoice.reread_from_document': { nl: 'Bestand opnieuw gelezen', en: 'File read again', ar: 'أُعيدت قراءة ملف' },
  'log.invoice.reimported': { nl: 'Factuur opnieuw ingelezen', en: 'Invoice re-imported', ar: 'أُعيد استيراد فاتورة' },
  // [SPLIT-ALSNOG] Bewust een andere zin dan 'opnieuw ingelezen': hier is GEEN bedrag veranderd.
  // Een logboekregel die de twee op één zin laat uitkomen laat een eigenaar denken dat zijn
  // factuur is herschreven terwijl er alleen een controle alsnog kon lopen.
  'log.invoice.btw_rows_read': { nl: 'Btw-specificatie nagelezen (bedragen ongewijzigd)', en: 'Btw specification read again (amounts unchanged)', ar: 'أُعيدت قراءة تفصيل الضريبة (المبالغ دون تغيير)' },
  'log.bank.auto_confirmed': { nl: 'Bankregel automatisch aan een factuur gekoppeld', en: 'Bank line matched to an invoice automatically', ar: 'رُبط سطر بنكي بفاتورة تلقائيًا' },
  'log.bank.auto_confirmed_batch': { nl: 'Eén bankbetaling automatisch over meerdere facturen verdeeld', en: 'One bank payment split across several invoices automatically', ar: 'وُزّعت دفعة بنكية على عدة فواتير تلقائياً' },
  'log.bank.attachment_added': { nl: 'Bestand bij een bankregel gevoegd', en: 'File attached to a bank line', ar: 'أُرفق ملف بسطر بنكي' },
  'log.bank.attachment_removed': { nl: 'Bestand bij een bankregel verwijderd', en: 'File removed from a bank line', ar: 'أُزيل ملف من سطر بنكي' },
  'log.bank.line_deleted': { nl: 'Bankregel verwijderd', en: 'Bank line deleted', ar: 'حُذف سطر بنكي' },
  'log.bank.storno_applied': { nl: 'Teruggeboekte incasso verwerkt: factuur weer open, beide regels apart gezet', en: 'Reversed direct debit processed: invoice reopened, both lines set aside', ar: 'عولج خصم مباشر مرتجع: أُعيد فتح الفاتورة ووُضع السطران جانبًا' },
  'log.bank.confirmed_batch': { nl: 'Eén bankbetaling over meerdere facturen verdeeld', en: 'One bank payment split across several invoices', ar: 'وُزّعت دفعة بنكية على عدة فواتير' },
  'log.bank.confirmed': { nl: 'Bankregel aan een factuur gekoppeld', en: 'Bank line matched to an invoice', ar: 'رُبط سطر بنكي بفاتورة' },
  'log.bank.partial_payment': { nl: 'Deelbetaling geboekt', en: 'Partial payment booked', ar: 'قُيّدت دفعة جزئية' },
  'log.bank.payment_allocated': { nl: 'Eén betaling zelf over facturen verdeeld', en: 'One payment allocated across invoices by hand', ar: 'وُزّعت دفعة يدوياً على فواتير' },
  'log.bank.overpayment_residue': { nl: 'Er is meer betaald dan er openstond — het overschot is niet geboekt', en: 'More was paid than was owed — the excess was not booked', ar: 'دُفع أكثر من المستحق — ولم يُقيَّد الفائض' },
  'log.invoice.partial_payment': { nl: 'Deelbetaling met de hand geboekt', en: 'Partial payment recorded by hand', ar: 'قُيّدت دفعة جزئية يدويًا' },
  'log.bank.unlinked': { nl: 'Koppeling tussen bank en factuur ongedaan gemaakt', en: 'Bank-to-invoice match undone', ar: 'أُلغي الربط بين البنك والفاتورة' },
  'log.bank.match_checked': { nl: 'Automatische koppeling nagekeken en akkoord bevonden', en: 'Automatic match reviewed and accepted', ar: 'رُوجعت المطابقة التلقائية وقُبلت' },
  'log.invoice.document_attached': { nl: 'Origineel document aan een factuur gehangen', en: 'Original document attached to an invoice', ar: 'أُرفق مستند أصلي بفاتورة' },
  'log.invoice.document_replaced': { nl: 'Document van een factuur vervangen door een beter exemplaar (het oude blijft bewaard)', en: 'An invoice document was replaced by a better copy (the old one is kept)', ar: 'استُبدل مستند فاتورة بنسخة أفضل (تُحفظ القديمة)' },
  'log.accountant.invoice_question': { nl: 'Je boekhouder heeft een vraag gesteld over een factuur', en: 'Your bookkeeper asked a question about an invoice', ar: 'طرح محاسبك سؤالًا عن فاتورة' },
  'log.bank.ignored': { nl: 'Bankregel opzijgezet', en: 'Bank line set aside', ar: 'نُحّي سطر بنكي جانبًا' },
  'log.bank.restored': { nl: 'Bankregel teruggehaald', en: 'Bank line taken back', ar: 'أُعيد سطر بنكي' },
  'log.bank.rematch_restored': { nl: 'Opnieuw proberen heeft opzijgezette bankregels teruggehaald', en: 'A re-match pass took set-aside bank lines back', ar: 'أعادت محاولة المطابقة سطوراً بنكية منحّاة' },
  'log.bank.overapplied': { nl: 'Er is meer aan deze bankregel gekoppeld dan hij groot is', en: 'More was matched to this bank line than it holds', ar: 'رُبط بهذا السطر البنكي أكثر من قيمته' },
  // [BANK-OVERAPPLIED-LOUD] De controle hierboven is de enige waarborg tegen een race die de
  // boekingsroute niet kan sluiten. Draaide ze niet, dan is dat een feit over deze transactie —
  // zonder deze regel betekende 'geen alarm' zowel 'het klopt' als 'we hebben niet gekeken'.
  'log.bank.overapplied_check_failed': { nl: 'De controle op dubbel geboekte bedragen kon bij deze bankregel niet worden uitgevoerd', en: 'The over-application check could not be run on this bank line', ar: 'تعذّر إجراء فحص تكرار المبالغ على هذا السطر البنكي' },
  'log.creditnota.created': { nl: 'Creditnota aangemaakt', en: 'Credit note created', ar: 'أُنشئ إشعار دائن' },
  'log.invoice.archived': { nl: 'Factuur uit de boeken gehaald (bewaard, terug te halen)', en: 'Invoice removed from the books (kept, reversible)', ar: 'أُخرجت فاتورة من الدفاتر (محفوظة وقابلة للإرجاع)' },
  'log.invoice.restored': { nl: 'Factuur teruggezet in de boeken', en: 'Invoice put back in the books', ar: 'أُعيدت فاتورة إلى الدفاتر' },
  'log.invoice.payment_moved': { nl: 'Betaling verplaatst naar een andere factuur', en: 'Payment moved to another invoice', ar: 'نُقلت دفعة إلى فاتورة أخرى' },
  'log.invoice.duplicate_dismissed': { nl: 'Dubbelmelding weggeklikt', en: 'Duplicate warning dismissed', ar: 'أُغلق تنبيه تكرار' },
  'log.invoice.multi_invoice_dismissed': { nl: 'Melding over meerdere facturen in één bestand weggeklikt', en: 'Multi-invoice warning dismissed', ar: 'أُغلق تنبيه تعدّد الفواتير في ملف' },
  'log.invoice.superseded': { nl: 'Factuur vervangen door een nieuwe', en: 'Invoice replaced by a new one', ar: 'استُبدلت فاتورة بأخرى' },
  'log.invoice.numbering_configured': { nl: 'Factuurnummering ingesteld', en: 'Invoice numbering configured', ar: 'ضُبط ترقيم الفواتير' },
  'log.invoice.numbering_change_blocked': { nl: 'Wijziging van de nummering geweigerd — de reeks moet doorlopen', en: 'Numbering change refused — the series must stay unbroken', ar: 'رُفض تغيير الترقيم — يجب أن تبقى السلسلة متصلة' },
  'log.invoice.arithmetic_blocked': { nl: 'Factuur geweigerd omdat de bedragen niet klopten', en: 'Invoice refused because the amounts did not add up', ar: 'رُفضت الفاتورة لأن المبالغ لم تتطابق' },
  'log.cash.entry_added': { nl: 'Kasregel toegevoegd', en: 'Cash entry added', ar: 'أُضيف قيد نقدي' },
  'log.cash.entry_removed': { nl: 'Kasregel verwijderd', en: 'Cash entry removed', ar: 'حُذف قيد نقدي' },
  'log.cash.opening_balance_set': { nl: 'Beginsaldo van de kas ingesteld', en: 'Cash opening balance set', ar: 'ضُبط الرصيد الافتتاحي للصندوق' },
  'log.turnover.auto_imported': { nl: 'Dagomzet ingelezen', en: 'Daily turnover imported', ar: 'استُورد إيراد يومي' },
  // [KASBOEK-LEZEN] "Gelezen", niet "ingelezen": er is niets geboekt, en het logboek mag dat niet
  // suggereren. Een regel die als import leest, wordt later gelezen als bewijs dat de bedragen in
  // de administratie staan — precies wat hier NIET is gebeurd.
  // [IB-JAAR] Het jaaroverzicht voor de inkomstenbelasting — schermchroom; de inhoudelijke
  // zinnen (uren, kanttekeningen, niet-bijgehouden) komen als data van de server, in het
  // Nederlands, zoals elke administratieve waarheid hier.
  'jaar.titel': { nl: 'Jaaroverzicht voor de IB-aangifte', en: 'Year overview for the income tax return', ar: 'ملخص السنة لإقرار ضريبة الدخل' },
  'jaar.intro': { nl: 'Je jaar, geordend zoals de aangifte inkomstenbelasting erom vraagt. Dit rekent geen belasting uit — het zet je cijfers klaar en zegt wat er nog mist.', en: 'Your year, arranged the way the income tax return asks for it. It computes no tax — it lays out your figures and says what is still missing.', ar: 'سنتك مرتبة كما يطلبها إقرار ضريبة الدخل. لا يحسب ضريبة — يجهّز أرقامك ويقول ما الناقص.' },
  // [OPDRACHTGEVER] Who this year's money came from. Facts, never a verdict — see the module.
  'dba.kop': { nl: 'Opdrachtgevers {jaar}', en: 'Clients {jaar}', ar: 'العملاء {jaar}' },
  'dba.samenvatting': { nl: '{n} opdrachtgevers · {bedrag} · grootste {grootste}%', en: '{n} clients · {bedrag} · largest {grootste}%', ar: '{n} عملاء · {bedrag} · الأكبر {grootste}%' },
  'dba.samenvattingEen': { nl: '1 opdrachtgever · {bedrag}', en: '1 client · {bedrag}', ar: 'عميل واحد · {bedrag}' },
  'dba.uren': { nl: '{uren} uur', en: '{uren} hours', ar: '{uren} ساعة' },
  'dba.geen': { nl: 'Nog geen facturen in dit jaar.', en: 'No invoices in this year yet.', ar: 'لا فواتير في هذه السنة بعد.' },
  'dba.leesfout': { nl: 'We konden je opdrachtgevers nu niet ophalen.', en: 'We could not fetch your clients right now.', ar: 'تعذّر جلب عملائك الآن.' },
  'gl.kop': { nl: 'Opnieuw bekijken', en: 'Worth a second look', ar: 'يستحقّ نظرة ثانية' },
  'gl.uitleg': { nl: 'Deze facturen zette je opzij toen we ze niet konden lezen. Inmiddels lezen we ze wel.', en: 'You set these aside when we could not read them. We can read them now.', ar: 'نحّيت هذه الفواتير حين عجزنا عن قراءتها. صرنا نقرأها الآن.' },
  'gl.samen': { nl: '{n} facturen · {bedrag}', en: '{n} invoices · {bedrag}', ar: '{n} فاتورة · {bedrag}' },
  'gl.samenEen': { nl: '1 factuur · {bedrag}', en: '1 invoice · {bedrag}', ar: 'فاتورة واحدة · {bedrag}' },
  'gl.leerBtw': { nl: 'we lezen nu de BTW-uitsplitsing per tarief', en: 'we now read the per-rate VAT breakdown', ar: 'صرنا نقرأ تفصيل الضريبة لكل تعرفة' },
  'gl.leerStatiegeld': { nl: 'we vinden nu het statiegeld terug', en: 'we now find the deposit line', ar: 'صرنا نجد سطر الوديعة' },
  'gl.terug': { nl: 'Terugzetten', en: 'Put back', ar: 'إرجاع' },
  'gl.terugFout': { nl: 'Terugzetten mislukt. Probeer het nog een keer.', en: 'Putting back failed. Please try again.', ar: 'فشلت الإعادة. حاول مرة أخرى.' },
  'gl.leesfout': { nl: 'We konden je genegeerde facturen nu niet nakijken.', en: 'We could not check your ignored invoices right now.', ar: 'تعذّر فحص فواتيرك المتجاهَلة الآن.' },
  'gl.daarna': { nl: 'Teruggezet — je vindt hem in de controlewachtrij, waar "Opnieuw inlezen" klaarstaat.', en: 'Put back — you will find it in the verification queue, where "Read again" is waiting.', ar: 'أُعيدت — تجدها في قائمة المراجعة، حيث «إعادة القراءة» جاهزة.' },
  'gb.kop': { nl: 'Grootboekrekening', en: 'Ledger account', ar: 'حساب دفتر الأستاذ' },
  'gb.groepEen': { nl: '1 factuur · {bedrag}', en: '1 invoice · {bedrag}', ar: 'فاتورة واحدة · {bedrag}' },
  'gb.groep': { nl: '{n} facturen · {bedrag}', en: '{n} invoices · {bedrag}', ar: '{n} فاتورة · {bedrag}' },
  'gb.klaar': { nl: 'Elke inkoopfactuur staat op een rekening.', en: 'Every purchase invoice is on an account.', ar: 'كل فاتورة شراء على حساب.' },
  'gb.open': { nl: '{n} facturen bij {lev} leveranciers wachten nog op een rekening.', en: '{n} invoices from {lev} suppliers are still waiting for an account.', ar: '{n} فاتورة من {lev} مورّدًا ما زالت تنتظر حسابًا.' },
  'gb.openEen': { nl: '1 factuur wacht nog op een rekening.', en: '1 invoice is still waiting for an account.', ar: 'فاتورة واحدة ما زالت تنتظر حسابًا.' },
  'gb.leesfout': { nl: 'We konden nu niet ophalen welke facturen nog een rekening nodig hebben.', en: 'We could not fetch which invoices still need an account.', ar: 'تعذّر جلب الفواتير التي ما زالت تحتاج حسابًا.' },
  'gb.opslaanFout': { nl: 'Opslaan mislukt. Probeer het nog een keer.', en: 'Saving failed. Please try again.', ar: 'فشل الحفظ. حاول مرة أخرى.' },
  'gb.waaromVaker': { nl: 'je zette deze leverancier hier al eerder op', en: 'you put this supplier here before', ar: 'سبق أن وضعت هذا المورّد هنا' },
  'gb.waaromWoord': { nl: 'op de factuur staat "{woord}"', en: '"{woord}" is on the invoice', ar: 'على الفاتورة «{woord}»' },
  'gb.waaromNiets': { nl: 'we weten het niet — kies zelf', en: 'we do not know — pick one yourself', ar: 'لا نعرف — اختر بنفسك' },
  'gb.meer': { nl: 'Toon meer', en: 'Show more', ar: 'إظهار المزيد' },
  'gb.uitleg': { nl: 'Waar een inkoopfactuur op boekt. Je boekhouder ziet dit terug in het auditfile.', en: 'Where a purchase invoice books. Your accountant sees this back in the auditfile.', ar: 'الحساب الذي تُقيَّد عليه فاتورة الشراء. يراه محاسبك في ملف التدقيق.' },
  'dba.sinds': { nl: 'sinds {jaar}', en: 'since {jaar}', ar: 'منذ {jaar}' },
  'dba.nieuw': { nl: 'nieuw dit jaar', en: 'new this year', ar: 'جديد هذه السنة' },
  'dba.maanden': { nl: '{n} maanden met omzet', en: '{n} months with revenue', ar: '{n} شهرًا فيها إيراد' },
  'dba.maandEen': { nl: '1 maand met omzet', en: '1 month with revenue', ar: 'شهر واحد فيه إيراد' },
  'dba.tarief': { nl: '{bedrag} per uur', en: '{bedrag} per hour', ar: '{bedrag} للساعة' },
  'dba.gewonnen': { nl: '{n} van hen kwamen dit jaar binnen.', en: '{n} of them came in this year.', ar: '{n} منهم جاؤوا هذه السنة.' },
  'dba.gewonnenEen': { nl: '1 van hen kwam dit jaar binnen.', en: '1 of them came in this year.', ar: 'واحد منهم جاء هذه السنة.' },
  'dba.tariefBereik': { nl: 'Je afgesproken uurtarief loopt van {laag} tot {hoog}.', en: 'Your agreed hourly rate runs from {laag} to {hoog}.', ar: 'أجرك بالساعة المتّفق عليه يتراوح بين {laag} و{hoog}.' },
  'dba.tariefGelijk': { nl: 'Je hebt {bedrag} per uur afgesproken met elk van hen.', en: 'You agreed {bedrag} per hour with each of them.', ar: 'اتّفقت على {bedrag} للساعة مع كلٍّ منهم.' },
  'dba.geenOordeel': { nl: 'Dit zijn je eigen facturen, opgeteld. Of je zelfstandig bent hangt van meer af dan deze cijfers.', en: 'These are your own invoices, added up. Whether you are self-employed depends on more than these figures.', ar: 'هذه فواتيرك أنت، مجموعة. استقلالك يعتمد على أكثر من هذه الأرقام.' },
  // ── [ONDERHANDEN-WERK] Werk dat op de laatste dag van het boekjaar nog niet gefactureerd was ──
  'ohw.kop': { nl: 'Onderhanden werk op {datum}', en: 'Work in progress on {datum}', ar: 'عمل قيد التنفيذ في {datum}' },
  'ohw.uren': { nl: '{uren} uur', en: '{uren} hours', ar: '{uren} ساعة' },
  'ohw.geenKlant': { nl: 'Zonder klant', en: 'No customer', ar: 'بدون عميل' },
  'ohw.geen': { nl: 'Op die dag stond al je werk op een factuur.', en: 'On that day all your work was on an invoice.', ar: 'في ذلك اليوم كان كل عملك على فاتورة.' },
  'ohw.nietInSaldo': { nl: 'Dit bedrag zit niet in het saldo hierboven.', en: 'This amount is not in the result above.', ar: 'هذا المبلغ غير مُدرَج في النتيجة أعلاه.' },
  'ohw.oudste': { nl: 'Oudste uur hierin: {datum}.', en: 'Oldest hour in this: {datum}.', ar: 'أقدم ساعة هنا: {datum}.' },
  'ohw.zonderTarief.een': { nl: 'Bij 1 uur staat geen tarief — dat uur zit niet in dit bedrag.', en: '1 entry has no rate — it is not in this amount.', ar: 'قيد واحد بلا تعرفة — غير محتسب في هذا المبلغ.' },
  'ohw.zonderTarief.meer': { nl: 'Bij {n} uren staat geen tarief — die zitten niet in dit bedrag.', en: '{n} entries have no rate — they are not in this amount.', ar: '{n} سجلات بلا تعرفة — غير محتسبة في هذا المبلغ.' },
  'ohw.onbekendeFactuur': { nl: 'Van een factuur konden we de datum niet lezen. Dit bedrag kan te laag zijn.', en: "We could not read one invoice's date. This amount may be too low.", ar: 'تعذّرت قراءة تاريخ إحدى الفواتير. قد يكون هذا المبلغ أقل من الواقع.' },
  'ohw.leesfout': { nl: 'We konden je onderhanden werk nu niet ophalen.', en: 'We could not fetch your work in progress right now.', ar: 'تعذّر جلب العمل قيد التنفيذ الآن.' },
  'jaar.wv.titel': { nl: 'Winst-en-verliesrekening', en: 'Profit and loss', ar: 'حساب الأرباح والخسائر' },
  'jaar.wv.opbrengsten': { nl: 'Opbrengsten', en: 'Revenue', ar: 'الإيرادات' },
  'jaar.wv.kosten': { nl: 'Kosten', en: 'Costs', ar: 'التكاليف' },
  'jaar.wv.saldo': { nl: 'Saldo (winst)', en: 'Balance (profit)', ar: 'الرصيد (الربح)' },
  'jaar.wv.afschrijvingen': { nl: 'waarvan afschrijvingen', en: 'of which depreciation', ar: 'منها الاستهلاك' },
  'jaar.balans.titel': { nl: 'Bedrijfsmiddelen', en: 'Business assets', ar: 'الأصول التجارية' },
  'jaar.balans.aanslagen': { nl: 'Belastingaanslagen betaald (niet in de kosten)', en: 'Tax assessments paid (not in costs)', ar: 'ضرائب مدفوعة (ليست ضمن التكاليف)' },
  'jaar.balans.investeringen': { nl: 'Investeringen dit jaar (niet in de kosten)', en: 'Investments this year (not in costs)', ar: 'استثمارات هذه السنة (ليست ضمن التكاليف)' },
  'jaar.balans.boekwaarde': { nl: 'Boekwaarde op 31 december', en: 'Book value on 31 December', ar: 'القيمة الدفترية في 31 ديسمبر' },
  'jaar.balans.registerLeeg': { nl: 'Register is leeg — een investering van € 450 of meer hoort erin', en: 'Register is empty — an investment of € 450 or more belongs in it', ar: 'السجل فارغ — مكان أي استثمار بقيمة € 450 أو أكثر هنا.' },
  'jaar.balans.registerLink': { nl: 'Open het register', en: 'Open the register', ar: 'افتح السجل' },
  'jaar.balans.onleesbaar': { nl: 'Het register kon nu niet gelezen worden: elke inkoop telt hierboven als kost. Ververs de pagina.', en: 'The register could not be read: every purchase counts as a cost above. Refresh the page.', ar: 'تعذّرت قراءة السجل الآن: كل شراء محسوب أعلاه كتكلفة. أعد تحميل الصفحة.' },
  // [BEDRIJFSMIDDEL] The asset register — /dashboard/bedrijfsmiddelen.
  'bm.titel': { nl: 'Bedrijfsmiddelen', en: 'Business assets', ar: 'الأصول التجارية' },
  'bm.intro': { nl: 'Een investering van € 450 of meer schrijf je af over zijn gebruiksduur. Zet hem hier; het jaarcijfer volgt.', en: 'An investment of € 450 or more is depreciated over its useful life. Put it here; the year figure follows.', ar: 'الاستثمار بقيمة € 450 أو أكثر يُستهلك على مدى عمره الإنتاجي. سجّله هنا؛ ويأتي رقم السنة بعد ذلك.' },
  'bm.leeg': { nl: 'Nog geen bedrijfsmiddelen.', en: 'No business assets yet.', ar: 'لا أصول تجارية بعد.' },
  'bm.kolom.inGebruik': { nl: 'in gebruik sinds', en: 'in use since', ar: 'قيد الاستخدام منذ' },
  'bm.kolom.aanschaf': { nl: 'Aanschaf', en: 'Cost', ar: 'التكلفة' },
  'bm.kolom.perJaar': { nl: 'Per jaar', en: 'Per year', ar: 'سنويًا' },
  'bm.kolom.boekwaarde': { nl: 'Boekwaarde', en: 'Book value', ar: 'القيمة الدفترية' },
  'bm.afgevoerd': { nl: 'afgevoerd {datum}', en: 'disposed {datum}', ar: 'تم التخلص منه في {datum}' },
  'bm.kandidaten.titel': { nl: 'Is dit een bedrijfsmiddel?', en: 'Is this a business asset?', ar: 'هل هذا أصل تجاري؟' },
  'bm.kandidaten.uitleg': { nl: 'Inkopen van € 450 of meer bij een leverancier waar je zelden koopt. Jij beslist.', en: 'Purchases of € 450 or more from a supplier you rarely buy from. You decide.', ar: 'مشتريات بقيمة € 450 أو أكثر من مورّد نادرًا ما تشتري منه. القرار لك.' },
  'bm.kandidaat.ja': { nl: 'Ja, bedrijfsmiddel', en: 'Yes, an asset', ar: 'نعم، أصل' },
  'bm.kandidaat.nee': { nl: 'Nee, inkoop', en: 'No, a purchase', ar: 'لا، مشتريات' },
  'bm.toevoegen': { nl: 'Bedrijfsmiddel toevoegen', en: 'Add an asset', ar: 'إضافة أصل' },
  'bm.veld.omschrijving': { nl: 'Omschrijving', en: 'Description', ar: 'الوصف' },
  'bm.veld.aanschaf': { nl: 'Aanschafwaarde (ex btw)', en: 'Cost (ex btw)', ar: 'قيمة الشراء (بدون btw)' },
  'bm.veld.aanschafIncl': { nl: 'Aanschafwaarde (incl. btw)', en: 'Cost (incl. btw)', ar: 'قيمة الشراء (شاملة btw)' },
  'bm.veld.restwaarde': { nl: 'Restwaarde', en: 'Residual value', ar: 'القيمة المتبقية' },
  'bm.veld.gebruiksduur': { nl: 'Gebruiksduur (jaren)', en: 'Useful life (years)', ar: 'العمر الإنتاجي (سنوات)' },
  'bm.veld.inGebruik': { nl: 'In gebruik vanaf', en: 'In use from', ar: 'قيد الاستخدام اعتبارًا من' },
  'bm.regel': { nl: 'Per jaar: (aanschaf − restwaarde) ÷ gebruiksduur, maximaal 20% per jaar. Willekeurige afschrijving of een bedrijfspand: overleg met je boekhouder.', en: 'Per year: (cost − residual value) ÷ useful life, at most 20% a year. Accelerated depreciation or a business premises: consult your accountant.', ar: 'سنويًا: (التكلفة − القيمة المتبقية) ÷ العمر الإنتاجي، بحد أقصى 20% سنويًا. الاستهلاك المعجّل أو مبنى تجاري: استشر محاسبك.' },
  'bm.opslaan': { nl: 'Opslaan', en: 'Save', ar: 'حفظ' },
  'bm.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'bm.afvoeren': { nl: 'Verkocht of afgevoerd', en: 'Sold or disposed', ar: 'بيع أو التخلص منه' },
  'bm.afvoerenUitleg': { nl: 'De afschrijving stopt na deze maand. De boekwinst of het verlies bij verkoop boek je met je boekhouder.', en: 'Depreciation stops after this month. The gain or loss on sale you book with your accountant.', ar: 'يتوقف الاستهلاك بعد هذا الشهر. ربح أو خسارة البيع تقيّده مع محاسبك.' },
  'bm.verwijderen': { nl: 'Verwijderen', en: 'Delete', ar: 'حذف' },
  'bm.verwijderVraag': { nl: 'Bedrijfsmiddel verwijderen?', en: 'Delete this asset?', ar: 'حذف هذا الأصل؟' },
  'bm.verwijderUitleg': { nl: 'De inkoopfactuur telt dan weer volledig als kost in zijn jaar.', en: 'The purchase invoice then counts in full as a cost in its year again.', ar: 'ستُحتسب فاتورة الشراء عندها بالكامل كتكلفة في سنتها من جديد.' },
  'bm.boekwinstNoot': { nl: 'Boekwinst of -verlies bij verkoop: bespreek met je boekhouder.', en: 'Gain or loss on sale: discuss with your accountant.', ar: 'ربح أو خسارة البيع: ناقشه مع محاسبك.' },
  'bm.fout.laden': { nl: 'We konden het register nu niet lezen. Probeer het zo opnieuw.', en: 'We could not read the register right now. Try again shortly.', ar: 'تعذّرت قراءة السجل الآن. حاول بعد قليل.' },
  'bm.fout.opslaan': { nl: 'Kon niet opslaan.', en: 'Could not save.', ar: 'تعذّر الحفظ.' },
  'bm.nietBeschikbaar': { nl: 'Het register staat nog niet aan op deze omgeving.', en: 'The register is not switched on in this environment yet.', ar: 'السجل غير مفعّل بعد في هذه البيئة.' },
  'jaar.uren.titel': { nl: 'Urencriterium', en: 'Hours criterion', ar: 'معيار الساعات' },
  'jaar.mist.titel': { nl: 'Wat hier niet in zit', en: 'What is not in here', ar: 'ما ليس مشمولًا هنا' },
  'jaar.mist.intro': { nl: 'Deze administratie houdt het volgende niet bij — neem het mee vóór je cijfers overneemt:', en: 'This administration does not track the following — account for it before copying figures:', ar: 'هذه الإدارة لا تتتبع التالي — خذه بالحسبان قبل نقل الأرقام:' },
  'jaar.kanttekeningen.titel': { nl: 'Kanttekeningen', en: 'Caveats', ar: 'ملاحظات جانبية' },
  'jaar.laden': { nl: 'Jaar doorrekenen…', en: 'Computing the year…', ar: 'جارٍ احتساب السنة…' },
  'jaar.fout': { nl: 'We konden het jaar nu niet doorrekenen. Probeer het zo opnieuw.', en: 'We could not compute the year right now. Try again shortly.', ar: 'تعذّر احتساب السنة الآن. حاول بعد قليل.' },
  'jaar.xaf.link': { nl: 'Download auditbestand (XAF 3.2) voor de boekhouder', en: 'Download audit file (XAF 3.2) for your accountant', ar: 'نزّل ملف التدقيق (XAF 3.2) للمحاسب' },
  'jaar.xaf.link4': { nl: 'Download auditbestand XAF 4.0 (Belastingdienst vanaf 2027)', en: 'Download audit file XAF 4.0 (tax office from 2027)', ar: 'نزّل ملف التدقيق XAF 4.0 (مصلحة الضرائب من 2027)' },

  'log.kasboek.imported_read_only': { nl: 'Kasboek gelezen (niets geboekt)', en: 'Cash book read (nothing booked)', ar: 'قُرئ دفتر الصندوق (لم يُقيَّد شيء)' },
  'log.kasboek.gap_booked': { nl: 'Ontbrekende kasuitgaven uit het kasboek geboekt', en: 'Missing cash payments booked from the cash book', ar: 'قُيّدت مصروفات نقدية ناقصة من دفتر النقد' },
  'log.turnover.day_removed': { nl: 'Dagomzet van een dag verwijderd', en: 'A day of turnover removed', ar: 'حُذف إيراد يوم' },
  'log.article.seeded_from_vak': { nl: 'Prijslijst gevuld vanuit een vak-sjabloon', en: 'Price list filled from a trade template', ar: 'مُلئت قائمة الأسعار من قالب مهنة' },
  'log.turnover.day_entered': { nl: 'Dagomzet zelf ingevuld', en: 'Daily turnover entered by hand', ar: 'أُدخل إيراد اليوم يدويًا' },
  'log.till.ticket_rung': { nl: 'Verkoop aangeslagen op de kassa', en: 'Sale rung up on the till', ar: 'سُجّلت عملية بيع على الكاشير' },
  'log.till.ticket_voided': { nl: 'Kassabon teruggedraaid', en: 'Till ticket voided', ar: 'أُلغيت فاتورة كاشير' },
  'log.ledger.auto_imported': { nl: 'Kasstaat ingelezen', en: 'Till ledger imported', ar: 'استُورد كشف صندوق' },
  'log.btw.filed': { nl: 'BTW-aangifte als ingediend gemarkeerd', en: 'VAT return marked as filed', ar: 'وُسم إقرار ضريبة القيمة المضافة كمُقدَّم' },
  'log.btw.filed_despite_warnings': { nl: 'BTW-aangifte ingediend ondanks waarschuwingen', en: 'VAT return filed despite warnings', ar: 'قُدّم إقرار ضريبة القيمة المضافة رغم التحذيرات' },
  'log.btw.filing_unlocked': { nl: 'Een ingediend kwartaal weer opengezet', en: 'A filed quarter re-opened', ar: 'أُعيد فتح ربع مُقدَّم' },
  // [SUPPLETIE-VERREKEND] Added by another session in the same week as the logboek itself, which
  // is exactly the collision AGENTS.md describes: both branches merged cleanly and the COMBINATION
  // was broken — an action with no sentence reaches the logboek as a bare identifier.
  'log.btw.correction_carried': {
    nl: 'Een correctie in een latere aangifte verwerkt',
    en: 'A correction processed in a later VAT return',
    ar: 'عولج تصحيح ضمن إقرار لاحق',
  },
  'log.accountant.client_invited': { nl: 'Klant uitgenodigd', en: 'Client invited', ar: 'دُعي عميل' },
  'log.accountant.client_linked': { nl: 'Koppeling met een boekhouder tot stand gekomen', en: 'Link with a bookkeeper established', ar: 'تمّ ربط محاسب' },
  'log.accountant.client_unlinked': { nl: 'Koppeling met een boekhouder verbroken', en: 'Link with a bookkeeper ended', ar: 'أُنهي الربط مع محاسب' },
  'log.accountant.invoice_status_set': { nl: 'Je boekhouder heeft de status van een factuur gezet', en: 'Your bookkeeper set an invoice\'s status', ar: 'ضبط محاسبك حالة فاتورة' },
  'log.accountant.invoice_mandate_granted': { nl: 'Machtiging aan je boekhouder gegeven', en: 'Mandate granted to your bookkeeper', ar: 'مُنح تفويض لمحاسبك' },
  'log.accountant.invoice_mandate_revoked': { nl: 'Machtiging van je boekhouder ingetrokken', en: 'Mandate withdrawn from your bookkeeper', ar: 'سُحب تفويض محاسبك' },
  'log.accountant.documents_requested': { nl: 'Je boekhouder heeft stukken opgevraagd', en: 'Your bookkeeper requested documents', ar: 'طلب محاسبك مستندات' },
  'log.accountant.invoice_confirmed': { nl: 'Je boekhouder heeft een factuur bevestigd', en: 'Your bookkeeper confirmed an invoice', ar: 'أكّد محاسبك الفاتورة' },
  'log.accountant.mandate_requested': { nl: 'Je boekhouder heeft om een machtiging gevraagd', en: 'Your bookkeeper asked for a mandate', ar: 'طلب محاسبك تفويضًا' },
  'log.invoice.reminder_sent': { nl: 'Herinnering naar je klant gestuurd', en: 'Reminder sent to your customer', ar: 'أُرسل تذكير إلى عميلك' },
  'log.member.invited': { nl: 'Medewerker uitgenodigd', en: 'Team member invited', ar: 'دُعي موظف' },
  'log.member.joined': { nl: 'Medewerker toegetreden', en: 'Team member joined', ar: 'انضمّ موظف' },
  'log.member.revoked': { nl: 'Toegang van een medewerker ingetrokken', en: 'Team member\'s access withdrawn', ar: 'سُحبت صلاحية وصول موظف' },
  'log.retention.warning_sent': { nl: 'Waarschuwing over de bewaartermijn verstuurd', en: 'Retention warning sent', ar: 'أُرسل تحذير بشأن مدة الحفظ' },
  // [PAKKET-LINK] Dezelfde drie feiten, maar voor de deel-link naar een boekhouder ZONDER account.
  // Apart van de regel hieronder omdat er geen ingelogde boekhouder achter zit: dit is het spoor
  // van de EIGENAAR — naar wie hij zijn boeken stuurde, wanneer, en of ze zijn opgehaald.
  'log.package.link_shared': { nl: 'Je hebt het kwartaalpakket naar je boekhouder gestuurd', en: 'You sent the quarterly package to your bookkeeper', ar: 'أرسلت حزمة الربع إلى محاسبك' },
  'log.package.link_downloaded': { nl: 'Je boekhouder heeft het kwartaalpakket via je link opgehaald', en: 'Your bookkeeper collected the quarterly package through your link', ar: 'حمّل محاسبك حزمة الربع عبر رابطك' },
  'log.package.link_revoked': { nl: 'Je hebt de deel-link naar je boekhouder ingetrokken', en: 'You withdrew the share link to your bookkeeper', ar: 'سحبت رابط المشاركة المُرسل إلى محاسبك' },
  'log.accountant.package_downloaded': { nl: 'Je boekhouder heeft het kwartaalpakket gedownload', en: 'Your bookkeeper downloaded the quarterly package', ar: 'نزّل محاسبك حزمة الربع' },
  'log.accountant.export_downloaded': { nl: 'Je boekhouder heeft een export gedownload', en: 'Your bookkeeper downloaded an export', ar: 'نزّل محاسبك تصديراً' },
  'log.supplier.auto_incasso_on': { nl: 'Leverancier gemarkeerd als automatische incasso', en: 'Supplier marked as direct debit', ar: 'وُسم مورّد بالخصم المباشر' },
  'log.supplier.auto_incasso_off': { nl: 'Automatische incasso bij een leverancier uitgezet', en: 'Direct debit switched off for a supplier', ar: 'أُوقف الخصم المباشر لمورّد' },
  'log.supplier.created': { nl: 'Leverancier toegevoegd', en: 'Supplier added', ar: 'أُضيف مورّد' },
  'log.supplier.deleted': { nl: 'Leverancier verwijderd', en: 'Supplier removed', ar: 'حُذف مورّد' },
  'log.supplier.updated': { nl: 'Gegevens van een leverancier aangepast', en: 'Supplier details changed', ar: 'عُدّلت بيانات مورّد' },
  'log.supplier.merged': { nl: 'Twee leveranciers samengevoegd tot één', en: 'Two suppliers merged into one', ar: 'دُمج مورّدان في واحد' },
  'log.document.uploaded': { nl: 'Bestand geüpload', en: 'File uploaded', ar: 'رُفع ملف' },
  'log.document.duplicate_blocked': { nl: 'Dubbel bestand geweigerd', en: 'Duplicate file refused', ar: 'رُفض ملف مكرر' },
  'log.document.deleted': { nl: 'Bestand verwijderd', en: 'File deleted', ar: 'حُذف ملف' },
  'log.document.bulk_deleted': { nl: 'Meerdere bestanden verwijderd', en: 'Several files deleted', ar: 'حُذفت عدة ملفات' },
  'log.document.restored': { nl: 'Bestand teruggezet', en: 'File restored', ar: 'أُعيد ملف' },
  'log.document.reminder_filed': { nl: 'Betalingsherinnering bewaard, niet geboekt', en: 'Payment reminder filed, not booked', ar: 'حُفظ تذكير بالدفع ولم يُقيّد' },
  'log.work.created': { nl: 'Werk aangemaakt', en: 'Work created', ar: 'أُنشئ عمل' },
  'log.work.status_changed': { nl: 'Werk van status veranderd', en: 'Work status changed', ar: 'تغيّرت حالة العمل' },
  'log.work.invoiced': { nl: 'Werk gefactureerd', en: 'Work invoiced', ar: 'فُوتر العمل' },
  'log.work.deleted': { nl: 'Werk verwijderd', en: 'Work deleted', ar: 'حُذف عمل' },
  'log.work.visit_recorded': { nl: 'Beurt gedaan op werk', en: 'Visit recorded on work', ar: 'سُجّلت زيارة على عمل' },
  'log.article.bulk_deleted': { nl: 'Meerdere artikelen verwijderd', en: 'Several articles deleted', ar: 'حُذفت عدة أصناف' },
  'log.folder.created': { nl: 'Map aangemaakt', en: 'Folder created', ar: 'أُنشئ مجلد' },
  'log.folder.deleted': { nl: 'Map verwijderd', en: 'Folder deleted', ar: 'حُذف مجلد' },
  'log.folder.renamed': { nl: 'Map hernoemd', en: 'Folder renamed', ar: 'أُعيدت تسمية مجلد' },
  'log.user.password_changed': { nl: 'Wachtwoord gewijzigd', en: 'Password changed', ar: 'غُيّرت كلمة المرور' },
  'log.user.email_changed': { nl: 'E-mailadres gewijzigd', en: 'E-mail address changed', ar: 'غُيّر البريد الإلكتروني' },
  'log.user.account_deletion_requested': { nl: 'Verwijdering van het account aangevraagd', en: 'Account deletion requested', ar: 'طُلب حذف الحساب' },
  'log.user.data_purged': { nl: 'Gegevens definitief verwijderd', en: 'Data permanently deleted', ar: 'حُذفت البيانات نهائيًا' },
  'log.email.connection_created': { nl: 'Mailbox gekoppeld', en: 'Mailbox connected', ar: 'رُبط البريد' },
  'log.email.connection_revoked': { nl: 'Mailbox ontkoppeld', en: 'Mailbox disconnected', ar: 'فُصل البريد' },
  'log.email.sender_rule_created': { nl: 'Regel voor een afzender aangemaakt', en: 'Sender rule created', ar: 'أُنشئت قاعدة لمُرسِل' },
  'log.email.sender_rule_deleted': { nl: 'Regel voor een afzender verwijderd', en: 'Sender rule deleted', ar: 'حُذفت قاعدة مُرسِل' },
  'log.snelstart.connected': { nl: 'SnelStart gekoppeld', en: 'SnelStart connected', ar: 'رُبط SnelStart' },
  'log.snelstart.disconnected': { nl: 'SnelStart ontkoppeld', en: 'SnelStart disconnected', ar: 'فُصل SnelStart' },
  'log.snelstart.pushed': { nl: 'Naar SnelStart doorgezet', en: 'Pushed to SnelStart', ar: 'أُرسل إلى SnelStart' },
  'log.snelstart.hold_acknowledged': { nl: 'Blokkade bij SnelStart afgehandeld', en: 'SnelStart hold acknowledged', ar: 'عولج توقّف في SnelStart' },
  'log.bank.connect_started': { nl: 'Bankkoppeling gestart', en: 'Bank connection started', ar: 'بدأ ربط البنك' },
  'log.bank.connected': { nl: 'Bank gekoppeld', en: 'Bank connected', ar: 'رُبط البنك' },
  'log.bank.disconnected': { nl: 'Bank ontkoppeld', en: 'Bank disconnected', ar: 'فُصل البنك' },

  // [LOGBOEK] The screen's own words. `log.onbekend` is the one that matters most: an action with
  // no sentence is still SHOWN, phrased neutrally and carrying its raw name — an audit trail that
  // hides what it cannot phrase is not an audit trail.
  'log.titel': { nl: 'Logboek', en: 'Activity log', ar: 'سجل النشاط' },
  'log.uitleg': {
    nl: 'Alles wat er in jouw administratie is gebeurd — ook wat je boekhouder deed.',
    en: 'Everything that happened in your administration — including what your bookkeeper did.',
    ar: 'كل ما جرى في إدارتك — بما في ذلك ما فعله محاسبك.',
  },
  'log.leeg': {
    nl: 'Er is nog niets gebeurd om te tonen.',
    en: 'Nothing has happened yet.',
    ar: 'لم يحدث شيء بعد.',
  },
  'log.mislukt': {
    nl: 'We konden je logboek niet lezen. Dit is geen “er is niets gebeurd”.',
    en: 'We could not read your log. This is not “nothing happened”.',
    ar: 'تعذّرت قراءة دفترك. هذا ليس «لم يحدث شيء».',
  },
  'log.onbekend': { nl: 'Handeling vastgelegd', en: 'Action recorded', ar: 'سُجّل إجراء' },
  'log.doorAnder': { nl: 'door iemand anders', en: 'by someone else', ar: 'بواسطة شخص آخر' },
  'log.meer': { nl: 'Meer laden', en: 'Load more', ar: 'تحميل المزيد' },
  'log.filter.alles': { nl: 'Alles', en: 'Everything', ar: 'الكل' },
  'log.filter.geld': { nl: 'Geld', en: 'Money', ar: 'المال' },
  'log.filter.document': { nl: 'Documenten', en: 'Documents', ar: 'المستندات' },
  'log.filter.toegang': { nl: 'Toegang', en: 'Access', ar: 'الوصول' },
  'log.spoorOnvolledig': {
    nl: 'Je boekhouder is gekoppeld, maar je ziet hier nog geen handelingen van hem. Er ontbreekt een instelling in de database.',
    en: 'Your bookkeeper is linked, but none of their actions appear here yet. A database setting is missing.',
    ar: 'محاسبك مرتبط، لكن لا تظهر أي من إجراءاته هنا بعد. ينقص إعداد في قاعدة البيانات.',
  },

  // ─── [2FA] Verificatie in twee stappen ──────────────────────────────────────────────────────
  //
  // The wording carries one thing the generic version of this feature does not: WHY it is heavier
  // here than on an ordinary account. A mandated bookkeeper and an invited medewerker both issue
  // invoices in the owner's unbroken number series, under the owner's BTW number — so a stolen
  // password is not access to a dashboard, it is the authority to make documents that cannot be
  // withdrawn. And the lockout sentence is not fine print: losing the phone means losing the way
  // into records the Belastingdienst can ask for, so it is said BEFORE the switch, not after.

  // ── [DOORLOPEND] Loopt de factuurnummering door? ───────────────────────────────────
  //
  // Artikel 35 Wet OB vraagt een doorlopende reeks. Een gat is meestal geen fraude en geen bug: het
  // nummer wordt vóór de factuur toegekend, dus een verzending die halverwege strandt verbrandt er
  // één. Dat mág — de Belastingdienst accepteert een gat dat je kunt UITLEGGEN. Wat niet mag is een
  // gat dat niemand heeft gezien. Vandaar de toon hieronder: benoemen, niet alarmeren.
  'doorlopend.klopt': {
    nl: 'Je factuurnummering loopt door, zonder gaten.',
    en: 'Your invoice numbering runs unbroken, with no gaps.',
    ar: 'ترقيم فواتيرك متصل، بلا فجوات.',
  },
  'doorlopend.halfGecontroleerd': {
    nl: 'Het einde van de reeks konden we nu niet nakijken.',
    en: 'We could not check the end of the series just now.',
    ar: 'لم نتمكّن الآن من فحص نهاية السلسلة.',
  },
  'doorlopend.nietGelezen': {
    nl: 'We konden je nummering nu niet nakijken. Dat betekent niet dat er iets mis is.',
    en: 'We could not check your numbering just now. That does not mean anything is wrong.',
    ar: 'تعذّر علينا فحص ترقيمك الآن. هذا لا يعني أن هناك خطأ.',
  },
  'doorlopend.gatenTitel': {
    nl: 'Er ontbreken nummers in je reeks',
    en: 'Numbers are missing from your series',
    ar: 'تنقص أرقام من سلسلتك',
  },
  'doorlopend.reeks.factuur': { nl: 'Facturen', en: 'Invoices', ar: 'الفواتير' },
  'doorlopend.reeks.creditnota': { nl: 'Creditnota\'s', en: 'Credit notes', ar: 'الإشعارات الدائنة' },
  'doorlopend.ontbreekt': {
    nl: '— nummer {nummers} is nooit uitgereikt.',
    en: '— number {nummers} was never issued.',
    ar: '— الرقم {nummers} لم يُصدر قط.',
  },
  'doorlopend.eindeReeks': {
    nl: '— {aantal} aan het eind van de reeks: de teller staat hoger dan je hoogste factuur.',
    en: '— {aantal} at the end of the series: the counter stands higher than your highest invoice.',
    ar: '— {aantal} في نهاية السلسلة: العدّاد أعلى من أعلى فاتورة لديك.',
  },
  // [REEKS-ZONDER-FACTUUR] Een eigen zin, want "aan het eind van de reeks" veronderstelt een reeks.
  // Dit gaat over een reeks waarin nooit iets is geschreven: de teller staat op 2 en er is geen
  // enkele creditnota. De gewone aanleiding is een weggegooid concept, en dat is een volstrekt
  // legitiem antwoord — de eigenaar moet het alleen kunnen GEVEN, en daarvoor moet hij het zien.
  'doorlopend.reeksLeeg': {
    nl: '— {aantal} toegekend, maar er staat geen enkel document in deze reeks. Meestal een concept dat is weggegooid; noteer dat even voor je boekhouder.',
    en: '— {aantal} allocated, but there is no document at all in this series. Usually a discarded draft; make a note of it for your accountant.',
    ar: '— {aantal} مُخصّصة، لكن لا يوجد أي مستند في هذه السلسلة. غالبًا مسوّدة حُذفت؛ دوّن ذلك لمحاسبك.',
  },
  'doorlopend.dubbel': {
    nl: '— nummer {nummers} komt twee keer voor. Dit hoort niet te kunnen; laat het ons weten.',
    en: '— number {nummers} appears twice. This should not be possible; please tell us.',
    ar: '— الرقم {nummers} يتكرر مرتين. هذا لا يُفترض أن يحدث؛ أخبرنا به.',
  },
  'doorlopend.onleesbaar': {
    nl: 'Deze nummers passen niet in je huidige opmaak, dus die konden we niet meetellen: {nummers}. Meestal is dat overgenomen historie uit een vorig pakket.',
    en: 'These numbers do not fit your current format, so we could not include them: {nummers}. Usually that is history carried over from a previous package.',
    ar: 'هذه الأرقام لا تطابق تنسيقك الحالي فلم نستطع احتسابها: {nummers}. غالباً ما تكون سجلات منقولة من برنامج سابق.',
  },
  'doorlopend.watNu': {
    nl: 'Een verbrand nummer kun je niet opnieuw gebruiken, en dat hoeft niet: de Belastingdienst accepteert een gat dat je kunt uitleggen. Schrijf op wat er gebeurde en bewaar het bij je administratie.',
    en: 'A burned number cannot be reused, and need not be: the Belastingdienst accepts a gap you can explain. Write down what happened and keep it with your records.',
    ar: 'لا يمكن إعادة استخدام الرقم المحروق، ولا حاجة لذلك: تقبل مصلحة الضرائب فجوة يمكنك تفسيرها. دوِّن ما حدث واحفظه مع سجلاتك.',
  },
  // ── [GELD-INVARIANT] Kloppen de boeken met zichzelf ────────────────────────────────
  //
  // Alleen de OMLIJSTING staat hier. De bevindingen zelf komen als zin uit money-invariants.ts,
  // omdat ze bedragen en factuurnummers bevatten die per geval verschillen — precies zoals het
  // klaar-scherm de zinnen van readiness.ts rendert. Wat hier staat is wat het scherm zegt als er
  // NIETS te melden valt, en dat is de helft die er het meest toe doet: een controle die alleen
  // spreekt als ze iets vindt, bewijst nooit dat ze gedraaid heeft.
  // Geen titelsleutel: het paneel zwijgt op één regel als alles klopt, precies als het
  // nummeringspaneel ernaast. Een kop boven een regel die zegt dat er niets aan de hand is, maakt
  // van die regel een blok — en een blok ter grootte van een waarschuwing is hoe mensen leren over
  // die plek heen te lezen. De kop bestaat alleen in het waarschuwingsvak, hieronder.
  'geld.klopt': {
    nl: 'Elke factuur klopt met de betalingen die eraan hangen. Geen enkel verschil gevonden.',
    en: 'Every invoice agrees with the payments attached to it. No difference found.',
    ar: 'كل فاتورة تتطابق مع المدفوعات المرتبطة بها. لم يُعثر على أي فرق.',
  },
  'geld.ladeNietGecontroleerd': {
    nl: 'De kaslade konden we nu niet nakijken.',
    en: 'We could not check the cash drawer just now.',
    ar: 'لم نتمكّن الآن من فحص درج النقد.',
  },
  'geld.nietGelezen': {
    nl: 'We konden je boeken nu niet nakijken. Dat betekent niet dat er iets mis is.',
    en: 'We could not check your books just now. That does not mean anything is wrong.',
    ar: 'تعذّر علينا فحص دفاترك الآن. هذا لا يعني أن هناك خطأ.',
  },
  'geld.verschillenTitel': {
    nl: 'Twee bronnen zijn het oneens',
    en: 'Two sources disagree',
    ar: 'مصدران غير متفقين',
  },
  'geld.watNu': {
    nl: 'We herstellen dit niet automatisch: er moet één bron gekozen worden, en fout kiezen schrijft een onwaar bedrag over een waar bedrag heen. Kijk het na, of leg het voor aan je boekhouder.',
    en: 'We do not repair this automatically: one source has to be chosen, and choosing wrong writes a false amount over a true one. Check it, or put it to your accountant.',
    ar: 'لا نصلح هذا تلقائيًا: يجب اختيار مصدر واحد، والاختيار الخاطئ يكتب مبلغًا غير صحيح فوق مبلغ صحيح. راجعه، أو اعرضه على محاسبك.',
  },
  // ── [BEVEILIGING] Wie kan bij deze administratie ───────────────────────────────────
  //
  // Dit scherm beantwoordt de enige vraag die een zzp'er niet zelf kan controleren als hij zijn
  // boeken aan een app geeft: leest er iemand anders mee. Elke zin hieronder is dus een uitspraak
  // over ZIJN gegevens en niet over ons — en waar we het niet zeker weten, staat dat er.
  'bev.titel': { nl: 'Beveiliging & toegang', en: 'Security & access', ar: 'الأمان والوصول' },
  'bev.uitleg': {
    nl: 'Wat er op dit moment waar is over deze administratie: wie erbij kan, hoe hij op slot zit, en wat er van elke handeling is vastgelegd.',
    en: 'What is true about this administration right now: who can open it, how it is locked, and what has been recorded of every action.',
    ar: 'ما هو صحيح الآن عن هذه الإدارة: من يستطيع فتحها، وكيف هي مُقفلة، وما الذي سُجِّل من كل إجراء.',
  },
  'bev.wie.titel': { nl: 'Wie kan bij deze administratie', en: 'Who can open this administration', ar: 'من يستطيع الوصول إلى هذه الإدارة' },
  'bev.wie.alleenJij': {
    nl: 'Alleen jij. Er is verder niemand aan deze administratie gekoppeld.',
    en: 'Only you. Nobody else is linked to this administration.',
    ar: 'أنت فقط. لا أحد آخر مرتبط بهذه الإدارة.',
  },
  'bev.wie.aantal': {
    nl: '{aantal} mensen kunnen bij deze administratie.',
    en: '{aantal} people can open this administration.',
    ar: '{aantal} أشخاص يمكنهم الوصول إلى هذه الإدارة.',
  },
  // De hele reden dat dit scherm bestaat, staat in deze zin: liever "we weten het niet zeker" dan
  // een geruststelling die we niet kunnen waarmaken.
  'bev.wie.onvolledig': {
    nl: 'We konden niet alles uitlezen, dus deze lijst is misschien niet compleet. Wat er staat klopt; wat er niet staat weten we nu niet zeker.',
    en: 'We could not read everything, so this list may be incomplete. What is here is correct; what is missing we cannot be sure about right now.',
    ar: 'تعذّر علينا قراءة كل شيء، لذا قد تكون هذه القائمة ناقصة. ما هو مذكور صحيح؛ وما هو غائب لا نستطيع تأكيده الآن.',
  },
  'bev.rol.eigenaar': { nl: 'Jij — eigenaar', en: 'You — owner', ar: 'أنت — المالك' },
  'bev.rol.boekhouder': { nl: 'Boekhouder', en: 'Bookkeeper', ar: 'المحاسب' },
  'bev.rol.medewerker': { nl: 'Medewerker', en: 'Employee', ar: 'الموظف' },
  'bev.naamOnbekend': { nl: 'Naam niet gelezen', en: 'Name not read', ar: 'تعذّرت قراءة الاسم' },
  'bev.sinds': { nl: 'Sinds {datum}', en: 'Since {datum}', ar: 'منذ {datum}' },
  'bev.beheren': { nl: 'Toegang beheren', en: 'Manage access', ar: 'إدارة الوصول' },
  'bev.hint.titel': {
    nl: 'Je administratie hangt aan één wachtwoord',
    en: 'Your administration hangs on one password',
    ar: 'إدارتك معلَّقة على كلمة مرور واحدة',
  },
  'bev.apparaten.titel': { nl: 'Andere apparaten', en: 'Other devices', ar: 'الأجهزة الأخرى' },
  // De eerlijke helft staat in de zin zelf: wat we NIET kunnen tonen, staat er vóór wat we wel kunnen.
  'bev.apparaten.uitleg': {
    nl: 'Een lijst van je apparaten kunnen we niet tonen. Wel kun je alle andere sessies in één keer uitloggen — doe dat als je vermoedt dat iemand je wachtwoord heeft.',
    en: 'We cannot show a list of your devices. You can sign out every other session at once — do that if you suspect someone has your password.',
    ar: 'لا نستطيع عرض قائمة أجهزتك. لكن يمكنك إنهاء كل الجلسات الأخرى دفعة واحدة — افعل ذلك إن شككت أن أحدًا يعرف كلمة سرّك.',
  },
  'bev.apparaten.knop': { nl: 'Log alle andere apparaten uit', en: 'Sign out every other device', ar: 'إنهاء الجلسات على كل الأجهزة الأخرى' },
  'bev.apparaten.gelukt': {
    nl: 'Alle andere sessies zijn uitgelogd. Dit apparaat blijft ingelogd.',
    en: 'Every other session has been signed out. This device stays signed in.',
    ar: 'أُنهيت كل الجلسات الأخرى. هذا الجهاز يبقى مسجَّلًا.',
  },
  'bev.apparaten.mislukt': {
    nl: 'Het is niet gelukt, en we weten niet of er iets is uitgelogd. Probeer het zo meteen opnieuw.',
    en: 'It did not work, and we do not know whether anything was signed out. Try again in a moment.',
    ar: 'لم تنجح العملية، ولا نعرف إن أُنهيت أي جلسة. أعد المحاولة بعد قليل.',
  },
  'bev.log.titel': { nl: 'Wat er is vastgelegd', en: 'What has been recorded', ar: 'ما الذي سُجِّل' },
  'bev.log.uitleg': {
    nl: 'Elke handeling in deze administratie wordt vastgelegd — ook die van je boekhouder, en ook die van ons. Je kunt het zelf teruglezen.',
    en: 'Every action in this administration is recorded — your bookkeeper\'s too, and ours. You can read it back yourself.',
    ar: 'كل إجراء في هذه الإدارة يُسجَّل — بما في ذلك إجراءات محاسبك وإجراءاتنا. ويمكنك مراجعته بنفسك.',
  },
  'bev.log.aantal': {
    nl: '{aantal} handelingen vastgelegd',
    en: '{aantal} actions recorded',
    ar: '{aantal} إجراءً مُسجَّلًا',
  },
  'bev.log.onbekend': {
    nl: 'We konden het aantal nu niet lezen. Het logboek zelf staat er wel.',
    en: 'We could not read the number just now. The logbook itself is still there.',
    ar: 'تعذّرت قراءة العدد الآن. أما السجل نفسه فموجود.',
  },
  'bev.log.bekijken': { nl: 'Logboek openen', en: 'Open the logbook', ar: 'فتح السجل' },
  'mfa.titel': { nl: 'Verificatie in twee stappen', en: 'Two-step verification', ar: 'التحقق بخطوتين' },
  'mfa.staatAan': { nl: 'Staat aan', en: 'Switched on', ar: 'مُفعَّل' },
  'mfa.staatUit': { nl: 'Staat uit', en: 'Switched off', ar: 'غير مُفعَّل' },
  'mfa.waarom': {
    nl: 'Wie jouw wachtwoord heeft, kan facturen uitreiken op jouw naam en in jouw doorlopende nummerreeks. Die kun je daarna niet meer intrekken. Een tweede stap sluit dat af.',
    en: 'Anyone with your password can issue invoices in your name and in your unbroken number series. Those cannot be withdrawn afterwards. A second step closes that off.',
    ar: 'من يملك كلمة مرورك يستطيع إصدار فواتير باسمك وفي سلسلة أرقامك المتصلة. ولا يمكن سحبها بعد ذلك. الخطوة الثانية تُغلق هذا الباب.',
  },
  'mfa.aanzetten': { nl: 'Aanzetten', en: 'Switch on', ar: 'تفعيل' },
  'mfa.uitzetten': { nl: 'Uitzetten', en: 'Switch off', ar: 'تعطيل' },
  'mfa.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'mfa.scan.uitleg': {
    nl: 'Scan deze code met je authenticator-app (bijvoorbeeld Google Authenticator, 1Password of Bitwarden).',
    en: 'Scan this code with your authenticator app (Google Authenticator, 1Password or Bitwarden, for example).',
    ar: 'امسح هذا الرمز بتطبيق المصادقة لديك (مثل Google Authenticator أو 1Password أو Bitwarden).',
  },
  'mfa.scan.handmatig': {
    nl: 'Kun je niet scannen? Typ deze sleutel over in je app:',
    en: 'Cannot scan? Type this key into your app instead:',
    ar: 'لا يمكنك المسح؟ اكتب هذا المفتاح في تطبيقك:',
  },
  'mfa.code.label': { nl: 'Code uit je app', en: 'Code from your app', ar: 'الرمز من تطبيقك' },
  'mfa.bevestig': { nl: 'Bevestigen', en: 'Confirm', ar: 'تأكيد' },
  'mfa.verifieer': { nl: 'Verifiëren', en: 'Verify', ar: 'تحقّق' },
  'mfa.verificatie.uitleg': {
    nl: 'Vul de zescijferige code in die je authenticator-app nu toont.',
    en: 'Enter the six-digit code your authenticator app is showing now.',
    ar: 'أدخل الرمز المكوّن من ستة أرقام الذي يعرضه تطبيق المصادقة الآن.',
  },
  'mfa.fout.ongeldig': {
    nl: 'Die code klopt niet. Codes verlopen na een halve minuut — probeer de nieuwste uit je app.',
    en: 'That code is not right. Codes expire after half a minute — try the newest one in your app.',
    ar: 'هذا الرمز غير صحيح. الرموز تنتهي خلال نصف دقيقة — جرّب أحدث رمز في تطبيقك.',
  },
  'mfa.fout.mislukt': {
    nl: 'We konden je code nu niet controleren. Dit betekent niet dat de code fout is — probeer het zo meteen opnieuw.',
    en: 'We could not check your code just now. That does not mean the code is wrong — try again in a moment.',
    ar: 'تعذّر التحقق من رمزك الآن. هذا لا يعني أن الرمز خاطئ — أعد المحاولة بعد قليل.',
  },
  'mfa.fout.aanzetten': {
    nl: 'Het aanzetten is niet gelukt. Er is niets veranderd: je logt in zoals altijd.',
    en: 'Switching it on did not work. Nothing changed: you sign in as before.',
    ar: 'لم ينجح التفعيل. لم يتغيّر شيء: تسجّل الدخول كالمعتاد.',
  },
  'mfa.gelukt': {
    nl: 'Verificatie in twee stappen staat nu aan. Vanaf je volgende aanmelding vragen we ook om een code.',
    en: 'Two-step verification is on. From your next sign-in we will also ask for a code.',
    ar: 'التحقق بخطوتين مُفعَّل الآن. سنطلب رمزًا أيضًا عند تسجيل دخولك التالي.',
  },
  'mfa.uit.gelukt': {
    nl: 'Verificatie in twee stappen staat uit. Je logt weer in met alleen je wachtwoord.',
    en: 'Two-step verification is off. You sign in with your password alone again.',
    ar: 'التحقق بخطوتين مُوقَف. ستسجّل الدخول بكلمة المرور وحدها.',
  },
  'mfa.waarschuwing.telefoon': {
    nl: 'Raak je je telefoon kwijt, dan raak je ook de toegang tot je administratie kwijt. Bewaar de sleutel hierboven ergens veilig, of voeg straks een tweede apparaat toe.',
    en: 'If you lose your phone, you lose access to your administration too. Keep the key above somewhere safe, or add a second device afterwards.',
    ar: 'إن فقدت هاتفك فقدت الوصول إلى إدارتك أيضًا. احفظ المفتاح أعلاه في مكان آمن، أو أضف جهازًا ثانيًا لاحقًا.',
  },
  'mfa.waarschuwing.sessies': {
    nl: 'Andere apparaten waarop je nu bent ingelogd, worden uitgelogd.',
    en: 'Other devices you are signed in on will be signed out.',
    ar: 'ستُسجَّل الأجهزة الأخرى المسجَّلة حاليًا خارج الحساب.',
  },
  'mfa.kwijt.titel': { nl: 'Je telefoon kwijt?', en: 'Lost your phone?', ar: 'فقدت هاتفك؟' },
  'mfa.kwijt.uitleg': {
    nl: 'Heb je een tweede apparaat, gebruik dan de code daarvan. Zo niet: mail support@boekbrug.nl vanaf het e-mailadres van je account — na controle zetten we de tweede stap uit.',
    en: 'If you have a second device, use the code from that one. If not: e-mail support@boekbrug.nl from your account address — after checking we switch the second step off.',
    ar: 'إن كان لديك جهاز ثانٍ فاستخدم رمزه. وإلا: راسل support@boekbrug.nl من بريد حسابك — وبعد التحقق نوقف التحقق بخطوتين.',
  },
  'mfa.herstel.titel': { nl: 'Eerst de tweede stap', en: 'The second step first', ar: 'الخطوة الثانية أولًا' },
  'mfa.herstel.uitleg': {
    nl: 'Op dit account staat verificatie in twee stappen aan. Voer eerst de code uit je app in; daarna kun je hier je wachtwoord wijzigen.',
    en: 'This account has two-step verification switched on. Enter the code from your app first; after that you can change your password here.',
    ar: 'هذا الحساب مُفعَّل عليه التحقق بخطوتين. أدخل الرمز من تطبيقك أولاً؛ ثم يمكنك تغيير كلمة المرور هنا.',
  },
  'mfa.uitloggen': { nl: 'Uitloggen', en: 'Sign out', ar: 'تسجيل الخروج' },
  'mfa.nietsTeVerifieren': {
    nl: 'Op dit account staat geen verificatie in twee stappen aan, dus er is hier niets te bevestigen.',
    en: 'This account has no two-step verification switched on, so there is nothing to confirm here.',
    ar: 'لا يوجد تحقق بخطوتين مُفعَّل على هذا الحساب، فليس هنا ما يُؤكَّد.',
  },
  'mfa.verder': { nl: 'Verder', en: 'Continue', ar: 'متابعة' },
  'mfa.fout.lezen': {
    nl: 'We konden dit nu niet lezen. Probeer het zo meteen opnieuw.',
    en: 'We could not read this just now. Try again in a moment.',
    ar: 'تعذّرت قراءة هذا الآن. أعد المحاولة بعد قليل.',
  },
  'mfa.apparaten': { nl: 'Apparaten', en: 'Devices', ar: 'الأجهزة' },
  'mfa.apparaatToevoegen': { nl: 'Tweede apparaat toevoegen', en: 'Add a second device', ar: 'إضافة جهاز ثانٍ' },
  'mfa.apparaatVerwijderen': { nl: 'Verwijderen', en: 'Remove', ar: 'حذف' },
  'mfa.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ التنفيذ…' },

  // ─── [PRIJS-MODUS] Typ je de catalogusprijs inclusief of exclusief btw? ─────────────────────
  //
  // De factuurschermen boden deze keuze al; de catalogus niet. Wie all-in werkt — horeca, retail,
  // een vast tarief "€ 50 all-in" — moest de btw er dus zelf uit rekenen vóór hij een artikel
  // opsloeg, en die deling met de hand is precies waar de centen weglekken.
  //
  // De knop zegt WELKE prijs er in het veld staat, niet wat de app ermee doet. Opgeslagen wordt
  // altijd de prijs excl. btw — zie de kop van price-mode.ts.

  'art.prijsIncl': { nl: 'Prijs (incl. BTW)', en: 'Price (incl. VAT)', ar: 'السعر (شامل الضريبة)' },
  'art.modus.excl': { nl: 'Excl. btw', en: 'Excl. btw', ar: 'بدون الضريبة' },
  'art.modus.incl': { nl: 'Incl. btw', en: 'Incl. btw', ar: 'شامل الضريبة' },
  'art.modus.aria': {
    nl: 'Staat er in het prijsveld een bedrag inclusief of exclusief btw?',
    en: 'Is the price field an amount including or excluding btw?',
    ar: 'هل المبلغ في حقل السعر شامل الضريبة أم دونها؟',
  },
  // De tegenprijs, onder het veld. Wie all-in typt wil de ex-prijs zien die op de factuur belandt,
  // en andersom — dat is het getal waar hij zijn marge tegen afzet.
  'art.tegenprijs.excl': {
    nl: 'Excl. btw: {bedrag}',
    en: 'Excl. btw: {bedrag}',
    ar: 'بدون btw: {bedrag}',
  },
  'art.tegenprijs.incl': {
    nl: 'Incl. btw: {bedrag}',
    en: 'Incl. btw: {bedrag}',
    ar: 'شامل الضريبة: {bedrag}',
  },

  // ─── [KASSA] The counter of a shop without a till ────────────────────────────────────────────
  //
  // Two rules from the head of this file do real work in this block, so they are worth pointing at
  // before anyone adds a key here.
  //
  // A NOUN INSIDE A SENTENCE IS NOT A PARAMETER. "Pin", "Contant" and "Overig" are payment methods
  // that appear both as button labels AND inside sentences ("… is contant betaald"). Every such
  // sentence gets its own key per method rather than one template with {method} substituted, which
  // would break Arabic agreement and Turkish suffix harmony on a screen an owner uses all day.
  //
  // A SENTENCE THAT POINTS AT A BUTTON NAMES THE BUTTON AS IT IS WRITTEN. The conflict notices are
  // written server-side in Dutch (till-day.ts) because they name concrete screens — Kas, Dagomzet —
  // whose navigation labels are still Dutch in every language. Translating the sentence without
  // the label would send the owner hunting for a word that is nowhere in his interface.

  'kassa.titel': { nl: 'Kassa', en: 'Till', ar: 'الكاشير' },
  // The home card. Its sub-line says what the screen DOES, not what it is — a shop owner scanning
  // his home screen is deciding where to tap, not reading a glossary.
  'start.kassa': { nl: 'Kassa', en: 'Till', ar: 'الكاشير' },
  'start.kassa.sub': {
    nl: 'Sla je verkopen aan — met het juiste btw-tarief',
    en: 'Ring up your sales — at the right btw rate',
    ar: 'سجّل مبيعاتك — بنسبة الضريبة الصحيحة',
  },
  'kassa.uitleg': {
    nl: 'Sla hier aan wat je verkoopt. Aan het eind van de dag staat je omzet met het juiste btw-tarief in je boekhouding — zonder kassabon en zonder overtypen.',
    en: 'Ring up what you sell here. At the end of the day your revenue is in your books at the right btw rate — no till receipt, no retyping.',
    ar: 'سجّل هنا ما تبيعه. في نهاية اليوم يكون إيرادك في دفاترك بنسبة الضريبة الصحيحة — بلا إيصال كاشير وبلا إعادة إدخال.',
  },
  'kassa.dagtotaal': { nl: 'Vandaag aangeslagen', en: 'Rung up today', ar: 'المسجَّل اليوم' },
  'kassa.prijslijst': { nl: 'Prijslijst', en: 'Price list', ar: 'قائمة الأسعار' },
  'kassa.prijslijstLeeg': {
    nl: 'Je prijslijst is nog leeg. Zet je diensten er één keer in, dan sla je ze daarna met één tik aan.',
    en: 'Your price list is still empty. Add your services once, then ring them up with a single tap.',
    ar: 'قائمة أسعارك ما زالت فارغة. أدخل خدماتك مرة واحدة، ثم سجّلها بنقرة واحدة.',
  },
  'kassa.prijslijstBeheren': { nl: 'Prijslijst beheren', en: 'Manage price list', ar: 'إدارة قائمة الأسعار' },
  'kassa.bon': { nl: 'Bon', en: 'Ticket', ar: 'إيصال' },
  'kassa.bonLeeg': {
    nl: 'Tik hierboven een dienst aan, of vul een vrij bedrag in.',
    en: 'Tap a service above, or enter a free amount.',
    ar: 'انقر على خدمة في الأعلى، أو أدخل مبلغًا حرًا.',
  },
  'kassa.vrijBedrag': { nl: 'Vrij bedrag', en: 'Free amount', ar: 'مبلغ حر' },
  'kassa.omschrijving': { nl: 'Omschrijving', en: 'Description', ar: 'الوصف' },
  'kassa.bedrag': { nl: 'Bedrag', en: 'Amount', ar: 'المبلغ' },
  'kassa.tarief': { nl: 'Btw-tarief', en: 'Btw rate', ar: 'نسبة btw' },
  'kassa.toevoegen': { nl: 'Op de bon', en: 'Add to ticket', ar: 'إضافة إلى الإيصال' },
  'kassa.regelWeg': { nl: 'Regel weghalen', en: 'Remove line', ar: 'إزالة السطر' },
  'kassa.meer': { nl: 'Eentje erbij', en: 'One more', ar: 'واحد إضافي' },
  'kassa.minder': { nl: 'Eentje eraf', en: 'One fewer', ar: 'واحد أقل' },
  'kassa.totaal': { nl: 'Totaal', en: 'Total', ar: 'الإجمالي' },
  'kassa.hoeBetaald': { nl: 'Hoe is er betaald?', en: 'How was it paid?', ar: 'كيف تم الدفع؟' },
  'kassa.pin': { nl: 'Pin', en: 'Card', ar: 'بطاقة' },
  'kassa.contant': { nl: 'Contant', en: 'Cash', ar: 'نقداً' },
  'kassa.overig': { nl: 'Overig', en: 'Other', ar: 'أخرى' },
  'kassa.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ التنفيذ…' },
  'kassa.verkopenVandaag': { nl: 'Aangeslagen vandaag', en: 'Rung up today', ar: 'المسجَّل اليوم' },
  'kassa.geenVerkopen': {
    nl: 'Nog niets aangeslagen vandaag.',
    en: 'Nothing rung up today yet.',
    ar: 'لم يُسجَّل شيء اليوم بعد.',
  },
  'kassa.terugdraaien': { nl: 'Terugdraaien', en: 'Void', ar: 'التراجع عن العملية' },
  'kassa.terugdraaienVraag': {
    nl: 'Deze bon helemaal terugdraaien?',
    en: 'Void this whole ticket?',
    ar: 'إلغاء هذه الفاتورة بالكامل؟',
  },
  // [KASSA-DIALOOG] Wat er gebeurt, in het scherm van de app zelf. De vraag hierboven stond in een
  // window.confirm: één regel in de chrome van het besturingssysteem, met in een geïnstalleerde PWA
  // de herkomst-URL erboven — precies op het moment dat een geldapp er het minst betrouwbaar uitziet.
  // En een balie-eigenaar tikt dat weg met een klant voor zich. De regels zijn een harde delete
  // (api/till/sale DELETE), dus dit zegt allebei: het verdwijnt, en het staat nog in je logboek.
  'kassa.terugdraaienUitleg': {
    nl: 'De regels gaan uit de omzet van vandaag. Terugdraaien kan niet ongedaan worden gemaakt — wat erop stond blijft wel in je logboek staan.',
    en: 'The lines leave today’s takings. Voiding cannot be undone — what was on the ticket stays in your log.',
    ar: 'ستُزال البنود من إيراد اليوم. لا يمكن التراجع عن الإلغاء — لكن ما كان على الفاتورة يبقى في سجلك.',
  },
  'kassa.terugdraaienKnop': { nl: 'Terugdraaien', en: 'Void ticket', ar: 'التراجع عن العملية' },
  // One sentence per payment method — a noun inside a sentence is not a parameter.
  'kassa.betaaldPin': { nl: 'Met pin betaald', en: 'Paid by card', ar: 'مدفوعة بالبطاقة' },
  'kassa.betaaldContant': { nl: 'Contant betaald', en: 'Paid in cash', ar: 'مدفوعة نقدًا' },
  'kassa.betaaldOverig': { nl: 'Anders betaald', en: 'Paid another way', ar: 'مدفوعة بطريقة أخرى' },
  'kassa.splitPin': { nl: 'Pin', en: 'Card', ar: 'بطاقة' },
  'kassa.splitContant': { nl: 'Contant', en: 'Cash', ar: 'نقدًا' },
  'kassa.splitOverig': { nl: 'Overig', en: 'Other', ar: 'أخرى' },
  'kassa.waaromTarief': {
    nl: 'Het btw-tarief hoort bij de dienst, niet bij de betaling. Daarom staat het op de prijslijst en hoef je het hier niet elke keer te kiezen.',
    en: 'The btw rate belongs to the service, not to the payment. That is why it lives on the price list and you do not choose it every time here.',
    ar: 'نسبة الضريبة تتبع الخدمة لا طريقة الدفع. لذلك تُحفظ في قائمة الأسعار ولا تختارها هنا في كل مرة.',
  },
  'kassa.fout.laden': {
    nl: 'Kon de verkopen van vandaag niet laden.',
    en: 'Could not load today’s sales.',
    ar: 'تعذّر تحميل مبيعات اليوم.',
  },
  'kassa.fout.opslaan': {
    nl: 'Kon de verkoop niet opslaan.',
    en: 'Could not save the sale.',
    ar: 'تعذّر حفظ عملية البيع.',
  },

  // ─── [VAK-BRUG] Filling an empty price list from the owner's trade ───────────────────────────
  // The counter tab. Short because a nav label has ~9 characters before it wraps on a 320px screen.
  // [VAK-BRUG] The trade question, on the company step of the wizard.
  'onb.vak': { nl: 'Wat voor werk doe je?', en: 'What kind of work do you do?', ar: 'ما نوع عملك؟', tr: 'Ne iş yapıyorsun?' },
  'onb.vak.leeg': { nl: 'Kies je vak (mag je overslaan)', en: 'Pick your trade (you may skip this)', ar: 'اختر مهنتك (يمكنك التخطّي)', tr: 'Mesleğini seç (atlayabilirsin)' },
  'onb.vak.uitleg': {
    nl: 'Hiermee zet de app je prijslijst alvast klaar, met het btw-tarief dat bij jouw werk hoort. Je kunt alles later aanpassen.',
    en: 'This lets the app prepare your price list, with the btw rate that belongs to your work. You can change everything later.',
    ar: 'بهذا يجهّز التطبيق قائمة أسعارك، بنسبة ضريبة القيمة المضافة التي تخصّ عملك. ويمكنك تعديل كل شيء لاحقًا.',
  },

  // ─── [VOERTUIG] The cars a garage works on ───────────────────────────────────────────────────
  // [TAAL] 'APK' and 'kenteken' are Dutch domain terms with no English equivalent in this context —
  // AGENTS.md names both explicitly. They stay as they are in every language, exactly like btw.
  'vtg.titel': { nl: 'Voertuigen', en: 'Vehicles', ar: 'المركبات', tr: 'Araçlar' },
  'vtg.uitleg': {
    nl: 'Leg vast welke auto’s je onder handen hebt. Komt de APK-datum in zicht, dan staan ze vanzelf bovenaan — je reden om de klant te bellen.',
    en: 'Record which cars you work on. As the APK date comes into view they move to the top by themselves — your reason to call the customer.',
    ar: 'سجّل السيارات التي تعمل عليها. عند اقتراب تاريخ الـ APK ترتفع إلى الأعلى تلقائيًا — وهو سببك للاتصال بالعميل.',
  },
  'vtg.kenteken': { nl: 'Kenteken', en: 'Kenteken', ar: 'رقم اللوحة', tr: 'Plaka (kenteken)' },
  'vtg.auto': { nl: 'Merk en model', en: 'Make and model', ar: 'الماركة والموديل' },
  'vtg.klant': { nl: 'Klant', en: 'Customer', ar: 'العميل' },
  'vtg.telefoon': { nl: 'Telefoon', en: 'Phone', ar: 'الهاتف' },
  'vtg.apk': { nl: 'APK verloopt op', en: 'APK expires on', ar: 'ينتهي الـ APK في' },
  'vtg.notitie': { nl: 'Notitie', en: 'Note', ar: 'ملاحظة' },
  'vtg.opslaan': { nl: 'Voertuig vastleggen', en: 'Record the vehicle', ar: 'حفظ المركبة' },
  'vtg.toevoegen': { nl: 'Voertuig toevoegen', en: 'Add a vehicle', ar: 'إضافة مركبة' },
  'vtg.leeg': {
    nl: 'Nog geen voertuigen. Voeg de eerste auto toe die je onder handen hebt.',
    en: 'No vehicles yet. Add the first car you are working on.',
    ar: 'لا مركبات بعد. أضف أول سيارة تعمل عليها.',
  },
  'vtg.verwijderen': { nl: 'Verwijderen', en: 'Remove', ar: 'حذف' },
  'vtg.verwijderenVraag': { nl: 'Dit voertuig verwijderen?', en: 'Remove this vehicle?', ar: 'إزالة هذه المركبة؟' },
  // [KASSA-DIALOOG] Zie de uitleg bij kassa.terugdraaienUitleg: dezelfde reden, dezelfde vervanging.
  // Het voertuig draagt de APK-herinnering, en die verdwijnt mee — dat is het gevolg dat niemand
  // opmerkt tot de keuring te laat is.
  'vtg.verwijderenUitleg': {
    nl: 'Het voertuig verdwijnt uit je administratie, samen met de APK-herinnering die eraan hangt.',
    en: 'The vehicle leaves your administration, along with the APK reminder attached to it.',
    ar: 'ستختفي المركبة من إدارتك، ومعها تذكير الـ APK المرتبط بها.',
  },
  // One whole sentence per state — never one template with the state substituted in.
  'vtg.status.expired': { nl: 'APK is verlopen', en: 'The APK has expired', ar: 'انتهى الـ APK' },
  'vtg.status.due': { nl: 'APK verloopt binnenkort', en: 'The APK expires soon', ar: 'ينتهي الـ APK قريبًا' },
  'vtg.status.soon': { nl: 'APK komt in zicht', en: 'The APK is coming up', ar: 'يقترب موعد الـ APK' },
  'vtg.status.ok': { nl: 'APK is nog geldig', en: 'The APK is still valid', ar: 'الـ APK ما زال ساريًا' },
  'vtg.status.unknown': {
    nl: 'APK-datum niet bekend — vul hem in om deze auto op tijd terug te zien',
    en: 'APK date unknown — fill it in to see this car back in time',
    ar: 'تاريخ الـ APK غير معروف — أدخله لترى هذه السيارة في وقتها',
  },
  'vtg.bellen': { nl: 'Deze wil je bellen', en: 'These are worth calling', ar: 'هؤلاء يستحقّون الاتصال' },
  'vtg.fout.laden': { nl: 'Kon de voertuigen niet laden.', en: 'Could not load the vehicles.', ar: 'تعذّر تحميل المركبات.' },
  'vtg.fout.opslaan': { nl: 'Kon het voertuig niet opslaan.', en: 'Could not save the vehicle.', ar: 'تعذّر حفظ المركبة.' },

  'nav.kassa': { nl: 'Kassa', en: 'Till', ar: 'الكاشير', tr: 'Kasa' },
  // [WERK] The trade's own work screen. Dutch is the source; the nouns are the trade's own words.
  'nav.werk': { nl: 'Werk', en: 'Work', ar: 'العمل', tr: 'İş' },
  'werk.titel': { nl: 'Werk', en: 'Work', ar: 'العمل', tr: 'İş' },
  'werk.noun.werkorder': { nl: 'Werkorder', en: 'Work order', ar: 'أمر عمل' },
  'werk.noun.werkorders': { nl: 'Werkorders', en: 'Work orders', ar: 'أوامر العمل' },
  'werk.noun.rit': { nl: 'Rit', en: 'Trip', ar: 'رحلة' },
  'werk.noun.ritten': { nl: 'Ritten', en: 'Trips', ar: 'الرحلات' },
  'werk.noun.klus': { nl: 'Klus', en: 'Job', ar: 'مهمة' },
  'werk.noun.klussen': { nl: 'Klussen', en: 'Jobs', ar: 'المهام' },
  'werk.noun.opdracht': { nl: 'Opdracht', en: 'Assignment', ar: 'طلب' },
  'werk.noun.opdrachten': { nl: 'Opdrachten', en: 'Assignments', ar: 'الطلبات' },
  'werk.uitleg': { nl: '{plural} van vandaag, wie wacht, en wat klaar is voor de factuur.', en: 'Today\'s {plural}, who is waiting, and what is ready to invoice.', ar: '{plural} اليوم، من ينتظر، وما هو جاهز للفاتورة.' },
  'werk.nieuw': { nl: 'Nieuwe {noun}', en: 'New {noun}', ar: '{noun} جديد' },
  'werk.leeg': { nl: 'Nog geen {plural}.', en: 'No {plural} yet.', ar: 'لا {plural} بعد.' },
  'werk.filter.open': { nl: 'Open', en: 'Open', ar: 'مفتوح' },
  'werk.filter.alles': { nl: 'Alles', en: 'All', ar: 'الكل' },
  'werk.klant': { nl: 'Klant', en: 'Customer', ar: 'العميل' },
  'werk.kenteken': { nl: 'Kenteken', en: 'Kenteken', ar: 'رقم اللوحة' },
  'werk.omschrijving': { nl: 'Omschrijving', en: 'Description', ar: 'الوصف' },
  'werk.gepland': { nl: 'Gepland op', en: 'Planned on', ar: 'مخطط في' },
  'werk.notitie': { nl: 'Notitie', en: 'Note', ar: 'ملاحظة' },
  'werk.opslaan': { nl: 'Opslaan', en: 'Save', ar: 'حفظ' },
  'werk.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'werk.sluiten': { nl: 'Sluiten', en: 'Close', ar: 'إغلاق' },
  'werk.status': { nl: 'Status', en: 'Status', ar: 'الحالة' },
  'werk.regels': { nl: 'Regels', en: 'Lines', ar: 'البنود' },
  'werk.regelToevoegen': { nl: 'Regel toevoegen', en: 'Add line', ar: 'إضافة بند' },
  'werk.regel.omschrijving': { nl: 'Omschrijving', en: 'Description', ar: 'الوصف' },
  'werk.regel.aantal': { nl: 'Aantal', en: 'Quantity', ar: 'الكمية' },
  'werk.regel.prijs': { nl: 'Prijs ex btw', en: 'Price ex VAT', ar: 'السعر بدون btw' },
  'werk.regel.btw': { nl: 'btw', en: 'VAT', ar: 'الضريبة' },
  'werk.regel.arbeid': { nl: 'Arbeid', en: 'Labour', ar: 'عمل' },
  'werk.regel.onderdeel': { nl: 'Onderdeel', en: 'Part', ar: 'قطعة' },
  'werk.regel.materiaal': { nl: 'Materiaal', en: 'Material', ar: 'مواد' },
  'werk.regel.meerwerk': { nl: 'Meerwerk', en: 'Extra work', ar: 'عمل إضافي' },
  'werk.regel.ritprijs': { nl: 'Ritprijs', en: 'Trip price', ar: 'سعر الرحلة' },
  'werk.regel.km': { nl: 'Per kilometer', en: 'Per kilometre', ar: 'لكل كيلومتر' },
  'werk.regel.uur': { nl: 'Per uur', en: 'Per hour', ar: 'لكل ساعة' },
  'werk.regel.wachttijd': { nl: 'Wachttijd', en: 'Waiting time', ar: 'وقت انتظار' },
  'werk.regel.extra': { nl: 'Extra', en: 'Extra', ar: 'إضافي' },
  'werk.regel.vast': { nl: 'Vast bedrag', en: 'Fixed amount', ar: 'مبلغ ثابت' },
  'werk.totaal': { nl: 'Totaal ex btw', en: 'Total ex VAT', ar: 'الإجمالي قبل الضريبة' },
  'werk.uren': { nl: 'Uren', en: 'Hours', ar: 'الساعات' },
  'werk.urenKoppelen': { nl: 'Uren koppelen', en: 'Attach hours', ar: 'ربط ساعات' },
  'werk.kosten': { nl: 'Inkoop', en: 'Purchases', ar: 'المشتريات' },
  'werk.kostenKoppelen': { nl: 'Inkoopfactuur koppelen', en: 'Attach purchase invoice', ar: 'ربط فاتورة شراء' },
  'werk.los': { nl: 'Losmaken', en: 'Detach', ar: 'إلغاء الربط' },
  'werk.geenKandidaten': { nl: 'Niets om te koppelen.', en: 'Nothing to attach.', ar: 'لا شيء للربط.' },
  'werk.marge': { nl: 'Marge', en: 'Margin', ar: 'الهامش' },
  'werk.factuurMaken': { nl: 'Maak factuur', en: 'Make invoice', ar: 'إنشاء فاتورة' },
  'werk.factuurBekijken': { nl: 'Factuur bekijken', en: 'View invoice', ar: 'عرض الفاتورة' },
  'werk.factuurKlaar': { nl: 'De factuur staat klaar als concept.', en: 'The invoice is ready as a draft.', ar: 'الفاتورة جاهزة كمسودة.' },
  'werk.urenZonderTarief': { nl: '{n} uur zonder tarief bleef buiten de factuur.', en: '{n} hours without a rate stayed off the invoice.', ar: '{n} ساعة بلا تعرفة بقيت خارج الفاتورة.' },
  'werk.verwijderen': { nl: 'Verwijderen', en: 'Delete', ar: 'حذف' },
  'werk.verwijderenVraag': { nl: 'Dit werk verwijderen?', en: 'Delete this work?', ar: 'حذف هذا العمل؟' },
  'werk.fout.laden': { nl: 'Het werk kon niet worden geladen.', en: 'The work could not be loaded.', ar: 'تعذّر تحميل العمل.' },
  'werk.fout.opslaan': { nl: 'Opslaan is niet gelukt.', en: 'Saving failed.', ar: 'فشل الحفظ.' },
  'werk.fout.factuur': { nl: 'De factuur kon niet worden gemaakt.', en: 'The invoice could not be made.', ar: 'تعذّر إنشاء الفاتورة.' },
  'werk.veld.kmStand': { nl: 'Kilometerstand', en: 'Odometer', ar: 'عداد المسافة' },
  'werk.veld.klacht': { nl: 'Klacht', en: 'Complaint', ar: 'الشكوى' },
  'werk.veld.monteur': { nl: 'Monteur', en: 'Mechanic', ar: 'الميكانيكي' },
  'werk.veld.laadadres': { nl: 'Laadadres', en: 'Pickup address', ar: 'عنوان التحميل' },
  'werk.veld.losadres': { nl: 'Losadres', en: 'Delivery address', ar: 'عنوان التسليم' },
  'werk.veld.referentie': { nl: 'Referentie', en: 'Reference', ar: 'المرجع' },
  'werk.veld.colli': { nl: 'Colli', en: 'Packages', ar: 'الطرود' },
  'werk.veld.gewicht': { nl: 'Gewicht (kg)', en: 'Weight (kg)', ar: 'الوزن (كغ)' },
  'werk.veld.km': { nl: 'Kilometers', en: 'Kilometres', ar: 'الكيلومترات' },
  'werk.veld.chauffeur': { nl: 'Chauffeur', en: 'Driver', ar: 'السائق' },
  'werk.veld.werkadres': { nl: 'Werkadres', en: 'Work address', ar: 'عنوان العمل' },
  'werk.veld.locatie': { nl: 'Locatie', en: 'Location', ar: 'الموقع' },
  'werk.veld.afgesprokenUren': { nl: 'Afgesproken uren', en: 'Agreed hours', ar: 'الساعات المتفق عليها' },
  'werk.veld.medewerker': { nl: 'Medewerker', en: 'Employee', ar: 'الموظف' },
  'werk.status.open': { nl: 'Gepland', en: 'Planned', ar: 'مخطط' },
  'werk.status.bezig': { nl: 'Bezig', en: 'In progress', ar: 'جارٍ' },
  'werk.status.wacht_klant': { nl: 'Wacht op klant', en: 'Waiting for customer', ar: 'بانتظار العميل' },
  'werk.status.wacht_onderdeel': { nl: 'Wacht op onderdelen', en: 'Waiting for parts', ar: 'بانتظار قطع' },
  'werk.status.klaar': { nl: 'Klaar', en: 'Done', ar: 'جاهز' },
  'werk.status.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.geannuleerd': { nl: 'Geannuleerd', en: 'Cancelled', ar: 'ملغى' },
  'werk.status.werkorder.open': { nl: 'Gepland', en: 'Planned', ar: 'مخطط' },
  'werk.status.werkorder.bezig': { nl: 'In behandeling', en: 'In progress', ar: 'قيد المعالجة' },
  'werk.status.werkorder.wacht_onderdeel': { nl: 'Wacht op onderdelen', en: 'Waiting for parts', ar: 'بانتظار قطع' },
  'werk.status.werkorder.wacht_klant': { nl: 'Wacht op klant', en: 'Waiting for customer', ar: 'بانتظار العميل' },
  'werk.status.werkorder.klaar': { nl: 'Gereed', en: 'Ready', ar: 'جاهز' },
  'werk.status.werkorder.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.werkorder.geannuleerd': { nl: 'Geannuleerd', en: 'Cancelled', ar: 'ملغى' },
  'werk.status.rit.open': { nl: 'Gepland', en: 'Planned', ar: 'مخطط' },
  'werk.status.rit.bezig': { nl: 'Onderweg', en: 'On the way', ar: 'في الطريق' },
  'werk.status.rit.klaar': { nl: 'Afgeleverd', en: 'Delivered', ar: 'تم التسليم' },
  'werk.status.rit.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.rit.geannuleerd': { nl: 'Geannuleerd', en: 'Cancelled', ar: 'ملغى' },
  'werk.status.klus.open': { nl: 'Gepland', en: 'Planned', ar: 'مخطط' },
  'werk.status.klus.bezig': { nl: 'Bezig', en: 'In progress', ar: 'جارٍ' },
  'werk.status.klus.wacht_klant': { nl: 'Wacht op klant', en: 'Waiting for customer', ar: 'بانتظار العميل' },
  'werk.status.klus.klaar': { nl: 'Klaar', en: 'Done', ar: 'جاهز' },
  'werk.status.klus.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.klus.geannuleerd': { nl: 'Geannuleerd', en: 'Cancelled', ar: 'ملغى' },
  'werk.status.opdracht.open': { nl: 'Gepland', en: 'Planned', ar: 'مخطط' },
  'werk.status.opdracht.bezig': { nl: 'Bezig', en: 'In progress', ar: 'جارٍ' },
  'werk.status.opdracht.klaar': { nl: 'Uitgevoerd', en: 'Carried out', ar: 'نُفّذ' },
  'werk.status.opdracht.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.opdracht.geannuleerd': { nl: 'Geannuleerd', en: 'Cancelled', ar: 'ملغى' },
  'vandaag.werk.zin': { nl: '{klaar} klaar voor de factuur, {bezig} in behandeling, {wacht} wachten.', en: '{klaar} ready to invoice, {bezig} in progress, {wacht} waiting.', ar: '{klaar} جاهزة للفاتورة، {bezig} قيد المعالجة، {wacht} تنتظر.' },
  'vandaag.werk.niets': { nl: 'Geen open {plural}.', en: 'No open {plural}.', ar: 'لا {plural} مفتوحة.' },
  'vandaag.werk.zinBedrag': { nl: '{klaar} klaar voor de factuur · {bedrag}, {bezig} in behandeling, {wacht} wachten.', en: '{klaar} ready to invoice · {bedrag}, {bezig} in progress, {wacht} waiting.', ar: '{klaar} جاهزة للفاتورة · {bedrag}، {bezig} قيد المعالجة، {wacht} تنتظر.' },
  'vandaag.werk.naar': { nl: 'Naar {plural}', en: 'To {plural}', ar: 'إلى {plural}' },
  // [WERK-2] The fietsenmaker's reparatie, the consultant's opdracht, the courier's ontvanger.
  'werk.noun.reparatie': { nl: 'Reparatie', en: 'Repair', ar: 'تصليح' },
  'werk.noun.reparaties': { nl: 'Reparaties', en: 'Repairs', ar: 'التصليحات' },
  'werk.veld.fiets': { nl: 'Fiets (merk, kleur)', en: 'Bike (brand, colour)', ar: 'الدراجة (الماركة، اللون)' },
  'werk.veld.framenummer': { nl: 'Framenummer', en: 'Frame number', ar: 'رقم الهيكل' },
  'werk.veld.ontvanger': { nl: 'Ontvangen door', en: 'Received by', ar: 'استلمها' },
  'werk.regel.reiskosten': { nl: 'Reiskosten', en: 'Travel costs', ar: 'مصاريف السفر' },
  'werk.status.reparatie.open': { nl: 'Ingenomen', en: 'Taken in', ar: 'مستلَمة' },
  'werk.status.reparatie.bezig': { nl: 'In reparatie', en: 'Being repaired', ar: 'قيد التصليح' },
  'werk.status.reparatie.wacht_onderdeel': { nl: 'Wacht op onderdelen', en: 'Waiting for parts', ar: 'بانتظار قطع' },
  'werk.status.reparatie.wacht_klant': { nl: 'Wacht op klant', en: 'Waiting for customer', ar: 'بانتظار العميل' },
  'werk.status.reparatie.klaar': { nl: 'Klaar voor ophalen', en: 'Ready for pickup', ar: 'جاهزة للاستلام' },
  'werk.status.reparatie.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.reparatie.geannuleerd': { nl: 'Geannuleerd', en: 'Cancelled', ar: 'ملغى' },
  // [WERK-BEURT] Repeating work and its beurten.
  'werk.herhaal': { nl: 'Herhaalt', en: 'Repeats', ar: 'يتكرر' },
  'werk.herhaal.geen': { nl: 'Eenmalig', en: 'Once', ar: 'مرة واحدة' },
  'werk.herhaal.week': { nl: 'Elke week', en: 'Every week', ar: 'كل أسبوع' },
  'werk.herhaal.tweeWeken': { nl: 'Elke twee weken', en: 'Every two weeks', ar: 'كل أسبوعين' },
  'werk.herhaal.vierWeken': { nl: 'Elke vier weken', en: 'Every four weeks', ar: 'كل أربعة أسابيع' },
  'werk.herhaal.maand': { nl: 'Elke maand', en: 'Every month', ar: 'كل شهر' },
  'werk.beurten': { nl: 'Beurten', en: 'Visits', ar: 'الزيارات' },
  'werk.beurtGedaan': { nl: 'Beurt gedaan', en: 'Visit done', ar: 'تمت الزيارة' },
  'werk.beurtNotitie': { nl: 'Notitie (optioneel)', en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  'werk.geenBeurten': { nl: 'Nog geen beurten.', en: 'No visits yet.', ar: 'لا زيارات بعد.' },
  'werk.volgende': { nl: 'Volgende', en: 'Next', ar: 'التالي' },
  'werk.beurtenOpen': { nl: '{n} beurten nog te factureren', en: '{n} visits still to invoice', ar: '{n} زيارات لم تُفوتر بعد' },
  'werk.beurtFactuur': { nl: 'Factureer {n} beurten', en: 'Invoice {n} visits', ar: 'فوتر {n} زيارات' },
  // [WERK-VERZAMEL] One invoice for several finished pieces of work of one client.
  'werk.verzamel': { nl: 'Verzamelfactuur', en: 'Combined invoice', ar: 'فاتورة مجمّعة' },
  'werk.verzamelKnop': { nl: 'Verzamelfactuur · {client} · {n} stuks', en: 'Combined invoice · {client} · {n} items', ar: 'فاتورة مجمّعة · {client} · {n} بنود' },
  'werk.verzamelVraag': { nl: 'Eén factuur voor {n} stuks werk van {client}?', en: 'One invoice for {n} pieces of work for {client}?', ar: 'فاتورة واحدة لـ {n} أعمال للعميل {client}؟' },
  // [WERK-BON] A bon or photo from inside the work.
  'werk.bestanden': { nl: 'Bestanden', en: 'Files', ar: 'الملفات' },
  'werk.bon': { nl: 'Bon of foto toevoegen', en: 'Add receipt or photo', ar: 'أضف إيصالاً أو صورة' },
  'werk.bonKosten': { nl: 'De bon staat als inkoop op dit werk.', en: 'The receipt is on this work as a purchase.', ar: 'الإيصال مسجّل كمشتريات على هذا العمل.' },
  'werk.bonBestand': { nl: 'Het bestand staat bij dit werk.', en: 'The file is attached to this work.', ar: 'الملف مرفق بهذا العمل.' },
  'werk.bonNietGekoppeld': { nl: 'Het bestand is opgeslagen, maar niet aan dit werk gekoppeld.', en: 'The file was saved but not attached to this work.', ar: 'حُفظ الملف لكنه لم يُربط بهذا العمل.' },
  // [WERK-3] After the adversarial review and the market check: the daily basics per trade.
  'werk.veld.telefoon': { nl: 'Telefoon klant', en: 'Customer phone', ar: 'هاتف الزبون' },
  'werk.veld.laadtijd': { nl: 'Laadtijd', en: 'Pickup time', ar: 'وقت التحميل' },
  'werk.veld.lostijd': { nl: 'Lostijd', en: 'Delivery time', ar: 'وقت التسليم' },
  'werk.regel.personen': { nl: 'Personenvervoer (9%)', en: 'Passenger transport (9%)', ar: 'نقل ركاب (9%)' },
  'werk.regel.voorrijkosten': { nl: 'Voorrijkosten', en: 'Call-out charge', ar: 'رسوم الانتقال' },
  'werk.regel.afvoer': { nl: 'Afvoer groenafval', en: 'Green waste removal', ar: 'إزالة النفايات الخضراء' },
  'werk.herhaal.kwartaal': { nl: 'Elk kwartaal', en: 'Every quarter', ar: 'كل ربع سنة' },
  'werk.fout.klant': { nl: 'Zet een klant op dit werk.', en: 'Put a customer on this work.', ar: 'حدّد عميلًا لهذا العمل.' },
  'werk.nietsGekoppeld': { nl: 'Er is niets gekoppeld; het stond al ergens anders op.', en: 'Nothing was attached; it was already on something else.', ar: 'لم يُربط شيء؛ كان مربوطًا بشيء آخر.' },
  'werk.gegevensAanpassen': { nl: 'Gegevens aanpassen', en: 'Edit details', ar: 'تعديل البيانات' },
  'werk.filter.vandaag': { nl: 'Vandaag', en: 'Today', ar: 'اليوم' },
  'werk.filter.week': { nl: 'Deze week', en: 'This week', ar: 'هذا الأسبوع' },
  'werk.zoeken': { nl: 'Zoeken op naam, klant of kenteken', en: 'Search by name, customer or plate', ar: 'ابحث بالاسم أو العميل أو اللوحة' },
  // [WERK-STAND] The Werk screen opens on the money, not on the list.
  'werk.stand.kop': { nl: 'Wat laat jij liggen?', en: 'What are you leaving on the table?', ar: 'ما الذي تتركه دون تحصيل؟' },
  'werk.stand.klaar': { nl: '{n} klaar voor de factuur · {bedrag}', en: '{n} ready to invoice · {bedrag}', ar: '{n} جاهز للفوترة · {bedrag}' },
  'werk.stand.klaarEen': { nl: '1 klaar voor de factuur · {bedrag}', en: '1 ready to invoice · {bedrag}', ar: 'واحد جاهز للفوترة · {bedrag}' },
  'werk.stand.niets': { nl: 'Niets blijft liggen.', en: 'Nothing is left on the table.', ar: 'لا شيء متروك.' },
  'werk.stand.onbekend': { nl: 'De stand kon niet worden gelezen.', en: 'The position could not be read.', ar: 'تعذّرت قراءة الوضع.' },
  'werk.meer': { nl: 'Meer velden', en: 'More fields', ar: 'حقول أكثر' },
  'werk.budget': { nl: '{spent} van {agreed} afgesproken uren', en: '{spent} of {agreed} agreed hours', ar: '{spent} من {agreed} ساعة متفق عليها' },
  'werk.geschiedenis': { nl: 'Eerder aan deze auto', en: 'Earlier on this car', ar: 'سابقًا على هذه السيارة' },
  'werk.bellen': { nl: 'Bellen', en: 'Call', ar: 'اتصال' },
  'werk.klaarBericht': { nl: 'Klant: staat klaar', en: 'Customer: it is ready', ar: 'الزبون: جاهز' },
  'werk.uren.aantal': { nl: 'Uren', en: 'Hours', ar: 'الساعات' },
  'werk.uren.tarief': { nl: 'Tarief', en: 'Rate', ar: 'التعرفة' },
  'werk.uren.omschrijving': { nl: 'Wat is er gedaan', en: 'What was done', ar: 'ما الذي أُنجز' },
  'werk.uren.opslaan': { nl: 'Uren opschrijven', en: 'Write hours', ar: 'تسجيل الساعات' },
  'werk.vorigeZoeken': { nl: 'Regels van vorige keer', en: 'Lines from last time', ar: 'بنود المرة السابقة' },
  // [OFFERTE-WERK] The accepted offerte becomes the work.
  'werk.offerte.kies': { nl: 'Uit offerte', en: 'From a quote', ar: 'من عرض سعر' },
  'werk.offerte.geen': { nl: 'Geen', en: 'None', ar: 'لا شيء' },
  'werk.offerte.uitleg': { nl: 'De regels en het afgesproken bedrag komen mee. De offerte gaat naar het archief.', en: 'The lines and the agreed amount come along. The quote moves to the archive.', ar: 'السطور والمبلغ المتفق عليه تأتي معه. ينتقل العرض إلى الأرشيف.' },
  'werk.offerte.akkoord': { nl: 'akkoord', en: 'accepted', ar: 'مقبول' },
  'werk.offerte.uit': { nl: 'Uit offerte {nummer}', en: 'From quote {nummer}', ar: 'من عرض السعر {nummer}' },
  'werk.vorigeRegels': { nl: 'Neem {n} regels over', en: 'Take over {n} lines', ar: 'إضافة {n} بنداً' },
  // [RIJSCHOOL] One leerling in training; every les a beurt in the trade's own word.
  'werk.noun.leerling': { nl: 'Leerling', en: 'Learner', ar: 'متدرّب' },
  'werk.noun.leerlingen': { nl: 'Leerlingen', en: 'Learners', ar: 'المتدربون' },
  'werk.status.les.open': { nl: 'Aangemeld', en: 'Registered', ar: 'مسجَّل' },
  'werk.status.les.bezig': { nl: 'In opleiding', en: 'In training', ar: 'قيد التدريب' },
  'werk.status.les.wacht_klant': { nl: 'Wacht op examen', en: 'Waiting for exam', ar: 'بانتظار الامتحان' },
  'werk.status.les.klaar': { nl: 'Afgerond', en: 'Completed', ar: 'مكتمل' },
  'werk.status.les.gefactureerd': { nl: 'Gefactureerd', en: 'Invoiced', ar: 'مفوتر' },
  'werk.status.les.geannuleerd': { nl: 'Gestopt', en: 'Stopped', ar: 'توقف' },
  'werk.veld.instructeur': { nl: 'Instructeur', en: 'Instructor', ar: 'المدرّب' },
  'werk.veld.lespakket': { nl: 'Lespakket', en: 'Lesson package', ar: 'باقة الدروس' },
  'werk.veld.examenDatum': { nl: 'Examendatum', en: 'Exam date', ar: 'تاريخ الامتحان' },
  'werk.regel.les': { nl: 'Rijles', en: 'Driving lesson', ar: 'درس قيادة' },
  'werk.regel.pakket': { nl: 'Lespakket', en: 'Lesson package', ar: 'باقة الدروس' },
  'werk.regel.examen': { nl: 'Examen', en: 'Exam', ar: 'امتحان' },
  'werk.les.lessen': { nl: 'Lessen', en: 'Lessons', ar: 'الدروس' },
  'werk.les.lesGedaan': { nl: 'Les gegeven', en: 'Lesson given', ar: 'أُعطي الدرس' },
  'werk.les.lesFactuur': { nl: 'Factureer {n} lessen', en: 'Invoice {n} lessons', ar: 'فوتر {n} دروس' },
  'werk.les.lessenOpen': { nl: '{n} lessen nog te factureren', en: '{n} lessons still to invoice', ar: '{n} دروس لم تُفوتر بعد' },
  // [WERK-4] Financieel gereed, the trust of a margin, begroot against werkelijk, and the signals.
  'werk.veld.begroot': { nl: 'Begroot / prijsafspraak ex btw', en: 'Estimate / agreed price ex VAT', ar: 'المقدَّر / السعر المتفق عليه قبل ضريبة القيمة المضافة' },
  'werk.gereed.bedrag': { nl: 'Klaar voor de factuur · {bedrag}', en: 'Ready for the invoice · {bedrag}', ar: 'جاهز للفاتورة · {bedrag}' },
  'werk.gereed.niet': { nl: 'Nog niet klaar voor de factuur', en: 'Not ready for the invoice yet', ar: 'ليس جاهزًا للفاتورة بعد' },
  'werk.gereed.klant': { nl: 'Klant bekend', en: 'Customer known', ar: 'الزبون معروف' },
  'werk.gereed.regels': { nl: 'Iets om te factureren', en: 'Something to invoice', ar: 'شيء للفوترة' },
  'werk.gereed.urenTarief': { nl: 'Elk uur heeft een tarief', en: 'Every hour has a rate', ar: 'لكل ساعة تعرفة' },
  'werk.gereed.status': { nl: 'Werk is klaar', en: 'Work is done', ar: 'العمل منتهٍ' },
  'werk.marge.werkelijk': { nl: 'werkelijk', en: 'actual', ar: 'فعلي' },
  'werk.marge.geschat': { nl: 'geschat, nog geen kosten', en: 'estimated, no costs yet', ar: 'تقديري، بلا تكاليف بعد' },
  'werk.marge.incompleet': { nl: 'nog niet compleet', en: 'not complete yet', ar: 'غير مكتمل بعد' },
  'werk.begroot': { nl: 'Begroot {begroot} · werkelijk {actual}', en: 'Estimated {begroot} · actual {actual}', ar: 'المقدَّر {begroot} · الفعلي {actual}' },
  'vandaag.werk.sig.meerwerk': { nl: '{n} stuks werk met {bedrag} meerwerk nog niet gefactureerd.', en: '{n} pieces of work with {bedrag} extra work not invoiced yet.', ar: '{n} أعمال فيها {bedrag} عمل إضافي لم يُفوتر بعد.' },
  'vandaag.werk.sig.urenZonderTarief': { nl: '{n} uur op werk zonder tarief valt straks buiten de factuur.', en: '{n} hours on work without a rate will fall off the invoice.', ar: '{n} ساعة على عمل بلا تعرفة ستسقط من الفاتورة.' },
  'vandaag.werk.sig.kosten': { nl: '{n} bonnen ({bedrag}) van bekende leveranciers hangen aan geen werk.', en: '{n} receipts ({bedrag}) from known suppliers are attached to no work.', ar: '{n} إيصالات ({bedrag}) من مورّدين معروفين غير مرتبطة بأي عمل.' },
  'vandaag.werk.sig.begroting': { nl: '{n} stuks werk boven de begroting.', en: '{n} pieces of work over their estimate.', ar: '{n} أعمال تجاوزت المقدَّر.' },
  // [CONTRACT] A contract on a location: the fixed fee, its end, and the portfolio.
  'werk.veld.maandbedrag': { nl: 'Vast bedrag per maand ex btw', en: 'Fixed amount per month ex VAT', ar: 'مبلغ ثابت شهريًا قبل ضريبة القيمة المضافة' },
  // [STRIPPENKAART] Hours sold up front, drawn down by the work on this opdracht.
  'werk.veld.bundelUren': { nl: 'Strippenkaart (uren)', en: 'Prepaid hours', ar: 'بطاقة ساعات مدفوعة' },
  'werk.bundel.kop': { nl: 'Strippenkaart', en: 'Prepaid hours', ar: 'بطاقة الساعات' },
  'werk.bundel.stand': { nl: '{gebruikt} van {verkocht} uur gebruikt · {over} over', en: '{gebruikt} of {verkocht} hours used · {over} left', ar: 'استُخدمت {gebruikt} من {verkocht} ساعة · بقي {over}' },
  'werk.bundel.op': { nl: 'De strippenkaart is op: {over} uur meer gewerkt dan verkocht.', en: 'The bundle is used up: {over} hours more than sold.', ar: 'انتهت البطاقة: {over} ساعة أكثر مما بيع.' },
  'werk.bundel.nogNietGefactureerd': { nl: 'Nog niet gefactureerd', en: 'Not invoiced yet', ar: 'لم تُفوتر بعد' },
  'werk.bundel.gefactureerd': { nl: 'Vooraf gefactureerd', en: 'Invoiced up front', ar: 'فوترت مقدّمًا' },
  'werk.veld.einddatum': { nl: 'Einddatum contract', en: 'Contract end date', ar: 'تاريخ انتهاء العقد' },
  'werk.filter.contracten': { nl: 'Contracten', en: 'Contracts', ar: 'العقود' },
  'werk.contract.geen': { nl: 'Nog geen contracten.', en: 'No contracts yet.', ar: 'لا عقود بعد.' },
  'werk.contract.leesfout': { nl: 'Een deel van de cijfers kon niet worden gelezen.', en: 'Part of the figures could not be read.', ar: 'تعذّرت قراءة جزء من الأرقام.' },
  'werk.contract.perMaand': { nl: 'per maand', en: 'per month', ar: 'شهرياً' },
  'werk.contract.perBeurt': { nl: 'Per beurt', en: 'Per visit', ar: 'لكل زيارة' },
  'werk.contract.loopAf': { nl: 'loopt af over {n} dagen', en: 'ends in {n} days', ar: 'ينتهي بعد {n} يوماً' },
  'werk.contract.afgelopen': { nl: 'afgelopen', en: 'ended', ar: 'انتهى' },
  'werk.contract.goed': { nl: 'Goed', en: 'Good', ar: 'جيد' },
  'werk.contract.aandacht': { nl: 'Aandacht', en: 'Attention', ar: 'انتباه' },
  'werk.contract.omzetMaand': { nl: 'Omzet deze maand', en: 'Revenue this month', ar: 'إيراد هذا الشهر' },
  'werk.contract.urenMaand': { nl: '{spent} van {agreed} uur deze maand', en: '{spent} of {agreed} hours this month', ar: '{spent} من {agreed} ساعة هذا الشهر' },
  'werk.contract.periodeGefactureerd': { nl: '{periode} gefactureerd', en: '{periode} invoiced', ar: 'فُوترت {periode}' },
  'werk.periodeFactuur': { nl: 'Factureer {periode}', en: 'Invoice {periode}', ar: 'إصدار فاتورة عن {periode}' },
  'vandaag.werk.sig.contractEinde': { nl: '{n} contracten lopen binnen 60 dagen af.', en: '{n} contracts end within 60 days.', ar: '{n} عقود تنتهي خلال 60 يوماً.' },
  // [VAK-KIEZEN] The trade, chosen from settings.
  'vandaag.werk.sig.strippenkaartOp': { nl: '{n} strippenkaarten zijn op: {uren} uur meer gewerkt dan verkocht.', en: '{n} prepaid bundles are used up: {uren} hours more than sold.', ar: '{n} بطاقات ساعات انتهت: {uren} ساعة أكثر مما بيع.' },
  'vandaag.werk.sig.urenOud': { nl: '{bedrag} aan gewerkte uren staat na {dagen} dagen nog op geen factuur.', en: '{bedrag} of worked hours is still on no invoice after {dagen} days.', ar: '{bedrag} من ساعات العمل ما زالت بلا فاتورة بعد {dagen} يومًا.' },
  'inst.vak.kop': { nl: 'Mijn vak', en: 'My trade', ar: 'مهنتي' },
  'inst.vak.uitleg': { nl: 'Kies je vak en de app zet jouw werk voorop: werkorders, ritten, klussen of opdrachten.', en: 'Pick your trade and the app puts your work first: work orders, trips, jobs or assignments.', ar: 'اختر مهنتك فيضع التطبيق عملك في المقدمة: أوامر عمل أو رحلات أو مهام أو طلبات.' },
  'inst.vak.geen': { nl: 'Geen vak gekozen', en: 'No trade chosen', ar: 'لم تُختر مهنة' },
  'inst.vak.werklaag': { nl: 'Je ziet nu {plural} als tweede knop onderin.', en: 'You now see {plural} as the second button at the bottom.', ar: 'ترى الآن {plural} كزر ثانٍ في الأسفل.' },
  'inst.vak.opgeslagen': { nl: 'Opgeslagen.', en: 'Saved.', ar: 'تم الحفظ.' },
  'inst.vak.mislukt': { nl: 'Opslaan is niet gelukt. Probeer het opnieuw.', en: 'Saving failed. Try again.', ar: 'فشل الحفظ. حاول مرة أخرى.' },

  'vak.titel': { nl: 'Begin met de regels van jouw vak', en: 'Start from your trade’s lines', ar: 'ابدأ من بنود مهنتك' },
  'vak.uitleg': {
    nl: 'Kies je vak en vul in wat jij rekent — je prijslijst staat er. Het btw-tarief staat er al bij; daar gaat het het vaakst mis.',
    en: 'Pick your trade and fill in what you charge — your price list is there. The btw rate is already set; that is where it most often goes wrong.',
    ar: 'اختر مهنتك واملأ ما تتقاضاه — فتجهز قائمة أسعارك. نسبة ضريبة القيمة المضافة مضبوطة سلفًا؛ وهناك يخطئ الناس أكثر.',
  },
  'vak.kies': { nl: 'Wat is je vak?', en: 'What is your trade?', ar: 'ما مهنتك؟' },
  'vak.prijsKop': { nl: 'Wat reken jij?', en: 'What do you charge?', ar: 'كم تتقاضى؟' },
  'vak.prijsUitleg': {
    nl: 'Laat leeg wat je niet aanbiedt — die regel wordt niet gemaakt. Je kunt alles later nog aanpassen.',
    en: 'Leave blank what you do not offer — that line is not created. You can change everything later.',
    ar: 'اترك ما لا تقدّمه فارغًا — لن يُنشأ ذلك السطر. ويمكنك تعديل كل شيء لاحقًا.',
  },
  'vak.opslaan': { nl: 'Prijslijst maken', en: 'Create the price list', ar: 'إنشاء قائمة الأسعار' },
  'vak.klaar': { nl: 'Je prijslijst staat er. Op de Kassa sla je hem nu met één tik aan.', en: 'Your price list is there. On the Kassa you now ring it up with one tap.', ar: 'قائمة أسعارك جاهزة. تسجّلها الآن على الكاشير بنقرة واحدة.' },
  'vak.letOpKop': { nl: 'Let op bij dit vak', en: 'Watch out in this trade', ar: 'انتبه في هذه المهنة' },
  'vak.fout.opslaan': { nl: 'Kon de prijslijst niet maken.', en: 'Could not create the price list.', ar: 'تعذّر إنشاء قائمة الأسعار.' },
  'vak.fout.leeg': { nl: 'Vul minstens één prijs in.', en: 'Fill in at least one price.', ar: 'املأ سعرًا واحدًا على الأقل.' },

  // ─── [KASSA] A whole day typed by hand, on the Dagomzet screen ───────────────────────────────
  'dzh.titel': { nl: 'Dag zelf invullen', en: 'Enter a day yourself', ar: 'أدخل اليوم بنفسك' },
  'dzh.uitleg': {
    nl: 'Geen kassa-rapport? Vul dan zelf in wat je die dag omzette. Het btw-tarief kun je nergens anders kwijt — zonder tarief blokkeert je btw-aangifte.',
    en: 'No till report? Then enter what you took that day yourself. The btw rate you can record nowhere else — without it your btw return is blocked.',
    ar: 'لا يوجد تقرير كاشير؟ أدخل بنفسك ما حقّقته ذلك اليوم. لا يمكن تسجيل نسبة الضريبة في مكان آخر — وبدونها يُحجب إقرار ضريبة القيمة المضافة.',
  },
  'dzh.datum': { nl: 'Welke dag', en: 'Which day', ar: 'أي يوم' },
  'dzh.omzetKop': { nl: 'Omzet, inclusief btw', en: 'Revenue, including btw', ar: 'الإيراد شامل btw' },
  'dzh.omzet21': { nl: 'Tegen 21%', en: 'At 21%', ar: 'بنسبة 21%' },
  'dzh.omzet9': { nl: 'Tegen 9%', en: 'At 9%', ar: 'بنسبة 9%' },
  'dzh.omzet0': { nl: 'Tegen 0%', en: 'At 0%', ar: 'بنسبة 0%' },
  // [DAG-UIT-DE-BANK] The bank already describes this day's card payouts. Offered, never written:
  // the owner presses it, because only they know the cash and the rate split.
  'dzh.bank.suggestie': {
    nl: 'Je bank noemt voor deze dag {bedrag} aan pinomzet ({regels} afrekeningen).',
    ar: 'يذكر بنكك لهذا اليوم {bedrag} من مبيعات البطاقة ({regels} تسويات).',
    en: 'Your bank reports {bedrag} of card takings for this day ({regels} settlements).',
  },
  'dzh.bank.overnemen': {
    nl: 'Overnemen',
    ar: 'اعتماد المبلغ',
    en: 'Use this amount',
  },
  'dzh.bank.onvolledig': {
    nl: 'Er staan ook creditcard-afrekeningen die een week noemen in plaats van een dag ({bedrag}). Die zitten hier NIET bij, dus dit bedrag is een ondergrens.',
    ar: 'توجد أيضًا تسويات بطاقات ائتمان تذكر أسبوعًا لا يومًا ({bedrag}). ليست محتسبة هنا، فهذا المبلغ حدّ أدنى.',
    en: 'There are also credit-card settlements naming a week rather than a day ({bedrag}). Those are NOT included, so this amount is a floor.',
  },
  'dzh.betaaldKop': { nl: 'Hoe er betaald is', en: 'How it was paid', ar: 'كيف تم الدفع' },
  'dzh.totaalOmzet': { nl: 'Omzet bij elkaar', en: 'Revenue together', ar: 'مجموع الإيراد' },
  'dzh.totaalBetaald': { nl: 'Betaald bij elkaar', en: 'Paid together', ar: 'مجموع المدفوع' },
  'dzh.moetGelijk': {
    nl: 'Deze twee moeten gelijk zijn — ze beschrijven dezelfde dag.',
    en: 'These two must match — they describe the same day.',
    ar: 'يجب أن يتساوى الرقمان — فهما يصفان اليوم نفسه.',
  },
  'dzh.opslaan': { nl: 'Dag vastleggen', en: 'Record the day', ar: 'إقفال اليوم' },
  'dzh.klaar': {
    nl: 'De dag staat in je omzet, met het btw-tarief erbij.',
    en: 'The day is in your revenue, with its btw rate.',
    ar: 'اليوم مُسجَّل في إيرادك، ومعه نسبة الضريبة.',
  },
  'dzh.fout.opslaan': {
    nl: 'Kon de dagomzet niet opslaan.',
    en: 'Could not save the day’s revenue.',
    ar: 'تعذّر حفظ إيراد اليوم.',
  },

  // ─── [BEWIJS-BEANTWOORDEN] Het antwoord op de vraag die het bewijspaneel stelt ───────────────
  //
  // Het paneel vroeg "Klopt het dat deze factuur nog openstaat?" en bood niets om dat mee te
  // beantwoorden. Wie het één keer had nagekeken, kreeg dezelfde vraag elke keer opnieuw. Een
  // vraag zonder antwoord leert de ondernemer om over het paneel heen te lezen — en dit paneel is
  // juist de ene plek in de app die zijn werk laat zien.
  //
  // De knop zegt het ANTWOORD, niet de handeling. "Sluiten" laat in het midden wat er is
  // vastgesteld; "Ja, staat nog open" is wat de ondernemer heeft nagekeken, en dat is ook precies
  // waarvoor de vraag hem bedankt door hem niet meer te stellen.

  'bewijs.ack.knop': {
    nl: 'Ja, staat nog open',
    en: 'Yes, still open',
    ar: 'نعم، ما زالت مستحقّة',
  },
  'bewijs.bank.knop': {
    nl: 'Bekijk in bank',
    en: 'View in bank',
    ar: 'عرض في البنك',
  },
  'bewijs.ack.knopAria': {
    nl: 'Deze vraag is beantwoord — niet meer tonen',
    en: 'This question is answered — stop showing it',
    ar: 'أُجيب عن هذا السؤال — لا تعرضه مرة أخرى',
  },
  // Wat er is weggelegd, staat er. Dat een rij WEG is mag nooit zelf ook verdwijnen.
  'bewijs.ack.verborgen.een': {
    nl: '1 eerdere vraag heb je al beantwoord.',
    en: 'You already answered 1 earlier question.',
    ar: 'أجبت بالفعل عن سؤال واحد سابق.',
  },
  'bewijs.ack.verborgen.meer': {
    nl: '{count} eerdere vragen heb je al beantwoord.',
    en: 'You already answered {count} earlier questions.',
    ar: 'أجبت بالفعل عن {count} أسئلة سابقة.',
  },
  'bewijs.ack.toonWeer': {
    nl: 'Toon ze weer',
    en: 'Show them again',
    ar: 'أظهرها مجددًا',
  },
  // Waarom een beantwoorde vraag tóch terug kan komen. Zonder deze zin lijkt hij weg te zijn
  // gebleven en dan is een nieuwe betaling die er wél bij past een verrassing.
  'bewijs.ack.uitleg': {
    nl: 'Komt er later een andere betaling die bij deze factuur past, dan vragen we het opnieuw.',
    en: 'If a different payment turns up later that fits this invoice, we will ask again.',
    ar: 'إن ظهرت لاحقًا دفعة أخرى تطابق هذه الفاتورة، فسنسأل من جديد.',
  },

  // ─── [UREN] De gewerkte uren, en wat ervan nog te factureren valt ────────────────────────────
  //
  // Elke zin hier gaat over geld dat nog niet gefactureerd is, en dat is de reden dat dit scherm
  // bestaat: overtikken uit een schrift lekt maar één kant op. Waar een bedrag onvolledig is,
  // zegt de tekst dat — een totaal dat stil een uur zonder tarief weglaat is een getal dat de
  // ondernemer niet kan narekenen tegen de lijst ernaast.

  // [URENCRITERIUM] Het urencriterium terwijl er nog iets aan te doen is. Elke stand heeft een
  // EIGEN zin: "Een {woord} haal je niet" werkt in het Nederlands en breekt Arabische congruentie
  // en Turkse klinkerharmonie. Getallen zijn wél parameters — die verbuigen niet.
  // [ZOEK-EERLIJK] Elke bron neemt de N NIEUWSTE treffers en rangschikt pas daarna op relevantie.
  // Een match van twee jaar terug haalt de rangschikking dus niet eens, en het scherm presenteerde
  // de overlevenden als "alles". Dat is het enige wat een zoekfunctie niet mag doen: wie een
  // leverancier zoekt die hij jaren gebruikt en acht facturen ziet, concludeert dat het er acht zijn.
  'ink.zoek.nietHier': {
    nl: 'Deze factuur staat niet meer op dit scherm — hij is waarschijnlijk al bevestigd. Kijk bij Bevestigde inkoopfacturen.',
    en: 'This invoice is no longer on this screen — it has probably been confirmed already. Look under confirmed purchase invoices.',
    ar: 'لم تعد هذه الفاتورة على هذه الشاشة — على الأرجح جرى تأكيدها. راجع فواتير الشراء المؤكَّدة.',
  },
  // [ZOEK-BEGRIJPT] Wat de zoekfunctie uit de vraag heeft BEGREPEN, als chips die je weg kunt tikken.
  // Zonder deze regel verdwijnen er resultaten en zegt niets waarom — dat is erger dan een zoekterm
  // die genegeerd wordt.
  'zoek.begrepen': {
    nl: 'Begrepen als:',
    en: 'Understood as:',
    ar: 'فُهم على أنه:',
  },
  'zoek.begrepen.weg': {
    nl: 'Verwijder {filter}',
    en: 'Remove {filter}',
    ar: 'إزالة {filter}',
  },
  'zoek.afgekapt': {
    nl: 'Er zijn meer resultaten dan hier passen. Zoek specifieker — met een factuurnummer, een bedrag of een deel van de naam.',
    en: 'There are more results than fit here. Search more specifically — an invoice number, an amount, or part of the name.',
    ar: 'النتائج أكثر مما يتّسع هنا. ابحث بصورة أدق — برقم فاتورة أو مبلغ أو جزء من الاسم.',
  },
  'uren.criterium.titel': { nl: 'Urencriterium', en: 'Hour criterion', ar: 'معيار الساعات' },
  'uren.criterium.voortgang': {
    nl: '{uren} van de 1.225 uur geregistreerd in {jaar}',
    en: '{uren} of the 1,225 hours registered in {jaar}',
    ar: 'تم تسجيل {uren} من أصل 1.225 ساعة في {jaar}',
  },
  'uren.criterium.onbekend': {
    nl: 'We konden je uren nu niet lezen — het urencriterium is niet beoordeeld.',
    en: 'We could not read your hours just now — the hour criterion has not been assessed.',
    ar: 'تعذّرت قراءة ساعاتك الآن — لم يُقيَّم معيار الساعات.',
  },
  'uren.criterium.gehaald': {
    nl: 'Je hebt het urencriterium gehaald. Blijf je uren gewoon bijhouden — de Belastingdienst mag erom vragen.',
    en: 'You have met the hour criterion. Keep registering your hours — the Belastingdienst may ask to see them.',
    ar: 'لقد استوفيت معيار الساعات. واصل تسجيل ساعاتك — قد تطلبها مصلحة الضرائب.',
  },
  'uren.criterium.tevroeg': {
    nl: 'Het jaar is nog te jong om te zeggen waar dit uitkomt. Vanaf hier is dat gemiddeld {perweek} uur per week.',
    en: 'The year is too young to say where this lands. From here that is {perweek} hours a week on average.',
    ar: 'ما زال العام في بدايته لتحديد النتيجة. من الآن فصاعدًا يعني ذلك {perweek} ساعة أسبوعيًا في المتوسط.',
  },
  'uren.criterium.opkoers': {
    nl: 'Op dit tempo kom je dit jaar uit op ongeveer {verwacht} uur. Dat is boven de 1.225.',
    en: 'At this pace you will reach about {verwacht} hours this year. That is above the 1,225.',
    ar: 'بهذه الوتيرة ستصل إلى نحو {verwacht} ساعة هذا العام، أي فوق 1.225.',
  },
  // [NIET-BIJGEHOUDEN] Geen oordeel, want er valt niets te oordelen. En géén aansporing om het hier
  // te gaan doen: veel ondernemers houden hun uren ergens anders bij, en dat is prima — wat ze
  // moeten weten is dát die registratie bewaard moet blijven, niet waar hij staat.
  'uren.criterium.nietbijgehouden': {
    nl: 'Je houdt je uren hier (nog) niet bij, dus we kunnen niets zeggen over het urencriterium. Doe je dat ergens anders? Bewaar die registratie goed — de Belastingdienst kan erom vragen. Vul je ze hier in, dan rekenen we mee, ook de uren die je niet factureert.',
    en: 'You are not keeping your hours here, so we cannot say anything about the urencriterium. Keeping them somewhere else? Hold on to that record — the Belastingdienst may ask for it. Enter them here and we will count along, including the hours you do not invoice.',
    ar: 'أنت لا تسجّل ساعاتك هنا، لذلك لا يمكننا قول شيء عن معيار الساعات. أتحتفظ بها في مكان آخر؟ احتفظ بذلك السجل جيدًا — فقد تطلبه مصلحة الضرائب. وإن أدخلتها هنا فسنحسبها معك، بما فيها الساعات غير المفوترة.',
  },
  'uren.criterium.achter': {
    nl: 'Op dit tempo kom je uit op ongeveer {verwacht} uur — onder de 1.225. Je hebt nog {resterend} uur te gaan in {dagen} dagen: gemiddeld {perweek} uur per week.',
    en: 'At this pace you will reach about {verwacht} hours — below the 1,225. You have {resterend} hours to go in {dagen} days: {perweek} hours a week on average.',
    ar: 'بهذه الوتيرة ستصل إلى نحو {verwacht} ساعة — أي أقل من 1.225. أمامك {resterend} ساعة خلال {dagen} يومًا: بمعدل {perweek} ساعة أسبوعيًا.',
  },
  'uren.criterium.kritiek': {
    nl: 'Je hebt nog {resterend} uur te gaan in {dagen} dagen. Dat is gemiddeld {perweek} uur per week — meer dan een volle werkweek. Houd er rekening mee dat de zelfstandigenaftrek dit jaar kan vervallen.',
    en: 'You have {resterend} hours to go in {dagen} days. That is {perweek} hours a week — more than a full working week. Take into account that the zelfstandigenaftrek may lapse this year.',
    ar: 'أمامك {resterend} ساعة خلال {dagen} يومًا، أي {perweek} ساعة أسبوعيًا — أكثر من أسبوع عمل كامل. ضع في حسبانك أن خصم العمل الحر قد يسقط هذا العام.',
  },
  'uren.criterium.onhaalbaar': {
    nl: 'Er zijn niet genoeg dagen meer over om dit jaar aan 1.225 uur te komen. Bespreek met je boekhouder wat dat betekent voor de zelfstandigenaftrek.',
    en: 'There are not enough days left to reach 1,225 hours this year. Discuss with your accountant what that means for the zelfstandigenaftrek.',
    ar: 'لم تعد الأيام المتبقية كافية لبلوغ 1.225 ساعة هذا العام. ناقش مع محاسبك أثر ذلك على خصم العمل الحر.',
  },
  'uren.criterium.afgeslotengehaald': {
    nl: 'In {jaar} haalde je het urencriterium op basis van je registratie.',
    en: 'In {jaar} you met the hour criterion based on your registration.',
    ar: 'في {jaar} استوفيت معيار الساعات بناءً على تسجيلك.',
  },
  'uren.criterium.afgeslotengemist': {
    nl: 'In {jaar} bleef je registratie onder de 1.225 uur. Werkte je meer, dan telt alleen wat je alsnog vastlegt.',
    en: 'In {jaar} your registration stayed below 1,225 hours. If you worked more, only what you still record counts.',
    ar: 'في {jaar} بقي تسجيلك دون 1.225 ساعة. إن كنت قد عملت أكثر، فلا يُحتسب إلا ما تُوثّقه.',
  },
  // De twee dingen die ondernemers het vaakst verkeerd aannemen. Ze staan er ALTIJD bij, ook als
  // het criterium gehaald is: wie het dit jaar haalde neemt volgend jaar dezelfde aanname mee.
  'uren.criterium.tellenmee': {
    nl: 'Ook uren die je niet factureert tellen mee: administratie, offertes, acquisitie, reistijd en scholing. Dit scherm is gemaakt om te factureren, dus die uren vergeet je makkelijk.',
    en: 'Hours you do not invoice count too: administration, quotes, acquisition, travel and training. This screen is built for invoicing, so those hours are easy to forget.',
    ar: 'تُحتسب أيضًا الساعات غير المفوترة: الإدارة وعروض الأسعار واستقطاب العملاء ووقت التنقل والتدريب. صُمِّمت هذه الشاشة للفوترة، لذا يسهل نسيان تلك الساعات.',
  },
  'uren.criterium.geendeeljaar': {
    nl: 'Startte je dit jaar? Dan geldt dezelfde 1.225 uur — er wordt niet naar rato gerekend.',
    en: 'Did you start this year? The same 1,225 hours apply — there is no pro-rata.',
    ar: 'هل بدأت هذا العام؟ ينطبق العدد نفسه، 1.225 ساعة — لا يُحتسب بالتناسب.',
  },
  'uren.titel': { nl: 'Uren', en: 'Hours', ar: 'الساعات' },
  'uren.subtitel': {
    nl: 'Schrijf op wat je gewerkt hebt. Wat er nog niet op een factuur staat, zet je hier in één keer om.',
    en: 'Write down what you worked. Whatever is not on an invoice yet, you turn into one here.',
    ar: 'سجّل ما عملته. وما لم يُدرَج بعد في فاتورة، تحوّله من هنا دفعة واحدة.',
  },
  'uren.nieuw': { nl: 'Uur toevoegen', en: 'Add hours', ar: 'إضافة ساعات' },
  'uren.leeg.titel': { nl: 'Nog geen uren', en: 'No hours yet', ar: 'لا ساعات بعد' },
  'uren.leeg.uitleg': {
    nl: 'Zodra je hier uren opschrijft, zie je per klant wat er nog te factureren valt — en maak je daar met één knop een factuur van.',
    en: 'Once you write hours here, you see per customer what is still to be invoiced — and turn it into an invoice with one button.',
    ar: 'ما إن تسجّل ساعات هنا، ترى لكل عميل ما لم يُفوتَر بعد — وتحوّله إلى فاتورة بزر واحد.',
  },

  // ── De velden ──
  'uren.veld.datum': { nl: 'Datum', en: 'Date', ar: 'التاريخ' },
  'uren.veld.klant': { nl: 'Klant', en: 'Customer', ar: 'العميل' },
  'uren.veld.omschrijving': { nl: 'Wat heb je gedaan?', en: 'What did you do?', ar: 'ماذا أنجزت؟' },
  // Dit veld wordt de factuurregel. Dat hier zeggen scheelt een omschrijving als "werk" waar de
  // klant later niets aan heeft — en de klant is degene die hem moet kunnen narekenen.
  'uren.veld.omschrijvingHint': {
    nl: 'Dit komt zo op de factuurregel te staan.',
    en: 'This becomes the invoice line.',
    ar: 'سيظهر هذا في سطر الفاتورة.',
  },
  'uren.veld.uren': { nl: 'Uren', en: 'Hours', ar: 'الساعات' },
  'uren.veld.tarief': { nl: 'Uurtarief', en: 'Hourly rate', ar: 'تعرفة الساعة' },
  'uren.veld.tariefHint': {
    nl: 'Excl. btw. Laat leeg als je het nog niet weet — het uur blijft dan gewoon staan.',
    en: 'Excl. btw. Leave it empty if you do not know yet — the hours stay recorded.',
    ar: 'دون ضريبة القيمة المضافة. اتركه فارغًا إن لم تعرفه بعد — تبقى الساعات مسجّلة.',
  },
  // [DECLARABEL] Which hours may ever reach an invoice, and which are the owner's own time.
  'uren.veld.declarabel': { nl: 'Declarabel', en: 'Billable', ar: 'قابلة للفوترة' },
  'uren.veld.declarabelHint': { nl: 'Uit voor acquisitie, administratie of leren. Die uren tellen wel mee voor het urencriterium.', en: 'Off for acquisition, admin or learning. Those hours do count towards the 1,225-hour criterion.', ar: 'أطفئها للاستقطاب أو الإدارة أو التعلّم. تلك الساعات تُحتسب لمعيار الساعات.' },
  'uren.nietDeclarabel.kop': { nl: 'Niet-declarabel', en: 'Not billable', ar: 'غير قابلة للفوترة' },
  'uren.nietDeclarabel.uitleg': { nl: 'Eigen tijd: acquisitie, administratie, leren. Telt mee voor het urencriterium, nooit voor een factuur.', en: 'Your own time: acquisition, admin, learning. Counts towards the criterion, never towards an invoice.', ar: 'وقتك الخاص: استقطاب وإدارة وتعلّم. يُحتسب لمعيار الساعات، لا للفاتورة.' },
  'uren.nietDeclarabel.chip': { nl: 'Eigen tijd', en: 'Own time', ar: 'وقت خاص' },
  'uren.split': { nl: 'waarvan {declarabel} declarabel', en: 'of which {declarabel} billable', ar: 'منها {declarabel} قابلة للفوترة' },
  'uren.splitPct': { nl: 'waarvan {declarabel} declarabel ({pct}%)', en: 'of which {declarabel} billable ({pct}%)', ar: 'منها {declarabel} قابلة للفوترة ({pct}%)' },
  'uren.veld.geenKlant': { nl: 'Geen klant', en: 'No customer', ar: 'بدون عميل' },
  'uren.opslaan': { nl: 'Opslaan', en: 'Save', ar: 'حفظ' },
  'uren.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'uren.bewerken': { nl: 'Bewerken', en: 'Edit', ar: 'تعديل' },
  'uren.verwijderen': { nl: 'Verwijderen', en: 'Remove', ar: 'حذف' },
  'uren.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ التنفيذ…' },

  // ── Wat er nog te factureren valt ──
  'uren.teFactureren': { nl: 'Nog te factureren', en: 'Still to invoice', ar: 'غير مفوترة بعد' },
  'uren.gefactureerd': { nl: 'Al gefactureerd', en: 'Already invoiced', ar: 'مفوترة بالفعل' },
  'uren.maakFactuur': { nl: 'Maak factuur', en: 'Create invoice', ar: 'إنشاء فاتورة' },
  'uren.urenKort': { nl: 'uur', en: 'h', ar: 'ساعة' },
  // Een uur dat op een factuur staat is geen invoerveld meer — zie de kop van /api/uren.
  'uren.staatOpFactuur': {
    nl: 'Staat op een factuur',
    en: 'On an invoice',
    ar: 'مُدرَجة في فاتورة',
  },
  'uren.staatOpFactuurUitleg': {
    nl: 'Dit uur staat op een factuur en kan niet meer worden aangepast. Gooi je dat concept weg, dan komt het uur weer vrij.',
    en: 'These hours are on an invoice and can no longer be changed. Delete that draft and they become available again.',
    ar: 'هذه الساعات مدرجة في فاتورة ولم تعد قابلة للتعديل. احذف تلك المسودة لتعود متاحة.',
  },

  // ── Waar een bedrag onvolledig is, staat het er ──
  'uren.zonderTarief.een': {
    nl: 'Bij 1 uur staat nog geen tarief — dat uur zit niet in dit bedrag en gaat niet mee op de factuur.',
    en: '1 entry has no rate yet — it is not in this amount and will not go on the invoice.',
    ar: 'سجلٌّ واحد بلا أجر بعد — غير محتسب في هذا المبلغ ولن يُدرَج في الفاتورة.',
  },
  'uren.zonderTarief.meer': {
    nl: 'Bij {n} uren staat nog geen tarief — die zitten niet in dit bedrag en gaan niet mee op de factuur.',
    en: '{n} entries have no rate yet — they are not in this amount and will not go on the invoice.',
    ar: '{n} سجلات بلا أجر بعد — غير محتسبة في هذا المبلغ ولن تُدرَج في الفاتورة.',
  },
  // ── [RITTEN] De kilometeradministratie: wat er gereden is, en wat het waard is ──
  'ritten.tab': { nl: 'Kilometers', en: 'Kilometres', ar: 'الكيلومترات' },
  'ritten.nieuw': { nl: 'Rit opschrijven', en: 'Log a trip', ar: 'تسجيل رحلة' },
  'ritten.veld.datum': { nl: 'Datum', en: 'Date', ar: 'التاريخ' },
  'ritten.veld.vertrek': { nl: 'Van', en: 'From', ar: 'من' },
  'ritten.veld.bestemming': { nl: 'Naar', en: 'To', ar: 'إلى' },
  'ritten.veld.doel': { nl: 'Waarvoor', en: 'Purpose', ar: 'الغرض' },
  'ritten.veld.kilometers': { nl: 'Kilometers', en: 'Kilometres', ar: 'الكيلومترات' },
  'ritten.veld.tarief': { nl: 'Tarief per km (ex btw)', en: 'Rate per km (ex VAT)', ar: 'التعرفة لكل كم (قبل الضريبة)' },
  'ritten.veld.tariefHint': { nl: 'Leeg = niet doorbelasten.', en: 'Empty = not charged on.', ar: 'فارغ = لا يُحمَّل على العميل.' },
  'ritten.veld.klant': { nl: 'Klant', en: 'Customer', ar: 'العميل' },
  'ritten.veld.geenKlant': { nl: 'Geen klant', en: 'No customer', ar: 'بدون عميل' },
  'ritten.zakelijk': { nl: 'Zakelijke rit', en: 'Business trip', ar: 'رحلة عمل' },
  'ritten.zakelijkHint': { nl: 'Alleen zakelijke kilometers tellen voor de aftrek.', en: 'Only business kilometres count towards the deduction.', ar: 'كيلومترات العمل وحدها تُحتسب للخصم.' },
  'ritten.opslaan': { nl: 'Opslaan', en: 'Save', ar: 'حفظ' },
  'ritten.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'ritten.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ التنفيذ…' },
  'ritten.bewerken': { nl: 'Bewerken', en: 'Edit', ar: 'تعديل' },
  'ritten.verwijderen': { nl: 'Verwijderen', en: 'Delete', ar: 'حذف' },
  'ritten.verwijderen.vraag': { nl: 'Deze rit weggooien?', en: 'Delete this trip?', ar: 'حذف هذه الرحلة؟' },
  'ritten.verwijderen.uitleg': { nl: 'De rit verdwijnt uit je kilometeradministratie.', en: 'The trip disappears from your kilometre log.', ar: 'ستختفي الرحلة من سجل الكيلومترات.' },
  'ritten.leeg.titel': { nl: 'Nog geen ritten', en: 'No trips yet', ar: 'لا رحلات بعد' },
  'ritten.leeg.uitleg': { nl: 'Schrijf een rit op de dag zelf op. Dat is wat de aftrek later draagt.', en: 'Log a trip on the day itself. That is what carries the deduction later.', ar: 'سجّل الرحلة في يومها. هذا ما يسند الخصم لاحقًا.' },
  'ritten.jaar.km': { nl: '{km} km zakelijk in {jaar}', en: '{km} business km in {jaar}', ar: '{km} كم عمل في {jaar}' },
  'ritten.jaar.aftrek': { nl: 'Aftrek {bedrag} · {tarief} per km', en: 'Deduction {bedrag} · {tarief} per km', ar: 'خصم {bedrag} · {tarief} لكل كم' },
  'ritten.jaar.zelfBoeken': { nl: 'Deze aftrek boek je zelf; hij staat nog niet in je resultaat.', en: 'You book this deduction yourself; it is not in your result yet.', ar: 'تُقيّد هذا الخصم بنفسك؛ ليس ضمن نتيجتك بعد.' },
  'ritten.jaar.teFactureren': { nl: '{bedrag} reiskosten staat nog op geen factuur.', en: '{bedrag} of travel is on no invoice yet.', ar: '{bedrag} من بدل السفر ليست على أي فاتورة بعد.' },
  'ritten.zonderTarief.een': { nl: 'Bij 1 rit staat geen tarief — die zit niet in dit bedrag.', en: '1 trip has no rate — it is not in this amount.', ar: 'رحلة واحدة بلا تعرفة — غير محتسبة في هذا المبلغ.' },
  'ritten.zonderTarief.meer': { nl: 'Bij {n} ritten staat geen tarief — die zitten niet in dit bedrag.', en: '{n} trips have no rate — they are not in this amount.', ar: '{n} رحلات بلا تعرفة — غير محتسبة في هذا المبلغ.' },
  'ritten.klaar': { nl: 'Klaar om te factureren', en: 'Ready to invoice', ar: 'جاهزة للفوترة' },
  'ritten.maakFactuur': { nl: 'Maak factuur', en: 'Create invoice', ar: 'إنشاء فاتورة' },
  'ritten.fout.factuur': { nl: 'De factuur kon niet worden gemaakt.', en: 'The invoice could not be created.', ar: 'تعذّر إنشاء الفاتورة.' },
  'ritten.opFactuur': { nl: 'Staat op een factuur', en: 'On an invoice', ar: 'مُدرَجة في فاتورة' },
  'ritten.prive': { nl: 'Privé', en: 'Private', ar: 'خاص' },
  'ritten.kmKort': { nl: 'km', en: 'km', ar: 'كم' },
  'ritten.fout.geenDatum': { nl: 'Kies de datum van de rit.', en: 'Choose the date of the trip.', ar: 'اختر تاريخ الرحلة.' },
  'ritten.fout.geenVertrek': { nl: 'Vul in waar de rit begon.', en: 'Fill in where the trip started.', ar: 'اكتب من أين بدأت الرحلة.' },
  'ritten.fout.geenBestemming': { nl: 'Vul in waar de rit naartoe ging.', en: 'Fill in where the trip went.', ar: 'اكتب إلى أين ذهبت الرحلة.' },
  'ritten.fout.geenDoel': { nl: 'Vul in waarvoor je reed.', en: 'Fill in what you drove for.', ar: 'اكتب سبب الرحلة.' },
  'ritten.fout.plaatsTeLang': { nl: 'Van en Naar mogen korter.', en: 'From and To may be shorter.', ar: 'اجعل «من» و«إلى» أقصر.' },
  'ritten.fout.doelTeLang': { nl: 'Waarvoor mag korter.', en: 'The purpose may be shorter.', ar: 'اجعل الغرض أقصر.' },
  'ritten.fout.geenKilometers': { nl: 'Vul in hoeveel kilometer je reed.', en: 'Fill in how many kilometres you drove.', ar: 'اكتب عدد الكيلومترات التي قدتها.' },
  'ritten.fout.teVeelKilometers': { nl: 'Meer dan {max} km in één rit kan niet. Splits de rit.', en: 'More than {max} km in one trip is not possible. Split the trip.', ar: 'لا يمكن أن تتجاوز الرحلة الواحدة {max} كم. قسّم الرحلة.' },
  'ritten.fout.tariefGeenBedrag': { nl: 'Het tarief per km is geen bedrag.', en: 'The rate per km is not an amount.', ar: 'التعرفة لكل كم ليست مبلغًا.' },
  'ritten.fout.welkeRit': { nl: 'We weten niet welke rit je bedoelt. Ververs de pagina.', en: 'We do not know which trip you mean. Refresh the page.', ar: 'لا نعرف أي رحلة تقصد. أعد تحميل الصفحة.' },
  'ritten.fout.laden': { nl: 'We konden je ritten nu niet ophalen.', en: 'We could not fetch your trips right now.', ar: 'تعذّر جلب رحلاتك الآن.' },
  'ritten.fout.opslaan': { nl: 'De rit kon niet worden opgeslagen.', en: 'The trip could not be saved.', ar: 'تعذّر حفظ الرحلة.' },
  'ritten.fout.aanpassen': { nl: 'De rit kon niet worden aangepast.', en: 'The trip could not be changed.', ar: 'تعذّر تعديل الرحلة.' },
  'ritten.fout.verwijderenMislukt': { nl: 'De rit kon niet worden verwijderd.', en: 'The trip could not be deleted.', ar: 'تعذّر حذف الرحلة.' },
  'ritten.fout.alGefactureerd': { nl: 'Deze rit staat op een factuur en verandert niet meer.', en: 'This trip is on an invoice and does not change any more.', ar: 'هذه الرحلة مدرجة في فاتورة ولم تعد قابلة للتغيير.' },
  'uren.geenTarief': { nl: 'Geen tarief', en: 'No rate', ar: 'بلا تعرفة' },

  // ── Wat er misging ──
  'uren.fout.laden': {
    nl: 'De uren konden niet worden geladen. Dit is een storing, geen lege lijst — probeer het zo opnieuw.',
    en: 'The hours could not be loaded. This is a failure, not an empty list — try again in a moment.',
    ar: 'تعذّر تحميل الساعات. هذا عطل وليس قائمة فارغة — أعد المحاولة بعد قليل.',
  },
  'uren.fout.opslaan': {
    nl: 'Dit uur is niet opgeslagen. Er is niets veranderd.',
    en: 'These hours were not saved. Nothing changed.',
    ar: 'لم تُحفَظ هذه الساعات. لم يتغيّر شيء.',
  },
  'uren.fout.factuur': {
    nl: 'De factuur is niet gemaakt en je uren staan er nog. Ververs de pagina en probeer het opnieuw.',
    en: 'The invoice was not created and your hours are still there. Refresh the page and try again.',
    ar: 'لم تُنشأ الفاتورة وساعاتك ما زالت موجودة. أعد تحميل الصفحة وحاول مرة أخرى.',
  },
  // [SERVER-ZIN] What /api/uren answers when it refuses. Each sentence names ONE field. They used
  // to live in the route as Dutch literals, so an Arabic owner who left the hours blank read
  // "Vul in hoeveel uur je gewerkt hebt." in a toast. The route now translates them with the
  // language cookie of whoever is typing (uren-refusal.ts maps the code to the key).
  'uren.fout.nietIngelogd': {
    nl: 'Je bent niet ingelogd. Log opnieuw in en probeer het nog eens.',
    en: 'You are not signed in. Sign in again and try once more.',
    ar: 'أنت غير مسجّل الدخول. سجّل الدخول مجددًا وأعد المحاولة.',
  },
  'uren.fout.geenDatum': {
    nl: 'Vul de datum in waarop je gewerkt hebt.',
    en: 'Fill in the date you worked on.',
    ar: 'أدخل التاريخ الذي عملت فيه.',
  },
  'uren.fout.geenBestaandeDatum': {
    nl: 'Die datum bestaat niet. Gebruik de datumkiezer.',
    en: 'That date does not exist. Use the date picker.',
    ar: 'هذا التاريخ غير موجود. استخدم منتقي التاريخ.',
  },
  'uren.fout.geenOmschrijving': {
    nl: 'Schrijf op wat je gedaan hebt — dit komt zo op de factuurregel te staan.',
    en: 'Write down what you did — this will appear on the invoice line.',
    ar: 'اكتب ما أنجزته — سيظهر هذا في سطر الفاتورة.',
  },
  'uren.fout.omschrijvingTeLang': {
    nl: 'De omschrijving is te lang voor een factuurregel. Houd het bij een zin.',
    en: 'The description is too long for an invoice line. Keep it to one sentence.',
    ar: 'الوصف أطول من أن يتّسع في سطر فاتورة. اجعله جملة واحدة.',
  },
  'uren.fout.geenUren': {
    nl: 'Vul in hoeveel uur je gewerkt hebt.',
    en: 'Fill in how many hours you worked.',
    ar: 'أدخل عدد الساعات التي عملتها.',
  },
  'uren.fout.teVeelUren': {
    nl: 'Meer dan {max} uur op één dag kan niet. Splits het over twee regels.',
    en: 'More than {max} hours in one day is not possible. Split it over two lines.',
    ar: 'لا يمكن تسجيل أكثر من {max} ساعة في يوم واحد. قسّمها على سطرين.',
  },
  'uren.fout.tariefGeenBedrag': {
    nl: 'Het uurtarief is geen bedrag. Laat het leeg als je het nog niet weet.',
    en: 'The hourly rate is not an amount. Leave it empty if you do not know it yet.',
    ar: 'أجر الساعة ليس مبلغاً. اتركه فارغاً إن لم تعرفه بعد.',
  },
  'uren.fout.welkUur': {
    nl: 'Welk uur bedoel je?',
    en: 'Which hours do you mean?',
    ar: 'أيّ ساعات تقصد؟',
  },
  'uren.fout.aanpassen': {
    nl: 'Dit uur kon niet worden aangepast. Probeer het opnieuw.',
    en: 'These hours could not be changed. Try again.',
    ar: 'تعذّر تعديل هذه الساعات. أعد المحاولة.',
  },
  'uren.fout.verwijderenMislukt': {
    nl: 'Dit uur kon niet worden verwijderd. Probeer het opnieuw.',
    en: 'These hours could not be removed. Try again.',
    ar: 'تعذّر حذف هذه الساعات. أعد المحاولة.',
  },
  'uren.fout.alGefactureerdAanpassen': {
    nl: 'Dit uur staat al op een factuur en kan niet meer worden aangepast. Gooi het concept weg als je het toch wilt wijzigen — dan komt het uur weer vrij.',
    en: 'These hours are already on an invoice and can no longer be changed. Discard the draft if you do want to change them — the hours are then released.',
    ar: 'هذه الساعات مدرجة بالفعل في فاتورة ولا يمكن تعديلها. احذف المسودة إن أردت تعديلها — فتعود الساعات متاحة.',
  },
  'uren.fout.alGefactureerdVerwijderen': {
    nl: 'Dit uur staat al op een factuur en kan niet meer worden verwijderd. Gooi het concept weg als je het toch wilt weghalen — dan komt het uur weer vrij.',
    en: 'These hours are already on an invoice and can no longer be removed. Discard the draft if you do want to take them out — the hours are then released.',
    ar: 'هذه الساعات مدرجة بالفعل في فاتورة ولا يمكن حذفها. احذف المسودة إن أردت إزالتها — فتعود الساعات متاحة.',
  },
  'uren.verwijderen.vraag': {
    nl: 'Dit uur weggooien?',
    en: 'Remove these hours?',
    ar: 'إزالة هذه الساعات؟',
  },
  'uren.verwijderen.uitleg': {
    nl: 'Het verdwijnt uit je urenlijst. Werk dat je wel gedaan hebt, kun je daarna niet meer factureren.',
    en: 'It disappears from your hours. Work you did do cannot be invoiced afterwards.',
    ar: 'ستختفي من قائمة ساعاتك. ولن تتمكّن بعدها من فوترة عمل أنجزته فعلًا.',
  },


  // ─── [UITNODIGING] De pagina waar een uitnodiging een koppeling wordt ───────────────────────
  //
  // De genodigde is meestal een KLANT van een kantoor — iemand die BoekBrug nog nooit zag en er
  // via de mail van zijn boekhouder binnenkomt. De eerste kantoren lezen Arabisch, dus dit is
  // een van de weinige publieke pagina's waar de vertaling er vanaf dag één toe doet.
  // Het kantoor-overzicht van wat er uitstaat (KlantenBeheer).
  'bh.klant.uitn.kop': { nl: 'Uitgenodigd — wacht op reactie ({count})', ar: 'دعوات بانتظار الرد ({count})', en: 'Invited — awaiting reply ({count})' },
  'bh.klant.uitn.verloopt': { nl: 'Link nog {dagen} dagen geldig', ar: 'الرابط صالح لمدة {dagen} أيام أخرى', en: 'Link valid for {dagen} more days' },
  'bh.klant.uitn.intrekken': { nl: 'Intrekken', ar: 'سحب الدعوة', en: 'Withdraw' },
  // Stap 5 van de wizard, voor wie al gekoppeld binnenkwam (via de uitnodiging van zijn kantoor).
  'onb.kantoor.titel': { nl: 'Je boekhouder staat al klaar', ar: 'محاسبك جاهز بالفعل', en: 'Your accountant is already set' },
  'onb.kantoor.uitleg': { nl: 'Je bent gekoppeld aan {naam}. Alles wat je verstuurt, ontvangt of op betaald zet, haalt hij aan het kwartaaleinde in één keer op; je concepten blijven van jou.', ar: 'أنت مرتبط بـ {naam}. كل ما ترسله أو تستقبله أو تعلّمه كمدفوع يجمعه دفعة واحدة في نهاية الربع؛ ومسوّداتك تبقى لك.', en: 'You are linked to {naam}. Everything you send, receive or mark as paid, they collect in one go at quarter end; your drafts stay yours.' },
  // ─── [PAKKET-LINK] Het kwartaal versturen naar een boekhouder zonder account ────────────────
  'klr.deel.knop': { nl: 'Of stuur het naar je boekhouder', ar: 'أو أرسله إلى محاسبك', en: 'Or send it to your accountant' },
  'klr.deel.uitleg': { nl: 'Wij mailen hem een downloadlink. Hij heeft géén account nodig — de link werkt 30 dagen en je kunt hem altijd intrekken.', ar: 'نرسل له رابط تنزيل بالبريد. لا يحتاج حسابًا — الرابط يعمل 30 يومًا ويمكنك سحبه في أي وقت.', en: 'We e-mail him a download link. He needs no account — the link works for 30 days and you can withdraw it at any time.' },
  'klr.deel.adresLabel': { nl: 'E-mailadres van je boekhouder', ar: 'البريد الإلكتروني لمحاسبك', en: 'Your accountant\'s e-mail address' },
  'klr.deel.notitieLabel': { nl: 'Eigen bericht (optioneel)', ar: 'رسالة منك (اختيارية)', en: 'Your own message (optional)' },
  'klr.deel.notitiePlaceholder': { nl: 'Bijvoorbeeld: de bon van de verzekering komt nog na.', ar: 'مثلًا: إيصال التأمين سيصل لاحقًا.', en: 'For example: the insurance receipt is still to come.' },
  'klr.deel.versturen': { nl: 'Versturen', ar: 'إرسال', en: 'Send' },
  'klr.deel.bezig': { nl: 'Bezig met versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  // [PAKKET-AFDRUK] De zip wordt bij elke download opnieuw gebouwd uit de huidige tabellen, dus
  // dezelfde link kan in juni iets anders geven dan in april. Deze regels maken dat zichtbaar op
  // het scherm waar de eigenaar de link maakt — de enige plek waar "stuur hem opnieuw" een
  // handeling is in plaats van een advies.
  'klr.afl.kopEen': { nl: 'Je boekhouder haalde dit pakket 1× op', ar: 'حمّل محاسبك هذه الحزمة مرة واحدة', en: 'Your accountant collected this package once' },
  'klr.afl.kopMeer': { nl: 'Je boekhouder haalde dit pakket {aantal}× op', ar: 'حمّل محاسبك هذه الحزمة {aantal} مرات', en: 'Your accountant collected this package {aantal} times' },
  'klr.afl.inhoud': { nl: '{verkoop} verkoop · {inkoop} inkoop · {bestanden} bestanden', ar: '{verkoop} مبيعات · {inkoop} مشتريات · {bestanden} ملفات', en: '{verkoop} sales · {inkoop} purchase · {bestanden} files' },
  // [NO-SILENT-EMPTY] Een lege lijst zou hier zeggen "hij heeft het nooit opgehaald" — een bewering,
  // op precies het scherm waar de eigenaar controleert of de overdracht is aangekomen.
  'klr.afl.fout': { nl: 'We konden de ophaalgeschiedenis nu niet lezen. Dat zegt niets over of je boekhouder het pakket heeft opgehaald.', ar: 'تعذّرت قراءة سجلّ التحميل الآن. هذا لا يقول شيئًا عمّا إذا كان محاسبك قد حمّل الحزمة.', en: 'We could not read the collection history just now. That says nothing about whether your accountant collected the package.' },
  'klr.deel.verstuurd': { nl: '✓ Verstuurd naar {email}. Je ziet hier straks of hij het pakket heeft opgehaald.', ar: '✓ أُرسل إلى {email}. سترى هنا لاحقًا إن كان قد حمّل الحزمة.', en: '✓ Sent to {email}. You will see here whether he collected the package.' },
  'klr.deel.fout': { nl: 'Versturen mislukt. Er is niets verstuurd — probeer het opnieuw.', ar: 'فشل الإرسال. لم يُرسل شيء — حاول مرة أخرى.', en: 'Sending failed. Nothing was sent — please try again.' },
  'klr.deel.offline': { nl: 'Geen verbinding. Er is niets verstuurd.', ar: 'لا يوجد اتصال. لم يُرسل شيء.', en: 'No connection. Nothing was sent.' },

  // ─── [PROEFDOSSIER] Het voorbeelddossier — de bewijsplek vóór de eerste klant ───────────────
  'bh.home.klanten.eerste.voorbeeld': { nl: 'Eerst zien hoe een gevuld klantdossier eruitziet →', ar: 'شاهد أولاً كيف يبدو ملف عميل ممتلئ ←', en: 'First see what a filled client file looks like →' },
  'bh.demo.banner.titel': { nl: 'Voorbeeld — fictieve cijfers', ar: 'مثال — أرقام خيالية', en: 'Example — fictional figures' },
  'bh.demo.banner.uitleg': { nl: 'Zo ziet een gevuld klantdossier eruit. Niets hierin is echt of wordt opgeslagen — het laat zien wat je klanten straks aanleveren.', ar: 'هكذا يبدو ملف عميل ممتلئ. لا شيء هنا حقيقي أو يُحفظ — إنه يُريك ما سيسلّمه عملاؤك.', en: 'This is what a filled client file looks like. Nothing in it is real or gets stored — it shows what your clients will deliver.' },
  'bh.demo.gereedheid': { nl: '{verwerkt} van {totaal} inkoopfacturen verwerkt · Bank ✓ · {vragen} vraag open', ar: '{verwerkt} من {totaal} فواتير مشتريات معالجة · البنك ✓ · {vragen} سؤال مفتوح', en: '{verwerkt} of {totaal} purchase invoices processed · Bank ✓ · {vragen} question open' },
  'bh.demo.tegel.omzet': { nl: 'Omzet (excl. btw)', ar: 'الإيراد (بدون الضريبة)', en: 'Revenue (excl. VAT)' },
  'bh.demo.tegel.kosten': { nl: 'Kosten (excl. btw)', ar: 'التكاليف (بدون الضريبة)', en: 'Costs (excl. VAT)' },
  'bh.demo.tegel.saldo': { nl: 'BTW-saldo (te betalen)', ar: 'رصيد الضريبة (مستحق الدفع)', en: 'VAT balance (payable)' },
  'bh.demo.verkoop.kop': { nl: 'Verkoop', ar: 'المبيعات', en: 'Sales' },
  'bh.demo.inkoop.kop': { nl: 'Inkoop', ar: 'المشتريات', en: 'Purchases' },
  'bh.demo.chip.verwerkt': { nl: '✓ Verwerkt', ar: '✓ تمت المعالجة', en: '✓ Processed' },
  'bh.demo.chip.vraag': { nl: '? Vraag', ar: '؟ سؤال', en: '? Question' },
  'bh.demo.vraag.teltNietMee': { nl: 'Telt nergens in mee tot de klant antwoordt — geen gok in je voorbelasting.', ar: 'لا تُحتسب في أي شيء حتى يجيب العميل — لا تخمين في ضريبة المشتريات.', en: 'Counts nowhere until the client answers — no guess in your input VAT.' },
  'bh.demo.eerlijk.kop': { nl: 'Wat wij niet zeker weten, staat als vraag — niet als gok', ar: 'ما لا نعرفه يقينًا يبقى سؤالًا — لا تخمينًا', en: 'What we are not sure of stands as a question — not a guess' },
  'bh.demo.eerlijk.tekst': { nl: 'Kijk naar de tegels: de factuur met de open vraag telt niet mee in kosten en voorbelasting. Het dossier klopt — of zegt precies waar het nog niet klopt.', ar: 'انظر إلى الأرقام: الفاتورة ذات السؤال المفتوح لا تُحتسب في التكاليف ولا في ضريبة المشتريات. الملف صحيح — أو يقول بدقة أين لم يصح بعد.', en: 'Look at the tiles: the invoice with the open question counts in neither costs nor input VAT. The file is right — or says exactly where it is not yet.' },
  'bh.demo.pakket.tekst': { nl: 'Aan het kwartaaleinde haal je alles in één keer op: PDF\'s, CSV en het XAF-auditbestand voor je eigen pakket.', ar: 'في نهاية الربع تجمع كل شيء دفعة واحدة: ملفات PDF وCSV وملف تدقيق XAF لبرنامجك.', en: 'At quarter end you collect everything in one go: PDFs, CSV and the XAF audit file for your own package.' },
  'bh.demo.cta': { nl: 'Nodig je eerste klant uit', ar: 'ادعُ عميلك الأول', en: 'Invite your first client' },

  'uitn.laden': { nl: 'Laden…', ar: 'جارٍ التحميل…', en: 'Loading…' },
  'uitn.titel': { nl: 'Je bent uitgenodigd', ar: 'تمت دعوتك', en: 'You are invited' },
  // Twee richtingen, twee zinnen — zie de kop van invite/accept/page.tsx.
  'uitn.vanKantoor': { nl: '{naam} nodigt je uit om via BoekBrug samen te werken. Jij houdt je administratie bij; je boekhouder haalt op wat hij nodig heeft.', ar: '{naam} يدعوك للعمل معًا عبر BoekBrug. أنت تتابع إدارتك، ومحاسبك يحصل على ما يحتاج إليه.', en: '{naam} invites you to work together through BoekBrug. You keep your administration; your accountant picks up what they need.' },
  'uitn.vanOndernemer': { nl: '{naam} wil je toevoegen als boekhouder via BoekBrug.', ar: '{naam} يريد إضافتك محاسبًا له عبر BoekBrug.', en: '{naam} wants to add you as their accountant on BoekBrug.' },
  'uitn.ingelogdAls': { nl: 'Ingelogd als {email}', ar: 'مسجّل الدخول كـ {email}', en: 'Signed in as {email}' },
  'uitn.accepteren': { nl: 'Uitnodiging accepteren', ar: 'قبول الدعوة', en: 'Accept invitation' },
  'uitn.weigeren': { nl: 'Weigeren', ar: 'رفض', en: 'Decline' },
  'uitn.eerstAccount': { nl: 'Maak een account aan (of log in) om de uitnodiging te accepteren.', ar: 'أنشئ حسابًا (أو سجّل الدخول) لقبول الدعوة.', en: 'Create an account (or sign in) to accept the invitation.' },
  'uitn.registreren': { nl: 'Account aanmaken', ar: 'إنشاء حساب', en: 'Create account' },
  'uitn.inloggen': { nl: 'Inloggen', ar: 'تسجيل الدخول', en: 'Sign in' },
  'uitn.klaar.titel': { nl: 'Uitnodiging geaccepteerd!', ar: 'تم قبول الدعوة!', en: 'Invitation accepted!' },
  'uitn.klaar.uitleg': { nl: 'Je wordt doorgestuurd naar je dashboard…', ar: 'يتم تحويلك إلى لوحتك…', en: 'Taking you to your dashboard…' },
  'uitn.geweigerd.titel': { nl: 'Uitnodiging geweigerd', ar: 'تم رفض الدعوة', en: 'Invitation declined' },
  'uitn.geweigerd.uitleg': { nl: 'Er is niets gekoppeld. Je kunt dit venster sluiten.', ar: 'لم يُربط أي شيء. يمكنك إغلاق هذه النافذة.', en: 'Nothing was linked. You can close this window.' },
  'uitn.fout.titel': { nl: 'Dat lukte niet', ar: 'لم ينجح ذلك', en: 'That did not work' },
  'uitn.fout.ongeldig': { nl: 'Deze uitnodiging is verlopen of al gebruikt. Vraag je boekhouder om een nieuwe.', ar: 'هذه الدعوة منتهية أو استُخدمت من قبل. اطلب من محاسبك دعوة جديدة.', en: 'This invitation has expired or was already used. Ask your accountant for a new one.' },

  // ═══ [BOEKHOUDER] De schermen van de boekhouder ═══════════════════════════════════════════════
  //
  // Deze module was met opzet alleen Nederlands, en die keuze stond met redenen in AGENTS.md: de
  // boekhouder is een Nederlandse beroepsbeoefenaar, en de taalkeuze van de EIGENAAR zegt niets
  // over hem. Het slot van die alinea was ook de uitweg: "wordt een niet-Nederlandse boekhouder
  // ooit een echt publiek, dan is dat eerst een productbeslissing en pas daarna een vertaling."
  //
  // Dat publiek is er. De boekhouder heeft bovendien zijn EIGEN profiel en dus zijn eigen taal —
  // de bezwaren in die alinea gingen over de taal van de eigenaar, en die raakt deze schermen
  // nog steeds niet.
  //
  // Wat NIET meevertaalt en hier dus ook niet in staat: de administratie zelf. Bedragen, data,
  // factuurnummers, statuswaarden uit de database, de factuur, de e-factuur en het auditbestand
  // blijven wat ze waren. Een vertaalde knop boven een Nederlands document vertaalt het document
  // niet — en dat is precies goed.

  // ─── [BOEKHOUDER] Boekhouder · de dagelijkse startpagina (AccountantHome) ───────────────────
  'bh.home.groet.ochtend': { nl: 'Goedemorgen', en: 'Good morning', ar: 'صباح الخير' },
  'bh.home.groet.middag': { nl: 'Goedemiddag', en: 'Good afternoon', ar: 'طاب يومك' },
  'bh.home.groet.avond': { nl: 'Goedenavond', en: 'Good evening', ar: 'مساء الخير' },
  'bh.home.groet.hallo': { nl: 'Hallo', en: 'Hello', ar: 'مرحبًا' },
  'bh.home.groet.daar': { nl: 'daar', en: 'there', ar: 'أهلًا' },
  'bh.home.aangifte.titel': { nl: 'Aangifte & status', en: 'Return & status', ar: 'الإقرار والحالة' },
  'bh.home.aangifte.uitleg': { nl: 'BTW-deadline, klaar-status en herinneren per klant', en: 'VAT deadline, readiness and reminders per client', ar: 'موعد إقرار الضريبة وحالة الجاهزية والتذكير لكل عميل' },
  'bh.home.werkvoorraad.onvolledig': { nl: 'We konden je werkvoorraad niet volledig lezen; de blokken hieronder kunnen onvolledig zijn. Ververs de pagina.', en: 'We could not fully read your work queue; the blocks below may be incomplete. Refresh the page.', ar: 'لم نتمكّن من قراءة قائمة أعمالك بالكامل؛ قد تكون الكتل أدناه ناقصة. أعد تحميل الصفحة.' },
  'bh.home.werkvoorraad.kop': { nl: 'Wat er op jou ligt', en: 'What is waiting for you', ar: 'ما ينتظرك' },
  'bh.home.bevestigen.label': { nl: 'Te bevestigen', en: 'To confirm', ar: 'بانتظار التأكيد' },
  'bh.home.geenMachtiging': { nl: 'Nog niemand machtigde je hiervoor', en: 'Nobody has authorised you for this yet', ar: 'لم يفوّضك أحد بذلك بعد' },
  'bh.home.bevestigen.niets': { nl: 'Niets houdt een kwartaal tegen', en: 'Nothing is holding up a quarter', ar: 'لا شيء يعطّل ربعًا' },
  'bh.home.bevestigen.blokkeert': { nl: 'Houdt een kwartaal tegen', en: 'Holds up a quarter', ar: 'يعطّل ربعًا' },
  'bh.home.telaat.label': { nl: 'Te laat', en: 'Overdue', ar: 'متأخر' },
  'bh.home.telaat.niets': { nl: 'Niets te laat', en: 'Nothing overdue', ar: 'لا شيء متأخر' },
  'bh.home.telaat.een': { nl: '{aantal} factuur · oudste {dagen} dagen', en: '{aantal} invoice · oldest {dagen} days', ar: '{aantal} فاتورة · الأقدم {dagen} يومًا' },
  'bh.home.telaat.meer': { nl: '{aantal} facturen · oudste {dagen} dagen', en: '{aantal} invoices · oldest {dagen} days', ar: '{aantal} فواتير · الأقدم {dagen} يومًا' },
  'bh.home.overzicht.kop': { nl: 'Overzicht', en: 'Overview', ar: 'نظرة عامة' },
  'bh.home.overzicht.klanten': { nl: 'Klanten', en: 'Clients', ar: 'العملاء' },
  'bh.home.overzicht.openVraag': { nl: 'Open vraag', en: 'Open question', ar: 'سؤال مفتوح' },
  'bh.home.overzicht.zonderBank': { nl: 'Zonder bank', en: 'No bank', ar: 'بلا بنك' },
  'bh.home.todo.onleesbaar.titel': { nl: 'We konden je takenlijst nu niet ophalen', en: 'We could not fetch your to-do list right now', ar: 'لم نتمكّن من جلب قائمة مهامك الآن' },
  'bh.home.todo.onleesbaar.uitleg': { nl: 'Dit betekent niet dat er niets te doen is: we konden het niet lezen.', en: 'This does not mean there is nothing to do: we could not read it.', ar: 'هذا لا يعني أنه لا يوجد ما تفعله: لم نتمكن من قراءته.' },
  'bh.home.todo.kop': { nl: 'Te doen', en: 'To do', ar: 'المهام' },
  'bh.home.klanten.kop': { nl: 'Mijn klanten', en: 'My clients', ar: 'عملائي' },
  'bh.home.klanten.nieuw': { nl: '+ Klant', en: '+ Client', ar: '+ عميل' },
  'bh.home.klanten.zoekPlaceholder': { nl: 'Zoek klant op naam of e-mail…', en: 'Search a client by name or e-mail…', ar: 'ابحث عن عميل بالاسم أو البريد الإلكتروني…' },
  'bh.home.klanten.zoekLabel': { nl: 'Klanten zoeken', en: 'Search clients', ar: 'البحث عن العملاء' },
  'bh.home.klanten.wissen': { nl: 'Wissen', en: 'Clear', ar: 'مسح' },
  'bh.home.klanten.onleesbaar.titel': { nl: 'We konden je klantenlijst nu niet ophalen', en: 'We could not fetch your client list right now', ar: 'لم نتمكّن من جلب قائمة عملائك الآن' },
  'bh.home.klanten.onleesbaar.uitleg': { nl: 'Dit zegt niets over je klanten: we konden ze niet lezen. Ververs de pagina.', en: 'This says nothing about your clients: we could not read them. Refresh the page.', ar: 'هذا لا يقول شيئًا عن عملائك: لم نتمكن من قراءتهم. أعد تحميل الصفحة.' },
  'bh.home.klanten.eerste.titel': { nl: 'Voeg je eerste klant toe', en: 'Add your first client', ar: 'أضف عميلك الأول' },
  'bh.home.klanten.eerste.uitleg': { nl: 'Nodig een klant uit of koppel een bestaande', en: 'Invite a client or link an existing one', ar: 'ادعُ عميلًا أو اربط عميلًا موجودًا' },
  'bh.home.klanten.geenResultaat': { nl: 'Geen klanten gevonden voor “{zoekterm}”', en: 'No clients found for “{zoekterm}”', ar: 'لا عملاء مطابقون لـ “{zoekterm}”' },
  'bh.home.werkplek.kop': { nl: 'Werkplek', en: 'Workspace', ar: 'مساحة العمل' },
  'bh.home.tegel.beheren': { nl: 'Beheren', en: 'Manage', ar: 'إدارة' },
  'bh.home.tegel.kwartaal': { nl: 'Kwartaal', en: 'Quarter', ar: 'الربع' },
  'bh.home.tegel.brug': { nl: 'Brug', en: 'Bridge', ar: 'الجسر' },
  'bh.home.tegel.mijnFacturen': { nl: 'Mijn facturen', en: 'My invoices', ar: 'فواتيري' },
  'bh.home.tegel.factureren': { nl: 'Factureren', en: 'Invoicing', ar: 'إصدار فاتورة' },
  'bh.home.tegel.openstaand': { nl: 'Openstaand', en: 'Outstanding', ar: 'مستحق' },
  'bh.home.tegel.opvragen': { nl: 'Opvragen', en: 'Request', ar: 'طلب المستندات' },
  // [KANTOORGIDS] De tegel naar de eigen vermelding. Kort, want het is een naam en geen zin.
  'bh.home.tegel.gids': { nl: 'Kantoorgids', en: 'Office directory', ar: 'دليل المكاتب' },
  'bh.home.tegel.bevestigen': { nl: 'Bevestigen', en: 'Confirm', ar: 'تأكيد' },
  'bh.home.tegel.bestanden': { nl: 'Bestanden', en: 'Files', ar: 'الملفات' },
  'bh.home.tegel.instellingen': { nl: 'Instellingen', en: 'Settings', ar: 'الإعدادات' },
  'bh.home.verder.kop': { nl: 'Ga verder waar je gebleven bent', en: 'Continue where you left off', ar: 'تابع من حيث توقفت' },
  'bh.home.ai.eyebrow': { nl: 'AI Assistent', en: 'AI assistant', ar: 'مساعد الذكاء الاصطناعي' },
  'bh.home.ai.titel': { nl: 'Samen werken met AI ✨', en: 'Working together with AI ✨', ar: 'العمل مع الذكاء الاصطناعي ✨' },
  'bh.home.ai.uitleg': { nl: 'Schrijf wat je wilt doen — de AI stelt het voor je op.', en: 'Write what you want to do — the AI drafts it for you.', ar: 'اكتب ما تريد فعله — وسيصوغه لك الذكاء الاصطناعي.' },
  'bh.home.ai.placeholder': { nl: 'bijv. bereid BTW aangifte voor klant Jansen BV...', en: 'e.g. prepare the VAT return for client Jansen BV...', ar: 'مثلًا: جهّز إقرار ضريبة القيمة المضافة للعميل Jansen BV...' },
  'bh.home.ai.bezig': { nl: 'AI werkt...', en: 'AI is working...', ar: 'الذكاء الاصطناعي يعمل...' },
  'bh.home.ai.genereer': { nl: 'Genereer ✨', en: 'Generate ✨', ar: 'أنشئ ✨' },
  'bh.home.ai.onderwerp': { nl: 'Onderwerp: {onderwerp}', en: 'Subject: {onderwerp}', ar: 'الموضوع: {onderwerp}' },
  'bh.home.ai.kopieren': { nl: 'Kopiëren', en: 'Copy', ar: 'نسخ' },
  'bh.home.ai.opnieuw': { nl: 'Opnieuw', en: 'Again', ar: 'إعادة المحاولة' },
  'bh.home.ai.teVeel': { nl: 'Even te veel aanvragen', en: 'A few too many requests', ar: 'طلبات كثيرة الآن' },
  'bh.home.ai.mislukt': { nl: 'Het lukte niet', en: 'It did not work', ar: 'لم ينجح الأمر' },
  'bh.home.meldingenFout': {
    nl: 'We konden je meldingen nu niet ophalen. Probeer het zo meteen opnieuw.',
    ar: 'لم نتمكن من جلب إشعاراتك الآن. حاول مرة أخرى بعد قليل.',
    en: 'We could not fetch your notifications right now. Try again in a moment.',
  },
  'bh.home.ai.probeerStraks': { nl: 'Probeer het zo opnieuw.', en: 'Try again shortly.', ar: 'أعد المحاولة بعد قليل.' },
  'bh.home.ai.geenVerbinding': { nl: 'Geen verbinding', en: 'No connection', ar: 'لا يوجد اتصال' },
  'bh.home.ai.checkInternet': { nl: 'Controleer je internet en probeer opnieuw.', en: 'Check your internet and try again.', ar: 'تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.' },

  // ─── [BOEKHOUDER] Boekhouder · aangifte & status (AccountantWerkboard) ──────────────────────
  // ── [SNEL-BORD] Hoe oud de stand op het bord is ──────────────────────────────────────────────
  // Eén sleutel per band én per getal: "{n} {woord} geleden" werkt in het Nederlands en breekt de
  // Arabische congruentie en de Turkse klinkerharmonie (AGENTS.md), en n = 1 is in al die talen een
  // andere zin. Welke sleutel wanneer: ageMessageKey in readiness-cache.ts.
  'bh.stand.zojuist': { nl: 'stand van zojuist', ar: 'الحالة الآن', en: 'as of just now' },
  'bh.stand.minuut1': { nl: 'stand van 1 minuut geleden', ar: 'الحالة قبل دقيقة', en: 'as of 1 minute ago' },
  'bh.stand.minuten': { nl: 'stand van {n} minuten geleden', ar: 'الحالة قبل {n} دقيقة', en: 'as of {n} minutes ago' },
  'bh.stand.uur1': { nl: 'stand van 1 uur geleden', ar: 'الحالة قبل ساعة', en: 'as of 1 hour ago' },
  'bh.stand.uren': { nl: 'stand van {n} uur geleden', ar: 'الحالة قبل {n} ساعة', en: 'as of {n} hours ago' },
  'bh.stand.dag1': { nl: 'stand van gisteren', ar: 'حالة الأمس', en: 'as of yesterday' },
  'bh.stand.dagen': { nl: 'stand van {n} dagen geleden', ar: 'الحالة قبل {n} أيام', en: 'as of {n} days ago' },
  // De regel boven het bord, zolang er nog rijen van eerder op staan. Zij verdwijnt vanzelf.
  'bh.stand.bijwerken': {
    nl: 'Sommige cijfers hieronder zijn van eerder — bij elke rij staat van wanneer.',
    ar: 'بعض الأرقام أدناه من وقت سابق — وعند كل سطر مكتوب متى.',
    en: 'Some figures below are from earlier — each row says when.',
  },
  // [NO-SILENT-EMPTY] En als het bijwerken mislukt: het oude cijfer blijft staan, maar nooit alsof
  // het vers is. Een stand die niet kon worden nagerekend mag niet als een oordeel lezen.
  'bh.stand.mislukt': {
    nl: 'kon niet worden bijgewerkt',
    ar: 'تعذّر تحديثها',
    en: 'could not be refreshed',
  },
  'bh.werk.vernieuwen': { nl: 'Vernieuwen', ar: 'تحديث', en: 'Refresh' },
  'bh.werk.hero.btwAangifte': { nl: 'BTW-aangifte {kwartaal}', ar: 'إقرار ضريبة القيمة المضافة {kwartaal}', en: 'VAT return {kwartaal}' },
  'bh.werk.hero.uiterlijk': { nl: 'Uiterlijk {datum}', ar: 'في موعد أقصاه {datum}', en: 'No later than {datum}' },
  'bh.werk.countdown.verlopenEen': { nl: '{n} dag verlopen', ar: 'تأخّر {n} يوم', en: '{n} day overdue' },
  'bh.werk.countdown.verlopenMeer': { nl: '{n} dagen verlopen', ar: 'متأخر {n} يومًا', en: '{n} days overdue' },
  'bh.werk.countdown.vandaag': { nl: 'Deadline is vandaag', ar: 'الموعد النهائي اليوم', en: 'Deadline is today' },
  'bh.werk.countdown.nogEen': { nl: 'Nog {n} dag', ar: 'بقي {n} يوم', en: '{n} day left' },
  'bh.werk.countdown.nogMeer': { nl: 'Nog {n} dagen', ar: 'بقي {n} أيام', en: '{n} days left' },
  'bh.werk.jaar.vorig': { nl: 'Vorig jaar', ar: 'السنة السابقة', en: 'Previous year' },
  'bh.werk.jaar.volgend': { nl: 'Volgend jaar', ar: 'السنة التالية', en: 'Next year' },
  'bh.werk.telling.klaar': { nl: 'Klaar', ar: 'جاهز', en: 'Ready' },
  'bh.werk.telling.bijna': { nl: 'Bijna', ar: 'تقريبًا', en: 'Almost' },
  'bh.werk.telling.nogNiet': { nl: 'Nog niet', ar: 'ليس بعد', en: 'Not yet' },
  'bh.werk.status.ready': { nl: 'Klaar', ar: 'جاهز', en: 'Ready' },
  'bh.werk.status.almost': { nl: 'Bijna klaar', ar: 'شبه جاهز', en: 'Almost ready' },
  'bh.werk.status.attention': { nl: 'Nog niet', ar: 'ليس بعد', en: 'Not yet' },
  'bh.werk.filter.alle': { nl: 'Alle klanten', ar: 'كل العملاء', en: 'All clients' },
  'bh.werk.filter.actie': { nl: 'Actie nodig', ar: 'يتطلب إجراء', en: 'Action needed' },
  'bh.werk.zoek.placeholder': { nl: 'Zoek klant…', ar: 'ابحث عن عميل…', en: 'Search client…' },
  'bh.werk.zoek.aria': { nl: 'Klanten zoeken', ar: 'البحث عن العملاء', en: 'Search clients' },
  'bh.werk.zoek.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'bh.werk.csv': { nl: 'Alle klanten (CSV)', ar: 'كل العملاء (CSV)', en: 'All clients (CSV)' },
  'bh.werk.leeg.geenKlanten': { nl: 'Nog geen klanten gekoppeld', ar: 'لا يوجد عملاء مرتبطون بعد', en: 'No clients linked yet' },
  'bh.werk.leeg.geenTreffer': { nl: 'Geen klanten gevonden voor “{zoekterm}”', ar: 'لا عملاء مطابقون لـ “{zoekterm}”', en: 'No clients found for “{zoekterm}”' },
  'bh.werk.leeg.allemaalKlaar': { nl: 'Alle klanten zijn klaar 🎉', ar: 'كل العملاء جاهزون 🎉', en: 'All clients are ready 🎉' },
  'bh.werk.rij.controleren': { nl: 'Controleren…', ar: 'جارٍ التحقق…', en: 'Checking…' },
  'bh.werk.rij.koppelingVerbroken': { nl: 'Koppeling verbroken', ar: 'انقطع الربط', en: 'Link disconnected' },
  'bh.werk.rij.statusOnbekend': { nl: 'Kon status niet laden', ar: 'تعذّر تحميل الحالة', en: 'Could not load status' },
  'bh.werk.rij.compleet': { nl: '{score}% compleet', ar: '{score}% مكتمل', en: '{score}% complete' },
  'bh.werk.rij.ontbreekt': { nl: '{n} ontbreekt', ar: 'ينقص {n}', en: '{n} missing' },
  'bh.werk.rij.nakijken': { nl: '{n} nakijken', ar: '{n} للمراجعة', en: '{n} to check' },
  'bh.werk.herinner': { nl: 'Herinner', ar: 'ذكِّر', en: 'Remind' },
  'bh.werk.versturen': { nl: 'Versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'bh.werk.verstuurd': { nl: 'Verstuurd', ar: 'أُرسل', en: 'Sent' },
  'bh.werk.mislukt': { nl: 'Mislukt · opnieuw', ar: 'فشل · أعد المحاولة', en: 'Failed · retry' },
  'bh.werk.meer': { nl: '+{n} meer', ar: '+{n} أخرى', en: '+{n} more' },
  'bh.werk.pakket': { nl: 'Pakket', ar: 'الحزمة', en: 'Package' },
  'bh.werk.jaarKnop': { nl: 'Jaar', ar: 'السنة', en: 'Year' },
  // [JOURNAAL-BRON] Grootboek blijft Grootboek in elke taal — het is het woord van het vak,
  // dezelfde regel die btw en kvk volgen.
  'bh.werk.grootboekKnop': { nl: 'Grootboek', ar: 'دفتر الأستاذ', en: 'Grootboek' },
  'bh.werk.verstuurHerinnering': { nl: 'Verstuur herinnering', ar: 'أرسل التذكير', en: 'Send reminder' },
  'bh.werk.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bh.werk.melding': { nl: 'De klant krijgt dit als melding in de app (geen e-mail).', ar: 'يصل هذا إلى العميل كإشعار داخل التطبيق (وليس بريدًا إلكترونيًا).', en: 'The client receives this as an in-app notification (no e-mail).' },
  'bh.werk.voetnoot': { nl: 'Dezelfde score als de klant ziet op “Ben ik klaar?”. “Herinner” stuurt de klant een melding in de app, na jouw bevestiging.', ar: 'النتيجة نفسها التي يراها العميل في «هل أنا جاهز؟». «تذكير» يرسل للعميل إشعارًا داخل التطبيق، بعد تأكيدك.', en: 'The same score the client sees on “Am I ready?”. “Remind” sends the client an in-app notification, after you confirm.' },

  // ─── [BOEKHOUDER] Boekhouder · factureren namens een klant (AccountantFactuur) ──────────────
  'bh.fact.titel': { nl: 'Factureren namens een klant', ar: 'إصدار فاتورة نيابةً عن عميل', en: 'Invoicing on behalf of a client' },
  'bh.fact.ondertitel': { nl: 'De factuur gaat uit op naam van je klant, niet op die van jou.', ar: 'تصدر الفاتورة باسم عميلك، لا باسمك أنت.', en: 'The invoice goes out in the name of your client, not in yours.' },
  'bh.fact.geenMachtiging': { nl: 'Nog geen enkele klant heeft je hiervoor gemachtigd.', ar: 'لم يفوّضك أي عميل بذلك حتى الآن.', en: 'No client has authorised you for this yet.' },
  'bh.fact.geenMachtigingUitleg': { nl: 'Factureren namens iemand is iets anders dan zijn administratie inzien. Je klant zet het zelf aan bij Instellingen → Mijn boekhouder, en daar ook weer uit.', ar: 'إصدار فواتير نيابةً عن شخص شيء آخر غير الاطّلاع على إدارته. عميلك يفعّل ذلك بنفسه في «Instellingen → Mijn boekhouder»، ويوقفه هناك أيضاً.', en: 'Invoicing on someone\'s behalf is not the same as viewing their administratie. Your client switches it on themselves under Instellingen → Mijn boekhouder, and off again there.' },
  'bh.fact.geenMachtigingWet': { nl: 'De factuur komt op zijn naam, in zijn nummerreeks en onder zijn BTW-nummer — hij blijft er zelf verantwoordelijk voor (art. 35a Wet OB). Daarom vraagt de app het hem.', ar: 'تصدر الفاتورة باسمه، ضمن سلسلة أرقامه وتحت رقم btw الخاص به — وتبقى مسؤوليته هو (art. 35a Wet OB). لذلك يطلبها التطبيق منه.', en: 'The invoice goes out in their name, in their number series and under their BTW number — they stay responsible for it themselves (art. 35a Wet OB). That is why the app asks them.' },
  'bh.fact.namensLabel': { nl: 'Namens welke klant?', ar: 'نيابةً عن أي عميل؟', en: 'On behalf of which client?' },
  'bh.fact.kiesKlantOptie': { nl: 'Kies een klant…', ar: 'اختر عميلًا…', en: 'Choose a client…' },
  'bh.fact.mandaat': { nl: 'Deze factuur komt op naam van {naam}, met zijn nummerreeks. Hij krijgt bericht zodra hij verstuurd is en kan de machtiging altijd zelf intrekken.', ar: 'تصدر هذه الفاتورة باسم {naam}، ضمن سلسلة أرقامه. يصله إشعار فور إرسالها ويمكنه سحب التفويض بنفسه في أي وقت.', en: 'This invoice goes out in the name of {naam}, in their number series. They are notified as soon as it is sent and can withdraw the mandate themselves at any time.' },
  'bh.fact.mandaatBtw': { nl: 'Deze factuur komt op naam van {naam}, met zijn nummerreeks en BTW-nummer {btw}. Hij krijgt bericht zodra hij verstuurd is en kan de machtiging altijd zelf intrekken.', ar: 'تصدر هذه الفاتورة باسم {naam}، ضمن سلسلة أرقامه وتحت رقم btw {btw}. يصله إشعار فور إرسالها ويمكنه سحب التفويض بنفسه في أي وقت.', en: 'This invoice goes out in the name of {naam}, in their number series and under BTW number {btw}. They are notified as soon as it is sent and can withdraw the mandate themselves at any time.' },
  'bh.fact.aanWie': { nl: 'Aan wie stuurt {naam} deze factuur?', ar: 'إلى من يرسل {naam} هذه الفاتورة؟', en: 'Who is {naam} sending this invoice to?' },
  'bh.fact.jeKlant': { nl: 'je klant', ar: 'عميلك', en: 'your client' },
  'bh.fact.labelNaam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'bh.fact.labelEmail': { nl: 'E-mailadres', ar: 'البريد الإلكتروني', en: 'E-mail address' },
  'bh.fact.labelAdres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'bh.fact.labelPostcode': { nl: 'Postcode', ar: 'الرمز البريدي', en: 'Postcode' },
  'bh.fact.labelPlaats': { nl: 'Plaats', ar: 'المدينة', en: 'City' },
  'bh.fact.labelBtw': { nl: 'BTW-nummer (optioneel)', ar: 'رقم btw (اختياري)', en: 'BTW number (optional)' },
  'bh.fact.labelDatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'bh.fact.watGeleverd': { nl: 'Wat is er geleverd?', ar: 'ما الذي تم تسليمه؟', en: 'What was delivered?' },
  'bh.fact.phOmschrijving': { nl: 'Omschrijving', ar: 'الوصف', en: 'Description' },
  'bh.fact.ariaOmschrijving': { nl: 'Omschrijving regel {n}', ar: 'وصف السطر {n}', en: 'Description, line {n}' },
  'bh.fact.phAantal': { nl: 'Aantal', ar: 'الكمية', en: 'Quantity' },
  'bh.fact.ariaAantal': { nl: 'Aantal regel {n}', ar: 'كمية السطر {n}', en: 'Quantity, line {n}' },
  'bh.fact.ariaEenheid': { nl: 'Eenheid regel {n}', ar: 'وحدة السطر {n}', en: 'Unit, line {n}' },
  'bh.fact.phPrijs': { nl: 'Prijs', ar: 'السعر', en: 'Price' },
  'bh.fact.ariaPrijs': { nl: 'Prijs regel {n}', ar: 'سعر السطر {n}', en: 'Price, line {n}' },
  'bh.fact.ariaBtw': { nl: 'BTW regel {n}', ar: 'btw للسطر {n}', en: 'VAT, line {n}' },
  'bh.fact.btwTarief': { nl: '{tarief}% BTW', ar: '{tarief}% btw', en: '{tarief}% VAT' },
  'bh.fact.regelErbij': { nl: '+ Regel erbij', ar: '+ سطر إضافي', en: '+ Add a line' },
  'bh.fact.subtotaal': { nl: 'Subtotaal', ar: 'المجموع الفرعي', en: 'Subtotal' },
  'bh.fact.btw': { nl: 'BTW', ar: 'الضريبة', en: 'VAT' },
  'bh.fact.totaal': { nl: 'Totaal', ar: 'الإجمالي', en: 'Total' },
  'bh.fact.bezig': { nl: 'Bezig met versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'bh.fact.verstuurNamens': { nl: 'Verstuur namens {naam}', ar: 'أرسل نيابةً عن {naam}', en: 'Send on behalf of {naam}' },
  'bh.fact.kiesEerst': { nl: 'Kies eerst een klant', ar: 'اختر عميلاً أولاً', en: 'Choose a client first' },
  'bh.fact.nummerWaarschuwing': { nl: 'Versturen geeft het factuurnummer uit, en dat is definitief (art. 35 Wet OB). Corrigeren gaat met een creditnota.', ar: 'عند الإرسال يصدر رقم الفاتورة، ويصبح نهائيًا (art. 35 Wet OB). ويُجرى التصحيح عبر إشعار دائن.', en: 'Sending issues the invoice number, and that is final (art. 35 Wet OB). You correct with a creditnota.' },
  'bh.fact.foutKiesKlant': { nl: 'Kies eerst voor welke klant je factureert.', ar: 'اختر أولًا العميل الذي تصدر الفاتورة نيابةً عنه.', en: 'First choose which client you are invoicing for.' },
  'bh.fact.foutOntvanger': { nl: 'Vul in aan wie de factuur gericht is.', ar: 'أدخل الجهة التي توجَّه إليها الفاتورة.', en: 'Fill in who the invoice is addressed to.' },
  'bh.fact.foutRegel': { nl: 'Vul minstens één regel in met een omschrijving en een bedrag.', ar: 'أدخل سطرًا واحدًا على الأقل مع وصف ومبلغ.', en: 'Fill in at least one line with a description and an amount.' },
  // [REGEL-ZONDER-OMSCHRIJVING] Een regel met een bedrag en geen omschrijving werd stil weggelaten
  // uit de factuur terwijl hij WEL in het totaal op het scherm stond. Het factuurnummer is dan al
  // vergeven en de klant betaalt het lagere bedrag; herstellen kost een creditnota. Weigeren dus,
  // met het regelnummer erbij — "er klopt iets niet" zonder te zeggen wát is geen foutmelding.
  'bh.fact.foutOmschrijving': { nl: 'Regel {nummer} heeft een bedrag maar geen omschrijving. Vul hem in of maak het bedrag leeg — anders staat er straks een ander totaal op de factuur.', ar: 'السطر {nummer} فيه مبلغ بلا وصف. أكمِله أو امسح المبلغ — وإلا ظهر على الفاتورة إجمالي مختلف.', en: 'Line {nummer} has an amount but no description. Fill it in or clear the amount — otherwise the invoice will show a different total.', tr: '{nummer}. satırda tutar var ama açıklama yok. Doldurun ya da tutarı silin — aksi hâlde faturada farklı bir toplam çıkar.' },
  'bh.fact.foutConcept': { nl: 'Het concept kon niet worden aangemaakt.', ar: 'تعذّر إنشاء المسودة.', en: 'The draft could not be created.' },
  'bh.fact.foutVersturen': { nl: 'Het concept staat klaar, maar versturen lukte niet. Probeer het opnieuw vanaf de factuur zelf.', ar: 'المسودة جاهزة، لكن الإرسال لم ينجح. حاول مرة أخرى من الفاتورة نفسها.', en: 'The draft is ready, but sending failed. Try again from the invoice itself.' },
  'bh.fact.foutOnbekend': { nl: 'Er ging iets mis. Probeer het opnieuw.', ar: 'حدث خطأ ما. حاول مرة أخرى.', en: 'Something went wrong. Try again.' },

  // ─── [BOEKHOUDER] Boekhouder · inkoopfacturen bevestigen (AccountantBevestigen) ─────────────
  'bh.bev.titel': { nl: 'Bevestigen', ar: 'تأكيد', en: 'Confirm' },
  'bh.bev.subtitel': { nl: 'Deze stukken houden een kwartaal tegen — bevestig wat klopt.', ar: 'هذه المستندات تعطّل ربعًا كاملًا — أكّد ما هو صحيح.', en: 'These documents are holding up a quarter — confirm what is correct.' },
  'bh.bev.leeg': { nl: 'Er staat niets te wachten. Bij je gemachtigde klanten is elke inkoopfactuur bevestigd.', ar: 'لا شيء في الانتظار. لدى العملاء الذين فوّضوك، كل فاتورة شراء مؤكدة.', en: 'Nothing is waiting. At the clients who authorised you, every purchase invoice is confirmed.' },
  'bh.bev.uitleg': { nl: 'Je bevestigt de lezing, je verandert er niets aan. Klopt een bedrag niet? Bevestig dan niet en vraag het je klant. Elke bevestiging draagt jouw naam en meldt hem — de verantwoordelijkheid blijft bij hem (art. 52 AWR).', ar: 'أنت تؤكد القراءة ولا تغيّر فيها شيئًا. مبلغ غير صحيح؟ فلا تؤكد واسأل عميلك. كل تأكيد يحمل اسمك ويُعلم عميلك — والمسؤولية تبقى عليه (art. 52 AWR).', en: 'You confirm the reading, you change nothing about it. Is an amount wrong? Then do not confirm and ask your client. Every confirmation carries your name and notifies him — the responsibility stays with him (art. 52 AWR).' },
  'bh.bev.wacht.een': { nl: 'stuk wacht op bevestiging', ar: 'مستند بانتظار التأكيد', en: 'document waiting for confirmation' },
  'bh.bev.wacht.meer': { nl: 'stukken wachten op bevestiging', ar: 'مستندات بانتظار التأكيد', en: 'documents waiting for confirmation' },
  'bh.bev.actie.bevestigen': { nl: 'Bevestigen', ar: 'تأكيد', en: 'Confirm' },
  'bh.bev.actie.bevestigd': { nl: 'Bevestigd', ar: 'مؤكَّد', en: 'Confirmed' },
  'bh.bev.actie.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'bh.bev.actie.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  // [NO-SILENT-EMPTY] De derde lege staat: niet 'niets te doen' en niet 'geen machtiging', maar
  // 'we konden het niet lezen'. De zin noemt expliciet wat het NIET betekent, omdat de boekhouder
  // die twee andere schermen kent en er anders een van invult.
  'bh.bev.leesfout.kop': { nl: 'We konden je stapel nu niet lezen.', ar: 'تعذّرت قراءة قائمتك الآن.', en: 'We could not read your stack just now.' },
  'bh.bev.leesfout.uitleg': { nl: 'Dit betekent niet dat er niets wacht, en het betekent niet dat je geen machtiging hebt: alleen de lezing misging. Ververs de pagina.', ar: 'هذا لا يعني أنه لا شيء ينتظر، ولا يعني أنك بلا تفويض: أخفقت القراءة فقط. أعد تحميل الصفحة.', en: 'This does not mean nothing is waiting, and it does not mean you have no authorisation: only the read failed. Refresh the page.' },
  'bh.bev.meer': { nl: 'Dit zijn de oudste 500. Er wachten er nog {aantal} meer.', ar: 'هذه أقدم 500. وما زال ينتظر {aantal} غيرها.', en: 'These are the oldest 500. Another {aantal} are still waiting.' },
  'bh.bev.geenMandaat.kop': { nl: 'Nog geen enkele klant heeft je gemachtigd om zijn inkoopfacturen te bevestigen.', ar: 'لم يفوّضك أي عميل بعد لتأكيد فواتير مشترياته.', en: 'No client has authorised you to confirm their purchase invoices yet.' },
  'bh.bev.geenMandaat.anders': { nl: 'Een andere machtiging dan die om te factureren — een klant kan er één geven en de ander niet.', ar: 'تفويض مختلف عن تفويض إصدار الفواتير — قد يمنح العميل أحدهما دون الآخر.', en: 'A different authorisation from the one for invoicing — a client can grant one and not the other.' },
  'bh.bev.geenMandaat.zetAan': { nl: 'Hij zet het zelf aan bij', ar: 'وهو يفعّله بنفسه من', en: 'He turns it on himself under' },
  'bh.bev.geenMandaat.plek': { nl: 'Instellingen → Jouw boekhouder', ar: 'Instellingen → Jouw boekhouder', en: 'Instellingen → Jouw boekhouder' },
  'bh.bev.geenMandaat.waarom': { nl: 'Zolang een inkoopfactuur onbevestigd is, valt hij buiten het kwartaalpakket en blijft het kwartaal op "niet klaar". Zonder deze machtiging kan alleen je klant dat openen.', ar: 'ما دامت فاتورة الشراء غير مؤكدة فهي خارج ملف الربع ويظل الربع على "niet klaar". وبدون هذا التفويض لا يفتح ذلك سوى عميلك.', en: 'As long as a purchase invoice is unconfirmed it falls outside the quarter package and the quarter stays on "niet klaar". Without this authorisation only your client can open that.' },
  'bh.bev.sel.een': { nl: '1 factuur geselecteerd', ar: 'تم تحديد فاتورة واحدة', en: '1 invoice selected' },
  'bh.bev.sel.meer': { nl: '{aantal} facturen geselecteerd', ar: 'تم تحديد {aantal} فاتورة', en: '{aantal} invoices selected' },
  'bh.bev.sel.wis': { nl: 'Wis selectie', ar: 'مسح التحديد', en: 'Clear selection' },
  'bh.bev.rij.selecteer': { nl: 'Selecteer {leverancier} voor bevestigen', ar: 'حدّد {leverancier} للتأكيد', en: 'Select {leverancier} for confirmation' },
  'bh.bev.rij.factuur': { nl: 'factuur', ar: 'فاتورة', en: 'invoice' },
  'bh.bev.rij.onbekendeLeverancier': { nl: 'Onbekende leverancier', ar: 'مورّد غير معروف', en: 'Unknown supplier' },
  'bh.bev.rij.zonderNummer': { nl: 'zonder nummer', ar: 'بدون رقم', en: 'without number' },
  'bh.bev.rij.datumOnbekend': { nl: 'datum onbekend', ar: 'تاريخ غير معروف', en: 'date unknown' },
  'bh.bev.rij.waarvanBtw': { nl: 'waarvan {bedrag} btw', ar: 'منها {bedrag} btw', en: 'of which {bedrag} btw' },
  // [CREDIT-BEVESTIG] Waarom deze rij niet te bevestigen is, en wat de boekhouder in plaats
  // daarvan doet. De reden staat erbij, want "kan niet" zonder waarom is een doodlopend scherm.
  'bh.bev.rij.creditTegenTeken': {
    nl: 'Creditnota met een positief bedrag. Zo bevestigd telt hij als kosten en vraagt hij btw terug die eraf hoort. Laat de ondernemer het bedrag corrigeren — daarna kun je bevestigen.',
    ar: 'إشعار دائن بمبلغ موجب. تأكيده هكذا يجعله يُحتسب كتكلفة ويسترجع ضريبة يجب طرحها. دع صاحب العمل يصحّح المبلغ — ثم يمكنك التأكيد.',
    en: 'A credit note with a positive amount. Confirmed like this it counts as a cost and reclaims VAT that should come off. Have the owner correct the amount — then you can confirm.',
    tr: 'Pozitif tutarlı bir alacak dekontu. Bu hâliyle onaylanırsa gider sayılır ve düşülmesi gereken KDV\'yi geri ister. Tutarı işletme sahibine düzelttirin — sonra onaylayabilirsiniz.',
  },
  'bh.bev.rij.twijfels': { nl: 'Dit konden wij niet zeker lezen: {twijfels}. Controleer het aan het document zelf voor je bevestigt.', ar: 'لم نتمكّن من قراءة هذا بثقة: {twijfels}. تحقّق منه في المستند نفسه قبل أن تؤكد.', en: 'We could not read this with certainty: {twijfels}. Check it against the document itself before you confirm.' },
  'bh.bev.rij.vraagVerstuurd': { nl: 'Vraag verstuurd', ar: 'تم إرسال السؤال', en: 'Question sent' },
  'bh.bev.rij.kloptNiet': { nl: 'Klopt niet — vraag stellen', ar: 'غير صحيح — اطرح سؤالًا', en: 'Not correct — ask a question' },
  'bh.bev.bulk.titelEen': { nl: '1 factuur bevestigen ({bedrag})?', ar: 'تأكيد فاتورة واحدة ({bedrag})؟', en: 'Confirm 1 invoice ({bedrag})?' },
  'bh.bev.bulk.titelMeer': { nl: '{aantal} facturen bevestigen ({bedrag})?', ar: 'تأكيد {aantal} فاتورة ({bedrag})؟', en: 'Confirm {aantal} invoices ({bedrag})?' },
  'bh.bev.bulk.titelMeerKlanten': { nl: '{aantal} facturen bevestigen bij {klanten} klanten ({bedrag})?', ar: 'تأكيد {aantal} فاتورة لدى {klanten} عملاء ({bedrag})؟', en: 'Confirm {aantal} invoices at {klanten} clients ({bedrag})?' },
  'bh.bev.bulk.blijftEen': { nl: '1 factuur blijft staan: de lezer kon die niet zeker lezen. Bevestig hem apart, met het document erbij.', ar: 'تبقى فاتورة واحدة كما هي: لم يستطع القارئ قراءتها بثقة. أكّدها على حدة، مع المستند أمامك.', en: '1 invoice stays put: the reader could not read it with certainty. Confirm it separately, with the document at hand.' },
  'bh.bev.bulk.blijftMeer': { nl: '{aantal} facturen blijven staan: de lezer kon die niet zeker lezen. Bevestig ze één voor één, met het document erbij.', ar: 'تبقى {aantal} فاتورة كما هي: لم يستطع القارئ قراءتها بثقة. أكّدها واحدة تلو الأخرى، مع المستند أمامك.', en: '{aantal} invoices stay put: the reader could not read them with certainty. Confirm them one by one, with the document at hand.' },
  'bh.bev.bulk.lezing': { nl: 'Je bevestigt de lezing — je verandert er niets aan. Elke bevestiging draagt jouw naam en meldt je klant; de verantwoordelijkheid blijft bij hem (art. 52 AWR).', ar: 'أنت تؤكد القراءة — ولا تغيّر فيها شيئًا. كل تأكيد يحمل اسمك ويُعلم عميلك؛ والمسؤولية تبقى عليه (art. 52 AWR).', en: 'You confirm the reading — you change nothing about it. Every confirmation carries your name and notifies your client; the responsibility stays with him (art. 52 AWR).' },
  'bh.bev.bulk.klanten': { nl: 'Deze facturen horen bij {klanten} verschillende klanten.', ar: 'هذه الفواتير تخص {klanten} عملاء مختلفين.', en: 'These invoices belong to {klanten} different clients.' },
  'bh.bev.bulk.ja': { nl: 'Ja, bevestigen', ar: 'نعم، أكّد', en: 'Yes, confirm' },
  'bh.bev.bulk.resultEen': { nl: '1 factuur bevestigd.', ar: 'تم تأكيد فاتورة واحدة.', en: '1 invoice confirmed.' },
  'bh.bev.bulk.resultMeer': { nl: '{aantal} facturen bevestigd.', ar: 'تم تأكيد {aantal} فاتورة.', en: '{aantal} invoices confirmed.' },
  'bh.bev.bulk.resultGeenEen': { nl: 'De factuur kon niet worden bevestigd — hij staat er nog.', ar: 'تعذّر تأكيد الفاتورة — ما زالت في القائمة.', en: 'The invoice could not be confirmed — it is still there.' },
  'bh.bev.bulk.resultGeenMeer': { nl: 'Geen van de {aantal} facturen kon worden bevestigd — ze staan er nog.', ar: 'تعذّر تأكيد أي من الفواتير الـ {aantal} — ما زالت في القائمة.', en: 'None of the {aantal} invoices could be confirmed — they are still there.' },
  'bh.bev.bulk.resultDeels': { nl: '{gelukt} bevestigd, {mislukt} niet — die staan er nog en kun je apart proberen.', ar: 'تم تأكيد {gelukt}، وتعذّر {mislukt} — ما زالت في القائمة ويمكنك تجربتها على حدة.', en: '{gelukt} confirmed, {mislukt} not — those are still there and you can try them separately.' },
  'bh.bev.vraag.kop': { nl: 'Vraag over deze factuur', ar: 'سؤال عن هذه الفاتورة', en: 'Question about this invoice' },
  'bh.bev.vraag.factuurnummer': { nl: 'factuur {nummer}', ar: 'فاتورة {nummer}', en: 'invoice {nummer}' },
  'bh.bev.vraag.gaatNaar': { nl: 'gaat naar {klant}', ar: 'تُرسل إلى {klant}', en: 'goes to {klant}' },
  'bh.bev.vraag.placeholder': { nl: 'Bijvoorbeeld: is dit zakelijk of privé? Of: klopt het btw-bedrag hier?', ar: 'مثلًا: هل هذا مصروف تجاري أم خاص؟ أو: هل مبلغ ضريبة القيمة المضافة هنا صحيح؟', en: 'For example: is this business or private? Or: is the btw amount here correct?' },
  'bh.bev.vraag.melding': { nl: 'je klant krijgt een melding en kan hier antwoorden', ar: 'يصل عميلك إشعار ويمكنه الرد هنا', en: 'your client gets a notification and can answer here' },
  'bh.bev.vraag.versturen': { nl: 'Vraag versturen', ar: 'إرسال السؤال', en: 'Send question' },
  'bh.bev.vraag.mislukt': { nl: 'De vraag kon niet worden verstuurd.', ar: 'تعذّر إرسال السؤال.', en: 'The question could not be sent.' },
  'bh.bev.fout.bevestigen': { nl: 'Bevestigen mislukt.', ar: 'فشل التأكيد.', en: 'Confirmation failed.' },
  'bh.bev.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },

  // ─── [BOEKHOUDER] Boekhouder · openstaand + machtiging vragen (AccountantDebiteuren, VraagMachtiging) 
  'bh.deb.titel': { nl: 'Openstaande facturen', ar: 'الفواتير غير المسدَّدة', en: 'Outstanding invoices' },
  'bh.deb.ondertitel': { nl: 'Oudste schuld bovenaan — niet het grootste bedrag.', ar: 'الأقدم في الأعلى — وليس الأكبر مبلغًا.', en: 'Oldest debt at the top — not the largest amount.' },
  'bh.deb.dagen.vandaag': { nl: 'vandaag vervallen', ar: 'تستحق اليوم', en: 'due today' },
  'bh.deb.dagen.een': { nl: '1 dag te laat', ar: 'متأخرة يومًا واحدًا', en: '1 day overdue' },
  'bh.deb.dagen.dagen': { nl: '{dagen} dagen te laat', ar: 'متأخرة {dagen} يومًا', en: '{dagen} days overdue' },
  'bh.deb.dagen.maanden': { nl: '{maanden} maanden te laat', ar: 'متأخرة {maanden} أشهر', en: '{maanden} months overdue' },
  'bh.deb.geenMandaat.kop': { nl: 'Nog geen enkele klant heeft je gemachtigd om namens hem te herinneren.', ar: 'لم يمنحك أي عميل بعد تفويضًا بإرسال تذكيرات نيابةً عنه.', en: 'No client has authorised you to send reminders on their behalf yet.' },
  'bh.deb.geenMandaat.uitleg1': { nl: 'Meekijken is iets anders dan mailen naar de klanten van je klant. Je klant zet het zelf aan bij', ar: 'الاطّلاع شيء، ومراسلة عملاء عميلك شيء آخر. يفعّل عميلك ذلك بنفسه من', en: 'Looking in is not the same as e-mailing your client\'s customers. Your client turns it on themselves under' },
  'bh.deb.geenMandaat.uitleg2': { nl: ', met dezelfde machtiging waarmee je ook namens hem kunt factureren.', ar: '، بالتفويض نفسه الذي يتيح لك أيضًا إصدار الفواتير نيابةً عنه.', en: ', with the same mandate that also lets you invoice on their behalf.' },
  'bh.deb.leeg.allesBetaald': { nl: 'Niets te laat. Bij geen van je gemachtigde klanten staat een vervallen factuur open.', ar: 'لا شيء متأخر. لا توجد فاتورة متأخرة لدى أي من عملائك المفوِّضين.', en: 'Nothing overdue. None of the clients who authorised you has an overdue invoice open.' },
  'bh.deb.totaal.enkelEnkel': { nl: 'te laat · {facturen} factuur bij {klanten} klant', ar: 'متأخرة · {facturen} فاتورة لدى {klanten} عميل', en: 'overdue · {facturen} invoice at {klanten} client' },
  'bh.deb.totaal.enkelMeer': { nl: 'te laat · {facturen} factuur bij {klanten} klanten', ar: 'متأخرة · {facturen} فاتورة لدى {klanten} عملاء', en: 'overdue · {facturen} invoice at {klanten} clients' },
  'bh.deb.totaal.meerEnkel': { nl: 'te laat · {facturen} facturen bij {klanten} klant', ar: 'متأخرة · {facturen} فواتير لدى {klanten} عميل', en: 'overdue · {facturen} invoices at {klanten} client' },
  'bh.deb.totaal.meerMeer': { nl: 'te laat · {facturen} facturen bij {klanten} klanten', ar: 'متأخرة · {facturen} فواتير لدى {klanten} عملاء', en: 'overdue · {facturen} invoices at {klanten} clients' },
  'bh.deb.totaal.geenHerinnerbaar': { nl: 'Vandaag kun je er geen enkele herinneren — per factuur staat hieronder waarom.', ar: 'لا يمكنك إرسال تذكير لأي منها اليوم — السبب مذكور أسفل كل فاتورة.', en: 'You cannot remind any of them today — the reason is below each invoice.' },
  'bh.deb.totaal.herinnerbaarEen': { nl: '{aantal} kan vandaag een herinnering krijgen.', ar: '{aantal} يمكن أن يحصل على تذكير اليوم.', en: '{aantal} can get a reminder today.' },
  'bh.deb.totaal.herinnerbaarMeer': { nl: '{aantal} kunnen vandaag een herinnering krijgen.', ar: '{aantal} يمكنهم الحصول على تذكير اليوم.', en: '{aantal} can get a reminder today.' },
  'bh.deb.totaal.namensKlant': { nl: 'De mail gaat uit op naam van je klant, en hij krijgt van elke herinnering bericht.', ar: 'يُرسَل البريد باسم عميلك، ويصله إشعار بكل تذكير.', en: 'The e-mail goes out in your client\'s name, and they are notified of every reminder.' },
  'bh.deb.groep.oudste': { nl: 'oudste:', ar: 'الأقدم:', en: 'oldest:' },
  'bh.deb.rij.onbekendeAfnemer': { nl: 'Onbekende afnemer', ar: 'عميل غير معروف', en: 'Unknown customer' },
  'bh.deb.rij.herinneringEen': { nl: '{aantal} herinnering verstuurd', ar: 'أُرسل {aantal} تذكير', en: '{aantal} reminder sent' },
  'bh.deb.rij.herinneringMeer': { nl: '{aantal} herinneringen verstuurd', ar: 'أُرسلت {aantal} تذكيرات', en: '{aantal} reminders sent' },
  'bh.deb.knop.herinner': { nl: 'Herinner', ar: 'ذكِّر', en: 'Remind' },
  'bh.deb.knop.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'bh.deb.status.verstuurd': { nl: 'Herinnering verstuurd', ar: 'تم إرسال التذكير', en: 'Reminder sent' },
  'bh.deb.fout.herinneringMislukt': { nl: 'De herinnering kon niet worden verstuurd.', ar: 'تعذّر إرسال التذكير.', en: 'The reminder could not be sent.' },
  'bh.deb.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'bh.deb.voet': { nl: 'Na drie herinneringen stopt deze knop. Een aanmaning of incasso heeft gevolgen die de ondernemer zelf moet willen (art. 6:96 BW) — dus geen knop hier.', ar: 'يتوقف هذا الزر بعد ثلاثة تذكيرات. الإنذار أو التحصيل له تبعات يجب أن يريدها صاحب العمل بنفسه (art. 6:96 BW) — لذلك لا زر هنا.', en: 'After three reminders this button stops. A formal demand or debt collection has consequences the entrepreneur must want themselves (art. 6:96 BW) — so no button here.' },
  'bh.macht.kop': { nl: 'Vraag het je klant', ar: 'اطلب ذلك من عميلك', en: 'Ask your client' },
  'bh.macht.uitleg': { nl: 'Hij krijgt een bericht: wat je vraagt, wat dat wel en niet toestaat, en de knop. Beslissen doet hij zelf.', ar: 'يصله إشعار: ما تطلبه، وما يتيحه وما لا يتيحه، والزر. والقرار قراره وحده.', en: 'They get a message: what you ask, what it does and does not allow, and the button. They decide themselves.' },
  'bh.macht.kiesLabel': { nl: 'Klant om te vragen', ar: 'العميل المراد سؤاله', en: 'Client to ask' },
  'bh.macht.kiesPlaceholder': { nl: 'Kies een klant…', ar: 'اختر عميلًا…', en: 'Choose a client…' },
  'bh.macht.knop.vraag': { nl: 'Vraag toestemming', ar: 'اطلب الإذن', en: 'Ask for permission' },
  'bh.macht.knop.gevraagd': { nl: 'Gevraagd', ar: 'تم الطلب', en: 'Asked' },
  'bh.macht.knop.bezig': { nl: 'Bezig…', ar: 'جارٍ التنفيذ…', en: 'Working…' },
  'bh.macht.gevraagdMelding': { nl: 'Gevraagd. Zodra hij het aanzet, staat deze pagina vol.', ar: 'تم الطلب. وبمجرد أن يفعّله، ستمتلئ هذه الصفحة.', en: 'Asked. As soon as they turn it on, this page fills up.' },
  'bh.macht.fout.mislukt': { nl: 'Vragen mislukt.', ar: 'تعذّر إرسال الطلب.', en: 'The request failed.' },
  'bh.macht.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'bh.macht.voet': { nl: 'Eén keer vragen is genoeg. Sneller antwoord? Bel even — daar is met opzet geen knop voor.', ar: 'يكفي أن تسأل مرة واحدة. تريد ردًا أسرع؟ اتصل به — لا يوجد زر لذلك، وهذا مقصود.', en: 'Asking once is enough. Want a faster answer? Give them a call — there is deliberately no button for that.' },

  // ─── [BOEKHOUDER] Boekhouder · stukken opvragen (AccountantOpvragen) ────────────────────────
  'bh.opvr.titel': { nl: 'Stukken opvragen', ar: 'طلب المستندات', en: 'Request documents' },
  'bh.opvr.intro': { nl: 'Eén bericht met precies wat er nog mist — in zijn inbox en in zijn mail.', ar: 'رسالة واحدة تحتوي بالضبط على ما ينقص — في صندوق الوارد لديه وبريده الإلكتروني.', en: 'One message with exactly what is still missing — in their inbox and in their e-mail.' },
  'bh.opvr.geenKlanten': { nl: 'Je hebt nog geen gekoppelde klanten. Nodig er een uit bij', ar: 'ليس لديك عملاء مرتبطون بعد. ادعُ عميلاً من', en: 'You have no linked clients yet. Invite one from' },
  'bh.opvr.klant': { nl: 'Klant', ar: 'العميل', en: 'Client' },
  'bh.opvr.kiesKlant': { nl: 'Kies een klant…', ar: 'اختر عميلًا…', en: 'Choose a client…' },
  'bh.opvr.kwartaal': { nl: 'Kwartaal', ar: 'الربع', en: 'Quarter' },
  'bh.opvr.mistIn': { nl: 'Wat BoekBrug mist in {kwartaal}', ar: 'ما تفتقده BoekBrug في {kwartaal}', en: 'What BoekBrug is missing in {kwartaal}' },
  'bh.opvr.laden': { nl: 'Bezig met lezen…', ar: 'جارٍ القراءة…', en: 'Reading…' },
  'bh.opvr.geenGaten': { nl: 'BoekBrug ziet geen gaten in dit kwartaal — maar een bon die nooit is geüpload zien wij niet. Vraag hieronder zelf wat je mist.', ar: 'لا ترى BoekBrug نواقص في هذا الربع — لكن إيصالًا لم يُرفَع قط لا نراه. اطلب بنفسك أدناه ما ينقصك.', en: 'BoekBrug sees no gaps in this quarter — but a receipt that was never uploaded is invisible to us. Ask for what you miss yourself below.' },
  'bh.opvr.vinkUitleg': { nl: 'Haal weg wat je al weet: een bon die onderweg is, of een gat dat jouw werk is. Meer dan {max} punten leest niemand.', ar: 'أزل ما تعرفه مسبقاً: إيصال في الطريق، أو نقص هو من عملك أنت. لا أحد يقرأ أكثر من {max} نقاط.', en: 'Remove what you already know about: a receipt on its way, or a gap that is your own work. Nobody reads more than {max} points.' },
  'bh.opvr.eigenZin': { nl: 'Je eigen zin erbij (optioneel)', ar: 'جملة من عندك (اختياري)', en: 'Your own sentence (optional)' },
  'bh.opvr.voorbeeldKop': { nl: 'Dit krijgt {naam} te zien', ar: 'هذا ما سيراه {naam}', en: 'This is what {naam} will see' },
  'bh.opvr.jeKlant': { nl: 'je klant', ar: 'عميلك', en: 'your client' },
  'bh.opvr.verstuurd': { nl: 'Verstuurd. Het staat in zijn inbox en is per mail gegaan.', ar: 'تم الإرسال. الرسالة في صندوق الوارد لديه وأُرسلت أيضًا بالبريد الإلكتروني.', en: 'Sent. It is in their inbox and has gone out by e-mail.' },
  'bh.opvr.bezig': { nl: 'Bezig met versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'bh.opvr.verstuurNaar': { nl: 'Verstuur naar {naam}', ar: 'أرسل إلى {naam}', en: 'Send to {naam}' },
  'bh.opvr.voet': { nl: 'Het bericht staat op jouw naam, in dezelfde inbox als je gewone berichten. Hij kan direct antwoorden.', ar: 'تُرسَل الرسالة باسمك، في صندوق الوارد نفسه لرسائلك العادية. ويمكنه الرد مباشرة.', en: 'The message goes out in your name, in the same inbox as your ordinary messages. They can reply directly.' },
  'bh.opvr.fout.lezen': { nl: 'Kon het kwartaal niet lezen.', ar: 'تعذّرت قراءة بيانات الربع.', en: 'Could not read the quarter.' },
  'bh.opvr.fout.versturen': { nl: 'Versturen mislukt.', ar: 'فشل الإرسال.', en: 'Sending failed.' },
  'bh.opvr.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },

  // ─── [BOEKHOUDER] Boekhouder · klanten beheren (KlantenBeheer) ──────────────────────────────
  'bh.klant.invite.title': { nl: 'Klant uitnodigen', ar: 'دعوة عميل', en: 'Invite client' },
  'bh.klant.invite.intro': { nl: 'Vul het e-mailadres van je klant in. Ze ontvangen een uitnodiging om BoekBrug te gebruiken.', ar: 'أدخل عنوان البريد الإلكتروني لعميلك. سيتلقّى دعوة لاستخدام BoekBrug.', en: 'Enter your client\'s e-mail address. They will receive an invitation to use BoekBrug.' },
  'bh.klant.invite.sending': { nl: 'Versturen...', ar: 'جارٍ الإرسال…', en: 'Sending...' },
  'bh.klant.invite.send': { nl: 'Nodig uit', ar: 'أرسل دعوة', en: 'Invite' },
  'bh.klant.invite.sent': { nl: '✓ Uitnodiging verstuurd.', ar: '✓ تم إرسال الدعوة.', en: '✓ Invitation sent.' },
  'bh.klant.invite.failed': { nl: 'Versturen mislukt.', ar: 'فشل الإرسال.', en: 'Sending failed.' },
  'bh.klant.error.network': { nl: 'Netwerkfout. Probeer het opnieuw.', ar: 'خطأ في الشبكة. حاول مرة أخرى.', en: 'Network error. Please try again.' },
  'bh.klant.error.networkShort': { nl: 'Netwerkfout.', ar: 'خطأ في الشبكة.', en: 'Network error.' },
  'bh.klant.bulk.toggle': { nl: 'Meerdere klanten tegelijk uitnodigen', ar: 'دعوة عدة عملاء دفعة واحدة', en: 'Invite several clients at once' },
  'bh.klant.bulk.intro': { nl: 'Plak e-mailadressen, één per regel of met komma\'s. Elk adres krijgt de uitnodiging hierboven; je ziet per adres of het lukte.', ar: 'الصق عناوين البريد الإلكتروني، عنوانًا في كل سطر أو مفصولة بفواصل. سيتلقى كل عنوان الدعوة أعلاه؛ وسترى لكل عنوان ما إذا نجح.', en: 'Paste e-mail addresses, one per line or comma-separated. Each address gets the invitation above; you see per address whether it worked.' },
  'bh.klant.bulk.sending': { nl: 'Versturen... ({count})', ar: 'جارٍ الإرسال... ({count})', en: 'Sending... ({count})' },
  'bh.klant.bulk.send': { nl: 'Verstuur alle uitnodigingen', ar: 'إرسال جميع الدعوات', en: 'Send all invitations' },
  'bh.klant.bulk.overflow': { nl: 'Meer dan 200 adressen: de eerste 200 zijn verstuurd, de laatste {count} niet. Plak die morgen opnieuw — de daglimiet is 200.', ar: 'أكثر من 200 عنوان: أُرسلت العناوين الـ200 الأولى، أما آخر {count} فلم تُرسل. الصقها غدًا من جديد — الحد اليومي 200.', en: 'More than 200 addresses: the first 200 were sent, the last {count} were not. Paste those again tomorrow — the daily limit is 200.' },
  'bh.klant.bulk.sentCount': { nl: '{count} verstuurd', ar: '{count} مُرسَلة', en: '{count} sent' },
  'bh.klant.bulk.failedCount': { nl: '{count} niet verstuurd', ar: '{count} لم تُرسَل', en: '{count} not sent' },
  'bh.klant.bulk.busy': { nl: 'bezig…', ar: 'جارٍ التنفيذ…', en: 'working…' },
  'bh.klant.list.title': { nl: 'Gekoppelde klanten', ar: 'العملاء المرتبطون', en: 'Linked clients' },
  'bh.klant.search.placeholder': { nl: 'Zoek klant op naam of e-mail…', ar: 'ابحث عن عميل بالاسم أو البريد الإلكتروني…', en: 'Search a client by name or e-mail…' },
  'bh.klant.search.aria': { nl: 'Klanten zoeken', ar: 'البحث عن العملاء', en: 'Search clients' },
  'bh.klant.search.clear': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'bh.klant.unreadable.line1': { nl: 'We konden je klantenlijst nu niet ophalen.', ar: 'تعذّر علينا جلب قائمة عملائك الآن.', en: 'We could not fetch your client list right now.' },
  'bh.klant.unreadable.line2': { nl: 'Dit zegt niets over je koppelingen: we konden ze niet lezen.', ar: 'هذا لا يقول شيئًا عن ارتباطاتك: لم نتمكّن من قراءتها.', en: 'This says nothing about your links: we could not read them.' },
  'bh.klant.list.empty': { nl: 'Nog geen klanten gekoppeld', ar: 'لا يوجد عملاء مرتبطون بعد', en: 'No clients linked yet' },
  'bh.klant.list.noMatch': { nl: 'Geen klanten gevonden voor “{query}”', ar: 'لم يُعثر على عملاء لـ «{query}»', en: 'No clients found for “{query}”' },
  'bh.klant.readiness.none': { nl: 'Geen facturen dit kwartaal', ar: 'لا فواتير هذا الربع', en: 'No invoices this quarter' },
  'bh.klant.readiness.processed': { nl: '{done}/{total} verwerkt · Bank {bank}', ar: '{done}/{total} مُعالَجة · البنك {bank}', en: '{done}/{total} processed · Bank {bank}' },
  // [NO-SILENT-EMPTY] De derde stand van een klantkaart: niet "niets te doen", maar "we konden het
  // niet lezen". Zonder deze regel stond er "0/0 verwerkt · Bank —" bij een klant die keurig
  // aanlevert, en dat is precies het soort zin waar een boekhouder op handelt zonder te twijfelen.
  'bh.klant.readiness.onleesbaar': { nl: 'Stand niet te lezen', ar: 'تعذّرت قراءة الحالة', en: 'Status could not be read' },
  'bh.klant.openQuestions': { nl: '{count} vraag', ar: '{count} سؤال', en: '{count} question' },
  'bh.klant.unlink.action': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Unlink' },
  'bh.klant.unlink.title': { nl: 'Klant ontkoppelen', ar: 'إلغاء ربط العميل', en: 'Unlink client' },
  'bh.klant.unlink.confirm': { nl: 'Weet je zeker dat je {name} wilt ontkoppelen? Je verliest toegang tot hun gegevens.', ar: 'هل أنت متأكد أنك تريد إلغاء الربط مع {name}؟ ستفقد الوصول إلى بياناتهم.', en: 'Are you sure you want to unlink {name}? You will lose access to their data.' },
  'bh.klant.unlink.busy': { nl: 'Verwijderen...', ar: 'جارٍ الحذف…', en: 'Removing...' },
  'bh.klant.unlink.failed': { nl: 'Verwijderen mislukt.', ar: 'فشل الحذف.', en: 'Removing failed.' },
  'bh.klant.cancel': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },

  // ─── [BOEKHOUDER] Boekhouder · het kwartaal en de gegevens van een klant ────────────────────
  'bh.kwt.actie.verwerkt': { nl: 'Verwerkt', ar: 'تمت المعالجة', en: 'Processed' },
  'bh.kwt.actie.inBehandeling': { nl: 'In behandeling', ar: 'قيد المعالجة', en: 'In progress' },
  'bh.kwt.actie.vraag': { nl: 'Vraag', ar: 'سؤال', en: 'Question' },
  'bh.kwt.sectie.debiteuren': { nl: 'Debiteuren', ar: 'الذمم المدينة', en: 'Receivables' },
  'bh.kwt.sectie.debiteurenSub': { nl: 'verzonden — nog te ontvangen', ar: 'مُرسَلة — لم تُحصَّل بعد', en: 'sent — not yet received' },
  'bh.kwt.sectie.crediteuren': { nl: 'Crediteuren', ar: 'الذمم الدائنة', en: 'Payables' },
  'bh.kwt.sectie.crediteurenSub': { nl: 'ontvangen — nog te betalen', ar: 'واردة — لم تُدفع بعد', en: 'received — not yet paid' },
  'bh.kwt.sectie.voldaan': { nl: 'Voldaan', ar: 'مسدَّدة', en: 'Settled' },
  'bh.kwt.sectie.voldaanSub': { nl: 'betaald', ar: 'مدفوعة', en: 'paid' },
  'bh.kwt.kop': { nl: 'Q{q} {jaar}', ar: 'الربع {q} {jaar}', en: 'Q{q} {jaar}' },
  'bh.kwt.kop.metKlant': { nl: 'Q{q} {jaar} — {klant}', ar: 'الربع {q} {jaar} — {klant}', en: 'Q{q} {jaar} — {klant}' },
  'bh.kwt.sorteerOudste': { nl: 'Oudste ↑', ar: 'الأقدم ↑', en: 'Oldest ↑' },
  'bh.kwt.sorteerNieuwste': { nl: 'Nieuwste ↓', ar: 'الأحدث ↓', en: 'Newest ↓' },
  'bh.kwt.laden': { nl: 'Laden...', ar: 'جارٍ التحميل…', en: 'Loading...' },
  'bh.kwt.documenten': { nl: 'Documenten — bekijk in Brug', ar: 'المستندات — عرضها في الجسر', en: 'Documents — view in Bridge' },
  'bh.kwt.pakketBezig': { nl: 'Kwartaalpakket genereren…', ar: 'جارٍ إنشاء حزمة الربع…', en: 'Generating quarter package…' },
  'bh.kwt.pakketDownload': { nl: 'Download kwartaalpakket (ZIP)', ar: 'تنزيل حزمة الربع (ZIP)', en: 'Download quarter package (ZIP)' },
  'bh.kwt.pakketMislukt': { nl: 'Pakket genereren mislukt — probeer opnieuw.', ar: 'تعذّر إنشاء الحزمة — حاول مرة أخرى.', en: 'Could not generate the package — please try again.' },
  'bh.kwt.omzet': { nl: 'Omzet (excl. BTW)', ar: 'الإيراد (بدون btw)', en: 'Turnover (excl. VAT)' },
  'bh.kwt.kosten': { nl: 'Kosten (excl. BTW)', ar: 'التكاليف (بدون btw)', en: 'Costs (excl. VAT)' },
  'bh.kwt.btwSaldo': { nl: 'BTW te betalen (5g)', ar: 'btw المستحقة (5g)', en: 'VAT to pay (5g)' },
  'bh.kwt.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'bh.kwt.zoekPlaceholder': { nl: 'Zoek op factuurnummer, klant of bedrag…', ar: 'ابحث برقم الفاتورة أو العميل أو المبلغ…', en: 'Search by invoice number, client or amount…' },
  'bh.kwt.zoekAria': { nl: 'Facturen zoeken', ar: 'البحث في الفواتير', en: 'Search invoices' },
  'bh.kwt.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'bh.kwt.leesfout': { nl: 'Facturen van dit kwartaal konden we niet ophalen; dat zegt niets over de administratie.', ar: 'تعذّر جلب فواتير هذا الربع؛ وهذا لا يقول شيئًا عن دفاترك.', en: 'We could not load this quarter\'s invoices; that says nothing about the books.' },
  'bh.kwt.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'bh.kwt.geenFacturen': { nl: 'Geen facturen in Q{q} {jaar}', ar: 'لا فواتير في الربع {q} {jaar}', en: 'No invoices in Q{q} {jaar}' },
  'bh.kwt.geenGevonden': { nl: 'Geen facturen gevonden voor “{zoek}”', ar: 'لا توجد فواتير مطابقة لـ«{zoek}»', en: 'No invoices found for “{zoek}”' },
  'bh.kwt.uitgaand': { nl: 'Uitg.', ar: 'صادر', en: 'Out' },
  'bh.kwt.inkomend': { nl: 'Ink.', ar: 'وارد', en: 'In' },
  'bh.kwt.verlopen': { nl: 'Verlopen', ar: 'متأخرة', en: 'Overdue' },
  'bh.kwt.creditnota': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },
  'bh.kwt.betaaldOp': { nl: 'betaald {datum}', ar: 'دُفعت في {datum}', en: 'paid {datum}' },
  'bh.kwt.statusLabel': { nl: 'Status', ar: 'الحالة', en: 'Status' },
  'bh.kwt.statusNietOpgeslagen': { nl: 'Status niet opgeslagen — probeer het opnieuw.', ar: 'لم تُحفظ الحالة — حاول مرة أخرى.', en: 'Status not saved — please try again.' },
  'bh.kwt.nietVerwerkt': { nl: 'Niet verwerkt', ar: 'غير مُعالجة', en: 'Not processed' },
  'bh.kwt.aan': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'bh.kwt.vervangt': { nl: 'Vervangt', ar: 'يحلّ محلّ', en: 'Replaces' },
  'bh.kwt.exclBtw': { nl: 'Excl. BTW', ar: 'بدون btw', en: 'Excl. VAT' },
  'bh.kwt.btwTarief': { nl: 'BTW {tarief}%', ar: 'ضريبة {tarief}%', en: 'VAT {tarief}%' },
  'bh.kwt.inclBtw': { nl: 'Incl. BTW', ar: 'شامل btw', en: 'Incl. VAT' },
  'bh.kwt.openen': { nl: 'Openen', ar: 'فتح', en: 'Open' },
  'bh.kwt.vraag.titel': { nl: 'Vraag aan de klant', ar: 'سؤال إلى العميل', en: 'Question for the client' },
  'bh.kwt.vraag.uitleg': { nl: 'Je klant ziet dit bij factuur {nummer}{partij}. Laat je het leeg, dan melden we alleen dát je een vraag hebt.', ar: 'يرى عميلك هذا عند الفاتورة {nummer}{partij}. إن تركته فارغًا، أعلمناه فقط بأن لديك سؤالًا.', en: 'Your client sees this with invoice {nummer}{partij}. Leave it empty and we only say you have a question.' },
  'bh.kwt.vraag.uitlegZonderNummer': { nl: 'Je klant ziet dit bij een factuur{partij}. Laat je het leeg, dan melden we alleen dát je een vraag hebt.', ar: 'يرى عميلك هذا عند إحدى الفواتير{partij}. إن تركته فارغًا، أعلمناه فقط بأن لديك سؤالًا.', en: 'Your client sees this with one of their invoices{partij}. Leave it empty and we only say you have a question.' },
  'bh.kwt.vraag.placeholder': { nl: 'Waar gaat deze factuur over?', ar: 'ما موضوع هذه الفاتورة؟', en: 'What is this invoice about?' },
  'bh.kwt.vraag.versturen': { nl: 'Vraag versturen', ar: 'إرسال السؤال', en: 'Send question' },
  // [VOORSTEL] Proposing a correction from the quarter page.
  'bh.kwt.voorstel.knop': { nl: 'Correctie voorstellen', ar: 'اقتراح تصحيح', en: 'Propose a correction' },
  'bh.kwt.voorstel.uitleg': { nl: 'De klant ziet oud en nieuw naast elkaar en tikt op Akkoord. Pas dan verandert de factuur.', ar: 'يرى العميل القديم والجديد جنبًا إلى جنب ويضغط «موافق». عندها فقط تتغيّر الفاتورة.', en: 'The client sees old and new side by side and taps Approve. Only then does the invoice change.' },
  'bh.kwt.voorstel.reden': { nl: 'Waarom (de klant leest dit)', ar: 'لماذا (يقرأ العميل هذا)', en: 'Why (the client reads this)' },
  'bh.kwt.voorstel.versturen': { nl: 'Voorstel versturen', ar: 'إرسال الاقتراح', en: 'Send proposal' },
  'bh.kwt.voorstel.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bh.kwt.voorstel.verstuurd': { nl: 'Voorstel verstuurd. De klant krijgt bericht.', ar: 'أُرسل العرض. سيتلقى العميل إشعارًا.', en: 'Proposal sent. The client has been told.' },
  'bh.kwt.voorstel.fout': { nl: 'Versturen mislukte.', ar: 'فشل الإرسال.', en: 'Sending failed.' },
  'bh.kwt.voorstel.status.open': { nl: 'Voorstel wacht op de klant', ar: 'العرض بانتظار العميل', en: 'Proposal awaiting the client' },
  'bh.kwt.voorstel.status.accepted': { nl: 'Voorstel overgenomen', ar: 'قُبل الاقتراح', en: 'Proposal accepted' },
  'bh.kwt.voorstel.status.declined': { nl: 'Voorstel afgewezen', ar: 'رُفض الاقتراح', en: 'Proposal declined' },
  'bh.kwt.voorstel.status.stale': { nl: 'Voorstel vervallen', ar: 'انتهت صلاحية الاقتراح', en: 'Proposal lapsed' },
  'bh.det.laden': { nl: 'Laden...', ar: 'جارٍ التحميل…', en: 'Loading...' },
  'bh.det.ontkoppelTitel': { nl: 'Klant ontkoppelen?', ar: 'إلغاء ربط العميل؟', en: 'Unlink client?' },
  'bh.det.ontkoppelUitleg': { nl: 'Je verliest de toegang tot de administratie van {naam}. Hij houdt alles zelf; later opnieuw koppelen kan.', ar: 'ستفقد الوصول إلى دفاتر {naam}. يحتفظ هو بكل شيء؛ ويمكن الربط من جديد لاحقًا.', en: 'You lose access to the books of {naam}. They keep everything; you can link again later.' },
  'bh.det.ontkoppelUitlegAnoniem': { nl: 'Je verliest de toegang tot de administratie van deze klant. Hij houdt alles zelf; later opnieuw koppelen kan.', ar: 'ستفقد الوصول إلى دفاتر هذا العميل. يحتفظ هو بكل شيء؛ ويمكن الربط من جديد لاحقًا.', en: 'You lose access to this client\'s books. They keep everything; you can link again later.' },
  'bh.det.ontkoppelen': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Unlink' },
  'bh.det.ontkoppelMislukt': { nl: 'Ontkoppelen mislukt', ar: 'فشل إلغاء الربط', en: 'Unlinking failed' },
  'bh.det.klantgegevens': { nl: 'Klantgegevens', ar: 'بيانات العميل', en: 'Client details' },
  'bh.det.naam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'bh.det.email': { nl: 'E-mail', ar: 'البريد الإلكتروني', en: 'E-mail' },
  'bh.det.stuurEmail': { nl: 'Stuur e-mail', ar: 'إرسال بريد إلكتروني', en: 'Send e-mail' },
  'bh.det.stuurBericht': { nl: 'Stuur bericht', ar: 'إرسال رسالة', en: 'Send message' },
  'bh.det.werkplek': { nl: 'Working Place', ar: 'مساحة العمل', en: 'Working Place' },
  'bh.det.kiesKwartaal': { nl: 'Selecteer een kwartaal', ar: 'اختر ربعًا', en: 'Select a quarter' },
  'bh.det.huidig': { nl: 'huidig', ar: 'الحالي', en: 'current' },
  'bh.det.factuurOpstellen': { nl: 'Factuur opstellen voor deze klant', ar: 'إنشاء فاتورة لهذا العميل', en: 'Create an invoice for this client' },

  // ── [TAAL-POORT] Inloggen en registreren ────────────────────────────────────────────────────
  //
  // De schermen waar de vertaling brak. Een Arabische lezer las een volledig Arabisch blogartikel
  // op /ar/blog, drukte op "أنشئ حساباً مجانياً" — en kwam op twee schermen die 100% Nederlands
  // waren: nul catalogus-imports in beide bestanden. Precies op de deur, en precies bij de mensen
  // die het product als eerste accountants gebruiken.
  //
  // De foutmeldingen komen uit auth-errors.ts. Die module beslist WELKE fout het is (de moeilijke,
  // pure helft, met een zorgvuldig gekozen volgorde) en geeft een sleutel terug; de woorden staan
  // hier. Zo hoeft die beslisboom nooit vertaald te worden.
  'auth.bevestigEerst': {
    nl: 'Je moet eerst je e-mail bevestigen.',
    ar: 'عليك تأكيد بريدك الإلكتروني أولًا.',
    en: 'You need to confirm your e-mail first.',
  },
  'auth.teVeelPogingen': {
    nl: 'Te veel pogingen achter elkaar — wacht een minuut en probeer opnieuw.',
    ar: 'محاولات كثيرة متتالية — انتظر دقيقة ثم أعد المحاولة.',
    en: 'Too many attempts in a row — wait a minute and try again.',
  },
  'auth.teVeelAanvragen': {
    nl: 'Te veel aanvragen achter elkaar — wacht een minuut en probeer opnieuw.',
    ar: 'طلبات كثيرة متتالية — انتظر دقيقة ثم أعد المحاولة.',
    en: 'Too many requests in a row — wait a minute and try again.',
  },
  'auth.geblokkeerd': {
    nl: 'Dit account is geblokkeerd. Neem contact op via de website.',
    ar: 'هذا الحساب محظور. تواصل معنا عبر الموقع.',
    en: 'This account is blocked. Get in touch through the website.',
  },
  'auth.onjuist': {
    nl: 'E-mail of wachtwoord is onjuist',
    ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    en: 'E-mail or password is incorrect',
  },
  'auth.inlogMislukt': {
    nl: 'Inloggen lukte niet — probeer het zo opnieuw.',
    ar: 'تعذّر تسجيل الدخول — أعد المحاولة بعد قليل.',
    en: 'Signing in did not work — try again in a moment.',
  },
  'auth.wachtwoordZwak': {
    nl: 'Dit wachtwoord is te zwak — kies er een die langer is.',
    ar: 'كلمة المرور هذه ضعيفة — اختر كلمة أطول.',
    en: 'This password is too weak — pick a longer one.',
  },
  'auth.wachtwoordZelfde': {
    nl: 'Dit is je huidige wachtwoord — kies een ander.',
    ar: 'هذه كلمة مرورك الحالية — اختر غيرها.',
    en: 'That is your current password — pick a different one.',
  },
  'auth.linkVerlopen': {
    nl: 'Deze herstellink is verlopen of al gebruikt. Vraag een nieuwe aan.',
    ar: 'انتهت صلاحية رابط الاستعادة أو تم استخدامه. اطلب رابطًا جديدًا.',
    en: 'This recovery link has expired or was already used. Request a new one.',
  },
  'auth.opslaanMislukt': {
    nl: 'Opslaan lukte niet — probeer het zo opnieuw.',
    ar: 'تعذّر الحفظ — أعد المحاولة بعد قليل.',
    en: 'Saving did not work — try again in a moment.',
  },
  'auth.versturenMislukt': {
    nl: 'Versturen lukte niet — probeer het zo opnieuw.',
    ar: 'تعذّر الإرسال — أعد المحاولة بعد قليل.',
    en: 'Sending did not work — try again in a moment.',
  },
  'auth.googleAfgebroken': {
    nl: 'Het inloggen met Google is onderweg afgebroken. Probeer het opnieuw.',
    ar: 'توقّف تسجيل الدخول عبر Google في منتصف الطريق. أعد المحاولة.',
    en: 'Signing in with Google was interrupted. Try again.',
  },
  'auth.googleMislukt': {
    nl: 'Inloggen met Google lukte niet. Probeer het opnieuw of gebruik je e-mailadres.',
    ar: 'تعذّر تسجيل الدخول عبر Google. أعد المحاولة أو استخدم بريدك الإلكتروني.',
    en: 'Signing in with Google did not work. Try again or use your e-mail address.',
  },
  'auth.googleFout': {
    nl: 'Google login mislukt — probeer opnieuw',
    ar: 'فشل تسجيل الدخول عبر Google — أعد المحاولة',
    en: 'Google sign-in failed — try again',
  },

  // Het inlogscherm zelf.
  'auth.slogan': {
    nl: 'De brug tussen jou en je boekhouder',
    ar: 'الجسر بينك وبين محاسبك',
    en: 'The bridge between you and your bookkeeper',
  },
  'auth.metGoogle': { nl: 'Inloggen met Google', ar: 'تسجيل الدخول عبر Google', en: 'Sign in with Google' },
  'auth.verbinden': { nl: 'Bezig met verbinden...', ar: 'جارٍ الاتصال…', en: 'Connecting...' },
  'auth.of': { nl: 'of', ar: 'أو', en: 'or' },
  'auth.email': { nl: 'E-mailadres', ar: 'البريد الإلكتروني', en: 'E-mail address' },
  'auth.wachtwoord': { nl: 'Wachtwoord', ar: 'كلمة المرور', en: 'Password' },
  'auth.wachtwoordVergeten': { nl: 'Wachtwoord vergeten?', ar: 'نسيت كلمة المرور؟', en: 'Forgot your password?' },
  'auth.inloggen': { nl: 'Inloggen', ar: 'تسجيل الدخول', en: 'Sign in' },
  'auth.bezig': { nl: 'Bezig...', ar: 'جارٍ التنفيذ…', en: 'Working...' },
  'auth.laden': { nl: 'Laden...', ar: 'جارٍ التحميل…', en: 'Loading...' },
  'auth.nieuwAccount': { nl: 'Nieuw account aanmaken', ar: 'إنشاء حساب جديد', en: 'Create a new account' },
  'auth.mailOpnieuw': { nl: 'Stuur de mail opnieuw', ar: 'إعادة إرسال الرسالة', en: 'Send the e-mail again' },
  'auth.mailVersturen': { nl: 'Bezig met versturen...', ar: 'جارٍ الإرسال…', en: 'Sending...' },
  'auth.mailOpnieuwGestuurd': {
    nl: 'We hebben de mail opnieuw gestuurd.',
    ar: 'أعدنا إرسال الرسالة.',
    en: 'We have sent the e-mail again.',
  },
  // De taalkeuze op de deur zelf. De namen van de talen blijven in hun eigen schrift — wie zijn
  // taal zoekt, zoekt de vorm van zijn eigen letters, niet een vertaling ervan.
  'auth.taal': { nl: 'Taal', ar: 'اللغة', en: 'Language' },

  // Het registratiescherm. Zelfde reden als de sleutels hierboven: dit is de deur.
  'reg.wieBenJij': { nl: 'Wie ben jij?', ar: 'مَن أنت؟', en: 'Who are you?' },
  'reg.zzper': { nl: 'ZZP’er', ar: 'صاحب عمل حر', en: 'Freelancer' },
  'reg.zzperUitleg': {
    nl: 'Ik stuur en ontvang facturen',
    ar: 'أنا أرسل الفواتير وأستقبلها',
    en: 'I send and receive invoices',
  },
  'reg.boekhouder': { nl: 'Boekhouder', ar: 'المحاسب', en: 'Bookkeeper' },
  'reg.boekhouderUitleg': {
    nl: 'Ik beheer facturen van mijn klanten',
    ar: 'أدير فواتير عملائي',
    en: 'I manage my clients’ invoices',
  },
  'reg.metGoogle': { nl: 'Doorgaan met Google', ar: 'المتابعة عبر Google', en: 'Continue with Google' },
  'reg.ofMetEmail': { nl: 'of met e-mail', ar: 'أو بالبريد الإلكتروني', en: 'or with e-mail' },
  'reg.naam': { nl: 'Volledige naam', ar: 'الاسم الكامل', en: 'Full name' },
  'reg.naamVoorbeeld': { nl: 'Jan de Vries', ar: 'Jan de Vries', en: 'Jan de Vries' },
  'reg.bedrijf': { nl: 'Bedrijfsnaam (optioneel)', ar: 'اسم الشركة (اختياري)', en: 'Company name (optional)' },
  'reg.bedrijfVoorbeeld': { nl: 'Jouw Bedrijf BV', ar: 'Jouw Bedrijf BV', en: 'Jouw Bedrijf BV' },
  'reg.kvk': { nl: 'KVK-nummer (optioneel)', ar: 'رقم KVK (اختياري)', en: 'KVK number (optional)' },
  'reg.btw': { nl: 'BTW-nummer (optioneel)', ar: 'رقم btw (اختياري)', en: 'BTW number (optional)' },
  'reg.laterInvullen': { nl: 'Kun je later invullen.', ar: 'يمكنك إدخاله لاحقًا.', en: 'You can fill this in later.' },
  // De akkoordregel, in stukken die elk een hele zin of een hele knopnaam zijn — de twee links
  // staan er middenin, en een taal met een andere woordvolgorde zet ze op een andere plek.
  'reg.akkoordVoor': { nl: 'Als je een account maakt, ga je akkoord met onze', ar: 'بإنشائك حسابًا فإنك توافق على', en: 'By creating an account you agree to our' },
  'reg.akkoordTussen': { nl: 'en de', ar: 'و', en: 'and the' },
  'reg.voorwaarden': { nl: 'Voorwaarden', ar: 'الشروط', en: 'Terms' },
  'reg.privacy': { nl: 'Privacyverklaring', ar: 'بيان الخصوصية', en: 'Privacy statement' },
  'reg.alAccount': { nl: 'Al een account?', ar: 'لديك حساب بالفعل؟', en: 'Already have an account?' },
  'reg.emailBezet': {
    nl: 'Dit e-mailadres is al geregistreerd.',
    ar: 'هذا البريد الإلكتروني مُسجَّل بالفعل.',
    en: 'This e-mail address is already registered.',
  },
  // De veldcontroles vóór de server. Elk veld zijn eigen zin.
  'reg.vulNaam': { nl: 'Vul je naam in', ar: 'أدخل اسمك', en: 'Enter your name' },
  'reg.vulEmail': { nl: 'Vul je e-mailadres in', ar: 'أدخل بريدك الإلكتروني', en: 'Enter your e-mail address' },
  'reg.emailKloptNiet': { nl: 'Dit e-mailadres klopt niet', ar: 'هذا البريد الإلكتروني غير صحيح', en: 'That e-mail address is not valid' },
  // [WACHTWOORD-EIS] De eis stond alleen in deze foutmelding, dus je las hem pas nadat je hem had
  // overtreden. Dezelfde zin staat nu ook als hint ONDER het veld, vóór de eerste poging.
  'reg.wachtwoordKort': {
    nl: 'Kies een wachtwoord van minstens 6 tekens',
    ar: 'اختر كلمة مرور من 6 أحرف على الأقل',
    en: 'Choose a password of at least 6 characters',
  },
  'reg.wachtwoordEis': {
    nl: 'Minstens 6 tekens.',
    ar: '6 أحرف على الأقل.',
    en: 'At least 6 characters.',
  },
  'reg.wachtwoordZwakServer': {
    nl: 'Dit wachtwoord is te zwak — kies een langer wachtwoord',
    ar: 'كلمة المرور هذه ضعيفة — اختر كلمة أطول',
    en: 'This password is too weak — choose a longer one',
  },
  'reg.teVeelPogingen': {
    nl: 'Te veel pogingen achter elkaar — wacht even en probeer opnieuw',
    ar: 'محاولات كثيرة متتالية — انتظر قليلًا ثم أعد المحاولة',
    en: 'Too many attempts in a row — wait a moment and try again',
  },
  'reg.emailUit': {
    nl: 'Registreren met e-mail staat tijdelijk uit — probeer het met Google',
    ar: 'التسجيل بالبريد الإلكتروني متوقف مؤقتًا — جرّب عبر Google',
    en: 'Registering with e-mail is temporarily off — try Google instead',
  },
  'reg.mislukt': { nl: 'Registratie mislukt — probeer opnieuw', ar: 'فشل التسجيل — أعد المحاولة', en: 'Registration failed — try again' },
  'reg.googleFout': { nl: 'Google registratie mislukt — probeer opnieuw', ar: 'فشل التسجيل عبر Google — أعد المحاولة', en: 'Google registration failed — try again' },
  // Het bevestigingsscherm.
  'reg.controleerMail': { nl: 'Controleer je e-mail', ar: 'تحقّق من بريدك الإلكتروني', en: 'Check your e-mail' },
  'reg.linkGestuurd': {
    nl: 'We hebben een bevestigingslink gestuurd naar {email}. Klik op de link om je account te activeren.',
    ar: 'أرسلنا رابط تأكيد إلى {email}. اضغط على الرابط لتفعيل حسابك.',
    en: 'We have sent a confirmation link to {email}. Click it to activate your account.',
  },
  'reg.factuurBewaardKop': { nl: 'Je factuur is bewaard.', ar: 'تم حفظ فاتورتك.', en: 'Your invoice has been saved.' },
  'reg.factuurBewaard': {
    nl: 'Zodra je je account activeert staat hij klaar — je bedrijfsgegevens, je klant en je regels. Je hoeft niets opnieuw in te tikken.',
    ar: 'بمجرد تفعيل حسابك ستجدها جاهزة — بيانات شركتك وعميلك وبنودك. لن تحتاج إلى إعادة كتابة شيء.',
    en: 'It is waiting the moment you activate your account — your company details, your client and your lines. You will not have to retype anything.',
  },
  'reg.naarInloggen': { nl: 'Naar inloggen', ar: 'إلى تسجيل الدخول', en: 'To sign in' },
  // De knop die het account aanmaakt. Twee, want er zijn twee soorten bezoekers — zie
  // purposeCopy in account-purpose.ts, dat de sleutel kiest.
  'reg.ctaGratis': { nl: 'Gratis beginnen', ar: 'ابدأ مجانًا', en: 'Start for free' },
  'reg.ctaArchief': { nl: 'Archief aanmaken', ar: 'إنشاء الأرشيف', en: 'Create archive' },

  // ── [MEDEWERKER] De kop van het verkoopbord ─────────────────────────────────────────────────
  //
  // Twee regels in het profielmenu van een verkoopmedewerker. Instellingen staat er niet tussen:
  // dat scherm mag hij niet openen. Deze twee wél — en er wees tot nu toe geen enkele deur heen.
  'kop.mijnKlanten': { nl: 'Mijn klanten', ar: 'عملائي', en: 'My clients' },
  'kop.beveiliging': { nl: 'Beveiliging', ar: 'الأمان', en: 'Security' },
  // [GEEN-WACHTWOORD] De uitweg voor een account dat via Google is aangemaakt en dus geen
  // wachtwoord heeft om de verwijdering mee te bevestigen.
  'inst.stuurWachtwoordLink': {
    nl: 'Stuur me een link om een wachtwoord in te stellen',
    ar: 'أرسل لي رابطاً لتعيين كلمة مرور',
    en: 'Send me a link to set a password',
  },
  'inst.wachtwoordLinkGestuurd': {
    nl: 'Als dit adres bij ons bekend is, staat er een link in je mail. Stel een wachtwoord in en kom hier terug.',
    ar: 'إن كان هذا العنوان معروفًا لدينا، فستجد رابطًا في بريدك. عيّن كلمة مرور ثم عد إلى هنا.',
    en: 'If we know this address, there is a link in your mail. Set a password and come back here.',
  },
  // [TAAL] De staart van de belangrijkste zin op het verkoopbord. Stond hard-gecodeerd achter een
  // sleutel, dus de alinea wisselde halverwege van taal — over het feit dat deze gebruiker juist
  // moet begrijpen: onder wiens naam en BTW-nummer zijn facturen uitgaan.
  'vk.namensUitleg': {
    nl: 'Ze gaan uit op hun naam en BTW-nummer, met hun doorlopende factuurnummers. Hieronder staat alleen wat jij zelf hebt gemaakt.',
    ar: 'تصدر باسمهم ورقم btw الخاص بهم، وبأرقام فواتيرهم المتسلسلة. وفي الأسفل يظهر ما أنشأتَه أنت فقط.',
    en: 'They go out under their name and BTW number, in their continuous invoice series. Below is only what you created yourself.',
  },

  // ─── [WAAROM-WACHT] Waarom wacht DIT document op mij ────────────────────────────────────────
  //
  // Eén zin per weigering, en elke zin wijst één ding aan: welk veld te bekijken, of welke
  // schakelaar om te zetten. De ergste kaart is niet de gemarkeerde — die draagt al een badge en
  // een lijst redenen. De ergste is de kaart met een groen "klaar om te bevestigen" die tóch
  // wacht: daar staat vandaag niets, dus leest de eigenaar een document dat goed gelezen is nog
  // een keer, vindt niets, tikt bevestigen en heeft niets geleerd. Driehonderd keer.
  //
  // De machinecode komt hier nooit op het scherm. Een weigering zonder zin toont niets — zie
  // why-waiting.ts en de poort die elke code van een zin voorziet.

  // De enige regel hier die géén leesprobleem beschrijft maar een KEUZE, en dus als enige een
  // uitweg noemt. De schakelaar wordt genoemd zoals hij op het instellingenscherm geschreven
  // staat, in dezelfde taal als de rest van dat scherm — anders zoekt de eigenaar naar een woord
  // dat nergens in de interface voorkomt.
  'ink.waaromWacht': {
    nl: 'Waarom wacht deze op jou',
    ar: 'لماذا تنتظرك هذه',
    en: 'Why this one is waiting for you',
  },

  'wacht.eigenKeuze': {
    nl: 'Wacht op jou omdat "Duidelijke facturen automatisch inboeken" uit staat. Zet het aan bij Instellingen als dit voortaan vanzelf mag.',
    ar: 'ينتظرك لأن «قيد الفواتير الواضحة تلقائيًا» متوقّف. فعّله في الإعدادات إن أردت أن يجري هذا من تلقاء نفسه.',
    en: 'Waiting for you because "Book clear invoices automatically" is off. Turn it on in Settings if this may happen by itself from now on.',
  },

  // De geldvelden — de zinnen die zeggen WAAR je moet kijken.
  'wacht.geenTotaal': {
    nl: 'Er is geen betrouwbaar totaalbedrag gelezen. Vul het bedrag zelf in.',
    ar: 'لم يُقرأ مبلغ إجمالي موثوق. أدخل المبلغ بنفسك.',
    en: 'No reliable total was read. Fill in the amount yourself.',
  },
  'wacht.totaalBerekend': {
    nl: 'Het totaal is berekend, niet van het document gelezen. Vergelijk het even.',
    ar: 'الإجمالي محسوب، وليس مقروءًا من المستند. قارنه سريعًا.',
    en: 'The total was calculated, not read off the document. Compare it.',
  },
  'wacht.totaalNietInTekst': {
    nl: 'Het gelezen totaal staat niet zo in de tekst van dit document. Vergelijk het bedrag met wat er gedrukt staat.',
    ar: 'الإجمالي المقروء لا يظهر بهذه القيمة في نص هذا المستند. قارن المبلغ بما هو مطبوع.',
    en: 'The total that was read does not appear that way in this document. Compare it with what is printed.',
  },
  'wacht.totaalVerkeerdePlek': {
    nl: 'Het bedrag staat niet waar een totaal hoort te staan — mogelijk is een subtotaal gelezen.',
    ar: 'المبلغ ليس في الموضع الذي يُطبع فيه الإجمالي عادةً — ربما قُرئ مبلغ فرعي.',
    en: 'The amount is not where a total is normally printed — a subtotal may have been read.',
  },
  'wacht.btwAnders': {
    nl: 'De btw-verdeling op het document is anders dan wat er gelezen is.',
    ar: 'توزيع ضريبة القيمة المضافة على المستند يختلف عمّا قُرئ.',
    en: 'The btw split on the document differs from what was read.',
  },
  'wacht.btwNul': {
    nl: 'De btw is nul, maar er staat geen 0% op het document.',
    ar: 'قيمة ضريبة القيمة المضافة صفر، لكن لا توجد نسبة 0% على المستند.',
    en: 'The btw is zero, but the document does not state 0%.',
  },
  'wacht.zelffactuur': {
    nl: 'Op dit document staat dat de afnemer hem heeft opgemaakt. Controleer of dit jouw eigen verkoop is.',
    ar: 'يذكر هذا المستند أن المشتري هو من حرّره. تحقّق ممّا إذا كان هذا بيعاً من عندك.',
    en: 'This document states the customer drew it up. Check whether it is your own sale.',
  },
  'wacht.vreemdeValuta': {
    nl: "De bedragen op dit document staan niet in euro's. Vul zelf het eurobedrag in dat je bank heeft afgeschreven.",
    ar: 'المبالغ في هذا المستند ليست باليورو. أدخل بنفسك المبلغ باليورو الذي خصمه بنكك.',
    en: "The amounts on this document are not in euros. Enter the euro amount your bank actually debited.",
  },
  'wacht.eFactuurAnders': {
    nl: 'De e-factuur van de leverancier noemt andere bedragen dan er gelezen is.',
    ar: 'الفاتورة الإلكترونية من المورّد تذكر مبالغ مختلفة عن المبالغ المقروءة.',
    en: "The supplier's e-invoice states different amounts than were read.",
  },
  'wacht.bedragOnzeker': {
    nl: 'De lezer was niet zeker genoeg over het bedrag. Vergelijk het met het document.',
    ar: 'لم يكن القارئ واثقًا بما يكفي من المبلغ. قارنه بالمستند.',
    en: 'The reader was not certain enough about the amount. Compare it with the document.',
  },

  // De lezing als geheel.
  'wacht.lezingOnzeker': {
    nl: 'De lezer was niet zeker genoeg over dit document. Kijk het bedrag en de datum na.',
    ar: 'لم يكن القارئ واثقًا بما يكفي من هذا المستند. راجع المبلغ والتاريخ.',
    en: 'The reader was not certain enough about this document. Check the amount and the date.',
  },
  'wacht.gegevensOnzeker': {
    nl: 'De lezer was niet zeker genoeg over de leverancier, het factuurnummer of de datum.',
    ar: 'لم يكن القارئ واثقًا بما يكفي من المورّد أو رقم الفاتورة أو التاريخ.',
    en: 'The reader was not certain enough about the supplier, the invoice number or the date.',
  },
  'wacht.aandacht': {
    nl: 'Er staat iets in deze factuur dat eerst nagekeken moet worden.',
    ar: 'في هذه الفاتورة ما يجب مراجعته أولًا.',
    en: 'Something in this invoice has to be checked first.',
  },

  // Wat het document IS.
  'wacht.geenFactuur': {
    nl: 'Dit lijkt geen factuur. Kijk even of het hier hoort.',
    ar: 'لا يبدو هذا فاتورة. تحقّق إن كان مكانه هنا.',
    en: 'This does not look like an invoice. Check whether it belongs here.',
  },
  'wacht.overzicht': {
    nl: 'Dit lijkt een rekeningoverzicht, geen factuur.',
    ar: 'يبدو هذا كشف حساب، لا فاتورة.',
    en: 'This looks like a statement, not an invoice.',
  },
  'wacht.herinnering': {
    nl: 'Dit lijkt een herinnering van een factuur die je misschien al hebt.',
    ar: 'يبدو هذا تذكيراً بفاتورة قد تكون لديك أصلاً.',
    en: 'This looks like a reminder for an invoice you may already have.',
  },
  'wacht.aanslag': {
    nl: 'Dit is een brief van de Belastingdienst. Jij bevestigt waar hij boekt.',
    ar: 'هذه رسالة من مصلحة الضرائب. أنت تؤكد أين تُقيَّد.',
    en: 'This is a letter from the tax office. You confirm where it books.',
  },
  'wacht.creditnota': {
    nl: 'Dit lijkt een creditnota. Die boekt de app nooit vanzelf.',
    ar: 'يبدو هذا إشعار دائن. لا يقيّده التطبيق تلقائياً أبداً.',
    en: 'This looks like a credit note. The app never books those by itself.',
  },

  // Hoe het binnenkwam.
  // Deze regel deelde tot nu toe zijn naam met 'uncertain', en las dus als "de lezer was niet zeker
  // genoeg" — over een factuur die perfect gelezen is en alleen een betaalspoor draagt. Dat stuurde
  // de eigenaar het verkeerde veld in.
  'wacht.betaalspoor': {
    nl: 'Op dit document staat dat het al betaald is, maar de betaling is hier niet vastgelegd. Geef aan hoe het betaald is, dan is het klaar.',
    ar: 'على هذا المستند ما يفيد أنه مدفوع، لكن الدفعة لم تُسجَّل هنا. حدّد كيف دُفع، وينتهي الأمر.',
    en: 'This document says it has already been paid, but the payment is not recorded here. Say how it was paid and it is done.',
  },

  'wacht.uitMailtekst': {
    nl: 'Dit komt uit de tekst van een e-mail, niet uit een bijlage.',
    ar: 'هذا مأخوذ من نص رسالة بريد، لا من مرفق.',
    en: 'This comes from the text of an e-mail, not from an attachment.',
  },
  'wacht.meerdereFacturen': {
    nl: 'Er zaten meerdere facturen in één bestand.',
    ar: 'كان في الملف الواحد أكثر من فاتورة.',
    en: 'There were several invoices in one file.',
  },
  'wacht.tochToegevoegd': {
    nl: 'Je hebt deze toegevoegd terwijl hij op een dubbele leek.',
    ar: 'أضفتَ هذه رغم أنها بدت مكرّرة.',
    en: 'You added this one although it looked like a duplicate.',
  },
  // ── /bank: waarom deze regel zichzelf niet koppelde ───────────────────────────────────────
  //
  // Het tabblad "Geen factuur" had één alinea voor álle regels, en die was over elke regel waar
  // en over geen enkele nuttig. De vier redenen eronder vragen tegengestelde handelingen: een
  // factuur TOEVOEGEN, er één KIEZEN, wachten op een deelbetaling, of de regel één keer een
  // categorie geven.
  'wacht.bankNummerOnbekend': {
    nl: 'De betaling noemt een factuurnummer dat niet in je administratie staat. Waarschijnlijk is die factuur er nog niet — voeg hem toe, dan koppelt deze regel zichzelf.',
    ar: 'تذكر الدفعة رقم فاتورة غير موجود في إدارتك. على الأرجح لم تُضَف تلك الفاتورة بعد — أضفها، وسيرتبط هذا السطر بها تلقائيًا.',
    en: 'The payment quotes an invoice number that is not in your administration. That invoice is probably not entered yet — add it and this line links itself.',
  },
  // [SOM-KLOPT] De tegenovergestelde zin van hierboven, en hij bestaat omdat de app die van
  // hierboven printte bóven een factuur die gewoon in de administratie stond, betaald, op de cent.
  'wacht.bankNummerAlGeboekt': {
    nl: 'De factuur die deze betaling noemt staat al in je administratie en is al afgeboekt. Er valt hier niets te kiezen — controleer alleen of hij niet twee keer betaald is.',
    ar: 'الفاتورة التي تذكرها هذه الدفعة موجودة في إدارتك ومُسجَّلة كمدفوعة. لا شيء تختاره هنا — تحقّق فقط من أنها لم تُدفع مرتين.',
    en: 'The invoice this payment quotes is already in your administration and already settled. There is nothing to choose here — only check that it was not paid twice.',
  },
  'wacht.bankMeerdereZelfdeBedrag': {
    nl: 'Er staan meerdere facturen open met precies dit bedrag. Kies welke het is — raden doet de app niet.',
    ar: 'هناك أكثر من فاتورة مفتوحة بالمبلغ نفسه تماماً. اختر أيّها — التطبيق لا يخمّن.',
    en: 'Several open invoices carry exactly this amount. Pick the right one — the app does not guess.',
  },
  'wacht.bankGeenBedrag': {
    nl: 'Van deze tegenpartij staan wel facturen open, maar geen met dit bedrag. Vaak is dit een deelbetaling of een factuur die nog moet komen.',
    ar: 'لهذا الطرف فواتير مفتوحة، لكن ليس بهذا المبلغ. غالبًا دفعة جزئية أو فاتورة لم تصل بعد.',
    en: 'This counterparty has open invoices, but none for this amount. Often a part payment, or an invoice still to come.',
  },
  'wacht.bankOnbekendePartij': {
    nl: 'Deze tegenpartij komt niet voor in je openstaande facturen. Hoort er geen factuur bij — huur, een lening, privé — geef de regel dan één keer een categorie.',
    ar: 'هذا الطرف لا يرد في فواتيرك المفتوحة. إن لم تكن له فاتورة — إيجار أو قرض أو أمر شخصي — فامنح السطر تصنيفاً مرة واحدة.',
    en: 'This counterparty does not appear in your open invoices. If no invoice belongs to it — rent, a loan, private — give the line a category once.',
  },
  // ── /bank/categoriseren: waarom de app deze regel niet zelf codeert ───────────────────────
  //
  // De eerste zin bestaat omdat het label erboven "onthouden" zei — ook wanneer het geheugen de
  // ANDERE kant op wees. De suggestie die de app zelf wantrouwt zag er precies uit als degene die
  // ze het meest vertrouwt, en de eigenaar kon het verschil niet zien.
  // ── [KAS-ACHTER-BANK] Wat de bankpas met opzet niet boekte ────────────────────────────────
  //
  // Onder het kasstelsel is de betaaldatum btw-timing. Een match op bedrag + naam zonder gedrukt
  // factuurnummer, in een kwartaal dat AL is aangegeven, zou een fout naar de Belastingdienst
  // schrijven in plaats van in de administratie — en die is alleen met een suppletie te
  // herstellen. De app laat die dus aan de eigenaar. Dat is de app die het goed doet, en de
  // eigenaar hoorde het nergens.
  'bank.kas.aangegeven': {
    nl: '{count} betaling(en) bewust niet geboekt: dat kwartaal heb je al aangegeven, en onder het kasstelsel telt de betaaldatum. Die keuze is aan jou.',
    ar: '{count} دفعة/دفعات لم تُسجَّل عن قصد: ذلك الربع قدّمت إقراره بالفعل، وفي النظام النقدي يُعتدّ بتاريخ الدفع. القرار لك.',
    en: '{count} payment(s) deliberately not booked: you already filed that quarter, and under the cash scheme the payment date counts. That call is yours.',
  },
  // De gevaarlijke stand: niet "we hebben besloten", maar "we konden het niet nagaan". Zonder deze
  // zin ziet een stilgevallen controle er precies zo uit als een rustige dag.
  'bank.kas.onbekend': {
    nl: 'Bij {count} betaling(en) konden we niet nagaan of dat kwartaal al is aangegeven. Die zijn daarom niet vanzelf geboekt — geen fout, alleen niet gecontroleerd.',
    ar: 'بشأن {count} دفعة/دفعات تعذّر علينا التحقّق مما إذا كان ذلك الربع قد قُدّم إقراره. لذلك لم تُسجَّل تلقائيًا — ليس خطأً، فقط لم تُفحص.',
    en: 'For {count} payment(s) we could not check whether that quarter was already filed. So they were not booked by themselves — not an error, just not checked.',
  },

  // ── [KAS-ACHTER] De kaslade waarvan de koppeling niet kon bijwerken ───────────────────────
  //
  // Het saldo is het getal waar een winkelier zijn lade tegenaan telt. Een verouderd saldo dat er
  // actueel uitziet is de gevaarlijkste vorm die dat scherm kan aannemen — en de code wist het al:
  // de regel die dit meldt stond er, schreef naar een log, en zei het nergens tegen de eigenaar.
  'kas.achter.kop': {
    nl: 'De koppeling met je facturen kon niet bijwerken',
    ar: 'تعذّر تحديث الربط مع فواتيرك',
    en: 'The link with your invoices could not update',
  },
  'kas.achter.uitleg': {
    nl: 'De boekingen hieronder kloppen. Maar contant betaalde facturen zijn deze keer niet verwerkt, dus het saldo kan achterlopen. Probeer het zo opnieuw; blijft dit staan, laat het ons weten.',
    ar: 'القيود أدناه صحيحة. لكن الفواتير المدفوعة نقدًا لم تُعالَج هذه المرة، فقد يكون الرصيد متأخرًا. أعد المحاولة بعد قليل؛ وإن بقي الأمر، فأخبرنا.',
    en: 'The entries below are right. But invoices paid in cash were not processed this time, so the balance may be behind. Try again in a moment; if this stays, let us know.',
  },

  'wacht.catGeheugenAndereKant': {
    nl: 'Deze tegenpartij ken je, maar toen ging het geld de andere kant op. Een teruggestort bedrag is geen omzet en een terugbetaling is geen kost — kies zelf.',
    ar: 'هذا الطرف معروف لديك، لكن المال حينها سار في الاتجاه الآخر. المبلغ المُعاد ليس إيراداً والاسترداد ليس تكلفة — اختر بنفسك.',
    en: 'You know this counterparty, but last time the money went the other way. A refund is not turnover and a repayment is not a cost — choose yourself.',
  },
  'wacht.catLijktMaarNietDezelfde': {
    nl: 'Deze lijkt op een tegenpartij die je eerder hebt ingedeeld, maar het is niet dezelfde. Twee zaken met dezelfde naam zijn niet één bedrijf.',
    ar: 'يشبه هذا طرفاً صنّفته سابقاً، لكنه ليس نفسه. محلّان بالاسم ذاته ليسا شركة واحدة.',
    en: 'This resembles a counterparty you categorised before, but it is not the same one. Two shops sharing a name are not one business.',
  },
  'wacht.catNooitGezien': {
    nl: 'Deze tegenpartij ben je nog niet eerder tegengekomen. Het voorstel hieronder gaat alleen op plus of min af — daarom vult de app hem niet zelf in.',
    ar: 'لم تصادف هذا الطرف من قبل. الاقتراح أدناه يعتمد على الإشارة فقط — لذلك لا يملؤه التطبيق بنفسه.',
    en: 'You have not come across this counterparty before. The suggestion below goes on the sign alone — which is why the app does not fill it in for you.',
  },

  'wacht.bankNietsOpen': {
    nl: 'Er staat op dit moment geen enkele factuur open om aan te koppelen.',
    ar: 'لا توجد حاليًا أي فاتورة مفتوحة ليُربط بها.',
    en: 'There is currently no open invoice to link this to.',
  },

  'wacht.nietInAanmerking': {
    nl: 'Deze kwam niet in aanmerking om vanzelf geboekt te worden.',
    ar: 'لم تكن هذه مؤهّلة للقيد التلقائي.',
    en: 'This one was not eligible to be booked automatically.',
  },


  // ─── [GESPREK] The conversation screen — one chat with a linked client or accountant ────────
  //
  // This screen held six Dutch sentences of its own. The list screen next to it (ber.*) was
  // already in the catalogue; this one is the one the owner opens from it, so a translated list
  // led straight into a Dutch chat. Simple words on purpose: the reader is typing to their
  // accountant, not reading a manual.

  'gesprek.ophaalFout': {
    nl: 'We konden dit gesprek nu niet ophalen. Probeer het zo meteen opnieuw.',
    ar: 'لم نتمكّن من فتح هذه المحادثة الآن. حاول مرة أخرى بعد قليل.',
    en: 'We could not load this conversation right now. Please try again in a moment.',
  },
  'gesprek.stuurAan': { nl: 'Stuur een bericht aan {name}', ar: 'أرسل رسالة إلى {name}', en: 'Send a message to {name}' },
  'gesprek.plaatshouder': {
    nl: 'Bericht aan {name}... (Enter om te verzenden)',
    ar: 'رسالة إلى {name}... (اضغط Enter للإرسال)',
    en: 'Message to {name}... (Enter to send)',
  },
  'gesprek.verzendFout': { nl: 'Verzenden mislukt — probeer opnieuw', ar: 'فشل الإرسال — حاول مرة أخرى', en: 'Sending failed — try again' },
  'gesprek.stuur': { nl: 'Versturen', ar: 'إرسال', en: 'Send' },

  // ─── [KWARTAAL-INTRO] The one line above the quarter overview ───────────────────────────────

  'kwo.intro': {
    nl: 'BTW-aangifte, totalen en export per kwartaal',
    ar: 'إقرار btw والإجماليات والتصدير لكل ربع سنة',
    en: 'VAT return, totals and export per quarter',
  },

  // ─── [BEHEER] The operator's screen ─────────────────────────────────────────────────────────
  //
  // This screen was deliberately Dutch-only, on the argument that its one reader chose no
  // language setting. The reader is the owner of the product, and the owner reads Arabic — the
  // same reversal the accountant module went through. The sentences that come from the libraries
  // it renders (the hold-reason labels, the cron notes) stay as those libraries write them; the
  // screen's OWN words are here. Plain words, because these panels are read at a glance.

  'beh.titel': { nl: 'Beheer', ar: 'الإدارة', en: 'Admin' },
  'beh.alleenLezen': {
    nl: 'Alleen-lezen. Koppelen, ontkoppelen en rollen lopen via de partijen zelf — dit scherm geeft overzicht, geen tweede deur.',
    ar: 'للقراءة فقط. الربط وإلغاء الربط والأدوار تتم عند الأطراف نفسها. هذه الشاشة تعطي نظرة عامة، وليست بابًا ثانيًا.',
    en: 'Read-only. Linking, unlinking and roles are done by the parties themselves — this screen gives an overview, not a second door.',
  },

  'beh.accounts': { nl: 'accounts', ar: 'الحسابات', en: 'accounts' },
  'beh.ondernemers': { nl: 'ondernemers', ar: 'أصحاب أعمال', en: 'business owners' },
  'beh.boekhouders': { nl: 'boekhouders', ar: 'محاسبون', en: 'accountants' },
  'beh.koppelingen': { nl: 'koppelingen', ar: 'روابط', en: 'links' },

  'beh.accountsKop': { nl: 'Accounts', ar: 'الحسابات', en: 'Accounts' },
  'beh.naam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'beh.email': { nl: 'E-mail', ar: 'البريد الإلكتروني', en: 'E-mail' },
  'beh.rol': { nl: 'Rol', ar: 'الدور', en: 'Role' },
  'beh.plan': { nl: 'Plan', ar: 'الخطة', en: 'Plan' },
  'beh.sinds': { nl: 'Sinds', ar: 'منذ', en: 'Since' },
  'beh.nogGeenAccounts': { nl: 'Nog geen accounts.', ar: 'لا حسابات بعد.', en: 'No accounts yet.' },

  'beh.koppelKop': { nl: 'Boekhouder ↔ klant', ar: 'المحاسب ↔ العميل', en: 'Accountant ↔ client' },
  'beh.boekhouder': { nl: 'Boekhouder', ar: 'المحاسب', en: 'Accountant' },
  'beh.klant': { nl: 'Klant', ar: 'العميل', en: 'Client' },
  'beh.nogGeenKoppelingen': { nl: 'Nog geen koppelingen.', ar: 'لا روابط بعد.', en: 'No links yet.' },

  // The background jobs.
  'beh.hartslagOnleesbaar': { nl: 'De cron-hartslag is niet te lezen', ar: 'تعذّرت قراءة نبض المهام الخلفية', en: 'The cron heartbeat cannot be read' },
  'beh.hartslagOnleesbaarUitleg': {
    nl: 'We weten dus niet of de achtergrondtaken nog draaien: geen bevestiging dat er iets stuk is, en geen bevestiging dat alles goed gaat — precies het geval waarin niemand het merkt.',
    ar: 'لا نعرف إذًا إن كانت المهام الخلفية ما زالت تعمل: لا تأكيد أن شيئًا معطّل، ولا تأكيد أن كل شيء بخير — وهذه تحديدًا الحالة التي لا يلاحظها أحد.',
    en: 'So we do not know whether the background jobs still run: no confirmation something is broken, and no confirmation that all is well — exactly the case nobody notices.',
  },
  'beh.alleTakenDraaien': { nl: 'Alle {n} achtergrondtaken draaien', ar: 'كل المهام الخلفية ({n}) تعمل', en: 'All {n} background jobs are running' },
  'beh.takenAandacht': {
    nl: '{a} van {n} achtergrondtaken hebben aandacht nodig',
    ar: '{a} من {n} مهام خلفية تحتاج انتباهًا',
    en: '{a} of {n} background jobs need attention',
  },
  'beh.nogNooit': { nl: 'nog nooit', ar: 'لم تعمل قط', en: 'never yet' },
  'beh.minderDanUur': { nl: '< 1 uur', ar: 'أقل من ساعة', en: '< 1 hour' },
  'beh.uren': { nl: '{n} uur', ar: '{n} ساعة', en: '{n} h' },
  // The six health states of cron-heartbeat.ts, as words. The judgement stays there; only the
  // label is here.
  'beh.gezond.ok': { nl: 'ok', ar: 'سليمة', en: 'ok' },
  'beh.gezond.nogNietLangs': { nl: 'nog niet langs', ar: 'لم يحن دورها بعد', en: 'not due yet' },
  'beh.gezond.nooitGedraaid': { nl: 'nooit gedraaid', ar: 'لم يُشغَّل قط', en: 'never ran' },
  'beh.gezond.afgebroken': { nl: 'afgebroken', ar: 'توقفت في المنتصف', en: 'aborted' },
  'beh.gezond.gefaald': { nl: 'gefaald', ar: 'فشل', en: 'failed' },
  'beh.gezond.teLangStil': { nl: 'te lang stil', ar: 'صامتة أطول من اللازم', en: 'silent too long' },

  // The failures of the last days.
  'beh.storingOnleesbaar': { nl: 'Het storingsbeeld is niet te lezen', ar: 'تعذّرت قراءة صورة الأعطال', en: 'The failure picture cannot be read' },
  'beh.storingOnleesbaarUitleg': {
    nl: 'We weten dus niet of er de afgelopen {days} dagen iets is misgegaan. Dat is niet hetzelfde als "er ging niets mis".',
    ar: 'لا نعرف إذًا إن حدث خطأ في آخر {days} يومًا. وهذا ليس مثل «لم يحدث أي خطأ».',
    en: 'So we do not know whether anything went wrong in the last {days} days. That is not the same as "nothing went wrong".',
  },
  'beh.geenStoringen': { nl: 'Geen afgevangen storingen in {days} dagen', ar: 'لا أعطال مسجّلة خلال {days} يومًا', en: 'No caught failures in {days} days' },
  'beh.storingenEen': { nl: '1 afgevangen storing in {days} dagen', ar: 'عطل واحد مسجّل خلال {days} يومًا', en: '1 caught failure in {days} days' },
  'beh.storingenMeer': { nl: '{n} afgevangen storingen in {days} dagen', ar: '{n} أعطال مسجّلة خلال {days} يومًا', en: '{n} caught failures in {days} days' },
  'beh.minderDanUurGeleden': { nl: '< 1 uur geleden', ar: 'قبل أقل من ساعة', en: '< 1 hour ago' },
  'beh.urenGeleden': { nl: '{n} uur geleden', ar: 'قبل {n} ساعة', en: '{n} h ago' },

  // How often a person had to correct the reader.
  'beh.lees.onleesbaarKop': { nl: 'Leeskwaliteit is niet te lezen', ar: 'تعذّر قياس جودة القراءة', en: 'Reading quality cannot be read' },
  'beh.lees.onleesbaarUitleg': {
    nl: 'De vraag kon niet gesteld worden — géén bevestiging dat de lezer het goed doet.',
    ar: 'تعذّر طرح السؤال — وهذا ليس تأكيدًا أن القارئ يعمل جيدًا.',
    en: 'The question could not be asked — no confirmation that the reader is doing well.',
  },
  'beh.lees.kop': { nl: 'Leeskwaliteit', ar: 'جودة القراءة', en: 'Reading quality' },
  'beh.lees.uitleg': {
    nl: 'Hoe vaak een mens een gelezen bedrag of rekeningnummer moest verbeteren, laatste 90 dagen. Dit is de fout die IEMAND ZAG — een mislezing die niemand opmerkte ziet er van hier uit als een goede lezing.',
    ar: 'كم مرة اضطر إنسان إلى تصحيح مبلغ أو رقم حساب مقروء، خلال آخر 90 يومًا. هذه هي الأخطاء التي لاحظها أحد — أما القراءة الخاطئة التي لم يلاحظها أحد فتبدو من هنا قراءة صحيحة.',
    en: 'How often a person had to correct a read amount or account number, last 90 days. This is the error SOMEONE SAW — a misreading nobody noticed looks, from here, like a good reading.',
  },
  'beh.lees.gelezen': { nl: 'facturen gelezen', ar: 'فواتير مقروءة', en: 'invoices read' },
  'beh.lees.bedragVerbeterd': { nl: 'bedrag verbeterd', ar: 'مبلغ مصحَّح', en: 'amount corrected' },
  'beh.lees.ibanVerbeterd': { nl: 'rekeningnummer verbeterd', ar: 'رقم حساب مصحَّح', en: 'account number corrected' },
  'beh.lees.naBetaling': { nl: 'verbeterd ná betaling', ar: 'صُحِّح بعد الدفع', en: 'corrected after payment' },
  'beh.lees.foutpercentage': { nl: 'Gevonden foutpercentage:', ar: 'نسبة الأخطاء المكتشفة:', en: 'Found error rate:' },
  'beh.lees.leveranciersKop': { nl: 'Leveranciers met meer dan één verbetering', ar: 'مورّدون لديهم أكثر من تصحيح', en: 'Suppliers with more than one correction' },
  'beh.lees.leveranciersUitleg': {
    nl: 'Twee keer dezelfde leverancier is zelden toeval: meestal één documentsoort die de lezer niet aankan, en die komt bij elke volgende factuur terug.',
    ar: 'تكرار المورّد نفسه مرتين نادرًا ما يكون صدفة: غالبًا نوع مستند واحد لا يجيده القارئ، ويعود مع كل فاتورة قادمة.',
    en: 'The same supplier twice is rarely a coincidence: usually one document type the reader cannot handle, and it returns with every next invoice.',
  },
  'beh.lees.leverancier': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'beh.lees.verbeterd': { nl: 'Verbeterd', ar: 'صُحِّح', en: 'Corrected' },
  'beh.lees.vanHoeveel': { nl: 'Van hoeveel', ar: 'من أصل', en: 'Out of' },
  'beh.lees.wanneer': { nl: 'Wanneer', ar: 'متى', en: 'When' },
  'beh.lees.wat': { nl: 'Wat', ar: 'ماذا', en: 'What' },
  'beh.lees.was': { nl: 'Was', ar: 'كان', en: 'Was' },
  'beh.lees.werd': { nl: 'Werd', ar: 'أصبح', en: 'Became' },
  'beh.lees.geen': { nl: 'Geen enkele verbetering in deze periode.', ar: 'لا تصحيحات في هذه الفترة.', en: 'No corrections at all in this period.' },

  // Why the rest needed a person.
  'beh.vast.onleesbaarKop': { nl: 'Handwerk is niet te meten', ar: 'تعذّر قياس العمل اليدوي', en: 'Manual work cannot be measured' },
  'beh.vast.onleesbaarUitleg': {
    nl: 'De vraag kon niet gesteld worden — géén bevestiging dat de wachtrij leeg is.',
    ar: 'تعذّر طرح السؤال — وهذا ليس تأكيدًا أن قائمة الانتظار فارغة.',
    en: 'The question could not be asked — no confirmation that the queue is empty.',
  },
  'beh.vast.kop': { nl: 'Waarom kost dit handwerk', ar: 'لماذا يحتاج هذا إلى عمل يدوي', en: 'Why this takes manual work' },
  'beh.vast.uitleg': {
    nl: 'Inkomende documenten van de laatste 90 dagen: hoeveel de app zelf boekte, en waarom de rest op een mens wachtte. Elke regel is een minuut per document; de bovenste geeft de meeste tijd terug.',
    ar: 'المستندات الواردة خلال آخر 90 يومًا: كم قيّد التطبيق بنفسه، ولماذا انتظر الباقي إنسانًا. كل سطر يساوي دقيقة لكل مستند؛ والأول يوفر أكبر قدر من الوقت.',
    en: 'Incoming documents of the last 90 days: how many the app booked itself, and why the rest waited for a person. Every row is a minute per document; the top one gives back the most time.',
  },
  'beh.vast.binnen': { nl: 'documenten binnen', ar: 'مستندات واردة', en: 'documents received' },
  'beh.vast.vanzelf': { nl: 'vanzelf geboekt', ar: 'قُيّدت تلقائيًا', en: 'booked automatically' },
  'beh.vast.handwerk': { nl: 'handwerk', ar: 'عمل يدوي', en: 'manual work' },
  'beh.vast.vanzelfVerwerkt': { nl: 'Vanzelf verwerkt:', ar: 'عولج تلقائيًا:', en: 'Processed automatically:' },
  'beh.vast.zonderReden': { nl: '{u} van de {h} zonder vastgelegde reden', ar: '{u} من {h} بلا سبب مسجّل', en: '{u} of the {h} without a recorded reason' },
  'beh.vast.zonderRedenUitleg': {
    nl: 'Deze tellen niet mee hieronder: documenten van vóór deze meting dragen geen reden. Dat aantal hoort te dalen; stijgt het, dan schrijft een pad zijn reden niet meer op en is de lijst onvolledig.',
    ar: 'هذه لا تُحسب أدناه: المستندات التي سبقت هذا القياس لا تحمل سببًا. هذا العدد يجب أن ينخفض؛ وإن ارتفع فهناك مسار توقف عن تسجيل سببه والقائمة ناقصة.',
    en: 'These do not count below: documents from before this measurement carry no reason. That number should fall; if it rises, a path has stopped writing its reason and the list is incomplete.',
  },
  'beh.vast.reden': { nl: 'Reden', ar: 'السبب', en: 'Reason' },
  'beh.vast.aantal': { nl: 'Aantal', ar: 'الكمية', en: 'Count' },
  'beh.vast.aandeel': { nl: 'Aandeel', ar: 'النسبة', en: 'Share' },
  'beh.vast.vooralBij': { nl: 'Vooral bij', ar: 'غالبًا عند', en: 'Mostly at' },
  'beh.vast.verspreid': { nl: 'verspreid', ar: 'متفرّق', en: 'spread out' },
  'beh.vast.geen': { nl: 'Geen enkele vastgelegde reden in deze periode.', ar: 'لا أسباب مسجّلة في هذه الفترة.', en: 'No recorded reason at all in this period.' },

} satisfies Record<string, Message>

export type MessageKey = keyof typeof MESSAGES
