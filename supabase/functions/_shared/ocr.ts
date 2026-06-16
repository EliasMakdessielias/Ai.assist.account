// Gemensam OCR-/tolkningslogik (Google Gemini) för edge functions.
//
// EN källa för schema, prompt och Gemini-anrop så att uppladdning (tolka-underlag) och
// inmejlade underlag (inbound-email) tolkar EXAKT likadant – ingen parallell/divergerande
// logik. categoryFromTolkning mappar resultatets `typ` till inkorgskategori (spegel av
// src/lib/classifyDocument.js – håll dem i synk).

// Strukturerat svar som Gemini ska returnera (svensk fakturatolkning + konteringsförslag).
export const OCR_SCHEMA = {
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
    invoice_type: { type: 'string', description: '"debit" för vanlig faktura, "credit" för kreditfaktura/kreditnota' },
    is_credit_invoice: { type: 'boolean', description: 'true om underlaget är en kreditfaktura/kreditnota' },
    credit_reason: { type: 'string', description: 'kort motivering om det är en kreditfaktura' },
    credit_evidence: { type: 'string', description: 'ordet/uttrycket som avgjorde, t.ex. "Kreditnota" eller "Att erhålla"' },
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
  required: ['beskrivning', 'konteringsrader', 'invoice_type'],
}

// Bygger prompten. `kontoplan` = "nr namn"-rader för företagets aktiva konton.
export function buildOcrPrompt(kontoplan: string): string {
  return `Du är en svensk redovisningsexpert. Analysera det bifogade underlaget (faktura, kvitto eller insättningskvitto) och returnera strukturerad data enligt schemat.

Regler:
- Datum i formatet YYYY-MM-DD.
- Belopp som tal (punkt som decimal), inte text.
- Föreslå en korrekt kontering enligt BAS-kontoplanen där debet = kredit (balanserad verifikation).
- Använd ENDAST kontonummer som finns i kontoplanen nedan.
- För en leverantörsfaktura med moms: debet kostnadskonto (NETTO = summa exkl. moms), debet 2640 ingående moms (momsbeloppet), kredit 2440 leverantörsskulder (= "Att betala", totalt inkl. moms efter ev. öresavrundning).
- FAKTURA ELLER KREDITFAKTURA: avgör uttryckligen om underlaget är en vanlig faktura ("debit") eller en kreditfaktura/kreditnota ("credit"). Sätt invoice_type, is_credit_invoice och credit_evidence (ordet/uttrycket som avgjorde, t.ex. "Kreditfaktura", "Kreditnota", "Kreditering", "Krediteras", "Att erhålla", "Credit note").
- KREDITFAKTURA: returnera belopp_inkl_moms och moms_belopp som NEGATIVA tal, och OMVÄND kontering: KREDIT kostnadskonto (netto), KREDIT ingående moms (2640/2641), DEBET 2440 leverantörsskulder (= beloppet "Att erhålla"/återbetalas). Summa debet = summa kredit ska fortfarande gälla (positiva belopp i debet/kredit-kolumnerna).
- Förväxla INTE kreditfaktura med betalkredit, kreditvillkor, kredittid, kreditgräns eller kreditkort – sådant gör INTE underlaget till en kreditfaktura.
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
- typ: sätt "leverantorsfaktura", "kvitto", "insattningskvitto" eller "ovrigt" beroende på vad underlaget är.

KONTOPLAN (aktiva konton):
${kontoplan}`
}

// MIME-typer Gemini kan läsa som bild/PDF. docx OCR:as inte (klassas på filnamn i stället).
const OCR_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
const OCR_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']

export function isOcrableFile(contentType?: string | null, filename?: string | null): boolean {
  const ct = String(contentType || '').toLowerCase()
  if (OCR_MIME.includes(ct)) return true
  const m = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return !!m && OCR_EXT.includes(m[1])
}

// Kör Gemini-OCR på en base64-kodad fil och returnerar strukturerad data enligt OCR_SCHEMA.
// Kastar vid fel (samma feltexter som tidigare så classifyOcrError fortsätter matcha).
export async function runGeminiOcr(
  { apiKey, base64, mimeType, kontoplan, timeoutMs = 30000 }:
  { apiKey: string; base64: string; mimeType: string; kontoplan: string; timeoutMs?: number },
): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildOcrPrompt(kontoplan) }, { inlineData: { mimeType, data: base64 } }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: OCR_SCHEMA,
            temperature: 0,
            thinkingConfig: { thinkingBudget: 0 }, // stäng av reasoning -> snabbare
          },
        }),
        signal: ctrl.signal,
      },
    )
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Gemini-fel (${resp.status}): ${errText.slice(0, 300)}`)
    }
    const gj = await resp.json()
    const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Tomt svar från Gemini')
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

// Mappar ett tolkningsresultats `typ` till inkorgskategori. Spegel av
// src/lib/classifyDocument.js:categoryFromTolkning. Returnerar { type, confidence, status }
// vid entydig typ, annars null (anroparen faller tillbaka på nyckelordsklassning).
export const OCR_TYPE_TO_CATEGORY: Record<string, string> = {
  leverantorsfaktura: 'leverantorsfaktura',
  kvitto: 'kvitto',
  insattningskvitto: 'kvitto',
}

export function categoryFromTolkning(result: any): { type: string; confidence: number; status: string } | null {
  const typ = String(result?.typ ?? '').trim().toLowerCase()
  const cat = OCR_TYPE_TO_CATEGORY[typ]
  if (!cat) return null
  return { type: cat, confidence: 0.95, status: 'classified' }
}
