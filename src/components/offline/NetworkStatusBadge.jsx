import { useEffect, useState } from 'react'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { onPwaUpdate, applyUpdate } from '../../lib/pwa'

// Diskret nätverks-/versionsindikator (Etapp 1A). Bottom-left, stör inte arbetsytan.
// Använder CSS-prick + svensk text (ingen ikonfont) så den fungerar även offline.
// Endast statusar vars funktioner finns nu: Online / Instabil / Offline / Servern kan inte nås /
// Sessionen behöver förnyas / Ny version tillgänglig. (Inga "Synkroniserar/Konflikt/Väntar".)

const META = {
  online: { label: 'Online', dot: '#16a34a', tone: 'muted' },
  unstable: { label: 'Instabil anslutning', dot: '#f59e0b', tone: 'show' },
  offline: { label: 'Offline', dot: '#9ca3af', tone: 'show', retry: true },
  server_unreachable: { label: 'Servern kan inte nås', dot: '#dc2626', tone: 'show', retry: true },
  server_error: { label: 'Servern svarar med fel', dot: '#dc2626', tone: 'show', retry: true },
  session: { label: 'Sessionen behöver förnyas', dot: '#f59e0b', tone: 'show' },
}

function fmtTime(ts) { try { return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function NetworkStatusBadge() {
  const { status, lastSuccessAt, checking, retry } = useNetworkStatus()
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => onPwaUpdate(setUpdateReady), [])

  const meta = META[status] || META.online
  const wrap = { position: 'fixed', left: 12, bottom: 12, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', pointerEvents: 'none' }
  const pill = { pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: '0.5px solid rgba(0,0,0,0.12)', borderRadius: 999, padding: '5px 11px', fontSize: 12, color: '#1a1a18', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
  const dot = (c) => ({ width: 8, height: 8, borderRadius: '50%', background: c, flex: '0 0 auto', boxShadow: checking ? `0 0 0 3px ${c}22` : 'none' })
  const btn = { pointerEvents: 'auto', font: 'inherit', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: '#2563eb', padding: 0, textDecoration: 'underline' }

  return (
    <div style={wrap} aria-live="polite">
      {/* Ny version tillgänglig (kontrollerad uppdatering) */}
      {updateReady && (
        <div style={{ ...pill, borderColor: 'rgba(37,99,235,0.4)' }}>
          <span style={dot('#2563eb')} />
          <span>Ny version av BokPilot finns tillgänglig.</span>
          <button style={{ ...btn, fontWeight: 600 }} onClick={applyUpdate}>Uppdatera</button>
        </div>
      )}

      {/* Nätverksstatus: diskret prick när allt är bra, full pill annars. */}
      {meta.tone === 'show' ? (
        <div style={pill} title={lastSuccessAt ? `Senaste serverkontakt ${fmtTime(lastSuccessAt)}` : 'Ingen verifierad serverkontakt ännu'}>
          <span style={dot(meta.dot)} />
          <span>{meta.label}</span>
          {meta.retry && <button style={btn} onClick={retry}>Försök igen</button>}
        </div>
      ) : (
        <div
          style={{ ...pill, padding: 6, background: 'transparent', border: 'none', boxShadow: 'none' }}
          title={`${meta.label}${lastSuccessAt ? ` · senaste serverkontakt ${fmtTime(lastSuccessAt)}` : ''}`}
        >
          <span style={dot(meta.dot)} />
        </div>
      )}
    </div>
  )
}
