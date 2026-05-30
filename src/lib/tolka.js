import { supabase } from './supabase'

function isQuota(e) { return /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(e?.message || '') }
function friendly() {
  return new Error('AI-tolkningens kvot är tillfälligt slut (Google Gemini). Vänta en stund och försök igen, eller aktivera fakturering på din Gemini-nyckel för högre gränser.')
}

async function callOnce(id) {
  const { data, error } = await supabase.functions.invoke('tolka-underlag', { body: { document_id: id } })
  if (error) {
    let m = error.message
    try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ }
    throw new Error(m)
  }
  if (data?.error) throw new Error(data.error)
  return data.result
}

// Tolkar ett dokument. Gör ETT omförsök vid kallstart, men ALDRIG vid kvot/429
// (då hjälper inte ett omförsök, det bränner bara mer kvot).
export async function tolkaDocument(id) {
  try { return await callOnce(id) }
  catch (e) {
    if (isQuota(e)) throw friendly()
    try { return await callOnce(id) }
    catch (e2) { throw isQuota(e2) ? friendly() : e2 }
  }
}
