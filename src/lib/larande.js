// Lärande över tid (spårbart): jämför AI-tolkningen mot användarens slutliga värden och
// plockar ut korrigeringar (träningsdata) + den inlärda standardkonteringen per leverantör.
// Rena funktioner – DB-skrivning och bekräftelse sker i komponenten. Ingen parallell datamodell:
// korrigeringar loggas i extraction_corrections, inlärt kostnadskonto sparas i suppliers.default_motkonto.

const norm = v => String(v ?? '').trim()
const mag = v => {
  const n = parseFloat(String(v ?? '').replace(/[−‒–—―]/g, '-').replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? null : Math.abs(n)
}

// Fält vi spårar korrigeringar för. `extract` läser värdet ur AI-resultatet (original).
export const SPARADE_FALT = [
  { key: 'fakturadatum', extract: r => r.fakturadatum || r.datum },
  { key: 'forfallodatum', extract: r => r.forfallodatum },
  { key: 'fakturanummer', extract: r => r.fakturanummer || r.fakturanr || r.invoice_nr },
  { key: 'ocr', extract: r => r.ocr },
  { key: 'belopp_inkl_moms', numeric: true, extract: r => r.belopp_inkl_moms ?? r.total ?? r.belopp ?? r.summa },
  { key: 'moms_belopp', numeric: true, extract: r => r.moms_belopp ?? r.moms ?? r.vat },
]

// Jämför AI-original mot användarens slutliga värden (final = { fält: värde }).
// Returnerar en post per ändrat fält: { field, original_value, final_value, confidence_before }.
export function samlaKorrigeringar({ original, final = {}, faltSak = {} } = {}) {
  if (!original) return []
  const out = []
  for (const f of SPARADE_FALT) {
    if (f.numeric) {
      const o = mag(f.extract(original)), n = mag(final[f.key])
      if (n != null && (o == null || Math.abs(o - n) > 0.01)) {
        out.push({ field: f.key, original_value: o != null ? String(o) : null, final_value: String(n), confidence_before: faltSak?.[f.key] ?? null })
      }
    } else {
      const o = norm(f.extract(original)), n = norm(final[f.key])
      if (n && o !== n) out.push({ field: f.key, original_value: o || null, final_value: n, confidence_before: faltSak?.[f.key] ?? null })
    }
  }
  return out
}

// Det inlärda kostnadskontot ur en bokförd kontering: störst belopp på rätt sida,
// exklusive moms (264x), leverantörsskuld (244x) och öresavrundning (3740).
// rows: [{ nr, debet, kredit }]. Vid kreditfaktura ligger kostnaden på kredit.
export function larDefaultMotkonto(rows = [], isCreditInvoice = false) {
  const belopp = r => Number(isCreditInvoice ? r.kredit : r.debet) || 0
  const cand = rows.filter(r => {
    const nr = String(r.nr || '')
    if (/^264/.test(nr) || /^244/.test(nr) || nr === '3740') return false
    return belopp(r) > 0
  })
  if (!cand.length) return null
  cand.sort((a, b) => belopp(b) - belopp(a))
  return String(cand[0].nr)
}
