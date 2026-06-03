import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const today = () => new Date().toISOString().slice(0, 10)
const dnum = s => String(s || '').replace(/-/g, '')

function buildSie(company, accounts, vers, from, tom) {
  const L = []
  L.push('#FLAGGA 0')
  L.push('#PROGRAM "Redo Flow" 1.0')
  L.push('#FORMAT PC8')
  L.push(`#GEN ${dnum(today())}`)
  L.push('#SIETYP 4')
  if (company.org_nr) L.push(`#ORGNR ${String(company.org_nr).replace(/\D/g, '')}`)
  L.push(`#FNAMN "${(company.name || '').replace(/"/g, '')}"`)
  L.push(`#RAR 0 ${dnum(from)} ${dnum(tom)}`)
  accounts.forEach(a => L.push(`#KONTO ${a.account_nr} "${(a.name || '').replace(/"/g, '')}"`))
  vers.forEach(v => {
    const serie = (v.ver_serie || 'A')[0]
    const nr = String(v.ver_nr || '').replace(/\D/g, '') || '0'
    L.push(`#VER ${serie} ${nr} ${dnum(v.datum)} "${(v.beskrivning || '').replace(/"/g, '')}"`)
    L.push('{')
    v.rows.forEach(r => { const amt = (r.debet || 0) - (r.kredit || 0); L.push(`   #TRANS ${r.account_nr} {} ${amt.toFixed(2)}`) })
    L.push('}')
  })
  return L.join('\r\n')
}

