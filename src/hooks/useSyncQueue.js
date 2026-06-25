// useSyncQueue — Etapp 3C (intern prototyp). Orkestrerar synkkön för bokslut-check-kommentaren.
// AVSTÄNGD om inte enabled (serverflaggan). Inert no-op när av → tidigare beteende oförändrat.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  enqueue, listForUser, countByStatus, manualRetry, deleteOperation, purgeExpired,
  QUEUE_STATUS, OP_UPSERT, OP_CLEAR, OP_OVERWRITE, exceedsMax,
} from '../lib/offline/syncQueue'
import { drainQueue } from '../lib/offline/syncWorker'
import { createLeader } from '../lib/offline/syncLeader'
import { subscribeNetwork } from '../lib/offline/networkHealth'

const EMPTY_COUNTS = { pending: 0, processing: 0, succeeded: 0, conflict: 0, rejected: 0, retry_wait: 0, paused: 0 }

export function useSyncQueue({ enabled, supabase, userId, companyId }) {
  const [counts, setCounts] = useState(EMPTY_COUNTS)
  const [operations, setOperations] = useState([])
  const [isLeader, setIsLeader] = useState(false)
  const [reauthNeeded, setReauthNeeded] = useState(false)
  const leaderRef = useRef(null)
  const reachableRef = useRef(true)
  const sessionValidRef = useRef(true)
  const drainingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!enabled || !userId) { setCounts(EMPTY_COUNTS); setOperations([]); return }
    try {
      const ops = await listForUser(userId)
      setOperations(ops.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)))
      setCounts(await countByStatus(userId))
    } catch { /* ignore */ }
  }, [enabled, userId])

  const drain = useCallback(async () => {
    if (!enabled || !userId || !supabase) return
    if (drainingRef.current) return
    // Bearbeta endast som ledare, med giltig session och nåbar server.
    if (!leaderRef.current?.isLeader() || !sessionValidRef.current || !reachableRef.current) { await refresh(); return }
    drainingRef.current = true
    try {
      const processed = await drainQueue(supabase, userId, {
        shouldContinue: () => !!leaderRef.current?.isLeader() && sessionValidRef.current && reachableRef.current,
      })
      if (processed.some(p => p.mapped?.requireReauth)) setReauthNeeded(true)
    } finally {
      drainingRef.current = false
      await refresh()
    }
  }, [enabled, userId, supabase, refresh])

  // Köläggning av en serveroperation (FÖRE nätverksanrop sparas den lokalt; sedan körs kön om möjligt).
  const enqueueComment = useCallback(async (identity, { operationType = OP_UPSERT, comment = null, baseRevision } = {}) => {
    if (!enabled) return { ok: false, reason: 'disabled' }
    if (operationType !== OP_CLEAR && exceedsMax(comment)) return { ok: false, reason: 'too_large' }
    if (baseRevision == null) return { ok: false, reason: 'base_revision_missing' }
    try {
      const op = await enqueue(identity, { operationType, comment, baseRevision, appBuildId: (typeof window !== 'undefined' && window.__bokpilotBuildId) || null })
      await refresh()
      drain()                                            // bästa-fall: kör direkt om online + ledare
      return { ok: true, operationId: op.operationId }
    } catch (e) { return { ok: false, reason: e?.message || 'enqueue_failed' } }
  }, [enabled, refresh, drain])

  const retry = useCallback(async (operationId) => { await manualRetry(operationId); await refresh(); drain() }, [refresh, drain])
  const discardOperation = useCallback(async (operationId) => { await deleteOperation(operationId); await refresh() }, [refresh])

  // Ledare + triggers. Per-användar/per-bolag-isolering. Stoppas/återskapas vid byte av user/company.
  useEffect(() => {
    if (!enabled || !userId) { setIsLeader(false); return }
    const leader = createLeader({
      userId, companyId,
      onBecomeLeader: () => { setIsLeader(true); drain() },
      onLoseLeader: () => setIsLeader(false),
    })
    leaderRef.current = leader
    leader.start()
    purgeExpired().catch(() => {})
    refresh()

    const onTrigger = () => drain()
    const unsubNet = subscribeNetwork((s) => {
      reachableRef.current = s.reachable !== false && s.status !== 'offline' && s.status !== 'server_unreachable'
      sessionValidRef.current = s.sessionValid !== false
      setReauthNeeded(rn => (s.sessionValid === false ? true : rn))
      if (reachableRef.current && sessionValidRef.current) drain()
    })
    window.addEventListener('online', onTrigger)
    window.addEventListener('focus', onTrigger)
    document.addEventListener('visibilitychange', onTrigger)

    return () => {
      try { leader.stop() } catch { /* ignore */ }
      leaderRef.current = null
      unsubNet()
      window.removeEventListener('online', onTrigger)
      window.removeEventListener('focus', onTrigger)
      document.removeEventListener('visibilitychange', onTrigger)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, companyId])

  // Lättviktig polling medan det finns aktiva operationer (IndexedDB saknar ändringshändelser mellan flikar).
  useEffect(() => {
    if (!enabled || !userId) return
    const active = counts.pending + counts.processing + counts.retry_wait
    if (active <= 0) return
    const t = setInterval(() => drain(), 5000)
    return () => clearInterval(t)
  }, [enabled, userId, counts.pending, counts.processing, counts.retry_wait, drain])

  return {
    counts, operations, isLeader, reauthNeeded,
    leaderMode: leaderRef.current?.mode || null,
    enqueueComment, retry, discardOperation, refresh, drain,
    OP_UPSERT, OP_CLEAR, OP_OVERWRITE, QUEUE_STATUS,
  }
}
