// Delad, ren logik för hierarkiska kontorapporter (Balansräkning + Resultaträkning).
// Inga beroenden på React/Supabase. Ingen ny datamodell – bygger på kontoplan + en valueFn
// som anroparen beräknar från company-scopad data.

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const nrNum = nr => parseInt(String(nr ?? '').replace(/\D/g, ''), 10) || 0

// Bygger en hierarkisk rapport: sektion → grupp → undergrupp → konton → summor.
//   structure: [{ key, rubrik, sign, grupper:[{ key, rubrik, undergrupper:[{ rubrik, from, to }] }] }]
//   accounts:  [{ account_nr, name }] (kontoplanen)
//   valueFn(nr) → objekt med numeriska RAW-fält (otecknade), t.ex. { ib, change, ub } eller { perioden, ackumulerat }
//   opts.fields: vilka fält som ska tecknas (× sektionens sign) och summeras
//   opts.showZero: ta med konton som är 0 i ALLA fält (annars döljs de)
//   opts.inject(sektionKey, gruppKey) → ev. extra (redan tecknade) konton att lägga i en grupp
// Tomma undergrupper/grupper/sektioner (inga konton i kontoplanen, eller alla noll) utelämnas.
export function buildHierReport(structure, accounts, valueFn, { fields = [], showZero = false, inject = null } = {}) {
  const sumV = list => {
    const t = {}; for (const f of fields) t[f] = 0
    for (const v of list || []) for (const f of fields) t[f] += (v[f] || 0)
    for (const f of fields) t[f] = round2(t[f])
    return t
  }
  const isZeroV = v => fields.every(f => Math.abs(v[f] || 0) < 0.005)

  const sektioner = []
  for (const sec of structure) {
    const sign = sec.sign ?? 1
    const grupper = []
    for (const gr of sec.grupper) {
      const undergrupper = []
      for (const ug of gr.undergrupper) {
        let konton = (accounts || [])
          .filter(a => { const n = nrNum(a.account_nr); return n >= ug.from && n <= ug.to })
          .map(a => {
            const raw = valueFn(a.account_nr) || {}
            const k = { nr: String(a.account_nr), namn: a.name || '' }
            for (const f of fields) k[f] = round2(sign * (raw[f] || 0))
            return k
          })
        if (inject) { const extra = inject(sec.key, gr.key); if (extra && extra.length) konton = konton.concat(extra) }
        if (!konton.length) continue
        const visible = showZero ? konton : konton.filter(k => k.synthetic || !isZeroV(k))
        if (!visible.length) continue
        undergrupper.push({ rubrik: ug.rubrik, konton: visible, sum: sumV(visible) })
      }
      if (!undergrupper.length) continue
      grupper.push({ key: gr.key, rubrik: gr.rubrik, undergrupper, sum: sumV(undergrupper.map(u => u.sum)) })
    }
    if (!grupper.length) continue
    sektioner.push({ key: sec.key, rubrik: sec.rubrik, sign, grupper, sum: sumV(grupper.map(g => g.sum)) })
  }
  return sektioner
}
