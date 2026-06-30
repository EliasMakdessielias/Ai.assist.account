// Edge Function: robo-bp-chat
// ROBO-bp – kontrollerad AI-bokföringsassistent. SERVER-SIDE AI-kontrakt:
//  1. auth (inloggad) + bolagsmedlemskap (cross-company-skydd) + licens (has_ai_feature robo_bp)
//  2. assemblerar MINIMAL kontext serverside (klienten skickar aldrig rå bokföringsdata)
//  3. strikt JSON-schema till modellen + re-validering + hallucinationsspärr (konton/objekt-id)
//  4. persisterar konversation/meddelande + audit-loggar (minimerad detalj, inga secrets/persondata)
// ROBO-bp bokför/ändrar/godkänner ALDRIG något. requires_human_review tvingas true.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const RISK = ['low', 'medium', 'high', 'critical']
const BASIS = ['company_data', 'rule_source', 'ai_inference']
const SRC = ['bfn', 'skatteverket', 'bas', 'internal', 'company_document']
const ACT = ['open_object', 'create_check', 'suggest_accounting', 'explain_rule']
const OBJ = ['verification', 'invoice', 'account', 'document', 'supplier', 'customer']
const VIEWS = ['bokforing', 'leverantorsfakturor', 'kundfakturor', 'kassa_bank', 'moms', 'manadskontroll', 'ai_bokslut', 'inkorg', 'dokument', 'oversikt']
// Steg 2A: ROBO-bp får analysera/förklara men INTE föreslå kontering. suggest_accounting blockeras.
const STEP2A_ACTIONS = ['open_object', 'explain_rule', 'create_check']

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    risk_level: { type: 'string', enum: RISK },
    basis: { type: 'array', items: { type: 'string', enum: BASIS } },
    sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, type: { type: 'string', enum: SRC } }, required: ['title', 'type'] } },
    findings: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, description: { type: 'string' }, risk_level: { type: 'string', enum: RISK },
      affected_objects: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: OBJ }, id: { type: 'string' } }, required: ['type', 'id'] } },
      recommended_action: { type: 'string' }, requires_human_review: { type: 'boolean' },
    }, required: ['title', 'description', 'risk_level', 'recommended_action'] } },
    proposed_actions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ACT }, label: { type: 'string' }, payload: { type: 'object' } }, required: ['type', 'label'] } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'risk_level', 'basis'],
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const arr = (v: unknown) => (Array.isArray(v) ? v : [])
const empty = () => ({ answer: 'Jag kunde inte ta fram ett säkert svar just nu.', confidence: 0, risk_level: 'low', basis: ['ai_inference'], sources: [], findings: [], proposed_actions: [], limitations: ['Inget giltigt AI-svar kunde valideras.'] })

// Steg 2B: deterministiska observationer ur serverhämtad summary (INTE bokföringsförslag). Endast counts + generisk text.
const OBSERVATION_STATUS_THRESHOLD = 5
function observationsFrom(s: any) {
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const o: any[] = []
  const add = (code: string, severity: string, text: string, count: number) => o.push({ code, severity, text, count: n(count) })
  if (s?.hasFiscalYear === false) add('no_fiscal_year', 'medium', 'Inget räkenskapsår valt – siffrorna kan avse all historik.', 0)
  if (n(s?.missingVerDesc) > 0) add('missing_ver_desc', 'low', `${n(s.missingVerDesc)} verifikation(er) saknar beskrivning.`, s.missingVerDesc)
  if (n(s?.unbalancedVer) > 0) add('unbalanced_ver', 'high', `${n(s.unbalancedVer)} verifikation(er) verkar obalanserade (debet ≠ kredit).`, s.unbalancedVer)
  if (n(s?.supplierNoName) > 0) add('supplier_no_name', 'low', `${n(s.supplierNoName)} leverantörsfaktura(or) saknar leverantörsnamn.`, s.supplierNoName)
  if (n(s?.supOverdue) > 0) add('supplier_overdue', 'medium', `${n(s.supOverdue)} förfallen(na) leverantörsfaktura(or).`, s.supOverdue)
  if (n(s?.custOverdue) > 0) add('customer_overdue', 'medium', `${n(s.custOverdue)} förfallen(na) kundfaktura(or).`, s.custOverdue)
  if (n(s?.itemsWithoutStatus) >= OBSERVATION_STATUS_THRESHOLD) add('many_without_status', 'low', `Ovanligt många poster (${n(s.itemsWithoutStatus)}) saknar status.`, s.itemsWithoutStatus)
  return o
}

