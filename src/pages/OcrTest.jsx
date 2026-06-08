// [FOLIO_OCR_EXPERIMENTAL_PROVIDER] – Admin-testverktyg (krav 12/13).
// Kör befintlig Gemini-tolkning och (om aktiverad) Folio-OCR mot SAMMA dokument och visar
// resultat sida-vid-sida: processtid, extraherade fält, confidence, om fallback användes samt
// Folio-tjänstens health-status. Ändrar INGET i produktion – Gemini-flödet är oförändrat.
// Gated: operations_admin/superadmin.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { tolkaDocument } from '../lib/tolka'
import toast from 'react-hot-toast'

const Card = ({ title, icon, tone = 'gray', children }) => (
  <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
    <div className={`text-sm font-medium mb-2 flex items-center gap-1.5 ${tone === 'purple' ? 'text-purple-700' : 'text-gray-700'}`}>
      {icon && <i className={`ti ${icon}`} />}{title}
    </div>
    {children}
  </div>
)
const Row = ({ k, v }) => (
  <div className="flex justify-between gap-3 py-1 border-b border-gray-50 text-sm">
    <span className="text-gray-500">{k}</span>
    <span className="text-gray-900 font-medium text-right break-words">{v ?? <span className="text-gray-300">—</span>}</span>
  </div>
)
const ms = (n) => (typeof n === 'number' ? `${n} ms` : '—')

