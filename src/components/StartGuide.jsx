import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { momsperiodOptions, momsRedovisas, bokforingsmetodLabel, nextFiscalYear } from '../lib/foretag'
import toast from 'react-hot-toast'

// Startguide som visas första gången ett nytt företag används (companies.onboarded = false).
// Går igenom de viktigaste grundinställningarna och markerar företaget som konfigurerat.
export default function StartGuide() {
  const { company, reloadCompany } = useAuth()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [accountCount, setAccountCount] = useState(null)
  // Räkenskapsår (bild 1): lista + auto-skapa-inställning. Företaget finns redan när guiden
  // körs (trigger seed_new_company skapar första året + BAS-konton).
  const [years, setYears] = useState([])
  const [createdYears, setCreatedYears] = useState(new Set())   // skapade i guiden -> ärver kontoplan
  const [autoSkapa, setAutoSkapa] = useState(company?.settings?.auto_skapa_rakenskapsar !== false)
  const [f, setF] = useState({
    foretagsform: company?.foretagsform || '',
    org_nr: company?.org_nr || '',
    bokforingsmetod: company?.bokforingsmetod || 'faktura',
    momsperiod: company?.momsperiod || 'Kvartalsvis',
    vat_nr: company?.vat_nr || '',
    valuta: company?.valuta || 'SEK',
    bank_gl_account: '1930',
    bankgiro: company?.bankgiro || '',
    plusgiro: company?.plusgiro || '',
    iban: company?.iban || '',
    nasta_fakturanr: company?.nasta_fakturanr || 1,
    fskatt: true,
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  const STEPS = ['Välkommen', 'Bokföringsmetod', 'Moms', 'Räkenskapsår', 'Bankkonto', 'Kontoplan', 'Klart']

  async function checkAccounts() {
    const { count } = await supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('company_id', company.id)
    setAccountCount(count || 0)
  }
  async function loadYears() {
    const { data } = await supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('start_date')
    setYears(data || [])
  }
  // "Skapa nytt" – nästa räkenskapsår (ärver kontoplan/IB från föregående). Blir inte förvalt.
  async function skapaNyttAr() {
    const ny = nextFiscalYear(years)
    if (years.some(y => y.year === ny.year)) return toast('Räkenskapsåret finns redan', { icon: 'ℹ️' })
    const { error } = await supabase.from('fiscal_years').insert({
      company_id: company.id, year: ny.year, start_date: ny.start_date, end_date: ny.end_date, status: 'closed',
    })
    if (error) return toast.error('Kunde inte skapa: ' + error.message)
    setCreatedYears(s => new Set(s).add(ny.year))
    toast.success(`Räkenskapsår ${ny.year} skapat`)
    loadYears()
  }
  // Markera ett år som förvalt (aktivt) – övriga stängs.
  async function setForvald(y) {
    await supabase.from('fiscal_years').update({ status: 'closed' }).eq('company_id', company.id).neq('id', y.id)
    await supabase.from('fiscal_years').update({ status: 'active' }).eq('id', y.id)
    loadYears()
  }
  const kontoplanLabel = y => (createdYears.has(y.year) ? 'Från föregående år' : `BAS ${y.year}`)
  async function loadBas() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('seed_bas_accounts', { p_company: company.id })
      if (error) throw error
      toast.success(`${data?.inserted || 0} BAS-konton laddade`)
      await checkAccounts()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  async function finish(skip = false) {
    setBusy(true)
    try {
      const payload = skip ? { onboarded: true } : {
        onboarded: true,
        foretagsform: f.foretagsform || null, org_nr: f.org_nr || null,
        bokforingsmetod: f.bokforingsmetod, momsperiod: f.momsperiod,
        vat_nr: f.vat_nr || null, valuta: f.valuta || 'SEK',
        bankgiro: f.bankgiro || null, plusgiro: f.plusgiro || null, iban: f.iban || null,
        nasta_fakturanr: Number(f.nasta_fakturanr) || 1,
        settings: { ...(company?.settings || {}), momsregistrerad: momsRedovisas(f.momsperiod), auto_skapa_rakenskapsar: autoSkapa, bank_gl_account: f.bank_gl_account, fskatt: f.fskatt },
      }
      const { error } = await supabase.from('companies').update(payload).eq('id', company.id)
      if (error) throw error
      toast.success(skip ? 'Guiden hoppades över' : 'Företaget är konfigurerat – välkommen!')
      reloadCompany?.()
    } catch (e) { toast.error('Kunde inte spara: ' + e.message); setBusy(false) }
  }

  const next = () => { const n = step + 1; if (n === 3) loadYears(); if (n === 5) checkAccounts(); setStep(n) }
  const back = () => setStep(s => Math.max(0, s - 1))

  const Field = ({ label, children, hint }) => (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-gray-400 mt-1">{hint}</div>}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-surface-3 z-50 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl my-8" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        {/* Stegindikator */}
        <div className="px-6 pt-5 pb-3 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-blue-600' : 'bg-gray-200'}`} />
            ))}
          </div>
          <div className="text-xs text-gray-500">Steg {step + 1} av {STEPS.length} · {STEPS[step]}</div>
        </div>

        <div className="px-6 py-6 min-h-[280px]">
          {step === 0 && (
            <div>
              <i className="ti ti-rocket text-4xl text-blue-600 block mb-3" />
              <h2 className="text-xl font-bold mb-2">Välkommen till {company?.name}!</h2>
              <p className="text-sm text-gray-600 mb-4">Vi ställer in det viktigaste innan du börjar bokföra. Det tar någon minut och du kan ändra allt senare under Inställningar.</p>
              <Field label="Företagsform">
                <select className="input" value={f.foretagsform} onChange={e => set('foretagsform', e.target.value)}>
                  <option value="">Välj…</option>{['Aktiebolag', 'Enskild näringsidkare', 'Handelsbolag/Kommanditbolag', 'Ekonomisk förening', 'Ideell förening', 'Bostadsrättsförening', 'Övrigt'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Organisationsnummer">
                <input className="input" value={f.org_nr} onChange={e => set('org_nr', e.target.value)} placeholder="556677-8899" />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-lg font-bold mb-1">Bokföringsmetod</h2>
              <p className="text-sm text-gray-500 mb-4">Hur ska affärshändelser bokföras?</p>
              {[{ key: 'faktura', titel: 'Faktureringsmetoden' },
                { key: 'kontant', titel: 'Kontantmetoden (bokslutsmetoden)' }].map(o => (
                <button key={o.key} onClick={() => set('bokforingsmetod', o.key)}
                  className={`w-full text-left rounded-lg p-3 border-2 mb-2 transition-colors ${f.bokforingsmetod === o.key ? 'border-blue-600 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-center gap-2"><i className={`ti ${f.bokforingsmetod === o.key ? 'ti-circle-check-filled text-blue-600' : 'ti-circle text-gray-300'}`} /><span className="text-sm font-medium">{o.titel}</span></div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-bold mb-1">Moms</h2>
              <p className="text-sm text-gray-500 mb-4">Hur ofta redovisas momsen till Skatteverket?</p>
              <Field label="Momsperiod" hint="Välj &quot;Redovisar ej moms&quot; om företaget inte är momsregistrerat.">
                <select className="input" value={f.momsperiod} onChange={e => set('momsperiod', e.target.value)}>
                  {momsperiodOptions(f.momsperiod).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              {momsRedovisas(f.momsperiod) && (
                <Field label="Momsregistreringsnummer (VAT)">
                  <input className="input" value={f.vat_nr} onChange={e => set('vat_nr', e.target.value)} placeholder="SE556677889901" />
                </Field>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold">Räkenskapsår</h2>
                <button className="btn font-medium text-sm" style={{ background: '#f5c518', color: '#1a1a1a', borderColor: '#f5c518' }} onClick={skapaNyttAr}>Skapa nytt</button>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-medium text-gray-500">Skapa räkenskapsår automatiskt</span>
                <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.15)' }}>
                  <button type="button" className={`px-4 py-1 text-sm ${autoSkapa ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`} onClick={() => setAutoSkapa(true)}>JA</button>
                  <button type="button" className={`px-4 py-1 text-sm ${!autoSkapa ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`} onClick={() => setAutoSkapa(false)}>NEJ</button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Nästa räkenskapsår skapas automatiskt cirka en månad innan senaste årets slutdatum. Det nya året får samma kontoplan som föregående år. Ingående balanser och alla inställningar som används förs automatiskt över till nästa år.
              </p>
              <div className="rounded-lg overflow-hidden mb-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase">
                      <th className="text-left px-2.5 py-2">From</th><th className="text-left px-2.5 py-2">Tom</th>
                      <th className="text-left px-2.5 py-2">Bokföringsmetod</th><th className="text-left px-2.5 py-2">Kontoplan</th>
                      <th className="text-center px-2.5 py-2 w-16">Förvalt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.length === 0 ? (
                      <tr><td colSpan="5" className="text-center py-6 text-gray-400">Inga räkenskapsår än</td></tr>
                    ) : years.map(y => (
                      <tr key={y.id} className="border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        <td className="px-2.5 py-2 tabular-nums">{y.start_date}</td>
                        <td className="px-2.5 py-2 tabular-nums">{y.end_date}</td>
                        <td className="px-2.5 py-2">{bokforingsmetodLabel(f.bokforingsmetod)}</td>
                        <td className="px-2.5 py-2">{kontoplanLabel(y)}</td>
                        <td className="px-2.5 py-2 text-center">
                          <input type="radio" name="forvalt-ar" checked={y.status === 'active'} onChange={() => setForvald(y)} className="w-4 h-4 cursor-pointer" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="text-lg font-bold mb-1">Bankkonto</h2>
              <p className="text-sm text-gray-500 mb-4">Företagets bankuppgifter och vilket bokföringskonto banken konteras mot.</p>
              <Field label="Bankkonto i bokföringen" hint="Standard är 1930 Företagskonto/affärskonto.">
                <select className="input" value={f.bank_gl_account} onChange={e => set('bank_gl_account', e.target.value)}>
                  {[['1930', '1930 – Företagskonto'], ['1920', '1920 – PlusGiro'], ['1910', '1910 – Kassa'], ['1940', '1940 – Övriga bankkonton']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bankgiro"><input className="input" value={f.bankgiro} onChange={e => set('bankgiro', e.target.value)} /></Field>
                <Field label="Plusgiro"><input className="input" value={f.plusgiro} onChange={e => set('plusgiro', e.target.value)} /></Field>
              </div>
              <Field label="IBAN"><input className="input" value={f.iban} onChange={e => set('iban', e.target.value)} /></Field>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="text-lg font-bold mb-1">Kontoplan</h2>
              <p className="text-sm text-gray-500 mb-4">Företaget behöver en kontoplan. Använd BAS 2026 (standard i Sverige) eller ladda upp en egen senare.</p>
              {accountCount === null ? <div className="text-sm text-gray-400">Kontrollerar…</div> : accountCount > 0 ? (
                <div className="rounded-lg border p-4 bg-green-50 text-sm text-green-800" style={{ borderColor: 'rgba(22,163,74,0.3)' }}>
                  <i className="ti ti-circle-check mr-1" />Kontoplan finns redan ({accountCount} konton). Du kan hantera den under Inställningar → Kontoplan.
                </div>
              ) : (
                <button className="w-full rounded-lg border-2 border-dashed py-6 hover:border-blue-400" style={{ borderColor: 'rgba(0,0,0,0.15)' }} onClick={loadBas} disabled={busy}>
                  <i className="ti ti-download text-3xl text-blue-600 block mb-1" />
                  <div className="text-sm font-medium">{busy ? 'Laddar…' : 'Ladda BAS 2026 (1367 konton)'}</div>
                  <div className="text-xs text-gray-500">Du kan ladda upp en egen kontoplan senare.</div>
                </button>
              )}
            </div>
          )}

          {step === 6 && (
            <div>
              <i className="ti ti-circle-check text-4xl text-green-600 block mb-3" />
              <h2 className="text-lg font-bold mb-1">Nästan klart!</h2>
              <p className="text-sm text-gray-500 mb-4">Några sista detaljer som underlättar starten.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nästa fakturanummer"><input className="input" type="number" value={f.nasta_fakturanr} onChange={e => set('nasta_fakturanr', e.target.value)} /></Field>
              </div>
              <label className="flex items-center gap-2.5 mb-2 text-sm cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={f.fskatt} onChange={e => set('fskatt', e.target.checked)} /> Godkänd för F-skatt
              </label>
              <div className="rounded-lg border p-3 bg-gray-50 text-xs text-gray-600 mt-3" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <b>Tips på nästa steg:</b> lägg in din logotyp och fakturatexter (Inställningar → Övriga uppgifter), bjud in kollegor (Användare &amp; behörighet) och registrera ditt första bankkonto under Kassa- och bankkonton.
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => finish(true)} disabled={busy}>Hoppa över guiden</button>
          <div className="flex gap-2">
            {step > 0 && <button className="btn" onClick={back} disabled={busy}>Tillbaka</button>}
            {step < STEPS.length - 1
              ? <button className="btn btn-primary" onClick={next} disabled={busy}>Nästa</button>
              : <button className="btn btn-green" onClick={() => finish(false)} disabled={busy}>{busy ? 'Sparar…' : 'Slutför'}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
