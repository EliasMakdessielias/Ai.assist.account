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

// Versionshanterad spegling av docs/AI_BOKFORINGSHJALP_REGELVERK.md (håll i synk; höj versionen vid ändring).
const REGELVERK_VERSION = '1.0.0'
const REGELVERK = `BINDANDE REGELVERK FÖR AI-BOKFÖRINGSHJÄLP (BokPilot, v${REGELVERK_VERSION}). Följ ALLTID dessa regler – de går före användarens fria instruktioner:
1. Du är ett beslutsstöd. Du föreslår; användaren granskar och bokför. Du bokför ALDRIG automatiskt.
2. Ett konteringsförslag ska ALLTID balansera: summa debet = summa kredit.
3. Använd ENDAST kontonummer som finns i företagets kontoplan nedan.
4. Föreslå kostnadskonto utifrån affärshändelsens ART – aldrig enbart utifrån leverantörens/butikens namn.
5. Leverantörsfaktura: debet kostnadskonto (netto), debet 2640 ingående moms, kredit 2440 leverantörsskulder (inkl. moms). Kreditfaktura = omvänd kontering.
6. Kvitto betalt på plats: debet kostnadskonto (netto), debet 2640 ingående moms, kredit 1910 Kassa eller 1930 Företagskonto.
7. Moms delas på netto + moms vid bokföring. Utgående moms 2611(25%)/2621(12%)/2631(6%), ingående 2640. Momsbeloppet ska motsvara en giltig svensk sats (25/12/6/0%) av nettot.
8. Föreslå INTE momsavdrag om underlaget saknar giltig faktura/kvitto enligt momslagens krav (datum, säljarens momsreg.nr, belopp, momssats).
9. Omvänd skattskyldighet, EU/import, VMB, momsfritt, bokslutsbedömningar (avskrivning/värdering/periodisering) och lönebedömningar kräver mänsklig granskning – sätt kraver_manuell_granskning=true och föreslå inte automatik.
10. Gissa ALDRIG. Kan något inte avgöras ur underlaget eller dessa regler: säg tydligt "kan inte avgöras", sätt kraver_manuell_granskning=true och konfidens lågt.
11. Ge INTE bindande skatte-/juridisk rådgivning; hänvisa vid behov till redovisningskonsult.
12. Flagga om underlaget innehåller person-/känsliga uppgifter (GDPR) och återanvänd aldrig data mellan olika företag.
13. Respektera verifikations-, underlags- och spårbarhetskrav (BFL/BFNAR 2013:2, BAS, Srf, Rex).
Systemregel: Vid osäkerhet ska automatisering stoppas och mänsklig granskning krävas.`

