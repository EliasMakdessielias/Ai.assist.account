// Edge Function: hamta-foretag
// Hämtar svenska företagsuppgifter. PRIMÄRT via officiellt API (UC Affärsinformation / Allabolag)
// när secrets är satta; annars FALLBACK till best-effort scraping av allabolag.se:s publika sida.
// Secrets bor enbart här (server-side). Returnerar en normaliserad intern företagsmodell + en
// platt `result` (bakåtkompatibel med LeverantorEditor).
//
// Provider-interface (CompanyInformationProvider) => byt/komplettera datakälla utan att frontend
// behöver byggas om. Officiella adapterns HTTP-mappning (endpoint/auth/fältsökvägar) drivs av
// miljövariabler – anpassa efter UC:s API-dokumentation. Scraping-providern är en reserv som kan
// blockeras av allabolag.se:s bot-skydd och bryta mot deras villkor; föredra det officiella API:t.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const CACHE_TTL_MS = 24 * 60 * 60 * 1000      // 24h
const RATE_MAX = 20                            // max slagningar per användare
const RATE_WINDOW_MS = 60 * 1000               // per minut
const TIMEOUT_MS = 10_000                      // timeout för externa anrop

// ---- Org-nr (samma regler som src/lib/orgnr.js) -------------------------------------------
function normalizeOrgNr(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 12) return d.slice(2)
  if (d.length === 10) return d
  if (d.length > 12) return d.slice(-10)
  return ''
}
function luhnValid(s: string): boolean {
  if (!/^\d{10}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) { let x = s.charCodeAt(i) - 48; if (i % 2 === 0) { x *= 2; if (x > 9) x -= 9 } sum += x }
  return sum % 10 === 0
}
const formatOrgNr = (n: string) => (n.length === 10 ? `${n.slice(0, 6)}-${n.slice(6)}` : n)

// ---- Intern företagsmodell ----------------------------------------------------------------
function emptyCompany() {
  return {
    organizationNumber: '', legalName: '', displayName: '', companyForm: '', status: '',
    registrationDate: null, businessDescription: '',
    address: { careOf: '', street: '', postalCode: '', city: '', municipality: '', county: '', country: 'Sverige' },
    postalAddress: { careOf: '', street: '', postalCode: '', city: '', country: 'Sverige' },
    contact: { phone: '', mobile: '', email: '', website: '' },
    taxRegistration: { fTax: null, vatRegistered: null, employerRegistered: null, vatNumber: '' },
    industries: [], workplaces: [], management: [], groupInformation: {}, financials: [],
    employeeCount: null, shareCapital: null, source: 'Allabolag', sourceRetrievedAt: null,
  }
}

const s = (v: unknown) => (v == null ? '' : String(v))
const pick = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined }

