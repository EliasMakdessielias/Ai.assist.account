# BokPilot – inkommande underlag via Cloudflare Email Routing

Permanent, skalbar mottagning av e-postade underlag. **Inga brevlådor per företag.**
Alla adresser `{arkivnummer}underlag@bokpilot.se` tas emot av en enda catch-all i Cloudflare,
körs genom den här Email Worker:n, som parsar mejlet + bilagorna och POST:ar (HMAC-signerat)
till Supabase edge-funktionen `inbound-email`. Edge:n validerar arkivnumret mot
`inbox_addresses`, lagrar bilagorna och klassificerar dem. Ett flöde → obegränsat antal företag.

```
Avsändare ──▶ MX (Cloudflare) ──▶ Email Routing (catch-all) ──▶ denna Worker
   ──▶ POST (HMAC) ──▶ Supabase edge `inbound-email` ──▶ Storage + documents (Inkorgen)
```

## Engångsuppsättning

1. **Lägg bokpilot.se i Cloudflare** (flytta nameservers dit om det inte redan är gjort).
2. **Aktivera Email Routing** för zonen `bokpilot.se` (Cloudflare lägger till nödvändiga MX/TXT).
3. **Behåll vanliga adresser** (t.ex. `info@`, `support@`) som egna *Custom address*-regler som
   vidarebefordrar till era riktiga brevlådor – så att catch-all bara tar hand om underlag/okända.
4. **Deploya workern:**
   ```bash
   cd cloudflare/inbound-email-worker
   npm install
   npx wrangler login
   npx wrangler secret put INBOUND_EMAIL_WEBHOOK_SECRET   # SAMMA värde som edge-secret
   npx wrangler deploy
   ```
   Sätt samma secret på edge-sidan om den inte redan finns:
   `supabase secrets set INBOUND_EMAIL_WEBHOOK_SECRET=<värde>`
5. **Koppla catch-all → Worker:** Email Routing → *Catch-all address* → Action **Send to a Worker**
   → välj `bokpilot-inbound-email`. Aktivera catch-all.
6. **Testa:** mejla en PDF till t.ex. `<arkivnr>underlag@bokpilot.se` (arkivnumret står i appen
   under Inkorg). Bilagan ska dyka upp i rätt Inkorg-flik inom sekunder.

## Felsökning
- Studsar (550) → catch-all/MX ännu inte aktivt (steg 2/5).
- Levereras men syns inte i Inkorgen → kolla `npx wrangler tail` + Supabase-loggar för
  `inbound-email`. Vanliga svar: `unknown_archive_number` (fel/okänt arkivnr),
  `unauthorized` (secret matchar inte mellan worker och edge).
- Andra adresser än underlag avvisas medvetet (`Unknown recipient`).

## Noter
- `INBOUND_EDGE_URL` ligger i `wrangler.toml` (ej hemlig). Secret hanteras enbart via
  `wrangler secret` / Supabase secrets och checkas aldrig in.
- Adressformatet (`{arkivnr}underlag@bokpilot.se`) matchar både edge-funktionen och
  `src/lib/inboxAddresses.js`. Ändras formatet måste alla tre uppdateras.
