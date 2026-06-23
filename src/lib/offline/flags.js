// Feature flag för autosave-piloten — Etapp 2A.
// AV som standard i produktion. Kan aktiveras för testbolag/testanvändare eller via localStorage-override.
// Flaggan är INTE den enda säkerhetskontrollen (identitet/RLS/servervalidering gäller alltid).
const FLAG_KEY = 'bokpilot.flags.autosavePilot'

// Testbolag (BokPilot AB – Test). Lägg ev. till fler test-id:n här vid behov.
const TEST_COMPANY_IDS = new Set(['4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'])

export function isAutosavePilotEnabled({ company } = {}) {
  // 1) Explicit override per enhet (för test): '1' = på, '0' = av.
  try {
    const o = localStorage.getItem(FLAG_KEY)
    if (o === '1') return true
    if (o === '0') return false
  } catch { /* ignore */ }
  // 2) Dev/preview-bygge: på (för utveckling/test).
  if (!import.meta.env.PROD) return true
  // 3) Produktion: endast uttalade testbolag.
  if (company?.id && TEST_COMPANY_IDS.has(company.id)) return true
  return false
}

export function autosaveFlagDiagnostics({ company } = {}) {
  let override = null
  try { override = localStorage.getItem(FLAG_KEY) } catch { /* ignore */ }
  return { enabled: isAutosavePilotEnabled({ company }), override, prod: !!import.meta.env.PROD, testCompany: !!(company?.id && TEST_COMPANY_IDS.has(company.id)) }
}
