# Redo Flow – Bokföring & ekonomi

En modern bokföringsapp byggd med React + Supabase, inspirerad av Fortnox.

## Funktioner

- **Bokföring** – Skapa och visa verifikationer med Enter-navigation, kontoautocomplete och auto-balansering
- **Kontoplan** – BAS 2026 med alla 1367 konton, sök/filter/paginering
- **Fakturor** – Kundfordringar med statushantering
- **Leverantörsfakturor** – Inkommande fakturor
- **Kassa och bank** – Kontosaldon och banksynk
- **Lön** – Löneunderlag med skatt och arbetsgivaravgifter
- **Moms** – Momsrapport med SKV-rutor
- **Rapporter** – Resultaträkning, balansräkning, kassaflöde
- **Kunder & Leverantörer** – Kundregister med org.nr och kontaktuppgifter
- **Inställningar** – Företagsinfo, kontoplan, räkenskapsår

## Teknikstack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend/Databas**: Supabase (PostgreSQL + Auth + RLS)
- **Hosting**: Vercel (gratis)

## Installation

### 1. Skapa Supabase-projekt

1. Gå till [supabase.com](https://supabase.com) och skapa ett konto (gratis)
2. Klicka **New project**
3. Välj namn (t.ex. "bocker"), lösenord och region (EU West)
4. Vänta tills projektet skapats

### 2. Kör databasschema

1. I Supabase, gå till **SQL Editor**
2. Klistra in innehållet från `supabase/schema.sql` och kör
3. Klistra in innehållet från `supabase/seed_accounts.sql` och kör (importerar BAS 2026)

### 3. Hämta API-nycklar

1. I Supabase, gå till **Settings → API**
2. Kopiera **Project URL** och **anon/public key**

### 4. Installera och starta

```bash
# Klona/ladda ner projektet
cd bocker-app

# Installera beroenden
npm install

# Skapa .env-fil
cp .env.example .env
# Redigera .env och klistra in dina Supabase-nycklar:
# VITE_SUPABASE_URL=https://ditt-projekt.supabase.co
# VITE_SUPABASE_ANON_KEY=din-anon-nyckel

# Starta utvecklingsserver
npm run dev
```

Öppna http://localhost:5173 i webbläsaren.

### 5. Skapa ditt första konto

1. Klicka **Skapa konto** på inloggningssidan
2. Fyll i företagsnamn, org.nr, e-post och lösenord
3. Kontrollera e-post för verifiering (kan stängas av i Supabase → Auth → Settings)

## Publicera på Vercel (gratis)

```bash
# Installera Vercel CLI
npm i -g vercel

# Publicera
vercel

# Följ instruktionerna och ange environment variables:
# VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY
```

Eller:
1. Pusha till GitHub
2. Gå till [vercel.com](https://vercel.com)
3. Importera ditt GitHub-repo
4. Lägg till environment variables
5. Klicka Deploy

## Projektstruktur

```
bocker-app/
├── index.html              # Vite entry
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── supabase/
│   ├── schema.sql          # Databasschema (tabeller + RLS)
│   └── seed_accounts.sql   # BAS 2026 kontoplan (1367 konton)
└── src/
    ├── main.jsx            # React entry
    ├── App.jsx             # Router + auth
    ├── index.css           # Tailwind + custom CSS
    ├── lib/
    │   └── supabase.js     # Supabase client
    ├── hooks/
    │   └── useAuth.jsx     # Auth context + hooks
    ├── components/
    │   ├── Layout.jsx      # Sidebar + content layout
    │   └── Sidebar.jsx     # Sidofält med navigation
    └── pages/
        ├── Login.jsx       # Inloggning / Registrering
        ├── Dashboard.jsx   # Översikt med nyckeltal
        ├── Bokforing.jsx   # Verifikationslista med subtabs
        ├── NyVerifikation.jsx  # Skapa verifikation
        ├── VisaVerifikation.jsx # Visa bokförd verifikation
        ├── Kontoplan.jsx   # Kontoplan med sökning
        ├── KontoDetalj.jsx # Kontodetalj / Skapa konto
        ├── Fakturor.jsx
        ├── Leverantorsfakturor.jsx
        ├── KassaBank.jsx
        ├── Lon.jsx
        ├── Rapporter.jsx
        ├── Moms.jsx
        ├── Kunder.jsx
        ├── Leverantorer.jsx
        ├── Produkter.jsx
        └── Installningar.jsx
```

## Säkerhet

- **Row Level Security (RLS)** – varje användare ser bara sitt eget företags data
- **Supabase Auth** – säker autentisering med JWT
- **HTTPS** – automatiskt via Vercel
- **Bokföringslagen** – verifikationer låses efter bokföring (is_locked = true)

## Nästa steg

Sidor som behöver byggas ut fullt:
- Fakturor (skapa, PDF-generering)
- Leverantörsfakturor (import, betalning)
- Kassa och bank (banksynk)
- Lön (löneberäkning)
- Moms (SKV-export)
- Rapporter (resultat/balansräkning)

## Licens

Privat projekt.
