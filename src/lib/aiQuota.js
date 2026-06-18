// Hjälpare för AI-quota-cooldown i UI: countdown + tydliga meddelanden.
// Ren, testbar logik (ingen React/DOM). Används av dokumentvisaren för att
// inaktivera "Tolka underlaget" och visa "Försök igen om N sekunder".

export const DEFAULT_COOLDOWN_SECONDS = 60
export const COOLDOWN_STORAGE_KEY = 'bokpilot.ocr.cooldownUntil'

// Antal sekunder för visning: ändliga värden golvas till 1, annars default.
function coerceSeconds(seconds) {
  const n = Number(seconds)
  return Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : DEFAULT_COOLDOWN_SECONDS
}

// Standardmeddelande vid quota – antyder ALDRIG att underlaget/bilden är fel.
export function quotaMessage(seconds) {
  return `AI-kvoten är tillfälligt slut. Försök igen om ${coerceSeconds(seconds)} sekunder.`
}

// Återstående hela sekunder till `until` (ms-epoch eller Date), räknat från `now` (ms-epoch).
export function remainingSeconds(until, now = Date.now()) {
  if (!until) return 0
  const t = until instanceof Date ? until.getTime() : Number(until)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.ceil((t - now) / 1000))
}

// true om en cooldown är aktiv (har tid kvar).
export function isCoolingDown(until, now = Date.now()) {
  return remainingSeconds(until, now) > 0
}

// Plockar ut ett cooldown-tillstånd ur ett tolka-svar ELLER ett kastat fel.
// Returnerar { seconds, scope } vid quota/rate limit, annars null.
export function quotaFrom(x) {
  if (!x || typeof x !== 'object') return null
  const code = x.code
  if (code !== 'quota_cooldown' && code !== 'rate_limited' && code !== 'cooldown') return null
  const retry = Number(x.retry_after_seconds ?? x.retryAfter ?? x.retry_after)
  return { seconds: Number.isFinite(retry) && retry > 0 ? retry : DEFAULT_COOLDOWN_SECONDS, scope: x.scope || null }
}

// Absolut sluttid (ms-epoch) för en cooldown som börjar nu och varar `seconds`.
export function cooldownUntilFrom(seconds, now = Date.now()) {
  return now + coerceSeconds(seconds) * 1000
}
