// Ren leveranslogik för email-kö-processorn (scripts/email-worker).
// Testbar utan nätverk/DB. Edge-funktionen notif-unsubscribe speglar token-logiken.
import { createHmac } from 'node:crypto'
import { MANDATORY_EVENTS } from './notifications.js'

// Events där email aldrig får stängas av via unsubscribe (säkerhets-/systemkritiskt).
export const NON_UNSUBSCRIBABLE = new Set(MANDATORY_EVENTS)

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// Exponentiell backoff i minuter: 2^attemptCount, tak 60 min. attemptCount = antal gjorda försök.
export function backoffMinutes(attemptCount, { capMinutes = 60 } = {}) {
  const n = Math.max(0, Number(attemptCount) || 0)
  return Math.min(capMinutes, Math.pow(2, n))
}

// När ska nästa försök ske? Returnerar ISO-sträng (now + backoff). `now` injiceras för testbarhet.
export function nextRetryAt(attemptCount, now, opts) {
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return new Date(base + backoffMinutes(attemptCount, opts) * 60_000).toISOString()
}

// Permanent fel (ingen retry): saknad/ogiltig adress, hård SMTP-avvisning av mottagare.
export function isPermanentFailure(reason) {
  if (!reason) return false
  const r = String(reason).toLowerCase()
  if (/missing|no recipient|saknar|invalid email|ogiltig/.test(r)) return true
  // 5xx-koder som gäller mottagaren (ej tillfälliga 4xx).
  if (/\b5\.[157]\.\d\b/.test(r)) return true // 5.1.x adress finns ej, 5.5.x, 5.7.x policy
  if (/550|551|553|554/.test(r)) return true
  return false
}

// Avgör om en köpost ska skickas, hoppas över eller faila permanent — innan SMTP.
// row: { status, channel, scheduled_at, attempt_count, max_attempts, next_retry_at }
export function deliveryDecision(row, { recipientEmail, now = new Date() } = {}) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (row.channel !== 'email') return { action: 'skip', reason: 'not-email' }
  if (row.scheduled_at && new Date(row.scheduled_at).getTime() > t) return { action: 'wait', reason: 'scheduled' }
  if (row.next_retry_at && new Date(row.next_retry_at).getTime() > t) return { action: 'wait', reason: 'retry-pending' }
  if ((row.attempt_count || 0) >= (row.max_attempts || 5)) return { action: 'fail', reason: 'max-attempts' }
  if (!isValidEmail(recipientEmail)) return { action: 'fail', reason: 'missing-or-invalid-email', permanent: true }
  return { action: 'send' }
}

// Beräkna nästa status efter ett misslyckande.
export function failureTransition(row, reason, now = new Date()) {
  const attempts = (row.attempt_count || 0) + 1
  const permanent = isPermanentFailure(reason)
  const exhausted = attempts >= (row.max_attempts || 5)
  if (permanent || exhausted) {
    return { status: 'failed', attempt_count: attempts, next_retry_at: null, error_message: String(reason).slice(0, 500) }
  }
  return { status: 'pending', attempt_count: attempts, next_retry_at: nextRetryAt(attempts, now), error_message: String(reason).slice(0, 500) }
}

// --- Unsubscribe-token (HMAC). Format: base64url(userId|eventType).hmac ---
function b64url(s) { return Buffer.from(s, 'utf8').toString('base64url') }
function unb64url(s) { return Buffer.from(s, 'base64url').toString('utf8') }

export function buildUnsubToken(userId, eventType, secret) {
  const payload = `${userId}|${eventType}`
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${b64url(payload)}.${sig}`
}

export function verifyUnsubToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [p, sig] = token.split('.')
  let payload
  try { payload = unb64url(p) } catch { return null }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  if (sig !== expected) return null
  const [userId, eventType] = payload.split('|')
  if (!userId || !eventType) return null
  return { userId, eventType }
}

// Bygg unsubscribe-URL (eller null för obligatoriska/icke-avregistrerbara events).
export function unsubscribeUrl(baseUrl, userId, eventType, secret) {
  if (NON_UNSUBSCRIBABLE.has(eventType)) return null
  return `${baseUrl}?token=${encodeURIComponent(buildUnsubToken(userId, eventType, secret))}`
}

// Footer som läggs till i email. Obligatoriska events får ingen avregistreringslänk.
export function emailFooter({ companyName, unsubUrl }) {
  const brand = companyName ? `BokPilot · ${companyName}` : 'BokPilot'
  const unsubText = unsubUrl ? `\n\nVill du inte få den här typen av notiser? Avregistrera: ${unsubUrl}` : ''
  const unsubHtml = unsubUrl
    ? `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Vill du inte få den här typen av notiser? <a href="${unsubUrl}" style="color:#6b7280">Avregistrera</a>.</p>`
    : ''
  return {
    text: `\n\n— ${brand}${unsubText}`,
    html: `<hr style="border:none;border-top:1px solid #eee;margin:24px 0 8px"/><p style="margin:0;font-size:12px;color:#9ca3af">— ${brand}</p>${unsubHtml}`,
  }
}

export const APP_ORIGIN = 'https://app.bokpilot.se'
// Relativa länkar (t.ex. /inkorg) måste göras absoluta i e-post – relativa href fungerar inte i mejlklienter.
export function absoluteUrl(url) {
  if (!url) return ''
  return /^https?:\/\//i.test(url) ? url : APP_ORIGIN + (url.startsWith('/') ? url : '/' + url)
}

// Bygg HTML-mail från subject/body (text) + ev. action-länk i link_url.
export function buildEmailHtml({ subject, body, linkUrl, footer }) {
  const safe = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const para = safe(body).split(/\n+/).filter(Boolean).map(p => `<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.5">${p}</p>`).join('')
  const href = absoluteUrl(linkUrl)
  const cta = href
    ? `<p style="margin:20px 0"><a href="${href}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block">Öppna i BokPilot</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f9fafb;padding:24px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<h1 style="margin:0 0 16px;font-size:18px;color:#111827">${safe(subject)}</h1>${para}${cta}${footer?.html || ''}</div></body></html>`
}
