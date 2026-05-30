// Edge Function: hamta-foretag
// Hämtar grundläggande företagsuppgifter (namn, adress m.m.) för ett
// organisationsnummer från allabolag.se (publik företagssida).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { org_nr } = await req.json()
    const digits = String(org_nr || '').replace(/\D/g, '')
    if (digits.length < 10) throw new Error('Ange ett giltigt organisations-/personnummer (10 siffror)')
    const orgnr10 = digits.slice(-10)
    const formatted = `${orgnr10.slice(0, 6)}-${orgnr10.slice(6)}`

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'sv-SE,sv;q=0.9',
    }
    const urls = [`https://www.allabolag.se/${orgnr10}`, `https://www.allabolag.se/what/${orgnr10}`, `https://www.allabolag.se/${formatted}`]
    let html = ''
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers, redirect: 'follow' })
        if (r.ok) { const t = await r.text(); if (t && t.length > 800) { html = t; break } }
      } catch { /* nästa */ }
    }
    if (!html) throw new Error('Kunde inte hämta sidan från allabolag.se (kan vara blockerad). Fyll i manuellt.')

    const result: Record<string, string> = { org_nr: formatted }

    // 1) JSON-LD (schema.org Organization)
    const lds = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    for (const m of lds) {
      try {
        const parsed = JSON.parse(m[1].trim())
        const arr = Array.isArray(parsed) ? parsed : [parsed]
        for (const o of arr) {
          if (!o || typeof o !== 'object') continue
          if (o.name && !result.name) result.name = o.name
          if (o.legalName && !result.name) result.name = o.legalName
          const a = o.address
          if (a && typeof a === 'object') {
            if (a.streetAddress) result.faktura_adress = a.streetAddress
            if (a.postalCode) result.postnr = String(a.postalCode).replace(/\s/g, '')
            if (a.addressLocality) result.ort = a.addressLocality
            if (a.addressCountry) result.land = typeof a.addressCountry === 'string' ? a.addressCountry : (a.addressCountry.name || '')
          }
          if (o.telephone && !result.phone) result.phone = String(o.telephone)
          if (o.url && !result.webb) result.webb = String(o.url)
        }
      } catch { /* ignore */ }
    }

    // 2) Fallback: og:title / title för namn
    if (!result.name) {
      const og = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      const ti = html.match(/<title>([^<]+)<\/title>/i)
      const raw = (og?.[1] || ti?.[1] || '').split(/[|–-]/)[0].trim()
      if (raw) result.name = raw
    }

    if (!result.name) throw new Error('Hittade inga uppgifter för numret. Fyll i manuellt.')
    return json({ ok: true, result })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
