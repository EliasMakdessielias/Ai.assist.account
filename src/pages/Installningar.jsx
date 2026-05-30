import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const TABS = ['Grunduppgifter', 'Faktureringsuppgifter', 'Bokföringsuppgifter', 'Övriga uppgifter']

export default function Installningar() {
  const { company, reloadCompany } = useAuth()
  const [form, setForm] = useState(null)
  const [tab, setTab] = useState('Grunduppgifter')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    const { data } = await supabase.from('companies').select('*').eq('id', company.id).single()
    setForm(data || company)
  }
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.name?.trim()) return toast.error('Företagsnamn krävs')
    setSaving(true)
    const num = v => (v === '' || v == null ? null : Number(v))
    const payload = {
      name: form.name?.trim(), org_nr: form.org_nr || null, vat_nr: form.vat_nr || null,
      address: form.address || null, postnr: form.postnr || null, postort: form.postort || null, sate: form.sate || null,
      email: form.email || null, phone: form.phone || null, mobil: form.mobil || null, website: form.website || null,
      valuta: form.valuta || 'SEK', bankgiro: form.bankgiro || null, plusgiro: form.plusgiro || null,
      iban: form.iban || null, bic_swift: form.bic_swift || null, swish: form.swish || null,
      payment_terms: num(form.payment_terms), late_interest: num(form.late_interest), nasta_fakturanr: num(form.nasta_fakturanr),
      foretagsform: form.foretagsform || null, momsperiod: form.momsperiod || null, bokforing_last_tom: form.bokforing_last_tom || null,
      bokforingsmetod: form.bokforingsmetod || 'faktura',
      faktura_text: form.faktura_text || null, faktura_epost_text: form.faktura_epost_text || null,
    }
    const { error } = await supabase.from('companies').update(payload).eq('id', company.id)
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Inställningar sparade')
    reloadCompany()
  }

  // Generisk fältrenderare
  const F = ({ k, label, type = 'text', w, opts, step }) => (
    <div className={w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {opts ? (
        <select className="input" value={form[k] ?? ''} onChange={e => set(k, e.target.value)}>
          <option value="">Välj…</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="input" type={type} step={step} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} />
      )}
    </div>
  )
  const Card = ({ title, children, cols = 2 }) => (
    <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      <div className={`grid ${cols === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>{children}</div>
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Företagsinställningar</span>
        <button className="btn btn-primary" onClick={save} disabled={saving || !form}><i className="ti ti-device-floppy" /> {saving ? 'Sparar…' : 'Spara'}</button>
      </div>

      <div className="bg-white border-b flex gap-0 px-7" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px transition-colors ${tab === t ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>{t}</button>
        ))}
      </div>

      <div className="p-7 max-w-3xl">
        {!form ? <div className="text-gray-400 py-12 text-center">Laddar…</div> : (
          <div className="space-y-6">
            {tab === 'Grunduppgifter' && <>
              <Card title="Kontaktuppgifter">
                <F k="name" label="Företagsnamn" w={2} />
                <F k="address" label="Postadress" w={2} />
                <F k="postnr" label="Postnummer" />
                <F k="postort" label="Postort" />
                <F k="sate" label="Säte" />
                <F k="phone" label="Telefon" />
                <F k="mobil" label="Mobil" />
                <F k="email" label="E-postadress" type="email" />
                <F k="website" label="Webbplats" w={2} />
              </Card>
              <Card title="Företagsuppgifter">
                <F k="org_nr" label="Organisationsnummer" />
                <F k="valuta" label="Internvaluta" />
                <F k="vat_nr" label="Momsregistreringsnummer" />
                <F k="bankgiro" label="Bankgiro" />
                <F k="plusgiro" label="Plusgiro" />
                <F k="iban" label="IBAN" />
                <F k="bic_swift" label="BIC/SWIFT" />
                <F k="swish" label="Swish" />
              </Card>
            </>}

            {tab === 'Faktureringsuppgifter' && <>
              <Card title="Försäljningsinställningar">
                <F k="payment_terms" label="Förvalt betalningsvillkor (dagar)" type="number" />
                <F k="late_interest" label="Dröjsmålsränta (%)" type="number" step="0.01" />
              </Card>
              <Card title="Nummerserier">
                <F k="nasta_fakturanr" label="Nästa kundfakturanummer" type="number" />
              </Card>
            </>}

            {tab === 'Bokföringsuppgifter' && <>
              <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <h2 className="text-sm font-semibold mb-1">Bokföringsmetod</h2>
                <p className="text-xs text-gray-500 mb-4">Styr när affärshändelser bokförs.</p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'faktura', titel: 'Faktureringsmetoden', desc: 'Bokför fordran/skuld när fakturan skapas (1510/2440). Moms på fakturadatum.' },
                    { key: 'kontant', titel: 'Kontantmetoden', desc: 'Bokför vid betalning. Obetalda fakturor vid bokslut. Moms vid betalning. (Bokslutsmetoden)' },
                  ].map(o => {
                    const active = (form.bokforingsmetod || 'faktura') === o.key
                    return (
                      <button key={o.key} type="button" onClick={() => set('bokforingsmetod', o.key)}
                        className={`text-left rounded-lg p-4 border-2 transition-colors ${active ? 'border-blue-600 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <div className="flex items-center gap-2 mb-1"><i className={`ti ${active ? 'ti-circle-check-filled text-blue-600' : 'ti-circle text-gray-300'}`} /><span className="text-sm font-medium">{o.titel}</span></div>
                        <div className="text-xs text-gray-500">{o.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <Card title="Bokföringsinställningar">
                <F k="foretagsform" label="Företagsform" opts={['Aktiebolag', 'Enskild näringsidkare', 'Handelsbolag/Kommanditbolag', 'Ekonomisk förening', 'Ideell förening', 'Bostadsrättsförening', 'Övrigt']} />
                <F k="momsperiod" label="Momsperiod" opts={['Varje månad', 'Varje kvartal', 'En gång per år', 'Ej momspliktig']} />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Bokföring låst t.o.m.</label>
                  <input className="input" type="month" value={form.bokforing_last_tom ?? ''} onChange={e => set('bokforing_last_tom', e.target.value)} />
                </div>
              </Card>
            </>}

            {tab === 'Övriga uppgifter' && <>
              <Card title="Standardtexter" cols={1}>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Standardtext på faktura</label>
                  <textarea className="input" rows={3} value={form.faktura_text ?? ''} onChange={e => set('faktura_text', e.target.value)} placeholder="T.ex. Tack för ditt köp!" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Standardtext i e-post vid fakturautskick</label>
                  <textarea className="input" rows={3} value={form.faktura_epost_text ?? ''} onChange={e => set('faktura_epost_text', e.target.value)} placeholder="Hej! Bifogat finner du din faktura…" />
                </div>
              </Card>
            </>}

            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Link to="/installningar/kontoplan" className="btn text-sm"><i className="ti ti-list-numbers" /> Kontoplan</Link>
                <Link to="/installningar/rakenskapsar" className="btn text-sm"><i className="ti ti-calendar" /> Räkenskapsår</Link>
              </div>
              <button className="btn btn-primary px-6 py-2" onClick={save} disabled={saving}><i className="ti ti-device-floppy" /> {saving ? 'Sparar…' : 'Spara ändringar'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
