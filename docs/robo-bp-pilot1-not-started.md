# ROBO-bp Pilot 1 – ej startad

> Read-only statusrapport. Ingen pilottrafik finns sedan Pilot 0. Detta är **inte** en lyckad
> Pilot 1-utvärdering – ingen verklig användning har skett och därför kan ingenting utvärderas.
> Bygger på [robo-bp-pilot0.md](robo-bp-pilot0.md) och [robo-bp-status.md](robo-bp-status.md).

## Slutsats

**Pilot 1 har inte startat.** Sedan Pilot 0 rensade chatt-slaten i testbolaget har **ingen** användare
ställt en enda fråga till ROBO-bp. Alla mätbara delta är noll. ROBO-bp ska **inte** utökas till fler bolag
förrän en pilot faktiskt körts på ett verkligt användningsfall och utvärderats.

## Delta sedan Pilot 0-baslinjen (testbolaget `4f0d…`)

| Mått | Baslinje (Pilot 0) | Nu | Delta |
| --- | --- | --- | --- |
| Konversationer | 0 | 0 | **0** |
| Meddelanden | 0 | 0 | **0** |
| `ai_query` | 34 | 34 | **0** |
| `intent_blocked` | 0 | 0 | **0** |
| `check_created` | 0 | 0 | **0** |
| `check_status_changed` | 0 | 0 | **0** |
| `suggestion_accepted` | 3 | 3 | **0** |
| Kontrollpunkter (`robo_bp_checks`) | 0 | 0 | **0** |

Inga audit-rader skapade efter Pilot 0-städningen (`audit_after_pilot0 = 0`). De kvarvarande
`ai_query`-/`suggestion_accepted`-raderna är den bevarade baslinjen från tidigare smoke, inte pilotaktivitet.

## Audit-läckagekontroll – GODKÄND

- `ai_query`-detalj: `contextCounts, errors, hasSelection, observationCounts, risk, valid, view` – metadata-only.
- `suggestion_accepted`-detalj: `action_type, label` – metadata-only.
- Inga `question`/`answer`-nycklar. Träffen i en bred råtext-sökning var ordet *fråga* inuti UI-etiketten
  "Skapa en kontrollfråga" (en `create_check`-knappetikett) – inte rå frågetext eller AI-svarstext.

## Bokföringspåverkan – INGEN

- Verifikationer i testbolaget: **0**.
- Fakturor i testbolaget: **0**.
- ROBO-bp har aldrig skapat eller ändrat någon bokföringspost.

## Varför svarskvalitet inte kan bedömas

1. **Ingen pilottrafik** – noll frågor sedan Pilot 0, alltså inga svar att granska.
2. **Testbolaget har 0 verifikationer och 0 fakturor** – även om frågor ställdes skulle ROBO-bp sakna
   substans att analysera, så svaren skulle med nödvändighet bli tomma/vaga och inte representativa.

Därför kan användbara svar, svaga svar, missade spärrar, hallucinationer, UI-friktion eller
confidence-tolkning **inte** bedömas i detta läge.

## Beslut

1. **ROBO-bp ska inte utökas till fler bolag ännu.** Feature flag `robo_bp` förblir aktiv **endast** på
   testbolaget `4f0d…`.
2. **Pilot 1 måste köras på ett faktiskt användningsfall först** – minst en intern användare som ställer de
   10 frågorna i [robo-bp-pilot0.md](robo-bp-pilot0.md) mot ett bolag med verklig substans.

## Rekommendation

Innan Pilot 1 körs, välj ett dataunderlag med substans:

- **Antingen** ett internt bolag med **icke-känslig** bokföringsdata (riktiga men ofarliga verifikationer/fakturor), **eller**
- **Skapa tydligt markerad demo-data** i testbolaget (reversibel, märkt t.ex. "DEMO/PILOT") så att ROBO-bp
  har något att analysera.

Kör därefter piloten och kör om utvärderingen mot en delta som faktiskt visar aktivitet
(t.ex. ≥10 `ai_query` + minst en `check_created` och en `intent_blocked`).

## Rekommenderad nästa åtgärd

Bemanna och kör Pilot 1 (intern användare + bolag med substans enligt ovan), och kör sedan om
delta-utvärderingen. Ingen flagg-utökning, ingen kod/prompt/DB-ändring dessförinnan.
