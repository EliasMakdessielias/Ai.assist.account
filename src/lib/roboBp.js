// ROBO-bp – BokPilots kontrollerade AI-bokföringsassistent.
// DENNA FIL = det delade AI-KONTRAKTET (klient + edge): schema, validering och hallucinationsspärr.
// ROBO-bp bokför/ändrar/godkänner ALDRIG något automatiskt. Den föreslår, analyserar och riskmarkerar;
// användaren måste granska och godkänna. All permanent inlärning kräver behörig användares bekräftelse.

export const FEATURE_KEY = 'robo_bp'

// ── Konstanter (enum-värden som AI-svaret valideras mot) ──
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical']
export const RISK_META = {
  low: { label: 'Låg', color: '#6b7280', order: 1 },
  medium: { label: 'Medel', color: '#2563eb', order: 2 },
  high: { label: 'Hög', color: '#f97316', order: 3 },
  critical: { label: 'Kritisk', color: '#dc2626', order: 4 },
}
export const BASIS_TYPES = ['company_data', 'rule_source', 'ai_inference']
export const BASIS_META = {
  company_data: { label: 'Företagets data', desc: 'Bygger på verifierad systemdata i BokPilot.' },
  rule_source: { label: 'Regelkälla', desc: 'Bygger på en angiven svensk regelkälla.' },
  ai_inference: { label: 'AI-bedömning', desc: 'AI-tolkning – kräver mänsklig granskning.' },
}
export const SOURCE_TYPES = ['bfn', 'skatteverket', 'bas', 'internal', 'company_document']
export const ACTION_TYPES = ['open_object', 'create_check', 'suggest_accounting', 'explain_rule']
// Steg 2A: ROBO-bp får analysera/förklara men INTE föreslå kontering. suggest_accounting blockeras.
export const STEP2A_ACTIONS = ['open_object', 'explain_rule', 'create_check']
export const OBJECT_TYPES = ['verification', 'invoice', 'account', 'document', 'supplier', 'customer']

// Vyer som ROBO-bp kan öppnas kontextuellt från (point 2).
export const ROBO_VIEWS = [
  'bokforing', 'leverantorsfakturor', 'kundfakturor', 'kassa_bank', 'moms',
  'manadskontroll', 'ai_bokslut', 'inkorg', 'dokument', 'oversikt',
]

// JSON-schema som skickas till AI-modellen (Gemini responseSchema). Strikt → modellen tvingas svara i form.
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    risk_level: { type: 'string', enum: RISK_LEVELS },
    basis: { type: 'array', items: { type: 'string', enum: BASIS_TYPES } },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, url: { type: 'string' }, type: { type: 'string', enum: SOURCE_TYPES } },
        required: ['title', 'type'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          risk_level: { type: 'string', enum: RISK_LEVELS },
          affected_objects: {
            type: 'array',
            items: { type: 'object', properties: { type: { type: 'string', enum: OBJECT_TYPES }, id: { type: 'string' } }, required: ['type', 'id'] },
          },
          recommended_action: { type: 'string' },
          requires_human_review: { type: 'boolean' },
        },
        required: ['title', 'description', 'risk_level', 'recommended_action'],
      },
    },
    proposed_actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { type: { type: 'string', enum: ACTION_TYPES }, label: { type: 'string' }, payload: { type: 'object' } },
        required: ['type', 'label'],
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'risk_level', 'basis'],
}

const isStr = v => typeof v === 'string'
const clamp01 = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
const asArr = v => (Array.isArray(v) ? v : [])

// Tomt, säkert svar (används vid parse-fel så UI alltid har en giltig form att visa).
export function emptyResponse(answer = 'Jag kunde inte ta fram ett säkert svar just nu.') {
  return { answer, confidence: 0, risk_level: 'low', basis: ['ai_inference'], sources: [], findings: [], proposed_actions: [], limitations: ['Inget giltigt AI-svar kunde valideras.'] }
}

/**
 * Validerar + SANERAR ett AI-svar mot kontraktet och blockerar hallucinationer.
 * allowed.accounts  = Set/array av kontonummer som FAKTISKT finns i kontexten (serverhämtade).
 * allowed.objects   = { verification:Set, invoice:Set, document:Set, supplier:Set, customer:Set } – id:n som finns.
 * Returnerar { ok, errors, value } där value ALLTID är ett giltigt, sanerat svar (hallucinerade
 * konton/objekt-id:n bortfiltrerade) och requires_human_review tvingas true på alla findings.
 */
