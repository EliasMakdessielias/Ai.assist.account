// Global state för ROBO-bp-panelen: öppna/stäng + kontext (vy + vald referens) + licens.
// useRoboBp() har en SÄKER default (no-op) så komponenter kan anropa den utan provider (t.ex. i tester).
import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { FEATURE_KEY } from '../lib/roboBp'

// Härled ROBO-vy ur en route-path (kontextförståelse, point 2/3).
const PATH_VIEW = [
  [/^\/bokforing/, 'bokforing'], [/^\/leverantorsfakturor/, 'leverantorsfakturor'],
  [/^\/fakturor/, 'kundfakturor'], [/^\/kassa-bank/, 'kassa_bank'], [/^\/moms/, 'moms'],
  [/^\/manadskontroll/, 'manadskontroll'], [/^\/ai-bokslut/, 'ai_bokslut'], [/^\/inkorg/, 'inkorg'],
]
export function viewForPath(pathname = '') {
  for (const [re, v] of PATH_VIEW) if (re.test(pathname)) return v
  return 'oversikt'
}

const noop = () => {}
const RoboBpContext = createContext({ isOpen: false, licensed: false, descriptor: null, currentView: 'oversikt', openWith: noop, open: noop, close: noop })
export const useRoboBp = () => useContext(RoboBpContext)

export function RoboBpProvider({ children }) {
  const { company } = useAuth()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const [descriptor, setDescriptor] = useState(null)
  const [licensed, setLicensed] = useState(false)
  const currentView = viewForPath(location.pathname)

  useEffect(() => {
    if (!company?.id) { setLicensed(false); return }
    let active = true
    supabase.rpc('has_ai_feature', { p_company: company.id, p_key: FEATURE_KEY })
      .then(({ data }) => { if (active) setLicensed(!!data) })
    return () => { active = false }
  }, [company?.id])

  // Öppna med explicit kontext (vy + ev. vald verifikation/faktura/dokument …).
  const openWith = useCallback((d = {}) => {
    setDescriptor({ view: d.view || viewForPath(location.pathname), selection: d.selection || null })
    setIsOpen(true)
  }, [location.pathname])
  const open = useCallback(() => openWith({}), [openWith])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <RoboBpContext.Provider value={{ isOpen, licensed, descriptor, currentView, openWith, open, close }}>
      {children}
    </RoboBpContext.Provider>
  )
}
