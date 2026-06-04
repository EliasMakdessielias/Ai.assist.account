import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { ensureStandardBankAccounts, sortBankAccounts } from '../lib/standardBankAccounts'
import { SUPPORTED_CURRENCIES } from '../lib/currency'
import toast from 'react-hot-toast'

// Standard-bokföringskonto per typ
const TYP_DEFAULT = {
  'Företagskonto': '1930',
  'Sparkonto': '1940',
  'Valutakonto': '1930',
  'Kassakonto': '1910',
  'Skattekonto': '1630',
}
const NYA_TYPER = ['Företagskonto', 'Sparkonto', 'Valutakonto']

export default function KassaBankKonton() {
  const { company } = useAuth()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [btx, setBtx] = useState([])
  const [search, setSearch] = useState('')
  const [visaInaktiva, setVisaInaktiva] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newMenu, setNewMenu] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    await ensureStandardBankAccounts(supabase, company.id)
    const [{ data: ba }, { data: acc }, { data: tx }] = await Promise.all([
      supabase.from('bank_accounts').select('*').eq('company_id', company.id).order('namn'),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).or('account_nr.like.19%,account_nr.like.16%').order('account_nr'),
      supabase.from('bank_transactions').select('account_nr, datum, imported_at').eq('company_id', company.id),
    ])
    setItems(sortBankAccounts(ba || []))
    setAccounts(acc || [])
    setBtx(tx || [])
    setLoading(false)
  }

  // Bankkoppling = finns inlästa banktransaktioner på kontot (senaste datum).
  function koppling(account_nr) {
    const rows = btx.filter(t => t.account_nr === account_nr)
    if (!rows.length) return null
    const senaste = rows.reduce((d, t) => { const x = (t.imported_at || t.datum || '').slice(0, 10); return x > d ? x : d }, '')
    return senaste
  }

  function openNew(typ) {
    setNewMenu(false)
    setForm({ namn: typ, typ, valuta: 'SEK', account_nr: TYP_DEFAULT[typ] || '', bankgiro: '', iban: '', bankkontonr: '', aktiv: true, id: null })
  }
  function openEdit(b) { if (b.locked) { toast('Låst standardkonto – kan inte ändras', { icon: '🔒' }); return } setForm({ ...b }) }

  async function save() {
    if (!form.namn?.trim()) return toast.error('Namn krävs')
    if (!form.account_nr?.trim()) return toast.error('Välj bokföringskonto')
    setSaving(true)
    const payload = {
      company_id: company.id, namn: form.namn.trim(), typ: form.typ, valuta: form.valuta || 'SEK',
      account_nr: form.account_nr.trim(), bankgiro: form.bankgiro || null, iban: form.iban || null,
      bankkontonr: form.bankkontonr || null, aktiv: form.aktiv,
    }
    let error
    if (form.id) ({ error } = await supabase.from('bank_accounts').update(payload).eq('id', form.id))
    else ({ error } = await supabase.from('bank_accounts').insert(payload))
    if (!error) {
      // Aktivera bokföringskontot i kontoplanen så det syns i Kassa och bank
      await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).eq('account_nr', payload.account_nr).eq('is_active', false)
    }
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Kontot sparat'); setForm(null); load()
  }

  async function remove(b) {
    if (!confirm(`Ta bort "${b.namn}"? (Bokföringskontot påverkas inte.)`)) return
    await supabase.from('bank_accounts').delete().eq('id', b.id)
    toast.success('Borttaget'); load()
  }

  const accName = nr => accounts.find(a => a.account_nr === nr)?.name || ''
  const visible = items.filter(b => (visaInaktiva || b.aktiv) && (!search || `${b.namn} ${b.typ} ${b.account_nr}`.toLowerCase().includes(search.toLowerCase())))

  return (
    <div onClick={() => setNewMenu(false)}>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kassa- och bankkonton</span>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button className="text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: '#6d28d9' }} onClick={() => setNewMenu(o => !o)}>
            Nytt bankkonto <i className="ti ti-chevron-down" />
          </button>
          {newMenu && (
            <div className="absolute right-0 mt-1 bg-white rounded-lg shadow-xl z-30 w-48 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
              {NYA_TYPER.map(t => <button key={t} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => openNew(t)}>{t}</button>)}
            </div>
          )}
        </div>
      </div>

      <div className="p-7">
        <div className="relative max-w-sm mb-2">
          <input className="input pl-8" placeholder="Sök" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 mb-5"><input type="checkbox" checked={visaInaktiva} onChange={e => setVisaInaktiva(e.target.checked)} /> Visa även inaktiva poster</label>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Typ</th>
                <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Valuta</th>
                <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokföringskonto</th>
                <th className="text-left px-4 py-2.5 border-b w-52" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bankkoppling</th>
                <th className="px-4 py-2.5 border-b w-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400"><i className="ti ti-building-bank text-3xl block mb-2 opacity-30" />Inga kassa-/bankkonton. Klicka "Nytt bankkonto".</td></tr>
              ) : visible.map(b => {
                const k = koppling(b.account_nr)
                return (
                  <tr key={b.id} className={`hover:bg-gray-50 ${b.locked ? '' : 'cursor-pointer'} ${!b.aktiv ? 'opacity-50' : ''}`} onClick={() => openEdit(b)}>
                    <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      {b.namn}{!b.aktiv && <span className="text-xs text-gray-400"> · inaktiv</span>}
                      {b.locked
                        ? <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 align-middle" title="Låst standardkonto – kan inte ändras eller raderas."><i className="ti ti-lock text-[10px]" /> Låst</span>
                        : b.is_standard && <span className="ml-2 inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 align-middle" title="Standardkonto">Standard</span>}
                    </td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.typ}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.valuta}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.account_nr}{accName(b.account_nr) ? ` – ${accName(b.account_nr)}` : ''}</td>
                    <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{k ? <span className="text-green-700">Aktivt ({k})</span> : <span className="text-gray-400">Ingen bankkoppling</span>}</td>
                    <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={e => e.stopPropagation()}>
                      {b.is_standard
                        ? <i className="ti ti-lock text-gray-300" title="Standardkonto kan inte tas bort" />
                        : <button className="text-gray-300 hover:text-red-600" title="Ta bort" onClick={() => remove(b)}><i className="ti ti-trash" /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="text-right text-xs text-gray-400 mt-3">{visible.length} av {items.length} poster visas</div>
      </div>

      {/* Skapa/redigera */}
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setForm(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">{form.id ? 'Redigera konto' : `Nytt ${form.typ?.toLowerCase()}`}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setForm(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-500 mb-1">Namn *</label><input className="input" value={form.namn} onChange={e => setForm(f => ({ ...f, namn: e.target.value }))} autoFocus /></div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Typ</label>
                <select className="input" value={form.typ} disabled={form.is_standard} style={form.is_standard ? { background: '#f1efe8' } : {}}
                  onChange={e => setForm(f => ({ ...f, typ: e.target.value, account_nr: f.account_nr || TYP_DEFAULT[e.target.value] || '' }))}>
                  {Object.keys(TYP_DEFAULT).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Valuta</label>
                <select className="input" value={form.valuta} onChange={e => setForm(f => ({ ...f, valuta: e.target.value }))}>{SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Bokföringskonto *</label>
                <input className="input" list="kbk-konton" value={form.account_nr} readOnly={form.is_standard}
                  style={form.is_standard ? { background: '#f1efe8' } : {}}
                  onChange={e => setForm(f => ({ ...f, account_nr: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) }))} placeholder="t.ex. 1930" />
                <datalist id="kbk-konton">{accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}</datalist>
                {accName(form.account_nr) && <div className="text-xs text-gray-500 mt-1">{form.account_nr} – {accName(form.account_nr)}{form.is_standard ? ' · standardkonto (fast)' : ''}</div>}
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Bankgiro</label><input className="input" value={form.bankgiro ?? ''} onChange={e => setForm(f => ({ ...f, bankgiro: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label><input className="input" value={form.iban ?? ''} onChange={e => setForm(f => ({ ...f, iban: e.target.value }))} /></div>
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-500 mb-1">Bankkontonummer</label><input className="input" value={form.bankkontonr ?? ''} onChange={e => setForm(f => ({ ...f, bankkontonr: e.target.value }))} placeholder="Clearingnummer + kontonummer, t.ex. 8327-9 123 456 789" /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.aktiv} onChange={e => setForm(f => ({ ...f, aktiv: e.target.checked }))} /> Aktivt konto</label>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setForm(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
