// Delad notis-logik (event-typer, kanaler, mall-rendering). Speglar render_template
// i databasen så klienten kan förhandsvisa/validera mallar.

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push']
export const CHANNEL_LABELS = { in_app: 'I appen', email: 'E-post', sms: 'SMS', push: 'Push' }

// Event-typer + UI-etikett + ikon. mandatory = kan inte stängas av (säkerhet/system).
export const EVENT_TYPES = [
  { key: 'underlag_received', label: 'Nytt underlag mottaget', icon: 'ti-inbox' },
  { key: 'kvitto_classified', label: 'Kvitto klassificerat', icon: 'ti-receipt' },
  { key: 'supplier_invoice_received', label: 'Leverantörsfaktura mottagen', icon: 'ti-file-import' },
  { key: 'invoice_needs_review', label: 'Underlag behöver granskas', icon: 'ti-help-circle' },
  { key: 'ocr_failed', label: 'AI-tolkning misslyckades', icon: 'ti-alert-triangle' },
  { key: 'bookkeeping_suggestion', label: 'Bokföringsförslag skapat', icon: 'ti-book' },
  { key: 'verifikation_created', label: 'Verifikation skapad', icon: 'ti-checkbox' },
  { key: 'payment_overdue', label: 'Betalning förfallen', icon: 'ti-clock-exclamation' },
  { key: 'vat_report_ready', label: 'Momsrapport redo', icon: 'ti-receipt-tax' },
  { key: 'bank_reconciliation_action', label: 'Bankavstämning kräver åtgärd', icon: 'ti-building-bank' },
  { key: 'import_failed', label: 'Import misslyckades', icon: 'ti-file-alert' },
  { key: 'user_invited', label: 'Användare inbjuden', icon: 'ti-user-plus', mandatory: true },
  { key: 'security_event', label: 'Säkerhetshändelse', icon: 'ti-shield-lock', mandatory: true },
  { key: 'permission_changed', label: 'Behörighet ändrad', icon: 'ti-key', mandatory: true },
  { key: 'chart_import_done', label: 'Kontoplanimport klar', icon: 'ti-list-numbers' },
  { key: 'locked_account_blocked', label: 'Blockerad bokning på låst konto', icon: 'ti-lock', mandatory: true },
  { key: 'system_error', label: 'Systemfel kräver åtgärd', icon: 'ti-alert-octagon', mandatory: true },
]
export const MANDATORY_EVENTS = EVENT_TYPES.filter(e => e.mandatory).map(e => e.key)
export const eventLabel = key => EVENT_TYPES.find(e => e.key === key)?.label || key
export const eventIcon = key => EVENT_TYPES.find(e => e.key === key)?.icon || 'ti-bell'

// Logisk gruppering av event-typer för preferens-UI (Inställningar → Notiser).
export const EVENT_GROUPS = [
  { key: 'inkorg', label: 'Underlag & Inkorg', icon: 'ti-inbox', events: ['underlag_received', 'kvitto_classified', 'invoice_needs_review', 'ocr_failed', 'import_failed'] },
  { key: 'fakturor', label: 'Fakturor', icon: 'ti-file-invoice', events: ['supplier_invoice_received', 'payment_overdue'] },
  { key: 'bokforing', label: 'Bokföring', icon: 'ti-book', events: ['bookkeeping_suggestion', 'verifikation_created', 'chart_import_done'] },
  { key: 'moms', label: 'Moms', icon: 'ti-receipt-tax', events: ['vat_report_ready'] },
  { key: 'bank', label: 'Bank', icon: 'ti-building-bank', events: ['bank_reconciliation_action'] },
  { key: 'sakerhet', label: 'Säkerhet', icon: 'ti-shield-lock', events: ['security_event', 'permission_changed', 'user_invited', 'locked_account_blocked'] },
  { key: 'system', label: 'System', icon: 'ti-settings', events: ['system_error'] },
]

// Kanaler som har en konfigurerad provider just nu. sms/push byggs i senare fas.
export const CHANNEL_PROVIDER_AVAILABLE = { in_app: true, email: true, sms: false, push: false }
export const providerAvailable = ch => CHANNEL_PROVIDER_AVAILABLE[ch] === true

// Status för en (event, kanal)-cell i preferens-UI.
// 'mandatory' | 'provider_missing' | 'needs_opt_in' | 'active' | 'off'
export function channelStatus({ eventType, channel, enabled, hasOptIn = false }) {
  if (MANDATORY_EVENTS.includes(eventType) && (channel === 'in_app' || channel === 'email')) return 'mandatory'
  if (!providerAvailable(channel)) return 'provider_missing'
  if ((channel === 'sms' || channel === 'push') && !hasOptIn) return 'needs_opt_in'
  return enabled ? 'active' : 'off'
}
export const STATUS_META = {
  mandatory: { label: 'Obligatorisk', tone: 'amber' },
  provider_missing: { label: 'Provider saknas', tone: 'gray' },
  needs_opt_in: { label: 'Kräver opt-in', tone: 'blue' },
  active: { label: 'Aktiv', tone: 'green' },
  off: { label: 'Avstängd', tone: 'gray' },
}

// Effektivt på/av för en cell givet sparade DB-rader (annars standard).
// Obligatoriska in_app/email är alltid på oavsett sparat värde.
export function resolvePref(dbRows, eventType, channel) {
  if (MANDATORY_EVENTS.includes(eventType) && (channel === 'in_app' || channel === 'email')) return true
  const row = (dbRows || []).find(r => r.event_type === eventType && r.channel === channel)
  if (row) return !!row.enabled
  return defaultChannelEnabled(channel, eventType)
}

// Ersätt {{var}} med värden; saknade variabler tas bort (matchar SQL render_template).
export function renderTemplate(tmpl, vars = {}) {
  if (tmpl == null) return ''
  let out = String(tmpl)
  for (const [k, v] of Object.entries(vars || {})) out = out.split(`{{${k}}}`).join(v == null ? '' : String(v))
  return out.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, '')
}

// Returnerar obligatoriska variabler som saknas/är tomma (för validering före utskick).
export function missingVars(requiredVars = [], vars = {}) {
  return (requiredVars || []).filter(k => vars?.[k] === undefined || vars?.[k] === null || vars?.[k] === '')
}

// Informativa/högfrekventa events där email är AV som standard (in_app räcker) – speglar notify_event i DB.
// Viktiga events (faktura/moms/säkerhet/system/import) behåller email på som standard.
export const EMAIL_DEFAULT_OFF = ['underlag_received', 'kvitto_classified', 'verifikation_created', 'bookkeeping_suggestion', 'chart_import_done']

// Standard på/av per kanal när användaren inte gjort ett val.
// in_app alltid på; email på utom för informativa events; sms/push av (kräver opt-in).
export function defaultChannelEnabled(channel, eventType) {
  if (channel === 'in_app') return true
  if (channel === 'email') return !EMAIL_DEFAULT_OFF.includes(eventType)
  return false
}

// Är kanalen tillåten att stänga av för detta event?
// Obligatoriska (säkerhets-/systemkritiska) events kan ej stängas av för in_app/email –
// systemet tvångsskickar dem (se kö-processor + apply_email_unsubscribe). sms/push styrs via opt-in.
export function canDisable(eventType, channel) {
  if (channel === 'sms' || channel === 'push') return true
  return !MANDATORY_EVENTS.includes(eventType)
}
