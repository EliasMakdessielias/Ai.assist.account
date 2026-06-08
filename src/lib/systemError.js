// System-error-rapportering: gemensam, säker helper. Canonical-logik (testas i vitest);
// speglas inline i edge functions (Deno) + används av Node-workers.
// Säkerhet: ALDRIG tokens, credentials, fakturainnehåll eller fulla email-bodies i metadata.

export const SEVERITY = ['warning', 'error', 'critical']

// Nyckel-namn som ALLTID redigeras bort ur metadata.
const SENSITIVE_KEY = /pass(word)?|secret|token|auth|credential|cookie|api[_-]?key|\bkey\b|bearer|body|base64|content|iban|bic|ocr|swish|cvc|pan/i
const MAX_STR = 300
const MAX_KEYS = 20

export function normalizeSeverity(s) {
  return SEVERITY.includes(s) ? s : 'error'
}

// warning -> in_app only; error/critical -> in_app + email (krav 8).
export function severityRouting(severity) {
  switch (normalizeSeverity(severity)) {
    case 'warning': return { channels: ['in_app'], priority: 'normal' }
    case 'critical': return { channels: ['in_app', 'email'], priority: 'urgent' }
    default: return { channels: ['in_app', 'email'], priority: 'high' }
  }
}

// UTC timme-bucket "YYYYMMDDHH" (matchar to_char(...,'YYYYMMDDHH24') i DB).
export function hourBucket(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const p = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`
}

export function normalizeErrorCode(code) {
  return String(code || 'unknown').slice(0, 60).replace(/[^a-zA-Z0-9_.\-]/g, '_') || 'unknown'
}

// Dedupe (krav 9): system_error:{component}:{errorCode}:{hourBucket}
export function dedupeKey(component, errorCode, bucket = hourBucket()) {
  return `system_error:${String(component || 'okänd')}:${normalizeErrorCode(errorCode)}:${bucket}`
}

// Sanera metadata: ta bort känsliga nycklar, trunkera strängar, begränsa storlek/djup.
export function sanitizeMetadata(meta, depth = 0) {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const out = {}
  let n = 0
  for (const [k, v] of Object.entries(meta)) {
    if (n++ >= MAX_KEYS) break
    if (SENSITIVE_KEY.test(k)) { out[k] = '[redacted]'; continue }
    if (v == null || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v
    else if (Array.isArray(v)) out[k] = `[array(${v.length})]`
    else if (typeof v === 'object' && depth < 1) out[k] = sanitizeMetadata(v, depth + 1)
    else out[k] = '[object]'
  }
  return out
}

// Bygg ett komplett, sanerat error-report-objekt (för RPC eller edge-endpoint).
export function buildErrorReport({ component, severity, errorCode, message, metadata, occurredAt } = {}) {
  const sev = normalizeSeverity(severity)
  return {
    component: String(component || 'okänd').slice(0, 60),
    severity: sev,
    errorCode: normalizeErrorCode(errorCode),
    message: String(message || '').slice(0, 300),
    metadata: sanitizeMetadata(metadata),
    occurredAt: occurredAt || new Date().toISOString(),
    ...severityRouting(sev),
  }
}

// RPC-parametrar för report_system_error (snake_case) från ett report-objekt.
export function toRpcParams(report, companyId = null) {
  return {
    p_component: report.component,
    p_message: report.message,
    p_company_id: companyId,
    p_severity: report.severity,
    p_error_code: report.errorCode,
    p_metadata: report.metadata,
    p_occurred_at: report.occurredAt,
  }
}
