// Tjänstelås (service-state) – ren logik delad av kundappen (Layout) och adminpanelen.
// active = normalt. paused/blocked = kundappen låst (ingen skriv/läs av app-funktioner)
// men data raderas aldrig och supportflödet förblir nåbart.

export const LOCK_STATES = ['paused', 'blocked']

export const SERVICE_STATE_META = {
  active: { label: 'Aktiv', tone: 'green' },
  paused: { label: 'Pausad', tone: 'amber' },
  blocked: { label: 'Blockerad', tone: 'red' },
}
export const serviceStateMeta = state => SERVICE_STATE_META[state] || { label: state || 'Okänd', tone: 'gray' }

// Är företaget låst (paused/blocked)? Plattformsadmin släpps alltid förbi (isAdmin).
export function isCompanyLocked(company) {
  return !!company && LOCK_STATES.includes(company.service_state)
}

// Vilka vägar får besökas trots lås: supportflödet (krav 5) + utloggning sker via knapp.
export function lockAllowsPath(pathname) {
  return typeof pathname === 'string' && pathname.startsWith('/support')
}

// Giltiga tillstånd + transitionsvalidering (krav 9 – service-state transitions).
export const SERVICE_STATES = ['active', 'paused', 'blocked']
export function isValidServiceState(state) {
  return SERVICE_STATES.includes(state)
}

// ---- Server-side write-lock (Fas 2-härdning) ----
export const SERVICE_PAUSED_MESSAGE = 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.'

// Speglar can_company_write() i DB. Plattformsadmin (operations) får skriva; annars endast active.
export function canCompanyWrite(company, access = null) {
  if (access && (access.isSuperadmin || access.canManageOperations)) return true
  if (!company) return true
  return (company.service_state || 'active') === 'active'
}

// Affärstabeller som skyddas av write-lock-triggern (dokumentation + regressionsskydd för testerna).
export const LOCKED_WRITE_TABLES = [
  'documents', 'verifikationer', 'verifikation_rows', 'invoices', 'invoice_rows', 'supplier_invoices',
  'customers', 'suppliers', 'products', 'bank_transactions', 'bank_accounts', 'account_import_batches',
  'accounts', 'article_templates', 'bookkeeping_templates', 'fiscal_years', 'salaries',
]
// Medvetna undantag som MÅSTE fortsätta fungera (support/notiser/audit/billing/team/system).
export const WRITE_LOCK_EXEMPT_TABLES = [
  'support_tickets', 'support_messages', 'support_internal_notes', 'support_attachments',
  'notification_queue', 'notification_events', 'notification_preferences',
  'audit_log', 'platform_audit_log', 'download_audit_log',
  'company_subscriptions', 'user_companies', 'company_invites', 'worker_health',
]

// Mappar ett DB-skrivfel till ren svensk text när det är ett service-lås-fel (krav 7) –
// så att UI visar ett begripligt meddelande, inte ett tekniskt RLS/SQL-fel.
export function friendlyWriteError(error) {
  const msg = (error && (error.message || error.msg)) || (typeof error === 'string' ? error : '')
  if (/Tjänsten är pausad/.test(msg) || error?.code === '42501') return SERVICE_PAUSED_MESSAGE
  return msg || 'Något gick fel.'
}
