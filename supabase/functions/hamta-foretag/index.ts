// Edge Function: hamta-foretag
// Hämtar företagsuppgifter (namn, adress, telefon m.m.) för ett organisationsnummer
// från allabolag.se. Datan ligger i sidans __NEXT_DATA__-JSON.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Djupsök efter företagsobjektet (matchar orgnr) i __NEXT_DATA__.
function findCompany(node: unknown, orgnr: string): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const v of node) { const f = findCompany(v, orgnr); if (f) return f }
    return null
  }
  const o = node as Record<string, unknown>
  const on = String(o.orgnr ?? o.orgNumber ?? o.organisationNumber ?? '').replace(/\D/g, '')
  if (on && on === orgnr && (o.name || o.legalName)) return o
  for (const v of Object.values(o)) { const f = findCompany(v, orgnr); if (f) return f }
  return null
}

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
    let html = ''
    for (const u of [`https://www.allabolag.se/${orgnr10}`, `https://www.allabolag.se/what/${orgnr10}`]) {
      try { const r = await fetch(u, { headers, redirect: 'follow' }); if (r.ok) { const t = await r.text(); if (t.length > 5000) { html = t; break } } } catch { /* nästa */ }
    }
    if (!html) throw new Error('Kunde inte hämta sidan från allabolag.se. Fyll i manuellt.')

    const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
    if (!nd) throw new Error('Kunde inte tolka sidan. Fyll i manuellt.')
    const data = JSON.parse(nd[1])
    const c = findCompany(data, orgnr10)
    if (!c) throw new Error('Hittade inga uppgifter för numret. Fyll i manuellt.')

    const post = (c.postalAddress || {}) as Record<string, string>
    const vis = (c.visitorAddress || {}) as Record<string, string>
    const result: Record<string, string> = {
      org_nr: formatted,
      name: String(c.name || c.legalName || ''),
      phone: String(c.phone || c.phone2 || '').replace(/\s/g, ''),
      faktura_adress: post.addressLine || post.boxAddressLine || vis.addressLine || '',
      postnr: String(post.zipCode || vis.zipCode || '').replace(/\s/g, ''),
      ort: post.postPlace || vis.postPlace || '',
      land: 'Sverige',
    }
    return json({ ok: true, result })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
