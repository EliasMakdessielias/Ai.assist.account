// Testbar parsning av mottagaradress för IMAP-importern.
// Accepterar ENDAST {archiveNumber}underlag@bokpilot.se (5–10 siffror).

export const INBOX_DOMAIN = 'bokpilot.se'

// Tolka ett enskilt header-värde -> { archiveNumber, email } eller null.
export function parseRecipient(raw) {
  if (!raw) return null
  const m = String(raw).match(/<([^>]+)>/)
  const addr = (m ? m[1] : String(raw)).trim().toLowerCase()
  const mm = addr.match(/^([0-9]{5,10})underlag@(.+)$/)
  if (!mm) return null
  if (mm[2] !== INBOX_DOMAIN) return null
  return { archiveNumber: mm[1], email: addr }
}

// Plocka första giltiga mottagaren ur en lista av header-värden
// (ordning: Delivered-To, X-Original-To, Envelope-To, To, Cc). Hanterar
// kommaseparerade värden och "Namn <adress>".
export function pickRecipient(values) {
  for (const v of values) {
    if (!v) continue
    for (const part of String(v).split(',')) {
      const r = parseRecipient(part)
      if (r) return r.email
    }
  }
  return null
}

// Klassificera inbound-email-webhookens svar (Fas 2-härdning). Avgör hur IMAP-importern
// ska behandla mejlet:
//   'processed'      – mottaget/needs_review/dubblett → flytta till Processed, räkna som klart
//   'service_locked' – företaget pausat/blockerat → AFFÄRSAVVISNING (ej systemfel): flytta undan,
//                      ingen retry-loop, INGET system_error
//   'failed'         – tekniskt fel (webhook 5xx/oväntat) → flytta till Failed, rapportera som
//                      system_error vid upprepade fel
// Princip (krav 4): service-lock = business rejection; upprepade tekniska webhookfel = system_error.
export function classifyWebhookOutcome(res) {
  const st = res?.body?.status
  const reason = res?.body?.reason
  if (res?.ok && (st === 'received' || st === 'needs_review' || st === 'duplicate')) return 'processed'
  if (res?.ok && st === 'rejected' && reason === 'service_locked') return 'service_locked'
  return 'failed'
}
