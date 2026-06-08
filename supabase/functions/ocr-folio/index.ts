// [FOLIO_OCR_EXPERIMENTAL_PROVIDER] – isolerad adapter mot en SEPARAT Folio-OCR-tjänst.
// Folio-OCR körs som egen tjänst (FastAPI/Docker) och anropas ENDAST härifrån via HTTP.
// Default AV (ENABLE_FOLIO_OCR != true) -> returnerar {available:false}. Ersätter ALDRIG Gemini-flödet.
// Adapter-kontrakt: POST {FOLIO_OCR_BASE_URL}/ocr  { filename, mimeType, contentBase64, persist:false }
//   -> { text, pages:[{page,text,blocks}], confidence }. (Folio kan kräva en tunn shim runt sitt
//   upload/ocr-API; se docs/FOLIO_OCR.md.) BokPilot äger lagringen – Folio ska köra stateless (persist:false).
// Deploy: verify_jwt=true. Endast operations_admin/superadmin. Loggar aldrig secrets/dokumentinnehåll.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ENABLED = (Deno.env.get('ENABLE_FOLIO_OCR') || 'false').toLowerCase() === 'true'
const BASE = (Deno.env.get('FOLIO_OCR_BASE_URL') || '').replace(/\/$/, '')
const TIMEOUT = parseInt(Deno.env.get('FOLIO_OCR_TIMEOUT_MS') || '20000', 10)
const API_SECRET = Deno.env.get('FOLIO_OCR_API_SECRET') || ''
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function normalize(folio: any, processingTimeMs: number) {
  const pages = Array.isArray(folio?.pages) ? folio.pages : []
  const normPages = pages.map((p: any, i: number) => ({ page: p?.page ?? i + 1, text: typeof p?.text === 'string' ? p.text : '', blocks: Array.isArray(p?.blocks) ? p.blocks : [] }))
  return {
    providerName: 'folio_ocr',
    rawText: typeof folio?.text === 'string' ? folio.text : normPages.map((p: any) => p.text).filter(Boolean).join('\n\n'),
    pages: normPages,
    layoutBlocks: Array.isArray(folio?.blocks) ? folio.blocks : normPages.flatMap((p: any) => p.blocks),
    confidence: typeof folio?.confidence === 'number' ? folio.confidence : null,
    processingTimeMs, errors: [], fallbackUsed: false,
  }
}
async function withTimeout(fn: (signal: AbortSignal) => Promise<Response>) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT)
  try { return await fn(ac.signal) } finally { clearTimeout(t) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const SB_URL = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  // Endast operations_admin/superadmin (testverktyg).
  const { data: access } = await userClient.rpc('my_platform_access')
  if (!access?.canViewOperations) return json({ error: 'forbidden' }, 403)

  if (!ENABLED || !BASE) return json({ available: false, providerName: 'folio_ocr', reason: !ENABLED ? 'disabled' : 'no_base_url' })

  const admin = createClient(SB_URL, SRK)
  let body: any; try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  // Health-check.
  if (body?.healthCheck) {
    const start = Date.now()
    try {
      const r = await withTimeout(s => fetch(`${BASE}/health`, { signal: s, headers: API_SECRET ? { 'X-Api-Key': API_SECRET } : {} }))
      const ok = r.ok
      await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: ok, p_error: ok ? null : `health ${r.status}` })
      return json({ available: true, healthy: ok, latencyMs: Date.now() - start })
    } catch (e) {
      await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: false, p_error: String((e as Error)?.message || e).slice(0, 200) })
      return json({ available: true, healthy: false, error: 'unreachable' })
    }
  }

  // OCR av ett dokument (BokPilot äger filen i Supabase Storage; skickas stateless till Folio).
  const docId = body?.document_id
  if (!docId) return json({ error: 'document_id saknas' }, 400)
  const { data: doc } = await admin.from('documents').select('id, company_id, storage_path, file_name, mime_type').eq('id', docId).single()
  if (!doc?.storage_path) return json({ available: true, error: 'document_missing', result: null })
  // Verifiera att anroparen tillhör företaget (RLS-spegling).
  const { data: member } = await admin.from('user_companies').select('id').eq('company_id', doc.company_id).eq('user_id', (await userClient.auth.getUser()).data.user?.id).maybeSingle()
  if (!member && !access?.isSuperadmin) return json({ error: 'forbidden' }, 403)

  const start = Date.now()
  try {
    const { data: file, error: dErr } = await admin.storage.from('underlag').download(doc.storage_path)
    if (dErr || !file) throw new Error('download_failed')
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''; const chunk = 0x8000
    for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk))
    const b64 = btoa(bin)
    const resp = await withTimeout(s => fetch(`${BASE}/ocr`, {
      method: 'POST', signal: s,
      headers: { 'Content-Type': 'application/json', ...(API_SECRET ? { 'X-Api-Key': API_SECRET } : {}) },
      body: JSON.stringify({ filename: doc.file_name, mimeType: doc.mime_type, contentBase64: b64, persist: false }),
    }))
    if (!resp.ok) throw new Error(`folio ${resp.status}`)
    const folio = await resp.json()
    await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: true, p_error: null })
    return json({ available: true, result: normalize(folio, Date.now() - start) })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    await admin.rpc('record_worker_health', { p_component: 'folio-ocr', p_ok: false, p_error: msg.slice(0, 200) })
    // Kritiskt fel (ej timeout) -> system_error till operations_admins. Skapar INGEN dokumentpost.
    if (!/abort|timeout/i.test(msg)) {
      await admin.rpc('report_system_error', { p_component: 'folio-ocr', p_message: msg.slice(0, 200), p_company_id: doc.company_id, p_severity: 'warning', p_error_code: 'folio_ocr_failure', p_metadata: {}, p_occurred_at: new Date().toISOString() })
    }
    return json({ available: true, error: /abort|timeout/i.test(msg) ? 'timeout' : 'folio_error', result: null })
  }
})
