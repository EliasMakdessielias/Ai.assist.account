// Ren logik för leverantörsfaktura – inga beroenden på React eller Supabase, så att
// den kan enhetstestas isolerat (se leverantorsfaktura.test.js).
//
// Innehåll:
//  * Kontoplan-validering inför bokföring (missing/reactivatable).
//  * Kreditfaktura-detektion från OCR/tolkning (detectCreditInvoice).
//  * Konteringsbyggare för debet- och kreditfaktura (buildSupplierInvoicePosting).
//
// Bokföringsregel (leverantörsfaktura):
//  - Vanlig faktura:   kostnad + ingående moms = DEBET, leverantörsskuld (2440) = KREDIT.
//  - Kreditfaktura:    kostnad + ingående moms = KREDIT, leverantörsskuld (2440) = DEBET.
// Beloppen i debet/kredit-kolumnerna är ALLTID positiva; fakturahuvudets total/moms
// kan vara negativa för en kreditfaktura.

const nrOf = r => String(r?.nr ?? '').trim()
// Normalisera Unicode-minus (sv-SE formaterar negativa tal med U+2212) + diverse streck
// till ASCII-minus, annars blir t.ex. "−291,50" → NaN → 0 vid återinläsning.
const num = v => { const n = parseFloat(String(v ?? '').replace(/[−‒–—―]/g, '-').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ---------------------------------------------------------------------------
// Kontoplan-validering
// ---------------------------------------------------------------------------

// Konteringskonton som inte finns i kontoplanen (felstavat/oimporterat konto).
// rows: [{ nr }]; accountNrs: array eller Set av befintliga account_nr.
export function missingKonteringAccounts(rows, accountNrs) {
  const set = accountNrs instanceof Set ? accountNrs : new Set((accountNrs || []).map(a => String(typeof a === 'object' && a ? a.account_nr : a)))
  const out = []
  for (const r of rows || []) {
    const nr = nrOf(r)
    if (nr && !set.has(nr) && !out.includes(nr)) out.push(nr)
  }
  return out
}

// Konton som säkert kan återaktiveras: används i konteringen, är inaktiva och INTE låsta.
// Låsta konton lämnas orörda (skyddas av protect_locked_account).
export function reactivatableAccounts(rows, accounts) {
  const used = new Set((rows || []).map(nrOf).filter(Boolean))
  const out = []
  for (const a of accounts || []) {
    const nr = String(a?.account_nr ?? '')
    if (used.has(nr) && a?.is_active === false && !a?.is_locked && !out.includes(nr)) out.push(nr)
  }
  return out
}

// ---------------------------------------------------------------------------
// Kreditfaktura-detektion
// ---------------------------------------------------------------------------

// Specifika uttryck (sv/en). Medvetet snäva – bara "kredit" matchar INTE (kreditkort,
// kreditvillkor, kredittid, kreditgräns är betalkredit, inte kreditfaktura).
export const CREDIT_KEYWORDS = [
  'kreditfaktura', 'kreditnota', 'kreditering', 'krediteras', 'kreditmeddelande', 'kreditnotering',
  'att erhålla', 'att erhalla', 'credit invoice', 'credit note', 'credit memo', 'creditnote',
]

function gatherText(result) {
  const fields = [
    result?.beskrivning, result?.typ, result?.fakturatyp, result?.dokumenttyp, result?.dokument,
    result?.invoice_type, result?.invoiceType, result?.credit_reason, result?.creditReason,
    result?.credit_evidence, result?.creditEvidence, result?.sourceEvidence, result?.titel, result?.rubrik,
  ]
  return fields.filter(Boolean).map(String).join('  ').toLowerCase()
}

function matchCreditKeyword(text) {
  for (const kw of CREDIT_KEYWORDS) if (text.includes(kw)) return kw
  return null
}

// Avgör om en OCR-tolkning är en kreditfaktura. Försiktig: kräver en TYDLIG signal
// (uttrycklig OCR-flagga, känt nyckelord, 2440 på debet, eller negativt belopp).
// Returnerar { isCreditInvoice, invoiceType, creditReason, sourceEvidence }.
export function detectCreditInvoice(result) {
  const r = result || {}
  const explicit =
    r.is_credit_invoice === true || r.isCreditInvoice === true || r.kreditfaktura === true ||
    String(r.invoice_type || r.invoiceType || '').toLowerCase() === 'credit'

  const kw = matchCreditKeyword(gatherText(r))

  const kontering = Array.isArray(r.konteringsrader) ? r.konteringsrader : []
  const payableOnDebet = kontering.some(x => /^244/.test(String(x?.konto || '')) && num(x?.debet) > 0)

  const negAmount =
    num(r.belopp_inkl_moms ?? r.total ?? r.belopp ?? r.summa) < 0 ||
    num(r.moms_belopp ?? r.moms ?? r.vat) < 0

  const isCreditInvoice = !!(explicit || kw || payableOnDebet || negAmount)

  let creditReason = '', sourceEvidence = ''
  if (isCreditInvoice) {
    if (explicit) {
      sourceEvidence = String(r.credit_evidence || r.creditEvidence || r.sourceEvidence || 'OCR: invoice_type=credit')
      creditReason = String(r.credit_reason || r.creditReason || 'OCR klassade underlaget som kreditfaktura')
    } else if (kw) {
      sourceEvidence = kw
      creditReason = `Nyckelord i underlaget: "${kw}"`
    } else if (payableOnDebet) {
      sourceEvidence = '2440 på debet'
      creditReason = 'Leverantörsskuld (2440) konterad på debet'
    } else {
      sourceEvidence = 'negativt belopp'
      creditReason = 'Negativ total/moms i underlaget'
    }
  }
  return { isCreditInvoice, invoiceType: isCreditInvoice ? 'credit' : 'debit', creditReason, sourceEvidence }
}

// ---------------------------------------------------------------------------
// Teckenhantering (undviker dubbel-negativ)
// ---------------------------------------------------------------------------

// Magnituden (alltid positiv) av ett (ev. redan negativt) OCR-belopp.
export function amountMagnitude(value) { return round2(Math.abs(num(value))) }

// Fakturahuvudets tecken: magnitud × (kredit ? −1 : +1). abs() först → aldrig dubbel-negativ
// även om OCR redan returnerade ett negativt belopp.
export function signedHeaderAmount(value, isCreditInvoice) {
  const mag = amountMagnitude(value)
  return isCreditInvoice ? -mag : mag
}

// ---------------------------------------------------------------------------
// Konteringsbyggare
// ---------------------------------------------------------------------------

const line = (nr, name, side, amount, info = '') => ({
  nr: String(nr), name: name || '', info: info || '',
  debet: side === 'debet' ? round2(amount) : 0,
  kredit: side === 'kredit' ? round2(amount) : 0,
})

// Bygger en balanserad kontering för en leverantörsfaktura (debet ELLER kredit).
// Indata:
//   isCreditInvoice  – vänder sidorna.
//   total, vat       – fakturahuvudets belopp (tecken spelar ingen roll, abs används).
//   rows             – kostnadsrader [{ nr/konto, name/namn, amount/debet/kredit }] (magnituder).
//   vatAccount/vatName, payableAccount/payableName – konton för moms resp. leverantörsskuld.
//   rounding         – max öresutjämning som auto-balanseras (default 1,50).
// Returnerar { rows:[{nr,name,info,debet,kredit}], totalDebet, totalKredit, diff, balanced }.
export function buildSupplierInvoicePosting({
  isCreditInvoice = false, total = 0, vat = 0, rows = [], rounding = 1.5,
  payableAccount = '2440', payableName = 'Leverantörsskulder',
  vatAccount = '2640', vatName = 'Ingående moms',
} = {}) {
  const T = amountMagnitude(total)
  const M = amountMagnitude(vat)
  const costSide = isCreditInvoice ? 'kredit' : 'debet'   // kostnad + moms
  const payableSide = isCreditInvoice ? 'debet' : 'kredit' // leverantörsskuld

  const out = []
  for (const r of rows || []) {
    const amt = amountMagnitude(r.amount ?? r.belopp ?? (num(r.debet) || num(r.kredit)))
    if (amt <= 0.005) continue
    out.push(line(r.nr ?? r.konto, r.name ?? r.namn, costSide, amt, r.info))
  }
  if (M > 0.005) out.push(line(vatAccount, vatName, costSide, M))
  if (T > 0.005) out.push(line(payableAccount, payableName, payableSide, T))

  // Öresutjämning (konto 3740): balansera på den sida som är "kort". Tecknet följer
  // differensen, inte kredit/debet-fakturatypen → korrekt åt båda håll.
  let diff = round2(out.reduce((s, r) => s + r.debet, 0) - out.reduce((s, r) => s + r.kredit, 0))
  if (Math.abs(diff) > 0.005 && Math.abs(diff) <= rounding) {
    out.push(line('3740', 'Öres- och kronutjämning', diff > 0 ? 'kredit' : 'debet', Math.abs(diff), 'Öresutjämning'))
    diff = 0
  }

  const totalDebet = round2(out.reduce((s, r) => s + r.debet, 0))
  const totalKredit = round2(out.reduce((s, r) => s + r.kredit, 0))
  return { rows: out, totalDebet, totalKredit, diff, balanced: Math.abs(round2(totalDebet - totalKredit)) < 0.005 }
}

// Delar upp OCR:ns konteringsrader i kostnadsrader (magnituder) samt identifierar
// momskonto. Leverantörsskuld (244x) och momskonto (264x) plockas bort ur kostnaderna.
export function costRowsFromKontering(kontering) {
  const list = Array.isArray(kontering) ? kontering : []
  let vatAccount = null
  const costRows = []
  for (const r of list) {
    const nr = String(r?.konto ?? r?.nr ?? '').trim()
    if (!nr) continue
    const amt = round2(Math.abs(num(r.debet) || num(r.kredit) || num(r.amount)))
    if (/^244/.test(nr)) continue                 // leverantörsskuld – byggs separat
    if (/^264/.test(nr)) { vatAccount = nr; continue } // moms – byggs separat
    if (amt > 0.005) costRows.push({ nr, name: r.benamning || r.name || r.namn || '', amount: amt })
  }
  return { costRows, vatAccount }
}
