// Undermeny för Inställningar med EXAKT route-matchning (per post), så att
// bara en post är aktiv åt gången. Kontoplan får även matcha sin dynamiska
// under-route (/installningar/kontoplan/[id]).
//
// Löneinställningar och Bokföringsmallar har ännu inga egna sidor – de navigerar
// till företagsinställningarna och markeras aldrig aktiva (de stjäl alltså inte
// aktiv-styling). Ge dem en egen `match` när sidorna byggs. Artikelkontering har
// en egen sida (/installningar/artikelkontering).
export const SETTINGS_ITEMS = [
  { label: 'Företagsinställningar', to: '/installningar', match: p => p === '/installningar' },
  { label: 'Användare & behörighet', to: '/installningar/team', match: p => p === '/installningar/team' },
  { label: 'Kassa- och bankkonton', to: '/installningar/kassa-bankkonton', match: p => p === '/installningar/kassa-bankkonton' },
  { label: 'Löneinställningar', to: '/installningar', match: () => false },
  { label: 'Räkenskapsår och IB', to: '/installningar/rakenskapsar', match: p => p === '/installningar/rakenskapsar' },
  { label: 'Kontoplan', to: '/installningar/kontoplan', match: p => p === '/installningar/kontoplan' || p.startsWith('/installningar/kontoplan/') },
  { label: 'Artikelkontering', to: '/installningar/artikelkontering', match: p => p === '/installningar/artikelkontering' },
  { label: 'Bokföringsmallar', to: '/installningar', match: () => false },
  { label: 'Import och export', to: '/installningar/import-export', match: p => p === '/installningar/import-export' },
]

export function isSettingsItemActive(item, pathname) {
  return !!item.match?.(pathname)
}

// Är vi någonstans under Inställningar? (för att hålla parent-sektionen öppen)
export function isSettingsSection(pathname) {
  return pathname === '/installningar' || pathname.startsWith('/installningar/')
}

// Hjälp för tester: vilka poster är aktiva på en given route?
export function activeSettingsLabels(pathname) {
  return SETTINGS_ITEMS.filter(it => isSettingsItemActive(it, pathname)).map(it => it.label)
}
