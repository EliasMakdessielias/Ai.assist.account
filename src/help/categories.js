// Handbokens kategorier (vänsternavigering). Ordningen styr menyn. requiredRole styr vilka
// som ser kategorin: 'user' = alla, 'admin' = superadmin, 'ops' = drift/övervakning.
export const HELP_CATEGORIES = [
  { key: 'Kom igång', icon: 'ti-rocket', requiredRole: 'user' },
  { key: 'Dashboard', icon: 'ti-layout-dashboard', requiredRole: 'user' },
  { key: 'AI-assistent', icon: 'ti-sparkles', requiredRole: 'user' },
  { key: 'Inkorg', icon: 'ti-inbox', requiredRole: 'user' },
  { key: 'Bokföring', icon: 'ti-book', requiredRole: 'user' },
  { key: 'Kundfakturor', icon: 'ti-file-invoice', requiredRole: 'user' },
  { key: 'Leverantörsfakturor', icon: 'ti-file-import', requiredRole: 'user' },
  { key: 'Kassa och bank', icon: 'ti-building-bank', requiredRole: 'user' },
  { key: 'Kontoanalys', icon: 'ti-report-search', requiredRole: 'user' },
  { key: 'Lön', icon: 'ti-wallet', requiredRole: 'user' },
  { key: 'Moms', icon: 'ti-receipt-tax', requiredRole: 'user' },
  { key: 'Månadskontroll', icon: 'ti-checklist', requiredRole: 'user' },
  { key: 'Rapporter', icon: 'ti-chart-bar', requiredRole: 'user' },
  { key: 'AI-granskning', icon: 'ti-shield-check', requiredRole: 'user' },
  { key: 'Kunder', icon: 'ti-users', requiredRole: 'user' },
  { key: 'Leverantörer', icon: 'ti-building-store', requiredRole: 'user' },
  { key: 'Produkter', icon: 'ti-package', requiredRole: 'user' },
  { key: 'OCR och AI-tolkning', icon: 'ti-scan', requiredRole: 'user' },
  { key: 'Inställningar', icon: 'ti-settings', requiredRole: 'user' },
  { key: 'Billing och abonnemang', icon: 'ti-credit-card', requiredRole: 'user' },
  { key: 'Support', icon: 'ti-headset', requiredRole: 'user' },
  { key: 'Superadmin', icon: 'ti-shield-lock', requiredRole: 'admin' },
  { key: 'Systemövervakning', icon: 'ti-activity-heartbeat', requiredRole: 'ops' },
]

export const CATEGORY_ICON = Object.fromEntries(HELP_CATEGORIES.map(c => [c.key, c.icon]))

// Får användaren se en viss requiredRole? access = { isAdmin, canViewOps }.
export function roleAllowed(requiredRole, access = {}) {
  if (requiredRole === 'admin') return !!access.isAdmin
  if (requiredRole === 'ops') return !!access.canViewOps || !!access.isAdmin
  return true
}
