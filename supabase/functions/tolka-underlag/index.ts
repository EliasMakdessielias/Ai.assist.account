// Edge Function: tolka-underlag
// Tar emot ett document_id, hämtar filen, skickar den till Gemini för
// fakturatolkning och returnerar strukturerad data + förslag på kontering.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCompanyServiceState, isServiceLocked, SERVICE_PAUSED_MESSAGE } from '../_shared/serviceState.ts'
import { runGeminiOcr } from '../_shared/ocr.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
// system_error-rapportering (service-role). Får aldrig kasta. Inga underlagsdata i metadata.
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

    // Verifiera att anroparen är inloggad. Vi validerar EXAKT den bearer-token som
    // skickades (getUser(token)) i stället för att förlita oss på klientens auth-state –
    // annars kan en giltig anon-nyckel passera plattformens verify_jwt men ge null user
    // här ("Ej inloggad"). Debug-logg loggar ALDRIG token, endast om header finns + user-id.
    const authHeader = req.headers.get('Authorization') || ''
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    console.log(`[tolka-underlag] auth_header_present=${bearer ? 'yes' : 'no'}`)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await userClient.auth.getUser(bearer || undefined)
    if (userErr || !user) {
      console.log(`[tolka-underlag] auth_failed reason=${userErr ? 'invalid_token' : 'no_user'}`)
      return new Response(JSON.stringify({ error: 'Ej inloggad' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    console.log(`[tolka-underlag] authed user_id=${user.id}`)

    admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Hämta dokumentet + kontrollera att användaren tillhör företaget.
    const { data: doc, error: docErr } = await admin.from('documents').select('*').eq('id', document_id).single()
    if (docErr || !doc) throw new Error('Underlaget hittades inte')
    companyId = doc.company_id

    const { data: member } = await admin.from('user_companies')
      .select('id').eq('user_id', user.id).eq('company_id', doc.company_id).maybeSingle()
    if (!member) return new Response(JSON.stringify({ error: 'Ingen åtkomst' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })

    // Service-lås (Fas 2-härdning): pausat/blockerat företag → kör INTE Gemini och skriv ingen
    // tolkning. Kontrollerad affärsavvisning (ej system_error). Klienten visar ren svensk text.
    const serviceState = await getCompanyServiceState(admin, companyId)
    if (isServiceLocked(serviceState)) {
      return new Response(JSON.stringify({ error: SERVICE_PAUSED_MESSAGE, code: 'service_locked', state: serviceState }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Ladda ner filen.
    const { data: fileData, error: dlErr } = await admin.storage.from('underlag').download(doc.storage_path)
    if (dlErr || !fileData) throw new Error('Kunde inte ladda ner filen')
    const base64 = blobToBase64(await fileData.arrayBuffer())
    const mimeType = doc.mime_type || 'application/pdf'

    // Hämta aktiva konton som underlag till konteringsförslaget.
    const { data: accounts } = await admin.from('accounts')
      .select('account_nr, name').eq('company_id', doc.company_id).eq('is_active', true).order('account_nr')
    const kontoplan = (accounts || []).map(a => `${a.account_nr} ${a.name}`).join('\n')

    // Gemini-OCR via den delade modulen (samma schema/prompt som inbound-email).
    const result = await runGeminiOcr({ apiKey: GEMINI_API_KEY, base64, mimeType, kontoplan })

    // Plan-enforcement (soft): registrera AI-användning + kontrollera/varna. Blockerar aldrig OCR.
    try {
      await admin.rpc('record_ai_usage', { p_company_id: companyId, p_kind: 'ocr' })
      await admin.rpc('enforce_plan_limit', { p_company_id: companyId, p_metric: 'ai' })
    } catch { /* soft – får ej stoppa tolkningen */ }
    await admin.rpc('record_worker_health', { p_component: 'tolka-underlag', p_ok: true, p_error: null })
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = String((err as Error)?.message || err)
    // Rapportera bara genuina systemfel – inte klient-/anroparfel (saknat id, ej inloggad, hittades inte).
    const clientErr = /document_id saknas|hittades inte|ingen åtkomst|ej inloggad/i.test(msg)
    if (!clientErr) {
      const { errorCode, severity } = classifyOcrError(msg)
      await reportOcrError(admin, errorCode, msg, severity, {}, companyId)
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
