// Undermeny för Inställningar med EXAKT route-matchning (per post), så att
// bara en post är aktiv åt gången. Kontoplan får även matcha sin dynamiska
// under-route (/installningar/kontoplan/[id]).
//
// Löneinställningar har ännu ingen egen sida – navigerar till företagsinställningarna
// och markeras aldrig aktiv (stjäl alltså inte aktiv-styling). Ge den en egen `match`
// när sidan byggs. Artikelkontering (/installningar/artikelkontering) och
// Bokföringsmallar (/installningar/bokforingsmallar) har egna sidor.
export const SETTINGS_ITEMS = [
  { label: 'Företagsinställningar', to: '/installningar', match: p => p === '/installningar' },
  { label: 'Användare & behörighet', to: '/installningar/team', match: p => p === '/installningar/team' },
  { label: 'Kassa- och bankkonton', to: '/installningar/kassa-bankkonton', match: p => p === '/installningar/kassa-bankkonton' },
  { label: 'Löneinställningar', to: '/installningar', match: () => false },
  { label: 'Räkenskapsår och IB', to: '/installningar/rakenskapsar', match: p => p === '/installningar/rakenskapsar' },
  { label: 'Kontoplan', to: '/installningar/kontoplan', match: p => p === '/installningar/kontoplan' || p.startsWith('/installningar/kontoplan/') },
  { label: 'Artikelkontering', to: '/installningar/artikelkontering', match: p => p === '/installningar/artikelkontering' },
  { label: 'Bokföringsmallar', to: '/installningar/bokforingsmallar', match: p => p === '/installningar/bokforingsmallar' },
  { label: 'Import och export', to: '/installningar/import-export', match: p => p === '/installningar/import-export' },
  { label: 'Notiser', to: '/installningar/notiser', match: p => p === '/installningar/notiser' },
  { label: 'Abonnemang', to: '/installningar/abonnemang', match: p => p === '/installningar/abonnemang' },
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
