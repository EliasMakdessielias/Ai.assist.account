import { useState, useEffect, useRef } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { isValidOrgNr, normalizeOrgNr } from '../lib/orgnr'
import { BRAND } from '../lib/brand'
import { SETTINGS_ITEMS, isSettingsItemActive, isSettingsSection } from '../lib/settingsNav'
import NotificationCenter from './NotificationCenter'
import { FEATURE_KEY as BOKSLUT_FEATURE } from '../lib/bokslut'
import toast from 'react-hot-toast'

const navItems = [
  { section: 'Översikt' },
  { label: 'Dashboard', icon: 'ti-layout-dashboard', to: '/' },
  { label: 'AI-assistent', icon: 'ti-sparkles', to: '/assistent' },
  { label: 'AI-ekonomichef', icon: 'ti-chart-arcs', to: '/ekonomichef' },
  { label: 'AI Bokslut & Årsredovisning', icon: 'ti-report-analytics', to: '/ai-bokslut', featureKey: BOKSLUT_FEATURE, badgeKey: 'bokslut' },
  { section: 'Ekonomi' },
  { label: 'Inkorg', icon: 'ti-inbox', to: '/inkorg' },
  { label: 'Bokföring', icon: 'ti-book', to: '/bokforing' },
  { label: 'Kundfakturor', icon: 'ti-file-invoice', to: '/fakturor' },
  { label: 'Leverantörsfakturor', icon: 'ti-file-import', to: '/leverantorsfakturor' },
  { label: 'Kassa och bank', icon: 'ti-building-bank', to: '/kassa-bank' },
  { label: 'Kontoanalys', icon: 'ti-report-search', to: '/kontoanalys' },
  { label: 'Lön', icon: 'ti-wallet', to: '/lon' },
  { label: 'Moms', icon: 'ti-receipt-tax', to: '/moms' },
  { label: 'Månadskontroll', icon: 'ti-checklist', to: '/manadskontroll', badgeKey: 'mc' },
  { label: 'Rapporter', icon: 'ti-chart-bar', to: '/rapporter' },
  { label: 'AI-granskning', icon: 'ti-shield-check', to: '/granskning' },
  { section: 'Register' },
  { label: 'Kunder', icon: 'ti-users', to: '/kunder' },
  { label: 'Leverantörer', icon: 'ti-building-store', to: '/leverantorer' },
  { label: 'Produkter', icon: 'ti-package', to: '/produkter' },
  { section: 'Hjälp' },
  { label: 'Handbok', icon: 'ti-book-2', to: '/help' },
  { label: 'Support', icon: 'ti-headset', to: '/support' },
]

