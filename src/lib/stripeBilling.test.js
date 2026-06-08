import { describe, it, expect } from 'vitest'
import { STRIPE_HANDLED_EVENTS, STRIPE_REQUIRED_ENV, mapStripeStatus, stripeCustomerUrl } from './stripeBilling'

describe('Stripe-event-stöd (krav 7)', () => {
  it('hanterar minst de sex kärn-eventen', () => {
    for (const e of ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
      'customer.subscription.deleted', 'invoice.payment_succeeded', 'invoice.payment_failed']) {
      expect(STRIPE_HANDLED_EVENTS).toContain(e)
    }
  })
})

describe('env-variabler (krav 1)', () => {
  it('listar alla obligatoriska Stripe-env', () => {
    for (const v of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_PRO_MONTHLY',
      'STRIPE_PRICE_BYRA_MONTHLY', 'STRIPE_SUCCESS_URL', 'STRIPE_CANCEL_URL']) {
      expect(STRIPE_REQUIRED_ENV).toContain(v)
    }
  })
})

describe('status-mapping (krav 9)', () => {
  it('Stripe -> BokPilot', () => {
    expect(mapStripeStatus('trialing')).toBe('trial')
    expect(mapStripeStatus('active')).toBe('active')
    expect(mapStripeStatus('past_due')).toBe('past_due')
    expect(mapStripeStatus('canceled')).toBe('cancelled')
    expect(mapStripeStatus('unpaid')).toBe('past_due')
    expect(mapStripeStatus('incomplete')).toBe('past_due')
    expect(mapStripeStatus('incomplete_expired')).toBe('cancelled')
    expect(mapStripeStatus('whatever')).toBe('past_due')
  })
})

describe('stripeCustomerUrl', () => {
  it('bygger dashboard-länk', () => {
    expect(stripeCustomerUrl('cus_123')).toBe('https://dashboard.stripe.com/customers/cus_123')
    expect(stripeCustomerUrl(null)).toBeNull()
  })
})
