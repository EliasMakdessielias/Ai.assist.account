import { describe, it, expect } from 'vitest'
import {
  computeWorkerStatus, summarizeQueue, filterSystemErrors,
  canViewSystemDashboard, canRunAdminAction, formatAge, WORKER_COMPONENTS,
} from './systemStatus'

const NOW = new Date('2026-06-08T12:00:00Z')
const ago = h => new Date(NOW.getTime() - h * 3600 * 1000).toISOString()

describe('worker-komponenter', () => {
  it('täcker alla kärn-workers (krav 1)', () => {
    expect(WORKER_COMPONENTS.map(c => c.key)).toEqual([
      'imap-import', 'inbound-email', 'tolka-underlag', 'email-worker', 'scheduled-notifications',
    ])
  })
})

describe('computeWorkerStatus (krav 3)', () => {
  it('unknown när ingen health-record finns', () => {
    expect(computeWorkerStatus({ has_record: false }, NOW)).toBe('unknown')
    expect(computeWorkerStatus(null, NOW)).toBe('unknown')
  })
  it('healthy: nyligen success + 0 consecutive', () => {
    expect(computeWorkerStatus({ has_record: true, consecutive_failures: 0, last_success_at: ago(1) }, NOW)).toBe('healthy')
  })
  it('failing: consecutive_failures > 0', () => {
    expect(computeWorkerStatus({ has_record: true, consecutive_failures: 2, last_success_at: ago(1) }, NOW)).toBe('failing')
  })
  it('failing: senaste error/critical nyligen', () => {
    expect(computeWorkerStatus({ has_record: true, consecutive_failures: 0, last_severity: 'critical', last_failure_at: ago(1), last_success_at: ago(1) }, NOW)).toBe('failing')
  })
  it('warning: senaste warning nyligen', () => {
    expect(computeWorkerStatus({ has_record: true, consecutive_failures: 0, last_severity: 'warning', last_failure_at: ago(2), last_success_at: ago(1) }, NOW)).toBe('warning')
  })
  it('warning: gammal success (> 24h)', () => {
    expect(computeWorkerStatus({ has_record: true, consecutive_failures: 0, last_success_at: ago(30) }, NOW)).toBe('warning')
  })
})

describe('summarizeQueue (krav 5)', () => {
  const rows = [
    { channel: 'email', status: 'pending', scheduled_at: ago(3), next_retry_at: ago(-1) }, // retry schemalagd (framtid)
    { channel: 'email', status: 'pending', scheduled_at: ago(5), next_retry_at: null },
    { channel: 'email', status: 'processing', scheduled_at: ago(1) },
    { channel: 'email', status: 'sent', updated_at: ago(2) },     // idag
    { channel: 'email', status: 'sent', updated_at: ago(30) },    // igår
    { channel: 'email', status: 'failed', scheduled_at: ago(6) },
    { channel: 'email', status: 'skipped', scheduled_at: ago(6) },
    { channel: 'in_app', status: 'pending', scheduled_at: ago(9) }, // ignoreras (ej email)
  ]
  it('räknar status korrekt', () => {
    const s = summarizeQueue(rows, NOW)
    expect(s.pending).toBe(2)
    expect(s.processing).toBe(1)
    expect(s.sent_today).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.skipped).toBe(1)
    expect(s.retries_scheduled).toBe(1)
    expect(s.oldest_pending_age_seconds).toBe(5 * 3600)
  })
})

describe('filterSystemErrors (krav 11)', () => {
  const errs = [
    { component: 'imap-import', severity: 'error', acknowledged: false },
    { component: 'email-worker', severity: 'warning', acknowledged: true },
    { component: 'imap-import', severity: 'critical', acknowledged: false },
  ]
  it('filtrerar på komponent', () => {
    expect(filterSystemErrors(errs, { component: 'imap-import' })).toHaveLength(2)
  })
  it('filtrerar på severity', () => {
    expect(filterSystemErrors(errs, { severity: 'warning' })).toHaveLength(1)
  })
  it('filtrerar på acknowledged', () => {
    expect(filterSystemErrors(errs, { ack: 'ack' })).toHaveLength(1)
    expect(filterSystemErrors(errs, { ack: 'unack' })).toHaveLength(2)
  })
  it('utan filter returnerar allt', () => {
    expect(filterSystemErrors(errs, {})).toHaveLength(3)
  })
})

describe('access control (krav 8/11)', () => {
  it('bara admin får se/agera', () => {
    expect(canViewSystemDashboard(true)).toBe(true)
    expect(canViewSystemDashboard(false)).toBe(false)
    expect(canRunAdminAction(true)).toBe(true)
    expect(canRunAdminAction(false)).toBe(false)
  })
})

describe('formatAge', () => {
  it('formaterar sekunder', () => {
    expect(formatAge(30)).toBe('30 s')
    expect(formatAge(300)).toBe('5 min')
    expect(formatAge(7200)).toBe('2 h')
    expect(formatAge(172800)).toBe('2 d')
  })
})
