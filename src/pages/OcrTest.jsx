// [FOLIO_OCR_EXPERIMENTAL_PROVIDER] – Admin-verktyg för OCR-providers (krav 4–13).
// Gemini = PRODUKTION (befintligt tolka-underlag/tolkaDocument-flöde, oförändrat).
// Folio-OCR = EXPERIMENTELL, valfri sekundär provider. Folio ersätter ALDRIG Gemini automatiskt
// och körs endast manuellt här. Separata knappar: "Tolka med Gemini", "Tolka med Folio", "Kör båda".
// Gated: operations_admin/superadmin. Folio-toggle (base URL + på/av): endast superadmin.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { tolkaDocument } from '../lib/tolka'
import { folioStatusMeta, folioRunOutcome, folioButtonDisabled } from '../lib/ocr/folioStatus'
import toast from 'react-hot-toast'

const TONE = {
  green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700', gray: 'bg-gray-100 text-gray-600',
}
const Card = ({ title, icon, tone = 'gray', badge, children }) => (
  <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
    <div className={`text-sm font-medium mb-2 flex items-center gap-1.5 ${tone === 'purple' ? 'text-purple-700' : 'text-gray-700'}`}>
      {icon && <i className={`ti ${icon}`} />}{title}
      {badge && <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase tracking-wide">{badge}</span>}
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
  const isSuper = !!platformAccess?.isSuperadmin
  const [docs, setDocs] = useState([])
  const [docId, setDocId] = useState('')
  const [gemini, setGemini] = useState(null)        // { ok, ms, fields, error }
  const [geminiBusy, setGeminiBusy] = useState(false)
  const [folio, setFolio] = useState(null)          // folioRunOutcome(...) + { ms }
  const [folioBusy, setFolioBusy] = useState(false)
  const [folioHealth, setFolioHealth] = useState(null)  // ocr-folio health-svar
  const [cfg, setCfg] = useState(null)              // { folioEnabled, folioBaseUrl }
  const [cfgDraft, setCfgDraft] = useState({ enabled: false, baseUrl: '' })
  const [savingCfg, setSavingCfg] = useState(false)

  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from('documents')
      .select('id, file_name, created_at, status')
      .eq('company_id', company.id).not('storage_path', 'is', null)
      .order('created_at', { ascending: false }).limit(40)
    setDocs(data || [])
    setDocId(prev => prev || data?.[0]?.id || '')
  }, [company?.id])

  const loadHealth = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('ocr-folio', { body: { healthCheck: true } })
    setFolioHealth(error ? { status: 'unavailable', error: error.message } : data)
  }, [])

  const loadConfig = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_ocr_provider_config')
    if (!error && data) { setCfg(data); setCfgDraft({ enabled: !!data.folioEnabled, baseUrl: data.folioBaseUrl || '' }) }
  }, [])

  useEffect(() => { if (canView && company?.id) { loadDocs(); loadHealth(); loadConfig() } }, [canView, company?.id, loadDocs, loadHealth, loadConfig])

  async function runGemini() {
    if (!docId) return toast.error('Välj ett dokument')
    setGeminiBusy(true); setGemini(null)
    const t0 = performance.now()
    try {
      const res = await tolkaDocument(docId)
      setGemini({ ok: true, ms: Math.round(performance.now() - t0), fields: res })
    } catch (e) {
      setGemini({ ok: false, ms: Math.round(performance.now() - t0), error: e?.message || 'fel' })
    } finally { setGeminiBusy(false) }
  }

  async function runFolio() {
    if (!docId) return toast.error('Välj ett dokument')
    setFolioBusy(true); setFolio(null)
    const t0 = performance.now()
    const { data, error } = await supabase.functions.invoke('ocr-folio', { body: { document_id: docId } })
    const elapsed = Math.round(performance.now() - t0)
    // Transportfel (t.ex. nät) -> behandla som service-fel, lugnt.
    const resp = error ? { available: false, status: 'unavailable', error: 'folio_error', result: null } : data
    const outcome = folioRunOutcome(resp)
    setFolio({ ...outcome, ms: elapsed, raw: resp })
    setFolioHealth(resp) // uppdatera health-panelen utifrån svaret
    setFolioBusy(false)
  }

  async function runBoth() {
    if (!docId) return toast.error('Välj ett dokument')
    await Promise.allSettled([runGemini(), runFolio()])
  }

  async function saveConfig() {
    setSavingCfg(true)
    const { data, error } = await supabase.rpc('set_ocr_provider_config', { p_enabled: cfgDraft.enabled, p_base_url: cfgDraft.baseUrl || null })
    setSavingCfg(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara')
    setCfg(data); toast.success('Folio-konfiguration sparad')
    loadHealth()
  }

  if (!canView) return (
    <div className="p-12 text-center">
      <i className="ti ti-lock text-4xl text-gray-300 block mb-3" />
      <div className="text-gray-600 font-medium">Ingen åtkomst</div>
      <div className="text-sm text-gray-400 mt-1">OCR-test kräver rollen <b>operations_admin</b> eller <b>superadmin</b>.</div>
    </div>
  )

  const fh = folioStatusMeta(folioHealth)
  const folioDisabled = folioButtonDisabled(fh.state)
  const fr = folio?.result

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2">
          <i className="ti ti-scan text-purple-600" /> OCR-providers
        </span>
        <button onClick={loadHealth} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5">
          <i className="ti ti-refresh" /> Uppdatera status
        </button>
      </div>

      <div className="p-7 space-y-5 max-w-5xl">
        {/* Provider-health (krav 8/10) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={`rounded-lg px-4 py-3 flex items-center gap-2 ${TONE.green}`}>
            <i className="ti ti-sparkles" />
            <span className="text-sm"><b>Gemini</b> · Produktion · tillgänglig</span>
          </div>
          <div className={`rounded-lg px-4 py-3 flex items-center gap-2 ${TONE[fh.tone]}`}>
            <i className="ti ti-flask" />
            <span className="text-sm"><b>Folio-OCR</b> · Experimentell · {fh.label}{typeof folioHealth?.latencyMs === 'number' ? ` (${ms(folioHealth.latencyMs)})` : ''}</span>
          </div>
        </div>

        {/* Dokumentval + knappar (krav 4) */}
        <div className="space-y-3">
          <label className="block">
            <div className="text-xs text-gray-500 mb-1">Dokument (senaste 40 med fil)</div>
            <select value={docId} onChange={e => setDocId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {docs.length === 0 && <option value="">Inga dokument</option>}
              {docs.map(d => (
                <option key={d.id} value={d.id}>{d.file_name || d.id} · {new Date(d.created_at).toLocaleDateString('sv-SE')} · {d.status || '—'}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={runGemini} disabled={geminiBusy || !docId}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
              {geminiBusy ? <><i className="ti ti-loader animate-spin" /> Kör…</> : <><i className="ti ti-sparkles" /> Tolka med Gemini</>}
            </button>
            <button onClick={runFolio} disabled={folioBusy || !docId || folioDisabled}
              title={folioDisabled ? fh.label : 'Kör endast Folio-OCR'}
              className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
              {folioBusy ? <><i className="ti ti-loader animate-spin" /> Kör…</> : <><i className="ti ti-flask" /> Tolka med Folio</>}
            </button>
            <button onClick={runBoth} disabled={geminiBusy || folioBusy || !docId}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5">
              <i className="ti ti-player-play" /> Kör båda
            </button>
            {folioDisabled && <span className="text-xs text-gray-400">{fh.label} – Folio körs inte.</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Gemini (produktion) */}
          <Card title="Gemini" icon="ti-sparkles" badge="Produktion">
            {geminiBusy ? <div className="text-sm text-gray-400 flex items-center gap-1.5"><i className="ti ti-loader animate-spin" /> Tolkar…</div>
              : !gemini ? <div className="text-sm text-gray-400">Ej körd än.</div>
              : gemini.ok ? (
                <div>
                  <Row k="Status" v={<span className="text-green-600">OK</span>} />
                  <Row k="Processtid" v={ms(gemini.ms)} />
                  <Row k="Typ" v={gemini.fields?.typ || gemini.fields?.kategori} />
                  <Row k="Leverantör" v={gemini.fields?.leverantor || gemini.fields?.motpart} />
                  <Row k="Belopp" v={gemini.fields?.belopp_inkl_moms ?? gemini.fields?.belopp ?? gemini.fields?.summa} />
                  <Row k="Datum" v={gemini.fields?.fakturadatum || gemini.fields?.datum} />
                  <details className="mt-2"><summary className="text-xs text-gray-400 cursor-pointer">Rådata (fält)</summary>
                    <pre className="text-[11px] bg-gray-50 rounded p-2 mt-1 overflow-auto max-h-60">{JSON.stringify(gemini.fields, null, 2)}</pre>
                  </details>
                </div>
              ) : <div className="text-sm text-red-600">Fel: {gemini.error}</div>}
          </Card>

          {/* Folio (experimentell) */}
          <Card title="Folio-OCR" icon="ti-flask" tone="purple" badge="Experimentell">
            {folioBusy ? <div className="text-sm text-gray-400 flex items-center gap-1.5"><i className="ti ti-loader animate-spin" /> Tolkar…</div>
              : !folio ? <div className="text-sm text-gray-400">Ej körd än.</div>
              : folio.kind === 'disabled' ? (
                <div className="text-sm text-gray-500">{folio.label}. Detta påverkar inte produktionen.</div>
              ) : folio.kind === 'not_configured' ? (
                <div className="text-sm text-amber-600">{folio.label}. Ange Folio Base URL nedan (superadmin) för att aktivera.</div>
              ) : folio.kind === 'failed' ? (
                <div className="text-sm text-red-600">
                  {folio.label} ({folio.reason}).
                  <div className="text-xs text-gray-400 mt-1">Gemini-resultatet är opåverkat. I produktion sker fallback till Gemini.</div>
                </div>
              ) : fr ? (
                <div>
                  <Row k="Status" v={<span className="text-green-600">OK</span>} />
                  <Row k="Provider" v={fr.providerName} />
                  <Row k="Processtid (Folio)" v={ms(fr.processingTimeMs)} />
                  <Row k="Total (inkl. nät)" v={ms(folio.ms)} />
                  <Row k="Confidence" v={fr.confidence != null ? `${Math.round(fr.confidence * 100)}%` : '—'} />
                  <Row k="Sidor" v={fr.pages?.length} />
                  <Row k="Layout-block" v={fr.layoutBlocks?.length} />
                  <details className="mt-2"><summary className="text-xs text-gray-400 cursor-pointer">Råtext</summary>
                    <pre className="text-[11px] bg-gray-50 rounded p-2 mt-1 overflow-auto max-h-60 whitespace-pre-wrap">{fr.rawText || '(tom)'}</pre>
                  </details>
                </div>
              ) : <div className="text-sm text-gray-400">Inget resultat.</div>}
          </Card>
        </div>

        {(gemini || folio) && (
          <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
            <i className="ti ti-info-circle mr-1" />
            Gemini är produktionsflödet. Folio-OCR är ett valfritt, experimentellt verktyg som körs manuellt
            och <b>ersätter aldrig Gemini automatiskt</b>. Ett Folio-fel påverkar inte Gemini-resultatet.
          </div>
        )}

        {/* Superadmin: Folio-konfiguration (krav 11). API-secret hanteras endast i edge-secrets. */}
        {isSuper && (
          <Card title="Folio-OCR – konfiguration (superadmin)" icon="ti-settings">
            <p className="text-xs text-gray-500 mb-3">
              Slå på/av Folio och ange tjänstens bas-URL utan att deploya om. API-nyckeln (om någon)
              lagras endast som edge-secret (<code>FOLIO_OCR_API_SECRET</code>) och visas aldrig här.
            </p>
            <label className="flex items-center gap-2 mb-3 text-sm">
              <input type="checkbox" checked={cfgDraft.enabled} onChange={e => setCfgDraft(d => ({ ...d, enabled: e.target.checked }))} />
              Aktivera Folio-OCR (sekundär/experimentell)
            </label>
            <label className="block mb-3">
              <div className="text-xs text-gray-500 mb-1">Folio Base URL</div>
              <input type="url" placeholder="https://folio.intern.example.se" value={cfgDraft.baseUrl}
                onChange={e => setCfgDraft(d => ({ ...d, baseUrl: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <div className="flex items-center gap-3">
              <button onClick={saveConfig} disabled={savingCfg}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-black disabled:opacity-50 flex items-center gap-1.5">
                {savingCfg ? <><i className="ti ti-loader animate-spin" /> Sparar…</> : <><i className="ti ti-device-floppy" /> Spara</>}
              </button>
              {cfg && <span className="text-xs text-gray-400">Nuvarande: {cfg.folioEnabled ? 'på' : 'av'}{cfg.folioBaseUrl ? ` · ${cfg.folioBaseUrl}` : ' · ingen URL'}</span>}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
