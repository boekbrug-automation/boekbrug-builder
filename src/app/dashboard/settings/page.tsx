//src/app/dashboard/settings/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { amsterdamToday } from '@/lib/format-nl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PushNotificationCard } from '@/components/settings/PushNotificationCard'
import AdresZoeker from '@/components/AdresZoeker'
// [TAAL] De taal van het SCHERM. Niet van de documenten — die blijven Nederlands, want die leest
// de klant en de Belastingdienst. Zie src/lib/i18n/locale.ts.
import { LanguageCard } from '@/components/settings/LanguageCard'
// [VAK-KIEZEN] The owner's trade: the door that is always open to the work layer.
import { VakCard } from '@/components/settings/VakCard'
// [SNELSTART] Live koppeling met SnelStart (B2B-API) — koppelen, rekeningen kiezen, doorsturen
import { SnelStartCard } from '@/components/settings/SnelStartCard'
import { MollieCard } from '@/components/settings/MollieCard'
// [FACTUUR-B] numbering extraction (client-side live preview)
import { previewInvoiceStart, reasonToDutch } from '@/lib/invoice-template'
// [BRIDGE-POLISH 3a-3] formal validation for KVK / BTW / IBAN
import {
  validateKvk, validateBtw, validateIban,
  normalizeBtw, normalizeIban,
} from '@/lib/validation'
import type { ProfileRow } from '@/types/rows'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { COLUMN } from '@/lib/design/tokens';
// [BTW-VERKLARING] Zelfde normalisatie en zelfde maximum als de PDF gebruikt.
import { cleanVatNote, MAX_NOTE_LENGTH } from '@/lib/vat-statement'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'

