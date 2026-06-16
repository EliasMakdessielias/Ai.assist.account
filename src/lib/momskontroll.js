// Momskontroll / månadskontroll (read-only): hittar bokföringsfel inför momsredovisning.
// Ändrar ALDRIG bokföringen – returnerar fynd med exakt var felet sitter (verifikation, konto,
// belopp, förväntat). Konservativ: kör ratiokontroller bara på "rena" verifikationer (en momsrad)
// för att undvika falsklarm vid blandade momssatser.
//
// Kontroller:
//  - Ingående/utgående moms som inte matchar 25/12/6 % av kostnads-/intäktsnettot
//  - Moms bokförd på fel momskonto kontra försäljningskontots sats (3001=25, 3002=12, 3003=6)
//  - Moms i fel riktning (ingående moms på försäljning / utgående moms på inköp)
//  - Momspliktig försäljning utan utgående moms
//  - Leverantörsfaktura bokförd med fel belopp eller fel moms mot fakturan

const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// BAS-kontoklassning via kontonummer (robust, oberoende av vat_code).
export const isOutputVat = nr => /^26[123]\d$/.test(String(nr || ''))      // 261x/262x/263x utgående
export const isInputVat = nr => /^264\d$/.test(String(nr || ''))           // 264x ingående
export const outputVatRate = nr => (/^261/.test(nr) ? 25 : /^262/.test(nr) ? 12 : /^263/.test(nr) ? 6 : null)
export const isRevenue = nr => /^3\d{3}$/.test(String(nr || '')) && String(nr) !== '3740'
export const isCost = nr => /^[4-7]\d{3}$/.test(String(nr || '')) && String(nr) !== '3740'
// Försäljningskontots förväntade momssats (BAS): 3001=25, 3002=12, 3003=6, 3004=momsfri.
export const salesAccountRate = nr => ({ 3001: 25, 3002: 12, 3003: 6, 3004: 0 }[String(nr || '')] ?? null)

// Tolerans för öresavrundning/avrundning: 1 kr eller 1 % av basen.
const within = (a, b, base) => Math.abs(a - b) <= Math.max(1, Math.abs(base) * 0.01)
const matchesAnyRate = (vat, base) => [25, 12, 6].some(rate => within(Math.abs(vat), Math.abs(base) * rate / 100, base))
const impliedPct = (vat, base) => r2(Math.abs(vat) / Math.abs(base) * 100)

