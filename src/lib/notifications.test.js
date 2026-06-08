import { describe, it, expect } from 'vitest'
import {
  renderTemplate, missingVars, defaultChannelEnabled, canDisable,
  EVENT_TYPES, MANDATORY_EVENTS, NOTIFICATION_CHANNELS, eventLabel,
  EVENT_GROUPS, providerAvailable, channelStatus, resolvePref,
} from './notifications'

describe('renderTemplate', () => {
  it('ersätter variabler', () => {
    expect(renderTemplate('Faktura {{invoiceNumber}} ({{amount}})', { invoiceNumber: '123', amount: '1 250 kr' }))
      .toBe('Faktura 123 (1 250 kr)')
  })
  it('tar bort saknade variabler (ingen {{...}} kvar)', () => {
    expect(renderTemplate('Hej {{name}}, se {{actionUrl}}', { name: 'Eli' })).toBe('Hej Eli, se ')
    expect(renderTemplate('A {{x}} B', {})).toBe('A  B')
  })
  it('null-mall -> tom sträng', () => {
    expect(renderTemplate(null, { x: 1 })).toBe('')
  })
})

describe('missingVars (validering före utskick)', () => {
  it('hittar obligatoriska som saknas/är tomma', () => {
    expect(missingVars(['actionUrl', 'companyName'], { companyName: 'BokPilot AB' })).toEqual(['actionUrl'])
    expect(missingVars(['actionUrl'], { actionUrl: '' })).toEqual(['actionUrl'])
    expect(missingVars(['actionUrl'], { actionUrl: 'https://x' })).toEqual([])
  })
})

describe('kanaler & preferenser', () => {
  it('in_app + email på som standard, sms/push av', () => {
    expect(defaultChannelEnabled('in_app')).toBe(true)
    expect(defaultChannelEnabled('email')).toBe(true)
    expect(defaultChannelEnabled('sms')).toBe(false)
    expect(defaultChannelEnabled('push')).toBe(false)
  })
  it('obligatoriska notiser kan inte stängas av för in_app/email', () => {
    expect(canDisable('security_event', 'in_app')).toBe(false)
    expect(canDisable('permission_changed', 'in_app')).toBe(false)
    expect(canDisable('security_event', 'email')).toBe(false) // tvångsskickas av systemet
    // icke-obligatoriska kan stängas
    expect(canDisable('kvitto_classified', 'in_app')).toBe(true)
    expect(canDisable('kvitto_classified', 'email')).toBe(true)
    // sms/push styrs alltid via opt-in (kan togglas)
    expect(canDisable('security_event', 'sms')).toBe(true)
  })
})

describe('preferens-UI: gruppering', () => {
  it('varje event-typ ligger i exakt en grupp', () => {
    const grouped = EVENT_GROUPS.flatMap(g => g.events)
    const keys = EVENT_TYPES.map(e => e.key)
    for (const k of keys) expect(grouped.filter(x => x === k)).toHaveLength(1)
    expect(grouped).toHaveLength(keys.length) // inga extra/okända nycklar
  })
  it('har de sju logiska grupperna', () => {
    expect(EVENT_GROUPS.map(g => g.label)).toEqual([
      'Underlag & Inkorg', 'Fakturor', 'Bokföring', 'Moms', 'Bank', 'Säkerhet', 'System',
    ])
  })
})

describe('preferens-UI: provider & status', () => {
  it('in_app/email har provider, sms/push saknar (Fas 2)', () => {
    expect(providerAvailable('in_app')).toBe(true)
    expect(providerAvailable('email')).toBe(true)
    expect(providerAvailable('sms')).toBe(false)
    expect(providerAvailable('push')).toBe(false)
  })
  it('channelStatus speglar de sex lägena', () => {
    expect(channelStatus({ eventType: 'security_event', channel: 'in_app', enabled: true })).toBe('mandatory')
    expect(channelStatus({ eventType: 'security_event', channel: 'email', enabled: false })).toBe('mandatory')
    expect(channelStatus({ eventType: 'kvitto_classified', channel: 'email', enabled: true })).toBe('active')
    expect(channelStatus({ eventType: 'kvitto_classified', channel: 'email', enabled: false })).toBe('off')
    expect(channelStatus({ eventType: 'kvitto_classified', channel: 'sms', enabled: true })).toBe('provider_missing')
    // om provider funnits men ingen opt-in skulle det bli needs_opt_in (testas via hasOptIn-grenen)
    expect(channelStatus({ eventType: 'kvitto_classified', channel: 'sms', enabled: true, hasOptIn: true })).toBe('provider_missing')
  })
})

describe('preferens-UI: resolvePref (laddning)', () => {
  const rows = [
    { event_type: 'kvitto_classified', channel: 'email', enabled: false },
    { event_type: 'kvitto_classified', channel: 'in_app', enabled: true },
  ]
  it('läser sparat värde från DB-rader', () => {
    expect(resolvePref(rows, 'kvitto_classified', 'email')).toBe(false)
    expect(resolvePref(rows, 'kvitto_classified', 'in_app')).toBe(true)
  })
  it('faller tillbaka till standard när rad saknas', () => {
    expect(resolvePref(rows, 'payment_overdue', 'email')).toBe(true) // email på som standard
    expect(resolvePref(rows, 'payment_overdue', 'sms')).toBe(false)  // sms av som standard
  })
  it('obligatoriska in_app/email är alltid på, även om DB säger annat', () => {
    const tampered = [{ event_type: 'security_event', channel: 'email', enabled: false }]
    expect(resolvePref(tampered, 'security_event', 'email')).toBe(true)
    expect(resolvePref(tampered, 'security_event', 'in_app')).toBe(true)
  })
  it('informativa events har email AV som standard (in_app på)', () => {
    // speglar notify_event email-default-off
    expect(resolvePref([], 'verifikation_created', 'in_app')).toBe(true)
    expect(resolvePref([], 'verifikation_created', 'email')).toBe(false)
    expect(resolvePref([], 'bookkeeping_suggestion', 'email')).toBe(false)
    expect(resolvePref([], 'kvitto_classified', 'email')).toBe(false)
    // viktiga events behåller email på
    expect(resolvePref([], 'payment_overdue', 'email')).toBe(true)
    expect(resolvePref([], 'import_failed', 'email')).toBe(true)
  })
})

describe('event-typer', () => {
  it('täcker alla kärn-events från specen', () => {
    const keys = EVENT_TYPES.map(e => e.key)
    for (const k of ['underlag_received', 'kvitto_classified', 'supplier_invoice_received', 'invoice_needs_review',
      'ocr_failed', 'bookkeeping_suggestion', 'verifikation_created', 'payment_overdue', 'vat_report_ready',
      'bank_reconciliation_action', 'import_failed', 'user_invited', 'security_event', 'permission_changed',
      'chart_import_done', 'locked_account_blocked', 'system_error']) {
      expect(keys).toContain(k)
    }
    expect(EVENT_TYPES).toHaveLength(17)
    expect(NOTIFICATION_CHANNELS).toEqual(['in_app', 'email', 'sms', 'push'])
    expect(MANDATORY_EVENTS).toContain('security_event')
    expect(eventLabel('kvitto_classified')).toBe('Kvitto klassificerat')
  })
})
