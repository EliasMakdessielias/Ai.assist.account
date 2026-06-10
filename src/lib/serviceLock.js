// Tjänstelås (service-state) – ren logik delad av kundappen (Layout) och adminpanelen.
// active = normalt. paused/blocked = kundappen låst (ingen skriv/läs av app-funktioner)
// men data raderas aldrig och supportflödet förblir nåbart.

export const LOCK_STATES = ['paused', 'blocked']

export const SERVICE_STATE_META = {
  active: { label: 'Aktiv', tone: 'green' },
  paused: { label: 'Pausad', tone: 'amber' },
  blocked: { label: 'Blockerad', tone: 'red' },
}
export const serviceStateMeta = state => SERVICE_STATE_META[state] || { label: state || 'Okänd', tone: 'gray' }

// Är företaget låst (paused/blocked)? Plattformsadmin släpps alltid förbi (isAdmin).
export function isCompanyLocked(company) {
  return !!company && LOCK_STATES.includes(company.service_state)
}

// Vilka vägar får besökas trots lås: supportflödet (krav 5) + utloggning sker via knapp.
export function lockAllowsPath(pathname) {
  return typeof pathname === 'string' && pathname.startsWith('/support')
}

// Giltiga tillstånd + transitionsvalidering (krav 9 – service-state transitions).
export const SERVICE_STATES = ['active', 'paused', 'blocked']
export function isValidServiceState(state) {
  return SERVICE_STATES.includes(state)
}
