import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useAuth } from '../hooks/useAuth'
import StartGuide from './StartGuide'
import { isCompanyLocked, lockAllowsPath, serviceStateMeta } from '../lib/serviceLock'

// Låsvy när företagets tjänst är pausad/blockerad (Fas 2). Data raderas aldrig; endast
// supportflödet är nåbart. Kunden kan inte skapa/tolka/bokföra/ladda upp/ändra/radera.
function ServiceLockView({ company, onSignOut, onSupport }) {
  const meta = serviceStateMeta(company.service_state)
  const date = company.service_changed_at ? new Date(company.service_changed_at).toLocaleDateString('sv-SE') : null
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-3 p-6">
      <div className="bg-white rounded-xl p-8 max-w-md w-full text-center shadow-sm" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <i className="ti ti-lock text-4xl text-amber-500 block mb-3" />
        <div className="text-lg font-semibold mb-1">Ditt BokPilot-konto är tillfälligt pausat.</div>
        <p className="text-sm text-gray-500 mb-4">Din bokföringsdata är oförändrad och raderas inte. Kontakta support för att återaktivera tjänsten.</p>
        <div className="text-left text-sm bg-gray-50 rounded-lg px-4 py-3 mb-5" style={{ border: '0.5px solid rgba(0,0,0,0.06)' }}>
          <div className="flex justify-between py-0.5"><span className="text-gray-400">Status</span><span className={`font-medium ${meta.tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{meta.label}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-gray-400">Orsak</span><span className="font-medium text-gray-700">{company.service_reason || '—'}</span></div>
          {date && <div className="flex justify-between py-0.5"><span className="text-gray-400">Datum</span><span className="font-medium text-gray-700">{date}</span></div>}
        </div>
        <div className="flex justify-center gap-2.5">
          <button className="btn btn-primary" onClick={onSupport}><i className="ti ti-lifebuoy" /> Kontakta support</button>
          <button className="btn" onClick={onSignOut}><i className="ti ti-logout" /> Logga ut</button>
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { company, isAdmin, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebarCollapsed') === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])

  // Tjänstelås (Fas 2): pausad/blockerad → låsvy, men supportflödet förblir nåbart.
  // Plattformsadmin (isAdmin) släpps alltid förbi. Kontrolleras FÖRE legacy-suspended.
  if (isCompanyLocked(company) && !isAdmin && !lockAllowsPath(location.pathname)) {
    return <ServiceLockView company={company} onSignOut={signOut} onSupport={() => navigate('/support')} />
  }

  // Avstängt företag (väntar på godkännande): blockera appen (admin släpps förbi).
  if (company?.suspended && !isCompanyLocked(company) && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-3 p-6">
        <div className="bg-white rounded-xl p-8 max-w-md text-center shadow-sm" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <i className="ti ti-clock-pause text-4xl text-amber-500 block mb-3" />
          <div className="text-lg font-semibold mb-1">Kontot inväntar aktivering</div>
          <p className="text-sm text-gray-500 mb-5">Företaget <b>{company.name}</b> är ännu inte aktiverat. Vi aktiverar det så snart som möjligt — kontakta support om det dröjer.</p>
          <button className="btn" onClick={signOut}><i className="ti ti-logout" /> Logga ut</button>
        </div>
      </div>
    )
  }

  // Nytt företag som inte gått igenom startguiden ännu.
  if (company && company.onboarded === false) {
    return <StartGuide />
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <main className="flex-1 min-w-0 transition-[margin] duration-150" style={{ marginLeft: collapsed ? 72 : 'max(220px, 10vw)' }}>
        <Outlet />
      </main>
    </div>
  )
}
