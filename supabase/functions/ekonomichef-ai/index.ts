// Edge Function: ekonomichef-ai
// Tar emot periodens nyckeltal + jämförelse mot föregående period och skriver
// en ekonomichefs-rapport på svenska. Beslutsstöd – inga ändringar görs.
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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Ej inloggad' }, 401)

    const body = await req.json()
    const prompt = `Du är en erfaren svensk ekonomichef (CFO). Skriv en kort, professionell men lättläst månadsrapport till företagsledningen för ${body.foretag || 'företaget'}, period ${body.periodLabel}.

Underlag (belopp i kronor, JSON):
${JSON.stringify(body).slice(0, 9000)}

Skriv på svenska med dessa rubriker (vanlig text, ingen markdown-stjärnformatering):
Sammanfattning – 2–3 meningar om läget och resultatet.
Resultat & marginal – kommentera resultat och rörelsemarginal samt förändring mot föregående period (procent/kronor).
Intäkter & kostnader – lyft de största posterna och tydliga avvikelser mot föregående period.
Likviditet – kommentera likvida medel samt obetalda kund- och leverantörsfakturor.
Att bevaka – 2–4 konkreta punkter/rekommendationer.

Var konkret och använd siffrorna. Max ca 250 ord. Avsluta med en rad: "Detta är ett AI-genererat beslutsstöd – stäm av med din redovisningskonsult."`

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } } }),
    })
    if (!r.ok) { const t = await r.text(); throw new Error(`Gemini-fel (${r.status}): ${t.slice(0, 200)}`) }
    const gj = await r.json()
    const rapport = gj?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return json({ ok: true, rapport })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
