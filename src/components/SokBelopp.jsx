import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const toAmt = s => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n }

export default function SokBelopp() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const yr = new Date().getFullYear()
  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(true)
  const [searched, setSearched] = useState(false)

  const [beloppFrom, setBeloppFrom] = useState('')
  const [beloppTom, setBeloppTom] = useState('')
  const [serie, setSerie] = useState('Alla')
  const [from, setFrom] = useState(`${yr}-01-01`)
  const [tom, setTom] = useState(`${yr}-12-31`)
  const [konto, setKonto] = useState('')
  const [result, setResult] = useState([])

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('verifikation_rows')
      .select('id, account_nr, account_name, debet, kredit, transaktionsinfo, verifikationer!inner(id, company_id, datum, ver_nr, beskrivning, ver_serie)')
      .eq('verifikationer.company_id', company.id)
    setAllRows((data || []).map(r => ({
      id: r.id, verId: r.verifikationer.id, verNr: r.verifikationer.ver_nr, serie: r.verifikationer.ver_serie || '',
      datum: r.verifikationer.datum, besk: r.verifikationer.beskrivning, konto: r.account_nr, kontoNamn: r.account_name || '',
      info: r.transaktionsinfo || '', debet: r.debet || 0, kredit: r.kredit || 0,
    })))
    setLoading(false)
  }

  const series = useMemo(() => ['Alla', ...[...new Set(allRows.map(r => r.serie[0]).filter(Boolean))].sort()], [allRows])

  function sok() {
    const bf = toAmt(beloppFrom), bt = toAmt(beloppTom)
    const k = konto.trim()
    const res = allRows.filter(r => {
      if (serie !== 'Alla' && r.serie[0] !== serie) return false
      if (from && r.datum < from) return false
      if (tom && r.datum > tom) return false
      if (k && !String(r.konto || '').startsWith(k)) return false
      const belopp = r.debet || r.kredit
      if (bf != null && belopp < bf) return false
      if (bt != null && belopp > bt) return false
      return true
    }).sort((a, b) => a.datum.localeCompare(b.datum) || a.verNr.localeCompare(b.verNr, 'sv'))
    setResult(res)
    setSearched(true)
  }

  function rensa() {
    setBeloppFrom(''); setBeloppTom(''); setSerie('Alla'); setFrom(`${yr}-01-01`); setTom(`${yr}-12-31`); setKonto('')
    setResult([]); setSearched(false)
  }

  const sumDebet = result.reduce((s, r) => s + r.debet, 0)
  const sumKredit = result.reduce((s, r) => s + r.kredit, 0)

  return (
    <div>
      {/* Rubrik + belopp-intervall */}
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <span className="text-[15px] font-bold tracking-tight">SÖK BELOPP</span>
        <input className="input w-44" placeholder="Belopp, från" inputMode="decimal" value={beloppFrom}
          onChange={e => setBeloppFrom(e.target.value)} onKeyDown={e => e.key === 'Enter' && sok()} />
        <input className="input w-44" placeholder="Belopp, till" inputMode="decimal" value={beloppTom}
          onChange={e => setBeloppTom(e.target.value)} onKeyDown={e => e.key === 'Enter' && sok()} />
        <button className="text-sm text-blue-700 hover:underline" onClick={() => setAdvanced(a => !a)}>
          {advanced ? 'Stäng utökad sökning' : 'Utökad sökning'}
        </button>
      </div>

      {advanced && (
        <>
          <div className="flex justify-end mb-2">
            <button className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1.5 no-print" onClick={() => window.print()}>
              <i className="ti ti-printer" /> Skriv ut lista
            </button>
          </div>
          <div className="grid grid-cols-4 gap-4 items-end mb-1">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Verifikationsserie</label>
              <select className="input" value={serie} onChange={e => setSerie(e.target.value)}>
                {series.map(s => <option key={s} value={s}>{s === 'Alla' ? 'Alla' : `${s} – serie`}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Datum fr.o.m.</label>
              <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Datum t.o.m.</label>
              <input className="input" type="date" value={tom} onChange={e => setTom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Konto</label>
              <input className="input" placeholder="t.ex. 1930 eller 19" value={konto}
                onChange={e => setKonto(e.target.value)} onKeyDown={e => e.key === 'Enter' && sok()} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mb-5 no-print">
            <button className="btn" onClick={rensa}>Rensa</button>
            <button className="btn btn-primary px-6" onClick={sok}>Sök</button>
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3 mb-2 text-sm text-gray-500">
        {searched && <span>{result.length} rader</span>}
      </div>

      <div id="printable" className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Verifikationsnr</th>
              <th className="text-left px-4 py-2.5 border-b w-36" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokföringsdatum</th>
              <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
              <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
              <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Transaktionsinfo</th>
              <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Debet</th>
              <th className="text-right px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kredit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="text-center py-12 text-gray-400">Laddar…</td></tr>
            ) : !searched ? (
              <tr><td colSpan="7" className="text-center py-14 text-gray-400">
                <i className="ti ti-search text-3xl block mb-2 opacity-30" />
                Ange ett belopp­intervall och klicka <b>Sök</b>
              </td></tr>
            ) : result.length === 0 ? (
              <tr><td colSpan="7" className="text-center py-14 text-gray-400">
                <i className="ti ti-file-off text-3xl block mb-2 opacity-30" />
                Inga rader matchade sökningen
              </td></tr>
            ) : result.map(r => (
              <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/bokforing/${r.verId}`)}>
                <td className="px-4 py-2.5 border-b font-medium text-blue-700" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.verNr}</td>
                <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.datum}</td>
                <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.besk}</td>
                <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.konto}{r.kontoNamn ? ` – ${r.kontoNamn}` : ''}</td>
                <td className="px-4 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.info}</td>
                <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.debet ? fmt(r.debet) : ''}</td>
                <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.kredit ? fmt(r.kredit) : ''}</td>
              </tr>
            ))}
            {searched && result.length > 0 && (
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2.5" colSpan="5">Summa</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sumDebet)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sumKredit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
