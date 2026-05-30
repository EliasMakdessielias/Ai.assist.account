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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY saknas i Edge Function-secrets')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    const { document_id } = await req.json()
    if (!document_id) throw new Error('document_id saknas')

    // Verifiera att anroparen är inloggad.
    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Ej inloggad' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Hämta dokumentet + kontrollera att användaren tillhör företaget.
    const { data: doc, error: docErr } = await admin.from('documents').select('*').eq('id', document_id).single()
    if (docErr || !doc) throw new Error('Underlaget hittades inte')

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
- För en leverantörsfaktura med moms: debet kostnadskonto (netto), debet 2640 ingående moms (momsbeloppet), kredit 2440 leverantörsskulder (totalt inkl moms).
- För ett kontantkvitto: kreditera 1910 Kassa eller 1930 Företagskonto istället för 2440.
- För insättningskvitto (kontanter till banken): debet 1930 Företagskonto, kredit 1910 Kassa.
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

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
