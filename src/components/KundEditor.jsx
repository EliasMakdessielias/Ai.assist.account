import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { kundPayload } from '../lib/kunder'
import { SUPPORTED_CURRENCIES } from '../lib/currency'
import { isValidOrgNr, normalizeOrgNr } from '../lib/orgnr'
import { companyToKundForm, diffFormValues, KUND_FIELD_LABELS } from '../lib/companyProvider'

// Kundkort (Fortnox-inspirerat, tätt och svenskt): Grunduppgifter + Faktureringsuppgifter.
// Automatisk hämtning av svenska företagsuppgifter via officiellt API (edge: hamta-foretag).
// Endast fält BokPilot använder/lagrar. Betalningsvillkor styr förfallodatum i Ny faktura;
// Försäljningskonto används vid bokföring av kundfakturan (tomt = 3001).
export default function KundEditor({ kund, forslagsNr, onClose, onSaved, onDelete, onOpenExisting }) {
  const { company, user } = useAuth()
  const ny = !kund?.id
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(() => ({
    kundtyp: 'foretag', is_active: true, payment_terms: 30, valuta: 'SEK',
    ...kund, kund_nr: kund?.kund_nr ?? forslagsNr,
  }))
  const [saving, setSaving] = useState(false)
  const [salesAccounts, setSalesAccounts] = useState([])
  // Faktureringsinställningar (Fortnox-likt kort). Lagras i JSONB customers.faktura_installningar.
  // Fält med riktig funktion ligger i egna kolumner (payment_terms, valuta, referenser, vat, försäljningskonto).
  const [inst, setInst] = useState(() => ({ ...(kund?.faktura_installningar || {}) }))
  const iset = (k, v) => setInst(s => ({ ...s, [k]: v }))
  // Hopfällbara sektioner (matchar bilden: E-dokument + Förvalda mallar öppna, Fakturatext stängd).
  const [openSect, setOpenSect] = useState({ edok: true, faktext: false, mallar: true })

  // Hämtning av företagsuppgifter
  const [hamtar, setHamtar] = useState(false)
  const [filledKeys, setFilledKeys] = useState(new Set())       // fält ifyllda från Allabolag (badge)
  const [manualKeys, setManualKeys] = useState(new Set())       // fält ändrade manuellt efter hämtning
  const [foretag, setForetag] = useState(null)                  // { legalName, status } för statusraden
  const [prov, setProv] = useState(null)                        // { source, retrievedAt, apiVersion }
  const [ejAktiverad, setEjAktiverad] = useState(false)         // officiellt API ej konfigurerat -> tyst manuell ifyllnad
  const [dupKund, setDupKund] = useState(null)                  // befintlig kund med samma org-nr
  const [diff, setDiff] = useState(null)                        // { conflicts, values, foretag, prov } inför överskrivning
  const lastLookup = useRef(kund?.org_nr_normalized || (kund?.org_nr ? normalizeOrgNr(kund.org_nr) : ''))
  const debounceRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  // Ändras ett Allabolag-ifyllt fält manuellt försvinner badgen och fältet markeras som manuellt.
  const setEdited = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (filledKeys.has(k)) {
      setFilledKeys(s => { const n = new Set(s); n.delete(k); return n })
      setManualKeys(s => new Set(s).add(k))
    }
  }

  useEffect(() => {
    if (!company) return
    supabase.from('accounts').select('account_nr, name').eq('company_id', company.id)
      .like('account_nr', '3%').eq('is_active', true).order('account_nr')
      .then(({ data }) => setSalesAccounts(data || []))
  }, [company?.id])

  // Dubblettkontroll: finns redan en kund med detta org-nr i företaget?
  async function kollaDubblett(norm) {
    const { data } = await supabase.from('customers').select('id, kund_nr, name')
      .eq('company_id', company.id).eq('org_nr_normalized', norm).limit(1).maybeSingle()
    setDupKund(data && data.id !== kund?.id ? data : null)
  }

  // Hämtar företagsuppgifter via edge-funktionen. force=true kringgår cache (Uppdatera-knappen)
  // och visar en jämförelse innan manuellt ändrade fält skrivs över.
  async function hamtaForetag(orgnr, { force = false } = {}) {
    setHamtar(true)
    try {
      const { data, error } = await supabase.functions.invoke('hamta-foretag', { body: { org_nr: orgnr, force } })
      let code
      if (error) {
        let m = error.message
        try { const b = await error.context.json(); if (b?.error) m = b.error; if (b?.code) code = b.code } catch { /* ignore */ }
        const e = new Error(m); e.code = code; throw e
      }
      if (data?.error) { const e = new Error(data.error); e.code = data.code; throw e }
      const c = data.company
      const { values } = companyToKundForm(c)
      const nyaProv = { source: c.source || 'Allabolag', retrievedAt: c.sourceRetrievedAt, apiVersion: data.apiVersion }
      setEjAktiverad(false)

      if (force) {
        const conflicts = diffFormValues(form, values)
        if (conflicts.length) { setDiff({ conflicts, values, foretag: c, prov: nyaProv }); setHamtar(false); return }
      }
      applyForetag(values, c, nyaProv)
      toast.success('Företagsuppgifterna har hämtats från Allabolag.')
    } catch (e) {
      // Officiellt API ej konfigurerat: degradera tyst vid AUTO-hämtning (visa lugn inline-text,
      // ingen feltoast). Vid manuellt klick (force) visas meddelandet. Övriga fel: visa alltid.
      if (e.code === 'not_configured') { setEjAktiverad(true); if (force) toast.error(e.message) }
      else toast.error(e.message || 'Företagsuppgifterna kunde inte hämtas just nu. Du kan fylla i uppgifterna manuellt.')
    }
    setHamtar(false)
  }

  // Fyller formuläret med hämtade värden (skriver inte över manuellt ändrade fält vid auto-hämtning).
  function applyForetag(values, c, nyaProv, overwriteAll = false) {
    setForm(f => {
      const next = { ...f }
      for (const [k, v] of Object.entries(values)) {
        if (k === 'kundtyp') { next[k] = v; continue }
        if (overwriteAll || !manualKeys.has(k)) next[k] = v
      }
      return next
    })
    setFilledKeys(prev => {
      const n = new Set(prev)
      Object.keys(values).forEach(k => { if (k !== 'kundtyp' && (overwriteAll || !manualKeys.has(k))) n.add(k) })
      return n
    })
    setForetag({ legalName: c.legalName || c.displayName, status: c.status })
    setProv(nyaProv)
  }

  // Auto-hämtning: när ett komplett + giltigt org-nr skrivits (Luhn), debounce ~500ms.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const norm = normalizeOrgNr(form.org_nr)
    if (!isValidOrgNr(form.org_nr)) { setDupKund(null); return }
    debounceRef.current = setTimeout(() => {
      kollaDubblett(norm)
      // Hoppa över auto-hämtning om officiellt API redan visat sig vara ej konfigurerat (ingen spam).
      if (!ejAktiverad && norm !== lastLookup.current) { lastLookup.current = norm; hamtaForetag(form.org_nr) }
    }, 500)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [form.org_nr])   // eslint-disable-line react-hooks/exhaustive-deps

  async function spara() {
    if (!String(form.name || '').trim()) return toast.error('Kundnamn krävs')
    if (dupKund) return toast.error('Det finns redan en kund med detta organisationsnummer.')
    const payload = kundPayload(form)
    if (!payload.kund_nr) return toast.error('Ange ett kundnummer')
    payload.faktura_installningar = inst   // Fortnox-likt faktureringskort (JSONB)
    // Proveniens: källa/tidpunkt/version + manuellt ändrade fält.
    if (prov) {
      payload.data_source = prov.source
      payload.source_retrieved_at = prov.retrievedAt || null
      payload.source_api_version = prov.apiVersion || null
    }
    if (manualKeys.size) {
      payload.manual_fields = [...manualKeys]
      payload.last_manual_edit_at = new Date().toISOString()
      payload.last_manual_edit_by = user?.id || null
    }
    setSaving(true)
    let error
    if (kund?.id) ({ error } = await supabase.from('customers').update(payload).eq('id', kund.id).eq('company_id', company.id))
    else ({ error } = await supabase.from('customers').insert({ ...payload, company_id: company.id }))
    setSaving(false)
    if (error) {
      if (/customers_company_orgnr_uniq/i.test(error.message)) return toast.error('Det finns redan en kund med detta organisationsnummer.')
      if (/customers_company_kundnr_uniq|duplicate key/i.test(error.message)) return toast.error(`Kundnummer ${payload.kund_nr} används redan – välj ett annat.`)
      return toast.error('Kunde inte spara: ' + error.message)
    }
    toast.success(`Kund ${payload.kund_nr} sparad`)
    onSaved()
  }

  const Badge = () => <span className="ml-1.5 text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-blue-50 text-blue-600 align-middle">Hämtad från Allabolag</span>
  const Field = ({ k, label, type = 'text', w, ph, list }) => (
    <div className={w === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{filledKeys.has(k) && <Badge />}</label>
      <input className="input" type={type} value={form[k] ?? ''} list={list} placeholder={ph || ''}
        onChange={e => setEdited(k, e.target.value)} />
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

  // Render-hjälpare för Faktureringsuppgifter (rena funktioner -> inga remounts/fokustapp).
  const lblCls = 'block text-xs font-medium text-gray-500 mb-1'
  const inp = (label, val, onChange, ph = '') => (
    <div className="mb-3"><label className={lblCls}>{label}</label>
      <input className="input" value={val ?? ''} placeholder={ph} onChange={e => onChange(e.target.value)} /></div>
  )
  const drop = (label, val, onChange, opts, blank) => (
    <div className="mb-3"><label className={lblCls}>{label}</label>
      <select className="input" value={val ?? ''} onChange={e => onChange(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {opts.map(o => (typeof o === 'object' ? <option key={o.v} value={o.v}>{o.l}</option> : <option key={o} value={o}>{o}</option>))}
      </select></div>
  )
  const seg = (label, val, onChange, opts) => (
    <div className="mb-3"><label className={lblCls}>{label}</label>
      <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.15)' }}>
        {opts.map(([v, l, dis]) => (
          <button key={v} type="button" disabled={dis} onClick={() => !dis && onChange(v)}
            className={`px-4 py-1.5 text-sm ${val === v ? 'bg-gray-800 text-white' : dis ? 'bg-gray-50 text-gray-300' : 'bg-white text-gray-600'}`}>{l}</button>
        ))}
      </div></div>
  )
  const colHead = t => <div className="text-sm font-semibold text-gray-700 mb-3">{t}</div>
  const sectHead = (key, title) => (
    <button type="button" onClick={() => setOpenSect(o => ({ ...o, [key]: !o[key] }))}
      className="flex items-center gap-2 text-sm font-semibold text-gray-700 py-2 border-b w-full mt-6" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
      <i className={`ti ti-chevron-${openSect[key] ? 'down' : 'right'} text-green-700`} />{title}
    </button>
  )
  const BETALDAGAR = [0, 10, 14, 15, 20, 30, 60, 90]
  const MOMSTYPER = ['SE', 'EU', 'Export', 'Omvänd skattskyldighet']
  const SPRAK = ['Svenska', 'Engelska']

  const orgnrGiltigt = isValidOrgNr(form.org_nr)

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">KUND {form.kund_nr || ''} – {ny ? 'SKAPA NY' : (kund.name || '').toUpperCase()}</span>
        <div className="flex items-center gap-2.5">
          {orgnrGiltigt && !ejAktiverad && (
            <button className="btn text-sm" onClick={() => hamtaForetag(form.org_nr, { force: true })} disabled={hamtar}>
              <i className="ti ti-refresh mr-1" />{hamtar ? 'Hämtar…' : 'Uppdatera företagsuppgifter'}
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}><i className="ti ti-list" /> Visa lista</button>
        </div>
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
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{form.kundtyp === 'privat' ? 'Personnummer' : 'Org-/Personnummer'}</label>
              <input className="input" value={form.org_nr ?? ''} placeholder="556036-0793"
                onChange={e => set('org_nr', e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && isValidOrgNr(form.org_nr)) { e.preventDefault(); lastLookup.current = normalizeOrgNr(form.org_nr); setEjAktiverad(false); hamtaForetag(form.org_nr, { force: true }) } }} />
              {hamtar && <p className="text-xs text-blue-600 mt-1"><i className="ti ti-loader mr-1" />Hämtar företagsuppgifter…</p>}
              {!hamtar && ejAktiverad && !foretag && (
                <p className="text-xs text-gray-400 mt-1">Automatisk företagshämtning är inte aktiverad – fyll i uppgifterna manuellt.</p>
              )}
              {!hamtar && foretag && (
                <div className="mt-1 text-xs">
                  <div className="font-medium text-gray-800">{foretag.legalName}</div>
                  {foretag.status && <div className="text-green-700">{foretag.status}</div>}
                </div>
              )}
              {dupKund && (
                <div className="mt-1.5 text-xs px-2 py-1.5 bg-amber-50 border border-amber-200 rounded">
                  <div className="text-amber-800">Det finns redan en kund med detta organisationsnummer.</div>
                  <button className="text-blue-700 font-medium hover:underline mt-0.5" onClick={() => onOpenExisting?.(dupKund)}>
                    Öppna kund {dupKund.kund_nr} – {dupKund.name}
                  </button>
                </div>
              )}
            </div>
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
          <div className="max-w-[1400px]">
            {/* Fyra kolumner: Betal-/leveransvillkor · Fakturering · Referenser · Bokföring */}
            <div className="grid grid-cols-4 gap-x-10">
              <div>
                {colHead('Betal- och leveransvillkor')}
                {drop('Betalningsvillkor', form.payment_terms, v => set('payment_terms', parseInt(v, 10) || 0), BETALDAGAR.map(d => ({ v: d, l: `${d} dagar` })))}
                {inp('Leveransvillkor', form.leveransvillkor, v => set('leveransvillkor', v))}
                {inp('Leveranssätt', form.leveranssatt, v => set('leveranssatt', v))}
                {seg('Räntefakturering', inst.rantefakturering ? 'ja' : 'nej', v => iset('rantefakturering', v === 'ja'), [['ja', 'Ja'], ['nej', 'Nej']])}
              </div>

              <div>
                {colHead('Fakturering')}
                <div className="grid grid-cols-2 gap-3">
                  {drop('Prislista', inst.prislista ?? 'Prislista A', v => iset('prislista', v), ['Prislista A'])}
                  {drop('Valuta', form.valuta, v => set('valuta', v), SUPPORTED_CURRENCIES.map(c => c.code))}
                </div>
                {inp('Fakturarabatt (%)', inst.fakturarabatt, v => iset('fakturarabatt', v))}
                <div className="grid grid-cols-2 gap-3">
                  {inp('Fakturaavgift', inst.fakturaavgift, v => iset('fakturaavgift', v))}
                  {inp('Fraktavgift', inst.fraktavgift, v => iset('fraktavgift', v))}
                </div>
                {seg('Priser inkl. moms', inst.priser_inkl_moms ? 'ja' : 'nej', v => iset('priser_inkl_moms', v === 'ja'), [['ja', 'Ja'], ['nej', 'Nej']])}
              </div>

              <div>
                {colHead('Referenser')}
                {inp('Vår referens', form.var_referens, v => set('var_referens', v), 'Förnamn, Efternamn')}
                {drop('Kundansvarig', inst.kundansvarig, v => iset('kundansvarig', v), [], 'Ingen vald')}
                {inp('Extern referens', inst.extern_referens, v => iset('extern_referens', v))}
                <div className="mb-3">
                  <label className={lblCls}>Er referens</label>
                  <div className="rounded-lg overflow-hidden text-sm" style={{ border: '0.5px solid rgba(0,0,0,0.15)' }}>
                    <div className="grid grid-cols-[64px_1fr] bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                      <div className="px-2 py-1.5 text-center border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Förvald</div>
                      <div className="px-2 py-1.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Benämning</div>
                    </div>
                    <div className="grid grid-cols-[64px_1fr] items-center">
                      <div className="px-2 py-1.5 text-center"><input type="radio" checked readOnly className="w-4 h-4" /></div>
                      <input className="px-2 py-1.5 outline-none bg-transparent" value={form.er_referens ?? ''} placeholder="Ingen förvald" onChange={e => set('er_referens', e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                {colHead('Bokföring')}
                {inp('VAT-nummer', form.vat_nummer, v => set('vat_nummer', v))}
                {drop('Momstyp', inst.momstyp ?? 'SE', v => iset('momstyp', v), MOMSTYPER)}
                <div className="mb-3">
                  <label className={lblCls}>Försäljningskonto</label>
                  <input className="input" list="kund-salj-konton" value={form.forsaljningskonto ?? ''} placeholder="Konto, Benämning (tomt = 3001)"
                    onChange={e => set('forsaljningskonto', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} />
                  <datalist id="kund-salj-konton">
                    {salesAccounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
                  </datalist>
                </div>
              </div>
            </div>

            {/* E-dokument */}
            {sectHead('edok', 'E-dokument')}
            {openSect.edok && (
              <div className="py-4 max-w-md">
                <div className="text-sm font-semibold text-gray-700 mb-3">Faktura</div>
                {seg('Distributionssätt', inst.distributionssatt ?? '', v => iset('distributionssatt', v),
                  [['e-faktura', 'E-faktura', true], ['e-post', 'E-post'], ['utskrift', 'Utskrift']])}
                {inp('E-post', inst.epost_faktura, v => iset('epost_faktura', v))}
                {inp('E-post för påminnelser', inst.epost_paminnelser, v => iset('epost_paminnelser', v))}
                {inp('Kopia', inst.epost_kopia, v => iset('epost_kopia', v))}
                {inp('Hemlig kopia', inst.epost_hemlig_kopia, v => iset('epost_hemlig_kopia', v))}
                {inp('GLN-nummer', inst.gln, v => iset('gln', v))}
                {inp('GLN-nummer för leverans', inst.gln_leverans, v => iset('gln_leverans', v))}
              </div>
            )}

            {/* Fakturatext */}
            {sectHead('faktext', 'Fakturatext')}
            {openSect.faktext && (
              <div className="py-4 max-w-2xl">
                <textarea className="input" rows={4} value={inst.fakturatext ?? ''} placeholder="Text som visas på fakturan…" onChange={e => iset('fakturatext', e.target.value)} />
              </div>
            )}

            {/* Förvalda mallar */}
            {sectHead('mallar', 'Förvalda mallar')}
            {openSect.mallar && (
              <div className="grid grid-cols-4 gap-x-10 py-4">
                {[['faktura', 'Faktura'], ['offert', 'Offert'], ['order', 'Order'], ['kontant', 'Kontantfaktura']].map(([k, label]) => (
                  <div key={k}>
                    <div className="text-sm font-semibold text-gray-700 mb-3">{label}</div>
                    {drop('Mall', inst[`mall_${k}`], v => iset(`mall_${k}`, v), [], 'Inget förvalt')}
                    {drop('Språk', inst[`sprak_${k}`], v => iset(`sprak_${k}`, v), SPRAK, 'Inget förvalt')}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border-t px-7 py-3 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <button className="btn btn-danger" disabled={ny || saving} onClick={() => onDelete(kund)} title={ny ? 'Spara kunden först' : 'Ta bort kunden'}>Radera</button>
        <div className="flex gap-2.5">
          <button className="btn" onClick={onClose} disabled={saving}>Avbryt</button>
          <button className="btn btn-primary px-6" onClick={spara} disabled={saving || !!dupKund}>{saving ? 'Sparar…' : 'Spara'}</button>
        </div>
      </div>

      {diff && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-6" onClick={() => setDiff(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-[15px] font-bold tracking-tight">Uppdatera företagsuppgifter</span>
            </div>
            <div className="p-6">
              <p className="text-xs text-gray-600 mb-3">Följande manuellt ändrade fält skiljer sig från Allabolag. Vill du skriva över dem?</p>
              <div className="rounded-lg overflow-hidden text-sm" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <table className="w-full">
                  <thead><tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                    <th className="text-left px-3 py-2">Fält</th><th className="text-left px-3 py-2">Nuvarande</th><th className="text-left px-3 py-2">Från Allabolag</th>
                  </tr></thead>
                  <tbody>
                    {diff.conflicts.map(c => (
                      <tr key={c.key} className="border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        <td className="px-3 py-1.5 font-medium">{KUND_FIELD_LABELS[c.key] || c.key}</td>
                        <td className="px-3 py-1.5 text-gray-500">{c.from}</td>
                        <td className="px-3 py-1.5 text-gray-800">{c.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => { applyForetag(diff.values, diff.foretag, diff.prov); setDiff(null); toast.success('Företagsuppgifterna har hämtats från Allabolag.') }}>Behåll mina ändringar i övriga</button>
              <button className="btn btn-primary" onClick={() => { setManualKeys(new Set()); applyForetag(diff.values, diff.foretag, diff.prov, true); setDiff(null); toast.success('Företagsuppgifterna har uppdaterats från Allabolag.') }}>Skriv över</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
