import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { buildUniqueMatches } from '../lib/avstamning'

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
  // Granskningsläge: Matcha bygger unika par som visas (P1, P2 …) men skriver INGET –
  // användaren accepterar med Spara. { pairs, bokNo: Map id->parnr, bankNo: Map id->parnr }
  // eller { group: true, bokIds, bankIds } för manuell gruppmatchning av markerade poster.
  const [pending, setPending] = useState(null)

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
    setPending(null)
    setLoading(false)
  }

  const toggle = (setter) => (id) => setter(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const bokVis = bok.filter(r => !doljMatchade || !r.avstamd)
  const bankVis = bank.filter(t => !doljMatchade || !t.avstamd)
  const sumBok = bok.filter(r => selBok.has(r.id)).reduce((s, r) => s + r.belopp, 0)
  const sumBank = bank.filter(t => selBank.has(t.id)).reduce((s, t) => s + t.belopp, 0)

  // Möjliga unika par bland ej avstämda (visas som antal på Matcha-knappen + gulmarkering).
  const possiblePairs = buildUniqueMatches(bok.filter(r => !r.avstamd), bank.filter(t => !t.avstamd))
  const suggBok = new Set(possiblePairs.map(p => p.bokId))
  const suggBank = new Set(possiblePairs.map(p => p.bankId))

  // Steg 1 – Matcha: bygg UNIK 1:1-matchning (varje post i högst ett par) och visa den som
  // granskningsläge. Finns markeringar begränsas parningen till de markerade posterna.
  // Markerade som inte kan paras 1:1 men vars summor stämmer erbjuds som gruppmatchning.
  // INGET skrivs till databasen i detta steg.
  function matchaTransaktioner() {
    const bokKand = bok.filter(r => !r.avstamd && (selBok.size ? selBok.has(r.id) : true))
    const bankKand = bank.filter(t => !t.avstamd && (selBank.size ? selBank.has(t.id) : true))
    const pairs = buildUniqueMatches(bokKand, bankKand)
    if (!pairs.length) {
      if (selBok.size && selBank.size && Math.abs(sumBok - sumBank) <= 0.01) {
        setPending({ group: true, bokIds: new Set(selBok), bankIds: new Set(selBank) })
        return
      }
      return toast('Inga matchningar hittades (samma belopp, datum inom 7 dagar). Markera poster med lika summor på båda sidor för gruppmatchning.', { icon: 'ℹ️' })
    }
    const bokNo = new Map(pairs.map((p, i) => [p.bokId, i + 1]))
    const bankNo = new Map(pairs.map((p, i) => [p.bankId, i + 1]))
    const omatchade = [...selBok].filter(id => !bokNo.has(id)).length + [...selBank].filter(id => !bankNo.has(id)).length
    setPending({ pairs, bokNo, bankNo, bokIds: new Set(bokNo.keys()), bankIds: new Set(bankNo.keys()) })
    if (omatchade) toast(`${omatchade} markerade poster kunde inte paras unikt och ingår inte`, { icon: 'ℹ️' })
  }

  // Steg 2 – Spara: användarens acceptans av granskad matchning → skriv avstämningen.
  async function sparaAvstamning() {
    if (!pending) return
    setSaving(true)
    try {
      if (pending.bokIds.size) await supabase.from('verifikation_rows').update({ avstamd: true }).in('id', [...pending.bokIds])
      if (pending.bankIds.size) await supabase.from('bank_transactions').update({ avstamd: true }).in('id', [...pending.bankIds])
      toast.success(pending.group ? 'Gruppmatchning sparad' : `Avstämning sparad (${pending.pairs.length} matchningar)`)
      setPending(null)
      await load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setSaving(false)
  }

  async function avmarkera(side, id) {
    if (side === 'bok') await supabase.from('verifikation_rows').update({ avstamd: false }).eq('id', id)
    else await supabase.from('bank_transactions').update({ avstamd: false }).eq('id', id)
    load()
  }

  const Col = ({ title, rows, sel, onToggle, side, showVer, sugg, pendNo, pendGroup }) => (
    <div className="bg-white rounded-xl overflow-hidden flex-1" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="px-4 py-2 text-sm font-medium border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span>{title}</span>
        <span className="text-xs text-gray-500">Markerat: <b className="tabular-nums">{fmt(side === 'bok' ? sumBok : sumBank)}</b></span>
      </div>
      <div>
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
            ) : rows.map(r => {
              const parNr = pendNo?.get(r.id)
              const iPending = !!parNr || (pendGroup?.has(r.id))
              return (
              <tr key={r.id} className={r.avstamd ? 'bg-green-50/50' : iPending ? 'bg-blue-50/60' : sugg?.has(r.id) ? 'bg-amber-50/50' : 'hover:bg-gray-50'}>
                <td className="px-2 py-2 border-b text-center" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  {r.avstamd
                    ? <button title="Ångra avstämning" className="text-green-600" onClick={() => avmarkera(side, r.id)}><i className="ti ti-circle-check-filled" /></button>
                    : iPending
                      ? <span className="inline-block min-w-7 text-[10px] font-bold px-1 py-0.5 rounded bg-blue-100 text-blue-700 tabular-nums" title={parNr ? `Matchning ${parNr}` : 'Gruppmatchning'}>{parNr ? `P${parNr}` : 'G'}</span>
                      : <input type="checkbox" checked={sel.has(r.id)} onChange={() => onToggle(r.id)} disabled={!!pending} className="w-4 h-4 cursor-pointer" title={sugg?.has(r.id) ? 'Föreslagen matchning' : ''} />}
                </td>
                {showVer && <td className="px-2 py-2 border-b text-blue-700 font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.ver}</td>}
                <td className="px-2 py-2 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.datum}</td>
                <td className="px-2 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.besk}</td>
                <td className="px-3 py-2 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)', color: r.belopp < 0 ? '#b91c1c' : '#1a7a2e' }}>{fmt(r.belopp)}</td>
              </tr>
            )})}
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
            <Col title="Bokföringstransaktioner" rows={bokVis} sel={selBok} onToggle={toggle(setSelBok)} side="bok" showVer
              sugg={suggBok} pendNo={pending?.bokNo} pendGroup={pending?.group ? pending.bokIds : null} />
            <Col title="Inlästa transaktioner" rows={bankVis} sel={selBank} onToggle={toggle(setSelBank)} side="bank"
              sugg={suggBank} pendNo={pending?.bankNo} pendGroup={pending?.group ? pending.bankIds : null} />
          </div>
          {pending ? (
            <div className="flex justify-end items-center gap-3 mt-4">
              <span className="text-sm text-gray-600">
                {pending.group
                  ? `Gruppmatchning av ${pending.bokIds.size + pending.bankIds.size} markerade poster – granska och spara`
                  : `${pending.pairs.length} unika matchningar (P1–P${pending.pairs.length}) – granska paren och spara`}
              </span>
              <button className="btn" onClick={() => setPending(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-green px-6" onClick={sparaAvstamning} disabled={saving}>
                {saving ? 'Sparar…' : 'Spara'}
              </button>
            </div>
          ) : (
            <div className="flex justify-end mt-4">
              <button className="btn btn-green px-6" onClick={matchaTransaktioner} disabled={loading || saving}>
                Matcha transaktioner{possiblePairs.length ? ` (${possiblePairs.length})` : ''}
              </button>
            </div>
          )}
          <div className="text-xs text-gray-400 mt-3">
            <b>Matcha transaktioner</b> parar ihop poster med samma belopp (datum inom 7 dagar) – varje post ingår i högst EN matchning, parade poster blåmarkeras med parnummer. Granska och klicka <b>Spara</b> för att godkänna avstämningen, eller <b>Avbryt</b>. Markera poster manuellt på båda sidor för att begränsa matchningen eller gruppmatcha lika summor. Avstämda poster blir gröna; klicka den gröna bocken för att ångra. Banktransaktioner läses in under <b>Kassa och bank → Klistra in kontoutdrag</b>.
          </div>
        </>
      )}
    </div>
  )
}
