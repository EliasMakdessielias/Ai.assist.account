// [FOLIO_OCR_EXPERIMENTAL_PROVIDER] – isolerad adapter mot en SEPARAT Folio-OCR-tjänst.
// Folio-OCR körs som egen tjänst (FastAPI/Docker) och anropas ENDAST härifrån via HTTP.
// Default AV. Ersätter ALDRIG Gemini-flödet. Aktiveras via DB-config (admin-toggle) ELLER env.
//
// Config-prioritet (krav 2/11): DB-rad ocr_provider_config gäller om den finns, annars env
//   (ENABLE_FOLIO_OCR, FOLIO_OCR_BASE_URL). API-secret läses ENDAST från env (aldrig DB/frontend).
// Statuslägen (krav 8): 'disabled' (av), 'not_configured' (på men saknar base-url),
//   'available' (health ok), 'unavailable' (svarar ej).
//
// Adapter-kontrakt: POST {base}/ocr { filename, mimeType, contentBase64, persist:false }
//   -> { text, pages:[{page,text,blocks}], confidence }. BokPilot äger lagringen (persist:false).
// Säkerhet (krav 12): verify_jwt=true, inloggad krävs, company-åtkomst krävs, CORS innehåller
//   authorization/x-client-info/apikey/content-type. Loggar aldrig secrets/dokumentinnehåll.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCompanyServiceState, isServiceLocked, SERVICE_PAUSED_MESSAGE } from '../_shared/serviceState.ts'

const TIMEOUT = parseInt(Deno.env.get('FOLIO_OCR_TIMEOUT_MS') || '20000', 10)
const API_SECRET = Deno.env.get('FOLIO_OCR_API_SECRET') || '' // ENDAST env – exponeras aldrig
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Resolvera enabled + base: DB-config (admin-toggle) först, annars env (krav 2/11).
async function resolveConfig(admin) {
  let enabled = (Deno.env.get('ENABLE_FOLIO_OCR') || 'false').toLowerCase() === 'true'
  let base = (Deno.env.get('FOLIO_OCR_BASE_URL') || '').replace(/\/$/, '')
  try {
    const { data } = await admin.from('ocr_provider_config').select('folio_enabled, folio_base_url').eq('id', true).maybeSingle()
    if (data) {
      if (typeof data.folio_enabled === 'boolean') enabled = data.folio_enabled
      if (data.folio_base_url != null && String(data.folio_base_url).trim() !== '') base = String(data.folio_base_url).replace(/\/$/, '')
    }
  } catch { /* faller tillbaka till env */ }
  return { enabled, base }
}

