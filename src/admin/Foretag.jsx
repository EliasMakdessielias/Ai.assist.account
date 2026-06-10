import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { filterCompanies, serviceStateMeta, riskMeta, COMPANY_FILTERS } from '../lib/adminCompanies'
import { TONE_CLASS } from '../lib/systemStatus'

// Företagslista – Control Center Fas 2. Server-gate via admin_list_companies (can_view_operations).
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('sv-SE') : '–'
const Pill = ({ meta }) => <span className={`text-xs px-2 py-0.5 rounded ${TONE_CLASS[meta.tone] || TONE_CLASS.gray}`}>{meta.label}</span>

export default function Foretag() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase.rpc('admin_list_companies', { p_search: null, p_state: state || null }).then(({ data, error: err }) => {
      if (!active) return
      if (err) setError(err.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ladda företag')
      else { setRows(data || []); setError(null) }
      setLoading(false)
    })
    return () => { active = false }
  }, [state])

  const filtered = useMemo(() => filterCompanies(rows, { search, state }), [rows, search, state])

  return (
    <div className="p-7 max-w-[1400px]">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Företag</h1>
      <p className="text-sm text-gray-400 mb-5">Alla företag på plattformen.</p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <input className="input pl-8 w-80" placeholder="Sök namn, org.nr, e-post, arkivnr" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>
        <select className="input w-48" value={state} onChange={e => setState(e.target.value)}>
          {COMPANY_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <span className="text-sm text-gray-400">{filtered.length} företag</span>
      </div>

      <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              {['Företag', 'Tjänst', 'Abonnemang', 'Användare', 'Underlag', 'Ärenden', 'Senaste aktivitet', 'Risk'].map(h =>
                <th key={h} className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="8" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              : error ? <tr><td colSpan="8" className="text-center py-12 text-gray-400"><i className="ti ti-lock mr-1" />{error}</td></tr>
              : filtered.length === 0 ? <tr><td colSpan="8" className="text-center py-12 text-gray-400">Inga företag matchar</td></tr>
              : filtered.map(c => (
                <tr key={c.company_id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/foretag/${c.company_id}`)}>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-gray-400">{c.org_nr || '–'}{c.archive_number ? ` · arkiv ${c.archive_number}` : ''}</div>
                  </td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><Pill meta={serviceStateMeta(c.service_state)} /></td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.plan_name || '–'}{c.sub_status ? ` · ${c.sub_status}` : ''}</td>
                  <td className="px-4 py-2.5 border-b tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.user_count}</td>
                  <td className="px-4 py-2.5 border-b tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.document_count}</td>
                  <td className="px-4 py-2.5 border-b tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.open_tickets}</td>
                  <td className="px-4 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmtDate(c.last_activity)}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><Pill meta={riskMeta(c.risk)} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
