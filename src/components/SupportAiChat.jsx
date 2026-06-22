import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { askSupportAi, technicalContext } from '../lib/supportAi'
import { AttachmentPicker } from './SupportAttachments'
import { uploadSupportAttachments } from '../lib/supportAttachments'

const EMOJIS = ['👍', '🙏', '🙂', '😊', '✅', '❌', '⚠️', '❓', '🧾', '💳', '📊', '📎']
const GREETING = 'Hej! Jag är BokPilots AI-support. Jag hjälper dig med appen – bokföring, fakturor, kvitton, OCR/AI-tolkning, moms, lön, rapporter, inställningar och felsökning. Vad behöver du hjälp med?'

export default function SupportAiChat({ onEscalated }) {
  const { company, user, isAdmin, platformAccess } = useAuth()
  const role = isAdmin ? 'admin' : (platformAccess?.canViewSupport ? 'support' : 'user')
  const access = { isAdmin: !!isAdmin, canViewOps: !!platformAccess?.canViewOperations }
  const [messages, setMessages] = useState([{ role: 'ai', text: GREETING }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [files, setFiles] = useState([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setInput(''); setEmojiOpen(false)
    const history = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.text }))
    setMessages(m => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const res = await askSupportAi({ question: q, history, company, user, role, route: location.pathname, access })
      setMessages(m => [...m, { role: 'ai', text: res.svar, escalate: res.foreslar_eskalering }])
    } catch (e) {
      setMessages(m => [...m, { role: 'ai', text: e.message || 'AI-supporten kunde inte svara just nu. Välj "Prata med support".' }])
    }
    setBusy(false)
  }

  async function escalate() {
    if (!company) return
    setEscalating(true)
    const ctx = technicalContext(location.pathname)
    const firstUser = messages.find(m => m.role === 'user')?.text
    const subject = (firstUser || 'Supportärende från AI-support').slice(0, 80)
    const transcript = messages.filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'Kund' : 'AI-support'}: ${m.text}`).join('\n')
    const body = `Eskalerat från AI-support.\n\nVy: ${ctx.route}\nWebbläsare: ${ctx.browser}\nTid: ${ctx.timestamp}\n\n--- Konversation med AI-support ---\n${transcript || '(ingen tidigare konversation)'}`
    const { data, error } = await supabase.rpc('create_support_ticket', {
      p_company_id: company.id, p_subject: subject, p_category: 'other', p_priority: 'normal', p_body: body,
    })
    if (error) { setEscalating(false); return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skapa ärende') }
    try {
      if (files.length && data?.ticket_id) await uploadSupportAttachments(supabase, { files, companyId: company.id, ticketId: data.ticket_id, messageId: data.message_id })
    } catch (e) { toast.error(e.message) }
    setEscalating(false); setFiles([])
    setMessages(m => [...m, { role: 'system', text: 'Ärendet har eskalerats till mänsklig support. Du hittar det under "Mina ärenden" och får svar där.' }])
    toast.success('Ärende skapat – support är notifierad')
    onEscalated?.(data?.ticket_id)
  }

  return (
    <div className="bg-white rounded-xl flex flex-col" style={{ border: '0.5px solid rgba(0,0,0,0.10)', height: 'calc(100vh - 8.5rem)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#6d28d9,#7c3aed)' }}><i className="ti ti-sparkles text-sm" /></span>
          <div>
            <div className="text-sm font-semibold">AI-support</div>
            <div className="text-[11px] text-gray-400">Svarar inom BokPilots supportområde</div>
          </div>
        </div>
        <button className="btn text-sm" onClick={escalate} disabled={escalating}>
          <i className="ti ti-headset" /> {escalating ? 'Skapar…' : 'Prata med support'}
        </button>
      </div>

      {/* Meddelanden */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-surface-3">
        {messages.map((m, i) => m.role === 'system' ? (
          <div key={i} className="text-center"><span className="inline-block text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">{m.text}</span></div>
        ) : (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`} style={m.role === 'user' ? undefined : { border: '0.5px solid rgba(0,0,0,0.10)' }}>
              {m.role === 'ai' && <div className="text-[10px] font-medium text-purple-600 mb-0.5">AI-support</div>}
              {m.text}
              {m.escalate && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                  <button className="text-[12px] text-blue-700 hover:underline" onClick={escalate} disabled={escalating}><i className="ti ti-headset mr-1" />Prata med en supportagent</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="bg-white text-gray-400 text-sm rounded-2xl rounded-bl-sm px-3 py-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>AI-support skriver…</div></div>}
        <div ref={endRef} />
      </div>

      {/* Bifogade filer (skickas med vid eskalering) */}
      {files.length > 0 && (
        <div className="px-4 pt-2 shrink-0"><div className="text-[11px] text-gray-400 mb-1">Bifogas när du pratar med support:</div><AttachmentPicker files={files} onChange={setFiles} disabled={escalating} /></div>
      )}

      {/* Inmatning */}
      <div className="px-3 py-2.5 border-t bg-white shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="flex items-end gap-2 relative">
          <div className="relative">
            <button className="text-gray-400 hover:text-gray-700 p-1.5" title="Emoji" onClick={() => setEmojiOpen(o => !o)}><i className="ti ti-mood-smile text-lg" /></button>
            {emojiOpen && (
              <div className="absolute bottom-10 left-0 z-20 bg-white rounded-lg shadow-xl p-2 grid grid-cols-6 gap-1" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                {EMOJIS.map(e => <button key={e} className="text-lg hover:bg-gray-100 rounded p-0.5" onClick={() => { setInput(v => v + e); setEmojiOpen(false) }}>{e}</button>)}
              </div>
            )}
          </div>
          {files.length === 0 && <div className="shrink-0"><AttachmentPicker files={files} onChange={setFiles} disabled={escalating} compact /></div>}
          <textarea className="input flex-1 resize-none" rows={1} placeholder="Skriv din fråga…" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button className="btn btn-primary px-3" onClick={send} disabled={busy || !input.trim()} title="Skicka"><i className="ti ti-send" /></button>
        </div>
        <div className="text-[10px] text-gray-400 mt-1.5 px-1">AI-support svarar utifrån handboken. Granska alltid bokföring själv – för komplexa frågor, välj "Prata med support".</div>
      </div>
    </div>
  )
}
