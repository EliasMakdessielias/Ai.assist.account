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

// Standard på/av per kanal när användaren inte gjort ett val.
// in_app + email på som standard; sms/push av (kräver explicit opt-in).
export function defaultChannelEnabled(channel) {
  return channel === 'in_app' || channel === 'email'
}

// Är kanalen tillåten att stänga av för detta event? (obligatoriska in_app kan ej stängas)
export function canDisable(eventType, channel) {
  if (channel !== 'in_app') return true
  return !MANDATORY_EVENTS.includes(eventType)
}
