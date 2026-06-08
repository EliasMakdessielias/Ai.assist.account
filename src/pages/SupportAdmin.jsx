import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  TICKET_STATUSES, TICKET_PRIORITIES, STATUS_LABELS, PRIORITY_LABELS, CATEGORY_LABELS,
  STATUS_META, PRIORITY_META, TONE_CLASS, isOpenForReply,
} from '../lib/support'
import toast from 'react-hot-toast'
import { AttachmentPicker, AttachmentList } from '../components/SupportAttachments'
import { uploadSupportAttachments } from '../lib/supportAttachments'

const Pill = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.gray}`}>{children}</span>
)
const fmt = ts => ts ? new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–'

export default function SupportAdmin() {
  const { platformAccess } = useAuth()
  const canView = !!platformAccess?.canViewSupport
  const [tickets, setTickets] = useState([])
  const [admins, setAdmins] = useState([])
  const [sel, setSel] = useState(null)        // get_support_ticket-resultat
  const [filters, setFilters] = useState({ status: '', priority: '', assigned: '', search: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  const [note, setNote] = useState('')
  const [replyFiles, setReplyFiles] = useState([])
  const [noteFiles, setNoteFiles] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('list_support_tickets', {
      p_status: filters.status || null, p_priority: filters.priority || null,
      p_assigned_admin_id: filters.assigned || null, p_search: filters.search || null,
    })
    if (error) toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ladda'); else setTickets(data || [])
    setLoading(false)
  }, [filters])

  useEffect(() => { if (canView) { load(); supabase.rpc('list_support_admins').then(({ data }) => setAdmins(data || [])) } }, [canView, load])

  async function openTicket(id) {
    const { data, error } = await supabase.rpc('get_support_ticket', { p_id: id })
    if (error) return toast.error('Kunde inte öppna ärendet')
    setSel(data); setReply(''); setNote(''); setReplyFiles([]); setNoteFiles([])
  }
  async function sendReply() {
    if (!reply.trim() && !replyFiles.length) return
    setBusy(true)
    const { data: msgId, error } = await supabase.rpc('reply_support_ticket', { p_ticket_id: sel.ticket.id, p_body: reply || '(bifogad fil)', p_attachment_count: replyFiles.length })
    if (error) { setBusy(false); return toast.error('Kunde inte skicka svar') }
    try { if (replyFiles.length) await uploadSupportAttachments(supabase, { files: replyFiles, companyId: sel.ticket.company_id, ticketId: sel.ticket.id, messageId: msgId }) } catch (e) { toast.error(e.message) }
    setBusy(false); toast.success('Svar skickat'); await load(); await openTicket(sel.ticket.id)
  }
  async function sendNote() {
    if (!note.trim() && !noteFiles.length) return
    setBusy(true)
    const { data: noteId, error } = await supabase.rpc('add_internal_note', { p_ticket_id: sel.ticket.id, p_body: note || '(bifogad fil)' })
    if (error) { setBusy(false); return toast.error('Kunde inte spara anteckning') }
    try { if (noteFiles.length) await uploadSupportAttachments(supabase, { files: noteFiles, companyId: sel.ticket.company_id, ticketId: sel.ticket.id, noteId }) } catch (e) { toast.error(e.message) }
    setBusy(false); toast.success('Anteckning sparad'); await openTicket(sel.ticket.id)
  }
  async function act(rpc, params, okMsg, keepOpen = true) {
    setBusy(true)
    const { error } = await supabase.rpc(rpc, params)
    setBusy(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades')
    toast.success(okMsg)
    await load()
    if (keepOpen && sel?.ticket?.id) await openTicket(sel.ticket.id)
  }

  if (!canView) return (
    <div className="p-12 text-center">
      <i className="ti ti-lock text-4xl text-gray-300 block mb-3" />
      <div className="text-gray-600 font-medium">Ingen åtkomst</div>
      <div className="text-sm text-gray-400 mt-1">Support kräver rollen <b>support_admin</b> eller <b>superadmin</b>.</div>
    </div>
  )

  const t = sel?.ticket, ctx = sel?.company_context

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-headset text-purple-600" /> Support</span>
        <Link to="/admin" className="btn text-sm"><i className="ti ti-arrow-left" /> Superadmin</Link>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Vänster: filter + lista */}
        <div className="w-[380px] border-r flex flex-col min-h-0" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          <div className="p-3 border-b space-y-2 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            <div className="relative">
              <input className="input pl-8 text-sm" placeholder="Sök ärende eller företag" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select className="input text-xs py-1" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">Status</option>{TICKET_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              <select className="input text-xs py-1" value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
                <option value="">Prioritet</option>{TICKET_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
              <select className="input text-xs py-1" value={filters.assigned} onChange={e => setFilters(f => ({ ...f, assigned: e.target.value }))}>
                <option value="">Tilldelad</option>{admins.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <div className="p-6 text-center text-gray-400 text-sm">Laddar…</div>
              : tickets.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Inga ärenden</div>
              : tickets.map(tk => (
                <button key={tk.id} onClick={() => openTicket(tk.id)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 ${sel?.ticket?.id === tk.id ? 'bg-blue-50/50' : ''}`} style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium truncate">{tk.subject}</span>
                    <Pill tone={PRIORITY_META[tk.priority]?.tone}>{PRIORITY_LABELS[tk.priority]}</Pill>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500 truncate">{tk.company_name || '–'}</span>
                    <Pill tone={STATUS_META[tk.status]?.tone}>{STATUS_LABELS[tk.status]}</Pill>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">{fmt(tk.last_message_at)} · {tk.message_count} meddelanden</div>
                </button>
              ))}
          </div>
        </div>

        {/* Höger: ärendedetalj */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {!sel ? <div className="h-full flex items-center justify-center text-gray-400 text-sm">Välj ett ärende</div> : (
            <div className="p-6 max-w-3xl">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-lg font-semibold">{t.subject}</h1>
                  <div className="text-sm text-gray-500 mt-1">{ctx?.company_name} · {CATEGORY_LABELS[t.category]} · skapad {fmt(t.created_at)}</div>
                </div>
              </div>

              {/* Kontroller */}
              <div className="bg-white rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div><label className="block text-[11px] text-gray-500 mb-1">Status</label>
                  <select className="input text-sm py-1" value={t.status} disabled={busy} onChange={e => act('update_support_ticket_status', { p_ticket_id: t.id, p_status: e.target.value }, 'Status uppdaterad')}>
                    {TICKET_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select></div>
                <div><label className="block text-[11px] text-gray-500 mb-1">Prioritet</label>
                  <select className="input text-sm py-1" value={t.priority} disabled={busy} onChange={e => act('update_support_ticket_priority', { p_ticket_id: t.id, p_priority: e.target.value }, 'Prioritet uppdaterad')}>
                    {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select></div>
                <div><label className="block text-[11px] text-gray-500 mb-1">Tilldelad</label>
                  <select className="input text-sm py-1" value={t.assigned_admin_id || ''} disabled={busy} onChange={e => act('assign_support_ticket', { p_ticket_id: t.id, p_admin_id: e.target.value || null }, 'Ärende tilldelat')}>
                    <option value="">Ej tilldelad</option>{admins.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                  </select></div>
              </div>

              {/* Begränsad kundöversikt */}
              <div className="bg-white rounded-xl p-4 mb-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Kundöversikt</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4 text-sm">
                  <div><span className="text-gray-400 text-xs block">Företag</span>{ctx?.company_name || '–'}</div>
                  <div><span className="text-gray-400 text-xs block">Org.nr</span>{ctx?.org_nr || '–'}</div>
                  <div><span className="text-gray-400 text-xs block">Plan</span>{ctx?.plan || '–'}</div>
                  <div><span className="text-gray-400 text-xs block">Användare</span>{ctx?.users_count ?? '–'}</div>
                  <div><span className="text-gray-400 text-xs block">Senaste aktivitet</span>{ctx?.last_activity ? fmt(ctx.last_activity) : '–'}</div>
                  <div><span className="text-gray-400 text-xs block">Inkomna underlag (30d)</span>{ctx?.recent_inbound_documents ?? '–'}</div>
                  <div><span className="text-gray-400 text-xs block">Misslyckade importer (30d)</span>{ctx?.recent_failed_imports ?? '–'}</div>
                </div>
              </div>

              {/* Konversation */}
              <div className="bg-white rounded-xl p-4 mb-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Konversation</div>
                <div className="space-y-3">
                  {(sel.messages || []).map(m => (
                    <div key={m.id} className={`flex ${m.is_admin ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-xl px-3 py-2 ${m.is_admin ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                        <div className="text-[10px] opacity-70 mb-0.5">{m.is_admin ? 'Support' : (m.sender_email || 'Kund')} · {fmt(m.created_at)}</div>
                        <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                        <AttachmentList items={(sel.attachments || []).filter(a => a.message_id === m.id)} onTone={m.is_admin ? 'dark' : 'light'} />
                      </div>
                    </div>
                  ))}
                </div>
                {isOpenForReply(t.status) && (
                  <div className="mt-3">
                    <div className="flex gap-2">
                      <textarea className="input text-sm flex-1" rows={2} placeholder="Svara kunden…" value={reply} onChange={e => setReply(e.target.value)} />
                      <button className="btn btn-primary self-end" disabled={busy || (!reply.trim() && !replyFiles.length)} onClick={sendReply}><i className="ti ti-send" /> Skicka</button>
                    </div>
                    <div className="mt-1.5"><AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={busy} /></div>
                  </div>
                )}
              </div>

              {/* Interna anteckningar (syns aldrig för kund) */}
              <div className="bg-amber-50 rounded-xl p-4" style={{ border: '0.5px solid rgba(217,119,6,0.25)' }}>
                <div className="text-xs font-semibold text-amber-700 uppercase mb-2 flex items-center gap-1"><i className="ti ti-lock" /> Interna anteckningar (ej synliga för kund)</div>
                <div className="space-y-2 mb-3">
                  {(sel.internal_notes || []).length === 0 ? <div className="text-xs text-amber-700/60">Inga anteckningar</div>
                    : sel.internal_notes.map(n => (
                      <div key={n.id} className="text-sm bg-white/70 rounded px-2 py-1.5">
                        <div className="text-[10px] text-amber-700/70">{n.author_email || 'Admin'} · {fmt(n.created_at)}</div>
                        <div className="whitespace-pre-wrap">{n.body}</div>
                        <AttachmentList items={(sel.attachments || []).filter(a => a.note_id === n.id)} onTone="light" />
                      </div>
                    ))}
                </div>
                <div className="flex gap-2">
                  <textarea className="input text-sm flex-1 bg-white" rows={2} placeholder="Lägg till intern anteckning…" value={note} onChange={e => setNote(e.target.value)} />
                  <button className="btn self-end" disabled={busy || (!note.trim() && !noteFiles.length)} onClick={sendNote}><i className="ti ti-plus" /> Spara</button>
                </div>
                <div className="mt-1.5"><AttachmentPicker files={noteFiles} onChange={setNoteFiles} disabled={busy} /></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
