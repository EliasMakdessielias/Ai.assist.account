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
