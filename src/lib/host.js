// Värd-medvetenhet: bokpilot.se (apex) = marknadssida/skal, app.bokpilot.se = appen.
// Övriga värdar (localhost, *.vercel.app) räknas som "app" så utveckling/preview funkar.

export const APP_ORIGIN = 'https://app.bokpilot.se'
export const MARKETING_ORIGIN = 'https://bokpilot.se'

export function isMarketingHost() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  return h === 'bokpilot.se' || h === 'www.bokpilot.se'
}

// Vart "Logga in"-knappen på skalet ska leda. På riktiga apex-domänen → appens
// subdomän. Lokalt/preview → den lokala inloggningssidan, så knappen funkar ändå.
export function appLoginUrl() {
  return isMarketingHost() ? APP_ORIGIN + '/login' : '/login'
}
