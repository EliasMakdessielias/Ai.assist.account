import { describe, it, expect } from 'vitest'
import { missingKonteringAccounts, reactivatableAccounts } from './leverantorsfaktura'

describe('missingKonteringAccounts', () => {
  const plan = ['2440', '2640', '4000', '3740']

  it('returnerar tomt när alla konton finns', () => {
    const rows = [{ nr: '2440' }, { nr: '2640' }, { nr: '4000' }]
    expect(missingKonteringAccounts(rows, plan)).toEqual([])
  })

  it('flaggar konton som saknas i kontoplanen', () => {
    const rows = [{ nr: '2440' }, { nr: '5999' }, { nr: '4000' }]
    expect(missingKonteringAccounts(rows, plan)).toEqual(['5999'])
  })

  it('avduplicerar och behåller inmatningsordning', () => {
    const rows = [{ nr: '5999' }, { nr: '4000' }, { nr: '5999' }, { nr: '6111' }]
    expect(missingKonteringAccounts(rows, plan)).toEqual(['5999', '6111'])
  })

  it('ignorerar tomma kontonummer', () => {
    const rows = [{ nr: '' }, { nr: '2440' }, {}]
    expect(missingKonteringAccounts(rows, plan)).toEqual([])
  })

  it('accepterar Set och kontoobjekt som kontoplan', () => {
    expect(missingKonteringAccounts([{ nr: '4000' }], new Set(['4000']))).toEqual([])
    const objs = [{ account_nr: '4000' }, { account_nr: '2440' }]
    expect(missingKonteringAccounts([{ nr: '4000' }, { nr: '9000' }], objs)).toEqual(['9000'])
  })
})

describe('reactivatableAccounts', () => {
  const accounts = [
    { account_nr: '2440', is_active: false, is_locked: true },  // låst – ska EJ röras
    { account_nr: '2640', is_active: false, is_locked: true },  // låst – ska EJ röras
    { account_nr: '4000', is_active: true, is_locked: false },  // redan aktivt
    { account_nr: '6110', is_active: false, is_locked: false }, // inaktivt, ej låst → återaktivera
  ]

  it('återaktiverar endast inaktiva, icke-låsta konton som används', () => {
    const rows = [{ nr: '2440' }, { nr: '2640' }, { nr: '4000' }, { nr: '6110' }]
    expect(reactivatableAccounts(rows, accounts)).toEqual(['6110'])
  })

  it('rör aldrig låsta konton även om de är inaktiva och används', () => {
    const rows = [{ nr: '2440' }, { nr: '2640' }]
    expect(reactivatableAccounts(rows, accounts)).toEqual([])
  })

  it('tar bara med konton som faktiskt används i konteringen', () => {
    const rows = [{ nr: '4000' }]
    expect(reactivatableAccounts(rows, accounts)).toEqual([])
  })

  it('hanterar tomma indata', () => {
    expect(reactivatableAccounts([], accounts)).toEqual([])
    expect(reactivatableAccounts(null, null)).toEqual([])
  })
})
