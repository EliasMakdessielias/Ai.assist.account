import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { basClass, basType, CLASS_NAMES } from '../../lib/kontoplan'
import toast from 'react-hot-toast'

// Modal för att skapa nytt eller redigera befintligt konto.
// account = null => skapa nytt. Annars redigera.
export default function AccountEditModal({ open, account, companyId, existingNrs = [], onSaved, onClose }) {
  const isNew = !account?.id
  const locked = !!account?.is_locked
  const [form, setForm] = useState(() => ({
    account_nr: account?.account_nr || '',
    name: account?.name || '',
    vat_code: account?.vat_code || '',
    sru: account?.sru || '',
    is_active: account?.is_active ?? true,
    opening_balance: account?.opening_balance ?? 0,
  }))
  const [busy, setBusy] = useState(false)
  if (!open) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const klass = basClass(form.account_nr)

  async function save() {
    if (locked) return toast.error('Detta konto är låst och kan inte ändras manuellt.')
    if (!/^\d{3,4}$/.test(form.account_nr)) return toast.error('Kontonummer måste vara 3–4 siffror')
    if (!form.name.trim()) return toast.error('Ange en benämning')
    if (isNew && existingNrs.map(String).includes(form.account_nr)) return toast.error(`Konto ${form.account_nr} finns redan`)
    setBusy(true)
    try {
      const payload = {
        account_nr: form.account_nr, name: form.name.trim(), vat_code: form.vat_code || null,
        sru: form.sru || null, is_active: form.is_active, opening_balance: Number(form.opening_balance) || 0,
        account_class: basClass(form.account_nr), account_type: basType(form.account_nr),
      }
      if (isNew) {
        const { error } = await supabase.from('accounts').insert({ ...payload, company_id: companyId })
        if (error) throw error
        toast.success(`Konto ${form.account_nr} skapat`)
      } else {
        const { error } = await supabase.from('accounts').update(payload).eq('id', account.id)
        if (error) throw error
        toast.success('Konto sparat')
      }
      onSaved?.()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose?.()}>
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-base font-medium">{isNew ? 'Nytt konto' : locked ? `Systemkonto ${form.account_nr}` : `Redigera konto ${form.account_nr}`}</span>
          <button className="text-gray-400 hover:text-gray-700" onClick={() => onClose?.()}><i className="ti ti-x" /></button>
        </div>
        {locked && (
          <div className="mx-5 mt-4 rounded-lg border p-3 bg-purple-50 text-xs text-purple-800 flex items-start gap-2" style={{ borderColor: 'rgba(126,34,206,0.3)' }}>
            <i className="ti ti-lock mt-0.5" />
            <span>Det här är ett <b>låst systemkonto</b> (blockerat för manuell bokföring). Det kan inte ändras eller raderas, varken här eller via import.</span>
          </div>
        )}
        <fieldset disabled={locked} className="px-5 py-5 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Kontonummer</label>
            <input className="input" value={form.account_nr} onChange={e => set('account_nr', e.target.value)}
              readOnly={!isNew} style={!isNew ? { background: '#f1efe8' } : {}} />
            {klass && <div className="text-[11px] text-gray-400 mt-1">Klass {klass} – {CLASS_NAMES[klass]}</div>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Aktivt</label>
            <div className="flex">
              <button onClick={() => set('is_active', true)} className={`px-4 py-2 text-sm border rounded-l-lg ${form.is_active ? 'bg-gray-100 font-medium' : 'text-gray-400'}`} style={{ borderColor: 'rgba(0,0,0,0.18)' }}>Ja</button>
              <button onClick={() => set('is_active', false)} className={`px-4 py-2 text-sm border-t border-b border-r rounded-r-lg ${!form.is_active ? 'bg-gray-100 font-medium' : 'text-gray-400'}`} style={{ borderColor: 'rgba(0,0,0,0.18)' }}>Nej</button>
            </div>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Benämning</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Momskod</label>
            <input className="input" value={form.vat_code} onChange={e => set('vat_code', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">SRU</label>
            <input className="input" value={form.sru} onChange={e => set('sru', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ingående balans</label>
            <input className="input text-right" type="number" value={form.opening_balance} onChange={e => set('opening_balance', e.target.value)} />
          </div>
        </fieldset>
        <div className="px-5 py-4 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <button className="btn" onClick={() => onClose?.()} disabled={busy}>{locked ? 'Stäng' : 'Avbryt'}</button>
          {!locked && <button className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Sparar…' : 'Spara'}</button>}
        </div>
      </div>
    </div>
  )
}
