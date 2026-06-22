// Månadskontroll: konstanter, etiketter, färger och hjälpfunktioner (klient).
// Regelmotorn och behörighet är auktoritativa i databasen (run_monthly_control + RLS/RPC).

export const MODULES = [
  { key: 'inkorg', label: 'Inkorg & underlag', icon: 'ti-inbox' },
  { key: 'bokforing', label: 'Bokföring', icon: 'ti-book' },
  { key: 'leverantorsfakturor', label: 'Leverantörsfakturor', icon: 'ti-file-invoice' },
  { key: 'kundfakturor', label: 'Kundfakturor', icon: 'ti-file-dollar' },
  { key: 'bank', label: 'Kassa & bank', icon: 'ti-building-bank' },
  { key: 'moms', label: 'Moms', icon: 'ti-receipt-tax' },
  { key: 'lon', label: 'Lön', icon: 'ti-users' },
  { key: 'avstamning', label: 'Kontoavstämning', icon: 'ti-scale' },
]
export const MODULE_LABEL = Object.fromEntries(MODULES.map(m => [m.key, m.label]))
export const MODULE_ICON = Object.fromEntries(MODULES.map(m => [m.key, m.icon]))

// Prioritet: ordning (lägre = viktigare) + färg/etikett.
export const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 }
export const PRIORITY_META = {
  critical: { label: 'Kritisk', dot: '#dc2626', chip: 'bg-red-100 text-red-700', row: 'rgba(220,38,38,0.06)' },
  high: { label: 'Hög', dot: '#f97316', chip: 'bg-orange-100 text-orange-700', row: 'rgba(249,115,22,0.05)' },
  normal: { label: 'Normal', dot: '#3b82f6', chip: 'bg-blue-100 text-blue-700', row: 'transparent' },
  low: { label: 'Låg', dot: '#9ca3af', chip: 'bg-gray-100 text-gray-500', row: 'transparent' },
}
export const priorityRank = p => PRIORITY_ORDER[p] ?? 9

// Status per kontrollpunkt.
export const ITEM_STATUS_META = {
  open: { label: 'Öppen', chip: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'Pågår', chip: 'bg-amber-100 text-amber-700' },
  waiting_for_user: { label: 'Väntar på dig', chip: 'bg-amber-100 text-amber-700' },
  waiting_for_support: { label: 'Väntar på support', chip: 'bg-purple-100 text-purple-700' },
  resolved: { label: 'Löst', chip: 'bg-green-100 text-green-700' },
  ignored: { label: 'Ignorerad', chip: 'bg-gray-100 text-gray-500' },
  blocked: { label: 'Blockerad', chip: 'bg-red-100 text-red-700' },
}
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting_for_user', 'waiting_for_support', 'blocked']
export const isOpenStatus = s => OPEN_STATUSES.includes(s)

// Status per månadskontroll (översikt).
export const CONTROL_STATUS_META = {
  not_started: { label: 'Ej påbörjad', chip: 'bg-gray-100 text-gray-500' },
  in_progress: { label: 'Pågår', chip: 'bg-blue-100 text-blue-700' },
  needs_action: { label: 'Kräver åtgärd', chip: 'bg-red-100 text-red-700' },
  ready_for_review: { label: 'Klar för granskning', chip: 'bg-green-100 text-green-700' },
  closed: { label: 'Avslutad', chip: 'bg-gray-200 text-gray-600' },
}

export const MONTHS = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December']
export const monthLabel = (y, m) => `${MONTHS[m - 1]} ${y}`

// Bygg lista av valbara månader utifrån räkenskapsår (eller innevarande år som fallback).
export function monthOptions(years, today = new Date()) {
  const out = []
  const seen = new Set()
  const add = (y, m) => { const key = `${y}-${m}`; if (!seen.has(key)) { seen.add(key); out.push({ year: y, month: m, label: monthLabel(y, m) }) } }
  if (years?.length) {
    years.forEach(fy => {
      let d = new Date(fy.start_date), end = new Date(fy.end_date)
      while (d <= end) { add(d.getFullYear(), d.getMonth() + 1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) }
    })
  } else {
    const y = today.getFullYear()
    for (let m = 1; m <= 12; m++) add(y, m)
  }
  return out.sort((a, b) => (b.year - a.year) || (b.month - a.month))
}

// Sortera punkter: prioritet först, sedan modul, sedan datum.
export function sortItems(items) {
  return [...(items || [])].sort((a, b) =>
    priorityRank(a.priority) - priorityRank(b.priority) ||
    (a.module || '').localeCompare(b.module || '') ||
    (a.created_at || '').localeCompare(b.created_at || ''))
}

// Nästa rekommenderade åtgärd = viktigaste öppna punkten.
export function nextAction(items) {
  return sortItems((items || []).filter(i => isOpenStatus(i.status)))[0] || null
}
