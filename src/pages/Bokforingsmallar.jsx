import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import LockedStandardPostBadge from '../components/kontoplan/LockedStandardPostBadge'
import toast from 'react-hot-toast'

const USAGE_AREAS = ['Leverantörsfaktura', 'Kvitto', 'Övrigt uttag', 'Övrig insättning', 'Manuell verifikation']
const SERIES = [
  'A - Anläggningstillgångar', 'B - Bokslutsverifikationer', 'C - Kassa och bank', 'D - Kvitto',
  'G - Arbetsgivardeklarationer', 'I - Inbetalningar', 'K - Kundfakturor', 'L - Leverantörsfakturor',
  'M - Manuella verifikationer', 'N - Moms', 'R - Rättelser', 'U - Utbetalningar',
]
const OPERATORS = ['+', '-', '*', '/', '(', ')']

const emptyRow = () => ({ account_nr: '', project: '', cost_center: '', dk: 'debet', formula: '' })
const normRow = r => ({ account_nr: r.account_nr || '', project: r.project || '', cost_center: r.cost_center || '', dk: r.dk || 'debet', formula: r.formula || '' })
const emptyTemplate = () => ({
  id: null, name: '', name_en: '', usage_area: 'Manuell verifikation', ver_series: 'M - Manuella verifikationer',
  description: '', is_active: true, is_standard: false, locked: false, rows: [emptyRow(), emptyRow()],
})

