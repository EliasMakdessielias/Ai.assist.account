// Delad logik för företagets inbound-mottagningsadresser (arkiv.bokpilot.se).
// Används av UI, tester och – i en egen kopia – av edge-funktionen inbound-email.
//
// Format: {0000001}.{typ}@arkiv.bokpilot.se   (typ = kvitto | leverantorsfaktura | dokument | avtal)
// Adresserna är ENBART inbound: ingen inloggning, inget lösenord, ingen utgående post.

export const INBOX_DOMAIN = 'arkiv.bokpilot.se'

// Typ -> etikett (UI) + kategori i documents-tabellen (inkorgsflödet).
export const INBOX_TYPES = [
  { type: 'kvitto', label: 'Kvitton', kategori: 'kvitto' },
  { type: 'leverantorsfaktura', label: 'Leverantörsfakturor', kategori: 'leverantorsfaktura' },
  { type: 'dokument', label: 'Dokument', kategori: 'dokument' },
  { type: 'avtal', label: 'Avtal', kategori: 'avtal' },
]
export const INBOX_TYPE_KEYS = INBOX_TYPES.map(t => t.type)

// Nollutfyllt företagsnummer, t.ex. 1 -> "0000001".
export function companyNumberToPrefix(n, width = 7) {
  if (n === null || n === undefined || n === '') return null
  const num = Number(n)
  if (!Number.isFinite(num) || num < 1) return null
  return String(Math.floor(num)).padStart(width, '0')
}

// Bygg en adress av prefix (eller nummer) + typ.
export function buildInboxAddress(prefixOrNumber, type) {
  const prefix = /^\d+$/.test(String(prefixOrNumber))
    ? companyNumberToPrefix(prefixOrNumber)
    : String(prefixOrNumber)
  if (!prefix || !INBOX_TYPE_KEYS.includes(type)) return null
  return `${prefix}.${type}@${INBOX_DOMAIN}`
}

// De fyra adresserna för ett företagsnummer.
export function buildInboxAddresses(companyNumber) {
  const prefix = companyNumberToPrefix(companyNumber)
  if (!prefix) return []
  return INBOX_TYPES.map(t => ({ ...t, email_address: `${prefix}.${t.type}@${INBOX_DOMAIN}` }))
}

// Plocka ut ren e-postadress ur t.ex. `"Namn" <a@b.se>` eller `<a@b.se>`.
export function extractEmail(raw) {
  if (!raw) return ''
  const m = String(raw).match(/<([^>]+)>/)
  return (m ? m[1] : String(raw)).trim().toLowerCase()
}

// Tolka en mottagaradress -> { prefix, type, kategori } eller null om okänd/ogiltig.
// Validerar domän OCH att typen är en av de tillåtna (säkerhet: okända nekas).
export function parseInboxRecipient(raw) {
  const addr = extractEmail(raw)
  const m = addr.match(/^(\d{1,12})\.([a-z]+)@(.+)$/)
  if (!m) return null
  const [, prefix, type, domain] = m
  if (domain !== INBOX_DOMAIN) return null
  if (!INBOX_TYPE_KEYS.includes(type)) return null
  const def = INBOX_TYPES.find(t => t.type === type)
  return { prefix, type, kategori: def.kategori, email_address: addr }
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
