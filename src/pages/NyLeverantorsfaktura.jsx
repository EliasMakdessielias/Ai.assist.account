import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import UnderlagPanel from '../components/UnderlagPanel'
import LeverantorEditor from '../components/LeverantorEditor'
import { tolkaDocument } from '../lib/tolka'
import { serie } from '../lib/serier'
import { missingKonteringAccounts, reactivatableAccounts, detectCreditInvoice, buildSupplierInvoicePosting, costRowsFromKontering, reconcileCostRows, buildKonteringFromPrevious, signedHeaderAmount, amountMagnitude } from '../lib/leverantorsfaktura'
import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrency } from '../lib/currency'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
// Normalisera Unicode-minus (sv-SE skriver negativa tal med U+2212) + streck till ASCII-minus,
// annars blir negativa visade belopp (t.ex. "−291,50") NaN → 0 vid återinläsning.
const num = v => { const n = parseFloat(String(v).replace(/[−‒–—―]/g, '-').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const emptyRow = () => ({ konto: '', namn: '', info: '', debet: '', kredit: '' })

export default function NyLeverantorsfaktura() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const docId = params.get('doc')
  const editId = params.get('edit')
  const autoTolka = params.get('tolka') === '1'
  const tolkadRef = useRef(false)
  const kreditManualRef = useRef(false)   // användaren har själv togglat Kreditfaktura → skriv inte över vid (om)tolkning
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
  const [kreditfaktura, setKreditfaktura] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attachIds, setAttachIds] = useState(docId ? [docId] : [])
  const [panelOpen, setPanelOpen] = useState(true)
  const [levForslag, setLevForslag] = useState(null)
  const [levEditor, setLevEditor] = useState(null)
  const [levOpen, setLevOpen] = useState(false)
  const [levQuery, setLevQuery] = useState('')
  const [prevKontering, setPrevKontering] = useState(null)   // { invoice, ver, rows, doc } från senaste bokförda fakturan
  const [prevOpen, setPrevOpen] = useState(false)
  const [prevLoading, setPrevLoading] = useState(false)
  const toggleAttach = id => setAttachIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  useEffect(() => { if (company) init() }, [company?.id])

  async function init() {
    const [{ data: acc }, { data: sup }, { data: inv }] = await Promise.all([
      supabase.from('accounts').select('account_nr, name, is_active, is_locked').eq('company_id', company.id).order('account_nr'),
      supabase.from('suppliers').select('id, name, org_nr, bankgiro, default_motkonto').eq('company_id', company.id).order('name'),
      supabase.from('supplier_invoices').select('lopnr').eq('company_id', company.id),
    ])
    setAccounts(acc || [])
    setSuppliers(sup || [])
    setNextLopnr(Math.max(0, ...(inv || []).map(i => i.lopnr || 0)) + 1)

    if (editId) {
      const { data: ex } = await supabase.from('supplier_invoices').select('*').eq('id', editId).single()
      if (ex) {
        const kredit = !!ex.kreditfaktura
        setKreditfaktura(kredit)
        const absTotal = Math.abs(ex.total_amount || 0), absMoms = Math.abs(ex.vat_amount || 0)
        setSupplierId(ex.supplier_id || '')
        setFakturadatum(ex.invoice_date || today())
        setForfallodatum(ex.due_date || today())
        setTotal(absTotal ? fmt(kredit ? -absTotal : absTotal) : '')
        setMoms(absMoms ? fmt(kredit ? -absMoms : absMoms) : '')
        setOcr(ex.ocr || '')
        setFakturanummer(ex.invoice_nr || '')
        setValuta(normalizeCurrency(ex.currency) || DEFAULT_CURRENCY)
        setNextLopnr(ex.lopnr)
        const amap = Object.fromEntries((acc || []).map(a => [a.account_nr, a.name]))
        const m = absMoms, net = absTotal - m
        // Kreditfaktura: omvända sidor (2440 debet, moms/kostnad kredit).
        const big = (d) => kredit ? { debet: '', kredit: d } : { debet: d, kredit: '' }
        const skuld = (d) => kredit ? { debet: d, kredit: '' } : { debet: '', kredit: d }
        const r = [{ konto: '2440', namn: 'Leverantörsskulder', info: '', ...skuld(absTotal ? fmt(absTotal) : '') }]
        if (m > 0.005) r.push({ konto: '2640', namn: amap['2640'] || 'Ingående moms', info: '', ...big(fmt(m)) })
        r.push({ konto: ex.kostnadskonto || '4000', namn: amap[ex.kostnadskonto || '4000'] || '', info: '', ...big(net > 0 ? fmt(net) : '') })
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

  // Hämta senaste BOKFÖRDA fakturan från samma leverantör (samma company_id) → "Kontering
  // från förra fakturan". RLS skyddar datan; explicit company_id-filter som extra skydd.
  // Endast bokförda fakturor med kopplad verifikation och faktiska bokföringsrader.
  useEffect(() => {
    if (!company || !supplierId) { setPrevKontering(null); setPrevOpen(false); return }
    let cancelled = false
    ;(async () => {
      setPrevLoading(true)
      const { data: inv } = await supabase.from('supplier_invoices')
        .select('id, invoice_date, created_at, verifikation_id, kreditfaktura')
        .eq('company_id', company.id).eq('supplier_id', supplierId).eq('bokford', true)
        .not('verifikation_id', 'is', null)
        .order('invoice_date', { ascending: false }).order('created_at', { ascending: false })
        .limit(1).maybeSingle()
      if (cancelled) return
      if (!inv?.verifikation_id) { setPrevKontering(null); setPrevLoading(false); return }
      const [{ data: vrows }, { data: ver }, { data: doc }] = await Promise.all([
        supabase.from('verifikation_rows').select('account_nr, account_name, debet, kredit, sort_order').eq('verifikation_id', inv.verifikation_id).order('sort_order'),
        supabase.from('verifikationer').select('ver_nr, datum').eq('id', inv.verifikation_id).maybeSingle(),
        supabase.from('documents').select('id, storage_path, file_name, mime_type').eq('company_id', company.id).eq('verifikation_id', inv.verifikation_id).limit(1).maybeSingle(),
      ])
      if (cancelled) return
      if (!vrows || !vrows.length) { setPrevKontering(null); setPrevLoading(false); return }
      setPrevKontering({ invoice: inv, ver: ver || null, rows: vrows, doc: doc || null })
      setPrevLoading(false)
    })()
    return () => { cancelled = true }
  }, [company?.id, supplierId])

  async function reloadSuppliers() {
    const { data } = await supabase.from('suppliers').select('id, name, org_nr, bankgiro, default_motkonto').eq('company_id', company.id).order('name')
    setSuppliers(data || [])
    return data || []
  }

  // Smart kontering: förifyll kostnadskonto från leverantörens fördefinierade motkonto.
  function applySupplier(sup) {
    setSupplierId(sup.id); setLevForslag(null); setLevOpen(false)
    const konto = sup.default_motkonto
    if (konto) setRows(rs => {
      const idx = rs.findIndex(r => !r.konto)
      if (idx < 0) return rs
      const n = rs.map((r, i) => i === idx ? { ...r, konto, namn: accMap[konto] || '' } : r)
      if (idx === n.length - 1) n.push(emptyRow())
      return n
    })
  }

  const accMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.account_nr, a.name])), [accounts])
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts])

  const sumDebet = rows.reduce((s, r) => s + num(r.debet), 0)
  const sumKredit = rows.reduce((s, r) => s + num(r.kredit), 0)
  const differens = sumDebet - sumKredit
  const balanced = Math.abs(differens) < 0.005 && sumDebet > 0

  function setRow(idx, patch) {
    // Uteslut debet/kredit på samma rad: sätts ett belopp > 0 på ena sidan töms
    // den andra automatiskt (samma regel som i verifikationer).
    const p = { ...patch }
    if ('debet' in p && num(p.debet) > 0) p.kredit = ''
    if ('kredit' in p && num(p.kredit) > 0) p.debet = ''
    setRows(rs => {
      const next = rs.map((r, i) => i === idx ? { ...r, ...p } : r)
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

  // Normal faktura: 2440 kredit = Total, 2640 debet = Moms.
  // Kreditfaktura: omvänt (2440 debet = Total, 2640 kredit = Moms). Auto vid blur.
  function syncHeader(nextTotal = total, nextMoms = moms, kredit = kreditfaktura) {
    // Magnituder: konteringsraderna ska alltid ha positiva belopp – tecknet på Total/Moms
    // i fakturahuvudet styr inte radbeloppen, utan kreditfaktura-flaggan styr SIDAN.
    const t = amountMagnitude(nextTotal), m = amountMagnitude(nextMoms)
    const skuldSide = kredit ? 'debet' : 'kredit', momsSide = kredit ? 'kredit' : 'debet'
    setRows(rs => {
      let next = rs.map(r => r.konto === '2440' ? { ...r, [skuldSide]: t ? fmt(t) : '', [momsSide]: '' } : r)
      const momsIdx = next.findIndex(r => r.konto === '2640')
      if (m > 0.005) {
        const momsRow = { [momsSide]: fmt(m), [skuldSide]: '' }
        if (momsIdx >= 0) next[momsIdx] = { ...next[momsIdx], ...momsRow }
        else { const ins = next.length > 1 ? 1 : next.length; next.splice(ins, 0, { konto: '2640', namn: accMap['2640'] || 'Ingående moms', info: '', debet: '', kredit: '', ...momsRow }) }
      } else if (momsIdx >= 0) next.splice(momsIdx, 1)
      if (!next.length || (next[next.length - 1].konto || next[next.length - 1].debet || next[next.length - 1].kredit)) next.push(emptyRow())
      return next
    })
  }

  // Bocka i/ur Kreditfaktura: vänd alla rader (debet<->kredit) så bokföringen blir en
  // kreditering, och teckenväxla Total/Moms i huvudet. Leverantör/datum/OCR/fakturanr/valuta
  // bevaras (separat state). Markerar manuellt val så (om)tolkning inte skriver över det.
  function toggleKredit() {
    kreditManualRef.current = true
    setKreditfaktura(k => {
      const next = !k
      setTotal(t => { const m = amountMagnitude(t); return m ? fmt(next ? -m : m) : t })
      setMoms(t => { const m = amountMagnitude(t); return m ? fmt(next ? -m : m) : t })
      return next
    })
    setRows(rs => rs.map(r => ({ ...r, debet: r.kredit, kredit: r.debet })))
  }

  // En rad får ALDRIG ha både debet och kredit. Om båda är satta läggs beloppet
  // på rätt sida: kostnad/moms på debet, leverantörsskuld (24xx) på kredit – och
  // omvänt om det är en kreditfaktura.
  function singleSide(r) {
    const d = num(r.debet), k = num(r.kredit)
    if (d > 0 && k > 0) {
      const isPayable = /^24/.test(String(r.konto || ''))
      const toKredit = kreditfaktura ? !isPayable : isPayable
      const val = fmt(Math.max(d, k))
      return { ...r, debet: toKredit ? '' : val, kredit: toKredit ? val : '' }
    }
    return r
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
        // Normal: fyll debet med (kredit−debet). Kreditfaktura: fyll kredit med (debet−kredit).
        if (kreditfaktura) { const restKredit = sd - sk; if (restKredit > 0.005) next[idx] = { ...next[idx], kredit: fmt(restKredit) } }
        else { const restDebet = sk - sd; if (restDebet > 0.005) next[idx] = { ...next[idx], debet: fmt(restDebet) } }
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
    // Valuta från underlaget: acceptera endast SEK/USD/GBP/EUR, annars flagga för manuell hantering.
    const valutaRaw = result.valuta || result.currency
    if (valutaRaw) {
      const norm = normalizeCurrency(valutaRaw)
      if (norm) setValuta(norm)
      else toast(`Valutan "${valutaRaw}" stöds inte – kontrollera manuellt (standard ${DEFAULT_CURRENCY} används)`, { icon: '⚠️', duration: 6000 })
    }
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
    // Kreditfaktura-detektion (sv/en-uttryck, 2440-på-debet, negativt belopp). Skriv INTE
    // över om användaren redan togglat Kreditfaktura manuellt.
    const credit = detectCreditInvoice(result)
    const isCredit = kreditManualRef.current ? kreditfaktura : credit.isCreditInvoice
    if (!kreditManualRef.current) setKreditfaktura(isCredit)

    // Magnituder för Total/Moms (abs → aldrig dubbel-negativ även om OCR redan gav minus).
    const kr = Array.isArray(result.konteringsrader) ? result.konteringsrader : []
    const { costRows, vatAccount } = costRowsFromKontering(kr)
    let T = amountMagnitude(result.belopp_inkl_moms ?? result.total ?? result.belopp ?? result.summa)
    let M = amountMagnitude(result.moms_belopp ?? result.moms ?? result.vat)
    if (!M && vatAccount) M = amountMagnitude(kr.filter(r => /^264/.test(String(r.konto || ''))).reduce((s, r) => s + Math.max(num(r.debet), num(r.kredit)), 0))
    if (!T) {
      const payable = kr.filter(r => /^244/.test(String(r.konto || ''))).reduce((s, r) => s + Math.max(num(r.debet), num(r.kredit)), 0)
      T = amountMagnitude(payable || (costRows.reduce((s, r) => s + r.amount, 0) + M))
    }
    // Stäm av kostnadsrader mot tillförlitligt netto (Total − Moms): OCR dubbelräknar ibland
    // (delsumma + enskild rad som redan ingår) → korrigeras så konteringen balanserar.
    let useCostRows = reconcileCostRows(costRows, T - M)
    if (!useCostRows.length && T) {
      const fallback = suppliers.find(s => s.id === supplierId)?.default_motkonto || '4000'
      useCostRows = [{ nr: fallback, name: accMap[fallback] || '', amount: amountMagnitude(T - M) }]
    }

    // Omvänd kontering vid kreditfaktura sköts centralt; öresutjämning får korrekt tecken.
    const posting = buildSupplierInvoicePosting({
      isCreditInvoice: isCredit, total: T, vat: M, rows: useCostRows,
      vatAccount: vatAccount || '2640', vatName: accMap[vatAccount || '2640'] || 'Ingående moms',
      payableName: accMap['2440'] || 'Leverantörsskulder',
    })

    setTotal(T ? fmt(signedHeaderAmount(T, isCredit)) : '')
    setMoms(M ? fmt(signedHeaderAmount(M, isCredit)) : '')
    const oresRow = posting.rows.find(r => r.nr === '3740')
    setOres(oresRow ? fmt(oresRow.debet || oresRow.kredit) : '')
    if (posting.rows.length) {
      setRows([
        ...posting.rows.map(r => ({ konto: r.nr, namn: accMap[r.nr] || r.name || '', info: r.info || '', debet: r.debet ? fmt(r.debet) : '', kredit: r.kredit ? fmt(r.kredit) : '' })),
        emptyRow(),
      ])
    }
    toast.success(isCredit ? 'Underlaget tolkat som KREDITFAKTURA – granska och bokför' : 'Underlaget tolkat – granska och klicka Bokför')
  }

  const supplier = suppliers.find(s => s.id === supplierId)
  const levFiltered = !levQuery.trim() ? suppliers : suppliers.filter(s => `${s.name} ${s.org_nr || ''}`.toLowerCase().includes(levQuery.toLowerCase()))

  function konteringRows() {
    return rows.filter(r => r.konto && (num(r.debet) > 0 || num(r.kredit) > 0))
      .map(r => singleSide(r))   // skydd: aldrig både debet och kredit på samma rad
      .map(r => ({ nr: r.konto, name: accMap[r.konto] || r.namn || '', info: r.info || '', debet: num(r.debet), kredit: num(r.kredit) }))
  }

  async function spara(bokfor) {
    if (!supplierId) return toast.error('Välj en leverantör')
    // Magnitud (positiv); tecknet i fakturahuvudet styrs av kreditfaktura-flaggan nedan.
    const t = amountMagnitude(total)
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
    // Alla konteringskonton måste finnas i kontoplanen innan vi bokför (annars
    // skapas verifikationsrader mot konton som inte existerar).
    const saknade = missingKonteringAccounts(krows, accounts.map(a => a.account_nr))
    if (bokfor && saknade.length) return toast.error(`Konto saknas i kontoplanen: ${saknade.join(', ')}. Lägg till kontot innan du bokför.`)
    const td = krows.reduce((s, r) => s + r.debet, 0), tk = krows.reduce((s, r) => s + r.kredit, 0)

    setSaving(true)
    try {
      // Kostnadskontot ligger på debet vid normal faktura, på kredit vid kreditfaktura.
      const costRow = krows.find(r => (kreditfaktura ? r.kredit > 0 : r.debet > 0) && r.nr !== '2640')
      const sign = kreditfaktura ? -1 : 1
      const invPayload = {
        company_id: company.id, supplier_id: supplierId, invoice_nr: fakturanummer || null, ocr: ocr || null,
        invoice_date: fakturadatum, due_date: forfallodatum, currency: isSupportedCurrency(valuta) ? valuta : DEFAULT_CURRENCY,
        amount_excl_vat: sign * (t - amountMagnitude(moms)), vat_amount: sign * amountMagnitude(moms), total_amount: sign * t,
        kostnadskonto: costRow?.nr || '4000', status: 'unpaid', lopnr: nextLopnr, kreditfaktura,
      }
      let inv, e0
      if (editId) ({ data: inv, error: e0 } = await supabase.from('supplier_invoices').update(invPayload).eq('id', editId).select().single())
      else ({ data: inv, error: e0 } = await supabase.from('supplier_invoices').insert(invPayload).select().single())
      if (e0) throw e0

      if (bokfor) {
        const ser = serie(company, 'leverantorsfakturor')
        const { data: nr, error: eNr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
        if (eNr) throw eNr
        const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
          company_id: company.id, ver_nr: nr || 'L' + Date.now(), ver_serie: ser,
          datum: fakturadatum, beskrivning: `${kreditfaktura ? 'Lev.kreditfaktura' : 'Lev.faktura'} ${supplier?.name || ''} ${fakturanummer || ''}`.trim(),
          total_debet: td, total_kredit: tk, created_by: user.id,
        }).select().single()
        if (e1) throw e1
        // Allt-eller-inget: misslyckas något steg efter att verifikationshuvudet skapats
        // raderas det (verifikation_rows tas via CASCADE, faktura/underlag återställs via
        // SET NULL + revert-triggern) så ingen halv-bokförd verifikation lämnas kvar.
        const rollbackVer = async (err) => { await supabase.from('verifikationer').delete().eq('id', ver.id); throw err }
        const { error: e2 } = await supabase.from('verifikation_rows').insert(krows.map((r, ix) => ({
          verifikation_id: ver.id, account_nr: r.nr, account_name: r.name, transaction_info: r.info || null, debet: r.debet, kredit: r.kredit, sort_order: ix,
        })))
        if (e2) await rollbackVer(e2)
        // Återaktivera endast inaktiva, ICKE-låsta konton. Låsta standardkonton (2440/2640)
        // skyddas av protect_locked_account-triggern och får aldrig uppdateras här. Best-effort.
        const react = reactivatableAccounts(krows, accounts)
        if (react.length) await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', react)
        if (attachIds.length) { const { error: e4 } = await supabase.from('documents').update({ verifikation_id: ver.id }).in('id', attachIds); if (e4) await rollbackVer(e4) }
        const { error: e5 } = await supabase.from('supplier_invoices').update({ bokford: true, verifikation_id: ver.id }).eq('id', inv.id)
        if (e5) await rollbackVer(e5)
        toast.success(`Leverantörsfaktura bokförd (${ver.ver_nr})`)
      } else {
        if (attachIds.length) toast('Sparad – bilden kopplas när fakturan bokförs', { icon: 'ℹ️' })
        else toast.success('Leverantörsfaktura sparad')
      }
      navigate('/leverantorsfakturor')
    } catch (e) { toast.error('Fel: ' + e.message) }
    setSaving(false)
  }

  // Använd kontostrukturen från förra fakturan på den aktuella. Räknar om beloppen från
  // NUVARANDE total/moms (gamla belopp kopieras aldrig). Bevarar leverantör/datum/OCR/
  // fakturanr/valuta/total/moms; respekterar kreditfaktura. Låsta konton återanvänds som de var.
  function anvandForraKontering() {
    if (!prevKontering?.rows?.length) return
    const res = buildKonteringFromPrevious(prevKontering.rows, { total, vat: moms, isCreditInvoice: kreditfaktura, accMap })
    if (!res.rows.length) return toast.error('Kunde inte tillämpa tidigare kontering')
    setRows([
      ...res.rows.map(r => ({ konto: r.nr, namn: accMap[r.nr] || r.name || '', info: r.info || '', debet: r.debet ? fmt(r.debet) : '', kredit: r.kredit ? fmt(r.kredit) : '' })),
      emptyRow(),
    ])
    const oresRow = res.rows.find(r => r.nr === '3740')
    setOres(oresRow ? fmt(oresRow.debet || oresRow.kredit) : '')
    if (res.needsManualAmounts) toast('Kontostruktur tillämpad. Beloppen behöver kontrolleras.', { icon: '⚠️', duration: 7000 })
    else toast.success('Kontering tillämpad från förra fakturan')
  }

  // Öppna tidigare fakturans underlag i ny flik (ersätter INTE nuvarande fakturas underlag).
  async function visaForraUnderlag() {
    const d = prevKontering?.doc
    if (!d?.storage_path) return
    const { data, error } = await supabase.storage.from('underlag').createSignedUrl(d.storage_path, 120)
    if (error || !data?.signedUrl) return toast.error('Kunde inte öppna det tidigare underlaget')
    window.open(data.signedUrl, '_blank', 'noopener')
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
        <label className={`flex items-center gap-1.5 text-[13px] cursor-pointer select-none ${kreditfaktura ? 'text-purple-700 font-medium' : 'text-gray-600 hover:text-gray-900'}`} title="Bocka i för att skapa en kreditfaktura (omvänd kontering)">
          <input type="checkbox" className="w-4 h-4 accent-purple-600" checked={kreditfaktura} onChange={toggleKredit} />
          <i className="ti ti-file-minus" /> Kreditfaktura
        </label>
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
                      onMouseDown={() => applySupplier(s)}>
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
              onChange={e => setTotal(e.target.value)} onBlur={e => { const mag = amountMagnitude(e.target.value); setTotal(mag ? fmt(kreditfaktura ? -mag : mag) : ''); syncHeader(mag, moms) }}
              onKeyDown={e => hEnter(e, 'lev-moms', () => { const mag = amountMagnitude(total); setTotal(mag ? fmt(kreditfaktura ? -mag : mag) : ''); syncHeader(mag, moms) })} placeholder="0,00" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Moms</label>
            <input id="lev-moms" className="input text-right" inputMode="decimal" value={moms}
              onChange={e => setMoms(e.target.value)} onBlur={e => { const mag = amountMagnitude(e.target.value); setMoms(mag ? fmt(kreditfaktura ? -mag : mag) : ''); syncHeader(total, mag) }}
              onKeyDown={e => hEnter(e, 'lev-ocr', () => { const mag = amountMagnitude(moms); setMoms(mag ? fmt(kreditfaktura ? -mag : mag) : ''); syncHeader(total, mag) })} placeholder="0,00" />
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
            <select className="input" value={valuta} onChange={e => setValuta(e.target.value)}>{SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
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
        {/* Kontering från förra fakturan – hopfällbar, mellan Ytterligare uppgifter och Kontoregistrering */}
        <div className="border-b mb-5" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
          <button className="flex items-center gap-2 text-sm font-medium text-gray-700 py-2 w-full" onClick={() => setPrevOpen(o => !o)}>
            <i className={`ti ti-chevron-${prevOpen ? 'down' : 'right'} text-green-700`} /> Kontering från förra fakturan
            {prevKontering && <span className="ml-1 text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 rounded-full">{prevKontering.rows.length}</span>}
          </button>
          {prevOpen && (
            <div className="pb-4">
              {!supplierId ? (
                <p className="text-sm text-gray-400 px-1 pb-1">Välj leverantör för att se tidigare kontering.</p>
              ) : prevLoading ? (
                <p className="text-sm text-gray-400 px-1 pb-1">Hämtar tidigare kontering…</p>
              ) : !prevKontering ? (
                <p className="text-sm text-gray-400 px-1 pb-1">Ingen tidigare kontering hittades för denna leverantör.</p>
              ) : (
                <>
                  <p className="text-[13px] text-gray-500 mb-3">
                    Tidigare kontering tas fram utifrån hur ni bokfört den senaste fakturan från leverantören.
                    {prevKontering.ver?.datum && <span className="text-gray-400"> · Bokförd {new Date(prevKontering.ver.datum).toLocaleDateString('sv-SE')}{prevKontering.ver?.ver_nr ? ` (${prevKontering.ver.ver_nr})` : ''}</span>}
                  </p>
                  <div className="bg-white rounded-xl overflow-hidden max-w-xl" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          <th className="text-left px-3 py-2 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                          <th className="text-left px-3 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kontobenämning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prevKontering.rows.map((r, i) => (
                          <tr key={i}>
                            <td className="border-b px-3 py-1.5 tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.account_nr}</td>
                            <td className="border-b px-3 py-1.5 text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{accMap[r.account_nr] || r.account_name || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2.5 mt-3">
                    <button className="btn" onClick={visaForraUnderlag} disabled={!prevKontering.doc}
                      title={prevKontering.doc ? 'Öppna tidigare fakturans underlag i ny flik' : 'Inget underlag finns kopplat till den tidigare fakturan.'}>
                      <i className="ti ti-photo" /> Visa underlag
                    </button>
                    <button className="btn btn-green" onClick={anvandForraKontering}><i className="ti ti-copy" /> Använd kontering</button>
                    {!prevKontering.doc && <span className="text-xs text-gray-400">Inget underlag finns kopplat till den tidigare fakturan.</span>}
                  </div>
                </>
              )}
            </div>
          )}
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
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const n = num(e.target.value); setRow(idx, { debet: n ? fmt(n) : '' }); n ? (balanced ? focusId('lev-bokfor') : focusId(`lev-konto-${idx + 1}`)) : focusId(`lev-kredit-${idx}`) } }} />
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
          {kreditfaktura && <span className="ml-2.5 text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded flex items-center gap-1"><i className="ti ti-file-minus" /> Kreditfaktura – omvänd kontering</span>}
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
        <UnderlagPanel company={company} attachIds={attachIds} onToggleAttach={toggleAttach} onTolkat={fyllFranTolkning} selectDocId={docId} title="KOPPLA BILD" widthKey="bokpilot.levfaktura.ny.viewerW" onClose={() => setPanelOpen(false)} />
      )}

      {levEditor && (
        <LeverantorEditor company={company} prefill={levEditor} docId={docId || attachIds[0]}
          onCancel={() => setLevEditor(null)}
          onSaved={async (sup) => { setLevEditor(null); setLevForslag(null); await reloadSuppliers(); setSupplierId(sup.id) }} />
      )}
    </div>
  )
}
