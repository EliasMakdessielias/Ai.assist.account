// Inbound-email webhook för BokPilot (bokpilot.se).
//
// Tar emot inkommande e-post och identifierar företaget via arkivnumret i
// mottagaradressen ({archiveNumber}underlag@bokpilot.se), lagrar varje bilaga och
// skapar EN inkorgspost per bilaga i `documents` med automatisk klassificering.
// ENDAST inbound – inga utgående funktioner.
//
// Autentisering (en av):
//   1) ?token=<secret>  – inbound-provider (Postmark Inbound) som postar JSON.
//   2) X-Bokpilot-Signature: sha256=<hmac(rawBody, secret)> – egen Cloudflare-worker.
// Secret: INBOUND_EMAIL_WEBHOOK_SECRET (+ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY auto).
// Deploy: verify_jwt=false (webhooken autentiseras ovan, inte via JWT).
//
// Stödjer Postmark Inbound-payload (From/To/Subject/TextBody/Attachments) och ett
// eget JSON-format { to, from, subject, text, attachments:[{filename,contentType,contentBase64,size}] }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCompanyServiceState, isServiceLocked } from '../_shared/serviceState.ts'

const BUCKET = 'underlag'
const INBOX_DOMAIN = 'bokpilot.se'
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'docx']
const ALLOWED_MIME = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'scr', 'js', 'jar', 'msi', 'sh', 'ps1', 'vbs', 'dll', 'app', 'html', 'htm', 'svg', 'zip']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
// system_error-rapportering (har service-role). Aldrig bodies/secrets i metadata. Får aldrig kasta.
async function reportErr(admin: any, errorCode: string, message: string, severity = 'error', metadata: Record<string, unknown> = {}, companyId: string | null = null) {
  try {
    await admin.rpc('report_system_error', {
      p_component: 'inbound-email', p_message: String(message || '').slice(0, 300), p_company_id: companyId,
      p_severity: ['warning', 'error', 'critical'].includes(severity) ? severity : 'error',
      p_error_code: errorCode, p_metadata: metadata, p_occurred_at: new Date().toISOString(),
    })
  } catch { /* noop */ }
}
function extractEmail(raw: string): string {
  if (!raw) return ''
  const m = String(raw).match(/<([^>]+)>/)
  return (m ? m[1] : String(raw)).trim().toLowerCase()
}
// {archiveNumber}underlag@bokpilot.se -> archiveNumber, annars null.
// Domän = bokpilot.se, local-part = {siffror}underlag (suffix exakt "underlag").
function parseRecipient(raw: string): { archiveNumber: string; email: string } | null {
  const addr = extractEmail(raw)
  const at = addr.indexOf('@')
  if (at < 0) return null
  const local = addr.slice(0, at)
  const domain = addr.slice(at + 1)
  if (domain !== INBOX_DOMAIN) return null
  const m = local.match(/^(\d+)underlag$/)
  if (!m) return null
  return { archiveNumber: m[1], email: addr }
}
function fileExt(name = ''): string {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}
// null = ok, annars orsak.
function attachmentReject(a: { filename?: string; contentType?: string; size?: number }): string | null {
  const ext = fileExt(a.filename || '')
  if (BLOCKED_EXTENSIONS.includes(ext)) return 'blockerad_filtyp'
  if ((a.size || 0) > MAX_ATTACHMENT_BYTES) return 'for_stor'
  if (ext && ALLOWED_EXTENSIONS.includes(ext)) return null
  if (!ext && ALLOWED_MIME.includes(String(a.contentType || '').toLowerCase())) return null
  return 'ej_tillaten_filtyp'
}

