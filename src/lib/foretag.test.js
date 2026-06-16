import { describe, it, expect } from 'vitest'
import { MOMSPERIODER, momsperiodOptions, momsRedovisas, bokforingsmetodLabel, nextFiscalYear } from './foretag'

describe('momsperiod', () => {
  it('har de fem alternativen från bilden', () => {
    expect(MOMSPERIODER).toEqual([
      'Redovisar ej moms', 'Årsvis', 'Kvartalsvis',
      'En gång per månad (12:e i månaden)', 'En gång per månad (26:e i månaden)',
    ])
  })
  it('momsperiodOptions inkluderar äldre lagrat värde (bakåtkompatibel)', () => {
    expect(momsperiodOptions('Varje kvartal')[0]).toBe('Varje kvartal')
    expect(momsperiodOptions('Kvartalsvis')).toEqual(MOMSPERIODER)   // redan i listan, dupliceras ej
    expect(momsperiodOptions('')).toEqual(MOMSPERIODER)
  })
  it('momsRedovisas: falskt endast för "Redovisar ej moms"', () => {
    expect(momsRedovisas('Kvartalsvis')).toBe(true)
    expect(momsRedovisas('Redovisar ej moms')).toBe(false)
    expect(momsRedovisas('')).toBe(false)
  })
})

describe('bokforingsmetodLabel', () => {
  it('mappar metodnyckel till svensk etikett', () => {
    expect(bokforingsmetodLabel('faktura')).toBe('Faktureringsmetoden')
    expect(bokforingsmetodLabel('kontant')).toBe('Kontantmetoden')
  })
})

describe('nextFiscalYear', () => {
  it('kalenderår: 2025 -> 2026 (1 jan–31 dec)', () => {
    expect(nextFiscalYear([{ year: 2025, start_date: '2025-01-01', end_date: '2025-12-31' }]))
      .toEqual({ year: 2026, start_date: '2026-01-01', end_date: '2026-12-31' })
  })
  it('väljer senaste året och hoppar inte över', () => {
    const years = [
      { year: 2024, start_date: '2024-01-01', end_date: '2024-12-31' },
      { year: 2025, start_date: '2025-01-01', end_date: '2025-12-31' },
    ]
    expect(nextFiscalYear(years).year).toBe(2026)
  })
  it('brutet räkenskapsår bevaras (1 jul–30 jun)', () => {
    expect(nextFiscalYear([{ year: 2025, start_date: '2024-07-01', end_date: '2025-06-30' }]))
      .toEqual({ year: 2025, start_date: '2025-07-01', end_date: '2026-06-30' })
  })
  it('tom lista -> angivet innevarande år', () => {
    expect(nextFiscalYear([], 2026)).toEqual({ year: 2026, start_date: '2026-01-01', end_date: '2026-12-31' })
  })
})
