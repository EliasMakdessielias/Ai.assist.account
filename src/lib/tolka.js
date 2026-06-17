import { supabase } from './supabase'
import { ACCOUNTING_AUDIT_ACTIONS, redactInterpretation } from './auditAccounting'

// Behandlingshistorik (BFL): logga att ett underlag tolkats. Best-effort – audit får ALDRIG
// stoppa tolkningen. Endast redigerade (vitlistade) fält loggas, aldrig råtext/mailbody.
async function logDocumentInterpreted(documentId, result) {
  try {
    await supabase.rpc('log_accounting_audit', {
      p_action: ACCOUNTING_AUDIT_ACTIONS.documentInterpreted, p_entity: 'document', p_entity_ref: documentId,
      p_source: 'ocr', p_metadata: redactInterpretation(result),
    })
  } catch { /* audit får aldrig stoppa tolkningen */ }
}

function isQuota(e) { return /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(e?.message || '') }
// Service-lås (företaget pausat/blockerat) – kontrollerad affärsavvisning, gör INGET omförsök.
function isServiceLocked(e) { return e?.code === 'service_locked' || /Tjänsten är pausad/.test(e?.message || '') }
function friendly() {
  return new Error('AI-tolkningens kvot är tillfälligt slut (per-minut-gräns hos Google Gemini). Vänta en stund och försök igen – appen provar flera modeller automatiskt.')
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
    let m = error.message, code
    try { const b = await error.context.json(); if (b?.error) m = b.error; if (b?.code) code = b.code } catch { /* ignore */ }
    // Om edge-funktionen ändå nekar p.g.a. auth -> visa åtgärdbart sessionsfel.
    if (/ej inloggad|not authenticated|jwt/i.test(m)) throw sessionExpired()
    const e = new Error(m); if (code) e.code = code; throw e
  }
  if (data?.error) { const e = new Error(data.error); if (data.code === 'service_locked') e.code = 'service_locked'; throw e }
  return data.result
}

// Tolkar ett dokument. Skickar alltid den inloggade användarens access token.
// Gör ETT omförsök vid kallstart, men ALDRIG vid kvot/429 (då hjälper inte ett
// omförsök, det bränner bara mer kvot) eller vid utgången session.
export async function tolkaDocument(id) {
  const token = await requireAccessToken()
  let result
  try { result = await callOnce(id, token) }
  catch (e) {
    if (isQuota(e)) throw friendly()
    if (e?.code === 'session_expired') throw e
    if (isServiceLocked(e)) throw e   // affärsavvisning – inget omförsök
    try { result = await callOnce(id, token) }
    catch (e2) {
      if (isQuota(e2)) throw friendly()
      throw e2
    }
  }
  await logDocumentInterpreted(id, result)   // behandlingshistorik (best-effort)
  return result
}
