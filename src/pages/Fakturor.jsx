import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import HelpButton from '../components/HelpButton'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS = {
  draft: { label: 'Utkast', bg: '#f3f4f6', color: '#6b7280' },
  sent: { label: 'Skickad', bg: 'rgba(79,156,249,0.15)', color: '#1d4ed8' },
  paid: { label: 'Betald', bg: 'rgba(52,211,153,0.15)', color: '#1a7a2e' },
  overdue: { label: 'Förfallen', bg: 'rgba(248,113,113,0.15)', color: '#b91c1c' },
}

export default function Fakturor() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('invoices')
      .select('*, customers(name)').eq('company_id', company.id).order('invoice_nr', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const effStatus = inv => (inv.status === 'sent' && inv.due_date < today) ? 'overdue' : inv.status
  const visible = invoices.filter(i => filter === 'all' || effStatus(i) === filter)

  const obetalt = invoices.filter(i => ['sent', 'overdue'].includes(effStatus(i))).reduce((s, i) => s + (i.total_amount || 0), 0)

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="flex items-center gap-1.5"><span className="text-base font-medium">Fakturor</span><HelpButton slug="skapa-kundfaktura" /></div>
        <Link to="/fakturor/ny" className="btn btn-primary"><i className="ti ti-plus" /> Ny faktura</Link>
      </div>

      <div className="bg-white border-b flex gap-0 px-7" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {[['all', 'Alla'], ['draft', 'Utkast'], ['sent', 'Skickade'], ['overdue', 'Förfallna'], ['paid', 'Betalda']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px transition-colors ${
              filter === k ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}>{label}</button>
        ))}
      </div>

      <div className="p-7">
        {obetalt > 0 && (
          <div className="mb-4 text-sm text-gray-500">Utestående: <span className="font-semibold text-gray-800 tabular-nums">{fmt(obetalt)} kr</span></div>
        )}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Nr</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kund</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Fakturadatum</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Förfaller</th>
                <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">
                  <i className="ti ti-file-invoice text-3xl block mb-2 opacity-30" />
                  {invoices.length ? 'Inga fakturor i denna vy.' : 'Inga fakturor än – skapa din första.'}
                </td></tr>
              ) : visible.map(inv => {
                const st = STATUS[effStatus(inv)] || STATUS.draft
                return (
                  <tr key={inv.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/fakturor/${inv.id}`)}>
                    <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{inv.invoice_nr}</td>
                    <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{inv.customers?.name || '–'}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{inv.invoice_date}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{inv.due_date}</td>
                    <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{fmt(inv.total_amount)}</td>
                    <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
