// Multiflik-ledare för synkkön — Etapp 3C. ENDAST klientoptimering: serverns idempotency + CAS är auktoritativa,
// så även om två flikar mot förmodan bearbetar samtidigt kan ingen dubbelmutation eller tyst överskrivning ske.
// Primär: Web Locks API (robust, auto-släpp vid kraschad flik). Fallback: BroadcastChannel-lease med heartbeat.

export function makeTabId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'tab-' + crypto.randomUUID() } catch { /* ignore */ }
  return 'tab-' + Date.now().toString(36) + '-' + Math.abs((Math.random() * 1e9) | 0).toString(36)
}

// Låsnamn omfattar app + userId + companyId + syncQueue (per-användar/per-bolag-isolering).
export function leaderLockName({ userId, companyId }) {
  return `bokpilot:sync:${userId || 'anon'}:${companyId || 'none'}:syncQueue`
}

const webLocksAvailable = () => { try { return typeof navigator !== 'undefined' && !!navigator.locks?.request } catch { return false } }

/**
 * Skapar en ledare. onBecomeLeader/onLoseLeader anropas vid övergångar.
 * Returnerar { start, stop, isLeader, mode }.
 */
export function createLeader({ userId, companyId, tabId = makeTabId(), onBecomeLeader, onLoseLeader, leaseTtl = 8000, heartbeatMs = 3000, electionDelayMs = 400 }) {
  const name = leaderLockName({ userId, companyId })
  let leader = false
  let abort = null
  let stopped = false
  let ch = null
  let hbTimer = null
  let electionTimer = null
  let lease = { owner: null, expiresAt: 0 }

  function setLeader(v) {
    if (v === leader) return
    leader = v
    try { (v ? onBecomeLeader : onLoseLeader)?.() } catch { /* ignore */ }
  }

  // ── Web Locks-väg ──
  function startWebLocks() {
    abort = new AbortController()
    // request blockerar tills låset beviljas; vi håller det tills released-promisen resolvar (stop) eller fliken kraschar.
    navigator.locks.request(name, { mode: 'exclusive', signal: abort.signal }, () => new Promise((release) => {
      if (stopped) { setLeader(false); return release() }
      setLeader(true)
      // Spara release så stop() kan släppa låset.
      startWebLocks._release = () => { setLeader(false); release() }
    })).catch(() => { /* AbortError vid stop, eller annan flik håller låset – ignore */ })
  }

  // ── BroadcastChannel-fallback (lease + heartbeat) ──
  function now() { return Date.now() }
  function leaseValid() { return lease.owner && lease.expiresAt > now() }
  function broadcast(type) { try { ch?.postMessage({ type, owner: tabId, expiresAt: lease.expiresAt }) } catch { /* ignore */ } }

  function startBroadcast() {
    try { ch = new BroadcastChannel('bokpilot-sync-leader:' + name) } catch { ch = null }
    if (!ch) { setLeader(true); return }     // ingen koordinering möjlig → bli ledare (single-tab-antagande)
    ch.onmessage = (ev) => {
      const m = ev.data
      if (!m || m.owner === tabId) return
      if (m.type === 'claim' || m.type === 'heartbeat') {
        // Annan flik gör anspråk. Deterministisk tiebreak: lägst tabId vinner.
        if (m.expiresAt > now() && (!leaseValid() || m.owner < tabId)) {
          lease = { owner: m.owner, expiresAt: m.expiresAt }
          if (leader && m.owner < tabId) setLeader(false)
        }
      } else if (m.type === 'release' && m.owner === lease.owner) {
        lease = { owner: null, expiresAt: 0 }
      }
    }
    // ELECTION-SETTLE: annonsera tentativ närvaro men bli INTE ledare under konvergensfönstret.
    // Hindrar att två nystartade flikar båda blir ledare och skickar RPC samtidigt. Lägst tabId vinner i handlern.
    lease = { owner: tabId, expiresAt: now() + leaseTtl }
    broadcast('claim')
    const reAnnounce = setTimeout(() => { try { broadcast('claim') } catch { /* ignore */ } }, Math.max(50, Math.floor(electionDelayMs / 2)))
    electionTimer = setTimeout(() => {
      electionTimer = null
      try { clearTimeout(reAnnounce) } catch { /* ignore */ }
      if (stopped) return
      tick()                                  // beslut efter settle: lägst tabId hävdar ledarskap, övriga avstår
      hbTimer = setInterval(tick, heartbeatMs)
    }, electionDelayMs)
  }
  function tick() {
    if (stopped) return
    if (leader) { lease = { owner: tabId, expiresAt: now() + leaseTtl }; broadcast('heartbeat'); return }
    if (!leaseValid() || lease.owner === tabId) {
      lease = { owner: tabId, expiresAt: now() + leaseTtl }
      setLeader(true); broadcast('claim')
    }
  }

  function start() {
    stopped = false
    if (webLocksAvailable()) startWebLocks()
    else startBroadcast()
  }
  function stop() {
    stopped = true
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null }
    if (electionTimer) { clearTimeout(electionTimer); electionTimer = null }
    if (leader && ch) broadcast('release')
    setLeader(false)
    try { startWebLocks._release?.() } catch { /* ignore */ }
    try { abort?.abort() } catch { /* ignore */ }
    try { ch?.close() } catch { /* ignore */ }
    ch = null
  }

  // Bekräftar STABILT ledarskap direkt före varje RPC (försvar mot split-brain).
  // Web Locks: själva låset är auktoritativt. Broadcast-lease: kräver giltig lease ägd av DENNA tabId.
  function confirmLeadership() {
    if (webLocksAvailable()) return leader
    return leader && leaseValid() && lease.owner === tabId && !stopped
  }

  return { start, stop, isLeader: () => leader, confirmLeadership, mode: webLocksAvailable() ? 'web-locks' : 'broadcast-lease', tabId }
}
