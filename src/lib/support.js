// Support-admin: konstanter, etiketter och filterlogik (klient). RPC/RLS är auktoritativa på backend.

export const TICKET_STATUSES = ['new', 'open', 'waiting_for_customer', 'waiting_for_support', 'resolved', 'closed']
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent']
export const TICKET_CATEGORIES = ['billing', 'invoice_import', 'bookkeeping', 'login_access', 'technical_error', 'feature_request', 'other']

export const STATUS_LABELS = {
  new: 'Ny', open: 'Öppen', waiting_for_customer: 'Väntar på kund', waiting_for_support: 'Väntar på support',
  resolved: 'Löst', closed: 'Stängd',
}
export const PRIORITY_LABELS = { low: 'Låg', normal: 'Normal', high: 'Hög', urgent: 'Akut' }
export const CATEGORY_LABELS = {
  billing: 'Fakturering', invoice_import: 'Fakturaimport', bookkeeping: 'Bokföring', login_access: 'Inloggning/åtkomst',
  technical_error: 'Tekniskt fel', feature_request: 'Funktionsönskemål', other: 'Övrigt',
}
export const STATUS_META = {
  new: { tone: 'blue' }, open: { tone: 'blue' }, waiting_for_customer: { tone: 'amber' },
  waiting_for_support: { tone: 'red' }, resolved: { tone: 'green' }, closed: { tone: 'gray' },
}
export const PRIORITY_META = { low: { tone: 'gray' }, normal: { tone: 'gray' }, high: { tone: 'amber' }, urgent: { tone: 'red' } }
export const TONE_CLASS = {
  blue: 'bg-blue-100 text-blue-700', amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700', green: 'bg-green-100 text-green-700', gray: 'bg-gray-100 text-gray-500',
}

// Status som räknas som "aktiva" (öppna ärenden).
export const ACTIVE_STATUSES = ['new', 'open', 'waiting_for_customer', 'waiting_for_support']
export const isActiveStatus = s => ACTIVE_STATUSES.includes(s)
export const isOpenForReply = s => s !== 'closed'

// Klient-filter (speglar list_support_tickets-parametrar) – för snabb lokal filtrering/test.
export function filterTickets(tickets, { status = '', priority = '', companyId = '', assigned = '', search = '' } = {}) {
  const q = search.trim().toLowerCase()
  return (tickets || []).filter(t =>
    (!status || t.status === status) &&
    (!priority || t.priority === priority) &&
    (!companyId || t.company_id === companyId) &&
    (!assigned || t.assigned_admin_id === assigned) &&
    (!q || (t.subject || '').toLowerCase().includes(q) || (t.company_name || '').toLowerCase().includes(q)))
}

// Endast support_admin/superadmin får admin-supportvyn.
export const canViewSupportAdmin = access => !!access?.canViewSupport
