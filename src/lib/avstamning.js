// Bankavstämning: unik 1:1-matchning mellan bokföringsrader och inlästa banktransaktioner.
// Ren logik (testbar) – komponenten StamAvKonto visar paren som granskningsläge och skriver
// avstamd först när användaren accepterar med Spara.

// Bygger unika par: varje bokföringsrad och varje banktransaktion ingår i HÖGST ETT par.
// Kriterium: samma belopp (±0,01, tecknet räknas) och datum inom `maxDagar` dagar.
// Globalt giriga val: alla kandidatpar sorteras på datumavstånd (närmast först) och plockas
// i ordning – så att t.ex. en banktransaktion paras med den NÄRMASTE bokföringsraden även
// när flera rader har samma belopp.
// Indata: bok [{ id, datum, belopp }], bank [{ id, datum, belopp }] (redan filtrerade på
// ej avstämda / användarens urval). Returnerar [{ bokId, bankId, belopp, dagar }].
export function buildUniqueMatches(bok, bank, { maxDagar = 7 } = {}) {
  const dagar = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000)
  const kandidater = []
  for (const r of bok || []) {
    for (const t of bank || []) {
      if (Math.abs((t.belopp || 0) - (r.belopp || 0)) > 0.01) continue
      const d = dagar(r.datum, t.datum)
      if (d <= maxDagar) kandidater.push({ bokId: r.id, bankId: t.id, belopp: r.belopp, dagar: d })
    }
  }
  kandidater.sort((a, b) => a.dagar - b.dagar)
  const usedBok = new Set(), usedBank = new Set(), out = []
  for (const k of kandidater) {
    if (usedBok.has(k.bokId) || usedBank.has(k.bankId)) continue
    usedBok.add(k.bokId); usedBank.add(k.bankId)
    out.push(k)
  }
  return out
}
