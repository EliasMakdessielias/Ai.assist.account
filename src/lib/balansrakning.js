// Ren logik för Balansräkningen i Kontoanalys: BAS-hierarki + summering + balanskontroll.
// Inga beroenden på React/Supabase. INGEN ny datamodell – bygger på kontoplanen (accounts)
// och verifikationsrader (via en valueFn som anroparen beräknar från company-scopad data).

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const nrNum = nr => parseInt(String(nr ?? '').replace(/\D/g, ''), 10) || 0

// Balansräkningens struktur enligt BAS. sign: tillgångar = +1 (debet-positiv),
// eget kapital & skulder = −1 (kredit-positiv). Konto-intervall per undergrupp.
export const BALANCE_STRUCTURE = [
  { key: 'tillgangar', rubrik: 'Tillgångar', sign: 1, grupper: [
    { key: 'anlaggning', rubrik: 'Anläggningstillgångar', undergrupper: [
      { rubrik: 'Immateriella anläggningstillgångar', from: 1000, to: 1099 },
      { rubrik: 'Materiella anläggningstillgångar', from: 1100, to: 1299 },
      { rubrik: 'Finansiella anläggningstillgångar', from: 1300, to: 1399 },
    ] },
    { key: 'omsattning', rubrik: 'Omsättningstillgångar', undergrupper: [
      { rubrik: 'Varulager m.m.', from: 1400, to: 1499 },
      { rubrik: 'Kortfristiga fordringar', from: 1500, to: 1799 },
      { rubrik: 'Kortfristiga placeringar', from: 1800, to: 1899 },
      { rubrik: 'Kassa och bank', from: 1900, to: 1999 },
    ] },
  ] },
  { key: 'ekskuld', rubrik: 'Eget kapital och skulder', sign: -1, grupper: [
    { key: 'ek', rubrik: 'Eget kapital', undergrupper: [{ rubrik: 'Eget kapital', from: 2000, to: 2099 }] },
    { key: 'obesk', rubrik: 'Obeskattade reserver', undergrupper: [{ rubrik: 'Obeskattade reserver', from: 2100, to: 2199 }] },
    { key: 'avsattningar', rubrik: 'Avsättningar', undergrupper: [{ rubrik: 'Avsättningar', from: 2200, to: 2299 }] },
    { key: 'langfristiga', rubrik: 'Långfristiga skulder', undergrupper: [{ rubrik: 'Långfristiga skulder', from: 2300, to: 2399 }] },
    { key: 'kortfristiga', rubrik: 'Kortfristiga skulder', undergrupper: [{ rubrik: 'Kortfristiga skulder', from: 2400, to: 2999 }] },
  ] },
]

// Balanskonto = kontoklass 1 eller 2 (1000–2999). Intäkts/kostnadskonton (3xxx–8xxx) hör inte hit.
export function isBalansKonto(nr) { const n = nrNum(nr); return n >= 1000 && n <= 2999 }

const ZERO = () => ({ ib: 0, change: 0, ub: 0 })
const addV = (a, b) => ({ ib: a.ib + b.ib, change: a.change + b.change, ub: a.ub + b.ub })
const sumV = list => { const t = (list || []).reduce((a, v) => addV(a, v), ZERO()); return { ib: round2(t.ib), change: round2(t.change), ub: round2(t.ub) } }
const isZeroV = v => Math.abs(v.ib) < 0.005 && Math.abs(v.change) < 0.005 && Math.abs(v.ub) < 0.005

// Bygger den hierarkiska balansräkningen.
//   accounts: [{ account_nr, name }] (kontoplanen)
//   valueFn(nr) → { ib, change, ub } RAW (debet−kredit, otecknat)
//   opts.showZero: ta med nollkonton (default false → dölj konton som är 0 i alla kolumner)
//   opts.aretsResultat: { ib, change, ub } redan tecknat för Eget kapital (vinst positiv)
// Returnerar { sektioner, tillgangar, ekskuld, differens, balanserar }.
export function buildBalansReport(accounts = [], valueFn = ZERO, opts = {}) {
  const showZero = !!opts.showZero
  const ar = opts.aretsResultat || null
  const sektioner = []
  for (const sec of BALANCE_STRUCTURE) {
    const grupper = []
    for (const gr of sec.grupper) {
      const undergrupper = []
      for (const ug of gr.undergrupper) {
        let konton = (accounts || [])
          .filter(a => { const n = nrNum(a.account_nr); return n >= ug.from && n <= ug.to })
          .map(a => {
            const raw = valueFn(a.account_nr) || ZERO()
            return { nr: String(a.account_nr), namn: a.name || '', ib: round2(sec.sign * raw.ib), change: round2(sec.sign * raw.change), ub: round2(sec.sign * raw.ub) }
          })
        // Årets resultat injiceras som egen rad under Eget kapital (gör att balansen går ihop).
        if (ar && sec.key === 'ekskuld' && gr.key === 'ek') {
          konton = konton.concat([{ nr: '', namn: 'Årets resultat', synthetic: true, ib: round2(ar.ib), change: round2(ar.change), ub: round2(ar.ub) }])
        }
        if (!konton.length) continue                                   // inget konto i kontoplanen → hoppa undergrupp
        const visible = showZero ? konton : konton.filter(k => k.synthetic || !isZeroV(k))
        if (!visible.length) continue                                  // alla noll & ej "visa alla" → hoppa
        undergrupper.push({ rubrik: ug.rubrik, konton: visible, sum: sumV(visible) })
      }
      if (!undergrupper.length) continue                               // tom grupp → hoppa (t.ex. saknade obeskattade reserver)
      grupper.push({ key: gr.key, rubrik: gr.rubrik, undergrupper, sum: sumV(undergrupper.map(u => u.sum)) })
    }
    if (!grupper.length) continue
    sektioner.push({ key: sec.key, rubrik: sec.rubrik, sign: sec.sign, grupper, sum: sumV(grupper.map(g => g.sum)) })
  }
  const get = k => sektioner.find(s => s.key === k)?.sum || ZERO()
  const tillgangar = get('tillgangar'), ekskuld = get('ekskuld')
  const differens = { ib: round2(tillgangar.ib - ekskuld.ib), change: round2(tillgangar.change - ekskuld.change), ub: round2(tillgangar.ub - ekskuld.ub) }
  return { sektioner, tillgangar, ekskuld, differens, balanserar: Math.abs(differens.ub) < 0.005 }
}
