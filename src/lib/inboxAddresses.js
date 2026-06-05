// Delad logik för företagets inbound-mottagningsadresser (arkiv.bokpilot.se).
// Används av UI, tester och – i en egen kopia – av edge-funktionen inbound-email.
//
// Format: {0000001}.{typ}@arkiv.bokpilot.se   (typ = kvitto | leverantorsfaktura | dokument | avtal)
// Adresserna är ENBART inbound: ingen inloggning, inget lösenord, ingen utgående post.

export const INBOX_DOMAIN = 'arkiv.bokpilot.se'

// Typ -> kort suffix i adressen + etikett (UI) + kategori i documents-tabellen.
// Suffixen är medvetet korta (kvi/lev/dok/avt) och prefixet är företagets
// SLUMPMÄSSIGA arkivnummer (avslöjar inte antal kunder).
export const INBOX_TYPES = [
  { type: 'kvitto', suffix: 'kvi', label: 'Kvitton', kategori: 'kvitto' },
  { type: 'leverantorsfaktura', suffix: 'lev', label: 'Leverantörsfakturor', kategori: 'leverantorsfaktura' },
  { type: 'dokument', suffix: 'dok', label: 'Dokument', kategori: 'dokument' },
  { type: 'avtal', suffix: 'avt', label: 'Avtal', kategori: 'avtal' },
]
export const INBOX_TYPE_KEYS = INBOX_TYPES.map(t => t.type)
export const INBOX_SUFFIXES = INBOX_TYPES.map(t => t.suffix)
const TYPE_BY_SUFFIX = Object.fromEntries(INBOX_TYPES.map(t => [t.suffix, t]))
const SUFFIX_BY_TYPE = Object.fromEntries(INBOX_TYPES.map(t => [t.type, t.suffix]))

// Arkivnummer: 7 siffror, 1000000-9999999 (börjar aldrig med 0).
export const ARCHIVE_MIN = 1000000
export const ARCHIVE_MAX = 9999999

export function isValidArchiveNumber(n) {
  const num = Number(n)
  return Number.isInteger(num) && num >= ARCHIVE_MIN && num <= ARCHIVE_MAX
}

// Klientsidig generator (databasen är auktoritativ + gör unik-kontroll).
export function generateArchiveNumber(rand = Math.random) {
  return ARCHIVE_MIN + Math.floor(rand() * (ARCHIVE_MAX - ARCHIVE_MIN + 1))
}

// Bygg en adress av arkivnummer + typ.
export function buildInboxAddress(archiveNumber, type) {
  if (!isValidArchiveNumber(archiveNumber)) return null
  const sfx = SUFFIX_BY_TYPE[type]
  if (!sfx) return null
  return `${archiveNumber}.${sfx}@${INBOX_DOMAIN}`
}

// De fyra adresserna för ett arkivnummer.
export function buildInboxAddresses(archiveNumber) {
  if (!isValidArchiveNumber(archiveNumber)) return []
  return INBOX_TYPES.map(t => ({ ...t, email_address: `${archiveNumber}.${t.suffix}@${INBOX_DOMAIN}` }))
}

// Plocka ut ren e-postadress ur t.ex. `"Namn" <a@b.se>` eller `<a@b.se>`.
export function extractEmail(raw) {
  if (!raw) return ''
  const m = String(raw).match(/<([^>]+)>/)
  return (m ? m[1] : String(raw)).trim().toLowerCase()
}

// Tolka en mottagaradress -> { archiveNumber, suffix, type, kategori } eller null.
// Validerar domän, 7-siffrigt arkivnummer (1-9 först) OCH giltigt suffix
// (kvi/lev/dok/avt). Okänd domän/suffix nekas (säkerhet).
export function parseInboxRecipient(raw) {
  const addr = extractEmail(raw)
  const m = addr.match(/^([1-9]\d{6})\.([a-z]{3})@(.+)$/)
  if (!m) return null
  const [, archiveNumber, suffix, domain] = m
  if (domain !== INBOX_DOMAIN) return null
  const def = TYPE_BY_SUFFIX[suffix]
  if (!def) return null
  return { archiveNumber, suffix, type: def.type, kategori: def.kategori, email_address: addr }
}

// ---- Bilage-validering (säkerhet) ----
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB per bilaga
export const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'docx']
export const ALLOWED_MIME = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
// Tydligt farliga ändelser som alltid blockeras (extra skydd utöver allowlist).
export const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'scr', 'js', 'jar', 'msi', 'sh', 'ps1', 'vbs', 'dll', 'app', 'html', 'htm', 'svg', 'zip']

export function fileExtension(filename = '') {
  const m = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

// Tillåten bilaga = ändelse i allowlist, inte i blocklist, och inom storleksgräns.
export function isAllowedAttachment({ filename = '', contentType = '', size = 0 } = {}) {
  const ext = fileExtension(filename)
  if (BLOCKED_EXTENSIONS.includes(ext)) return false
  if (size && size > MAX_ATTACHMENT_BYTES) return false
  if (ext && ALLOWED_EXTENSIONS.includes(ext)) return true
  // Tillåt även på giltig MIME om ändelse saknas (vissa providers utelämnar den).
  if (!ext && ALLOWED_MIME.includes(String(contentType).toLowerCase())) return true
  return false
}

export function rejectionReason({ filename = '', contentType = '', size = 0 } = {}) {
  const ext = fileExtension(filename)
  if (BLOCKED_EXTENSIONS.includes(ext)) return 'blockerad_filtyp'
  if (size && size > MAX_ATTACHMENT_BYTES) return 'for_stor'
  if (!isAllowedAttachment({ filename, contentType, size })) return 'ej_tillaten_filtyp'
  return null
}
