// Behandlingshistorik (audit trail) för bokföringshändelser – Bokföringslagen (1999:1078).
// Ren logik (inga React/Supabase-beroenden). DB-sidan: trigger-funktioner + RPC
// `log_accounting_audit` (supabase/audit_bokforing.sql) loggar bokföringshändelser i `audit_log`.
// Denna modul äger sekretess-redaktionen för OCR-tolkning + de centrala konstanterna.

// Audit-actions (måste matcha SQL-triggrarna).
export const ACCOUNTING_AUDIT_ACTIONS = {
  verificationCreated: 'verification_created',
  verificationUpdated: 'verification_updated',
  verificationDeletedLegacy: 'verification_deleted_current_legacy_flow',
  supplierInvoiceBooked: 'supplier_invoice_booked',
  customerInvoiceBooked: 'customer_invoice_booked',
  documentInterpreted: 'document_interpreted',
}

export const AUDIT_SOURCES = ['ui', 'edge_function', 'worker', 'import', 'ocr', 'system']

// Endast dessa fält ur en OCR-tolkning får loggas som metadata. ALDRIG hela tolkningen,
// råtext, mailbody, konteringsrader eller känslig data.
export const SAFE_INTERPRETATION_KEYS = [
  'leverantor', 'org_nr', 'fakturanummer', 'fakturadatum', 'forfallodatum',
  'belopp_inkl_moms', 'moms_belopp', 'momssats', 'valuta', 'typ', 'invoice_type', 'is_credit_invoice',
]

// Nyckelfragment som ALDRIG får förekomma i audit-metadata (försvar mot oavsiktlig läcka).
const FORBIDDEN_KEY_FRAGMENTS = ['raw', 'text', 'body', 'base64', 'apikey', 'api_key', 'password', 'secret', 'token', 'card', 'kontering']

// Bygg säker metadata från en OCR-tolkning: behåll bara vitlistade fält, dropp råtext/secrets.
// Strängar trunkeras för att aldrig logga stora textblock.
export function redactInterpretation(result) {
  const r = result || {}
  const out = {}
  for (const k of SAFE_INTERPRETATION_KEYS) {
    const v = r[k]
    if (v === undefined || v === null || v === '') continue
    out[k] = typeof v === 'string' ? v.slice(0, 120) : v
  }
  return out
}

// Säkerhetskontroll: false om objektet innehåller förbjudna/känsliga nycklar.
export function isAuditMetadataSafe(meta) {
  if (!meta || typeof meta !== 'object') return true
  return !Object.keys(meta).some(k => { const lk = String(k).toLowerCase(); return FORBIDDEN_KEY_FRAGMENTS.some(f => lk.includes(f)) })
}
