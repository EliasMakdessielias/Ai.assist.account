// Automatisk bokföring av fakturor (metod-medveten).
import { supabase } from './supabase'

const NAMES = {
  '1510': 'Kundfordringar', '1930': 'Företagskonto', '2440': 'Leverantörsskulder',
  '2611': 'Utgående moms 25 %', '2621': 'Utgående moms 12 %', '2631': 'Utgående moms 6 %',
  '3001': 'Försäljning', '2640': 'Ingående moms',
}
const VATACC = { 25: '2611', 12: '2621', 6: '2631' }

// Bokför en kundfaktura enligt faktureringsmetoden: D 1510 / K försäljningskonto (netto)
// + K utgående moms. Intäktskontot är kundens försäljningskonto (kundkortet) om det finns
// i kontoplanen, annars 3001. Gör inget i kontantmetoden (bokförs vid betalning), eller om
// fakturan redan är bokförd.
export async function bokforKundfaktura({ companyId, metod, userId, invoiceId, serie }) {
  const ser = (serie && String(serie).trim()) || 'A - Redovisning'
  if (metod !== 'faktura') return null
  const { data: inv } = await supabase.from('invoices').select('*, customers(name, forsaljningskonto)').eq('id', invoiceId).single()
  if (!inv || inv.verifikation_id) return null
  const { data: rows } = await supabase.from('invoice_rows').select('*').eq('invoice_id', invoiceId)

  const vatByRate = {}
  ;(rows || []).forEach(r => {
    const base = (r.quantity || 0) * (r.unit_price || 0)
    const v = base * ((r.vat_rate || 0) / 100)
    vatByRate[r.vat_rate] = (vatByRate[r.vat_rate] || 0) + v
  })

  let salesAcc = '3001', salesName = NAMES['3001']
  const kundKonto = inv.customers?.forsaljningskonto
  if (kundKonto && /^\d{4}$/.test(String(kundKonto))) {
    const { data: acc } = await supabase.from('accounts').select('name').eq('company_id', companyId).eq('account_nr', String(kundKonto)).maybeSingle()
    if (acc) { salesAcc = String(kundKonto); salesName = acc.name || '' }   // saknas kontot i kontoplanen -> 3001
  }

  const lines = [{ nr: '1510', d: inv.total_amount, k: 0 }, { nr: salesAcc, name: salesName, d: 0, k: inv.amount_excl_vat }]
  Object.entries(vatByRate).forEach(([rate, v]) => {
    const acc = VATACC[Number(rate)]
    if (v > 0.0001 && acc) lines.push({ nr: acc, d: 0, k: v })
  })

  const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: companyId, p_serie: ser })
  const total = inv.total_amount
  const { data: ver, error } = await supabase.from('verifikationer').insert({
    company_id: companyId, ver_nr: nr || ser.charAt(0) + Date.now(), ver_serie: ser,
    datum: inv.invoice_date, beskrivning: `Kundfaktura ${inv.invoice_nr} ${inv.customers?.name || ''}`.trim(),
    total_debet: total, total_kredit: total, created_by: userId,
  }).select().single()
  if (error) throw error

  await supabase.from('verifikation_rows').insert(lines.map((l, i) => ({
    verifikation_id: ver.id, account_nr: l.nr, account_name: l.name || NAMES[l.nr] || '', debet: l.d, kredit: l.k, sort_order: i,
  })))
  await supabase.from('invoices').update({ verifikation_id: ver.id }).eq('id', invoiceId)
  return ver
}

export { NAMES, VATACC }
