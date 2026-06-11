// Ren logik för Kontoanalys fakturalänkning – inga beroenden på React/Supabase (enhetstestbar).
//
// Säkerhet: länken byggs ALLTID på en explicit relation verifikation → faktura
// (supplier_invoices.verifikation_id / invoices.verifikation_id), aldrig på ett globalt
// fakturanummer. Anroparen hämtar fakturorna scopat på company_id (+ RLS), så kartan kan
// bara innehålla det egna företagets fakturor. En verifikation som råkar peka mot flera
// fakturor markeras ambiguös och får INGEN länk.

// Bygger { [verifikation_id]: { kind:'lev'|'kund', id, invoice_nr } }.
export function buildInvoiceLinkMap(supplierInvoices = [], customerInvoices = []) {
  const seen = new Map()   // vid -> { kind, id, invoice_nr, ambiguous }
  const add = (list, kind) => {
    for (const inv of list || []) {
      const vid = inv?.verifikation_id
      if (!vid) continue
      if (seen.has(vid)) { seen.get(vid).ambiguous = true; continue }
      seen.set(vid, { kind, id: inv.id, invoice_nr: String(inv.invoice_nr || '').trim(), ambiguous: false })
    }
  }
  add(supplierInvoices, 'lev')
  add(customerInvoices, 'kund')
  const out = {}
  for (const [vid, e] of seen) {
    if (e.ambiguous) continue          // flera matchningar → ingen länk
    if (!e.invoice_nr) continue        // utan nummer går inget att göra klickbart i texten
    out[vid] = { kind: e.kind, id: e.id, invoice_nr: e.invoice_nr }
  }
  return out
}

// Befintlig route per fakturatyp (återanvänder appens routes).
export function invoiceRoute(link) {
  if (!link?.id) return null
  return link.kind === 'kund' ? `/fakturor/${link.id}` : `/leverantorsfakturor/${link.id}`
}

// Bygger karta verifikation_id → [relaterade verifikation_id] via fakturans bokförings-
// och betalningsverifikation (supplier_invoices.verifikation_id ↔ betalning_ver_id).
// Bidirektionellt: bokföringsver pekar på betalningsver och vice versa.
export function buildRelatedVerMap(supplierInvoices = []) {
  const map = {}
  const link = (a, b) => { if (!a || !b || a === b) return; (map[a] ||= []); if (!map[a].includes(b)) map[a].push(b) }
  for (const si of supplierInvoices || []) { link(si?.verifikation_id, si?.betalning_ver_id); link(si?.betalning_ver_id, si?.verifikation_id) }
  return map
}

// Hittar fakturanumret som en HEL token i beskrivningen och delar upp texten runt det.
// Returnerar { before, match, after } eller null om numret inte finns som egen token
// (så "3419" inte matchar inuti "34190"). \w-gränser: numret får inte gränsa till bokstav/siffra.
export function splitDescriptionByInvoiceNr(besk, invoiceNr) {
  const text = String(besk ?? '')
  const nr = String(invoiceNr ?? '').trim()
  if (!nr) return null
  const esc = nr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = text.match(new RegExp(`(^|[^\\w])(${esc})(?![\\w])`))
  if (!m) return null
  const idx = m.index + m[1].length
  return { before: text.slice(0, idx), match: nr, after: text.slice(idx + nr.length) }
}
