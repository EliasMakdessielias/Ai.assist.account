// Stripe Checkout för BokPilot. Kund startar uppgradering från Inställningar → Abonnemang.
// Validering + price/kund-uppslag sker i RPC stripe_checkout_context (per inloggad användare).
// Returnerar { configured:false } om Stripe ej satt upp -> frontend faller tillbaka till supportärende.
// Deploy: verify_jwt=true. Env: STRIPE_SECRET_KEY, STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL.
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno&deno-std=0.177.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET = Deno.env.get('STRIPE_SECRET_KEY') || ''
const SUCCESS_URL = Deno.env.get('STRIPE_SUCCESS_URL') || 'https://app.bokpilot.se/installningar/abonnemang?checkout=success'
const CANCEL_URL = Deno.env.get('STRIPE_CANCEL_URL') || 'https://app.bokpilot.se/installningar/abonnemang?checkout=cancel'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const SB_URL = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') || ''
  const user = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } } })
  let body: any; try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const { company_id, plan_id, billing_period } = body || {}

  // Validera + hämta price/kund via RPC (gate: medlem i företaget).
  const { data: ctx, error } = await user.rpc('stripe_checkout_context', { p_company_id: company_id, p_plan_id: plan_id, p_billing_period: billing_period })
  if (error) return json({ error: error.message?.replace(/^.*?:\s*/, '') || 'forbidden' }, 403)
  if (!ctx?.configured) return json({ configured: false })   // frontend faller tillbaka till supportflöde
  if (!SECRET) return json({ configured: false })

  const stripe = new Stripe(SECRET, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
  let customerId = ctx.customerId
  if (!customerId) {
    const c = await stripe.customers.create({ email: ctx.email || undefined, metadata: { company_id: ctx.companyId } })
    customerId = c.id
    // Spara kund-id (service role) så webhooken kan matcha företaget.
    const admin = createClient(SB_URL, SRK)
    await admin.from('company_subscriptions').upsert({ company_id: ctx.companyId, payment_provider: 'stripe', payment_customer_id: customerId }, { onConflict: 'company_id' })
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer: customerId, client_reference_id: ctx.companyId,
    line_items: [{ price: ctx.priceId, quantity: 1 }],
    success_url: SUCCESS_URL, cancel_url: CANCEL_URL,
  })
  return json({ configured: true, url: session.url })
})
