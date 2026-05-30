import { supabase } from './supabase'

// Plockar ut ett "handlarord" ur en banktext, t.ex. "MICROSOFT-G1/26-05-28" -> "MICROSOFT".
export function merchantKey(text) {
  const words = String(text || '').toUpperCase().match(/[A-ZÅÄÖ]{4,}/g) || []
  // hoppa över generiska ord
  const skip = new Set(['BETALNING', 'KORTKÖP', 'KORTKOP', 'AUTOGIRO', 'OVERFORING', 'ÖVERFÖRING', 'SWISH', 'FAKTURA', 'INSÄTTNING', 'UTTAG'])
  return words.find(w => !skip.has(w)) || words[0] || null
}

// Föreslår kostnadskonto (4xxx–7xxx) utifrån hur liknande poster bokförts förut.
// Returnerar { konto, count, key } eller null.
export async function foreslaKontoFromText(companyId, text) {
  const key = merchantKey(text)
  if (!key || key.length < 4) return null
  const { data } = await supabase
    .from('verifikation_rows')
    .select('account_nr, verifikationer!inner(company_id, beskrivning)')
    .eq('verifikationer.company_id', companyId)
    .ilike('verifikationer.beskrivning', `%${key}%`)
    .limit(400)
  const tally = {}
  ;(data || []).forEach(r => { if (/^[4-7]/.test(r.account_nr)) tally[r.account_nr] = (tally[r.account_nr] || 0) + 1 })
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
  return top ? { konto: top[0], count: top[1], key } : null
}
