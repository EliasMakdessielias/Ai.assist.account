// Stripe Billing Portal för BokPilot. Kund (medlem) öppnar portal för att hantera betalningsmetod/abonnemang.
// Validering via RPC stripe_checkout_context-mönstret: vi slår upp kund-id via egen subscription (RLS).
// Deploy: verify_jwt=true. Env: STRIPE_SECRET_KEY, STRIPE_CANCEL_URL (return).
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno&deno-std=0.177.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET = Deno.env.get('STRIPE_SECRET_KEY') || ''
const RETURN_URL = Deno.env.get('STRIPE_CANCEL_URL') || 'https://app.bokpilot.se/installningar/abonnemang'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!SECRET) return json({ configured: false })
  const SB_URL = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const auth = req.headers.get('Authorization') || ''
  const user = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } } })
  let body: any; try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  // RLS: kund ser bara sitt företags subscription -> customer_id.
  const { data: sub } = await user.from('company_subscriptions').select('payment_customer_id').eq('company_id', body?.company_id).maybeSingle()
  if (!sub?.payment_customer_id) return json({ configured: false })
  const stripe = new Stripe(SECRET, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
  const portal = await stripe.billingPortal.sessions.create({ customer: sub.payment_customer_id, return_url: RETURN_URL })
  return json({ configured: true, url: portal.url })
})
