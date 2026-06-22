import { describe, it, expect } from 'vitest'
import { priorityRank, isOpenStatus, sortItems, nextAction, monthOptions, monthLabel } from './monthlyControl'

describe('monthlyControl', () => {
  it('priorityRank ordnar kritisk först', () => {
    expect(priorityRank('critical')).toBeLessThan(priorityRank('high'))
    expect(priorityRank('high')).toBeLessThan(priorityRank('normal'))
    expect(priorityRank('normal')).toBeLessThan(priorityRank('low'))
    expect(priorityRank('okänt')).toBe(9)
  })

  it('isOpenStatus: öppna statusar men inte resolved/ignored', () => {
    expect(isOpenStatus('open')).toBe(true)
    expect(isOpenStatus('in_progress')).toBe(true)
    expect(isOpenStatus('resolved')).toBe(false)
    expect(isOpenStatus('ignored')).toBe(false)
  })

  it('sortItems prioriterar kritiskt och nextAction tar viktigaste öppna', () => {
    const items = [
      { id: 'a', priority: 'normal', module: 'bank', status: 'open', created_at: '2026-06-01' },
      { id: 'b', priority: 'critical', module: 'bokforing', status: 'open', created_at: '2026-06-02' },
      { id: 'c', priority: 'critical', module: 'bokforing', status: 'resolved', created_at: '2026-06-01' },
      { id: 'd', priority: 'high', module: 'inkorg', status: 'open', created_at: '2026-06-01' },
    ]
    const sorted = sortItems(items)
    expect(sorted[0].priority).toBe('critical') // kritiskt först oavsett status
    expect(nextAction(items).id).toBe('b') // viktigaste ÖPPNA (c är resolved och räknas ej)
  })

  it('monthOptions bygger månader ur räkenskapsår, nyast först', () => {
    const opts = monthOptions([{ start_date: '2026-01-01', end_date: '2026-03-31' }])
    expect(opts).toHaveLength(3)
    expect(opts[0]).toMatchObject({ year: 2026, month: 3 })
    expect(opts[2]).toMatchObject({ year: 2026, month: 1 })
    expect(monthLabel(2026, 6)).toBe('Juni 2026')
  })

  it('monthOptions faller tillbaka till innevarande år utan räkenskapsår', () => {
    const opts = monthOptions([], new Date('2026-06-15'))
    expect(opts).toHaveLength(12)
    expect(opts.every(o => o.year === 2026)).toBe(true)
  })
})
