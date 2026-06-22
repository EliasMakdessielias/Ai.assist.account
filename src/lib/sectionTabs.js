// Konfiguration för huvudval i sidomenyn som visar undersidor som horisontella TOPPFLIKAR
// (i stället för dropdown/accordion i sidomenyn). Återanvändbart mönster:
//
//   { menuItem, basePath, defaultTab, tabs: [{ label, path, key, requires? }] }
//
// requires(access) (valfritt) → false döljer fliken (behörighet). access = { isAdmin, platformAccess }.
// Lägg till fler huvudval här så får de samma flikbeteende automatiskt.
export const SECTION_TABS = [
  {
    menuItem: 'Lön',
    basePath: '/lon',
    defaultTab: 'loner',
    tabs: [
      { label: 'Löner', path: '/lon/loner', key: 'loner' },
      { label: 'Anställda', path: '/lon/anstallda', key: 'anstallda' },
    ],
  },
]

export const sectionByBasePath = Object.fromEntries(SECTION_TABS.map(s => [s.basePath, s]))

// Flikar användaren har behörighet till (default: alla). access = { isAdmin, platformAccess }.
export function visibleTabs(section, access = {}) {
  return (section?.tabs || []).filter(t => typeof t.requires !== 'function' || t.requires(access))
}
