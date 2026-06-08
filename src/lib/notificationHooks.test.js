import { describe, it, expect } from 'vitest'
import { NOTIFY_HOOKS, defaultChannelsFor, APP_URL } from './notificationHooks'

describe('notify_event-hooks: kontrakt (speglar DB-triggers)', () => {
  it('alla sju prioriterade hooks finns', () => {
    expect(Object.keys(NOTIFY_HOOKS).sort()).toEqual([
      'bank_reconciliation_action', 'bookkeeping_suggestion', 'import_failed',
      'payment_overdue', 'system_error', 'vat_report_ready', 'verifikation_created',
    ])
  })

  it('actionUrl pekar rätt per hook', () => {
    expect(NOTIFY_HOOKS.payment_overdue.actionUrl('kund', 'abc')).toBe(`${APP_URL}/fakturor/abc`)
    expect(NOTIFY_HOOKS.payment_overdue.actionUrl('leverantör', 'xyz')).toBe(`${APP_URL}/leverantorsfakturor/xyz`)
    expect(NOTIFY_HOOKS.bookkeeping_suggestion.actionUrl()).toBe(`${APP_URL}/inkorg`)
    expect(NOTIFY_HOOKS.verifikation_created.actionUrl('v1')).toBe(`${APP_URL}/bokforing/v1`)
    expect(NOTIFY_HOOKS.vat_report_ready.actionUrl('v9')).toBe(`${APP_URL}/bokforing/v9`)
    expect(NOTIFY_HOOKS.import_failed.actionUrl()).toBe(`${APP_URL}/installningar/import-export`)
    expect(NOTIFY_HOOKS.bank_reconciliation_action.actionUrl()).toBe(`${APP_URL}/kassa-bank`)
  })

  it('payment_overdue: samma faktura+förfallodatum ger SAMMA dedupe-nyckel (idempotens)', () => {
    const a = NOTIFY_HOOKS.payment_overdue.dedupeKey('inv-1', '2026-05-01')
    const b = NOTIFY_HOOKS.payment_overdue.dedupeKey('inv-1', '2026-05-01')
    expect(a).toBe(b)
    expect(a).toBe('payment_overdue:inv-1:2026-05-01')
    // annat förfallodatum -> annan nyckel (ny påminnelse tillåts)
    expect(NOTIFY_HOOKS.payment_overdue.dedupeKey('inv-1', '2026-06-01')).not.toBe(a)
  })

  it('bank: dedupe per företag och dag (en notis/dag)', () => {
    expect(NOTIFY_HOOKS.bank_reconciliation_action.dedupeKey('c1', '2026-06-08'))
      .toBe('bank_reconciliation_action:c1:2026-06-08')
  })

  it('system_error: timme-bucket dedupe + går bara till plattformsadmins', () => {
    expect(NOTIFY_HOOKS.system_error.recipients).toBe('platform_admins')
    const k1 = NOTIFY_HOOKS.system_error.dedupeKey('email-worker', 'HASH', '2026060810')
    const k2 = NOTIFY_HOOKS.system_error.dedupeKey('email-worker', 'HASH', '2026060810')
    expect(k1).toBe(k2) // samma timme -> dedupe
    expect(NOTIFY_HOOKS.system_error.dedupeKey('email-worker', 'HASH', '2026060811')).not.toBe(k1) // ny timme
  })

  it('verifikation_created går bara till skaparen', () => {
    expect(NOTIFY_HOOKS.verifikation_created.recipients).toBe('creator')
  })

  it('standardkanaler: informativa = endast in_app, viktiga = in_app + email', () => {
    expect(defaultChannelsFor('verifikation_created')).toEqual(['in_app'])
    expect(defaultChannelsFor('bookkeeping_suggestion')).toEqual(['in_app'])
    expect(defaultChannelsFor('payment_overdue')).toEqual(['in_app', 'email'])
    expect(defaultChannelsFor('vat_report_ready')).toEqual(['in_app', 'email'])
    expect(defaultChannelsFor('import_failed')).toEqual(['in_app', 'email'])
    expect(defaultChannelsFor('system_error')).toEqual(['in_app', 'email'])
  })
})
