import { supabase } from './supabase'
import { ACCOUNTING_AUDIT_ACTIONS, redactInterpretation } from './auditAccounting'
import { quotaMessage } from './aiQuota'

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

// Tydligt, åtgärdbart fel när sessionen saknas/gått ut.
function sessionExpired() {
  const e = new Error('Sessionen har gått ut. Logga in igen.')
  e.code = 'session_expired'
  return e
}
function tagged(message, code, extra = {}) {
  const e = new Error(message)
  e.code = code
  Object.assign(e, extra)
  return e
}

// Hämtar en giltig access token för den inloggade användaren. getSession() förnyar
// automatiskt en utgången token. Att skicka token EXPLICIT till functions.invoke garanterar
// att användarens JWT används – inte anon-nyckeln.
async function requireAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw sessionExpired()
  return session.access_token
}

// Tolkar ett dokument. GÖR INGET klient-omförsök – servern (tolka-underlag) sköter
// modell-fallback och quota-/cooldown-hantering. Ett klient-omförsök vid 429 skulle bara
// bränna mer kvot och skapa en retry-storm.
//
// Kastar taggade fel som UI kan agera på:
//   code 'quota_cooldown' (+ retryAfter sekunder) – visa countdown, inaktivera knappen
//   code 'in_progress'    – ett jobb körs redan för dokumentet (dubbelklick) – inte ett fel
//   code 'ai_failed'      – tjänsten kunde inte tolka just nu (antyder ALDRIG fel underlag)
//   code 'session_expired' / 'service_locked'
export async function tolkaDocument(id) {
  const token = await requireAccessToken()
  const { data, error } = await supabase.functions.invoke('tolka-underlag', {
    body: { document_id: id },
    headers: { Authorization: `Bearer ${token}` },
  })

  // Non-2xx (t.ex. 400/401/403). Läs ev. strukturerad felkropp.
  if (error) {
    let m = error.message, code
    try { const b = await error.context.json(); if (b?.error) m = b.error; if (b?.code) code = b.code } catch { /* ignore */ }
    if (/ej inloggad|not authenticated|jwt/i.test(m)) throw sessionExpired()
    throw tagged(m, code)
  }

  // 200-svar: success | quota_cooldown | in_progress | ai_failed | service_locked.
  if (data?.ok && data.result) {
    await logDocumentInterpreted(id, data.result)   // behandlingshistorik (best-effort)
    return data.result
  }
  const code = data?.code
  if (code === 'quota_cooldown' || code === 'rate_limited' || code === 'cooldown') {
    const sec = Number(data.retry_after_seconds) || 60
    throw tagged(data.error || quotaMessage(sec), 'quota_cooldown', { retryAfter: sec, scope: data.scope || null })
  }
  if (code === 'in_progress') {
    throw tagged(data.message || 'AI-tolkning pågår redan för detta underlag.', 'in_progress')
  }
  if (code === 'service_locked') {
    throw tagged(data.error || 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.', 'service_locked')
  }
  if (code === 'ai_failed') {
    throw tagged(data.error || 'AI-tjänsten kunde inte tolka underlaget just nu. Försök igen om en stund.', 'ai_failed')
  }
  if (data?.error) throw tagged(data.error, code)
  throw new Error('AI-tjänsten kunde inte tolka underlaget just nu. Försök igen om en stund.')
}
