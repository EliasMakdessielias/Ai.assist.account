// Ren logik för bokföring av leverantörsfaktura – inga beroenden på React eller
// Supabase, så att den kan enhetstestas isolerat (se leverantorsfaktura.test.js).
//
// Bakgrund: konteringsraderna i en leverantörsfaktura bokförs som en verifikation.
// Två saker måste hålla innan vi bokför:
//  1. Alla konton i konteringen måste finnas i företagets kontoplan.
//  2. Använda konton som råkar vara inaktiva ska återaktiveras – MEN låsta
//     standardkonton (t.ex. 2440/2640) skyddas av DB-triggern protect_locked_account
//     och får aldrig uppdateras av flödet (annars kastas "KONTO_LAST").

const nrOf = r => String(r?.nr ?? '').trim()

// Konteringskonton som inte finns i kontoplanen (felstavat/oimporterat konto).
// rows: [{ nr }]; accountNrs: array eller Set av befintliga account_nr.
// Returnerar unika saknade kontonummer i inmatningsordning.
export function missingKonteringAccounts(rows, accountNrs) {
  const set = accountNrs instanceof Set ? accountNrs : new Set((accountNrs || []).map(a => String(typeof a === 'object' && a ? a.account_nr : a)))
  const out = []
  for (const r of rows || []) {
    const nr = nrOf(r)
    if (nr && !set.has(nr) && !out.includes(nr)) out.push(nr)
  }
  return out
}

// Konton som säkert kan återaktiveras: används i konteringen, är inaktiva (is_active===false)
// och är INTE låsta. Låsta konton lämnas orörda (skyddas av protect_locked_account).
// rows: [{ nr }]; accounts: [{ account_nr, is_active, is_locked }].
export function reactivatableAccounts(rows, accounts) {
  const used = new Set((rows || []).map(nrOf).filter(Boolean))
  const out = []
  for (const a of accounts || []) {
    const nr = String(a?.account_nr ?? '')
    if (used.has(nr) && a?.is_active === false && !a?.is_locked && !out.includes(nr)) out.push(nr)
  }
  return out
}
