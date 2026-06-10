// Värd-medvetenhet: bokpilot.se (apex) = marknadssida/skal, app.bokpilot.se = appen.
// Övriga värdar (localhost, *.vercel.app) räknas som "app" så utveckling/preview funkar.

export const APP_ORIGIN = 'https://app.bokpilot.se'
export const MARKETING_ORIGIN = 'https://bokpilot.se'
export const ADMIN_ORIGIN = 'https://admin.bokpilot.se'

export function isMarketingHost() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  return h === 'bokpilot.se' || h === 'www.bokpilot.se'
}

// Admin Control Center: admin.bokpilot.se (separat plattform, host-gated i samma deploy).
// Lokalt/preview kan adminskalet tvingas fram med ?admin i URL:en (samma mönster som ?landing).
export function isAdminHost() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  if (h === 'admin.bokpilot.se') return true
  try { return new URLSearchParams(window.location.search).has('admin') } catch { return false }
}

// Vart "Logga in"-knappen på skalet ska leda. På riktiga apex-domänen → appens
// subdomän. Lokalt/preview → den lokala inloggningssidan, så knappen funkar ändå.
export function appLoginUrl() {
  return isMarketingHost() ? APP_ORIGIN + '/login' : '/login'
}