// ---- Regelbaserad klassificering (spegel av src/lib/classifyDocument.js) ----
const STRONG: Record<string, string[]> = {
  kvitto: ['kvitto', 'receipt', 'kassakvitto', 'kortköp'],
  leverantorsfaktura: ['leverantörsfaktura', 'faktura', 'invoice'],
  kundfaktura: ['kundfaktura', 'utgående faktura'],
  avtal: ['avtal', 'kontrakt', 'agreement', 'contract'],
}
const SUPPORT: Record<string, string[]> = {
  kvitto: ['butik', 'betaldatum', 'kvittonr', 'kortbetalning', 'swish', 'summa'],
  leverantorsfaktura: ['ocr', 'bankgiro', 'plusgiro', 'förfallodatum', 'fakturanummer', 'fakturanr', 'att betala', 'momsreg', 'org.nr'],
  kundfaktura: ['kund', 'vår referens', 'er referens'],
  avtal: ['signerat', 'signerad', 'parterna', 'parter', 'villkor', 'undertecknat', 'giltighetstid'],
}
const PRIORITY = ['leverantorsfaktura', 'kvitto', 'kundfaktura', 'avtal', 'dokument']
function classify(input: { filename?: string; mimeType?: string; subject?: string; bodyText?: string }, supported: boolean) {
  if (!supported) return { type: 'okand', confidence: 0, status: 'unsupported' }
  const hay = `${input.filename || ''} ${input.subject || ''} ${input.bodyText || ''}`.toLowerCase()
  const hits = (ws: string[]) => ws.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
  const scores: Record<string, number> = {}
  for (const c of ['kvitto', 'leverantorsfaktura', 'kundfaktura', 'avtal']) {
    const strong = hits(STRONG[c]) > 0 ? 0.6 : 0
    const support = hits(SUPPORT[c]) * 0.12
    scores[c] = strong > 0 ? strong + support : support * 0.5
  }
  if (/\.docx?$/i.test(input.filename || '') || /word|officedocument/.test(input.mimeType || '')) {
    scores.avtal = (scores.avtal || 0) + 0.1
    scores.dokument = 0.25
  }
  let best: string | null = null, bestScore = 0
  for (const c of PRIORITY) { const s = scores[c] || 0; if (s > bestScore) { bestScore = s; best = c } }
  if (!best || bestScore <= 0) return { type: 'okand', confidence: 0, status: 'needs_review' }
  const confidence = Math.min(0.97, Math.round(bestScore * 100) / 100)
  return { type: best, confidence, status: confidence >= 0.6 ? 'classified' : 'needs_review' }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SECRET = Deno.env.get('INBOUND_EMAIL_WEBHOOK_SECRET') || Deno.env.get('INBOUND_WEBHOOK_SECRET') || ''
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  if (!SECRET) {
    // Saknad secret = konfigurationsfel (inte en vanlig felaktig signatur). Notifiera admins.
    await reportErr(admin, 'config_missing_secret', 'INBOUND_EMAIL_WEBHOOK_SECRET saknas i edge-secrets', 'critical')
    return json({ error: 'server_misconfigured' }, 500)
  }

  try {

  // 1) Autentisering: HMAC-signatur (egen Cloudflare-worker) ELLER ?token=<secret>
  //    (inbound-provider, t.ex. Postmark, som inte HMAC-signerar).
  const raw = await req.text()
  const url = new URL(req.url)
  const token = (url.searchParams.get('token') || req.headers.get('X-Webhook-Token') || '').trim()
  const sig = (req.headers.get('X-Bokpilot-Signature') || '').replace(/^sha256=/, '').trim().toLowerCase()
  let authed = false
  if (sig) authed = timingSafeEqual(sig, await hmacSha256Hex(SECRET, raw))
  else if (token) authed = timingSafeEqual(token, SECRET)
  if (!authed) return json({ error: 'unauthorized' }, 401)

  let payload: any
  try { payload = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }

  // 2) Normalisera payload – stöd både eget JSON-format och Postmark Inbound.
  const isPostmark = Array.isArray(payload.Attachments) || payload.FromFull || payload.ToFull
  let sender: string, subject: string, bodyText: string, attachments: any[], recipientCandidates: string[]
  if (isPostmark) {
    sender = extractEmail(payload.From || payload.FromFull?.Email || '')
    subject = (payload.Subject || '').toString().slice(0, 500)
    bodyText = (payload.TextBody || '').toString().slice(0, 100000)
    attachments = (payload.Attachments || []).map((a: any) => ({ filename: a.Name, contentType: a.ContentType, contentBase64: a.Content, size: a.ContentLength }))
    // Vid Hostinger-forward ligger originaladressen kvar i To/headers.
    recipientCandidates = [
      ...(Array.isArray(payload.ToFull) ? payload.ToFull.map((t: any) => t.Email) : []),
      payload.To, payload.OriginalRecipient,
      ...(Array.isArray(payload.CcFull) ? payload.CcFull.map((t: any) => t.Email) : []),
    ].filter(Boolean).map(String)
  } else {
    sender = extractEmail(String(payload.from || ''))
    subject = (payload.subject || '').toString().slice(0, 500)
    bodyText = (payload.text || '').toString().slice(0, 100000)
    attachments = Array.isArray(payload.attachments) ? payload.attachments : []
    recipientCandidates = [payload.to].filter(Boolean).map(String)
  }
  const messageId = (payload.messageId || payload.MessageID || payload.MessageId || '').toString().slice(0, 400) || null
  const sourceTag = (payload.source || 'email').toString().slice(0, 40)
  const now = new Date().toISOString()

  // Idempotens: samma Message-ID importeras aldrig två gånger.
  if (messageId) {
    const { data: dup } = await admin.from('inbound_email_log').select('id').eq('message_id', messageId).maybeSingle()
    if (dup) return json({ status: 'duplicate', messageId })
  }

  // 3) Hitta den mottagaradress som matchar {nr}underlag@bokpilot.se.
  let parsed: { archiveNumber: string; email: string } | null = null
  let recipient = recipientCandidates[0] || ''
  for (const cand of recipientCandidates) { const p = parseRecipient(cand); if (p) { parsed = p; recipient = cand; break } }

  const log = (company_id: string | null, status: string, detail: string, n = 0) =>
    admin.from('inbound_email_log').insert({ company_id, recipient: extractEmail(recipient), sender, subject, status, detail, attachment_count: n, message_id: messageId })

  if (!parsed) { await log(null, 'rejected', 'okand_eller_ogiltig_mottagaradress'); return json({ status: 'rejected', reason: 'unknown_recipient' }) }
  const { data: inbox } = await admin.from('inbox_addresses')
    .select('company_id, is_active').eq('email_address', parsed.email).maybeSingle()
  if (!inbox) { await log(null, 'rejected', 'okant_arkivnummer'); return json({ status: 'rejected', reason: 'unknown_archive_number' }) }
  if (!inbox.is_active) { await log(inbox.company_id, 'rejected', 'adress_inaktiverad'); return json({ status: 'rejected', reason: 'inactive' }) }

  const companyId = inbox.company_id

  // Service-lås (Fas 2-härdning): pausat/blockerat företag får INGA nya affärsdokument via
  // bakgrundsflöden. Kontrollerad affärsavvisning (ej systemfel): logga utan mailbody/base64,
  // skapa inga documents/storage, räkna körningen som lyckad (worker_health ok), svara 200.
  // Genuint DB-läsfel kastar → fångas av yttre catch → system_error (tekniskt fel).
  const serviceState = await getCompanyServiceState(admin, companyId)
  if (isServiceLocked(serviceState)) {
    await log(companyId, 'rejected', `service_${serviceState}`, attachments.length)   // audit, ingen body
    await admin.rpc('record_worker_health', { p_component: 'inbound-email', p_ok: true, p_error: null })
    return json({ status: 'rejected', reason: 'service_locked', state: serviceState })
  }

  const base = {
    company_id: companyId, source: sourceTag, email_from: sender, email_to: parsed.email,
    email_subject: subject, email_body: bodyText, received_at: now, inbound_message_id: messageId,
  }
  const results: any[] = []

  // 3) En inkorgspost per bilaga (klassificeras separat).
  for (const a of attachments) {
    const filename = (a.filename || 'bilaga').toString()
    const size = Number(a.size) || (a.contentBase64 ? Math.floor(a.contentBase64.length * 0.75) : 0)
    const reject = attachmentReject({ filename, contentType: a.contentType, size })

    if (reject === 'blockerad_filtyp' || reject === 'for_stor') { results.push({ filename, skipped: reject }); continue }

    if (reject === 'ej_tillaten_filtyp') {
      await admin.from('documents').insert({ ...base, storage_path: null, file_name: filename, mime_type: a.contentType || null, file_size: size, kategori: 'okand', confidence: 0, status: 'unsupported' })
      results.push({ filename, status: 'unsupported' }); continue
    }

    const cls = classify({ filename, mimeType: a.contentType, subject, bodyText }, true)
    let storage_path: string | null = null
    if (a.contentBase64) {
      const safe = filename.replace(/[^\w.\-]+/g, '_')
      const path = `${companyId}/${crypto.randomUUID()}-${safe}`
      const up = await admin.storage.from(BUCKET).upload(path, base64ToBytes(a.contentBase64), { contentType: a.contentType || 'application/octet-stream', upsert: false })
      if (up.error) await reportErr(admin, 'storage_upload_failure', up.error.message, 'warning', { filename: safe }, companyId)
      else storage_path = path
    }
    const ins = await admin.from('documents').insert({ ...base, storage_path, file_name: filename, mime_type: a.contentType || null, file_size: size, kategori: cls.type, confidence: cls.confidence, status: cls.status })
    if (ins.error) await reportErr(admin, 'db_insert_failure', ins.error.message, 'error', { table: 'documents' }, companyId)
    results.push({ filename, type: cls.type, confidence: cls.confidence, status: cls.status })
  }

  // 4) Inga bilagor -> en post som behöver granskas (kroppen sparas).
  if (attachments.length === 0) {
    await admin.from('documents').insert({ ...base, storage_path: null, file_name: subject || '(utan ämne)', mime_type: null, file_size: null, kategori: 'okand', confidence: 0, status: 'needs_review' })
    await log(companyId, 'needs_review', 'inga_bilagor', 0)
    return json({ status: 'needs_review', created: 1 })
  }

  const created = results.filter(r => r.status).length
  await log(companyId, 'received', JSON.stringify(results).slice(0, 1000), created)
  // Plan-enforcement (soft): varna vid dokumentgräns. Blockerar aldrig import.
  try { await admin.rpc('enforce_plan_limit', { p_company_id: companyId, p_metric: 'documents' }) } catch { /* soft */ }
  await admin.rpc('record_worker_health', { p_component: 'inbound-email', p_ok: true, p_error: null })
  return json({ status: 'received', created, results })
  } catch (err) {
    // Oväntat ohanterat fel i klassificerings-/lagringspipelinen -> notifiera admins.
    await reportErr(admin, 'unhandled_error', (err as Error)?.message || String(err), 'critical')
    return json({ error: 'internal_error' }, 500)
  }
})
