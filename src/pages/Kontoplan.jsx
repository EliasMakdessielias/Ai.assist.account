import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function Kontoplan() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('alla')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const perPage = 100

  useEffect(() => { if (company) loadAccounts() }, [company])

  async function loadAccounts() {
    setLoading(true)
    const { data } = await supabase
      .from('accounts')
      .select('*')
      .eq('company_id', company.id)
      .order('account_nr')
    setAccounts(data || [])
    setLoading(false)
  }

  const filtered = accounts.filter(a => {
    if (statusFilter === 'aktiva' && !a.is_active) return false
    if (statusFilter === 'inaktiva' && a.is_active) return false
    if (search && !a.account_nr.includes(search) && !a.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageData = filtered.slice((page - 1) * perPage, page * perPage)

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kontoplan</span>
        <button className="btn btn-primary" onClick={() => navigate('/installningar/kontoplan/ny')}>
          <i className="ti ti-plus" /> Skapa konto
        </button>
      </div>

      <div className="p-7">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="relative">
              <input className="input pl-8 w-64" placeholder="Konto, Benämning" value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }} />
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            </div>
            {['alla', 'aktiva', 'inaktiva'].map(s => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`btn text-xs ${statusFilter === s ? 'bg-gray-100' : ''}`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{filtered.length} konton</span>
            <button className="btn text-xs py-1 px-2" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><i className="ti ti-chevron-left" /></button>
            <span>{page} / {totalPages}</span>
            <button className="btn text-xs py-1 px-2" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><i className="ti ti-chevron-right" /></button>
          </div>
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="tbl w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b bg-gray-200 w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Benämning</th>
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Momskod</th>
                <th className="text-left px-4 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>SRU</th>
                <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>IB</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">Laddar kontoplan...</td></tr>
              ) : pageData.map(a => (
                <tr key={a.id} className="cursor-pointer hover:bg-gray-50"
                  onClick={() => navigate(`/installningar/kontoplan/${a.account_nr}`)}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{a.account_nr}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{a.name}</td>
                  <td className="px-4 py-2.5 border-b text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{a.vat_code || '—'}</td>
                  <td className="px-4 py-2.5 border-b text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{a.sru || '—'}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {a.is_active
                      ? <span className="badge-active"><i className="ti ti-check text-xs" /> Aktiv</span>
                      : <span className="badge-draft">Inaktiv</span>}
                  </td>
                  <td className="px-4 py-2.5 border-b text-right text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {(a.opening_balance || 0).toFixed(2).replace('.', ',')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
