# IMAP-import av underlag (Hostinger → BokPilot Inkorg)

Läser olästa mejl i Hostinger-mailboxen och importerar underlag till Inkorgen –
**utan att MX för bokpilot.se ändras** och **utan betald inbound-provider**.

```
Avsändare → MX (Hostinger, oförändrat) → mailbox underlag@bokpilot.se
  → [denna importer, schemalagd] läser via IMAP
  → POST till Supabase inbound-email (samma parsing/klassificering som direkttestet)
  → Inkorg (documents). Bearbetade mejl flyttas till "Processed", fel till "Failed".
```

## 1. Manuellt i Hostinger (hPanel → E-post)
1. **Skapa mailbox** `underlag@bokpilot.se` (sätt ett starkt lösenord).
2. **Fånga upp adresserna** – välj ETT:
   - **Catch-all:** aktivera catch-all för bokpilot.se → leverera till `underlag@bokpilot.se`.
     Då hamnar alla `{archiveNumber}underlag@bokpilot.se` (och övriga okända adresser) i mailboxen.
   - **Alias/forward:** skapa vidarebefordran `8063151underlag@bokpilot.se` → `underlag@bokpilot.se`
     (lägg till en per företag). Säkrare/renare än catch-all.
   > Övriga riktiga mailboxar (admin@, info@ …) påverkas inte.
3. **IMAP-uppgifter** (Hostinger): host `imap.hostinger.com`, port `993`, TLS. Användare =
   `underlag@bokpilot.se`, lösenord = mailboxens lösenord (Hostinger har normalt inte separata
   app-lösenord – använd mailbox-lösenordet). Kontrollera ev. exakt host i hPanel → E-post → Anslutningsinfo.

## 2. Miljövariabler (hemligheter – aldrig i kod/loggar)
Skapa `.env` i denna mapp (gitignoreras) **eller** sätt dem i schemaläggaren:
```
IMAP_HOST=imap.hostinger.com
IMAP_PORT=993
IMAP_USER=underlag@bokpilot.se
IMAP_PASSWORD=********              # mailboxens lösenord
IMAP_TLS=true
INBOUND_WEBHOOK_URL=https://bypebgvxdmbzxqecllao.supabase.co/functions/v1/inbound-email
INBOUND_EMAIL_WEBHOOK_SECRET=********   # samma secret som edge-funktionen
# valfritt: IMAP_MAILBOX=INBOX  IMAP_PROCESSED=Processed  IMAP_FAILED=Failed
```

## 3. Installera & kör
```bash
cd scripts/imap-import
npm install
node index.mjs        # läser olästa, importerar, flyttar till Processed/Failed
```

## 4. Schemalägg (var 5:e minut)
**Windows (samma mönster som BockerAutoSync):**
```powershell
$action  = New-ScheduledTaskAction -Execute 'node' -Argument 'C:\Projekt\bocker-app\scripts\imap-import\index.mjs' -WorkingDirectory 'C:\Projekt\bocker-app\scripts\imap-import'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'BokPilotUnderlagImport' -Action $action -Trigger $trigger -Description 'IMAP-import av underlag'
```
**Linux/server (cron):** `*/5 * * * * cd /path/scripts/imap-import && node index.mjs >> import.log 2>&1`

> Vill du ha det helt molnbaserat (alltid på, oberoende av en dator) kan importern
> senare flyttas till en liten server/Cloud Run / Supabase-schemalagd funktion –
> samma kod och webhook återanvänds.

## Hur kraven uppfylls
- **Endast olästa** mejl läses; efter import markeras de `\Seen` och flyttas till `Processed`
  (fel → `Failed`) → **idempotent**. Webhooken dedupar dessutom på **Message-ID**.
- **Mottagaren** läses ur To/Cc/Delivered-To/X-Original-To; endast `{archiveNumber}underlag@bokpilot.se`
  accepteras, annars flyttas mejlet till `Failed` utan att skapa Inkorg-post.
- **Flera bilagor** → webhooken skapar **en Inkorg-post per bilaga** med klassificering + confidence.
- **`source = "hostinger-imap"`** och **`inbound_message_id`** sparas på varje post; loggas i `inbound_email_log`.
- **Inga känsliga uppgifter loggas** (endast uid/status).
