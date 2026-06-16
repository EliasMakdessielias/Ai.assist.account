// Företagskonfiguration: momsperiod + räkenskapsår (ren logik, testbar).

// Momsperioder (Skatteverkets redovisningsperioder). "Redovisar ej moms" = ej momspliktig.
export const MOMSPERIODER = [
  'Redovisar ej moms',
  'Årsvis',
  'Kvartalsvis',
  'En gång per månad (12:e i månaden)',
  'En gång per månad (26:e i månaden)',
]

// Dropdown-alternativ som alltid inkluderar ett befintligt (ev. äldre) lagrat värde,
// så att gamla företags momsperiod ('Varje kvartal' m.fl.) inte tappas i listan.
export function momsperiodOptions(current) {
  const c = String(current || '').trim()
  return c && !MOMSPERIODER.includes(c) ? [c, ...MOMSPERIODER] : [...MOMSPERIODER]
}

export const momsRedovisas = mp => !!mp && mp !== 'Redovisar ej moms'

export function bokforingsmetodLabel(m) {
  return m === 'kontant' ? 'Kontantmetoden' : 'Faktureringsmetoden'
}

// --- Räkenskapsår -------------------------------------------------------------------------
const addDaysUTC = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const addYearsUTC = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + n)
  return d.toISOString().slice(0, 10)
}

// Nästa räkenskapsår utifrån befintliga år: börjar dagen efter senaste slutdatum och är lika
// långt som ett normalår (1 år − 1 dag). Bevarar brutet räkenskapsår. Tom lista → innevarande
// kalenderår.
export function nextFiscalYear(years, nowYear) {
  const list = (years || []).filter(y => y && y.end_date)
  if (!list.length) {
    const y = nowYear || new Date().getUTCFullYear()
    return { year: y, start_date: `${y}-01-01`, end_date: `${y}-12-31` }
  }
  const latest = list.reduce((a, b) => (a.end_date >= b.end_date ? a : b))
  const start = addDaysUTC(latest.end_date, 1)
  const end = addDaysUTC(addYearsUTC(start, 1), -1)
  return { year: Number(start.slice(0, 4)), start_date: start, end_date: end }
}
