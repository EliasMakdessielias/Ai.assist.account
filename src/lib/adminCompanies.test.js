import { describe, it, expect } from 'vitest'
import { filterCompanies, canMutateServiceState, riskMeta, serviceStateMeta } from './adminCompanies'

const list = [
  { company_id: 'a', name: 'Acme AB', org_nr: '556111', email: 'a@x.se', archive_number: '1001', service_state: 'active', sub_status: 'active' },
  { company_id: 'b', name: 'Bolaget', org_nr: '999222', email: 'b@y.se', archive_number: '1002', service_state: 'paused', sub_status: 'trial' },
  { company_id: 'c', name: 'Cirkus', org_nr: '111333', email: 'c@z.se', archive_number: '1003', service_state: 'active', sub_status: 'past_due' },
]

describe('filterCompanies – sök + statusfilter (krav 1/9)', () => {
  it('söker på namn/org.nr/e-post/arkivnummer', () => {
    expect(filterCompanies(list, { search: 'acme' }).map(c => c.company_id)).toEqual(['a'])
    expect(filterCompanies(list, { search: '999222' }).map(c => c.company_id)).toEqual(['b'])
    expect(filterCompanies(list, { search: '1003' }).map(c => c.company_id)).toEqual(['c'])  // arkivnummer
    expect(filterCompanies(list, { search: '@z.se' }).map(c => c.company_id)).toEqual(['c'])
  })
  it('filtrerar på service-state', () => {
    expect(filterCompanies(list, { state: 'paused' }).map(c => c.company_id)).toEqual(['b'])
    expect(filterCompanies(list, { state: 'active' }).map(c => c.company_id)).toEqual(['a', 'c'])
  })
  it('filtrerar på abonnemangsstatus', () => {
    expect(filterCompanies(list, { state: 'trial' }).map(c => c.company_id)).toEqual(['b'])
    expect(filterCompanies(list, { state: 'past_due' }).map(c => c.company_id)).toEqual(['c'])
  })
  it('utan filter returneras alla', () => {
    expect(filterCompanies(list, {}).length).toBe(3)
    expect(filterCompanies(list).length).toBe(3)
  })
})

describe('canMutateServiceState (krav 4) – endast superadmin/operations_admin', () => {
  it('tillåter superadmin och operations_admin', () => {
    expect(canMutateServiceState({ isSuperadmin: true })).toBe(true)
    expect(canMutateServiceState({ canManageOperations: true })).toBe(true)
  })
  it('nekar read_only_admin, billing/support och okänd', () => {
    expect(canMutateServiceState({ isReadOnly: true, canViewOperations: true, canManageOperations: false })).toBe(false)
    expect(canMutateServiceState({ canViewBilling: true })).toBe(false)
    expect(canMutateServiceState(null)).toBe(false)
  })
})

describe('riskMeta / serviceStateMeta', () => {
  it('risketiketter', () => {
    expect(riskMeta('healthy').label).toBe('OK')
    expect(riskMeta('at_risk').label).toBe('Risk')
    expect(riskMeta('blocked').label).toBe('Låst')
  })
  it('återexporterar serviceStateMeta', () => {
    expect(serviceStateMeta('paused').label).toBe('Pausad')
  })
})
