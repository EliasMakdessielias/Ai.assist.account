# HANDOFF – var vi är i BokPilot-projektet

> **Till Claude på en ny dator:** Läs denna fil först. Den ger full kontext om
> projektet så vi kan fortsätta där vi slutade. (Användaren: Elias, svensktalande
> redovisningskonsult, byrån AcountX/AI Account Assist. Jobbar iterativt och testar
> varje steg. "kör"/"ja" = fortsätt med rekommendationen.)

## Vad det är
BokPilot (av REDOFLOW AB) – en svensk bokföringsapp (Visma eEkonomi/Spiris-stil). React 18 + Vite +
Tailwind + React Router + react-hot-toast. Backend: Supabase (Postgres, Auth, RLS,
Storage, Edge Functions). AI via Google Gemini (2.5-flash-lite) i edge functions.

- Repo: https://github.com/EliasMakdessielias/Ai.assist.account
- Live: https://bocker-app.vercel.app (auto-deploy från GitHub `main`, ~20 s)
- Supabase project ref: `bypebgvxdmbzxqecllao`

## Arbetssätt / konventioner
- **Bygg → `npm run build` (verifiera) → commit → `git push origin main`** efter varje ändring.
  Commit-meddelanden på svenska, avsluta med `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **DB-ändringar:** jag skriver SQL till en fil i `supabase/*.sql`, kopierar till urklipp
  (`pbcopy` på Mac), användaren kör den i Supabase SQL Editor och svarar "Success".
- **Edge functions deploy:** kräver tillfällig access-token. Användaren skapar en på
  supabase.com/dashboard/account/tokens, klistrar in i chatten, jag kör
  `supabase functions deploy <namn> --project-ref bypebgvxdmbzxqecllao`, sedan raderar
  användaren token. (Supabase CLI: `~/.local/share/supabase/supabase`.)
- Node finns lokalt; på Mac: `export PATH="$HOME/.local/node/bin:$PATH"`.
- RLS-mönster för company-tabeller: `company_id in (select user_company_ids())`.
- Verifikationsserier hämtas via `src/lib/serier.js` (`serie(company, key)`), konfigureras
  i Inställningar → Bokföringsuppgifter.

## Vad som är byggt (klart)
- **Bokföring:** verifikationer (Enter-nav, unik-prefix konto, rättelse + ändringslogg,
  kommentar), subflikar: Registrera dagskassa, Registrera kvitto, Stäm av konto
  (auto-matchningsförslag), Sök belopp. Moms flyttad till egen sida.
- **Moms:** fullständig SKV-deklaration (rutor A–I), bokför mot 2650.
- **Leverantörsfakturor:** Spiris-lista (statuschips), fullsides-editor (kontering,
  auto-balansering, öresutjämning 3740, Enter-nav, underlagspanel m. Koppla+Tolka),
  detaljvy med KOPPLADE BILDER, Utbetalningar-flik, Inkomna fakturor + Skicka för tolkning.
  Sökbar leverantörslista med "Skapa ny leverantör" + Hämta uppgifter från allabolag.se.
  Livscykel: radera bokförings-/betalningsverifikation → faktura återställs (DB-trigger).
- **Inkorg:** kategorier (kvitto/lev.faktura/dokument/avtal), unik mejla-in-adress,
  auto-tolkning, massbearbetning, skapa verifikation/faktura direkt.
- **Kassa och bank:** Spiris-layout, konto-rullista, period/datumfilter, smart unik
  matchning (OCR/bankgiro/fakturanr/namn), inline Matcha-modal, registrera/ångra
  utbetalningar, ta bort inläst fil (batch), smart kontering med minne.
- **Kontoanalys:** Huvudbok (IB/UB + löpande saldo) + Balans-/Resultaträkning.
- **Inställningar:** Företagsinställningar (4 flikar, allt i `companies.settings` jsonb),
  Kassa- och bankkonton, Import/export (CSV + SIE4 import/export), Kontoplan, Räkenskapsår,
  Användare & behörighet. Verifikationsserier inkopplade i bokföringen.
- **Superadmin:** godkännandegate (server-enforced), aktivera/avstänga/radera konton,
  nya företag seedas med BAS-kontoplan + räkenskapsår via trigger.
- **AI-svit:** fakturatolkning (`tolka-underlag`), AI-granskning (`granska-ai`),
  AI-assistent (`assistent-ai`), AI-ekonomichef (`ekonomichef-ai`), företagshämtning
  (`hamta-foretag`), smart bankmatchning + smart kontering (deterministiskt, ingen edge fn).

## Deployade edge functions
`tolka-underlag`, `granska-ai`, `assistent-ai`, `ekonomichef-ai`, `hamta-foretag`, `admin`.
Hemlighet `GEMINI_API_KEY` i Edge Function-secrets. (Användaren planerar flytta Gemini-nyckel
+ billing till ett företags-Google-konto.)

## Pågående / backlog-idéer
- AI-momsgranskning inför deklaration.
- Deklarations-/deadlinekalender (moms, AGI, F-skatt, årsredovisning).
- Bygga ut stub-sidor: Lön, Produkter, Kunder (delvis), Dashboard, Rapporter.
- Anpassa fler företagsinställningar att styra logik (öresavrundning, utskriftskryss).
- Egen domän/inbound-mail för riktig inmejlning till Inkorgen.

## Så fortsätter du på nya datorn
1. `git pull` (hämta senaste).
2. Be Claude läsa denna fil (`HANDOFF.md`) + `KOMIGÅNG.md`.
3. Fortsätt bygga – jag committar/pushar automatiskt efter varje ändring.
