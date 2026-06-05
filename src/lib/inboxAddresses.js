// Delad logik för företagets EN inbound-mottagningsadress (bpilot.se).
// Används av UI, tester och – i en egen kopia – av edge-funktionen inbound-email.
//
// Format: {archiveNumber}.underlag@bpilot.se   (t.ex. 8063151.underlag@bpilot.se)
// Adressen är ENBART inbound: ingen inloggning, inget lösenord, ingen utgående post.
// Klassificering av varje bilaga görs vid mottagning (se classifyDocument.js).

export const INBOX_DOMAIN = 'bokpilot.se'
export const INBOX_LOCAL = 'ulag'

// Klassificeringskategorier (detekterad typ) + UI-etikett + ikon (Inkorg-flikar).
export const INBOX_CATEGORIES = [
  { key: 'kvitto', label: 'Kvitton', icon: 'ti-receipt', tolka: true, create: 'verifikation' },
  { key: 'leverantorsfaktura', label: 'Leverantörsfakturor', icon: 'ti-file-invoice', tolka: true, create: 'lev' },
  { key: 'kundfaktura', label: 'Kundfakturor', icon: 'ti-file-dollar', tolka: false },
  { key: 'dokument', label: 'Dokument', icon: 'ti-file-text', tolka: false },
  { key: 'avtal', label: 'Avtal', icon: 'ti-file-certificate', tolka: false },
  { key: 'okand', label: 'Behöver granskas', icon: 'ti-help-circle', tolka: false },
]
export function inboxCategoryLabel(key) {
  return INBOX_CATEGORIES.find(c => c.key === key)?.label || 'Dokument'
}

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

// Bygg företagets enda mottagningsadress av arkivnummer.
export function buildInboxAddress(archiveNumber) {
  if (!isValidArchiveNumber(archiveNumber)) return null
  return `${archiveNumber}.${INBOX_LOCAL}@${INBOX_DOMAIN}`
}

// Plocka ut ren e-postadress ur t.ex. `"Namn" <a@b.se>` eller `<a@b.se>`.
export function extractEmail(raw) {
  if (!raw) return ''
  const m = String(raw).match(/<([^>]+)>/)
  return (m ? m[1] : String(raw)).trim().toLowerCase()
}

// Tolka en mottagaradress -> { archiveNumber, email_address } eller null.
// Validerar domän, 7-siffrigt arkivnummer (1-9 först) och local-part "underlag".
// Okänd domän/format nekas (säkerhet).
export function parseInboxRecipient(raw) {
  const addr = extractEmail(raw)
  const m = addr.match(/^([1-9]\d{6})\.ulag@(.+)$/)
  if (!m) return null
  const [, archiveNumber, domain] = m
  if (domain !== INBOX_DOMAIN) return null
  return { archiveNumber, email_address: addr }
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
