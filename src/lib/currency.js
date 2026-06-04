// Central valutakonfiguration för BokPilot. Endast dessa valutor stöds.
// Koder enligt ISO 4217.
export const SUPPORTED_CURRENCIES = [
  { code: 'SEK', name: 'Svensk krona', symbol: 'kr' },
  { code: 'USD', name: 'Amerikansk dollar', symbol: '$' },
  { code: 'GBP', name: 'Brittiskt pund', symbol: '£' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
]

export const CURRENCY_CODES = SUPPORTED_CURRENCIES.map(c => c.code)
export const DEFAULT_CURRENCY = 'SEK'

const BY_CODE = Object.fromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, c]))

export function isSupportedCurrency(code) {
  return CURRENCY_CODES.includes(String(code ?? '').trim().toUpperCase())
}

export function currencySymbol(code) {
  return BY_CODE[String(code ?? '').trim().toUpperCase()]?.symbol || ''
}

export function currencyName(code) {
  return BY_CODE[String(code ?? '').trim().toUpperCase()]?.name || ''
}

// Normalisera en upptäckt valuta (från OCR/import) till en stödd ISO-kod.
// Returnerar en av SEK/USD/GBP/EUR, eller null om okänd (flagga för manuell hantering).
export function normalizeCurrency(raw) {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) return null
  if (CURRENCY_CODES.includes(s)) return s
  const map = {
    KR: 'SEK', SEK: 'SEK', SKR: 'SEK', KRONA: 'SEK', KRONOR: 'SEK', 'KR.': 'SEK',
    $: 'USD', USD: 'USD', 'US$': 'USD', USD$: 'USD', DOLLAR: 'USD', DOLLARS: 'USD',
    '£': 'GBP', GBP: 'GBP', POUND: 'GBP', POUNDS: 'GBP', 'GBP£': 'GBP',
    '€': 'EUR', EUR: 'EUR', EURO: 'EUR', EUROS: 'EUR',
  }
  return map[s] || null
}

// Formatering enligt specifikation:
//   SEK: 1 250,00 kr   USD: $1,250.00   GBP: £1,250.00   EUR: €1,250.00
export function formatCurrency(amount, code = DEFAULT_CURRENCY) {
  const c = String(code ?? '').trim().toUpperCase()
  const n = Number(amount) || 0
  if (c === 'SEK') {
    return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr'
  }
  const sym = currencySymbol(c) || (c ? c + ' ' : '')
  const sign = n < 0 ? '-' : ''
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return sign + sym + body
}
