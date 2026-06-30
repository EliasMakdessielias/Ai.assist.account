// ROBO-bp Steg 2F – samlad arbetsvy för alla ROBO-bp-kontrollpunkter (per bolag + filter).
// Läser robo_bp_checks via RLS (bolagsisolerat). Statusändring via robo_bp_set_check_status (audit metadata-only).
// Visar ALDRIG audit-rådata, frågetext eller rå AI-svarstext. Rör ALDRIG bokföring.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRoboBp } from '../context/RoboBpContext'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { RISK_META, CHECK_STATUS_META, CHECK_STATUSES, RISK_LEVELS, checkActions, sortChecks } from '../lib/roboBp'

function Pill({ meta, fallback }) {
  const m = meta || { label: fallback, color: '#6b7280' }
  return <span className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ color: m.color, background: `${m.color}1a` }}>{m.label}</span>
}

export default function RoboBpChecks() {
  const { company } = useAuth()
  const { licensed } = useRoboBp()
  const navigate = useNavigate()
  const [checks, setChecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusBusy, setStatusBusy] = useState({})
  const [filters, setFilters] = useState({ status: 'all', risk: 'all', view: 'all', fy: 'all' })

  const loadChecks = useCallback(async () => {
    if (!company?.id) { setChecks([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('robo_bp_checks')
      .select('id, title, risk_level, status, view, fiscal_year_id, source, created_at, updated_at')
      .eq('company_id', company.id)                       // bolagsisolering (utöver RLS)
      .order('created_at', { ascending: false }).limit(200)
    setChecks(sortChecks(data || []))
    setLoading(false)
  }, [company?.id])

  useEffect(() => { loadChecks() }, [loadChecks])
  useEffect(() => { setFilters({ status: 'all', risk: 'all', view: 'all', fy: 'all' }) }, [company?.id])

  const views = useMemo(() => [...new Set(checks.map(c => c.view).filter(Boolean))], [checks])
  const fyIds = useMemo(() => [...new Set(checks.map(c => c.fiscal_year_id).filter(Boolean))], [checks])
  const filtered = useMemo(() => checks.filter(c =>
    (filters.status === 'all' || c.status === filters.status) &&
    (filters.risk === 'all' || c.risk_level === filters.risk) &&
    (filters.view === 'all' || c.view === filters.view) &&
    (filters.fy === 'all' || c.fiscal_year_id === filters.fy)
  ), [checks, filters])

  async function setStatus(checkId, toStatus) {
    if (!checkId || statusBusy[checkId]) return
    setStatusBusy(s => ({ ...s, [checkId]: true }))
    try {
      const { error } = await supabase.rpc('robo_bp_set_check_status', { p_check: checkId, p_status: toStatus })
      if (error) throw new Error(error.message || 'fel')
      await loadChecks()
      toast.success('Status uppdaterad – ingen bokföring har ändrats.')
    } catch (e) {
      toast.error(/forbidden|42501|behörig/i.test(e?.message || '') ? 'Du saknar behörighet att ändra status.' : (e?.message || 'Kunde inte ändra status'))
    } finally {
      setStatusBusy(s => { const n = { ...s }; delete n[checkId]; return n })
    }
  }

  if (!licensed) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="bg-white rounded-2xl p-8 text-center" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
          <i className="ti ti-lock text-3xl text-gray-300 block mb-2" />
          <div className="text-gray-700 font-medium">ROBO-bp ingår inte i din plan</div>
          <div className="text-sm text-gray-400 mt-1">Kontrollpunkter kräver att AI-bokföringsassistenten är aktiverad.</div>
        </div>
      </div>
    )
  }

  const Select = ({ value, onChange, children, label }) => (
    <label className="text-[12px] text-gray-500 flex items-center gap-1.5">
      {label}
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-[13px] bg-white">
        {children}
      </select>
    </label>
  )

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-2 mb-1">
        <i className="ti ti-checklist text-xl text-violet-600" />
        <h1 className="text-lg font-semibold">ROBO-bp kontrollpunkter</h1>
      </div>
      <p className="text-[13px] text-gray-500 mb-4">Samlad uppföljning av kontrollpunkter som skapats från ROBO-bp:s findings och observationer. ROBO-bp bokför aldrig – kontrollpunkter ändrar ingen bokföring.</p>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Select label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))}>
          <option value="all">Alla</option>
          {CHECK_STATUSES.map(s => <option key={s} value={s}>{CHECK_STATUS_META[s].label}</option>)}
        </Select>
        <Select label="Risk" value={filters.risk} onChange={v => setFilters(f => ({ ...f, risk: v }))}>
          <option value="all">Alla</option>
          {RISK_LEVELS.map(r => <option key={r} value={r}>{RISK_META[r]?.label || r}</option>)}
        </Select>
        <Select label="Vy" value={filters.view} onChange={v => setFilters(f => ({ ...f, view: v }))}>
          <option value="all">Alla</option>
          {views.map(v => <option key={v} value={v}>{v}</option>)}
        </Select>
        {fyIds.length > 0 && (
          <Select label="Räkenskapsår" value={filters.fy} onChange={v => setFilters(f => ({ ...f, fy: v }))}>
            <option value="all">Alla</option>
            {fyIds.map(id => <option key={id} value={id}>{String(id).slice(0, 8)}</option>)}
          </Select>
        )}
        <button onClick={loadChecks} className="text-[12px] text-gray-500 hover:text-gray-800 flex items-center gap-1 ml-auto"><i className="ti ti-refresh" /> Uppdatera</button>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm"><i className="ti ti-loader animate-spin" /> Laddar…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center" data-testid="robo-checks-empty">
            <i className="ti ti-clipboard-check text-3xl text-gray-200 block mb-2" />
            <div className="text-gray-600 font-medium">{checks.length === 0 ? 'Inga ROBO-bp-kontrollpunkter finns' : 'Inga kontrollpunkter matchar filtret'}</div>
            <div className="text-sm text-gray-400 mt-1">{checks.length === 0 ? 'Skapa kontrollpunkter från ROBO-bp-panelens findings eller observationer.' : 'Justera filtren ovan.'}</div>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                <th className="px-3 py-2 font-medium">Kontrollpunkt</th>
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Vy</th>
                <th className="px-3 py-2 font-medium">Skapad</th>
                <th className="px-3 py-2 font-medium">Uppdaterad</th>
                <th className="px-3 py-2 font-medium">Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.04)' }}>
                  <td className="px-3 py-2 text-gray-800 max-w-[260px]">{c.title}</td>
                  <td className="px-3 py-2"><Pill meta={RISK_META[c.risk_level]} fallback={c.risk_level} /></td>
                  <td className="px-3 py-2"><Pill meta={CHECK_STATUS_META[c.status]} fallback={c.status} /></td>
                  <td className="px-3 py-2 text-gray-500">{c.view}</td>
                  <td className="px-3 py-2 text-gray-400">{String(c.created_at || '').slice(0, 10)}</td>
                  <td className="px-3 py-2 text-gray-400">{String(c.updated_at || '').slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {checkActions(c.status).map(a => (
                        <button key={a.to} disabled={!!statusBusy[c.id]} onClick={() => setStatus(c.id, a.to)}
                          className="text-[11px] px-2 py-0.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">
                          {a.label}
                        </button>
                      ))}
                      {checkActions(c.status).length === 0 && <span className="text-[11px] text-gray-300">–</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button onClick={() => navigate(-1)} className="text-[12px] text-gray-400 hover:text-gray-700 mt-3 flex items-center gap-1"><i className="ti ti-arrow-left" /> Tillbaka</button>
    </div>
  )
}
