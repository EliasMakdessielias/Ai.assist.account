// HMAC-SHA256-signatur för inbound-email-webhooken. Samma algoritm används i
// edge-funktionen (supabase/functions/inbound-email) och i Cloudflare Email
// Workern – detta är den testbara referensen för kontraktet:
//   X-Bokpilot-Signature: sha256=<hex(hmacSHA256(rawBody, secret))>

export async function hmacSha256Hex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Konstant-tids-jämförelse (motverkar timing-attacker).
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export async function verifyInboundSignature(secret, body, header) {
  if (!secret || !header) return false
  const provided = String(header).replace(/^sha256=/, '').trim().toLowerCase()
  const expected = await hmacSha256Hex(secret, body)
  return timingSafeEqualHex(provided, expected)
}
