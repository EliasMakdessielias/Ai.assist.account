import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function StamAvKonto() {
  const { company } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [konto, setKonto] = useState('')
  const [from, setFrom] = useState('')
  const [tom, setTom] = useState('')
  const [doljMatchade, setDoljMatchade] = useState(false)
  const [bok, setBok] = useState([])      // bokföringstransaktioner
  const [bank, setBank] = useState([])    // inlästa banktransaktioner
  const [selBok, setSelBok] = useState(new Set())
  const [selBank, setSelBank] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) loadAccounts() }, [company?.id])
  useEffect(() => { if (company && konto) load() }, [company?.id, konto, from, tom])

  async function loadAccounts() {
    const { data } = await supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).like('account_nr', '19%').eq('is_active', true).order('account_nr')
    setAccounts(data || [])
    setKonto(prev => prev || (data || []).find(a => a.account_nr === '1930')?.account_nr || (data || [])[0]?.account_nr || '')
  }

  async function load() {
    setLoading(true)
    const [{ data: rows }, { data: btx }] = await Promise.all([
      supabase.from('verifikation_rows')
        .select('id, debet, kredit, avstamd, verifikationer!inner(company_id, datum, ver_nr, beskrivning)')
        .eq('verifikationer.company_id', company.id).eq('account_nr', konto),
      supabase.from('bank_transactions').select('*').eq('company_id', company.id).eq('account_nr', konto),
    ])
    const inP = d => (!from || d >= from) && (!tom || d <= tom)
    setBok((rows || [])
      .map(r => ({ id: r.id, ver: r.verifikationer.ver_nr, datum: r.verifikationer.datum, besk: r.verifikationer.beskrivning, belopp: (r.debet || 0) - (r.kredit || 0), avstamd: !!r.avstamd }))
      .filter(r => inP(r.datum)).sort((a, b) => a.datum.localeCompare(b.datum)))
    setBank((btx || [])
      .map(t => ({ id: t.id, datum: t.datum, besk: t.text, belopp: t.amount || 0, avstamd: !!t.avstamd }))
      .filter(t => inP(t.datum)).sort((a, b) => a.datum.localeCompare(b.datum)))
    setSelBok(new Set()); setSelBank(new Set())
    setLoading(false)
  }

  const toggle = (setter) => (id) => setter(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const bokVis = bok.filter(r => !doljMatchade || !r.avstamd)
  const bankVis = bank.filter(t => !doljMatchade || !t.avstamd)
  const sumBok = bok.filter(r => selBok.has(r.id)).reduce((s, r) => s + r.belopp, 0)
  const sumBank = bank.filter(t => selBank.has(t.id)).reduce((s, t) => s + t.belopp, 0)
  const kanMatcha = (selBok.size > 0 || selBank.size > 0)

  async function matcha() {
    if (!kanMatcha) return
    if (selBok.size > 0 && selBank.size > 0 && Math.abs(sumBok - sumBank) > 0.01) {
      if (!confirm(`Markerade summor skiljer sig (${fmt(sumBok)} vs ${fmt(sumBank)}). Matcha ändå?`)) return
    }
    setSaving(true)
    try {
      if (selBok.size) await supabase.from('verifikation_rows').update({ avstamd: true }).in('id', [...selBok])
      if (selBank.size) await supabase.from('bank_transactions').update({ avstamd: true }).in('id', [...selBank])
      toast.success('Transaktioner avstämda')
      await load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setSaving(false)
  }

  async function avmarkera(side, id) {
    if (side === 'bok') await supabase.from('verifikation_rows').update({ avstamd: false }).eq('id', id)
    else await supabase.from('bank_transactions').update({ avstamd: false }).eq('id', id)
    load()
  }

  const Col = ({ title, rows, sel, onToggle, side, showVer }) => (
    <div className="bg-white rounded-xl overflow-hidden flex-1" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="px-4 py-2 text-sm font-medium border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span>{title}</span>
        <span className="text-xs text-gray-500">Markerat: <b className="tabular-nums">{fmt(side === 'bok' ? sumBok : sumBank)}</b></span>
      </div>
      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
              <th className="w-8 px-2 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              {showVer && <th className="text-left px-2 py-2 border-b w-14" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Ver</th>}
              <th className="text-left px-2 py-2 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Datum</th>
              <th className="text-left px-2 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
              <th className="text-right px-3 py-2 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={showVer ? 5 : 4} className="text-center py-10 text-gray-400 text-sm">Inga poster</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className={r.avstamd ? 'bg-green-50/50' : 'hover:bg-gray-50'}>
                <td className="px-2 py-2 border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  {r.avstamd
                    ? <button title="Ångra avstämning" className="text-green-600" onClick={() => avmarkera(side, r.id)}><i className="ti ti-circle-check-filled" /></button>
                    : <input type="checkbox" checked={sel.has(r.id)} onChange={() => onToggle(r.id)} className="w-4 h-4 cursor-pointer" />}
                </td>
                {showVer && <td className="px-2 py-2 border-b text-blue-700 font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.ver}</td>}
                <td className="px-2 py-2 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.datum}</td>
                <td className="px-2 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.besk}</td>
                <td className="px-3 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)', color: r.belopp < 0 ? '#b91c1c' : '#1a7a2e' }}>{fmt(r.belopp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div>
      <div className="text-[15px] font-bold tracking-tight mb-4">STÄM AV KONTO</div>

      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div className="w-56">
          <label className="block text-xs font-medium text-gray-500 mb-1">Konto</label>
          <select className="input" value={konto} onChange={e => setKonto(e.target.value)}>
            {accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Period fr.o.m.</label>
          <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Period t.o.m.</label>
          <input className="input" type="date" value={tom} onChange={e => setTom(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 ml-2 pb-2">
          <input type="checkbox" checked={doljMatchade} onChange={e => setDoljMatchade(e.target.checked)} /> Dölj matchade
        </label>
      </div>

      {loading ? <div className="text-gray-400 py-12 text-center">Laddar…</div> : (
        <>
          <div className="flex gap-4 items-start">
            <Col title="Bokföringstransaktioner" rows={bokVis} sel={selBok} onToggle={toggle(setSelBok)} side="bok" showVer />
            <Col title="Inlästa transaktioner" rows={bankVis} sel={selBank} onToggle={toggle(setSelBank)} side="bank" />
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn btn-green px-6" onClick={matcha} disabled={!kanMatcha || saving}>
              {saving ? 'Matchar…' : 'Matcha transaktioner'}
            </button>
          </div>
          <div className="text-xs text-gray-400 mt-3">
            Bocka i matchande poster på båda sidor (summorna visas) → <b>Matcha transaktioner</b>. Avstämda poster blir gröna; klicka den gröna bocken för att ångra. Banktransaktioner läses in under <b>Kassa och bank → Läs in / Klistra in kontoutdrag</b>.
          </div>
        </>
      )}
    </div>
  )
}