export default function Sidebar({ collapsed = false, onToggle }) {
  const { company, companies, switchCompany, createCompany, signOut, isAdmin, platformAccess } = useAuth()
  const canViewOps = !!platformAccess?.canViewOperations
  const canViewSupport = !!platformAccess?.canViewSupport
  const canManageBilling = !!platformAccess?.canManageBilling
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(isSettingsSection(location.pathname))
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newOrg, setNewOrg] = useState('')
  const [creating, setCreating] = useState(false)
  const [hamtar, setHamtar] = useState(false)
  const orgDebounce = useRef(null)
  const lastOrgLookup = useRef('')

  // Månadskontroll: kritiska/höga öppna punkter → badge (uppdateras i realtid).
  const [mcCounts, setMcCounts] = useState({ critical: 0, high: 0, open: 0 })
  useEffect(() => {
    if (!company?.id) return
    let active = true
    const load = async () => { const { data } = await supabase.rpc('mc_open_counts', { p_company: company.id }); if (active && data) setMcCounts(data) }
    load()
    const ch = supabase.channel('sidebar-mc')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_control_items' }, load)
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [company?.id])
  const mcBadge = mcCounts.critical > 0 ? { n: mcCounts.critical, bg: '#dc2626' } : (mcCounts.high > 0 ? { n: mcCounts.high, bg: '#f97316' } : null)

  // AI Bokslut & Årsredovisning: licensgrindat menyval + badge (kritisk röd/hög orange), realtid.
  const [bokslutLicensed, setBokslutLicensed] = useState(false)
  const [bokslutCounts, setBokslutCounts] = useState({ critical: 0, high: 0, open: 0 })
  useEffect(() => {
    if (!company?.id) { setBokslutLicensed(false); return }
    let active = true
    supabase.rpc('has_ai_feature', { p_company: company.id, p_key: BOKSLUT_FEATURE }).then(({ data }) => { if (active) setBokslutLicensed(!!data) })
    const load = async () => { const { data } = await supabase.rpc('bokslut_open_counts', { p_company: company.id }); if (active && data) setBokslutCounts(data) }
    load()
    const ch = supabase.channel('sidebar-bokslut')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bokslut_checks' }, load)
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [company?.id])
  const bokslutBadge = bokslutCounts.critical > 0 ? { n: bokslutCounts.critical, bg: '#dc2626' } : (bokslutCounts.high > 0 ? { n: bokslutCounts.high, bg: '#f97316' } : null)
  const badgeForItem = item => item.badgeKey === 'mc' ? mcBadge : item.badgeKey === 'bokslut' ? bokslutBadge : null

  // Hämtar företagsnamnet automatiskt från organisationsnumret (officiell källa via
  // edge-funktionen hamta-foretag). Best-effort: misslyckas tyst så namnet kan skrivas manuellt.
  async function hamtaForetagsnamn(org) {
    setHamtar(true)
    try {
      const { data, error } = await supabase.functions.invoke('hamta-foretag', { body: { org_nr: org } })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      const namn = data.company?.legalName || data.company?.displayName || data.result?.name || ''
      if (namn) setNewName(namn)
    } catch { /* tyst – användaren kan fylla i namnet manuellt */ }
    setHamtar(false)
  }

  // Auto-hämtning vid giltigt org-nr (Luhn), debounce ~600 ms.
  useEffect(() => {
    if (orgDebounce.current) clearTimeout(orgDebounce.current)
    if (!createOpen || !isValidOrgNr(newOrg)) return
    const norm = normalizeOrgNr(newOrg)
    if (norm === lastOrgLookup.current) return
    orgDebounce.current = setTimeout(() => { lastOrgLookup.current = norm; hamtaForetagsnamn(newOrg) }, 600)
    return () => orgDebounce.current && clearTimeout(orgDebounce.current)
  }, [newOrg, createOpen])   // eslint-disable-line react-hooks/exhaustive-deps

  function resetCreate() { setCreateOpen(false); setNewName(''); setNewOrg(''); lastOrgLookup.current = '' }

  async function doCreate() {
    if (!newName.trim()) return toast.error('Ange organisationsnummer (företagsnamnet hämtas automatiskt) eller skriv namnet manuellt')
    setCreating(true)
    try { await createCompany(newName, newOrg); toast.success('Företag skapat'); resetCreate() }
    catch (e) { toast.error('Kunde inte skapa: ' + e.message) }
    setCreating(false)
  }

  const linkClass = ({ isActive }) =>
    `flex items-center ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-5'} py-2 text-[13.5px] transition-colors cursor-pointer w-full ${
      isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
    }`

  return (
    <aside className="sidebar bg-white border-r fixed top-0 left-0 h-screen flex flex-col z-50 transition-[width] duration-150" style={{ borderColor: 'rgba(0,0,0,0.10)', width: collapsed ? 72 : 'max(220px, 10vw)' }}>
      {/* Logotyp + fäll-knapp */}
      <div className={`border-b flex items-center ${collapsed ? 'justify-center py-4' : 'justify-between px-5 pt-5 pb-4'}`} style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button onClick={onToggle} title="Expandera meny" aria-label="Expandera meny"
              className="w-9 h-9 bg-white border rounded-lg flex items-center justify-center hover:bg-gray-50" style={{ borderColor: 'rgba(0,0,0,0.12)' }}>
              <img src={BRAND.logo} alt={BRAND.appName} className="w-6 h-6 object-contain" />
            </button>
            <NotificationCenter collapsed />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <img src={BRAND.logo} alt={BRAND.appName} className="w-8 h-8 object-contain shrink-0" />
              <div className="min-w-0">
                <div className="text-xl font-semibold tracking-tight truncate">
                  {BRAND.appName.split('').map((ch, i) =>
                    /[A-ZÅÄÖ]/.test(ch) ? <span key={i} className="font-extrabold">{ch}</span> : ch
                  )}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5 truncate">{BRAND.tagline}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <NotificationCenter />
              <button onClick={onToggle} title="Fäll ihop meny" aria-label="Fäll ihop meny" className="text-gray-400 hover:text-gray-700 p-1">
                <i className="ti ti-layout-sidebar-left-collapse text-xl" />
              </button>
            </div>
          </>
        )}
      </div>

      <nav className="flex-1 py-2.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item, i) => {
          // Licensgrindade menyval (t.ex. AI Bokslut) visas bara om funktionen ingår i planen.
          if (item.featureKey === BOKSLUT_FEATURE && !bokslutLicensed) return null
          if (item.section) {
            return collapsed
              ? <div key={i} className="mx-3 my-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }} />
              : <div key={i} className="px-5 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{item.section}</div>
          }
          const badge = badgeForItem(item)
          return (
            <NavLink key={i} to={item.to} end={item.to === '/'} className={s => `${linkClass(s)} relative`} title={collapsed ? item.label : undefined}>
              <i className={`ti ${item.icon} text-[17px] w-5 text-center`} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {badge && (collapsed
                ? <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full" style={{ background: badge.bg }} />
                : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: badge.bg }}>{badge.n > 9 ? '9+' : badge.n}</span>)}
            </NavLink>
          )
        })}

        {(isAdmin || canViewOps || canViewSupport || canManageBilling) && (
          collapsed ? (
            <>
              {isAdmin && <NavLink to="/admin" className={linkClass} title="Superadmin"><i className="ti ti-shield-lock text-[17px] w-5 text-center" /></NavLink>}
              {canViewOps && <NavLink to="/admin/system" className={linkClass} title="Systemövervakning"><i className="ti ti-activity-heartbeat text-[17px] w-5 text-center" /></NavLink>}
              {canViewOps && <NavLink to="/admin/ocr-test" className={linkClass} title="OCR-test"><i className="ti ti-scan text-[17px] w-5 text-center" /></NavLink>}
              {canViewSupport && <NavLink to="/admin/support" className={linkClass} title="Supportärenden"><i className="ti ti-headset text-[17px] w-5 text-center" /></NavLink>}
              {canManageBilling && <NavLink to="/admin/billing" className={linkClass} title="Billing"><i className="ti ti-credit-card text-[17px] w-5 text-center" /></NavLink>}
            </>
          ) : (
            <>
              <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Plattform</div>
              {isAdmin && <NavLink to="/admin" className={linkClass}><i className="ti ti-shield-lock text-[17px] w-5 text-center" />Superadmin</NavLink>}
              {canViewOps && <NavLink to="/admin/system" className={linkClass}><i className="ti ti-activity-heartbeat text-[17px] w-5 text-center" />Systemövervakning</NavLink>}
              {canViewOps && <NavLink to="/admin/ocr-test" className={linkClass}><i className="ti ti-scan text-[17px] w-5 text-center" />OCR-test</NavLink>}
              {canViewSupport && <NavLink to="/admin/support" className={linkClass}><i className="ti ti-headset text-[17px] w-5 text-center" />Supportärenden</NavLink>}
              {canManageBilling && <NavLink to="/admin/billing" className={linkClass}><i className="ti ti-credit-card text-[17px] w-5 text-center" />Billing</NavLink>}
            </>
          )
        )}

        {/* Inställningar */}
        {collapsed ? (
          <NavLink to="/installningar" className={linkClass} title="Inställningar"
            aria-current={isSettingsSection(location.pathname) ? 'page' : undefined}>
            <i className="ti ti-settings text-[17px] w-5 text-center" />
          </NavLink>
        ) : (
          <>
            <div className="px-5 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Inställningar</div>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`flex items-center gap-2.5 px-5 py-2 text-[13.5px] w-full transition-colors ${
                settingsOpen ? 'text-gray-900 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <i className="ti ti-settings text-[17px] w-5 text-center" />
              Inställningar
              <i className={`ti ti-chevron-down text-sm ml-auto transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
            </button>
            <div className={`nav-submenu ${settingsOpen ? 'open' : ''}`}>
              {SETTINGS_ITEMS.map((item, i) => {
                const active = isSettingsItemActive(item, location.pathname)
                return (
                  <Link key={i} to={item.to} aria-current={active ? 'page' : undefined}
                    className={`block px-5 pl-12 py-1.5 text-[13px] transition-colors ${
                      active ? 'text-blue-700 font-medium bg-blue-50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    }`}>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </nav>

      <div className="p-3 border-t relative" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {/* Företagsväxlare-dropdown */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-full mb-1 bg-white rounded-lg shadow-xl z-50 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.12)', left: 12, minWidth: 220 }}>
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

        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button onClick={() => setMenuOpen(o => !o)} title={`${company?.name || 'Företag'}${companies.length > 1 ? ' · byt företag' : ''}`}
              className="w-9 h-9 bg-blue-700 rounded-lg flex items-center justify-center text-white text-[11px] font-semibold hover:bg-blue-800">
              {company?.name?.slice(0, 2).toUpperCase() || 'AB'}
            </button>
            <button onClick={signOut} title="Logga ut" className="text-gray-400 hover:text-gray-700 p-1"><i className="ti ti-logout text-lg" /></button>
          </div>
        ) : (
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
        )}
      </div>

      {/* Skapa nytt företag */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => !creating && resetCreate()}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}><span className="text-base font-medium">Skapa nytt företag</span></div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Organisationsnummer *</label>
                <input className="input" value={newOrg} autoFocus placeholder="556036-0793"
                  onChange={e => setNewOrg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && isValidOrgNr(newOrg)) { e.preventDefault(); lastOrgLookup.current = normalizeOrgNr(newOrg); hamtaForetagsnamn(newOrg) } }} />
                {hamtar && <p className="text-xs text-blue-600 mt-1"><i className="ti ti-loader mr-1" />Hämtar företagsuppgifter…</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Företagsnamn *</label>
                <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Hämtas automatiskt från org.nr" />
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={resetCreate} disabled={creating}>Avbryt</button>
              <button className="btn btn-primary" onClick={doCreate} disabled={creating || hamtar}>{creating ? 'Skapar…' : 'Skapa'}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
