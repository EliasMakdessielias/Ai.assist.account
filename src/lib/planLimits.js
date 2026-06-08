// Plan-enforcement (soft). Central status-beräkning (speglar check_plan_limit i DB) + flödeshjälp.

export const LIMIT_METRICS = [
  { key: 'users', label: 'Användare' },
  { key: 'companies', label: 'Företag' },
  { key: 'invoices', label: 'Fakturor denna månad' },
  { key: 'documents', label: 'Underlag denna månad' },
  { key: 'storage', label: 'Lagring (MB)' },
  { key: 'ai', label: 'AI-operationer/mån' },
]
export const METRIC_LABEL = Object.fromEntries(LIMIT_METRICS.map(m => [m.key, m.label]))

export const STATUS_META = {
  ok: { tone: 'green', label: 'OK' },
  warning: { tone: 'amber', label: 'Nära gränsen' },
  exceeded: { tone: 'red', label: 'Gräns nådd' },
  unlimited: { tone: 'gray', label: 'Obegränsat' },
}
export const BAR_CLASS = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-gray-300' }
export const TEXT_CLASS = { green: 'text-green-600', amber: 'text-amber-600', red: 'text-red-600', gray: 'text-gray-400' }

// Statusregler (krav 5): unlimited (null/-1), exceeded (>=100%), warning (80–99%), ok (<80%).
export function limitStatus(used, limit) {
  const u = Number(used) || 0
  if (limit === null || limit === undefined || Number(limit) < 0) {
    return { status: 'unlimited', limit: null, used: u, remaining: null, percentUsed: null }
  }
  const l = Number(limit)
  const percentUsed = l === 0 ? 100 : Math.round((u * 100) / l)
  const status = u >= l ? 'exceeded' : percentUsed >= 80 ? 'warning' : 'ok'
  return { status, limit: l, used: u, remaining: Math.max(0, l - u), percentUsed }
}

// Admin plan-usage-översikt: sorterings- och filteralternativ.
export const USAGE_SORT_OPTIONS = [
  { value: 'percent_desc', label: 'Högst förbrukning' },
  { value: 'exceeded', label: 'Flest överskridna' },
  { value: 'storage', label: 'Mest lagring' },
  { value: 'ai', label: 'Mest AI/OCR' },
  { value: 'newest', label: 'Nyaste kund' },
  { value: 'oldest_active', label: 'Äldst aktiv' },
]
export const OVERALL_STATUS_FILTERS = [
  { value: '', label: 'Alla' }, { value: 'ok', label: 'OK' },
  { value: 'warning', label: 'Nära gränsen' }, { value: 'exceeded', label: 'Gräns nådd' },
]

export const isBlockingStatus = s => s === 'exceeded'
export const hasWarnings = limits => (limits || []).some(l => l.status === 'warning' || l.status === 'exceeded')
export const worstStatus = limits => {
  if ((limits || []).some(l => l.status === 'exceeded')) return 'exceeded'
  if ((limits || []).some(l => l.status === 'warning')) return 'warning'
  return 'ok'
}

// Soft enforcement i flöden: kontrollera + notifiera (server dedupe), returnera status. Blockerar ALDRIG hårt.
export async function enforcePlanLimit(supabase, companyId, metric) {
  try {
    const { data } = await supabase.rpc('enforce_plan_limit', { p_company_id: companyId, p_metric: metric })
    return data || null
  } catch { return null }
}

// Mjuk enforcement med kundvänlig toast vid warning/exceeded. Returnerar status; flödet fortsätter alltid.
export async function enforceAndToast(supabase, companyId, metric, toast) {
  if (!companyId) return null
  const r = await enforcePlanLimit(supabase, companyId, metric)
  if (r && (r.status === 'warning' || r.status === 'exceeded')) {
    const label = METRIC_LABEL[metric] || metric
    const msg = r.status === 'exceeded'
      ? `Du har nått plangränsen för ${label}. Funktionen fungerar fortfarande – överväg att uppgradera.`
      : `Du närmar dig plangränsen för ${label}.`
    try { toast(msg, { icon: '⚠️', duration: 5000 }) } catch { /* toast valfri */ }
  }
  return r
}
