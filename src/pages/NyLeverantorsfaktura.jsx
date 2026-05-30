import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import UnderlagPanel from '../components/UnderlagPanel'
import LeverantorEditor from '../components/LeverantorEditor'
import { tolkaDocument } from '../lib/tolka'
import { serie } from '../lib/serier'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const emptyRow = () => ({ konto: '', namn: '', info: '', debet: '', kredit: '' })

export default function NyLeverantorsfaktura() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const docId = params.get('doc')
  const editId = params.get('edit')
  const autoTolka = params.get('tolka') === '1'
  const tolkadRef = useRef(false)
  const [accounts, setAccounts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [nextLopnr, setNextLopnr] = useState(null)

  const [supplierId, setSupplierId] = useState('')
  const [fakturadatum, setFakturadatum] = useState(today())
  const [forfallodatum, setForfallodatum] = useState(today())
  const [total, setTotal] = useState('')
  const [moms, setMoms] = useState('')
  const [ocr, setOcr] = useState('')
  const [fakturanummer, setFakturanummer] = useState('')
  const [valuta, setValuta] = useState('SEK')
  const [moreOpen, setMoreOpen] = useState(false)
  const [tab, setTab] = useState('konto')
  const [rows, setRows] = useState([{ konto: '2440', namn: 'Leverantörsskulder', info: '', debet: '', kredit: '' }, emptyRow()])
  const [avgift, setAvgift] = useState('')
  const [frakt, setFrakt] = useState('')
  const [ores, setOres] = useState('')
  const [saving, setSaving] = useState(false)
  const [attachIds, setAttachIds] = useState(docId ? [docId] : [])
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(560)
  const [levForslag, setLevForslag] = useState(null)
  const [levEditor, setLevEditor] = useState(null)
  const [levOpen, setLevOpen] = useState(false)
  const [levQuery, setLevQuery] = useState('')
  const toggleAttach = id => setAttachIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  function startResize(e) {
    e.preventDefault()
    const move = ev => setPanelWidth(Math.min(window.innerWidth - 360, Math.max(380, window.innerWidth - ev.clientX)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect = '' }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  useEffect(() => { if (company) init() }, [company?.id])

  async function init() {
    const [{ data: acc }, { data: sup }, { data: inv }] = await Promise.all([
      supabase.from('accounts').select('account_nr, name, is_active').eq('company_id', company.id).order('account_nr'),
      supabase.from('suppliers').select('id, name, org_nr, bankgiro').eq('company_id', company.id).order('name'),
      supabase.from('supplier_invoices').select('lopnr').eq('company_id', company.id),
    ])
    setAccounts(acc || [])
    setSuppliers(sup || [])
    setNextLopnr(Math.max(0, ...(inv || []).map(i => i.lopnr || 0)) + 1)

    if (editId) {
      const { data: ex } = await supabase.from('supplier_invoices').select('*').eq('id', editId).single()
      if (ex) {
        setSupplierId(ex.supplier_id || '')
        setFakturadatum(ex.invoice_date || today())
        setForfallodatum(ex.due_date || today())
        setTotal(ex.total_amount ? fmt(ex.total_amount) : '')
        setMoms(ex.vat_amount ? fmt(ex.vat_amount) : '')
        setOcr(ex.ocr || '')
        setFakturanummer(ex.invoice_nr || '')
        setValuta(ex.currency || 'SEK')
        setNextLopnr(ex.lopnr)
        const amap = Object.fromEntries((acc || []).map(a => [a.account_nr, a.name]))
        const m = ex.vat_amount || 0, net = (ex.total_amount || 0) - m
        const r = [{ konto: '2440', namn: 'Leverantörsskulder', info: '', debet: '', kredit: ex.total_amount ? fmt(ex.total_amount) : '' }]
        if (m > 0.005) r.push({ konto: '2640', namn: amap['2640'] || 'Ingående moms', info: '', debet: fmt(m), kredit: '' })
        r.push({ konto: ex.kostnadskonto || '4000', namn: amap[ex.kostnadskonto || '4000'] || '', info: '', debet: net > 0 ? fmt(net) : '', kredit: '' })
        setRows([...r, emptyRow()])
      }
    }
  }

  // Auto-tolka när man kommer från Inkomna fakturor (?doc=…&tolka=1)
  useEffect(() => {
    if (!company || !docId || !autoTolka || tolkadRef.current || !accounts.length) return
    tolkadRef.current = true
    ;(async () => {
      const t = toast.loading('Tolkar underlaget…')
      try {
        let r
        const { data: dd } = await supabase.from('documents').select('tolkning').eq('id', docId).maybeSingle()
        if (dd?.tolkning) r = dd.tolkning
        else r = await tolkaDocument(docId)
        fyllFranTolkning(r); toast.dismiss(t)
      } catch (e) { toast.dismiss(t); toast.error(e.message || String(e)) }
    })()
  }, [company, accounts.length])

  async function reloadSuppliers() {
    const { data } = await supabase.from('suppliers').select('id, name, org_nr, bankgiro').eq('company_id', company.id).order('name')
    setSuppliers(data || [])
    return data || []
  }

  const accMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.account_nr, a.name])), [accounts])
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts])

  const sumDebet = rows.reduce((s, r) => s + num(r.debet), 0)
  const sumKredit = rows.reduce((s, r) => s + num(r.kredit), 0)
  const differens = sumDebet - sumKredit
  const balanced = Math.abs(differens) < 0.005 && sumDebet > 0

  function setRow(idx, patch) {
    setRows(rs => {
      const next = rs.map((r, i) => i === idx ? { ...r, ...patch } : r)
      // håll en tom rad sist
      if (next.length === 0 || (next[next.length - 1].konto || next[next.length - 1].debet || next[next.length - 1].kredit)) next.push(emptyRow())
      return next
    })
  }
  function removeRow(idx) { setRows(rs => rs.filter((_, i) => i !== idx)) }

  // Enter-navigering
  const focusId = id => setTimeout(() => { const el = document.getElementById(id); el?.focus(); el?.select?.() }, 0)
  const hEnter = (e, nextId, before) => { if (e.key !== 'Enter') return; e.preventDefault(); if (before) before(); if (nextId) focusId(nextId) }
  const focusFirstEmptyKonto = () => { const idx = rows.findIndex(r => !r.konto); focusId(`lev-konto-${idx < 0 ? rows.length - 1 : idx}`) }

  // Sätt 2440-kredit = Total, och 2640-debet = Moms; auto vid blur.
  function syncHeader(nextTotal = total, nextMoms = moms) {
    const t = num(nextTotal), m = num(nextMoms)
    setRows(rs => {
      let next = rs.map(r => r.konto === '2440' ? { ...r, kredit: t ? fmt(t) : '', debet: '' } : r)
      const momsIdx = next.findIndex(r => r.konto === '2640')
      if (m > 0.005) {
        if (momsIdx >= 0) next[momsIdx] = { ...next[momsIdx], debet: fmt(m), kredit: '' }
        else { const ins = next.length > 1 ? 1 : next.length; next.splice(ins, 0, { konto: '2640', namn: accMap['2640'] || 'Ingående moms', info: '', debet: fmt(m), kredit: '' }) }
      } else if (momsIdx >= 0) next.splice(momsIdx, 1)
      if (!next.length || (next[next.length - 1].konto || next[next.length - 1].debet || next[next.length - 1].kredit)) next.push(emptyRow())
      return next
    })
  }

  // När man fyllt i ett kostnadskonto och raden saknar belopp → fyll debet med kvarvarande differens.
  function onKontoBlur(idx) {
    setRows(rs => {
      const r = rs[idx]; if (!r.konto) return rs
      const namn = accMap[r.konto] || r.namn
      let next = rs.map((x, i) => i === idx ? { ...x, namn } : x)
      if (!num(r.debet) && !num(r.kredit) && r.konto !== '2440') {
        const sd = next.reduce((s, x, i) => i === idx ? s : s + num(x.debet), 0)
        const sk = next.reduce((s, x, i) => i === idx ? s : s + num(x.kredit), 0)
        const restDebet = sk - sd
        if (restDebet > 0.005) next[idx] = { ...next[idx], debet: fmt(restDebet) }
      }
      if (!next.length || (next[next.length - 1].konto || next[next.length - 1].debet || next[next.length - 1].kredit)) next.push(emptyRow())
      return next
    })
  }

  // Fyll i fakturan från AI-tolkningen (bokför inte).
  function fyllFranTolkning(result) {
    if (!result) return
    const datum = result.fakturadatum || result.datum
    if (datum && /^\d{4}-\d{2}-\d{2}$/.test(datum)) setFakturadatum(datum)
    if (result.forfallodatum && /^\d{4}-\d{2}-\d{2}$/.test(result.forfallodatum)) setForfallodatum(result.forfallodatum)
    if (result.ocr) setOcr(String(result.ocr))
    const faktnr = result.fakturanummer || result.fakturanr || result.invoice_nr
    if (faktnr) setFakturanummer(String(faktnr))
    // Matcha leverantör på namn – annars föreslå att skapa ny
    const levRaw = String(result.leverantor || result.leverantör || result.supplier || result.saljare || '').trim()
    const orgRaw = String(result.org_nr || result.orgnr || result.organisationsnummer || '').trim()
    if (levRaw || orgRaw) {
      const ll = levRaw.toLowerCase()
      const m = suppliers.find(s => (orgRaw && (s.org_nr || '').replace(/\D/g, '') === orgRaw.replace(/\D/g, '')) ||
        (ll && (s.name.toLowerCase().includes(ll.slice(0, 8)) || ll.includes(s.name.toLowerCase().slice(0, 8)))))
      if (m) { setSupplierId(m.id); setLevForslag(null) }
      else setLevForslag({
        name: levRaw, org_nr: orgRaw,
        bankgiro: String(result.bankgiro || result.bg || '').trim(),
        plusgiro: String(result.plusgiro || '').trim(),
        iban: String(result.iban || '').trim(),
        bic: String(result.bic || '').trim(),
        vat_nummer: String(result.vat_nummer || result.vat || '').trim(),
        phone: String(result.leverantor_telefon || result.telefon || '').trim(),
        email: String(result.leverantor_epost || result.email || '').trim(),
        faktura_adress: String(result.leverantor_adress || result.adress || '').trim(),
        postnr: String(result.leverantor_postnr || result.postnr || '').trim(),
        ort: String(result.leverantor_ort || result.ort || '').trim(),
        land: String(result.leverantor_land || result.land || '').trim(),
        webb: String(result.leverantor_webb || result.webb || '').trim(),
      })
    }
    // Kontering
    const kr = Array.isArray(result.konteringsrader) ? result.konteringsrader : []
    let nya = kr.map(r => {
      const nr = String(r.konto ?? '').trim()
      const d = num(r.debet), k = num(r.kredit)
      return { konto: nr, namn: accMap[nr] || r.benamning || '', info: '', debet: d > 0 ? fmt(d) : '', kredit: k > 0 ? fmt(k) : '' }
    }).filter(r => r.konto)
    // Härled Total/Moms
    let t = num(result.total ?? result.belopp ?? result.summa)
    let m = num(result.moms ?? result.vat)
    if (!t && nya.length) t = nya.filter(r => r.konto === '2440').reduce((s, r) => s + num(r.kredit), 0) || nya.reduce((s, r) => s + num(r.debet), 0)
    if (!m && nya.length) m = nya.filter(r => /^264/.test(r.konto)).reduce((s, r) => s + num(r.debet), 0)
    if (t) { setTotal(fmt(t)) }
    if (m) { setMoms(fmt(m)) }
    if (!nya.length && t) {
      // Bygg standardkontering om AI inte gav rader
      nya = [
        { konto: '2440', namn: 'Leverantörsskulder', info: '', debet: '', kredit: fmt(t) },
        ...(m > 0 ? [{ konto: '2640', namn: accMap['2640'] || 'Ingående moms', info: '', debet: fmt(m), kredit: '' }] : []),
        { konto: '4000', namn: accMap['4000'] || '', info: '', debet: fmt(t - m), kredit: '' },
      ]
    } else if (nya.length && !nya.some(r => r.konto === '2440')) {
      nya.unshift({ konto: '2440', namn: 'Leverantörsskulder', info: '', debet: '', kredit: fmt(t) })
    }
    // Öresutjämning vid avrundningsdiff (konto 3740)
    const sd2 = nya.reduce((s, r) => s + num(r.debet), 0), sk2 = nya.reduce((s, r) => s + num(r.kredit), 0)
    const d2 = +(sd2 - sk2).toFixed(2)
    if (Math.abs(d2) > 0.005 && Math.abs(d2) <= 1.5) {
      nya.push({ konto: '3740', namn: accMap['3740'] || 'Öres- och kronutjämning', info: '', debet: d2 < 0 ? fmt(-d2) : '', kredit: d2 > 0 ? fmt(d2) : '' })
      setOres(fmt(Math.abs(d2)))
    }
    setRows([...nya, emptyRow()])
    toast.success('Underlaget tolkat – granska och klicka Bokför')
  }

  const supplier = suppliers.find(s => s.id === supplierId)
  const levFiltered = !levQuery.trim() ? suppliers : suppliers.filter(s => `${s.name} ${s.org_nr || ''}`.toLowerCase().includes(levQuery.toLowerCase()))

  function konteringRows() {
    return rows.filter(r => r.konto && (num(r.debet) > 0 || num(r.kredit) > 0))
      .map(r => ({ nr: r.konto, name: accMap[r.konto] || r.namn || '', info: r.info || '', debet: num(r.debet), kredit: num(r.kredit) }))
  }

  async function spara(bokfor) {
    if (!supplierId) return toast.error('Välj en leverantör')
    const t = num(total)
    if (t <= 0) return toast.error('Ange totalbelopp')
    const krows = konteringRows()
    // Automatisk öresutjämning vid små avrundningsdiffar (konto 3740)
    const csd = krows.reduce((s, r) => s + r.debet, 0), csk = krows.reduce((s, r) => s + r.kredit, 0)
    let diff = +(csd - csk).toFixed(2)
    if (Math.abs(diff) > 0.005 && Math.abs(diff) <= 1.5) {
      krows.push({ nr: '3740', name: accMap['3740'] || 'Öres- och kronutjämning', info: 'Öresutjämning', debet: diff < 0 ? +(-diff).toFixed(2) : 0, kredit: diff > 0 ? +diff.toFixed(2) : 0 })
      diff = 0
    }
    if (bokfor && Math.abs(diff) > 0.005) return toast.error('Konteringen måste balansera (differens 0)')
    if (bokfor && krows.length < 2) return toast.error('Lägg till kontering')
    const td = krows.reduce((s, r) => s + r.debet, 0), tk = krows.reduce((s, r) => s + r.kredit, 0)

    setSaving(true)
    try {
      const costRow = krows.find(r => r.debet > 0 && r.nr !== '2640')
      const invPayload = {
        company_id: company.id, supplier_id: supplierId, invoice_nr: fakturanummer || null, ocr: ocr || null,
        invoice_date: fakturadatum, due_date: forfallodatum, currency: valuta,
        amount_excl_vat: t - num(moms), vat_amount: num(moms), total_amount: t,
        kostnadskonto: costRow?.nr || '4000', status: 'unpaid', lopnr: nextLopnr,
      }
      let inv, e0
      if (editId) ({ data: inv, error: e0 } = await supabase.from('supplier_invoices').update(invPayload).eq('id', editId).select().single())
      else ({ data: inv, error: e0 } = await supabase.from('supplier_invoices').insert(invPayload).select().single())
      if (e0) throw e0

      if (bokfor) {
        const ser = serie(company, 'leverantorsfakturor')
        const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
        const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
          company_id: company.id, ver_nr: nr || 'L' + Date.now(), ver_serie: ser,
          datum: fakturadatum, beskrivning: `Lev.faktura ${supplier?.name || ''} ${fakturanummer || ''}`.trim(),
          total_debet: td, total_kredit: tk, created_by: user.id,
        }).select().single()
        if (e1) throw e1
        await supabase.from('verifikation_rows').insert(krows.map((r, ix) => ({
          verifikation_id: ver.id, account_nr: r.nr, account_name: r.name, transaction_info: r.info || null, debet: r.debet, kredit: r.kredit, sort_order: ix,
        })))
        await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', [...new Set(krows.map(r => r.nr))]).eq('is_active', false)
        if (attachIds.length) await supabase.from('documents').update({ verifikation_id: ver.id }).in('id', attachIds)
        await supabase.from('supplier_invoices').update({ bokford: true, verifikation_id: ver.id }).eq('id', inv.id)
        toast.success(`Leverantörsfaktura bokförd (${ver.ver_nr})`)
      } else {
        if (attachIds.length) toast('Sparad – bilden kopplas när fakturan bokförs', { icon: 'ℹ️' })
        else toast.success('Leverantörsfaktura sparad')
      }
      navigate('/leverantorsfakturor')
    } catch (e) { toast.error('Fel: ' + e.message) }
    setSaving(false)
  }

  const Tool = ({ icon, label, onClick, disabled }) => (
    <button disabled={disabled} onClick={onClick} className={`flex items-center gap-1.5 text-[13px] ${disabled ? 'text-gray-300' : 'text-gray-600 hover:text-gray-900'}`}>
      <i className={`ti ${icon}`} /> {label}
    </button>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <datalist id="lev-konton">
        {activeAccounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
      </datalist>
      <div className="flex-1 overflow-y-auto">

      {/* Topprad */}
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-bold tracking-tight">LEVERANTÖRSFAKTURA {nextLopnr || ''}{editId ? ' – ÄNDRA' : '*'}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="btn" onClick={() => { navigate('/leverantorsfakturor/ny'); setTimeout(() => window.location.reload(), 0) }}><i className="ti ti-plus" /> Skapa leverantörsfaktura</button>
          <button className="btn font-medium" style={{ background: '#f5c518', color: '#1a1a1a', borderColor: '#f5c518' }} onClick={() => navigate('/leverantorsfakturor')}><i className="ti ti-list" /> Visa lista</button>
          <button className="btn" onClick={() => setPanelOpen(o => !o)}><i className="ti ti-photo" /> {panelOpen ? 'Dölj bild' : 'Visa bild'}</button>
        </div>
      </div>

      {/* Verktygsrad */}
      <div className="bg-white border-b px-7 py-2.5 flex items-center gap-6 flex-wrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <Tool icon="ti-file-minus" label="Skapa kreditfaktura" disabled />
        <Tool icon="ti-copy" label="Kopiera" disabled />
        <Tool icon="ti-cash" label="Utbetalningar" onClick={() => navigate('/leverantorsfakturor')} />
        <Tool icon="ti-file-off" label="Inaktivera betalfil" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })} />
        <Tool icon="ti-search" label="Kreditupplysning" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })} />
        <Tool icon="ti-calendar" label="Periodisering" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })} />
        <Tool icon="ti-message" label="Kommentar" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })} />
      </div>

      <div className="p-7">
        {levForslag && !supplierId && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800">
            <i className="ti ti-user-question text-amber-500 text-lg" />
            <span>Leverantören <b>{levForslag.name || levForslag.org_nr}</b> hittades inte i registret.</span>
            <button className="btn btn-green text-xs py-1 px-3 ml-auto" onClick={() => setLevEditor(levForslag)}><i className="ti ti-plus" /> Skapa ny leverantör</button>
            <button className="text-amber-700 hover:text-amber-900 text-xs underline" onClick={() => setLevForslag(null)}>Ignorera</button>
          </div>
        )}

        {/* Huvuduppgifter */}
        <div className="grid grid-cols-12 gap-4 mb-2">
          <div className="col-span-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Leverantör</label>
            <div className="relative">
              <input id="lev-leverantor" className="input pr-8" placeholder="Leverantörsnr, Org-/Personnr, Namn, Bg/Pg"
                value={levOpen ? levQuery : (supplier ? `${supplier.name}${supplier.org_nr ? ` · ${supplier.org_nr}` : ''}` : '')}
                onChange={e => { setLevQuery(e.target.value); setLevOpen(true) }}
                onFocus={() => { setLevQuery(''); setLevOpen(true) }}
                onBlur={() => setTimeout(() => setLevOpen(false), 150)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); const f = levFiltered; if (f.length === 1) { setSupplierId(f[0].id); setLevForslag(null); setLevOpen(false); focusId('lev-fakturadatum') } else setLevOpen(true) }
                  else if (e.key === 'Escape') setLevOpen(false)
                }} />
              <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              {levOpen && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-white rounded-lg shadow-xl max-h-72 overflow-y-auto" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                  {levFiltered.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">Inga leverantörer matchar</div>}
                  {levFiltered.map(s => (
                    <button key={s.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
                      onMouseDown={() => { setSupplierId(s.id); setLevForslag(null); setLevOpen(false) }}>
                      <span className="truncate">{s.name}</span>
                      <span className="text-gray-400 text-xs shrink-0">{s.org_nr || ''}</span>
                    </button>
                  ))}
                  <button type="button" className="sticky bottom-0 w-full text-left bg-gray-50 border-t px-3 py-2.5 text-sm text-green-700 font-medium hover:bg-gray-100" style={{ borderColor: 'rgba(0,0,0,0.08)' }}
                    onMouseDown={() => { setLevEditor({ name: /^\d/.test(levQuery) ? '' : levQuery, org_nr: /^\d/.test(levQuery) ? levQuery.replace(/\s/g, '') : '' }); setLevOpen(false) }}>
                    <i className="ti ti-plus mr-1.5" /> Skapa ny leverantör{levQuery ? ` "${levQuery}"` : ''}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Fakturadatum</label>
            <input id="lev-fakturadatum" className="input" type="date" value={fakturadatum} onChange={e => setFakturadatum(e.target.value)} onKeyDown={e => hEnter(e, 'lev-forfallodatum')} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Förfallodatum</label>
            <input id="lev-forfallodatum" className="input" type="date" value={forfallodatum} onChange={e => setForfallodatum(e.target.value)} onKeyDown={e => hEnter(e, 'lev-total')} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Total</label>
            <input id="lev-total" className="input text-right" inputMode="decimal" value={total}
              onChange={e => setTotal(e.target.value)} onBlur={e => { const n = num(e.target.value); setTotal(n ? fmt(n) : ''); syncHeader(n ? fmt(n) : '', moms) }}
              onKeyDown={e => hEnter(e, 'lev-moms', () => { const n = num(total); setTotal(n ? fmt(n) : ''); syncHeader(n ? fmt(n) : '', moms) })} placeholder="0,00" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Moms</label>
            <input id="lev-moms" className="input text-right" inputMode="decimal" value={moms}
              onChange={e => setMoms(e.target.value)} onBlur={e => { const n = num(e.target.value); setMoms(n ? fmt(n) : ''); syncHeader(total, n ? fmt(n) : '') }}
              onKeyDown={e => hEnter(e, 'lev-ocr', () => { const n = num(moms); setMoms(n ? fmt(n) : ''); syncHeader(total, n ? fmt(n) : '') })} placeholder="0,00" />
          </div>
        </div>
        <div className="grid grid-cols-12 gap-4 mb-4">
          <div className="col-span-5">
            <label className="block text-xs font-medium text-gray-500 mb-1">OCR</label>
            <input id="lev-ocr" className="input" value={ocr} onChange={e => setOcr(e.target.value)} onKeyDown={e => hEnter(e, 'lev-fakturanummer')} />
          </div>
          <div className="col-span-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Fakturanummer</label>
            <input id="lev-fakturanummer" className="input" value={fakturanummer} onChange={e => setFakturanummer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusFirstEmptyKonto() } }} />
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Valuta</label>
            <select className="input" value={valuta} onChange={e => setValuta(e.target.value)}><option>SEK</option><option>EUR</option><option>USD</option></select>
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Kurs</label>
            <input className="input bg-gray-50 text-right" value="1" readOnly />
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Enhet</label>
            <input className="input bg-gray-50 text-right" value="1" readOnly />
          </div>
        </div>

        <button className="flex items-center gap-2 text-sm font-medium text-gray-700 py-2 border-b w-full" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => setMoreOpen(o => !o)}>
          <i className={`ti ti-chevron-${moreOpen ? 'down' : 'right'} text-green-700`} /> Ytterligare uppgifter
        </button>
        {moreOpen && (
          <div className="grid grid-cols-3 gap-4 py-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Vår referens</label><input className="input" /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Er referens</label><input className="input" /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Meddelande</label><input className="input" /></div>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 py-2 border-b mb-5" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
          <i className="ti ti-chevron-right text-green-700" /> Kontering från förra fakturan
        </div>

        {/* Tabbar */}
        <div className="flex gap-1 mb-0">
          {[['konto', 'Kontoregistrering'], ['artikel', 'Artikelregistrering']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-[13px] rounded-t-lg border border-b-0 ${tab === k ? 'bg-white text-gray-900 font-medium' : 'bg-gray-100 text-gray-500'}`} style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{l}</button>
          ))}
        </div>

        {tab === 'artikel' ? (
          <div className="bg-white rounded-b-xl rounded-tr-xl p-10 text-center text-gray-400" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>Artikelregistrering – kommer snart</div>
        ) : (
          <div className="bg-white rounded-b-xl rounded-tr-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                  <th className="text-left px-3 py-2.5 border-b w-56" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kontobenämning</th>
                  <th className="text-left px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Transaktionsinfo</th>
                  <th className="text-right px-3 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Debet</th>
                  <th className="text-right px-3 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kredit</th>
                  <th className="px-2 py-2.5 border-b w-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx}>
                    <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      <input id={`lev-konto-${idx}`} className="w-full px-3 py-2 outline-none bg-transparent" list="lev-konton" value={r.konto}
                        onChange={e => setRow(idx, { konto: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
                        onBlur={() => onKontoBlur(idx)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onKontoBlur(idx); focusId(`lev-debet-${idx}`) } }} placeholder="––––" />
                    </td>
                    <td className="border-b px-3 py-2 text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{accMap[r.konto] || r.namn || ''}</td>
                    <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      <input id={`lev-info-${idx}`} className="w-full px-3 py-2 outline-none bg-transparent" value={r.info} onChange={e => setRow(idx, { info: e.target.value })} onKeyDown={e => hEnter(e, `lev-debet-${idx}`)} />
                    </td>
                    <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      <input id={`lev-debet-${idx}`} className="w-full px-3 py-2 outline-none bg-transparent text-right tabular-nums" inputMode="decimal" value={r.debet}
                        onChange={e => setRow(idx, { debet: e.target.value })} onBlur={e => { const n = num(e.target.value); setRow(idx, { debet: n ? fmt(n) : '' }) }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const n = num(e.target.value); setRow(idx, { debet: n ? fmt(n) : '' }); focusId(`lev-kredit-${idx}`) } }} />
                    </td>
                    <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      <input id={`lev-kredit-${idx}`} className="w-full px-3 py-2 outline-none bg-transparent text-right tabular-nums" inputMode="decimal" value={r.kredit}
                        onChange={e => setRow(idx, { kredit: e.target.value })} onBlur={e => { const n = num(e.target.value); setRow(idx, { kredit: n ? fmt(n) : '' }) }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const n = num(e.target.value); setRow(idx, { kredit: n ? fmt(n) : '' }); (balanced ? focusId('lev-bokfor') : focusId(`lev-konto-${idx + 1}`)) } }} />
                    </td>
                    <td className="border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      {rows.length > 1 && <button className="text-gray-300 hover:text-red-600" onClick={() => removeRow(idx)}><i className="ti ti-trash text-sm" /></button>}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-medium">
                  <td colSpan="3" className="px-3 py-2.5 text-right text-gray-500">Summa</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(sumDebet)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(sumKredit)}</td>
                  <td />
                </tr>
                <tr className="bg-gray-50">
                  <td colSpan="3" className="px-3 py-2.5 text-right text-gray-500 font-medium">Differens</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: balanced ? '#1a7a2e' : '#A32D2D' }}>{fmt(differens > 0 ? differens : 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: balanced ? '#1a7a2e' : '#A32D2D' }}>{fmt(differens < 0 ? -differens : 0)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Extra fält */}
        <div className="grid grid-cols-3 gap-4 mt-6 max-w-3xl ml-auto">
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Fakturaavgift</label><input className="input text-right" inputMode="decimal" value={avgift} onChange={e => setAvgift(e.target.value)} placeholder="0,00" /></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Frakt</label><input className="input text-right" inputMode="decimal" value={frakt} onChange={e => setFrakt(e.target.value)} placeholder="0,00" /></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Öresutjämning</label><input className="input text-right" inputMode="decimal" value={ores} onChange={e => setOres(e.target.value)} placeholder="0,00" /></div>
        </div>

        {/* Knapprad */}
        <div className="flex items-center mt-8 pt-5 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          <button className="btn" onClick={() => navigate('/leverantorsfakturor')}>Makulera</button>
          <button className="btn ml-2.5" disabled>Skapa kreditfaktura</button>
          <div className="ml-auto flex items-center gap-2.5">
            <button className="btn" onClick={() => navigate('/leverantorsfakturor')} disabled={saving}>Avbryt</button>
            <button className="btn btn-green" onClick={() => spara(false)} disabled={saving}>{saving ? '…' : 'Spara'}</button>
            <button id="lev-bokfor" className="btn btn-green px-6" onClick={() => spara(true)} disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); spara(true) } }}>{saving ? 'Bokför…' : 'Bokför'}</button>
          </div>
        </div>
      </div>
      </div>

      {panelOpen && (
        <UnderlagPanel company={company} attachIds={attachIds} onToggleAttach={toggleAttach} onTolkat={fyllFranTolkning} selectDocId={docId} title="KOPPLA BILD" width={panelWidth} onClose={() => setPanelOpen(false)} />
      )}

      {levEditor && (
        <LeverantorEditor company={company} prefill={levEditor}
          onCancel={() => setLevEditor(null)}
          onSaved={async (sup) => { setLevEditor(null); setLevForslag(null); await reloadSuppliers(); setSupplierId(sup.id) }} />
      )}
    </div>
  )
}
