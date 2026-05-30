import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function normalizeDate(str) {
  const d = String(str || '').replace(/\D/g, '')
  let y, m, dd
  if (d.length === 4) { y = String(new Date().getFullYear()); m = d.slice(0, 2); dd = d.slice(2, 4) }
  else if (d.length === 6) { y = '20' + d.slice(0, 2); m = d.slice(2, 4); dd = d.slice(4, 6) }
  else if (d.length === 8) { y = d.slice(0, 4); m = d.slice(4, 6); dd = d.slice(6, 8) }
  else return str
  if (+m < 1 || +m > 12 || +dd < 1 || +dd > 31) return str
  return `${y}-${m}-${dd}`
}

const NAMES = {
  '6110': 'Kontorsmateriel', '7690': 'Övriga personalkostnader', '5710': 'Frakter och transporter',
  '5410': 'Förbrukningsinventarier', '5460': 'Förbrukningsmaterial', '5090': 'Övriga lokalkostnader',
  '5800': 'Resekostnader', '5611': 'Drivmedel', '2640': 'Ingående moms', '1910': 'Kassa', '1930': 'Företagskonto',
}

// Mallar (kostnadskategori -> konto + momssats). Kan göras inställningsbara senare.
const TEMPLATES = {
  utlagg: {
    namn: 'Diverse utlägg', titel: 'DIVERSE UTLÄGG', besk: 'Utlägg',
    rader: [
      { label: 'Kontorsmateriel', konto: '6110', sats: 25 },
      { label: 'Fikabröd', konto: '7690', sats: 12 },
      { label: 'Frakt', konto: '5710', sats: 25 },
      { label: 'Förbrukningsinventarier', konto: '5410', sats: 25 },
      { label: 'Förbrukningsmaterial', konto: '5460', sats: 25 },
      { label: 'Övriga lokalkostnader', konto: '5090', sats: 25 },
    ],
  },
  resa: {
    namn: 'Resa', titel: 'RESA', besk: 'Resa',
    rader: [
      { label: 'Taxi', konto: '5800', sats: 6 },
      { label: 'Flyg', konto: '5800', sats: 6 },
      { label: 'Tåg', konto: '5800', sats: 6 },
      { label: 'Drivmedel', konto: '5611', sats: 25 },
    ],
  },
}

