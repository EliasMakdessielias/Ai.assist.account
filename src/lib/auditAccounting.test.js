import { describe, it, expect } from 'vitest'
import { ACCOUNTING_AUDIT_ACTIONS, AUDIT_SOURCES, redactInterpretation, isAuditMetadataSafe } from './auditAccounting'

describe('audit-konstanter', () => {
  it('har de bokföringsactions som SQL-triggrarna använder', () => {
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationCreated).toBe('verification_created')
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationVoided).toBe('verification_voided')
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationCorrectionStarted).toBe('verification_correction_started')
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationReversalCreated).toBe('verification_reversal_created')
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationReplacementCreated).toBe('verification_replacement_created')
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationCorrected).toBe('verification_corrected')
    expect(ACCOUNTING_AUDIT_ACTIONS.verificationDeletedLegacy).toBe('verification_deleted_current_legacy_flow')
    expect(ACCOUNTING_AUDIT_ACTIONS.supplierInvoiceBooked).toBe('supplier_invoice_booked')
    expect(ACCOUNTING_AUDIT_ACTIONS.customerInvoiceBooked).toBe('customer_invoice_booked')
    expect(ACCOUNTING_AUDIT_ACTIONS.documentInterpreted).toBe('document_interpreted')
  })
  it('source-typer enligt protokollet', () => {
    expect(AUDIT_SOURCES).toEqual(['ui', 'edge_function', 'worker', 'import', 'ocr', 'system'])
  })
})

describe('redactInterpretation', () => {
  const full = {
    leverantor: 'Acme AB', org_nr: '556677-8899', fakturanummer: '3419', fakturadatum: '2026-01-29',
    belopp_inkl_moms: 1250, moms_belopp: 250, momssats: 25, valuta: 'SEK', invoice_type: 'debit', is_credit_invoice: false,
    // Får ALDRIG loggas:
    beskrivning: 'lång känslig råtext från underlaget', konteringsrader: [{ konto: '4000' }], ocr: '123456',
    raw_text: 'hela råtexten', email_body: 'mailinnehåll', api_key: 'sk_live_x',
  }

  it('behåller endast vitlistade fält', () => {
    const m = redactInterpretation(full)
    expect(m).toMatchObject({ leverantor: 'Acme AB', org_nr: '556677-8899', fakturanummer: '3419', belopp_inkl_moms: 1250, invoice_type: 'debit', is_credit_invoice: false })
  })

  it('loggar ALDRIG råtext, konteringsrader, mailbody eller secrets', () => {
    const m = redactInterpretation(full)
    expect(m.beskrivning).toBeUndefined()
    expect(m.konteringsrader).toBeUndefined()
    expect(m.ocr).toBeUndefined()
    expect(m.raw_text).toBeUndefined()
    expect(m.email_body).toBeUndefined()
    expect(m.api_key).toBeUndefined()
    expect(JSON.stringify(m)).not.toContain('känslig')
    expect(JSON.stringify(m)).not.toContain('sk_live')
  })

  it('utelämnar tomma värden och trunkerar långa strängar', () => {
    const m = redactInterpretation({ leverantor: 'x'.repeat(500), org_nr: '', fakturanummer: null })
    expect(m.leverantor.length).toBeLessThanOrEqual(120)
    expect(m.org_nr).toBeUndefined()
    expect(m.fakturanummer).toBeUndefined()
  })

  it('hanterar tomt/odefinierat resultat', () => {
    expect(redactInterpretation(null)).toEqual({})
    expect(redactInterpretation(undefined)).toEqual({})
  })
})

describe('isAuditMetadataSafe', () => {
  it('godkänner redigerad metadata', () => {
    expect(isAuditMetadataSafe(redactInterpretation({ leverantor: 'Acme', belopp_inkl_moms: 100 }))).toBe(true)
  })
  it('flaggar förbjudna nycklar (secrets/råtext)', () => {
    expect(isAuditMetadataSafe({ api_key: 'x' })).toBe(false)
    expect(isAuditMetadataSafe({ raw_text: 'x' })).toBe(false)
    expect(isAuditMetadataSafe({ email_body: 'x' })).toBe(false)
    expect(isAuditMetadataSafe({ password: 'x' })).toBe(false)
    expect(isAuditMetadataSafe({ card_number: 'x' })).toBe(false)
  })
})