export function validateRoboBpResponse(raw, allowed = {}, opts = {}) {
  const errors = []
  const allowedActions = Array.isArray(opts.allowedActions) ? opts.allowedActions : ACTION_TYPES
  const accounts = toSet(allowed.accounts)
  const objects = allowed.objects || {}
  let obj = raw
  if (isStr(raw)) { try { obj = JSON.parse(raw) } catch { errors.push('parse_failed'); return { ok: false, errors, value: emptyResponse() } } }
  if (!obj || typeof obj !== 'object') { errors.push('not_object'); return { ok: false, errors, value: emptyResponse() } }

  if (!isStr(obj.answer) || !obj.answer.trim()) errors.push('answer_missing')
  if (!RISK_LEVELS.includes(obj.risk_level)) errors.push('risk_level_invalid')

  const basis = asArr(obj.basis).filter(b => BASIS_TYPES.includes(b))
  if (basis.length === 0) errors.push('basis_missing')

  const sources = asArr(obj.sources)
    .filter(s => s && isStr(s.title) && SOURCE_TYPES.includes(s.type))
    .map(s => ({ title: s.title, type: s.type, ...(isStr(s.url) && s.url ? { url: s.url } : {}) }))

  // Findings: filtrera bort hallucinerade affected_objects (id finns ej i serverhämtad kontext).
  const findings = asArr(obj.findings).filter(f => f && isStr(f.title) && isStr(f.description)).map(f => {
    const objs = asArr(f.affected_objects).filter(o => o && OBJECT_TYPES.includes(o.type) && isStr(o.id))
    const kept = []
    for (const o of objs) {
      const known = o.type === 'account' ? accounts.has(String(o.id)) : toSet(objects[o.type]).has(String(o.id))
      if (known) kept.push({ type: o.type, id: String(o.id) })
      else errors.push(`hallucinated_object:${o.type}:${o.id}`)
    }
    return {
      title: f.title, description: f.description,
      risk_level: RISK_LEVELS.includes(f.risk_level) ? f.risk_level : 'medium',
      affected_objects: kept,
      recommended_action: isStr(f.recommended_action) ? f.recommended_action : '',
      requires_human_review: true,                              // ALLTID true – ROBO-bp utför aldrig själv
    }
  })

  // Proposed actions: blockera otillåtna åtgärdstyper (t.ex. suggest_accounting i Steg 2A) + påhittade konton.
  asArr(obj.proposed_actions).forEach(a => { if (a && ACTION_TYPES.includes(a.type) && !allowedActions.includes(a.type)) errors.push(`blocked_action:${a.type}`) })
  const proposed = asArr(obj.proposed_actions).filter(a => a && allowedActions.includes(a.type) && isStr(a.label)).map(a => {
    const payload = (a.payload && typeof a.payload === 'object') ? a.payload : {}
    if (a.type === 'suggest_accounting' && payload.account != null && !accounts.has(String(payload.account))) {
      errors.push(`hallucinated_account:${payload.account}`)
      return null                                               // släng konteringsförslag mot okänt konto
    }
    if (a.type === 'open_object' && payload.id != null && payload.type) {
      const set = payload.type === 'account' ? accounts : toSet(objects[payload.type])
      if (!set.has(String(payload.id))) { errors.push(`hallucinated_open:${payload.type}:${payload.id}`); return null }
    }
    return { type: a.type, label: a.label, payload }
  }).filter(Boolean)

  const value = {
    answer: isStr(obj.answer) && obj.answer.trim() ? obj.answer.trim() : emptyResponse().answer,
    confidence: clamp01(obj.confidence),
    risk_level: RISK_LEVELS.includes(obj.risk_level) ? obj.risk_level : 'low',
    basis: basis.length ? basis : ['ai_inference'],
    sources, findings, proposed_actions: proposed,
    limitations: asArr(obj.limitations).filter(isStr),
  }
  // ok = strukturen höll OCH inga hallucinationer upptäcktes.
  const ok = !errors.some(e => e === 'answer_missing' || e === 'risk_level_invalid' || e === 'basis_missing' || e === 'parse_failed' || e === 'not_object' || e.startsWith('hallucinated'))
  return { ok, errors, value }
}

