# Komma igång på en ny dator – BokPilot

Den här guiden tar dig från en ren dator till att appen kör lokalt och du kan
jobba vidare på projektet. Koden ligger på GitHub, din data ligger i Supabase
(molnet) – så ingenting tappas.

Repo: https://github.com/EliasMakdessielias/Ai.assist.account.git

---

## 1. Engångsinstallation (gör en gång per dator)

### a) Node.js (krävs)
- Gå till https://nodejs.org → ladda ner **LTS (20 eller senare)** → installera.
- Kontrollera i Terminal:
  ```bash
  node -v
  ```
  Ska visa t.ex. `v22.x` eller `v20.x`.

### b) Git (krävs för att hämta/spara kod)
- **Mac:** öppna Terminal och kör `git --version`. Saknas det dyker en ruta upp som installerar det (eller installera Xcode Command Line Tools).
- **Windows:** ladda ner från https://git-scm.com och installera.

### c) (Valfritt men enklast) GitHub Desktop
- Ladda ner https://desktop.github.com – ett grafiskt program för att hämta/spara
  kod utan terminal. Logga in med ditt GitHub-konto.

### d) (Valfritt) En kodredigerare
- VS Code: https://code.visualstudio.com

---

## 2. Hämta projektet från GitHub

### Alternativ A – GitHub Desktop (enklast)
1. Öppna GitHub Desktop → **File → Clone repository**.
2. Välj `EliasMakdessielias/Ai.assist.account` (eller klistra in repo-URL:en).
3. Välj en mapp på datorn → **Clone**.

### Alternativ B – Terminal
```bash
git clone https://github.com/EliasMakdessielias/Ai.assist.account.git
cd Ai.assist.account
```
> Är repot privat frågar Git efter inloggning. Enklast: installera GitHub CLI och kör `gh auth login`, eller använd GitHub Desktop (alt. A).

---

## 3. Skapa filen `.env`

I projektmappen (samma nivå som `package.json`), skapa en fil som heter exakt `.env`
med detta innehåll:

```
VITE_SUPABASE_URL=https://bypebgvxdmbzxqecllao.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cGViZ3Z4ZG1ienhxZWNsbGFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjc0MTYsImV4cCI6MjA5NTY0MzQxNn0.KMkfvKuzmFwYRiRYYeh16ggn_AJhgoNM16GhP_j_Vng
```

> Anon-nyckeln är publik och avsedd för frontend – ok att ha i klartext.
> `.env` laddas medvetet **inte** upp till GitHub (säkerhet), därför måste du skapa den manuellt på varje ny dator.

Skapa snabbt i Terminal (stå i projektmappen):
```bash
cat > .env <<'EOF'
VITE_SUPABASE_URL=https://bypebgvxdmbzxqecllao.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cGViZ3Z4ZG1ienhxZWNsbGFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjc0MTYsImV4cCI6MjA5NTY0MzQxNn0.KMkfvKuzmFwYRiRYYeh16ggn_AJhgoNM16GhP_j_Vng
EOF
```

---

## 4. Installera och starta

I projektmappen:
```bash
npm install      # installerar beroenden (görs en gång + när package.json ändrats)
npm run dev      # startar appen lokalt
```
Öppna adressen som visas, oftast **http://localhost:5173**.

Logga in med ditt vanliga konto – all bokföringsdata finns i Supabase-molnet.

---

## 5. Dagligt arbetsflöde (viktigt för att inte tappa ändringar)

Eftersom du kan jobba på flera datorer: **hämta senaste innan du börjar, spara när du är klar.**

- **Innan du börjar:**
  - GitHub Desktop: **Fetch/Pull origin**
  - eller Terminal: `git pull`
- **När du är klar:**
  - GitHub Desktop: skriv en rad om vad du gjort → **Commit** → **Push**
  - eller Terminal:
    ```bash
    git add -A
    git commit -m "Beskriv ändringen"
    git push
    ```

> Tumregel: en dator i taget. Pusha färdigt på den ena innan du fortsätter på den andra.

---

## 6. (Valfritt) Jobba med Claude på nya datorn
- Installera Claude i samma projektmapp och logga in med ditt Anthropic/Claude-konto.
- Chatthistoriken är lokal per dator. Den här filen + koden ger Claude kontext om projektet.

---

## 7. Felsökning
- **`command not found: npm`** → Node är inte installerat (steg 1a) eller starta om Terminal.
- **Vit sida / "Missing Supabase env"** → `.env` saknas eller har fel namn/innehåll (steg 3). Starta om `npm run dev` efter att du skapat den.
- **Port upptagen** → Vite väljer automatiskt en annan port; använd adressen som skrivs ut.
- **Kan inte pusha** → du är inte inloggad mot GitHub; använd GitHub Desktop eller `gh auth login`.
- **AI-funktioner svarar inte** → de körs i Supabase (molnet) och påverkas inte av din dator; om de strular är det oftast Gemini-kvot (vänta) eller en edge function som behöver omdeployas.

---

## Sammanfattning
1. Installera Node + Git
2. Klona repot
3. Skapa `.env`
4. `npm install` → `npm run dev`
5. `git pull` innan, `git push` efter