// ADAPTER: råsvar (UC/Allabolag) -> intern modell. Läser vanligt förekommande fältnamn defensivt.
// Anpassa fältsökvägarna efter UC:s faktiska API-schema. Saknade/null-värden hanteras säkert.
function normalizeAllabolag(raw: Record<string, unknown>): ReturnType<typeof emptyCompany> {
  const c = emptyCompany()
  const o = (raw?.company ?? raw?.data ?? raw) as Record<string, unknown>
  if (!o || typeof o !== 'object') return c
  const addr = (o.visitorAddress ?? o.address ?? {}) as Record<string, unknown>
  const post = (o.postalAddress ?? o.postAddress ?? addr) as Record<string, unknown>
  const tax = (o.taxRegistration ?? o.tax ?? {}) as Record<string, unknown>

  c.organizationNumber = normalizeOrgNr(s(pick(o, ['organizationNumber', 'orgNumber', 'organisationNumber', 'orgnr', 'organisationsnummer'])))
  c.legalName = s(pick(o, ['legalName', 'name', 'companyName', 'foretagsnamn', 'namn', 'juridisktNamn']))
  c.displayName = s(pick(o, ['displayName', 'tradeName', 'specialName', 'visningsnamn'])) || c.legalName
  c.companyForm = s(pick(o, ['companyForm', 'legalForm', 'companyType', 'bolagsform']))
  c.status = s(pick(o, ['status', 'companyStatus', 'foretagsstatus', 'statusText']))
  c.registrationDate = (pick(o, ['registrationDate', 'registeredDate', 'registreringsdatum']) as string) ?? null
  c.businessDescription = s(pick(o, ['businessDescription', 'description', 'sniDescription', 'verksamhet', 'verksamhetsbeskrivning', 'andamal']))
  c.employeeCount = (pick(o, ['employeeCount', 'employees', 'numberOfEmployees', 'antalAnstallda', 'anstallda']) as number) ?? null
  c.shareCapital = (pick(o, ['shareCapital', 'capital', 'aktiekapital']) as number) ?? null

  c.address = {
    careOf: s(pick(addr, ['careOf', 'co'])), street: s(pick(addr, ['street', 'addressLine', 'streetAddress', 'gatuadress', 'utdelningsadress', 'postadress'])),
    postalCode: s(pick(addr, ['postalCode', 'zipCode', 'zip', 'postnummer', 'postnr'])).replace(/\s/g, ''),
    city: s(pick(addr, ['city', 'postPlace', 'town', 'postort', 'ort'])), municipality: s(pick(addr, ['municipality', 'kommun', 'kommunsate'])),
    county: s(pick(addr, ['county', 'lan', 'lansate'])), country: s(pick(addr, ['country', 'land'])) || 'Sverige',
  }
  c.postalAddress = {
    careOf: s(pick(post, ['careOf', 'co'])), street: s(pick(post, ['street', 'addressLine', 'boxAddressLine', 'gatuadress', 'utdelningsadress', 'postadress'])),
    postalCode: s(pick(post, ['postalCode', 'zipCode', 'zip', 'postnummer', 'postnr'])).replace(/\s/g, ''),
    city: s(pick(post, ['city', 'postPlace', 'town', 'postort', 'ort'])), country: s(pick(post, ['country', 'land'])) || 'Sverige',
  }
  c.contact = {
    phone: s(pick(o, ['phone', 'phoneNumber', 'telephone', 'telefon', 'telefonnummer'])).replace(/\s/g, ''),
    mobile: s(pick(o, ['mobile', 'mobilePhone', 'cellPhone', 'mobil', 'mobiltelefon'])).replace(/\s/g, ''),
    email: s(pick(o, ['email', 'emailAddress', 'epost', 'epostadress', 'e_post'])), website: s(pick(o, ['website', 'homepage', 'web', 'hemsida', 'webbplats', 'webb'])),
  }
  const num = pick(o, ['vatNumber', 'vatNo', 'momsregnr', 'momsnummer', 'vatNummer']) ?? (tax.vatNumber as string)
  c.taxRegistration = {
    fTax: (pick(o, ['fTax', 'fskatt', 'godkand_for_f_skatt', 'fskattRegistrerad']) ?? tax.fTax ?? null) as boolean | null,
    vatRegistered: (pick(o, ['vatRegistered', 'momsregistrerad', 'momsRegistrerad']) ?? tax.vatRegistered ?? null) as boolean | null,
    employerRegistered: (pick(o, ['employerRegistered', 'arbetsgivarregistrerad', 'arbetsgivareRegistrerad']) ?? tax.employerRegistered ?? null) as boolean | null,
    vatNumber: s(num),
  }
  // SNI/bransch: lista om den finns, annars bygg en post från enstaka kod+text-fält.
  let inds = (o.industries ?? o.sniCodes ?? o.snikoder ?? o.sniKoder ?? []) as unknown[]
  if (!Array.isArray(inds) || !inds.length) {
    const sniCode = s(pick(o, ['sni', 'sniKod', 'sni_kod', 'branschkod', 'industryCode', 'sniCode']))
    const sniText = s(pick(o, ['sniText', 'sniBeskrivning', 'branschText', 'bransch', 'industryText']))
    inds = (sniCode || sniText) ? [{ code: sniCode, description: sniText }] : []
  }
  c.industries = inds
  c.workplaces = (o.workplaces ?? o.establishments ?? []) as unknown[]
  c.management = (o.management ?? o.representatives ?? []) as unknown[]
  c.groupInformation = (o.groupInformation ?? {}) as Record<string, unknown>
  c.financials = (o.financials ?? o.accounts ?? []) as unknown[]
  return c
}

// Platt form för LeverantorEditor (bakåtkompatibel).
function toFlatResult(c: ReturnType<typeof emptyCompany>) {
  const a = c.postalAddress.street ? c.postalAddress : c.address
  return {
    org_nr: c.organizationNumber ? formatOrgNr(c.organizationNumber) : '',
    name: c.legalName, phone: c.contact.phone,
    faktura_adress: a.street, postnr: a.postalCode, ort: a.city, land: a.country || 'Sverige',
    webb: c.contact.website,
  }
}

