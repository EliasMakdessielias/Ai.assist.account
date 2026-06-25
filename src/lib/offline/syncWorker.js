// Synkkö-worker — Etapp 3C. Bearbetar EN operation åt gången per entitet, ledar-gated.
// Anropar server-RPC bokslut_sync_comment med SAMMA idempotencyKey vid retry. Serverns gridar (auth/medlemskap/
// feature/status) + idempotency + CAS är auktoritativa; klienten skapar aldrig en bokföringsåtgärd.
import {
  claimNext, applyResult, recoverStuck, mapServerResult, classifyTransport,
  QUEUE_STATUS, OP_CLEAR,
} from './syncQueue'

export const RPC_TIMEOUT_MS = 15000

// Ett RPC-anrop. Returnerar { data } (domänresultat) eller { transportErrorCode } (klassificerat fel). Kastar aldrig.
export async function callSyncRpc(supabase, op, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const builder = supabase.rpc('bokslut_sync_comment', {
      p_idempotency_key: op.idempotencyKey,
      p_check: op.entityId,
      p_operation_type: op.operationType,
      p_comment: op.operationType === OP_CLEAR ? null : op.payload,
      p_base_revision: op.baseRevision,
      p_client_created_at: new Date(op.createdAt || Date.now()).toISOString(),
    })
    const res = (builder && typeof builder.abortSignal === 'function') ? await builder.abortSignal(ctrl.signal) : await builder
    if (!res || typeof res !== 'object') return { transportErrorCode: 'unavailable' }
    if (res.error) return { transportErrorCode: classifyTransport(res.error) }
    return { data: res.data }
  } catch (e) {
    if ((e && e.name === 'AbortError') || ctrl.signal.aborted) return { transportErrorCode: 'timeout' }
    return { transportErrorCode: classifyTransport(e) }
  } finally {
    clearTimeout(timer)
  }
}

// Bearbeta exakt en redan claimad (processing) operation. Returnerar { mapped, op }.
export async function processClaimed(supabase, op, { timeoutMs } = {}) {
  const { data, transportErrorCode } = await callSyncRpc(supabase, op, { timeoutMs })
  const mapped = mapServerResult({ data: data || null, transportErrorCode: transportErrorCode || null })
  await applyResult(op.operationId, mapped, { serverResult: data || null })
  return { mapped, op }
}

// Töm kön så länge fliken är ledare och det finns redo operationer. Bearbetar en i taget (per användare/entitet).
// shouldContinue() → false avbryter (t.ex. ledarskap förlorat / session ogiltig / offline). Returnerar bearbetade resultat.
export async function drainQueue(supabase, userId, { shouldContinue = () => true, now = Date.now(), timeoutMs, maxOps = 100 } = {}) {
  const processed = []
  if (!userId) return processed
  await recoverStuck(userId, now)
  for (let i = 0; i < maxOps; i++) {
    if (!shouldContinue()) break
    const op = await claimNext(userId, Date.now())
    if (!op) break
    if (!shouldContinue()) {                                  // tappade ledarskap efter claim → lämna åt nästa ledare via lease-recovery
      await applyResult(op.operationId, { status: QUEUE_STATUS.RETRY_WAIT, errorCode: 'unavailable', autoRetry: true })
      break
    }
    const r = await processClaimed(supabase, op, { timeoutMs })
    processed.push(r)
  }
  return processed
}
