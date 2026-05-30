import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ACC = {
  forsaljning: { 25: '3001', 12: '3002', 6: '3003', 0: '3004' },
  moms: { 25: '2611', 12: '2621', 6: '2631' },
  kontant: '1910', kort: '1580',
}
const NAMES = {
  '3001': 'Försäljning 25% moms', '3002': 'Försäljning 12% moms', '3003': 'Försäljning 6% moms', '3004': 'Försäljning momsfri',
  '2611': 'Utgående moms 25%', '2621': 'Utgående moms 12%', '2631': 'Utgående moms 6%',
  '1910': 'Kassa', '1580': 'Kontokortsfordringar',
}
const empty = { vg25: '', vg12: '', vg6: '', vg0: '', moms25: '', moms12: '', moms6: '', kontant: '', kort: '' }

export default function Dagskassa() {
  const { company, user } = useAuth()
  const today = new Date().toISOString().slice(0, 10)
  const [mall, setMall] = useState('exkl')
  const [datum, setDatum] = useState(today)
  const [beskrivning, setBeskrivning] = useState('Dagskassa')
  const [kommentar, setKommentar] = useState('')
  const [f, setF] = useState({ ...empty })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const inkl = mall === 'inkl'

  // Enter-navigering: kedjan beror på mall (momsfälten hoppas över i inkl-läge).
  const chain = inkl
    ? ['ds-mall', 'ds-datum', 'ds-beskrivning', 'ds-vg25', 'ds-vg12', 'ds-vg6', 'ds-vg0', 'ds-kontant', 'ds-kort', 'ds-bokfor']
    : ['ds-mall', 'ds-datum', 'ds-beskrivning', 'ds-vg25', 'ds-vg12', 'ds-vg6', 'ds-vg0', 'ds-moms25', 'ds-moms12', 'ds-moms6', 'ds-kontant', 'ds-kort', 'ds-bokfor']
  function handleEnter(e, id) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = chain[chain.indexOf(id) + 1]
    if (next) { const el = document.getElementById(next); el?.focus(); el?.select?.() }
  }

  const split = (vg, rate) => {
    const g = num(vg)
    if (rate === 0) return { net: g, moms: 0 }
    if (inkl) { const net = g / (1 + rate / 100); return { net, moms: g - net } }
    return { net: g, moms: 0 }
  }
  const s25 = split(f.vg25, 25), s12 = split(f.vg12, 12), s6 = split(f.vg6, 6), s0 = split(f.vg0, 0)
  const net = { 25: s25.net, 12: s12.net, 6: s6.net, 0: s0.net }
  const moms = inkl ? { 25: s25.moms, 12: s12.moms, 6: s6.moms } : { 25: num(f.moms25), 12: num(f.moms12), 6: num(f.moms6) }

  const salesTotal = net[25] + net[12] + net[6] + net[0]
  const momsTotal = moms[25] + moms[12] + moms[6]
  const grandTotal = salesTotal + momsTotal
  const payments = num(f.kontant) + num(f.kort)
  const differens = payments - grandTotal
  const balanced = Math.abs(differens) < 0.01 && payments > 0

  function rensa() { setF({ ...empty }); setKommentar('') }

  async function bokfor() {
    if (payments <= 0) return toast.error('Ange betalsätt (kontant/kort)')
    if (!balanced) return toast.error('Differensen måste vara 0 — kontrollera beloppen')
    const rows = []
    const credit = (nr, b) => { if (b > 0.001) rows.push({ nr, debet: 0, kredit: Math.round(b * 100) / 100 }) }
    const debit = (nr, b) => { if (b > 0.001) rows.push({ nr, debet: Math.round(b * 100) / 100, kredit: 0 }) }
    credit(ACC.forsaljning[25], net[25]); credit(ACC.forsaljning[12], net[12]); credit(ACC.forsaljning[6], net[6]); credit(ACC.forsaljning[0], net[0])
    credit(ACC.moms[25], moms[25]); credit(ACC.moms[12], moms[12]); credit(ACC.moms[6], moms[6])
    debit(ACC.kontant, num(f.kontant)); debit(ACC.kort, num(f.kort))
    if (!rows.length) return toast.error('Fyll i minst en försäljningsrad')
    const totalDebet = rows.reduce((s, r) => s + r.debet, 0)
    const totalKredit = rows.reduce((s, r) => s + r.kredit, 0)
    setSaving(true)
    try {
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: 'K - Kassa' })
      const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'K' + Date.now(), ver_serie: 'K - Kassa',
        datum, beskrivning: beskrivning || 'Dagskassa', kommentar: kommentar || null,
        total_debet: totalDebet, total_kredit: totalKredit, created_by: user.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('verifikation_rows').insert(rows.map((r, i) => ({
        verifikation_id: ver.id, account_nr: r.nr, account_name: NAMES[r.nr] || '', debet: r.debet, kredit: r.kredit, sort_order: i,
      })))
      if (e2) throw e2
      const used = [...new Set(rows.map(r => r.nr))]
      await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', used).eq('is_active', false)
      toast.success(`Dagskassa ${ver.ver_nr} bokförd!`)
      rensa()
      setTimeout(() => document.getElementById('ds-vg25')?.focus(), 50)
    } catch (err) {
      toast.error('Fel: ' + err.message)
    }
    setSaving(false)
  }

  // Beloppsrad (anropas som funktion, inte som komponent → fokus tappas inte).
  const amt = (label, k, opts = {}) => (
    <div className="grid grid-cols-[200px_220px] items-center gap-3 mb-2">
      <label className="text-sm text-gray-600">{label}</label>
      <input id={`ds-${k}`} className="input text-right" inputMode="decimal" disabled={opts.locked}
        style={{ opacity: opts.locked ? 0.6 : 1 }}
        value={opts.locked ? (opts.value ? fmt(opts.value) : '') : (f[k] ?? '')}
        onChange={e => set(k, e.target.value)} onKeyDown={e => handleEnter(e, `ds-${k}`)} placeholder="0,00" />
    </div>
  )
  const subtotal = (label, val) => (
    <div className="grid grid-cols-[200px_220px] gap-3"><span /><div className="text-right text-sm text-gray-500 pr-1">{label}: <b className="text-gray-800 tabular-nums">{fmt(val)}</b></div></div>
  )

  return (
    <div className="max-w-3xl">
      <div className="text-[15px] font-bold tracking-tight mb-5">NY FÖRSÄLJNING {inkl ? 'INKL.' : 'EXKL.'} MOMS</div>

      <div className="grid grid-cols-[1fr_1fr] gap-4 mb-5 max-w-xl">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mall</label>
          <select id="ds-mall" className="input" value={mall} onChange={e => setMall(e.target.value)} onKeyDown={e => handleEnter(e, 'ds-mall')}>
            <option value="exkl">Försäljning exkl. moms</option>
            <option value="inkl">Försäljning inkl. moms</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bokföringsdatum</label>
          <input id="ds-datum" className="input" type="date" value={datum} max={today} onChange={e => setDatum(e.target.value)} onKeyDown={e => handleEnter(e, 'ds-datum')} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Verifikationsbeskrivning</label>
          <input id="ds-beskrivning" className="input" value={beskrivning} onChange={e => setBeskrivning(e.target.value)} onKeyDown={e => handleEnter(e, 'ds-beskrivning')} />
        </div>
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Försäljning {inkl ? 'inkl.' : 'exkl.'} moms</div>
        {amt('Varugrupp 25% moms', 'vg25')}
        {amt('Varugrupp 12% moms', 'vg12')}
        {amt('Varugrupp 6% moms', 'vg6')}
        {amt('Varugrupp momsfri', 'vg0')}
        {subtotal('Netto', salesTotal)}
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Moms{inkl && <span className="text-xs font-normal text-gray-400"> (beräknas automatiskt)</span>}</div>
        {amt('Moms 25%', 'moms25', { locked: inkl, value: moms[25] })}
        {amt('Moms 12%', 'moms12', { locked: inkl, value: moms[12] })}
        {amt('Moms 6%', 'moms6', { locked: inkl, value: moms[6] })}
        {subtotal('Moms', momsTotal)}
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Betalsätt</div>
        {amt('Kontant', 'kontant')}
        {amt('Kort', 'kort')}
        {subtotal('Inbetalt', payments)}
      </div>

      <div className="grid grid-cols-[200px_220px] gap-3 items-center mb-5 pt-2 border-t max-w-[428px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-sm font-semibold">Differens</span>
        <div className="text-right text-base font-bold tabular-nums pr-1" style={{ color: balanced ? '#1a7a2e' : '#A32D2D' }}>{fmt(differens)}</div>
      </div>

      <div className="mb-6 max-w-xl">
        <label className="block text-xs font-medium text-gray-500 mb-1">Kommentar</label>
        <textarea className="input" rows={2} value={kommentar} onChange={e => setKommentar(e.target.value)} />
      </div>

      <div className="flex gap-3">
        <button className="btn" onClick={rensa} disabled={saving}>Rensa</button>
        <button id="ds-bokfor" className="btn btn-green px-6" onClick={bokfor} disabled={saving}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bokfor() } }}>{saving ? 'Bokför…' : 'Bokför'}</button>
      </div>
    </div>
  )
}
