// Edge Function: bokslut-ai (Steg 2B)
// AI-granskningsstöd för AI Bokslut & Årsredovisning. Läser strukturerad kontext (checks/bilagor) via RPC,
// frågar Gemini med STRIKT JSON-schema, validerar och sparar via RPC. Skriver ALDRIG bokföringsdata, skapar
// INGA verifikationer, INGA draft-justeringar och INGET K2-utkast. Förslagen kräver mänsklig granskning.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const SYSTEM = `Du är ett granskningsstöd för bokslut i BokPilot (svenskt bokföringssystem, K2 för mindre aktiebolag).
Du analyserar färdiga kontrollpunkter (checks) och bokslutsbilagor och ger STRUKTURERADE granskningsförslag som
hjälper en redovisningskonsult att förstå risker, prioritera och veta vad som bör kontrolleras härnäst.

REGLER (följ alltid):
- Förklara VARFÖR en risk finns och föreslå NÄSTA MANUELLA kontroll.
- Hänvisa till relevanta checks/bilagor via deras id (related_check_id / related_attachment_id) när det går.
- Markera osäkerhet tydligt (lägre confidence) och säg när något INTE kan avgöras utifrån given data.
- Använd svensk redovisningsterminologi. Svara kort och konkret.
- Hitta ALDRIG på konton, belopp eller regler. Använd bara siffror som finns i kontexten.
- Du får ALDRIG bokföra, skapa verifikationer, ändra låsta perioder, godkänna bokslut, lämna in årsredovisning,
  ge definitiv juridisk/skatterådgivning eller skriva K2-årsredovisningstext.
- Allt du föreslår är granskningsstöd som en behörig användare måste bedöma.

Returnera JSON enligt schemat: en lista 'suggestions'. suggestion_type ska vara en av:
risk_explanation, next_action, missing_documentation, attachment_review, balance_issue, vat_issue, tax_issue,
equity_issue, payroll_issue, manual_review_required. risk_level: low/medium/high/critical. confidence: 0..1.`

const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          suggestion_type: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          reasoning: { type: 'string' },
          risk_level: { type: 'string' },
          confidence: { type: 'number' },
          related_check_id: { type: 'string' },
          related_attachment_id: { type: 'string' },
          suggested_next_action: { type: 'string' },
        },
        required: ['suggestion_type', 'title', 'risk_level'],
      },
    },
  },
  required: ['suggestions'],
}
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY saknas')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Ej inloggad' }, 401)

    const { engagement_id } = await req.json()
    if (!engagement_id) return json({ error: 'engagement_id krävs' }, 400)

    // Kontext + auktorisering (admin) sker i RPC. Fel (behörighet/lås) propageras som tydligt meddelande.
    const { data: ctx, error: ctxErr } = await userClient.rpc('bokslut_ai_context', { p_engagement: engagement_id })
    if (ctxErr) return json({ error: ctxErr.message?.replace(/^.*?:\s*/, '') || 'Kunde inte läsa kontext', code: ctxErr.code }, ctxErr.code === '42501' ? 403 : 400)

    const prompt = `${SYSTEM}\n\nKONTEXT (JSON):\n${JSON.stringify(ctx).slice(0, 16000)}\n\nGe 3–8 prioriterade granskningsförslag.`
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    })

    // Gemini med modell-fallback (429 → nästa modell; 503/500 → kort backoff; max 2 anrop). Quota-mönster.
    let gj: any = null, lastStatus = 0, calls = 0
    for (const model of MODELS) {
      if (calls >= 2) break
      calls++
      let resp: Response | null = null
      try {
        resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      } catch { continue }
      if (resp.ok) { gj = await resp.json(); break }
      lastStatus = resp.status
      if ((lastStatus === 503 || lastStatus === 500) && calls < 2) await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 500)))
    }
    if (!gj) {
      const transient = lastStatus === 429 || lastStatus === 503 || lastStatus === 0
      return json({ error: transient ? 'AI är tillfälligt upptagen (kvot/hög last). Försök igen om en stund.' : 'AI kunde inte generera förslag just nu.' }, transient ? 503 : 502)
    }

    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    let parsed: any = {}
    try { parsed = JSON.parse(text) } catch { return json({ error: 'AI gav ogiltigt svar (kunde inte tolkas). Inget sparades.' }, 502) }
    const items = Array.isArray(parsed?.suggestions) ? parsed.suggestions : []
    if (items.length === 0) return json({ ok: true, created: 0, note: 'Inga förslag genererades.' })

    // Spara via RPC (validerar strikt server-side, auktoriserar admin, loggar audit). Ogiltiga poster skippas.
    const { data: created, error: saveErr } = await userClient.rpc('bokslut_save_ai_suggestions', { p_engagement: engagement_id, p_items: items, p_model: 'gemini' })
    if (saveErr) return json({ error: saveErr.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara förslag', code: saveErr.code }, saveErr.code === '42501' ? 403 : 400)
    return json({ ok: true, created: created ?? 0 })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
