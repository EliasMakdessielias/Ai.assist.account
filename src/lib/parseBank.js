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
  let t = String(s).replace(/\s/g, '').replace(/kr/i, '')
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

// Gissar kolumnindex utifrån rubriknamn.
export function guessColumns(header) {
  const find = (...keys) => header.findIndex(h => keys.some(k => h.toLowerCase().includes(k)))
  return {
    datum: Math.max(0, find('datum', 'date', 'bokf')),
    text: Math.max(0, find('text', 'beskriv', 'meddel', 'narrative', 'referens')),
    belopp: Math.max(0, find('belopp', 'amount', 'summa')),
  }
}
