import { describe, it, expect } from 'vitest'
import {
  validateRoboBpResponse, assembleContextDescriptor, contextLabel,
  checkDebetKredit, checkMomsRimlighet, checkFakturaTotal,
  FEATURE_KEY, RISK_LEVELS,
} from './roboBp'

const full = {
  answer: 'Marknadsföring uppgår till 12 500 kr detta kvartal.',
  confidence: 0.8, risk_level: 'low', basis: ['company_data'],
  sources: [{ title: 'BAS-kontoplanen', type: 'bas', url: 'https://www.bas.se' }],
  findings: [{
    title: 'Ovanligt momskonto', description: 'Konto 2611 används på ett ovanligt sätt.',
    risk_level: 'high', recommended_action: 'Granska verifikationen.',
    affected_objects: [{ type: 'account', id: '2611' }, { type: 'verification', id: 'V123' }],
    requires_human_review: false,
  }],
  proposed_actions: [{ type: 'open_object', label: 'Öppna verifikation', payload: { type: 'verification', id: 'V123' } }],
  limitations: ['AI-bedömning – granskning krävs.'],
}

describe('roboBp – AI-kontrakt & hallucinationsspärr', () => {
  it('FEATURE_KEY är robo_bp', () => { expect(FEATURE_KEY).toBe('robo_bp') })

  it('giltigt svar valideras ok och requires_human_review tvingas true', () => {
    const { ok, value } = validateRoboBpResponse(full, { accounts: ['2611', '6510'], objects: { verification: ['V123'] } })
    expect(ok).toBe(true)
    expect(value.findings[0].requires_human_review).toBe(true)         // tvingad oavsett AI-svar
    expect(value.findings[0].affected_objects).toHaveLength(2)
    expect(value.proposed_actions).toHaveLength(1)
  })

  it('blockerar hallucinerat konto i affected_objects', () => {
    const { ok, errors, value } = validateRoboBpResponse(full, { accounts: ['6510'], objects: { verification: ['V123'] } })
    expect(ok).toBe(false)
    expect(errors).toContain('hallucinated_object:account:2611')
    expect(value.findings[0].affected_objects.find(o => o.type === 'account')).toBeFalsy()  // saneras bort
  })

  it('blockerar hallucinerat verifikations-id i affected_objects och i open_object', () => {
    const { ok, errors, value } = validateRoboBpResponse(full, { accounts: ['2611'], objects: { verification: [] } })
    expect(ok).toBe(false)
    expect(errors).toContain('hallucinated_object:verification:V123')
    expect(errors).toContain('hallucinated_open:verification:V123')
    expect(value.proposed_actions).toHaveLength(0)                      // open_object mot okänt id slängs
  })

  it('blockerar konteringsförslag mot påhittat konto (suggest_accounting)', () => {
    const raw = { ...full, proposed_actions: [{ type: 'suggest_accounting', label: 'Föreslå kontering', payload: { account: '9999' } }] }
    const { ok, errors, value } = validateRoboBpResponse(raw, { accounts: ['2611', '6510'], objects: { verification: ['V123'] } })
    expect(ok).toBe(false)
    expect(errors).toContain('hallucinated_account:9999')
    expect(value.proposed_actions).toHaveLength(0)
  })

  it('avvisar svar utan giltigt schema (saknar answer/risk_level/basis)', () => {
    const { ok, errors, value } = validateRoboBpResponse({ foo: 'bar' }, {})
    expect(ok).toBe(false)
    expect(errors).toEqual(expect.arrayContaining(['answer_missing', 'risk_level_invalid', 'basis_missing']))
    expect(value.answer).toBeTruthy()                                   // alltid en säker form tillbaka
    expect(RISK_LEVELS).toContain(value.risk_level)
  })

  it('avvisar ogiltig JSON-sträng utan att krascha', () => {
    const { ok, errors } = validateRoboBpResponse('{ inte json', {})
    expect(ok).toBe(false)
    expect(errors).toContain('parse_failed')
  })

  it('filtrerar bort ogiltiga risknivåer/källtyper/åtgärdstyper', () => {
    const raw = { answer: 'x', risk_level: 'low', basis: ['company_data', 'fejk'], sources: [{ title: 'A', type: 'fejk' }], proposed_actions: [{ type: 'delete_everything', label: 'Radera' }] }
    const { value } = validateRoboBpResponse(raw, {})
    expect(value.basis).toEqual(['company_data'])
    expect(value.sources).toHaveLength(0)
    expect(value.proposed_actions).toHaveLength(0)                      // okänd/farlig åtgärdstyp släpps inte igenom
  })
})

describe('roboBp – kontext-deskriptor', () => {
  it('bygger minimal deskriptor utan rådata', () => {
    const d = assembleContextDescriptor({ view: 'leverantorsfakturor', companyId: 'c1', fiscalYearId: 'fy1', selection: { type: 'invoice', id: 42 } })
    expect(d).toEqual({ view: 'leverantorsfakturor', companyId: 'c1', fiscalYearId: 'fy1', selection: { type: 'invoice', id: '42' } })
  })
  it('faller tillbaka till oversikt vid okänd vy och nollar ogiltig selection', () => {
    const d = assembleContextDescriptor({ view: 'hemlig', selection: { type: 'rocket', id: 1 } })
    expect(d.view).toBe('oversikt'); expect(d.selection).toBeNull()
  })
  it('contextLabel speglar vy/selection', () => {
    expect(contextLabel({ view: 'manadskontroll', selection: null })).toBe('Analyserar månadskontrollen')
    expect(contextLabel({ view: 'bokforing', selection: { type: 'verification', id: 'V1' } })).toBe('Analyserar verifikation')
  })
})

describe('roboBp – deterministiska kontroller (före AI)', () => {
  it('debet=kredit', () => {
    expect(checkDebetKredit([{ debet: 100 }, { kredit: 100 }]).balanced).toBe(true)
    expect(checkDebetKredit([{ debet: 100 }, { kredit: 90 }]).differens).toBe(10)
  })
  it('momsrimlighet 25%', () => {
    expect(checkMomsRimlighet({ netto: 1000, moms: 250, sats: 0.25 }).rimlig).toBe(true)
    expect(checkMomsRimlighet({ netto: 1000, moms: 120, sats: 0.25 }).rimlig).toBe(false)
  })
  it('fakturatotal = netto + moms', () => {
    expect(checkFakturaTotal({ netto: 1000, moms: 250, total: 1250 }).stammer).toBe(true)
    expect(checkFakturaTotal({ netto: 1000, moms: 250, total: 1000 }).stammer).toBe(false)
  })
})
