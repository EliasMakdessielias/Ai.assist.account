import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import KundEditor from '../components/KundEditor'
import { nextKundNr } from '../lib/kunder'

export default function Kunder() {
  const { company } = useAuth()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // kundobjekt vid redigering, {} vid ny, annars null

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('customers').select('*').eq('company_id', company.id)
      .order('kund_nr', { ascending: true, nullsFirst: false }).order('name')
    setCustomers(data || [])
    setLoading(false)
  }

  async function remove(c) {
    if (!confirm(`Ta bort kunden "${c.name}"?`)) return
    const { error } = await supabase.from('customers').delete().eq('id', c.id).eq('company_id', company.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Kund borttagen')
    setEditing(null)
    load()
  }

  const visible = customers.filter(c => !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.org_nr || '').includes(search) ||
    String(c.kund_nr || '').includes(search))

  if (editing) {
    return (
      <KundEditor
        kund={editing.id ? editing : null}
        forslagsNr={nextKundNr(customers)}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
        onDelete={remove}
      />
    )
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kunder</span>
        <button className="btn btn-primary" onClick={() => setEditing({})}><i className="ti ti-plus" /> Skapa kund</button>
      </div>

      <div className="p-7">
        <div className="mb-4 relative max-w-xs">
          <input className="input pl-8" placeholder="Sök namn, org.nr eller kundnr" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kundnr</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Org.nr</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>E-post</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Telefon</th>
                <th className="px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">
                  <i className="ti ti-users text-3xl block mb-2 opacity-30" />
                  {customers.length ? 'Inga kunder matchar sökningen.' : 'Inga kunder än – lägg till din första.'}
                </td></tr>
              ) : visible.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditing(c)}>
                  <td className="px-4 py-2.5 border-b tabular-nums text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{c.kund_nr ?? '–'}</td>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {c.name}
                    {c.is_active === false && <span className="ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Inaktiv</span>}
                  </td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{c.org_nr || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{c.email || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{c.phone || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    <button className="text-gray-300 hover:text-red-600" title="Ta bort" onClick={e => { e.stopPropagation(); remove(c) }}><i className="ti ti-trash" /></button>
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
