// Centralt nätverkshälsolager — Etapp 1A/1B.
// navigator.onLine används ENDAST som signal. Auktoritativt är ett verifierat, tidsbegränsat anrop till
// Supabase publika /auth/v1/health. OBS: detta verifierar att BokPilots servrar (Supabase-origin) är
// NÅBARA — det är en reachability-proxy, INTE en full hälsokontroll av varje deltjänst (REST/Storage/Edge).
// UI-texterna är formulerade därefter och överdriver inte vad som verifierats.
// 401/403 (auth) och 5xx (serverfel) klassas ALDRIG som offline (servern nåddes ju).
//
// Statusar: 'online' | 'unstable' | 'offline' | 'server_unreachable' | 'server_error' | 'session'
// Sessionssignalen ('session') sätts separat av appen via setSessionValid() (lättviktig heuristik,
// ingen extra autentiserad poll i denna etapp).

import { supabase } from '../supabase'

const HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const TIMEOUT_MS = 6000
const BASE_INTERVAL = 30000          // normal pollfrekvens när allt är bra
const MIN_BACKOFF = 5000
const MAX_BACKOFF = 60000
const HISTORY = 4                     // antal senaste resultat för "instabil"-bedömning

let state = {
  status: 'online',
  reachable: true,
  serverError: false,
  sessionValid: true,
  lastSuccessAt: null,
  checking: false,
}
let history = []                      // true = nådde servern, false = misslyckades
let timer = null
let failStreak = 0
let started = false
const subs = new Set()

function jitter(ms) { return ms + Math.floor((self.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? 0) % 1000) }

// Ren klassificerare (testbar). 401/403 = nådd server (reachable=true, serverError=false) → ALDRIG offline.
// 5xx = reachable=true, serverError=true → 'server_error', ej offline. Timeout/nätfel = reachable=false.
export function classifyNetwork({ reachable, serverError, sessionValid, online, recent = [] }) {
  if (sessionValid === false && reachable) return 'session'
  if (!reachable) return online === false ? 'offline' : 'server_unreachable'
  if (serverError) return 'server_error'
  if (recent.length >= 2 && recent.slice(-HISTORY).includes(false)) return 'unstable'
  return 'online'
}

function classify() {
  return classifyNetwork({
    reachable: state.reachable,
    serverError: state.serverError,
    sessionValid: state.sessionValid,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    recent: history,
  })
}

function publish() {
  const status = classify()
  state = { ...state, status }
  for (const cb of subs) { try { cb(state) } catch { /* ignore */ } }
}

function record(reachable) {
  history.push(reachable)
  if (history.length > HISTORY) history.shift()
}

async function ping() {
  if (state.checking) return
  state.checking = true; publish()
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(HEALTH_URL, {
      method: 'GET', cache: 'no-store', signal: ctrl.signal,
      headers: ANON ? { apikey: ANON } : undefined,
    })
    clearTimeout(to)
    // Servern svarade = nåbar (oavsett statuskod). Klassa fel separat.
    state.reachable = true
    state.serverError = res.status >= 500            // 5xx = serverfel, INTE offline
    // 401/403 från publik health betyder fortfarande att servern nåddes → ingen offline-klassning.
    state.lastSuccessAt = Date.now()
    record(true)
    failStreak = 0
  } catch {
    clearTimeout(to)
    state.reachable = false
    state.serverError = false
    record(false)
    failStreak += 1
  } finally {
    state.checking = false
    publish()
    schedule()
  }
}

function schedule() {
  if (timer) clearTimeout(timer)
  if (typeof document !== 'undefined' && document.hidden) return   // pausa när fliken är dold
  let delay = BASE_INTERVAL
  if (failStreak > 0) delay = Math.min(MAX_BACKOFF, MIN_BACKOFF * Math.pow(2, failStreak - 1))
  timer = setTimeout(ping, jitter(delay))
}

/** Appen anropar denna när sessionsläget ändras (giltig/utgången). Lättviktig, ingen extra poll. */
export function setSessionValid(valid) {
  if (state.sessionValid === valid) return
  state.sessionValid = valid
  publish()
}

export function retryNow() { failStreak = 0; ping() }
export function getNetworkState() { return state }

export function subscribeNetwork(cb) {
  subs.add(cb)
  cb(state)
  return () => subs.delete(cb)
}

export function startNetworkHealth() {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('online', () => { retryNow() })
  window.addEventListener('offline', () => { state.reachable = false; record(false); publish(); schedule() })
  window.addEventListener('focus', () => { if (!state.checking) ping() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); else schedule() })

  // Spegla Supabase-sessionens giltighet → 'session'-status (ingen separat nätverkspoll).
  try {
    supabase.auth.getSession().then(({ data }) => { setSessionValid(!!data?.session) })
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setSessionValid(false)
      else setSessionValid(!!session)
    })
  } catch { /* ignore */ }

  ping()
}
