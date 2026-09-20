'use client'

// src/app/dashboard/messages/[id]/page.tsx
// BOEK-007: صفحة المحادثة — مع skeleton + optimistic UI + realtime

import { useState, useEffect, useRef } from 'react'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import { PAGE_HEADER_HEIGHT, COLUMN } from '@/lib/design/tokens'
// [TAAL] The screen holds no language of its own: every sentence comes from the catalogue, and
// the clock is formatted in the owner's language too (with Latin digits in Arabic, see locale.ts).
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { LOCALE_META } from '@/lib/i18n/locale'
// [AG-03] A session that expires mid-thread comes back to THIS thread after logging in.
import { withRedirect } from '@/lib/safe-redirect'
import type { MessageRow } from '@/types/rows'

// Skeleton للرسائل أثناء التحميل
function MessageSkeleton({ isMe }: { isMe: boolean }) {
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-pulse`}>
      <div className={`h-9 rounded-2xl bg-gray-100 ${isMe ? 'w-48' : 'w-64'}`} />
    </div>
  )
}

export default function ConversationPage() {
  const router = useRouter()
  const params = useParams()
  const otherId = params.id as string
  const supabase = createClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const t = translator(locale)

  const [currentUserId, setCurrentUserId] = useState<string>('')
  // [NAAM-TEGENPARTIJ] De naam komt van de server, samen met de berichten. Hij werd hier uit
  // `profiles` gelezen met de browserclient, en dat levert een zzp'er niets: RLS op profiles kent
  // alleen "je eigen rij" en "een boekhouder mag zijn gekoppelde klant zien" — niet andersom. De
  // ondernemer keek dus naar een gesprek met "..." in de titel en "Bericht aan ..." in het invoerveld.
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // [NO-SILENT-EMPTY] Een mislukte lezing mag niet als "nog geen berichten" op het scherm komen.
  const [loadError, setLoadError] = useState('')
  // [GESPREK-GRENS] Whether the two are linked, as the server reports it: true, false, or null
  // when it could not check. false with no messages is a stranger's id in the URL — not a
  // conversation, and never a composer that pretends it is (audit TH-01). false WITH messages is a
  // former accountant: readable, not writable. The server refuses the send either way; this only
  // stops the screen from claiming otherwise.
  const [linked, setLinked] = useState<boolean | null>(null)

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/messages?with=${otherId}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setLoadError(failureText(res.status, data, t('gesprek.ophaalFout')))
        return
      }
      setLoadError('')
      if (data?.messages) setMessages(data.messages)
      if (data?.partner) setPartnerName(data.partner.name ?? null)
      setLinked(typeof data?.linked === 'boolean' ? data.linked : null)
    } catch {
      setLoadError(t('gesprek.ophaalFout'))
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      // [AG-03] Not a bare /login: the owner was on THIS thread, and comes back to it.
      if (!user) { router.push(withRedirect('/login', `/dashboard/messages/${otherId}`)); return }
      setCurrentUserId(user.id)

      await fetchMessages()
      setLoading(false)
    }
    load()
  }, [otherId])

  // Scroll للأسفل عند كل رسالة جديدة
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime — رسائل جديدة تصل تلقائياً
  useEffect(() => {
    if (!currentUserId) return

    const channel = supabase
      .channel(`messages-${currentUserId}-${otherId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      }, (payload) => {
        const msg = payload.new as MessageRow
        const isRelevant =
          (msg.sender_id === currentUserId && msg.receiver_id === otherId) ||
          (msg.sender_id === otherId && msg.receiver_id === currentUserId)
        if (isRelevant) fetchMessages()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentUserId, otherId])

  async function handleSend() {
    if (!input.trim() || sending) return

    setSending(true)
    setError('')
    const content = input.trim()
    setInput('')

    // Optimistic UI — الرسالة تظهر فوراً
    const optimistic = {
      id: `temp-${Date.now()}`,
      sender_id: currentUserId,
      receiver_id: otherId,
      content,
      read: false,
      created_at: new Date().toISOString()
    }
    setMessages(prev => [...prev, optimistic])

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiver_id: otherId, content })
    })

    if (!res.ok) {
      // Roll the optimistic message back
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
      setInput(content)
      // [SERVER-ZEGT-WAAROM] De route weigert met een reden — "je kunt alleen berichten sturen naar
      // een gekoppelde klant of boekhouder" (403), of "de koppeling kon niet worden gecontroleerd"
      // (503). Hier stond onvoorwaardelijk "probeer opnieuw", wat bij een 403 een instructie is om
      // eeuwig iets te herhalen dat nooit kan lukken: een scherm dat de weigering van de server
      // overschrijft met een raadgeving die hij niet gaf.
      const data = await res.json().catch(() => null)
      setError(failureText(res.status, data, t('gesprek.verzendFout')))
    } else {
      await fetchMessages()
    }

    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const otherName = partnerName || '...'
  // [GESPREK-GRENS] The composer exists only for a pair the server says is linked. Unknown (null,
  // the link read failed) keeps it: the server decides on send, and answers with its reason.
  const kanSturen = linked !== false
  const vreemde = linked === false && messages.length === 0

  // [SUBNAV] Conversation partner's name as the shared sub-page header title
  // (back is provided there too). The chat fills exactly the space below the
  // shared bar (height below), so the composer stays pinned on-screen.
  useSubPageHeader({ title: otherName }, [otherName])

  return (
    <div
      className="bg-[#f8f9fa] flex flex-col"
      // [HEADER-SYSTEM] Full height minus the shared sub-page bar; the 56 magic
      // number is now the PAGE_HEADER_HEIGHT token.
      style={{ height: `calc(100dvh - ${PAGE_HEADER_HEIGHT}px - env(safe-area-inset-top))` }}
    >

      {/* Berichten */}
      <div className="flex-1 w-full mx-auto px-6 py-4 space-y-3 overflow-y-auto" style={{ maxWidth: COLUMN.work }}>

        {loading ? (
          <>
            <MessageSkeleton isMe={false} />
            <MessageSkeleton isMe={true} />
            <MessageSkeleton isMe={false} />
            <MessageSkeleton isMe={true} />
          </>
        ) : loadError ? (
          /* De fout IN PLAATS VAN het gesprek: een leeg gesprek beweert dat er niets gezegd is. */
          <div className="text-center py-16">
            <p className="text-2xl mb-2">⚠️</p>
            <p className="text-gray-700 text-sm font-medium px-6">{loadError}</p>
            <button
              onClick={() => { setLoading(true); fetchMessages().finally(() => setLoading(false)) }}
              className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              {t('ber.opnieuw')}
            </button>
          </div>
        ) : vreemde ? (
          /* [GESPREK-GRENS] Not an empty conversation with a stranger: there is none to have. */
          <div className="text-center py-16">
            <p className="text-2xl mb-2">🚫</p>
            <p className="text-gray-700 text-sm font-medium px-6">{t('gesprek.nietGekoppeld')}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-2xl mb-2">👋</p>
            <p className="text-gray-400 text-sm">
              {t('gesprek.stuurAan', { name: otherName })}
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.sender_id === currentUserId
            const isOptimistic = msg.id.startsWith('temp-')
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm transition-opacity ${
                    isOptimistic ? 'opacity-60' : 'opacity-100'
                  } ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-white text-gray-900 shadow-sm rounded-bl-md'
                  }`}
                >
                  <p className="leading-relaxed">{msg.content}</p>
                  <p className={`text-xs mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                    {msg.created_at
                      ? new Date(msg.created_at).toLocaleTimeString(LOCALE_META[locale].intl, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </p>
                </div>
              </div>
            )
          })
        )}

        <div ref={bottomRef} />
      </div>

      {/* Foutmelding */}
      {error && (
        <div className="mx-auto w-full px-6" style={{ maxWidth: COLUMN.work }}>
          <p className="text-xs text-red-500 text-center py-1">{error}</p>
        </div>
      )}

      {/* Input — [GESPREK-GRENS] only for a linked pair; a read-only line otherwise. */}
      <div className="bg-white border-t border-gray-200 px-6 py-4 sticky bottom-0">
        {kanSturen ? (
          <div className="mx-auto flex items-end gap-3" style={{ maxWidth: COLUMN.work }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('gesprek.plaatshouder', { name: otherName })}
              rows={1}
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-400 transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              {sending ? '...' : t('gesprek.stuur')}
            </button>
          </div>
        ) : (
          <p className="mx-auto text-xs text-gray-500 text-center" style={{ maxWidth: COLUMN.work }}>
            {vreemde ? t('gesprek.nietGekoppeld') : t('gesprek.koppelingWeg')}
          </p>
        )}
      </div>

    </div>
  )
}
