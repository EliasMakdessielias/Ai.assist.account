// Ren logik för Resultaträkningen i Kontoanalys. Återanvänder den delade hierarki-byggaren
// (src/lib/rapport.js). Resultatkonton 3xxx–8xxx; alla sektioner sign −1 så intäkter visas
// positivt och kostnader negativt (BokPilots konvention). Ingen ny datamodell.
import { buildHierReport, round2, nrNum } from './rapport'

// BAS-baserad gruppering via kontonummerintervall (BAS saknar exakta rapportgrupper i datan).
export const RESULTAT_STRUCTURE = [
  { key: 'intakter', rubrik: 'Rörelsens intäkter', sign: -1, grupper: [
    { key: 'netto', rubrik: 'Nettoomsättning', undergrupper: [{ rubrik: 'Nettoomsättning', from: 3000, to: 3799 }] },
    { key: 'ovr_int', rubrik: 'Övriga rörelseintäkter', undergrupper: [{ rubrik: 'Övriga rörelseintäkter', from: 3800, to: 3999 }] },
  ] },
  { key: 'kostnader', rubrik: 'Rörelsens kostnader', sign: -1, grupper: [
    { key: 'ravaror', rubrik: 'Råvaror och förnödenheter', undergrupper: [{ rubrik: 'Råvaror och förnödenheter', from: 4000, to: 4999 }] },
    { key: 'externa', rubrik: 'Övriga externa kostnader', undergrupper: [{ rubrik: 'Övriga externa kostnader', from: 5000, to: 6999 }] },
    { key: 'personal', rubrik: 'Personalkostnader', undergrupper: [{ rubrik: 'Personalkostnader', from: 7000, to: 7699 }] },
    { key: 'avskrivningar', rubrik: 'Av- och nedskrivningar', undergrupper: [{ rubrik: 'Av- och nedskrivningar', from: 7700, to: 7899 }] },
    { key: 'ovr_kost', rubrik: 'Övriga rörelsekostnader', undergrupper: [{ rubrik: 'Övriga rörelsekostnader', from: 7900, to: 7999 }] },
  ] },
  { key: 'finansiella', rubrik: 'Finansiella poster', sign: -1, grupper: [
    { key: 'fin_int', rubrik: 'Finansiella intäkter', undergrupper: [{ rubrik: 'Finansiella intäkter', from: 8000, to: 8399 }] },
    { key: 'fin_kost', rubrik: 'Finansiella kostnader', undergrupper: [{ rubrik: 'Finansiella kostnader', from: 8400, to: 8799 }] },
  ] },
  { key: 'skatt', rubrik: 'Bokslutsdispositioner och skatt', sign: -1, grupper: [
    { key: 'skatt_g', rubrik: 'Bokslutsdispositioner och skatt', undergrupper: [{ rubrik: 'Bokslutsdispositioner och skatt', from: 8800, to: 8999 }] },
  ] },
]

// Resultatkonto = kontoklass 3–8 (3000–8999). 1xxx/2xxx (balanskonton) hör inte hit.
export function isResultatKonto(nr) { const n = nrNum(nr); return n >= 3000 && n <= 8999 }

const FIELDS = ['perioden', 'ackumulerat']
const Z = () => ({ perioden: 0, ackumulerat: 0 })
const sumF = list => {
  const t = Z()
  for (const v of list || []) for (const f of FIELDS) t[f] += (v[f] || 0)
  return { perioden: round2(t.perioden), ackumulerat: round2(t.ackumulerat) }
}

// Bygger resultaträkningen. valueFn(nr) → { perioden, ackumulerat } RAW (debet−kredit, otecknat).
// Returnerar sektioner + sammanställning (rörelseresultat, efter finansiella poster, beräknat resultat).
export function buildResultatReport(accounts = [], valueFn = Z, opts = {}) {
  const sektioner = buildHierReport(RESULTAT_STRUCTURE, accounts, valueFn, { fields: FIELDS, showZero: !!opts.showZero })
  const get = k => sektioner.find(s => s.key === k)?.sum || Z()
  const intakter = get('intakter'), kostnader = get('kostnader'), finansiella = get('finansiella'), skatt = get('skatt')
  const add = (...xs) => ({ perioden: round2(xs.reduce((s, x) => s + x.perioden, 0)), ackumulerat: round2(xs.reduce((s, x) => s + x.ackumulerat, 0)) })
  const rorelseresultat = add(intakter, kostnader)
  const efterFinansiella = add(rorelseresultat, finansiella)
  const beraknat = sumF(sektioner.map(s => s.sum))   // = efterFinansiella + skatt
  return { sektioner, intakter, kostnader, finansiella, skatt, rorelseresultat, efterFinansiella, beraknat }
}
