// src/app/ar/prijzen/page.tsx
// [BILLING/AR] Arabic pricing page (RTL). A translated copy of /prijzen that
// REUSES the same price values from lib and the same SubscribeButton — no
// billing logic is duplicated or changed here.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { PLUS } from '@/lib/plan'
import { fairUseLimit } from '@/lib/fair-use'
import { BEWAARPLICHT_YEARS, KLUIS_GRACE_MONTHS, eur, KLUIS_PREPAY_YEAR_PRICE_EUR } from '@/lib/bewaarkluis'
import SubscribeButton from '@/app/prijzen/SubscribeButton'
import { isAnnualBillingConfigured } from '@/lib/billing'

export const metadata: Metadata = {
  title: 'الأسعار — مجاني لك ولمحاسبك | BoekBrug',
  description:
    `جرّب BoekBrug مجاناً: ${fairUseLimit('invoicesSent').free} فواتير و${fairUseLimit('aiDocuments').free} مستندات يقرأها الذكاء الاصطناعي شهرياً. باقة Plus تكلّف ${PLUS.priceLabel} شهرياً أو ${PLUS.annualPriceLabel} سنوياً (شامل الضريبة). بلا فترة تجريبية، بلا خصم تلقائي، ولا قفل على إدارتك الخاصة.`,
  keywords: ['أسعار boekbrug', 'برنامج محاسبة مجاني هولندا', 'تكلفة محاسبة zzp', 'واجب الحفظ 7 سنوات'],
  alternates: {
    canonical: '/ar/prijzen',
    languages: { 'nl-NL': '/prijzen', 'en-GB': '/en/prijzen', ar: '/ar/prijzen', 'tr-TR': '/tr/prijzen' },
  },
  openGraph: {
    title: 'BoekBrug — مجاني لك ولمحاسبك',
    description: `باقة Plus تكلّف ${PLUS.priceLabel} شهرياً أو ${PLUS.annualPriceLabel} سنوياً — اثنا عشر شهراً بسعر تسعة.`,
    type: 'website',
    locale: 'ar_AR',
  },
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }
const arFont = 'var(--font-arabic), var(--font-sans), system-ui, sans-serif'

const INCLUDED = [
  'إنشاء الفواتير وإرسالها ومتابعتها (مع طلب دفع)',
  'مسح الإيصالات وفواتير الشراء بالذكاء الاصطناعي',
  'جلب الفواتير تلقائياً من بريدك الإلكتروني',
  'استيراد كشف البنك ومطابقته تلقائياً',
  'دفتر النقد ومبيعات اليوم',
  'تحضير إقرار ضريبة القيمة المضافة (بما فيه نظام KOR)',
  'الجسر إلى محاسبك — زرّ واحد، وكل شيء مكتمل',
  'خزنة الامتثال: إدارتك مرتّبة وقابلة للتصدير سنة بسنة',
]

