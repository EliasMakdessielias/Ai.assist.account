# Inbound-mottagningsadress (bokpilot.se)

Varje företag får automatiskt **EN endast-inbound** adress. Format:
`{archiveNumber}underlag@bokpilot.se` (exempel):

```
806351underlag@bokpilot.se
```

Prefixet är företagets **`archive_number`** – ett SLUMPMÄSSIGT, unikt och permanent
7-siffrigt nummer (1000000–9999999) som sätts när företaget skapas och aldrig
ändras (avslöjar inte antal kunder, till skillnad från ett löpnummer). Adressen
har **ingen brevlåda, inget lösenord och ingen utgående post** – den finns bara
som routing-mål för inkommande e-post. Varje **bilaga klassificeras automatiskt**
(kvitto / leverantörsfaktura / kundfaktura / dokument / avtal / okänd) vid mottagning.

## Arkitektur

```
Avsändare ──▶ MX (arkiv.bokpilot.se) ──▶ Cloudflare Email Routing
            ──▶ Email Worker (parsar + signerar HMAC)
            ──▶ POST https://<ref>.supabase.co/functions/v1/inbound-email
            ──▶ Edge function: verifierar signatur, slår upp företag via arkivnummer,
                validerar + lagrar varje bilaga i Storage (bucket `underlag`),
                KLASSIFICERAR per bilaga, skapar EN post per bilaga i `documents`
                (Inkorgen) med detectedType/confidence/status + loggar i `inbound_email_log`.
```

Det interna webhook-kontraktet är **provider-agnostiskt** (JSON + HMAC), så valfri
inbound-provider (Mailgun Routes, SendGrid Inbound Parse, Postmark Inbound) kan
användas i stället för Cloudflare – relät behöver bara posta samma JSON och
beräkna signaturen.

## 1. DNS / e-postinfrastruktur (KRÄVER BESLUT – krav 12–15)

Adressen är `{archiveNumber}underlag@bokpilot.se` på **apex** `bokpilot.se`.

> ⚠️ **MX är domänomfattande – det går INTE att routa enbart `…underlag@bokpilot.se`
> till webhooken och låta övrig @bokpilot.se ligga kvar på Hostinger via MX.** Apexen
> har `MX → mx1/mx2.hostinger.com` (befintlig e-post, inkl. inloggningen
> `admin@bokpilot.se`). All apex-post följer samma MX. Per krav 14: **apex-MX rörs inte.**

Två säkra sätt att ändå få `…underlag@bokpilot.se` att tas emot (välj ett):

1. **Hostinger-forward (apex-MX orört, säkrast).** Hostinger fortsätter vara MX för
   apex. I Hostingers e-postpanel skapas en forward/catch-all-regel som vidarebefordrar
   `*underlag@bokpilot.se` till en inbound-parse-adress hos en provider (Mailgun/Postmark)
   som postar till webhooken nedan. Övriga @bokpilot.se-mailboxar påverkas inte.
2. **Flytta ALL @bokpilot.se till en provider/Cloudflare** som både levererar/forwardar
   befintliga adresser OCH catch-all:ar `*underlag@` till webhooken. Då blir Hostinger-
   mailboxarna forward-only (apex-MX byts) – kräver lista på alla befintliga adresser.

Alternativ fallback (om apex inte kan lösas säkert): kör adressen på en **subdomän**
(`…underlag@in.bokpilot.se`) med egen MX → provider. Apex orört. (Kräver formatändring
→ endast efter godkännande, krav 15.)

## 2. Cloudflare Email Worker

```js
// wrangler: [[email]] -> denna worker som catch-all för bokpilot.se
import PostalMime from 'postal-mime'

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw)
    const attachments = []
    for (const a of parsed.attachments || []) {
      const bytes = a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : a.content
      let bin = ''; for (const b of bytes) bin += String.fromCharCode(b)
      attachments.push({
        filename: a.filename || 'bilaga',
        contentType: a.mimeType || 'application/octet-stream',
        size: bytes.length,
        contentBase64: btoa(bin),
      })
    }
    const body = JSON.stringify({
      to: message.to,                       // mottagaradressen (routing-nyckel)
      from: message.from,
      subject: parsed.subject || '',
      text: parsed.text || '',
      attachments,
    })
    // HMAC-SHA256 över rå body med delad hemlighet
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.INBOUND_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')

    await fetch(env.INBOUND_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bokpilot-Signature': `sha256=${hex}` },
      body,
    })
  },
}
```

