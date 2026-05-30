import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Rakenskapsar() {
  const { company } = useAuth()
  const [years, setYears] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const thisYear = new Date().getFullYear()
  const [form, setForm] = useState({ year: thisYear, start_date: `${thisYear}-01-01`, end_date: `${thisYear}-12-31` })

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false })
    setYears(data || [])
    setLoading(false)
  }

  // När året ändras, föreslå kalenderår (redigerbart).
  function setYear(y) {
    const yr = parseInt(y, 10)
    setForm(f => ({
      ...f,
      year: y,
      start_date: yr ? `${yr}-01-01` : f.start_date,
      end_date: yr ? `${yr}-12-31` : f.end_date,
    }))
  }

  async function add() {
    const yr = parseInt(form.year, 10)
    if (!yr) return toast.error('Ange ett giltigt år')
    if (!form.start_date || !form.end_date) return toast.error('Ange start- och slutdatum')
    if (years.some(y => y.year === yr)) return toast.error(`Räkenskapsår ${yr} finns redan`)
    setAdding(true)
    const isFirst = years.length === 0
    const { error } = await supabase.from('fiscal_years').insert({
      company_id: company.id, year: yr, start_date: form.start_date, end_date: form.end_date,
      status: isFirst ? 'active' : 'open',
    })
    setAdding(false)
    if (error) return toast.error('Kunde inte skapa: ' + error.message)
    toast.success(`Räkenskapsår ${yr} skapat`)
    const next = yr + 1
    setForm({ year: next, start_date: `${next}-01-01`, end_date: `${next}-12-31` })
    load()
  }

  async function setActive(y) {
    // Sätt valt år som aktivt, övriga som stängda.
    await supabase.from('fiscal_years').update({ status: 'closed' }).eq('company_id', company.id).neq('id', y.id)
    const { error } = await supabase.from('fiscal_years').update({ status: 'active' }).eq('id', y.id)
    if (error) return toast.error('Kunde inte uppdatera: ' + error.message)
    toast.success(`Räkenskapsår ${y.year} är nu aktivt`)
    load()
  }

  async function remove(y) {
    if (!confirm(`Ta bort räkenskapsår ${y.year}?`)) return
    const { error } = await supabase.from('fiscal_years').delete().eq('id', y.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success(`Räkenskapsår ${y.year} borttaget`)
    load()
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Räkenskapsår</span>
        <Link to="/installningar" className="btn"><i className="ti ti-arrow-left" /> Inställningar</Link>
      </div>

      <div className="p-7 max-w-3xl">
        {/* Lägg till nytt */}
        <div className="bg-white rounded-xl p-6 mb-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <h2 className="text-sm font-semibold mb-4">Lägg till räkenskapsår</h2>
          <div className="grid grid-cols-[120px_1fr_1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">År</label>
              <input className="input" type="number" value={form.year} onChange={e => setYear(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Startdatum</label>
              <input className="input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Slutdatum</label>
              <input className="input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
            <button className="btn btn-primary py-2" onClick={add} disabled={adding}>
              <i className="ti ti-plus" /> {adding ? 'Lägger till…' : 'Lägg till'}
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>År</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Period</th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="px-4 py-2.5 border-b w-48" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4" className="text-center py-12 text-gray-400">Laddar…</td></tr>
              ) : years.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-12 text-gray-400">
                  <i className="ti ti-calendar-off text-3xl block mb-2 opacity-30" />
                  Inga räkenskapsår än – lägg till ditt första ovan.
                </td></tr>
              ) : years.map(y => (
                <tr key={y.id}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{y.year}</td>
                  <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{y.start_date} – {y.end_date}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {y.status === 'active'
                      ? <span className="tag-active px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'rgba(52,211,153,0.15)', color: '#1a7a2e' }}>Aktivt</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Stängt</span>}
                  </td>
                  <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {y.status !== 'active' && (
                      <button className="btn text-xs py-1 px-2.5 mr-1.5" onClick={() => setActive(y)}>Markera aktivt</button>
                    )}
                    <button className="text-gray-300 hover:text-red-600 align-middle" title="Ta bort" onClick={() => remove(y)}><i className="ti ti-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