function parseSie(text) {
  const accounts = {}, vers = []
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#KONTO')) {
      const m = line.match(/^#KONTO\s+(\S+)\s+"?([^"]*)"?/)
      if (m) accounts[m[1]] = { account_nr: m[1], name: m[2].trim() }
    } else if (line.startsWith('#VER')) {
      const m = line.match(/^#VER\s+(\S+)\s+(\S+)\s+(\d{8})\s*(?:"([^"]*)")?/)
      if (m) cur = { serie: m[1], nr: m[2], datum: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6, 8)}`, text: m[4] || '', rows: [] }
    } else if (line.startsWith('#TRANS')) {
      const m = line.match(/^#TRANS\s+(\S+)\s+\{[^}]*\}\s+(-?[\d.,]+)/)
      if (m && cur) cur.rows.push({ konto: m[1], amount: parseFloat(m[2].replace(/\s/g, '').replace(',', '.')) || 0 })
    } else if (line === '}') { if (cur) { vers.push(cur); cur = null } }
  }
  return { accounts: Object.values(accounts), vers }
}

export default function Sie() {
  const { company, user } = useAuth()
  const yr = new Date().getFullYear()
  const [tab, setTab] = useState('export')
  const [from, setFrom] = useState(`${yr}-01-01`)
  const [tom, setTom] = useState(`${yr}-12-31`)
  const [vers, setVers] = useState([])
  const [accounts, setAccounts] = useState([])
  const [selSeries, setSelSeries] = useState({})
  const [busy, setBusy] = useState(false)
  const [parsed, setParsed] = useState(null)
  const fileRef = useRef()

  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    const [{ data: v }, { data: r }, { data: a }] = await Promise.all([
      supabase.from('verifikationer').select('id, ver_nr, ver_serie, datum, beskrivning').eq('company_id', company.id),
      supabase.from('verifikation_rows').select('verifikation_id, account_nr, debet, kredit, verifikationer!inner(company_id)').eq('verifikationer.company_id', company.id),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).order('account_nr'),
    ])
    const byVer = {}; (r || []).forEach(row => { (byVer[row.verifikation_id] ||= []).push(row) })
    const list = (v || []).map(x => ({ ...x, rows: byVer[x.id] || [] }))
    setVers(list); setAccounts(a || [])
    const series = {}; list.forEach(x => { series[(x.ver_serie || 'A')[0]] = true }); setSelSeries(series)
  }

  const serieStats = (() => {
    const m = {}
    vers.filter(v => v.datum >= from && v.datum <= tom).forEach(v => { const s = (v.ver_serie || 'A')[0]; m[s] = (m[s] || 0) + 1 })
    return m
  })()

  function exportSie() {
    const inRange = vers.filter(v => v.datum >= from && v.datum <= tom && selSeries[(v.ver_serie || 'A')[0]])
    const txt = buildSie(company, accounts, inRange, from, tom)
    const blob = new Blob(['﻿' + txt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${(company.name || 'export').replace(/[^\w]+/g, '_')}_${from}_${tom}.se`
    a.click(); URL.revokeObjectURL(url)
    toast.success(`SIE-fil skapad (${inRange.length} verifikationer)`)
  }

  function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => { try { setParsed(parseSie(String(rd.result))) } catch { toast.error('Kunde inte tolka filen') } }
    rd.readAsText(f, 'utf-8')
  }
  function onDrop(e) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]; if (!f) return
    const rd = new FileReader(); rd.onload = () => { try { setParsed(parseSie(String(rd.result))) } catch { toast.error('Kunde inte tolka filen') } }; rd.readAsText(f, 'utf-8')
  }

  async function doImport() {
    if (!parsed) return
    setBusy(true)
    try {
      // 1) Konton som saknas
      const existing = new Set(accounts.map(a => a.account_nr))
      const nya = parsed.accounts.filter(a => !existing.has(a.account_nr))
      if (nya.length) await supabase.from('accounts').insert(nya.map(a => ({ company_id: company.id, account_nr: a.account_nr, name: a.name || a.account_nr, is_active: true })))
      // 2) Verifikationer + rader
      let n = 0
      for (const v of parsed.vers) {
        const totD = v.rows.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0)
        const totK = v.rows.reduce((s, r) => s + (r.amount < 0 ? -r.amount : 0), 0)
        const { data: ver, error } = await supabase.from('verifikationer').insert({
          company_id: company.id, ver_nr: `${v.serie}${v.nr}`, ver_serie: `${v.serie} - SIE-import`,
          datum: v.datum, beskrivning: v.text || 'SIE-import', total_debet: totD, total_kredit: totK, created_by: user.id,
        }).select().single()
        if (error) continue
        await supabase.from('verifikation_rows').insert(v.rows.map((r, i) => ({
          verifikation_id: ver.id, account_nr: r.konto, account_name: '', debet: r.amount > 0 ? r.amount : 0, kredit: r.amount < 0 ? -r.amount : 0, sort_order: i,
        })))
        n++
      }
      toast.success(`Import klar: ${nya.length} nya konton, ${n} verifikationer`)
      setParsed(null); load()
    } catch (e) { toast.error('Fel vid import: ' + e.message) }
    setBusy(false)
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">SIE – import och export av bokföringsdata</span>
      </div>
      <div className="bg-white border-b flex gap-0 px-7" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {[['export', 'SIE-export'], ['import', 'SIE-import']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px ${tab === k ? 'text-gray-900 font-medium border-green-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>{l}</button>
        ))}
      </div>

      <div className="p-7 max-w-3xl">
        {tab === 'export' ? (
          <>
            <div className="text-[15px] font-bold tracking-tight mb-4">EXPORT – SIE</div>
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-500 mb-1">SIE-typ</label>
              <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.15)' }}>
                {['1 - Bokslutssaldon', '2 - Periodsaldon', '3 - Objektsaldon', '4 - Transaktioner'].map((t, i) => (
                  <span key={t} className={`px-3.5 py-1.5 text-sm ${i === 3 ? 'bg-green-600 text-white' : 'bg-white text-gray-400'}`}>{t}</span>
                ))}
              </div>
              <div className="text-xs text-gray-400 mt-1">Endast SIE 4 (transaktioner) stöds.</div>
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-md mb-5">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Omfattning fr.o.m.</label><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">t.o.m.</label><input className="input" type="date" value={tom} onChange={e => setTom(e.target.value)} /></div>
            </div>
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-500 mb-2">Välj serier</label>
              <div className="bg-white rounded-xl overflow-hidden max-w-md" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                {Object.keys(serieStats).length === 0 ? <div className="px-4 py-4 text-sm text-gray-400">Inga verifikationer i perioden.</div> :
                  Object.entries(serieStats).sort().map(([s, n]) => (
                    <label key={s} className="flex items-center justify-between px-4 py-2 border-b text-sm cursor-pointer hover:bg-gray-50" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      <span className="flex items-center gap-2.5"><input type="checkbox" checked={!!selSeries[s]} onChange={e => setSelSeries(p => ({ ...p, [s]: e.target.checked }))} /> Serie {s}</span>
                      <span className="text-gray-400">{n} st</span>
                    </label>
                  ))}
              </div>
            </div>
            <button className="btn btn-primary px-6" onClick={exportSie}><i className="ti ti-download" /> Skapa SIE-fil</button>
          </>
        ) : (
          <>
            <div className="text-[15px] font-bold tracking-tight mb-4">IMPORT – SIE</div>
            <div className="flex justify-end mb-2"><button className="btn" onClick={() => fileRef.current?.click()}><i className="ti ti-upload" /> Läs in fil</button>
              <input ref={fileRef} type="file" accept=".se,.si,.sie,text/plain" className="hidden" onChange={onFile} /></div>
            <div onDragOver={e => e.preventDefault()} onDrop={onDrop} onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed rounded-xl py-12 text-center text-gray-500 cursor-pointer hover:bg-gray-50" style={{ borderColor: 'rgba(0,0,0,0.15)' }}>
              <i className="ti ti-file-upload text-3xl block mb-2 opacity-40" />
              Dra och släpp en SIE-fil här eller klicka på Läs in fil uppe till höger.
            </div>
            {parsed && (
              <div className="mt-5 bg-white rounded-xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="text-sm mb-3">Filen innehåller <b>{parsed.accounts.length}</b> konton och <b>{parsed.vers.length}</b> verifikationer.</div>
                <div className="flex items-center gap-2.5">
                  <button className="btn btn-green" onClick={doImport} disabled={busy}>{busy ? 'Importerar…' : 'Importera till bokföringen'}</button>
                  <button className="btn" onClick={() => setParsed(null)} disabled={busy}>Avbryt</button>
                </div>
                <div className="text-xs text-amber-700 mt-3">Obs: import skapar nya verifikationer (serie "X - SIE-import"). Importera inte samma fil flera gånger – det skapar dubletter.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