Worker-secrets: `INBOUND_WEBHOOK_SECRET` (samma som i Supabase) och
`INBOUND_WEBHOOK_URL` = `https://bypebgvxdmbzxqecllao.supabase.co/functions/v1/inbound-email`.

## 3. Supabase edge function

```bash
# Sätt den delade hemligheten
supabase secrets set INBOUND_WEBHOOK_SECRET=<lång slumpsträng> --project-ref bypebgvxdmbzxqecllao
# Deploy UTAN jwt-verifiering (webhooken autentiseras via HMAC, inte JWT)
supabase functions deploy inbound-email --no-verify-jwt --project-ref bypebgvxdmbzxqecllao
```

Funktionen (`supabase/functions/inbound-email/index.ts`):

1. Verifierar `X-Bokpilot-Signature` (HMAC-SHA256, konstant-tids-jämförelse).
2. Tolkar mottagaradressen → arkivnummer (`{archiveNumber}.ulag@arkiv.bokpilot.se`).
   Okänd domän/format → `inbound_email_log.status = 'rejected'`, svarar 200.
3. Slår upp `inbox_addresses` (måste finnas **och** vara `is_active`). Annars `rejected`.
4. Per bilaga: validerar (allowlist pdf/jpg/jpeg/png/heic/heif/docx, max 25 MB,
   blockerar exe/zip/html/svg m.fl.), laddar upp till `underlag`, **klassificerar**
   (filnamn/MIME/ämne/text) och skapar EN `documents`-rad med `kategori`=detekterad
   typ, `confidence`, `status` (classified/needs_review), `source='email'` +
   `email_from/email_to/email_subject/email_body/received_at`.
5. Filtyp som ej stöds → rad med `status='unsupported'`. Farlig/för stor → hoppas
   över (loggas). Inga bilagor → en rad med `status='needs_review'` (kroppen sparas).
6. Allt loggas i `inbound_email_log`.

## 4. Klassificering (per bilaga)

| Detekterad `kategori` | Signaler (filnamn/ämne/text/OCR) | Flöde i appen |
|---|---|---|
| `kvitto` | kvitto, receipt, butik, kortköp, betaldatum, moms | Inkorg → Kvitton, kan AI-tolkas |
| `leverantorsfaktura` | faktura, invoice, OCR, bankgiro, plusgiro, förfallodatum, fakturanr | Inkorg → Leverantörsfakturor, kan OCR/AI-tolkas |
| `kundfaktura` | kundfaktura, utgående faktura | Inkorg → Kundfakturor |
| `avtal` | avtal, kontrakt, agreement, signerat, parter | Inkorg → Avtal |
| `dokument` | övriga administrativa filer | Inkorg → Dokument |
| `okand` | osäkert / inga signaler | Inkorg → **Behöver granskas** (`needs_review`) |

`confidence ≥ 0.6` → `status='classified'`, annars `needs_review`. Användaren kan
ändra kategori manuellt i Inkorgen (kategori-väljaren per rad). Okänt arkivnummer →
`rejected`, ingen inkorgspost. Logiken finns i `src/lib/classifyDocument.js` (testad)
och en spegel i edge-funktionen.

## 5. Säkerhet

- **Signaturverifiering** på webhooken (HMAC, delad hemlighet) – förfalskade anrop nekas.
- **Allowlist för arkivnummer** – okända nummer/format loggas som `rejected`.
- **Filtypsallowlist + storleksgräns** + blocklist för farliga ändelser.
- **Endast service-role** (edge function) får skriva `inbox_addresses`/`inbound_email_log`;
  vanliga användare kan bara läsa sina egna och toggla `is_active` (adressformatet är
  låst av en DB-trigger).
- Adresserna kan **inte** användas för inloggning eller utgående e-post (ingen brevlåda finns).

## 6. Alternativa providers

Samma JSON-kontrakt fungerar med valfri inbound-provider – relät (eller en tunn
proxy-funktion) måste posta `{to, from, subject, text, attachments[]}` och sätta
`X-Bokpilot-Signature`. För providers med egen signatur (t.ex. Mailguns
`timestamp/token/signature`) kan man i stället verifiera deras signatur och hoppa
över HMAC – byt ut steg 1 i edge-funktionen.
