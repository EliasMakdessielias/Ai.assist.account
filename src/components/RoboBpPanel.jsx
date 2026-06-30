// ROBO-bp högerpanel (slide-over). Kontextuell, läcker aldrig andra bolags data (allt via
// behörighetskontrollerad edge robo-bp-chat). ROBO-bp bokför ALDRIG – föreslår och analyserar.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useRoboBp } from '../context/RoboBpContext'
import { contextLabel, RISK_META, BASIS_META, canFollowUp, buildCheckPayload, CHECK_STATUS_META, checkActions, sortChecks } from '../lib/roboBp'

const OBJECT_ROUTE = { verification: '/bokforing', invoice: '/leverantorsfakturor', document: '/inkorg' }

function RiskBadge({ level }) {
  const m = RISK_META[level] || RISK_META.low
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: m.color }}>{m.label}</span>
}

function AnswerCard({ data, observations = [], companyId, onOpenObject, onCreateCheck, checkState }) {
  if (!data) return null
  const FollowUpButton = ({ item }) => {
    if (!canFollowUp(item) || !onCreateCheck) return null
    const st = checkState?.[item.title || item.text]
    return (
      <button disabled={st === 'busy' || st === 'done'} onClick={() => onCreateCheck(item)}
        className="text-[11px] px-2 py-1 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-60">
        {st === 'done' ? <><i className="ti ti-check" /> Kontrollpunkt skapad</> : st === 'busy' ? <><i className="ti ti-loader animate-spin" /> Skapar…</> : <><i className="ti ti-flag-plus" /> Skapa kontrollpunkt</>}
      </button>
    )
  }
  return (
    <div className="bg-white rounded-xl p-3 text-[13px]" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="flex items-start gap-2 mb-1.5">
        <i className="ti ti-robot text-violet-600 mt-0.5" />
        <div className="flex-1 whitespace-pre-wrap text-gray-800">{data.answer}</div>
        <RiskBadge level={data.risk_level} />
      </div>
      {Array.isArray(data.basis) && data.basis.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {data.basis.map((b, i) => <span key={i} title={BASIS_META[b]?.desc} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{BASIS_META[b]?.label || b}</span>)}
          {typeof data.confidence === 'number' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">säkerhet {Math.round(data.confidence * 100)}%</span>}
        </div>
      )}
      {Array.isArray(data.findings) && data.findings.map((f, i) => (
        <div key={i} className="mt-2 rounded-lg p-2 bg-gray-50">
          <div className="flex items-center gap-1.5 font-medium text-gray-800"><RiskBadge level={f.risk_level} /> {f.title}</div>
          <div className="text-gray-600 mt-0.5">{f.description}</div>
          {f.affected_objects?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {f.affected_objects.map((o, k) => <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">{o.type}: {o.id}</span>)}
            </div>
          )}
          {f.recommended_action && <div className="text-[12px] text-gray-700 mt-1"><b>Åtgärd:</b> {f.recommended_action}</div>}
          <div className="flex items-center justify-between mt-1">
            <div className="text-[10px] text-amber-600"><i className="ti ti-user-check" /> Kräver mänsklig granskning</div>
            <FollowUpButton item={f} />
          </div>
        </div>
      ))}
      {Array.isArray(data.sources) && data.sources.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-500">
          <span className="font-medium">Källor:</span>{' '}
          {data.sources.map((s, i) => (
            <span key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">{s.title}</a> : s.title}{i < data.sources.length - 1 ? ', ' : ''}</span>
          ))}
        </div>
      )}
      {Array.isArray(data.proposed_actions) && data.proposed_actions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {data.proposed_actions.map((a, i) => (
            <button key={i} onClick={() => onOpenObject(a)} className="text-[12px] px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50">
              <i className="ti ti-arrow-right" /> {a.label}
            </button>
          ))}
        </div>
      )}
      {Array.isArray(data.limitations) && data.limitations.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-400">{data.limitations.map((l, i) => <div key={i}>• {l}</div>)}</div>
      )}
      {Array.isArray(observations) && observations.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-[11px] font-medium text-gray-500 mb-1"><i className="ti ti-checklist" /> Kontroller från systemet</div>
          {observations.map((o, i) => (
            <div key={i} className="rounded-lg p-2 bg-violet-50/50 mt-1">
              <div className="flex items-center gap-1.5">
                <RiskBadge level={o.severity} />
                <span className="text-[12px] text-gray-800 flex-1">{o.text}</span>
                {typeof o.count === 'number' && o.count > 0 && <span className="text-[10px] text-gray-400">×{o.count}</span>}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-400">{o.code}</span>
                <FollowUpButton item={o} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const m = CHECK_STATUS_META[status] || { label: status, color: '#6b7280' }
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: m.color, background: `${m.color}1a` }}>{m.label}</span>
}

// Steg 2E/2F: lista över skapade ROBO-bp-kontrollpunkter med minimalt statusflöde. Rör ALDRIG bokföring.
function ChecksSection({ checks, statusBusy, onStatus, onShowAll }) {
  return (
    <section aria-label="ROBO-bp kontrollpunkter" className="bg-white rounded-xl p-2.5" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
      <div className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1">
        <i className="ti ti-checklist" /> ROBO-bp kontrollpunkter
        <button onClick={onShowAll} className="ml-auto text-[11px] text-violet-600 hover:text-violet-800 font-medium">Visa alla kontrollpunkter</button>
      </div>
      {checks.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-1">Inga kontrollpunkter än. Skapa en från en finding eller observation nedan.</div>
      ) : checks.map(c => (
        <div key={c.id} className="rounded-lg p-2 mt-1" style={{ background: 'rgba(0,0,0,0.02)' }}>
          <div className="flex items-start gap-1.5">
            <RiskBadge level={c.risk_level} />
            <span className="text-[12px] text-gray-800 flex-1 leading-snug">{c.title}</span>
            <StatusBadge status={c.status} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-gray-400">{String(c.created_at || '').slice(0, 10)} · {c.view}</span>
            <div className="flex gap-1">
              {checkActions(c.status).map(a => (
                <button key={a.to} disabled={!!statusBusy[c.id]} onClick={() => onStatus(c.id, a.to)}
                  className="text-[11px] px-2 py-0.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

export default function RoboBpPanel() {
  const { isOpen, licensed, descriptor, close } = useRoboBp()
  const { company } = useAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [convId, setConvId] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [checkState, setCheckState] = useState({})   // per finding-titel: 'busy' | 'done' (dubbelklicksskydd)
  const [checks, setChecks] = useState([])           // Steg 2E: skapade kontrollpunkter för bolaget/vyn
  const [statusBusy, setStatusBusy] = useState({})   // per checkId under statusändring
  const scrollRef = useRef(null)

  // Hämtar kontrollpunkter via RLS-skyddad select (filtrerat på bolag + aktuell vy om specifik).
  const loadChecks = useCallback(async () => {
    if (!company?.id) { setChecks([]); return }
    let q = supabase.from('robo_bp_checks')
      .select('id, title, risk_level, status, created_at, view, source, fiscal_year_id')
      .eq('company_id', company.id)
    const v = descriptor?.view
    if (v && v !== 'oversikt') q = q.eq('view', v)         // specifik vy → filtrera; oversikt (AI-paket) → alla
    const { data } = await q.order('created_at', { ascending: false }).limit(50)
    setChecks(sortChecks(data || []))                       // öppna/påbörjade först
  }, [company?.id, descriptor?.view])

  useEffect(() => { setMessages([]); setConvId(null); setError(null); setCheckState({}) }, [company?.id])
  useEffect(() => { if (isOpen) loadChecks() }, [isOpen, loadChecks])
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, busy])

  // Statusändring (open→in_progress→done / dismissed). Rör ALDRIG bokföring. Audit i RPC:n.
  async function setStatus(checkId, toStatus) {
    if (!checkId || statusBusy[checkId]) return
    setStatusBusy(s => ({ ...s, [checkId]: true }))
    try {
      const { error: err } = await supabase.rpc('robo_bp_set_check_status', { p_check: checkId, p_status: toStatus })
      if (err) throw new Error(err.message || 'fel')
      await loadChecks()
      toast.success('Status uppdaterad – ingen bokföring har ändrats.')
    } catch (e) {
      toast.error(/forbidden|42501|behörig/i.test(e?.message || '') ? 'Du saknar behörighet att ändra status.' : (e?.message || 'Kunde inte ändra status'))
    } finally {
      setStatusBusy(s => { const n = { ...s }; delete n[checkId]; return n })
    }
  }

  async function send() {
    const q = input.trim()
    if (!q || busy || !company?.id) return
    setInput(''); setError(null); setBusy(true)
    setMessages(m => [...m, { role: 'user', content: q }])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error: err } = await supabase.functions.invoke('robo-bp-chat', {
        body: { company_id: company.id, descriptor: { view: descriptor?.view, selection: descriptor?.selection, fiscalYearId: null }, question: q, conversation_id: convId },
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      if (err) { let m = err.message; try { const b = await err.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      setConvId(data.conversation_id)
      setMessages(m => [...m, { role: 'assistant', structured: data.response, observations: Array.isArray(data.observations) ? data.observations : [] }])
    } catch (e) {
      setError(e?.message || 'Något gick fel')
      setMessages(m => [...m, { role: 'assistant', errored: true }])
    } finally { setBusy(false) }
  }

  // Användarens EXPLICITA klick på ett förslag. ROBO-bp utför aldrig själv – vi navigerar eller loggar.
  async function onAction(a) {
    if (a.type === 'open_object' && a.payload?.id) {
      const base = OBJECT_ROUTE[a.payload.type]
      if (base) { close(); navigate(`${base}/${a.payload.id}`); return }
    }
    try { await supabase.rpc('log_robo_bp_event', { p_company: company.id, p_action: 'suggestion_accepted', p_detail: { action_type: a.type, label: a.label } }) } catch { /* ignore */ }
    toast.success('Förslaget loggat – ingen bokföring har ändrats.')
  }

  // Skapa kontrollpunkt från en finding (explicit klick). Skapar ALDRIG bokföring. Dubbelklicksskydd via checkState.
  async function createCheck(item) {
    const key = item?.title || item?.text
    if (!key || checkState[key] === 'busy' || checkState[key] === 'done') return
    const payload = buildCheckPayload(item, { companyId: company?.id, view: descriptor?.view, fiscalYearId: null, conversationId: convId })
    if (!payload) return
    setCheckState(s => ({ ...s, [key]: 'busy' }))
    try {
      const { error: err } = await supabase.rpc('robo_bp_create_check', payload)
      if (err) throw new Error(err.message || 'fel')
      setCheckState(s => ({ ...s, [key]: 'done' }))
      toast.success('Kontrollpunkt skapad – ingen bokföring har ändrats.')
      loadChecks()                                          // uppdatera listan utan reload (point 9)
    } catch (e) {
      setCheckState(s => { const n = { ...s }; delete n[key]; return n })
      toast.error(/forbidden|42501|behörig/i.test(e?.message || '') ? 'Du saknar behörighet att skapa kontrollpunkt.' : (e?.message || 'Kunde inte skapa kontrollpunkt'))
    }
  }

  if (!isOpen) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[60]" onClick={close} />
      <aside aria-label="ROBO-bp" className="fixed top-0 right-0 h-screen w-full max-w-[420px] bg-surface-3 z-[61] flex flex-col shadow-2xl" style={{ borderLeft: '0.5px solid rgba(0,0,0,0.12)' }}>
        <div className="bg-white border-b px-4 h-14 flex items-center gap-2 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <i className="ti ti-robot text-lg text-violet-600" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">ROBO-bp</div>
            <div className="text-[11px] text-gray-400 leading-tight truncate">{contextLabel(descriptor)}</div>
          </div>
          <button onClick={close} className="ml-auto text-gray-400 hover:text-gray-700 p-1" aria-label="Stäng"><i className="ti ti-x text-lg" /></button>
        </div>

        <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100 shrink-0">
          <i className="ti ti-alert-triangle" /> ROBO-bp föreslår och analyserar – den bokför, ändrar eller godkänner aldrig något. Granska och godkänn själv.
        </div>

        {!licensed ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <i className="ti ti-lock text-3xl text-gray-300 block mb-2" />
              <div className="text-gray-600 font-medium">ROBO-bp ingår inte i din plan</div>
              <div className="text-sm text-gray-400 mt-1">Kontakta BokPilot för att aktivera AI-bokföringsassistenten.</div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
              <ChecksSection checks={checks} statusBusy={statusBusy} onStatus={setStatus} onShowAll={() => { close(); navigate('/robo-bp/kontroller') }} />
              {messages.length === 0 && !busy && (
                <div className="text-[13px] text-gray-500 bg-white rounded-xl p-3" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
                  Ställ en fråga om bokföringen – t.ex. <i>”Vilka kostnader ser ovanliga ut?”</i> eller <i>”Vilka konton bör jag kontrollera inför bokslut?”</i>. Svaren bygger på ditt bolags data och anger källa och osäkerhet.
                </div>
              )}
              {messages.map((m, i) => m.role === 'user'
                ? <div key={i} className="text-[13px] bg-blue-600 text-white rounded-xl px-3 py-2 ml-8">{m.content}</div>
                : m.errored ? <div key={i} className="text-[13px] text-red-600 bg-red-50 rounded-xl px-3 py-2">Kunde inte svara just nu.</div>
                : <AnswerCard key={i} data={m.structured} observations={m.observations} companyId={company?.id} onOpenObject={onAction} onCreateCheck={createCheck} checkState={checkState} />)}
              {busy && <div className="text-[13px] text-gray-400 flex items-center gap-1.5"><i className="ti ti-loader animate-spin" /> ROBO-bp analyserar…</div>}
              {error && <div className="text-[12px] text-red-500">{error}</div>}
            </div>

            <div className="border-t bg-white p-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div className="flex items-end gap-2">
                <textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder="Fråga ROBO-bp…"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
                <button onClick={send} disabled={busy || !input.trim()} aria-label="Skicka fråga" className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  <i className="ti ti-send" />
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
