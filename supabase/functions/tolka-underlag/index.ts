// Edge Function: tolka-underlag
// Tar emot ett document_id, hämtar filen, skickar den till Gemini för
// fakturatolkning och returnerar strukturerad data + förslag på kontering.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SCHEMA = {
  type: 'object',
  properties: {
    leverantor: { type: 'string' },
    beskrivning: { type: 'string' },
    fakturadatum: { type: 'string', description: 'YYYY-MM-DD' },
    forfallodatum: { type: 'string', description: 'YYYY-MM-DD eller tom' },
    valuta: { type: 'string' },
    belopp_inkl_moms: { type: 'number' },
    moms_belopp: { type: 'number' },
    momssats: { type: 'number', description: '25, 12, 6 eller 0' },
    fakturanummer: { type: 'string', description: 'fakturans nummer/Faktnr' },
    ocr: { type: 'string', description: 'OCR-referens som anges vid betalning (ofta längre sifferföljd)' },
    org_nr: { type: 'string', description: 'leverantörens (avsändarens) organisationsnummer' },
    bankgiro: { type: 'string', description: 'leverantörens bankgiro' },
    plusgiro: { type: 'string', description: 'leverantörens plusgiro' },
    iban: { type: 'string' },
    bic: { type: 'string' },
    vat_nummer: { type: 'string', description: 'leverantörens momsregistreringsnummer (VAT)' },
    leverantor_adress: { type: 'string', description: 'leverantörens gatuadress' },
    leverantor_postnr: { type: 'string', description: 'leverantörens postnummer' },
    leverantor_ort: { type: 'string', description: 'leverantörens ort' },
    leverantor_land: { type: 'string', description: 'leverantörens land' },
    leverantor_telefon: { type: 'string', description: 'leverantörens telefonnummer' },
    leverantor_epost: { type: 'string', description: 'leverantörens e-postadress' },
    leverantor_webb: { type: 'string', description: 'leverantörens webbadress' },
    typ: { type: 'string', description: 'leverantorsfaktura, kvitto, insattningskvitto eller ovrigt' },
    konteringsrader: {
      type: 'array',
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
  required: ['beskrivning', 'konteringsrader'],
}

function blobToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// Klassificera ett OCR-fel -> {errorCode, severity}. Inga dokumentdata/secrets exponeras.
function classifyOcrError(msg: string): { errorCode: string; severity: string } {
  const m = (msg || '').toLowerCase()
  if (/gemini_api_key|api_key saknas|api-key saknas/.test(m)) return { errorCode: 'config_missing_gemini_key', severity: 'critical' }
  if (/\b429\b|rate limit|quota|resource_exhausted/.test(m)) return { errorCode: 'gemini_rate_limit', severity: 'warning' }
  if (/timeout|timed out|deadline|aborted/.test(m)) return { errorCode: 'ocr_timeout', severity: 'error' }
  if (/ladda ner|download|storage|hittades inte|extract/.test(m)) return { errorCode: 'file_extraction_failure', severity: 'error' }
  if (/json|parse|tomt svar|unexpected|malformed/.test(m)) return { errorCode: 'malformed_model_response', severity: 'error' }
  if (/gemini|generativelanguage|api/.test(m)) return { errorCode: 'gemini_api_failure', severity: 'error' }
  return { errorCode: 'ocr_unhandled', severity: 'error' }
}
// system_error-rapportering (service-role). Får aldrig kasta. Inga underlagsdata i metadata.
async function reportOcrError(admin: any, errorCode: string, message: string, severity: string, metadata: Record<string, unknown> = {}, companyId: string | null = null) {
  try {
    if (!admin) return
    await admin.rpc('report_system_error', {
      p_component: 'tolka-underlag', p_message: String(message || '').slice(0, 300), p_company_id: companyId,
      p_severity: severity, p_error_code: errorCode, p_metadata: metadata, p_occurred_at: new Date().toISOString(),
    })
  } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let admin: any = null
  let companyId: string | null = null
  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY saknas i Edge Function-secrets')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    const { document_id } = await req.json()
    if (!document_id) throw new Error('document_id saknas')

    // Verifiera att anroparen är inloggad. Vi validerar EXAKT den bearer-token som
    // skickades (getUser(token)) i stället för att förlita oss på klientens auth-state –
    // annars kan en giltig anon-nyckel passera plattformens verify_jwt men ge null user
    // här ("Ej inloggad"). Debug-logg loggar ALDRIG token, endast om header finns + user-id.
    const authHeader = req.headers.get('Authorization') || ''
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    console.log(`[tolka-underlag] auth_header_present=${bearer ? 'yes' : 'no'}`)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await userClient.auth.getUser(bearer || undefined)
    if (userErr || !user) {
      console.log(`[tolka-underlag] auth_failed reason=${userErr ? 'invalid_token' : 'no_user'}`)
      return new Response(JSON.stringify({ error: 'Ej inloggad' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    console.log(`[tolka-underlag] authed user_id=${user.id}`)

    admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Hämta dokumentet + kontrollera att användaren tillhör företaget.
    const { data: doc, error: docErr } = await admin.from('documents').select('*').eq('id', document_id).single()
    if (docErr || !doc) throw new Error('Underlaget hittades inte')
    companyId = doc.company_id

    const { data: member } = await admin.from('user_companies')
      .select('id').eq('user_id', user.id).eq('company_id', doc.company_id).maybeSingle()
    if (!member) return new Response(JSON.stringify({ error: 'Ingen åtkomst' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })

    // Ladda ner filen.
    const { data: fileData, error: dlErr } = await admin.storage.from('underlag').download(doc.storage_path)
    if (dlErr || !fileData) throw new Error('Kunde inte ladda ner filen')
    const base64 = blobToBase64(await fileData.arrayBuffer())
    const mimeType = doc.mime_type || 'application/pdf'

    // Hämta aktiva konton som underlag till konteringsförslaget.
    const { data: accounts } = await admin.from('accounts')
      .select('account_nr, name').eq('company_id', doc.company_id).eq('is_active', true).order('account_nr')
    const kontoplan = (accounts || []).map(a => `${a.account_nr} ${a.name}`).join('\n')

    const prompt = `Du är en svensk redovisningsexpert. Analysera det bifogade underlaget (faktura, kvitto eller insättningskvitto) och returnera strukturerad data enligt schemat.

Regler:
- Datum i formatet YYYY-MM-DD.
- Belopp som tal (punkt som decimal), inte text.
- Föreslå en korrekt kontering enligt BAS-kontoplanen där debet = kredit (balanserad verifikation).
- Använd ENDAST kontonummer som finns i kontoplanen nedan.
- För en leverantörsfaktura med moms: debet kostnadskonto (NETTO = summa exkl. moms), debet 2640 ingående moms (momsbeloppet), kredit 2440 leverantörsskulder (= "Att betala", totalt inkl. moms efter ev. öresavrundning).
- DUBBELRÄKNA ALDRIG: bokför kostnaden som EN nettorad. Om fakturan visar både enskilda fakturarader OCH en delsumma/"Summa exkl moms", använd ENBART delsumman (raderna ingår redan i den). Summan av alla debet-kostnadsrader måste vara exakt = netto (summa exkl moms).
- ÖRESAVRUNDNING: om fakturan har "Öresavrundning"/"Öresutjämning" (t.ex. −0,25), lägg en egen rad på konto 3740 Öres- och kronutjämning. Avrundat NEDÅT (negativt) => kredit 3740; uppåt (positivt) => debet 3740. 2440 ska krediteras med "Att betala", inte netto+moms.
- En rad får ALDRIG ha både debet och kredit – välj en sida.
- KONTROLLERA före svar: summa debet = summa kredit (annars justera). Kredit 2440 = beloppet "Att betala".
- För ett kontantkvitto: kreditera 1910 Kassa eller 1930 Företagskonto istället för 2440.
- För insättningskvitto (kontanter till banken): debet 1930 Företagskonto, kredit 1910 Kassa.
- Föredra 2640 Ingående moms (inte 2641) om båda finns i kontoplanen.
- Sätt momssats till 25, 12, 6 eller 0.
- beskrivning: kort, t.ex. leverantörens namn + vad det avser.
- fakturanummer: läs ut fakturans nummer (märkt "Fakturanummer", "Faktnr" eller liknande).
- ocr: läs ut OCR-numret som anges vid betalning (märkt "OCR" – ofta en längre sifferföljd, ibland samma som referens). Lämna tomt om det inte finns.
- org_nr: leverantörens organisationsnummer om det framgår.
- bankgiro/plusgiro/iban/bic: leverantörens betaluppgifter om de framgår.
- vat_nummer: leverantörens momsregistreringsnummer (VAT) om det framgår.
- leverantor_adress / leverantor_postnr / leverantor_ort / leverantor_land / leverantor_telefon / leverantor_epost / leverantor_webb: leverantörens (AVSÄNDARENS/säljarens) kontakt- och adressuppgifter.
- VIKTIGT: extrahera ALLTID leverantörens/säljarens uppgifter – ALDRIG mottagarens/köparens (den som fakturan är ställd till). Lämna fält tomma om de inte framgår.
- Blanda inte ihop fakturanummer och OCR – de är olika fält.

KONTOPLAN (aktiva konton):
${kontoplan}`

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
            temperature: 0,
            thinkingConfig: { thinkingBudget: 0 }, // stäng av reasoning -> snabbare
          },
        }),
      },
    )

    if (!geminiResp.ok) {
      const errText = await geminiResp.text()
      throw new Error(`Gemini-fel (${geminiResp.status}): ${errText.slice(0, 300)}`)
    }

    const gj = await geminiResp.json()
    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Tomt svar från Gemini')
    const result = JSON.parse(text)

    // Plan-enforcement (soft): registrera AI-användning + kontrollera/varna. Blockerar aldrig OCR.
    try {
      await admin.rpc('record_ai_usage', { p_company_id: companyId, p_kind: 'ocr' })
      await admin.rpc('enforce_plan_limit', { p_company_id: companyId, p_metric: 'ai' })
    } catch { /* soft – får ej stoppa tolkningen */ }
    await admin.rpc('record_worker_health', { p_component: 'tolka-underlag', p_ok: true, p_error: null })
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = String((err as Error)?.message || err)
    // Rapportera bara genuina systemfel – inte klient-/anroparfel (saknat id, ej inloggad, hittades inte).
    const clientErr = /document_id saknas|hittades inte|ingen åtkomst|ej inloggad/i.test(msg)
    if (!clientErr) {
      const { errorCode, severity } = classifyOcrError(msg)
      await reportOcrError(admin, errorCode, msg, severity, {}, companyId)
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
