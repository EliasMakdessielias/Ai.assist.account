// [FOLIO_OCR_EXPERIMENTAL_PROVIDER] – ren statusmappning för UI (krav 3/5/7/8).
// Översätter ocr-folio-svar till lugna, användarvänliga lägen. Inget tekniskt rått fel
// visas när Folio är av eller saknar konfiguration.

export const FOLIO_STATES = {
  disabled:       { tone: 'gray',  label: 'Folio-OCR är inaktiverad' },
  not_configured: { tone: 'amber', label: 'Folio-OCR är inte konfigurerad' },
  available:      { tone: 'green', label: 'Folio-OCR är tillgänglig' },
  unavailable:    { tone: 'red',   label: 'Folio-OCR svarar inte' },
  unknown:        { tone: 'gray',  label: 'Folio-OCR: status okänd' },
}

// Härleder status från ett health-/run-svar. Stödjer nytt { status } och äldre { available, reason }.
export function folioStatus(resp) {
  if (!resp) return 'unknown'
  if (resp.status && FOLIO_STATES[resp.status]) return resp.status
  if (resp.available === false) {
    if (resp.reason === 'not_configured') return 'not_configured'
    if (resp.reason === 'disabled') return 'disabled'
    return 'unavailable'
  }
  if (resp.available === true) return 'available'
  return 'unknown'
}

export function folioStatusMeta(resp) {
  const state = folioStatus(resp)
  return { state, ...FOLIO_STATES[state] }
}

// Tolkar ett OCR-körresultat till ett UI-vänligt utfall (krav 5/7).
// Folio-fel påverkar ALDRIG Gemini och skapar inga dokumentposter.
export function folioRunOutcome(resp) {
  if (!resp) return { kind: 'none' }
  const state = folioStatus(resp)
  if (state === 'disabled') return { kind: 'disabled', label: FOLIO_STATES.disabled.label }
  if (state === 'not_configured') return { kind: 'not_configured', label: FOLIO_STATES.not_configured.label }
  if (resp.result) return { kind: 'ok', result: resp.result }
  const reason = resp.error === 'timeout' ? 'timeout' : (resp.error || 'fel')
  return { kind: 'failed', reason, label: 'Folio misslyckades, Gemini påverkas inte' }
}

// Ska "Tolka med Folio"-knappen vara inaktiverad? (av eller ej konfigurerad)
export function folioButtonDisabled(state) {
  return state === 'disabled' || state === 'not_configured'
}
