import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useAuth } from '../hooks/useAuth'
import StartGuide from './StartGuide'

export default function Layout() {
  const { company, isAdmin, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebarCollapsed') === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])

  // Avstängt företag: blockera appen (admin släpps förbi).
  if (company?.suspended && !isAdmin) {
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
