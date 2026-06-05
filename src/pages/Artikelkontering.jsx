import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import LockedStandardPostBadge from '../components/kontoplan/LockedStandardPostBadge'
import toast from 'react-hot-toast'

const VAT_RATES = [25, 12, 6, 0]
const CATEGORIES = ['Varor', 'Tjänster']
const ACCOUNT_FIELDS = [
  ['momspliktig', 'Momspliktig'],
  ['momsfri', 'Momsfri'],
  ['momspliktig_eu', 'Momspliktig EU'],
  ['momsfri_eu', 'Momsfri EU'],
  ['export', 'Export utanför EU'],
  ['eu_tredje_part', 'EU tredje part'],
  ['omvand_skatt', 'Omvänd skattskyldighet'],
  ['momspliktig_eu_oss', 'Momspliktig EU, OSS'],
]

const emptyTemplate = () => ({
  id: null, name: '', name_en: '', vat_rate: 25, category: 'Varor', description: '',
  is_active: true, is_standard: false, locked: false, sales_accounts: {},
})

export default function Artikelkontering() {
  const { company } = useAuth()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [editing, setEditing] = useState(null)   // null = lista, annars redigeraren
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    setLoading(true)
    const [{ data: t }, { data: acc }] = await Promise.all([
      supabase.from('article_templates').select('*').eq('company_id', company.id).order('category').order('name'),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).like('account_nr', '3%').order('account_nr'),
    ])
    setItems(t || [])
    setAccounts(acc || [])
    setLoading(false)
  }

  const accName = nr => accounts.find(a => a.account_nr === nr)?.name || ''
  const accLabel = nr => nr ? `${nr} – ${accName(nr)}` : 'Inget konto'

  const visible = useMemo(() => items.filter(t =>
    (showInactive || t.is_active) &&
    (!search || `${t.name} ${t.category} ${t.vat_rate}`.toLowerCase().includes(search.toLowerCase()))
  ), [items, showInactive, search])

  function openNew() { setEditing(emptyTemplate()) }
  function openEdit(t) { setEditing({ ...t, sales_accounts: { ...(t.sales_accounts || {}) } }) }
  function openCopy(t) {
    setEditing({ ...emptyTemplate(), name: `${t.name} (kopia)`, name_en: t.name_en, vat_rate: t.vat_rate, category: t.category, description: t.description, sales_accounts: { ...(t.sales_accounts || {}) } })
  }

  async function save() {
    if (editing.locked) return toast.error('Detta är en låst standardpost och kan inte ändras.')
    if (!editing.name.trim()) return toast.error('Ange ett namn')
    setSaving(true)
    const payload = {
      company_id: company.id, name: editing.name.trim(), name_en: editing.name_en || null,
      vat_rate: Number(editing.vat_rate), category: editing.category, description: editing.description || null,
      is_active: editing.is_active, sales_accounts: editing.sales_accounts || {},
    }
    let error
    if (editing.id) ({ error } = await supabase.from('article_templates').update(payload).eq('id', editing.id))
    else ({ error } = await supabase.from('article_templates').insert(payload))
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Artikelkontering sparad')
    setEditing(null); load()
  }

  async function remove(t) {
    if (t.is_standard) return toast.error('Standardposter kan inte raderas')
    if (!confirm(`Ta bort "${t.name}"?`)) return
    const { error } = await supabase.from('article_templates').delete().eq('id', t.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Borttagen'); load()
  }

  // ---------- Redigerare ----------
  if (editing) {
    const e = editing
    const set = (k, v) => setEditing(p => ({ ...p, [k]: v }))
    const setAcc = (k, v) => setEditing(p => ({ ...p, sales_accounts: { ...p.sales_accounts, [k]: v || null } }))
    const ro = e.locked
    return (
      <div className="pb-24">
        <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-base font-medium">{e.id ? 'Redigera artikelkontering' : 'Ny artikelkontering'}</span>
          <button className="btn" onClick={() => setEditing(null)}><i className="ti ti-arrow-left" /> Tillbaka</button>
        </div>
        <div className="p-7 grid grid-cols-2 gap-x-14 max-w-5xl">
          {/* Grunduppgifter */}
          <div>
            <h2 className="text-sm font-semibold mb-4 pb-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>Grunduppgifter</h2>
            <fieldset disabled={ro} className="space-y-4">
              <label className="flex items-center gap-2.5 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={e.is_active} onChange={ev => set('is_active', ev.target.checked)} /> Aktiv</label>
              <div><label className="block text-xs font-medium text-gray-500 mb-1"><span className="text-red-500">*</span> Namn</label>
                <input className="input" value={e.name} style={ro ? { background: '#f1efe8' } : {}} onChange={ev => set('name', ev.target.value)} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Namn på engelska</label>
                <input className="input" value={e.name_en || ''} style={ro ? { background: '#f1efe8' } : {}} onChange={ev => set('name_en', ev.target.value)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-gray-500 mb-1"><span className="text-red-500">*</span> Moms</label>
                  <select className="input" value={e.vat_rate} style={ro ? { background: '#f1efe8' } : {}} onChange={ev => set('vat_rate', ev.target.value)}>
                    {VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1"><span className="text-red-500">*</span> Typ</label>
                  <select className="input" value={e.category} style={ro ? { background: '#f1efe8' } : {}} onChange={ev => set('category', ev.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select></div>
              </div>
            </fieldset>
            {e.locked && <div className="mt-4"><LockedStandardPostBadge account={{ is_locked: true }} /></div>}
            {e.description && <p className="text-sm font-semibold mt-4">{e.description}</p>}
          </div>

          {/* Försäljningskonton */}
          <div>
            <h2 className="text-sm font-semibold mb-4 pb-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>Försäljningskonton</h2>
            <fieldset disabled={ro} className="space-y-3">
              {ACCOUNT_FIELDS.map(([k, label]) => (
                <div key={k} className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
                  <span className="text-sm text-gray-600">{label}</span>
                  <select className="input" value={e.sales_accounts?.[k] || ''} style={ro ? { background: '#f1efe8' } : {}} onChange={ev => setAcc(k, ev.target.value)}>
                    <option value="">Inget konto</option>
                    {accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
                  </select>
                </div>
              ))}
            </fieldset>
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
        <span className="text-base font-medium">Artikelkonteringar</span>
        <button className="text-white text-sm font-medium px-4 py-2 rounded-lg" style={{ background: '#6d28d9' }} onClick={openNew}>Ny artikelkontering</button>
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
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kategori</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Moms</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="3" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="3" className="text-center py-12 text-gray-400">Inga artikelkonteringar.</td></tr>
              ) : visible.map(t => (
                <>
                  <tr key={t.id} className={`hover:bg-gray-50 cursor-pointer ${!t.is_active ? 'opacity-50' : ''}`} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.name}{!t.is_active && <span className="text-xs text-gray-400"> · inaktiv</span>}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.category}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.vat_rate} %</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr key={t.id + '-d'} style={{ borderLeft: '3px solid #6d28d9' }}>
                      <td colSpan="3" className="px-4 py-4 border-b bg-gray-50/40" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        <div className="flex justify-between gap-4">
                          <div className="flex-1">
                            {t.description && <div className="text-sm font-semibold mb-3">{t.description}</div>}
                            <table className="text-[13px]">
                              <tbody>
                                {ACCOUNT_FIELDS.map(([k, label]) => (
                                  <tr key={k}>
                                    <td className="pr-8 py-0.5 text-gray-600 align-top">{label}</td>
                                    <td className="py-0.5 text-gray-800">{t.sales_accounts?.[k] ? accLabel(t.sales_accounts[k]) : ''}</td>
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
        <div className="text-right text-xs text-gray-400 mt-3">{visible.length} poster visas</div>
      </div>
    </div>
  )
}
