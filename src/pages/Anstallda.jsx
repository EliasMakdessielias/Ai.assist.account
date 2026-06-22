import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { validatePersonnummer, normalizePersonnummer, maskPersonnummer } from '../lib/personnummer'
import { useSectionActions } from '../components/SectionTabsLayout'

const fmt = n => (n || n === 0) ? Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '–'
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n }

const emptyEmployee = {
  namn: '', personnummer: '', epost: '', telefon: '',
  anstallningsdatum: new Date().toISOString().slice(0, 10), slutdatum: '', is_active: true,
  undanta_arbetsgivaravgift: false,
  manadslon: '', sidoinkomst: false, kommun: '', skattetabell: '', bankkontonummer: '',
  ack_bruttolon: '', ack_prelskatt: '',
}

// Liten iOS-stil toggle.
function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function Anstallda() {
  const { company, user } = useAuth()
  const { setActions } = useSectionActions()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('alla')   // alla | aktiva | inaktiva
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  // "Ny anställd" i den delade toppraden (bredvid flikarna).
  useEffect(() => {
    setActions(<button className="btn btn-primary" onClick={() => setEditing({ ...emptyEmployee })}><i className="ti ti-plus" /> Ny anställd</button>)
    return () => setActions(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').eq('company_id', company.id).order('namn', { nullsFirst: false })
    setItems(data || [])
    setLoading(false)
  }

  const displayName = e => e.namn || [e.fornamn, e.efternamn].filter(Boolean).join(' ') || '–'

  async function save() {
    const e = editing
    if (!e.namn?.trim()) return toast.error('Namn krävs')
    if (!e.personnummer?.trim()) return toast.error('Personnummer krävs')
    const v = validatePersonnummer(e.personnummer)
    if (!v.valid) return toast.error('Ogiltigt personnummer: ' + v.reason)
    if (!e.anstallningsdatum) return toast.error('Startdatum krävs')
    if (num(e.manadslon) == null) return toast.error('Ange bruttolön per månad')

    setSaving(true)
    const payload = {
      namn: e.namn.trim(), fornamn: null, efternamn: null,
      personnummer: normalizePersonnummer(e.personnummer),
      epost: e.epost?.trim() || null, telefon: e.telefon?.trim() || null,
      anstallningsdatum: e.anstallningsdatum || null, slutdatum: e.slutdatum || null,
      is_active: e.is_active !== false,
      undanta_arbetsgivaravgift: !!e.undanta_arbetsgivaravgift,
      lonetyp: 'manad', manadslon: num(e.manadslon),
      sidoinkomst: !!e.sidoinkomst,
      kommun: e.sidoinkomst ? null : (e.kommun?.trim() || null),
      skattetabell: e.sidoinkomst || !e.skattetabell ? null : parseInt(e.skattetabell, 10),
      bankkontonummer: e.bankkontonummer?.trim() || null,
      ack_bruttolon: num(e.ack_bruttolon) ?? 0,
      ack_prelskatt: num(e.ack_prelskatt) ?? 0,
    }
    let error
    if (e.id) ({ error } = await supabase.from('employees').update(payload).eq('id', e.id))
    else ({ error } = await supabase.from('employees').insert({ ...payload, company_id: company.id, created_by: user?.id || null }))
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success(e.id ? 'Anställd uppdaterad' : 'Anställd skapad')
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
    if (!confirm(`Ta bort ${displayName(emp)}? Detta går inte att ångra.`)) return
    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Anställd borttagen')
    load()
  }

  const visible = items.filter(e => {
    if (filter === 'aktiva' && !e.is_active) return false
    if (filter === 'inaktiva' && e.is_active) return false
    if (!search) return true
    const s = search.toLowerCase()
    return displayName(e).toLowerCase().includes(s) || (e.personnummer || '').includes(search) || (e.epost || '').toLowerCase().includes(s)
  })

  const set = (k, val) => setEditing(s => ({ ...s, [k]: val }))
  const field = (key, label, props = {}) => (
    <div className={props.w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}{props.required ? ' *' : ''}</label>
      <input className="input" type={props.type || 'text'} inputMode={props.inputMode} placeholder={props.placeholder} disabled={props.disabled}
        value={editing[key] ?? ''} onChange={ev => set(key, ev.target.value)} />
      {props.hint && <p className="text-[11px] text-gray-400 mt-1">{props.hint}</p>}
    </div>
  )
  const toggleRow = (key, label, hint) => (
    <div className="flex items-start gap-3 py-1">
      <Toggle checked={!!editing[key]} onChange={val => set(key, val)} />
      <div>
        <div className="text-sm text-gray-700">{label}</div>
        {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
      </div>
    </div>
  )
  const sectionTitle = t => <div className="col-span-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mt-2 mb-0.5">{t}</div>

  const counts = { alla: items.length, aktiva: items.filter(e => e.is_active).length, inaktiva: items.filter(e => !e.is_active).length }

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {[['alla', 'Alla'], ['aktiva', 'Aktiva'], ['inaktiva', 'Inaktiva']].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3 py-1 text-[13px] rounded-md transition-colors ${filter === k ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                {l} <span className="text-gray-400">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="relative max-w-xs flex-1">
            <input className="input pl-8" placeholder="Sök namn, personnr eller e-post" value={search} onChange={e => setSearch(e.target.value)} />
            <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          </div>
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Personnummer</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>E-post</th>
                <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Telefon</th>
                <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Månadslön</th>
                <th className="text-left px-4 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Tabell</th>
                <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="text-right px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Åtgärder</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="8" className="text-center py-16 text-gray-400">
                  <i className="ti ti-user text-3xl block mb-2 opacity-30" />
                  {items.length ? (
                    <div className="text-sm">Inga anställda matchar.</div>
                  ) : (
                    <>
                      <div className="font-semibold text-gray-700 mb-1">Inga anställda ännu</div>
                      <div className="text-sm">Lägg till anställda för att komma igång med lönehantering.</div>
                    </>
                  )}
                </td></tr>
              ) : visible.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditing({ ...emptyEmployee, ...e, namn: displayName(e) === '–' ? '' : displayName(e) })}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{displayName(e)}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600 tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.personnummer ? maskPersonnummer(e.personnummer) : '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.epost || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.telefon || '–'}</td>
                  <td className="px-4 py-2.5 border-b text-right text-gray-700 tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.manadslon != null ? `${fmt(e.manadslon)} kr` : '–'}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600 tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{e.sidoinkomst ? 'Sidoink.' : (e.skattetabell || '–')}</td>
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
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-start justify-between sticky top-0 bg-white z-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div>
                <div className="text-base font-semibold">{editing.id ? 'Redigera anställd' : 'Ny anställd'}</div>
                <div className="text-xs text-gray-400 mt-0.5">Fyll i information om den {editing.id ? 'anställda' : 'nya anställda'}</div>
              </div>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setEditing(null)}><i className="ti ti-x text-lg" /></button>
            </div>

            <div className="px-6 py-4 grid grid-cols-2 gap-4">
              {sectionTitle('Personuppgifter')}
              {field('namn', 'Namn', { w: 2, required: true, placeholder: 'Anna Andersson' })}
              {field('personnummer', 'Personnummer', { w: 2, required: true, placeholder: '19900101-1234', hint: 'Format: YYYYMMDD-XXXX eller YYYYMMDDXXXX' })}
              {field('epost', 'E-post', { type: 'email', placeholder: 'anna@email.com' })}
              {field('telefon', 'Telefon', { placeholder: '+46701234567', hint: 'Krävs för säker leverans av lönebesked via SMS.' })}

              {sectionTitle('Anställningsuppgifter')}
              {field('anstallningsdatum', 'Startdatum', { type: 'date', required: true })}
              {field('slutdatum', 'Slutdatum (valfritt)', { type: 'date' })}
              <div className="col-span-2 space-y-1">
                {toggleRow('is_active', 'Aktiv anställning')}
                {toggleRow('undanta_arbetsgivaravgift', 'Undanta från arbetsgivaravgifter', 'Arbetsgivaravgifter beräknas ej vid lönekörning för denna anställd')}
              </div>

              {sectionTitle('Löneinformation')}
              {field('manadslon', 'Bruttolön / månad', { w: 2, required: true, inputMode: 'decimal', placeholder: '35000', hint: 'Lön före skatt. Nettolön beräknas automatiskt vid lönekörning.' })}
              <div className="col-span-2">{toggleRow('sidoinkomst', 'Sidoinkomst', 'Anställningen är inte mottagarens huvudsakliga inkomst – skatteavdrag görs med fast procentsats istället för skattetabell.')}</div>
              {field('kommun', 'Kommun', { placeholder: 'Sök kommun…', disabled: editing.sidoinkomst, hint: 'Välj kommun för att tilldela skattetabell' })}
              {field('skattetabell', 'Skattetabell', { inputMode: 'numeric', disabled: editing.sidoinkomst, placeholder: 't.ex. 34', hint: 'Hämtas från Skatteverket utifrån kommun' })}
              {field('bankkontonummer', 'Bankkontonummer', { w: 2, placeholder: '1234567890', hint: 'För utbetalning av lön' })}

              {sectionTitle('Ingående ackumulerade värden')}
              <p className="col-span-2 -mt-1 text-[11px] text-gray-400">Fyll i om du migrerar från ett annat system mitt under ett år. Lämna tomt annars.</p>
              {field('ack_bruttolon', 'Ack. bruttolön (kr)', { inputMode: 'decimal', placeholder: '0', hint: 'Utbetald bruttolön före i år' })}
              {field('ack_prelskatt', 'Ack. preliminärskatt (kr)', { inputMode: 'decimal', placeholder: '0', hint: 'Dragen skatt före i år' })}

              <p className="col-span-2 text-[11px] text-gray-400 flex items-start gap-1.5 mt-1">
                <i className="ti ti-shield-lock mt-0.5" /> Personnummer är en känslig personuppgift och lagras endast för ditt företag (GDPR).
              </p>
            </div>

            <div className="px-6 py-3 border-t flex justify-end gap-2.5 sticky bottom-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setEditing(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Sparar…' : editing.id ? 'Spara' : 'Skapa'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
