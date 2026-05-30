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

// Gissar kolumnindex utifrån rubriknamn (och värden som fallback).
// `rows` kan vara antingen rubrikraden (array av strängar) eller hela tabellen
// (array av rader) – i det senare fallet används dataraderna för värde-detektering.
export function guessColumns(rows) {
  const isTable = Array.isArray(rows?.[0])
  const header = isTable ? rows[0] : rows
  const samples = isTable ? rows.slice(1, 9) : []
  const lower = header.map(h => String(h || '').toLowerCase())

  const find = (keys, avoid = []) => lower.findIndex(h => keys.some(k => h.includes(k)) && !avoid.some(a => h.includes(a)))

  const datum = find(['valutadatum', 'transaktionsdatum', 'bokförd', 'bokford', 'datum', 'date', 'bokf'])
  const text = find(['text', 'beskriv', 'meddel', 'narrative', 'referens', 'mottagare', 'avsändare', 'rubrik', 'info'])
  // Beloppskolumn: undvik "saldo" (kontots saldo, inte transaktionsbeloppet).
  let belopp = find(['insättning', 'insattning', 'uttag', 'belopp', 'amount', 'summa', 'transaktionsbelopp', 'rörelse', 'rorelse', 'debet', 'kredit'], ['saldo'])

  // Värde-baserad fallback om rubriken inte gav träff.
  if (belopp < 0 && samples.length) {
    for (let i = 0; i < header.length; i++) {
      if (i === datum || i === text || lower[i].includes('saldo')) continue
      const vals = samples.map(r => parseAmount(r[i])).filter(v => v != null)
      const hasDecimals = samples.some(r => /[.,]\d{1,2}\b/.test(String(r[i] || '')) || /-/.test(String(r[i] || '')))
      if (vals.length >= Math.max(1, Math.floor(samples.length * 0.6)) && hasDecimals) { belopp = i; break }
    }
  }

  return { datum: Math.max(0, datum), text: Math.max(0, text), belopp: Math.max(0, belopp) }
}
