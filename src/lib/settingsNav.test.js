import { describe, it, expect } from 'vitest'
import { activeSettingsLabels, isSettingsSection } from './settingsNav'

describe('Inställningar – aktiv undermeny', () => {
  it('på /installningar/kontoplan är ENDAST Kontoplan aktiv', () => {
    expect(activeSettingsLabels('/installningar/kontoplan')).toEqual(['Kontoplan'])
  })
  it('på dynamisk under-route /installningar/kontoplan/3041 är ENDAST Kontoplan aktiv', () => {
    expect(activeSettingsLabels('/installningar/kontoplan/3041')).toEqual(['Kontoplan'])
  })
  it('på /installningar är ENDAST Företagsinställningar aktiv', () => {
    expect(activeSettingsLabels('/installningar')).toEqual(['Företagsinställningar'])
  })
  it('på /installningar/team är ENDAST Användare & behörighet aktiv', () => {
    expect(activeSettingsLabels('/installningar/team')).toEqual(['Användare & behörighet'])
  })
  it('på /installningar/rakenskapsar är ENDAST Räkenskapsår och IB aktiv', () => {
    expect(activeSettingsLabels('/installningar/rakenskapsar')).toEqual(['Räkenskapsår och IB'])
  })
  it('på /installningar/artikelkontering är ENDAST Artikelkontering aktiv', () => {
    expect(activeSettingsLabels('/installningar/artikelkontering')).toEqual(['Artikelkontering'])
  })
  it('aldrig flera aktiva samtidigt på en inställningssida', () => {
    for (const p of ['/installningar', '/installningar/kontoplan', '/installningar/kontoplan/9999', '/installningar/team', '/installningar/kassa-bankkonton', '/installningar/rakenskapsar', '/installningar/import-export']) {
      expect(activeSettingsLabels(p).length).toBeLessThanOrEqual(1)
    }
  })
  it('placeholders (Löneinställningar/Artikelkontering/Bokföringsmallar) lyser inte upp på /installningar', () => {
    const aktiva = activeSettingsLabels('/installningar')
    expect(aktiva).not.toContain('Löneinställningar')
    expect(aktiva).not.toContain('Artikelkontering')
    expect(aktiva).not.toContain('Bokföringsmallar')
  })
})

describe('isSettingsSection (håll parent öppen)', () => {
  it('är true på inställningssidor', () => {
    expect(isSettingsSection('/installningar')).toBe(true)
    expect(isSettingsSection('/installningar/kontoplan')).toBe(true)
  })
  it('är false utanför inställningar', () => {
    expect(isSettingsSection('/bokforing')).toBe(false)
    expect(isSettingsSection('/')).toBe(false)
  })
})
