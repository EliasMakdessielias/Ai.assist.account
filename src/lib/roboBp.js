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
