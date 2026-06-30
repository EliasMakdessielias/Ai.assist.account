# ROBO-bp – statusdokumentation (Steg 2K, stabilisering & pilotberedskap)

> Stabiliseringsetapp. Ingen ny produktionsfunktionalitet byggd i 2K – endast dokumentation,
> verifiering och en liten smoke utan live-AI. Senast verifierad: efter Steg 2J.

## Sammanfattning

ROBO-bp är BokPilots kontrollerade, licensstyrda AI-**granskningsstöd**. Den analyserar bokföringen,
hittar risker/avvikelser, förklarar regler och låter användaren skapa och följa upp **kontrollpunkter**.
Den **bokför aldrig, ändrar aldrig och godkänner aldrig** något. All output kräver mänsklig granskning.
Steg 1–2J är byggda, testade och driftsatta för **ett testbolag**.

## Aktiveringsstatus

| Sak | Värde |
| --- | --- |
| Klara steg | 1, 1B, 2A, 2B, 2C, 2D, 2E, 2F, 2G, 2H, 2I, 2J |
| Edge Function | `robo-bp-chat` **v6** (ACTIVE, verify_jwt=true) |
| Feature flag | `robo_bp` (via `company_ai_features` + `has_ai_feature`) |
| Aktiverat för | **1 bolag** – testbolaget `4f0d…` (maskerat). Inga andra bolag. |
| Frontend-route | Panel (AI-paket / "Fråga ROBO-bp") + sida `/robo-bp/kontroller` |

## Arkitektur

- **Klient → edge-kontrakt:** klienten skickar ENDAST `{ company_id, descriptor:{ view, selection, fiscalYearId }, question }`.
  Aldrig rå bokföringsdata.
- **Edge `robo-bp-chat` (Deno, Gemini 2.5-flash, strikt JSON `responseSchema`):**
  membutskontroll → licens → **safe-intent guard (2J)** → `robo_bp_context`-RPC (minimal, server-sammansatt kontext)
  → Gemini → validering/sanering → persistering + audit.
- **Tabeller (public):** `robo_bp_conversations`, `robo_bp_messages`, `robo_bp_checks`, `robo_bp_audit_log`, `robo_bp_rules`.
- **RPC:er (SECURITY DEFINER):** `robo_bp_context` (smart begränsad kontext, p_view+p_question),
  `robo_bp_create_check` (skapa kontrollpunkt + decision_basis/confidence_label),
  `robo_bp_set_check_status` (statusflöde). Licensgrind via delad `has_ai_feature`.
- **Migrationer (referens):** initialt robo_bp-schema, `robo_bp_checks` (2C), `robo_bp_context_2b_smart` (2B),
  `robo_bp_check_status` (2E), `robo_bp_decision_basis` (2H). Referensfiler i `supabase/robo_bp_*.sql`.
- **Delad ren logik:** `src/lib/roboBp.js` (kontrakt, validering, observationer, confidence, intent-guard) – enhetstestad.
- **UI:** `src/components/RoboBpPanel.jsx` (panel) + `src/pages/RoboBpChecks.jsx` (samlad vy).

## Data till AI

Edge:n sammanställer en **minimal, server-vald** kontext (max ~20 000 tecken) och skickar till Gemini:

- Bolagsnamn + org.nr, aktuell vy, ev. vald referens (selection).
- **Smart vald kontoplan** (kontonr, namn, klass, aktiv) – rankad, hård LIMIT.
- Saldo per kontoklass.
- Senaste verifikationer (id, ver-nr, datum, beskrivning ≤120 tecken, totalbelopp, status).
- Senaste leverantörs-/kundfakturor (id, motpart, datum, total, moms, status).
- `summary` (antal/öppna/förfallna, intäkt/kostnad/moms m.m.).
- Deterministiska `observations` (koder/antal).
- Användarens fråga.

## Data som aldrig skickas

- Klienten skickar **aldrig** rå bokföringsdata – bara vy/selection/fråga.
- Till AI skickas **inte**: hela huvudboken/alla rader, bilagor, OCR-text, dokumentinnehåll,
  personnummer, andra bolags data, eller fält utanför den minimala projektionen ovan.
- **Audit innehåller aldrig** rå frågetext eller rå AI-svarstext (endast metadata – se nedan).

## Behörighet och RLS

