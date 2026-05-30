import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const MONTHS = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December']
const fmt = n => Math.round(Number(n || 0)).toLocaleString('sv-SE')
const lastDay = (y, mi) => new Date(y, mi + 1, 0).getDate()
const ym = (y, mi) => `${y}-${String(mi + 1).padStart(2, '0')}`

export default function Ekonomichef() {
  const { company } = useAuth()
  const [accs, setAccs] = useState([])
  const [rows, setRows] = useState([])
  const [sup, setSup] = useState([])
  const [cust, setCust] = useState([])
  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [rapport, setRapport] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    setLoading(true)
    const [{ data: a }, { data: r }, { data: s }, { data: c }] = await Promise.all([
      supabase.from('accounts').select('account_nr, name, opening_balance').eq('company_id', company.id),
      supabase.from('verifikation_rows').select('account_nr, debet, kredit, verifikationer!inner(company_id, datum)').eq('verifikationer.company_id', company.id),
      supabase.from('supplier_invoices').select('total_amount, paid_amount, status, makulerad').eq('company_id', company.id).eq('status', 'unpaid'),
      supabase.from('invoices').select('total_amount, status').eq('company_id', company.id).eq('status', 'sent'),
    ])
    setAccs(a || []); setRows((r || []).map(x => ({ nr: x.account_nr, datum: x.verifikationer.datum, b: (x.debet || 0) - (x.kredit || 0) })))
    setSup(s || []); setCust(c || [])
    setLoading(false)
  }

  const periods = useMemo(() => {
    const set = new Set(rows.map(r => r.datum.slice(0, 7)))
    const now = new Date(); set.add(ym(now.getFullYear(), now.getMonth()))
    return [...set].sort().reverse()
  }, [rows])
  useEffect(() => { if (!period && periods.length) setPeriod(periods[0]) }, [periods])

  const accName = nr => accs.find(a => a.account_nr === nr)?.name || nr
  const OB = nr => accs.find(a => a.account_nr === nr)?.opening_balance || 0

  function range(p) {
    const [y, m] = p.split('-').map(Number)
    return { from: `${p}-01`, tom: `${p}-${String(lastDay(y, m - 1)).padStart(2, '0')}`, y, mi: m - 1 }
  }
  function prevPeriod(p) { const [y, m] = p.split('-').map(Number); const d = new Date(y, m - 2, 1); return ym(d.getFullYear(), d.getMonth()) }

  function kpis(p) {
    if (!p) return null
    const { from, tom } = range(p)
    const sum = re => rows.filter(r => re.test(r.nr) && r.datum >= from && r.datum <= tom).reduce((t, r) => t + r.b, 0)
    const intakter = -sum(/^3/), kostnader = sum(/^[4-7]/), finans = sum(/^8/)
    const resultat = intakter - kostnader - finans
    const marginal = intakter > 0 ? resultat / intakter * 100 : 0
    const likvida = accs.filter(a => /^19/.test(a.account_nr)).reduce((s, a) => s + OB(a.account_nr) + rows.filter(r => r.nr === a.account_nr && r.datum <= tom).reduce((t, r) => t + r.b, 0), 0)
    const kByKonto = {}
    rows.filter(r => /^[4-7]/.test(r.nr) && r.datum >= from && r.datum <= tom).forEach(r => { kByKonto[r.nr] = (kByKonto[r.nr] || 0) + r.b })
    const toppKostnader = Object.entries(kByKonto).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nr, v]) => ({ konto: `${nr} ${accName(nr)}`, belopp: Math.round(v) }))
    return { intakter, kostnader, finans, resultat, marginal, likvida, toppKostnader }
  }

  const cur = useMemo(() => kpis(period), [period, rows, accs])
  const prev = useMemo(() => kpis(prevPeriod(period)), [period, rows, accs])
  const periodLabel = period ? `${MONTHS[range(period).mi]} ${range(period).y}` : ''
  const obetaltLev = sup.filter(s => !s.makulerad).reduce((t, s) => t + ((s.total_amount || 0) - (s.paid_amount || 0)), 0)
  const obetaltKund = cust.reduce((t, c) => t + (c.total_amount || 0), 0)

  const delta = (c, p) => (p == null || !cur) ? null : c - p
  const Kpi = ({ label, value, d, suffix = ' kr', invert }) => {
    const up = d != null && d > 0
    const good = invert ? !up : up
    return (
      <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <div className="text-[20px] font-semibold tabular-nums">{fmt(value)}{suffix}</div>
        {d != null && Math.abs(d) > 0.5 && <div className="text-[11px] mt-0.5" style={{ color: good ? '#1a7a2e' : '#b91c1c' }}>{up ? '▲' : '▼'} {fmt(Math.abs(d))} mot föreg. period</div>}
      </div>
    )
  }

  async function generera() {
    if (!cur) return
    setBusy(true); setRapport('')
    try {
      const payload = {
        foretag: company.name, periodLabel,
        aktuell: { intakter: Math.round(cur.intakter), kostnader: Math.round(cur.kostnader), finansiella: Math.round(cur.finans), resultat: Math.round(cur.resultat), marginal_procent: Math.round(cur.marginal), likvida_medel: Math.round(cur.likvida), topp_kostnader: cur.toppKostnader },
        foregaende: prev ? { intakter: Math.round(prev.intakter), kostnader: Math.round(prev.kostnader), resultat: Math.round(prev.resultat), marginal_procent: Math.round(prev.marginal) } : null,
        obetalda_leverantorsfakturor_kr: Math.round(obetaltLev), obetalda_kundfakturor_kr: Math.round(obetaltKund),
      }
      const { data, error } = await supabase.functions.invoke('ekonomichef-ai', { body: payload })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      setRapport(data.rapport || '')
    } catch (e) { toast.error('Kunde inte generera: ' + (e.message || e)) }
    setBusy(false)
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-chart-arcs text-purple-600" /> AI-ekonomichef</span>
        <div className="flex items-center gap-2.5">
          <select className="input w-44" value={period} onChange={e => { setPeriod(e.target.value); setRapport('') }}>
            {periods.map(p => { const { y, mi } = range(p); return <option key={p} value={p}>{MONTHS[mi]} {y}</option> })}
          </select>
          <button className="btn btn-primary" onClick={generera} disabled={busy || loading}>{busy ? 'Skriver…' : 'Generera rapport'}</button>
          {rapport && <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /></button>}
        </div>
      </div>

      <div className="p-7 max-w-4xl" id="printable">
        <div className="mb-1 text-lg font-semibold">Månadsrapport – {periodLabel}</div>
        <div className="text-xs text-gray-500 mb-5">{company?.name}</div>

        {loading ? <div className="text-gray-400 py-12 text-center">Laddar…</div> : !cur ? <div className="text-gray-400 py-12 text-center">Ingen data.</div> : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Kpi label="Intäkter" value={cur.intakter} d={delta(cur.intakter, prev?.intakter)} />
              <Kpi label="Kostnader" value={cur.kostnader} d={delta(cur.kostnader, prev?.kostnader)} invert />
              <Kpi label="Resultat" value={cur.resultat} d={delta(cur.resultat, prev?.resultat)} />
              <Kpi label="Rörelsemarginal" value={cur.marginal} suffix=" %" d={delta(cur.marginal, prev?.marginal)} />
              <Kpi label="Likvida medel" value={cur.likvida} />
              <Kpi label="Obetalda lev.fakturor" value={obetaltLev} invert />
            </div>

            {cur.toppKostnader.length > 0 && (
              <div className="bg-white rounded-xl p-4 mb-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="text-sm font-semibold mb-2">Största kostnader denna period</div>
                {cur.toppKostnader.map(k => (
                  <div key={k.konto} className="flex justify-between text-sm py-0.5"><span className="text-gray-600">{k.konto}</span><span className="tabular-nums">{fmt(k.belopp)} kr</span></div>
                ))}
              </div>
            )}

            <div className="bg-white rounded-xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="flex items-center gap-2 mb-3"><i className="ti ti-sparkles text-purple-600" /><span className="text-sm font-semibold">Ekonomichefens kommentar</span></div>
              {rapport ? <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{rapport}</div>
                : <div className="text-sm text-gray-400">Klicka <b>Generera rapport</b> så skriver AI en sammanfattning av månaden med kommentarer och rekommendationer.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
