// Edge Function: hamta-foretag
// Hämtar svenska företagsuppgifter via OFFICIELLT API (UC Affärsinformation / Allabolag).
// Skrapar ALDRIG allabolag.se:s HTML. Secrets bor enbart här (server-side). Returnerar en
// normaliserad intern företagsmodell + en platt `result` (bakåtkompatibel med LeverantorEditor).
//
// Provider-interface (CompanyInformationProvider) => byt/komplettera datakälla utan att
// frontend behöver byggas om. AllabolagCompanyProvider är default; BolagsverketCompanyProvider
// är en framtida fallback. Den faktiska HTTP-mappningen (endpoint/auth/fältsökvägar) drivs av
// miljövariabler och är samlad i adapter-funktionerna nedan – anpassa efter UC:s API-dokumentation.
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

  c.organizationNumber = normalizeOrgNr(s(pick(o, ['organizationNumber', 'orgNumber', 'organisationNumber', 'orgnr'])))
  c.legalName = s(pick(o, ['legalName', 'name', 'companyName']))
  c.displayName = s(pick(o, ['displayName', 'tradeName', 'specialName'])) || c.legalName
  c.companyForm = s(pick(o, ['companyForm', 'legalForm', 'companyType']))
  c.status = s(pick(o, ['status', 'companyStatus']))
  c.registrationDate = (pick(o, ['registrationDate', 'registeredDate']) as string) ?? null
  c.businessDescription = s(pick(o, ['businessDescription', 'description', 'sniDescription']))
  c.employeeCount = (pick(o, ['employeeCount', 'employees', 'numberOfEmployees']) as number) ?? null
  c.shareCapital = (pick(o, ['shareCapital', 'capital']) as number) ?? null

  c.address = {
    careOf: s(pick(addr, ['careOf', 'co'])), street: s(pick(addr, ['street', 'addressLine', 'streetAddress'])),
    postalCode: s(pick(addr, ['postalCode', 'zipCode', 'zip'])).replace(/\s/g, ''),
    city: s(pick(addr, ['city', 'postPlace', 'town'])), municipality: s(pick(addr, ['municipality', 'kommun'])),
    county: s(pick(addr, ['county', 'lan'])), country: s(pick(addr, ['country'])) || 'Sverige',
  }
  c.postalAddress = {
    careOf: s(pick(post, ['careOf', 'co'])), street: s(pick(post, ['street', 'addressLine', 'boxAddressLine'])),
    postalCode: s(pick(post, ['postalCode', 'zipCode', 'zip'])).replace(/\s/g, ''),
    city: s(pick(post, ['city', 'postPlace', 'town'])), country: s(pick(post, ['country'])) || 'Sverige',
  }
  c.contact = {
    phone: s(pick(o, ['phone', 'phoneNumber', 'telephone'])).replace(/\s/g, ''),
    mobile: s(pick(o, ['mobile', 'mobilePhone', 'cellPhone'])).replace(/\s/g, ''),
    email: s(pick(o, ['email', 'emailAddress'])), website: s(pick(o, ['website', 'homepage', 'web'])),
  }
  const num = pick(o, ['vatNumber', 'vatNo']) ?? (tax.vatNumber as string)
  c.taxRegistration = {
    fTax: (pick(o, ['fTax', 'fskatt']) ?? tax.fTax ?? null) as boolean | null,
    vatRegistered: (pick(o, ['vatRegistered', 'momsregistrerad']) ?? tax.vatRegistered ?? null) as boolean | null,
    employerRegistered: (pick(o, ['employerRegistered', 'arbetsgivarregistrerad']) ?? tax.employerRegistered ?? null) as boolean | null,
    vatNumber: s(num),
  }
  c.industries = (o.industries ?? o.sniCodes ?? []) as unknown[]
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

    const provider = allabolagProvider(env)
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
