import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { bokforKundfaktura } from '../lib/bokforing'
import toast from 'react-hot-toast'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function VisaFaktura() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { company, user } = useAuth()
  const [inv, setInv] = useState(null)
  const [rows, setRows] = useState([])
  const [customer, setCustomer] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    const { data: i } = await supabase.from('invoices').select('*, customers(*)').eq('id', id).single()
    const { data: r } = await supabase.from('invoice_rows').select('*').eq('invoice_id', id).order('sort_order')
    setInv(i); setCustomer(i?.customers || null); setRows(r || [])
    setLoading(false)
  }

  async function setStatus(status) {
    const { error } = await supabase.from('invoices').update({ status }).eq('id', id)
    if (error) return toast.error('Kunde inte uppdatera: ' + error.message)
    // Faktureringsmetoden: bokför kundfordran när fakturan skickas.
    if (status === 'sent') {
      try { await bokforKundfaktura({ companyId: company.id, metod: company.bokforingsmetod, userId: user.id, invoiceId: id }) }
      catch (e) { toast.error('Kunde inte bokföra: ' + e.message) }
    }
    toast.success('Faktura uppdaterad')
    load()
  }

  async function remove() {
    if (!confirm(`Ta bort faktura ${inv.invoice_nr}?`)) return
    const { error } = await supabase.from('invoices').delete().eq('id', id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Faktura borttagen')
    navigate('/fakturor')
  }

  if (loading) return <div className="p-12 text-center text-gray-400">Laddar…</div>
  if (!inv) return <div className="p-12 text-center text-gray-400">Fakturan hittades inte</div>

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between no-print" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">FAKTURA {inv.invoice_nr}</span>
        <div className="flex items-center gap-2.5">
          {inv.status === 'draft' && <button className="btn btn-green" onClick={() => setStatus('sent')}>Markera skickad</button>}
          {['sent', 'overdue'].includes(inv.status) && <button className="btn btn-green" onClick={() => setStatus('paid')}>Markera betald</button>}
          {inv.verifikation_id && <button className="btn" onClick={() => navigate(`/bokforing/${inv.verifikation_id}`)}><i className="ti ti-book" /> Verifikation</button>}
          <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut</button>
          <button className="btn btn-danger" onClick={remove}><i className="ti ti-trash" /> Ta bort</button>
          <button className="btn btn-primary" onClick={() => navigate('/fakturor')}><i className="ti ti-list" /> Lista</button>
        </div>
      </div>

      <div id="printable" className="p-10 max-w-3xl">
        <div className="flex justify-between mb-10">
          <div>
            <div className="text-2xl font-bold tracking-tight">{company?.name}</div>
            {company?.org_nr && <div className="text-sm text-gray-500">Org.nr {company.org_nr}</div>}
            {company?.address && <div className="text-sm text-gray-500">{company.address}</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-tight">FAKTURA</div>
            <div className="text-sm text-gray-600 mt-1">Nr {inv.invoice_nr}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8">
          <div>
            <div className="text-[11px] text-gray-500 font-medium uppercase mb-1">Faktureras till</div>
            <div className="text-sm font-medium">{customer?.name}</div>
            {customer?.org_nr && <div className="text-sm text-gray-500">Org.nr {customer.org_nr}</div>}
            {customer?.address && <div className="text-sm text-gray-500">{customer.address}</div>}
          </div>
          <div className="text-sm">
            <div className="flex justify-between py-0.5"><span className="text-gray-500">Fakturadatum</span><span>{inv.invoice_date}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-gray-500">Förfallodatum</span><span>{inv.due_date}</span></div>
            {company?.bankgiro && <div className="flex justify-between py-0.5"><span className="text-gray-500">Bankgiro</span><span>{company.bankgiro}</span></div>}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden mb-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
                <th className="text-right px-4 py-2.5 border-b w-16" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Antal</th>
                <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>À-pris</th>
                <th className="text-right px-4 py-2.5 border-b w-16" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Moms</th>
                <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.description}</td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.quantity}</td>
                  <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(r.unit_price)}</td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.vat_rate}%</td>
                  <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-64 text-sm">
            <div className="flex justify-between py-1"><span className="text-gray-500">Summa exkl. moms</span><span className="tabular-nums">{fmt(inv.amount_excl_vat)}</span></div>
            <div className="flex justify-between py-1"><span className="text-gray-500">Moms</span><span className="tabular-nums">{fmt(inv.vat_amount)}</span></div>
            <div className="flex justify-between py-2 mt-1 border-t font-bold text-base" style={{ borderColor: 'rgba(0,0,0,0.2)' }}><span>Att betala</span><span className="tabular-nums">{fmt(inv.total_amount)} kr</span></div>
          </div>
        </div>

        {inv.message && <div className="mt-8 text-sm text-gray-600 border-t pt-4" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{inv.message}</div>}
      </div>
    </div>
  )
}
