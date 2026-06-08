# Folio-OCR — valfri, sekundär OCR-provider

Folio-OCR ([vorojar/Folio-OCR](https://github.com/vorojar/Folio-OCR)) är integrerad i BokPilot som
en **valfri, experimentell sekundär OCR-provider** via en plug-in/adapter-arkitektur. Den
**ersätter aldrig** det befintliga produktionsflödet (Gemini via `tolka-underlag`). Den är
**avstängd som standard** och kan aktiveras, testas och tas bort utan att påverka befintlig
funktionalitet.

> TL;DR: Allt OCR i produktion går fortfarande genom Gemini. Folio är ett opt-in-verktyg
> som operations-admins kan testa mot enskilda dokument. Sätt inte `ENABLE_FOLIO_OCR=true`
> i produktion förrän kriterierna längst ner är uppfyllda.

---

## Arkitektur

| Del | Plats | Tagg |
| --- | --- | --- |
| Provider-kontrakt, normalisering, flaggor, fallback-orkestrering | `src/lib/ocr/ocrProviders.js` | `[OCR_PROVIDER_ARCHITECTURE]`, `[OCR_FALLBACK]` |
| Isolerad adapter/proxy mot Folio-tjänsten | `supabase/functions/ocr-folio/index.ts` | `[FOLIO_OCR_EXPERIMENTAL_PROVIDER]` |
| Admin-testverktyg (Gemini vs Folio) | `src/pages/OcrTest.jsx` (`/admin/ocr-test`) | — |
| Health-integration | `worker_health` via `record_worker_health('folio-ocr', …)` + Systemövervakning | — |

- **Primary** = `gemini` (befintligt `tolka-underlag`-flöde, helt orört).
- **Secondary** = `folio_ocr` (används endast om aktiverad).
- Folio körs som en **separat tjänst** (egen container/worker, t.ex. FastAPI + GLM-OCR/Ollama).
  BokPilot anropar den ALDRIG direkt från browsern — allt går via edge-funktionen `ocr-folio`
  så att bas-URL och ev. API-secret stannar server-side.
- BokPilot **äger all lagring** (Supabase Storage + Postgres). Folio anropas stateless
  (`persist:false`) och ska inte spara kunddata permanent. Folios egen SQLite är endast
  transient/cache och är **inte** BokPilots databas.

### Adapter-kontrakt (vad Folio-tjänsten måste exponera)

Folios nativa API är flerstegs + SSE. BokPilot förväntar sig istället ett enkelt kontrakt;
lägg vid behov en tunn shim framför Folio som översätter:

```
POST {FOLIO_OCR_BASE_URL}/ocr
  headers: X-Api-Key: <FOLIO_OCR_API_SECRET?>
  body:    { filename, mimeType, contentBase64, persist: false }
  -> 200   { text, pages: [{ page, text, blocks }], confidence }

GET  {FOLIO_OCR_BASE_URL}/health   -> 200 om tjänsten är uppe
```

Svaret normaliseras till BokPilots gemensamma format (krav 10):
`{ providerName, rawText, pages, layoutBlocks, confidence, processingTimeMs, errors, fallbackUsed }`.
Efter normalisering används BokPilots befintliga AI-/klassificeringspipeline — Folio äger
**ingen** bokföringslogik.

---

## Feature flags (env / Supabase secrets)

| Variabel | Default | Beskrivning |
| --- | --- | --- |
| `OCR_PROVIDER_PRIMARY` | `gemini` | Primär provider (produktion). |
| `OCR_PROVIDER_SECONDARY` | `folio_ocr` | Sekundär provider. |
| `ENABLE_FOLIO_OCR` | `false` | **Huvudbrytaren.** Måste vara `true` för att Folio ska köras. |
| `ENABLE_OCR_FALLBACK` | `true` | Vid Folio-fel/timeout: fall tillbaka till primär (Gemini). |
| `FOLIO_OCR_BASE_URL` | — | URL till Folio-tjänsten. Saknas den → Folio är otillgänglig. |
| `FOLIO_OCR_TIMEOUT_MS` | `20000` | Timeout per anrop (abort → behandlas som fel/fallback). |
| `FOLIO_OCR_API_SECRET` | — | Valfri; skickas som `X-Api-Key`. Loggas aldrig. |

Sätts som edge-secrets:

```bash
supabase secrets set ENABLE_FOLIO_OCR=true FOLIO_OCR_BASE_URL=https://folio.intern.example.se
supabase secrets set FOLIO_OCR_TIMEOUT_MS=20000 FOLIO_OCR_API_SECRET=...
```

---

## Aktivera

1. Driftsätt Folio-tjänsten isolerat (egen container) och exponera adapter-kontraktet ovan.
2. Sätt `FOLIO_OCR_BASE_URL` (+ ev. `FOLIO_OCR_API_SECRET`) som secrets.
3. Sätt `ENABLE_FOLIO_OCR=true`.
4. Gå till **/admin/ocr-test** (operations_admin/superadmin), klicka **Folio health** → ska visa
   "tillgänglig".
5. Välj ett dokument och kör **Kör båda** för att jämföra Gemini vs Folio.

## Inaktivera / avinstallera (safe uninstall, krav 14)

Vilket som helst av följande stänger av Folio helt — **utan** att påverka det befintliga
OCR-flödet:

- Sätt `ENABLE_FOLIO_OCR=false` (eller ta bort `FOLIO_OCR_BASE_URL`). `ocr-folio` returnerar då
  `{ available:false }`.
- Ta bort edge-funktionen `ocr-folio` helt.

Inga databasmigrationer krävs för det befintliga flödet, inga importvägar bryts (Gemini-flödet
importerar aldrig Folio-koden), och inga obligatoriska nya env-variabler saknas. `src/lib/ocr/*`
är fristående hjälpkod utan biverkningar.

---

## Fel & fallback (krav 5)

- **Folio lyckas** → resultat används (i testverktyget visas det; orkestreraren markerar
  `fallbackUsed:false`).
- **Folio timeout** (abort) → behandlas som fel; vid `ENABLE_OCR_FALLBACK=true` faller flödet
  tillbaka till Gemini (`fallbackUsed:true`). Ingen `system_error` (förväntat övergående).
- **Folio kritiskt fel** (t.ex. 5xx, oväntat svar) → `record_worker_health('folio-ocr', false)` +
  `report_system_error('folio-ocr', …, severity:'warning')` till operations-admins. Vid fallback
  på används Gemini. **Ingen trasig dokumentpost skapas** — vid total miss returneras
  `{ failed:true }`.
- **Inga secrets eller dokumentinnehåll loggas.**

---

## Health-status (krav 13)

`ocr-folio` anropar `record_worker_health('folio-ocr', ok, error)` vid varje körning och
health-check. Komponenten `folio-ocr` visas i **Systemövervakning** (`/admin/system`) bredvid
övriga workers, med senaste lyckade/misslyckade körning och senaste fel.

---

## Risker & när det är säkert att göra Folio till default

**Risker:** extra latens och nätberoende; en separat tjänst att drifta/övervaka (GPU/Ollama);
kvalitet på svensk faktura-OCR är ej verifierad i stor skala; adaptershim måste hållas i synk
med kontraktet.

**Gör INTE Folio till primär** förrän samtliga gäller:

1. Health är grön och stabil över tid i Systemövervakning.
2. Stor jämförelse i `/admin/ocr-test` visar ≥ paritet med Gemini på riktiga svenska underlag
   (belopp, datum, moms, leverantör), inklusive confidence.
3. `processingTimeMs` ligger inom acceptabel SLA.
4. Fallback är verifierad (timeout/5xx → Gemini, inga trasiga poster).
5. Lagrings-/sekretesskrav uppfyllda (`persist:false`, ingen permanent kunddata i Folio).

Tills dess: Folio är ett opt-in test-/utvärderingsverktyg, Gemini förblir produktionsproviders.
