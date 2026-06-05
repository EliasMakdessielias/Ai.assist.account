# Inbound-mottagningsadresser (arkiv.bokpilot.se)

Varje företag får automatiskt fyra **endast-inbound** adresser (exempel för
arkivnummer `7564841`):

```
7564841.kvi@arkiv.bokpilot.se   (kvitto)
7564841.lev@arkiv.bokpilot.se   (leverantörsfaktura)
7564841.dok@arkiv.bokpilot.se   (dokument)
7564841.avt@arkiv.bokpilot.se   (avtal)
```

Prefixet är företagets **`archive_number`** – ett SLUMPMÄSSIGT, unikt och permanent
7-siffrigt nummer (1000000–9999999) som sätts när företaget skapas och aldrig
ändras (avslöjar inte antal kunder, till skillnad från ett löpnummer). Adresserna
har **ingen brevlåda, inget lösenord och ingen utgående post** – de finns bara
som routing-mål för inkommande e-post.

## Arkitektur

```
Avsändare ──▶ MX (arkiv.bokpilot.se) ──▶ Cloudflare Email Routing
            ──▶ Email Worker (parsar + signerar HMAC)
            ──▶ POST https://<ref>.supabase.co/functions/v1/inbound-email
            ──▶ Edge function: verifierar signatur, slår upp företag/typ,
                lagrar bilagor i Storage (bucket `underlag`), skapar poster i
                `documents` (Inkorgen) + loggar i `inbound_email_log`.
```

Det interna webhook-kontraktet är **provider-agnostiskt** (JSON + HMAC), så valfri
inbound-provider (Mailgun Routes, SendGrid Inbound Parse, Postmark Inbound) kan
användas i stället för Cloudflare – relät behöver bara posta samma JSON och
beräkna signaturen.

## 1. DNS (Cloudflare)

Vi använder redan Cloudflare för zonen `bokpilot.se`. Aktivera **Email Routing**
och lägg MX för subdomänen `arkiv`:

```
MX   arkiv   route1.mx.cloudflare.net   (prio 13)
MX   arkiv   route2.mx.cloudflare.net   (prio 86)
MX   arkiv   route3.mx.cloudflare.net   (prio 24)
TXT  arkiv   "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

> Cloudflare ger de exakta MX-värdena när du aktiverar Email Routing. SPF/DKIM/DMARC
> för **utgående** post på huvuddomänen påverkas inte – `arkiv` används bara för mottagning.
> DMARC kan sättas på `_dmarc.arkiv` med `p=reject` (vi skickar aldrig från subdomänen).

Sätt en **catch-all**-route i Email Routing som triggar Email Workern nedan
(så att alla `*.{typ}@arkiv.bokpilot.se` fångas; okända adresser nekas i koden).

## 2. Cloudflare Email Worker

```js
// wrangler: [[email]] -> denna worker som catch-all för arkiv.bokpilot.se
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
2. Tolkar mottagaradressen → typ (`kvitto`/`leverantorsfaktura`/`dokument`/`avtal`).
   Okänd domän/typ → `inbound_email_log.status = 'rejected'`, svarar 200.
3. Slår upp `inbox_addresses` (måste finnas **och** vara `is_active`). Annars `rejected`.
4. Validerar varje bilaga (allowlist: pdf/jpg/jpeg/png/heic/heif/docx, max 25 MB,
   blockerar exe/zip/html/svg m.fl.). Giltiga laddas upp till `underlag` och får en
   `documents`-rad med `kategori` enligt typ, `source='email'`, `status='new'` samt
   `email_from/email_to/email_subject/email_body/received_at`.
5. Saknas giltiga bilagor → en `documents`-rad med `status='needs_review'` (kroppen sparas).
6. Allt loggas i `inbound_email_log`.

## 4. Inkorgs-flöde per typ

| Suffix | `documents.kategori` | Flöde i appen |
|---|---|---|
| `.kvi` | `kvitto` | Inkorg → Kvitton, kan AI-tolkas |
| `.lev` | `leverantorsfaktura` | Inkorg → Leverantörsfakturor, kan skickas till OCR/AI-tolkning |
| `.dok` | `dokument` | Inkorg → Dokument (sparas som dokumentunderlag, ej faktura) |
| `.avt` | `avtal` | Inkorg → Avtal (dokumentunderlag) |

Okänt arkivnummer eller suffix som inte är `kvi/lev/dok/avt` → loggas som
`rejected`, ingen inkorgspost skapas.

## 5. Säkerhet

- **Signaturverifiering** på webhooken (HMAC, delad hemlighet) – förfalskade anrop nekas.
- **Allowlist för mottagaradresser** – okända adresser/typer loggas som `rejected`.
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
