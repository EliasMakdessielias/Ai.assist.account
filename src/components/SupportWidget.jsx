import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useSupportWidget } from '../hooks/useSupportWidget'
import { supabase } from '../lib/supabase'
import { askSupportAi } from '../lib/supportAi'
import { workContext, contextSummary, contextBlock } from '../lib/supportContext'
import { AttachmentPicker } from './SupportAttachments'
import { uploadSupportAttachments, openSupportAttachment } from '../lib/supportAttachments'
import { customerStatusLabel } from '../lib/support'

const EMOJIS = ['👍', '🙏', '🙂', '😊', '✅', '❌', '⚠️', '❓', '🧾', '💳', '📊', '📎']
const GREETING = 'Hej! Jag är BokPilots AI-support. Jag hjälper dig direkt här – ställ din fråga om bokföring, fakturor, kvitton, OCR/AI-tolkning, moms, lön, rapporter eller inställningar. Vill du prata med en människa väljer du "Prata med support".'

const fmtTime = (ts) => { try { return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// ── Inmatningsrad: text, emoji, filbilaga och röstinspelning (om mikrofon tillåts) ──
function Composer({ files, setFiles, onSend, busy, placeholder }) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && !!window.MediaRecorder

  function submit() {
    const t = text.trim()
    if ((!t && files.length === 0) || busy) return
    setText(''); setEmojiOpen(false)
    onSend(t)
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], `rostmeddelande-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, { type: 'audio/webm' })
        setFiles(f => [...f, file].slice(0, 5))
        stream.getTracks().forEach(t => t.stop())
      }
      recRef.current = mr; mr.start(); setRecording(true)
    } catch { toast.error('Mikrofonen är inte tillgänglig') }
  }
  function stopRec() { try { recRef.current?.stop() } catch { /* ignore */ } setRecording(false) }

  return (
    <div className="px-3 py-2.5 border-t bg-white shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
      {files.length > 0 && <div className="mb-2"><AttachmentPicker files={files} onChange={setFiles} disabled={busy} /></div>}
      <div className="flex items-end gap-1.5 relative">
        <div className="relative">
          <button className="text-gray-400 hover:text-gray-700 p-1.5" title="Emoji" onClick={() => setEmojiOpen(o => !o)}><i className="ti ti-mood-smile text-lg" /></button>
          {emojiOpen && (
            <div className="absolute bottom-10 left-0 z-20 bg-white rounded-lg shadow-xl p-2 grid grid-cols-6 gap-1" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
              {EMOJIS.map(e => <button key={e} className="text-lg hover:bg-gray-100 rounded p-0.5" onClick={() => { setText(v => v + e); setEmojiOpen(false) }}>{e}</button>)}
            </div>
          )}
        </div>
        <div className="shrink-0"><AttachmentPicker files={files} onChange={setFiles} disabled={busy} compact /></div>
        {canRecord && (
          <button className={`p-1.5 ${recording ? 'text-red-600 animate-pulse' : 'text-gray-400 hover:text-gray-700'}`} title={recording ? 'Stoppa inspelning' : 'Spela in röstmeddelande'} onClick={recording ? stopRec : startRec}>
            <i className={`ti ${recording ? 'ti-player-stop-filled' : 'ti-microphone'} text-lg`} />
          </button>
        )}
        <textarea className="input flex-1 resize-none" rows={1} placeholder={recording ? 'Spelar in…' : (placeholder || 'Skriv ditt meddelande…')} value={text}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} disabled={busy} />
        <button className="btn btn-primary px-3" onClick={submit} disabled={busy || (!text.trim() && files.length === 0)} title="Skicka"><i className="ti ti-send" /></button>
      </div>
    </div>
  )
}

// ── Bilagor i ett ärendemeddelande (klickbara, signerad URL) ──
function MsgAttachments({ items }) {
  if (!items?.length) return null
  async function open(att) { try { window.open(await openSupportAttachment(supabase, att), '_blank', 'noopener') } catch (e) { toast.error(e.message) } }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map(a => {
        const isAudio = (a.mime_type || '').startsWith('audio/')
        return (
          <button key={a.id} onClick={() => open(a)} className="inline-flex items-center gap-1 text-[11px] bg-black/5 hover:bg-black/10 rounded px-2 py-1">
            <i className={`ti ${isAudio ? 'ti-microphone' : 'ti-paperclip'}`} />{isAudio ? 'Röstmeddelande' : a.file_name}
          </button>
        )
      })}
    </div>
  )
}

// ── Slide-over-panelen (alltid monterad, döljs via transform när stängd) ──
function SupportPanel() {
  const { company, user, isAdmin, platformAccess } = useAuth()
  const { open, closeSupport, refreshUnread, connError } = useSupportWidget()
  const location = useLocation()
  const role = isAdmin ? 'admin' : (platformAccess?.canViewSupport ? 'support' : 'user')
  const access = { isAdmin: !!isAdmin, canViewOps: !!platformAccess?.canViewOperations }

  const [mode, setMode] = useState('ai') // 'ai' | 'ticket'
  const [activeTicket, setActiveTicket] = useState(null)
  const [aiMessages, setAiMessages] = useState([{ role: 'ai', text: GREETING }])
  const [ticketMessages, setTicketMessages] = useState([])
  const [attByMsg, setAttByMsg] = useState({})
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  const ctx = () => workContext({ pathname: location.pathname, user, company, role })

  const markRead = useCallback(async (id) => {
    if (!id) return
    await supabase.rpc('mark_support_read', { p_ticket_id: id })
    refreshUnread()
  }, [refreshUnread])

  const loadTicket = useCallback(async (id) => {
    const [{ data: msgs }, { data: atts }] = await Promise.all([
      supabase.from('support_messages').select('id, is_admin, body, created_at, sender_user_id').eq('ticket_id', id).order('created_at'),
      supabase.from('support_attachments').select('id, message_id, file_name, mime_type, file_size, storage_path, created_at').eq('ticket_id', id),
    ])
    setTicketMessages(msgs || [])
    const grouped = {}
    for (const a of atts || []) { (grouped[a.message_id] = grouped[a.message_id] || []).push(a) }
    setAttByMsg(grouped)
  }, [])

  // Hämta aktuellt (öppet) ärende när företag är klart → återuppta konversationen.
  useEffect(() => {
    if (!company?.id) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase.from('support_tickets').select('id, status, subject')
        .eq('company_id', company.id).neq('status', 'closed').order('last_message_at', { ascending: false }).limit(1)
      if (cancel || !data?.[0]) return
      setActiveTicket(data[0]); setMode('ticket'); loadTicket(data[0].id)
    })()
    return () => { cancel = true }
  }, [company?.id, loadTicket])

  // Realtime för aktivt ärende: nya meddelanden visas direkt; supportsvar markeras lästa om panelen är öppen.
  useEffect(() => {
    if (!activeTicket?.id) return
    const ch = supabase.channel(`support-ticket-${activeTicket.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `ticket_id=eq.${activeTicket.id}` }, (payload) => {
        const m = payload.new
        setTicketMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [activeTicket?.id])

  // Markera läst ENBART när panelen är öppen på ett aktivt ärende. Körs även när ett nytt
  // supportsvar kommer in medan panelen är öppen (lastAdminMsgId ändras). Stängd panel = aldrig läst.
  const lastAdminMsgId = ticketMessages.filter(m => m.is_admin).slice(-1)[0]?.id
  useEffect(() => {
    if (open && mode === 'ticket' && activeTicket?.id) markRead(activeTicket.id)
  }, [open, mode, activeTicket?.id, lastAdminMsgId, markRead])

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages, ticketMessages, busy, open, mode])

  async function sendAi(text) {
    setBusy(true)
    const history = aiMessages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.text }))
    setAiMessages(m => [...m, { role: 'user', text }])
    try {
      const c = ctx()
      const res = await askSupportAi({ question: text, history, company, user, role, route: `${c.sida} (${c.route})`, access })
      setAiMessages(m => [...m, { role: 'ai', text: res.svar, escalate: res.foreslar_eskalering }])
    } catch (e) {
      setAiMessages(m => [...m, { role: 'ai', text: e.message || 'AI-supporten kunde inte svara just nu. Välj "Prata med support".' }])
    }
    setBusy(false)
  }

  async function sendTicketReply(text) {
    if (!activeTicket) return
    setBusy(true)
    const body = text || '(bifogad fil)'
    const { data: msgId, error } = await supabase.rpc('customer_reply_support_ticket', { p_ticket_id: activeTicket.id, p_body: body })
    if (error) { setBusy(false); return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skicka') }
    const sent = files
    setFiles([])
    setTicketMessages(prev => prev.some(x => x.id === msgId) ? prev : [...prev, { id: msgId, is_admin: false, body, created_at: new Date().toISOString(), sender_user_id: user.id }])
    if (sent.length) {
      try { await uploadSupportAttachments(supabase, { files: sent, companyId: company.id, ticketId: activeTicket.id, messageId: msgId }); await loadTicket(activeTicket.id) }
      catch (e) { toast.error(e.message) }
    }
    setBusy(false)
  }

  async function escalate() {
    if (!company || busy) return
    setBusy(true)
    const c = ctx()
    const firstUser = aiMessages.find(m => m.role === 'user')?.text
    const subject = (firstUser || `Support – ${c.sida}`).slice(0, 80)
    const transcript = aiMessages.filter(m => m.role !== 'system').map(m => `${m.role === 'user' ? 'Kund' : 'AI-support'}: ${m.text}`).join('\n')
    const body = `Eskalerat från AI-support.\n\n${contextBlock(c)}\n\n--- Konversation med AI-support ---\n${transcript || '(ingen tidigare konversation)'}`
    const { data, error } = await supabase.rpc('create_support_ticket', { p_company_id: company.id, p_subject: subject, p_category: 'other', p_priority: 'normal', p_body: body })
    if (error) { setBusy(false); return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skapa ärende') }
    if (files.length && data?.ticket_id) { try { await uploadSupportAttachments(supabase, { files, companyId: company.id, ticketId: data.ticket_id, messageId: data.message_id }) } catch (e) { toast.error(e.message) } }
    setFiles([])
    const t = { id: data.ticket_id, status: 'new', subject }
    setActiveTicket(t); setMode('ticket'); await loadTicket(data.ticket_id)
    toast.success('Ärende skapat – support är notifierad')
    setBusy(false)
  }

  const hasTicket = !!activeTicket
  const waiting = activeTicket && ['new', 'open', 'waiting_for_support'].includes(activeTicket.status)

  return (
    <div className="h-full flex flex-col bg-white shadow-2xl" style={{ borderLeft: '0.5px solid rgba(0,0,0,0.12)' }}>
      {/* Rubrik */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#6d28d9,#7c3aed)' }}><i className="ti ti-headset text-sm" /></span>
          <div>
            <div className="text-sm font-semibold leading-tight">Support</div>
            <div className="text-[11px] text-gray-400">{mode === 'ticket' ? 'Mänsklig support' : 'AI-support · svarar inom BokPilot'}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {mode === 'ai' && !hasTicket && <button className="btn text-xs" onClick={escalate} disabled={busy}><i className="ti ti-user" /> Prata med support</button>}
          <button className="text-gray-400 hover:text-gray-700 p-1.5" title="Minimera" onClick={closeSupport}><i className="ti ti-minus text-lg" /></button>
          <button className="text-gray-400 hover:text-gray-700 p-1.5" title="Stäng" onClick={closeSupport}><i className="ti ti-x text-lg" /></button>
        </div>
      </div>

      {/* Lägesväxlare när det finns ett aktivt ärende */}
      {hasTicket && (
        <div className="flex shrink-0 text-xs border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
          <button className={`flex-1 py-2 ${mode === 'ticket' ? 'text-blue-700 border-b-2 border-blue-600 font-medium' : 'text-gray-500'}`} onClick={() => setMode('ticket')}>Mitt ärende</button>
          <button className={`flex-1 py-2 ${mode === 'ai' ? 'text-blue-700 border-b-2 border-blue-600 font-medium' : 'text-gray-500'}`} onClick={() => setMode('ai')}>AI-assistent</button>
        </div>
      )}

      {connError && <div className="px-4 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 shrink-0"><i className="ti ti-wifi-off mr-1" />Anslutningen är instabil – meddelanden kan dröja.</div>}

      {/* Diskret sidkontext */}
      <div className="px-4 py-1.5 text-[11px] text-gray-400 bg-gray-50 border-b shrink-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
        <i className="ti ti-map-pin mr-1" />{contextSummary(ctx())}
      </div>

      {/* Statusbanner för ärende */}
      {mode === 'ticket' && waiting && (
        <div className="px-4 py-2 text-[12px] text-amber-800 bg-amber-50 border-b border-amber-200 shrink-0">
          <i className="ti ti-clock mr-1" />Ärendet väntar på mänsklig support ({customerStatusLabel(activeTicket.status)}). Du får svar här.
        </div>
      )}
      {mode === 'ticket' && activeTicket && activeTicket.status === 'resolved' && (
        <div className="px-4 py-2 text-[12px] text-green-800 bg-green-50 border-b border-green-200 shrink-0"><i className="ti ti-check mr-1" />Ärendet är markerat som löst.</div>
      )}

      {/* Meddelanden */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-surface-3">
        {mode === 'ai' ? (
          <>
            {aiMessages.map((m, i) => m.role === 'system' ? (
              <div key={i} className="text-center"><span className="inline-block text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">{m.text}</span></div>
            ) : (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`} style={m.role === 'user' ? undefined : { border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  {m.role === 'ai' && <div className="text-[10px] font-medium text-purple-600 mb-0.5">AI-support</div>}
                  {m.text}
                  {m.escalate && !hasTicket && (
                    <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                      <button className="text-[12px] text-blue-700 hover:underline" onClick={escalate} disabled={busy}><i className="ti ti-user mr-1" />Prata med en supportagent</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="flex justify-start"><div className="bg-white text-gray-400 text-sm rounded-2xl rounded-bl-sm px-3 py-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>AI-support skriver…</div></div>}
          </>
        ) : (
          <>
            {ticketMessages.map((m) => (
              <div key={m.id} className={`flex ${m.is_admin ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${m.is_admin ? 'bg-white text-gray-800 rounded-bl-sm' : 'bg-blue-600 text-white rounded-br-sm'}`} style={m.is_admin ? { border: '0.5px solid rgba(0,0,0,0.10)' } : undefined}>
                  <div className={`text-[10px] font-medium mb-0.5 ${m.is_admin ? 'text-purple-600' : 'text-blue-100'}`}>{m.is_admin ? 'Support' : 'Du'} · {fmtTime(m.created_at)}</div>
                  {m.body}
                  <MsgAttachments items={attByMsg[m.id]} />
                </div>
              </div>
            ))}
            {busy && <div className="flex justify-end"><div className="bg-blue-600/60 text-white text-sm rounded-2xl rounded-br-sm px-3 py-2">Skickar…</div></div>}
          </>
        )}
        <div ref={endRef} />
      </div>

      <Composer files={files} setFiles={setFiles} busy={busy} onSend={mode === 'ai' ? sendAi : sendTicketReply}
        placeholder={mode === 'ai' ? 'Skriv din fråga…' : 'Svara support…'} />
      <div className="text-[10px] text-gray-400 px-3 pb-2 -mt-1">{mode === 'ai' ? 'AI-support svarar utifrån handboken – granska alltid bokföring själv.' : 'Du chattar med BokPilots support.'}</div>
    </div>
  )
}

// ── Global widget: flytande supportikon + slide-over. Monteras en gång i Layout. ──
export default function SupportWidget() {
  const { open, toggleSupport, unread, connError } = useSupportWidget()
  return (
    <>
      <button onClick={toggleSupport} title="Support" aria-label="Support"
        className={`fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 ${open ? 'ring-2 ring-offset-2 ring-purple-400' : ''}`}
        style={{ background: 'linear-gradient(135deg,#6d28d9,#7c3aed)' }}>
        <i className={`ti ${open ? 'ti-x' : 'ti-headset'} text-2xl`} />
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center border-2 border-white">{unread > 9 ? '9+' : unread}</span>
        )}
        {!open && connError && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-white" title="Anslutningsproblem" />}
      </button>

      <div className={`fixed top-0 right-0 h-full z-50 transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
        style={{ width: 'min(420px, 100vw)' }} aria-hidden={!open}>
        <SupportPanel />
      </div>
    </>
  )
}
