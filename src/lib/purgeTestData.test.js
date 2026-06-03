import { describe, it, expect } from 'vitest'
import { PURGE_CONFIRM_PHRASE, isPurgeConfirmed, summarizePurge } from './purgeTestData'

describe('isPurgeConfirmed', () => {
  it('kräver exakt "RADERA TESTDATA"', () => {
    expect(PURGE_CONFIRM_PHRASE).toBe('RADERA TESTDATA')
    expect(isPurgeConfirmed('RADERA TESTDATA')).toBe(true)
    expect(isPurgeConfirmed('  RADERA TESTDATA  ')).toBe(true) // trimmas
  })
  it('avvisar fel text och fel skiftläge', () => {
    expect(isPurgeConfirmed('radera testdata')).toBe(false)
    expect(isPurgeConfirmed('RADERA')).toBe(false)
    expect(isPurgeConfirmed('')).toBe(false)
    expect(isPurgeConfirmed(null)).toBe(false)
  })
})

describe('summarizePurge', () => {
  it('mappar räknare och bevarar kontoplanen (ej i raderingslistan)', () => {
    const result = {
      ok: true,
      deleted: { invoices: 3, supplier_invoices: 2, verifikationer: 10, bank_transactions: 5, documents: 4, import_batches: 1, products: 0, customers: 2, suppliers: 1 },
      chart_of_accounts_preserved: true,
      preserved_accounts: 1367,
    }
    const s = summarizePurge(result)
    expect(s.deleted.find(r => r.key === 'invoices').count).toBe(3)
    // Kontoplanen ska ALDRIG finnas i raderingslistan
    expect(s.deleted.find(r => r.key === 'accounts')).toBeUndefined()
    expect(s.totalDeleted).toBe(3 + 2 + 10 + 5 + 4 + 1 + 0 + 2 + 1)
    expect(s.preservedAccounts).toBe(1367)
    expect(s.chartOfAccountsPreserved).toBe(true)
  })
  it('hanterar tomt/saknat resultat', () => {
    const s = summarizePurge({})
    expect(s.totalDeleted).toBe(0)
    expect(s.preservedAccounts).toBe(0)
    expect(s.deleted).toHaveLength(9)
    expect(s.chartOfAccountsPreserved).toBe(true)
  })
})
