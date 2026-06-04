import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SUPPORTED_CURRENCIES } from '../lib/currency'
import toast from 'react-hot-toast'

const MOMSTYPER = ['25%', '12%', '6%', '0%', 'Unionsinternt förvärv', 'Omvänd skattskyldighet']
const BETALVILLKOR = ['0 dagar', '5 dagar', '7 dagar', '10 dagar', '14 dagar', '15 dagar', '20 dagar', '30 dagar', 'Autogiro', 'Kontant', 'Postförskott']

const empty = {
  leverantorsnr: '', org_nr: '', aktiv: true, name: '', phone: '', email: '',
  faktura_adress: '', telefon2: '', webb: '', faktura_adress2: '', fax: '',
  postnr: '', ort: '', land: '', landskod: '',
  bankgiro: '', plusgiro: '', bic: '', iban: '',
  kontotyp: 'Bankkonto', bank: '', clearingnr: '', kontonr: '',
  avgiftskod: 'Avsändaren betalar', betalkod: '', inaktivera_betalfil: false,
  default_motkonto: '', konteringsmall: '', artikelregistrering: false, oresavrundning: true, momstyp: '',
  vat_nummer: '', valuta: 'SEK', betalningsvillkor: '', kundnummer: '', cfar: '', sni: '', referens: '', anteckning: '',
}

