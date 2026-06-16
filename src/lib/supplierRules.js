// Lärande regelmotor: leverantör → bokföringskonto. Företagsspecifik (RLS + company_id i DB).
// Rena, testbara funktioner. DB-läsning/skrivning sker i komponenten (NyLeverantorsfaktura).
//
// En regel = (företag, leverantör, fakturakategori, radnyckelord) → konto, med tillhörande
// momskonto/sats, fördelningsandel, bekräftelse-/korrigeringsräknare och confidence.
// Confidence stiger med bekräftelser och sänks vid korrigeringar. Globala standardförslag
// får användas som grund men företagets egen historik väger tyngst (hanteras i komponenten).

const norm = s => String(s ?? '').toLowerCase().replace(/[^0-9a-zåäö ]+/gi, ' ').replace(/\s+/g, ' ').trim()

// Confidence-trösklar.
export const RULE_AUTOFILL = 0.8   // ≥ → fyll i automatiskt (men visa att det är inlärt)
export const RULE_SUGGEST = 0.4    // ≥ → föreslå (men fyll inte i automatiskt)

// Beloppstyp utifrån kontonummer (BAS): styr hur en rad tolkas i lärandet.
export function belopptyp(nr) {
  const s = String(nr || '')
  if (/^264\d$/.test(s)) return 'ingaende_moms'
  if (/^26[123]\d$/.test(s)) return 'utgaende_moms'
  if (/^24/.test(s)) return 'leverantorsskuld'
  if (s === '3740') return 'oresavrundning'
  if (/^[4-7]\d{3}$/.test(s)) return 'kostnad'
  return 'ovrigt'
}

// Normaliserat radnyckelord (transaktionsinfo/benämning) för matchning, max 40 tecken.
export function ruleKeyword(text) { return norm(text).slice(0, 40) }

// Confidence utifrån bekräftelser/korrigeringar. Första bekräftelsen = svagt förslag.
export function ruleConfidence({ confirmation_count = 0, correction_count = 0 } = {}) {
  const c = Math.max(0, Number(confirmation_count) || 0)
  let conf = c >= 4 ? 0.95 : c === 3 ? 0.9 : c === 2 ? 0.7 : c === 1 ? 0.4 : 0.2
  conf -= 0.2 * Math.max(0, Number(correction_count) || 0)
  return Math.max(0.1, Math.min(0.97, Math.round(conf * 100) / 100))
}

// Hittar samma regel i en lista (matchning vid upsert): leverantör + kategori + nyckelord + konto.
export function findMatchingRule(rules = [], { invoice_category = null, line_keyword = null, account_number } = {}) {
  const kw = ruleKeyword(line_keyword)
  return rules.find(r =>
    String(r.account_number) === String(account_number) &&
    (r.invoice_category || null) === (invoice_category || null) &&
    ruleKeyword(r.line_keyword) === kw) || null
}

// Bästa regel för en kontext (rules redan filtrerade på leverantör). Prioritet:
// nyckelordsmatch > kategorimatch > leverantörsgenerell regel, därefter confidence och antal.
export function bestRuleFor(rules = [], { invoiceCategory = null, keyword = null } = {}) {
  const kw = ruleKeyword(keyword)
  const active = rules.filter(r => (r.status || 'active') === 'active')
  const score = r => {
    let s = 0
    if (kw && ruleKeyword(r.line_keyword) === kw) s += 100
    else if (kw && r.line_keyword && (kw.includes(ruleKeyword(r.line_keyword)) || ruleKeyword(r.line_keyword).includes(kw))) s += 50
    if (invoiceCategory && r.invoice_category === invoiceCategory) s += 10
    if (!r.line_keyword) s += 1
    return s
  }
  const sorted = [...active].sort((a, b) =>
    score(b) - score(a) ||
    (b.confidence_score || 0) - (a.confidence_score || 0) ||
    (b.confirmation_count || 0) - (a.confirmation_count || 0))
  const top = sorted[0]
  return top && (top.confidence_score || 0) >= RULE_SUGGEST ? top : null
}

// Bygg regel-kandidater från den slutligt godkända konteringen. En kandidat per kostnadskonto,
// med tillhörande momskonto + fördelningsandel (för flera-konton-mönster).
// rows: [{ nr, namn, info, debet, kredit }].
export function rulesFromKontering(rows = [], { vat_rate = null } = {}) {
  const cost = rows.filter(r => belopptyp(r.nr) === 'kostnad')
  const momsRow = rows.find(r => belopptyp(r.nr) === 'ingaende_moms' || belopptyp(r.nr) === 'utgaende_moms')
  const belopp = r => Math.max(Number(r.debet) || 0, Number(r.kredit) || 0)
  const total = cost.reduce((s, r) => s + belopp(r), 0)
  return cost.map(r => ({
    account_number: String(r.nr),
    account_name: r.namn || '',
    line_keyword: ruleKeyword(r.info) || null,
    vat_account: momsRow ? String(momsRow.nr) : null,
    vat_rate: vat_rate != null ? Number(vat_rate) : null,
    belopp_type: 'kostnad',
    allocation_share: total ? Math.round((belopp(r) / total) * 100) / 100 : null,
  }))
}

// Avviker den nya konteringen från leverantörens inlärda mönster? → markera för granskning.
// Sant om någon kostnadsrad använder ett konto som inte finns i en stark (≥SUGGEST) regel.
export function avvikerFranMonster(rows = [], rules = []) {
  const strong = rules.filter(r => (r.status || 'active') === 'active' && (r.confidence_score || 0) >= RULE_SUGGEST)
  if (!strong.length) return false
  const known = new Set(strong.map(r => String(r.account_number)))
  const cost = rows.filter(r => belopptyp(r.nr) === 'kostnad')
  return cost.some(r => !known.has(String(r.nr)))
}
