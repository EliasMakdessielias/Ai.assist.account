// Standard transaktions-/bankkonton som alltid ska finnas i programmet.
// 1930 Företagskonto är redigerbart (bankuppgifter). 1910 och 1630 är låsta.
// Ordning: 1930 först (förvalt konto under Kassa och bank).
export const STANDARD_BANK_ACCOUNTS = [
  { account_nr: '1930', namn: 'Företagskonto', typ: 'Företagskonto', locked: false },
  { account_nr: '1910', namn: 'Kassa', typ: 'Kassakonto', locked: true },
  { account_nr: '1630', namn: 'Skattekonto', typ: 'Skattekonto', locked: true },
]

export const STANDARD_ORDER = STANDARD_BANK_ACCOUNTS.map(s => s.account_nr) // ['1930','1910','1630']
export const DEFAULT_BANK_ACCOUNT = '1930'

// Sortera så att standardkontona kommer först i rätt ordning (1930, 1910, 1630),
// därefter övriga konton i nummerordning.
export function sortBankAccounts(list, key = a => a.account_nr) {
  const rank = nr => { const i = STANDARD_ORDER.indexOf(nr); return i === -1 ? 99 : i }
  return [...(list || [])].sort((a, b) => {
    const ra = rank(key(a)), rb = rank(key(b))
    if (ra !== rb) return ra - rb
    return String(key(a)).localeCompare(String(key(b)), 'sv', { numeric: true })
  })
}

// Säkerställ att standardkontona finns för företaget (idempotent). Körs vid
// laddning av båda sidorna så att kontona alltid är på plats från start.
export async function ensureStandardBankAccounts(supabase, companyId) {
  if (!companyId) return
  const { data } = await supabase.from('bank_accounts').select('account_nr').eq('company_id', companyId)
  const have = new Set((data || []).map(b => b.account_nr))
  const missing = STANDARD_BANK_ACCOUNTS.filter(s => !have.has(s.account_nr))
  if (!missing.length) return
  await supabase.from('bank_accounts').insert(missing.map(s => ({
    company_id: companyId, namn: s.namn, typ: s.typ, valuta: 'SEK',
    account_nr: s.account_nr, aktiv: true, is_standard: true, locked: s.locked,
  })))
}
