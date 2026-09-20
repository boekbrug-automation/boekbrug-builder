'use client'

// src/app/dashboard/messages/page.tsx
// BOEK-007: قائمة المحادثات — مع skeleton loading

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { rowMatchesQuery } from '@/lib/search'
import { COLUMN } from '@/lib/design/tokens';
// [TAAL] The screen speaks the owner's language.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
// [TAAL] The date beside a conversation follows the owner's language, like the clock in the thread.
import { LOCALE_META } from '@/lib/i18n/locale'
// [AG-03] A session that expires here comes back here after logging in.
import { withRedirect } from '@/lib/safe-redirect'

// Eén gesprek in de lijst: samengesteld uit berichten + de naam van de tegenpartij.
interface Conversation {
  otherId: string
  lastMessage: string
  lastAt: string | null
  unread: number
  name?: string | null
}

// Skeleton لصف محادثة واحدة
function ConversationSkeleton() {
  return (
    <div className="flex items-center justify-between px-5 py-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex-shrink-0" />
        <div className="space-y-2">
          <div className="h-3 w-28 bg-gray-100 rounded-full" />
          <div className="h-2.5 w-44 bg-gray-100 rounded-full" />
        </div>
      </div>
      <div className="h-2.5 w-12 bg-gray-100 rounded-full" />
    </div>
  )
}

export default function MessagesPage() {
  const locale = useLocale()
  const t = translator(locale)
  const router = useRouter()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  // [NO-SILENT-EMPTY] Een mislukte lezing is geen lege inbox. Zonder deze stand toonde dit scherm
  // "Nog geen berichten" zodra er iets misging — een uitspraak over de post van de ondernemer die
  // op dat moment niemand kon doen.
  const [loadError, setLoadError] = useState<string | null>(null)
  // [GEEN-STILLE-KAP] De server scant een begrensd aantal berichten; als hij de bodem niet haalde,
  // hoort dat hier te staan in plaats van stilzwijgend een half lijstje.
  const [truncated, setTruncated] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      // [NAAM-TEGENPARTIJ] Namen komen van de server: RLS op profiles laat een zzp'er zijn
      // boekhouder niet zien, dus de browser kon deze lijst nooit compleet maken.
      try {
        const res = await fetch('/api/messages/conversations')
        if (res.status === 401) { router.push(withRedirect('/login', '/dashboard/messages')); return }
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setLoadError(failureText(res.status, data, t('ber.ophaalFout')))
          return
        }
        setConversations(data?.conversations ?? [])
        setTruncated(data?.truncated === true)
      } catch {
        setLoadError(t('ber.ophaalFoutEerlijk'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // [SMART-FILTER] In-page live filter over the fully-loaded conversation list
  // (naam / laatste bericht), accent-folded via de gedeelde matcher.
  // [PERF] useMemo: alleen herberekenen als de zoekterm of de gesprekken wijzigen,
  // niet bij elke render.
  const rawQ = search.trim()
  const filtered = useMemo(
    () =>
      rawQ
        ? conversations.filter(c => rowMatchesQuery(rawQ, [c.name, c.lastMessage]))
        : conversations,
    [rawQ, conversations]
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      <div className="mx-auto px-6 py-6" style={{ maxWidth: COLUMN.work }}>
        {/* Search — only when there's something to filter */}
        {!loading && conversations.length > 0 && (
          <div className="relative mb-4">
            <svg className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('ber.zoek')}
              aria-label={t('ber.zoekAria')}
              className="w-full bg-white border border-gray-200 rounded-xl py-2.5 ps-10 pe-9 text-sm text-gray-900 outline-none focus:border-gray-300 shadow-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label={t('ber.wissen')} className="tap-44 absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center">×</button>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

          {loading ? (
            <div className="divide-y divide-gray-50">
              <ConversationSkeleton />
              <ConversationSkeleton />
              <ConversationSkeleton />
            </div>
          ) : loadError ? (
            /* De fout IN PLAATS VAN de lijst — een lege lijst hier zegt "je hebt geen berichten",
               en dat is precies wat we op dit moment niet weten. */
            <div className="text-center py-16 px-6">
              <p className="text-2xl mb-2">⚠️</p>
              <p className="text-gray-700 text-sm font-medium">{loadError}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t('ber.opnieuw')}
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-gray-500 text-sm font-medium">{t('ber.leeg')}</p>
              <p className="text-gray-300 text-xs mt-1">
                {t('ber.leegHint')}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-500 text-sm font-medium">{t('ber.nietsGevonden', { query: rawQ })}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(conv => (
                <div
                  key={conv.otherId}
                  onClick={() => router.push(`/dashboard/messages/${conv.otherId}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/dashboard/messages/${conv.otherId}`) } }}
                  className="pressable-row flex items-center justify-between px-5 py-4 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                      {conv.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className={`text-sm ${conv.unread > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-900'}`}>
                        {conv.name || t('ber.onbekend')}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
                        {conv.lastMessage}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p className="text-xs text-gray-300">
                      {conv.lastAt ? new Date(conv.lastAt).toLocaleDateString(LOCALE_META[locale].intl) : ''}
                    </p>
                    {conv.unread > 0 && (
                      <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* [GEEN-STILLE-KAP] Zeg het als de lijst niet alles kon nalopen. */}
        {!loading && !loadError && truncated && (
          <p className="text-xs text-gray-400 text-center mt-3">
            {t('ber.afgekapt')}
          </p>
        )}
      </div>
    </div>
  )
}
