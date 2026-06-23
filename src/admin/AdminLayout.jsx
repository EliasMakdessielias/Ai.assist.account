import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { APP_ORIGIN } from '../lib/host'

// BokPilot Control Center – admin-skal (host-gated på admin.bokpilot.se).
// Separat skal från kundappen; återanvänder useAuth + befintliga admin-sidor.
const NAV = [
  { to: '/', label: 'Control Center', icon: 'ti-layout-dashboard', end: true, need: 'any' },
  { to: '/foretag', label: 'Företag', icon: 'ti-building', need: 'ops' },
  { to: '/billing', label: 'Abonnemang', icon: 'ti-credit-card', need: 'billing' },
  { to: '/support', label: 'Support', icon: 'ti-lifebuoy', need: 'support' },
  { to: '/system', label: 'Systemövervakning', icon: 'ti-activity', need: 'ops' },
  { to: '/ocr', label: 'OCR-test', icon: 'ti-scan', need: 'ops' },
  { to: '/bokslut-denied', label: 'Bokslut – nekade', icon: 'ti-shield-x', need: 'superadmin' },
]

export default function AdminLayout({ access }) {
  const { user, signOut } = useAuth()
  const allow = need => need === 'any' || (need === 'ops' && access.canViewOperations) ||
    (need === 'support' && access.canViewSupport) || (need === 'billing' && access.canViewBilling) ||
    (need === 'superadmin' && access.isSuperadmin)
  const roleLabel = access.isSuperadmin ? 'Superadmin' : access.isReadOnly ? 'Read-only' : (access.roles || []).join(', ') || 'Admin'

  // Support-kö: antal ärenden som väntar på agent (nya + kundsvar). Uppdateras i realtid.
  const [supportQueue, setSupportQueue] = useState(0)
  useEffect(() => {
    if (!access.canViewSupport) return
    let active = true
    const load = async () => { const { data } = await supabase.rpc('support_admin_queue_count'); if (active) setSupportQueue(Number(data) || 0) }
    load()
    const ch = supabase.channel('admin-support-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, load)
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [access.canViewSupport])
  const badgeFor = item => (item.to === '/support' ? supportQueue : 0)

  return (
    <div className="flex h-screen overflow-hidden bg-surface-3">
      <aside className="w-64 shrink-0 bg-white flex flex-col" style={{ borderRight: '1px solid rgba(0,0,0,0.10)' }}>
        <div className="px-5 h-16 flex flex-col justify-center border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="text-lg font-semibold tracking-tight"><span className="font-extrabold">B</span>ok<span className="font-extrabold">P</span>ilot</div>
          <div className="text-[11px] text-amber-600 font-semibold tracking-wide uppercase">Control Center</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV.filter(item => allow(item.need)).map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `flex items-center gap-3 px-5 py-2.5 text-sm ${isActive ? 'text-gray-900 font-medium bg-amber-50 border-r-2 border-amber-500' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
              <i className={`ti ${item.icon} text-base`} /> <span>{item.label}</span>
              {badgeFor(item) > 0 && (
                <span className="ml-auto text-[11px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center" title={`${badgeFor(item)} ärenden väntar på support`}>
                  {badgeFor(item) > 9 ? '9+' : badgeFor(item)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t px-5 py-3 text-xs" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="font-medium text-gray-700 truncate" title={user?.email}>{user?.email}</div>
          <div className="text-gray-400 mb-2">{roleLabel}</div>
          <a href={APP_ORIGIN} className="text-blue-700 hover:underline flex items-center gap-1 mb-1"><i className="ti ti-external-link" /> Till kundappen</a>
          <button onClick={signOut} className="text-gray-500 hover:text-gray-800 flex items-center gap-1"><i className="ti ti-logout" /> Logga ut</button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
