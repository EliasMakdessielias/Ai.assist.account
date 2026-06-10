// Stripe webhook för BokPilot. Verifierar signatur, extraherar relevanta fält och delegerar all
// affärslogik (idempotens, price/status-mapping, sync, notiser, audit) till RPC stripe_handle_event.
// Adapterbaserad: Stripe-specifik parsning här, providerneutral logik i DB. Deploy: verify_jwt=false.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (+ SUPABASE_URL/SERVICE_ROLE_KEY auto).
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno&deno-std=0.177.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET = Deno.env.get('STRIPE_SECRET_KEY') || ''
const WH_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const iso = (sec?: number | null) => (sec ? new Date(sec * 1000).toISOString() : null)

const HANDLED = new Set([
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.finalized', 'invoice.payment_succeeded', 'invoice.payment_failed',
])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SECRET || !WH_SECRET) return json({ error: 'stripe_not_configured' }, 503)

  const stripe = new Stripe(SECRET, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
  const sig = req.headers.get('stripe-signature') || ''
  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WH_SECRET, undefined, Stripe.createSubtleCryptoProvider())
  } catch { return json({ error: 'invalid_signature' }, 400) }

  if (!HANDLED.has(event.type)) return json({ received: true, ignored: event.type })

  // Extrahera providerneutrala fält per event-typ.
  const o: any = event.data.object
  let customerId: string | null = null, subscriptionId: string | null = null, priceId: string | null = null
  let stripeStatus: string | null = null, periodStart: string | null = null, periodEnd: string | null = null, clientRef: string | null = null
  let invoiceId: string | null = null, nextAttempt: string | null = null
  if (event.type === 'checkout.session.completed') {
    customerId = typeof o.customer === 'string' ? o.customer : o.customer?.id || null
    subscriptionId = typeof o.subscription === 'string' ? o.subscription : o.subscription?.id || null
    clientRef = o.client_reference_id || null
  } else if (event.type.startsWith('customer.subscription.')) {
    subscriptionId = o.id; customerId = typeof o.customer === 'string' ? o.customer : o.customer?.id || null
    stripeStatus = o.status; priceId = o.items?.data?.[0]?.price?.id || null
    periodStart = iso(o.current_period_start); periodEnd = iso(o.current_period_end)
  } else if (event.type.startsWith('invoice.')) {
    customerId = typeof o.customer === 'string' ? o.customer : o.customer?.id || null
    subscriptionId = typeof o.subscription === 'string' ? o.subscription : o.subscription?.id || null
    periodEnd = iso(o.lines?.data?.[0]?.period?.end)
    invoiceId = o.id || null
    nextAttempt = iso(o.next_payment_attempt)   // sätts av Stripe vid invoice.payment_failed
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.rpc('stripe_handle_event', {
    p_event_id: event.id, p_type: event.type, p_customer_id: customerId, p_subscription_id: subscriptionId,
    p_price_id: priceId, p_stripe_status: stripeStatus, p_period_start: periodStart, p_period_end: periodEnd, p_client_reference: clientRef,
    p_invoice_id: invoiceId, p_next_attempt: nextAttempt,
  })
  if (error) return json({ error: 'handler_failed' }, 500)   // 5xx -> Stripe gör retry
  return json({ received: true, result: data })
})