// Returnerar fynd: { sev:'fel'|'varning', kod, titel, detalj, verId, ver_nr, datum, belopp? }.
export function granskaMomsFynd({ vers = [], rowsByVer = {}, supplierInvoices = [] } = {}) {
  const out = []
  const add = (sev, kod, titel, detalj, v) => out.push({ sev, kod, titel, detalj, verId: v.id, ver_nr: v.ver_nr, datum: v.datum })

  for (const v of vers) {
    const rs = rowsByVer[v.id] || []
    let costBase = 0, revBase = 0, inVat = 0, outVat = 0, vatRows = 0
    const outRows = []; let revRows = 0; let ratedSalesBase = 0; let ratedSalesExpVat = 0
    for (const r of rs) {
      const nr = String(r.account_nr || ''); const d = Number(r.debet) || 0, k = Number(r.kredit) || 0
      if (isCost(nr)) costBase += d - k
      else if (isRevenue(nr)) {
        revBase += k - d; revRows++
        const sr = salesAccountRate(nr)
        if (sr != null && sr > 0) { ratedSalesBase += k - d; ratedSalesExpVat += (k - d) * sr / 100 }
      } else if (isInputVat(nr)) { inVat += d - k; vatRows++ }
      else if (isOutputVat(nr)) { outVat += k - d; vatRows++; outRows.push({ nr, belopp: k - d }) }
    }
    costBase = r2(costBase); revBase = r2(revBase); inVat = r2(inVat); outVat = r2(outVat); ratedSalesExpVat = r2(ratedSalesExpVat)

    // --- Ingående moms ---
    if (Math.abs(inVat) > 1) {
      if (Math.abs(costBase) < 1 && Math.abs(revBase) >= 1) {
        add('varning', 'moms_fel_riktning', 'Ingående moms på en försäljning?',
          'Verifikationen ser ut som en försäljning men har ingående moms (264x). Ska det vara utgående moms (261x/262x/263x)?', v)
      } else if (Math.abs(costBase) < 1) {
        add('varning', 'moms_utan_konto', 'Ingående moms utan kostnadskonto',
          `Ingående moms ${fmt(inVat)} kr men inget kostnadskonto (4–7xxx) i verifikationen. Kontrollera konteringen.`, v)
      } else if (vatRows === 1 && !matchesAnyRate(inVat, costBase)) {
        add('fel', 'moms_fel_sats', 'Ingående moms stämmer inte med kostnadskontot',
          `Momsen (${fmt(inVat)} kr) är ${impliedPct(inVat, costBase)} % av nettot (${fmt(costBase)} kr) – förväntat 25/12/6 %. Kontrollera moms eller kostnadskonto.`, v)
      }
    }

    // --- Utgående moms ---
    if (Math.abs(outVat) > 1) {
      if (Math.abs(revBase) < 1 && Math.abs(costBase) >= 1) {
        add('varning', 'moms_fel_riktning', 'Utgående moms på ett inköp?',
          'Verifikationen ser ut som ett inköp men har utgående moms. Ska det vara ingående moms (264x)?', v)
      } else if (Math.abs(revBase) < 1) {
        add('varning', 'moms_utan_konto', 'Utgående moms utan intäktskonto',
          `Utgående moms ${fmt(outVat)} kr men ingen försäljning (3xxx) i verifikationen. Kontrollera konteringen.`, v)
      } else if (vatRows === 1 && !matchesAnyRate(outVat, revBase)) {
        add('fel', 'moms_fel_sats', 'Utgående moms stämmer inte med försäljningen',
          `Momsen (${fmt(outVat)} kr) är ${impliedPct(outVat, revBase)} % av nettot (${fmt(revBase)} kr) – förväntat 25/12/6 %.`, v)
      } else if (revRows === 1 && ratedSalesBase > 1 && Math.abs(outVat - ratedSalesExpVat) > Math.max(1, ratedSalesBase * 0.01)) {
        // Momsen matchar inte försäljningskontots sats (t.ex. 3001 = 25 % men 6 % moms bokförd).
        add('fel', 'moms_fel_konto', 'Momsen matchar inte försäljningskontot',
          `Försäljningskontot kräver ${fmt(ratedSalesExpVat)} kr i moms men ${fmt(outVat)} kr är bokfört. Kontrollera momssats/momskonto.`, v)
      }
    }

    // --- Momspliktig försäljning utan utgående moms ---
    if (Math.abs(outVat) < 1 && ratedSalesBase > 100) {
      add('varning', 'moms_saknas', 'Momspliktig försäljning utan utgående moms',
        `Försäljning ${fmt(ratedSalesBase)} kr på momspliktigt konto men ingen utgående moms bokförd. Kontrollera momsplikt.`, v)
    }
  }

  // --- Leverantörsfakturor bokförda fel ---
  for (const s of supplierInvoices) {
    if (!s.verifikation_id || !s.bokford || s.makulerad) continue
    const v = vers.find(x => x.id === s.verifikation_id)
    if (!v) continue
    const rs = rowsByVer[v.id] || []
    const verTotal = r2(Math.max(Number(v.total_debet) || 0, Number(v.total_kredit) || 0))
    const invTotal = r2(Math.abs(Number(s.total_amount) || 0))
    if (invTotal > 0 && Math.abs(verTotal - invTotal) > 1) {
      add('fel', 'lev_fel_belopp', 'Leverantörsfaktura bokförd med fel belopp',
        `Faktura ${s.invoice_nr || ''}: bokfört ${fmt(verTotal)} kr men fakturan är ${fmt(invTotal)} kr.`, v)
    }
    const verInVat = r2(rs.filter(r => isInputVat(r.account_nr)).reduce((a, r) => a + ((Number(r.debet) || 0) - (Number(r.kredit) || 0)), 0))
    const invVat = r2(Math.abs(Number(s.vat_amount) || 0))
    if (invVat > 1 && Math.abs(verInVat) < 1) {
      add('fel', 'lev_moms_saknas', 'Leverantörsfaktura med moms utan ingående moms',
        `Faktura ${s.invoice_nr || ''} har moms ${fmt(invVat)} kr men ingen ingående moms (264x) är bokförd.`, v)
    } else if (invVat > 1 && Math.abs(Math.abs(verInVat) - invVat) > 1) {
      add('fel', 'lev_fel_moms', 'Leverantörsfakturans moms stämmer inte',
        `Faktura ${s.invoice_nr || ''}: fakturans moms ${fmt(invVat)} kr men bokförd ingående moms ${fmt(verInVat)} kr.`, v)
    }
  }

  return out
}
