// Hjälplogik för admin-funktionen "Töm testdata". Ren och testbar.

export const PURGE_CONFIRM_PHRASE = 'RADERA TESTDATA'

export function isPurgeConfirmed(input) {
  return String(input ?? '').trim() === PURGE_CONFIRM_PHRASE
}

// Etiketter + ordning för sammanfattningen (matchar nycklarna från purge_test_data).
const LABELS = [
  ['invoices', 'Kundfakturor'],
  ['supplier_invoices', 'Leverantörsfakturor'],
  ['verifikationer', 'Verifikationer'],
  ['bank_transactions', 'Banktransaktioner'],
  ['documents', 'Filer & underlag (OCR)'],
  ['import_batches', 'Importhistorik'],
  ['products', 'Produkter'],
  ['customers', 'Kunder'],
  ['suppliers', 'Leverantörer'],
  ['accounts', 'Konton (olåsta)'],
]

export function summarizePurge(result) {
  const d = result?.deleted || {}
  const deleted = LABELS.map(([key, label]) => ({ key, label, count: Number(d[key] || 0) }))
  return {
    deleted,
    totalDeleted: deleted.reduce((s, r) => s + r.count, 0),
    preservedLockedAccounts: Number(result?.preserved_locked_accounts || 0),
  }
}
