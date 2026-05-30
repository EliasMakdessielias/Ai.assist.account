// Edge Function: granska-ai
// Tar emot resultatet av bokföringsgranskningen (endast antal/belopp – inga
// person- eller kunduppgifter) och returnerar en prioriterad åtgärdsanalys på
// svenska enligt bokföringslagen och god redovisningssed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY saknas')

    // Verifiera inloggning
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Ej inloggad' }, 401)

    const body = await req.json()
    const fynd = Array.isArray(body?.fynd) ? body.fynd : []

    const prompt = `Du är en svensk auktoriserad redovisningskonsult. Nedan är resultatet av en automatisk granskning av ett företags bokföring för perioden ${body?.period?.from} – ${body?.period?.tom} (${body?.antalVerifikationer || 0} verifikationer).

Fynd (allvarsgrad, titel, antal, beskrivning):
${fynd.map((f: Record<string, unknown>) => `- [${f.allvar}] ${f.titel} (${f.antal} st): ${f.detalj}`).join('\n') || '- Inga avvikelser hittades.'}

Skriv en kort, konkret åtgärdsplan på svenska:
1. Sammanfatta läget i 1–2 meningar.
2. Lista åtgärderna i prioritetsordning (allvarligast först), med hänvisning till bokföringslagen (BFL) eller god redovisningssed där det är relevant.
3. Var konkret och praktisk. Max ca 200 ord. Påminn kort om att en människa måste granska och godkänna – inget bokförs automatiskt.
Använd ren text (inga markdown-rubriker), gärna numrerad lista.`

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } }),
    })
    if (!r.ok) { const t = await r.text(); throw new Error(`Gemini-fel (${r.status}): ${t.slice(0, 200)}`) }
    const gj = await r.json()
    const analys = gj?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return json({ ok: true, analys })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
