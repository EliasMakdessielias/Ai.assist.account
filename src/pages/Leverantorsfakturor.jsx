import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n }

const STATUS = {
  unpaid: { label: 'Obetald', bg: 'rgba(79,156,249,0.15)', color: '#1d4ed8' },
  paid: { label: 'Betald', bg: 'rgba(52,211,153,0.15)', color: '#1a7a2e' },
  overdue: { label: 'Förfallen', bg: 'rgba(248,113,113,0.15)', color: '#b91c1c' },
}

const emptyForm = () => ({ supplier_id: '', invoice_nr: '', invoice_date: today(), due_date: addDays(today(), 30), excl: '', vat_rate: 25 })

export default function Leverantorsfakturor() {
  const { company } = useAuth()
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: sup }] = await Promise.all([
      supabase.from('supplier_invoices').select('*, suppliers(name)').eq('company_id', company.id).order('invoice_date', { ascending: false }),
      supabase.from('suppliers').select('id, name').eq('company_id', company.id).order('name'),
    ])
    setItems(inv || [])
    setSuppliers(sup || [])
    setLoading(false)
  }

  const eff = i => (i.status === 'unpaid' && i.due_date < today()) ? 'overdue' : i.status
  const visible = items.filter(i => filter === 'all' || eff(i) === filter)
  const obetalt = items.filter(i => ['unpaid', 'overdue'].includes(eff(i))).reduce((s, i) => s + (i.total_amount || 0), 0)

  const fvat = form ? num(form.excl) * (num(form.vat_rate) / 100) : 0
  const ftotal = form ? num(form.excl) + fvat : 0

  async function save() {
    if (!form.supplier_id) return toast.error('Välj en leverantör')
    if (num(form.excl) <= 0) return toast.error('Ange belopp')
    setSaving(true)
    const { error } = await supabase.from('supplier_invoices').insert({
      company_id: company.id, supplier_id: form.supplier_id, invoice_nr: form.invoice_nr || null,
      invoice_date: form.invoice_date, due_date: form.due_date,
      amount_excl_vat: num(form.excl), vat_amount: fvat, total_amount: ftotal, status: 'unpaid',
    })
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Leverantörsfaktura registrerad')
    setForm(null)
    load()
  }

  async function setStatus(i, status) {
    const { error } = await supabase.from('supplier_invoices').update({ status }).eq('id', i.id)
    if (error) return toast.error('Kunde inte uppdatera: ' + error.message)
    toast.success('Uppdaterad')
    load()
  }

  async function remove(i) {
    if (!confirm('Ta bort leverantörsfakturan?')) return
    const { error } = await supabase.from('supplier_invoices').delete().eq('id', i.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Borttagen')
    load()
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Leverantörsfakturor</span>
        <button className="btn btn-primary" onClick={() => setForm(emptyForm())}><i className="ti ti-plus" /> Ny leverantörsfaktura</button>
      </div>

      <div className="bg-white border-b flex gap-0 px-7" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {[['all', 'Alla'], ['unpaid', 'Obetalda'], ['overdue', 'Förfallna'], ['paid', 'Betalda']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px transition-colors ${
              filter === k ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}>{label}</button>
        ))}
      </div>

      <div className="p-7">
        {obetalt > 0 && <div className="mb-4 text-sm text-gray-500">Att betala: <span className="font-semibold text-gray-800 tabular-nums">{fmt(obetalt)} kr</span></div>}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Leverantör</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Fakturanr</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Datum</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Förfaller</th>
                <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Totalt</th>
                <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="7" className="text-center py-12 text-gray-400">
                  <i className="ti ti-file-import text-3xl block mb-2 opacity-30" />
                  {items.length ? 'Inga i denna vy.' : 'Inga leverantörsfakturor än.'}
                </td></tr>
              ) : visible.map(i => {
                const st = STATUS[eff(i)] || STATUS.unpaid
                return (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{i.suppliers?.name || '–'}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{i.invoice_nr || '–'}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{i.invoice_date}</td>
                    <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{i.due_date}</td>
                    <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{fmt(i.total_amount)}</td>
                    <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                      {i.status !== 'paid' && <button className="btn btn-green text-xs py-1 px-2.5 mr-1.5" onClick={() => setStatus(i, 'paid')}>Markera betald</button>}
                      <button className="text-gray-300 hover:text-red-600 align-middle" title="Ta bort" onClick={() => remove(i)}><i className="ti ti-trash" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setForm(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Ny leverantörsfaktura</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setForm(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Leverantör *</label>
                <select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">Välj leverantör…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {suppliers.length === 0 && <div className="text-xs text-amber-700 mt-1">Inga leverantörer än – lägg till under Leverantörer.</div>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fakturanummer</label>
                <input className="input" value={form.invoice_nr} onChange={e => setForm(f => ({ ...f, invoice_nr: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Momssats</label>
                <select className="input" value={form.vat_rate} onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))}>
                  <option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fakturadatum</label>
                <input className="input" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Förfallodatum</label>
                <input className="input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Belopp exkl. moms *</label>
                <input className="input" inputMode="decimal" value={form.excl} onChange={e => setForm(f => ({ ...f, excl: e.target.value }))} placeholder="0,00" />
              </div>
              <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex justify-between py-0.5"><span className="text-gray-500">Moms</span><span className="tabular-nums">{fmt(fvat)}</span></div>
                <div className="flex justify-between py-0.5 font-semibold"><span>Att betala</span><span className="tabular-nums">{fmt(ftotal)} kr</span></div>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setForm(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Sparar…' : 'Registrera'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
