import { useCallback, useEffect, useRef, useState } from 'react'
import {
  saveDraft, getDraft, deleteDraft, enforceCap, RevisionConflict,
  makeId, payloadHash, identityComplete,
} from '../lib/offline/autosaveStore'

// Lokal autosave-hook (pilot) — Etapp 2A/2B. Sparar text lokalt i IndexedDB, aldrig till servern.
// Återställer ALDRIG automatiskt. Lokal optimistic concurrency: ingen tyst multi-tab-överskrivning.
const CHANNEL = 'bokpilot-autosave'

let TAB_ID = null
function tabId() {
  if (!TAB_ID) TAB_ID = 'tab-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
  return TAB_ID
}

export function useAutosaveDraft({ enabled, identity, value, debounceMs = 800 }) {
  const [status, setStatus] = useState('idle')          // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [restorable, setRestorable] = useState(null)
  const [otherTab, setOtherTab] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const [conflict, setConflict] = useState(null)        // { current } – nyare version finns i annan flik

  const id = identityComplete(identity) ? makeId(identity) : null
  const ready = !!enabled && !!id
  const lastHashRef = useRef(null)
  const expectedRevRef = useRef(0)                       // optimistic concurrency-baslinje
  const timerRef = useRef(null)
  const chRef = useRef(null)
  const conflictRef = useRef(false)

  // Ladda ev. befintligt lokalt utkast vid identitetsbyte (visas, ersätter ALDRIG automatiskt).
  useEffect(() => {
    lastHashRef.current = null; expectedRevRef.current = 0; conflictRef.current = false
    setRestorable(null); setOtherTab(false); setStatus('idle'); setLastSavedAt(null); setStorageError(false); setConflict(null)
    if (!ready) return
    let alive = true
    getDraft(identity).then(e => {
      if (!alive || !e) return
      setRestorable(e); lastHashRef.current = e.payloadHash; expectedRevRef.current = e.localRevision || 0
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id])

  // Multi-flik-signal (snabb varning utöver den hårda revisionskontrollen).
  useEffect(() => {
    if (!ready || typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(CHANNEL); chRef.current = ch
    ch.onmessage = (ev) => { const d = ev.data; if (d && d.id === id && d.tabId !== tabId()) setOtherTab(true) }
    return () => { try { ch.close() } catch { /* ignore */ } chRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id])

  // Debounced lokal sparning vid faktisk ändring. Pausad medan en konflikt väntar på beslut.
  useEffect(() => {
    if (!ready || conflictRef.current) return
    const text = String(value ?? '')
    const h = payloadHash(text)
    if (h === lastHashRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    timerRef.current = setTimeout(async () => {
      try {
        if (text.trim() === '') {
          await deleteDraft(identity)
          lastHashRef.current = h; expectedRevRef.current = 0; setStatus('idle'); setLastSavedAt(null); setStorageError(false)
          return
        }
        const entry = await saveDraft(identity, {
          payload: text, expectedRevision: expectedRevRef.current,
          appBuildId: (typeof window !== 'undefined' && window.__bokpilotBuildId) || null, tabId: tabId(),
        })
        expectedRevRef.current = entry.localRevision
        lastHashRef.current = h; setStatus('saved'); setLastSavedAt(Date.now()); setStorageError(false)
        try { chRef.current?.postMessage({ id, tabId: tabId() }) } catch { /* ignore */ }
        enforceCap().catch(() => {})
      } catch (e) {
        if (e instanceof RevisionConflict || e?.name === 'RevisionConflict') {
          conflictRef.current = true; setConflict({ current: e.current }); setStatus('idle')   // ingen tyst överskrivning
        } else {
          setStatus('error'); setStorageError(true)        // QuotaExceeded m.m. – formuläret fortsätter funka
        }
      }
    }, debounceMs)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, value, id])

  const restore = useCallback(() => {
    const e = restorable
    if (e) { lastHashRef.current = e.payloadHash; expectedRevRef.current = e.localRevision || 0 }
    setRestorable(null)
    return e ? e.payload : null
  }, [restorable])

  const discard = useCallback(async () => { setRestorable(null); await deleteDraft(identity) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dismissBanner = useCallback(() => setRestorable(null), [])

  // Konfliktlösning: läs in den nyare versionen (annan flik). Returnerar payload att applicera i formuläret.
  const resolveLoadNewer = useCallback(() => {
    const cur = conflict?.current
    if (cur) { lastHashRef.current = cur.payloadHash; expectedRevRef.current = cur.localRevision || 0 }
    conflictRef.current = false; setConflict(null); setOtherTab(false)
    return cur ? cur.payload : null
  }, [conflict])

  // Konfliktlösning: behåll MIN text som ett SEPARAT lokalt utkast (egen identity), adoptera sedan nyare i fältet.
  const resolveKeepSeparate = useCallback(async () => {
    const cur = conflict?.current
    const mine = String(value ?? '')
    try {
      const forkIdentity = { ...identity, fieldId: `${identity.fieldId}::fork-${tabId()}-${Date.now()}` }
      await saveDraft(forkIdentity, { payload: mine, expectedRevision: 0, appBuildId: (typeof window !== 'undefined' && window.__bokpilotBuildId) || null, tabId: tabId() })
    } catch { /* fork best-effort */ }
    if (cur) { lastHashRef.current = cur.payloadHash; expectedRevRef.current = cur.localRevision || 0 }
    conflictRef.current = false; setConflict(null); setOtherTab(false)
    return cur ? cur.payload : null
  }, [conflict, identity, value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Efter BEKRÄFTAT lyckat serversparande → ta bort motsvarande lokala utkast.
  const clearLocal = useCallback(async () => {
    lastHashRef.current = payloadHash(''); expectedRevRef.current = 0
    conflictRef.current = false; setConflict(null)
    setStatus('idle'); setLastSavedAt(null)
    await deleteDraft(identity)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ready, status, lastSavedAt, restorable, otherTab, storageError, conflict, restore, discard, dismissBanner, resolveLoadNewer, resolveKeepSeparate, clearLocal }
}
