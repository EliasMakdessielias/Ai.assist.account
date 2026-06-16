import { useEffect, useState, createContext, useContext } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { CURRENCY_CODES } from '../lib/currency'
import { momsperiodOptions } from '../lib/foretag'
// (Mottagningsadressen läses direkt från inbox_addresses-tabellen)
import toast from 'react-hot-toast'
import WhatsAppSupportButton from '../components/WhatsAppSupportButton'

const TABS = ['Grunduppgifter', 'Faktureringsuppgifter', 'Bokföringsuppgifter', 'Övriga uppgifter', 'Mottagningsadresser']

const BETALV = [['0', 'Kontant'], ['10', '10 dagar netto'], ['14', '14 dagar netto'], ['15', '15 dagar'], ['20', '20 dagar netto'], ['30', '30 dagar netto'], ['60', '60 dagar netto']]

// Verifikationsserier (typ -> standardserie)
const SERIE_TYPER = [
  ['kundfakturor', 'Kundfakturor', 'K - Kundfakturor'],
  ['inbetalningar', 'Inbetalningar', 'I - Inbetalningar'],
  ['leverantorsfakturor', 'Leverantörsfakturor', 'L - Leverantörsfakturor'],
  ['kvitto', 'Inköp mot kvitto', 'D - Kvitto'],
  ['utbetalningar', 'Utbetalningar', 'U - Utbetalningar'],
  ['kassabank', 'Kassa- och bank', 'C - Kassa och bank'],
  ['moms', 'Moms', 'N - Moms'],
  ['korrigeringar', 'Korrigeringar', 'R - Rättelser'],
  ['anlaggning', 'Anläggningstillgångar', 'A - Anläggningstillgångar'],
  ['ovrigt', 'Övrigt', 'M - Manuella verifikationer'],
  ['loner', 'Löner', 'L - Löner'],
  ['arbgiv', 'Arbetsgivardeklarationer', 'G - Arbetsgivardeklarationer'],
  ['bokslut', 'Bokslutsverifikationer', 'B - Bokslutsverifikationer'],
]

// Delad form-kontext så att hjälpkomponenterna kan ligga på MODULNIVÅ
// (stabil identitet). Annars monteras inputs om vid varje tangenttryck och
// tappar fokus efter en bokstav.
const FormCtx = createContext(null)

function Section({ title, children }) {
  return (
    <div className="mb-7">
      <h2 className="text-sm font-semibold mb-3 pb-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{title}</h2>
      {children}
    </div>
  )
}

