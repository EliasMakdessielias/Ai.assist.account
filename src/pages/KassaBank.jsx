import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { parseFile, parseAmount, parseDate, guessColumns } from '../lib/parseBank'
import { serie } from '../lib/serier'
import { foreslaKontoFromText } from '../lib/kontering'
import { ensureStandardBankAccounts, sortBankAccounts, DEFAULT_BANK_ACCOUNT } from '../lib/standardBankAccounts'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const today = () => new Date().toISOString().slice(0, 10)
const emptyKRow = () => ({ konto: '', debet: '', kredit: '' })
const KNOWN = { '2440': 'Leverantörsskulder', '1510': 'Kundfordringar', '1930': 'Företagskonto', '1910': 'Kassa' }

export default function KassaBank() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [allAccounts, setAllAccounts] = useState([])
  const [banktxAll, setBanktxAll] = useState([])
  const [openSup, setOpenSup] = useState([])
  const [openCust, setOpenCust] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ejbok')
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('Anpassad')
  const [from, setFrom] = useState('2018-01-01')
  const [tom, setTom] = useState(today())
  const [sel, setSel] = useState(new Set())
  const [rowMenu, setRowMenu] = useState(null)
  const [topMenu, setTopMenu] = useState(false)
  const [actMenu, setActMenu] = useState(false)
  const [working, setWorking] = useState(false)

  // Import
  const [impOpen, setImpOpen] = useState(false)
  const [impRows, setImpRows] = useState([])
  const [impHeader, setImpHeader] = useState(true)
  const [impMap, setImpMap] = useState({ datum: 0, text: 1, belopp: 2 })
  const [importing, setImporting] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [matchTx, setMatchTx] = useState(null)    // tx vi matchar i modalen
  const [mRows, setMRows] = useState([emptyKRow()])
  const [mBesk, setMBesk] = useState('')
  const [mDatum, setMDatum] = useState('')
  const [mForslag, setMForslag] = useState(null)
  const [payTx, setPayTx] = useState(null)        // tx vi väljer leverantörsfaktura för
  const [paySearch, setPaySearch] = useState('')
  const [transferTx, setTransferTx] = useState(null)  // tx vi matchar som överföring mellan egna konton
  const [transferSearch, setTransferSearch] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const fileRef = useRef()

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    // Säkerställ att standardkontona (1930, 1910, 1630) finns konfigurerade.
    await ensureStandardBankAccounts(supabase, company.id)
    const [{ data: ba }, { data: allAccs }, { data: btx }, { data: sup }, { data: cust }] = await Promise.all([
      supabase.from('bank_accounts').select('account_nr, namn, aktiv').eq('company_id', company.id),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).eq('is_active', true).order('account_nr'),
      supabase.from('bank_transactions').select('*').eq('company_id', company.id).order('datum', { ascending: false }),
      supabase.from('supplier_invoices').select('id, invoice_nr, ocr, due_date, total_amount, status, suppliers(name, bankgiro)').eq('company_id', company.id).eq('status', 'unpaid'),
      supabase.from('invoices').select('id, invoice_nr, total_amount, amount_excl_vat, vat_amount, status, customers(name)').eq('company_id', company.id).eq('status', 'sent'),
    ])
    // Endast konton som är inlagda under Inställningar → Kassa- och bankkonton.
    const baNrs = [...new Set((ba || []).filter(b => b.aktiv).map(b => b.account_nr).filter(Boolean))]
    const baNamn = Object.fromEntries((ba || []).map(b => [b.account_nr, b.namn]))
    const { data: chartAccs } = baNrs.length
      ? await supabase.from('accounts').select('account_nr, name, opening_balance').eq('company_id', company.id).in('account_nr', baNrs)
      : { data: [] }
    const byNr = Object.fromEntries((chartAccs || []).map(a => [a.account_nr, a]))
    // 1930 först (förvalt), sedan övriga standardkonton, sedan resten.
    const visibleAccs = sortBankAccounts(baNrs.map(nr => byNr[nr] || { account_nr: nr, name: baNamn[nr] || '', opening_balance: 0 }))
    setAccounts(visibleAccs)
    setAllAccounts(allAccs || [])
    setBanktxAll(btx || [])
    setOpenSup(sup || [])
    setOpenCust(cust || [])
    setSelected(prev => (prev && visibleAccs.some(a => a.account_nr === prev)) ? prev
      : (visibleAccs.find(a => a.account_nr === DEFAULT_BANK_ACCOUNT) || visibleAccs[0])?.account_nr || null)
    setSel(new Set())
    setLoading(false)
  }

  const accName = nr => allAccounts.find(a => a.account_nr === nr)?.name || accounts.find(a => a.account_nr === nr)?.name || KNOWN[nr] || ''
  const selAcc = accounts.find(a => a.account_nr === selected)
  const metod = company?.bokforingsmetod || 'faktura'

  async function bookMatch(tx, m) {
    const belopp = Math.abs(tx.amount)
    let rows
    if (m.type === 'sup') rows = [{ nr: '2440', d: belopp, k: 0 }, { nr: selected, d: 0, k: belopp }]
    else if (metod === 'kontant') {
      const ex = m.inv.amount_excl_vat || 0, vat = m.inv.vat_amount || 0
      rows = [{ nr: selected, d: belopp, k: 0 }, { nr: '3001', d: 0, k: ex }]
      if (vat > 0.0001) rows.push({ nr: '2611', d: 0, k: vat })
    } else rows = [{ nr: selected, d: belopp, k: 0 }, { nr: '1510', d: 0, k: belopp }]
    const ser = serie(company, m.type === 'sup' ? 'utbetalningar' : 'inbetalningar')
    const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
    const { data: ver, error } = await supabase.from('verifikationer').insert({
      company_id: company.id, ver_nr: nr || 'B' + Date.now(), ver_serie: ser,
      datum: tx.datum, beskrivning: m.summary.slice(0, 200), total_debet: belopp, total_kredit: belopp, created_by: user.id,
    }).select().single()
    if (error) { toast.error(error.message); return false }
    await supabase.from('verifikation_rows').insert(rows.map((r, i) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: accName(r.nr), debet: r.d, kredit: r.k, sort_order: i })))
    await supabase.from('bank_transactions').update({ status: 'booked', verifikation_id: ver.id }).eq('id', tx.id)
    if (m.type === 'sup') await supabase.from('supplier_invoices').update({ status: 'paid', paid_amount: m.inv.total_amount, paid_date: tx.datum, betalning_ver_id: ver.id }).eq('id', m.inv.id)
    else await supabase.from('invoices').update({ status: 'paid' }).eq('id', m.inv.id)
    return true
  }

  // Registrera utbetalning av en vald leverantörsfaktura direkt från bankhändelsen.
  async function betalaFaktura(tx, inv) {
    setPayTx(null)
    const belopp = Math.abs(tx.amount)
    const rows = [{ nr: '2440', d: belopp, k: 0 }, { nr: selected, d: 0, k: belopp }]
    setWorking(true)
    try {
      const ser = serie(company, 'utbetalningar')
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
      const { data: ver, error } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'B' + Date.now(), ver_serie: ser,
        datum: tx.datum, beskrivning: `Betalning av leverantörsfaktura ${inv.invoice_nr || ''} ${inv.suppliers?.name || ''}`.trim().slice(0, 200),
        total_debet: belopp, total_kredit: belopp, created_by: user.id,
      }).select().single()
      if (error) throw error
      await supabase.from('verifikation_rows').insert(rows.map((r, i) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: accName(r.nr), debet: r.d, kredit: r.k, sort_order: i })))
      await supabase.from('bank_transactions').update({ status: 'booked', verifikation_id: ver.id }).eq('id', tx.id)
      await supabase.from('supplier_invoices').update({ status: 'paid', paid_amount: inv.total_amount, paid_date: tx.datum, betalning_ver_id: ver.id }).eq('id', inv.id)
      toast.success('Utbetalning registrerad – fakturan markerad betald')
      load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setWorking(false)
  }

  // Överföring mellan egna bankkonton: matcha den valda bankhändelsen mot
  // motsvarande händelse på ett annat eget bankkonto och bokför BÅDA som EN
  // verifikation (D mottagande konto / K avsändande konto).
  async function bokforOverforing(tx, counter) {
    setTransferTx(null)
    if (Math.abs(Math.abs(tx.amount) - Math.abs(counter.amount)) > 0.01) return toast.error('Beloppen måste vara lika för en överföring')
    const belopp = Math.abs(tx.amount)
    const sending = tx.amount < 0 ? tx : counter      // pengar lämnar kontot (krediteras)
    const receiving = tx.amount < 0 ? counter : tx    // pengar in på kontot (debiteras)
    setWorking(true)
    try {
      const ser = serie(company, 'kassabank')
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
      const besk = `Överföring mellan egna bankkonton ${sending.account_nr} → ${receiving.account_nr}`
      const { data: ver, error } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'B' + Date.now(), ver_serie: ser,
        datum: receiving.datum || tx.datum, beskrivning: besk.slice(0, 200),
        total_debet: belopp, total_kredit: belopp, created_by: user.id,
      }).select().single()
      if (error) throw error
      await supabase.from('verifikation_rows').insert([
        { verifikation_id: ver.id, account_nr: receiving.account_nr, account_name: accName(receiving.account_nr), debet: belopp, kredit: 0, sort_order: 0 },
        { verifikation_id: ver.id, account_nr: sending.account_nr, account_name: accName(sending.account_nr), debet: 0, kredit: belopp, sort_order: 1 },
      ])
      await supabase.from('bank_transactions').update({ status: 'booked', verifikation_id: ver.id }).in('id', [tx.id, counter.id])
      toast.success(`Överföring bokförd (${ver.ver_nr}) – båda bankhändelserna markerade`)
      load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setWorking(false)
  }

  // Ångra en bokförd bankhändelse: radera verifikationen -> triggern återställer faktura + bankhändelse.
  async function angra(tx) {
    setRowMenu(null)
    if (!tx.verifikation_id) return
    if (!confirm('Ångra bokföringen? Verifikationen tas bort, händelsen blir ej bokförd igen och ev. fakturabetalning återställs.')) return
    const { error } = await supabase.from('verifikationer').delete().eq('id', tx.verifikation_id)
    if (error) return toast.error('Kunde inte ångra: ' + error.message)
    toast.success('Bokföring ångrad')
    load()
  }

  // Ta bort en hel inläsning (batch) – bara om inget i den är bokfört.
  async function deleteBatch(b) {
    if (b.bookedCount > 0) return toast.error('Ångra bokföringen av raderna först')
    if (!confirm(`Ta bort inläsningen (${b.count} bankhändelser)?`)) return
    const { error } = await supabase.from('bank_transactions').delete().eq('company_id', company.id).eq('import_batch', b.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Inläsning borttagen'); load()
  }
  async function bokforMatch(tx, m) { setWorking(true); const ok = await bookMatch(tx, m); setWorking(false); if (ok) { toast.success('Bokförd'); load() } }
  async function bokforAlla() {
    const matched = ejbok.map(t => ({ t, m: matchFor(t) })).filter(x => x.m)
    if (!matched.length) return toast.error('Inga matchade händelser att bokföra')
    setWorking(true); let n = 0
    for (const { t, m } of matched) { if (await bookMatch(t, m)) n++ }
    setWorking(false); toast.success(`${n} händelser bokförda`); load()
  }
  function matcha(tx) {
    const p = new URLSearchParams({ banktx: tx.id, bankkonto: selected, bankdatum: tx.datum, bankbelopp: String(tx.amount), banktext: tx.text || '' })
    navigate(`/bokforing/ny?${p.toString()}`)
  }

  // Inline-matchning (modal): bygg kontering mot bankhändelsen.
  function openMatch(tx) {
    setRowMenu(null)
    const m = matchFor(tx)
    setMatchTx(tx)
    setMBesk((m?.summary || tx.text || '').slice(0, 200))
    setMDatum(tx.datum)
    setMForslag(null)
    const motkonto = m ? (m.type === 'sup' ? '2440' : (metod === 'kontant' ? '3001' : '1510')) : ''
    setMRows(motkonto ? [{ konto: motkonto, debet: '', kredit: '' }, emptyKRow()] : [emptyKRow()])
    // Smart kontering med minne: föreslå kostnadskonto från historik (för kostnader utan fakturamatch)
    if (!m && tx.amount < 0 && tx.text) {
      const belopp = Math.abs(tx.amount)
      foreslaKontoFromText(company.id, tx.text).then(res => {
        if (res) { setMForslag(res); setMRows([{ konto: res.konto, debet: fmt(belopp), kredit: '' }, emptyKRow()]) }
      })
    }
  }
  function setMRow(idx, patch) {
    setMRows(rs => {
      const next = rs.map((r, i) => i === idx ? { ...r, ...patch } : r)
      if (!next.length || next[next.length - 1].konto || next[next.length - 1].debet || next[next.length - 1].kredit) next.push(emptyKRow())
      return next
    })
  }
  function mKontoBlur(idx) {
    if (!matchTx) return
    setMRows(rs => {
      const r = rs[idx]; if (!r.konto || num(r.debet) || num(r.kredit)) return rs
      const side = matchTx.amount < 0 ? 'debet' : 'kredit'   // motkontot ligger på motsatt sida mot banken
      const belopp = Math.abs(matchTx.amount)
      const filled = rs.reduce((s, x, i) => i === idx ? s : s + num(x[side]), 0)
      const rest = Math.round((belopp - filled) * 100) / 100
      const next = rs.map((x, i) => i === idx ? { ...x, [side]: rest > 0.005 ? fmt(rest) : '' } : x)
      if (!next.length || next[next.length - 1].konto || next[next.length - 1].debet || next[next.length - 1].kredit) next.push(emptyKRow())
      return next
    })
  }
  async function bokforMatcha() {
    if (!matchTx) return
    const belopp = Math.abs(matchTx.amount)
    const bankRow = matchTx.amount < 0 ? { nr: selected, d: 0, k: belopp } : { nr: selected, d: belopp, k: 0 }
    const mot = mRows.filter(r => r.konto && (num(r.debet) || num(r.kredit))).map(r => ({ nr: r.konto, d: num(r.debet), k: num(r.kredit) }))
    if (!mot.length) return toast.error('Lägg till minst ett motkonto')
    const all = [bankRow, ...mot]
    const td = all.reduce((s, r) => s + r.d, 0), tk = all.reduce((s, r) => s + r.k, 0)
    if (Math.abs(td - tk) > 0.01) return toast.error('Konteringen måste balansera (differens 0)')
    setWorking(true)
    try {
      const ser = serie(company, 'kassabank')
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
      const { data: ver, error } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'B' + Date.now(), ver_serie: ser,
        datum: mDatum, beskrivning: (mBesk || matchTx.text || 'Bankhändelse').slice(0, 200), total_debet: td, total_kredit: tk, created_by: user.id,
      }).select().single()
      if (error) throw error
      await supabase.from('verifikation_rows').insert(all.map((r, i) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: accName(r.nr), debet: r.d, kredit: r.k, sort_order: i })))
      await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', [...new Set(all.map(r => r.nr))]).eq('is_active', false)
      await supabase.from('bank_transactions').update({ status: 'booked', verifikation_id: ver.id }).eq('id', matchTx.id)
      toast.success(`Bankhändelse bokförd (${ver.ver_nr})`)
      setMatchTx(null); load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setWorking(false)
  }
  async function setBtxStatus(t, status) { setRowMenu(null); await supabase.from('bank_transactions').update({ status }).eq('id', t.id); load() }
  async function removeBtx(t) { setRowMenu(null); if (!confirm('Ta bort den inlästa transaktionen?')) return; await supabase.from('bank_transactions').delete().eq('id', t.id); load() }

  // --- Bulk ---
  async function bulkBokfor() {
    setActMenu(false)
    const items = rows.filter(t => sel.has(t.id)).map(t => ({ t, m: matchFor(t) })).filter(x => x.m)
    if (!items.length) return toast.error('Inga markerade har en föreslagen matchning')
    setWorking(true); let n = 0
    for (const { t, m } of items) { if (await bookMatch(t, m)) n++ }
    setWorking(false); toast.success(`${n} bokförda`); setSel(new Set()); load()
  }
  async function bulkIgnorera() { setActMenu(false); const ids = [...sel]; if (!ids.length) return; await supabase.from('bank_transactions').update({ status: 'ignored' }).in('id', ids); toast.success('Ignorerade'); setSel(new Set()); load() }
  async function bulkRadera() { setActMenu(false); const ids = [...sel]; if (!ids.length || !confirm(`Ta bort ${ids.length} bankhändelser?`)) return; await supabase.from('bank_transactions').delete().in('id', ids); toast.success('Borttagna'); setSel(new Set()); load() }

  // --- Import ---
  function startImport(text) {
    const { rows } = parseFile(text)
    if (!rows.length) return toast.error('Hittade inga rader')
    setImpRows(rows); setImpMap(guessColumns(rows)); setImpHeader(true); setImpOpen(true)
  }
  function onFile(e) { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const r = new FileReader(); r.onload = () => startImport(String(r.result)); r.readAsText(file, 'utf-8') }
  function parsedImport() {
    const data = impHeader ? impRows.slice(1) : impRows
    return data.map(r => ({ datum: parseDate(r[impMap.datum]), text: (r[impMap.text] || '').slice(0, 200), amount: parseAmount(r[impMap.belopp]) })).filter(t => t.datum && t.amount != null)
  }
  async function doImport() {
    const txs = parsedImport()
    if (!txs.length) return toast.error('Inga giltiga rader – kontrollera kolumnvalen')
    setImporting(true)
    const batch = crypto.randomUUID()
    const { error } = await supabase.from('bank_transactions').insert(txs.map(t => ({ company_id: company.id, account_nr: selected, datum: t.datum, text: t.text, amount: t.amount, status: 'unmatched', import_batch: batch })))
    setImporting(false)
    if (error) return toast.error('Kunde inte importera: ' + error.message)
    toast.success(`${txs.length} bankhändelser inlästa`)
    setImpOpen(false); setImpRows([]); setPasteText(''); setTab('ejbok'); load()
  }

  function applyPeriod(p) {
    setPeriod(p)
    const y = new Date().getFullYear()
    if (p === 'Innevarande år') { setFrom(`${y}-01-01`); setTom(`${y}-12-31`) }
    else if (p === 'Föregående år') { setFrom(`${y - 1}-01-01`); setTom(`${y - 1}-12-31`) }
  }

  // Härledningar
  const accBtxAll = banktxAll.filter(t => t.account_nr === selected)

  // --- Smart, unik matchning ---
  // Belopp måste stämma (full betalning). OCR / fakturanr / bankgiro / namn används
  // för att hitta RÄTT faktura bland flera med samma belopp och ge högre säkerhet.
  const digitsRuns = s => (String(s || '').match(/\d{3,}/g) || []).map(d => d.replace(/\D/g, ''))
  const normName = s => String(s || '').toLowerCase()
    .replace(/\b(ab|hb|kb|aktiebolag|filial|försäkring|forsakring|sverige)\b/g, ' ')
    .replace(/[^a-zåäö0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

  function scoreInv(tx, inv, type) {
    if (Math.abs((inv.total_amount || 0) - Math.abs(tx.amount)) > 0.01) return null // belopp är krav
    const txt = ' ' + (tx.text || '').toLowerCase() + ' '
    const txd = digitsRuns(tx.text)
    const party = type === 'sup' ? inv.suppliers : inv.customers
    let s = 40; const reasons = ['belopp']
    const ocr = String(inv.ocr || '').replace(/\D/g, '')
    if (ocr.length >= 6 && txd.some(d => d === ocr || d.includes(ocr) || ocr.includes(d))) { s += 100; reasons.unshift('OCR') }
    const fn = String(inv.invoice_nr || '').replace(/\D/g, '')
    if (fn.length >= 4 && txd.some(d => d === fn)) { s += 60; reasons.unshift('fakturanr') }
    const bg = String(party?.bankgiro || '').replace(/\D/g, '')
    if (bg.length >= 6 && txd.some(d => d === bg || d.includes(bg))) { s += 70; reasons.unshift('bankgiro') }
    const toks = normName(party?.name).split(' ').filter(t => t.length >= 4)
    if (toks.length && toks.some(t => txt.includes(t))) { s += 30; reasons.push('namn') }
    if (inv.due_date) { const dd = Math.abs((new Date(tx.datum) - new Date(inv.due_date)) / 86400000); if (dd <= 12) s += 10 }
    return { s, reasons }
  }

  const suggestions = (() => {
    const triples = []
    for (const tx of accBtxAll) {
      if (tx.status !== 'unmatched' || Math.abs(tx.amount) < 0.01) continue
      const type = tx.amount < 0 ? 'sup' : 'cust'
      if (type === 'sup' && metod !== 'faktura') continue
      const list = type === 'sup' ? openSup : openCust
      for (const inv of list) {
        const sc = scoreInv(tx, inv, type)
        if (sc) triples.push({ txId: tx.id, invId: inv.id, type, inv, score: sc.s, reasons: sc.reasons })
      }
    }
    triples.sort((a, b) => b.score - a.score || String(a.txId).localeCompare(String(b.txId)))
    const usedTx = new Set(), usedInv = new Set(), res = {}
    for (const t of triples) {
      if (usedTx.has(t.txId) || usedInv.has(t.invId)) continue
      usedTx.add(t.txId); usedInv.add(t.invId)
      const party = (t.type === 'sup' ? t.inv.suppliers : t.inv.customers)?.name || ''
      const summary = t.type === 'sup'
        ? `${t.inv.invoice_nr || ''} Betalning av leverantörsfaktura ${party}`.trim()
        : `${t.inv.invoice_nr || ''} Betalning av kundfaktura ${party}`.trim()
      res[t.txId] = { type: t.type, inv: t.inv, summary, reasons: t.reasons, score: t.score }
    }
    return res
  })()

  const matchFor = tx => (tx.status === 'unmatched' ? (suggestions[tx.id] || null) : null)

  // Förslag: överföring mellan egna bankkonton – unik motpost (motsatt tecken,
  // samma belopp) på ett ANNAT konfigurerat bankkonto.
  const transferSuggestionFor = tx => {
    if (!tx || tx.status === 'booked') return null
    const cfg = new Set(accounts.map(a => a.account_nr))
    const cands = banktxAll.filter(t => t.id !== tx.id && t.account_nr !== tx.account_nr
      && cfg.has(t.account_nr) && t.status !== 'booked'
      && Math.sign(t.amount) !== Math.sign(tx.amount)
      && Math.abs(Math.abs(t.amount) - Math.abs(tx.amount)) < 0.01)
    cands.sort((a, b) => Math.abs(new Date(a.datum) - new Date(tx.datum)) - Math.abs(new Date(b.datum) - new Date(tx.datum)))
    return cands[0] || null
  }

  const inRange = t => (!from || t.datum >= from) && (!tom || t.datum <= tom)
  const matchSearch = t => !search || `${t.datum} ${t.text || ''} ${fmt(t.amount)}`.toLowerCase().includes(search.toLowerCase())
  const accBtx = accBtxAll.filter(t => inRange(t) && matchSearch(t))
  const ejbok = accBtx.filter(t => t.status !== 'booked')
  const periodens = accBtx.filter(t => t.status === 'booked')
  const rows = tab === 'ejbok' ? ejbok : periodens
  const ejBokCount = accBtx.filter(t => t.status !== 'booked').length
  const matchadeAntal = ejbok.filter(t => matchFor(t)).length

  const openingBalance = selAcc?.opening_balance || 0
  const kontoutdragSaldo = openingBalance + accBtxAll.reduce((s, t) => s + (t.amount || 0), 0)
  const saldoDatum = accBtxAll.reduce((d, t) => t.datum > d ? t.datum : d, '') || today()

  // Inlästa filer (batcher) för valt konto
  const batches = Object.values(accBtxAll.reduce((acc, t) => {
    if (!t.import_batch) return acc
    const b = (acc[t.import_batch] ||= { id: t.import_batch, count: 0, bookedCount: 0, datum: t.imported_at || t.datum, minDatum: t.datum, maxDatum: t.datum, sum: 0 })
    b.count++; if (t.status === 'booked') b.bookedCount++
    b.sum += t.amount || 0
    if (t.datum < b.minDatum) b.minDatum = t.datum
    if (t.datum > b.maxDatum) b.maxDatum = t.datum
    return acc
  }, {})).sort((a, b) => String(b.datum).localeCompare(String(a.datum)))

  const payCandidates = openSup.filter(i => !paySearch || `${i.invoice_nr || ''} ${i.suppliers?.name || ''} ${fmt(i.total_amount)}`.toLowerCase().includes(paySearch.toLowerCase()))
    .sort((a, b) => Math.abs((a.total_amount || 0) - Math.abs(payTx?.amount || 0)) - Math.abs((b.total_amount || 0) - Math.abs(payTx?.amount || 0)))

  // Kandidater för överföring mellan egna konton: händelser på ANDRA konfigurerade
  // bankkonton, med motsatt tecken, ej bokförda. Exakt matchande belopp först.
  const configuredNrs = accounts.map(a => a.account_nr)
  const transferCandidates = transferTx ? banktxAll
    .filter(t => t.id !== transferTx.id && t.account_nr !== transferTx.account_nr && configuredNrs.includes(t.account_nr)
      && t.status !== 'booked' && Math.sign(t.amount) !== Math.sign(transferTx.amount) && Math.abs(t.amount) > 0.0001)
    .filter(t => !transferSearch || `${t.datum} ${t.text || ''} ${fmt(t.amount)} ${t.account_nr}`.toLowerCase().includes(transferSearch.toLowerCase()))
    .sort((a, b) => (Math.abs(Math.abs(a.amount) - Math.abs(transferTx.amount)) - Math.abs(Math.abs(b.amount) - Math.abs(transferTx.amount))) || String(b.datum).localeCompare(String(a.datum)))
    : []

  const allSelected = rows.length > 0 && rows.every(t => sel.has(t.id))
  const toggleSel = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => { const ids = rows.map(t => t.id); setSel(s => { const n = new Set(s); ids.forEach(i => allSelected ? n.delete(i) : n.add(i)); return n }) }
  const previewCols = impRows[0]?.length || 0

  return (
    <div className="pb-20" onClick={() => { setRowMenu(null); setActMenu(false); setTopMenu(false) }}>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kassa- och bankhändelser</span>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <div className="flex items-stretch rounded-lg overflow-hidden" style={{ background: '#6d28d9' }}>
            <button className="text-white text-sm font-medium px-4 py-2 hover:brightness-110" onClick={() => { setPasteText(''); setPasteOpen(true) }}>
              <i className="ti ti-clipboard mr-1.5" /> Klistra in kontoutdrag
            </button>
            <button className="text-white px-2 border-l border-white/25 hover:brightness-110" onClick={() => setTopMenu(o => !o)}><i className="ti ti-chevron-down" /></button>
          </div>
          {topMenu && (
            <div className="absolute right-0 mt-1 bg-white rounded-lg shadow-xl z-30 w-52 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
              <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2" onClick={() => { setTopMenu(false); fileRef.current?.click() }}><i className="ti ti-file-upload" /> Läs in fil (CSV)</button>
              <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2" onClick={() => { setTopMenu(false); setBatchOpen(true) }}><i className="ti ti-files" /> Hantera inläsningar…</button>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden" onChange={onFile} />
        </div>
      </div>

      {/* Tabbar */}
      <div className="px-7 pt-5 flex gap-3">
        {[['period', `Periodens bankhändelser`, periodens.length], ['ejbok', `Ej bokförda bankhändelser`, ejBokCount]].map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${tab === k ? 'text-purple-900' : 'text-gray-600 hover:bg-gray-50'}`}
            style={{ background: tab === k ? 'rgba(109,40,217,0.14)' : '#fff', border: '0.5px solid rgba(0,0,0,0.10)' }}>
            {label} <span className={`text-[11px] font-semibold px-1.5 rounded-full ${tab === k ? 'bg-purple-700 text-white' : 'bg-gray-200 text-gray-600'}`}>{n}</span>
          </button>
        ))}
      </div>

      {/* Filterrad */}
      <div className="px-7 py-4 grid grid-cols-[1fr_1.4fr_1.2fr] gap-5 items-start">
        <div className="relative">
          <input className="input pl-8" placeholder="Sök" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>
        <div>
          <div className="grid grid-cols-[80px_1fr] items-center gap-3">
            <label className="text-sm text-gray-600">Konto</label>
            <select className="input" value={selected || ''} onChange={e => { setSelected(e.target.value); setSel(new Set()) }}>
              {accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-[90px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">Period</label>
          <select className="input" value={period} onChange={e => applyPeriod(e.target.value)}>
            <option>Anpassad</option><option>Innevarande år</option><option>Föregående år</option>
          </select>
          <label className="text-sm text-gray-600">Bokföringsdatum</label>
          <div className="flex items-center gap-2">
            <input className="input" type="date" value={from} onChange={e => { setFrom(e.target.value); setPeriod('Anpassad') }} />
            <span className="text-gray-400">–</span>
            <input className="input" type="date" value={tom} onChange={e => { setTom(e.target.value); setPeriod('Anpassad') }} />
          </div>
        </div>
      </div>

      {/* Summeringsrad */}
      <div className="px-7 flex items-end justify-between mb-2">
        <div>
          <div className="text-[13px] font-medium text-gray-700">Bankhändelser på kontoutdraget</div>
          <div className="text-[15px] font-bold tabular-nums">{fmt(kontoutdragSaldo)}</div>
          <div className="text-[11px] text-gray-400">Saldo per {saldoDatum}</div>
        </div>
        <div className="text-right">
          <div className="text-[13px] font-medium text-gray-700">Bokföringshändelser</div>
          <div className="text-[12px] text-gray-500">{ejBokCount} av {accBtx.length} händelser är ej bokförda</div>
        </div>
      </div>

      {/* Tabell */}
      <div className="px-7">
        {loading ? <div className="text-gray-400 py-12 text-center">Laddar…</div>
          : !selected ? (
            <div className="text-center py-16 text-gray-400"><i className="ti ti-building-bank text-4xl block mb-3 opacity-30" />Inga kassa-/bankkonton.</div>
          ) : (
            <div className="bg-white rounded-xl overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2.5 border-b w-8 text-center" style={{ borderColor: 'rgba(0,0,0,0.10)' }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                    <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Datum</th>
                    <th className="text-left px-4 py-2.5 border-b w-56" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Referens</th>
                    <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                    <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Sammanfattning</th>
                    <th className="text-right px-4 py-2.5 border-b w-52" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan="6" className="text-center py-12 text-gray-400">{tab === 'ejbok' ? 'Inga ej bokförda bankhändelser. Klistra in ett kontoutdrag.' : 'Inga bokförda bankhändelser i perioden.'}</td></tr>
                  ) : rows.map(t => {
                    const m = matchFor(t)
                    const booked = t.status === 'booked'
                    const ts = (!booked && !m) ? transferSuggestionFor(t) : null
                    return (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} /></td>
                        <td className="px-4 py-2.5 border-b text-gray-600 whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.datum}</td>
                        <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.text}</td>
                        <td className="px-4 py-2.5 border-b text-right tabular-nums font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)', color: t.amount >= 0 ? '#1a7a2e' : '#b91c1c' }}>{fmt(t.amount)}</td>
                        <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                          {booked ? <span className="text-gray-500">Bokförd</span>
                            : m ? (
                              <span className="flex items-center gap-2">
                                <span className="text-blue-700">{m.summary}</span>
                                {m.reasons && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.reasons.some(r => ['OCR', 'bankgiro', 'fakturanr'].includes(r)) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>via {m.reasons[0]}</span>}
                              </span>
                            )
                            : ts ? (
                              <span className="flex items-center gap-2">
                                <span className="text-purple-800">Överföring mellan egna bankkonton → {ts.account_nr} {accName(ts.account_nr)} ({ts.datum})</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">överföring</span>
                              </span>
                            )
                            : <span className="text-gray-400 italic">Ingen överensstämmande bokföringshändelse hittad</span>}
                        </td>
                        <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {!booked && <button className="text-gray-300 hover:text-gray-600" title="Matcha mot underlag" onClick={() => matcha(t)}><i className="ti ti-upload" /></button>}
                            {booked ? (
                              <>
                                <button className="text-blue-700 text-xs hover:underline" onClick={() => navigate(`/bokforing/${t.verifikation_id}`)}><i className="ti ti-link" /> Visa</button>
                                <button className="text-xs text-gray-500 hover:text-red-600 hover:underline" onClick={() => angra(t)}><i className="ti ti-arrow-back-up" /> Ångra</button>
                              </>
                            ) : m ? (
                              <button className="text-white text-xs font-medium px-4 py-1.5 rounded-md" style={{ background: '#6d28d9' }} onClick={() => bokforMatch(t, m)} disabled={working}>Bokför</button>
                            ) : (
                              <div className="relative flex items-center gap-1">
                                {ts && <button className="text-white text-xs font-medium px-3 py-1.5 rounded-md" style={{ background: '#6d28d9' }} onClick={() => bokforOverforing(t, ts)} disabled={working} title={`Bokför som överföring mot ${ts.account_nr} (${ts.datum})`}>Bokför överföring</button>}
                                <div className="flex items-stretch rounded-md overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.18)' }}>
                                  <button className="text-sm px-3 py-1 hover:bg-gray-50" onClick={() => openMatch(t)}>Matcha</button>
                                  <button className="px-1.5 border-l hover:bg-gray-50" style={{ borderColor: 'rgba(0,0,0,0.12)' }} onClick={() => setRowMenu(rowMenu === t.id ? null : t.id)}><i className="ti ti-chevron-down text-xs" /></button>
                                </div>
                                {rowMenu === t.id && (
                                  <div className="absolute right-0 mt-1 bg-white rounded-lg shadow-xl z-30 w-56 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => openMatch(t)}>Matcha / kontera…</button>
                                    {t.amount < 0 && <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-purple-800" onClick={() => { setRowMenu(null); setPaySearch(''); setPayTx(t) }}><i className="ti ti-cash mr-1.5" />Betala leverantörsfaktura…</button>}
                                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-purple-800" onClick={() => { setRowMenu(null); setTransferSearch(''); setTransferTx(t) }}><i className="ti ti-arrows-exchange mr-1.5" />Överföring mellan egna bankkonton…</button>
                                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => matcha(t)}>Öppna i bokföringen</button>
                                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => setBtxStatus(t, 'ignored')}>Ignorera</button>
                                    <button className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-50" onClick={() => removeBtx(t)}>Ta bort</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Bottenrad */}
      {selected && (
        <div className="fixed bottom-0 left-[230px] right-0 bg-white border-t px-7 py-3 flex items-center gap-3 z-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }} onClick={e => e.stopPropagation()}>
          <button className="text-white text-sm font-medium px-5 py-2 rounded-lg" style={{ background: '#6d28d9' }} disabled={working || matchadeAntal === 0} onClick={bokforAlla}>
            {working ? 'Bokför…' : `Bokför alla${matchadeAntal ? ` (${matchadeAntal})` : ''}`}
          </button>
          <div className="relative">
            <button className="btn" onClick={() => setActMenu(o => !o)}>Åtgärder <i className="ti ti-chevron-up text-xs ml-1" /></button>
            {actMenu && (
              <div className="absolute bottom-full left-0 mb-1 bg-white rounded-lg shadow-xl z-30 w-52 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:text-gray-300" disabled={!sel.size} onClick={bulkBokfor}>Bokför markerade (matchade)</button>
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:text-gray-300" disabled={!sel.size} onClick={bulkIgnorera}>Ignorera markerade</button>
                <button className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-50 disabled:text-gray-300" disabled={!sel.size} onClick={bulkRadera}>Ta bort markerade</button>
              </div>
            )}
          </div>
          {sel.size > 0 && <span className="text-sm text-gray-500">{sel.size} markerade</span>}
          <span className="ml-auto text-sm text-gray-500">{rows.length} av {accBtx.length} poster visas</span>
        </div>
      )}

      {/* Klistra in kontoutdrag */}
      {pasteOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPasteOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Klistra in kontoutdrag → {selAcc?.account_nr} {selAcc?.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setPasteOpen(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-500 mb-2">Kopiera raderna från din internetbank (datum, text, belopp) och klistra in. Tabb-, komma- eller semikolon­separerat fungerar.</p>
              <textarea className="input font-mono text-xs" rows={10} value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={'2026-05-21\tLÖNER\t-32000,00'} autoFocus />
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setPasteOpen(false)}>Avbryt</button>
              <button className="btn btn-primary" onClick={() => { setPasteOpen(false); startImport(pasteText) }} disabled={!pasteText.trim()}>Fortsätt</button>
            </div>
          </div>
        </div>
      )}

      {/* Import: kolumnmappning */}
      {impOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !importing && setImpOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Granska och läs in → {selAcc?.account_nr} {selAcc?.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setImpOpen(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 border-b flex flex-wrap items-end gap-4" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={impHeader} onChange={e => { setImpHeader(e.target.checked); if (e.target.checked) setImpMap(guessColumns(impRows)) }} /> Första raden är rubrik</label>
              {['datum', 'text', 'belopp'].map(f => (
                <div key={f}>
                  <label className="block text-xs font-medium text-gray-500 mb-1 capitalize">{f}-kolumn</label>
                  <select className="input w-40 py-1.5" value={impMap[f]} onChange={e => setImpMap(m => ({ ...m, [f]: parseInt(e.target.value, 10) }))}>
                    {Array.from({ length: previewCols }).map((_, i) => <option key={i} value={i}>{impHeader ? (impRows[0][i] || `Kolumn ${i + 1}`) : `Kolumn ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
              <div className="text-sm text-gray-500 ml-auto">{parsedImport().length} giltiga rader</div>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              <table className="w-full text-xs">
                <tbody>
                  {impRows.slice(0, 10).map((r, ri) => (
                    <tr key={ri} className={ri === 0 && impHeader ? 'font-semibold text-gray-500' : ''}>
                      {r.map((c, ci) => <td key={ci} className={`px-2 py-1 border-b truncate max-w-[160px] ${[impMap.datum, impMap.text, impMap.belopp].includes(ci) ? 'bg-blue-50' : ''}`} style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {impRows.length > 10 && <div className="text-xs text-gray-400 mt-2">… och {impRows.length - 10} rader till</div>}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setImpOpen(false)} disabled={importing}>Avbryt</button>
              <button className="btn btn-primary" onClick={doImport} disabled={importing}>{importing ? 'Läser in…' : `Läs in ${parsedImport().length} bankhändelser`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Matcha bankhändelse – inline kontering */}
      {matchTx && (() => {
        const belopp = Math.abs(matchTx.amount)
        const motSide = matchTx.amount < 0 ? 'debet' : 'kredit'
        const bankRow = matchTx.amount < 0 ? { d: 0, k: belopp } : { d: belopp, k: 0 }
        const motD = mRows.reduce((s, r) => s + num(r.debet), 0)
        const motK = mRows.reduce((s, r) => s + num(r.kredit), 0)
        const sumD = bankRow.d + motD, sumK = bankRow.k + motK
        const diff = Math.round((sumD - sumK) * 100) / 100
        const kvar = Math.round((belopp - (motSide === 'debet' ? motD : motK)) * 100) / 100
        const balanced = Math.abs(diff) < 0.01 && mRows.some(r => r.konto)
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setMatchTx(null)}>
            <datalist id="kb-konton">{allAccounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}</datalist>
            <div className="bg-white rounded-xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <span className="text-base font-medium">Matcha bankhändelse</span>
                <button className="text-gray-400 hover:text-gray-700" onClick={() => setMatchTx(null)}><i className="ti ti-x" /></button>
              </div>

              <div className="px-5 py-3 border-b bg-gray-50" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Bankhändelse från kontoutdraget</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{matchTx.datum} · {matchTx.text}</span>
                  <span className="tabular-nums font-semibold" style={{ color: matchTx.amount < 0 ? '#b91c1c' : '#1a7a2e' }}>{fmt(matchTx.amount)}</span>
                </div>
              </div>

              <div className="px-5 py-4 overflow-y-auto">
                <div className="grid grid-cols-[160px_1fr] gap-3 mb-4 max-w-2xl">
                  <label className="text-sm text-gray-600 self-center">Bokföringsdatum</label>
                  <input className="input" type="date" value={mDatum} onChange={e => setMDatum(e.target.value)} />
                  <label className="text-sm text-gray-600 self-center">Beskrivning</label>
                  <input className="input" value={mBesk} onChange={e => setMBesk(e.target.value)} />
                </div>

                {mForslag && (
                  <div className="text-xs text-purple-800 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-1.5">
                    <i className="ti ti-sparkles" /> Smart förslag från historik: <b>{mForslag.konto} {accName(mForslag.konto)}</b> (bokfört så {mForslag.count} ggr på liknande). Justera vid behov.
                  </div>
                )}

                <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        <th className="text-left px-3 py-2 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                        <th className="text-left px-3 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kontobenämning</th>
                        <th className="text-right px-3 py-2 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Debet</th>
                        <th className="text-right px-3 py-2 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kredit</th>
                        <th className="px-2 py-2 border-b w-8" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {/* Bankkontorad (låst) */}
                      <tr className="bg-blue-50/40">
                        <td className="px-3 py-2 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{selected}</td>
                        <td className="px-3 py-2 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{accName(selected)}</td>
                        <td className="px-3 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{bankRow.d ? fmt(bankRow.d) : ''}</td>
                        <td className="px-3 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{bankRow.k ? fmt(bankRow.k) : ''}</td>
                        <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }} />
                      </tr>
                      {mRows.map((r, idx) => (
                        <tr key={idx}>
                          <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                            <input className="w-full px-3 py-2 outline-none bg-transparent" list="kb-konton" value={r.konto} placeholder="––––"
                              onChange={e => setMRow(idx, { konto: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} onBlur={() => mKontoBlur(idx)} />
                          </td>
                          <td className="border-b px-3 py-2 text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{accName(r.konto)}</td>
                          <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><input className="w-full px-3 py-2 outline-none bg-transparent text-right tabular-nums" inputMode="decimal" value={r.debet} onChange={e => setMRow(idx, { debet: e.target.value })} onBlur={e => { const n = num(e.target.value); setMRow(idx, { debet: n ? fmt(n) : '' }) }} /></td>
                          <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><input className="w-full px-3 py-2 outline-none bg-transparent text-right tabular-nums" inputMode="decimal" value={r.kredit} onChange={e => setMRow(idx, { kredit: e.target.value })} onBlur={e => { const n = num(e.target.value); setMRow(idx, { kredit: n ? fmt(n) : '' }) }} /></td>
                          <td className="border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{mRows.length > 1 && <button className="text-gray-300 hover:text-red-600" onClick={() => setMRows(rs => rs.filter((_, i) => i !== idx))}><i className="ti ti-trash text-sm" /></button>}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-medium">
                        <td colSpan="2" className="px-3 py-2 text-right text-gray-500">Summa</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(sumD)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(sumK)}</td>
                        <td />
                      </tr>
                      <tr className="bg-gray-50">
                        <td colSpan="2" className="px-3 py-2 text-right text-gray-500 font-medium">Differens</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: balanced ? '#1a7a2e' : '#A32D2D' }} colSpan="2">{fmt(diff)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="text-right text-sm mt-2" style={{ color: Math.abs(kvar) < 0.01 ? '#1a7a2e' : '#A32D2D' }}>Belopp kvar att stämma av: <b className="tabular-nums">{fmt(kvar)}</b></div>
              </div>

              <div className="px-5 py-3 border-t flex items-center justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <button className="btn" onClick={() => setMatchTx(null)}>Avbryt</button>
                <button className="text-white text-sm font-medium px-6 py-2 rounded-lg disabled:opacity-40" style={{ background: '#6d28d9' }} disabled={!balanced || working} onClick={bokforMatcha}>{working ? 'Bokför…' : 'Bokför'}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Betala leverantörsfaktura från bankhändelse */}
      {payTx && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPayTx(null)}>
          <div className="bg-white rounded-xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div className="flex items-center justify-between">
                <span className="text-base font-medium">Betala leverantörsfaktura</span>
                <button className="text-gray-400 hover:text-gray-700" onClick={() => setPayTx(null)}><i className="ti ti-x" /></button>
              </div>
              <div className="text-sm text-gray-500 mt-1">Bankhändelse {payTx.datum} · <b className="tabular-nums text-red-700">{fmt(payTx.amount)}</b> · {payTx.text}</div>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div className="relative">
                <input className="input pl-8" placeholder="Sök faktura/leverantör" value={paySearch} onChange={e => setPaySearch(e.target.value)} autoFocus />
                <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {payCandidates.length === 0 ? (
                <div className="text-center py-10 text-gray-400">Inga obetalda leverantörsfakturor.</div>
              ) : payCandidates.map(inv => {
                const match = Math.abs((inv.total_amount || 0) - Math.abs(payTx.amount)) < 0.01
                return (
                  <button key={inv.id} className="w-full text-left px-5 py-3 border-b hover:bg-gray-50 flex items-center justify-between gap-3" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => betalaFaktura(payTx, inv)} disabled={working}>
                    <span className="truncate">{inv.suppliers?.name || '–'} <span className="text-gray-400">· {inv.invoice_nr || ''}</span> {match && <span className="text-green-700 text-xs ml-1">✓ samma belopp</span>}</span>
                    <span className="tabular-nums font-medium shrink-0">{fmt(inv.total_amount)}</span>
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokför D 2440 / K {selAcc?.account_nr} och markerar fakturan som betald.</div>
          </div>
        </div>
      )}

      {/* Överföring mellan egna bankkonton */}
      {transferTx && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setTransferTx(null)}>
          <div className="bg-white rounded-xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div className="flex items-center justify-between">
                <span className="text-base font-medium">Överföring mellan egna bankkonton</span>
                <button className="text-gray-400 hover:text-gray-700" onClick={() => setTransferTx(null)}><i className="ti ti-x" /></button>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                Den här händelsen ({selAcc?.account_nr}): {transferTx.datum} · <b className="tabular-nums" style={{ color: transferTx.amount < 0 ? '#b91c1c' : '#1a7a2e' }}>{fmt(transferTx.amount)}</b> · {transferTx.text}
              </div>
              <div className="text-xs text-gray-400 mt-1">Välj den matchande händelsen på ditt andra bankkonto. Båda bokförs som en överföring.</div>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <div className="relative">
                <input className="input pl-8" placeholder="Sök konto, text eller belopp" value={transferSearch} onChange={e => setTransferSearch(e.target.value)} autoFocus />
                <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {transferCandidates.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">Inga matchande händelser på dina andra bankkonton.<div className="text-xs mt-1">(Motsvarande händelse ska ha motsatt tecken och samma belopp, och vara oboköförd.)</div></div>
              ) : transferCandidates.map(c => {
                const match = Math.abs(Math.abs(c.amount) - Math.abs(transferTx.amount)) < 0.01
                return (
                  <button key={c.id} className="w-full text-left px-5 py-3 border-b hover:bg-gray-50 flex items-center justify-between gap-3 disabled:opacity-40" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => bokforOverforing(transferTx, c)} disabled={working || !match}>
                    <span className="truncate">
                      <b>{c.account_nr}</b> {accName(c.account_nr)} <span className="text-gray-400">· {c.datum}</span> {c.text ? <span className="text-gray-500">· {c.text}</span> : ''}
                      {match ? <span className="text-green-700 text-xs ml-1">✓ samma belopp</span> : <span className="text-amber-600 text-xs ml-1">(annat belopp)</span>}
                    </span>
                    <span className="tabular-nums font-medium shrink-0" style={{ color: c.amount < 0 ? '#b91c1c' : '#1a7a2e' }}>{fmt(c.amount)}</span>
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokför D mottagande konto / K avsändande konto och markerar båda bankhändelserna som bokförda.</div>
          </div>
        </div>
      )}

      {/* Hantera inläsningar */}
      {batchOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setBatchOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Inlästa filer · {selAcc?.account_nr} {selAcc?.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setBatchOpen(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {batches.length === 0 ? (
                <div className="text-center py-10 text-gray-400">Inga spårade inläsningar för kontot.<div className="text-xs mt-1">(Rader inlästa innan funktionen aktiverades kan tas bort en och en i listan.)</div></div>
              ) : batches.map(b => (
                <div key={b.id} className="px-5 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  <div>
                    <div className="text-sm font-medium">{b.count} bankhändelser · {b.minDatum} – {b.maxDatum}</div>
                    <div className="text-xs text-gray-500">Netto <span className="tabular-nums">{fmt(b.sum)}</span>{b.bookedCount > 0 ? <span className="text-amber-700"> · {b.bookedCount} bokförda</span> : <span className="text-gray-400"> · inget bokfört</span>}</div>
                  </div>
                  <button className="btn btn-danger text-xs py-1 px-3 disabled:opacity-40" disabled={b.bookedCount > 0} onClick={() => deleteBatch(b)} title={b.bookedCount > 0 ? 'Ångra bokföringen först' : 'Ta bort inläsningen'}>
                    <i className="ti ti-trash" /> Ta bort
                  </button>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>En inläsning kan tas bort när inget i den är bokfört. Har du bokfört rader – ångra bokföringen först (knappen Ångra på raden).</div>
          </div>
        </div>
      )}
    </div>
  )
}
