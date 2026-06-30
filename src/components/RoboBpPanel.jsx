// ROBO-bp högerpanel (slide-over). Kontextuell, läcker aldrig andra bolags data (allt via
// behörighetskontrollerad edge robo-bp-chat). ROBO-bp bokför ALDRIG – föreslår och analyserar.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useRoboBp } from '../context/RoboBpContext'
import { contextLabel, RISK_META, BASIS_META } from '../lib/roboBp'

const OBJECT_ROUTE = { verification: '/bokforing', invoice: '/leverantorsfakturor', document: '/inkorg' }

function RiskBadge({ level }) {
  const m = RISK_META[level] || RISK_META.low
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: m.color }}>{m.label}</span>
}

function AnswerCard({ data, companyId, onOpenObject }) {
  if (!data) return null
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
          <div className="text-[10px] text-amber-600 mt-1"><i className="ti ti-user-check" /> Kräver mänsklig granskning</div>
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
    </div>
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
  const scrollRef = useRef(null)

  useEffect(() => { setMessages([]); setConvId(null); setError(null) }, [company?.id])
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, busy])

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
      setMessages(m => [...m, { role: 'assistant', structured: data.response }])
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

  if (!isOpen) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[60]" onClick={close} />
      <aside className="fixed top-0 right-0 h-screen w-full max-w-[420px] bg-surface-3 z-[61] flex flex-col shadow-2xl" style={{ borderLeft: '0.5px solid rgba(0,0,0,0.12)' }}>
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
              {messages.length === 0 && !busy && (
                <div className="text-[13px] text-gray-500 bg-white rounded-xl p-3" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
                  Ställ en fråga om bokföringen – t.ex. <i>”Vilka kostnader ser ovanliga ut?”</i> eller <i>”Vilka konton bör jag kontrollera inför bokslut?”</i>. Svaren bygger på ditt bolags data och anger källa och osäkerhet.
                </div>
              )}
              {messages.map((m, i) => m.role === 'user'
                ? <div key={i} className="text-[13px] bg-blue-600 text-white rounded-xl px-3 py-2 ml-8">{m.content}</div>
                : m.errored ? <div key={i} className="text-[13px] text-red-600 bg-red-50 rounded-xl px-3 py-2">Kunde inte svara just nu.</div>
                : <AnswerCard key={i} data={m.structured} companyId={company?.id} onOpenObject={onAction} />)}
              {busy && <div className="text-[13px] text-gray-400 flex items-center gap-1.5"><i className="ti ti-loader animate-spin" /> ROBO-bp analyserar…</div>}
              {error && <div className="text-[12px] text-red-500">{error}</div>}
            </div>

            <div className="border-t bg-white p-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div className="flex items-end gap-2">
                <textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder="Fråga ROBO-bp…"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
                <button onClick={send} disabled={busy || !input.trim()} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
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
