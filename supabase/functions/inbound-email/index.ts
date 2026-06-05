// Inbound-email webhook för BokPilot (bpilot.se).
//
// Tar emot inkommande e-post (rekommenderat relä: Cloudflare Email Worker, se
// docs/inbound-email.md), identifierar företaget via arkivnumret i mottagar-
// adressen ({archiveNumber}.underlag@bpilot.se), lagrar varje bilaga och skapar
// EN inkorgspost per bilaga i `documents` med automatisk klassificering. ENDAST
// inbound – inga utgående funktioner.
//
// Deploy (HMAC-autentisering, ej JWT):
//   supabase functions deploy inbound-email --no-verify-jwt --project-ref bypebgvxdmbzxqecllao
// Secrets: INBOUND_WEBHOOK_SECRET (+ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY auto).
//
// Webhook-kontrakt (POST JSON):
//   Header  X-Bokpilot-Signature: sha256=<hex(hmacSHA256(rawBody, secret))>
//   Body    { to, from, subject, text, attachments:[{filename, contentType, contentBase64, size}] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'underlag'
const INBOX_DOMAIN = 'in.bokpilot.se'
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
// {archiveNumber}.underlag@bpilot.se -> archiveNumber, annars null.
function parseRecipient(raw: string): { archiveNumber: string; email: string } | null {
  const addr = extractEmail(raw)
  const m = addr.match(/^([1-9]\d{6})underlag@(.+)$/)
  if (!m) return null
  const [, archiveNumber, domain] = m
  if (domain !== INBOX_DOMAIN) return null
  return { archiveNumber, email: addr }
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
  const SECRET = Deno.env.get('INBOUND_WEBHOOK_SECRET') || ''
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1) Verifiera HMAC-signatur över rå body.
  const raw = await req.text()
  const provided = (req.headers.get('X-Bokpilot-Signature') || '').replace(/^sha256=/, '').trim().toLowerCase()
  if (!SECRET || !provided) return json({ error: 'missing_signature' }, 401)
  if (!timingSafeEqual(provided, await hmacSha256Hex(SECRET, raw))) return json({ error: 'invalid_signature' }, 401)

  let payload: any
  try { payload = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }

  const recipient = String(payload.to || '')
  const sender = extractEmail(String(payload.from || ''))
  const subject = (payload.subject || '').toString().slice(0, 500)
  const bodyText = (payload.text || '').toString().slice(0, 100000)
  const attachments: any[] = Array.isArray(payload.attachments) ? payload.attachments : []
  const now = new Date().toISOString()

  const log = (company_id: string | null, status: string, detail: string, n = 0) =>
    admin.from('inbound_email_log').insert({ company_id, recipient: extractEmail(recipient), sender, subject, status, detail, attachment_count: n })

  // 2) Tolka mottagaradress + slå upp aktivt företag (okänt arkivnummer nekas).
  const parsed = parseRecipient(recipient)
  if (!parsed) { await log(null, 'rejected', 'okand_eller_ogiltig_mottagaradress'); return json({ status: 'rejected', reason: 'unknown_recipient' }) }
  const { data: inbox } = await admin.from('inbox_addresses')
    .select('company_id, is_active').eq('email_address', parsed.email).maybeSingle()
  if (!inbox) { await log(null, 'rejected', 'okant_arkivnummer'); return json({ status: 'rejected', reason: 'unknown_archive_number' }) }
  if (!inbox.is_active) { await log(inbox.company_id, 'rejected', 'adress_inaktiverad'); return json({ status: 'rejected', reason: 'inactive' }) }

  const companyId = inbox.company_id
  const base = {
    company_id: companyId, source: 'email', email_from: sender, email_to: parsed.email,
    email_subject: subject, email_body: bodyText, received_at: now,
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
      if (!up.error) storage_path = path
    }
    await admin.from('documents').insert({ ...base, storage_path, file_name: filename, mime_type: a.contentType || null, file_size: size, kategori: cls.type, confidence: cls.confidence, status: cls.status })
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
  return json({ status: 'received', created, results })
})
