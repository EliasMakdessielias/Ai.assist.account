import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { serie } from '../lib/serier'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }

export default function Utbetalningar() {
  const { company, user } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [banks, setBanks] = useState([])
  const [bank, setBank] = useState('1930')
  const [loading, setLoading] = useState(true)
  const [betaldatum, setBetaldatum] = useState(today())
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(null)
  const [belopp, setBelopp] = useState('')
  const [showSug, setShowSug] = useState(false)
  const [lines, setLines] = useState([])
  const [sel, setSel] = useState(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: bk }] = await Promise.all([
      supabase.from('supplier_invoices').select('*, suppliers(name, org_nr)').eq('company_id', company.id).eq('bokford', true).order('due_date'),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).like('account_nr', '19%').eq('is_active', true).order('account_nr'),
    ])
    setInvoices((inv || []).map(i => ({ ...i, saldo: (i.total_amount || 0) - (i.paid_amount || 0) })))
    setBanks(bk || [])
    if ((bk || []).length) setBank((bk.find(b => b.account_nr === '1930') || bk[0]).account_nr)
    setLoading(false)
  }

  // Betalbara: bokförda, ej makulerade, saldo kvar, ej redan i listan.
  const inList = new Set(lines.map(l => l.invoice.id))
  const payable = invoices.filter(i => !i.makulerad && i.saldo > 0.005 && !inList.has(i.id))
  const matches = useMemo(() => {
    if (!search.trim()) return payable
    const q = search.toLowerCase()
    return payable.filter(i => `${i.lopnr || ''} ${i.suppliers?.org_nr || ''} ${i.suppliers?.name || ''} ${i.ocr || ''} ${i.invoice_nr || ''}`.toLowerCase().includes(q))
  }, [search, payable])

  function pick(i) {
    setPicked(i); setSearch(`${i.lopnr || ''} · ${i.suppliers?.name || ''}`); setBelopp(fmt(i.saldo)); setShowSug(false)
  }
  function lagg() {
    if (!picked) return toast.error('Sök och välj en faktura')
    const b = num(belopp)
    if (b <= 0) return toast.error('Ange belopp')
    if (b > picked.saldo + 0.005) return toast.error(`Beloppet överstiger saldot (${fmt(picked.saldo)})`)
    const line = { invoice: picked, betaldatum, betalt: b }
    setLines(ls => [...ls, line])
    setSel(s => new Set([...s, lines.length]))
    rensa()
  }
  function rensa() { setPicked(null); setSearch(''); setBelopp(''); setShowSug(false) }
  function removeLine(idx) {
    setLines(ls => ls.filter((_, i) => i !== idx))
    setSel(new Set())
  }
  function toggle(idx) { setSel(s => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n }) }

  const selLines = lines.filter((_, i) => sel.has(i))
  const totalSel = selLines.reduce((s, l) => s + l.betalt, 0)
  const bk = banks.find(b => b.account_nr === bank)

  async function bokfor() {
    if (!selLines.length) return toast.error('Markera minst en utbetalning')
    setBusy(true)
    try {
      for (const l of selLines) {
        const i = l.invoice, belopp = l.betalt
        const rows = [
          { nr: '2440', name: 'Leverantörsskulder', debet: belopp, kredit: 0 },
          { nr: bank, name: bk?.name || 'Bank', debet: 0, kredit: belopp },
        ]
        const ser = serie(company, 'utbetalningar')
        const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
        const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
          company_id: company.id, ver_nr: nr || 'U' + Date.now(), ver_serie: ser,
          datum: l.betaldatum, beskrivning: `Betalning ${i.suppliers?.name || ''} ${i.invoice_nr || ''}`.trim(),
          total_debet: belopp, total_kredit: belopp, created_by: user.id,
        }).select().single()
        if (e1) throw e1
        await supabase.from('verifikation_rows').insert(rows.map((r, ix) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: r.name, debet: r.debet, kredit: r.kredit, sort_order: ix })))
        await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', [bank]).eq('is_active', false)
        const newPaid = (i.paid_amount || 0) + belopp
        const full = newPaid >= (i.total_amount || 0) - 0.005
        await supabase.from('supplier_invoices').update({
          paid_amount: newPaid, paid_date: full ? l.betaldatum : null, status: full ? 'paid' : 'unpaid', betalning_ver_id: ver.id,
        }).eq('id', i.id)
      }
      toast.success(`${selLines.length} utbetalning(ar) bokförd(a)`)
      setLines([]); setSel(new Set()); load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="pb-20">
      <div className="px-7 pt-6 flex items-center justify-between">
        <span className="text-[15px] font-bold tracking-tight">UTBETALNINGAR</span>
        <div className="flex items-center gap-5 text-[13px] text-gray-500">
          <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => { setLines([]); setSel(new Set()) }}><i className="ti ti-trash" /> Rensa listan</button>
          <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })}><i className="ti ti-upload" /> Läs in betalfil</button>
        </div>
      </div>

      <div className="px-7 py-5">
        {/* Registreringsrad */}
        <div className="flex items-end gap-3 flex-wrap bg-white rounded-xl p-4 mb-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Betaldatum</label>
            <input className="input w-40" type="date" value={betaldatum} onChange={e => setBetaldatum(e.target.value)} />
          </div>
          <div className="relative flex-1 min-w-[280px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Faktura</label>
            <input className="input" placeholder="Löpnr, Levnr, Namn, OCR/Faktnr" value={search}
              onChange={e => { setSearch(e.target.value); setPicked(null); setShowSug(true) }}
              onFocus={() => setShowSug(true)} />
            {showSug && matches.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white rounded-lg shadow-xl max-h-72 overflow-y-auto" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                {matches.slice(0, 30).map(i => (
                  <button key={i.id} onClick={() => pick(i)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm flex items-center justify-between gap-3">
                    <span className="truncate"><b>{i.lopnr}</b> · {i.suppliers?.name} <span className="text-gray-400">{i.invoice_nr ? `· ${i.invoice_nr}` : ''}</span></span>
                    <span className="tabular-nums text-gray-600 shrink-0">{fmt(i.saldo)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Betalt SEK</label>
            <input className="input w-40 text-right" inputMode="decimal" value={belopp} onChange={e => setBelopp(e.target.value)}
              onBlur={e => { const n = num(e.target.value); setBelopp(n > 0 ? fmt(n) : '') }}
              onKeyDown={e => e.key === 'Enter' && lagg()} placeholder="0,00" />
          </div>
          <button className="btn btn-green px-5" onClick={lagg}>Lägg till</button>
          <button className="btn" onClick={rensa}>Rensa</button>
          <button className="btn" onClick={() => { setSearch(''); setPicked(null); setShowSug(true) }}>Sök i faktlista</button>
        </div>

        {/* Lista */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2.5 border-b w-8" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                <th className="text-left px-3 py-2.5 border-b w-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Löpnr</th>
                <th className="text-left px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</th>
                <th className="text-left px-3 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Faktnr</th>
                <th className="text-left px-3 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Förfaller</th>
                <th className="text-right px-3 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Saldo</th>
                <th className="text-left px-3 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Betaldatum</th>
                <th className="text-right px-3 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Betalt SEK</th>
                <th className="px-3 py-2.5 border-b w-10" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9" className="text-center py-10 text-gray-400">Laddar…</td></tr>
              ) : lines.length === 0 ? (
                <tr><td colSpan="9" className="text-center py-12 text-gray-400">
                  <i className="ti ti-cash text-3xl block mb-2 opacity-30" />
                  Sök en obetald faktura ovan och klicka <b>Lägg till</b>
                </td></tr>
              ) : lines.map((l, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><input type="checkbox" checked={sel.has(idx)} onChange={() => toggle(idx)} /></td>
                  <td className="px-3 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{l.invoice.lopnr}</td>
                  <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{l.invoice.suppliers?.name}</td>
                  <td className="px-3 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{l.invoice.invoice_nr || ''}</td>
                  <td className="px-3 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{l.invoice.due_date}</td>
                  <td className="px-3 py-2.5 border-b text-right tabular-nums text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(l.invoice.saldo)}</td>
                  <td className="px-3 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{l.betaldatum}</td>
                  <td className="px-3 py-2.5 border-b text-right tabular-nums font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{fmt(l.betalt)}</td>
                  <td className="px-3 py-2.5 border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><button className="text-gray-300 hover:text-red-600" onClick={() => removeLine(idx)}><i className="ti ti-x" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottenrad */}
      <div className="fixed bottom-0 left-[230px] right-0 bg-white border-t px-7 py-3 flex items-center gap-4 z-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <button className="btn" disabled={!sel.size} onClick={() => setSel(new Set())}>Avmarkera alla</button>
        <span className="text-[13px] text-gray-500">({sel.size} markerade)</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm">Total SEK: <b className="tabular-nums">{fmt(totalSel)}</b></span>
          <select className="input w-48" value={bank} onChange={e => setBank(e.target.value)}>
            {banks.length === 0 && <option value="1930">1930 – Företagskonto</option>}
            {banks.map(b => <option key={b.account_nr} value={b.account_nr}>{b.name} ({b.account_nr})</option>)}
          </select>
          <button className="btn btn-green px-6" disabled={!selLines.length || busy} onClick={bokfor}>{busy ? 'Bokför…' : 'Bokför'}</button>
        </div>
      </div>
    </div>
  )
}
