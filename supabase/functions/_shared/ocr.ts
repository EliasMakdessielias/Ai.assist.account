// Gemensam OCR-/tolkningslogik (Google Gemini) för edge functions.
//
// EN källa för schema, prompt och Gemini-anrop så att uppladdning (tolka-underlag) och
// inmejlade underlag (inbound-email) tolkar EXAKT likadant – ingen parallell/divergerande
// logik. categoryFromTolkning mappar resultatets `typ` till inkorgskategori (spegel av
// src/lib/classifyDocument.js – håll dem i synk).

// Modell + promptversion – lagras i tolkningsresultatets _meta för spårbarhet (vilken modell/
// prompt som gav vilket resultat). Bumpa OCR_PROMPT_VERSION när prompten/schemat ändras.
export const OCR_MODEL = 'gemini-2.5-flash-lite'
export const OCR_PROMPT_VERSION = 'v4-2026-06-dagskassa'

// Kritiska fält som får per-fält-säkerhet (0–1) och som styr granskningsspärren i UI.
export const OCR_CONFIDENCE_FIELDS = ['leverantor', 'fakturadatum', 'forfallodatum', 'belopp_inkl_moms', 'moms_belopp', 'fakturanummer', 'ocr'] as const

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
    typ: { type: 'string', description: 'leverantorsfaktura, kvitto, dagskassa, insattningskvitto, avtal, dokument eller ovrigt (se klassificeringsreglerna i prompten)' },
    dagskassa: {
      type: 'object',
      description: 'Fylls ENDAST när typ="dagskassa" (dagsrapport/Z-rapport från säljarens eget kassaregister). Säljarens egen kassaförsäljning.',
      properties: {
        datum: { type: 'string', description: 'Försäljningsdatum YYYY-MM-DD (rapportens datum)' },
        forsaljning_25: { type: 'number', description: 'Varugruppförsäljning EXKL moms, 25 % moms' },
        forsaljning_12: { type: 'number', description: 'Varugruppförsäljning EXKL moms, 12 % moms' },
        forsaljning_6: { type: 'number', description: 'Varugruppförsäljning EXKL moms, 6 % moms' },
        forsaljning_0: { type: 'number', description: 'Momsfri varugruppförsäljning (0 %)' },
        moms_25: { type: 'number', description: 'Utgående moms 25 %' },
        moms_12: { type: 'number', description: 'Utgående moms 12 %' },
        moms_6: { type: 'number', description: 'Utgående moms 6 %' },
        kontant: { type: 'number', description: 'Kontant betalning (kassa)' },
        kort: { type: 'number', description: 'Kortbetalning' },
      },
    },
    falt_sakerhet: {
      type: 'object',
      description: 'Din säkerhet 0–1 per kritiskt fält (kalibrerad och ärlig). Lägre för handskrivet/suddigt/härlett, 0 om fältet saknas i underlaget.',
      properties: {
        leverantor: { type: 'number' },
        fakturadatum: { type: 'number' },
        forfallodatum: { type: 'number' },
        belopp_inkl_moms: { type: 'number' },
        moms_belopp: { type: 'number' },
        fakturanummer: { type: 'number' },
        ocr: { type: 'number' },
      },
    },
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
  required: ['beskrivning', 'konteringsrader', 'invoice_type', 'falt_sakerhet'],
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
- DUBBELRÄKNA ALDRIG: bokför kostnaden som EN nettorad per momssats. Om fakturan visar både enskilda fakturarader OCH en delsumma/"Summa exkl moms", använd ENBART delsumman (raderna ingår redan i den). Summan av alla debet-kostnadsrader måste vara exakt = netto (summa exkl moms).
- FLERA MOMSSATSER (mycket vanligt på kvitton): om underlaget har en momssammanställning med flera satser – t.ex. tabellen "Moms% / Moms / Netto / Brutto" med rader för 6 %, 12 % och/eller 25 % – skapa EN kostnadsrad (debet) per momssats med respektive NETTO-belopp på lämpligt kostnadskonto (livsmedel/varor ofta 6 % → 4000; övrigt/förbrukning 25 % → 5400 eller annat passande konto i kontoplanen), och bokför den TOTALA ingående momsen (summan av ALLA moms-rader) på 2640. Tappa ALDRIG bort en momssats även om beloppet är litet. Summan av alla netto-rader + summan av all moms MÅSTE bli exakt totalbeloppet (Brutto/Total/"Köp").
- ÖRESAVRUNDNING: om fakturan har "Öresavrundning"/"Öresutjämning" (t.ex. −0,25), lägg en egen rad på konto 3740 Öres- och kronutjämning. Avrundat NEDÅT (negativt) => kredit 3740; uppåt (positivt) => debet 3740. 2440 ska krediteras med "Att betala", inte netto+moms.
- En rad får ALDRIG ha både debet och kredit – välj en sida.
- KONTROLLERA FÖRE SVAR (obligatoriskt): (1) summa debet = summa kredit; (2) summan av alla netto-kostnadsrader + ingående moms = totalbeloppet inkl. moms; (3) ingen momssats är bortglömd. Stämmer det inte – justera tills det balanserar. Kredit 2440/1910/1930 = beloppet "Att betala"/"Total"/"Köp".
- För ett kontantkvitto: kreditera 1910 Kassa eller 1930 Företagskonto istället för 2440.
- För insättningskvitto (kontanter till banken): debet 1930 Företagskonto, kredit 1910 Kassa.
- DAGSKASSA / Z-RAPPORT (mycket viktigt – förväxla INTE med inköpskvitto): om underlaget är en dagsrapport/Z-rapport/kassaredovisning från säljarens EGET kassaregister (känns igen på t.ex. "Z-rapport", "Z 1", "dagsrapport", "FULL RAPPORT", "VGR TOTAL", "EJ KVITTO", "EJ KVITTO PÅ KÖP", momssammanställning med "MOMSPL"/varugrupper) är det säljarens EGEN FÖRSÄLJNING (utgående moms), INTE ett inköp. Sätt då typ="dagskassa" och fyll fältet "dagskassa": datum, forsaljning_25/12/6/0 (varugruppförsäljning EXKL moms per momssats), moms_25/12/6 (utgående moms per momssats), kontant och kort (betalsätt). Bokför konteringsrader som FÖRSÄLJNING: KREDIT 3001 (25%)/3002 (12%)/3003 (6%)/3004 (momsfri) med nettobeloppen, KREDIT 2611 (25%)/2621 (12%)/2631 (6%) med utgående moms, DEBET 1910 Kassa (kontant) och DEBET 1580 (kort). Bokför ALDRIG ingående moms (2640) eller inköp (4xxx) för en dagskassa. Om kontant+kort ≠ försäljning+moms: lägg differensen som kassadifferens på 3790 (debet vid manko, kredit vid överskott) så att debet = kredit.
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
- falt_sakerhet: ange din säkerhet 0–1 för varje kritiskt fält (leverantor, fakturadatum, forfallodatum, belopp_inkl_moms, moms_belopp, fakturanummer, ocr). 1.0 = tydligt tryckt och otvetydigt; 0.80–0.94 = något otydligt eller delvis dolt; under 0.80 = härlett, handskrivet, suddigt eller en gissning; 0 = fältet saknas i underlaget. Var ÄRLIG och kalibrerad – handskrivna, suddiga eller gissade värden MÅSTE få lägre säkerhet så att en människa kan granska dem.

