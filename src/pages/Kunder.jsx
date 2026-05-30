import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const empty = { name: '', org_nr: '', contact_person: '', email: '', phone: '', address: '', payment_terms: 30 }

export default function Kunder() {
  const { company } = useAuth()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // objekt vid redigering/ny, annars null
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('customers').select('*').eq('company_id', company.id).order('name')
    setCustomers(data || [])
    setLoading(false)
  }

  async function save() {
    if (!editing.name?.trim()) return toast.error('Kundnamn krävs')
    setSaving(true)
    const payload = {
      name: editing.name.trim(), org_nr: editing.org_nr || null, contact_person: editing.contact_person || null,
      email: editing.email || null, phone: editing.phone || null, address: editing.address || null,
      payment_terms: parseInt(editing.payment_terms, 10) || 30,
    }
    let error
    if (editing.id) ({ error } = await supabase.from('customers').update(payload).eq('id', editing.id))
    else ({ error } = await supabase.from('customers').insert({ ...payload, company_id: company.id }))
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Kund sparad')
    setEditing(null)
    load()
  }

  async function remove(c) {
    if (!confirm(`Ta bort kunden "${c.name}"?`)) return
    const { error } = await supabase.from('customers').delete().eq('id', c.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Kund borttagen')
    load()
  }

  const visible = customers.filter(c => !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.org_nr || '').includes(search))

  const field = (key, label, props = {}) => (
    <div className={props.w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{props.required ? ' *' : ''}</label>
      <input className="input" type={props.type || 'text'} value={editing[key] ?? ''} onChange={e => setEditing(s => ({ ...s, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kunder</span>
        <button className="btn btn-primary" onClick={() => setEditing({ ...empty })}><i className="ti ti-plus" /> Ny kund</button>
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
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>E-post</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Telefon</th>
                <th className="px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="5" className="text-center py-12 text-gray-400">
                  <i className="ti ti-users text-3xl block mb-2 opacity-30" />
                  {customers.length ? 'Inga kunder matchar sökningen.' : 'Inga kunder än – lägg till din första.'}
                </td></tr>
              ) : visible.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditing(c)}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{c.name}</td>
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

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">{editing.id ? 'Redigera kund' : 'Ny kund'}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setEditing(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              {field('name', 'Kundnamn', { w: 2, required: true })}
              {field('org_nr', 'Organisationsnummer')}
              {field('contact_person', 'Kontaktperson')}
              {field('email', 'E-post', { type: 'email' })}
              {field('phone', 'Telefon')}
              {field('address', 'Adress', { w: 2 })}
              {field('payment_terms', 'Betalningsvillkor (dagar)', { type: 'number' })}
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
