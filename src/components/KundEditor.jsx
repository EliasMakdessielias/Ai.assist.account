import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { kundPayload } from '../lib/kunder'
import { SUPPORTED_CURRENCIES } from '../lib/currency'

// Kundkort (Fortnox-inspirerat, tätt och svenskt): Grunduppgifter + Faktureringsuppgifter.
// Endast fält BokPilot använder/lagrar. Betalningsvillkor styr förfallodatum i Ny faktura;
// Försäljningskonto används vid bokföring av kundfakturan (tomt = 3001).
export default function KundEditor({ kund, forslagsNr, onClose, onSaved, onDelete }) {
  const { company } = useAuth()
  const ny = !kund?.id
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(() => ({
    kundtyp: 'foretag', is_active: true, payment_terms: 30, valuta: 'SEK',
    ...kund, kund_nr: kund?.kund_nr ?? forslagsNr,
  }))
  const [saving, setSaving] = useState(false)
  const [salesAccounts, setSalesAccounts] = useState([])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Försäljningskonton (3xxx) till datalist för Försäljningskonto-fältet.
  useEffect(() => {
    if (!company) return
    supabase.from('accounts').select('account_nr, name').eq('company_id', company.id)
      .like('account_nr', '3%').eq('is_active', true).order('account_nr')
      .then(({ data }) => setSalesAccounts(data || []))
  }, [company?.id])

  async function spara() {
    if (!String(form.name || '').trim()) return toast.error('Kundnamn krävs')
    const payload = kundPayload(form)
    if (!payload.kund_nr) return toast.error('Ange ett kundnummer')
    setSaving(true)
    let error
    if (kund?.id) ({ error } = await supabase.from('customers').update(payload).eq('id', kund.id).eq('company_id', company.id))
    else ({ error } = await supabase.from('customers').insert({ ...payload, company_id: company.id }))
    setSaving(false)
    if (error) {
      if (/customers_company_kundnr_uniq|duplicate key/i.test(error.message)) return toast.error(`Kundnummer ${payload.kund_nr} används redan – välj ett annat.`)
      return toast.error('Kunde inte spara: ' + error.message)
    }
    toast.success(`Kund ${payload.kund_nr} sparad`)
    onSaved()
  }

  const Field = ({ k, label, type = 'text', w, ph, list }) => (
    <div className={w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input className="input" type={type} value={form[k] ?? ''} list={list} placeholder={ph || ''}
        onChange={e => set(k, e.target.value)} />
    </div>
  )
  const Toggle = ({ k, label, yes = 'Ja', no = 'Nej', truthy = true, falsy = false }) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.15)' }}>
        <button type="button" className={`px-4 py-1.5 text-sm ${form[k] === truthy ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`} onClick={() => set(k, truthy)}>{yes}</button>
        <button type="button" className={`px-4 py-1.5 text-sm ${form[k] === falsy ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`} onClick={() => set(k, falsy)}>{no}</button>
      </div>
    </div>
  )
  const Section = ({ title }) => <div className="col-span-4 text-sm font-semibold text-gray-700 border-b pb-1.5 mt-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{title}</div>

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">KUND {form.kund_nr || ''} – {ny ? 'SKAPA NY' : (kund.name || '').toUpperCase()}</span>
        <button className="btn btn-primary" onClick={onClose}><i className="ti ti-list" /> Visa lista</button>
      </div>

      <div className="bg-white border-b px-7 flex gap-6 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {['Grunduppgifter', 'Faktureringsuppgifter'].map((t, i) => (
          <button key={t} className={`py-2.5 text-sm border-b-2 -mb-px ${tab === i ? 'border-gray-800 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      <div className="p-7 flex-1 overflow-y-auto">
        {tab === 0 ? (
          <div className="grid grid-cols-4 gap-x-5 gap-y-4 max-w-5xl">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Kundnummer *</label>
              <input className="input" type="number" min="1" value={form.kund_nr ?? ''} onChange={e => set('kund_nr', e.target.value)} />
            </div>
            <Toggle k="kundtyp" label="Kundtyp" yes="Företag" no="Privat" truthy="foretag" falsy="privat" />
            <Field k="org_nr" label={form.kundtyp === 'privat' ? 'Personnummer' : 'Org-/Personnummer'} />
            <Toggle k="is_active" label="Aktiv" />

            <Field k="name" label="Namn *" w={2} />
            <Field k="phone" label="Telefon" />
            <Field k="telefon2" label="Telefon 2" />

            <Field k="address" label="Fakturaadress" w={2} />
            <Field k="email" label="E-post" type="email" />
            <Field k="webb" label="Webbadress" />

            <Field k="address2" label="Fakturaadress 2" w={2} />
            <Field k="contact_person" label="Kontaktperson" w={2} />

            <Field k="postnr" label="Postnr" />
            <Field k="ort" label="Ort" />
            <Field k="land" label="Land" w={2} />

            <Section title="Leveransadress" />
            <Field k="lev_namn" label="Namn" w={2} />
            <Field k="lev_adress" label="Leveransadress" w={2} />
            <Field k="lev_adress2" label="Leveransadress 2" w={2} />
            <div className="col-span-2" />
            <Field k="lev_postnr" label="Postnr" />
            <Field k="lev_ort" label="Ort" />
            <Field k="lev_land" label="Land" w={2} />

            <Section title="Fler kunduppgifter" />
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Anteckningar</label>
              <textarea className="input" rows={3} value={form.anteckningar ?? ''} onChange={e => set('anteckningar', e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-x-5 gap-y-4 max-w-5xl">
            <Section title="Betal- och leveransvillkor" />
            <Field k="payment_terms" label="Betalningsvillkor (dagar)" type="number" />
            <Field k="leveransvillkor" label="Leveransvillkor" />
            <Field k="leveranssatt" label="Leveranssätt" w={2} />

            <Section title="Fakturering" />
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Valuta</label>
              <select className="input" value={form.valuta ?? 'SEK'} onChange={e => set('valuta', e.target.value)}>
                {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </div>
            <div className="col-span-3" />

            <Section title="Referenser" />
            <Field k="var_referens" label="Vår referens" ph="Förnamn, Efternamn" w={2} />
            <Field k="er_referens" label="Er referens" w={2} />

            <Section title="Bokföring" />
            <Field k="vat_nummer" label="VAT-nummer" ph="SE556677889901" w={2} />
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Försäljningskonto</label>
              <input className="input" list="kund-salj-konton" value={form.forsaljningskonto ?? ''} placeholder="Tomt = 3001 Försäljning"
                onChange={e => set('forsaljningskonto', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
              <datalist id="kund-salj-konton">
                {salesAccounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
              </datalist>
              <p className="text-xs text-gray-400 mt-1">Används när kundfakturan bokförs (intäktskontot).</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border-t px-7 py-3 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <button className="btn btn-danger" disabled={ny || saving} onClick={() => onDelete(kund)} title={ny ? 'Spara kunden först' : 'Ta bort kunden'}>Radera</button>
        <div className="flex gap-2.5">
          <button className="btn" onClick={onClose} disabled={saving}>Avbryt</button>
          <button className="btn btn-primary px-6" onClick={spara} disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>
        </div>
      </div>
    </div>
  )
}
