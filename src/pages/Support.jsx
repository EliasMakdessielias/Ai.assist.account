import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  TICKET_CATEGORIES, CATEGORY_LABELS, CUSTOMER_PRIORITIES, PRIORITY_LABELS,
  CUSTOMER_STATUS_LABELS, customerStatusLabel, STATUS_META, PRIORITY_META, TONE_CLASS, isOpenForReply,
} from '../lib/support'
import toast from 'react-hot-toast'

const Pill = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.gray}`}>{children}</span>
)
const fmt = ts => ts ? new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–'
const emptyForm = () => ({ subject: '', category: 'invoice_import', priority: 'normal', body: '' })

export default function Support() {
  const { company, user } = useAuth()
  const [tickets, setTickets] = useState([])
  const [sel, setSel] = useState(null)         // { ticket, messages }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [reply, setReply] = useState('')

  const loadList = useCallback(async () => {
    if (!company) return
    setLoading(true)
    const { data } = await supabase.from('support_tickets')
      .select('id, subject, category, priority, status, last_message_at, created_at')
      .eq('company_id', company.id).order('last_message_at', { ascending: false })
    setTickets(data || [])
    setLoading(false)
  }, [company?.id])

  useEffect(() => { loadList() }, [loadList])

  async function openTicket(id) {
    const [{ data: t }, { data: msgs }] = await Promise.all([
      supabase.from('support_tickets').select('id, subject, category, priority, status, created_at').eq('id', id).single(),
      supabase.from('support_messages').select('id, is_admin, body, created_at').eq('ticket_id', id).order('created_at'),
    ])
    setSel({ ticket: t, messages: msgs || [] }); setReply('')
  }

  async function createTicket() {
    if (!form.subject.trim() || !form.body.trim()) return toast.error('Fyll i ämne och meddelande')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_support_ticket', {
      p_company_id: company.id, p_subject: form.subject, p_category: form.category, p_priority: form.priority, p_body: form.body,
    })
    setBusy(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skapa ärende')
    toast.success('Supportärende skapat'); setCreating(false); setForm(emptyForm())
    await loadList(); if (data) openTicket(data)
  }
  async function sendReply() {
    if (!reply.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('customer_reply_support_ticket', { p_ticket_id: sel.ticket.id, p_body: reply })
    setBusy(false)
    if (error) return toast.error('Kunde inte skicka svar')
    setReply(''); await loadList(); await openTicket(sel.ticket.id)
  }
  async function closeTicket() {
    if (!confirm('Markera ärendet som löst och stäng det?')) return
    setBusy(true)
    const { error } = await supabase.rpc('customer_close_support_ticket', { p_ticket_id: sel.ticket.id })
    setBusy(false)
    if (error) return toast.error('Kunde inte stänga ärendet')
    toast.success('Ärendet stängt'); await loadList(); await openTicket(sel.ticket.id)
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-headset text-blue-600" /> Support</span>
        <button className="btn btn-primary text-sm" onClick={() => { setCreating(true); setSel(null) }}><i className="ti ti-plus" /> Nytt ärende</button>
      </div>

      <div className="p-7 max-w-5xl grid grid-cols-1 md:grid-cols-[320px_1fr] gap-6">
        {/* Lista */}
        <div className="bg-white rounded-xl overflow-hidden self-start" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <div className="px-4 py-2.5 border-b text-sm font-semibold" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>Mina ärenden</div>
          {loading ? <div className="p-6 text-center text-gray-400 text-sm">Laddar…</div>
            : tickets.length === 0 ? (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">
                <i className="ti ti-message-2 text-3xl block mb-2 opacity-40" />Inga supportärenden än.
                <div className="mt-2"><button className="text-blue-700 hover:underline" onClick={() => setCreating(true)}>Skapa ditt första ärende</button></div>
              </div>
            ) : tickets.map(tk => (
              <button key={tk.id} onClick={() => { setCreating(false); openTicket(tk.id) }}
                className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 ${sel?.ticket?.id === tk.id ? 'bg-blue-50/50' : ''}`} style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium truncate">{tk.subject}</span>
                  <Pill tone={STATUS_META[tk.status]?.tone}>{customerStatusLabel(tk.status)}</Pill>
                </div>
                <div className="text-[11px] text-gray-400">{CATEGORY_LABELS[tk.category]} · {fmt(tk.last_message_at)}</div>
              </button>
            ))}
        </div>

        {/* Detalj / skapa */}
        <div>
          {creating ? (
            <div className="bg-white rounded-xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <h2 className="text-sm font-semibold mb-4">Nytt supportärende</h2>
              <div className="space-y-3">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Ämne</label>
                  <input className="input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Kort beskrivning" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Kategori</label>
                    <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select></div>
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Prioritet</label>
                    <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                      {CUSTOMER_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select></div>
                </div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Meddelande</label>
                  <textarea className="input" rows={5} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Beskriv ditt ärende…" /></div>
                <div className="flex justify-end gap-2">
                  <button className="btn" onClick={() => setCreating(false)}>Avbryt</button>
                  <button className="btn btn-primary" disabled={busy} onClick={createTicket}><i className="ti ti-send" /> Skicka</button>
                </div>
              </div>
            </div>
          ) : !sel ? (
            <div className="bg-white rounded-xl p-12 text-center text-gray-400 text-sm" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              Välj ett ärende eller skapa ett nytt.
            </div>
          ) : (
            <div className="bg-white rounded-xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-base font-semibold">{sel.ticket.subject}</h2>
                <Pill tone={STATUS_META[sel.ticket.status]?.tone}>{customerStatusLabel(sel.ticket.status)}</Pill>
              </div>
              <div className="text-xs text-gray-500 mb-4">{CATEGORY_LABELS[sel.ticket.category]} · {PRIORITY_LABELS[sel.ticket.priority]} · skapad {fmt(sel.ticket.created_at)}</div>

              <div className="space-y-3 mb-4">
                {sel.messages.map(m => (
                  <div key={m.id} className={`flex ${m.is_admin ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 ${m.is_admin ? 'bg-gray-100 text-gray-800' : 'bg-blue-600 text-white'}`}>
                      <div className="text-[10px] opacity-70 mb-0.5">{m.is_admin ? 'BokPilot support' : 'Du'} · {fmt(m.created_at)}</div>
                      <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>

              {isOpenForReply(sel.ticket.status) ? (
                <>
                  <div className="flex gap-2">
                    <textarea className="input text-sm flex-1" rows={2} placeholder="Skriv ett svar…" value={reply} onChange={e => setReply(e.target.value)} />
                    <button className="btn btn-primary self-end" disabled={busy || !reply.trim()} onClick={sendReply}><i className="ti ti-send" /> Skicka</button>
                  </div>
                  <div className="mt-3 text-right">
                    <button className="text-xs text-gray-500 hover:text-gray-800" onClick={closeTicket}><i className="ti ti-circle-check" /> Markera som löst & stäng</button>
                  </div>
                </>
              ) : (
                <div className="text-center text-sm text-gray-400 py-3 border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  Ärendet är stängt. Skapa ett nytt ärende om du behöver mer hjälp.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
