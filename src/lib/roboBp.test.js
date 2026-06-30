import { describe, it, expect } from 'vitest'
import {
  validateRoboBpResponse, assembleContextDescriptor, contextLabel,
  checkDebetKredit, checkMomsRimlighet, checkFakturaTotal,
  FEATURE_KEY, RISK_LEVELS, STEP2A_ACTIONS,
  computeObservations, observationCounts, OBSERVATION_STATUS_THRESHOLD,
  canFollowUp, buildCheckPayload,
  CHECK_STATUSES, CHECK_STATUS_META, checkActions, sortChecks,
  summarizeBasis, BASIS_LABEL, SAFETY_PHRASES,
  computeConfidence, CONFIDENCE_META, DECISION_LEVEL_META,
  detectForbiddenIntent, FORBIDDEN_INTENT_CATEGORIES, BLOCKED_INTENT_MESSAGE,
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

describe('roboBp – Steg 2A: suggest_accounting blockeras + hallucinationsspärr', () => {
  it('STEP2A_ACTIONS saknar suggest_accounting men har de säkra', () => {
    expect(STEP2A_ACTIONS).not.toContain('suggest_accounting')
    expect(STEP2A_ACTIONS).toEqual(expect.arrayContaining(['open_object', 'explain_rule', 'create_check']))
  })

  it('blockerar suggest_accounting när allowedActions = STEP2A_ACTIONS (även om AI returnerar det)', () => {
    const raw = {
      answer: 'x', risk_level: 'low', basis: ['company_data'], proposed_actions: [
        { type: 'open_object', label: 'Öppna', payload: { type: 'verification', id: 'V1' } },
        { type: 'suggest_accounting', label: 'Föreslå kontering', payload: { account: '6212' } },
        { type: 'explain_rule', label: 'Förklara' },
      ],
    }
    const { ok, errors, value } = validateRoboBpResponse(raw, { accounts: ['6212'], objects: { verification: ['V1'] } }, { allowedActions: STEP2A_ACTIONS })
    expect(errors).toContain('blocked_action:suggest_accounting')
    expect(value.proposed_actions.find(a => a.type === 'suggest_accounting')).toBeFalsy()
    expect(value.proposed_actions.map(a => a.type).sort()).toEqual(['explain_rule', 'open_object'])
    expect(ok).toBe(true)   // sanering, inte valideringsfel
  })

  it('tar bort hallucinerade konton/objekt mot serverhämtad kontext i 2A-läge', () => {
    const raw = {
      answer: 'x', risk_level: 'medium', basis: ['company_data'], findings: [{
        title: 'F', description: 'D', risk_level: 'high', recommended_action: 'A',
        affected_objects: [{ type: 'account', id: '9999' }, { type: 'verification', id: 'V1' }, { type: 'invoice', id: 'BADID' }],
      }],
    }
    const { value, errors } = validateRoboBpResponse(raw, { accounts: ['6212'], objects: { verification: ['V1'], invoice: ['INV1'] } }, { allowedActions: STEP2A_ACTIONS })
    expect(errors).toContain('hallucinated_object:account:9999')
    expect(errors).toContain('hallucinated_object:invoice:BADID')
    expect(value.findings[0].affected_objects).toEqual([{ type: 'verification', id: 'V1' }])
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

describe('roboBp – Steg 2B: deterministiska observationer', () => {
  it('skapas deterministiskt ur summary (counts → observationer)', () => {
    const summary = { hasFiscalYear: true, missingVerDesc: 2, unbalancedVer: 1, supplierNoName: 3, supOverdue: 4, custOverdue: 0, itemsWithoutStatus: 7 }
    const obs = computeObservations(summary)
    const codes = obs.map(o => o.code)
    expect(codes).toEqual(['missing_ver_desc', 'unbalanced_ver', 'supplier_no_name', 'supplier_overdue', 'many_without_status'])
    expect(obs.find(o => o.code === 'unbalanced_ver').severity).toBe('high')
    expect(obs.find(o => o.code === 'missing_ver_desc').count).toBe(2)
    // determinism: samma input → samma output
    expect(computeObservations(summary)).toEqual(obs)
  })

  it('flaggar saknat räkenskapsår och tröskel för poster utan status', () => {
    expect(computeObservations({ hasFiscalYear: false }).map(o => o.code)).toContain('no_fiscal_year')
    expect(computeObservations({ itemsWithoutStatus: OBSERVATION_STATUS_THRESHOLD - 1 }).map(o => o.code)).not.toContain('many_without_status')
    expect(computeObservations({ itemsWithoutStatus: OBSERVATION_STATUS_THRESHOLD }).map(o => o.code)).toContain('many_without_status')
  })

  it('innehåller INGA råa personuppgifter – endast code/severity/text/count', () => {
    const obs = computeObservations({ missingVerDesc: 1, supplierNoName: 2, supOverdue: 1, custOverdue: 1 })
    for (const o of obs) {
      expect(Object.keys(o).sort()).toEqual(['code', 'count', 'severity', 'text'])
      expect(typeof o.count).toBe('number')
      // texten är generisk (siffror + svenska ord), aldrig namn/e-post/orgnr
      expect(o.text).not.toMatch(/@|\b\d{6}-\d{4}\b/)
    }
  })

  it('observationCounts ger total + koder (för audit), ingen rådata', () => {
    const obs = computeObservations({ unbalancedVer: 1, supOverdue: 2 })
    expect(observationCounts(obs)).toEqual({ total: 2, codes: ['unbalanced_ver', 'supplier_overdue'] })
    expect(observationCounts([])).toEqual({ total: 0, codes: [] })
  })

  it('tom summary → inga observationer', () => {
    expect(computeObservations({})).toEqual([])
    expect(computeObservations({ hasFiscalYear: true })).toEqual([])
  })
})

describe('roboBp – Steg 2C: kontrollpunkt (create_check) payload', () => {
  const ctx = { companyId: 'c1', view: 'bokforing', fiscalYearId: 'fy1', conversationId: 'conv1' }

  it('canFollowUp: true för finding (title) och observation (text), false annars', () => {
    expect(canFollowUp({ title: 'Ovanligt saldo' })).toBe(true)
    expect(canFollowUp({ text: '2 verifikationer saknar beskrivning.' })).toBe(true)
    expect(canFollowUp({ title: '  ' })).toBe(false)
    expect(canFollowUp({})).toBe(false)
    expect(canFollowUp(null)).toBe(false)
  })

  it('buildCheckPayload mappar finding → RPC-parametrar', () => {
    const finding = { title: 'Fel momskonto', description: 'Konto 2611 ovanligt', risk_level: 'high', affected_objects: [{ type: 'account', id: '2611' }] }
    expect(buildCheckPayload(finding, ctx)).toEqual({
      p_company: 'c1', p_view: 'bokforing', p_fiscal_year_id: 'fy1',
      p_title: 'Fel momskonto', p_description: 'Konto 2611 ovanligt', p_risk_level: 'high',
      p_affected_objects: [{ type: 'account', id: '2611' }], p_conversation_id: 'conv1',
      p_decision_basis: 'ai_finding', p_confidence_label: null,
    })
  })

  it('buildCheckPayload mappar observation: text→titel, severity→risk, härkomst i beskrivning, tom affected_objects', () => {
    const obs = { code: 'unbalanced_ver', severity: 'high', text: '1 verifikation verkar obalanserad.', count: 1 }
    const p = buildCheckPayload(obs, ctx)
    expect(p.p_title).toBe('1 verifikation verkar obalanserad.')
    expect(p.p_risk_level).toBe('high')                              // severity → risk_level
    expect(p.p_affected_objects).toEqual([])                         // observation utan objekt → tom
    expect(p.p_description).toContain('ROBO-bp')                     // tydlig härkomst
    expect(p.p_description).toContain('unbalanced_ver')
  })

  it('no_fiscal_year-observation (severity medium, ingen affected_objects) kan följas upp', () => {
    const obs = { code: 'no_fiscal_year', severity: 'medium', text: 'Inget räkenskapsår valt.', count: 0 }
    expect(canFollowUp(obs)).toBe(true)
    const p = buildCheckPayload(obs, { ...ctx, view: 'oversikt' })
    expect(p.p_risk_level).toBe('medium')
    expect(p.p_view).toBe('oversikt')
    expect(p.p_affected_objects).toEqual([])
  })

  it('default risk medium vid ogiltig nivå; null för icke-uppföljbart', () => {
    expect(buildCheckPayload({ title: 'X', risk_level: 'fejk' }, ctx).p_risk_level).toBe('medium')
    expect(buildCheckPayload({}, ctx)).toBeNull()
  })
})

describe('roboBp – Steg 2J: safe-intent guard', () => {
  const blocked = (q) => detectForbiddenIntent(q).blocked
  it('blockerar förbjudna åtgärdsbegäran (sv)', () => {
    expect(detectForbiddenIntent('Bokför detta kvitto')).toMatchObject({ blocked: true, category: 'bokfor' })
    expect(detectForbiddenIntent('Skapa en verifikation åt mig')).toMatchObject({ blocked: true, category: 'skapa_verifikation' })
    expect(detectForbiddenIntent('Radera den här verifikationen')).toMatchObject({ blocked: true, category: 'radera_verifikation' })
    expect(detectForbiddenIntent('Godkänn fakturan')).toMatchObject({ blocked: true, category: 'godkann_faktura' })
    expect(detectForbiddenIntent('Lämna in momsrapporten')).toMatchObject({ blocked: true, category: 'lamna_in' })
    expect(detectForbiddenIntent('Betala fakturan')).toMatchObject({ blocked: true, category: 'betala' })
    expect(blocked('Lås upp perioden')).toBe(true)
    expect(blocked('Ändra den här fakturan')).toBe(true)
    expect(blocked('Skicka rapporten till Skatteverket')).toBe(true)
  })
  it('blockerar enklare engelska', () => {
    expect(blocked('post this invoice')).toBe(true)
    expect(blocked('please delete this')).toBe(true)
    expect(blocked('approve the invoice')).toBe(true)
    expect(blocked('submit the VAT report')).toBe(true)
    expect(blocked('pay the invoice')).toBe(true)
  })
  it('blockerar INTE säkra frågor', () => {
    expect(blocked('Vad bör jag kontrollera?')).toBe(false)
    expect(blocked('Vilka risker eller avvikelser ser du i bokföringen just nu?')).toBe(false)  // "bokföringen" ≠ "bokför"
    expect(blocked('Hur bokför jag ett kvitto?')).toBe(false)                                    // förklarande fråga tillåts
    expect(blocked('Förklara momsreglerna')).toBe(false)
    expect(blocked('')).toBe(false)
  })
  it('alla kategorier är kända + säkert meddelande finns', () => {
    expect(FORBIDDEN_INTENT_CATEGORIES).toContain('bokfor')
    expect(BLOCKED_INTENT_MESSAGE).toMatch(/kan inte utföra detta automatiskt/)
  })
})

describe('roboBp – Steg 2H: confidence/beslutsnivå', () => {
  const conf = (resp, meta) => computeConfidence(summarizeBasis(resp, meta), resp)
  it('ai_inference utan sources/observations → Svag + Kräver manuell granskning', () => {
    const c = conf({ basis: ['ai_inference'], sources: [] }, {})
    expect(c.label).toBe('weak')
    expect(c.labelText).toBe('Svag')
    expect(c.decisionLevel).toBe('manual_review')
    expect(c.requiresManualReview).toBe(true)
  })
  it('company_data + observations → starkare än enbart AI', () => {
    const c = conf({ basis: ['company_data', 'ai_inference'], sources: [] }, { observationCounts: { total: 2, codes: ['x', 'y'] } })
    expect(['strong', 'strong_plus']).toContain(c.label)
    expect(CONFIDENCE_META[c.label].order).toBeGreaterThan(CONFIDENCE_META.weak.order)
  })
  it('rule_source/sources + company_data → Mycket stark grund', () => {
    const c = conf({ basis: ['company_data', 'ai_inference'], sources: [{ title: 'BFN', type: 'bfn' }] }, {})
    expect(c.label).toBe('strong_plus')
    expect(c.decisionLevel).toBe('data_analysis')
  })
  it('AI:s confidence-score exponeras separat (0–1), inte som label', () => {
    expect(conf({ basis: ['company_data'], confidence: 0.7 }, {}).score).toBe(0.7)
    expect(conf({ basis: ['company_data'], confidence: 5 }, {}).score).toBe(null)     // utanför 0–1 → ignoreras
  })
  it('buildCheckPayload: observation → system_observation, finding → ai_finding, + confidence_label', () => {
    const obs = buildCheckPayload({ code: 'no_fiscal_year', severity: 'medium', text: 'Inget år.' }, { companyId: 'c', confidenceLabel: 'strong_plus' })
    expect(obs.p_decision_basis).toBe('system_observation')
    expect(obs.p_confidence_label).toBe('strong_plus')
    const find = buildCheckPayload({ title: 'Avvikelse', description: 'x', risk_level: 'high' }, { companyId: 'c' })
    expect(find.p_decision_basis).toBe('ai_finding')
    expect(find.p_confidence_label).toBe(null)
  })
})

describe('roboBp – Steg 2G: transparens (summarizeBasis)', () => {
  const meta = { view: 'oversikt', contextCounts: { accounts: 12, verifications: 3, supplierInvoices: 0 }, observationCounts: { total: 2, codes: ['no_fiscal_year', 'unbalanced_ver'] } }
  it('company_data → systemdata-etikett + räknar bara icke-noll-counts', () => {
    const s = summarizeBasis({ basis: ['company_data'], sources: [] }, meta)
    expect(s.hasCompanyData).toBe(true)
    expect(s.basisLabels).toContain(BASIS_LABEL.company_data)
    expect(s.contextCountEntries.map(e => e.key)).toEqual(['accounts', 'verifications'])   // 0-count exkluderas
    expect(s.contextCountEntries.find(e => e.key === 'accounts')).toMatchObject({ label: 'konton', count: 12 })
  })
  it('ai_inference utan sources → aiWithoutSource + kräver mänsklig granskning', () => {
    const s = summarizeBasis({ basis: ['ai_inference'], sources: [] }, {})
    expect(s.aiWithoutSource).toBe(true)
    expect(s.requiresHumanReview).toBe(true)
  })
  it('ai_inference MED sources → ingen "utan källa"-flagga', () => {
    const s = summarizeBasis({ basis: ['ai_inference'], sources: [{ title: 'BFN K2', type: 'bfn' }] }, {})
    expect(s.aiWithoutSource).toBe(false)
    expect(s.hasRuleSource).toBe(true)
  })
  it('observations → systemkontroll med koder/antal', () => {
    const s = summarizeBasis({ basis: ['company_data'] }, meta)
    expect(s.usedSystemCheck).toBe(true)
    expect(s.observationCounts.codes).toContain('no_fiscal_year')
    expect(s.observationCounts.total).toBe(2)
  })
  it('tre fasta varningsfraser finns', () => {
    expect(SAFETY_PHRASES).toHaveLength(3)
    expect(SAFETY_PHRASES[1]).toMatch(/ändrar inte bokföringsdata/)
  })
})

describe('roboBp – Steg 2E: statusflöde för kontrollpunkter', () => {
  it('CHECK_STATUSES = open/in_progress/done/dismissed', () => {
    expect(CHECK_STATUSES).toEqual(['open', 'in_progress', 'done', 'dismissed'])
    expect(CHECK_STATUS_META.in_progress.label).toBe('Påbörjad')
  })
  it('checkActions: open → påbörja/avfärda, in_progress → klar/avfärda, done/dismissed → inga', () => {
    expect(checkActions('open').map(a => a.to)).toEqual(['in_progress', 'dismissed'])
    expect(checkActions('in_progress').map(a => a.to)).toEqual(['done', 'dismissed'])
    expect(checkActions('done')).toEqual([])
    expect(checkActions('dismissed')).toEqual([])
  })
  it('sortChecks: öppna/påbörjade först, sedan klara/avfärdade; nyast först inom grupp', () => {
    const checks = [
      { id: 'a', status: 'done', created_at: '2026-01-01' },
      { id: 'b', status: 'open', created_at: '2026-01-01' },
      { id: 'c', status: 'open', created_at: '2026-02-01' },
      { id: 'd', status: 'in_progress', created_at: '2026-01-01' },
    ]
    expect(sortChecks(checks).map(c => c.id)).toEqual(['c', 'b', 'd', 'a'])
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
