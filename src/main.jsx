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
