// Valideringsvakter för leverantörsfakturor (säkerhetskärnan, del 1).
// Rena funktioner som körs innan en faktura sparas/bokförs. Returnerar fel (blockerar
// bokföring) och varningar (påminner men blockerar inte – utkast får sparas ändå).
// Dubblettkoll mot databasen sker i komponenten (kräver DB) – se findDuplicateInvoice nedan.

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[−‒–—―]/g, '-').replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const isISODate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

export const VALID_VAT_RATES = [0, 6, 12, 25]

// Stämmer momsbeloppet mot en svensk momssats av nettot? Tolerans 1 kr / 1 % (öresavrundning).
// Returnerar { ok, impliedRate, closest }. Vid net≈0 ska moms också vara ≈0.
export function vatRateMatches(net, moms) {
  const n = Math.abs(r2(net)), m = Math.abs(r2(moms))
  if (n < 1) return { ok: m < 1, impliedRate: m < 1 ? 0 : null, closest: 0 }
  const implied = m / n * 100
  const closest = VALID_VAT_RATES.reduce((b, r) => (Math.abs(r - implied) < Math.abs(b - implied) ? r : b), VALID_VAT_RATES[0])
  const ok = Math.abs(m - n * closest / 100) <= Math.max(1, n * 0.01)
  return { ok, impliedRate: r2(implied), closest }
}

// Validera fakturahuvudets belopp och datum. total/moms får vara strängar (sv-format) eller tal.
export function validateLevfaktura({ total, moms, fakturadatum, forfallodatum } = {}) {
  const errors = [], warnings = []
  const T = Math.abs(num(total)), M = Math.abs(num(moms))

  // Moms kan aldrig vara större än totalbeloppet.
  if (T > 0 && M > T + 0.01) errors.push('Momsbeloppet är större än totalbeloppet – kontrollera Total och Moms.')

  // Momssatsen ska rimlighetskontrolleras (0/6/12/25 %). Varning, ej fel: momsfritt,
  // omvänd skattskyldighet och utländsk moms kan ge avvikande sats.
  if (T > 0 && M <= T + 0.01) {
    const { ok, impliedRate } = vatRateMatches(T - M, M)
    if (!ok && impliedRate != null) warnings.push(`Momsen motsvarar ${impliedRate} % av nettot – kontrollera momssatsen (normalt 0, 6, 12 eller 25 %).`)
  }

  // Förfallodatum får inte ligga före fakturadatum (varning).
  if (isISODate(fakturadatum) && isISODate(forfallodatum) && forfallodatum < fakturadatum) {
    warnings.push('Förfallodatumet ligger före fakturadatumet – kontrollera datumen.')
  }

  return { errors, warnings }
}
