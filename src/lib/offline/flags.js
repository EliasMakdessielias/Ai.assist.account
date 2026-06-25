// Feature flag för autosave-piloten — Etapp 2A/2B/2C.
//
// AUKTORITATIV aktivering i byggd miljö är SERVERSTYRD: passera `serverEnabled` (resultatet av
// has_ai_feature(company, 'offline_autosave_pilot')), som styrs via company_ai_features/plan i databasen
// med RLS. Produktionsaktivering styrs ALDRIG av hårdkodade frontend-ID:n, localStorage eller URL-parametrar.
//
// - DEV (vite dev): på för lokal utveckling; localStorage='0' kan stänga av lokalt.
// - Byggd miljö (production/preview/staging/okänd): endast `serverEnabled` aktiverar. Frontend-flaggan är
//   presentation; serverbehörighet + RLS + servervalidering är auktoritativa.
export const PILOT_FEATURE_KEY = 'offline_autosave_pilot'
const FLAG_KEY = 'bokpilot.flags.autosavePilot'

function lsGet(k) { try { return localStorage.getItem(k) } catch { return null } }

export function isAutosavePilotEnabled({ serverEnabled = false } = {}) {
  if (import.meta.env.DEV) return lsGet(FLAG_KEY) !== '0'   // lokal utveckling
  return !!serverEnabled                                     // byggd miljö: endast serverstyrt
}

// Explicit company-level uppslag av pilotbeslutet. INGEN plan-fallback (till skillnad från has_ai_feature):
// endast en uttrycklig rad i company_ai_features med enabled=true aktiverar. Frånvaro, enabled=false,
// flera rader, läsfel eller ogiltigt svar → ALLTID false. Klienten kan inte skriva raden (RLS, verifierat).
export async function fetchPilotServerEnabled(supabase, companyId) {
  if (!supabase || !companyId) return false
  try {
    const { data, error } = await supabase
      .from('company_ai_features')
      .select('enabled')
      .eq('company_id', companyId)
      .eq('feature_key', PILOT_FEATURE_KEY)
      .maybeSingle()                       // PK (company_id, feature_key) ⇒ ≤1 rad; >1 ⇒ error ⇒ false
    if (error) return false
    return data?.enabled === true
  } catch { return false }
}

// ── Etapp 3C: synkkö-prototyp (offline_autosave_sync) ──
// AVSTÄNGD som default i ALLA miljöer. Auktoritativ aktivering är ENBART serverstyrd (explicit company_ai_features-rad,
// enabled=true, INGEN plan-fallback). localStorage/URL/frontend-state kan ALDRIG aktivera i byggd miljö.
// I dev krävs uttrycklig opt-in (localStorage='1') OCH serverflagga – annars av (testbart "tidigare beteende").
export const SYNC_FEATURE_KEY = 'offline_autosave_sync'
const SYNC_FLAG_KEY = 'bokpilot.flags.syncQueue'

export function isSyncQueueEnabled({ serverEnabled = false } = {}) {
  if (!serverEnabled) return false                            // server är auktoritativ i ALLA miljöer (default av)
  if (import.meta.env.DEV) return lsGet(SYNC_FLAG_KEY) === '1'   // dev: dessutom uttrycklig lokal opt-in
  return true                                                  // byggd miljö: serverflaggan räcker (men aktiveras endast på isolerat testbolag)
}

// Explicit company-level uppslag. INGEN plan-fallback (till skillnad från has_ai_feature). Frånvaro/false/fel → false.
export async function fetchSyncServerEnabled(supabase, companyId) {
  if (!supabase || !companyId) return false
  try {
    const { data, error } = await supabase
      .from('company_ai_features')
      .select('enabled')
      .eq('company_id', companyId)
      .eq('feature_key', SYNC_FEATURE_KEY)
      .maybeSingle()
    if (error) return false
    return data?.enabled === true
  } catch { return false }
}

// Diagnostik UTAN payload/känslig text.
export function syncQueueDiagnostics({ serverEnabled = false, companyId = null, pendingCount = 0, leaderMode = null, isLeader = null } = {}) {
  return {
    queueFeatureLoaded: true,
    serverFlagStatus: serverEnabled ? 'enabled' : 'disabled',
    enabled: isSyncQueueEnabled({ serverEnabled }),
    activeCompanyId: companyId,
    pendingOperations: pendingCount,
    leaderMode, isLeader,
    env: import.meta.env.DEV ? 'development' : 'built',
    featureKey: SYNC_FEATURE_KEY,
  }
}

export function autosaveFlagDiagnostics({ serverEnabled = false } = {}) {
  return {
    enabled: isAutosavePilotEnabled({ serverEnabled }),
    env: import.meta.env.DEV ? 'development' : 'built',
    serverEnabled: !!serverEnabled,
    featureKey: PILOT_FEATURE_KEY,
    localStorageOverride: lsGet(FLAG_KEY),                   // endast dev-override/diagnostik – ej auktoritativ i prod
  }
}