export default function SettingsPage() {
  const t = translator(useLocale())
  const dialog = useDialog()
  const toast = useToast()
  const router = useRouter()
  const supabase = createClient()
  const [accountant, setAccountant] = useState<ProfileRow | null>(null)
  // [MANDAAT] Mag mijn boekhouder facturen op mijn naam uitreiken? Los van de koppeling, want het
  // is een losse beslissing: bijna iedereen laat zijn boekhouder meekijken, bijna niemand laat hem
  // ongevraagd factureren.
  const [mayInvoice, setMayInvoice] = useState(false)
  // [BEVESTIGEN] De tweede machtiging, en bewust een APARTE schakelaar. Wie zijn boekhouder zijn
  // boeken laat aftekenen, laat hem daarmee nog niet factureren onder zijn btw-nummer — en
  // andersom. Twee besluiten, twee knoppen.
  const [mayConfirm, setMayConfirm] = useState(false)
  const [mandaatBezig, setMandaatBezig] = useState<string | null>(null)
  // حالة الملف الشخصي
  const [profile, setProfile] = useState<ProfileRow | null>(null)

  // حقول تعديل الملف الشخصي
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [kvk, setKvk] = useState('')
  const [btw, setBtw] = useState('')
  const [iban, setIban] = useState('')
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  // [REGIME-FLAGS] KOR (kleineondernemersregeling) opt-in. Saved with the profile; drives the
  // accountant-handoff flag ("KOR is actief — bereken geen BTW"), never a figure by itself.
  const [korActive, setKorActive] = useState(false)
  // [KASSTELSEL] BTW basis: factuurstelsel (accrual) vs kasstelsel (cash basis — BTW on the pay
  // date). vat_scheme_since is the effective date; set when switching TO kas so a past quarter is
  // never retroactively rewritten.
  const [vatScheme, setVatScheme] = useState<'factuur' | 'kas'>('factuur')
  const [vatSchemeSince, setVatSchemeSince] = useState<string | null>(null)
  // [VRIJGESTELD] Declares (partly) BTW-exempt turnover (art. 11 Wet OB). Like vat_scheme it
  // carries an effective date, and for the same reason: without it, turning this on today would
  // re-apportion the deduction of a quarter that has already been filed.
  const [vatExemptActivity, setVatExemptActivity] = useState(false)
  // [BTW-VERKLARING] De eigen zin die op de factuur komt als er geen btw wordt berekend.
  const [vatStatementNote, setVatStatementNote] = useState('')
  const [vatExemptSince, setVatExemptSince] = useState<string | null>(null)
  // [REMINDERS] Automatic payment reminders — opt-in + cadence, saved with the profile.
  // Default OFF: nothing is ever e-mailed to a client until the owner turns this on.
  const [remindersEnabled, setRemindersEnabled] = useState(false)
  // [HERINNER-AAN] De stand zoals hij geladen werd. Nodig om AANZETTEN te onderscheiden van
  // "stond al aan, ik wijzig alleen de dagen" — zie de opslag hieronder.
  const [remindersWereOn, setRemindersWereOn] = useState(false)
  // [OCHTEND] The morning digest mail — on unless the owner said otherwise (missing column = on).
  const [ochtendMail, setOchtendMail] = useState(true)
  // [ZELF-EERST] The autopilot switch. Default true = today's behavior for everyone.
  const [autoBoeken, setAutoBoeken] = useState(true)
  const [reminderOffsetsText, setReminderOffsetsText] = useState('14, 30')

  // حالة دعوة المحاسب
  const [accountantEmail, setAccountantEmail] = useState('')

  // حالات التحميل والنجاح والخطأ
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingInvite, setLoadingInvite] = useState(false)
  const [successProfile, setSuccessProfile] = useState('')
  const [successInvite, setSuccessInvite] = useState('')
  const [errorProfile, setErrorProfile] = useState('')
  const [errorInvite, setErrorInvite] = useState('')
  // [BRIDGE-POLISH 3a-3] per-field validation errors (KVK / BTW / IBAN)
  const [fieldErrors, setFieldErrors] = useState<{ kvk?: string; btw?: string; iban?: string }>({})

  // [BOEK-032] حالة تصدير البيانات + حذف الحساب
  const [exportConfirmed, setExportConfirmed] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [delEmail, setDelEmail] = useState('')
  const [delPassword, setDelPassword] = useState('')
  const [delLoading, setDelLoading] = useState(false)
  const [delError, setDelError] = useState('')

  // [FACTUUR-B] factuurnummering
  const [numberingNext, setNumberingNext] = useState<string>('')
  const [numberingLocked, setNumberingLocked] = useState(false)
  const [numberingInput, setNumberingInput] = useState('')
  const [numberingLoading, setNumberingLoading] = useState(false)
  const [numberingSuccess, setNumberingSuccess] = useState('')
  const [numberingError, setNumberingError] = useState('')

  // [FACTUUR-B] load current numbering state (next number + lock)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/invoice/numbering')
        if (!res.ok) return
        const d = await res.json()
        if (d?.ok) {
          setNumberingNext(d.next ?? '')
          setNumberingLocked(!!d.locked)
        }
      } catch { /* silent */ }
    })()
  }, [])

  // تحميل بيانات الملف الشخصي عند فتح الصفحة
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setProfile(data)
        // تعبئة الحقول بالبيانات الموجودة
        setFullName(data.full_name || '')
        setCompanyName(data.company_name || '')
        setKvk(data.kvk_number || '')
        setBtw(data.btw_number || '')
        setIban(data.iban || '')
        setAddress(data.address || '')
        setPostalCode(data.postal_code || '')
        setCity(data.city || '')
        setKorActive(!!data.kor_active)
        setVatScheme(data.vat_scheme === 'kas' ? 'kas' : 'factuur')
        setVatSchemeSince(data.vat_scheme_since ?? null)
        setVatExemptActivity(!!data.vat_exempt_activity)
        setVatStatementNote((data as { vat_statement_note?: string | null }).vat_statement_note ?? '')
        setVatExemptSince(data.vat_exempt_since ?? null)
        setRemindersEnabled(!!data.reminders_enabled)
        setRemindersWereOn(!!data.reminders_enabled)
        setOchtendMail((data as { ochtend_mail?: boolean | null }).ochtend_mail !== false)
        setAutoBoeken((data as { auto_boeken?: boolean | null }).auto_boeken !== false)
        setReminderOffsetsText(
          (Array.isArray(data.reminder_offsets) && data.reminder_offsets.length > 0
            ? data.reminder_offsets
            : [14, 30]
          ).join(', ')
        )
      }
      // جلب محاسب الـ ZZP'er إذا كان مرتبطاً — via API (service role bypasses RLS)
      if (data?.role === 'zzper') {
        const res = await fetch('/api/settings/accountant')
        if (res.ok) {
          const json = await res.json()
          if (json.accountant) setAccountant(json.accountant)
          setMayInvoice(Boolean(json.mayInvoice))
          setMayConfirm(Boolean(json.mayConfirm))
        }
      }

      // [BOEK-032] هل سبق تأكيد تصدير البيانات؟ (يُبقي زر الحذف مُفعّلاً لو غادر وعاد)
      const { data: dr } = await supabase
        .from('deletion_requests')
        .select('export_confirmed')
        .eq('user_id', user.id)
        .maybeSingle()
      if (dr?.export_confirmed) setExportConfirmed(true)
    }
    load()
  }, [])

  // حفظ تعديلات الملف الشخصي
  async function saveProfile() {
    setLoadingProfile(true)
    setErrorProfile('')
    setSuccessProfile('')

    // [BRIDGE-POLISH 3a-3] Formal validation BEFORE any write. Empty values are
    // valid (all three fields are optional); only non-empty malformed values
    // block the save. Errors surface inline per field.
    const kvkRes  = validateKvk(kvk)
    const btwRes  = validateBtw(btw)
    const ibanRes = validateIban(iban)
    const nextErrors = {
      kvk:  kvkRes.valid  ? undefined : kvkRes.error,
      btw:  btwRes.valid  ? undefined : btwRes.error,
      iban: ibanRes.valid ? undefined : ibanRes.error,
    }
    if (!kvkRes.valid || !btwRes.valid || !ibanRes.valid) {
      setFieldErrors(nextErrors)
      setErrorProfile(t('inst.controleerVelden'))
      setLoadingProfile(false)
      return
    }
    setFieldErrors({})

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // [KASSTELSEL] When switching TO kas, anchor the effective date to the CURRENT quarter's
    // start (a clean boundary — no mid-quarter straddle): the current + future quarters compute
    // kas, past quarters stay factuur and are never retroactively rewritten. Keep the existing
    // since-date if already on kas. (A different agreed start-date is an accountant matter.)
    // [TZ-KLANT] De grens van het kwartaal in EUROPE/AMSTERDAM, niet in de tijdzone van het
    // apparaat. Dit is een 'use client'-bestand, dus `new Date().getMonth()` is de maand van de
    // BROWSER — en de twee lopen uiteen op precies de uren waarin deze datum het meeste doet.
    //
    // Op 1 april 01:00 Amsterdam is het bij een ondernemer met een klok op UTC−5 nog 31 maart.
    // Zijn apparaat zegt dan maart, `qStart` wordt 2026-01-01, en het kwartaal dat hij zojuist
    // heeft afgesloten wordt met terugwerkende kracht op kasstelsel gezet — precies wat de regel
    // hierboven zegt nooit te mogen gebeuren ("past quarters stay factuur and are never
    // retroactively rewritten"). Hetzelfde geldt voor de vrijstelling: die gaat dan in over een
    // kwartaal dat al is aangegeven.
    //
    // amsterdamToday() werkt in de browser net zo goed als op de server: het is Intl met een vaste
    // timeZone, niet de systeemklok.
    const vandaag = amsterdamToday()
    const qStart = `${vandaag.slice(0, 4)}-${String(Math.floor((Number(vandaag.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
    let since = vatSchemeSince
    if (vatScheme === 'kas' && (profile?.vat_scheme !== 'kas' || !since)) since = qStart
    // [VRIJGESTELD] Same anchoring, same reason: a declaration takes effect from the START of
    // the current quarter, never mid-quarter and never backwards over a filed one. Switching it
    // OFF clears the date, so a later re-declaration anchors fresh instead of reviving an old one.
    let exemptSince = vatExemptSince
    if (vatExemptActivity && (!profile?.vat_exempt_activity || !exemptSince)) exemptSince = qStart
    if (!vatExemptActivity) exemptSince = null

    // [REMINDERS] Parse the cadence text into positive ints (unique, ascending).
    // Empty/garbage falls back to the default {14,30} so the schedule is never blank.
    const parsedOffsets = Array.from(new Set(
      reminderOffsetsText
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0)
    )).sort((a, b) => a - b)
    const finalOffsets = parsedOffsets.length > 0 ? parsedOffsets : [14, 30]

    // [BRIDGE-POLISH 3a-3] Store the CANONICAL form (normalized), never the raw
    // input — so what we persist always matches what was validated. KVK keeps
    // its trimmed digits; BTW/IBAN are upper-cased + whitespace-stripped.
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        company_name: companyName,
        kvk_number: kvk.trim() || null,
        btw_number: normalizeBtw(btw) || null,
        iban: normalizeIban(iban) || null,
        address: address,
        postal_code: postalCode,
        city: city,
        kor_active: korActive,
        vat_scheme: vatScheme,
        vat_scheme_since: since,
      })
      .eq('id', user.id)

    if (error) {
      setErrorProfile(t('inst.opslaanMislukt'))
    } else {
      // [REMINDERS] Persist the reminder preferences in a SEPARATE, best-effort
      // update — never bundled with the core save above. Reason: if this deploys
      // before the invoice_reminders migration is applied, those two columns don't
      // exist yet; bundling them would make the WHOLE profile save fail ("column
      // does not exist") and brick Instellingen for every user. Split out, a
      // pre-migration miss is a silent no-op here while name/KVK/BTW still save.
      // Post-migration it simply succeeds. Order of deploy vs. migration no longer
      // matters.
      const { error: remErr } = await supabase
        .from('profiles')
        // [HERINNER-AAN] De klok begint alleen bij een échte overgang UIT → AAN.
        //
        // Niet bij elke opslag met de schakelaar aan: dan zou het wijzigen van de herinnerdagen —
        // een knop die niets met de stapel te maken heeft — het moment naar vandaag schuiven en
        // stilzwijgend elke factuur die sindsdien verviel buiten beeld zetten. De ondernemer zou
        // zien dat zijn herinneringen ophouden zonder dat iets op het scherm dat uitlegt.
        //
        // Ook niet bij uitzetten: het moment blijft staan, zodat weer aanzetten na een week pauze
        // niet alsnog de stapel van vóór die pauze losmaakt.
        .update({
          reminders_enabled: remindersEnabled,
          reminder_offsets: finalOffsets,
          ...(remindersEnabled && !remindersWereOn
            ? { reminders_enabled_at: new Date().toISOString() }
            : {}),
        })
        .eq('id', user.id)
      if (remErr) {
        console.warn('[REMINDERS] reminder-preferences save skipped (migration applied?)', remErr.message)
      } else {
        // Geslaagd → dit is voortaan de geladen stand, zodat een tweede opslag in dezelfde sessie
        // niet opnieuw als "aanzetten" telt.
        setRemindersWereOn(remindersEnabled)
      }

      // [OCHTEND] Same shape, same reason: before ochtend_mail.sql this column does not exist,
      // and bundling it would brick the whole profile save.
      const { error: ochtendErr } = await supabase
        .from('profiles')
        .update({ ochtend_mail: ochtendMail })
        .eq('id', user.id)
      if (ochtendErr) {
        console.warn('[OCHTEND] morning-mail preference save skipped (migration applied?)', ochtendErr.message)
      }

      // [ZELF-EERST] Same shape, same reason: before auto_boeken.sql this column does not exist,
      // and bundling it would brick the whole profile save.
      const { error: autoBoekenErr } = await supabase
        .from('profiles')
        .update({ auto_boeken: autoBoeken })
        .eq('id', user.id)
      if (autoBoekenErr) {
        console.warn('[ZELF-EERST] autopilot preference save skipped (migration applied?)', autoBoekenErr.message)
      }

      // [VRIJGESTELD] Separate + best-effort for exactly the reason spelled out above: before
      // vat_exemption.sql is applied these two columns do not exist, and bundling them into the
      // core save would fail the WHOLE profile update and brick Instellingen for every user —
      // including the ones who have no exempt turnover at all.
      const { error: exemptErr } = await supabase
        .from('profiles')
        .update({ vat_exempt_activity: vatExemptActivity, vat_exempt_since: exemptSince })
        .eq('id', user.id)
      if (exemptErr) {
        console.warn('[VRIJGESTELD] exemption declaration save skipped (migration applied?)', exemptErr.message)
      }

      // [BTW-VERKLARING] Apart en best-effort, om precies dezelfde reden als hierboven: vóór
      // vat_statement_note.sql bestaat deze kolom niet, en meeschrijven in de kernopslag zou het
      // HELE profiel laten falen voor iedereen — ook voor wie deze zin nooit invult.
      const { error: noteErr } = await supabase
        .from('profiles')
        .update({ vat_statement_note: cleanVatNote(vatStatementNote) || null })
        .eq('id', user.id)
      if (noteErr) {
        console.warn('[BTW-VERKLARING] btw-toelichting save skipped (migration applied?)', noteErr.message)
      }

      // Reflect the normalized values back into the form fields
      setBtw(normalizeBtw(btw))
      setIban(normalizeIban(iban))
      setKvk(kvk.trim())
      setVatSchemeSince(since) // [KASSTELSEL] keep local since in sync with what we persisted
      setVatExemptSince(exemptSince) // [VRIJGESTELD] idem — so a second save does not re-anchor
      setReminderOffsetsText(finalOffsets.join(', ')) // [REMINDERS] reflect the normalized cadence
      setSuccessProfile(t('inst.profielOpgeslagen'))
    }

    setLoadingProfile(false)
  }

  // [FACTUUR-B] save numbering via the single server authority (lock + seed live there)
  async function saveNumbering() {
    setNumberingLoading(true); setNumberingError(''); setNumberingSuccess('')
    try {
      const res = await fetch('/api/invoice/numbering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_start: numberingInput.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNumberingError(failureText(res.status, d, t('inst.opslaanMislukt')))
        if (d?.locked) setNumberingLocked(true)
      } else {
        setNumberingNext(d.next ?? '')
        setNumberingInput('')
        setNumberingSuccess(t('inst.nummeringOpgeslagen'))
      }
    } catch {
      setNumberingError(t('inst.opslaanMislukt'))
    }
    setNumberingLoading(false)
  }

  // إرسال دعوة للمحاسب
  async function sendInvite() {
    if (!accountantEmail) { setErrorInvite(t('inst.vulEmail')); return }
    setLoadingInvite(true)
    setErrorInvite('')
    setSuccessInvite('')

    const res = await fetch('/api/invite/accountant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountantEmail })
    })

    const data = await res.json()

    if (!res.ok) {
      setErrorInvite(failureText(res.status, data, t('inst.uitnodigingMislukt')))
    } else if (data.warning === 'email_failed') {
      // [INVITE-HONEST] The invitation row was created but the e-mail did NOT go out (Resend
      // rejected it / no API key). Don't claim "verstuurd" — tell the owner to share the link
      // themselves so the invite isn't silently lost.
      setErrorInvite(t('inst.uitnodigingNietVerzonden'))
    } else {
      setSuccessInvite(t('inst.uitnodigingVerstuurd', { email: accountantEmail }))
      setAccountantEmail('')
    }
    setLoadingInvite(false)
  }
  // إزالة ربط المحاسب مع تأكيد
  async function unlinkAccountant() {
    const confirmed = await dialog.confirm({
      title: t('inst.ontkoppelTitel'),
      message: t('inst.ontkoppelUitleg', {
        name: accountant?.full_name || accountant?.email || t('inst.jeBoekhouder'),
      }),
      confirmLabel: t('inst.ontkoppelen'),
      danger: true,
    })
    if (!confirmed) return

    // Call API — handles email notification + audit log server-side
    const res = await fetch('/api/accountant/unlink-by-client', { method: 'POST' })
    if (res.ok) {
      setAccountant(null)
      // De machtigingen gaan mee — de route trekt ze in, dit scherm hoort dat meteen te tonen.
      setMayInvoice(false)
      setMayConfirm(false)
    } else {
      const data = await res.json().catch(() => ({}))
      toast(failureText(res.status, data, t('inst.ontkoppelenMislukt')), { tone: 'error' })
    }
  }

  // [MANDAAT] Een machtiging aan- of uitzetten. Eén functie voor beide soorten, want het verschil
  // zit in de TEKST en niet in de handeling.
  //
  // Aanzetten vraagt om bevestiging, uitzetten niet. Dat is met opzet asymmetrisch: het geven van
  // deze bevoegdheid is de stap met gevolgen, het terugnemen ervan hoort nooit door een dialoog te
  // worden vertraagd.
  async function toggleMandate(soort: 'facturen' | 'bevestigen') {
    if (mandaatBezig) return
    const aan = soort === 'facturen' ? mayInvoice : mayConfirm
    const naam = accountant?.company_name || accountant?.full_name || t('inst.jeBoekhouder')
    if (!aan) {
      const confirmed = await dialog.confirm({
        title:
          soort === 'facturen'
            ? t('inst.mandaatFacturenTitel')
            : t('inst.mandaatBevestigenTitel'),
        message:
          soort === 'facturen'
            ? t('inst.mandaatFacturenUitleg', { name: naam })
            : t('inst.mandaatBevestigenUitleg', { name: naam }),
        confirmLabel: t('inst.machtigen'),
      })
      if (!confirmed) return
    }
    setMandaatBezig(soort)
    const res = await fetch('/api/accountant/invoice-mandate', {
      method: aan ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: soort,
        ...(aan ? { otherId: accountant?.id } : { accountantId: accountant?.id }),
      }),
    })
    if (res.ok) {
      if (soort === 'facturen') setMayInvoice(!aan)
      else setMayConfirm(!aan)
    } else {
      const data = await res.json().catch(() => ({}))
      toast(failureText(res.status, data, t('inst.wijzigenMislukt')), { tone: 'error' })
    }
    setMandaatBezig(null)
  }

  // [BOEK-032] تصدير كل بيانات الحساb (ZIP) ثم تفعيل زر الحذف
  async function exportData() {
    setExportLoading(true)
    setDelError('')
    try {
      const res = await fetch('/api/account/export', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDelError(failureText(res.status, data, t('kluis.exportMislukt')))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `boekbrug-export-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setExportConfirmed(true)
    } catch {
      setDelError(t('inst.exportMisluktOpnieuw'))
    } finally {
      setExportLoading(false)
    }
  }

  // [GEEN-WACHTWOORD] Dit account heeft alleen een Google-identiteit, dus er is geen wachtwoord om
  // mee te bevestigen. Zie de route: die zei tot nu toe "Verkeerd e-mailadres of wachtwoord" — een
  // onwaarheid die de eigenaar op zoek stuurt naar iets wat nooit heeft bestaan.
  const [geenWachtwoord, setGeenWachtwoord] = useState(false)
  const [linkGestuurd, setLinkGestuurd] = useState(false)

  async function stuurWachtwoordLink() {
    const adres = (delEmail || profile?.email || '').trim()
    if (!adres) return
    // Dezelfde aanroep als /wachtwoord-vergeten. De uitkomst wordt bewust NIET onderscheiden: of
    // dit adres bestaat, is niets wat een scherm hoort te bevestigen.
    await supabase.auth.resetPasswordForEmail(adres, {
      redirectTo: `${window.location.origin}/wachtwoord-herstellen`,
    })
    setLinkGestuurd(true)
  }

  // [BOEK-032] تأكيد الحذف بـ email + password — تعطيل لا حذف فيزيائي
  async function confirmDelete() {
    if (!delEmail || !delPassword) {
      setDelError(t('inst.vulEmailWachtwoord'))
      return
    }
    setDelLoading(true)
    setDelError('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: delEmail, password: delPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // [GEEN-WACHTWOORD] Geen foutmelding maar een weg: dit account kán niet met een
        // wachtwoord bevestigen, dus het scherm biedt aan er een in te stellen.
        if ((data as { code?: string }).code === 'geen_wachtwoord') setGeenWachtwoord(true)
        setDelError(failureText(res.status, data, t('act.verwijderenMislukt')))
        return
      }
      await supabase.auth.signOut()
      router.push('/login')
    } catch {
      setDelError(t('lijst.fout.verwijderen'))
    } finally {
      setDelLoading(false)
    }
  }

  // انتظار تحميل البيانات
  if (!profile) return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <p className="text-gray-400 text-sm">{t('nieuw.actie.laden')}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      <div className="mx-auto px-6 py-6 space-y-4" style={{ maxWidth: COLUMN.work }}>

        {/* تعديل الملف الشخصي */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            {t('inst.profiel')}
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* الاسم الكامل */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.volledigeNaam')}</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder={t('inst.naamVoorbeeld')}
              />
            </div>

            {/* اسم الشركة */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.bedrijfsnaam')}</label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder={t('inst.bedrijfVoorbeeld')}
              />
            </div>

            {/* رقم KVK */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.kvkNummer')}</label>
              <input
                type="text"
                value={kvk}
                onChange={e => { setKvk(e.target.value); setFieldErrors(p => ({ ...p, kvk: undefined })) }}
                className={`w-full border rounded-xl px-3 py-2 text-sm ${fieldErrors.kvk ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="12345678"
              />
              {fieldErrors.kvk && <p className="text-xs text-red-500 mt-1">{fieldErrors.kvk}</p>}
            </div>

            {/* رقم BTW */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.btwNummer')}</label>
              <input
                type="text"
                value={btw}
                onChange={e => { setBtw(e.target.value); setFieldErrors(p => ({ ...p, btw: undefined })) }}
                className={`w-full border rounded-xl px-3 py-2 text-sm ${fieldErrors.btw ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="NL123456789B01"
              />
              {fieldErrors.btw && <p className="text-xs text-red-500 mt-1">{fieldErrors.btw}</p>}
            </div>

            {/* IBAN */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
              <input
                type="text"
                value={iban}
                onChange={e => { setIban(e.target.value); setFieldErrors(p => ({ ...p, iban: undefined })) }}
                className={`w-full border rounded-xl px-3 py-2 text-sm ${fieldErrors.iban ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="NL12 ABNA 0123 4567 89"
              />
              {fieldErrors.iban && <p className="text-xs text-red-500 mt-1">{fieldErrors.iban}</p>}
            </div>

            {/* العنوان */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.adres')}</label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Straatnaam 1"
              />
            </div>

            {/* الرمز البريدي */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.postcode')}</label>
              <input
                type="text"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="1234 AB"
              />
            </div>

            {/* المدينة */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('inst.stad')}</label>
              <input
                type="text"
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder={t('inst.stadInvullen')}
              />
            </div>

            {/* [ADRES-ECHT] Het eigen adres staat op elke factuur die dit account verstuurt, dus
                hier is een typefout duurder dan waar dan ook: hij gaat mee op ALLES. Het register
                stelt voor, de eigenaar neemt over. */}
            <div className="col-span-2">
              <AdresZoeker
                postcode={postalCode}
                huisnummer={address.replace(/^\D+/, '')}
                straat={address.replace(/\s*\d.*$/, '')}
                plaats={city}
                onOvernemen={(adres) => {
                  setAddress(`${adres.street} ${adres.houseNumber}${adres.addition ? `-${adres.addition}` : ''}`)
                  setPostalCode(`${adres.postcode.slice(0, 4)} ${adres.postcode.slice(4)}`)
                  setCity(adres.city)
                }}
              />
            </div>
          </div>

          {successProfile && <p className="text-sm text-green-600">{successProfile}</p>}
          {errorProfile && <p className="text-sm text-red-500">{errorProfile}</p>}

          {/* [REGIME-FLAGS] KOR — kleineondernemersregeling opt-in. Saved with the profile. */}
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={korActive}
                onChange={e => setKorActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  {t('inst.kor')}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.korUitleg')}
                </span>
              </span>
            </label>
          </div>

          {/* [VRIJGESTELD] Vrijgestelde omzet (art. 11 Wet OB). Verandert twee dingen tegelijk:
              die omzet gaat in GEEN rubriek, en de voorbelasting op gemengde kosten wordt pro
              rata. Uit tot je hem aanzet — voor de meeste ondernemers verandert er niets. */}
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={vatExemptActivity}
                onChange={e => setVatExemptActivity(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  {t('inst.vrijgesteld')}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.vrijgesteldUitleg')}
                </span>
                {vatExemptActivity && vatExemptSince && (
                  <span className="block text-xs text-gray-500 mt-1">
                    {t('inst.geldtVanaf', { date: vatExemptSince })}
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* [BTW-VERKLARING] De zin die op de factuur komt als er geen btw op zit.
              Waarom de ondernemer hem zelf schrijft: de app weet DAT een regel vrijgesteld is,
              nooit WELKE vrijstelling — die staan in art. 11 Wet OB en de juiste hangt af van het
              vak. Er een verzinnen zou een onjuiste juridische grond op de factuur van een klant
              zetten, en dat is erger dan de stilte die het vervangt. */}
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <label htmlFor="vat-note" className="block text-sm font-medium text-gray-800">
              {t('inst.toelichting')}
            </label>
            <p className="text-xs text-gray-500">
              {t('inst.toelichtingUitleg')} <em>{t('inst.toelichtingVoorbeeld')}</em>
              {' '}{t('inst.toelichtingKor')}
            </p>
            <input
              id="vat-note"
              type="text"
              value={vatStatementNote}
              onChange={e => setVatStatementNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              maxLength={MAX_NOTE_LENGTH}
              placeholder={t('inst.toelichtingPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* [KASSTELSEL] BTW-methode: factuurstelsel (accrual) vs kasstelsel (cash basis). */}
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <span className="block text-sm font-medium text-gray-800">{t('inst.btwMethode')}</span>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="vat_scheme"
                checked={vatScheme === 'factuur'}
                onChange={() => setVatScheme('factuur')}
                className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm text-gray-800">{t('inst.factuurstelsel')}</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.factuurstelsel.uitleg')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="vat_scheme"
                checked={vatScheme === 'kas'}
                onChange={() => setVatScheme('kas')}
                className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm text-gray-800">{t('inst.kasstelsel')}</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.kasstelselUitleg')}
                </span>
              </span>
            </label>
          </div>

          {/* [REMINDERS] Automatische betalingsherinneringen — opt-in + cadence. */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={e => setRemindersEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  {t('inst.herinneringen')}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.herinneringenUitleg')}
                </span>
              </span>
            </label>
            {remindersEnabled && (
              <div className="ps-7">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t('inst.herinnerNa')}
                </label>
                <input
                  type="text"
                  value={reminderOffsetsText}
                  onChange={e => setReminderOffsetsText(e.target.value)}
                  className="w-40 border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="14, 30"
                />
                <span className="block text-xs text-gray-400 mt-1">
                  {t('inst.herinnerVoorbeeld')}
                </span>
              </div>
            )}
          </div>

          {/* [ZELF-EERST] De autopiloot — uit betekent: alles wacht op jouw tik, ook de schoonste
              lezing. Dit is hoe een eigenaar die het nog niet vertrouwt het mag leren vertrouwen. */}
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoBoeken}
                onChange={e => setAutoBoeken(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  {t('inst.autoBoeken')}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.autoBoekenUitleg')}
                </span>
              </span>
            </label>
          </div>

          {/* [OCHTEND] De ochtendmail — één mail per dag, en alleen op dagen dat er iets gebeurde. */}
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ochtendMail}
                onChange={e => setOchtendMail(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  {t('inst.ochtendMail')}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('inst.ochtendMailUitleg')}
                </span>
              </span>
            </label>
          </div>

          {/* زر الحفظ */}
          <button
            onClick={saveProfile}
            disabled={loadingProfile}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loadingProfile ? t('inst.opslaanBezig') : t('inst.opslaan')}
          </button>
        </div>

        <VakCard />

        {/* [PUSH] Meldingen (push notifications) — self-hides when unavailable */}
        <LanguageCard />

        <PushNotificationCard />

        {/* [SNELSTART] Boekhoudkoppeling — self-hides when the server has no API key */}
        <SnelStartCard />

        {/* [MOLLIE] iDEAL-betaallinks via het eigen Mollie-account van de eigenaar. */}
        <MollieCard />

        {/* [BEVEILIGING] Verificatie in twee stappen stond hier, en staat nu op een eigen scherm.
            Eén plek om hem aan te zetten, en die plek staat naast het antwoord op de vraag die er
            werkelijk achter zit — wie kan er bij deze administratie. Twee schakelaars voor één slot
            is hoe iemand hem op het ene scherm uitzet en op het andere blijft lezen dat hij aanstaat. */}
        <a
          href="/dashboard/beveiliging"
          className="block bg-white rounded-2xl p-5 shadow-sm space-y-1 hover:bg-gray-50"
        >
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('bev.titel')}</p>
          <p className="text-sm text-gray-500 leading-relaxed">{t('bev.uitleg')}</p>
        </a>

        {/* [FACTUUR-B] Factuurnummering — ZZP'er only */}
        {profile.role === 'zzper' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {t('inst.nummering')}
            </p>

            {numberingNext && (
              <p className="text-sm text-gray-600">
                {t('inst.volgendeFactuur')}{' '}
                <span className="font-semibold text-gray-900">{numberingNext}</span>
              </p>
            )}

            {numberingLocked ? (
              <p className="text-sm text-gray-500">
                {t('inst.nummeringVast')}
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  {t('inst.nummeringUitleg')} <span className="font-mono">045-2026</span>.
                </p>
                <input
                  type="text"
                  value={numberingInput}
                  onChange={e => { setNumberingInput(e.target.value); setNumberingError(''); setNumberingSuccess('') }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('inst.nummeringPlaceholder')}
                />

                {/* live preview */}
                {(() => {
                  const raw = numberingInput.trim()
                  if (!raw) return null
                  const p = previewInvoiceStart(raw, new Date().getFullYear())
                  if (p.ok) return (
                    <p className="text-sm text-green-600">
                      {t('inst.eersteFactuur')} <span className="font-semibold">{p.first}</span> {t('inst.volgende')} {p.next}
                    </p>
                  )
                  if (p.reason !== 'empty') return <p className="text-sm text-amber-600">{reasonToDutch(p.reason)}</p>
                  return null
                })()}

                {numberingSuccess && <p className="text-sm text-green-600">{numberingSuccess}</p>}
                {numberingError && <p className="text-sm text-red-500">{numberingError}</p>}

                <button
                  onClick={saveNumbering}
                  disabled={
                    numberingLoading ||
                    (numberingInput.trim() !== '' &&
                      !previewInvoiceStart(numberingInput.trim(), new Date().getFullYear()).ok)
                  }
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {numberingLoading ? t('inst.opslaanBezig') : t('inst.nummeringOpslaanKnop')}
                </button>
              </>
            )}
          </div>
        )}

        {/* دعوة المحاسب — للـ ZZP'er فقط */}
        {profile.role === 'zzper' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {t('inst.boekhouderKoppelen')}
            </p>
            <p className="text-sm text-gray-500">
              {t('inst.boekhouderUitleg')}
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={accountantEmail}
                onChange={e => setAccountantEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendInvite()}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="boekhouder@kantoor.nl"
              />
              <button
                onClick={sendInvite}
                disabled={loadingInvite}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {loadingInvite ? '...' : t('inst.uitnodigen')}
              </button>
            </div>
            {successInvite && <p className="text-sm text-green-600">{successInvite}</p>}
            {errorInvite && <p className="text-sm text-red-500">{errorInvite}</p>}
          </div>
        )}
        {/* محاسب ZZP'er الحالي */}
        {profile.role === 'zzper' && accountant && (
          /* [VRAAG-MACHTIGING] Het anker waar de melding van een boekhouder naartoe wijst. Zonder
             dit landt hij bovenaan een scherm van duizend regels en moet hij zoeken naar iets
             waarvan hij net voor het eerst hoorde — dat is het verschil tussen "hij las het" en
             "hij deed het". */
          <div id="boekhouder" className="bg-white rounded-2xl p-5 shadow-sm space-y-3 scroll-mt-20">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {t('inst.boekhouder')}
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {accountant.company_name || accountant.full_name}
                </p>
                <p className="text-xs text-gray-400">{accountant.email}</p>
              </div>
              <button
                onClick={unlinkAccountant}
                className="text-xs text-red-400 hover:text-red-600 font-medium"
              >
                {t('inst.ontkoppelen')}
              </button>
            </div>

            {/* [MANDAAT] Twee machtigingen, twee rijen — nooit één schakelaar.
                Art. 35 lid 1 Wet OB laat toe dat een derde de factuur uitreikt; art. 35a laat de
                verantwoordelijkheid bij de ondernemer. Voor het BEVESTIGEN bestaat zo'n bepaling
                niet, en art. 52 AWR laat de administratieplicht net zo goed bij hem. Beide zinnen
                staan hier in gewoon Nederlands, want dit is het scherm waar hij ze weggeeft. */}
            {([
              {
                soort: 'facturen' as const,
                aan: mayInvoice,
                titel: t('inst.rijFacturenTitel'),
                aanTekst: t('inst.rijFacturenAan'),
                uitTekst: t('inst.rijFacturenUit'),
              },
              {
                soort: 'bevestigen' as const,
                aan: mayConfirm,
                titel: t('inst.rijBevestigenTitel'),
                aanTekst: t('inst.rijBevestigenAan'),
                uitTekst: t('inst.rijBevestigenUit'),
              },
            ]).map((rij) => (
              <div key={rij.soort} className="pt-3 border-t border-gray-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{rij.titel}</p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {rij.aan ? rij.aanTekst : rij.uitTekst}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleMandate(rij.soort)}
                    disabled={mandaatBezig !== null}
                    aria-pressed={rij.aan}
                    className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border ${
                      rij.aan
                        ? 'text-red-500 border-red-200 hover:bg-red-50'
                        : 'text-blue-600 border-blue-200 hover:bg-blue-50'
                    } disabled:opacity-50`}
                  >
                    {mandaatBezig === rij.soort ? '…' : rij.aan ? t('team.intrekken') : t('inst.machtigen')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* [NAV] Facturering was reachable ONLY from a billing e-mail and the
            Stripe return URL — nothing in the app linked to it, so a user who
            wanted to see their plan had no way to get there. Boekhouders have no
            plan or limits measured, so the row is for owners only (the page
            itself makes the same distinction). */}
        {profile.role === 'zzper' && (
          <Link
            href="/dashboard/settings/facturering"
            className="pressable-row bg-white rounded-2xl p-5 shadow-sm flex items-center justify-between no-underline"
          >
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {t('inst.facturering')}
              </p>
              <p className="text-sm font-medium text-gray-900">{t('inst.plan')}</p>
            </div>
            <span className="material-symbols-outlined text-gray-400 icon-dir" aria-hidden>chevron_right</span>
          </Link>
        )}

        {/* [ACTING-FOR] Wie mag er onder MIJN BTW-nummer factureren? Alleen voor een eigenaar: een
            medewerker kan geen medewerkers uitnodigen (dat zou een keten worden waarin niemand
            meer kan zeggen wie er precies factureert), en de route erachter weigert het ook. */}
        {profile.role === 'zzper' && (
          <Link
            href="/dashboard/settings/team"
            className="pressable-row bg-white rounded-2xl p-5 shadow-sm flex items-center justify-between no-underline"
          >
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {t('inst.team')}
              </p>
              <p className="text-sm font-medium text-gray-900">{t('start.team.sub')}</p>
            </div>
            <span className="material-symbols-outlined text-gray-400 icon-dir" aria-hidden>chevron_right</span>
          </Link>
        )}

        {/* [BOEK-032] Gevarenzone — gegevens exporteren + account verwijderen */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3 border border-red-100">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">
            {t('inst.gevarenzone')}
          </p>
          <p className="text-sm text-gray-500">
            {t('inst.gevarenzoneUitleg')}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={exportData}
              disabled={exportLoading}
              className="flex-1 bg-[#1A73E8] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {exportLoading
                ? t('inst.exporterenBezig')
                : exportConfirmed
                ? t('inst.opnieuwExporteren')
                : t('inst.exporteerGegevens')}
            </button>
            <button
              onClick={() => { setDelError(''); setDeleteModalOpen(true) }}
              disabled={!exportConfirmed}
              className="flex-1 border border-red-300 text-red-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('inst.accountVerwijderen')}
            </button>
          </div>
          {!exportConfirmed && (
            <p className="text-xs text-gray-400">
              {t('inst.eerstExporteren')}
            </p>
          )}
        </div>

      </div>

      {/* [BOEK-032] Bevestig verwijderen — e-mail + wachtwoord */}
      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { if (!delLoading) setDeleteModalOpen(false) }}
        >
          <div
            className="bg-white w-full max-w-sm p-6 space-y-4"
            style={{ borderRadius: 28 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">{t('inst.accountVerwijderen')}</h2>
            <p className="text-sm text-gray-500">
              {t('inst.verwijderUitleg')}
            </p>
            <div className="space-y-2">
              <input
                type="email"
                value={delEmail}
                onChange={e => setDelEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder={t('nieuw.klant.email')}
              />
              <input
                type="password"
                value={delPassword}
                onChange={e => setDelPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder={t('inst.wachtwoord')}
              />
            </div>
            {delError && <p className="text-sm text-red-500">{delError}</p>}
            {/* [GEEN-WACHTWOORD] De uitweg, op het scherm waar hij vastliep. Zonder deze knop is de
                enige oplossing er één die nergens staat opgeschreven: uitloggen, naar
                /wachtwoord-vergeten, een wachtwoord instellen, terugkomen. */}
            {geenWachtwoord && (
              linkGestuurd ? (
                <p className="text-sm text-gray-600">{t('inst.wachtwoordLinkGestuurd')}</p>
              ) : (
                <button
                  onClick={stuurWachtwoordLink}
                  className="w-full border border-blue-600 text-blue-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-50"
                >
                  {t('inst.stuurWachtwoordLink')}
                </button>
              )
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteModalOpen(false)}
                disabled={delLoading}
                className="flex-1 border border-gray-300 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                {t('lijst.annuleren')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={delLoading}
                className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {delLoading ? t('inst.verwijderenBezig') : t('inst.definitiefVerwijderen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}