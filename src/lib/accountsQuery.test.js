import { describe, it, expect } from 'vitest'
import { computeTotalPages, buildAccountsQuery, fetchAccountsPage, fetchAllAccountNumbers } from './accountsQuery'

// Mock av Supabase-querybyggaren: kedjebar och "thenable" (await ger result).
function makeBuilder(result) {
  const calls = { select: [], eq: [], or: [], order: [], range: [] }
  const b = {
    select(sel, opts) { calls.select.push([sel, opts]); return b },
    eq(col, val) { calls.eq.push([col, val]); return b },
    or(expr) { calls.or.push(expr); return b },
    order(col, opts) { calls.order.push([col, opts]); return b },
    range(a, c) { calls.range.push([a, c]); return b },
    then(res, rej) { return Promise.resolve(result).then(res, rej) },
    _calls: calls,
  }
  return b
}
function makeSupabase(result) {
  const builder = makeBuilder(result)
  return { _builder: builder, from() { return builder } }
}

describe('computeTotalPages', () => {
  it('räknar sidor med Math.ceil(totalCount / pageSize)', () => {
    expect(computeTotalPages(1248, 100)).toBe(13)
    expect(computeTotalPages(1000, 100)).toBe(10)
    expect(computeTotalPages(1001, 100)).toBe(11)
    expect(computeTotalPages(37, 100)).toBe(1)
  })
  it('ger minst 1 sida vid tomt resultat', () => {
    expect(computeTotalPages(0, 100)).toBe(1)
  })
})

describe('buildAccountsQuery', () => {
  it('filtrerar på företag, status och kontoklass samt paginerar', () => {
    const sb = makeSupabase({ data: [], count: 0 })
    buildAccountsQuery(sb, { companyId: 'c1', status: 'aktiva', accountClass: '3', page: 2, pageSize: 100 })
    const c = sb._builder._calls
    expect(c.select[0]).toEqual(['*', { count: 'exact' }])
    expect(c.eq).toContainEqual(['company_id', 'c1'])
    expect(c.eq).toContainEqual(['is_active', true])
    expect(c.eq).toContainEqual(['account_class', 3])
    expect(c.range[0]).toEqual([100, 199]) // sida 2, 100/sida
  })
  it('lägger till sökfilter via or() (ilike på nr och namn)', () => {
    const sb = makeSupabase({ data: [], count: 0 })
    buildAccountsQuery(sb, { companyId: 'c1', search: 'moms', page: 1, pageSize: 100 })
    expect(sb._builder._calls.or[0]).toBe('account_nr.ilike.%moms%,name.ilike.%moms%')
  })
  it('utan sökning anropas inte or()', () => {
    const sb = makeSupabase({ data: [], count: 0 })
    buildAccountsQuery(sb, { companyId: 'c1', page: 1, pageSize: 100 })
    expect(sb._builder._calls.or).toHaveLength(0)
  })
})

describe('fetchAccountsPage', () => {
  it('returnerar verkligt totalCount även när sidan bara har 100 rader (>1000 konton)', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ account_nr: String(1000 + i) }))
    const sb = makeSupabase({ data: items, count: 1248, error: null })
    const res = await fetchAccountsPage(sb, { companyId: 'c1', page: 1, pageSize: 100 })
    expect(res.items).toHaveLength(100)
    expect(res.totalCount).toBe(1248)   // INTE pageSize
    expect(res.totalPages).toBe(13)
    expect(res.page).toBe(1)
  })
  it('filtrerat resultat ger filtrerat totalCount', async () => {
    const sb = makeSupabase({ data: Array.from({ length: 37 }, () => ({})), count: 37, error: null })
    const res = await fetchAccountsPage(sb, { companyId: 'c1', search: 'moms', page: 1, pageSize: 100 })
    expect(res.totalCount).toBe(37)
    expect(res.totalPages).toBe(1)
  })
  it('tomt resultat ger totalCount 0 och 1 sida', async () => {
    const sb = makeSupabase({ data: [], count: 0, error: null })
    const res = await fetchAccountsPage(sb, { companyId: 'c1', search: 'xyz', page: 1, pageSize: 100 })
    expect(res.items).toEqual([])
    expect(res.totalCount).toBe(0)
    expect(res.totalPages).toBe(1)
  })
  it('kastar vid databasfel', async () => {
    const sb = makeSupabase({ data: null, count: null, error: { message: 'boom' } })
    await expect(fetchAccountsPage(sb, { companyId: 'c1' })).rejects.toBeTruthy()
  })
})

describe('fetchAllAccountNumbers', () => {
  it('batchar förbi 1000-gränsen och slår ihop alla kontonummer', async () => {
    // Simulera 1248 konton i två batchar (1000 + 248)
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ account_nr: String(i) }))
    const page2 = Array.from({ length: 248 }, (_, i) => ({ account_nr: String(1000 + i) }))
    let call = 0
    const sb = {
      from() {
        const b = {
          select() { return b }, eq() { return b }, order() { return b },
          range() { return b },
          then(res) { const data = call++ === 0 ? page1 : page2; return Promise.resolve({ data, error: null }).then(res) },
        }
        return b
      },
    }
    const all = await fetchAllAccountNumbers(sb, 'c1')
    expect(all).toHaveLength(1248)
    expect(call).toBe(2) // två batchar
  })
})