function Card({ title, children, cols = 2 }) {
  return (
    <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      <div className={`grid ${cols === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>{children}</div>
    </div>
  )
}

function F({ k, label, type = 'text', w, opts, step }) {
  const { form, set } = useContext(FormCtx)
  return (
    <div className={w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {opts ? (
        <select className="input" value={form[k] ?? ''} onChange={e => set(k, e.target.value)}>
          <option value="">Välj…</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : <input className="input" type={type} step={step} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} />}
    </div>
  )
}

function Chk({ k, label }) {
  const { s, setS } = useContext(FormCtx)
  return (
    <label className="flex items-center gap-2.5 py-1.5 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" className="w-4 h-4" checked={!!s[k]} onChange={e => setS(k, e.target.checked)} /> {label}
    </label>
  )
}

function RowSel({ k, label, options, info }) {
  const { s, setS } = useContext(FormCtx)
  return (
    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
      <span className="text-sm text-gray-600 flex items-center gap-1.5">{label}{info && <i className="ti ti-info-circle text-gray-300" title={info} />}</span>
      <select className="input" value={s[k] ?? ''} onChange={e => setS(k, e.target.value)}>
        <option value="">Välj…</option>{options.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Txt({ valKey, label, rows = 4, settingKey, ph }) {
  const { form, set, s, setS } = useContext(FormCtx)
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <textarea className="input" rows={rows} placeholder={ph}
        value={settingKey ? (s[settingKey] ?? '') : (form[valKey] ?? '')}
        onChange={e => settingKey ? setS(settingKey, e.target.value) : set(valKey, e.target.value)} />
    </div>
  )
}

// Företagets EN inbound-mottagningsadress (endast mottagning – ingen inloggning,
// inget lösenord, ingen utgående post). Adressformatet är låst; admin kan endast
// aktivera/inaktivera adressen. Varje bilaga klassificeras automatiskt vid mottagning.
function MottagningsAdresser({ company }) {
  const [row, setRow] = useState(undefined) // undefined=laddar, null=saknas
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    const { data } = await supabase.from('inbox_addresses').select('*').eq('company_id', company.id).eq('inbox_type', 'underlag').maybeSingle()
    setRow(data || null)
  }
  async function toggle() {
    setBusy(true)
    const { error } = await supabase.from('inbox_addresses').update({ is_active: !row.is_active }).eq('id', row.id)
    setBusy(false)
    if (error) return toast.error('Kunde inte uppdatera: ' + error.message)
    toast.success(row.is_active ? 'Adress inaktiverad' : 'Adress aktiverad'); load()
  }
  async function copy(addr) {
    try { await navigator.clipboard.writeText(addr); toast.success('Adress kopierad') }
    catch { toast.error('Kunde inte kopiera') }
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gray-600 mb-5">
        Vidarebefordra eller mejla underlag (kvitton, fakturor, dokument, avtal) till adressen nedan så hamnar de automatiskt i <Link to="/inkorg" className="text-blue-700">Inkorgen</Link> och <strong>klassificeras automatiskt</strong> per bilaga.
        Adressen tar <strong>endast emot</strong> e-post – det går inte att logga in eller skicka från den, och formatet kan inte ändras.
      </p>
      {row === undefined ? <div className="text-gray-400 py-8 text-center">Laddar…</div>
        : row === null ? <div className="text-gray-400 py-8 text-center">Ingen mottagningsadress hittades.</div>
        : (
          <div className="bg-white rounded-xl p-4 flex items-center gap-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <i className="ti ti-mail text-gray-400 text-xl shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Mottagningsadress för underlag</div>
              <div className={`font-mono text-sm truncate ${row.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`} title={row.email_address}>{row.email_address}</div>
            </div>
            {!row.is_active && <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded shrink-0">Inaktiv</span>}
            <button className="btn px-3 shrink-0" title="Kopiera adress" onClick={() => copy(row.email_address)} disabled={!row.is_active}>
              <i className="ti ti-copy" /> Kopiera
            </button>
            <button className="btn px-3 shrink-0" onClick={toggle} disabled={busy}>
              {row.is_active ? 'Inaktivera' : 'Aktivera'}
            </button>
          </div>
        )}
      <div className="mt-6 pt-5 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Snabb supportfråga</div>
        <WhatsAppSupportButton company={company} />
      </div>
    </div>
  )
}

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
  const s = form?.settings || {}
  const setS = (k, v) => setForm(p => ({ ...p, settings: { ...(p.settings || {}), [k]: v } }))
  const setSerie = (k, v) => setForm(p => ({ ...p, settings: { ...(p.settings || {}), serier: { ...((p.settings || {}).serier || {}), [k]: v } } }))

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
      settings: form.settings || {},
    }
    const { error } = await supabase.from('companies').update(payload).eq('id', company.id)
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Inställningar sparade')
    reloadCompany()
  }

  const wide = tab !== 'Grunduppgifter'

  // Enter flyttar fokus till nästa fält (textrutor och kryssrutor undantas).
  function handleEnterNav(e) {
    if (e.key !== 'Enter') return
    const t = e.target
    if (t.tagName === 'TEXTAREA') return            // Enter = radbrytning i textruta
    if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return
    if (t.type === 'checkbox' || t.type === 'radio') return
    e.preventDefault()
    const fields = [...e.currentTarget.querySelectorAll('input, select, textarea')]
      .filter(el => !el.disabled && !el.readOnly && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'hidden' && el.offsetParent !== null)
    const i = fields.indexOf(t)
    if (i > -1 && i + 1 < fields.length) { fields[i + 1].focus(); fields[i + 1].select?.() }
    else t.blur()
  }

  return (
   <FormCtx.Provider value={{ form, set, s, setS, setSerie }}>
    <div className="pb-16" onKeyDown={handleEnterNav}>
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

      <div className={`p-7 ${wide ? '' : 'max-w-3xl'}`}>
        {!form ? <div className="text-gray-400 py-12 text-center">Laddar…</div> : (
          <>
            {tab === 'Grunduppgifter' && (
              <div className="space-y-6">
                <Card title="Kontaktuppgifter">
                  <F k="name" label="Företagsnamn" w={2} />
                  <F k="address" label="Postadress" w={2} />
                  <F k="postnr" label="Postnummer" /><F k="postort" label="Postort" />
                  <F k="sate" label="Säte" /><F k="phone" label="Telefon" />
                  <F k="mobil" label="Mobil" /><F k="email" label="E-postadress" type="email" />
                  <F k="website" label="Webbplats" w={2} />
                </Card>
                <Card title="Företagsuppgifter">
                  <F k="org_nr" label="Organisationsnummer" /><F k="valuta" label="Internvaluta" opts={CURRENCY_CODES} />
                  <F k="vat_nr" label="Momsregistreringsnummer" /><F k="bankgiro" label="Bankgiro" />
                  <F k="plusgiro" label="Plusgiro" /><F k="iban" label="IBAN" />
                  <F k="bic_swift" label="BIC/SWIFT" /><F k="swish" label="Swish" />
                </Card>
              </div>
            )}

            {tab === 'Faktureringsuppgifter' && (
              <div className="grid grid-cols-2 gap-x-14">
                <div>
                  <Section title="Försäljningsinställningar">
                    <Chk k="fskatt" label="Godkänd för F-skatt" />
                    <Chk k="omvand_skatt" label="Fakturerar enligt regler för omvänd skattskyldighet" />
                    <Chk k="mellanmans_eu" label="Mellanmans försäljning varor EU" />
                    <Chk k="oss" label="Tillämpa regler för One Stop Shop (OSS)" />
                    <Chk k="slihop_bilaga" label="Slå ihop faktura och bilaga till ett dokument (gäller inte e-faktura)" />
                    <Chk k="priser_exkl_privat" label="Visa priser exkl. moms för privatpersoner" />
                    <Chk k="visa_sek" label="Visa SEK på försäljningsdokument" />
                    <Chk k="visa_tackningsbidrag" label="Visa täckningsbidrag" />
                    <Chk k="originaldatum_utkast" label="Använd alltid originaldatumet på fakturautkast" />
                    <div className="mt-2">
                      <RowSel k="oresavrundning" label="Öresavrundning" options={['Avrunda till hel krona', 'Ingen avrundning']} />
                      <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                        <span className="text-sm text-gray-600">Förvalt betalningsvillkor</span>
                        <select className="input" value={String(form.payment_terms ?? '')} onChange={e => set('payment_terms', e.target.value)}>
                          <option value="">Välj…</option>{BETALV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                  </Section>
                  <Section title="Husarbete"><Chk k="husarbete" label="Fakturerar husarbete" /></Section>
                  <Section title="Grön teknik"><Chk k="gron_teknik" label="Fakturerar grön teknik" /></Section>
                  <Section title="Betalningspåminnelse">
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                      <span className="text-sm text-gray-600">Påminnelseavgift</span>
                      <div className="flex items-center gap-2"><input className="input text-right" inputMode="decimal" value={s.paminnelseavgift ?? ''} onChange={e => setS('paminnelseavgift', e.target.value)} placeholder="0,00" /><span className="text-sm text-gray-500">SEK</span></div>
                    </div>
                    <Chk k="forsta_paminnelse_utan_avgift" label="Första påminnelse utan avgift" />
                  </Section>
                  <Section title="Leverantörsfakturor">
                    <Chk k="lev_tillat_redigering" label="Tillåt redigering av leverantörsfakturor" />
                    <Chk k="lev_kvitta_auto" label="Kvitta automatiskt vid hantering av flera utkast" />
                    <Chk k="lev_betalningsfil" label="Använd betalningsfil för utgående betalningar" />
                    <Chk k="lev_bekrafta_betalningar" label="Bekräfta betalningar innan de skickas till banken" />
                    <Chk k="lev_visa_debet_kredit" label="Visa debet och kredit på leverantörsfakturor" />
                  </Section>
                </div>

                <div>
                  <Section title="Nummerserier">
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                      <span className="text-sm text-gray-600">Nästa kundfakturanr</span>
                      <input className="input" type="number" value={form.nasta_fakturanr ?? ''} onChange={e => set('nasta_fakturanr', e.target.value)} />
                    </div>
                  </Section>
                  <Section title="E-fakturor och underlag">
                    <Chk k="ta_emot_efaktura" label="Ta emot e-fakturor (3,50 SEK per faktura och 0,70 SEK per bilaga)" />
                    <Chk k="ta_emot_underlag_epost" label="Ta emot underlag via e-post (underlag 3,50 kr)" />
                  </Section>
                  <Section title="E-postinställningar för mottagna e-fakturor">
                    <Chk k="epost_vid_nya_efakturor" label="Skicka e-post när jag får nya e-fakturor" />
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                      <span className="text-sm text-gray-600">Skicka e-post till</span>
                      <input className="input" value={s.epost_efaktura_adress ?? ''} onChange={e => setS('epost_efaktura_adress', e.target.value)} />
                    </div>
                    <RowSel k="epost_efaktura_frekvens" label="Skicka e-post" options={['Varje gång jag tar emot en e-faktura', 'En gång per dag', 'En gång per vecka']} />
                  </Section>
                  <Section title="Betalt Direkt">
                    <RowSel k="bd_avgiftskonto" label="Avgift för att sälja faktura" options={['6064 - Factoringavgifter', '6063 - Kreditförsäkringspremier', '6069 - Övriga kostnader']} />
                    <Chk k="bd_standard" label="Använd försäljning av fakturor som standardalternativ" />
                    <Chk k="bd_aktivera" label="Aktivera möjligheten att sälja fakturor" />
                  </Section>
                </div>
              </div>
            )}

            {tab === 'Bokföringsuppgifter' && (
              <div className="grid grid-cols-2 gap-x-14">
                <div>
                  <Section title="Bokföringsmetod">
                    <div className="grid grid-cols-1 gap-3">
                      {[{ key: 'faktura', titel: 'Faktureringsmetoden', desc: 'Bokför fordran/skuld när fakturan skapas (1510/2440). Moms på fakturadatum.' },
                        { key: 'kontant', titel: 'Kontantmetoden (bokslutsmetoden)', desc: 'Bokför vid betalning. Moms vid betalning.' }].map(o => {
                        const active = (form.bokforingsmetod || 'faktura') === o.key
                        return (
                          <button key={o.key} type="button" onClick={() => set('bokforingsmetod', o.key)}
                            className={`text-left rounded-lg p-3 border-2 transition-colors ${active ? 'border-blue-600 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                            <div className="flex items-center gap-2 mb-0.5"><i className={`ti ${active ? 'ti-circle-check-filled text-blue-600' : 'ti-circle text-gray-300'}`} /><span className="text-sm font-medium">{o.titel}</span></div>
                            <div className="text-xs text-gray-500">{o.desc}</div>
                          </button>
                        )
                      })}
                    </div>
                  </Section>
                  <Section title="Bokföringsinställningar">
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                      <span className="text-sm text-gray-600">Företagsform</span>
                      <select className="input" value={form.foretagsform ?? ''} onChange={e => set('foretagsform', e.target.value)}>
                        <option value="">Välj…</option>{['Aktiebolag', 'Enskild näringsidkare', 'Handelsbolag/Kommanditbolag', 'Ekonomisk förening', 'Ideell förening', 'Bostadsrättsförening', 'Övrigt'].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                      <span className="text-sm text-gray-600">Momsperiod</span>
                      <select className="input" value={form.momsperiod ?? ''} onChange={e => set('momsperiod', e.target.value)}>
                        <option value="">Välj…</option>{momsperiodOptions(form.momsperiod).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <RowSel k="periodisk_sammanstallning" label="Period för periodisk sammanställning" options={['Månad', 'Kvartal', 'Ingen']} />
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5">
                      <span className="text-sm text-gray-600">Bokföring låst t.o.m</span>
                      <input className="input" type="month" value={form.bokforing_last_tom ?? ''} onChange={e => set('bokforing_last_tom', e.target.value)} />
                    </div>
                    <RowSel k="lasning_efter" label="Låsning av period efter" options={['Månad', 'Kvartal', 'År', 'Ingen']} />
                    <div className="mt-2">
                      <Chk k="anvand_resultatenheter" label="Använd resultatenheter" />
                      <Chk k="anvand_projekt" label="Använd projekt" />
                      <Chk k="reskontrabokning" label="Använd reskontrabokning av fakturor" />
                      <Chk k="transaktionstexter" label="Använd transaktionstexter" />
                      <Chk k="auto_moms" label="Använd automatisk momsberäkning" />
                      <Chk k="auto_periodisering" label="Använd automatisk bokföring av periodiseringar" />
                      <Chk k="auto_avskrivning" label="Använd automatisk bokföring av avskrivningar" />
                    </div>
                  </Section>
                  <Section title="Avskrivningsinställningar">
                    <RowSel k="avskrivning_frekvens" label="Avskrivning görs" options={['Månadsvis', 'Kvartalsvis', 'Årsvis']} />
                  </Section>
                  <Section title="Attestinställningar">
                    <Chk k="attest_momsrapport" label="Använd attest av momsrapport" />
                    <Chk k="attest_lev" label="Använd attest av leverantörsfakturor" />
                    <Chk k="attest_epost" label="Skicka e-post till användare som ska attestera leverantörsfakturor" />
                  </Section>
                </div>

                <div>
                  <Section title="Verifikationsserier">
                    {SERIE_TYPER.map(([k, label, def]) => (
                      <div key={k} className="grid grid-cols-[1fr_1.3fr] items-center gap-3 py-1.5">
                        <span className="text-sm text-gray-600">{label}</span>
                        <input className="input" value={(s.serier?.[k]) ?? def} onChange={e => setSerie(k, e.target.value)} />
                      </div>
                    ))}
                  </Section>
                  <Section title="Koncernföretag">
                    <p className="text-xs text-gray-500 mb-2">Om ditt företag är en del av en koncern kan du använda koncernspecifika konton när du bokför kundfordringar och leverantörsskulder.</p>
                    <Chk k="koncernkonton" label="Använd koncernspecifika konton" />
                  </Section>
                </div>
              </div>
            )}

            {tab === 'Övriga uppgifter' && (
              <div className="grid grid-cols-2 gap-x-14">
                <div>
                  <Section title="Standardtexter för försäljningsdokument">
                    <Txt valKey="faktura_text" label="Faktura" ph="Ange ingen känslig eller konfidentiell information här!" />
                    <Txt settingKey="text_drojsmal" label="Dröjsmålsränta" rows={3} ph="Vid betalning efter förfallodagen debiteras ränta enligt räntelagen." />
                  </Section>
                  <Section title="Standardtexter för betalningspåminnelse">
                    <Txt settingKey="text_paminnelse_faktura" label="Faktura" rows={4} />
                    <Txt settingKey="text_paminnelse_epost" label="E-post" rows={5} />
                  </Section>
                </div>
                <div>
                  <Section title="Standardtexter för e-post">
                    <Txt valKey="faktura_epost_text" label="Faktura" rows={6} ph="Översänder faktura enligt överenskommelse." />
                  </Section>
                  <Section title="Utskriftsinställningar">
                    <Chk k="utskr_ram" label="Faktura med ram" />
                    <Chk k="utskr_ocr" label="Visa OCR på fakturautskrift" />
                    <Chk k="utskr_qr" label="Visa QR-kod på fakturautskrift" />
                    <Chk k="utskr_alt_bg" label="Använd alternativt bankgironummer på fakturautskrift" />
                    <Chk k="utskr_artikelnr" label="Visa artikelnummer på fakturautskrift" />
                    <Chk k="utskr_enhet" label="Visa enhet för artikel på fakturautskrift" />
                    <Chk k="utskr_antal" label="Visa antal artiklar på fakturautskrift" />
                    <Chk k="utskr_pris" label="Visa pris för artikel på fakturautskrift" />
                    <Chk k="utskr_projekt" label="Visa projekt på kundfaktura" />
                    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-1.5 mt-2">
                      <span className="text-sm text-gray-600">Fakturabakgrund</span>
                      <select className="input" value={s.fakturabakgrund ?? ''} onChange={e => setS('fakturabakgrund', e.target.value)}>
                        <option value="">Välj…</option>{['Företagsnamn och sidfot', 'Endast företagsnamn', 'Ingen bakgrund'].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </Section>
                </div>
              </div>
            )}

            {tab === 'Mottagningsadresser' && <MottagningsAdresser company={company} />}

            <div className="flex items-center justify-between mt-6">
              <div className="flex gap-2">
                <Link to="/installningar/kontoplan" className="btn text-sm"><i className="ti ti-list-numbers" /> Kontoplan</Link>
                <Link to="/installningar/rakenskapsar" className="btn text-sm"><i className="ti ti-calendar" /> Räkenskapsår</Link>
                <Link to="/installningar/notiser" className="btn text-sm"><i className="ti ti-bell" /> Notiser</Link>
                <Link to="/installningar/abonnemang" className="btn text-sm"><i className="ti ti-credit-card" /> Abonnemang</Link>
                <Link to="/installningar/aterstall" className="btn btn-danger text-sm"><i className="ti ti-alert-triangle" /> Återställ företag</Link>
              </div>
              <button className="btn btn-primary px-6 py-2" onClick={save} disabled={saving}><i className="ti ti-device-floppy" /> {saving ? 'Sparar…' : 'Spara ändringar'}</button>
            </div>
          </>
        )}
      </div>
    </div>
   </FormCtx.Provider>
  )
}
