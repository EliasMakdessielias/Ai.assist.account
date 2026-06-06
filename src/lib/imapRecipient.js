// Hjälp för IMAP-importen: hitta rätt mottagaradress bland ett mejls
// adress-headers (To, Delivered-To, X-Original-To, Cc) och plocka ut arkivnumret.
// Återanvänder samma format-/domänregler som webhooken (parseInboxRecipient).
import { parseInboxRecipient } from './inboxAddresses'

// headerValues: array av råa header-strängar. Varje sträng kan innehålla flera
// adresser (kommaseparerade) och formen `"Namn" <adr@dom>`. Returnerar första
// adressen som matchar {archiveNumber}underlag@bokpilot.se, annars null.
export function pickInboxRecipient(headerValues = []) {
  const candidates = []
  for (const hv of headerValues) {
    if (!hv) continue
    for (const part of String(hv).split(',')) {
      const p = part.trim()
      if (p) candidates.push(p)
    }
  }
  for (const c of candidates) {
    const hit = parseInboxRecipient(c)
    if (hit) return hit
  }
  return null
}

// Idempotensnyckel för ett inkommande mejl. Message-ID är primärt; saknas det
// används en stabil hash på messageId + första bilagan + storlek (krav 11).
export function importKey({ messageId, firstAttachmentName = '', size = 0 } = {}) {
  const id = (messageId || '').trim()
  if (id) return id
  return `noid:${firstAttachmentName}:${size}`
}
