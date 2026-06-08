// OCR-provider-arkitektur för BokPilot.
//
// [OCR_PROVIDER_ARCHITECTURE]
// Modulär provider-modell: en PRIMARY (Gemini, befintligt `tolka-underlag`-flöde) och en valfri
// SECONDARY/experimentell (Folio-OCR via adapter). Folio är ALDRIG default i produktion – det aktiveras
// med feature flags och körs som en isolerad, separat tjänst (FOLIO_OCR_BASE_URL). Befintligt OCR-flöde
// (`src/lib/tolka.js` → edge `tolka-underlag`) lämnas helt orört; denna fil äger INGEN bokföringslogik.
//
// Provider-interface (konceptuellt, en adapter implementerar):
//   { providerName, isAvailable(), extractText(file), extractLayout(file)?, classifyDocument(input)?,
//     healthCheck(), timeoutMs }
// extract* returnerar det normaliserade OCR-resultatformatet nedan.

export const OCR_PROVIDERS = { GEMINI: 'gemini', FOLIO: 'folio_ocr' }

// [Normaliserat OCR-resultatformat] (krav 10). Alla providers normaliseras till detta.
export function emptyOcrResult(providerName = 'unknown') {
  return { providerName, rawText: '', pages: [], layoutBlocks: [], confidence: null, processingTimeMs: null, errors: [], fallbackUsed: false }
}

export function normalizeOcrResult(raw, { providerName, processingTimeMs = null } = {}) {
  const r = raw || {}
  const pages = Array.isArray(r.pages) ? r.pages : []
  const normPages = pages.map((p, i) => ({ page: p?.page ?? i + 1, text: typeof p?.text === 'string' ? p.text : '', blocks: Array.isArray(p?.blocks) ? p.blocks : [] }))
  const layoutBlocks = Array.isArray(r.layoutBlocks) ? r.layoutBlocks
    : Array.isArray(r.blocks) ? r.blocks
    : normPages.flatMap(p => p.blocks)
  const rawText = typeof r.rawText === 'string' ? r.rawText
    : typeof r.text === 'string' ? r.text
    : normPages.map(p => p.text).filter(Boolean).join('\n\n')
  return {
    providerName: providerName || r.providerName || 'unknown',
    rawText,
    pages: normPages,
    layoutBlocks,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
    processingTimeMs: processingTimeMs ?? (typeof r.processingTimeMs === 'number' ? r.processingTimeMs : null),
    errors: Array.isArray(r.errors) ? r.errors : [],
    fallbackUsed: !!r.fallbackUsed,
  }
}

// Folio-OCR-svar -> normaliserat. Folio levererar { text, pages:[{page,text,blocks}], confidence }.
export function normalizeFolioResult(folio, meta = {}) {
  return normalizeOcrResult(
    { text: folio?.text, pages: folio?.pages, blocks: folio?.blocks, confidence: folio?.confidence, errors: folio?.errors },
    { providerName: OCR_PROVIDERS.FOLIO, processingTimeMs: meta.processingTimeMs },
  )
}

// [Feature flags] (krav 4). Läser ett env-likt objekt; default-säkert (Folio AV, fallback PÅ).
export function ocrConfig(env = {}) {
  const truthy = v => v === true || v === 'true' || v === '1'
  return {
    primary: env.OCR_PROVIDER_PRIMARY || OCR_PROVIDERS.GEMINI,
    secondary: env.OCR_PROVIDER_SECONDARY || OCR_PROVIDERS.FOLIO,
    folioEnabled: truthy(env.ENABLE_FOLIO_OCR),                                   // default false
    fallbackEnabled: env.ENABLE_OCR_FALLBACK === undefined ? true : truthy(env.ENABLE_OCR_FALLBACK), // default true
  }
}

// Resolverar körplan: secondary används endast om Folio aktiverat + secondary=folio_ocr.
export function resolveOcrPlan(config) {
  const useSecondary = !!config.folioEnabled && config.secondary === OCR_PROVIDERS.FOLIO
  return { primary: config.primary, secondary: useSecondary ? config.secondary : null, fallback: !!config.fallbackEnabled }
}

// [OCR_FALLBACK] Orkestrering (krav 5): försök secondary (experimentell) först om aktiv,
// fall tillbaka till primary om den misslyckas och fallback är på. Utan secondary körs bara primary.
// `providers` = { [name]: async () => normaliserat resultat }. Skapar ALDRIG trasiga poster –
// vid total miss returneras { failed:true, errors:[...] } så anroparen kan avstå.
export async function runOcrWithFallback({ plan, providers }) {
  const order = plan.secondary
    ? [plan.secondary, plan.fallback ? plan.primary : null].filter(Boolean)
    : [plan.primary]
  const errors = []
  for (let i = 0; i < order.length; i++) {
    const name = order[i]
    const fn = providers?.[name]
    if (typeof fn !== 'function') { errors.push({ provider: name, error: 'provider_unavailable' }); continue }
    try {
      const res = await fn()
      return { ...res, providerName: res?.providerName || name, fallbackUsed: i > 0, errors: [...errors, ...((res && res.errors) || [])] }
    } catch (e) {
      errors.push({ provider: name, error: String(e?.message || e) })
    }
  }
  return { ...emptyOcrResult(plan.secondary || plan.primary), errors, failed: true }
}
