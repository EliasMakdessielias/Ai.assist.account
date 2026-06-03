// Hjälplogik för admin-funktionen "Töm testdata". Ren och testbar.
// OBS: Kontoplanen (accounts) är grunddata och raderas ALDRIG av tömningen.

export const PURGE_CONFIRM_PHRASE = 'RADERA TESTDATA'

export function isPurgeConfirmed(input) {
  return String(input ?? '').trim() === PURGE_CONFIRM_PHRASE
}

// Etiketter + ordning för sammanfattningen (matchar nycklarna från purge_test_data).
// Kontoplan finns medvetet INTE med – den raderas aldrig.
const LABELS = [
  ['invoices', 'Kundfakturor'],
  ['supplier_invoices', 'Leverantörsfakturor'],
  ['verifikationer', 'Verifikationer'],
  ['bank_transactions', 'Banktransaktioner'],
  ['documents', 'Filer & underlag (OCR/AI)'],
  ['import_batches', 'Importhistorik'],
  ['products', 'Produkter'],
  ['customers', 'Kunder'],
  ['suppliers', 'Leverantörer'],
]

export function summarizePurge(result) {
  const d = result?.deleted || {}
  const deleted = LABELS.map(([key, label]) => ({ key, label, count: Number(d[key] || 0) }))
  return {
    deleted,
    totalDeleted: deleted.reduce((s, r) => s + r.count, 0),
    preservedAccounts: Number(result?.preserved_accounts || 0),
    chartOfAccountsPreserved: result?.chart_of_accounts_preserved !== false,
  }
}
