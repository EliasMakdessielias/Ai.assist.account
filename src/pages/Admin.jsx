import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Admin() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  async function load() {
    setLoading(true)
    const [{ data: companies }, { data: members }, { data: vers }] = await Promise.all([
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('user_companies').select('company_id, email, role'),
      supabase.from('verifikationer').select('company_id'),
    ])
    const verCount = {}
    ;(vers || []).forEach(v => { verCount[v.company_id] = (verCount[v.company_id] || 0) + 1 })
    const memByCo = {}
    const allUsers = new Map()
    ;(members || []).forEach(m => {
      ;(memByCo[m.company_id] ||= []).push(m)
      if (m.email) allUsers.set(m.email.toLowerCase(), { email: m.email, role: m.role })
    })
    setRows((companies || []).map(c => ({
      ...c, members: memByCo[c.id] || [], verCount: verCount[c.id] || 0,
    })).sort((a, b) => (b.suspended ? 1 : 0) - (a.suspended ? 1 : 0)))  // pausade/väntande överst
    setUsers([...allUsers.values()])
    setLoading(false)
  }

  async function toggleSuspend(c) {
    const ny = !c.suspended
    if (ny && !confirm(`Stäng av ${c.name}? Användarna blockeras från appen.`)) return
    const { error } = await supabase.from('companies').update({ suspended: ny }).eq('id', c.id)
    if (error) return toast.error('Kunde inte uppdatera: ' + error.message)
    toast.success(ny ? 'Företaget avstängt' : 'Företaget återaktiverat')
    load()
  }

  if (!isAdmin) {
    return <div className="p-12 text-center text-gray-400">Ingen åtkomst.</div>
  }

  const visible = rows.filter(c => !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.org_nr || '').includes(search) ||
    c.members.some(m => (m.email || '').toLowerCase().includes(search.toLowerCase())))

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-shield-lock text-purple-600" /> Superadmin</span>
        <span className="text-sm text-gray-500">
          {rows.filter(c => c.suspended).length > 0 && <span className="text-amber-700 font-medium mr-3">{rows.filter(c => c.suspended).length} väntar på aktivering</span>}
          {rows.length} företag · {users.length} användare
        </span>
      </div>

      <div className="p-7">
        <div className="mb-4 relative max-w-sm">
          <input className="input pl-8" placeholder="Sök företag, org.nr eller e-post" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Företag</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Org.nr</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Skapad</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Användare</th>
                <th className="text-right px-4 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Verif.</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="7" className="text-center py-12 text-gray-400">Inga företag.</td></tr>
              ) : visible.map(c => (
                <tr key={c.id} className={c.suspended ? 'bg-red-50/40' : ''}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.name}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.org_nr || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    {c.members.length === 0 ? <span className="text-gray-400">–</span> :
                      <span title={c.members.map(m => m.email).join(', ')}>{c.members[0]?.email}{c.members.length > 1 ? ` +${c.members.length - 1}` : ''}</span>}
                  </td>
                  <td className="px-4 py-2.5 border-b text-right tabular-nums text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c.verCount}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    {c.suspended
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Ej aktivt</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'rgba(52,211,153,0.15)', color: '#1a7a2e' }}>Aktivt</span>}
                  </td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    <button className={`btn text-xs py-1 px-3 ${c.suspended ? 'btn-green' : 'btn-danger'}`} onClick={() => toggleSuspend(c)}>
                      {c.suspended ? 'Aktivera' : 'Stäng av'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-400 mt-4">
          Avstängda företag blockeras från appen vid inloggning. Du ser alla företag och användare som registrerat sig — kundernas data är fortsatt isolerad i övrigt.
        </div>
      </div>
    </div>
  )
}
