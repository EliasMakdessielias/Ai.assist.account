// Hjälpfunktioner för att läsa in banktransaktioner från CSV/text.

export function detectDelimiter(line) {
  const counts = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of line) if (ch in counts) counts[ch]++
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ';'
}

export function parseLine(line, delim) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else {
      if (c === '"') q = true
      else if (c === delim) { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

export function parseFile(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (!lines.length) return { rows: [], delim: ';' }
  const delim = detectDelimiter(lines[0])
  const rows = lines.map(l => parseLine(l, delim))
  return { rows, delim }
}

// Tolkar belopp i olika format: "1 234,56", "1234.56", "-500", "500-", "(500)".
export function parseAmount(s) {
  if (s == null) return null
  const raw = String(s).trim()
  // Datum (t.ex. 2026-01-21) är inte ett belopp – annars skulle bindestrecken
  // strippas och ge ett felaktigt tal (20260121).
  if (/^\d{4}-\d{2}-\d{2}\b/.test(raw) || /^\d{4}\/\d{2}\/\d{2}\b/.test(raw)) return null
  let t = raw.replace(/\s/g, '').replace(/kr/i, '')
  if (!t) return null
  const neg = /^-/.test(t) || /-$/.test(t) || /^\(.*\)$/.test(t)
  t = t.replace(/[()]/g, '').replace(/-/g, '')
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(',', '.')
  const n = parseFloat(t)
  if (isNaN(n)) return null
  return neg ? -Math.abs(n) : n
}

// Tolkar datum till YYYY-MM-DD.
export function parseDate(s) {
  const t = String(s || '').trim()
  let m
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`
  if ((m = t.match(/^(\d{4})\/(\d{2})\/(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`
  if ((m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

// Gissar kolumnindex för datum/text/belopp. Robust för:
//  - filer MED rubrikrad (matchar på rubriknamn)
//  - filer UTAN rubrikrad, t.ex. Skatteverkets skattekonto-export
//    (företagsnamn på rad 1, saldo-rader, 4 kolumner inkl. löpande saldo)
// `rows` kan vara rubrikraden (array av strängar) eller hela tabellen (array av rader).
export function guessColumns(rows) {
  const isTable = Array.isArray(rows?.[0])
  const header = isTable ? rows[0] : rows
  const allRows = isTable ? rows : []
  const lower = header.map(h => String(h || '').toLowerCase())
  const ncols = header.length || 0

  const HEADER_KEYWORDS = ['datum', 'date', 'text', 'beskriv', 'belopp', 'amount', 'saldo', 'referens', 'meddel', 'insättning', 'insattning', 'uttag', 'summa']
  const hasHeader = lower.some(h => HEADER_KEYWORDS.some(k => h.includes(k)))

  const find = (keys, avoid = []) => lower.findIndex(h => keys.some(k => h.includes(k)) && !avoid.some(a => h.includes(a)))
  let datum = hasHeader ? find(['valutadatum', 'transaktionsdatum', 'bokförd', 'bokford', 'datum', 'date', 'bokf']) : -1
  let text = hasHeader ? find(['text', 'beskriv', 'meddel', 'narrative', 'referens', 'mottagare', 'avsändare', 'rubrik', 'info']) : -1
  let belopp = hasHeader ? find(['insättning', 'insattning', 'uttag', 'belopp', 'amount', 'summa', 'transaktionsbelopp', 'rörelse', 'rorelse', 'debet', 'kredit'], ['saldo']) : -1
  const saldoCol = hasHeader ? lower.findIndex(h => h.includes('saldo')) : -1

  // Värdebaserad analys per kolumn (på dataraderna).
  const dataRows = (hasHeader ? allRows.slice(1) : allRows).slice(0, 40)
  const stats = []
  for (let i = 0; i < ncols; i++) {
    let dates = 0, amounts = 0, nonEmpty = 0
    for (const r of dataRows) {
      const v = String(r?.[i] ?? '').trim()
      if (!v) continue
      nonEmpty++
      if (parseDate(v)) dates++
      else if (parseAmount(v) != null) amounts++
    }
    stats.push({ i, dates, amounts, nonEmpty })
  }

  // Datum: kolumnen med flest datumträffar.
  if (datum < 0) {
    const best = stats.filter(s => s.dates > 0).sort((a, b) => b.dates - a.dates)[0]
    datum = best ? best.i : 0
  }

  // Belopp: numerisk kolumn som varken är datum eller (löpande) saldo.
  if (belopp < 0) {
    const numCols = stats
      .filter(s => s.i !== datum && s.i !== saldoCol && s.amounts >= Math.max(1, Math.floor(s.nonEmpty * 0.5)))
      .map(s => s.i)
    // Flera numeriska kolumner: den sista är oftast löpande saldo → välj den första.
    if (numCols.length) belopp = numCols[0]
    else belopp = (stats.filter(s => s.i !== datum).sort((a, b) => b.amounts - a.amounts)[0]?.i) ?? 0
  }

  // Text: en icke-datum, icke-belopp kolumn med mest fritext.
  if (text < 0) {
    const cand = stats
      .filter(s => s.i !== datum && s.i !== belopp)
      .sort((a, b) => (b.nonEmpty - b.dates - b.amounts) - (a.nonEmpty - a.dates - a.amounts))[0]
    text = cand ? cand.i : Math.min(datum + 1, Math.max(0, ncols - 1))
  }

  return { datum: Math.max(0, datum), text: Math.max(0, text), belopp: Math.max(0, belopp) }
}