export default function Bokforingsmallar() {
  const { company } = useAuth()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const focusedFormula = useRef(null)

  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    setLoading(true)
    const [{ data: t }, { data: acc }] = await Promise.all([
      supabase.from('bookkeeping_templates').select('*').eq('company_id', company.id).order('name'),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).order('account_nr'),
    ])
    setItems(t || [])
    setAccounts(acc || [])
    setLoading(false)
  }

  const accName = nr => accounts.find(a => a.account_nr === nr)?.name || ''
  const accLabel = nr => nr ? `${nr} - ${accName(nr)}` : ''

  const visible = useMemo(() => items.filter(t =>
    (showInactive || t.is_active) &&
    (!search || `${t.name} ${t.usage_area}`.toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => a.name.localeCompare(b.name, 'sv')), [items, showInactive, search])

  function openNew() { setEditing(emptyTemplate()) }
  function openEdit(t) { setEditing({ ...t, rows: (t.rows || []).map(normRow) }) }
  function openCopy(t) {
    setEditing({ ...emptyTemplate(), name: `${t.name} (kopia)`, name_en: t.name_en || '', usage_area: t.usage_area,
      ver_series: t.ver_series || '', description: t.description || '', rows: (t.rows || []).map(normRow) })
  }

  async function save() {
    const e = editing
    if (e.locked) return toast.error('Detta är en låst standardpost och kan inte ändras.')
    if (!e.name.trim()) return toast.error('Ange ett namn')
    setSaving(true)
    const payload = {
      company_id: company.id, name: e.name.trim(), name_en: e.name_en || null,
      usage_area: e.usage_area, ver_series: e.ver_series || null, description: e.description || null,
      is_active: e.is_active, rows: (e.rows || []).filter(r => r.account_nr || r.formula).map(normRow),
    }
    let error
    if (e.id) ({ error } = await supabase.from('bookkeeping_templates').update(payload).eq('id', e.id))
    else ({ error } = await supabase.from('bookkeeping_templates').insert(payload))
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Bokföringsmall sparad')
    setEditing(null); load()
  }

  async function remove(t) {
    if (t.is_standard) return toast.error('Standardmallar kan inte raderas')
    if (!confirm(`Ta bort "${t.name}"?`)) return
    const { error } = await supabase.from('bookkeeping_templates').delete().eq('id', t.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Borttagen'); load()
  }

  // ---------- Redigerare ----------
  if (editing) {
    const e = editing
    const ro = e.locked
    const set = (k, v) => setEditing(p => ({ ...p, [k]: v }))
    const setRow = (i, k, v) => setEditing(p => ({ ...p, rows: p.rows.map((r, j) => j === i ? { ...r, [k]: v } : r) }))
    const addRow = i => setEditing(p => ({ ...p, rows: [...p.rows.slice(0, i + 1), emptyRow(), ...p.rows.slice(i + 1)] }))
    const delRow = i => setEditing(p => ({ ...p, rows: p.rows.length > 1 ? p.rows.filter((_, j) => j !== i) : p.rows }))
    const appendFormula = token => {
      const i = focusedFormula.current
      if (i == null) return
      setEditing(p => ({ ...p, rows: p.rows.map((r, j) => j === i ? { ...r, formula: (r.formula || '') + token } : r) }))
    }
    const labelStyle = ro ? { background: '#f1efe8' } : {}
    return (
      <div className="pb-24">
        <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-base font-medium">{e.id ? 'Redigera bokföringsmall' : 'Ny bokföringsmall'}</span>
          <button className="btn" onClick={() => setEditing(null)}><i className="ti ti-arrow-left" /> Tillbaka</button>
        </div>

        <div className="p-7">
          <h2 className="text-sm font-semibold mb-4 pb-2 border-b max-w-3xl" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Grunduppgifter</h2>
          <fieldset disabled={ro} className="max-w-3xl space-y-3">
            <label className="flex items-center gap-2.5 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={e.is_active} onChange={ev => set('is_active', ev.target.checked)} /> Aktiv</label>
            <Field label="Namn"><input className="input" value={e.name} style={labelStyle} onChange={ev => set('name', ev.target.value)} /></Field>
            <Field label="Namn på engelska"><input className="input" value={e.name_en || ''} style={labelStyle} onChange={ev => set('name_en', ev.target.value)} /></Field>
            <Field label="Användningsområde">
              <select className="input" value={e.usage_area} style={labelStyle} onChange={ev => set('usage_area', ev.target.value)}>
                {USAGE_AREAS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Verifikationsserie">
              <select className="input" value={e.ver_series || ''} style={labelStyle} onChange={ev => set('ver_series', ev.target.value)}>
                <option value="">(ingen)</option>
                {SERIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Beskrivning" top><textarea className="input min-h-[90px]" rows={3} value={e.description || ''} style={labelStyle} onChange={ev => set('description', ev.target.value)} /></Field>
          </fieldset>

          {e.locked && <div className="mt-4"><LockedStandardPostBadge account={{ is_locked: true }} /></div>}

          <hr className="my-6" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />

          {/* Operator-/kontoknappar */}
          <div className="flex justify-end gap-1.5 mb-2">
            <button type="button" className="btn px-3 py-1 text-xs" disabled={ro} onClick={() => appendFormula('Konto')}>Konto</button>
            {OPERATORS.map(op => (
              <button key={op} type="button" className="btn w-8 px-0 py-1 justify-center text-xs" disabled={ro} onClick={() => appendFormula(op)}>{op}</button>
            ))}
          </div>

          {/* Konteringsrader */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 980 }}>
              <thead>
                <tr className="text-left text-gray-500 text-xs">
                  <th className="font-medium pb-2 pr-3">Konto</th>
                  <th className="font-medium pb-2 pr-3">Projekt</th>
                  <th className="font-medium pb-2 pr-3">Kostnadsställe</th>
                  <th className="font-medium pb-2 px-2 text-center">Debet</th>
                  <th className="font-medium pb-2 px-2 text-center">Kredit</th>
                  <th className="font-medium pb-2 px-2 text-center">D/K</th>
                  <th className="font-medium pb-2 pl-3">Formel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {e.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="pr-3 py-1">
                      <select className="input" disabled={ro} value={r.account_nr} style={labelStyle} onChange={ev => setRow(i, 'account_nr', ev.target.value)}>
                        <option value=""></option>
                        {accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} - {a.name}</option>)}
                      </select>
                    </td>
                    <td className="pr-3 py-1"><select className="input" disabled value={r.project}><option value=""></option></select></td>
                    <td className="pr-3 py-1"><select className="input" disabled value={r.cost_center}><option value=""></option></select></td>
                    {['debet', 'kredit', 'dk'].map(opt => (
                      <td key={opt} className="px-2 py-1 text-center">
                        <input type="radio" name={`dk-${i}`} disabled={ro} checked={r.dk === opt} onChange={() => setRow(i, 'dk', opt)} className="w-4 h-4 accent-blue-600" />
                      </td>
                    ))}
                    <td className="pl-3 py-1">
                      <input className="input" disabled={ro} value={r.formula} style={labelStyle}
                        onFocus={() => { focusedFormula.current = i }}
                        onChange={ev => setRow(i, 'formula', ev.target.value)} />
                    </td>
                    <td className="py-1 pl-2 whitespace-nowrap">
                      <button type="button" className="text-gray-400 hover:text-gray-700 text-lg disabled:opacity-30" disabled={ro} title="Lägg till rad" onClick={() => addRow(i)}><i className="ti ti-circle-plus" /></button>
                      <button type="button" className="text-gray-400 hover:text-red-600 text-lg ml-1 disabled:opacity-30" disabled={ro} title="Ta bort rad" onClick={() => delRow(i)}><i className="ti ti-circle-minus" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="fixed bottom-0 left-[230px] right-0 bg-white border-t px-7 py-3 flex items-center justify-center gap-2.5 z-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          {!ro && <button className="btn btn-primary px-8" onClick={save} disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>}
          <button className="btn px-6" onClick={() => openCopy(e)}>Kopiera</button>
          <button className="btn px-6" onClick={() => setEditing(null)}>Avbryt</button>
        </div>
      </div>
    )
  }

  // ---------- Lista ----------
  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Bokföringsmallar</span>
        <button className="text-white text-sm font-medium px-4 py-2 rounded-lg" style={{ background: '#6d28d9' }} onClick={openNew}>Ny bokföringsmall</button>
      </div>
      <div className="p-7">
        <div className="relative max-w-md mb-2">
          <input className="input pl-8" placeholder="Sök" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 mb-5"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Visa även inaktiva poster</label>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-4 py-2.5 border-b w-56" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Användningsområde</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Typ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="3" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="3" className="text-center py-12 text-gray-400">Inga bokföringsmallar.</td></tr>
              ) : visible.map(t => (
                <>
                  <tr key={t.id} className={`hover:bg-gray-50 cursor-pointer ${!t.is_active ? 'opacity-50' : ''}`} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.name}{!t.is_active && <span className="text-xs text-gray-400"> · inaktiv</span>}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.usage_area}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.is_standard ? 'Standard' : 'Egen'}</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr key={t.id + '-d'} style={{ borderLeft: '3px solid #6d28d9' }}>
                      <td colSpan="3" className="px-4 py-4 border-b bg-gray-50/40" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        <div className="flex justify-between gap-4">
                          <div className="flex-1">
                            {t.description && <div className="text-sm font-semibold mb-2">{t.description}</div>}
                            <div className="text-sm font-semibold mb-1 pb-1 border-b inline-block" style={{ borderColor: 'rgba(0,0,0,0.12)' }}>Konto</div>
                            <table className="text-[13px] mt-1">
                              <tbody>
                                {(t.rows || []).map((r, i) => (
                                  <tr key={i}>
                                    <td className="pr-8 py-0.5 text-gray-800">{accLabel(r.account_nr)}</td>
                                    <td className="py-0.5 text-gray-500">{r.dk === 'kredit' ? 'Kredit' : r.dk === 'dk' ? 'D/K' : 'Debet'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0" onClick={ev => ev.stopPropagation()}>
                            <button className="btn px-6" onClick={() => openEdit(t)}>Redigera</button>
                            <button className="btn px-6" onClick={() => openCopy(t)}>Kopiera</button>
                            {!t.is_standard && <button className="btn btn-danger px-6" onClick={() => remove(t)}>Ta bort</button>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-right text-xs text-gray-400 mt-3">{visible.length} av {items.length} poster visas</div>
      </div>
    </div>
  )
}

function Field({ label, top, children }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 items-center" style={top ? { alignItems: 'start' } : undefined}>
      <label className="text-sm text-gray-600" style={top ? { paddingTop: 6 } : undefined}>{label}</label>
      {children}
    </div>
  )
}
