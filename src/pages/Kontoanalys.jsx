import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { BRAND } from '../lib/brand'
import { buildInvoiceLinkMap, buildRelatedVerMap, invoiceRoute, splitDescriptionByInvoiceNr } from '../lib/kontoanalys'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const verNum = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0
const PAGE = 120

function parseKonto(str) {
  const parts = String(str || '').split(/[,\s]+/).filter(Boolean)
  if (!parts.length) return null
  const ranges = parts.map(p => { const m = p.match(/^(\d+)\s*-\s*(\d+)$/); return m ? [+m[1], +m[2]] : [+p, +p] }).filter(r => !isNaN(r[0]))
  if (!ranges.length) return null
  return nr => { const n = +nr; return ranges.some(([a, b]) => n >= a && n <= b) }
}
const docType = serie => { const s = String(serie || ''); return s.includes(' - ') ? s.split(' - ')[1] : s }

export default function Kontoanalys({ popout = false, interactiveLinks = !popout }) {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const yr = new Date().getFullYear()
  // Filter kan seedas via query params (så popout öppnas med samma urval). Ingen ny modell.
  const validTab = t => (['huvudbok', 'balans', 'resultat'].includes(t) ? t : 'huvudbok')
  const urlHasPeriod = !!(params.get('from') && params.get('to'))
  const [tab, setTab] = useState(validTab(params.get('tab')))
  const [accounts, setAccounts] = useState([])
  const [rows, setRows] = useState([])
  const [fy, setFy] = useState([])
  const [loading, setLoading] = useState(true)
  const [kontoSok, setKontoSok] = useState(params.get('account') || '')
  const [textSok, setTextSok] = useState(params.get('search') || '')
  const [from, setFrom] = useState(params.get('from') || `${yr}-01-01`)
  const [tom, setTom] = useState(params.get('to') || `${yr}-12-31`)
  const [doljKorr, setDoljKorr] = useState(params.get('hideCorrections') === '1')
  const [doktyp, setDoktyp] = useState(params.get('documentType') || 'Alla')
  const [page, setPage] = useState(0)
  const [invoiceLinks, setInvoiceLinks] = useState({})   // verifikation_id → { kind, id, invoice_nr }
  const [relatedVer, setRelatedVer] = useState({})       // verifikation_id → [relaterade verifikation_id]
  const [docSet, setDocSet] = useState(() => new Set())  // verifikation_id med kopplat underlag
  const [expandedKey, setExpandedKey] = useState(null)   // inline-expanderad rad (konto:ver, en åt gången)

  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    setLoading(true)
    // Allt scopat på company_id (+ RLS) → ingen data från andra företag. supplier_invoices/
    // invoices/documents används för fakturalänk (interaktiv vy), relaterade verifikationer och
    // bilaga-indikator i den inline-expanderade panelen.
    const [{ data: acc }, { data: r }, { data: f }, { data: si }, { data: ci }, { data: dox }] = await Promise.all([
      supabase.from('accounts').select('account_nr, name, opening_balance, vat_code').eq('company_id', company.id).order('account_nr'),
      supabase.from('verifikation_rows').select('account_nr, debet, kredit, verifikationer!inner(id, ver_nr, ver_serie, datum, beskrivning, company_id)').eq('verifikationer.company_id', company.id),
      supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false }),
      supabase.from('supplier_invoices').select('id, invoice_nr, verifikation_id, betalning_ver_id').eq('company_id', company.id),
      supabase.from('invoices').select('id, invoice_nr, verifikation_id').eq('company_id', company.id).not('verifikation_id', 'is', null),
      supabase.from('documents').select('verifikation_id').eq('company_id', company.id).not('verifikation_id', 'is', null),
    ])
    setAccounts(acc || [])
    setRows((r || []).map(x => ({
      account_nr: x.account_nr, ver_id: x.verifikationer.id, ver_nr: x.verifikationer.ver_nr, serie: x.verifikationer.ver_serie,
      datum: x.verifikationer.datum, besk: x.verifikationer.beskrivning, belopp: (x.debet || 0) - (x.kredit || 0),
    })))
    setFy(f || [])
    // Fakturalänk används bara i interaktiv vy (renderBesk gate:ar på interactiveLinks).
    setInvoiceLinks(buildInvoiceLinkMap((si || []).filter(x => x.verifikation_id), ci))
    setRelatedVer(buildRelatedVerMap(si))
    setDocSet(new Set((dox || []).map(d => d.verifikation_id).filter(Boolean)))
    // Auto-välj aktivt räkenskapsår – men inte om perioden redan kommer från URL (popout).
    const active = (f || []).find(y => y.status === 'active') || (f || [])[0]
    if (active && !urlHasPeriod) { setFrom(active.start_date); setTom(active.end_date) }
    setLoading(false)
  }

  const accName = nr => accounts.find(a => a.account_nr === nr)?.name || ''
  const accOB = nr => accounts.find(a => a.account_nr === nr)?.opening_balance || 0
  const accVat = nr => accounts.find(a => a.account_nr === nr)?.vat_code || ''   // momskod från kontoplanen
  const doktyper = useMemo(() => ['Alla', ...[...new Set(rows.map(r => docType(r.serie)).filter(Boolean))].sort()], [rows])

  const kontoMatch = parseKonto(kontoSok)
  const matchRad = r => {
    if (doljKorr && /^R/.test(r.serie || '')) return false
    if (doktyp !== 'Alla' && docType(r.serie) !== doktyp) return false
    if (textSok && !`${r.ver_nr} ${r.besk || ''}`.toLowerCase().includes(textSok.toLowerCase())) return false
    return true
  }

  // Huvudbok: konton med rörelse i perioden (eller som matchar kontofilter)
  const huvudbok = useMemo(() => {
    const kontonMedRorelse = [...new Set(rows.map(r => r.account_nr))]
    const valda = kontonMedRorelse.filter(nr => !kontoMatch || kontoMatch(nr)).sort((a, b) => a.localeCompare(b))
    return valda.map(nr => {
      const alla = rows.filter(r => r.account_nr === nr)
      const ib = accOB(nr) + alla.filter(r => r.datum < from && matchRad(r)).reduce((s, r) => s + r.belopp, 0)
      const periodRader = alla.filter(r => r.datum >= from && r.datum <= tom && matchRad(r))
        .sort((a, b) => a.datum.localeCompare(b.datum) || verNum(a.ver_nr) - verNum(b.ver_nr))
      let saldo = ib
      const rader = periodRader.map(r => { saldo += r.belopp; return { ...r, saldo } })
      return { nr, namn: accName(nr), ib, ub: saldo, rader }
    }).filter(g => g.rader.length > 0)
  }, [rows, kontoSok, textSok, from, tom, doljKorr, doktyp, accounts])

  // Platta render-items för paginering
  const items = useMemo(() => {
    const out = []
    huvudbok.forEach(g => {
      out.push({ type: 'head', g }); out.push({ type: 'ib', g })
      g.rader.forEach(r => out.push({ type: 'row', g, r }))
      out.push({ type: 'ub', g })
    })
    return out
  }, [huvudbok])
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE))
  const cur = Math.min(page, pageCount - 1)
  const pageItems = items.slice(cur * PAGE, (cur + 1) * PAGE)

  // Balans-/Resultaträkning
  const saldoUB = nr => accOB(nr) + rows.filter(r => r.account_nr === nr && r.datum <= tom && matchRad(r)).reduce((s, r) => s + r.belopp, 0)
  const periodSum = nr => rows.filter(r => r.account_nr === nr && r.datum >= from && r.datum <= tom && matchRad(r)).reduce((s, r) => s + r.belopp, 0)
  const rapportRader = (test, sign) => accounts.filter(a => test(a.account_nr)).map(a => ({ nr: a.account_nr, namn: a.name, v: sign * (tab === 'balans' ? saldoUB(a.account_nr) : periodSum(a.account_nr)) })).filter(x => Math.abs(x.v) > 0.005)

  // Bygg popout-URL med nuvarande filter så det egna fönstret öppnas med samma urval.
  function popoutUrl() {
    const q = new URLSearchParams()
    if (tab !== 'huvudbok') q.set('tab', tab)
    if (kontoSok) q.set('account', kontoSok)
    if (textSok) q.set('search', textSok)
    if (from) q.set('from', from)
    if (tom) q.set('to', tom)
    if (doljKorr) q.set('hideCorrections', '1')
    if (doktyp && doktyp !== 'Alla') q.set('documentType', doktyp)
    const qs = q.toString()
    return `/kontoanalys/popout${qs ? `?${qs}` : ''}`
  }
  // Eget fönster: samma origin/session/aktiva företag → live samma data, RLS oförändrad. Ingen state kopieras.
  function openPopout() { window.open(window.location.origin + popoutUrl(), 'bokpilot-kontoanalys-popout', 'width=1280,height=900') }
  // Stäng: stäng skript-öppnat fönster; annars (öppnat direkt/refresh) navigera tillbaka. Påverkar ej huvudappen.
  function stangPopout() { window.close(); setTimeout(() => { if (!window.closed) navigate('/kontoanalys') }, 150) }

  // Beskrivning med klickbart fakturanummer – endast i interaktiv vy och när verifikationen
  // är kopplad till exakt EN faktura (company-scopad relation). Annars vanlig text.
  function renderBesk(r) {
    const link = interactiveLinks ? invoiceLinks[r.ver_id] : null
    const parts = link ? splitDescriptionByInvoiceNr(r.besk, link.invoice_nr) : null
    if (!parts) return r.besk
    return (<>{parts.before}<button className="text-blue-700 hover:underline font-medium" title={`Öppna faktura ${link.invoice_nr}`} onClick={() => navigate(invoiceRoute(link))}>{parts.match}</button>{parts.after}</>)
  }

  // Inline-detaljer för en verifikation (från redan laddad data – ingen ny fetch). Visar
  // konto/momskod/projekt/debet/kredit, dokumenttyp/datum/belopp/bilaga, relaterade
  // verifikationer samt knappar. Ingen navigation sker från Ver.nr-klicket självt.
  function VerDetail({ r }) {
    const vid = r.ver_id
    const detail = rows.filter(x => x.ver_id === vid).sort((a, b) => String(a.account_nr).localeCompare(String(b.account_nr)))
    const total = detail.reduce((s, d) => s + (d.belopp > 0 ? d.belopp : 0), 0)
    const related = (relatedVer[vid] || []).map(rid => {
      const rr = rows.find(x => x.ver_id === rid); if (!rr) return null
      const tot = rows.filter(x => x.ver_id === rid).reduce((s, x) => s + (x.belopp > 0 ? x.belopp : 0), 0)
      return { ver_id: rid, ver_nr: rr.ver_nr, besk: rr.besk, serie: rr.serie, datum: rr.datum, total: tot }
    }).filter(Boolean)
    return (
      <td colSpan="6" className="p-0 border-b" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
        <div className="px-4 py-3" style={{ borderLeft: '3px solid #6d28d9', background: 'rgba(109,40,217,0.04)' }}>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left py-1">Konto</th><th className="text-left">Momskod</th><th className="text-left">Projekt</th>
                <th className="text-right">Debet</th><th className="text-right">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {detail.map((d, ix) => (
                <tr key={ix}>
                  <td className="py-1 text-gray-700">{d.account_nr} – {accName(d.account_nr)}</td>
                  <td className="text-gray-600">{accVat(d.account_nr)}</td>
                  <td className="text-gray-600" />
                  <td className="text-right tabular-nums">{d.belopp > 0 ? fmt(d.belopp) : ''}</td>
                  <td className="text-right tabular-nums">{d.belopp < 0 ? fmt(-d.belopp) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-4 text-[12px] text-gray-500 mb-2">
            <span>{docType(r.serie)}</span>
            <span>{r.datum}</span>
            <span className="tabular-nums">{fmt(total)}</span>
            {docSet.has(vid) && <span className="flex items-center gap-1 text-gray-600"><i className="ti ti-paperclip" /> Bilaga</span>}
          </div>
          {related.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Relaterade verifikationer</div>
              {related.map(rv => (
                <div key={rv.ver_id} className="flex gap-3 text-[13px] py-0.5">
                  <span className="text-gray-700 font-medium w-12 shrink-0">{rv.ver_nr}</span>
                  <span className="text-gray-600 flex-1 truncate">{rv.besk}</span>
                  <span className="text-gray-500 w-28 shrink-0">{docType(rv.serie)}</span>
                  <span className="text-gray-500 w-24 shrink-0">{rv.datum}</span>
                  <span className="tabular-nums text-gray-700 w-24 text-right shrink-0">{fmt(rv.total)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-1">
            {interactiveLinks && <button className="btn text-xs py-1 px-3" onClick={() => navigate(`/bokforing/${vid}`)}><i className="ti ti-pencil" /> Redigera</button>}
            <button className="btn text-xs py-1 px-3" onClick={() => window.print()}><i className="ti ti-file-type-pdf" /> Skapa pdf</button>
          </div>
        </div>
      </td>
    )
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {popout ? (
          <span className="text-base flex items-baseline gap-2">
            <span className="font-bold tracking-tight">{BRAND.appName}</span>
            <span className="text-gray-300">·</span>
            <span className="font-medium">Kontoanalys</span>
          </span>
        ) : (
          <span className="text-base font-medium">Kontoanalys</span>
        )}
        <div className="flex items-center gap-2.5">
          {!popout && (
            <button data-testid="kontoanalys-popout-open" className="btn" onClick={openPopout}
              title="Öppna Kontoanalys i ett eget fönster för parallellt arbete">
              <i className="ti ti-external-link" /> Öppna i eget fönster
            </button>
          )}
          <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut</button>
          {popout && (
            <button data-testid="kontoanalys-popout-close" className="btn" onClick={stangPopout}>
              <i className="ti ti-x" /> Stäng
            </button>
          )}
        </div>
      </div>

      <div className="px-7 pt-4 flex gap-3 no-print">
        {[['huvudbok', 'Huvudbok'], ['balans', 'Balansräkning'], ['resultat', 'Resultaträkning']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${tab === k ? 'text-purple-900' : 'text-gray-600 hover:bg-gray-50'}`}
            style={{ background: tab === k ? 'rgba(109,40,217,0.14)' : '#fff', border: '0.5px solid rgba(0,0,0,0.10)' }}>{l}</button>
        ))}
      </div>

      <div className="px-7 py-4 grid grid-cols-[1.3fr_1.4fr] gap-6 items-start no-print">
        <div className="space-y-2">
          <div className="relative"><input className="input pl-8" placeholder="Sök konto t.ex. 1510, 3050-3053" value={kontoSok} onChange={e => { setKontoSok(e.target.value); setPage(0) }} /><i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" /></div>
          <div className="relative"><input className="input pl-8" placeholder="Sök" value={textSok} onChange={e => { setTextSok(e.target.value); setPage(0) }} /><i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" /></div>
          <label className="flex items-center gap-2.5 text-sm text-gray-600"><input type="checkbox" checked={doljKorr} onChange={e => setDoljKorr(e.target.checked)} /> Dölj korrigeringar</label>
        </div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2">
          <label className="text-sm text-gray-600">Visa period</label>
          <select className="input" value={`${from}|${tom}`} onChange={e => { const [f, t] = e.target.value.split('|'); setFrom(f); setTom(t); setPage(0) }}>
            <option value={`${from}|${tom}`}>Vald period</option>
            {fy.map(y => <option key={y.id} value={`${y.start_date}|${y.end_date}`}>{y.year} ({y.start_date} – {y.end_date})</option>)}
          </select>
          <label className="text-sm text-gray-600">Bokföringsdatum</label>
          <div className="flex items-center gap-2"><input className="input" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0) }} /><span className="text-gray-400">–</span><input className="input" type="date" value={tom} onChange={e => { setTom(e.target.value); setPage(0) }} /></div>
          <label className="text-sm text-gray-600">Dokumenttyp</label>
          <select className="input" value={doktyp} onChange={e => { setDoktyp(e.target.value); setPage(0) }}>{doktyper.map(d => <option key={d} value={d}>{d}</option>)}</select>
        </div>
      </div>

      <div className="px-7 pb-10" id="printable">
        {loading ? <div className="text-gray-400 py-12 text-center">Laddar…</div> : tab === 'huvudbok' ? (
          <>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 border-b w-16" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Ver.nr</th>
                    <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokföringsdatum</th>
                    <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
                    <th className="text-left px-4 py-2.5 border-b w-56" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Dokumenttyp</th>
                    <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                    <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kontosaldo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan="6" className="text-center py-12 text-gray-400">Inga konton/poster i perioden.</td></tr>
                  ) : pageItems.map((it, i) => {
                    if (it.type === 'head') return <tr key={i} className="bg-gray-50"><td colSpan="5" className="px-4 py-2 font-semibold border-y" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{it.g.nr} – {it.g.namn}</td><td className="px-4 py-2 text-right text-gray-500 border-y" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Ingående saldo:</td></tr>
                    if (it.type === 'ib') return <tr key={i}><td colSpan="5" /><td className="px-4 py-1.5 text-right tabular-nums text-gray-600 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(it.g.ib)}</td></tr>
                    if (it.type === 'ub') return <tr key={i} className="font-medium"><td colSpan="5" className="px-4 py-1.5 text-right text-gray-500 border-b" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>Utgående saldo:</td><td className="px-4 py-1.5 text-right tabular-nums border-b" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>{fmt(it.g.ub)}</td></tr>
                    const r = it.r
                    const rowKey = `${r.account_nr}:${r.ver_id}`
                    const open = expandedKey === rowKey
                    return (
                      <Fragment key={i}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                          {/* Ver.nr expanderar/collapsar inline – ALDRIG navigation (varken normal eller popout). */}
                          <button className="text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer" aria-expanded={open}
                            onClick={() => setExpandedKey(k => (k === rowKey ? null : rowKey))}>
                            <i className={`ti ti-chevron-${open ? 'down' : 'right'} text-xs`} />{r.ver_nr}
                          </button>
                        </td>
                        <td className="px-4 py-2 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.datum}</td>
                        <td className="px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{renderBesk(r)}</td>
                        <td className="px-4 py-2 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{docType(r.serie)}</td>
                        <td className="px-4 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)', color: r.belopp < 0 ? '#b91c1c' : '#1a1a1a' }}>{fmt(r.belopp)}</td>
                        <td className="px-4 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(r.saldo)}</td>
                      </tr>
                      {open && <tr className="bg-white"><VerDetail r={r} /></tr>}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 mt-3 text-sm text-gray-500 no-print">
                <button className="btn text-xs py-1 px-2" disabled={cur === 0} onClick={() => setPage(0)}><i className="ti ti-chevrons-left" /></button>
                <button className="btn text-xs py-1 px-2" disabled={cur === 0} onClick={() => setPage(cur - 1)}><i className="ti ti-chevron-left" /></button>
                <span>{cur + 1} av {pageCount}</span>
                <button className="btn text-xs py-1 px-2" disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)}><i className="ti ti-chevron-right" /></button>
                <button className="btn text-xs py-1 px-2" disabled={cur >= pageCount - 1} onClick={() => setPage(pageCount - 1)}><i className="ti ti-chevrons-right" /></button>
              </div>
            )}
          </>
        ) : tab === 'balans' ? (
          <Rapport titel="Balansräkning" sektioner={[
            { rubrik: 'Tillgångar', rader: rapportRader(nr => /^1/.test(nr), 1) },
            { rubrik: 'Eget kapital och skulder', rader: rapportRader(nr => /^2/.test(nr), -1) },
          ]} />
        ) : (
          <Rapport titel={`Resultaträkning ${from} – ${tom}`} sektioner={[
            { rubrik: 'Intäkter', rader: rapportRader(nr => /^3/.test(nr), -1) },
            { rubrik: 'Kostnader', rader: rapportRader(nr => /^[4-7]/.test(nr), 1) },
            { rubrik: 'Finansiella poster', rader: rapportRader(nr => /^8/.test(nr), 1) },
          ]} resultat />
        )}
      </div>
    </div>
  )
}

function Rapport({ titel, sektioner, resultat }) {
  const sum = s => s.rader.reduce((a, r) => a + r.v, 0)
  const total = sektioner.reduce((a, s, i) => a + (resultat ? (i === 0 ? sum(s) : -sum(s)) : sum(s)), 0)
  return (
    <div className="bg-white rounded-xl p-6 max-w-3xl" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="text-base font-semibold mb-4">{titel}</div>
      {sektioner.map((s, i) => (
        <div key={i} className="mb-5">
          <div className="text-sm font-semibold text-gray-700 mb-1.5 pb-1 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{s.rubrik}</div>
          {s.rader.length === 0 ? <div className="text-sm text-gray-400 py-1">–</div> : s.rader.map(r => (
            <div key={r.nr} className="flex justify-between py-1 text-sm">
              <span className="text-gray-600">{r.nr} {r.namn}</span>
              <span className="tabular-nums">{fmt(r.v)}</span>
            </div>
          ))}
          <div className="flex justify-between py-1.5 mt-1 text-sm font-semibold border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            <span>Summa {s.rubrik.toLowerCase()}</span><span className="tabular-nums">{fmt(sum(s))}</span>
          </div>
        </div>
      ))}
      <div className="flex justify-between py-2 text-base font-bold border-t-2" style={{ borderColor: 'rgba(0,0,0,0.15)' }}>
        <span>{resultat ? 'Beräknat resultat' : 'Balansomslutning / Differens'}</span>
        <span className="tabular-nums" style={{ color: total >= 0 ? '#1a7a2e' : '#b91c1c' }}>{fmt(total)}</span>
      </div>
    </div>
  )
}
