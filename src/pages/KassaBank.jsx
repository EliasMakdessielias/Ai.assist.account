import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { parseFile, parseAmount, parseDate, guessColumns } from '../lib/parseBank'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const KNOWN = { '2440': 'Leverantörsskulder', '1510': 'Kundfordringar', '1930': 'Företagskonto', '1910': 'Kassa' }

export default function KassaBank() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [rowsByAcc, setRowsByAcc] = useState({})
  const [bankByAcc, setBankByAcc] = useState({})
  const [openSup, setOpenSup] = useState([])
  const [openCust, setOpenCust] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [kontoutdrag, setKontoutdrag] = useState({})
  const [subtab, setSubtab] = useState('handelser')

  // Import
  const [impOpen, setImpOpen] = useState(false)
  const [impRows, setImpRows] = useState([])
  const [impHeader, setImpHeader] = useState(true)
  const [impMap, setImpMap] = useState({ datum: 0, text: 1, belopp: 2 })
  const [importing, setImporting] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [working, setWorking] = useState(false)
  const fileRef = useRef()

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: accs }, { data: rows }, { data: btx }, { data: sup }, { data: cust }] = await Promise.all([
      supabase.from('accounts').select('account_nr, name, opening_balance, is_active').eq('company_id', company.id).like('account_nr', '19%').order('account_nr'),
      supabase.from('verifikation_rows').select('id, account_nr, debet, kredit, avstamd, verifikationer!inner(id, ver_nr, datum, beskrivning, company_id)').eq('verifikationer.company_id', company.id).like('account_nr', '19%'),
      supabase.from('bank_transactions').select('*').eq('company_id', company.id).order('datum', { ascending: false }),
      supabase.from('supplier_invoices').select('id, invoice_nr, total_amount, status, suppliers(name)').eq('company_id', company.id).eq('status', 'unpaid'),
      supabase.from('invoices').select('id, invoice_nr, total_amount, amount_excl_vat, vat_amount, status, customers(name)').eq('company_id', company.id).eq('status', 'sent'),
    ])

    const byAcc = {}
    ;(rows || []).forEach(r => {
      const k = r.account_nr
      ;(byAcc[k] ||= []).push({ rowId: r.id, avstamd: !!r.avstamd, id: r.verifikationer.id, ver_nr: r.verifikationer.ver_nr, datum: r.verifikationer.datum, beskrivning: r.verifikationer.beskrivning, debet: r.debet || 0, kredit: r.kredit || 0 })
    })
    Object.values(byAcc).forEach(list => list.sort((a, b) => a.datum.localeCompare(b.datum) || a.ver_nr.localeCompare(b.ver_nr)))

    const bByAcc = {}
    ;(btx || []).forEach(t => { (bByAcc[t.account_nr] ||= []).push(t) })

    const visibleAccs = (accs || [])
      .filter(a => a.is_active || byAcc[a.account_nr] || bByAcc[a.account_nr])
      .map(a => {
        const ob = a.opening_balance || 0
        const movement = (byAcc[a.account_nr] || []).reduce((s, h) => s + h.debet - h.kredit, 0)
        const ejBok = (bByAcc[a.account_nr] || []).filter(t => t.status === 'unmatched').length
        return { ...a, saldo: ob + movement, antal: (byAcc[a.account_nr] || []).length, ejBok }
      })

    setAccounts(visibleAccs)
    setRowsByAcc(byAcc)
    setBankByAcc(bByAcc)
    setOpenSup(sup || [])
    setOpenCust(cust || [])
    setSelected(prev => prev || visibleAccs.find(a => a.antal > 0 || a.ejBok > 0)?.account_nr || visibleAccs[0]?.account_nr || null)
    setLoading(false)
  }

  const accName = nr => accounts.find(a => a.account_nr === nr)?.name || KNOWN[nr] || ''

  async function toggleAvstamd(h) {
    const ny = !h.avstamd
    setRowsByAcc(prev => ({ ...prev, [selected]: prev[selected].map(x => x.rowId === h.rowId ? { ...x, avstamd: ny } : x) }))
    const { error } = await supabase.from('verifikation_rows').update({ avstamd: ny }).eq('id', h.rowId)
    if (error) { toast.error('Kunde inte spara avstämning'); load() }
  }

  // --- Import (fil eller inklistrat) ---
  function startImport(text) {
    const { rows } = parseFile(text)
    if (!rows.length) return toast.error('Hittade inga rader')
    setImpRows(rows); setImpMap(guessColumns(rows[0])); setImpHeader(true); setImpOpen(true)
  }
  function onFile(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => startImport(String(reader.result))
    reader.readAsText(file, 'utf-8')
  }
  function parsedImport() {
    const data = impHeader ? impRows.slice(1) : impRows
    return data.map(r => ({ datum: parseDate(r[impMap.datum]), text: (r[impMap.text] || '').slice(0, 200), amount: parseAmount(r[impMap.belopp]) }))
      .filter(t => t.datum && t.amount != null)
  }
  async function doImport() {
    const txs = parsedImport()
    if (!txs.length) return toast.error('Inga giltiga rader – kontrollera kolumnvalen')
    setImporting(true)
    const { error } = await supabase.from('bank_transactions').insert(txs.map(t => ({ company_id: company.id, account_nr: selected, datum: t.datum, text: t.text, amount: t.amount, status: 'unmatched' })))
    setImporting(false)
    if (error) return toast.error('Kunde inte importera: ' + error.message)
    toast.success(`${txs.length} bankhändelser inlästa`)
    setImpOpen(false); setImpRows([]); setPasteText(''); setSubtab('inlasta'); load()
  }

  // --- Matchning mot öppna fakturor ---
  const metod = company?.bokforingsmetod || 'faktura'

  function matchFor(tx) {
    if (tx.status !== 'unmatched') return null
    const amt = Math.abs(tx.amount)
    if (amt < 0.01) return null
    if (tx.amount < 0) {
      // Leverantörsbetalning mot skuld – bara i faktureringsmetoden (kräver bokförd 2440).
      if (metod !== 'faktura') return null
      const inv = openSup.find(i => Math.abs((i.total_amount || 0) - amt) < 0.01)
      if (inv) return { type: 'sup', inv, summary: `${inv.invoice_nr || ''} Betalning av leverantörsfaktura ${inv.suppliers?.name || ''}`.trim() }
    } else {
      const inv = openCust.find(i => Math.abs((i.total_amount || 0) - amt) < 0.01)
      if (inv) return { type: 'cust', inv, summary: `${inv.invoice_nr} Betalning av kundfaktura ${inv.customers?.name || ''}`.trim() }
    }
    return null
  }

  async function bookMatch(tx, m) {
    const belopp = Math.abs(tx.amount)
    let rows
    if (m.type === 'sup') {
      rows = [{ nr: '2440', d: belopp, k: 0 }, { nr: selected, d: 0, k: belopp }]
    } else if (metod === 'kontant') {
      // Kontantmetoden: kundbetalning bokför intäkt + utgående moms direkt.
      const ex = m.inv.amount_excl_vat || 0, vat = m.inv.vat_amount || 0
      rows = [{ nr: selected, d: belopp, k: 0 }, { nr: '3001', d: 0, k: ex }]
      if (vat > 0.0001) rows.push({ nr: '2611', d: 0, k: vat })
    } else {
      // Faktureringsmetoden: kvitta kundfordran.
      rows = [{ nr: selected, d: belopp, k: 0 }, { nr: '1510', d: 0, k: belopp }]
    }
    const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: 'B - Bank' })
    const { data: ver, error } = await supabase.from('verifikationer').insert({
      company_id: company.id, ver_nr: nr || 'B' + Date.now(), ver_serie: 'B - Bank',
      datum: tx.datum, beskrivning: m.summary.slice(0, 200), total_debet: belopp, total_kredit: belopp, created_by: user.id,
    }).select().single()
    if (error) { toast.error(error.message); return false }
    await supabase.from('verifikation_rows').insert(rows.map((r, i) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: accName(r.nr), debet: r.d, kredit: r.k, sort_order: i })))
    await supabase.from('bank_transactions').update({ status: 'booked', verifikation_id: ver.id }).eq('id', tx.id)
    if (m.type === 'sup') await supabase.from('supplier_invoices').update({ status: 'paid' }).eq('id', m.inv.id)
    else await supabase.from('invoices').update({ status: 'paid' }).eq('id', m.inv.id)
    return true
  }

  async function bokforMatch(tx, m) {
    setWorking(true)
    const ok = await bookMatch(tx, m)
    setWorking(false)
    if (ok) { toast.success('Bokförd'); load() }
  }

  async function bokforAlla() {
    const matched = banktx.filter(t => t.status === 'unmatched').map(t => ({ t, m: matchFor(t) })).filter(x => x.m)
    if (!matched.length) return toast.error('Inga matchade händelser att bokföra')
    setWorking(true)
    let n = 0
    for (const { t, m } of matched) { if (await bookMatch(t, m)) n++ }
    setWorking(false)
    toast.success(`${n} händelser bokförda`)
    load()
  }

  function matcha(tx) {
    const p = new URLSearchParams({ banktx: tx.id, bankkonto: selected, bankdatum: tx.datum, bankbelopp: String(tx.amount), banktext: tx.text || '' })
    navigate(`/bokforing/ny?${p.toString()}`)
  }

  async function setBtxStatus(t, status) { await supabase.from('bank_transactions').update({ status }).eq('id', t.id); load() }
  async function removeBtx(t) { if (!confirm('Ta bort den inlästa transaktionen?')) return; await supabase.from('bank_transactions').delete().eq('id', t.id); load() }

  const totalSaldo = accounts.reduce((s, a) => s + a.saldo, 0)
  const selAcc = accounts.find(a => a.account_nr === selected)
  const händelser = selected ? (rowsByAcc[selected] || []) : []
  const banktx = selected ? (bankByAcc[selected] || []) : []
  const openingBalance = selAcc?.opening_balance || 0

  let running = openingBalance
  const radMedSaldo = händelser.map(h => { running += h.debet - h.kredit; return { ...h, saldo: running } })

  const avstamtSaldo = openingBalance + händelser.filter(h => h.avstamd).reduce((s, h) => s + h.debet - h.kredit, 0)
  const ejAvstamda = händelser.filter(h => !h.avstamd).length
  const utdrag = parseFloat(String(kontoutdrag[selected] ?? '').replace(',', '.'))
  const diff = isNaN(utdrag) ? null : utdrag - avstamtSaldo

  const ejBokforda = banktx.filter(t => t.status !== 'booked' && t.status !== 'ignored')
  const matchadeAntal = ejBokforda.filter(t => matchFor(t)).length
  const previewCols = impRows[0]?.length || 0

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kassa- och bankhändelser</span>
        <div className="flex items-center gap-3">
          {selected && <>
            <button className="btn" onClick={() => fileRef.current?.click()}><i className="ti ti-file-upload" /> Läs in fil</button>
            <button className="btn btn-primary" onClick={() => { setPasteText(''); setPasteOpen(true) }}><i className="ti ti-clipboard" /> Klistra in kontoutdrag</button>
          </>}
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden" onChange={onFile} />
          <span className="text-sm text-gray-500">Totalt: <span className="font-semibold text-gray-800 tabular-nums">{fmt(totalSaldo)} kr</span></span>
        </div>
      </div>

      <div className="p-7">
        {loading ? <div className="text-gray-400 py-12 text-center">Laddar…</div>
        : accounts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <i className="ti ti-building-bank text-4xl block mb-3 opacity-30" />
            <div className="font-medium text-gray-500 mb-1">Inga kassa-/bankkonton</div>
            <div className="text-sm">Bokför på ett 19xx-konto eller klistra in ett kontoutdrag.</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3.5 mb-7">
              {accounts.map(a => (
                <button key={a.account_nr} onClick={() => setSelected(a.account_nr)}
                  className={`text-left bg-white rounded-xl p-4 transition-colors ${selected === a.account_nr ? 'ring-2 ring-blue-500' : 'hover:bg-gray-50'}`}
                  style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className="text-xs text-gray-500 mb-1">{a.account_nr} · {a.name}</div>
                  <div className="text-[20px] font-semibold tabular-nums" style={{ color: a.saldo >= 0 ? '#185FA5' : '#A32D2D' }}>{fmt(a.saldo)}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{a.antal} händelser{a.ejBok ? ` · ${a.ejBok} ej bokförda` : ''}</div>
                </button>
              ))}
            </div>

            {selAcc && (
              <>
                <div className="flex border-b mb-3" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                  {[['handelser', `Kontohändelser (${händelser.length})`], ['inlasta', `Ej bokförda bankhändelser (${ejBokforda.length})`]].map(([k, label]) => (
                    <button key={k} onClick={() => setSubtab(k)} className={`px-4 py-2 text-[13.5px] border-b-[2.5px] -mb-px ${subtab === k ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>{label}</button>
                  ))}
                </div>

                {subtab === 'handelser' ? (
                  <>
                    <div className="flex items-center justify-end gap-4 text-sm mb-2">
                      <span className="text-gray-500">Avstämt saldo: <span className="font-semibold text-gray-800 tabular-nums">{fmt(avstamtSaldo)}</span></span>
                      {ejAvstamda > 0 && <span className="text-amber-700">{ejAvstamda} ej avstämda</span>}
                      <span className="flex items-center gap-1.5 text-gray-500">Kontoutdrag:
                        <input className="input w-32 py-1" inputMode="decimal" placeholder="saldo" value={kontoutdrag[selected] ?? ''} onChange={e => setKontoutdrag(k => ({ ...k, [selected]: e.target.value }))} />
                      </span>
                      {diff !== null && <span className={Math.abs(diff) < 0.01 ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>{Math.abs(diff) < 0.01 ? '✓ Stämmer' : `Diff ${fmt(diff)}`}</span>}
                    </div>
                    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                            <th className="px-3 py-2.5 border-b w-12 text-center" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Avst.</th>
                            <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Datum</th>
                            <th className="text-left px-4 py-2.5 border-b w-16" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Ver</th>
                            <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
                            <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>In</th>
                            <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Ut</th>
                            <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Saldo</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="text-gray-500">
                            <td className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }} />
                            <td className="px-4 py-2 border-b" colSpan="5" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>Ingående saldo</td>
                            <td className="px-4 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(openingBalance)}</td>
                          </tr>
                          {radMedSaldo.length === 0 ? (
                            <tr><td colSpan="7" className="text-center py-10 text-gray-400">Inga händelser.</td></tr>
                          ) : radMedSaldo.map((h, i) => (
                            <tr key={i} className={`hover:bg-gray-50 ${h.avstamd ? 'bg-green-50/40' : ''}`}>
                              <td className="px-3 py-2.5 border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><input type="checkbox" checked={h.avstamd} onChange={() => toggleAvstamd(h)} className="cursor-pointer w-4 h-4" /></td>
                              <td className="px-4 py-2.5 border-b text-gray-600 cursor-pointer" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => navigate(`/bokforing/${h.id}`)}>{h.datum}</td>
                              <td className="px-4 py-2.5 border-b font-medium cursor-pointer" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => navigate(`/bokforing/${h.id}`)}>{h.ver_nr}</td>
                              <td className="px-4 py-2.5 border-b cursor-pointer" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => navigate(`/bokforing/${h.id}`)}>{h.beskrivning}</td>
                              <td className="px-4 py-2.5 border-b text-right tabular-nums text-green-700" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{h.debet ? fmt(h.debet) : ''}</td>
                              <td className="px-4 py-2.5 border-b text-right tabular-nums text-red-700" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{h.kredit ? fmt(h.kredit) : ''}</td>
                              <td className="px-4 py-2.5 border-b text-right tabular-nums font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(h.saldo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2 text-sm">
                      <span className="text-gray-500">{ejBokforda.length} av {banktx.length} bankhändelser ej bokförda{matchadeAntal ? ` · ${matchadeAntal} föreslås` : ''}</span>
                      {matchadeAntal > 0 && <button className="btn btn-primary" onClick={bokforAlla} disabled={working}>{working ? 'Bokför…' : `Bokför alla matchade (${matchadeAntal})`}</button>}
                    </div>
                    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                      {banktx.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                          <i className="ti ti-clipboard text-3xl block mb-2 opacity-30" />
                          Inga bankhändelser – klicka "Klistra in kontoutdrag" eller "Läs in fil".
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                              <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Datum</th>
                              <th className="text-left px-4 py-2.5 border-b w-48" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Referens</th>
                              <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                              <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Sammanfattning</th>
                              <th className="text-right px-4 py-2.5 border-b w-44" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {banktx.map(t => {
                              const m = matchFor(t)
                              const booked = t.status === 'booked'
                              return (
                                <tr key={t.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.datum}</td>
                                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{t.text}</td>
                                  <td className="px-4 py-2.5 border-b text-right tabular-nums font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)', color: t.amount >= 0 ? '#1a7a2e' : '#b91c1c' }}>{fmt(t.amount)}</td>
                                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                                    {booked ? <span className="text-gray-500">Bokförd</span>
                                      : m ? <span className="text-gray-700">{m.summary}</span>
                                      : <span className="text-gray-400 italic">Ingen överensstämmande bokföringshändelse hittad</span>}
                                  </td>
                                  <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                                    {booked ? (
                                      <button className="text-blue-700 text-xs hover:underline" onClick={() => navigate(`/bokforing/${t.verifikation_id}`)}><i className="ti ti-link" /> Visa verifikation</button>
                                    ) : t.status === 'ignored' ? (
                                      <button className="text-gray-300 hover:text-red-600" title="Ta bort" onClick={() => removeBtx(t)}><i className="ti ti-trash" /></button>
                                    ) : m ? (
                                      <button className="btn btn-primary text-xs py-1 px-3" onClick={() => bokforMatch(t, m)} disabled={working}>Bokför</button>
                                    ) : (
                                      <>
                                        <button className="btn text-xs py-1 px-3 mr-1.5" onClick={() => matcha(t)}>Matcha</button>
                                        <button className="text-gray-300 hover:text-gray-600 mr-1.5 align-middle" title="Ignorera" onClick={() => setBtxStatus(t, 'ignored')}><i className="ti ti-eye-off text-xs" /></button>
                                        <button className="text-gray-300 hover:text-red-600 align-middle" title="Ta bort" onClick={() => removeBtx(t)}><i className="ti ti-trash text-xs" /></button>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Klistra in kontoutdrag */}
      {pasteOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPasteOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Klistra in kontoutdrag → {selAcc?.account_nr} {selAcc?.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setPasteOpen(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-500 mb-2">Kopiera raderna från din internetbank (datum, text, belopp) och klistra in nedan. Tabb-, komma- eller semikolon­separerat fungerar.</p>
              <textarea className="input font-mono text-xs" rows={10} value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder={'2026-05-21\tLÖNER\t-32000,00\n2026-05-21\tFORTNOX FINANS AB\t-750,00'} autoFocus />
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setPasteOpen(false)}>Avbryt</button>
              <button className="btn btn-primary" onClick={() => { setPasteOpen(false); startImport(pasteText) }} disabled={!pasteText.trim()}>Fortsätt</button>
            </div>
          </div>
        </div>
      )}

      {/* Import: kolumnmappning + förhandsvisning */}
      {impOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !importing && setImpOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Granska och läs in → {selAcc?.account_nr} {selAcc?.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setImpOpen(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 border-b flex flex-wrap items-end gap-4" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={impHeader} onChange={e => { setImpHeader(e.target.checked); if (e.target.checked) setImpMap(guessColumns(impRows[0])) }} /> Första raden är rubrik</label>
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
    </div>
  )
}
