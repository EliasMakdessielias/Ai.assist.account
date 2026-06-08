// Publik avregistreringslänk för email-notiser. Verifierar HMAC-token (NOTIF_UNSUB_SECRET),
// stänger av email för det specifika eventet via RPC apply_email_unsubscribe.
// Obligatoriska events kan ej avregistreras (RPC returnerar -1). Loggar inga secrets.
// Deploy: verify_jwt=false. Secret NOTIF_UNSUB_SECRET måste matcha kö-processorns .env.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SECRET = Deno.env.get('NOTIF_UNSUB_SECRET') ?? ''
const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}
function bytesToB64url(b: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function verifyToken(token: string): Promise<{ userId: string, eventType: string } | null> {
  if (!token || !token.includes('.')) return null
  const [p, sig] = token.split('.')
  let payload: string
  try { payload = new TextDecoder().decode(b64urlToBytes(p)) } catch { return null }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  if (bytesToB64url(mac) !== sig) return null
  const [userId, eventType] = payload.split('|')
  if (!userId || !eventType) return null
  return { userId, eventType }
}

function page(title: string, msg: string, ok: boolean): Response {
  const color = ok ? '#16a34a' : '#dc2626'
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;margin:0;padding:48px 16px"><div style="max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center"><h1 style="font-size:18px;color:#111827;margin:0 0 12px">${title}</h1><p style="color:${color};font-size:14px;margin:0 0 8px">${msg}</p><p style="color:#9ca3af;font-size:12px;margin:16px 0 0">BokPilot</p></div></body></html>`
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  const v = await verifyToken(token)
  if (!v) return page('Ogiltig länk', 'Avregistreringslänken är ogiltig eller har manipulerats.', false)
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc('apply_email_unsubscribe', { p_user_id: v.userId, p_event_type: v.eventType })
  if (error) return page('Fel', 'Kunde inte avregistrera just nu. Försök igen senare.', false)
  if (data === -1) return page('Kan inte avregistreras', 'Den här typen av notis är säkerhets-/systemkritisk och kan inte stängas av.', false)
  return page('Avregistrerad', 'Du får inte längre den här typen av email-notiser. Du kan ändra detta i Inställningar.', true)
})
