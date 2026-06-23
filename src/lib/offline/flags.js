// Feature flag för autosave-piloten — Etapp 2A/2B (strikt produktionssäker).
//
// Aktiveringsmodell:
// - DEV (vite dev, lokal utveckling): PÅ. localStorage får stänga AV ('0') för lokal test.
// - BYGGD miljö (production/preview/staging/okänd): localStorage kan ALDRIG aktivera piloten.
//   Aktivering kräver allowlistat testbolag eller testanvändare. En vanlig användare kan inte slå på
//   produktionspiloten genom att ändra localStorage.
const FLAG_KEY = 'bokpilot.flags.autosavePilot'

// Allowlist (explicit). BokPilot AB – Test + testanvändarens id.
const TEST_COMPANY_IDS = new Set(['4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'])
const TEST_USER_IDS = new Set(['3baa21a4-7461-43cd-b3ae-1088842a853c'])

function lsGet(k) { try { return localStorage.getItem(k) } catch { return null } }

export function isAutosavePilotEnabled({ user, company } = {}) {
  // Lokal utveckling: på som standard, men kan stängas av lokalt för test.
  if (import.meta.env.DEV) return lsGet(FLAG_KEY) !== '0'
  // Byggd miljö: endast explicit allowlist aktiverar (localStorage är EJ auktoritativ här).
  if (company?.id && TEST_COMPANY_IDS.has(company.id)) return true
  if (user?.id && TEST_USER_IDS.has(user.id)) return true
  return false
}

export function autosaveFlagDiagnostics({ user, company } = {}) {
  return {
    enabled: isAutosavePilotEnabled({ user, company }),
    env: import.meta.env.DEV ? 'development' : 'built',
    localStorageOverride: lsGet(FLAG_KEY),                 // endast diagnostik/dev – ej auktoritativ i prod
    allowlistedCompany: !!(company?.id && TEST_COMPANY_IDS.has(company.id)),
    allowlistedUser: !!(user?.id && TEST_USER_IDS.has(user.id)),
  }
}
