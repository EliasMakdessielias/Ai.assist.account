import { describe, it, expect } from 'vitest'
import {
  renderTemplate, missingVars, defaultChannelEnabled, canDisable,
  EVENT_TYPES, MANDATORY_EVENTS, NOTIFICATION_CHANNELS, eventLabel,
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
  it('obligatoriska in_app-notiser kan inte stängas av', () => {
    expect(canDisable('security_event', 'in_app')).toBe(false)
    expect(canDisable('permission_changed', 'in_app')).toBe(false)
    // icke-obligatoriska kan stängas
    expect(canDisable('kvitto_classified', 'in_app')).toBe(true)
    // andra kanaler kan alltid stängas
    expect(canDisable('security_event', 'email')).toBe(true)
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