function toSet(v) {
  if (v instanceof Set) return v
  if (Array.isArray(v)) return new Set(v.map(String))
  return new Set()
}

// Minimal kontext-DESKRIPTOR från klienten (INGEN rådata) – edge expanderar serverside.
export function assembleContextDescriptor({ view = 'oversikt', companyId = null, fiscalYearId = null, selection = null } = {}) {
  const v = ROBO_VIEWS.includes(view) ? view : 'oversikt'
  const sel = selection && OBJECT_TYPES.includes(selection.type) && selection.id != null
    ? { type: selection.type, id: String(selection.id) } : null
  return { view: v, companyId: companyId || null, fiscalYearId: fiscalYearId || null, selection: sel }
}

// Människovänlig kontextetikett ("Analyserar leverantörsfaktura", point 8).
const VIEW_LABEL = {
  bokforing: 'bokföringen', leverantorsfakturor: 'leverantörsfakturor', kundfakturor: 'kundfakturor',
  kassa_bank: 'kassa och bank', moms: 'momsrapporten', manadskontroll: 'månadskontrollen',
  ai_bokslut: 'bokslutet', inkorg: 'inkorgen', dokument: 'dokumentet', oversikt: 'översikten',
}
const OBJ_LABEL = { verification: 'verifikation', invoice: 'faktura', account: 'konto', document: 'dokument', supplier: 'leverantör', customer: 'kund' }
export function contextLabel(descriptor) {
  if (!descriptor) return 'Analyserar'
  if (descriptor.selection) return `Analyserar ${OBJ_LABEL[descriptor.selection.type] || 'objekt'}`
  return `Analyserar ${VIEW_LABEL[descriptor.view] || 'översikten'}`
}

// ── Deterministiska kontroller FÖRE AI (point 12). Rena funktioner, enhetstestade. ──
// Debet = Kredit. rows: [{ debet, kredit }]. Returnerar { balanced, differens }.
export function checkDebetKredit(rows) {
  const sum = asArr(rows).reduce((a, r) => ({ d: a.d + (Number(r.debet) || 0), k: a.k + (Number(r.kredit) || 0) }), { d: 0, k: 0 })
  const differens = Math.round((sum.d - sum.k) * 100) / 100
  return { balanced: differens === 0, differens, debet: sum.d, kredit: sum.k }
}
// Momsrimlighet: moms ≈ netto * sats (±toleransKr). sats t.ex. 0.25/0.12/0.06.
export function checkMomsRimlighet({ netto, moms, sats, toleransKr = 1 }) {
  const f = Number(netto) || 0, m = Number(moms) || 0, s = Number(sats) || 0
  const forvantat = Math.round(f * s * 100) / 100
  const diff = Math.round((m - forvantat) * 100) / 100
  return { rimlig: Math.abs(diff) <= toleransKr, forvantat, differens: diff }
}
// Faktura: total = netto + moms (±toleransKr).
export function checkFakturaTotal({ netto, moms, total, toleransKr = 1 }) {
  const summa = Math.round(((Number(netto) || 0) + (Number(moms) || 0)) * 100) / 100
  const diff = Math.round((summa - (Number(total) || 0)) * 100) / 100
  return { stammer: Math.abs(diff) <= toleransKr, summa, differens: diff }
}

// ── Steg 2B: deterministiska OBSERVATIONER (INTE bokföringsförslag) ur serverhämtad summary. ──
// Endast counts + generisk text – inga namn, inga personuppgifter, inga rådata.
export const OBSERVATION_STATUS_THRESHOLD = 5
const obsN = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
export function computeObservations(summary = {}) {
  const s = summary || {}
  const o = []
  const add = (code, severity, text, count) => o.push({ code, severity, text, count: obsN(count) })
  if (s.hasFiscalYear === false) add('no_fiscal_year', 'medium', 'Inget räkenskapsår valt – siffrorna kan avse all historik.', 0)
  if (obsN(s.missingVerDesc) > 0) add('missing_ver_desc', 'low', `${obsN(s.missingVerDesc)} verifikation(er) saknar beskrivning.`, s.missingVerDesc)
  if (obsN(s.unbalancedVer) > 0) add('unbalanced_ver', 'high', `${obsN(s.unbalancedVer)} verifikation(er) verkar obalanserade (debet ≠ kredit).`, s.unbalancedVer)
  if (obsN(s.supplierNoName) > 0) add('supplier_no_name', 'low', `${obsN(s.supplierNoName)} leverantörsfaktura(or) saknar leverantörsnamn.`, s.supplierNoName)
  if (obsN(s.supOverdue) > 0) add('supplier_overdue', 'medium', `${obsN(s.supOverdue)} förfallen(na) leverantörsfaktura(or).`, s.supOverdue)
  if (obsN(s.custOverdue) > 0) add('customer_overdue', 'medium', `${obsN(s.custOverdue)} förfallen(na) kundfaktura(or).`, s.custOverdue)
  if (obsN(s.itemsWithoutStatus) >= OBSERVATION_STATUS_THRESHOLD) add('many_without_status', 'low', `Ovanligt många poster (${obsN(s.itemsWithoutStatus)}) saknar status.`, s.itemsWithoutStatus)
  return o
}
// Minimal sammanställning för audit (endast koder + total, ingen rådata).
export function observationCounts(observations = []) {
  return { total: (observations || []).length, codes: (observations || []).map(o => o.code) }
}

