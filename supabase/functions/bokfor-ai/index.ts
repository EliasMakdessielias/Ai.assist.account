// Edge Function: bokfor-ai
// AI-stöd för bokföring av ett enskilt underlag (kvitto/leverantörsfaktura). Klienten skickar
// underlagets tolkning (OCR-resultat) + företagets kontoplan. Funktionen förklarar i klartext
// HUR underlaget bör bokföras och föreslår en balanserad kontering. Read-only – bokför inget.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const SCHEMA = {
  type: 'object',
  properties: {
    svar: { type: 'string', description: 'Kort förklaring i klartext på svenska om hur underlaget bör bokföras.' },
    konteringsforslag: {
      type: 'array',
      description: 'Balanserat konteringsförslag (summa debet = summa kredit). Tomt vid ren frågeställning.',
      items: {
        type: 'object',
        properties: {
          konto: { type: 'string' },
          benamning: { type: 'string' },
          debet: { type: 'number' },
          kredit: { type: 'number' },
        },
        required: ['konto', 'debet', 'kredit'],
      },
    },
  },
  required: ['svar'],
}

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

    const { kind, tolkning, kontoplan, fraga, history } = await req.json()
    const slag = kind === 'leverantorsfaktura' ? 'en leverantörsfaktura' : kind === 'kvitto' ? 'ett kvitto' : 'ett underlag'
    const hist = Array.isArray(history) ? history.slice(-6).map((m: { role: string; text: string }) => `${m.role === 'user' ? 'Användare' : 'Assistent'}: ${m.text}`).join('\n') : ''

    const prompt = `Du är en svensk redovisningsexpert i appen BokPilot och hjälper användaren att bokföra ${slag}. Utgå från underlagets tolkning (JSON) och företagets kontoplan nedan.

Regler:
- Svara kortfattat och konkret på svenska. Förklara HUR underlaget bör bokföras (kostnadskonto, ingående/utgående moms, motkonto) och varför.
- Föreslå en BALANSERAD kontering i konteringsforslag (summa debet = summa kredit). Belopp som tal (punkt som decimal).
- Använd ENDAST kontonummer som finns i kontoplanen nedan.
- Leverantörsfaktura: debet kostnadskonto (netto), debet 2640 ingående moms, kredit 2440 leverantörsskulder (totalt inkl. moms). Kreditfaktura = omvänd kontering.
- Kvitto betalt på plats: debet kostnadskonto (netto), debet 2640 ingående moms, kredit 1910 Kassa eller 1930 Företagskonto.
- Påpeka osäkra fält (t.ex. om moms saknas eller belopp inte stämmer) och be användaren kontrollera.
- Ge inte bindande skatte-/juridisk rådgivning; hänvisa vid behov till redovisningskonsult.
- Om användaren ställer en följdfråga: svara på den. Lämna konteringsforslag tomt om frågan inte gäller en ny kontering.
- Du är READ-ONLY och bokför inget själv – användaren granskar och bokför.

UNDERLAGETS TOLKNING (JSON):
${JSON.stringify(tolkning || {}).slice(0, 8000)}

KONTOPLAN (aktiva konton):
${String(kontoplan || '').slice(0, 6000)}

${hist ? 'Tidigare konversation:\n' + hist + '\n' : ''}${fraga ? 'Användarens fråga: ' + fraga : 'Förklara hur detta underlag bör bokföras och ge ett konteringsförslag.'}`

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
      }),
    })
    if (!r.ok) { const t = await r.text(); throw new Error(`Gemini-fel (${r.status}): ${t.slice(0, 200)}`) }
    const gj = await r.json()
    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    let parsed: any = { svar: 'Jag kunde inte svara just nu.' }
    try { parsed = JSON.parse(text) } catch { parsed = { svar: text || 'Jag kunde inte svara just nu.' } }
    return json({ ok: true, svar: parsed.svar || '', konteringsforslag: Array.isArray(parsed.konteringsforslag) ? parsed.konteringsforslag : [] })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
