import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_CURRENCIES, CURRENCY_CODES, DEFAULT_CURRENCY,
  isSupportedCurrency, normalizeCurrency, formatCurrency, currencySymbol,
} from './currency'

const nb = s => s.replace(/ /g, ' ') // normalisera hårda mellanslag (sv-SE)

describe('valutakonfiguration', () => {
  it('stöder exakt SEK, USD, GBP, EUR', () => {
    expect(CURRENCY_CODES).toEqual(['SEK', 'USD', 'GBP', 'EUR'])
    expect(SUPPORTED_CURRENCIES.find(c => c.code === 'SEK').symbol).toBe('kr')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('EUR')).toBe('€')
  })
  it('standardvaluta är SEK', () => {
    expect(DEFAULT_CURRENCY).toBe('SEK')
  })
})

describe('isSupportedCurrency', () => {
  it('godkänner tillåtna valutor (case-insensitive)', () => {
    expect(isSupportedCurrency('SEK')).toBe(true)
    expect(isSupportedCurrency('usd')).toBe(true)
    expect(isSupportedCurrency('GBP')).toBe(true)
    expect(isSupportedCurrency('eur')).toBe(true)
  })
  it('avvisar otillåtna valutor', () => {
    expect(isSupportedCurrency('NOK')).toBe(false)
    expect(isSupportedCurrency('DKK')).toBe(false)
    expect(isSupportedCurrency('JPY')).toBe(false)
    expect(isSupportedCurrency('')).toBe(false)
    expect(isSupportedCurrency(null)).toBe(false)
  })
})

describe('normalizeCurrency (OCR/import)', () => {
  it('mappar symboler och text till ISO-kod', () => {
    expect(normalizeCurrency('kr')).toBe('SEK')
    expect(normalizeCurrency('SEK')).toBe('SEK')
    expect(normalizeCurrency('$')).toBe('USD')
    expect(normalizeCurrency('dollar')).toBe('USD')
    expect(normalizeCurrency('£')).toBe('GBP')
    expect(normalizeCurrency('€')).toBe('EUR')
    expect(normalizeCurrency('euro')).toBe('EUR')
  })
  it('returnerar null för okänd valuta (flaggas manuellt)', () => {
    expect(normalizeCurrency('NOK')).toBeNull()
    expect(normalizeCurrency('JPY')).toBeNull()
    expect(normalizeCurrency('')).toBeNull()   // saknad valuta → använd standard SEK i anroparen
    expect(normalizeCurrency(null)).toBeNull()
  })
})

describe('formatCurrency', () => {
  it('SEK: 1 250,00 kr', () => {
    expect(nb(formatCurrency(1250, 'SEK'))).toBe('1 250,00 kr')
  })
  it('USD: $1,250.00', () => {
    expect(formatCurrency(1250, 'USD')).toBe('$1,250.00')
  })
  it('GBP: £1,250.00', () => {
    expect(formatCurrency(1250, 'GBP')).toBe('£1,250.00')
  })
  it('EUR: €1,250.00', () => {
    expect(formatCurrency(1250, 'EUR')).toBe('€1,250.00')
  })
  it('standardvaluta SEK när kod saknas', () => {
    expect(nb(formatCurrency(1250))).toBe('1 250,00 kr')
  })
  it('hanterar negativa belopp', () => {
    expect(formatCurrency(-1250, 'USD')).toBe('-$1,250.00')
  })
})
