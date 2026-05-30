import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function KontoDetalj() {
  const { nr } = useParams()
  const { company } = useAuth()
  const navigate = useNavigate()
  const isNew = nr === 'ny'
  const [account, setAccount] = useState({ account_nr: '', name: '', vat_code: '', sru: '', is_active: true, opening_balance: 0 })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isNew && company) loadAccount()
  }, [nr, company])

  async function loadAccount() {
    const { data } = await supabase
      .from('accounts')
      .select('*')
      .eq('company_id', company.id)
      .eq('account_nr', nr)
      .single()
    if (data) setAccount(data)
  }

  async function save() {
    if (!account.account_nr || !/^\d+$/.test(account.account_nr)) return toast.error('Kontonumret måste vara numeriskt')
    if (!account.name) return toast.error('Ange en benämning')
    setSaving(true)
    try {
      if (isNew) {
        const { error } = await supabase.from('accounts').insert({ ...account, company_id: company.id })
        if (error) throw error
        toast.success('Konto ' + account.account_nr + ' skapat!')
      } else {
        const { error } = await supabase.from('accounts').update(account).eq('id', account.id)
        if (error) throw error
        toast.success('Konto sparat!')
      }
      navigate('/installningar/kontoplan')
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }

  async function remove() {
    if (!confirm('Radera konto ' + account.account_nr + '?')) return
    await supabase.from('accounts').delete().eq('id', account.id)
    toast.success('Konto raderat')
    navigate('/installningar/kontoplan')
  }

  return (
    <div>
      <div className="bg-white border-b px-7 h-14 flex items-center justify-between sticky top-0 z-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">
          {isNew ? 'KONTO – SKAPA NYTT' : `KONTO ${account.account_nr} – ${account.name?.toUpperCase()}`}
        </span>
        <div className="flex items-center gap-2">
          {!isNew && <>
            <button className="btn text-xs py-1 px-2"><i className="ti ti-chevrons-left" /></button>
            <button className="btn text-xs py-1 px-2"><i className="ti ti-chevron-left" /></button>
            <button className="btn text-xs py-1 px-2"><i className="ti ti-chevron-right" /></button>
            <button className="btn text-xs py-1 px-2"><i className="ti ti-chevrons-right" /></button>
          </>}
          <button className="btn btn-primary" onClick={() => navigate('/installningar/kontoplan')}><i className="ti ti-list" /> Visa lista</button>
        </div>
      </div>

      <div className="p-7 max-w-4xl">
        <div className="grid grid-cols-[140px_1fr_220px_180px] gap-4 mb-6 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Kontonummer</label>
            <input className="input" value={account.account_nr}
              onChange={e => setAccount(a => ({ ...a, account_nr: e.target.value }))}
              readOnly={!isNew} style={!isNew ? { background: '#f1efe8' } : {}} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Benämning</label>
            <input className="input" value={account.name} onChange={e => setAccount(a => ({ ...a, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ingående balans</label>
            <input className="input text-right" type="number" value={account.opening_balance}
              onChange={e => setAccount(a => ({ ...a, opening_balance: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Aktivt</label>
            <div className="flex">
              <button onClick={() => setAccount(a => ({ ...a, is_active: true }))}
                className={`px-4 py-2 text-sm border rounded-l-lg ${account.is_active ? 'bg-gray-100 font-medium' : 'text-gray-400'}`}
                style={{ borderColor: 'rgba(0,0,0,0.18)' }}>Ja</button>
              <button onClick={() => setAccount(a => ({ ...a, is_active: false }))}
                className={`px-4 py-2 text-sm border-t border-b border-r rounded-r-lg ${!account.is_active ? 'bg-gray-100 font-medium' : 'text-gray-400'}`}
                style={{ borderColor: 'rgba(0,0,0,0.18)' }}>Nej</button>
            </div>
          </div>
        </div>

        <div className="border-t-2 border-blue-700 pt-4 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <i className="ti ti-chevron-down text-blue-700" />
            <span className="font-semibold text-sm text-blue-700">Ytterligare uppgifter</span>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">SRU</label>
              <input className="input" value={account.sru || ''} onChange={e => setAccount(a => ({ ...a, sru: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Momskod (momsruta)</label>
              <input className="input" value={account.vat_code || ''} onChange={e => setAccount(a => ({ ...a, vat_code: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Automatkontering</label>
              <input className="input" value={account.auto_kontering || ''} onChange={e => setAccount(a => ({ ...a, auto_kontering: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Föreslå debet/kredit</label>
              <div className="flex">
                <button onClick={() => setAccount(a => ({ ...a, suggest_debit_credit: 'debet' }))}
                  className={`px-3 py-2 text-sm border rounded-l-lg ${account.suggest_debit_credit === 'debet' ? 'bg-gray-100 font-medium' : 'text-gray-400'}`}
                  style={{ borderColor: 'rgba(0,0,0,0.18)' }}>Debet</button>
                <button onClick={() => setAccount(a => ({ ...a, suggest_debit_credit: 'kredit' }))}
                  className={`px-3 py-2 text-sm border-t border-b border-r rounded-r-lg ${account.suggest_debit_credit === 'kredit' ? 'bg-gray-100 font-medium' : 'text-gray-400'}`}
                  style={{ borderColor: 'rgba(0,0,0,0.18)' }}>Kredit</button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-8">
          {!isNew ? (
            <button className="btn btn-danger" onClick={remove}><i className="ti ti-trash" /> Radera</button>
          ) : <div />}
          <div className="flex gap-3">
            <button className="btn px-5 py-2" onClick={() => navigate('/installningar/kontoplan')}>Avbryt</button>
            <button className="btn btn-green px-5 py-2" onClick={save} disabled={saving}>{saving ? 'Sparar...' : 'Spara'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
