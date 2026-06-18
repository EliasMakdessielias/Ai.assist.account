// Edge Function: tolka-underlag
// Tar emot ett document_id, hämtar filen, skickar den till Gemini för
// fakturatolkning och returnerar strukturerad data + förslag på kontering.
//
// QUOTA-/JOBBHANTERING (skydd mot retry-storm):
// - ai_claim_job: cooldown (document/user/company), rate limit per user/company och
//   idempotens (dubbelklick återanvänder pågående jobb i stället för att starta nytt).
// - Vid 429 från Gemini: dokumentet markeras quota_limited (INTE failed) + cooldown 60 s,
//   och exakt felkropp loggas i ai_error_log (provider/modell/status/body/request id).
// - Klienten får retry_after_seconds och visar en countdown.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCompanyServiceState, isServiceLocked, SERVICE_PAUSED_MESSAGE } from '../_shared/serviceState.ts'
import { runGeminiOcr } from '../_shared/ocr.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const COOLDOWN_SECONDS = 60
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function blobToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// Klassificera ett OCR-fel -> {errorCode, severity}. Inga dokumentdata/secrets exponeras.
function classifyOcrError(msg: string): { errorCode: string; severity: string } {
  const m = (msg || '').toLowerCase()
  if (/gemini_api_key|api_key saknas|api-key saknas/.test(m)) return { errorCode: 'config_missing_gemini_key', severity: 'critical' }
  if (/\b429\b|rate limit|quota|resource_exhausted/.test(m)) return { errorCode: 'gemini_rate_limit', severity: 'warning' }
  if (/timeout|timed out|deadline|aborted/.test(m)) return { errorCode: 'ocr_timeout', severity: 'error' }
  if (/ladda ner|download|storage|hittades inte|extract/.test(m)) return { errorCode: 'file_extraction_failure', severity: 'error' }
  if (/json|parse|tomt svar|unexpected|malformed/.test(m)) return { errorCode: 'malformed_model_response', severity: 'error' }
  if (/gemini|generativelanguage|api/.test(m)) return { errorCode: 'gemini_api_failure', severity: 'error' }
  return { errorCode: 'ocr_unhandled', severity: 'error' }
}
async function reportOcrError(admin: any, errorCode: string, message: string, severity: string, metadata: Record<string, unknown> = {}, companyId: string | null = null) {
  try {
    if (!admin) return
    await admin.rpc('report_system_error', {
      p_component: 'tolka-underlag', p_message: String(message || '').slice(0, 300), p_company_id: companyId,
      p_severity: severity, p_error_code: errorCode, p_metadata: metadata, p_occurred_at: new Date().toISOString(),
    })
  } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let admin: any = null
  let companyId: string | null = null
  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY saknas i Edge Function-secrets')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    const { document_id } = await req.json()
    if (!document_id) throw new Error('document_id saknas')

    const authHeader = req.headers.get('Authorization') || ''
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await userClient.auth.getUser(bearer || undefined)
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Ej inloggad' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    admin = createClient(SUPABASE_URL, SERVICE_KEY)

    const { data: doc, error: docErr } = await admin.from('documents').select('*').eq('id', document_id).single()
    if (docErr || !doc) throw new Error('Underlaget hittades inte')
    companyId = doc.company_id

    const { data: member } = await admin.from('user_companies')
      .select('id').eq('user_id', user.id).eq('company_id', doc.company_id).maybeSingle()
    if (!member) return new Response(JSON.stringify({ error: 'Ingen åtkomst' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })

    const serviceState = await getCompanyServiceState(admin, companyId)
    if (isServiceLocked(serviceState)) {
      return json({ error: SERVICE_PAUSED_MESSAGE, code: 'service_locked', state: serviceState }, 403)
    }

    // Claim: cooldown + rate limit + idempotens. Förhindrar retry-storm och dubbla jobb.
    const { data: claim, error: claimErr } = await admin.rpc('ai_claim_job', {
      p_document_id: document_id, p_company_id: companyId, p_user_id: user.id,
    })
    if (claimErr) throw new Error('Kunde inte starta tolkningen: ' + (claimErr.message || 'okänt fel'))
    if (!claim?.allowed) {
      if (claim?.reason === 'not_found') throw new Error('Underlaget hittades inte')
      if (claim?.reason === 'in_progress') {
        return json({ ok: false, code: 'in_progress', job_id: claim.job_id, ai_status: 'processing',
          message: 'AI-tolkning pågår redan för detta underlag.' }, 200)
      }
      // cooldown eller rate_limited
      const sec = Number(claim?.retry_after_seconds) || COOLDOWN_SECONDS
      return json({ ok: false, code: 'quota_cooldown', reason: claim?.reason, scope: claim?.scope,
        retry_after_seconds: sec, ai_status: 'quota_limited',
        error: `AI-kvoten är tillfälligt slut. Försök igen om ${sec} sekunder.` }, 200)
    }

    // Hämta fil + kontoplan och kör OCR. All quota-/felhantering nedan.
    try {
      const { data: fileData, error: dlErr } = await admin.storage.from('underlag').download(doc.storage_path)
      if (dlErr || !fileData) throw new Error('Kunde inte ladda ner filen')
      const base64 = blobToBase64(await fileData.arrayBuffer())
      const mimeType = doc.mime_type || 'application/pdf'

      const { data: accounts } = await admin.from('accounts')
        .select('account_nr, name').eq('company_id', doc.company_id).eq('is_active', true).order('account_nr')
      const kontoplan = (accounts || []).map((a: any) => `${a.account_nr} ${a.name}`).join('\n')

      const result = await runGeminiOcr({ apiKey: GEMINI_API_KEY, base64, mimeType, kontoplan })

      await admin.rpc('ai_finish_job', { p_document_id: document_id, p_company_id: companyId, p_status: 'completed', p_user_id: user.id })
      try {
        await admin.rpc('record_ai_usage', { p_company_id: companyId, p_kind: 'ocr' })
        await admin.rpc('enforce_plan_limit', { p_company_id: companyId, p_metric: 'ai' })
      } catch { /* soft – får ej stoppa tolkningen */ }
      await admin.rpc('record_worker_health', { p_component: 'tolka-underlag', p_ok: true, p_error: null })
      return json({ ok: true, result, ai_status: 'completed' })
    } catch (ocrErr) {
      const e = ocrErr as Error & { quota?: boolean; status?: number; model?: string; body?: string; requestId?: string | null; calls?: number }
      const msg = String(e?.message || e)
      const quota = !!e?.quota || /\b429\b|resource_exhausted|quota|rate.?limit/i.test(msg)

      // Spara exakt felkropp för felsökning (provider/modell/status/body/request id).
      try {
        await admin.rpc('log_ai_error', {
          p_provider: 'gemini', p_model: e?.model || null, p_status_code: e?.status ?? null,
          p_error_code: quota ? 'RESOURCE_EXHAUSTED' : null, p_error_body: String(e?.body || msg).slice(0, 8000),
          p_request_id: e?.requestId || null, p_attempts: e?.calls ?? null, p_kind: 'ocr',
          p_user_id: user.id, p_company_id: companyId, p_document_id: document_id,
        })
      } catch { /* loggning får ej stoppa svaret */ }

      if (quota) {
        // 429: quota_limited (INTE failed) + cooldown. Dokumentet kan tolkas igen när kvoten är tillbaka.
        await admin.rpc('ai_finish_job', { p_document_id: document_id, p_company_id: companyId, p_status: 'quota_limited', p_cooldown_seconds: COOLDOWN_SECONDS, p_user_id: user.id, p_error: 'gemini_quota' })
        await reportOcrError(admin, 'gemini_rate_limit', msg, 'warning', { model: e?.model, status: e?.status, requestId: e?.requestId }, companyId)
        return json({ ok: false, code: 'quota_cooldown', retry_after_seconds: COOLDOWN_SECONDS, ai_status: 'quota_limited',
          error: `AI-kvoten är tillfälligt slut. Försök igen om ${COOLDOWN_SECONDS} sekunder.` }, 200)
      }

      // Annat fel (serverfel/timeout/malformed): failed. Meddelandet antyder ALDRIG att bilden är fel.
      await admin.rpc('ai_finish_job', { p_document_id: document_id, p_company_id: companyId, p_status: 'failed', p_user_id: user.id, p_error: msg.slice(0, 500) })
      const { errorCode, severity } = classifyOcrError(msg)
      await reportOcrError(admin, errorCode, msg, severity, { model: e?.model, status: e?.status }, companyId)
      await admin.rpc('record_worker_health', { p_component: 'tolka-underlag', p_ok: false, p_error: errorCode })
      return json({ ok: false, code: 'ai_failed', ai_status: 'failed',
        error: 'AI-tjänsten kunde inte tolka underlaget just nu. Försök igen om en stund.' }, 200)
    }
  } catch (err) {
    const msg = String((err as Error)?.message || err)
    const clientErr = /document_id saknas|hittades inte|ingen åtkomst|ej inloggad/i.test(msg)
    if (!clientErr) {
      const { errorCode, severity } = classifyOcrError(msg)
      await reportOcrError(admin, errorCode, msg, severity, {}, companyId)
    }
    return json({ error: msg }, 400)
  }
})
