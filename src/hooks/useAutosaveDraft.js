import { useCallback, useEffect, useRef, useState } from 'react'
import {
  saveDraft, getDraft, deleteDraft, enforceCap,
  makeId, payloadHash, identityComplete,
} from '../lib/offline/autosaveStore'

// Lokal autosave-hook (pilot) — Etapp 2A. Sparar text lokalt i IndexedDB, aldrig till servern.
// Återställer ALDRIG automatiskt; exponerar ett utkast som användaren själv kan återställa.
const CHANNEL = 'bokpilot-autosave'

let TAB_ID = null
function tabId() {
  if (!TAB_ID) TAB_ID = 'tab-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
  return TAB_ID
}

export function useAutosaveDraft({ enabled, identity, value, debounceMs = 800 }) {
  const [status, setStatus] = useState('idle')          // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [restorable, setRestorable] = useState(null)    // lokalt utkast som väntar på användarens beslut
  const [otherTab, setOtherTab] = useState(false)
  const [storageError, setStorageError] = useState(false)

  const id = identityComplete(identity) ? makeId(identity) : null
  const ready = !!enabled && !!id
  const lastHashRef = useRef(null)
  const timerRef = useRef(null)
  const chRef = useRef(null)

  // Ladda ev. befintligt lokalt utkast när identiteten ändras (visas, ersätter ALDRIG automatiskt).
  useEffect(() => {
    lastHashRef.current = null
    setRestorable(null); setOtherTab(false); setStatus('idle'); setLastSavedAt(null)
    if (!ready) return
    let alive = true
    getDraft(identity).then(e => {
      if (!alive) return
      if (e) { setRestorable(e); lastHashRef.current = e.payloadHash }
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id])

  // Multi-flik-detektering: varna om samma utkast redigeras i en annan flik (ingen tyst överskrivning).
  useEffect(() => {
    if (!ready || typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(CHANNEL); chRef.current = ch
    ch.onmessage = (ev) => { const d = ev.data; if (d && d.id === id && d.tabId !== tabId()) setOtherTab(true) }
    return () => { try { ch.close() } catch { /* ignore */ } chRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id])

  // Debounced lokal sparning vid faktisk ändring (hash-dedup). Blockerar aldrig UI.
  useEffect(() => {
    if (!ready) return
    const text = String(value ?? '')
    const h = payloadHash(text)
    if (h === lastHashRef.current) return                 // ingen reell ändring
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    timerRef.current = setTimeout(async () => {
      try {
        if (text.trim() === '') {
          await deleteDraft(identity)                      // tomt → behåll inget lokalt utkast
          lastHashRef.current = h; setStatus('idle'); setLastSavedAt(null); setStorageError(false)
          return
        }
        await saveDraft(identity, { payload: text, appBuildId: (typeof window !== 'undefined' && window.__bokpilotBuildId) || null, tabId: tabId() })
        lastHashRef.current = h; setStatus('saved'); setLastSavedAt(Date.now()); setStorageError(false)
        try { chRef.current?.postMessage({ id, tabId: tabId() }) } catch { /* ignore */ }
        enforceCap().catch(() => {})
      } catch {
        setStatus('error'); setStorageError(true)         // QuotaExceeded m.m. – formuläret fortsätter funka
      }
    }, debounceMs)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, value, id])

  // Returnerar utkastets payload (användaren väljer aktivt att återställa). Tar inte bort utkastet.
  const restore = useCallback(() => {
    const e = restorable
    if (e) lastHashRef.current = e.payloadHash            // undvik direkt omsparning av samma text
    setRestorable(null)
    return e ? e.payload : null
  }, [restorable])

  const discard = useCallback(async () => { setRestorable(null); await deleteDraft(identity) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dismissBanner = useCallback(() => setRestorable(null), [])

  // Anropas EFTER bekräftat lyckat serversparande → ta bort motsvarande lokala utkast.
  const clearLocal = useCallback(async () => {
    lastHashRef.current = payloadHash('')
    setStatus('idle'); setLastSavedAt(null)
    await deleteDraft(identity)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ready, status, lastSavedAt, restorable, otherTab, storageError, restore, discard, dismissBanner, clearLocal }
}
