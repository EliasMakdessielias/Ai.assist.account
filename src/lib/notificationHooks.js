// Kontrakt för notify_event-hooks – speglar DB-triggers/funktioner (migration notify_event_hooks).
// Single source för dedupe-nycklar, actionUrls och mottagar-/kanalpolicy. Verifieras live mot DB,
// kontraktet låses här så regressions fångas i testsviten.
import { EMAIL_DEFAULT_OFF } from './notifications.js'

export const APP_URL = 'https://app.bokpilot.se'

// recipients: 'company' (alla medlemmar) | 'creator' (created_by) | 'platform_admins'
export const NOTIFY_HOOKS = {
  payment_overdue: {
    source: 'run_scheduled_notifications (cron 06:00) – invoices + supplier_invoices',
    recipients: 'company', priority: 'high',
    dedupeKey: (invoiceId, dueDate) => `payment_overdue:${invoiceId}:${dueDate}`,
    actionUrl: (party, id) => `${APP_URL}/${party === 'kund' ? 'fakturor' : 'leverantorsfakturor'}/${id}`,
  },
  bank_reconciliation_action: {
    source: 'run_scheduled_notifications – bank_transactions status=unmatched',
    recipients: 'company', priority: 'normal',
    dedupeKey: (companyId, date) => `bank_reconciliation_action:${companyId}:${date}`,
    actionUrl: () => `${APP_URL}/kassa-bank`,
  },
  bookkeeping_suggestion: {
    source: 'trigger documents.tolkad false→true',
    recipients: 'company', priority: 'normal',
    dedupeKey: (docId) => `bookkeeping_suggestion:${docId}`,
    actionUrl: () => `${APP_URL}/inkorg`,
  },
  verifikation_created: {
    source: 'trigger verifikationer INSERT (ej Momsredovisning)',
    recipients: 'creator', priority: 'normal',
    dedupeKey: (verId) => `verifikation_created:${verId}`,
    actionUrl: (verId) => `${APP_URL}/bokforing/${verId}`,
  },
  import_failed: {
    source: 'trigger account_import_batches status=failed/error',
    recipients: 'company', priority: 'high',
    dedupeKey: (batchId) => `import_failed:${batchId}`,
    actionUrl: () => `${APP_URL}/installningar/import-export`,
  },
  vat_report_ready: {
    source: 'RPC notify_vat_report_ready (Moms-sidan efter momsredovisning)',
    recipients: 'company', priority: 'normal',
    dedupeKey: (verId) => `vat_report_ready:${verId}`,
    actionUrl: (verId) => `${APP_URL}/bokforing/${verId}`,
  },
  system_error: {
    source: 'RPC report_system_error (workers/edge functions)',
    recipients: 'platform_admins', priority: 'urgent',
    // Timme-bucket -> max en notis per distinkt fel och klocktimme (anti-spam).
    dedupeKey: (component, msgHash, hourBucket) => `system_error:${component}:${msgHash}:${hourBucket}`,
    actionUrl: () => `${APP_URL}/`,
  },
}

// Standardkanaler för ett event (speglar notify_event-defaults: in_app alltid, email utom informativa).
export function defaultChannelsFor(eventType) {
  const channels = ['in_app']
  if (!EMAIL_DEFAULT_OFF.includes(eventType)) channels.push('email')
  return channels
}
