import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { serie } from '../lib/serier'

const MONTHS = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December']
const r0 = n => Math.round(Number(n) || 0)
const fmtInt = n => r0(n).toLocaleString('sv-SE')
const toAmt = s => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const lastDay = (y, mi) => new Date(y, mi + 1, 0).getDate()

const NAMES = {
  '2611': 'Utgående moms 25 %', '2621': 'Utgående moms 12 %', '2631': 'Utgående moms 6 %',
  '2640': 'Ingående moms', '2650': 'Redovisningskonto för moms',
}

export default function Moms() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [bankUnbooked, setBankUnbooked] = useState(0)
  const [years, setYears] = useState([])
  const [period, setPeriod] = useState('')
  const [edits, setEdits] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: r }, { data: fy }, { data: btx }] = await Promise.all([
      supabase.from('verifikation_rows')
        .select('account_nr, account_name, debet, kredit, verifikationer!inner(company_id, datum)')
        .eq('verifikationer.company_id', company.id),
      supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false }),
      supabase.from('bank_transactions').select('datum, avstamd').eq('company_id', company.id),
    ])
    setRows(r || [])
    setYears(fy || [])
    setBankUnbooked((btx || []).filter(t => !t.avstamd).length)
    setLoading(false)
  }

  // Bygg månadsperioder utifrån räkenskapsår (annars innevarande kalenderår).
  const periods = useMemo(() => {
    const out = []
    const add = (y, mi) => out.push({ value: `${y}-${String(mi + 1).padStart(2, '0')}`, label: `${MONTHS[mi]} ${y}`, start: `${y}-${String(mi + 1).padStart(2, '0')}-01`, end: `${y}-${String(mi + 1).padStart(2, '0')}-${String(lastDay(y, mi)).padStart(2, '0')}` })
    if (years.length) {
      years.forEach(fy => {
        let d = new Date(fy.start_date), end = new Date(fy.end_date)
        while (d <= end) { add(d.getFullYear(), d.getMonth()); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) }
      })
    } else {
      const y = new Date().getFullYear()
      for (let m = 0; m < 12; m++) add(y, m)
    }
    return out
  }, [years])

  // Förvald: senaste perioden som har bokförda rader, annars senaste.
  useEffect(() => {
    if (!period && periods.length) {
      const withData = [...periods].reverse().find(p => rows.some(r => r.verifikationer.datum >= p.start && r.verifikationer.datum <= p.end))
      setPeriod((withData || periods[periods.length - 1])?.value || '')
    }
  }, [periods, rows])

  const sel = periods.find(p => p.value === period)

  // Saldon per konto i perioden.
  const accounts = useMemo(() => {
    if (!sel) return []
    const by = {}
    rows.filter(r => r.verifikationer.datum >= sel.start && r.verifikationer.datum <= sel.end).forEach(r => {
      const k = r.account_nr
      if (!by[k]) by[k] = { nr: k, name: r.account_name || k, debet: 0, kredit: 0 }
      by[k].debet += r.debet || 0; by[k].kredit += r.kredit || 0
    })
    return Object.values(by)
  }, [rows, sel])

  const sumBy = (prefixes, dir) => accounts.filter(a => prefixes.some(p => a.nr.startsWith(p)))
    .reduce((s, a) => s + (dir === 'k' ? a.kredit - a.debet : a.debet - a.kredit), 0)

  // Beräknade rutvärden från bokföringen.
  const computed = useMemo(() => {
    const utg25 = sumBy(['261'], 'k'), utg12 = sumBy(['262'], 'k'), utg6 = sumBy(['263'], 'k')
    const ing = sumBy(['264'], 'd')
    const momsfri = sumBy(['3004'], 'k')
    const c = {}
    ;['06', '07', '08', '20', '21', '22', '23', '24', '30', '31', '32', '35', '36', '37', '38', '39', '40', '41', '50', '60', '61', '62'].forEach(b => c[b] = 0)
    c['05'] = (utg25 ? utg25 / 0.25 : 0) + (utg12 ? utg12 / 0.12 : 0) + (utg6 ? utg6 / 0.06 : 0)
    c['10'] = utg25; c['11'] = utg12; c['12'] = utg6
    c['42'] = momsfri
    c['48'] = ing
    return c
  }, [accounts])

  // Effektivt värde (manuell override > beräknat).
  const v = b => (edits[b] !== undefined ? toAmt(edits[b]) : r0(computed[b] || 0))
  const box49 = ['10', '11', '12', '30', '31', '32', '60', '61', '62'].reduce((s, b) => s + v(b), 0) - v('48')

  useEffect(() => { setEdits({}) }, [period])

  async function bokfor() {
    if (!sel) return
    // Nollställ momskontona i perioden och bokför nettot mot 2650.
    const utg = accounts.filter(a => /^26[123]/.test(a.nr)).map(a => ({ ...a, bal: a.kredit - a.debet })).filter(a => Math.abs(a.bal) > 0.005)
    const ing = accounts.filter(a => a.nr.startsWith('264')).map(a => ({ ...a, bal: a.debet - a.kredit })).filter(a => Math.abs(a.bal) > 0.005)
    if (!utg.length && !ing.length) return toast.error('Inga momsbelopp att redovisa i perioden')

    const verRows = []
    utg.forEach(a => verRows.push({ nr: a.nr, name: a.name, debet: r0(a.bal > 0 ? a.bal : 0), kredit: r0(a.bal < 0 ? -a.bal : 0) }))
    ing.forEach(a => verRows.push({ nr: a.nr, name: a.name, debet: r0(a.bal < 0 ? -a.bal : 0), kredit: r0(a.bal > 0 ? a.bal : 0) }))
    const totUtg = utg.reduce((s, a) => s + a.bal, 0)
    const totIng = ing.reduce((s, a) => s + a.bal, 0)
    const betala = r0(totUtg - totIng)
    if (betala > 0) verRows.push({ nr: '2650', name: NAMES['2650'], debet: 0, kredit: betala })
    else if (betala < 0) verRows.push({ nr: '2650', name: NAMES['2650'], debet: -betala, kredit: 0 })

    const totalDebet = verRows.reduce((s, r) => s + r.debet, 0)
    const totalKredit = verRows.reduce((s, r) => s + r.kredit, 0)

    setSaving(true)
    try {
      const ser = serie(company, 'moms')
      const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: ser })
      const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
        company_id: company.id, ver_nr: nr || 'M' + Date.now(), ver_serie: ser,
        datum: sel.end, beskrivning: `Momsredovisning ${sel.label}`,
        kommentar: `Ruta 49: ${betala >= 0 ? 'att betala' : 'att återfå'} ${fmtInt(Math.abs(betala))} kr`,
        total_debet: totalDebet, total_kredit: totalKredit, created_by: user.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('verifikation_rows').insert(verRows.map((r, i) => ({
        verifikation_id: ver.id, account_nr: r.nr, account_name: NAMES[r.nr] || r.name || '', debet: r.debet, kredit: r.kredit, sort_order: i,
      })))
      if (e2) throw e2
      const used = [...new Set(verRows.map(r => r.nr))]
      await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', used).eq('is_active', false)
      toast.success(`Momsredovisning ${ver.ver_nr} bokförd!`)
      navigate(`/bokforing/${ver.id}`)
    } catch (err) { toast.error('Fel: ' + err.message) }
    setSaving(false)
  }

  // En ruta: etikett, rutnummer, värde (input).
  const Box = ({ num, label, locked }) => (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 min-w-0 text-sm text-gray-700 leading-snug">{label}</span>
      <span className="text-[11px] text-gray-400 w-5 text-right tabular-nums shrink-0">{num}</span>
      <div className="w-40 shrink-0">
        <input
          className="input text-right tabular-nums bg-gray-50"
          value={edits[num] !== undefined ? edits[num] : fmtInt(computed[num] || 0)}
          readOnly={locked}
          onChange={e => !locked && setEdits(p => ({ ...p, [num]: e.target.value }))}
          onBlur={e => !locked && setEdits(p => ({ ...p, [num]: String(r0(toAmt(e.target.value))) }))}
        />
      </div>
      <i className="ti ti-file-text text-gray-300 shrink-0" />
    </div>
  )
  const Section = ({ title, children }) => (
    <div className="mb-7">
      <div className="text-[15px] font-medium mb-1.5">{title}</div>
      <div className="divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>{children}</div>
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Ny momsredovisning</span>
        <div className="flex items-center gap-2.5">
          <button className="btn" onClick={() => setEdits({})} disabled={saving}>Återställ</button>
          <button className="btn btn-primary px-6" onClick={bokfor} disabled={saving || loading}>{saving ? 'Bokför…' : 'Bokför'}</button>
        </div>
      </div>

      <div className="p-7">
        <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <div className="flex items-center gap-4 mb-5 max-w-2xl">
            <label className="text-sm text-gray-600 w-28">Momsperiod</label>
            <select className="input flex-1" value={period} onChange={e => setPeriod(e.target.value)}>
              {periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {bankUnbooked > 0 && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-sm text-amber-800">
              <i className="ti ti-alert-triangle text-amber-500 mt-0.5" />
              <span>Det finns <Link to="/kassa-bank" className="underline font-medium">ej bokförda händelser</Link> under <b>Kassa- och bankhändelser</b>. Vi rekommenderar att du bokför dem innan du skapar momsredovisningen.</span>
            </div>
          )}

          {loading ? <div className="text-gray-400 py-12 text-center">Laddar…</div> : (
            <div className="grid grid-cols-2 gap-x-16">
              {/* Vänster kolumn */}
              <div>
                <Section title="A. Momspliktig försäljning eller uttag exklusive moms">
                  <Box num="05" label="Momspliktig försäljning som ej ingår i annan ruta" />
                  <Box num="06" label="Momspliktiga uttag" />
                  <Box num="07" label="Besk.underlag vid vinstmarginalbeskattning" />
                  <Box num="08" label="Hyresintäkter vid frivillig betalningsskyldighet" />
                </Section>
                <Section title="C. Momspliktiga inköp vid omvänd skattskyldighet">
                  <Box num="20" label="Inköp av varor från annat EU-land" />
                  <Box num="21" label="Inköp av tjänster från ett annat EU-land enligt huvudregeln" />
                  <Box num="22" label="Inköp av tjänster från land utanför EU" />
                  <Box num="23" label="Inköp av varor i Sverige" />
                  <Box num="24" label="Inköp av tjänster i Sverige" />
                </Section>
                <Section title="H. Import">
                  <Box num="50" label="Beskattningsunderlag vid import" />
                </Section>
                <Section title="E. Försäljning m.m. som är undantagen från moms">
                  <Box num="35" label="Försäljning av varor till annat EU-land" />
                  <Box num="36" label="Försäljning av varor utanför EU" />
                  <Box num="37" label="Mellanmans inköp av varor vid trepartshandel" />
                  <Box num="38" label="Mellanmans försäljning av varor vid trepartshandel" />
                  <Box num="39" label="Försäljning av tjänster till näringsidkare i ett annat EU-land enligt huvudregeln" />
                  <Box num="40" label="Övrig försäljning av tjänster omsatta utom landet" />
                  <Box num="41" label="Försäljning när köparen är skattskyldig i Sverige" />
                  <Box num="42" label="Övrig momsfri försäljning m m" />
                </Section>
              </div>

              {/* Höger kolumn */}
              <div>
                <Section title="B. Utgående moms på försäljning eller uttag i ruta 05-08">
                  <Box num="10" label="Utgående moms 25%" />
                  <Box num="11" label="Utgående moms 12%" />
                  <Box num="12" label="Utgående moms 6%" />
                </Section>
                <Section title="D. Utgående moms på inköp i ruta 20-24">
                  <Box num="30" label="Utgående moms 25%" />
                  <Box num="31" label="Utgående moms 12%" />
                  <Box num="32" label="Utgående moms 6%" />
                </Section>
                <Section title="I. Utgående moms på import i ruta 50">
                  <Box num="60" label="Utgående moms 25%" />
                  <Box num="61" label="Utgående moms 12%" />
                  <Box num="62" label="Utgående moms 6%" />
                </Section>
                <Section title="F. Ingående moms">
                  <Box num="48" label="Ingående moms att dra av" />
                </Section>
                <div className="mb-7">
                  <div className="text-[15px] font-medium mb-1.5">G. Moms att betala eller få tillbaka</div>
                  <div className="flex items-center gap-2 py-1.5">
                    <span className="flex-1 min-w-0 text-sm text-gray-700 leading-snug">{box49 >= 0 ? 'Moms att betala' : 'Moms att få tillbaka'}</span>
                    <span className="text-[11px] text-gray-400 w-5 text-right tabular-nums shrink-0">49</span>
                    <div className="w-40 shrink-0"><input className="input text-right tabular-nums bg-gray-50 font-semibold" value={fmtInt(Math.abs(box49))} readOnly /></div>
                    <i className="ti ti-file-text text-gray-300 shrink-0" />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="text-xs text-gray-400 mt-2 max-w-3xl">
            Rutorna beräknas automatiskt från bokföringen i vald period (utgående moms 2611/2621/2631, ingående moms 2640). Du kan justera ett fält manuellt vid behov. <b>Bokför</b> nollställer periodens momskonton och bokför nettot (ruta 49) mot 2650 – Redovisningskonto för moms.
          </div>
        </div>
      </div>
    </div>
  )
}
