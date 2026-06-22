// Centrala konstanter + validering för support-bilagor (krav 5). Speglas i add_support_attachment (DB)
// och storage-bucketens file_size_limit/allowed_mime_types.

export const MAX_FILE_BYTES = 10 * 1024 * 1024       // 10 MB per fil
export const MAX_FILES_PER_MESSAGE = 5
export const SUPPORT_BUCKET = 'support'

export const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'xlsx', 'docx', 'json', 'webm', 'm4a', 'mp3', 'ogg', 'wav']
export const BLOCKED_EXT = ['exe', 'bat', 'cmd', 'com', 'scr', 'js', 'jar', 'msi', 'sh', 'ps1', 'vbs', 'dll', 'app', 'html', 'htm', 'svg', 'zip']
// Endast dokument/bild i filväljaren; ljudmeddelanden spelas in separat (mikrofon).
export const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx,.docx,.json'

export function fileExt(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

// Lita aldrig på klientens filnamn: ta bort sökväg, sanera, begränsa längd (anti path-traversal).
export function safeFileName(name) {
  const base = String(name || 'fil').split(/[\\/]/).pop()
  const cleaned = base.replace(/[^\w.\-]+/g, '_').replace(/_{2,}/g, '_').replace(/^[._]+/, '')
  return (cleaned || 'fil').slice(0, 120)
}

export function validateFile(file) {
  const ext = fileExt(file?.name)
  if (BLOCKED_EXT.includes(ext)) return 'Filtypen är blockerad av säkerhetsskäl'
  if (!ALLOWED_EXT.includes(ext)) return 'Filtypen stöds inte'
  if ((file?.size || 0) > MAX_FILE_BYTES) return 'Filen är för stor (max 10 MB)'
  return null
}

export function validateFiles(files) {
  if ((files?.length || 0) > MAX_FILES_PER_MESSAGE) return `Max ${MAX_FILES_PER_MESSAGE} filer per meddelande`
  for (const f of files || []) { const e = validateFile(f); if (e) return `${f.name}: ${e}` }
  return null
}

// Storage-nyckel: {companyId}/{ticketId}/{messageId|noteId}/{säkert filnamn} (bucket = support).
export function attachmentPath(companyId, ticketId, refId, fileName) {
  return `${companyId}/${ticketId}/${refId}/${safeFileName(fileName)}`
}

export function formatBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${Math.round(b / 1024)} kB`
  return `${(b / 1048576).toFixed(1)} MB`
}

// Ladda upp filer till storage + registrera metadata via RPC. Kastar vid fel.
export async function uploadSupportAttachments(supabase, { files, companyId, ticketId, messageId = null, noteId = null }) {
  const refId = messageId || noteId
  const err = validateFiles(files)
  if (err) throw new Error(err)
  for (const file of files) {
    const path = attachmentPath(companyId, ticketId, refId, file.name)
    const { error: upErr } = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) throw new Error(`Uppladdning misslyckades: ${file.name}`)
    const { error: metaErr } = await supabase.rpc('add_support_attachment', {
      p_message_id: messageId, p_note_id: noteId, p_file_name: file.name, p_mime: file.type || null, p_size: file.size, p_storage_path: path, p_visibility: null,
    })
    if (metaErr) throw new Error(metaErr.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara bilaga')
  }
}

// Signerad URL (privat bucket) – loggar nedladdning + skapar tidsbegränsad URL. Storage-RLS gatar behörighet.
export async function openSupportAttachment(supabase, att) {
  await supabase.rpc('log_support_attachment_download', { p_attachment_id: att.id })
  const { data, error } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(att.storage_path, 120)
  if (error || !data?.signedUrl) throw new Error('Kunde inte öppna bilagan')
  return data.signedUrl
}
