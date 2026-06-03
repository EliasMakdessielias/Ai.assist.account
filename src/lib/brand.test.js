import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BRAND, APP_NAME, COMPANY_NAME, TAGLINE } from './brand'

describe('brand-konfiguration', () => {
  it('produktnamnet är "Redo Flow"', () => {
    expect(BRAND.appName).toBe('Redo Flow')
    expect(APP_NAME).toBe('Redo Flow')
  })
  it('företagsnamnet är "REDOFLOW AB"', () => {
    expect(BRAND.companyName).toBe('REDOFLOW AB')
    expect(COMPANY_NAME).toBe('REDOFLOW AB')
  })
  it('underrubriken är "Bokföring & ekonomi"', () => {
    expect(BRAND.tagline).toBe('Bokföring & ekonomi')
    expect(TAGLINE).toBe('Bokföring & ekonomi')
  })
  it('innehåller inte det gamla varumärket', () => {
    expect(JSON.stringify(BRAND)).not.toMatch(/Böcker/)
  })
})

// Regressionsskydd: det gamla varumärket "Böcker" får inte finnas kvar i UI/exporter.
describe('inga gamla varumärkesnamn kvar', () => {
  const files = [
    'index.html',
    'src/components/Sidebar.jsx',
    'src/pages/Login.jsx',
    'src/pages/Sie.jsx',
  ]
  for (const f of files) {
    it(`${f} innehåller inte "Böcker"`, () => {
      expect(readFileSync(f, 'utf8')).not.toMatch(/Böcker/)
    })
  }
})
