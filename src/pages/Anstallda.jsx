import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { validatePersonnummer, normalizePersonnummer, maskPersonnummer } from '../lib/personnummer'

const fmt = n => (n || n === 0) ? Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '–'

const ANSTALLNINGSFORM = [
  ['tillsvidare', 'Tillsvidare'], ['visstid', 'Visstid'],
  ['provanstallning', 'Provanställning'], ['timanstalld', 'Timanställd'],
]
const ANSTALLNINGSFORM_LABEL = Object.fromEntries(ANSTALLNINGSFORM)

const emptyEmployee = {
  fornamn: '', efternamn: '', personnummer: '', befattning: '', epost: '', telefon: '',
  anstallningsform: 'tillsvidare', lonetyp: 'manad', manadslon: '', timlon: '',
  skattetabell: '', skattekolumn: '1', arbetsgivaravgift_procent: '31.42',
  clearingnr: '', kontonr: '', anstallningsdatum: '', slutdatum: '', is_active: true,
}

const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n }

export default function Anstallda() {
  const { company, user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').eq('company_id', company.id).order('efternamn')
    setItems(data || [])
    setLoading(false)
  }

  async function save() {
    const e = editing
    if (!e.fornamn?.trim() || !e.efternamn?.trim()) return toast.error('För- och efternamn krävs')
    if (e.personnummer?.trim()) {
      const v = validatePersonnummer(e.personnummer)
      if (!v.valid) return toast.error('Ogiltigt personnummer: ' + v.reason)
    }
    if (e.lonetyp === 'manad' && num(e.manadslon) == null) return toast.error('Ange månadslön')
    if (e.lonetyp === 'timme' && num(e.timlon) == null) return toast.error('Ange timlön')

    setSaving(true)
    const payload = {
      fornamn: e.fornamn.trim(), efternamn: e.efternamn.trim(),
      personnummer: e.personnummer?.trim() ? normalizePersonnummer(e.personnummer) : null,
      befattning: e.befattning?.trim() || null, epost: e.epost?.trim() || null, telefon: e.telefon?.trim() || null,
      anstallningsform: e.anstallningsform, lonetyp: e.lonetyp,
      manadslon: e.lonetyp === 'manad' ? num(e.manadslon) : null,
      timlon: e.lonetyp === 'timme' ? num(e.timlon) : null,
      skattetabell: e.skattetabell ? parseInt(e.skattetabell, 10) : null,
      skattekolumn: e.skattekolumn ? parseInt(e.skattekolumn, 10) : null,
      arbetsgivaravgift_procent: num(e.arbetsgivaravgift_procent) ?? 31.42,
      clearingnr: e.clearingnr?.trim() || null, kontonr: e.kontonr?.trim() || null,
      anstallningsdatum: e.anstallningsdatum || null, slutdatum: e.slutdatum || null,
      is_active: e.is_active !== false,
    }
    let error
    if (e.id) ({ error } = await supabase.from('employees').update(payload).eq('id', e.id))
    else ({ error } = await supabase.from('employees').insert({ ...payload, company_id: company.id, created_by: user?.id || null }))
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Anställd sparad')
    setEditing(null)
    load()
  }

  async function toggleActive(emp) {
    const { error } = await supabase.from('employees').update({ is_active: !emp.is_active }).eq('id', emp.id)
    if (error) return toast.error('Kunde inte ändra status: ' + error.message)
    toast.success(emp.is_active ? 'Anställd inaktiverad' : 'Anställd aktiverad')
    load()
  }

  async function remove(emp) {
    if (!confirm(`Ta bort ${emp.fornamn} ${emp.efternamn}? Detta går inte att ångra.`)) return
    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Anställd borttagen')
    load()
  }

  const lonText = e => e.lonetyp === 'timme'
    ? (e.timlon != null ? `${fmt(e.timlon)} kr/tim` : '–')
    : (e.manadslon != null ? `${fmt(e.manadslon)} kr/mån` : '–')

  const visible = items.filter(e => {
    if (!showInactive && !e.is_active) return false
    if (!search) return true
    const s = search.toLowerCase()
    return `${e.fornamn} ${e.efternamn}`.toLowerCase().includes(s) || (e.personnummer || '').includes(search) || (e.befattning || '').toLowerCase().includes(s)
  })

  const field = (key, label, props = {}) => (
    <div className={props.w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{props.required ? ' *' : ''}</label>
      <input className="input" type={props.type || 'text'} inputMode={props.inputMode} placeholder={props.placeholder}
        value={editing[key] ?? ''} onChange={ev => setEditing(s => ({ ...s, [key]: ev.target.value }))} />
    </div>
  )
  const select = (key, label, opts) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <select className="input" value={editing[key]} onChange={ev => setEditing(s => ({ ...s, [key]: ev.target.value }))}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Anställda</span>
        <button className="btn btn-primary" onClick={() => setEditing({ ...emptyEmployee })}><i className="ti ti-plus" /> Ny anställd</button>
      </div>

      <div className="p-7">
        <div className="flex items-center justify-between mb-4">
          <div className="relative max-w-xs flex-1">
            <input className="input pl-8" placeholder="Sök namn, personnr eller befattning" value={search} onChange={e => setSearch(e.target.value)} />
            <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          </div>
          <label className="text-sm text-gray-500 flex items-center gap-1.5 cursor-pointer ml-3">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Visa inaktiva
          </label>
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Personnr</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Befattning</th>
                <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Anställning</th>
                <th className="text-right px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Lön</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="px-4 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="7" className="text-center py-14 text-gray-400">
                  <i className="ti ti-users text-3xl block mb-2 opacity-30" />
                  {items.length ? 'Inga anställda matchar.' : 'Inga anställda ännu – lägg till din första.'}
                </td></tr>
              ) : visible.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditing({ ...emptyEmployee, ...e })}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.fornamn} {e.efternamn}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600 tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.personnummer ? maskPersonnummer(e.personnummer) : '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.befattning || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{ANSTALLNINGSFORM_LABEL[e.anstallningsform] || e.anstallningsform}</td>
                  <td className="px-4 py-2.5 border-b text-right text-gray-700 tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{lonText(e)}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${e.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{e.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                  </td>
                  <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }} onClick={ev => ev.stopPropagation()}>
                    <button className="text-gray-300 hover:text-gray-700" title={e.is_active ? 'Inaktivera' : 'Aktivera'} onClick={() => toggleActive(e)}>
                      <i className={`ti ${e.is_active ? 'ti-user-off' : 'ti-user-check'}`} />
                    </button>
                    <button className="text-gray-300 hover:text-red-600 ml-2" title="Ta bort" onClick={() => remove(e)}><i className="ti ti-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">{editing.id ? 'Redigera anställd' : 'Ny anställd'}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setEditing(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              {field('fornamn', 'Förnamn', { required: true })}
              {field('efternamn', 'Efternamn', { required: true })}
              {field('personnummer', 'Personnummer', { placeholder: 'ÅÅÅÅMMDD-XXXX' })}
              {field('befattning', 'Befattning')}
              {select('anstallningsform', 'Anställningsform', ANSTALLNINGSFORM)}
              {select('lonetyp', 'Lönetyp', [['manad', 'Månadslön'], ['timme', 'Timlön']])}
              {editing.lonetyp === 'manad'
                ? field('manadslon', 'Månadslön (kr)', { inputMode: 'decimal' })
                : field('timlon', 'Timlön (kr)', { inputMode: 'decimal' })}
              {field('arbetsgivaravgift_procent', 'Arbetsgivaravgift (%)', { inputMode: 'decimal' })}
              {field('skattetabell', 'Skattetabell', { inputMode: 'numeric', placeholder: 't.ex. 34' })}
              {field('skattekolumn', 'Skattekolumn', { inputMode: 'numeric' })}
              {field('epost', 'E-post', { type: 'email' })}
              {field('telefon', 'Telefon')}
              {field('clearingnr', 'Clearingnr')}
              {field('kontonr', 'Kontonummer')}
              {field('anstallningsdatum', 'Anställningsdatum', { type: 'date' })}
              {field('slutdatum', 'Slutdatum', { type: 'date' })}
              <label className="col-span-2 text-sm text-gray-600 flex items-center gap-2 mt-1">
                <input type="checkbox" checked={editing.is_active !== false} onChange={e => setEditing(s => ({ ...s, is_active: e.target.checked }))} />
                Aktiv (inkluderas i lönekörningar)
              </label>
              <p className="col-span-2 text-[11px] text-gray-400 flex items-start gap-1.5">
                <i className="ti ti-shield-lock mt-0.5" /> Personnummer är en känslig personuppgift och lagras endast för ditt företag (GDPR).
              </p>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5 sticky bottom-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setEditing(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
