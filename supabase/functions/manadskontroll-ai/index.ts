// Edge Function: manadskontroll-ai
// AI-stöd för Månadskontroll. Förklarar varför en kontrollpunkt uppstod, föreslår hur den löses,
// föreslår arbetsordning, sammanfattar månadens risker och skapar checklista för månadsavslut.
// Strikta gränser: stänger ALDRIG punkter, bokför ALDRIG, ignorerar ALDRIG differenser, ger INGEN
// definitiv juridisk/skatterådgivning, och flaggar alltid när mänsklig granskning krävs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const SYSTEM = `Du är BokPilots assistent för Månadskontroll (svenskt bokföringssystem). Du hjälper användaren
att förstå och åtgärda kontrollpunkter inför månadsavslut. Svara kort, konkret och på svenska.

REGLER (följ alltid):
- Förklara VARFÖR en kontrollpunkt uppstod och HUR den åtgärdas, steg för steg.
- Hänvisa till var i appen åtgärden görs (Inkorg, Bokföring, Leverantörsfakturor, Kundfakturor,
  Kassa & bank, Moms, Lön).
- Du får ALDRIG stänga eller markera kontrollpunkter som lösta automatiskt – användaren gör det själv.
- Du får ALDRIG bokföra eller föreslå att något bokförs utan att användaren granskar och bekräftar.
- Ignorera ALDRIG differenser (t.ex. obalans eller momsavvikelse) – de måste utredas.
- Ge INTE definitiv juridisk eller skatterådgivning. Håll dig på generell nivå och hänvisa till
  redovisningskonsult vid behov.
- Flagga TYDLIGT när något kräver mänsklig granskning (särskilt kritiska punkter, obalans, moms,
  ej avstämd bank, ej bokförd lön, förfallna fakturor).
- Hitta aldrig på regler eller funktioner. Är du osäker: säg det och föreslå manuell kontroll.`

const SCHEMA = {
  type: 'object',
  properties: { svar: { type: 'string', description: 'Kort, konkret svar på svenska enligt reglerna.' } },
  required: ['svar'],
}
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash']

function buildPrompt(mode: string, item: any, items: any[]): string {
  const one = (it: any) => `- [${it?.priority}] ${it?.module}: ${it?.title}${it?.description ? ' – ' + it.description : ''}`
  if (mode === 'summary') {
    return `Sammanfatta månadens risker utifrån följande öppna kontrollpunkter. Lyft de viktigaste först,
gruppera per allvarlighetsgrad och nämn vad som kräver mänsklig granskning.\n\nPunkter:\n${(items || []).map(one).join('\n') || '(inga öppna punkter)'}`
  }
  if (mode === 'checklist') {
    return `Skapa en kort, prioriterad checklista för månadsavslut utifrån följande öppna kontrollpunkter.
Ange i vilken ordning användaren bör arbeta (kritiskt först) och vad som måste granskas manuellt.\n\nPunkter:\n${(items || []).map(one).join('\n') || '(inga öppna punkter)'}`
  }
  if (mode === 'order') {
    return `Föreslå i vilken ordning användaren bör åtgärda följande öppna kontrollpunkter och varför.\n\nPunkter:\n${(items || []).map(one).join('\n') || '(inga öppna punkter)'}`
  }
  // explain (default)
  return `Förklara varför följande kontrollpunkt uppstod och hur den åtgärdas steg för steg.
Avsluta med om den kräver mänsklig granskning.\n\nKontrollpunkt:
Modul: ${item?.module}
Prioritet: ${item?.priority}
Titel: ${item?.title}
Beskrivning: ${item?.description || '—'}
Föreslagen åtgärd: ${item?.suggested_action || '—'}
Regel: ${item?.rule_key || '—'}
Data: ${JSON.stringify(item?.source_data || {}).slice(0, 800)}`
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

    const { mode = 'explain', item, items, user_context } = await req.json()
    const ctx = user_context ? `ANVÄNDARE: ${[user_context.company, user_context.role].filter(Boolean).join(' · ')}` : ''
    const prompt = `${SYSTEM}\n\n${ctx}\n\n${buildPrompt(mode, item, items)}`

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    })

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
      return json({ error: transient ? 'AI är tillfälligt upptagen. Försök igen om en stund.' : 'AI kunde inte svara just nu.' }, transient ? 503 : 502)
    }
    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    let parsed: any = {}
    try { parsed = JSON.parse(text) } catch { parsed = { svar: text || '' } }
    return json({ ok: true, svar: parsed.svar || 'Inget svar.' })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
