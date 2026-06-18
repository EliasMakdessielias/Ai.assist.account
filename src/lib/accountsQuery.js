// Data-access för kontoplan: server-side paginering + filtrering + EXAKT count.
// Löser PostgREST:s 1000-radersgräns – count räknar alla matchande rader,
// medan range() bara hämtar aktuell sida.

export function computeTotalPages(totalCount, pageSize) {
  return Math.max(1, Math.ceil((totalCount || 0) / Math.max(1, pageSize)))
}

// Bygger en filtrerad, sorterad och paginerad Supabase-query med exakt count.
// params: { companyId, search, status, accountClass, page, pageSize, sort:{key,dir} }
export function buildAccountsQuery(supabase, params) {
  const { companyId, search, status, accountClass, page = 1, pageSize = 100, sort } = params
  let q = supabase.from('accounts').select('*', { count: 'exact' }).eq('company_id', companyId)

  if (status === 'aktiva') q = q.eq('is_active', true)
  else if (status === 'inaktiva') q = q.eq('is_active', false)

  if (accountClass && accountClass !== 'alla') q = q.eq('account_class', Number(accountClass))

  const s = (search || '').trim().replace(/[%,]/g, ' ')
  if (s) q = q.or(`account_nr.ilike.%${s}%,name.ilike.%${s}%`)

  const col = sort?.key === 'name' ? 'name' : sort?.key === 'account_class' ? 'account_class' : 'account_nr'
  q = q.order(col, { ascending: (sort?.dir ?? 'asc') === 'asc' })
  if (col !== 'account_nr') q = q.order('account_nr', { ascending: true })

  const from = (page - 1) * pageSize
  q = q.range(from, from + pageSize - 1)
  return q
}

// Kör queryn och returnerar { items, totalCount, page, pageSize, totalPages }.
export async function fetchAccountsPage(supabase, params) {
  const page = params.page || 1
  const pageSize = params.pageSize || 100
  const { data, count, error } = await buildAccountsQuery(supabase, { ...params, page, pageSize })
  if (error) throw error
  const totalCount = count ?? 0
  return { items: data || [], totalCount, page, pageSize, totalPages: computeTotalPages(totalCount, pageSize) }
}

// Hämtar ALLA konton (batchat förbi PostgREST:s 1000-radersgräns). Bokföringsformulär
// MÅSTE använda detta – annars saknas höga konton (7xxx/8xxx) i listan och validering/
// autocomplete tror felaktigt att t.ex. 7690 inte finns när företaget har >1000 konton.
export async function fetchAllAccounts(supabase, companyId, { columns = 'account_nr, name, is_active', batch = 1000 } = {}) {
  const all = []
  for (let from = 0; ; from += batch) {
    const { data, error } = await supabase
      .from('accounts').select(columns).eq('company_id', companyId)
      .order('account_nr').range(from, from + batch - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < batch) break
  }
  return all
}

// Hämtar ALLA kontonummer (batchat förbi 1000-gränsen). Används för
// dubblettkontroll vid skapande och korrekt förhandsgranskning vid import.
export async function fetchAllAccountNumbers(supabase, companyId, batch = 1000) {
  const all = []
  for (let from = 0; ; from += batch) {
    const { data, error } = await supabase
      .from('accounts').select('account_nr').eq('company_id', companyId)
      .order('account_nr').range(from, from + batch - 1)
    if (error) throw error
    all.push(...(data || []).map(r => r.account_nr))
    if (!data || data.length < batch) break
  }
  return all
}

// Som ovan men inkluderar låsstatus – för lås-medveten importförhandsgranskning.
export async function fetchAllAccountKeys(supabase, companyId, batch = 1000) {
  const all = []
  for (let from = 0; ; from += batch) {
    const { data, error } = await supabase
      .from('accounts').select('account_nr, is_locked').eq('company_id', companyId)
      .order('account_nr').range(from, from + batch - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < batch) break
  }
  return all
}
