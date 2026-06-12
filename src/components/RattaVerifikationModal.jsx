import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { foreslaRattelsedatum, arLastDatum } from '../lib/rattelse'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Rättelse av verifikation (BFL): originalet visas som läsbar källa, användaren anger orsak och
// bokföringsdatum, och kedjan skapas server-side via RPC ratta_verifikation
// (original -> rättelseverifikation i serie R -> ersättningsverifikation).
// Ligger originalet i låst period föreslås första öppna datum och det förklaras tydligt.
export default function RattaVerifikationModal({ ver, company, onClose, onDone }) {
  const [rows, setRows] = useState([])
  const [orsak, setOrsak] = useState('')
  const forslag = foreslaRattelsedatum(ver.datum, company?.bokforing_last_tom)
  const [datum, setDatum] = useState(forslag.datum || ver.datum)
  const [saving, setSaving] = useState(false)
  const datumLast = arLastDatum(datum, company?.bokforing_last_tom)

  useEffect(() => {
    supabase.from('verifikation_rows').select('*').eq('verifikation_id', ver.id).order('sort_order')
      .then(({ data }) => setRows(data || []))
  }, [ver.id])

  async function submit() {
    if (!orsak.trim()) return toast.error('Ange en orsak till rättelsen')
    if (datumLast) return toast.error(`Datumet ligger i låst period (bokföringen är låst t.o.m. ${company.bokforing_last_tom}). Välj ett datum i öppen period.`)
    setSaving(true)
    const { data, error } = await supabase.rpc('ratta_verifikation', { p_ver_id: ver.id, p_orsak: orsak.trim(), p_datum: datum })
    setSaving(false)
    if (error) return toast.error('Kunde inte rätta: ' + error.message)
    onDone(data)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-[15px] font-bold tracking-tight">RÄTTA VERIFIKATION {ver.ver_nr}</span>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose} title="Stäng"><i className="ti ti-x" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-600">
            En <span className="font-semibold">rättelseverifikation</span> (serie R) skapas som vänder originalets rader,
            och därefter öppnas en <span className="font-semibold">ny verifikation</span> förifylld med originalets rader
            som du ändrar till korrekt kontering. Originalet bevaras oförändrat.
          </p>

          {forslag.lastPeriod && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <i className="ti ti-lock mr-1" /> Originalverifikationen ligger i låst period. Rättelsen bokförs i öppen period.
            </div>
          )}

          <div>
            <div className="text-[11px] text-gray-500 font-medium mb-1">Originalets rader ({ver.datum})</div>
            <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                    <th className="text-left px-3 py-2">Konto</th>
                    <th className="text-left px-3 py-2">Benämning</th>
                    <th className="text-right px-3 py-2">Debet</th>
                    <th className="text-right px-3 py-2">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                      <td className="px-3 py-1.5 font-medium">{r.account_nr}</td>
                      <td className="px-3 py-1.5">{r.account_name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.debet > 0 ? fmt(r.debet) : ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.kredit > 0 ? fmt(r.kredit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Orsak till rättelsen *</label>
            <input className="input w-full" value={orsak} onChange={e => setOrsak(e.target.value)}
              placeholder="T.ex. fel konto användes" maxLength={150} autoFocus />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bokföringsdatum för rättelsen</label>
            <input className="input" type="date" value={datum} onChange={e => setDatum(e.target.value)} />
            {datumLast && (
              <p className="text-xs text-red-600 mt-1">
                Datumet ligger i låst period (bokföringen är låst t.o.m. {company?.bokforing_last_tom}). Välj ett datum i öppen period.
              </p>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <button className="btn" onClick={onClose}>Avbryt</button>
          <button className="btn btn-primary" disabled={saving || datumLast || !orsak.trim()} onClick={submit}>
            {saving ? 'Skapar rättelse…' : 'Skapa rättelse'}
          </button>
        </div>
      </div>
    </div>
  )
}
