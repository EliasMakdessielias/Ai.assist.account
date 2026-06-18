import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { serie } from '../lib/serier'
import { byggDagskassaRader, dagskassaFromTolkning, DAGSKASSA_NAMES as NAMES } from '../lib/dagskassa'

const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const empty = { vg25: '', vg12: '', vg6: '', vg0: '', moms25: '', moms12: '', moms6: '', kontant: '', kort: '' }

// "0530" -> 2026-05-30 (MMDD + år), "260530" -> ÅÅMMDD, "20260530" -> ÅÅÅÅMMDD.
function normalizeDate(str) {
  const digits = String(str || '').replace(/\D/g, '')
  let y, m, d
  if (digits.length === 4) { y = String(new Date().getFullYear()); m = digits.slice(0, 2); d = digits.slice(2, 4) }
  else if (digits.length === 6) { y = '20' + digits.slice(0, 2); m = digits.slice(2, 4); d = digits.slice(4, 6) }
  else if (digits.length === 8) { y = digits.slice(0, 4); m = digits.slice(4, 6); d = digits.slice(6, 8) }
  else return str
  const mi = parseInt(m, 10), di = parseInt(d, 10)
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return str
  return `${y}-${m}-${d}`
}

export default function Dagskassa({ underlagDoc, onUnderlagLinked, tolkning = null, tolkSignal = 0 }) {
  const { company, user } = useAuth()
  const today = new Date().toISOString().slice(0, 10)
  const [mall, setMall] = useState('exkl')
  const [datum, setDatum] = useState(today)
  const [beskrivning, setBeskrivning] = useState('Dagskassa')
  const [kommentar, setKommentar] = useState('')
  const [f, setF] = useState({ ...empty })
  const [saving, setSaving] = useState(false)
  const filledRef = useRef(0)

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const inkl = mall === 'inkl'

  // Tolka underlaget (Z-rapport/dagsrapport) → fyll formuläret. Föräldern bumpar tolkSignal.
  useEffect(() => {
    if (!tolkSignal || tolkSignal === filledRef.current) return
    const v = dagskassaFromTolkning(tolkning)
    if (!v) {
      filledRef.current = tolkSignal
      const typ = String(tolkning?.typ || '').toLowerCase()
      if (typ === 'dagskassa') toast('Kunde inte läsa ut dagskassans belopp automatiskt – fyll i fälten manuellt.', { icon: 'ℹ️' })
      else toast('Det här underlaget är inte en dagskassa/Z-rapport. Använd Registrera kvitto eller Skapa verifikation i stället.', { icon: 'ℹ️' })
      return
    }
    filledRef.current = tolkSignal
    setMall('exkl')   // OCR ger försäljning EXKL moms per varugrupp
    if (v.datum) applyDatum(v.datum)
    setF({
      ...empty,
      vg25: v.vg25 ? fmt(v.vg25) : '', vg12: v.vg12 ? fmt(v.vg12) : '', vg6: v.vg6 ? fmt(v.vg6) : '', vg0: v.vg0 ? fmt(v.vg0) : '',
      kontant: v.kontant ? fmt(v.kontant) : '', kort: v.kort ? fmt(v.kort) : '',
    })
    toast.success('Dagskassan ifylld från underlaget – kontrollera beloppen innan du bokför')
  }, [tolkSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyDatum(raw) {
    let dd = normalizeDate(raw)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dd) && dd > today) { dd = today; toast.error('Bokföringsdatum kan inte vara senare än idag') }
    setDatum(dd)
  }

  // Enter-navigering: kedjan beror på mall (momsfälten hoppas över i inkl-läge).
  // Momsen räknas alltid ut automatiskt -> hoppa över momsfälten i Enter-kedjan.
  const chain = ['ds-mall', 'ds-datum', 'ds-beskrivning', 'ds-vg25', 'ds-vg12', 'ds-vg6', 'ds-vg0', 'ds-kontant', 'ds-kort', 'ds-bokfor']
  function handleEnter(e, id) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = chain[chain.indexOf(id) + 1]
    if (next) { const el = document.getElementById(next); el?.focus(); el?.select?.() }
  }

  const split = (vg, rate) => {
    const g = num(vg)
    if (rate === 0) return { net: g, moms: 0 }
    if (inkl) { const net = g / (1 + rate / 100); return { net, moms: g - net } }   // brutto in -> dela upp
    return { net: g, moms: g * rate / 100 }                                          // netto in -> moms = netto * sats
  }
  const s25 = split(f.vg25, 25), s12 = split(f.vg12, 12), s6 = split(f.vg6, 6), s0 = split(f.vg0, 0)
  const net = { 25: s25.net, 12: s12.net, 6: s6.net, 0: s0.net }
  const moms = { 25: s25.moms, 12: s12.moms, 6: s6.moms }   // alltid automatiskt

  const salesTotal = net[25] + net[12] + net[6] + net[0]
  const momsTotal = moms[25] + moms[12] + moms[6]
  const grandTotal = salesTotal + momsTotal
  const payments = num(f.kontant) + num(f.kort)
  // Kassadifferens (inbetalt − försäljning inkl. moms). >0 överskott, <0 manko → bokförs på 3790.
  const kassadiff = Math.round((payments - grandTotal) * 100) / 100
  const harDiff = Math.abs(kassadiff) >= 0.01
  // "Väsentlig" diff (> 1 % och > 50 kr) → kräv bekräftelse innan den dumpas på 3790.
  const vasentligDiff = Math.abs(kassadiff) > 50 && (grandTotal === 0 || Math.abs(kassadiff) > grandTotal * 0.01)

  // Enter i Kort: är fältet tomt fylls resterande belopp i automatiskt (så differensen blir 0).
  function onKortEnter(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (num(f.kort) <= 0) {
      const remaining = grandTotal - num(f.kontant)
      if (remaining > 0.001) { set('kort', fmt(remaining)) }
    }
    setTimeout(() => document.getElementById('ds-bokfor')?.focus(), 0)
  }

  function rensa() { setF({ ...empty }); setKommentar('') }

  async function bokfor() {
    if (payments <= 0) return toast.error('Ange betalsätt (kontant/kort)')
    if (grandTotal <= 0) return toast.error('Fyll i minst en försäljningsrad')
    if (vasentligDiff && !window.confirm(`Kassadifferensen ${fmt(kassadiff)} kr bokförs på 3790 ${NAMES['3790']}. Stämmer det?`)) return
    const { rows, totalDebet, totalKredit } = byggDagskassaRader({ net, moms, kontant: num(f.kontant), kort: num(f.kort) })
    if (!rows.length) return toast.error('Fyll i minst en försäljningsrad')
    setSaving(true)
    try {
      const ser = serie(company, 'kassabank')
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
      const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'K' + Date.now(), ver_serie: ser,
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
      if (underlagDoc?.id) {
        await supabase.from('documents').update({ verifikation_id: ver.id, kategori: 'dokument' }).eq('id', underlagDoc.id).eq('company_id', company.id)
        onUnderlagLinked?.()
      }
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
        onChange={e => set(k, e.target.value)}
        onBlur={() => { if (!opts.locked) { const n = num(f[k]); set(k, n > 0 ? fmt(n) : '') } }}
        onKeyDown={opts.onKey || (e => handleEnter(e, `ds-${k}`))} placeholder="0,00" />
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
          <input id="ds-datum" className="input" type="text" inputMode="numeric" placeholder="ÅÅÅÅ-MM-DD"
            value={datum} onChange={e => setDatum(e.target.value)} onBlur={e => applyDatum(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyDatum(e.target.value); const el = document.getElementById('ds-beskrivning'); el?.focus(); el?.select?.() } }} />
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
        <div className="text-sm font-semibold mb-2">Moms <span className="text-xs font-normal text-gray-400">(beräknas automatiskt)</span></div>
        {amt('Moms 25%', 'moms25', { locked: true, value: moms[25] })}
        {amt('Moms 12%', 'moms12', { locked: true, value: moms[12] })}
        {amt('Moms 6%', 'moms6', { locked: true, value: moms[6] })}
        {subtotal('Moms', momsTotal)}
      </div>

      <div className="mb-5">
        <div className="text-sm font-semibold mb-2">Betalsätt</div>
        {amt('Kontant', 'kontant')}
        {amt('Kort', 'kort', { onKey: onKortEnter })}
        {subtotal('Inbetalt', payments)}
      </div>

      <div className="mb-5 pt-2 border-t max-w-[428px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="grid grid-cols-[200px_220px] gap-3 items-center">
          <span className="text-sm font-semibold">
            Kassadiff <span className="text-xs font-normal text-gray-400">(konto 3790)</span>
          </span>
          <div className="text-right text-base font-bold tabular-nums pr-1" style={{ color: harDiff ? '#A32D2D' : '#1a7a2e' }}>{fmt(kassadiff)}</div>
        </div>
        {harDiff && (
          <div className="grid grid-cols-[200px_220px] gap-3">
            <span />
            <div className="text-right text-xs text-gray-500 pr-1">
              {kassadiff > 0 ? 'Överskott' : 'Manko'} – bokförs på 3790 {NAMES['3790']}
            </div>
          </div>
        )}
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
