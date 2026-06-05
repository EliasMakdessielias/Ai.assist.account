import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BRAND, APP_NAME, PRODUCT_NAME, COMPANY_NAME, TAGLINE } from './brand'

describe('brand-konfiguration', () => {
  it('produktnamnet är exakt "BokPilot"', () => {
    expect(BRAND.appName).toBe('BokPilot')
    expect(BRAND.productName).toBe('BokPilot')
    expect(APP_NAME).toBe('BokPilot')
    expect(PRODUCT_NAME).toBe('BokPilot')
    // inte "Bok Pilot" med mellanslag eller "Bokpilot" med litet p
    expect(BRAND.appName).not.toMatch(/Bok Pilot|Bokpilot/)
  })
  it('företagsnamnet (bolaget) är "BokPilot AB"', () => {
    expect(BRAND.companyName).toBe('BokPilot AB')
    expect(COMPANY_NAME).toBe('BokPilot AB')
  })
  it('underrubriken är "Bokföring & ekonomi"', () => {
    expect(BRAND.tagline).toBe('Bokföring & ekonomi')
    expect(TAGLINE).toBe('Bokföring & ekonomi')
  })
  it('har en SEO-beskrivning', () => {
    expect(BRAND.description).toMatch(/BokPilot automatiserar svensk bokföring/)
  })
})

// Regressionsskydd: gamla produktnamn får inte finnas kvar i UI/exporter.
// (Företagsnamnet "BokPilot AB" är tillåtet – men det förekommer inte i dessa filer.)
describe('inga gamla produktnamn kvar', () => {
  const files = ['index.html', 'src/components/Sidebar.jsx', 'src/pages/Login.jsx', 'src/pages/Sie.jsx']
  for (const f of files) {
    it(`${f} innehåller varken "Böcker" eller "Redo Flow"`, () => {
      const content = readFileSync(f, 'utf8')
      expect(content).not.toMatch(/Böcker/)
      expect(content).not.toMatch(/Redo ?Flow/i)
    })
  }
})