// ---- Provider-interface -------------------------------------------------------------------
function allabolagProvider(env: Record<string, string | undefined>) {
  const base = env.ALLABOLAG_API_BASE_URL, key = env.ALLABOLAG_API_KEY
  const clientId = env.ALLABOLAG_CLIENT_ID, secret = env.ALLABOLAG_CLIENT_SECRET
  const configured = !!(base && (key || (clientId && secret)))
  return {
    name: 'Allabolag',
    configured,
    async getCompany(orgnr10: string) {
      if (!configured) { const e = new Error('not_configured'); (e as any).code = 'not_configured'; throw e }
      // ADAPTER: anpassa URL + auth efter UC:s dokumentation.
      const url = `${String(base).replace(/\/$/, '')}/companies/${orgnr10}`
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (key) headers.Authorization = `Bearer ${key}`
      if (clientId) headers['X-Client-Id'] = clientId
      if (secret) headers['X-Client-Secret'] = secret
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      let res: Response
      try { res = await fetch(url, { headers, signal: ctrl.signal }) }
      catch { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e }
      finally { clearTimeout(timer) }
      if (res.status === 404) { const e = new Error('not_found'); (e as any).code = 'not_found'; throw e }
      if (res.status === 429) { const e = new Error('rate_limited'); (e as any).code = 'rate_limited'; throw e }
      if (!res.ok) { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e }
      const raw = await res.json().catch(() => { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e })
      const apiVersion = res.headers.get('x-api-version') || env.ALLABOLAG_API_VERSION || 'v1'
      return { company: normalizeAllabolag(raw as Record<string, unknown>), apiVersion }
    },
  }
}

// PROVIDER: apiverket.se (officiell Bolagsverket/SCB-data inkl. SNI, gratis API-nyckel).
// Endpoint/auth är konfigurerbara via secrets eftersom de ska matchas mot apiverkets docs:
//   APIVERKET_API_KEY (krävs), APIVERKET_BASE_URL, APIVERKET_COMPANY_PATH (innehåller {orgnr}),
//   APIVERKET_AUTH_HEADER (default Authorization), APIVERKET_AUTH_PREFIX (default 'Bearer ').
function apiverketProvider(env: Record<string, string | undefined>) {
  const key = env.APIVERKET_API_KEY
  const base = (env.APIVERKET_BASE_URL || 'https://api.apiverket.se').replace(/\/$/, '')
  const path = env.APIVERKET_COMPANY_PATH || '/bolag/{orgnr}'
  const authHeader = env.APIVERKET_AUTH_HEADER || 'Authorization'
  const authPrefix = env.APIVERKET_AUTH_PREFIX ?? 'Bearer '
  return {
    name: 'apiverket',
    configured: !!key,
    async getCompany(orgnr10: string) {
      if (!key) { const e = new Error('not_configured'); (e as any).code = 'not_configured'; throw e }
      const url = base + path.replace('{orgnr}', orgnr10)
      const headers: Record<string, string> = { Accept: 'application/json', [authHeader]: `${authPrefix}${key}` }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      let res: Response
      try { res = await fetch(url, { headers, signal: ctrl.signal }) }
      catch { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e }
      finally { clearTimeout(timer) }
      if (res.status === 401 || res.status === 403) { const e = new Error('not_configured'); (e as any).code = 'not_configured'; throw e }
      if (res.status === 404) { const e = new Error('not_found'); (e as any).code = 'not_found'; throw e }
      if (res.status === 429) { const e = new Error('rate_limited'); (e as any).code = 'rate_limited'; throw e }
      if (!res.ok) { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e }
      const raw = await res.json().catch(() => { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e })
      return { company: normalizeAllabolag(raw as Record<string, unknown>), apiVersion: env.APIVERKET_API_VERSION || 'apiverket' }
    },
  }
}

// Djupsök efter företagsobjektet (matchar orgnr) i __NEXT_DATA__.
function findCompany(node: unknown, orgnr: string): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const v of node) { const f = findCompany(v, orgnr); if (f) return f } return null }
  const o = node as Record<string, unknown>
  const on = String(o.orgnr ?? o.orgNumber ?? o.organisationNumber ?? o.organizationNumber ?? '').replace(/\D/g, '')
  if (on && on.slice(-10) === orgnr && (o.name || o.legalName)) return o
  for (const v of Object.values(o)) { const f = findCompany(v, orgnr); if (f) return f }
  return null
}