// Server-side re-validering + hallucinationsspärr (defense-in-depth; klienten har en testad spegel i src/lib/roboBp.js).
function validate(raw: any, allowedAccounts: Set<string>, allowedObjects: Record<string, Set<string>>, allowedActions: string[] = ACT) {
  const errors: string[] = []
  let o = raw
  if (isStr(raw)) { try { o = JSON.parse(raw) } catch { return { ok: false, errors: ['parse_failed'], value: empty() } } }
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not_object'], value: empty() }
  if (!isStr(o.answer) || !o.answer.trim()) errors.push('answer_missing')
  if (!RISK.includes(o.risk_level)) errors.push('risk_level_invalid')
  const basis = arr(o.basis).filter((b: string) => BASIS.includes(b))
  if (!basis.length) errors.push('basis_missing')
  const sources = arr(o.sources).filter((s: any) => s && isStr(s.title) && SRC.includes(s.type)).map((s: any) => ({ title: s.title, type: s.type, ...(isStr(s.url) && s.url ? { url: s.url } : {}) }))
  const findings = arr(o.findings).filter((f: any) => f && isStr(f.title) && isStr(f.description)).map((f: any) => {
    const kept: any[] = []
    for (const ob of arr(f.affected_objects)) {
      if (!ob || !OBJ.includes(ob.type) || !isStr(ob.id)) continue
      const known = ob.type === 'account' ? allowedAccounts.has(String(ob.id)) : (allowedObjects[ob.type]?.has(String(ob.id)) ?? false)
      if (known) kept.push({ type: ob.type, id: String(ob.id) }); else errors.push(`hallucinated_object:${ob.type}:${ob.id}`)
    }
    return { title: f.title, description: f.description, risk_level: RISK.includes(f.risk_level) ? f.risk_level : 'medium', affected_objects: kept, recommended_action: isStr(f.recommended_action) ? f.recommended_action : '', requires_human_review: true }
  })
  arr(o.proposed_actions).forEach((a: any) => { if (a && ACT.includes(a.type) && !allowedActions.includes(a.type)) errors.push(`blocked_action:${a.type}`) })
  const proposed = arr(o.proposed_actions).filter((a: any) => a && allowedActions.includes(a.type) && isStr(a.label)).map((a: any) => {
    const payload = (a.payload && typeof a.payload === 'object') ? a.payload : {}
    if (a.type === 'suggest_accounting' && payload.account != null && !allowedAccounts.has(String(payload.account))) { errors.push(`hallucinated_account:${payload.account}`); return null }
    if (a.type === 'open_object' && payload.id != null && payload.type) {
      const set = payload.type === 'account' ? allowedAccounts : allowedObjects[payload.type]
      if (!set || !set.has(String(payload.id))) { errors.push(`hallucinated_open:${payload.type}:${payload.id}`); return null }
    }
    return { type: a.type, label: a.label, payload }
  }).filter(Boolean)
  const value = {
    answer: isStr(o.answer) && o.answer.trim() ? o.answer.trim() : empty().answer,
    confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
    risk_level: RISK.includes(o.risk_level) ? o.risk_level : 'low',
    basis: basis.length ? basis : ['ai_inference'], sources, findings, proposed_actions: proposed,
    limitations: arr(o.limitations).filter(isStr),
  }
  const ok = !errors.some(e => ['answer_missing', 'risk_level_invalid', 'basis_missing', 'parse_failed', 'not_object'].includes(e) || e.startsWith('hallucinated'))
  return { ok, errors, value }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    const SB_URL = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Ej inloggad' }, 401)

    const { company_id, descriptor, question, conversation_id } = await req.json()
    if (!company_id || !isStr(question) || !question.trim()) return json({ error: 'company_id och fråga krävs' }, 400)

    const admin = createClient(SB_URL, SRK)
    // 1. Cross-company-skydd: användaren MÅSTE vara medlem i bolaget.
    const { data: member } = await admin.from('user_companies').select('id').eq('company_id', company_id).eq('user_id', user.id).maybeSingle()
    if (!member) { await admin.from('robo_bp_audit_log').insert({ company_id, user_id: user.id, action: 'denied', detail: { reason: 'not_member' } }); return json({ error: 'forbidden' }, 403) }
    // 2. Licens (feature flag).
    const { data: licensed } = await userClient.rpc('has_ai_feature', { p_company: company_id, p_key: 'robo_bp' })
    if (!licensed) return json({ error: 'ROBO-bp ingår inte i din nuvarande plan.', code: 'no_license' }, 403)

    const view = VIEWS.includes(descriptor?.view) ? descriptor.view : 'oversikt'
    const selection = (descriptor?.selection && OBJ.includes(descriptor.selection.type) && descriptor.selection.id != null)
      ? { type: descriptor.selection.type, id: String(descriptor.selection.id) } : null

    // 3. Steg 2A: STRIKT BEGRÄNSAD kontext serverside via SECURITY DEFINER-RPC (medlemskap +
    //    minimal projektion + hårda LIMITs). Klienten skickar aldrig rådata. Inga bilagor/OCR/rader.
    const { data: comp } = await admin.from('companies').select('name, org_nr').eq('id', company_id).maybeSingle()
    const { data: ctx } = await userClient.rpc('robo_bp_context', { p_company: company_id, p_fiscal_year_id: descriptor?.fiscalYearId || null, p_view: view, p_question: question })
    const ctxData: any = ctx || {}
    const contextCounts = ctxData.counts || {}
    const observations = observationsFrom(ctxData.summary || {})
    const context = {
      company: comp?.name || null, orgNr: comp?.org_nr || null, view, selection,
      accounts: ctxData.accounts || [], balances: ctxData.balances || [], verifications: ctxData.verifications || [],
      supplierInvoices: ctxData.supplierInvoices || [], customerInvoices: ctxData.customerInvoices || [],
      summary: ctxData.summary || {}, observations,
    }

    // Tillåtna referenser för hallucinationsspärren – ENBART det serverhämtade.
    const allowedAccounts = new Set<string>((ctxData.accounts || []).map((a: any) => String(a.nr)))
    const allowedObjects: Record<string, Set<string>> = {
      verification: new Set((ctxData.verifications || []).map((v: any) => String(v.id))),
      invoice: new Set([...(ctxData.supplierInvoices || []).map((i: any) => String(i.id)), ...(ctxData.customerInvoices || []).map((i: any) => String(i.id))]),
      supplier: new Set((ctxData.supplierInvoices || []).map((i: any) => String(i.supplierId)).filter((x: string) => x && x !== 'null')),
      customer: new Set((ctxData.customerInvoices || []).map((i: any) => String(i.customerId)).filter((x: string) => x && x !== 'null')),
    }
    if (selection) { (allowedObjects[selection.type] = allowedObjects[selection.type] || new Set()).add(selection.id); if (selection.type === 'account') allowedAccounts.add(selection.id) }

    // 4. AI – strikt JSON. (Saknas nyckel → tydligt fel, ingen hallucination.)
    if (!GEMINI_API_KEY) return json({ error: 'AI-tjänsten är inte konfigurerad.', code: 'ai_unconfigured' }, 503)
    const prompt = `Du är ROBO-bp, BokPilots kontrollerade svenska AI-bokföringsassistent.
ABSOLUTA REGLER:
- Du bokför, ändrar, raderar, låser upp, godkänner eller lämnar ALDRIG in något. Du föreslår och analyserar bara.
- Svara ENDAST utifrån KONTEXT nedan. Hitta ALDRIG på konton, belopp, verifikations- eller fakturanummer.
- Ange "basis" ärligt: company_data (systemdata), rule_source (regelkälla), ai_inference (AI-bedömning).
- Vid regel/skatt/moms/bokslut: hänvisa till källa (bfn/skatteverket/bas) när sådan finns och säg när mänsklig granskning krävs.
- Sätt requires_human_review=true på alla findings. Var kort och konkret på svenska.
- Steg 2B: du har BEGRÄNSAD kontext (smart vald kontoplan + saldo per kontoklass + summary med antal/öppna/förfallna fakturor + intäkt/kostnad/moms + deterministiska "observations"). Använd summary och observations för att svara och prioritera. Föreslå INTE kontering – tillåtna proposed_actions är endast open_object, explain_rule, create_check. Saknas data: säg det i "limitations".
KONTEXT (JSON): ${JSON.stringify(context).slice(0, 20000)}
FRÅGA: ${question}`

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA } }),
    })
    let validated, vres
    if (!r.ok) { vres = { ok: false, errors: ['ai_http_' + r.status], value: { ...empty(), limitations: ['AI-tjänsten kunde inte svara just nu. Försök igen.'] } }; validated = vres.value }
    else { const gj = await r.json(); const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text || ''; vres = validate(text, allowedAccounts, allowedObjects, STEP2A_ACTIONS); validated = vres.value }

    // 5. Persistera konversation + meddelanden + audit (service role; medlemskap redan verifierat).
    let convId = isStr(conversation_id) ? conversation_id : null
    if (!convId) { const { data: c } = await admin.from('robo_bp_conversations').insert({ company_id, fiscal_year_id: descriptor?.fiscalYearId || null, user_id: user.id, title: question.slice(0, 80), context_view: view }).select('id').single(); convId = c?.id || null }
    if (convId) {
      await admin.from('robo_bp_messages').insert({ conversation_id: convId, company_id, user_id: user.id, role: 'user', content: question })
      await admin.from('robo_bp_messages').insert({ conversation_id: convId, company_id, role: 'assistant', content: validated.answer, structured: validated, basis: validated.basis, risk_level: validated.risk_level })
      await admin.from('robo_bp_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)
    }
    // Audit minimerad: ingen frågetext, ingen rådata – bara metadata.
    await admin.from('robo_bp_audit_log').insert({ company_id, user_id: user.id, action: 'ai_query', detail: { view, hasSelection: !!selection, contextCounts, observationCounts: { total: observations.length, codes: observations.map((o: any) => o.code) }, risk: validated.risk_level, valid: vres.ok, errors: vres.errors.slice(0, 8) } })

    // observations = deterministiska systemkontroller (server-beräknade, separat SÄKERT fält – ej AI-genererat).
    // meta = transparens-underlag (Steg 2G): ENDAST antal/koder (inga rader, ingen rå data, ingen frågetext).
    const meta = { view, contextCounts, observationCounts: { total: observations.length, codes: observations.map((o: any) => o.code) } }
    return json({ ok: true, conversation_id: convId, response: validated, observations, meta, validation: { ok: vres.ok, errors: vres.errors } })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
