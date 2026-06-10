// Stripe-adapter (klient). Anropar edge-funktionerna; ingen Stripe-logik hårdkodad i UI.
// paymentProvider-strukturen behålls så andra providers kan stödjas senare.

export const STRIPE_HANDLED_EVENTS = [
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.finalized', 'invoice.payment_succeeded', 'invoice.payment_failed',
]

// Billing-status → companies.service_state (speglar sync_company_service_state_from_billing i DB).
// Returnerar målstatus, eller null om admin-manuell lås (service_state_manual) ska respekteras (krav 7).
// Policy: trial/active→active; past_due inom grace→active, efter grace→paused; cancelled/expired/suspended→paused.
export function serviceStateForBilling(sub, now = Date.now()) {
  if (!sub) return null
  if (sub.service_state_manual) return null            // admin-manuell lås rörs aldrig av billing
  const status = sub.status
  if (status === 'trial' || status === 'active') return 'active'
  if (status === 'past_due') {
    const g = sub.grace_until ? new Date(sub.grace_until).getTime() : null
    return (g && g > now) ? 'active' : 'paused'        // inom grace → kvar aktiv, efter → paused
  }
  if (status === 'cancelled' || status === 'expired' || status === 'suspended') return 'paused'
  return 'active'
}

export const STRIPE_REQUIRED_ENV = [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_STARTER_YEARLY',
  'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY',
  'STRIPE_PRICE_BYRA_MONTHLY', 'STRIPE_PRICE_BYRA_YEARLY',
  'STRIPE_SUCCESS_URL', 'STRIPE_CANCEL_URL',
]

// Stripe subscription-status -> BokPilot (speglar map_stripe_status i DB).
export function mapStripeStatus(s) {
  return {
    trialing: 'trial', active: 'active', past_due: 'past_due', canceled: 'cancelled',
    unpaid: 'past_due', incomplete: 'past_due', incomplete_expired: 'cancelled',
  }[s] || 'past_due'
}

// Starta Stripe Checkout. Returnerar {configured, url}. configured:false -> anroparen faller tillbaka.
export async function startStripeCheckout(supabase, { companyId, planId, billingPeriod }) {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: { company_id: companyId, plan_id: planId, billing_period: billingPeriod === 'yearly' ? 'yearly' : 'monthly' },
  })
  if (error) return { configured: false, error: true }
  return data || { configured: false }
}

// Öppna Stripe Billing Portal (hantera betalningsmetod/abonnemang).
export async function openStripePortal(supabase, companyId) {
  const { data, error } = await supabase.functions.invoke('stripe-portal', { body: { company_id: companyId } })
  if (error) return { configured: false }
  return data || { configured: false }
}

export const stripeCustomerUrl = id => id ? `https://dashboard.stripe.com/customers/${id}` : null

// Validera Stripe-id (tomt = tillåtet tills Stripe aktiveras). price_ för pris, prod_ för produkt.
export const isValidStripeId = (value, prefix) => {
  const t = (value || '').trim()
  return t === '' || t.startsWith(prefix)
}

// Stripe-kopplingsstatus för en plan (för badges i admin).
export function planStripeStatus(plan) {
  const monthly = !!(plan?.stripe_price_monthly)
  const yearly = !!(plan?.stripe_price_yearly)
  return { monthly, yearly, product: !!(plan?.stripe_product_id), connected: monthly || yearly }
}

// Konfigurationsstatus för Stripe (admin). Klienten kan inte läsa edge-secrets, men kan visa hur
// många planer som har price-id kopplade. Saknas koppling → checkout faller tillbaka till supportärende.
// status: 'ready' (alla aktiva planer kopplade), 'partial', 'none'.
export function stripeConfigSummary(plans = []) {
  const active = (plans || []).filter(p => p?.is_active)
  const connected = active.filter(p => planStripeStatus(p).connected)
  const status = active.length === 0 ? 'none' : connected.length === active.length ? 'ready' : connected.length > 0 ? 'partial' : 'none'
  return { total: active.length, connected: connected.length, status }
}
