import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import UnderlagPanel from '../components/UnderlagPanel'
import { tolkaDocument } from '../lib/tolka'

const emptyRow = () => ({ konto: '', benamning: '', info: '', debet: '', kredit: '', debetLocked: false, kreditLocked: false })

// Tolkar kortform av datum: "0529" -> 2026-05-29 (MMDD + aktuellt år),
// "260529" -> 2026-05-29 (ÅÅMMDD), "20260529" -> 2026-05-29 (ÅÅÅÅMMDD).
// Returnerar oförändrad sträng om den inte går att tolka.
function normalizeDate(str) {
  const digits = String(str || '').replace(/\D/g, '')
  let y, m, d
  if (digits.length === 4) {
    y = String(new Date().getFullYear()); m = digits.slice(0, 2); d = digits.slice(2, 4)
  } else if (digits.length === 6) {
    y = '20' + digits.slice(0, 2); m = digits.slice(2, 4); d = digits.slice(4, 6)
  } else if (digits.length === 8) {
    y = digits.slice(0, 4); m = digits.slice(4, 6); d = digits.slice(6, 8)
  } else {
    return str
  }
  const mi = parseInt(m, 10), di = parseInt(d, 10)
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return str
  return `${y}-${m}-${d}`
}

// Tolkar ett belopp oavsett format ("100 000,00", "100000.00", "100000") -> tal.
const parseAmt = s => {
  const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
// Formaterar ett tal till svensk visning: "100 000,00".
const fmtSEK = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function NyVerifikation() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [beskrivning, setBeskrivning] = useState('')
  const [serie, setSerie] = useState('A - Redovisning')
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10))
  const [mall, setMall] = useState('')
  const [belopp, setBelopp] = useState('')
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()])
  const [accounts, setAccounts] = useState([])
  const [saving, setSaving] = useState(false)
  const beskRef = useRef()
  // Underlagspanelens öppen/dölj sparas per vy (krav 9/12/13).
  const [panelOpen, setPanelOpen] = useState(() => {
    try { return localStorage.getItem('bokpilot.bokforing.nyverifikation.viewerOpen') !== '0' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem('bokpilot.bokforing.nyverifikation.viewerOpen', panelOpen ? '1' : '0') } catch { /* ignore */ }
  }, [panelOpen])
  const [attachIds, setAttachIds] = useState([])
  const [reloadSignal, setReloadSignal] = useState(0)
  const [kommentar, setKommentar] = useState('')
  const [kommentarOpen, setKommentarOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const initialDoc = searchParams.get('underlag')
  const autoTolka = searchParams.get('tolka') === '1'
  const tolkadRef = useRef(false)
  // Ersättningsverifikation i rättelsekedjan (?ersatter=<original-id>&datum=<öppet datum>).
  // RPC:n ratta_verifikation har redan skapat rättelseverifikationen som nollar originalet;
  // här bokförs den KORREKTA verifikationen, länkad via kolumnen `ersatter`.
  const ersatterId = searchParams.get('ersatter')
  const ersatterDatum = searchParams.get('datum')
  const [ersatterInfo, setErsatterInfo] = useState(null)   // { id, ver_nr } om vi bokför en ersättning

  // Förvalt underlag från Inkorgen: koppla det direkt.
  useEffect(() => {
    if (initialDoc) setAttachIds(prev => prev.includes(initialDoc) ? prev : [...prev, initialDoc])
  }, [initialDoc])

  // Auto-tolka när man kommer från Inkorgen (?underlag=…&tolka=1)
  useEffect(() => {
    if (!initialDoc || !autoTolka || tolkadRef.current || !accounts.length) return
    tolkadRef.current = true
    ;(async () => {
      const t = toast.loading('Tolkar underlaget…')
      try {
        let r
        const { data: dd } = await supabase.from('documents').select('tolkning').eq('id', initialDoc).maybeSingle()
        if (dd?.tolkning) r = dd.tolkning
        else r = await tolkaDocument(initialDoc)
        fyllFranTolkning(r); toast.dismiss(t)
      } catch (e) { toast.dismiss(t); toast.error(e.message || String(e)) }
    })()
  }, [initialDoc, autoTolka, accounts.length])

  // Ersättningsläge: förifyll med originalets rader rakt av (rättelseverifikationen har redan
  // vänt dem) – användaren ändrar det som var fel och bokför den korrekta verifikationen.
  useEffect(() => {
    if (ersatterId && company) loadOriginal(ersatterId)
  }, [ersatterId, company])

  async function loadOriginal(origId) {
    const { data: v } = await supabase.from('verifikationer').select('*').eq('id', origId).single()
    const { data: r } = await supabase.from('verifikation_rows').select('*').eq('verifikation_id', origId).order('sort_order')
    if (!v) return
    setErsatterInfo({ id: v.id, ver_nr: v.ver_nr })
    setBeskrivning(v.beskrivning || '')
    setSerie(v.ver_serie || 'A - Redovisning')
    if (ersatterDatum) setDatum(ersatterDatum)
    const kopior = (r || []).map(row => ({
      konto: row.account_nr,
      benamning: row.account_name,
      info: row.transaction_info || '',
      debet: (row.debet || 0) > 0 ? fmtSEK(row.debet) : '',
      kredit: (row.kredit || 0) > 0 ? fmtSEK(row.kredit) : '',
      debetLocked: (row.kredit || 0) > 0,
      kreditLocked: (row.debet || 0) > 0,
    }))
    setRows(kopior.length ? kopior : [emptyRow(), emptyRow(), emptyRow()])
  }

  // Förifyll från en inläst banktransaktion (Kassa och bank).
  const bankTxId = searchParams.get('banktx')
  const bankPrefilled = useRef(false)
  useEffect(() => {
    const bankkonto = searchParams.get('bankkonto')
    if (!bankkonto || !accounts.length || bankPrefilled.current) return
    bankPrefilled.current = true
    const n = parseFloat(searchParams.get('bankbelopp') || '0')
    const text = searchParams.get('banktext') || ''
    const match = accounts.find(a => a.account_nr === bankkonto)
    setBeskrivning(text)
    applyDatum(searchParams.get('bankdatum') || datum)
    setRows([
      {
        konto: bankkonto, benamning: match ? match.name : '', info: '',
        debet: n >= 0 ? fmtSEK(Math.abs(n)) : '',
        kredit: n < 0 ? fmtSEK(Math.abs(n)) : '',
        debetLocked: n < 0, kreditLocked: n >= 0,
      },
      emptyRow(), emptyRow(),
    ])
  }, [accounts.length])

  function toggleAttach(id) {
    setAttachIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Fyller verifikationen från AI-tolkningen – men bokför inte.
  function fyllFranTolkning(result) {
    if (!result) return
    if (result.beskrivning) setBeskrivning(result.beskrivning)
    if (result.fakturadatum && /^\d{4}-\d{2}-\d{2}$/.test(result.fakturadatum)) applyDatum(result.fakturadatum)
    const k = Array.isArray(result.konteringsrader) ? result.konteringsrader : []
    const nya = k.map(r => {
      const d = parseAmt(r.debet), kr = parseAmt(r.kredit)
      const nr = String(r.konto ?? '').trim()
      const match = accounts.find(a => a.account_nr === nr)
      return {
        konto: nr,
        benamning: match ? match.name : (r.benamning || ''),
        info: '',
        debet: d > 0 ? fmtSEK(d) : '',
        kredit: kr > 0 ? fmtSEK(kr) : '',
        debetLocked: kr > 0,
        kreditLocked: d > 0,
      }
    })
    setRows(nya.length ? nya : [emptyRow(), emptyRow(), emptyRow()])
    const okand = nya.filter(r => r.konto && !accounts.some(a => a.account_nr === r.konto))
    if (okand.length) toast('Tolkat – granska konton som ej hittades i kontoplanen', { icon: '⚠️' })
    else toast.success('Underlaget tolkat – granska och klicka Bokför')
  }

  useEffect(() => {
    if (company) loadAccounts()
    setTimeout(() => beskRef.current?.focus(), 100)
  }, [company])

  async function loadAccounts() {
    // Ladda HELA kontoplanen. Aktiva konton används för förslag/autocomplete,
    // men validering sker mot alla konton som finns (även inaktiva).
    const { data } = await supabase
      .from('accounts')
      .select('account_nr, name, is_active')
      .eq('company_id', company.id)
      .order('account_nr')
    setAccounts(data || [])
  }

  function updateRow(idx, field, value) {
    setRows(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }

      if (field === 'konto') {
        const match = accounts.find(a => a.account_nr === value)
        next[idx].benamning = match ? match.name : ''
      }
      if (field === 'debet' && parseAmt(value) > 0) {
        next[idx].kredit = ''
        next[idx].kreditLocked = true
      } else if (field === 'debet') {
        next[idx].kreditLocked = false
      }
      if (field === 'kredit' && parseAmt(value) > 0) {
        next[idx].debet = ''
        next[idx].debetLocked = true
      } else if (field === 'kredit') {
        next[idx].debetLocked = false
      }
      return next
    })
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow()])
  }

  function removeRow(idx) {
    if (rows.length <= 1) return
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  // Fyller rad idx med differensen mot övriga rader. Returnerar 'debet'/'kredit' om något fylldes, annars null.
  function fillBalance(idx) {
    let otherD = 0, otherK = 0
    rows.forEach((r, i) => {
      if (i === idx) return
      otherD += parseAmt(r.debet)
      otherK += parseAmt(r.kredit)
    })
    const diff = otherD - otherK
    if (Math.abs(diff) < 0.01) return null
    setRows(prev => {
      const next = [...prev]
      if (diff > 0) {
        next[idx] = { ...next[idx], kredit: fmtSEK(diff), debet: '', debetLocked: true, kreditLocked: false }
      } else {
        next[idx] = { ...next[idx], debet: fmtSEK(Math.abs(diff)), kredit: '', kreditLocked: true, debetLocked: false }
      }
      return next
    })
    return diff > 0 ? 'kredit' : 'debet'
  }

  const totalDebet = rows.reduce((sum, r) => sum + parseAmt(r.debet), 0)
  const totalKredit = rows.reduce((sum, r) => sum + parseAmt(r.kredit), 0)
  const differens = Math.abs(totalDebet - totalKredit)
  const isBalanced = differens < 0.01

  function focusEl(id) {
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) { el.focus(); el.select?.() }
    }, 0)
  }

  // Enkel Enter-navigering mellan toppfälten (beskrivning, mall, belopp).
  function handleEnter(e, nextId) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    focusEl(nextId)
  }

  const today = new Date().toISOString().slice(0, 10)

  // Normaliserar datumet och hindrar datum senare än idag.
  function applyDatum(raw) {
    let d = normalizeDate(raw)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > today) {
      d = today
      toast.error('Bokföringsdatum kan inte vara senare än idag')
    }
    setDatum(d)
  }

  function onDatumKey(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    applyDatum(e.target.value)
    focusEl('ver-mall')
  }

  const accountExists = nr => accounts.some(a => a.account_nr === nr)

  // Formaterar ett belopp till svensk visning ("100 000,00") när fältet lämnas.
  function formatAmount(idx, field) {
    setRows(prev => {
      const next = [...prev]
      const v = parseAmt(next[idx][field])
      next[idx] = { ...next[idx], [field]: v > 0 ? fmtSEK(v) : '' }
      return next
    })
  }

  // Går vidare: balanserar böckerna -> Bokför. Annars nästa rads konto.
  function advance(i) {
    let d = 0, k = 0
    rows.forEach(r => { d += parseAmt(r.debet); k += parseAmt(r.kredit) })
    if (d > 0 && Math.abs(d - k) < 0.01) {
      focusEl('bokfor-btn')
    } else {
      if (i === rows.length - 1) addRow()
      focusEl(`konto-${i + 1}`)
    }
  }

  // Enter i kontofältet -> hoppa till debet på samma rad.
  // Tomt konto tillåts (raden ignoreras). Exakt träff används direkt.
  // Annars: om prefixet matchar exakt ETT konto väljs det automatiskt
  // (t.ex. "191" -> 1910, "249" -> 2499). Flera/inga träffar blockeras.
  function onKontoEnter(e, i) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const nr = (rows[i].konto || '').trim()
    if (!nr) { focusEl(`debet-${i}`); return }
    if (accountExists(nr)) { focusEl(`debet-${i}`); return }

    const matches = accounts.filter(a => a.is_active && a.account_nr.startsWith(nr))
    if (matches.length === 1) {
      updateRow(i, 'konto', matches[0].account_nr)
      focusEl(`debet-${i}`)
    } else if (matches.length === 0) {
      toast.error(`Konto "${nr}" finns inte i kontoplanen`)
    } else {
      toast.error(`Flera konton börjar på "${nr}" – ange fler siffror`)
    }
  }

  // Enter i debet: har du fyllt i belopp -> nästa box. Tomt -> hoppa till kredit.
  function onDebetEnter(e, i) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const hasDebet = parseAmt(rows[i].debet) > 0
    if (!hasDebet) { focusEl(`kredit-${i}`); return }
    advance(i)
  }

  // Enter i kredit: belopp ifyllt -> nästa box. Tomt -> fyll kvarvarande belopp
  // automatiskt (sista raden) och gå vidare.
  function onKreditEnter(e, i) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const hasKredit = parseAmt(rows[i].kredit) > 0
    if (!hasKredit) {
      const side = fillBalance(i)
      if (side) { focusEl('bokfor-btn'); return }
    }
    advance(i)
  }

  async function bokfor() {
    const validRows = rows.filter(r => r.konto)
    if (validRows.length === 0) return toast.error('Ange minst en konteringsrad')
    const badRow = validRows.find(r => !accountExists(r.konto))
    if (badRow) return toast.error(`Konto "${badRow.konto}" finns inte i kontoplanen`)
    if (!isBalanced) return toast.error('Debet och kredit balanserar inte!')
    if (!beskrivning) return toast.error('Ange en beskrivning')

    setSaving(true)
    try {
      const { data: nr } = await supabase.rpc('next_ver_nr', {
        p_company_id: company.id,
        p_serie: serie,
      })

      const { data: ver, error: verErr } = await supabase
        .from('verifikationer')
        .insert({
          company_id: company.id,
          ver_nr: nr || serie.charAt(0) + Date.now(),
          ver_serie: serie,
          datum,
          beskrivning,
          kommentar: kommentar.trim() || null,
          total_debet: totalDebet,
          total_kredit: totalKredit,
          created_by: user.id,
          ersatter: ersatterInfo?.id || null,   // rättelsekedja: länka ersättningen till originalet
        })
        .select()
        .single()

      if (verErr) throw verErr

      const rowsToInsert = validRows.map((r, i) => ({
        verifikation_id: ver.id,
        account_nr: r.konto,
        account_name: r.benamning,
        debet: parseAmt(r.debet),
        kredit: parseAmt(r.kredit),
        transaction_info: r.info,
        sort_order: i,
      }))

      const { error: rowErr } = await supabase.from('verifikation_rows').insert(rowsToInsert)
      if (rowErr) throw rowErr

      // Aktivera konton som användes men låg inaktiva (som i Fortnox).
      const inaktiva = validRows.map(r => r.konto).filter(nr => accounts.find(a => a.account_nr === nr && !a.is_active))
      if (inaktiva.length) {
        await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', inaktiva)
      }

      // Bokförd från inläst banktransaktion: markera den som bokförd.
      if (bankTxId) {
        await supabase.from('bank_transactions').update({ status: 'booked', verifikation_id: ver.id }).eq('id', bankTxId)
        toast.success(`Verifikation ${ver.ver_nr} bokförd`)
        setSaving(false)
        navigate(`/bokforing/${ver.id}`)
        return
      }

      // Koppla valda underlag till den nya verifikationen (lämnar då Inkorgen).
      if (attachIds.length) {
        await supabase.from('documents').update({ verifikation_id: ver.id }).in('id', attachIds)
      }

      // Ersättningsläge: rättelsekedjan är komplett (original → rättelse → ersättning).
      if (ersatterInfo) {
        toast.success(`Ersättningsverifikation ${ver.ver_nr} bokförd (ersätter ${ersatterInfo.ver_nr})`)
        setSaving(false)
        navigate(`/bokforing/${ver.id}`)
        return
      }

      toast.success(`Verifikation ${ver.ver_nr} bokförd!`)
      // Nollställ för nästa verifikation – behåll datum & serie så att flera kan bokföras snabbt.
      setBeskrivning('')
      setMall('')
      setBelopp('')
      setRows([emptyRow(), emptyRow(), emptyRow()])
      setAttachIds([])
      setReloadSignal(s => s + 1)
      setKommentar('')
      setKommentarOpen(false)
      setTimeout(() => beskRef.current?.focus(), 50)
    } catch (err) {
      toast.error('Fel: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="flex h-screen">
      <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0 sticky top-0 z-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">{ersatterInfo ? 'VERIFIKATION – ERSÄTTNING' : 'VERIFIKATION – NY'}</span>
        <div className="flex items-center gap-2.5">
          <button className="btn" onClick={bokfor} disabled={saving}><i className="ti ti-plus" /> Skapa verifikation</button>
          <button className="btn btn-primary" onClick={() => navigate('/bokforing')}><i className="ti ti-list" /> Visa lista</button>
        </div>
      </div>

      <div className="bg-white border-b px-7 h-10 flex items-center justify-end gap-5 shrink-0 no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <button className={`text-sm flex items-center gap-1 ${kommentarOpen || kommentar ? 'text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-800'}`}
          onClick={() => setKommentarOpen(o => !o)}><i className="ti ti-message" /> Kommentar</button>
        <button className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut</button>
        <button className="text-sm text-gray-400 flex items-center gap-1"
          onClick={() => toast('Periodisering byggs som ett eget steg', { icon: '🗓️' })}><i className="ti ti-calendar-repeat" /> Periodisering</button>
      </div>

      {/* Form */}
      <div id="printable" className="p-7 flex-1 overflow-y-auto">
        {ersatterInfo && (
          <div className="mb-4 max-w-4xl px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg no-print">
            <div className="text-sm font-semibold text-amber-800 flex items-center gap-1.5 mb-1"><i className="ti ti-pencil-minus" /> Ersätter verifikation {ersatterInfo.ver_nr}</div>
            <p className="text-xs text-amber-800">En rättelseverifikation har redan nollat originalet. Raderna nedan är kopierade från originalet – ändra det som var fel och bokför den korrekta verifikationen.</p>
          </div>
        )}
        {kommentarOpen && (
          <div className="mb-4 max-w-4xl">
            <label className="block text-xs font-medium text-gray-500 mb-1">Kommentar</label>
            <textarea className="input" rows={2} value={kommentar} onChange={e => setKommentar(e.target.value)}
              placeholder="Intern notering om verifikationen…" />
          </div>
        )}
        <div className="grid grid-cols-[2fr_2fr_1fr] gap-4 mb-4 max-w-4xl">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Beskrivning</label>
            <input ref={beskRef} className="input" value={beskrivning} onChange={e => setBeskrivning(e.target.value)}
              onKeyDown={e => handleEnter(e, 'ver-datum')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Verifikationsserie</label>
            <select className="input" value={serie} onChange={e => setSerie(e.target.value)}>
              <option>A - Redovisning</option><option>B - Bank</option><option>K - Kassa</option><option>L - Lön</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bokföringsdatum</label>
            <input id="ver-datum" className="input" type="text" inputMode="numeric" placeholder="ÅÅÅÅ-MM-DD" value={datum}
              onChange={e => setDatum(e.target.value)}
              onBlur={e => applyDatum(e.target.value)}
              onKeyDown={onDatumKey} />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-4 mb-6 max-w-4xl">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Konteringsmall</label>
            <input id="ver-mall" className="input" value={mall} onChange={e => setMall(e.target.value)}
              onKeyDown={e => handleEnter(e, 'ver-belopp')} placeholder="Kod, Benämning" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Belopp</label>
            <input id="ver-belopp" className="input" type="number" value={belopp} onChange={e => setBelopp(e.target.value)}
              onKeyDown={e => handleEnter(e, 'konto-0')} />
          </div>
        </div>

        {/* Datalist for konto autocomplete – bara aktiva konton föreslås */}
        <datalist id="konto-list">
          {accounts.filter(a => a.is_active).map(a => <option key={a.account_nr} value={a.account_nr} label={`${a.account_nr} – ${a.name}`} />)}
        </datalist>

        {/* Konteringsrader */}
        <div className="rounded-xl overflow-hidden max-w-5xl" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-2.5 py-2.5 border-b w-[100px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                <th className="text-left px-2.5 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Benämning</th>
                <th className="text-left px-2.5 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Transaktionsinfo</th>
                <th className="text-right px-2.5 py-2.5 border-b w-[120px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Debet</th>
                <th className="text-right px-2.5 py-2.5 border-b w-[120px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kredit</th>
                <th className="text-right px-2.5 py-2.5 border-b w-[100px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kontosaldo</th>
                <th className="py-2.5 border-b w-[90px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                  <td className="px-1"><input id={`konto-${i}`} className="ver-cell" list="konto-list" value={row.konto}
                    onChange={e => updateRow(i, 'konto', e.target.value)}
                    onKeyDown={e => onKontoEnter(e, i)} style={{ width: 100 }} /></td>
                  <td className="px-1"><input className="ver-cell bg-transparent" value={row.benamning} readOnly tabIndex={-1} /></td>
                  <td className="px-1"><input className="ver-cell" value={row.info} onChange={e => updateRow(i, 'info', e.target.value)} /></td>
                  <td className="px-1"><input id={`debet-${i}`} className="ver-cell text-right" type="text" inputMode="decimal"
                    value={row.debet} disabled={row.debetLocked} style={{ opacity: row.debetLocked ? 0.3 : 1 }}
                    onChange={e => updateRow(i, 'debet', e.target.value)}
                    onBlur={() => formatAmount(i, 'debet')}
                    onKeyDown={e => onDebetEnter(e, i)} /></td>
                  <td className="px-1"><input id={`kredit-${i}`} className="ver-cell text-right" type="text" inputMode="decimal"
                    value={row.kredit} disabled={row.kreditLocked} style={{ opacity: row.kreditLocked ? 0.3 : 1 }}
                    onChange={e => updateRow(i, 'kredit', e.target.value)}
                    onBlur={() => formatAmount(i, 'kredit')}
                    onKeyDown={e => onKreditEnter(e, i)} /></td>
                  <td className="text-right text-xs text-gray-400 px-2.5">
                    {fmtSEK(parseAmt(row.debet) - parseAmt(row.kredit))}
                  </td>
                  <td className="text-right px-1 whitespace-nowrap">
                    <button className="p-1 text-gray-300 hover:text-gray-600 text-xs" onClick={() => removeRow(i)}><i className="ti ti-trash" /></button>
                    <button className="p-1 text-gray-300 hover:text-gray-600 text-xs" onClick={addRow}><i className="ti ti-plus" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50">
                <td colSpan="3" className="text-right px-2.5 py-2.5 text-xs text-gray-500 border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Summa</td>
                <td className="text-right px-2.5 py-2.5 font-medium border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{fmtSEK(totalDebet)}</td>
                <td className="text-right px-2.5 py-2.5 font-medium border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{fmtSEK(totalKredit)}</td>
                <td colSpan="2" className="border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
              <tr className="bg-gray-50">
                <td colSpan="3" className="text-right px-2.5 py-2.5 text-xs text-gray-500">Differens</td>
                <td />
                <td className="text-right px-2.5 py-2.5 font-medium" style={{ color: isBalanced ? '#3B6D11' : '#A32D2D' }}>
                  {fmtSEK(differens)}
                </td>
                <td colSpan="2" />
              </tr>
            </tfoot>
          </table>
        </div>

        <button className="btn text-sm mt-3 no-print" onClick={addRow}><i className="ti ti-plus" /> Lägg till rad</button>

        <div className="flex justify-end gap-3 mt-8 max-w-5xl no-print">
          <button className="btn px-5 py-2" onClick={() => navigate('/bokforing')}>Avbryt</button>
          <button id="bokfor-btn" className="btn btn-green px-5 py-2" onClick={bokfor} disabled={saving}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bokfor() } }}>
            {saving ? 'Sparar...' : ersatterInfo ? 'Bokför ersättning' : 'Bokför'}
          </button>
        </div>
      </div>
      </div>

      {/* Hopfällningspil + underlagspanel */}
      <button
        className="self-center -mr-px z-20 w-7 h-12 rounded-l-lg bg-amber-400 hover:bg-amber-500 text-gray-900 flex items-center justify-center shadow shrink-0"
        onClick={() => setPanelOpen(o => !o)}
        title={panelOpen ? 'Dölj underlag' : 'Visa underlag'}>
        <i className={`ti ${panelOpen ? 'ti-chevron-right' : 'ti-chevron-left'}`} />
      </button>
      {panelOpen && (
        <UnderlagPanel company={company} attachIds={attachIds} onToggleAttach={toggleAttach} onTolkat={fyllFranTolkning} selectDocId={initialDoc} reloadSignal={reloadSignal} widthKey="bokpilot.bokforing.nyverifikation.viewerW" onClose={() => setPanelOpen(false)} />
      )}
    </div>
  )
}