function normalize(folio, processingTimeMs) {
  const pages = Array.isArray(folio?.pages) ? folio.pages : []
  const normPages = pages.map((p, i) => ({ page: p?.page ?? i + 1, text: typeof p?.text === 'string' ? p.text : '', blocks: Array.isArray(p?.blocks) ? p.blocks : [] }))
  return {
    providerName: 'folio_ocr',
    rawText: typeof folio?.text === 'string' ? folio.text : normPages.map((p) => p.text).filter(Boolean).join('\n\n'),
    pages: normPages,
    layoutBlocks: Array.isArray(folio?.blocks) ? folio.blocks : normPages.flatMap((p) => p.blocks),
    confidence: typeof folio?.confidence === 'number' ? folio.confidence : null,
    processingTimeMs, errors: [], fallbackUsed: false,
  }
}
async function withTimeout(fn) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT)
  try { return await fn(ac.signal) } finally { clearTimeout(t) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const SB_URL = Deno.env.get('SUPABASE_URL'), ANON = Deno.env.get('SUPABASE_ANON_KEY'), SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  // Auth (krav 12): inloggad + ENDAST plattforms-superadmin (internt testverktyg – ops får inte anropa).
  const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Ej inloggad' }, 401)
  const { data: access } = await userClient.rpc('my_platform_access')
  if (!access?.isSuperadmin) return json({ error: 'forbidden' }, 403)

  const admin = createClient(SB_URL, SRK)
  const { enabled, base } = await resolveConfig(admin)

  // Statuslägen som inte är fel (krav 3/7/8): rapportera ALDRIG system_error här.
  if (!enabled) return json({ available: false, status: 'disabled', providerName: 'folio_ocr', reason: 'disabled' })
  if (!base) return json({ available: false, status: 'not_configured', providerName: 'folio_ocr', reason: 'not_configured' })

  let body; try { body = await req.json() } catch { body = {} }

  // Health-check.
  if (body?.healthCheck) {
    const start = Date.now()
    try {
      const r = await withTimeout(s => fetch(`${base}/health`, { signal: s, headers: API_SECRET ? { 'X-Api-Key': API_SECRET } : {} }))
      const ok = r.ok
      await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: ok, p_error: ok ? null : `health ${r.status}` })
      return json({ available: ok, status: ok ? 'available' : 'unavailable', healthy: ok, latencyMs: Date.now() - start })
    } catch (e) {
      await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: false, p_error: String(e?.message || e).slice(0, 200) })
      return json({ available: false, status: 'unavailable', healthy: false, error: 'unreachable' })
    }
  }

  // OCR av ett dokument (BokPilot äger filen i Supabase Storage; skickas stateless till Folio).
  const docId = body?.document_id
  if (!docId) return json({ error: 'document_id saknas' }, 400)
  const { data: doc } = await admin.from('documents').select('id, company_id, storage_path, file_name, mime_type').eq('id', docId).single()
  if (!doc?.storage_path) return json({ available: true, error: 'document_missing', result: null })
  // Verifiera att anroparen tillhör företaget (krav 12).
  const { data: member } = await admin.from('user_companies').select('id').eq('company_id', doc.company_id).eq('user_id', user.id).maybeSingle()
  if (!member && !access?.isSuperadmin) return json({ error: 'forbidden' }, 403)

  // Service-lås (Fas 2-härdning) prioriteras över OCR-körning: pausat/blockerat företag → kör inte
  // Folio. Kontrollerad affärsavvisning, inget system_error, ingen dokumentmutation. (disabled/
  // not_configured har redan returnerats ovan och bevaras.)
  const serviceState = await getCompanyServiceState(admin, doc.company_id)
  if (isServiceLocked(serviceState)) {
    return json({ available: true, status: 'service_locked', error: SERVICE_PAUSED_MESSAGE, state: serviceState, result: null }, 403)
  }

  const start = Date.now()
  try {
    const { data: file, error: dErr } = await admin.storage.from('underlag').download(doc.storage_path)
    if (dErr || !file) throw new Error('download_failed')
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''; const chunk = 0x8000
    for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk))
    const b64 = btoa(bin)
    const resp = await withTimeout(s => fetch(`${base}/ocr`, {
      method: 'POST', signal: s,
      headers: { 'Content-Type': 'application/json', ...(API_SECRET ? { 'X-Api-Key': API_SECRET } : {}) },
      body: JSON.stringify({ filename: doc.file_name, mimeType: doc.mime_type, contentBase64: b64, persist: false }),
    }))
    if (!resp.ok) throw new Error(`folio ${resp.status}`)
    const folio = await resp.json()
    await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: true, p_error: null })
    return json({ available: true, status: 'available', result: normalize(folio, Date.now() - start) })
  } catch (e) {
    const msg = String(e?.message || e)
    await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: false, p_error: msg.slice(0, 200) })
    // Riktigt service-fel (ej timeout) -> system_error till operations_admins. Skapar INGEN dokumentpost.
    if (!/abort|timeout/i.test(msg)) {
      await admin.rpc('report_system_error', { p_component: 'folio-ocr', p_message: msg.slice(0, 200), p_company_id: doc.company_id, p_severity: 'warning', p_error_code: 'folio_ocr_failure', p_metadata: {}, p_occurred_at: new Date().toISOString() })
    }
    return json({ available: false, status: 'unavailable', error: /abort|timeout/i.test(msg) ? 'timeout' : 'folio_error', result: null })
  }
})
