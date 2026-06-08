import { supabase } from './supabase'

function isQuota(e) { return /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(e?.message || '') }
function friendly() {
  return new Error('AI-tolkningens kvot är tillfälligt slut (Google Gemini). Vänta en stund och försök igen, eller aktivera fakturering på din Gemini-nyckel för högre gränser.')
}
// Tydligt, åtgärdbart fel när sessionen saknas/gått ut (krav 8).
function sessionExpired() {
  const e = new Error('Sessionen har gått ut. Logga in igen.')
  e.code = 'session_expired'
  return e
}

// Hämtar en giltig access token för den inloggade användaren. getSession() förnyar
// automatiskt en utgången token. Saknas sessionen helt -> tydligt fel (ej "Ej inloggad").
// Att skicka token EXPLICIT till functions.invoke garanterar att användarens JWT
// används – inte anon-nyckeln (som annars kan skickas om functions-klientens auth-state
// inte hunnit synkas, vilket gav "Ej inloggad" i edge-funktionen).
async function requireAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw sessionExpired()
  return session.access_token
}

async function callOnce(id, accessToken) {
  const { data, error } = await supabase.functions.invoke('tolka-underlag', {
    body: { document_id: id },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (error) {
    let m = error.message
    try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ }
    // Om edge-funktionen ändå nekar p.g.a. auth -> visa åtgärdbart sessionsfel.
    if (/ej inloggad|not authenticated|jwt/i.test(m)) throw sessionExpired()
    throw new Error(m)
  }
  if (data?.error) throw new Error(data.error)
  return data.result
}

// Tolkar ett dokument. Skickar alltid den inloggade användarens access token.
// Gör ETT omförsök vid kallstart, men ALDRIG vid kvot/429 (då hjälper inte ett
// omförsök, det bränner bara mer kvot) eller vid utgången session.
export async function tolkaDocument(id) {
  const token = await requireAccessToken()
  try { return await callOnce(id, token) }
  catch (e) {
    if (isQuota(e)) throw friendly()
    if (e?.code === 'session_expired') throw e
    try { return await callOnce(id, token) }
    catch (e2) {
      if (isQuota(e2)) throw friendly()
      throw e2
    }
  }
}
