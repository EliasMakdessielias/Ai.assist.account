import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { bokforKundfaktura } from '../lib/bokforing'
import { serie } from '../lib/serier'
import { enforceAndToast } from '../lib/planLimits'
import toast from 'react-hot-toast'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const emptyRow = () => ({ description: '', quantity: '1', unit_price: '', vat_rate: 25 })
const addDays = (iso, days) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + (parseInt(days, 10) || 0))
  return d.toISOString().slice(0, 10)
}

export default function NyFaktura() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate] = useState(addDays(today, 30))
  const [message, setMessage] = useState('')
  const [rows, setRows] = useState([emptyRow()])
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    const { data } = await supabase.from('customers').select('id, name, payment_terms').eq('company_id', company.id).order('name')
    setCustomers(data || [])
  }

  function onCustomer(id) {
    setCustomerId(id)
    const c = customers.find(x => x.id === id)
    if (c) setDueDate(addDays(invoiceDate, c.payment_terms ?? 30))
  }

  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n }
  const rowTotal = r => num(r.quantity) * num(r.unit_price)
  const exVat = rows.reduce((s, r) => s + rowTotal(r), 0)
  const vat = rows.reduce((s, r) => s + rowTotal(r) * (num(r.vat_rate) / 100), 0)
  const total = exVat + vat

  function setRow(i, key, val) { setRows(p => p.map((r, j) => j === i ? { ...r, [key]: val } : r)) }
  function addRow() { setRows(p => [...p, emptyRow()]) }
  function removeRow(i) { setRows(p => p.length > 1 ? p.filter((_, j) => j !== i) : p) }

  async function save(status) {
    if (!customerId) return toast.error('Välj en kund')
    const valid = rows.filter(r => r.description.trim() && rowTotal(r) !== 0)
    if (!valid.length) return toast.error('Lägg till minst en fakturarad')
    setSaving(true)
    try {
      // Nästa fakturanummer (löpande per företag).
      const { data: last } = await supabase.from('invoices').select('invoice_nr').eq('company_id', company.id)
      const maxNr = (last || []).reduce((m, x) => Math.max(m, parseInt((x.invoice_nr || '').replace(/\D/g, ''), 10) || 0), 0)
      const invoiceNr = String(maxNr + 1)

      const { data: inv, error: e1 } = await supabase.from('invoices').insert({
        company_id: company.id, customer_id: customerId, invoice_nr: invoiceNr,
        invoice_date: invoiceDate, due_date: dueDate,
        amount_excl_vat: exVat, vat_amount: vat, total_amount: total,
        status, message: message || '',
      }).select().single()
      if (e1) throw e1

      const rowsToInsert = valid.map((r, i) => ({
        invoice_id: inv.id, description: r.description.trim(),
        quantity: num(r.quantity), unit_price: num(r.unit_price), vat_rate: num(r.vat_rate),
        total: rowTotal(r), sort_order: i,
      }))
      const { error: e2 } = await supabase.from('invoice_rows').insert(rowsToInsert)
      if (e2) throw e2

      // Faktureringsmetoden: bokför kundfordran automatiskt vid skickad faktura.
      if (status === 'sent') {
        try { await bokforKundfaktura({ companyId: company.id, metod: company.bokforingsmetod, userId: user.id, invoiceId: inv.id, serie: serie(company, 'kundfakturor') }) }
        catch (e) { toast.error('Fakturan skapad, men kunde inte bokföras: ' + e.message) }
      }

      toast.success(`Faktura ${invoiceNr} ${status === 'draft' ? 'sparad som utkast' : 'skapad'}`)
      enforceAndToast(supabase, company.id, 'invoices', toast)   // mjuk plangräns-varning
      navigate(`/fakturor/${inv.id}`)
    } catch (err) {
      toast.error('Kunde inte spara: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">NY FAKTURA</span>
        <div className="flex items-center gap-2.5">
          <button className="btn" onClick={() => save('draft')} disabled={saving}>Spara utkast</button>
          <button className="btn btn-green" onClick={() => save('sent')} disabled={saving}>{saving ? 'Sparar…' : 'Skapa faktura'}</button>
        </div>
      </div>

      <div className="p-7 max-w-4xl">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Kund *</label>
            <select className="input" value={customerId} onChange={e => onCustomer(e.target.value)}>
              <option value="">Välj kund…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {customers.length === 0 && <div className="text-xs text-amber-700 mt-1">Inga kunder än – lägg till under Kunder.</div>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fakturadatum</label>
            <input className="input" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Förfallodatum</label>
            <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
                <th className="text-right px-3 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Antal</th>
                <th className="text-right px-3 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>À-pris</th>
                <th className="text-right px-3 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Moms %</th>
                <th className="text-right px-3 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                <th className="border-b w-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  <td className="px-2"><input className="ver-cell" value={r.description} onChange={e => setRow(i, 'description', e.target.value)} placeholder="T.ex. Konsulttjänst" /></td>
                  <td className="px-2"><input className="ver-cell text-right" value={r.quantity} onChange={e => setRow(i, 'quantity', e.target.value)} /></td>
                  <td className="px-2"><input className="ver-cell text-right" value={r.unit_price} onChange={e => setRow(i, 'unit_price', e.target.value)} /></td>
                  <td className="px-2">
                    <select className="ver-cell text-right" value={r.vat_rate} onChange={e => setRow(i, 'vat_rate', e.target.value)}>
                      <option value="25">25</option><option value="12">12</option><option value="6">6</option><option value="0">0</option>
                    </select>
                  </td>
                  <td className="px-3 text-right tabular-nums text-gray-600">{fmt(rowTotal(r))}</td>
                  <td className="text-right pr-2"><button className="text-gray-300 hover:text-red-600" onClick={() => removeRow(i)}><i className="ti ti-trash text-xs" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn text-sm" onClick={addRow}><i className="ti ti-plus" /> Lägg till rad</button>

        <div className="flex justify-end mt-6">
          <div className="w-64 text-sm">
            <div className="flex justify-between py-1"><span className="text-gray-500">Summa exkl. moms</span><span className="tabular-nums">{fmt(exVat)}</span></div>
            <div className="flex justify-between py-1"><span className="text-gray-500">Moms</span><span className="tabular-nums">{fmt(vat)}</span></div>
            <div className="flex justify-between py-2 mt-1 border-t font-semibold text-base" style={{ borderColor: 'rgba(0,0,0,0.15)' }}><span>Att betala</span><span className="tabular-nums">{fmt(total)}</span></div>
          </div>
        </div>

        <div className="mt-6 max-w-lg">
          <label className="block text-xs font-medium text-gray-500 mb-1">Meddelande på fakturan</label>
          <textarea className="input" rows={2} value={message} onChange={e => setMessage(e.target.value)} placeholder="T.ex. Tack för ditt köp!" />
        </div>
      </div>
    </div>
  )
}
