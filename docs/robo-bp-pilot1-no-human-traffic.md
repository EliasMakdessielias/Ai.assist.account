# ROBO-bp Pilot 1 – ingen mänsklig pilottrafik ännu

> Read-only statusrapport. Demo-data finns nu i testbolaget, men **ingen mänsklig pilotanvändning**
> har skett. All ROBO-bp-aktivitet efter Demo-data 1 kommer **enbart från den automatiserade
> `robo.smoke`-körningen**, inte från en verklig intern pilotanvändare. Detta är därför **inte** en
> giltig Pilot 1-utvärdering. Bygger på [robo-bp-pilot0.md](robo-bp-pilot0.md),
> [robo-bp-demo-data-plan.md](robo-bp-demo-data-plan.md) och [robo-bp-status.md](robo-bp-status.md).

## Slutsats

ROBO-bp är tekniskt redo och testbolaget har nu meningsfull demo-bokföring, men **en mänsklig intern
pilot har inte körts**. Den enda aktiviteten (3 konversationer, 6 meddelanden, +3 `ai_query`) härrör från
den automatiska smoke-körningen under Demo-data 1 (2026-06-30, 16:35–16:37), inte från en människa
(`ai_query` efter demo-smoken = 0; senaste `ai_query` 16:37). Svarskvalitet, begriplig confidence och
nyttan av "Underlag för svaret" kan därför **inte** bedömas – det kräver mänsklig återkoppling.

## Aktivitet efter Demo-data 1 = endast automatiserad smoke

- Källa: `tests/e2e/robo.smoke.auth.spec.js` (testharness), körd som del av Demo-data 1.
- Ingen mänsklig pilotanvändare har öppnat panelen och ställt frågor.
- Att tolka denna automatiska aktivitet som "pilot" vore felaktigt – denna rapport avgränsar det tydligt.

## Delta sedan Demo-data 1-slutläget (read-only)

| Mått | Demo-data 1-slut | Nu | Delta |
| --- | --- | --- | --- |
| Konversationer | 3 | 3 | **0** |
| Meddelanden | 6 | 6 | **0** |
| `ai_query` | 37 | 37 | **0** |
| `intent_blocked` | 0 | 0 | **0** |
| `check_created` | 0 | 0 | **0** |
| `check_status_changed` | 0 | 0 | **0** |
| `robo_bp_checks` | 0 | 0 | **0** |
| `suggestion_accepted` | 3 | 3 | **0** |

→ **Noll mänsklig pilottrafik.**

## Dataläckagekontroll – GODKÄND

- `ai_query`-detalj: `contextCounts, errors, hasSelection, observationCounts, risk, valid, view` – metadata-only.
- `suggestion_accepted`-detalj: `action_type, label` – metadata-only.
- Inga `question`/`answer`-nycklar, ingen rå frågetext, ingen rå AI-svarstext.
- Inga personuppgifter (demo-datan = fiktiva företagsnamn + fiktiva org.nr `DEMO0000xx`, inga personnummer).

## Bokföringspåverkan – 0

- Verifikationer i testbolaget: **10**, varav **10 DEMO och 0 icke-DEMO** → ROBO-bp har skapat **0** verifikationer.
- DEMO-verifikationer (10), DEMO-leverantörsfakturor (3) och DEMO-kundfakturor (2) är **oförändrade**.
- ROBO-bp har inte ändrat någon faktura eller bokföringspost.

## Beslut

1. **ROBO-bp ska inte aktiveras för fler bolag ännu.** Feature flag `robo_bp` förblir aktiv **endast** på
   testbolaget `4f0d…`.
2. **En mänsklig intern pilot måste köras först** och utvärderas mot en faktisk delta innan någon bredd övervägs.

## Instruktion för intern pilot (kör detta härnäst)

Genomför med en eller två interna användare som är medlemmar i testbolaget:

1. **Använd testbolaget `4f0d…` med demo-data** (10 verifikationer, 3 leverantörsfakturor, 2 kundfakturor).
2. **Ställ de 10 pilotfrågorna** i [robo-bp-pilot0.md](robo-bp-pilot0.md) (inkl. fråga 6–8 om kontroller/granskning/confidence).
3. **Skapa minst en kontrollpunkt** från en finding eller observation, och stäng den (open → in_progress → done)
   på panelen eller `/robo-bp/kontroller`.
4. **Testa minst en safe-intent-fråga** (fråga 9 eller 10, t.ex. "Bokför detta kvitto åt mig.") och bekräfta
   att säkerhetsspärren utlöses (inget AI-anrop, `intent_blocked` i audit).
5. **Notera om confidence och "Underlag för svaret" är begripliga** – är beslutsnivå/confidence-label tydliga?
   Hjälper underlaget användaren att förstå svaret? Skriv ned upplevd nytta utan att klistra in känslig text.

Förväntad delta efter en verklig pilot: ≥10 nya `ai_query`, minst en `check_created`, minst en `intent_blocked`,
och minst en `check_status_changed`. Kör därefter om Pilot 1-utvärderingen mot den deltan.

## Nästa praktiska steg

Bemanna piloten enligt instruktionen ovan, samla in noteringarna, och kör om delta-utvärderingen.
Ingen flagg-utökning, ingen kod-/prompt-/databasändring innan dess.

---
*Denna rapport skapades read-only. Inga mutationer, ingen kod, prompt, databas eller feature flag ändrades.*