- **RLS** på alla `robo_bp_*`-tabeller: `company_id in (select user_company_ids())`. Mutationer endast via RPC.
- **Edge:** medlemskapsgrind (icke-medlem → 403, audit `denied`) + licensgrind (`has_ai_feature(robo_bp)`).
- **Cross-company:** membutskontroll i edge + RLS – andra bolags data exponeras aldrig (server-verifierat).
- **Roll:** `create_check` och `set_check_status` blockerar read-only-roller (viewer/read_only/lasare/guest…).
- Samlade vyn `/robo-bp/kontroller` filtrerar dessutom explicit på aktivt bolag (utöver RLS).

## Audit

Tabell `robo_bp_audit_log`. Alla actions är **metadata-only** (ingen rå fråga/AI-text):

| Action | När | Metadata |
| --- | --- | --- |
| `ai_query` | AI-svar levererat | view, hasSelection, contextCounts, observationCounts, risk, valid, errors |
| `intent_blocked` | safe-intent guard blockerade | category, view, hasSelection |
| `check_created` | kontrollpunkt skapad | source, view, risk_level, checkId, affectedIds, decisionBasis, confidenceLabel |
| `check_status_changed` | status ändrad | checkId, fromStatus, toStatus, view, risk_level |
| `denied` | nekad (medlemskap/licens/roll) | reason, op |
| `suggestion_accepted` | användare loggade förslag | action_type, label |

## Säkerhetsspärrar

1. **Ingen mutationskod** i edge:n – den kan tekniskt inte bokföra/ändra/godkänna/betala/lämna in.
2. **`requires_human_review` tvingas `true`** på alla findings.
3. **Hallucinationsspärr:** konton/objekt-id som inte finns i den server-hämtade kontexten saneras bort.
4. **`suggest_accounting` blockerat** – tillåtna proposed_actions endast `open_object`, `explain_rule`, `create_check`.
5. **Safe-intent guard (2J)** – deterministisk, körs FÖRE AI; förbjuden intent → inget AI-anrop, säkert svar.
6. **Server-sammansatt kontext** – klienten kan inte injicera rå data.
7. **Kontrollpunkter är read-only** mot bokföringen – statusflöde rör aldrig verifikationer/fakturor.
8. **Licens + RLS + roll** enligt ovan.

## Kontrollpunkter

- Tabell `robo_bp_checks`: company_id, source='robo_bp', view, fiscal_year_id, title, description, risk_level,
  affected_objects, status, conversation_id, created_by, created_at/updated_at, **decision_basis** (`system_observation`|`ai_finding`),
  **confidence_label** (systemberäknad).
- Statusflöde: `open → in_progress → done`, samt `dismissed`. Via `robo_bp_set_check_status` (audit + behörighet).
- Skapas från en **finding** (ai_finding) eller en **deterministisk observation** (system_observation).
- Visas i panelen och på samlade vyn `/robo-bp/kontroller` (filter: status/risk/vy/räkenskapsår).

## Teststatus

- **Build:** grön. **Vitest:** **965/965** (84 filer).
- **Enhetstester (`src/lib/roboBp.test.js`):** kontrakt/validering, deterministiska kontroller, observationer,
  create_check-payload, statusflöde, transparens (summarizeBasis), confidence/beslutsnivå, **safe-intent guard**.
- **Handbokstester (`src/help/help.test.js`):** ROBO-bp-artikel finns/slug/säkerhetsfraser/sök.
- **E2E (Playwright, `tests/e2e/robo.*.auth.spec.js`):**
  - `robo.smoke` – panel från 4 ställen, JSON-kontrakt, observation→check, finding→check, meta (live-AI, separat).
  - `robo.checks` – deterministisk: tomt läge → create → open→in_progress→done (mockat AI).
  - `robo.checksview` – samlad vy: navigation, listning, bolagsisolering, filter, statusändring (seedad fixture).
  - `robo.basis` – transparenssektion, confidence-chips, hjälplänk (mockat AI).
  - `robo.decisionbasis` – observation → decision_basis=system_observation (mockat AI).
  - `robo.intent` – **safe-intent guard mot riktig edge** (deterministisk, ingen live-AI).

## Live-verifiering (körd)