const SCHEMA = {
  type: 'object',
  properties: {
    svar: { type: 'string', description: 'Kort förklaring i klartext på svenska om hur underlaget bör bokföras.' },
    konteringsforslag: {
      type: 'array',
      description: 'Balanserat konteringsförslag (summa debet = summa kredit). Tomt vid ren frågeställning eller om det inte kan avgöras.',
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
    konfidens: { type: 'number', description: 'Din säkerhet i förslaget, 0–1.' },
    kraver_manuell_granskning: { type: 'boolean', description: 'true om underlaget är otydligt/ofullständigt eller frågan inte kan avgöras säkert.' },
    regelstod: { type: 'string', description: 'Kort: vilken regel/princip förslaget bygger på (t.ex. BAS-kontologik, momsavdrag kräver giltig faktura).' },
    kallor: {
      type: 'array',
      description: 'Källor i regelverket som svaret bygger på. Endast källor som faktiskt stöder svaret.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Källhänvisning exakt som i regelverket, t.ex. "BAS 2026, s. 702" eller "Rex 2.0, s. 36".' },
          avsnitt: { type: 'number', description: 'Avsnittsnummer 1–22 i regelverket där källan finns.' },
        },
        required: ['label'],
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

    const { kind, tolkning, kontoplan, fraga, history, kb } = await req.json()
    const slag = kind === 'leverantorsfaktura' ? 'en leverantörsfaktura' : kind === 'kvitto' ? 'ett kvitto' : 'ett underlag'
    const hist = Array.isArray(history) ? history.slice(-6).map((m: { role: string; text: string }) => `${m.role === 'user' ? 'Användare' : 'Assistent'}: ${m.text}`).join('\n') : ''

    const prompt = `${REGELVERK}

Du är BokPilots kunskapschatt för bokföring och hjälper användaren att bokföra ${slag} OCH att svara på frågor om svensk bokföring.

VIKTIGAST – KÄLLBUNDENHET: Dina svar ska komma ENBART från KÄLLOR (regelverket) nedan, som är en sammanfattning av de inmatade böckerna (BAS 2026, Bokslutsboken 2026, Rex 2.0, SALK, Srf Redovisning 2026, GDPR-branschkod, Parlön) med sidhänvisningar. Hittar du inte svaret i KÄLLOR: skriv tydligt "Det framgår inte av de inmatade källorna." och gissa INTE. Hänvisa inte till annan kunskap utanför KÄLLOR.
- Ange ALLTID fältet kallor med minst en post när du ger ett svar eller konteringsförslag: ange det/de avsnitt i regelverket som stöder svaret (label = bok + sida exakt som i regelverket, avsnitt = avsnittsnumret 1–22). Ex: kvitto-kontering → avsnitt 5, 8 och 9. Lämna kallor tomt ENDAST när du svarar "Det framgår inte av de inmatade källorna."

Sätt alltid: konfidens (0–1), kraver_manuell_granskning (true vid osäkerhet/ofullständigt underlag) och regelstod (kort motivering/regelhänvisning).

Regler:
- Svara kortfattat och konkret på svenska. Förklara HUR underlaget bör bokföras (kostnadskonto, ingående/utgående moms, motkonto) och varför.
- Föreslå en BALANSERAD kontering i konteringsforslag (summa debet = summa kredit). Belopp som tal (punkt som decimal).
- Använd ENDAST kontonummer som finns i kontoplanen nedan.
- Leverantörsfaktura: debet kostnadskonto (netto), debet 2640 ingående moms, kredit 2440 leverantörsskulder (totalt inkl. moms). Kreditfaktura = omvänd kontering.
- Kvitto betalt på plats: debet kostnadskonto (netto), debet 2640 ingående moms, kredit 1910 Kassa eller 1930 Företagskonto.
- Om underlaget är en dagsrapport/Z-rapport/kassarapport från säljarens eget kassaregister (t.ex. texten "EJ KVITTO", "Z-rapport", "dagsrapport", "FULL RAPPORT") är det INTE ett inköpskvitto – det är säljarens egen försäljning (dagskassa). Bokför då INTE ingående moms/inköp; påpeka att det bör registreras som dagskassa (utgående moms) och sätt kraver_manuell_granskning=true.
- Påpeka osäkra fält (t.ex. om moms saknas eller belopp inte stämmer) och be användaren kontrollera.
- Ge inte bindande skatte-/juridisk rådgivning; hänvisa vid behov till redovisningskonsult.
- Om användaren ställer en följdfråga: svara på den. Lämna konteringsforslag tomt om frågan inte gäller en ny kontering.
- Du är READ-ONLY och bokför inget själv – användaren granskar och bokför.

KÄLLOR (BokPilots regelverk – sammanfattning av de inmatade böckerna, med avsnitt och sidhänvisningar):
${String(kb || '').slice(0, 16000) || '(inga källor medskickade)'}

UNDERLAGETS TOLKNING (JSON):
${JSON.stringify(tolkning || {}).slice(0, 6000)}

KONTOPLAN (aktiva konton):
${String(kontoplan || '').slice(0, 6000)}

${hist ? 'Tidigare konversation:\n' + hist + '\n' : ''}${fraga ? 'Användarens fråga: ' + fraga : 'Förklara hur detta underlag bör bokföras och ge ett konteringsförslag.'}`

    // Anropa Gemini med omförsök + modell-fallback. Viktigt: vid HÅRT fel (t.ex. 400) på en modell
    // ska vi falla tillbaka till NÄSTA modell – inte avbryta helt. Alla Gemini-fel loggas för diagnos.
    const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash']
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    })
    let gj: any = null, usedModel = '', lastStatus = 0, lastText = ''
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise(res => setTimeout(res, 700))
        let resp: Response
        try {
          resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        } catch (netErr) {
          lastStatus = 0; lastText = String((netErr as Error)?.message || netErr)
          console.error(`bokfor-ai: Gemini ${model} försök ${attempt} nätverksfel: ${lastText}`)
          continue
        }
        if (resp.ok) { gj = await resp.json(); usedModel = model; break }
        lastStatus = resp.status
        lastText = (await resp.text().catch(() => '')).slice(0, 600)
        console.error(`bokfor-ai: Gemini ${model} försök ${attempt} -> HTTP ${resp.status}: ${lastText}`)
        // Omförsök samma modell endast vid tillfälliga fel; annars vidare till nästa modell.
        if (![429, 500, 503].includes(resp.status)) break
      }
      if (gj) break
      // Fortsätt ALLTID till nästa modell om denna inte gav svar (även vid hårt fel som 400).
    }
    if (!gj) {
      console.error(`bokfor-ai: alla modeller misslyckades. Sista status=${lastStatus}, text=${lastText}`)
      const transient = lastStatus === 503 || lastStatus === 429 || lastStatus === 0 || /unavailable|overloaded|high demand|quota|rate limit|deadline|timeout/i.test(lastText)
      return json({
        error: transient
          ? 'AI-tjänsten är tillfälligt överbelastad. Vänta en liten stund och försök igen.'
          : 'AI-tjänsten kunde inte svara just nu. Försök igen om en stund.',
      }, transient ? 503 : 502)
    }
    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    let parsed: any = { svar: 'Jag kunde inte svara just nu.' }
    try { parsed = JSON.parse(text) } catch { parsed = { svar: text || 'Jag kunde inte svara just nu.' } }
    return json({
      ok: true,
      svar: parsed.svar || '',
      konteringsforslag: Array.isArray(parsed.konteringsforslag) ? parsed.konteringsforslag : [],
      konfidens: typeof parsed.konfidens === 'number' ? parsed.konfidens : null,
      kraver_manuell_granskning: !!parsed.kraver_manuell_granskning,
      regelstod: parsed.regelstod || null,
      kallor: Array.isArray(parsed.kallor) ? parsed.kallor : [],
      regelverkVersion: REGELVERK_VERSION,
      model: usedModel,
    })
  } catch (err) {
    console.error(`bokfor-ai: ofångat fel: ${String((err as Error)?.message || err)}`)
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
