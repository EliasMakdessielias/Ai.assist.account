// Status-/formatlogik för admin-systemövervakningen. Ren och testbar (speglar admin_system_overview).
// Byggd för att kunna flyttas till admin.bokpilot.se utan ändring.

export const WORKER_COMPONENTS = [
  { key: 'imap-import', label: 'IMAP-importer', icon: 'ti-mail-down', mode: 'schemalagd (5 min)' },
  { key: 'inbound-email', label: 'Inkommande e-post (webhook)', icon: 'ti-inbox', mode: 'on-demand' },
  { key: 'tolka-underlag', label: 'OCR / Gemini-tolkning', icon: 'ti-robot', mode: 'on-demand' },
  { key: 'email-worker', label: 'E-postutskick & köprocessor', icon: 'ti-send', mode: 'schemalagd (5 min)' },
  { key: 'scheduled-notifications', label: 'Schemalagda notiser (cron)', icon: 'ti-clock', mode: 'dagligen 06:00' },
]
export const componentLabel = key => WORKER_COMPONENTS.find(c => c.key === key)?.label || key

export const STATUS_META = {
  healthy: { label: 'Frisk', tone: 'green', icon: 'ti-circle-check' },
  warning: { label: 'Varning', tone: 'amber', icon: 'ti-alert-triangle' },
  failing: { label: 'Fel', tone: 'red', icon: 'ti-alert-octagon' },
  unknown: { label: 'Okänd', tone: 'gray', icon: 'ti-help-circle' },
}
export const SEVERITY_META = {
  warning: { label: 'Varning', tone: 'amber' },
  error: { label: 'Fel', tone: 'red' },
  critical: { label: 'Kritisk', tone: 'red' },
}
export const TONE_CLASS = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-gray-100 text-gray-500',
}

const DAY_MS = 24 * 3600 * 1000
const isRecent = (ts, now) => !!ts && (now - new Date(ts).getTime()) < DAY_MS

// Statuslogik (krav 3) – speglar SQL i admin_system_overview.
// healthy: nyligen success + 0 consecutive. warning: gammal success eller senaste warning.
// failing: consecutive>0 eller senaste error/critical (nyligen). unknown: ingen health-record.
export function computeWorkerStatus(w, now = new Date()) {
  if (!w || !w.has_record) return 'unknown'
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if ((w.consecutive_failures || 0) > 0) return 'failing'
  if (['error', 'critical'].includes(w.last_severity) && isRecent(w.last_failure_at, t)) return 'failing'
  if (w.last_severity === 'warning' && isRecent(w.last_failure_at, t)) return 'warning'
  if (!isRecent(w.last_success_at, t)) return 'warning'
  return 'healthy'
}

// Sammanställ köstatus från rådata (kontrakt-spegel av SQL-aggregaten).
export function summarizeQueue(rows, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const dayStart = new Date(t); dayStart.setHours(0, 0, 0, 0)
  const r = (rows || []).filter(x => x.channel === 'email')
  const pend = r.filter(x => x.status === 'pending')
  const oldest = pend.reduce((m, x) => Math.min(m, new Date(x.scheduled_at).getTime()), Infinity)
  return {
    pending: pend.length,
    processing: r.filter(x => x.status === 'processing').length,
    sent_today: r.filter(x => x.status === 'sent' && new Date(x.updated_at).getTime() >= dayStart.getTime()).length,
    failed: r.filter(x => x.status === 'failed').length,
    skipped: r.filter(x => x.status === 'skipped').length,
    cancelled: r.filter(x => x.status === 'cancelled').length,
    retries_scheduled: pend.filter(x => x.next_retry_at && new Date(x.next_retry_at).getTime() > t).length,
    oldest_pending_age_seconds: oldest === Infinity ? 0 : Math.floor((t - oldest) / 1000),
  }
}

// Filtrera system_error-lista (krav 11).
export function filterSystemErrors(errors, { component = '', severity = '', ack = '' } = {}) {
  return (errors || []).filter(e =>
    (!component || e.component === component) &&
    (!severity || e.severity === severity) &&
    (ack === '' || (ack === 'ack' ? !!e.acknowledged : !e.acknowledged)))
}

// Access: bara plattformsadmins får se/agera (RLS/ RPC skyddar på backend).
export const canViewSystemDashboard = isAdmin => !!isAdmin
export const canRunAdminAction = isAdmin => !!isAdmin

export function formatAge(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86400)} d`
}
export function formatTime(ts) {
  if (!ts) return '–'
  const d = new Date(ts), diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'nyss'
  if (diff < 3600) return `${Math.floor(diff / 60)} min sedan`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h sedan`
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
}
