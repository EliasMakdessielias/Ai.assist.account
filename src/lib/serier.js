// Verifikationsserier – returnerar företagets valda serie för en given typ,
// annars en standardserie. Konfigureras i Företagsinställningar → Bokföringsuppgifter.
export const SERIE_DEFAULTS = {
  kundfakturor: 'K - Kundfakturor',
  inbetalningar: 'I - Inbetalningar',
  leverantorsfakturor: 'L - Leverantörsfakturor',
  kvitto: 'D - Kvitto',
  utbetalningar: 'U - Utbetalningar',
  kassabank: 'C - Kassa och bank',
  moms: 'N - Moms',
  korrigeringar: 'R - Rättelser',
  anlaggning: 'A - Anläggningstillgångar',
  ovrigt: 'M - Manuella verifikationer',
  loner: 'L - Löner',
  arbgiv: 'G - Arbetsgivardeklarationer',
  bokslut: 'B - Bokslutsverifikationer',
}

export function serie(company, key) {
  const v = company?.settings?.serier?.[key]
  return (v && String(v).trim()) || SERIE_DEFAULTS[key] || 'M - Manuella verifikationer'
}