// ── Steg 2G: transparens – "Underlag för svaret". Endast antal/koder, aldrig rå data. ──
export const BASIS_LABEL = {
  company_data: 'Systemdata (BokPilot)',
  rule_source: 'Regelkälla',
  ai_inference: 'AI-bedömning',
}
export const CONTEXT_COUNT_LABEL = {
  accounts: 'konton',
  verifications: 'verifikationer',
  supplierInvoices: 'leverantörsfakturor',
  customerInvoices: 'kundfakturor',
}
export const SAFETY_PHRASES = [
  'Detta är ett granskningsstöd, inte bokföring.',
  'ROBO-bp ändrar inte bokföringsdata.',
  'Kontrollera alltid innan åtgärd.',
]
// Härleder en begriplig underlagssammanfattning ur AI-svaret + serverns meta (rena antal/koder).
export function summarizeBasis(response = {}, meta = {}) {
  const basis = Array.isArray(response?.basis) ? response.basis.filter(b => BASIS_TYPES.includes(b)) : []
  const sources = Array.isArray(response?.sources) ? response.sources : []
  const hasAiInference = basis.includes('ai_inference')
  const hasCompanyData = basis.includes('company_data')
  const contextCounts = (meta && typeof meta.contextCounts === 'object' && meta.contextCounts) || {}
  const observationCounts = (meta && typeof meta.observationCounts === 'object' && meta.observationCounts) || { total: 0, codes: [] }
  return {
    basis,
    basisLabels: basis.map(b => BASIS_LABEL[b] || b),
    sources,
    hasCompanyData,
    hasRuleSource: basis.includes('rule_source') || sources.length > 0,
    hasAiInference,
    // AI-bedömning utan extern regelkälla → måste granskas av människa.
    aiWithoutSource: hasAiInference && sources.length === 0 && !basis.includes('rule_source'),
    requiresHumanReview: true,                          // ROBO-bp tvingar alltid mänsklig granskning
    contextCounts,
    contextCountEntries: Object.entries(contextCounts).filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => ({ key: k, label: CONTEXT_COUNT_LABEL[k] || k, count: Number(v) })),
    observationCounts,
    usedSystemCheck: Number(observationCounts.total) > 0,
    view: meta?.view || response?.view || null,
  }
}

// ── Steg 2H: confidence/beslutsnivå. SYSTEMET (inte AI) beräknar slutlig label från basis/sources/observations/risk. ──
export const CONFIDENCE_META = {
  strong_plus: { label: 'Mycket stark grund', color: '#16a34a', order: 4 },
  strong: { label: 'Stark grund', color: '#16a34a', order: 3 },
  medium: { label: 'Medel', color: '#f97316', order: 2 },
  weak: { label: 'Svag', color: '#dc2626', order: 1 },
}
export const DECISION_LEVEL_META = {
  system_check: { label: 'Systemkontroll', color: '#2563eb' },
  data_analysis: { label: 'Databaserad analys', color: '#2563eb' },
  ai_judgment: { label: 'AI-bedömning', color: '#f97316' },
  manual_review: { label: 'Kräver manuell granskning', color: '#dc2626' },
}
export const DECISION_BASIS = { SYSTEM_OBSERVATION: 'system_observation', AI_FINDING: 'ai_finding' }