export default function LeverantorEditor({ company, prefill = {}, onSaved, onCancel }) {
  const [tab, setTab] = useState('grund')
  const [f, setF] = useState({ ...empty, ...prefill })
  const [moreAddr, setMoreAddr] = useState(false)
  const [refs, setRefs] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hamtar, setHamtar] = useState(false)
  const [accounts, setAccounts] = useState([])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function hamtaUppgifter() {
    if (!String(f.org_nr || '').replace(/\D/g, '')) return toast.error('Ange organisations-/personnummer först')
    setHamtar(true)
    try {
      const { data, error } = await supabase.functions.invoke('hamta-foretag', { body: { org_nr: f.org_nr } })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      const r = data.result || {}
      setF(p => ({
        ...p,
        name: r.name || p.name,
        org_nr: r.org_nr || p.org_nr,
        faktura_adress: r.faktura_adress || p.faktura_adress,
        postnr: r.postnr || p.postnr,
        ort: r.ort || p.ort,
        land: r.land || p.land,
        phone: r.phone || p.phone,
        webb: r.webb || p.webb,
      }))
      toast.success('Uppgifter hämtade från allabolag.se')
    } catch (e) { toast.error('Kunde inte hämta: ' + (e.message || e)) }
    setHamtar(false)
  }
  const accMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.account_nr, a.name])), [accounts])

  useEffect(() => { genNr(); loadAccounts() }, [])
  async function loadAccounts() {
    const { data } = await supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).eq('is_active', true).order('account_nr')
    setAccounts(data || [])
  }
  async function genNr() {
    const { data } = await supabase.from('suppliers').select('leverantorsnr').eq('company_id', company.id)
    const max = Math.max(0, ...(data || []).map(s => parseInt(s.leverantorsnr, 10)).filter(n => !isNaN(n)))
    set('leverantorsnr', String(max + 1).padStart(3, '0'))
  }

  async function spara() {
    if (!f.name?.trim()) return toast.error('Leverantörsnamn krävs')
    setSaving(true)
    const payload = { ...f, company_id: company.id, name: f.name.trim() }
    // tomma strängar -> null
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
    const { data, error } = await supabase.from('suppliers').insert(payload).select().single()
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Leverantör skapad')
    onSaved?.(data)
  }

  // Fält-helper
  const F = ({ label, k, cls = '', type = 'text', req, placeholder }) => (
    <div className={cls}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{req ? ' *' : ''}</label>
      <input className="input" type={type} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={placeholder} />
    </div>
  )
  const Toggle = ({ label, k, opts }) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.15)' }}>
        {opts.map(([val, lbl]) => (
          <button key={String(val)} type="button" onClick={() => set(k, val)}
            className={`px-3.5 py-1.5 text-sm ${f[k] === val ? 'bg-green-600 text-white' : 'bg-white text-gray-500'}`}>{lbl}</button>
        ))}
      </div>
    </div>
  )
  const Section = ({ title }) => <div className="text-sm font-semibold mt-6 mb-3">{title}</div>

  return (
    <div className="fixed inset-0 bg-white z-[60] overflow-y-auto">
      {/* Topprad */}
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">LEVERANTÖR {f.leverantorsnr} – SKAPA NY</span>
        <div className="flex items-center gap-2.5">
          <button className="btn font-medium" style={{ background: '#f5c518', color: '#1a1a1a', borderColor: '#f5c518' }} onClick={onCancel}><i className="ti ti-list" /> Visa lista</button>
        </div>
      </div>

      {/* Verktygsrad */}
      <div className="bg-white border-b px-7 py-2.5 flex items-center justify-end gap-6 text-[13px] text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => setF({ ...empty, leverantorsnr: f.leverantorsnr })}><i className="ti ti-refresh" /> Återställ fält</button>
        <span className="flex items-center gap-1.5 text-gray-300"><i className="ti ti-arrows-exchange" /> E-faktura</span>
        <span className="flex items-center gap-1.5 text-gray-300"><i className="ti ti-search" /> Kreditupplysning</span>
        <button className="flex items-center gap-1.5 hover:text-gray-800 disabled:text-gray-300" onClick={hamtaUppgifter} disabled={hamtar}><i className="ti ti-download" /> {hamtar ? 'Hämtar…' : 'Hämta leverantörsuppgifter'}</button>
      </div>

      {/* Flikar */}
      <div className="bg-white border-b px-7 flex gap-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {[['grund', 'Grunduppgifter'], ['bokf', 'Bokföringsuppgifter']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px ${tab === k ? 'text-gray-900 font-medium border-green-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>{l}</button>
        ))}
      </div>

      <div className="p-7 pb-28 max-w-[1400px]">
        {tab === 'grund' ? (
          <>
            <div className="grid grid-cols-3 gap-5">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Leverantörsnummer *</label>
                <div className="relative">
                  <input className="input pr-9" value={f.leverantorsnr} onChange={e => set('leverantorsnr', e.target.value)} />
                  <button type="button" title="Generera nytt" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" onClick={genNr}><i className="ti ti-refresh" /></button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Org-/Personnummer</label>
                <div className="flex gap-2">
                  <input className="input" value={f.org_nr ?? ''} onChange={e => set('org_nr', e.target.value)} placeholder="556000-0000" />
                  <button className="btn whitespace-nowrap" onClick={hamtaUppgifter} disabled={hamtar} title="Hämta uppgifter från allabolag.se"><i className="ti ti-download" /> {hamtar ? '…' : 'Hämta'}</button>
                </div>
              </div>
              <Toggle label="Aktiv" k="aktiv" opts={[[true, 'Ja'], [false, 'Nej']]} />

              {F({ label: 'Leverantörsnamn', k: 'name', req: true })}
              {F({ label: 'Telefon', k: 'phone' })}
              {F({ label: 'E-post', k: 'email' })}

              {F({ label: 'Fakturaadress', k: 'faktura_adress' })}
              {F({ label: 'Telefon 2', k: 'telefon2' })}
              {F({ label: 'Webbadress', k: 'webb' })}

              {F({ label: 'Fakturaadress 2', k: 'faktura_adress2' })}
              {F({ label: 'Fax', k: 'fax' })}
              <div />

              <div className="grid grid-cols-2 gap-3">
                {F({ label: 'Postnr', k: 'postnr' })}
                {F({ label: 'Ort', k: 'ort' })}
              </div>
              <div />
              <div />

              <div className="grid grid-cols-2 gap-3">
                {F({ label: 'Land', k: 'land' })}
                {F({ label: 'Landskod', k: 'landskod' })}
              </div>
            </div>

            <Section title="Betalinformation" />
            <div className="grid grid-cols-4 gap-5">
              {F({ label: 'Bankgiro', k: 'bankgiro' })}
              {F({ label: 'Plusgiro', k: 'plusgiro' })}
              {F({ label: 'BIC', k: 'bic' })}
              {F({ label: 'IBAN', k: 'iban' })}
              <Toggle label="Typ av konto" k="kontotyp" opts={[['Bankkonto', 'Bankkonto'], ['Personkonto', 'Personkonto']]} />
              {F({ label: 'Bank', k: 'bank' })}
              {F({ label: 'Clearingnr', k: 'clearingnr' })}
              {F({ label: 'Kontonr', k: 'kontonr' })}
              <Toggle label="Avgiftskod" k="avgiftskod" opts={[['Avsändaren betalar', 'Avsändaren'], ['Delad kostnad', 'Delad'], ['Mottagaren betalar', 'Mottagaren']]} />
              {F({ label: 'Betalkod', k: 'betalkod' })}
              <Toggle label="Inaktivera betalfil" k="inaktivera_betalfil" opts={[[true, 'Ja'], [false, 'Nej']]} />
            </div>

            <button className="flex items-center gap-2 text-sm font-medium text-gray-700 mt-6 py-2 border-b w-full" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => setMoreAddr(o => !o)}>
              <i className={`ti ti-chevron-${moreAddr ? 'down' : 'right'} text-green-700`} /> Fler adressuppgifter
            </button>
            {moreAddr && (
              <div className="grid grid-cols-3 gap-5 py-3">
                {F({ label: 'Fakturaadress 2', k: 'faktura_adress2' })}
                {F({ label: 'Landskod', k: 'landskod' })}
                <div />
              </div>
            )}
            <button className="flex items-center gap-2 text-sm font-medium text-gray-700 py-2 border-b w-full" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => setRefs(o => !o)}>
              <i className={`ti ti-chevron-${refs ? 'down' : 'right'} text-green-700`} /> Referenser och anteckningar
            </button>
            {refs && (
              <div className="grid grid-cols-3 gap-5 py-3">
                {F({ label: 'Vår referens', k: 'referens' })}
                <div className="col-span-2"><label className="block text-xs font-medium text-gray-500 mb-1">Anteckning</label><textarea className="input" rows={2} value={f.anteckning || ''} onChange={e => set('anteckning', e.target.value)} /></div>
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-3 gap-x-12 gap-y-1">
            <div>
              <datalist id="lev-motkonton">
                {accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
              </datalist>
              <div className="text-sm font-semibold mb-3">Bokföring</div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fördefinierat motkonto</label>
                <input className="input" list="lev-motkonton" value={f.default_motkonto || ''} placeholder="Konto, Benämning"
                  onChange={e => set('default_motkonto', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
                {accMap[f.default_motkonto] && <div className="text-xs text-gray-500 mt-1">{f.default_motkonto} – {accMap[f.default_motkonto]}</div>}
              </div>
              <div className="mt-4">{F({ label: 'Konteringsmall', k: 'konteringsmall', placeholder: 'Kod, Benämning' })}</div>
              <div className="mt-4"><Toggle label="Artikelregistrering (e-faktura)" k="artikelregistrering" opts={[[true, 'PÅ'], [false, 'AV']]} /></div>
              <div className="mt-4"><Toggle label="Öresavrundning (e-faktura)" k="oresavrundning" opts={[[true, 'PÅ'], [false, 'AV']]} /></div>
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">Momstyp</label>
                <select className="input" value={f.momstyp || ''} onChange={e => set('momstyp', e.target.value)}>
                  <option value=""></option>
                  {MOMSTYPER.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold mb-3">&nbsp;</div>
              {F({ label: 'VAT-nummer', k: 'vat_nummer' })}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Valuta</label>
                  <select className="input" value={f.valuta} onChange={e => set('valuta', e.target.value)}>{SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Betalningsvillkor</label>
                  <select className="input" value={f.betalningsvillkor || ''} onChange={e => set('betalningsvillkor', e.target.value)}>
                    <option value=""></option>
                    {BETALVILLKOR.map(b => <option key={b} value={b}>{b}</option>)}
                  </select></div>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold mb-3">Övrig information</div>
              {F({ label: 'Vårt kundnummer', k: 'kundnummer' })}
              <div className="grid grid-cols-2 gap-3 mt-4">
                {F({ label: 'Arbetsställe (CFAR)', k: 'cfar' })}
                {F({ label: 'Branschkod (SNI)', k: 'sni' })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Knapprad */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-7 py-3 flex items-center justify-end gap-2.5 z-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <button className="btn" onClick={onCancel} disabled={saving}>Avbryt</button>
        <button className="btn btn-green px-6" onClick={spara} disabled={saving}>{saving ? 'Sparar…' : 'Spara'}</button>
      </div>
    </div>
  )
}
