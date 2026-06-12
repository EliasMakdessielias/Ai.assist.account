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

// Ingående moms-konton (BAS 264x): 2640 Ingående moms, 2641 Debiterad ingående moms,
// 2645 Beräknad ingående moms på förvärv från utlandet m.fl.
export function isIngaendeMomsKonto(nr) { return /^264\d$/.test(String(nr || '')) }

// Synkar konteringsraderna med fakturahuvudet (Total/Moms) utan att duplicera momsraden.
// - 2440-raden får Total på skuldsidan (debet vid kreditfaktura, annars kredit).
// - Finns EXAKT EN ingående momsrad (264x) uppdateras DEN och kontot bevaras (t.ex. 2641
//   från "Kontering från förra fakturan") – det skapas ALDRIG en parallell 2640-rad.
// - Saknas momsrad och moms > 0 skapas en 2640-rad.
// - Finns FLERA momsrader (t.ex. EU-förvärv med 2645) lämnas momsraderna orörda –
//   avancerad momskontering auto-synkas inte.
// Radbeloppen är alltid positiva: kreditfaktura styr SIDAN, aldrig tecknet.
// `rows` är UI-rader ({ konto, namn, info, debet, kredit } med formaterade strängar);
// `format` formaterar tal till radsträng (svensk visning i UI, identitet i tester).
export function syncRowsWithHeader(rows, { total, moms, isCreditInvoice = false, accMap = {}, format = v => v } = {}) {
  const t = amountMagnitude(total), m = amountMagnitude(moms)
  const skuldSide = isCreditInvoice ? 'debet' : 'kredit'
  const momsSide = isCreditInvoice ? 'kredit' : 'debet'
  const next = rows.map(r => r.konto === '2440' ? { ...r, [skuldSide]: t ? format(t) : '', [momsSide]: '' } : r)
  const momsIdx = next.reduce((acc, r, i) => (isIngaendeMomsKonto(r.konto) ? [...acc, i] : acc), [])
  if (momsIdx.length === 1) {
    if (m > 0.005) next[momsIdx[0]] = { ...next[momsIdx[0]], [momsSide]: format(m), [skuldSide]: '' }
    else next.splice(momsIdx[0], 1)
  } else if (momsIdx.length === 0 && m > 0.005) {
    const ins = next.length > 1 ? 1 : next.length
    next.splice(ins, 0, { konto: '2640', namn: accMap['2640'] || 'Ingående moms', info: '', debet: '', kredit: '', [momsSide]: format(m), [skuldSide]: '' })
  }
  return next
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
// Flera tolkade rader på SAMMA konto (t.ex. fakturans specifikationsrader) slås ihop
// till EN kostnadsrad per konto – konteringen ska aldrig splittra samma konto.
export function costRowsFromKontering(kontering) {
  const list = Array.isArray(kontering) ? kontering : []
  let vatAccount = null
  const byNr = new Map()   // bevarar första förekomstens ordning
  for (const r of list) {
    const nr = String(r?.konto ?? r?.nr ?? '').trim()
    if (!nr) continue
    const amt = round2(Math.abs(num(r.debet) || num(r.kredit) || num(r.amount)))
    if (/^244/.test(nr)) continue                 // leverantörsskuld – byggs separat
    if (/^264/.test(nr)) { vatAccount = nr; continue } // moms – byggs separat
    if (/^374/.test(nr)) continue                 // öresavrundning – byggs/återskapas separat
    if (amt <= 0.005) continue
    const name = r.benamning || r.name || r.namn || ''
    const ex = byNr.get(nr)
    if (ex) { ex.amount = round2(ex.amount + amt); if (!ex.name && name) ex.name = name }
    else byNr.set(nr, { nr, name, amount: amt })
  }
  return { costRows: [...byNr.values()], vatAccount }
}

// Stämmer av OCR:ns kostnadsrader mot ett tillförlitligt netto (Total − Moms). OCR
// dubbelräknar ibland (t.ex. en delsumma OCH en enskild rad som redan ingår i delsumman),
// vilket gör att summan inte balanserar. Logik:
//   * Summerar raderna ≈ nettot (inom öresavrundning, tol) → behåll dem oförändrade
//     (öresavrundningen hanteras sedan av buildSupplierInvoicePosting).
//   * Annars (dubbelräkning/saknad rad) → korrigera till nettot: ett konto → en nettorad
//     (löser dubbelräkning rent); flera konton → proportionell skalning så summan = nettot.
export function reconcileCostRows(costRows, netTarget, tol = 1.5) {
  const rows = (costRows || [])
    .map(r => ({ nr: String(r.nr ?? r.konto ?? '').trim(), name: r.name ?? r.namn ?? '', amount: round2(Math.abs(num(r.amount ?? r.debet ?? r.kredit))) }))
    .filter(r => r.nr && r.amount > 0.005)
  const net = round2(Math.abs(num(netTarget)))
  if (!net || !rows.length) return rows
  const sum = round2(rows.reduce((s, r) => s + r.amount, 0))
  if (Math.abs(sum - net) <= tol) return rows   // konsistent – öresavrundning sköts av byggaren

  const distinct = [...new Set(rows.map(r => r.nr))]
  if (distinct.length === 1) return [{ nr: distinct[0], name: rows[0].name, amount: net }]

  // Flera konton → skala proportionellt; lägg avrundningsresten på den största raden.
  const factor = net / sum
  let acc = 0
  const scaled = rows.map(r => { const a = round2(r.amount * factor); acc = round2(acc + a); return { ...r, amount: a } })
  const resid = round2(net - acc)
  if (Math.abs(resid) >= 0.01) {
    let big = 0
    scaled.forEach((r, i) => { if (r.amount > scaled[big].amount) big = i })
    scaled[big] = { ...scaled[big], amount: round2(scaled[big].amount + resid) }
  }
  return scaled
}

// ---------------------------------------------------------------------------
// "Kontering från förra fakturan" – återanvänd kontostruktur från en tidigare verifikation
// ---------------------------------------------------------------------------

// Plockar isär en tidigare verifikations rader till kontostruktur:
//   costAccounts: kostnadskonton (allt utom 244x/264x/374x) med tidigare magnitud (för proportion),
//   vatAccount/payableAccount: momskonto (264x) resp. leverantörsskuld (244x) med benämning.
// Accepterar både verifikation_rows (account_nr/account_name) och interna rader (nr/konto).
// Flera tidigare rader på SAMMA kostnadskonto slås ihop (summerad prevAmount) –
// den nya konteringen ska ha EN rad per konto, inte ärva gammal radsplittring.
export function konteringStructureFromRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  let vatAccount = null, vatName = '', payableAccount = '2440', payableName = 'Leverantörsskulder'
  const byNr = new Map()   // bevarar första förekomstens ordning
  for (const r of list) {
    const nr = String(r?.account_nr ?? r?.konto ?? r?.nr ?? '').trim()
    if (!nr) continue
    const name = r?.account_name ?? r?.name ?? r?.namn ?? r?.benamning ?? ''
    const amt = round2(Math.abs(num(r?.debet) || num(r?.kredit) || num(r?.amount)))
    if (/^244/.test(nr)) { payableAccount = nr; if (name) payableName = name; continue }
    if (/^264/.test(nr)) { vatAccount = nr; if (name) vatName = name; continue }
    if (/^374/.test(nr)) continue   // öresavrundning – återskapas av byggaren
    const ex = byNr.get(nr)
    if (ex) { ex.prevAmount = round2(ex.prevAmount + amt); if (!ex.name && name) ex.name = name }
    else byNr.set(nr, { nr, name, prevAmount: amt })
  }
  return { costAccounts: [...byNr.values()], vatAccount, vatName, payableAccount, payableName }
}