- 1B/2A–2J: panel öppnas/svarar enligt kontrakt; begränsad kontext; observationer; create_check (observation+finding);
  statusflöde; samlad vy; transparens + meta; decision_basis/confidence_label; **intent_blocked utan AI-anrop**.
- Server-verifierat (MCP): dedup, cross-company 403, audit metadata-only, `decision_basis`/`confidence_label`,
  `intent_blocked` + oförändrad `ai_query` (inget AI-anrop), och **verifikationer/fakturor 0→0 genomgående**.

### Testdata-läge (verifierat nu)

- **Kvarvarande smoke-checks: 0** (`robo_bp_checks` totalt = 0). Inga kontrollpunkter någonstans.
- **check_created / check_status_changed / intent_blocked: 0 rader** (alla smoke-artefakter reverserade).
- **Medvetet kvar (testbolaget, ofarlig smoke-historik):** ~33 `robo_bp_conversations` + `robo_bp_messages`,
  samt audit `ai_query` (~34) och `suggestion_accepted` (~3). Detta är chatt-/frågehistorik från smoke-körningar,
  RLS-skyddad och enbart i testbolaget. Kan valfritt rensas inför pilot (ej gjort här – 2K muterar inte DB).
- **Verifikationer/fakturor i testbolaget: 0** – ROBO-bp har aldrig rört bokföringsdata.

## Att ROBO-bp fortfarande INTE kan (verifierat)

bokföra · skapa verifikation · ändra verifikation · ändra faktura · godkänna faktura · betala · lämna in
moms/deklaration/årsredovisning · skicka till myndighet · föreslå kontering (`suggest_accounting`).
Skydd: ingen sådan kod i edge:n, `suggest_accounting` blockerat, safe-intent guard, requires_human_review,
read-only kontrollpunkter.

## Kända begränsningar

- Safe-intent guard är **regelbaserad** (regex) – ovanliga omskrivningar kan slinka förbi guarden, men ROBO-bp
  utför ändå aldrig åtgärden (guarden är ett extra lager, inte enda spärren).
- `confidence_label` gäller **hela svaret**, inte varje enskild finding.
- AI-svarens kvalitet beror på begränsad kontext; vid tom/ofullständig data kan svar bli vaga (markeras i `limitations`).
- Confidence är **inte kalibrerad mot utfall** (ingen inlärning).
- Live-AI-smoke är icke-deterministisk (separerad från blockerande deterministiska tester).
- Endast svenska K2-relevanta vyer; ingen RAG, ingen extern regelhämtning (BFN/Skatteverket) ännu.

## Rekommendation inför pilot

**Redo för intern pilot: JA – med begränsningar.**

Grunden är stabil: byggd, testad (965/965 + E2E), driftsatt, och alla destruktiva åtgärder är otillgängliga för
ROBO-bp. Säkerhetsspärrarna (ingen mutation, hallucinationsspärr, suggest_accounting blockerat, safe-intent guard,
RLS/licens/roll, metadata-only audit) är på plats och verifierade.

**Pilotbegränsningar:**
1. Endast **testbolaget `4f0d…`** har flaggan – pilot sker där tills uttryckligt beslut att aktivera fler.
2. Positionera tydligt som **granskningsstöd, inte redovisningskonsult** (handboksartikel `robo-bp` finns).
3. Mänsklig granskning krävs för varje svar; inga beslut baseras enbart på ROBO-bp.
4. Övervaka `robo_bp_audit_log` (ai_query/intent_blocked/check_*) under piloten.
5. (Valfritt) Rensa smoke-historik i testbolaget innan riktiga piloter bjuds in.

**Blockerare:** inga tekniska blockerare identifierade.

## Vad som INTE ska byggas ännu

- Ingen autobokföring/kontering, inga `suggest_accounting`-åtgärder.
- Ingen RAG, ingen extern regelhämtning, ingen permanent inlärning.
- Ingen breddning av flaggan till fler bolag utan beslut.
- Inga nya skrivvägar mot verifikationer/fakturor/perioder.

## Nästa möjliga steg (förslag, ej beslutade)

- Per-finding confidence (i stället för per svar).
- Pilot-feedback-loop (tumme upp/ner på svar, metadata-only).
- Fler deterministiska systemkontroller (observationer).
- Semantisk intent-klassificering som komplement till regex-guarden.
- Kontrollpunkts-notifiering/ägarskap (lättviktigt, utan task-manager-svällning).
