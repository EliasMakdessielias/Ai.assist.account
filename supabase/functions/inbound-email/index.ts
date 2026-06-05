// Inbound-email webhook för BokPilot (arkiv.bokpilot.se).
//
// Tar emot inkommande e-post från en mail-provider/relay (rekommenderat:
// Cloudflare Email Worker, se docs/inbound-email.md), identifierar företag +
// typ via mottagaradressen, lagrar bilagor i Storage och skapar inkorgsposter
// i `documents`. ENDAST inbound – inga utgående funktioner.
//
// Deploy (utan JWT-verifiering, webhooken autentiseras via HMAC-signatur):
//   supabase functions deploy inbound-email --no-verify-jwt --project-ref bypebgvxdmbzxqecllao
// Secrets som måste sättas:
//   INBOUND_WEBHOOK_SECRET   (delad hemlighet för HMAC-signatur)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (sätts automatiskt av plattformen)
//
// Webhook-kontrakt (JSON, POST):
//   Header  X-Bokpilot-Signature: sha256=<hex(hmacSHA256(rawBody, secret))>
//   Body    { to, from, subject, text, attachments:[{filename, contentType, contentBase64, size}] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'underlag'
const INBOX_DOMAIN = 'arkiv.bokpilot.se'
const INBOX_TYPES: Record<string, string> = {
  kvitto: 'kvitto', leverantorsfaktura: 'leverantorsfaktura', dokument: 'dokument', avtal: 'avtal',
}
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

function extractEmail(raw: string): string {
  if (!raw) return ''
  const m = String(raw).match(/<([^>]+)>/)
  return (m ? m[1] : String(raw)).trim().toLowerCase()
}

function parseRecipient(raw: string): { type: string; kategori: string; email: string } | null {
  const addr = extractEmail(raw)
  const m = addr.match(/^(\d{1,12})\.([a-z]+)@(.+)$/)
  if (!m) return null
  const [, , type, domain] = m
  if (domain !== INBOX_DOMAIN || !INBOX_TYPES[type]) return null
  return { type, kategori: INBOX_TYPES[type], email: addr }
}

function fileExt(name = ''): string {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}
function attachmentReject(a: { filename?: string; contentType?: string; size?: number }): string | null {
  const ext = fileExt(a.filename || '')
  if (BLOCKED_EXTENSIONS.includes(ext)) return 'blockerad_filtyp'
  if ((a.size || 0) > MAX_ATTACHMENT_BYTES) return 'for_stor'
  if (ext && ALLOWED_EXTENSIONS.includes(ext)) return null
  if (!ext && ALLOWED_MIME.includes(String(a.contentType || '').toLowerCase())) return null
  return 'ej_tillaten_filtyp'
}

// Konstant-tids-jämförelse av hex-strängar.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
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
  const SECRET = Deno.env.get('INBOUND_WEBHOOK_SECRET') || ''
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1) Läs rå body + verifiera HMAC-signatur (skydd mot förfalskade anrop).
  const raw = await req.text()
  const header = req.headers.get('X-Bokpilot-Signature') || ''
  const provided = header.replace(/^sha256=/, '').trim().toLowerCase()
  if (!SECRET || !provided) return json({ error: 'missing_signature' }, 401)
  const expected = await hmacSha256Hex(SECRET, raw)
  if (!timingSafeEqual(provided, expected)) return json({ error: 'invalid_signature' }, 401)

  let payload: any
  try { payload = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }

  const recipient = String(payload.to || '')
  const sender = extractEmail(String(payload.from || ''))
  const subject = (payload.subject || '').toString().slice(0, 500)
  const bodyText = (payload.text || '').toString().slice(0, 100000)
  const attachments: any[] = Array.isArray(payload.attachments) ? payload.attachments : []
  const now = new Date().toISOString()

  const log = (company_id: string | null, status: string, detail: string, attachment_count = 0) =>
    admin.from('inbound_email_log').insert({ company_id, recipient: extractEmail(recipient), sender, subject, status, detail, attachment_count })

  // 2) Validera mottagaradress + slå upp aktivt företag (okänd adress nekas).
  const parsed = parseRecipient(recipient)
  if (!parsed) { await log(null, 'rejected', 'okand_eller_ogiltig_mottagaradress'); return json({ status: 'rejected', reason: 'unknown_recipient' }) }

  const { data: inbox } = await admin.from('inbox_addresses')
    .select('company_id, inbox_type, is_active').eq('email_address', parsed.email).maybeSingle()
  if (!inbox) { await log(null, 'rejected', 'mottagaradress_finns_ej'); return json({ status: 'rejected', reason: 'unknown_recipient' }) }
  if (!inbox.is_active) { await log(inbox.company_id, 'rejected', 'mottagaradress_inaktiverad'); return json({ status: 'rejected', reason: 'inactive_recipient' }) }

  const companyId = inbox.company_id
  const kategori = parsed.kategori
  const warnings: string[] = []
  let stored = 0

  // 3) Lagra bilagor (validera typ/storlek; blockera riskabla filer).
  for (const a of attachments) {
    const filename = (a.filename || 'bilaga').toString()
    const size = Number(a.size) || (a.contentBase64 ? Math.floor(a.contentBase64.length * 0.75) : 0)
    const reason = attachmentReject({ filename, contentType: a.contentType, size })
    if (reason) { warnings.push(`${filename}: ${reason}`); continue }
    if (!a.contentBase64) { warnings.push(`${filename}: saknar_innehall`); continue }
    try {
      const bytes = base64ToBytes(a.contentBase64)
      const safe = filename.replace(/[^\w.\-]+/g, '_')
      const path = `${companyId}/${crypto.randomUUID()}-${safe}`
      const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: a.contentType || 'application/octet-stream', upsert: false })
      if (up.error) { warnings.push(`${filename}: uppladdning_misslyckades`); continue }
      const ins = await admin.from('documents').insert({
        company_id: companyId, storage_path: path, file_name: filename,
        mime_type: a.contentType || null, file_size: size, kategori,
        source: 'email', status: 'new', email_from: sender, email_to: parsed.email,
        email_subject: subject, email_body: bodyText, received_at: now,
      })
      if (ins.error) { warnings.push(`${filename}: db_fel`); continue }
      stored++
    } catch (_e) { warnings.push(`${filename}: fel_vid_lagring`) }
  }

  // 4) Inga giltiga bilagor -> skapa inkorgspost med status needs_review (kropp sparas).
  if (stored === 0) {
    await admin.from('documents').insert({
      company_id: companyId, storage_path: null, file_name: subject || '(utan ämne)',
      mime_type: null, file_size: null, kategori,
      source: 'email', status: 'needs_review', email_from: sender, email_to: parsed.email,
      email_subject: subject, email_body: bodyText, received_at: now,
    })
    await log(companyId, 'needs_review', warnings.length ? warnings.join('; ') : 'inga_bilagor', attachments.length)
    return json({ status: 'needs_review', stored: 0, warnings })
  }

  await log(companyId, warnings.length ? 'received_with_warnings' : 'received', warnings.join('; '), stored)
  return json({ status: 'received', stored, warnings, inboxType: inbox.inbox_type })
})
