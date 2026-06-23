import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import App from './App'
import './index.css'
import { registerPWA } from './lib/pwa'
import { startNetworkHealth } from './lib/offline/networkHealth'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)

// Etapp 1A: PWA (endast prod-bygge) + centralt nätverkshälsolager. Påverkar inte sparflöden.
registerPWA()
startNetworkHealth()

// Etapp 2A: retention-rensning av utgångna lokala pilotutkast (best-effort, påverkar inget sparflöde).
import('./lib/offline/autosaveStore').then(m => m.purgeExpired()).catch(() => {})
import('./lib/offline/flags').then(m => { try { window.__bokpilotFlags = { autosavePilot: m.isAutosavePilotEnabled } } catch { /* ignore */ } }).catch(() => {})