DOKUMENTTYP (fältet "typ") – klassificera underlaget. Detta styr var det sorteras, så följ reglerna noga:
- "kvitto": ett kassakvitto/butikskvitto som betalats DIREKT på plats (kort/kontant/swish). Känns igen på t.ex. "Kvitto", "Kassakvitto", "Köp", "ATT BETALA", "Köpbelopp", kortterminal-/betalrader (Kort, Kontaktlös, Mastercard/Visa, TERM, AID, ARQC), saknar namngiven köpare och saknar förfallodatum/OCR-nummer/bankgiro/plusgiro. Ett kassakvitto är en FÖRENKLAD FAKTURA och fullt giltigt underlag – men klassas alltid som "kvitto", ALDRIG "leverantorsfaktura", även om det har säljarens org.nr och momsspecifikation.
- "leverantorsfaktura": en faktura som är STÄLLD TILL köparen (företaget) och ska betalas SENARE. Enligt Skatteverkets krav på en fullständig faktura innehåller den normalt: fakturadatum (utfärdandedatum), ett unikt fakturanummer (löpnummer), säljarens momsregistreringsnummer, köparens namn och adress, varornas mängd/art eller tjänsternas omfattning/art, beskattningsunderlag per momssats samt momssats och momsbelopp – OCH betalningsuppgifter som förfallodatum och/eller OCR-nummer, bankgiro/plusgiro/IBAN. Avgörande skillnad mot kvitto: ställd till en namngiven köpare + ska betalas senare (förfallodatum/OCR/bankgiro), inte betald på plats.
- "dagskassa": en dagsrapport/Z-rapport/kassaredovisning från säljarens EGET kassaregister (säljarens egen dagsförsäljning), t.ex. "Z-rapport", "dagsrapport", "FULL RAPPORT", "VGR TOTAL", "EJ KVITTO PÅ KÖP", momssammanställning per varugrupp. Detta är INTE ett inköpskvitto – det är företagets egen försäljning som ska registreras som dagskassa.
- "insattningskvitto": kvitto på kontantinsättning till bank.
- "avtal": ett avtal eller kontrakt (t.ex. orden "Avtal", "Kontrakt", "Agreement", angivna parter, villkor, giltighetstid, underskrifter).
- "dokument": annat affärsdokument som varken är kvitto, leverantörsfaktura, insättningskvitto eller avtal.
- "ovrigt": använd ENDAST om underlaget är oläsligt eller du inte säkert kan avgöra typen.
- BESLUTSREGEL: dagsrapport/Z-rapport från eget kassaregister (egen försäljning) => "dagskassa". Betalt direkt på plats vid ett INKÖP, utan förfallodatum/OCR/fakturanummer-ställt-till-köpare => "kvitto". Ställd till köparen med fakturanummer och förfallodatum/OCR/bankgiro => "leverantorsfaktura".

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
// Modell-fallback vid tillfällig överbelastning/rate limit (429/500/503): modellerna har
// separata RPM/TPM-pooler → en fallback lyckas oftast när en är full.
export const OCR_MODELS = [OCR_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash']

export async function runGeminiOcr(
  { apiKey, base64, mimeType, kontoplan, timeoutMs = 30000 }:
  { apiKey: string; base64: string; mimeType: string; kontoplan: string; timeoutMs?: number },
): Promise<any> {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildOcrPrompt(kontoplan) }, { inlineData: { mimeType, data: base64 } }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: OCR_SCHEMA,
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 }, // stäng av reasoning -> snabbare
    },
  })
  let gj: any = null, usedModel = '', lastStatus = 0, lastText = ''
  for (const model of OCR_MODELS) {
    // Två försök per modell: rider ut korta 429/503-toppar (per-minut-gräns) med backoff.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(res => setTimeout(res, 1500))
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal },
        )
        if (resp.ok) { gj = await resp.json(); usedModel = model; break }
        lastStatus = resp.status; lastText = (await resp.text().catch(() => '')).slice(0, 300)
      } catch (e) {
        // Timeout (abort) eller nätverksfel: fånga så att vi kan falla tillbaka till nästa modell
        // i stället för att avbryta hela tolkningen.
        lastStatus = 0; lastText = String((e as Error)?.message || e)
      } finally {
        clearTimeout(timer)
      }
      // Omförsök samma modell endast vid tillfällig överbelastning; annars vidare till nästa modell.
      if (![429, 500, 503].includes(lastStatus)) break
    }
    if (gj) break
    // Fortsätt ALLTID till nästa modell om denna inte gav svar (även vid timeout/hårt fel).
  }
  if (!gj) {
    // Behåll feltexten så classifyOcrError fortsätter klassa 429/quota/timeout korrekt.
    throw new Error(`Gemini-fel (${lastStatus}): ${String(lastText).slice(0, 300)}`)
  }
  const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Tomt svar från Gemini')
  const parsed = JSON.parse(text)
  // Spårbarhet: vilken modell/promptversion gav resultatet (lagras i documents.tolkning).
  parsed._meta = { model: usedModel, promptVersion: OCR_PROMPT_VERSION, extractedAt: new Date().toISOString() }
  return parsed
}

// Mappar ett tolkningsresultats `typ` till inkorgskategori. Spegel av
// src/lib/classifyDocument.js:categoryFromTolkning. Returnerar { type, confidence, status }
// vid entydig typ, annars null (anroparen faller tillbaka på nyckelordsklassning /
// "Behöver granskas"). "ovrigt" mappas medvetet INTE → null.
export const OCR_TYPE_TO_CATEGORY: Record<string, string> = {
  leverantorsfaktura: 'leverantorsfaktura',
  kvitto: 'kvitto',
  dagskassa: 'dokument',
  insattningskvitto: 'kvitto',
  avtal: 'avtal',
  dokument: 'dokument',
}

export function categoryFromTolkning(result: any): { type: string; confidence: number; status: string } | null {
  const typ = String(result?.typ ?? '').trim().toLowerCase()
  const cat = OCR_TYPE_TO_CATEGORY[typ]
  if (!cat) return null
  return { type: cat, confidence: 0.95, status: 'classified' }
}
