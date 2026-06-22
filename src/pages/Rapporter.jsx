import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import HelpButton from '../components/HelpButton'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Rapporter() {
  const { company } = useAuth()
  const [rows, setRows] = useState([])
  const [years, setYears] = useState([])
  const [period, setPeriod] = useState('all') // 'all' eller fiscal_year id
  const [tab, setTab] = useState('resultat')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: r }, { data: fy }] = await Promise.all([
      supabase.from('verifikation_rows')
        .select('account_nr, account_name, debet, kredit, verifikationer!inner(company_id, datum)')
        .eq('verifikationer.company_id', company.id),
      supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false }),
    ])
    setRows(r || [])
    setYears(fy || [])
    const active = (fy || []).find(y => y.status === 'active')
    if (active) setPeriod(active.id)
    setLoading(false)
  }

  const selYear = years.find(y => y.id === period)
  const inPeriod = r => {
    if (!selYear) return true
    const d = r.verifikationer?.datum
    return d >= selYear.start_date && d <= selYear.end_date
  }

  // Aggregera saldon per konto.
  const byAccount = {}
  rows.filter(inPeriod).forEach(r => {
    const k = r.account_nr
    if (!byAccount[k]) byAccount[k] = { nr: k, name: r.account_name || k, debet: 0, kredit: 0 }
    byAccount[k].debet += r.debet || 0
    byAccount[k].kredit += r.kredit || 0
  })
  const accounts = Object.values(byAccount).sort((a, b) => a.nr.localeCompare(b.nr))

  const cls = a => a.nr[0]
  const intakter = accounts.filter(a => cls(a) === '3').map(a => ({ ...a, belopp: a.kredit - a.debet }))
  const kostnader = accounts.filter(a => ['4', '5', '6', '7'].includes(cls(a))).map(a => ({ ...a, belopp: a.debet - a.kredit }))
  const finansiellt = accounts.filter(a => cls(a) === '8').map(a => ({ ...a, belopp: a.kredit - a.debet }))
  const tillgangar = accounts.filter(a => cls(a) === '1').map(a => ({ ...a, belopp: a.debet - a.kredit }))
  const ekSkulder = accounts.filter(a => cls(a) === '2').map(a => ({ ...a, belopp: a.kredit - a.debet }))

  const sum = arr => arr.reduce((s, a) => s + a.belopp, 0)
  const sumIntakter = sum(intakter), sumKostnader = sum(kostnader), sumFinans = sum(finansiellt)
  const resultat = sumIntakter - sumKostnader + sumFinans
  const sumTillg = sum(tillgangar), sumEkSkuld = sum(ekSkulder)

  const Section = ({ title, items, total, totalLabel }) => (
    <div className="mb-5">
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-gray-400 px-1 py-1">Inga poster</div>
      ) : items.map(a => (
        <div key={a.nr} className="flex justify-between text-sm px-1 py-1 border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
          <span className="text-gray-700">{a.nr} {a.name}</span>
          <span className="tabular-nums">{fmt(a.belopp)}</span>
        </div>
      ))}
      <div className="flex justify-between text-sm font-semibold px-1 py-1.5 mt-0.5 border-t" style={{ borderColor: 'rgba(0,0,0,0.15)' }}>
        <span>{totalLabel || `Summa ${title.toLowerCase()}`}</span>
        <span className="tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="flex items-center gap-1.5"><span className="text-base font-medium">Rapporter</span><HelpButton slug="rapport-resultat" /></div>
        <div className="flex items-center gap-3">
          <select className="input w-auto" value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="all">Alla perioder</option>
            {years.map(y => <option key={y.id} value={y.id}>{y.year} ({y.start_date} – {y.end_date})</option>)}
          </select>
          <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut</button>
        </div>
      </div>

      <div className="bg-white border-b flex gap-0 px-7 no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {[['resultat', 'Resultaträkning'], ['balans', 'Balansräkning']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px transition-colors ${
              tab === k ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}>{label}</button>
        ))}
      </div>

      <div id="printable" className="p-7 max-w-2xl">
        <div className="mb-4">
          <div className="text-lg font-semibold">{tab === 'resultat' ? 'Resultaträkning' : 'Balansräkning'}</div>
          <div className="text-xs text-gray-500">{company?.name} · {selYear ? `Räkenskapsår ${selYear.year}` : 'Alla perioder'}</div>
        </div>

        {loading ? (
          <div className="text-gray-400 py-12 text-center">Laddar…</div>
        ) : tab === 'resultat' ? (
          <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <Section title="Intäkter" items={intakter} total={sumIntakter} />
            <Section title="Kostnader" items={kostnader} total={sumKostnader} />
            {finansiellt.length > 0 && <Section title="Finansiella poster" items={finansiellt} total={sumFinans} totalLabel="Summa finansiella poster" />}
            <div className="flex justify-between text-base font-bold px-1 py-2 mt-2 border-t-2" style={{ borderColor: 'rgba(0,0,0,0.3)', color: resultat >= 0 ? '#1a7a2e' : '#A32D2D' }}>
              <span>Årets resultat</span>
              <span className="tabular-nums">{fmt(resultat)}</span>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <Section title="Tillgångar" items={tillgangar} total={sumTillg} />
            <Section title="Eget kapital och skulder" items={ekSkulder} total={sumEkSkuld} />
            <div className="flex justify-between text-sm px-1 py-1 text-gray-600">
              <span>Beräknat årets resultat</span>
              <span className="tabular-nums">{fmt(resultat)}</span>
            </div>
            <div className="flex justify-between text-base font-bold px-1 py-2 mt-1 border-t-2" style={{ borderColor: 'rgba(0,0,0,0.3)' }}>
              <span>Summa eget kapital och skulder</span>
              <span className="tabular-nums">{fmt(sumEkSkuld + resultat)}</span>
            </div>
            {Math.abs(sumTillg - (sumEkSkuld + resultat)) > 0.01 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mt-3">
                ⚠️ Balansräkningen balanserar inte (differens {fmt(sumTillg - (sumEkSkuld + resultat))}). Kontrollera bokföringen.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
