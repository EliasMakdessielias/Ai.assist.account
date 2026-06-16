// Cloudflare Email Worker för BokPilots inkommande underlag.
//
// Skalbar permanent lösning: Cloudflare Email Routing tar emot ALLA adresser på domänen
// (catch-all) och kör den här workern. Vi behöver INGA brevlådor per företag – det unika
// ligger i adressens local-part ({arkivnr}underlag@bokpilot.se) och appen dirigerar via
// arkivnumret. Workern parsar mejlet + bilagorna och POST:ar (HMAC-signerat) till
// Supabase edge-funktionen `inbound-email`, som validerar arkivnumret, lagrar bilagorna och
// klassificerar dem. Ett enda flöde → obegränsat antal företag.
//
// Secrets/vars (sätts med wrangler, se README):
//   INBOUND_EMAIL_WEBHOOK_SECRET  – SAMMA värde som edge-funktionens secret (HMAC).
//   INBOUND_EDGE_URL              – https://<projekt>.supabase.co/functions/v1/inbound-email
import PostalMime from 'postal-mime'

// Endast {siffror}underlag@bokpilot.se hanteras; övriga catch-all-adresser avvisas.
const UNDERLAG_RE = /^\d+underlag@bokpilot\.se$/i

function base64FromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000   // undvik stack-overflow för stora bilagor
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}
async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export default {
  async email(message, env) {
    const to = String(message.to || '').trim().toLowerCase()
    if (!UNDERLAG_RE.test(to)) { message.setReject('Unknown recipient'); return }
    if (!env.INBOUND_EMAIL_WEBHOOK_SECRET || !env.INBOUND_EDGE_URL) { message.setReject('Temporarily unavailable'); return }

    const rawBuf = await new Response(message.raw).arrayBuffer()
    const email = await PostalMime.parse(rawBuf)

    const attachments = (email.attachments || []).map(a => {
      const buf = a.content instanceof ArrayBuffer ? a.content : (a.content?.buffer || a.content)
      const contentBase64 = typeof a.content === 'string' ? btoa(unescape(encodeURIComponent(a.content))) : base64FromArrayBuffer(buf)
      return {
        filename: a.filename || 'bilaga',
        contentType: a.mimeType || 'application/octet-stream',
        contentBase64,
        size: buf?.byteLength || 0,
      }
    })

    const payload = {
      source: 'cloudflare-email',
      to,
      from: String(message.from || email.from?.address || ''),
      subject: email.subject || '',
      text: email.text || '',
      messageId: message.headers.get('message-id') || email.messageId || '',
      attachments,
    }
    const body = JSON.stringify(payload)
    const sig = await hmacHex(env.INBOUND_EMAIL_WEBHOOK_SECRET, body)

    const res = await fetch(env.INBOUND_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bokpilot-Signature': `sha256=${sig}` },
      body,
    })
    // 2xx = klart (edge svarar 200 även vid affärsavvisning, t.ex. okänt arkivnummer).
    // Annat = transient fel → kasta så Cloudflare gör automatisk retry i stället för tyst förlust.
    if (!res.ok) throw new Error(`inbound-email edge svarade ${res.status}`)
  },
}
