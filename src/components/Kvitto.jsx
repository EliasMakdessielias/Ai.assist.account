import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { serie } from '../lib/serier'
import { bestRuleFor, findMatchingRule, ruleConfidence, ruleKeyword, normalizeMerchant, RULE_AUTOFILL } from '../lib/supplierRules'

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

export default function Kvitto({ underlagDoc, onUnderlagLinked }) {
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
  const [butik, setButik] = useState('')          // butik/säljare – nyckel för kvittoregler
  const [accounts, setAccounts] = useState([])
  const [kontoMap, setKontoMap] = useState({})     // kostnadstyp (label) → valt konto (override av mallens)
  const [rules, setRules] = useState([])           // inlärda regler för butiken
  const [rulesOpen, setRulesOpen] = useState(false)
  const applRef = useRef({})                        // label → tillämpad regel (ändringsdetektion)

  const mall = TEMPLATES[mallKey]
  const accMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.account_nr, a.name])), [accounts])
  const kontoFor = r => kontoMap[r.label] || r.konto

  useEffect(() => {
    if (!company) return
    supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).eq('is_active', true)
      .then(({ data }) => setAccounts((data || []).slice().sort((a, b) => String(a.account_nr).localeCompare(String(b.account_nr)))))
  }, [company?.id])

  // Hämta butikens inlärda regler (debounce) och auto-fyll konto per kostnadstyp vid hög confidence.
  useEffect(() => {
    const key = normalizeMerchant(butik)
    if (!company || key.length < 2) { setRules([]); applRef.current = {}; return }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabase.from('supplier_accounting_rules')
        .select('*').eq('company_id', company.id).eq('merchant_name', key)
      if (cancelled) return
      const list = (data || []).slice().sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0))
      setRules(list)
      const appl = {}
      setKontoMap(prev => {
        const next = { ...prev }
        for (const r of mall.rader) {
          const best = bestRuleFor(list, { invoiceCategory: 'kvitto', keyword: r.label })
          if (best && (best.confidence_score || 0) >= RULE_AUTOFILL && !prev[r.label]) { next[r.label] = best.account_number; appl[r.label] = best }
        }
        return next
      })
      applRef.current = appl
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [company?.id, butik, mallKey])

  // Föreslagna konton per kostnadstyp för aktuell butik (för badge).
  const kvForslag = useMemo(() => {
    if (!rules.length) return null
    const list = mall.rader.map(r => ({ label: r.label, rule: bestRuleFor(rules, { invoiceCategory: 'kvitto', keyword: r.label }) })).filter(x => x.rule)
    return list.length ? list : null
  }, [rules, mallKey])

  async function toggleRule(r) {
    const status = r.status === 'disabled' ? 'active' : 'disabled'
    await supabase.from('supplier_accounting_rules').update({ status, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', r.id)
    setRules(rs => rs.map(x => x.id === r.id ? { ...x, status } : x))
  }
  async function deleteRule(r) {
    if (!window.confirm(`Radera den inlärda regeln ${r.account_number} för denna butik?`)) return
    await supabase.from('supplier_accounting_rules').delete().eq('id', r.id)
    setRules(rs => rs.filter(x => x.id !== r.id))
  }

  // Analysera kvittots slutliga kontering → spara/uppdatera regler per butik (best-effort).
  async function larKvittoRegler() {
    const key = normalizeMerchant(butik)
    if (!key || key.length < 2) return
    for (const r of mall.rader) {
      if (num(costs[r.label]) <= 0.001) continue
      const konto = kontoFor(r)
      const kw = ruleKeyword(r.label)
      const appl = applRef.current[r.label]
      if (appl && String(appl.account_number) !== String(konto)) {
        const cc = (appl.correction_count || 0) + 1
        await supabase.from('supplier_accounting_rules').update({
          correction_count: cc, confidence_score: ruleConfidence({ confirmation_count: appl.confirmation_count, correction_count: cc }),
          updated_by: user.id, updated_at: new Date().toISOString(),
        }).eq('id', appl.id)
        if (!window.confirm(`Du ändrade kontot för "${r.label}" från ${appl.account_number} till ${konto}. Spara ${konto} som ny regel för framtida kvitton från ${butik.trim()}?`)) continue
      }
      const match = findMatchingRule(rules, { invoice_category: 'kvitto', line_keyword: kw, account_number: konto })
      if (match) {
        const cnt = (match.confirmation_count || 0) + 1
        await supabase.from('supplier_accounting_rules').update({
          confirmation_count: cnt, confidence_score: ruleConfidence({ confirmation_count: cnt, correction_count: match.correction_count }),
          account_name: accMap[konto] || r.label, vat_account: '2640', vat_rate: r.sats, status: 'active', updated_by: user.id, updated_at: new Date().toISOString(),
        }).eq('id', match.id)
      } else {
        await supabase.from('supplier_accounting_rules').insert({
          company_id: company.id, supplier_id: null, merchant_name: key, supplier_name: butik.trim() || null,
          document_type: 'kvitto', invoice_category: 'kvitto', line_keyword: kw, account_number: konto, account_name: accMap[konto] || r.label,
          vat_account: '2640', vat_rate: r.sats, belopp_type: 'kostnad',
          confirmation_count: 1, correction_count: 0, confidence_score: ruleConfidence({ confirmation_count: 1 }), status: 'active',
          created_by: user.id, updated_by: user.id,
        })
      }
    }
  }

  function bytMall(k) {
    setMallKey(k); setCosts({}); setKontant(''); setKort(''); setBeskrivning(TEMPLATES[k].besk); setKontoMap({}); applRef.current = {}
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
    mall.rader.forEach(r => { const { net } = split(r); if (net > 0.001) netByKonto[kontoFor(r)] = (netByKonto[kontoFor(r)] || 0) + net })
    const rows = []
    Object.entries(netByKonto).forEach(([nr, net]) => rows.push({ nr, debet: Math.round(net * 100) / 100, kredit: 0 }))
    if (momsTotal > 0.001) rows.push({ nr: '2640', debet: Math.round(momsTotal * 100) / 100, kredit: 0 })
    if (num(kontant) > 0.001) rows.push({ nr: '1910', debet: 0, kredit: num(kontant) })
    if (num(kort) > 0.001) rows.push({ nr: '1930', debet: 0, kredit: num(kort) })

    const totalDebet = rows.reduce((s, r) => s + r.debet, 0)
    const totalKredit = rows.reduce((s, r) => s + r.kredit, 0)
    setSaving(true)
    try {
      const ser = serie(company, 'kvitto')
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
      const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'K' + Date.now(), ver_serie: ser,
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
      if (underlagDoc?.id) {
        await supabase.from('documents').update({ verifikation_id: ver.id, kategori: 'kvitto' }).eq('id', underlagDoc.id).eq('company_id', company.id)
        onUnderlagLinked?.()
      }
      // Lärande regelmotor för kvitton (best-effort – får aldrig stoppa bokföringen).
      try { await larKvittoRegler() } catch { /* regelinlärning icke-kritisk */ }
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
          <label className="block text-xs font-medium text-gray-500 mb-1">Butik / säljare</label>
          <input id="kv-butik" className="input" value={butik} onChange={e => setButik(e.target.value)} placeholder="t.ex. Clas Ohlson"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusId('kv-beskrivning') } }} />
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

      <datalist id="kv-konton">
        {accounts.map(a => <option key={a.account_nr} value={a.account_nr}>{a.account_nr} – {a.name}</option>)}
      </datalist>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Kostnader inkl. moms</div>
          <div className="text-[11px] text-gray-400">Konto · belopp</div>
        </div>
        {kvForslag && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-2 text-[13px] text-blue-800 max-w-[470px]">
            <i className="ti ti-sparkles text-blue-500 mt-0.5 shrink-0" />
            <span>Konton föreslagna från tidigare kvitton för <b>{butik.trim()}</b>: {kvForslag.map((f, i) => (
              <span key={f.label}>{i > 0 ? ', ' : ''}{f.label} → {f.rule.account_number} ({f.rule.confirmation_count}×)</span>
            ))}.</span>
          </div>
        )}
        {mall.rader.map((r, i) => {
          const konto = kontoFor(r)
          const learnt = applRef.current[r.label]
          return (
            <div key={r.label} className="grid grid-cols-[170px_96px_160px] items-center gap-3 mb-2">
              <label className="text-sm text-gray-600 truncate" title={r.label}>{r.label}</label>
              <input className="input text-center tabular-nums" list="kv-konton" value={konto} title={accMap[konto] || ''}
                style={learnt && String(learnt.account_number) === String(konto) ? { borderColor: '#93c5fd', background: '#eff6ff' } : undefined}
                onChange={e => setKontoMap(m => ({ ...m, [r.label]: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) }))} />
              <input id={`kv-c${i}`} className="input text-right" inputMode="decimal" value={costs[r.label] ?? ''}
                onChange={e => setCosts(p => ({ ...p, [r.label]: e.target.value }))}
                onBlur={() => { const n = num(costs[r.label]); setCosts(p => ({ ...p, [r.label]: n > 0 ? fmt(n) : '' })) }}
                onKeyDown={i === mall.rader.length - 1 ? lastCostEnter : (e => handleEnter(e, `kv-c${i}`))} placeholder="0,00" />
            </div>
          )
        })}
        <div className="grid grid-cols-[170px_96px_160px] gap-3"><span /><span /><div className="text-right text-sm text-gray-500 pr-1">Moms: <b className="text-gray-800 tabular-nums">{fmt(momsTotal)}</b> · Tot: <b className="text-gray-800 tabular-nums">{fmt(costsGross)}</b></div></div>
      </div>

      <div className="grid grid-cols-[220px_220px] gap-3 items-center mb-5 pt-2 border-t max-w-[448px]" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-sm font-semibold">Differens</span>
        <div className="text-right text-base font-bold tabular-nums pr-1" style={{ color: balanced ? '#1a7a2e' : '#A32D2D' }}>{fmt(differens)}</div>
      </div>

      <div className="mb-6 max-w-xl">
        <label className="block text-xs font-medium text-gray-500 mb-1">Kommentar</label>
        <textarea className="input" rows={2} value={kommentar} onChange={e => setKommentar(e.target.value)} />
      </div>

      {rules.length > 0 && (
        <div className="mb-5 max-w-xl border-t pt-3" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          <button className="flex items-center gap-2 text-sm font-medium text-gray-700" onClick={() => setRulesOpen(o => !o)}>
            <i className={`ti ti-chevron-${rulesOpen ? 'down' : 'right'} text-green-700`} /> Inlärda konton för {butik.trim() || 'butiken'}
            <span className="ml-1 text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 rounded-full">{rules.length}</span>
          </button>
          {rulesOpen && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[13px] text-gray-500">Konton systemet lärt sig för denna butik. Inaktivera eller radera en felaktig regel.</p>
              {rules.map(r => (
                <div key={r.id} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${r.status === 'disabled' ? 'bg-gray-50 text-gray-400' : 'bg-white'}`} style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <span className="tabular-nums font-medium shrink-0">{r.account_number}</span>
                  <span className="text-gray-600 truncate flex-1">{accMap[r.account_number] || r.account_name || ''}{r.line_keyword ? ` · ${r.line_keyword}` : ''}</span>
                  <span className="text-xs text-gray-400 shrink-0">{r.confirmation_count}× · {Math.round((r.confidence_score || 0) * 100)}%</span>
                  <button className="text-xs text-gray-500 hover:text-gray-800 shrink-0" onClick={() => toggleRule(r)}>{r.status === 'disabled' ? 'Aktivera' : 'Inaktivera'}</button>
                  <button className="text-xs text-red-600 hover:text-red-800 shrink-0" onClick={() => deleteRule(r)}>Radera</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn" onClick={rensa} disabled={saving}>Rensa</button>
        <button id="kv-bokfor" className="btn btn-green px-6" onClick={bokfor} disabled={saving}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bokfor() } }}>{saving ? 'Bokför…' : 'Bokför'}</button>
      </div>
    </div>
  )
}