export default function Kvitto() {
  const { company, user } = useAuth()
  const today = new Date().toISOString().slice(0, 10)
  const [mallKey, setMallKey] = useState('utlagg')
  const [datum, setDatum] = useState(today)
  const [beskrivning, setBeskrivning] = useState(TEMPLATES.utlagg.besk)
  const [kommentar, setKommentar] = useState('')
  const [kontant, setKontant] = useState('')
  const [kort, setKort] = useState('')
  const [costs, setCosts] = useState({})
  const [saving, setSaving] = useState(false)

  const mall = TEMPLATES[mallKey]

  function bytMall(k) {
    setMallKey(k); setCosts({}); setKontant(''); setKort(''); setBeskrivning(TEMPLATES[k].besk)
  }
  function applyDatum(raw) {
    let dd = normalizeDate(raw)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dd) && dd > today) { dd = today; toast.error('Datum kan inte vara senare än idag') }
    setDatum(dd)
  }

  // Beräkningar
  const split = r => { const g = num(costs[r.label]); const net = r.sats ? g / (1 + r.sats / 100) : g; return { gross: g, net, moms: g - net } }
  const costsGross = mall.rader.reduce((s, r) => s + num(costs[r.label]), 0)
  const momsTotal = mall.rader.reduce((s, r) => s + split(r).moms, 0)
  const payments = num(kontant) + num(kort)
  const differens = payments - costsGross
  const balanced = Math.abs(differens) < 0.01 && costsGross > 0

  // Enter-navigering
  const chain = ['kv-mall', 'kv-datum', 'kv-beskrivning', 'kv-kontant', 'kv-kort', ...mall.rader.map((_, i) => `kv-c${i}`), 'kv-bokfor']
  function focusId(id) { setTimeout(() => { const el = document.getElementById(id); el?.focus(); el?.select?.() }, 0) }
  function handleEnter(e, id) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = chain[chain.indexOf(id) + 1]
    if (next) focusId(next)
  }
  // Sista kostnadsraden: fyll betalsätt automatiskt om det är tomt
  function lastCostEnter(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (payments < 0.01 && costsGross > 0.01) setKort(fmt(costsGross))
    focusId('kv-bokfor')
  }

  function rensa() { setCosts({}); setKontant(''); setKort(''); setKommentar('') }

  async function bokfor() {
    if (costsGross <= 0) return toast.error('Ange minst en kostnad')
    if (!balanced) return toast.error('Betalsätt måste motsvara kostnaderna (differens 0)')
    const netByKonto = {}
    mall.rader.forEach(r => { const { net } = split(r); if (net > 0.001) netByKonto[r.konto] = (netByKonto[r.konto] || 0) + net })
    const rows = []
    Object.entries(netByKonto).forEach(([nr, net]) => rows.push({ nr, debet: Math.round(net * 100) / 100, kredit: 0 }))
    if (momsTotal > 0.001) rows.push({ nr: '2640', debet: Math.round(momsTotal * 100) / 100, kredit: 0 })
    if (num(kontant) > 0.001) rows.push({ nr: '1910', debet: 0, kredit: num(kontant) })
    if (num(kort) > 0.001) rows.push({ nr: '1930', debet: 0, kredit: num(kort) })

    const totalDebet = rows.reduce((s, r) => s + r.debet, 0)
    const totalKredit = rows.reduce((s, r) => s + r.kredit, 0)
    setSaving(true)
    try {
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: 'K - Kassa' })
      const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'K' + Date.now(), ver_serie: 'K - Kassa',
        datum, beskrivning: beskrivning || mall.besk, kommentar: kommentar || null,
        total_debet: totalDebet, total_kredit: totalKredit, created_by: user.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('verifikation_rows').insert(rows.map((r, i) => ({
        verifikation_id: ver.id, account_nr: r.nr, account_name: NAMES[r.nr] || '', debet: r.debet, kredit: r.kredit, sort_order: i,
      })))
      if (e2) throw e2
      const used = [...new Set(rows.map(r => r.nr))]
      await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', used).eq('is_active', false)
      toast.success(`Kvitto ${ver.ver_nr} bokfört!`)
      rensa()
      focusId('kv-c0')
    } catch (err) { toast.error('Fel: ' + err.message) }
    setSaving(false)
  }

  const amtRow = (label, id, value, onChange, opts = {}) => (
    <div className="grid grid-cols-[220px_220px] items-center gap-3 mb-2">
      <label className="text-sm text-gray-600">{label}</label>
      <input id={id} className="input text-right" inputMode="decimal" value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { const n = num(value); onChange(n > 0 ? fmt(n) : '') }}
        onKeyDown={opts.onKey || (e => handleEnter(e, id))} placeholder="0,00" />
    </div>
  )

  return (
    <div className="max-w-3xl">
      <div className="text-[15px] font-bold tracking-tight mb-5">NY {mall.titel}</div>

      <div className="grid grid-cols-[1fr_1fr] gap-4 mb-5 max-w-xl">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mall</label>
          <select id="kv-mall" className="input" value={mallKey} onChange={e => bytMall(e.target.value)} onKeyDown={e => handleEnter(e, 'kv-mall')}>
            <option value="utlagg">Diverse utlägg</option>
            <option value="resa">Resa</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bokföringsdatum</label>
          <input id="kv-datum" className="input" type="text" inputMode="numeric" placeholder="ÅÅÅÅ-MM-DD" value={datum}
            onChange={e => setDatum(e.target.value)} onBlur={e => applyDatum(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyDatum(e.target.value); focusId('kv-beskrivning') } }} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Verifikationsbeskrivning</label>
          <input id="kv-beskrivning" className="input" value={beskrivning} onChange={e => setBeskrivning(e.target.value)} onKeyDown={e => handleEnter(e, 'kv-beskrivning')} />
        </div>
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Betalsätt</div>
        {amtRow('Kontant', 'kv-kontant', kontant, setKontant)}
        {amtRow('Kort', 'kv-kort', kort, setKort)}
        <div className="grid grid-cols-[220px_220px] gap-3"><span /><div className="text-right text-sm text-gray-500 pr-1">{fmt(payments)}</div></div>
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Kostnader inkl. moms</div>
        {mall.rader.map((r, i) => amtRow(r.label, `kv-c${i}`, costs[r.label] ?? '', v => setCosts(p => ({ ...p, [r.label]: v })),
          i === mall.rader.length - 1 ? { onKey: lastCostEnter } : {}))}
        <div className="grid grid-cols-[220px_220px] gap-3"><span /><div className="text-right text-sm text-gray-500 pr-1">Varav moms: <b className="text-gray-800 tabular-nums">{fmt(momsTotal)}</b> · Totalt: <b className="text-gray-800 tabular-nums">{fmt(costsGross)}</b></div></div>
      </div>

      <div className="grid grid-cols-[220px_220px] gap-3 items-center mb-5 pt-2 border-t max-w-[448px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-sm font-semibold">Differens</span>
        <div className="text-right text-base font-bold tabular-nums pr-1" style={{ color: balanced ? '#1a7a2e' : '#A32D2D' }}>{fmt(differens)}</div>
      </div>

      <div className="mb-6 max-w-xl">
        <label className="block text-xs font-medium text-gray-500 mb-1">Kommentar</label>
        <textarea className="input" rows={2} value={kommentar} onChange={e => setKommentar(e.target.value)} />
      </div>

      <div className="flex gap-3">
        <button className="btn" onClick={rensa} disabled={saving}>Rensa</button>
        <button id="kv-bokfor" className="btn btn-green px-6" onClick={bokfor} disabled={saving}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bokfor() } }}>{saving ? 'Bokför…' : 'Bokför'}</button>
      </div>
    </div>
  )
}
