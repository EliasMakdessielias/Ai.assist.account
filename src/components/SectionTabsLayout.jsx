import { useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { visibleTabs } from '../lib/sectionTabs'

// Återanvändbar layout: huvudvalets undersidor visas som horisontella toppflikar i
// innehållsytan (ingen dropdown i sidomenyn). Aktiv flik = blå underlinje. Varje undersida
// renderas via <Outlet/> och kan lägga en egen action (t.ex. "+ Ny lönekörning") uppe till
// höger genom useSectionActions().setActions(node). URL:en speglar aktiv flik; back/forward,
// direktlänkar och behörighet per flik fungerar via react-router + visibleTabs().
export default function SectionTabsLayout({ config }) {
  const { isAdmin, platformAccess } = useAuth()
  const [actions, setActions] = useState(null)
  const tabs = visibleTabs(config, { isAdmin, platformAccess })

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between gap-4"
        style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {/* Horisontella flikar – scrollbara på smal skärm utan att bryta layouten */}
        <nav className="flex items-stretch gap-1 h-full overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {tabs.map(t => (
            <NavLink key={t.key} to={t.path}
              className={({ isActive }) => `px-4 h-full flex items-center text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                isActive ? 'text-gray-900 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0">{actions}</div>
      </div>
      <div className="p-7">
        <Outlet context={{ setActions }} />
      </div>
    </div>
  )
}

// Undersidor använder denna för att placera sin action (knapp) i den delade toppraden.
// Anropa i en useEffect: const { setActions } = useSectionActions(); useEffect(() => { setActions(<…/>); return () => setActions(null) }, [])
export function useSectionActions() {
  return useOutletContext() || { setActions: () => {} }
}
