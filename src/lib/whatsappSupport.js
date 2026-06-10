// Ren logik för WhatsApp-supportlänk (wa.me). Detta är ENDAST en snabb supportväg –
// ingen WhatsApp API-integration, inga webhooks, ingen inbox-sync, ingen datamodell.
// WhatsApp är inte en officiell kanal för bokföringsunderlag (se GDPR-varningen nedan).
// Telefonnumret kommer alltid från env (VITE_BOKPILOT_SUPPORT_WHATSAPP_NUMBER) – aldrig
// hårdkodat i komponenterna.

export const WHATSAPP_BUTTON_LABEL = 'Kontakta support via WhatsApp'

export const WHATSAPP_GDPR_WARNING =
  'Skicka inte bokföringsunderlag eller känsliga dokument via WhatsApp. ' +
  'Ladda upp underlag i BokPilot eller mejla till din underlagsadress.'

// wa.me kräver enbart siffror (landsnummer utan +, mellanslag eller bindestreck).
export function normalizeWhatsAppNumber(raw) {
  return String(raw ?? '').replace(/\D/g, '')
}

// Hämtar supportnumret från env. Returnerar '' om det saknas (då döljs knappen).
export function getSupportWhatsAppNumber(env) {
  const source = env || (typeof import.meta !== 'undefined' && import.meta.env) || {}
  return normalizeWhatsAppNumber(source.VITE_BOKPILOT_SUPPORT_WHATSAPP_NUMBER)
}

// Bygger den förifyllda svenska texten. company_name/user_email/current_path tas alltid
// med; org.nr och arkivnummer endast om de finns; status endast om kontot är pausat/blockerat.
export function buildWhatsAppMessage(ctx = {}) {
  const { company_name, org_number, archive_number, user_email, current_path, service_state } = ctx
  const lines = ['Hej BokPilot, jag behöver hjälp.', '']
  lines.push(`Företag: ${company_name || '—'}`)
  if (org_number) lines.push(`Org.nr: ${org_number}`)
  if (archive_number) lines.push(`Arkivnummer: ${archive_number}`)
  lines.push(`Användare: ${user_email || '—'}`)
  lines.push(`Sida: ${current_path || '—'}`)
  if (service_state === 'paused' || service_state === 'blocked') lines.push(`Status: ${service_state}`)
  lines.push('', 'Beskrivning:')
  return lines.join('\n')
}

// Bygger wa.me-länken. Returnerar null om numret saknas (→ ingen knapp).
export function buildWhatsAppUrl(number, message) {
  const num = normalizeWhatsAppNumber(number)
  if (!num) return null
  return `https://wa.me/${num}?text=${encodeURIComponent(message || '')}`
}
