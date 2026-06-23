import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Plattformsadmin-vy (read-only) över nekade åtgärder i AI Bokslut & Årsredovisning.
// RLS på bokslut_denied_log (is_platform_admin) är auktoritativ – icke-plattformsadmin får 0 rader.
// Ingen radering/ändring/export i denna version.

const fmt = ts => { try { return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '' } }
const short = v => v ? <span title={v} className="font-mono text-[11px]">{String(v).slice(0, 8)}…</span> : <span className="text-gray-300">—</span>
const isUuid = v => /^[0-9a-fA-F-]{32,36}$/.test((v || '').trim())

const Th = ({ children, r }) => <th className={`${r ? 'text-right' : 'text-left'} px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b whitespace-nowrap`} style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{children}</th>
const Td = ({ children, cls = '' }) => <td className={`px-3 py-2.5 border-b align-top ${cls}`} style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{children}</td>

const ROLE_CHIP = { admin: 'bg-blue-100 text-blue-700', member: 'bg-gray-100 text-gray-600', none: 'bg-amber-100 text-amber-700' }

export default function BokslutDeniedLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ from: '', to: '', company: '', user: '', action: '', role: '', q: '' })

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('bokslut_denied_log')
      .select('id, created_at, company_id, engagement_id, user_id, role, action, reason, context')
      .order('created_at', { ascending: false }).limit(500)
    if (filters.from) query = query.gte('created_at', filters.from)
    if (filters.to) query = query.lte('created_at', filters.to + 'T23:59:59')
    if (isUuid(filters.company)) query = query.eq('company_id', filters.company.trim())
    if (isUuid(filters.user)) query = query.eq('user_id', filters.user.trim())
    if (filters.action) query = query.ilike('action', `%${filters.action}%`)
    if (filters.role) query = query.eq('role', filters.role)
    if (filters.q) query = query.or(`reason.ilike.%${filters.q}%,action.ilike.%${filters.q}%`)
    const { data, error } = await query
    if (!error) setRows(data || [])
    setLoading(false)
  }, [filters])
  useEffect(() => { load() }, [load])

  const reset = () => setFilters({ from: '', to: '', company: '', user: '', action: '', role: '', q: '' })

  return (
    <div className="p-6 max-w-[1280px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[15px] font-bold tracking-tight flex items-center gap-2"><i className="ti ti-shield-x text-red-600" /> NEKADE BOKSLUTSÅTGÄRDER</span>
        <span className="text-[11px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">Plattformsadmin · read-only</span>
      </div>
      <div className="text-[12px] text-gray-400 mb-4">Säkerhetslogg för AI Bokslut & Årsredovisning. Visas aldrig i kund-UI. Senaste 500 posterna.</div>

      {/* Filter */}
      <div className="bg-white rounded-xl p-3 mb-3 flex flex-wrap items-end gap-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <div><label className="block text-[11px] text-gray-500 mb-1">Från</label><input type="date" className="input text-sm py-1" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Till</label><input type="date" className="input text-sm py-1" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Företag (UUID)</label><input className="input text-sm py-1 w-44" placeholder="company_id" value={filters.company} onChange={e => setFilters(f => ({ ...f, company: e.target.value }))} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Användare (UUID)</label><input className="input text-sm py-1 w-44" placeholder="user_id" value={filters.user} onChange={e => setFilters(f => ({ ...f, user: e.target.value }))} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Åtgärd</label><input className="input text-sm py-1 w-40" placeholder="t.ex. resolve" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Roll</label>
          <select className="input text-sm py-1" value={filters.role} onChange={e => setFilters(f => ({ ...f, role: e.target.value }))}>
            <option value="">Alla</option><option value="admin">admin</option><option value="member">member</option><option value="none">none</option>
          </select>
        </div>
        <div className="relative"><label className="block text-[11px] text-gray-500 mb-1">Sök (orsak/åtgärd)</label><input className="input text-sm py-1 w-52" placeholder="fritext" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} /></div>
        <button className="btn text-sm" onClick={reset}>Rensa</button>
        <span className="text-[12px] text-gray-400 ml-auto">{loading ? 'Laddar…' : `${rows.length} poster`}</span>
      </div>

      {/* Tabell */}
      <div className="bg-white rounded-xl overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <table className="w-full text-sm">
          <thead><tr>{['Tid', 'Företag', 'Engagemang', 'Användare', 'Roll', 'Åtgärd', 'Orsak', 'Route'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400 text-sm">Inga nekade åtgärder för valt filter.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <Td cls="whitespace-nowrap text-gray-600">{fmt(r.created_at)}</Td>
                <Td>{short(r.company_id)}</Td>
                <Td>{short(r.engagement_id)}</Td>
                <Td>{short(r.user_id)}</Td>
                <Td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${ROLE_CHIP[r.role] || 'bg-gray-100 text-gray-500'}`}>{r.role || '—'}</span></Td>
                <Td cls="font-medium whitespace-nowrap">{r.action}</Td>
                <Td cls="text-gray-600 max-w-[360px]"><div className="line-clamp-2" title={r.reason}>{r.reason || '—'}</div></Td>
                <Td cls="text-gray-500 whitespace-nowrap">{r.context?.route || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
