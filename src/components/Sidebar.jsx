import { useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const navItems = [
  { section: 'Översikt' },
  { label: 'Dashboard', icon: 'ti-layout-dashboard', to: '/' },
  { section: 'Ekonomi' },
  { label: 'Inkorg', icon: 'ti-inbox', to: '/inkorg' },
  { label: 'Bokföring', icon: 'ti-book', to: '/bokforing' },
  { label: 'Kundfakturor', icon: 'ti-file-invoice', to: '/fakturor' },
  { label: 'Leverantörsfakturor', icon: 'ti-file-import', to: '/leverantorsfakturor' },
  { label: 'Kassa och bank', icon: 'ti-building-bank', to: '/kassa-bank' },
  { label: 'Lön', icon: 'ti-wallet', to: '/lon' },
  { label: 'Moms', icon: 'ti-receipt-tax', to: '/moms' },
  { label: 'Rapporter', icon: 'ti-chart-bar', to: '/rapporter' },
  { label: 'AI-granskning', icon: 'ti-shield-check', to: '/granskning' },
  { section: 'Register' },
  { label: 'Kunder', icon: 'ti-users', to: '/kunder' },
  { label: 'Leverantörer', icon: 'ti-building-store', to: '/leverantorer' },
  { label: 'Produkter', icon: 'ti-package', to: '/produkter' },
]

const settingsItems = [
  { label: 'Företagsinställningar', to: '/installningar' },
  { label: 'Användare & behörighet', to: '/installningar/team' },
  { label: 'Kassa- och bankkonton', to: '/installningar/kassa-bankkonton' },
  { label: 'Löneinställningar', to: '/installningar' },
  { label: 'Räkenskapsår och IB', to: '/installningar/rakenskapsar' },
  { label: 'Kontoplan', to: '/installningar/kontoplan' },
  { label: 'Artikelkontering', to: '/installningar' },
  { label: 'Bokföringsmallar', to: '/installningar' },
  { label: 'Import och export', to: '/installningar/import-export' },
]

export default function Sidebar() {
  const { company, companies, switchCompany, createCompany, signOut, isAdmin } = useAuth()
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(location.pathname.startsWith('/installningar'))
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newOrg, setNewOrg] = useState('')
  const [creating, setCreating] = useState(false)

  async function doCreate() {
    if (!newName.trim()) return toast.error('Företagsnamn krävs')
    setCreating(true)
    try { await createCompany(newName, newOrg); toast.success('Företag skapat'); setCreateOpen(false); setNewName(''); setNewOrg('') }
    catch (e) { toast.error('Kunde inte skapa: ' + e.message) }
    setCreating(false)
  }

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-5 py-2 text-[13.5px] transition-colors cursor-pointer w-full ${
      isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
    }`

  return (
    <aside className="sidebar w-[230px] bg-white border-r fixed top-0 left-0 h-screen flex flex-col z-50" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
      <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="text-xl font-semibold tracking-tight">Böcker</div>
        <div className="text-[11px] text-gray-400 mt-0.5">Bokföring &amp; ekonomi</div>
      </div>

      <nav className="flex-1 py-2.5 overflow-y-auto">
        {navItems.map((item, i) =>
          item.section ? (
            <div key={i} className="px-5 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {item.section}
            </div>
          ) : (
            <NavLink key={i} to={item.to} end={item.to === '/'} className={linkClass}>
              <i className={`ti ${item.icon} text-[17px] w-5 text-center`} />
              {item.label}
              {item.badge && (
                <span className="ml-auto bg-blue-700 text-white text-[10px] font-medium px-1.5 py-0 rounded-full">
                  {item.badge}
                </span>
              )}
            </NavLink>
          )
        )}

        {isAdmin && (
          <>
            <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Plattform</div>
            <NavLink to="/admin" className={linkClass}>
              <i className="ti ti-shield-lock text-[17px] w-5 text-center" />
              Superadmin
            </NavLink>
          </>
        )}

        <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Inställningar
        </div>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`flex items-center gap-2.5 px-5 py-2 text-[13.5px] w-full transition-colors ${
            settingsOpen ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <i className="ti ti-settings text-[17px] w-5 text-center" />
          Inställningar
          <i className={`ti ti-chevron-down text-sm ml-auto transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
        </button>
        <div className={`nav-submenu ${settingsOpen ? 'open' : ''}`}>
          {settingsItems.map((item, i) => (
            <NavLink
              key={i}
              to={item.to}
              className={({ isActive }) =>
                `block px-5 pl-12 py-1.5 text-[13px] transition-colors ${
                  isActive ? 'text-blue-700 font-medium bg-blue-50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="p-3 border-t relative" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {/* Företagsväxlare-dropdown */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-lg shadow-xl z-50 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Byt företag</div>
              <div className="max-h-60 overflow-y-auto">
                {companies.map(c => (
                  <button key={c.id} onClick={() => { switchCompany(c.id); setMenuOpen(false) }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-50 ${c.id === company?.id ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>
                    <i className={`ti ${c.id === company?.id ? 'ti-circle-check-filled' : 'ti-building'} text-base`} />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
              <div className="border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                <button onClick={() => { setMenuOpen(false); setCreateOpen(true) }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><i className="ti ti-plus" /> Skapa nytt företag</button>
                <Link to="/installningar" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><i className="ti ti-settings mr-2" />Företagsinställningar</Link>
              </div>
            </div>
          </>
        )}

        <div className="bg-gray-50 rounded-lg p-2.5 flex items-center gap-2.5">
          <button onClick={() => setMenuOpen(o => !o)} className="flex items-center gap-2.5 min-w-0 flex-1" title="Byt företag">
            <div className="w-8 h-8 bg-blue-700 rounded-lg flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
              {company?.name?.slice(0, 2).toUpperCase() || 'AB'}
            </div>
            <div className="min-w-0 text-left">
              <div className="text-[12.5px] font-medium truncate">{company?.name || 'Företag'}</div>
              <div className="text-[11px] text-gray-400">{companies.length > 1 ? `${companies.length} företag · byt` : (company?.org_nr || '')}</div>
            </div>
            <i className="ti ti-selector text-gray-400 shrink-0" />
          </button>
          <button onClick={signOut} title="Logga ut" className="text-gray-400 hover:text-gray-700 shrink-0 p-1">
            <i className="ti ti-logout text-lg" />
          </button>
        </div>
      </div>

      {/* Skapa nytt företag */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => !creating && setCreateOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}><span className="text-base font-medium">Skapa nytt företag</span></div>
            <div className="px-5 py-4 space-y-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Företagsnamn *</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} autoFocus /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Organisationsnummer</label><input className="input" value={newOrg} onChange={e => setNewOrg(e.target.value)} /></div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setCreateOpen(false)} disabled={creating}>Avbryt</button>
              <button className="btn btn-primary" onClick={doCreate} disabled={creating}>{creating ? 'Skapar…' : 'Skapa'}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