export default function OcrTest() {
  const { company, platformAccess } = useAuth()
  const canView = !!platformAccess?.canViewOperations
  const [docs, setDocs] = useState([])
  const [docId, setDocId] = useState('')
  const [running, setRunning] = useState(false)
  const [gemini, setGemini] = useState(null)   // { ok, ms, fields, error }
  const [folio, setFolio] = useState(null)      // { available, result, error, ms }
  const [health, setHealth] = useState(null)

  useEffect(() => { if (canView && company?.id) loadDocs() }, [canView, company?.id])
  async function loadDocs() {
    const { data } = await supabase.from('documents')
      .select('id, file_name, created_at, status, mime_type')
      .eq('company_id', company.id).not('storage_path', 'is', null)
      .order('created_at', { ascending: false }).limit(40)
    setDocs(data || [])
    if (data?.length && !docId) setDocId(data[0].id)
  }

  async function runGemini() {
    const t0 = performance.now()
    try {
      const res = await tolkaDocument(docId)
      return { ok: true, ms: Math.round(performance.now() - t0), fields: res }
    } catch (e) {
      return { ok: false, ms: Math.round(performance.now() - t0), error: e?.message || 'fel' }
    }
  }
  async function runFolio() {
    const t0 = performance.now()
    const { data, error } = await supabase.functions.invoke('ocr-folio', { body: { document_id: docId } })
    const elapsed = Math.round(performance.now() - t0)
    if (error) return { available: true, error: error.message, ms: elapsed }
    return { ...data, ms: elapsed }
  }

  async function runBoth() {
    if (!docId) return toast.error('Välj ett dokument')
    setRunning(true); setGemini(null); setFolio(null)
    const [g, f] = await Promise.allSettled([runGemini(), runFolio()])
    setGemini(g.status === 'fulfilled' ? g.value : { ok: false, error: String(g.reason) })
    setFolio(f.status === 'fulfilled' ? f.value : { available: true, error: String(f.reason) })
    setRunning(false)
  }
  async function checkHealth() {
    setHealth({ loading: true })
    const { data, error } = await supabase.functions.invoke('ocr-folio', { body: { healthCheck: true } })
    setHealth(error ? { error: error.message } : data)
  }

  if (!canView) return (
    <div className="p-12 text-center">
      <i className="ti ti-lock text-4xl text-gray-300 block mb-3" />
      <div className="text-gray-600 font-medium">Ingen åtkomst</div>
      <div className="text-sm text-gray-400 mt-1">OCR-test kräver rollen <b>operations_admin</b> eller <b>superadmin</b>.</div>
    </div>
  )

  const fr = folio?.result
  const folioUnavailable = folio && folio.available === false

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2">
          <i className="ti ti-scan text-purple-600" /> OCR-test (Gemini vs Folio)
        </span>
        <button onClick={checkHealth} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5">
          <i className="ti ti-heartbeat" /> Folio health
        </button>
      </div>

      <div className="p-7 space-y-5 max-w-5xl">
        {health && (
          <div className={`rounded-lg px-4 py-2 text-sm ${health.loading ? 'bg-gray-50 text-gray-500' : health.error || health.healthy === false ? 'bg-red-50 text-red-700' : health.available === false ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
            {health.loading ? 'Kontrollerar Folio…'
              : health.error ? `Health-fel: ${health.error}`
              : health.available === false ? `Folio är inaktiverad (${health.reason || 'disabled'}). Aktivera med ENABLE_FOLIO_OCR + FOLIO_OCR_BASE_URL.`
              : health.healthy ? `Folio är tillgänglig (svarstid ${ms(health.latencyMs)}).`
              : 'Folio svarar inte (unreachable).'}
          </div>
        )}

        <div className="flex items-end gap-3">
          <label className="flex-1">
            <div className="text-xs text-gray-500 mb-1">Dokument (senaste 40 med fil)</div>
            <select value={docId} onChange={e => setDocId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {docs.length === 0 && <option value="">Inga dokument</option>}
              {docs.map(d => (
                <option key={d.id} value={d.id}>{d.file_name || d.id} · {new Date(d.created_at).toLocaleDateString('sv-SE')} · {d.status || '—'}</option>
              ))}
            </select>
          </label>
          <button onClick={runBoth} disabled={running || !docId}
            className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
            {running ? <><i className="ti ti-loader animate-spin" /> Kör…</> : <><i className="ti ti-player-play" /> Kör båda</>}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Gemini (produktion) */}
          <Card title="Gemini (produktion)" icon="ti-sparkles">
            {!gemini ? <div className="text-sm text-gray-400">Ej körd än.</div> : gemini.ok ? (
              <div>
                <Row k="Status" v={<span className="text-green-600">OK</span>} />
                <Row k="Processtid" v={ms(gemini.ms)} />
                <Row k="Typ" v={gemini.fields?.typ || gemini.fields?.kategori} />
                <Row k="Leverantör" v={gemini.fields?.leverantor || gemini.fields?.motpart} />
                <Row k="Belopp" v={gemini.fields?.belopp ?? gemini.fields?.summa} />
                <Row k="Datum" v={gemini.fields?.datum} />
                <details className="mt-2"><summary className="text-xs text-gray-400 cursor-pointer">Rådata (fält)</summary>
                  <pre className="text-[11px] bg-gray-50 rounded p-2 mt-1 overflow-auto max-h-60">{JSON.stringify(gemini.fields, null, 2)}</pre>
                </details>
              </div>
            ) : <div className="text-sm text-red-600">Fel: {gemini.error}</div>}
          </Card>

          {/* Folio (experimentell) */}
          <Card title="Folio-OCR (experimentell)" icon="ti-flask" tone="purple">
            {!folio ? <div className="text-sm text-gray-400">Ej körd än.</div>
              : folioUnavailable ? (
                <div className="text-sm text-amber-600">Inaktiverad ({folio.reason || 'disabled'}). Detta påverkar inte produktionen.</div>
              ) : folio.error || !fr ? (
                <div className="text-sm text-red-600">
                  {folio.error === 'timeout' || folio.error === 'folio_error' ? `Folio misslyckades (${folio.error}).` : `Fel: ${folio.error || 'inget resultat'}`}
                  <div className="text-xs text-gray-400 mt-1">I produktion skulle fallback till Gemini ske (ENABLE_OCR_FALLBACK).</div>
                </div>
              ) : (
                <div>
                  <Row k="Status" v={<span className="text-green-600">OK</span>} />
                  <Row k="Processtid (Folio)" v={ms(fr.processingTimeMs)} />
                  <Row k="Total (inkl. nät)" v={ms(folio.ms)} />
                  <Row k="Confidence" v={fr.confidence != null ? `${Math.round(fr.confidence * 100)}%` : '—'} />
                  <Row k="Sidor" v={fr.pages?.length} />
                  <Row k="Layout-block" v={fr.layoutBlocks?.length} />
                  <Row k="Fallback använd" v={fr.fallbackUsed ? 'Ja' : 'Nej'} />
                  <details className="mt-2"><summary className="text-xs text-gray-400 cursor-pointer">Råtext</summary>
                    <pre className="text-[11px] bg-gray-50 rounded p-2 mt-1 overflow-auto max-h-60 whitespace-pre-wrap">{fr.rawText || '(tom)'}</pre>
                  </details>
                </div>
              )}
          </Card>
        </div>

        {gemini && folio && (
          <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
            <i className="ti ti-info-circle mr-1" />
            Jämförelse: Gemini {gemini.ok ? `(${ms(gemini.ms)})` : '(fel)'} vs Folio {fr ? `(${ms(fr.processingTimeMs)})` : folioUnavailable ? '(av)' : '(fel)'}.
            Folio är ett valfritt sekundärt verktyg – det ersätter inte Gemini-flödet.
          </div>
        )}
      </div>
    </div>
  )
}
