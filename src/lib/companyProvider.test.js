import { describe, it, expect } from 'vitest'
import { companyToKundForm, diffFormValues, primarySni } from './companyProvider'

// Syntetisk intern modell (mockdata – endast i test, aldrig påhittade riktiga företag i prod).
const COMPANY = {
  organizationNumber: '5560360793',
  legalName: 'Nordic Example AB',
  status: 'Aktivt',
  address: { street: 'Besöksgatan 1', postalCode: '11122', city: 'Stockholm', country: 'Sverige', careOf: '' },
  postalAddress: { street: 'Box 100', postalCode: '10010', city: 'Stockholm', country: 'Sverige', careOf: 'c/o Ekonomi' },
  contact: { phone: '08-1234567', mobile: '070-1112233', email: 'info@nordic.se', website: 'nordic.se' },
  taxRegistration: { vatNumber: 'SE556036079301' },
  industries: [{ code: '62010', description: 'Datakonsultverksamhet' }, { code: '70220', description: 'Konsult' }],
}

describe('companyToKundForm', () => {
  it('mappar intern modell till formulärfält och listar ifyllda nycklar', () => {
    const { values, filledKeys } = companyToKundForm(COMPANY)
    expect(values.name).toBe('Nordic Example AB')
    expect(values.org_nr).toBe('556036-0793')          // formaterat
    expect(values.address).toBe('Box 100')             // postadress prioriteras
    expect(values.postnr).toBe('10010')
    expect(values.ort).toBe('Stockholm')
    expect(values.address2).toBe('c/o Ekonomi')
    expect(values.phone).toBe('08-1234567')
    expect(values.telefon2).toBe('070-1112233')
    expect(values.email).toBe('info@nordic.se')
    expect(values.webb).toBe('nordic.se')
    expect(values.vat_nummer).toBe('SE556036079301')
    expect(values.sni).toBe('62010 Datakonsultverksamhet')   // primär SNI
    expect(filledKeys).toContain('sni')
    expect(values.kundtyp).toBe('foretag')
    expect(filledKeys).toContain('name')
    expect(filledKeys).not.toContain('kundtyp')         // kundtyp får ingen "hämtad"-etikett
  })

  it('faller tillbaka på besöksadress när postadress saknas', () => {
    const { values } = companyToKundForm({ ...COMPANY, postalAddress: {} })
    expect(values.address).toBe('Besöksgatan 1')
    expect(values.postnr).toBe('11122')
  })

  it('utelämnar tomma fält (ingen etikett, ingen överskrivning)', () => {
    const { values, filledKeys } = companyToKundForm({ organizationNumber: '5560360793', legalName: 'X AB' })
    expect(values.name).toBe('X AB')
    expect(values.phone).toBeUndefined()
    expect(filledKeys).not.toContain('phone')
  })

  it('hanterar tom/odefinierad modell', () => {
    expect(companyToKundForm(null).filledKeys).toEqual([])
    expect(companyToKundForm(null).values.kundtyp).toBe('foretag')
  })
})

describe('primarySni', () => {
  it('objektform: kod + beskrivning', () => {
    expect(primarySni([{ code: '62010', description: 'Datakonsultverksamhet' }])).toBe('62010 Datakonsultverksamhet')
  })
  it('alternativa nyckelnamn (sniCode/sniText)', () => {
    expect(primarySni([{ sniCode: '46900', sniText: 'Partihandel' }])).toBe('46900 Partihandel')
  })
  it('strängform behålls', () => {
    expect(primarySni(['62010 Datakonsultverksamhet'])).toBe('62010 Datakonsultverksamhet')
  })
  it('tomt/saknat -> tom sträng', () => {
    expect(primarySni([])).toBe('')
    expect(primarySni(null)).toBe('')
    expect(primarySni([{}])).toBe('')
  })
})

describe('diffFormValues', () => {
  it('flaggar endast fält där manuellt värde skiljer sig (tomma fylls utan konflikt)', () => {
    const current = { name: 'Gammalt namn AB', phone: '', email: 'info@nordic.se' }
    const next = companyToKundForm(COMPANY).values
    const diff = diffFormValues(current, next)
    const keys = diff.map(d => d.key)
    expect(keys).toContain('name')          // manuellt namn skiljer sig -> konflikt
    expect(keys).not.toContain('phone')     // tomt -> fylls, ingen konflikt
    expect(keys).not.toContain('email')     // identiskt -> ingen konflikt
    const namnDiff = diff.find(d => d.key === 'name')
    expect(namnDiff).toMatchObject({ from: 'Gammalt namn AB', to: 'Nordic Example AB' })
  })

  it('inga konflikter mot tomt formulär', () => {
    expect(diffFormValues({}, companyToKundForm(COMPANY).values)).toEqual([])
  })
})
