import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const fmt = n => Number(n).toLocaleString('sv-SE', { maximumFractionDigits: 0 }) + ' kr'

function Metric({ label, value, color, sub }) {
  return (
    <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="text-xs text-gray-500 mb-1.5">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums" style={{ color, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div className="text-[11px] mt-1 text-gray-400">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    const [{ data: rows }, { data: fy }, { data: invoices }, { data: recent }] = await Promise.all([
      supabase.from('verifikation_rows').select('account_nr, debet, kredit, verifikationer!inner(company_id, datum)').eq('verifikationer.company_id', company.id),
      supabase.from('fiscal_years').select('*').eq('company_id', company.id).eq('status', 'active').maybeSingle(),
      supabase.from('invoices').select('total_amount, status, due_date').eq('company_id', company.id),
      supabase.from('verifikationer').select('id, ver_nr, datum, beskrivning, total_debet').eq('company_id', company.id).order('datum', { ascending: false }).order('ver_nr', { ascending: false }).limit(6),
    ])

    const inPeriod = r => !fy || (r.verifikationer?.datum >= fy.start_date && r.verifikationer?.datum <= fy.end_date)
    const acc = {}
    ;(rows || []).filter(inPeriod).forEach(r => {
      if (!acc[r.account_nr]) acc[r.account_nr] = 0
      acc[r.account_nr] += (r.debet || 0) - (r.kredit || 0)  // debetsaldo
    })
    const sumByFirst = (digits, sign) => Object.entries(acc)
      .filter(([nr]) => digits.includes(nr[0]))
      .reduce((s, [, bal]) => s + sign * bal, 0)
    const sumByPrefix = (prefix, sign) => Object.entries(acc)
      .filter(([nr]) => nr.startsWith(prefix))
      .reduce((s, [, bal]) => s + sign * bal, 0)

    const intakter = sumByFirst(['3'], -1)       // intäkter = kreditsaldo
    const kostnader = sumByFirst(['4', '5', '6', '7'], 1)
    const finans = sumByFirst(['8'], -1)
    const resultat = intakter - kostnader + finans
    const utgMoms = sumByPrefix('261', -1) + sumByPrefix('262', -1) + sumByPrefix('263', -1)
    const ingMoms = sumByPrefix('264', 1)
    const moms = utgMoms - ingMoms

    const today = new Date().toISOString().slice(0, 10)
    const utestaende = (invoices || [])
      .filter(i => i.status === 'sent' || (i.status === 'sent' && i.due_date < today) || i.status === 'overdue')
      .reduce((s, i) => s + (i.total_amount || 0), 0)
    const forfallna = (invoices || []).filter(i => ['sent', 'overdue'].includes(i.status) && i.due_date < today)

    setData({
      intakter, kostnader, resultat, moms,
      verCount: (rows ? new Set(rows.filter(inPeriod).map(r => r.verifikationer?.datum + r.account_nr)).size : 0),
      utestaende, forfallnaCount: forfallna.length,
      period: fy ? `Räkenskapsår ${fy.year}` : 'Alla perioder',
      recent: recent || [],
    })
  }

  // Antal verifikationer (separat exakt räkning).
  const [verCount, setVerCount] = useState(0)
  useEffect(() => {
    if (!company) return
    supabase.from('verifikationer').select('*', { count: 'exact', head: true }).eq('company_id', company.id)
      .then(({ count }) => setVerCount(count || 0))
  }, [company?.id])

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Dashboard</span>
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-gray-400 bg-gray-50 border rounded-lg px-2.5 py-1.5 flex items-center gap-1.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
            <i className="ti ti-calendar text-sm" /> {data?.period || '—'}
          </span>
          <Link to="/bokforing/ny" className="btn btn-primary"><i className="ti ti-plus" /> Ny verifikation</Link>
        </div>
      </div>

      <div className="p-7">
        {!data ? (
          <div className="text-gray-400 py-12 text-center">Laddar…</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3.5 mb-4">
              <Metric label="Intäkter" value={fmt(data.intakter)} color="#185FA5" sub={data.period} />
              <Metric label="Kostnader" value={fmt(data.kostnader)} sub={data.period} />
              <Metric label="Resultat" value={fmt(data.resultat)} color={data.resultat >= 0 ? '#3B6D11' : '#A32D2D'} sub={data.period} />
              <Metric label={data.moms >= 0 ? 'Moms att betala' : 'Moms att återfå'} value={fmt(Math.abs(data.moms))} color="#854F0B" sub="Innevarande period" />
            </div>

            <div className="grid grid-cols-4 gap-3.5 mb-6">
              <Metric label="Utestående fakturor" value={fmt(data.utestaende)} color={data.utestaende > 0 ? '#185FA5' : undefined}
                sub={data.forfallnaCount ? `⚠️ ${data.forfallnaCount} förfallna` : 'Inga förfallna'} />
              <Metric label="Verifikationer" value={verCount + ' st'} sub="Totalt" />
            </div>

            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { to: '/bokforing/ny', icon: 'ti-file-invoice', box: 'bg-blue-50', ic: 'text-blue-700', t: 'Skapa verifikation', s: 'Ny bokföring' },
                { to: '/fakturor/ny', icon: 'ti-file-plus', box: 'bg-green-50', ic: 'text-green-700', t: 'Skapa faktura', s: 'Ny kundfordran' },
                { to: '/rapporter', icon: 'ti-chart-bar', box: 'bg-amber-50', ic: 'text-amber-700', t: 'Rapporter', s: 'Resultat & balans' },
                { to: '/moms', icon: 'ti-receipt-tax', box: 'bg-red-50', ic: 'text-red-700', t: 'Momsrapport', s: 'Deklarera moms' },
              ].map(a => (
                <Link key={a.to} to={a.to} className="bg-white rounded-xl p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className={`w-9 h-9 rounded-lg ${a.box} flex items-center justify-center`}><i className={`ti ${a.icon} ${a.ic}`} /></div>
                  <div><div className="text-[12.5px] font-medium">{a.t}</div><div className="text-[11px] text-gray-400">{a.s}</div></div>
                </Link>
              ))}
            </div>

            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="px-4 py-2.5 text-sm font-medium border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <span>Senaste verifikationer</span>
                <Link to="/bokforing" className="text-xs text-blue-700 hover:underline">Visa alla</Link>
              </div>
              {data.recent.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">Inga verifikationer än.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {data.recent.map(v => (
                      <tr key={v.id} className="hover:bg-gray-50 cursor-pointer border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.06)' }} onClick={() => navigate(`/bokforing/${v.id}`)}>
                        <td className="px-4 py-2.5 font-medium w-16">{v.ver_nr}</td>
                        <td className="px-4 py-2.5 text-gray-500 w-28">{v.datum}</td>
                        <td className="px-4 py-2.5">{v.beskrivning}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{Number(v.total_debet || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
