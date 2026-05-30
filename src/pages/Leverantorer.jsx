import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const empty = { name: '', org_nr: '', category: '', bankgiro: '', email: '', phone: '', address: '' }

export default function Leverantorer() {
  const { company } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('suppliers').select('*').eq('company_id', company.id).order('name')
    setItems(data || [])
    setLoading(false)
  }

  async function save() {
    if (!editing.name?.trim()) return toast.error('Leverantörsnamn krävs')
    setSaving(true)
    const payload = {
      name: editing.name.trim(), org_nr: editing.org_nr || null, category: editing.category || null,
      bankgiro: editing.bankgiro || null, email: editing.email || null, phone: editing.phone || null, address: editing.address || null,
    }
    let error
    if (editing.id) ({ error } = await supabase.from('suppliers').update(payload).eq('id', editing.id))
    else ({ error } = await supabase.from('suppliers').insert({ ...payload, company_id: company.id }))
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Leverantör sparad')
    setEditing(null)
    load()
  }

  async function remove(s) {
    if (!confirm(`Ta bort leverantören "${s.name}"?`)) return
    const { error } = await supabase.from('suppliers').delete().eq('id', s.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Leverantör borttagen')
    load()
  }

  const visible = items.filter(s => !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) || (s.org_nr || '').includes(search))

  const field = (key, label, props = {}) => (
    <div className={props.w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{props.required ? ' *' : ''}</label>
      <input className="input" type={props.type || 'text'} value={editing[key] ?? ''} onChange={e => setEditing(s => ({ ...s, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Leverantörer</span>
        <button className="btn btn-primary" onClick={() => setEditing({ ...empty })}><i className="ti ti-plus" /> Ny leverantör</button>
      </div>

      <div className="p-7">
        <div className="mb-4 relative max-w-xs">
          <input className="input pl-8" placeholder="Sök namn eller org.nr" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Org.nr</th>
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kategori</th>
                <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bankgiro</th>
                <th className="px-4 py-2.5 border-b w-16" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="5" className="text-center py-12 text-gray-400">
                  <i className="ti ti-building-store text-3xl block mb-2 opacity-30" />
                  {items.length ? 'Inga leverantörer matchar sökningen.' : 'Inga leverantörer än – lägg till din första.'}
                </td></tr>
              ) : visible.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditing(s)}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{s.name}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{s.org_nr || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{s.category || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{s.bankgiro || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    <button className="text-gray-300 hover:text-red-600" title="Ta bort" onClick={e => { e.stopPropagation(); remove(s) }}><i className="ti ti-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">{editing.id ? 'Redigera leverantör' : 'Ny leverantör'}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setEditing(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              {field('name', 'Leverantörsnamn', { w: 2, required: true })}
              {field('org_nr', 'Organisationsnummer')}
              {field('category', 'Kategori')}
              {field('bankgiro', 'Bankgiro')}
              {field('email', 'E-post', { type: 'email' })}
              {field('phone', 'Telefon')}
              {field('address', 'Adress', { w: 2 })}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setEditing(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
