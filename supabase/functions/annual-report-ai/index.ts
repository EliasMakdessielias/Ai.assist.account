// Edge Function: annual-report-ai (Steg 2C-3)
// Kontrollerat AI-stöd som formulerar TEXTUTKAST för förvaltningsberättelse och noter i K2-årsredovisningsutkastet.
// Läser begränsad kontext via RPC, frågar Gemini med STRIKT JSON-schema, validerar tillåtna sektioner och sparar
// via RPC (server-side validering). AI ändrar ALDRIG siffror, RR/BR eller status, godkänner ALDRIG sektioner och
// hittar ALDRIG på noter, ställda säkerheter eller eventualförpliktelser. Alla texter markeras ai_generated + requires_review.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const PROMPT_VERSION = 'ar-text-1'
const ALLOWED = ['forvaltningsberattelse', 'noter']

const SYSTEM = `Du skriver TEXTUTKAST till en svensk K2-årsredovisning (mindre aktiebolag) i BokPilot.
Du får ENDAST formulera text för: förvaltningsberättelse (forvaltningsberattelse) och noter (noter).

REGLER (följ alltid):
- Skriv på professionell, saklig svenska anpassad för årsredovisning. Håll texten kort och korrekt.
- Använd ENDAST kända uppgifter från den givna kontexten. Hitta ALDRIG på något.
- Skapa ALDRIG nya siffror och ändra ALDRIG resultaträkning eller balansräkning.
- Hitta ALDRIG på jämförelsetal, noter, ställda säkerheter eller eventualförpliktelser. Om källa saknas: skriv exakt "Uppgift saknas. Kräver manuell granskning."
- Dra inga juridiska slutsatser utan underlag. Skriv ALDRIG att årsredovisningen är godkänd eller att styrelse/revisor undertecknat.
- Markera osäkerhet tydligt. Texten är ett UTKAST som en behörig redovisningskonsult måste granska och godkänna.
- I source_summary: ange kort vilka delar av kontexten texten bygger på.

Returnera JSON enligt schemat: en lista 'sections'. section_key ska vara 'forvaltningsberattelse' eller 'noter'.`

const SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section_key: { type: 'string' },
          content: { type: 'string' },
          source_summary: { type: 'string' },
        },
        required: ['section_key', 'content'],
      },
    },
  },
  required: ['sections'],
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

    const { draft_id } = await req.json()
    if (!draft_id) return json({ error: 'draft_id krävs' }, 400)

    // Kontext + auktorisering (admin) sker i RPC. Fel (behörighet/lås) propageras som tydligt meddelande.
    const { data: ctx, error: ctxErr } = await userClient.rpc('annual_report_ai_context', { p_draft: draft_id })
    if (ctxErr) return json({ error: ctxErr.message?.replace(/^.*?:\s*/, '') || 'Kunde inte läsa kontext', code: ctxErr.code }, ctxErr.code === '42501' ? 403 : 400)

    const prompt = `${SYSTEM}\n\nKONTEXT (JSON):\n${JSON.stringify(ctx).slice(0, 16000)}\n\nSkriv textutkast för förvaltningsberättelse och noter.`
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
      return json({ error: transient ? 'AI är tillfälligt upptagen (kvot/hög last). Försök igen om en stund.' : 'AI kunde inte generera text just nu.' }, transient ? 503 : 502)
    }

    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    let parsed: any = {}
    try { parsed = JSON.parse(text) } catch { return json({ error: 'AI gav ogiltigt svar (kunde inte tolkas). Inget sparades.' }, 502) }
    const raw = Array.isArray(parsed?.sections) ? parsed.sections : []
    // Validera: endast tillåtna sektioner, content krävs. Bygg payload med källsammanfattning.
    const sections = raw
      .filter((s: any) => ALLOWED.includes(s?.section_key) && typeof s?.content === 'string' && s.content.trim() !== '')
      .map((s: any) => ({
        section_key: s.section_key,
        content: s.content,
        source_summary: { kalla: 'gemini', summary: String(s.source_summary || '').slice(0, 1000) },
      }))
    if (sections.length === 0) return json({ ok: true, updated: 0, note: 'Inga tillåtna textutkast genererades.' })

    // Spara via RPC (validerar strikt server-side, auktoriserar admin, sätter ai_generated/requires_review, loggar audit).
    const { data: updated, error: saveErr } = await userClient.rpc('annual_report_save_ai_texts', {
      p_draft: draft_id, p_payload: { model: 'gemini', prompt_version: PROMPT_VERSION, sections },
    })
    if (saveErr) return json({ error: saveErr.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara text', code: saveErr.code }, saveErr.code === '42501' ? 403 : 400)
    return json({ ok: true, updated: updated ?? 0 })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
