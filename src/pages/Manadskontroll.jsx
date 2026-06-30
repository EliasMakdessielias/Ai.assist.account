import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import HelpButton from '../components/HelpButton'
import RoboBpButton from '../components/RoboBpButton'
import {
  MODULES, MODULE_LABEL, MODULE_ICON, PRIORITY_META, ITEM_STATUS_META, CONTROL_STATUS_META,
  isOpenStatus, sortItems, nextAction, monthOptions,
} from '../lib/monthlyControl'

const fmt = ts => { try { return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '' } }
const fmtDate = ts => { try { return new Date(ts).toLocaleDateString('sv-SE') } catch { return '' } }

const Chip = ({ meta }) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta?.chip || 'bg-gray-100 text-gray-500'}`}>{meta?.label || '—'}</span>
const PriorityChip = ({ p }) => { const m = PRIORITY_META[p]; return <span className="inline-flex items-center gap-1 text-[12px] font-medium"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: m?.dot }} />{m?.label || p}</span> }

function SummaryCard({ label, value, tone = 'gray', sub }) {
  const tones = { red: 'text-red-600', orange: 'text-orange-600', blue: 'text-blue-600', green: 'text-green-600', gray: 'text-gray-800' }
  return (
    <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function Manadskontroll() {
  const { company, user, isAdmin, platformAccess } = useAuth()
  const navigate = useNavigate()
  const role = isAdmin ? 'admin' : (platformAccess?.canViewSupport ? 'support' : 'user')

  const [years, setYears] = useState([])
  const [period, setPeriod] = useState(null)
  const [control, setControl] = useState(null)
  const [items, setItems] = useState([])
  const [running, setRunning] = useState(false)
  const [filters, setFilters] = useState({ module: '', priority: '', status: 'open', search: '' })
  const [selected, setSelected] = useState(null)
  const [aiPanel, setAiPanel] = useState(null) // { title, text, busy }

  useEffect(() => {
    if (!company?.id) return
    supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false })
      .then(({ data }) => setYears(data || []))
  }, [company?.id])

  const months = useMemo(() => monthOptions(years), [years])
  useEffect(() => {
    if (period || !months.length) return
    const now = new Date()
    setPeriod(months.find(m => m.year === now.getFullYear() && m.month === now.getMonth() + 1) || months[0])
  }, [months, period])

  const loadControl = useCallback(async () => {
    if (!company?.id || !period) return
    const { data: ctrl } = await supabase.from('monthly_controls').select('*')
      .eq('company_id', company.id).eq('year', period.year).eq('month', period.month).maybeSingle()
    setControl(ctrl || null)
    if (ctrl) {
      const { data: its } = await supabase.from('monthly_control_items').select('*').eq('monthly_control_id', ctrl.id)
      setItems(its || [])
    } else setItems([])
  }, [company?.id, period])
  useEffect(() => { loadControl() }, [loadControl])

  // Realtime: uppdatera listan när punkter ändras (åtgärder/körningar).
  useEffect(() => {
    if (!control?.id) return
    const ch = supabase.channel(`mc-${control.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_control_items', filter: `monthly_control_id=eq.${control.id}` }, loadControl)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [control?.id, loadControl])

  async function run() {
    if (!company?.id || !period) return
    setRunning(true)
    try {
      await supabase.rpc('run_monthly_control', { p_company_id: company.id, p_year: period.year, p_month: period.month })
      toast.success('Månadskontroll körd')
      await loadControl()
    } catch (e) { toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte köra kontrollen') }
    setRunning(false)
  }

  // ── Aggregat ──
  const openItems = useMemo(() => items.filter(i => isOpenStatus(i.status)), [items])
  const counts = useMemo(() => ({
    open: openItems.length,
    critical: openItems.filter(i => i.priority === 'critical').length,
    high: openItems.filter(i => i.priority === 'high').length,
    normal: openItems.filter(i => i.priority === 'normal').length,
    low: openItems.filter(i => i.priority === 'low').length,
    resolved: items.filter(i => i.status === 'resolved').length,
  }), [items, openItems])
  const progress = control?.progress_percent ?? (items.length ? Math.round((items.length - openItems.length) * 100 / items.length) : 0)
  const moduleCounts = useMemo(() => {
    const m = {}
    for (const it of openItems) m[it.module] = (m[it.module] || 0) + 1
    return m
  }, [openItems])
  const recommended = useMemo(() => nextAction(items), [items])

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return sortItems(items.filter(i =>
      (filters.module === '' || i.module === filters.module) &&
      (filters.priority === '' || i.priority === filters.priority) &&
      (filters.status === 'all' || (filters.status === 'open' ? isOpenStatus(i.status) : i.status === filters.status)) &&
      (!q || (i.title || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q))))
  }, [items, filters])

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-[15px] font-bold tracking-tight flex items-center gap-2"><i className="ti ti-checklist text-purple-600" /> MÅNADSKONTROLL</span>
        {control && <Chip meta={CONTROL_STATUS_META[control.status]} />}
        <select className="input w-auto text-sm" value={period ? `${period.year}-${period.month}` : ''} onChange={e => { const [y, m] = e.target.value.split('-').map(Number); setPeriod(months.find(p => p.year === y && p.month === m)) }}>
          {months.map(m => <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.label}</option>)}
        </select>
        <button className="btn btn-primary font-medium" onClick={run} disabled={running}><i className={`ti ${running ? 'ti-loader-2 animate-spin' : 'ti-player-play'}`} /> {running ? 'Kör…' : 'Kör månadskontroll'}</button>
        <div className="ml-auto flex items-center gap-2">
          <RoboBpButton view="manadskontroll" />
          <button className="btn text-sm" disabled={!openItems.length} onClick={() => askAi('summary', { items: openItems }, 'Månadens risker')}><i className="ti ti-sparkles" /> Sammanfatta risker</button>
          <button className="btn text-sm" disabled={!openItems.length} onClick={() => askAi('checklist', { items: openItems }, 'Checklista för månadsavslut')}><i className="ti ti-list-check" /> Skapa checklista</button>
          <HelpButton slug="manadskontroll" variant="icon" />
        </div>
      </div>

      {!control && (
        <div className="bg-white rounded-xl p-8 text-center" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <i className="ti ti-checklist text-4xl text-gray-300 block mb-2" />
          <div className="text-sm text-gray-600 mb-1">Ingen kontroll körd för {period?.label} ännu.</div>
          <div className="text-xs text-gray-400 mb-4">Kör en månadskontroll för att hitta ofullständiga moment och åtgärder.</div>
          <button className="btn btn-primary" onClick={run} disabled={running}><i className="ti ti-player-play" /> Kör månadskontroll</button>
        </div>
      )}

      {control && (
        <>
          {/* Sammanfattning */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            <SummaryCard label="Öppna punkter" value={counts.open} tone="gray" />
            <SummaryCard label="Kritiska" value={counts.critical} tone="red" />
            <SummaryCard label="Höga" value={counts.high} tone="orange" />
            <SummaryCard label="Lösta" value={counts.resolved} tone="green" />
            <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="text-[11px] text-gray-400 uppercase tracking-wide">Progress</div>
              <div className="text-2xl font-semibold mt-0.5">{progress}%</div>
              <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${progress}%` }} /></div>
            </div>
          </div>

          {/* Per modul + nästa åtgärd */}
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <div className="md:col-span-2 bg-white rounded-xl p-3" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2 px-1">Status per område</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {MODULES.map(m => {
                  const n = moduleCounts[m.key] || 0
                  return (
                    <button key={m.key} onClick={() => setFilters(f => ({ ...f, module: f.module === m.key ? '' : m.key, status: 'open' }))}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${filters.module === m.key ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <i className={`ti ${m.icon} text-gray-400`} />
                      <div className="min-w-0 flex-1"><div className="text-[12px] truncate">{m.label}</div></div>
                      <span className={`text-[12px] font-semibold ${n ? 'text-gray-800' : 'text-gray-300'}`}>{n}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="bg-white rounded-xl p-3 flex flex-col" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2 px-1">Nästa rekommenderade åtgärd</div>
              {recommended ? (
                <div className="flex-1 flex flex-col">
                  <PriorityChip p={recommended.priority} />
                  <div className="text-[13px] font-medium mt-1 leading-snug">{recommended.title}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{MODULE_LABEL[recommended.module]}</div>
                  <button className="btn btn-primary text-sm mt-auto self-start" onClick={() => setSelected(recommended)}>Öppna åtgärd</button>
                </div>
              ) : <div className="text-sm text-green-600 flex items-center gap-1"><i className="ti ti-circle-check" /> Inga öppna punkter 🎉</div>}
              {control.last_run_at && <div className="text-[10px] text-gray-300 mt-2">Senast körd {fmt(control.last_run_at)}</div>}
            </div>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative">
              <input className="input pl-8 w-64 text-sm" placeholder="Sök punkt…" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            </div>
            <select className="input w-auto text-sm" value={filters.module} onChange={e => setFilters(f => ({ ...f, module: e.target.value }))}>
              <option value="">Alla områden</option>
              {MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select className="input w-auto text-sm" value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
              <option value="">Alla prioriteter</option>
              {['critical', 'high', 'normal', 'low'].map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
            <select className="input w-auto text-sm" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              <option value="open">Öppna</option>
              <option value="all">Alla</option>
              <option value="resolved">Lösta</option>
              <option value="ignored">Ignorerade</option>
            </select>
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} punkter</span>
          </div>

          {/* Lista */}
          <div className="bg-white rounded-xl overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Prioritet', 'Titel', 'Område', 'Status', 'Åtgärd'].map((h, i) => (
                    <th key={h} className={`${i === 4 ? 'text-right' : 'text-left'} px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b whitespace-nowrap`} style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400 text-sm">Inga punkter för valt filter.</td></tr>}
                {filtered.map(it => (
                  <tr key={it.id} className="hover:brightness-95 transition-all cursor-pointer" style={{ background: isOpenStatus(it.status) ? PRIORITY_META[it.priority]?.row : 'rgba(0,0,0,0.015)' }} onClick={() => setSelected(it)}>
                    <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><PriorityChip p={it.priority} /></td>
                    <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><div className="font-medium leading-snug">{it.title}</div></td>
                    <td className="px-3 py-2.5 border-b text-gray-500 whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{MODULE_LABEL[it.module]}</td>
                    <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><Chip meta={ITEM_STATUS_META[it.status]} /></td>
                    <td className="px-3 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={e => e.stopPropagation()}>
                      {it.action_url && <button className="text-blue-700 hover:underline text-[13px]" onClick={() => navigate(it.action_url)}>Gå till <i className="ti ti-arrow-right" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && <ItemDrawer item={selected} company={company} user={user} role={role} onClose={() => setSelected(null)} onChanged={loadControl} navigate={navigate} askAi={askAi} />}
      {aiPanel && <AiPanel panel={aiPanel} onClose={() => setAiPanel(null)} />}
    </div>
  )

  // ── AI ──
  async function askAi(mode, payload, title) {
    setAiPanel({ title, text: '', busy: true })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('manadskontroll-ai', {
        body: { mode, ...payload, user_context: { company: company?.name || null, role } },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      setAiPanel({ title, text: data.svar, busy: false })
    } catch (e) { setAiPanel({ title, text: '⚠️ ' + (e.message || e), busy: false }) }
  }
}

// ── AI-resultatpanel (modal) ──
function AiPanel({ panel, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="text-sm font-semibold flex items-center gap-2"><span className="w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#6d28d9,#7c3aed)' }}><i className="ti ti-sparkles text-xs" /></span>{panel.title}</div>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="p-5 overflow-y-auto text-sm whitespace-pre-wrap leading-relaxed">{panel.busy ? <span className="text-gray-400">AI analyserar…</span> : panel.text}</div>
        <div className="px-5 py-2 border-t text-[10px] text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>AI ger förslag – granska alltid själv. Stänger eller bokför aldrig något automatiskt.</div>
      </div>
    </div>
  )
}

// ── Detalj-drawer med åtgärder, spårbarhet, kommentarer och AI ──
function ItemDrawer({ item, company, user, role, onClose, onChanged, navigate, askAi }) {
  const [busy, setBusy] = useState(false)
  const [comments, setComments] = useState([])
  const [comment, setComment] = useState('')
  const [ai, setAi] = useState(null)
  const [events, setEvents] = useState([])
  const meta = PRIORITY_META[item.priority]

  const loadDetail = useCallback(async () => {
    const [{ data: c }, { data: ev }] = await Promise.all([
      supabase.from('monthly_control_comments').select('*').eq('item_id', item.id).order('created_at'),
      supabase.from('monthly_control_events').select('*').eq('item_id', item.id).order('created_at', { ascending: false }).limit(20),
    ])
    setComments(c || []); setEvents(ev || [])
  }, [item.id])
  useEffect(() => { loadDetail() }, [loadDetail])

  async function act(rpc, args, ok) {
    setBusy(true)
    try { const { error } = await supabase.rpc(rpc, args); if (error) throw error; if (ok) toast.success(ok); await onChanged(); await loadDetail() }
    catch (e) { toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades') }
    setBusy(false)
  }
  async function sendComment() {
    if (!comment.trim()) return
    await act('comment_mc_item', { p_item: item.id, p_body: comment }); setComment('')
  }
  function ignore() {
    const reason = window.prompt('Ange motivering för att ignorera punkten:')
    if (reason && reason.trim().length >= 2) act('ignore_mc_item', { p_item: item.id, p_reason: reason }, 'Punkt ignorerad')
    else if (reason !== null) toast.error('Motivering krävs')
  }
  async function explain() {
    setAi({ busy: true, text: '' })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('manadskontroll-ai', {
        body: { mode: 'explain', item, user_context: { company: company?.name || null, role } },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      setAi({ busy: false, text: data.svar })
    } catch (e) { setAi({ busy: false, text: '⚠️ ' + (e.message || e) }) }
  }
  async function escalate() {
    setBusy(true)
    try {
      const body = `Eskalerat från Månadskontroll.\n\nPunkt: ${item.title}\nOmråde: ${MODULE_LABEL[item.module]}\nPrioritet: ${PRIORITY_META[item.priority]?.label}\nBeskrivning: ${item.description || '—'}\nFöreslagen åtgärd: ${item.suggested_action || '—'}\nRegel: ${item.rule_key}`
      const { error } = await supabase.rpc('create_support_ticket', { p_company_id: company.id, p_subject: `Månadskontroll: ${item.title}`.slice(0, 80), p_category: 'bookkeeping', p_priority: 'normal', p_body: body })
      if (error) throw error
      toast.success('Ärende skapat hos support')
    } catch (e) { toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte eskalera') }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-start justify-between gap-2 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><PriorityChip p={item.priority} /><Chip meta={ITEM_STATUS_META[item.status]} /></div>
            <div className="text-[15px] font-semibold mt-1 leading-snug">{item.title}</div>
            <div className="text-[11px] text-gray-400">{MODULE_LABEL[item.module]}</div>
          </div>
          <button className="text-gray-400 hover:text-gray-700 p-1" onClick={onClose}><i className="ti ti-x text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {item.description && <p className="text-sm text-gray-700 leading-relaxed">{item.description}</p>}
          {item.suggested_action && (
            <div className="bg-blue-50 rounded-lg p-3 text-[13px] text-blue-900"><i className="ti ti-bulb mr-1" />{item.suggested_action}</div>
          )}
          {item.action_url && <button className="btn btn-primary w-full" onClick={() => navigate(item.action_url)}><i className="ti ti-arrow-right" /> Gå till åtgärd</button>}

          {/* Åtgärder */}
          <div className="flex flex-wrap gap-2">
            {item.status !== 'in_progress' && isOpenStatus(item.status) && <button className="btn text-sm" disabled={busy} onClick={() => act('start_mc_item', { p_item: item.id }, 'Markerad som påbörjad')}><i className="ti ti-player-play" /> Påbörja</button>}
            {isOpenStatus(item.status) && <button className="btn text-sm" disabled={busy} onClick={() => act('resolve_mc_item', { p_item: item.id }, 'Markerad som löst')}><i className="ti ti-check" /> Lös</button>}
            {isOpenStatus(item.status) && <button className="btn text-sm" disabled={busy} onClick={ignore}><i className="ti ti-eye-off" /> Ignorera</button>}
            {!isOpenStatus(item.status) && <button className="btn text-sm" disabled={busy} onClick={() => act('reopen_mc_item', { p_item: item.id }, 'Återöppnad')}><i className="ti ti-rotate" /> Återöppna</button>}
            {item.assigned_to === user?.id
              ? <button className="btn text-sm" disabled={busy} onClick={() => act('assign_mc_item', { p_item: item.id, p_user: null }, 'Tilldelning borttagen')}><i className="ti ti-user-off" /> Ta bort mig</button>
              : <button className="btn text-sm" disabled={busy} onClick={() => act('assign_mc_item', { p_item: item.id, p_user: user.id }, 'Tilldelad dig')}><i className="ti ti-user-check" /> Tilldela mig</button>}
            <button className="btn text-sm" disabled={busy} onClick={explain}><i className="ti ti-sparkles" /> Be AI om hjälp</button>
            <button className="btn text-sm" disabled={busy} onClick={escalate}><i className="ti ti-headset" /> Eskalera till support</button>
          </div>

          {ai && (
            <div className="bg-purple-50 rounded-lg p-3 text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">
              <div className="text-[10px] font-semibold text-purple-600 mb-1">AI-FÖRSLAG</div>
              {ai.busy ? <span className="text-gray-400">AI analyserar…</span> : ai.text}
            </div>
          )}

          {/* Kommentarer */}
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-2">Interna kommentarer</div>
            <div className="space-y-2 mb-2">
              {comments.map(c => <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2 text-[13px]"><div className="text-[10px] text-gray-400 mb-0.5">{fmt(c.created_at)}</div>{c.body}</div>)}
              {!comments.length && <div className="text-[12px] text-gray-400">Inga kommentarer ännu.</div>}
            </div>
            <div className="flex gap-2">
              <textarea className="input text-sm flex-1" rows={2} placeholder="Skriv en kommentar…" value={comment} onChange={e => setComment(e.target.value)} />
              <button className="btn btn-primary self-end" disabled={busy || !comment.trim()} onClick={sendComment}><i className="ti ti-send" /></button>
            </div>
          </div>

          {/* Spårbarhet */}
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-2">Spårbarhet</div>
            <div className="text-[12px] text-gray-500 space-y-1">
              <div><span className="text-gray-400">Regel:</span> {item.rule_key}</div>
              <div><span className="text-gray-400">Skapad:</span> {fmt(item.created_at)}</div>
              <div><span className="text-gray-400">Senast uppdaterad:</span> {fmt(item.updated_at)}</div>
              {item.resolved_at && <div><span className="text-gray-400">Löst:</span> {fmt(item.resolved_at)}</div>}
              {item.ignored_reason && <div><span className="text-gray-400">Ignorerad:</span> {item.ignored_reason}</div>}
              {item.source_data && Object.keys(item.source_data).length > 0 && (
                <pre className="bg-gray-50 rounded p-2 text-[11px] text-gray-600 overflow-x-auto mt-1">{JSON.stringify(item.source_data, null, 2)}</pre>
              )}
            </div>
            {events.length > 0 && (
              <div className="mt-2 text-[11px] text-gray-400 space-y-0.5">
                {events.map(e => <div key={e.id}>{fmtDate(e.created_at)} · {e.event_type}</div>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