// Beräknar confidence-label + beslutsnivå ur summarizeBasis-utdata. AI:s confidence visas separat (score), inte som label.
export function computeConfidence(summary = {}, response = {}) {
  const hasCompanyData = !!summary.hasCompanyData
  const hasRuleSource = !!summary.hasRuleSource
  const usedSystemCheck = !!summary.usedSystemCheck
  const hasAiInference = !!summary.hasAiInference
  const hasSources = Array.isArray(summary.sources) && summary.sources.length > 0
  const aiWithoutSource = !!summary.aiWithoutSource
  let label
  if ((hasRuleSource && hasCompanyData) || (usedSystemCheck && !hasAiInference)) label = 'strong_plus'  // regelkälla+data ELLER ren systemkontroll
  else if (hasCompanyData && usedSystemCheck) label = 'strong'                                          // data + tydliga observations
  else if (hasCompanyData && hasAiInference) label = 'medium'                                           // data + AI
  else if (hasAiInference && !hasSources && !usedSystemCheck) label = 'weak'                            // AI utan källa/observation
  else if (hasCompanyData) label = 'medium'
  else label = 'weak'
  let decisionLevel
  if (usedSystemCheck && !hasAiInference) decisionLevel = 'system_check'      // ren deterministisk kontroll
  else if (hasCompanyData) decisionLevel = 'data_analysis'                    // grundad i bolagsdata
  else if (hasAiInference) decisionLevel = 'ai_judgment'                      // AI utan dataförankring
  else decisionLevel = 'manual_review'
  if (label === 'weak') decisionLevel = 'manual_review'                       // svagaste grund → kräver manuell granskning
  void aiWithoutSource
  const score = (typeof response?.confidence === 'number' && response.confidence >= 0 && response.confidence <= 1) ? response.confidence : null
  return {
    label, labelText: CONFIDENCE_META[label].label,
    decisionLevel, decisionText: DECISION_LEVEL_META[decisionLevel].label,
    score, requiresManualReview: decisionLevel === 'manual_review',
  }
}

// ── Steg 2J: deterministisk safe-intent guard. Blockerar begäran om att utföra åtgärder ROBO-bp aldrig gör. ──
export const BLOCKED_INTENT_MESSAGE = 'ROBO-bp kan inte utföra detta automatiskt. Jag kan hjälpa dig att granska underlaget eller skapa en kontrollpunkt.'
export const FORBIDDEN_INTENT_CATEGORIES = ['bokfor', 'skapa_verifikation', 'andra_verifikation', 'radera_verifikation', 'andra_faktura', 'godkann_faktura', 'las_upp_period', 'lamna_in', 'betala', 'skicka_myndighet']

// Höger-gräns som funkar för svenska vokaler (JS \b bryts av å/ä/ö). Indata gemenas före match.
const RB = '(?![a-zåäö0-9])'
const rx = (s) => new RegExp(s, 'i')
// Förklarande frågor (hur/förklara/vad är …) tillåts – de besvaras som explain_rule, inte som åtgärd.
const INTENT_EXPLAIN = /(^|\s)(hur|varför)\b|förklar|vad (är|betyder|innebär)|vilka regler|how (do|can|should)|what (is|does)|\bexplain\b/i
// Ordning: specifika regler före generella (radera/skapa före bokför).
const INTENT_RULES = [
  ['radera_verifikation', rx(`(radera|raderar|ta bort|tar bort|makulera|makulerar)${RB}[^?.!]*(verifikation|faktura|bokföring)|delete${RB}`)],
  ['skapa_verifikation', rx(`(skapa|skapar|registrera|registrerar|lägg upp|lägga upp|ny|nya)${RB}[^?.!]*verifikation|create${RB}[^?.!]*journal`)],
  ['andra_verifikation', rx(`(ändra|ändrar|redigera|redigerar|justera|justerar|uppdatera|korrigera)${RB}[^?.!]*verifikation`)],
  ['andra_faktura', rx(`(ändra|ändrar|redigera|redigerar|justera|justerar|korrigera)${RB}[^?.!]*faktura`)],
  ['godkann_faktura', rx(`(godkänn|godkänna|godkänner|attestera|attesterar)${RB}[^?.!]*faktura|approve${RB}`)],
  ['las_upp_period', rx(`lås\\s*upp${RB}|låsa upp|öppna[^?.!]*låst[^?.!]*period|unlock${RB}`)],
  ['lamna_in', rx(`(lämna in|lämnar in|skicka in|skickar in|deklarera|deklarerar)[^?.!]*(moms|momsrapport|deklaration|årsredovisning|skatt)|submit${RB}`)],
  ['skicka_myndighet', rx(`skicka${RB}[^?.!]*(skatteverket|bolagsverket|myndighet)`)],
  ['betala', rx(`(betala|betalar|betalning)${RB}[^?.!]*faktura|betala fakturan?${RB}|pay${RB}[^?.!]*invoice`)],
  ['bokfor', rx(`(bokför|bokföra|bokförs|boka|bokar)${RB}|kontera${RB}[^?.!]*(automatiskt|åt|detta|den)|post${RB}[^?.!]*(this|the|it|detta)`)],
]
export function detectForbiddenIntent(question) {
  const q = String(question || '').toLowerCase().trim()
  if (!q) return { blocked: false, category: null }
  if (INTENT_EXPLAIN.test(q)) return { blocked: false, category: null }
  for (const [category, re] of INTENT_RULES) if (re.test(q)) return { blocked: true, category }
  return { blocked: false, category: null }
}

