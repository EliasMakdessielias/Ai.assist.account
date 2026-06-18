// Dagskassa – ren logik för kassaförsäljning i butik/online.
//
// Försäljningen (netto per momssats + utgående moms) krediteras, betalsätten (kontant/kort)
// debiteras. Stämmer inte inbetalt mot försäljning + moms uppstår en KASSADIFFERENS som
// bokförs på 3790: överskott (mer inbetalt) = kredit 3790, manko (mindre inbetalt) = debet 3790.
// Verifikationen balanserar då alltid (summa debet = summa kredit).

export const DAGSKASSA_ACC = {
  forsaljning: { 25: '3001', 12: '3002', 6: '3003', 0: '3004' },
  moms: { 25: '2611', 12: '2621', 6: '2631' },
  kontant: '1910', kort: '1580', kassadiff: '3790',
}

export const DAGSKASSA_NAMES = {
  '3001': 'Försäljning 25% moms', '3002': 'Försäljning 12% moms', '3003': 'Försäljning 6% moms', '3004': 'Försäljning momsfri',
  '2611': 'Utgående moms 25%', '2621': 'Utgående moms 12%', '2631': 'Utgående moms 6%',
  '1910': 'Kassa', '1580': 'Kontokortsfordringar', '3790': 'Kassadifferens',
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

// Bygger en balanserad kontering för en dagskassa.
//   net   = { 25, 12, 6, 0 } försäljning EXKL moms per momssats
//   moms  = { 25, 12, 6 }    utgående moms per momssats
//   kontant, kort           inbetalda belopp
// Returnerar { rows, kassadiff, salesTotal, momsTotal, grandTotal, payments, totalDebet, totalKredit }.
// kassadiff = inbetalt − (försäljning + moms): >0 överskott (kredit 3790), <0 manko (debet 3790).
export function byggDagskassaRader({ net = {}, moms = {}, kontant = 0, kort = 0 } = {}) {
  const rows = []
  const credit = (nr, b) => { if (b > 0.001) rows.push({ nr, debet: 0, kredit: r2(b) }) }
  const debit = (nr, b) => { if (b > 0.001) rows.push({ nr, debet: r2(b), kredit: 0 }) }

  credit(DAGSKASSA_ACC.forsaljning[25], net[25]); credit(DAGSKASSA_ACC.forsaljning[12], net[12])
  credit(DAGSKASSA_ACC.forsaljning[6], net[6]); credit(DAGSKASSA_ACC.forsaljning[0], net[0])
  credit(DAGSKASSA_ACC.moms[25], moms[25]); credit(DAGSKASSA_ACC.moms[12], moms[12]); credit(DAGSKASSA_ACC.moms[6], moms[6])
  debit(DAGSKASSA_ACC.kontant, kontant); debit(DAGSKASSA_ACC.kort, kort)

  const salesTotal = r2((net[25] || 0) + (net[12] || 0) + (net[6] || 0) + (net[0] || 0))
  const momsTotal = r2((moms[25] || 0) + (moms[12] || 0) + (moms[6] || 0))
  const grandTotal = r2(salesTotal + momsTotal)
  const payments = r2((Number(kontant) || 0) + (Number(kort) || 0))
  const kassadiff = r2(payments - grandTotal)

  if (kassadiff > 0.001) credit(DAGSKASSA_ACC.kassadiff, kassadiff)        // överskott
  else if (kassadiff < -0.001) debit(DAGSKASSA_ACC.kassadiff, -kassadiff)  // manko

  const totalDebet = r2(rows.reduce((s, r) => s + r.debet, 0))
  const totalKredit = r2(rows.reduce((s, r) => s + r.kredit, 0))
  return { rows, kassadiff, salesTotal, momsTotal, grandTotal, payments, totalDebet, totalKredit }
}

// Plockar ut dagskasse-fält ur ett OCR-tolkningsresultat (tolkning.dagskassa).
// Returnerar formulärvärden (tal) eller null om underlaget inte är en dagskassa.
export function dagskassaFromTolkning(tolkning) {
  const d = tolkning?.dagskassa
  if (!d || typeof d !== 'object') return null
  const n = v => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(x) ? 0 : x }
  const vals = {
    datum: typeof d.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.datum) ? d.datum : null,
    vg25: n(d.forsaljning_25), vg12: n(d.forsaljning_12), vg6: n(d.forsaljning_6), vg0: n(d.forsaljning_0),
    moms25: n(d.moms_25), moms12: n(d.moms_12), moms6: n(d.moms_6),
    kontant: n(d.kontant), kort: n(d.kort),
  }
  // Minst något belopp måste finnas för att räknas som ifylld dagskassa.
  const har = vals.vg25 || vals.vg12 || vals.vg6 || vals.vg0 || vals.kontant || vals.kort
  return har ? vals : null
}
