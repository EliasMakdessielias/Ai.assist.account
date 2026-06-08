// report-error: säker endpoint för bakgrundskomponenter UTAN Supabase service-role
// (t.ex. IMAP-importern). Autentiseras med HMAC (ERROR_REPORT_SECRET) och anropar
// report_system_error / record_worker_health server-side med funktionens service-role.
// Deploy: verify_jwt=false (autentiseras via HMAC nedan). Loggar/lagrar aldrig secrets.
//
// Body (JSON): { component, severity, errorCode, message, metadata, occurredAt, ok?, companyId? }
//  - ok:true  -> health-ping (last_success). Annars -> system_error-rapport.
// Sanering av metadata speglar src/lib/systemError.js (canonical + testad).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENSITIVE_KEY = /pass(word)?|secret|token|auth|credential|cookie|api[_-]?key|\bkey\b|bearer|body|base64|content|iban|bic|ocr|swish|cvc|pan/i
function sanitizeMetadata(meta: any, depth = 0): Record<string, unknown> {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const out: Record<string, unknown> = {}; let n = 0
  for (const [k, v] of Object.entries(meta)) {
    if (n++ >= 20) break
    if (SENSITIVE_KEY.test(k)) { out[k] = '[redacted]'; continue }
    if (v == null || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = v.length > 300 ? v.slice(0, 300) + '…' : v
    else if (Array.isArray(v)) out[k] = `[array(${v.length})]`
    else if (typeof v === 'object' && depth < 1) out[k] = sanitizeMetadata(v, depth + 1)
    else out[k] = '[object]'
  }
  return out
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const SECRET = Deno.env.get('ERROR_REPORT_SECRET') || ''
  if (!SECRET) return json({ error: 'server_misconfigured' }, 500)

  const raw = await req.text()
  const sig = (req.headers.get('X-Bokpilot-Signature') || '').replace(/^sha256=/, '').trim().toLowerCase()
  const token = (new URL(req.url).searchParams.get('token') || '').trim()
  let authed = false
  if (sig) authed = timingSafeEqual(sig, await hmacHex(SECRET, raw))
  else if (token) authed = timingSafeEqual(token, SECRET)
  if (!authed) return json({ error: 'unauthorized' }, 401)

  let p: any
  try { p = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const component = String(p.component || 'okänd').slice(0, 60)

  // Health-ping (lyckad körning) -> nollställ consecutive_failures.
  if (p.ok === true) {
    await admin.rpc('record_worker_health', { p_component: component, p_ok: true, p_error: null })
    return json({ status: 'ok' })
  }

  const { error } = await admin.rpc('report_system_error', {
    p_component: component,
    p_message: String(p.message || '').slice(0, 300),
    p_company_id: p.companyId ?? null,
    p_severity: ['warning', 'error', 'critical'].includes(p.severity) ? p.severity : 'error',
    p_error_code: String(p.errorCode || 'unknown').slice(0, 60).replace(/[^a-zA-Z0-9_.\-]/g, '_'),
    p_metadata: sanitizeMetadata(p.metadata),
    p_occurred_at: p.occurredAt || new Date().toISOString(),
  })
  if (error) return json({ error: 'report_failed' }, 500)
  return json({ status: 'reported' })
})
