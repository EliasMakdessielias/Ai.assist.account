import { describe, it, expect } from 'vitest'
import { pageLabel, openObjectId, contextSummary, contextBlock, workContext } from './supportContext'

describe('supportContext', () => {
  it('pageLabel ger läsbart namn, specifika mönster före listvyer', () => {
    expect(pageLabel('/')).toBe('Översikt')
    expect(pageLabel('/leverantorsfakturor/ny')).toBe('Leverantörsfaktura – Ny')
    expect(pageLabel('/leverantorsfakturor/3a4121c3-15ac-4035-993e-d2de891f58af')).toBe('Leverantörsfaktura')
    expect(pageLabel('/leverantorsfakturor')).toBe('Leverantörsfakturor')
    expect(pageLabel('/bokforing/ny')).toBe('Bokföring – Skapa verifikation')
    expect(pageLabel('/lon/anstallda')).toBe('Lön – Anställda')
    expect(pageLabel('/nagot-okant')).toBe('BokPilot')
  })

  it('openObjectId plockar uuid/nummer ur route, annars null', () => {
    expect(openObjectId('/fakturor/3a4121c3-15ac-4035-993e-d2de891f58af')).toBe('3a4121c3-15ac-4035-993e-d2de891f58af')
    expect(openObjectId('/installningar/kontoplan/1930')).toBe('1930')
    expect(openObjectId('/leverantorsfakturor/ny')).toBeNull()
    expect(openObjectId('/bokforing')).toBeNull()
  })

  it('contextSummary beskriver vy och objekt', () => {
    expect(contextSummary({ sida: 'Leverantörsfaktura', objektId: null })).toBe('Användaren befinner sig på Leverantörsfaktura.')
    expect(contextSummary({ sida: 'Kundfaktura', objektId: 'abc-123' })).toContain('arbetar med objekt abc-123')
    expect(contextSummary(null)).toBe('')
  })

  it('contextBlock innehåller vy, företag och tid', () => {
    const ctx = workContext({ pathname: '/bokforing/ny', user: { email: 'a@b.se' }, company: { id: 'c1', name: 'Acme' }, role: 'user' })
    const block = contextBlock(ctx)
    expect(block).toContain('Vy: Bokföring – Skapa verifikation (/bokforing/ny)')
    expect(block).toContain('Företag: Acme')
    expect(block).toContain('a@b.se')
    expect(ctx.sida).toBe('Bokföring – Skapa verifikation')
  })
})
