import { describe, it, expect } from 'vitest'
import { STRIPE_HANDLED_EVENTS, STRIPE_REQUIRED_ENV, mapStripeStatus, stripeCustomerUrl, isValidStripeId, planStripeStatus } from './stripeBilling'

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

describe('isValidStripeId (krav 5)', () => {
  it('tomt är tillåtet (tills Stripe aktiveras)', () => {
    expect(isValidStripeId('', 'price_')).toBe(true)
    expect(isValidStripeId(null, 'prod_')).toBe(true)
  })
  it('price_/prod_ krävs annars', () => {
    expect(isValidStripeId('price_123', 'price_')).toBe(true)
    expect(isValidStripeId('prod_123', 'prod_')).toBe(true)
    expect(isValidStripeId('xyz', 'price_')).toBe(false)
    expect(isValidStripeId('prod_123', 'price_')).toBe(false)
  })
})

describe('planStripeStatus (krav 6)', () => {
  it('visar monthly/yearly/product/connected', () => {
    expect(planStripeStatus({ stripe_price_monthly: 'price_m' })).toEqual({ monthly: true, yearly: false, product: false, connected: true })
    expect(planStripeStatus({ stripe_price_monthly: 'price_m', stripe_price_yearly: 'price_y', stripe_product_id: 'prod_x' }))
      .toEqual({ monthly: true, yearly: true, product: true, connected: true })
    expect(planStripeStatus({})).toEqual({ monthly: false, yearly: false, product: false, connected: false })
  })
})
