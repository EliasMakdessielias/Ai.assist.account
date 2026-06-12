// Rättelseflödets klientlogik (ren, testbar). Sanningen bor i DB:n
// (RPC ratta_verifikation + periodlås-triggers) – detta är UX-stödet:
// föreslå rätt bokföringsdatum och förklara låst period INNAN anropet.

// Sista låsta dagen enligt companies.bokforing_last_tom ('YYYY-MM' från
// Inställningar, alt. 'YYYY-MM-DD'). null = inget lås.
export function lockEndDate(bokforingLastTom) {
  const s = String(bokforingLastTom || '').trim()
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0))   // dag 0 i nästa månad = sista dagen i m
    return last.toISOString().slice(0, 10)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

// Är ett bokföringsdatum låst av periodlåset?
export function arLastDatum(datum, bokforingLastTom) {
  const end = lockEndDate(bokforingLastTom)
  return !!(end && datum && datum <= end)
}

// Föreslå bokföringsdatum för en rättelse av `originalDatum`:
// originalets datum om perioden är öppen, annars första dagen efter låset.
// `lastPeriod` styr infotexten "Originalverifikationen ligger i låst period…".
export function foreslaRattelsedatum(originalDatum, bokforingLastTom) {
  const end = lockEndDate(bokforingLastTom)
  if (!end || !originalDatum || originalDatum > end) {
    return { datum: originalDatum, lastPeriod: false }
  }
  const d = new Date(end + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return { datum: d.toISOString().slice(0, 10), lastPeriod: true }
}