// ── Steg 2E: minimalt statusflöde för ROBO-bp-kontrollpunkter (rör ALDRIG bokföring). ──
export const CHECK_STATUSES = ['open', 'in_progress', 'done', 'dismissed']
export const CHECK_STATUS_META = {
  open: { label: 'Öppen', color: '#2563eb', order: 0 },
  in_progress: { label: 'Påbörjad', color: '#f97316', order: 1 },
  done: { label: 'Klar', color: '#16a34a', order: 2 },
  dismissed: { label: 'Avfärdad', color: '#6b7280', order: 3 },
}
// Tillgängliga statusåtgärder per nuvarande status (minimalt flöde).
export function checkActions(status) {
  if (status === 'open') return [{ to: 'in_progress', label: 'Påbörja' }, { to: 'dismissed', label: 'Avfärda' }]
  if (status === 'in_progress') return [{ to: 'done', label: 'Klar' }, { to: 'dismissed', label: 'Avfärda' }]
  return []                                                // done/dismissed: inga vidare åtgärder
}
// Öppna/påbörjade först, sedan klara/avfärdade; inom grupp nyast först.
export function sortChecks(checks) {
  return [...(checks || [])].sort((a, b) =>
    (CHECK_STATUS_META[a.status]?.order ?? 9) - (CHECK_STATUS_META[b.status]?.order ?? 9)
    || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

// ── Steg 2C: kontrollpunkt (create_check) från en finding ELLER observation. Skapar ALDRIG bokföring. ──
// Ett objekt går att följa upp om det har en titel (finding) eller text (observation).
export function canFollowUp(item) {
  if (!item) return false
  const t = item.title || item.text
  return typeof t === 'string' && t.trim().length > 0
}
// Bygger RPC-parametrarna för robo_bp_create_check. Returnerar null om objektet inte går att följa upp.
export function buildCheckPayload(item, ctx = {}) {
  if (!canFollowUp(item)) return null
  const title = String(item.title || item.text).trim().slice(0, 200)
  const risk = RISK_LEVELS.includes(item.risk_level) ? item.risk_level
    : (RISK_LEVELS.includes(item.severity) ? item.severity : 'medium')
  // Observation (har code, ingen title) → tydlig härkomst i beskrivningen.
  const isObservation = !!item.code && !item.title
  const description = item.description
    ? String(item.description)
    : isObservation
      ? `Deterministisk systemkontroll från ROBO-bp (${item.code}). ${item.text || ''}`.trim()
      : String(item.text || title)
  return {
    p_company: ctx.companyId || null,
    p_view: ctx.view || 'oversikt',
    p_fiscal_year_id: ctx.fiscalYearId || null,
    p_title: title,
    p_description: description.trim().slice(0, 2000),
    p_risk_level: risk,
    p_affected_objects: Array.isArray(item.affected_objects) ? item.affected_objects : [],
    p_conversation_id: ctx.conversationId || null,
    // Steg 2H: beslutsgrund (observation → system_observation, finding → ai_finding) + ev. systemberäknad confidence.
    p_decision_basis: isObservation ? 'system_observation' : 'ai_finding',
    p_confidence_label: ctx.confidenceLabel || null,
  }
}