export default function ArPricingPage() {
  const ai = fairUseLimit('aiDocuments')
  // [JAARPRIJS] Server-side: a missing annual price costs one button, never the monthly flow,
  // and the Stripe price id never crosses to the browser — only this boolean does.
  //
  // ⚠ THIS PAGE IS STATIC (○ in the build output), so this boolean is baked in AT BUILD TIME.
  // The Dutch /prijzen is dynamic (ƒ) and re-reads it per request; these three do not. Setting
  // STRIPE_PRICE_ID_PLUS_YEAR after a deploy therefore lights up the annual button on /prijzen
  // immediately and on this page only after the next build. Set the variable before deploying,
  // or redeploy once it is set — see docs/JOUW_LIJST.md.
  const annualAvailable = isAnnualBillingConfigured()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: arFont }}>
      <PublicHeader />

      <main dir="rtl" style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        <p style={{ fontSize: 14, margin: '0 0 12px' }}>
          <Link href="/prijzen" style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 600 }}>🇳🇱 اعرضها بالهولندية →</Link>
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#202124', margin: '0 0 8px', lineHeight: 1.35 }}>
          لست مضطراً لمسك الدفاتر. <span style={{ color: '#1a73e8' }}>عليك فقط ألّا تفقد شيئاً.</span>
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.7, maxWidth: 640 }}>
          صوّر إيصالاتك أو دعها تصل عبر بريدك؛ وفي نهاية الربع يكون كل شيء جاهزاً لمحاسبك.
        </p>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.7, maxWidth: 620 }}>
          وهذا <strong>مجاناً</strong> — لك ولمحاسبك. بلا فترة تجريبية تنتهي بصمت، بلا بطاقة ائتمان مسبقاً، ولا قفل على إدارتك الخاصة.
        </p>

        {/* الخطط الثلاث */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <section style={{ ...card, borderColor: '#137333', borderWidth: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#137333', letterSpacing: 0.4 }}>صاحب العمل الحر</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>كل الميزات، للتجربة</div>
            <Link href="/register" style={{ display: 'block', textAlign: 'center', padding: '12px 20px', background: '#137333', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>ابدأ مجاناً</Link>
            <ul style={{ fontSize: 13.5, color: '#3c4043', margin: '16px 0 0', paddingInlineStart: 18, lineHeight: 1.8 }}>
              <li>فواتير مُرسَلة: <strong>{fairUseLimit('invoicesSent').free} شهرياً</strong></li>
              <li>مستندات يقرأها الذكاء الاصطناعي: <strong>{fairUseLimit('aiDocuments').free} شهرياً</strong></li>
              <li>مساحة: <strong>{fairUseLimit('storageMb').free} MB</strong></li>
              <li>صندوق بريد مربوط: <strong>{fairUseLimit('mailboxes').free}</strong></li>
            </ul>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '12px 0 0', lineHeight: 1.7 }}>
              يكفي لترى كيف يعمل. إن أدرت عليه عملك فستتجاوزها — وهذا هو المقصود. كل ما تُدخله يبقى لك، بعد ذلك أيضاً.
            </p>
          </section>

          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A73E8', letterSpacing: 0.4 }}>{PLUS.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>{PLUS.priceLabel}</span>
              <span style={{ fontSize: 15, color: '#5f6368' }}>شهرياً</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>شامل الضريبة · يمكن الإلغاء في أي وقت</div>
            {/* [JAARPRIJS] السعر السنوي: اثنا عشر شهراً بسعر تسعة. الرقم مشتقّ من plan.ts. */}
            {annualAvailable && (
              <p style={{ fontSize: 14.5, fontWeight: 600, color: '#188038', margin: '0 0 12px' }}>
                أو {PLUS.annualPriceLabel} سنوياً — اثنا عشر شهراً بسعر تسعة.
              </p>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              <SubscribeButton interval="month" label={`اشترك في Plus — ${PLUS.priceLabel} شهرياً`} />
              {annualAvailable && (
                <SubscribeButton interval="year" variant="secondary" label={`Plus سنوياً — ${PLUS.annualPriceLabel}`} />
              )}
            </div>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.7 }}>
              {/* [EERLIJK-WOORD] كان هنا «ترفع كل حدّ إلى {ai.plus}»، و ai.plus يساوي صفراً لأن
                  Plus لا تنشر سقفاً — فكانت الجملة تُعرض «ترفع كل حدّ إلى 0»: أضيق رقم ممكن في
                  الموضع الذي يقصد فيه أوسع وعد. */}
              هذه هي الباقة التي تدير عليها عملك. لا سقف منشور على الفواتير ولا على المستندات التي يقرأها الذكاء الاصطناعي ولا على المساحة — واسعة، ضمن الاستخدام العادل. صندوقا بريد بدل واحد. فوق {ai.free} مستندات شهرياً تكون Plus هي الجواب.
            </p>
          </section>

          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6368', letterSpacing: 0.4 }}>المحاسب</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>دائماً، مهما كان عدد العملاء</div>
            <Link href="/register" style={{ display: 'block', textAlign: 'center', padding: '12px 20px', background: '#fff', color: '#1A73E8', border: '1.5px solid #1A73E8', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>افتح البوابة</Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.7 }}>
              البوابة الكاملة، ولوحة العمل، وجلب ربع سنة مقفل لكل عميل. لا توجد باقة محاسب مدفوعة، ولن توجد.
            </p>
          </section>
        </div>

        {/* ما يشمله كل شيء */}
        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: '0 0 14px' }}>هذا موجود في كل الباقات — بما فيها المجانية</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {INCLUDED.map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: '#202124', lineHeight: 1.6 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.7 }}>
            حدود الباقة المجانية منشورة بالرقم على <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>/eerlijk-gebruik</Link>. إن تجاوزت حدّاً، يتوقّف فقط الإجراء الذي يكلّفنا مالاً. أمّا عرض إدارتك والبحث فيها وتصديرها فيبقى يعمل دائماً — فوق الحدّ، وبعد أن تتوقّف.
          </p>
        </section>

        {/* خزنة الحفظ */}
        <section style={{ ...card, marginTop: 16, background: '#FFFBF2', borderColor: '#E8C89A' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C5800', letterSpacing: 0.4 }}>خزنة الحفظ من BoekBrug</div>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '8px 0 10px' }}>تتوقّف عن عملك. لكن واجب الحفظ لا يتوقّف.</h2>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.8, maxWidth: 660 }}>
            تطلب مصلحة الضرائب أن تكون قادراً على إظهار إدارتك لمدّة <strong>{BEWAARPLICHT_YEARS} سنوات</strong> (المادة 52 AWR). تستمرّ هذه المدّة بعد توقّف شركتك، وبعد توقّف برنامجك أيضاً. إنه الشيء الوحيد الذي يجب أن يبقى صاحب العمل قادراً عليه بعد أن توقّف عن كل شيء — وهو بالضبط ما لا يكون جاهزاً عادةً.
          </p>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.8, maxWidth: 660 }}>
            نحفظ أرشيفك على الإنترنت: مرتّباً حسب السنة والربع، قابلاً للبحث، وقابلاً للتصدير سنة بسنة بزرّ واحد كملف ZIP مع فهرس. يكلّف ذلك <strong>{eur(KLUIS_PREPAY_YEAR_PRICE_EUR)} لكل سنة حفظ متبقّية</strong>، تُدفع مرة واحدة مقدّماً. لو أغلقت عملك اليوم فذلك {eur(BEWAARPLICHT_YEARS * KLUIS_PREPAY_YEAR_PRICE_EUR)} للمدّة كاملة.
          </p>
          <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.8, maxWidth: 660 }}>
            <strong>ما لا نبيعه:</strong> لا نتولّى واجب الحفظ عنك — يبقى قانونياً من مسؤوليتك. نحن نسختك الثانية، لا الوحيدة أبداً؛ فحمّل نسختك الخاصة أيضاً. وفي أول <strong>{KLUIS_GRACE_MONTHS} شهراً بعد إلغائك نحفظ كل شيء مجاناً</strong>، مع تحذير بالبريد قبل أن يُحذف أي شيء بوقت كافٍ. <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>الشروط §5.7</Link>.
          </p>
        </section>

        {/* الأسئلة الشائعة */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>أسئلة شائعة</h2>
          <div style={{ display: 'grid', gap: 14 }}>
            <Faq q="هل هو مجاني فعلاً أم فترة تجريبية؟">
              لا تعدّ أي ساعة. الباقة المجانية لا تتوقف من تلقاء نفسها، ولا تترك بيانات دفع، فلا يمكن أن يُخصم منك شيء أبداً. ما تحدّه هو الكمية شهرياً: إرسال {fairUseLimit('invoicesSent').free} فواتير و{ai.free} مستندات يقرأها الذكاء الاصطناعي. يكفي ذلك لترى كيف يعمل BoekBrug ولا يكفي لتدير عليه سنة — وهذا هو التصميم. كل الحدود على <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>صفحة واحدة</Link>.
            </Faq>
            <Faq q="ماذا يحدث إن تجاوزت الاستخدام العادل؟">
              تصلك رسالة عند 80% من أي حدّ، بالرقم الدقيق — أي قبل أن يحدث شيء. إن تجاوزته، يتوقّف <em>فقط</em> الإجراء الذي يكلّفنا مالاً: قراءة مستند جديد تلقائياً، أو إرسال فاتورة جديدة. كل ما هو موجود يبقى مقروءاً وقابلاً للتصدير. ثم تختار: الانتظار للشهر التالي، أو أخذ Plus.
            </Faq>
            <Faq q="هل يدفع محاسبي أيضاً؟">
              لا، ولن يتغيّر ذلك. بوابة المحاسب مجانية، حتى مع مئة عميل مرتبط. لا توجد باقة محاسب مدفوعة.
            </Faq>
            <Faq q="هل يمكنني الإلغاء؟">
              نعم، في أي وقت وفوراً — تلغي Plus بنفسك من إعداداتك، بلا بريد ولا مكالمة. تبقى Plus حتى نهاية المدّة التي دفعتها: حتى نهاية الشهر إن كنت تدفع شهرياً، وحتى نهاية السنة إن كنت تدفع سنوياً. بعدها تعود إلى الباقة المجانية. المدّة المدفوعة لا تُرَدّ تلقائياً، إلا إذا تعذّر استعمال الخدمة مدّة طويلة بسببنا. لا تفقد أي بيانات.
            </Faq>
            <Faq q="هل أحصل على فاتورة بالضريبة؟">
              نعم. كل دفعة تُنتج تلقائياً فاتورة ضريبية باسمك يمكنك تنزيلها بنفسك. إن كان لديك رقم ضريبي، تضيفه عند الدفع.
            </Faq>
            <Faq q="كيف أدفع؟">
              عبر iDEAL أو بطاقة ائتمان. يتمّ الدفع عبر Stripe — بيانات بطاقتك لا تصل إلى BoekBrug أبداً.
            </Faq>
            <Faq q="ماذا لو توقّفت عن BoekBrug تماماً؟">
              تصدّر كل شيء (وهذا يبقى يعمل دائماً، حتى في الباقة المجانية). بعد ذلك نحفظ إدارتك مجاناً {KLUIS_GRACE_MONTHS} شهراً إضافياً. أتريدها أن تبقى أطول لأن واجب الحفظ مستمرّ؟ لذلك وُجدت خزنة الحفظ. لا نحذف شيئاً أبداً دون إشعار بالبريد قبل 30 يوماً على الأقل.
            </Faq>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}
