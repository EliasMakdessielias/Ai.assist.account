import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { granskaMomsFynd } from '../lib/momskontroll'
import toast from 'react-hot-toast'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const verNum = v => parseInt(String(v.ver_nr || '').replace(/\D/g, ''), 10) || 0

const SEV = {
  fel: { label: 'Fel', icon: 'ti-alert-circle-filled', bg: 'rgba(220,38,38,0.1)', color: '#b91c1c', dot: '#dc2626' },
  varning: { label: 'Varning', icon: 'ti-alert-triangle-filled', bg: 'rgba(234,179,8,0.12)', color: '#92700a', dot: '#eab308' },
  info: { label: 'Info', icon: 'ti-info-circle-filled', bg: 'rgba(59,130,246,0.1)', color: '#1d4ed8', dot: '#3b82f6' },
  ok: { label: 'OK', icon: 'ti-circle-check-filled', bg: 'rgba(52,211,153,0.12)', color: '#1a7a2e', dot: '#34d399' },
}

export default function Granskning() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const yr = new Date().getFullYear()
  const [from, setFrom] = useState(`${yr}-01-01`)
  const [tom, setTom] = useState(`${yr}-12-31`)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [findings, setFindings] = useState(null)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [fy, setFy] = useState([])

  useEffect(() => { if (company) initFy() }, [company?.id])
  async function initFy() {
    const { data: f } = await supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false })
    setFy(f || [])
    const active = (f || []).find(y => y.status === 'active') || (f || [])[0]
    if (active) { setFrom(active.start_date); setTom(active.end_date) }
  }

  async function kor() {
    setLoading(true); setAiText('')
    const [{ data: vers }, { data: rows }, { data: docs }, { data: sup }, { data: btx }, { data: accs }] = await Promise.all([
      supabase.from('verifikationer').select('id, ver_nr, ver_serie, datum, beskrivning, total_debet, total_kredit').eq('company_id', company.id),
      supabase.from('verifikation_rows').select('verifikation_id, account_nr, debet, kredit, avstamd, verifikationer!inner(company_id, datum)').eq('verifikationer.company_id', company.id),
      supabase.from('documents').select('verifikation_id').eq('company_id', company.id).not('verifikation_id', 'is', null),
      supabase.from('supplier_invoices').select('id, bokford, makulerad, status, due_date, total_amount, vat_amount, verifikation_id, invoice_nr, suppliers(name)').eq('company_id', company.id),
      supabase.from('bank_transactions').select('account_nr, datum, status, amount').eq('company_id', company.id),
      supabase.from('accounts').select('account_nr, name, opening_balance, is_active').eq('company_id', company.id),
    ])
    setData({ vers: vers || [], rows: rows || [], docs: docs || [], sup: sup || [], btx: btx || [], accs: accs || [] })
    setLoading(false)
  }

  const result = useMemo(() => {
    if (!data) return null
    const inP = d => d >= from && d <= tom
    const F = []
    const push = (sev, titel, detalj, antal, items, lank) => F.push({ sev, titel, detalj, antal, items: items || [], lank })

    const versP = data.vers.filter(v => inP(v.datum))
    const rowsByVer = {}; data.rows.forEach(r => { (rowsByVer[r.verifikation_id] ||= []).push(r) })
    const docVerIds = new Set(data.docs.map(d => d.verifikation_id))
    const accSet = new Set(data.accs.map(a => a.account_nr))
    const accName = nr => data.accs.find(a => a.account_nr === nr)?.name || ''

    // 1. Obalanserade verifikationer
    const obal = versP.filter(v => {
      const rs = rowsByVer[v.id] || []
      const d = rs.reduce((s, r) => s + (r.debet || 0), 0), k = rs.reduce((s, r) => s + (r.kredit || 0), 0)
      return Math.abs(d - k) > 0.01
    })
    if (obal.length) push('fel', 'Obalanserade verifikationer', 'Debet och kredit stämmer inte. Måste rättas (BFL).', obal.length, obal.map(v => ({ id: v.id, txt: `${v.ver_nr} ${v.datum} ${v.beskrivning || ''}` })))

    // 2. Konton utanför kontoplanen
    const okonto = new Set()
    versP.forEach(v => (rowsByVer[v.id] || []).forEach(r => { if (r.account_nr && !accSet.has(r.account_nr)) okonto.add(r.account_nr) }))
    if (okonto.size) push('fel', 'Konton saknas i kontoplanen', `Konteringar använder konton som inte finns: ${[...okonto].join(', ')}.`, okonto.size)

    // 3. Nummerluckor per serie (BFL: obruten ordningsföljd)
    const bySerie = {}; versP.forEach(v => { (bySerie[v.ver_serie || '?'] ||= []).push(verNum(v)) })
    const luckor = []
    Object.entries(bySerie).forEach(([s, nums]) => {
      const sorted = [...new Set(nums)].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 1) luckor.push(`${s}: ${sorted[i - 1]}→${sorted[i]}`)
    })
    if (luckor.length) push('varning', 'Luckor i verifikationsnummer', 'Verifikationsserier ska vara obrutna. Kontrollera raderade/saknade nummer.', luckor.length, luckor.map(t => ({ txt: t })))

    // 4. Datum utanför valt räkenskapsår
    // (period = from/tom, så allt vi visar ligger i perioden – men flagga ver med datum i framtiden)
    const framtid = versP.filter(v => v.datum > today())
    if (framtid.length) push('varning', 'Verifikationer daterade i framtiden', 'Bokföringsdatum ligger efter dagens datum.', framtid.length, framtid.map(v => ({ id: v.id, txt: `${v.ver_nr} ${v.datum}` })))

    // 5. Bokförda leverantörsfakturor utan kopplat underlag (BFL underlag)
    const utanUnderlag = data.sup.filter(s => s.bokford && !s.makulerad && s.verifikation_id && !docVerIds.has(s.verifikation_id))
    if (utanUnderlag.length) push('varning', 'Leverantörsfakturor utan underlag', 'Bokförda fakturor saknar kopplat underlag (kvitto/faktura). Underlag krävs enligt BFL.', utanUnderlag.length, utanUnderlag.map(s => ({ id: s.verifikation_id, txt: `${s.invoice_nr || ''} ${s.suppliers?.name || ''}` })))

    // 6. Omatchade bankhändelser i perioden (fullständighet)
    const obok = data.btx.filter(t => inP(t.datum) && t.status !== 'booked' && t.status !== 'ignored')
    if (obok.length) push('varning', 'Ej bokförda bankhändelser', 'Inlästa bankhändelser som inte bokförts i perioden – bokföringen kan vara ofullständig.', obok.length, [], '/kassa-bank')

    // 7. Obokförda leverantörsfakturor
    const ejBokfSup = data.sup.filter(s => !s.bokford && !s.makulerad)
    if (ejBokfSup.length) push('info', 'Ej bokförda leverantörsfakturor', 'Registrerade men ej bokförda leverantörsfakturor.', ejBokfSup.length, [], '/leverantorsfakturor')

    // 8. Förfallna obetalda leverantörsfakturor
    const forfallna = data.sup.filter(s => s.status === 'unpaid' && !s.makulerad && s.due_date && s.due_date < today())
    if (forfallna.length) push('info', 'Förfallna obetalda leverantörsfakturor', 'Fakturor vars förfallodatum passerat.', forfallna.length, forfallna.map(s => ({ txt: `${s.suppliers?.name || ''} förföll ${s.due_date}` })), '/leverantorsfakturor')

    // 9. Oavstämda bankkonton (19xx-rader ej avstämda) i perioden
    const oavst = data.rows.filter(r => /^19/.test(r.account_nr) && inP(r.verifikationer?.datum) && !r.avstamd)
    if (oavst.length) push('info', 'Oavstämda bankposter', 'Bokföringsposter på bankkonton (19xx) som inte stämts av mot kontoutdrag.', oavst.length, [], '/bokforing')

    // 10. Försäljning utan utgående moms (kontroll – kan vara momsfritt)
    let sales = 0, utgMoms = 0
    versP.forEach(v => (rowsByVer[v.id] || []).forEach(r => {
      if (/^3/.test(r.account_nr)) sales += (r.kredit || 0) - (r.debet || 0)
      if (/^26[123]/.test(r.account_nr)) utgMoms += (r.kredit || 0) - (r.debet || 0)
    }))
    if (sales > 100 && utgMoms < 0.01) push('varning', 'Försäljning utan utgående moms', `Försäljning (${fmt(sales)} kr) bokförd men ingen utgående moms i perioden. Kontrollera momsplikt.`, 1)

    // 11. Negativ kassa (1910)
    const kassaOB = data.accs.find(a => a.account_nr === '1910')?.opening_balance || 0
    const kassaRader = data.rows.filter(r => r.account_nr === '1910' && inP(r.verifikationer?.datum)).sort((a, b) => (a.verifikationer?.datum || '').localeCompare(b.verifikationer?.datum || ''))
    let saldo = kassaOB, negDatum = null
    kassaRader.forEach(r => { saldo += (r.debet || 0) - (r.kredit || 0); if (saldo < -0.01 && !negDatum) negDatum = r.verifikationer?.datum })
    if (negDatum) push('fel', 'Negativt kassasaldo', `Kassan (1910) blir negativ ${negDatum}. En kassa kan aldrig vara negativ – kontrollera kontering.`, 1)

    // 12. Möjliga dubbletter (samma datum, belopp, serie)
    const seen = {}; const dubbletter = []
    versP.forEach(v => { const key = `${v.datum}|${(v.total_debet || 0).toFixed(2)}|${(v.ver_serie || '')[0]}|${(v.beskrivning || '').toLowerCase().slice(0, 20)}`; if (seen[key]) dubbletter.push({ id: v.id, txt: `${v.ver_nr} ${v.datum} ${fmt(v.total_debet)}` }); else seen[key] = v.id })
    if (dubbletter.length) push('varning', 'Möjliga dubbletter', 'Verifikationer med samma datum, belopp och beskrivning – kan vara dubbelbokfört.', dubbletter.length, dubbletter)

    // 13. Momskontroll (inför momsredovisning): moms mot kostnads-/intäktskonto, fel momskonto,
    // fel riktning, momspliktig försäljning utan moms, leverantörsfakturor bokförda fel.
    const MOMS_DETALJ = {
      moms_fel_sats: 'Momsbeloppet motsvarar inte 25/12/6 % av kostnads-/intäktsnettot. Öppna verifikationen för att se var det skiljer.',
      moms_fel_konto: 'Bokförd moms stämmer inte med försäljningskontots momssats (t.ex. 3001 = 25 %).',
      moms_fel_riktning: 'Ingående moms på en försäljning, eller utgående moms på ett inköp – kontrollera momskontot.',
      moms_utan_konto: 'Moms bokförd utan kostnads- eller intäktskonto i verifikationen.',
      moms_saknas: 'Försäljning på momspliktigt konto utan utgående moms – kontrollera momsplikten.',
      lev_fel_belopp: 'Bokfört belopp stämmer inte med leverantörsfakturans totalbelopp.',
      lev_fel_moms: 'Bokförd ingående moms stämmer inte med fakturans momsbelopp.',
      lev_moms_saknas: 'Leverantörsfaktura med moms men ingen ingående moms (264x) bokförd.',
    }
    const momsFynd = granskaMomsFynd({ vers: versP, rowsByVer, supplierInvoices: data.sup })
    const momsGrupp = {}
    momsFynd.forEach(m => { (momsGrupp[m.kod] ||= []).push(m) })
    Object.values(momsGrupp).forEach(arr => {
      const f0 = arr[0]
      push(f0.sev, f0.titel, MOMS_DETALJ[f0.kod] || f0.detalj, arr.length, arr.map(m => ({ id: m.verId, txt: `${m.ver_nr} ${m.datum}` })))
    })

    F.sort((a, b) => ({ fel: 0, varning: 1, info: 2 }[a.sev]) - ({ fel: 0, varning: 1, info: 2 }[b.sev]))
    const agg = { antalVer: versP.length, fel: F.filter(f => f.sev === 'fel').length, varning: F.filter(f => f.sev === 'varning').length, info: F.filter(f => f.sev === 'info').length, sales, utgMoms }
    return { F, agg }
  }, [data, from, tom])

  useEffect(() => { setFindings(result); setAiText('') }, [result])

  async function aiAnalys() {
    if (!findings) return
    setAiBusy(true)
    try {
      const payload = {
        period: { from, tom },
        antalVerifikationer: findings.agg.antalVer,
        fynd: findings.F.map(f => ({ allvar: f.sev, titel: f.titel, antal: f.antal, detalj: f.detalj })),
      }
      const { data: res, error } = await supabase.functions.invoke('granska-ai', { body: payload })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (res?.error) throw new Error(res.error)
      setAiText(res.analys || '')
    } catch (e) { toast.error('AI-analys misslyckades: ' + (e.message || e)) }
    setAiBusy(false)
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-shield-check text-purple-600" /> AI-granskning</span>
        <button className="btn btn-primary" onClick={kor} disabled={loading}>{loading ? 'Granskar…' : 'Kör granskning'}</button>
      </div>

      <div className="p-7 max-w-4xl">
        <div className="flex items-end gap-3 mb-5 flex-wrap">
          {fy.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Räkenskapsår</label>
              <select className="input w-56" value={`${from}|${tom}`} onChange={e => { const [f, t] = e.target.value.split('|'); setFrom(f); setTom(t) }}>
                {fy.map(y => <option key={y.id} value={`${y.start_date}|${y.end_date}`}>{y.year} ({y.start_date} – {y.end_date})</option>)}
              </select>
            </div>
          )}
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Fr.o.m.</label><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">T.o.m.</label><input className="input" type="date" value={tom} onChange={e => setTom(e.target.value)} /></div>
        </div>

        {!findings ? (
          <div className="text-center py-16 text-gray-400">
            <i className="ti ti-shield-check text-4xl block mb-3 opacity-30" />
            <div className="font-medium text-gray-500 mb-1">Granska bokföringen enligt BFL och god redovisningssed</div>
            <div className="text-sm">Välj period och klicka "Kör granskning".</div>
          </div>
        ) : (
          <>
            {/* Sammanfattning */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[['Verifikationer', findings.agg.antalVer, 'ok'], ['Fel', findings.agg.fel, 'fel'], ['Varningar', findings.agg.varning, 'varning'], ['Info', findings.agg.info, 'info']].map(([l, n, s]) => (
                <div key={l} className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className="text-[22px] font-semibold tabular-nums" style={{ color: SEV[s].color }}>{n}</div>
                  <div className="text-xs text-gray-500">{l}</div>
                </div>
              ))}
            </div>

            {/* AI-analys */}
            <div className="bg-white rounded-xl p-5 mb-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold flex items-center gap-2"><i className="ti ti-sparkles text-purple-600" /> AI-analys & åtgärdsplan</span>
                <button className="btn text-xs py-1 px-3" onClick={aiAnalys} disabled={aiBusy}>{aiBusy ? 'Analyserar…' : 'Be AI prioritera'}</button>
              </div>
              {aiText ? <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{aiText}</div>
                : <div className="text-xs text-gray-400">Klicka "Be AI prioritera" så sammanfattar AI fynden och föreslår en åtgärdsordning. (Endast antal/belopp skickas – inga person- eller kunduppgifter.)</div>}
            </div>

            {/* Fynd */}
            {findings.F.length === 0 ? (
              <div className="bg-white rounded-xl p-6 text-center" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <i className="ti ti-circle-check-filled text-3xl text-green-600 block mb-2" />
                <div className="font-medium">Inga avvikelser hittades i perioden 🎉</div>
                <div className="text-sm text-gray-500">Bokföringen ser ut att följa kontrollerna.</div>
              </div>
            ) : findings.F.map((f, i) => {
              const sv = SEV[f.sev]
              return (
                <div key={i} className="bg-white rounded-xl p-4 mb-3" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className="flex items-start gap-3">
                    <i className={`ti ${sv.icon} text-lg mt-0.5`} style={{ color: sv.dot }} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{f.titel}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: sv.bg, color: sv.color }}>{f.antal} st</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">{f.detalj}</div>
                      {f.items.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.items.slice(0, 12).map((it, j) => (
                            <button key={j} className={`text-xs px-2 py-0.5 rounded ${it.id ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-gray-50 text-gray-500'}`}
                              onClick={() => it.id && navigate(`/bokforing/${it.id}`)}>{it.txt}</button>
                          ))}
                          {f.items.length > 12 && <span className="text-xs text-gray-400 self-center">+{f.items.length - 12} till</span>}
                        </div>
                      )}
                      {f.lank && <button className="text-xs text-blue-700 hover:underline mt-2" onClick={() => navigate(f.lank)}>Öppna →</button>}
                    </div>
                  </div>
                </div>
              )
            })}

            <div className="text-xs text-gray-400 mt-4">
              Granskningen är ett beslutsstöd enligt bokföringslagen och god redovisningssed. Den ersätter inte din egen bedömning – du ansvarar för bokföringen. Inga ändringar görs automatiskt.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