// Bygger NY kontering utifrån en tidigare fakturas kontostruktur + NYA total/moms.
// Gamla belopp kopieras ALDRIG rakt av – endast kontona återanvänds, beloppen räknas om:
//   * ett kostnadskonto  → hela nettot (Total − Moms) på det kontot,
//   * flera kostnadskonton med tidigare belopp → nettot fördelas PROPORTIONELLT,
//   * flera utan användbar proportion → konton utan belopp + flagga needsManualAmounts.
// Moms hamnar på tidigare momskonto (264x), total på leverantörsskuld (244x). Kreditfaktura
// vänder sidorna. Öresutjämning och balans sköts av buildSupplierInvoicePosting.
export function buildKonteringFromPrevious(prevRows, { total = 0, vat = 0, isCreditInvoice = false, accMap = {} } = {}) {
  const struct = konteringStructureFromRows(prevRows)
  const T = amountMagnitude(total), M = amountMagnitude(vat)
  const net = round2(T - M)
  const nameOf = (nr, fb) => (accMap && accMap[nr]) || fb || ''
  const vatAccount = struct.vatAccount || '2641'
  const vatName = nameOf(vatAccount, struct.vatName || 'Debiterad ingående moms')
  const payableAccount = struct.payableAccount
  const payableName = nameOf(payableAccount, struct.payableName)

  let needsManualAmounts = false
  let costRows = []
  if (struct.costAccounts.length <= 1) {
    const c = struct.costAccounts[0]
    if (c && net > 0.005) costRows = [{ nr: c.nr, name: nameOf(c.nr, c.name), amount: net }]
    else if (c) costRows = [{ nr: c.nr, name: nameOf(c.nr, c.name), amount: 0 }]
  } else {
    const prevSum = round2(struct.costAccounts.reduce((s, c) => s + c.prevAmount, 0))
    if (prevSum > 0.005 && net > 0.005) {
      let acc = 0
      costRows = struct.costAccounts.map(c => { const a = round2(net * (c.prevAmount / prevSum)); acc = round2(acc + a); return { nr: c.nr, name: nameOf(c.nr, c.name), amount: a } })
      const resid = round2(net - acc)
      if (Math.abs(resid) >= 0.01) { let big = 0; costRows.forEach((r, i) => { if (r.amount > costRows[big].amount) big = i }); costRows[big] = { ...costRows[big], amount: round2(costRows[big].amount + resid) } }
    } else {
      needsManualAmounts = true
      costRows = struct.costAccounts.map(c => ({ nr: c.nr, name: nameOf(c.nr, c.name), amount: 0 }))
    }
  }

  if (needsManualAmounts) {
    // Konton utan belopp + moms/leverantörsskuld med belopp på rätt sida. Balanserar INTE
    // (kräver manuell kontroll); debet/kredit hålls positiva (0 på tomma kostnadsrader).
    const costSide = isCreditInvoice ? 'kredit' : 'debet'
    const payableSide = isCreditInvoice ? 'debet' : 'kredit'
    const out = costRows.map(c => ({ nr: c.nr, name: c.name, info: '', debet: 0, kredit: 0 }))
    if (M > 0.005) out.push(line(vatAccount, vatName, costSide, M))
    if (T > 0.005) out.push(line(payableAccount, payableName, payableSide, T))
    return { rows: out, needsManualAmounts: true, balanced: false }
  }

  const posting = buildSupplierInvoicePosting({
    isCreditInvoice, total: T, vat: M, rows: costRows.filter(r => r.amount > 0.005),
    vatAccount, vatName, payableAccount, payableName,
  })
  return { rows: posting.rows, needsManualAmounts: false, balanced: posting.balanced }
}
