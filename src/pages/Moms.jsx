import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Moms() {
  const { company } = useAuth()
  const [rows, setRows] = useState([])
  const [years, setYears] = useState([])
  const [period, setPeriod] = useState('all')
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

  // Saldon per konto.
  const byAccount = {}
  rows.filter(inPeriod).forEach(r => {
    const k = r.account_nr
    if (!byAccount[k]) byAccount[k] = { nr: k, name: r.account_name || k, debet: 0, kredit: 0 }
    byAccount[k].debet += r.debet || 0
    byAccount[k].kredit += r.kredit || 0
  })
  const accounts = Object.values(byAccount)

  // Summera konton vars nummer börjar med ett av prefixen. dir 'k' = kredit-debet (utgående), 'd' = debet-kredit (ingående).
  const sumBy = (prefixes, dir) => accounts
    .filter(a => prefixes.some(p => a.nr.startsWith(p)))
    .reduce((s, a) => s + (dir === 'k' ? a.kredit - a.debet : a.debet - a.kredit), 0)

  const utg25 = sumBy(['261'], 'k')
  const utg12 = sumBy(['262'], 'k')
  const utg6 = sumBy(['263'], 'k')
  const utgSum = utg25 + utg12 + utg6
  const ingaende = sumBy(['264'], 'd')
  const attBetala = utgSum - ingaende
  const forsaljning = accounts.filter(a => a.nr.startsWith('3')).reduce((s, a) => s + (a.kredit - a.debet), 0)

  const Box = ({ ruta, label, value, strong }) => (
    <div className={`flex items-center justify-between px-4 py-2.5 border-b ${strong ? 'bg-gray-50 font-semibold' : ''}`} style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
      <span className="flex items-center gap-3 text-sm">
        {ruta && <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-blue-50 text-blue-700 text-xs font-semibold">{ruta}</span>}
        <span className={strong ? '' : 'text-gray-700'}>{label}</span>
      </span>
      <span className="tabular-nums text-sm">{fmt(value)}</span>
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Moms</span>
        <div className="flex items-center gap-3">
          <select className="input w-auto" value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="all">Alla perioder</option>
            {years.map(y => <option key={y.id} value={y.id}>{y.year} ({y.start_date} – {y.end_date})</option>)}
          </select>
          <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut</button>
        </div>
      </div>

      <div id="printable" className="p-7 max-w-2xl">
        <div className="mb-4">
          <div className="text-lg font-semibold">Momsrapport</div>
          <div className="text-xs text-gray-500">{company?.name} · {selYear ? `Räkenskapsår ${selYear.year}` : 'Alla perioder'}</div>
        </div>

        {loading ? (
          <div className="text-gray-400 py-12 text-center">Laddar…</div>
        ) : (
          <>
            <div className="bg-white rounded-xl overflow-hidden mb-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Utgående moms (försäljning)</div>
              <Box ruta="10" label="Utgående moms 25 %" value={utg25} />
              <Box ruta="11" label="Utgående moms 12 %" value={utg12} />
              <Box ruta="12" label="Utgående moms 6 %" value={utg6} />
              <Box label="Summa utgående moms" value={utgSum} strong />
            </div>

            <div className="bg-white rounded-xl overflow-hidden mb-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Ingående moms (inköp)</div>
              <Box ruta="48" label="Ingående moms att dra av" value={ingaende} />
            </div>

            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <Box ruta="49" label={attBetala >= 0 ? 'Moms att betala' : 'Moms att återfå'} value={Math.abs(attBetala)} strong />
            </div>

            <div className="mt-5 text-xs text-gray-500">
              Informativt: momspliktig försäljning (konto 3) i perioden: <span className="tabular-nums font-medium text-gray-700">{fmt(forsaljning)} kr</span>.
              Rutorna beräknas från BAS-konton: utgående 2611/2621/2631-serien, ingående 264x. Kontrollera mot din kontering.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