// FALLBACK-PROVIDER (best-effort): hämtar allabolag.se:s publika sida och läser företagsobjektet
// ur __NEXT_DATA__. Används endast när det officiella UC-API:t inte är konfigurerat. Kan blockeras
// av allabolag.se:s bot-skydd och bryta mot deras villkor – föredra det officiella API:t i drift.
function allabolagScrapeProvider() {
  return {
    name: 'Allabolag',
    configured: true,
    async getCompany(orgnr10: string) {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'sv-SE,sv;q=0.9',
      }
      let html = ''
      for (const u of [`https://www.allabolag.se/${orgnr10}`, `https://www.allabolag.se/what/${orgnr10}`, `https://www.allabolag.se/${orgnr10}/`]) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
        try { const r = await fetch(u, { headers, redirect: 'follow', signal: ctrl.signal }); if (r.ok) { const t = await r.text(); if (t.length > 5000) { html = t; break } } }
        catch { /* nästa url */ } finally { clearTimeout(timer) }
      }
      if (!html) { const e = new Error('temporary'); (e as any).code = 'temporary'; throw e }
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
      if (!nd) { const e = new Error('not_found'); (e as any).code = 'not_found'; throw e }
      let data: unknown
      try { data = JSON.parse(nd[1]) } catch { const e = new Error('not_found'); (e as any).code = 'not_found'; throw e }
      const found = findCompany(data, orgnr10)
      if (!found) { const e = new Error('not_found'); (e as any).code = 'not_found'; throw e }
      return { company: normalizeAllabolag(found), apiVersion: 'scrape' }
    },
  }
}

const MSG: Record<string, string> = {
  invalid_orgnr: 'Organisationsnumret är inte giltigt. Kontrollera numret och försök igen.',
  not_found: 'Inget företag hittades med detta organisationsnummer.',
  not_configured: 'Anslutningen till Allabolag är inte konfigurerad. Kontrollera API-inställningarna.',
  rate_limited: 'För många sökningar just nu. Vänta en stund innan du försöker igen.',
  temporary: 'Företagsuppgifterna kunde inte hämtas just nu. Du kan fylla i uppgifterna manuellt.',
  unauthorized: 'Sessionen har gått ut. Logga in igen.',
}
const httpFor = (code: string) =>
  code === 'unauthorized' ? 401 : code === 'not_found' ? 404 : code === 'rate_limited' ? 429 : code === 'temporary' ? 502 : 400

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const env = Deno.env.toObject()
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  try {
    // Auth: kräver en inloggad användare (rate limit keyas på user_id).
    const authHeader = req.headers.get('Authorization') || ''
    const { data: u } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    const userId = u?.user?.id
    if (!userId) { const e = new Error('unauthorized'); (e as any).code = 'unauthorized'; throw e }

    const { org_nr, force } = await req.json().catch(() => ({}))
    const orgnr10 = normalizeOrgNr(s(org_nr))
    if (!luhnValid(orgnr10)) { const e = new Error('invalid_orgnr'); (e as any).code = 'invalid_orgnr'; throw e }

    // Rate limit (glidande fönster per användare).
    const { data: rate } = await admin.from('company_lookup_rate').select('*').eq('user_id', userId).maybeSingle()
    const now = Date.now()
    if (rate && now - new Date(rate.window_start).getTime() < RATE_WINDOW_MS) {
      if (rate.count >= RATE_MAX) { const e = new Error('rate_limited'); (e as any).code = 'rate_limited'; throw e }
      await admin.from('company_lookup_rate').update({ count: rate.count + 1 }).eq('user_id', userId)
    } else {
      await admin.from('company_lookup_rate').upsert({ user_id: userId, window_start: new Date(now).toISOString(), count: 1 })
    }

    // Cache (24h) – kringgås av force.
    if (!force) {
      const { data: cached } = await admin.from('company_lookup_cache').select('*').eq('org_nr', orgnr10).maybeSingle()
      if (cached && now - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
        const company = cached.payload
        return json({ ok: true, company, result: toFlatResult(company), apiVersion: cached.api_version, cached: true })
      }
    }

    // Providerordning: officiellt UC-API → apiverket.se (officiell Bolagsverket/SCB-data, gratis
    // nyckel) → best-effort scraping av allabolag.se (sista utväg).
    const official = allabolagProvider(env)
    const apiverket = apiverketProvider(env)
    const provider = official.configured ? official : apiverket.configured ? apiverket : allabolagScrapeProvider()
    const { company, apiVersion } = await provider.getCompany(orgnr10)
    company.sourceRetrievedAt = new Date(now).toISOString()
    company.source = provider.name

    await admin.from('company_lookup_cache').upsert({
      org_nr: orgnr10, payload: company, api_version: apiVersion, source: provider.name, fetched_at: new Date(now).toISOString(),
    })
    return json({ ok: true, company, result: toFlatResult(company), apiVersion, cached: false })
  } catch (err) {
    const code = (err as any)?.code || 'temporary'
    // Logga teknisk kod – ALDRIG secrets/auth-token/rå svarskropp.
    console.error('hamta-foretag', code)
    return json({ error: MSG[code] || MSG.temporary, code }, httpFor(code))
  }
})
