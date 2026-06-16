// Per-fält säkerhet (confidence) → granskningsspärr i UI (säkerhetskärnan, del 2).
// Tolkningen (Gemini) ger falt_sakerhet { fält: 0–1 }. Trösklar:
//   ≥0.95  grön  (ok, fyll i automatiskt)
//   0.80–0.95 gul (granska)
//   <0.80  röd  (osäker – blockerar bokföring tills användaren ändrar/bekräftar fältet)
// Ett fält som användaren själv ändrat eller bekräftat räknas alltid som verifierat (grönt).

export const CONF_OK = 0.95
export const CONF_GRANSKA = 0.80

export const KRITISKA_FALT = {
  leverantor: 'Leverantör',
  fakturadatum: 'Fakturadatum',
  forfallodatum: 'Förfallodatum',
  belopp_inkl_moms: 'Total',
  moms_belopp: 'Moms',
  fakturanummer: 'Fakturanummer',
  ocr: 'OCR',
}

// Nivå för ett enskilt score. null om okänt (då gäller ingen spärr).
export function faltNiva(score) {
  if (score == null || isNaN(Number(score))) return null
  const s = Number(score)
  if (s >= CONF_OK) return 'ok'
  if (s >= CONF_GRANSKA) return 'granska'
  return 'osaker'
}

// Effektiv nivå med hänsyn till verifiering (manuell ändring/val) och vald leverantör.
export function effektivNiva(field, { faltSak, verifierat = {}, supplierId } = {}) {
  if (verifierat[field]) return 'ok'
  if (field === 'leverantor' && supplierId) return 'ok'
  return faltNiva(faltSak?.[field])
}

// Kritiska fält som måste granskas innan bokföring: nivå 'osaker' som inte verifierats.
// Fakturanummer/OCR räknas som ETT krav – minst ett av dem måste vara säkert.
export function granskningskravda({ faltSak, verifierat = {}, supplierId } = {}) {
  if (!faltSak) return []
  const niv = f => effektivNiva(f, { faltSak, verifierat, supplierId })
  const krav = []
  ;['leverantor', 'fakturadatum', 'forfallodatum', 'belopp_inkl_moms', 'moms_belopp'].forEach(f => {
    if (niv(f) === 'osaker') krav.push({ key: f, label: KRITISKA_FALT[f] })
  })
  if (niv('fakturanummer') === 'osaker' && niv('ocr') === 'osaker') {
    krav.push({ key: 'fakturanummer_ocr', label: 'Fakturanummer/OCR', fields: ['fakturanummer', 'ocr'] })
  }
  return krav
}
