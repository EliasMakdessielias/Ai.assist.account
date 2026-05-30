import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})
const ACTIVE_KEY = 'activeCompanyId'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [companies, setCompanies] = useState([])
  const [company, setCompany] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadCompanies(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadCompanies(session.user)
      else { setCompanies([]); setCompany(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchCompanies(userId) {
    const { data } = await supabase.from('user_companies').select('company_id, role, companies(*)').eq('user_id', userId)
    return (data || []).map(r => r.companies).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  }

  async function loadCompanies(u) {
    // Är användaren plattformsadmin? (pa_self-policyn returnerar bara egen rad om man är admin)
    try {
      const { data: pa } = await supabase.from('platform_admins').select('email').limit(1)
      setIsAdmin((pa || []).length > 0)
    } catch { setIsAdmin(false) }
    // Acceptera ev. väntande inbjudningar (kopplar användaren till företag som bjudit in mejlet).
    await acceptInvites(u)
    let list = await fetchCompanies(u.id)
    // Har användaren inget företag än? Skapa det från registreringsuppgifterna (kräver inloggad session).
    if (!list.length) {
      await ensureCompanyFromMetadata(u)
      list = await fetchCompanies(u.id)
    }
    setCompanies(list)
    const stored = localStorage.getItem(ACTIVE_KEY)
    const active = list.find(c => c.id === stored) || list[0] || null
    setCompany(active)
    if (active) localStorage.setItem(ACTIVE_KEY, active.id)
    setLoading(false)
  }

  // Kollar company_invites för användarens mejl och skapar kopplingar.
  async function acceptInvites(u) {
    const email = u.email
    if (!email) return
    try {
      const { data: invites } = await supabase.from('company_invites').select('id, company_id').eq('status', 'pending').ilike('email', email)
      for (const inv of invites || []) {
        await supabase.from('user_companies').insert({ user_id: u.id, company_id: inv.company_id, role: 'member', email })
        await supabase.from('company_invites').update({ status: 'accepted' }).eq('id', inv.id)
      }
    } catch { /* tabellen kanske inte finns än – ignorera */ }
  }

  // Skapar företaget från uppgifterna som angavs vid registrering (sparade i user_metadata).
  async function ensureCompanyFromMetadata(u) {
    const meta = u.user_metadata || {}
    if (!meta.company_name) return
    const { data: comp, error } = await supabase.from('companies').insert({ name: meta.company_name, org_nr: meta.org_nr || null }).select().single()
    if (!error && comp) {
      await supabase.from('user_companies').insert({ user_id: u.id, company_id: comp.id, role: 'admin', email: u.email })
      localStorage.setItem(ACTIVE_KEY, comp.id)
    }
  }

  function switchCompany(id) {
    const c = companies.find(x => x.id === id)
    if (c) { setCompany(c); localStorage.setItem(ACTIVE_KEY, id) }
  }

  async function createCompany(name, orgNr) {
    const { data: comp, error } = await supabase.from('companies').insert({ name: name.trim(), org_nr: orgNr || null }).select().single()
    if (error) throw error
    await supabase.from('user_companies').insert({ user_id: user.id, company_id: comp.id, role: 'admin', email: user.email })
    const list = await fetchCompanies(user.id)
    setCompanies(list)
    setCompany(comp)
    localStorage.setItem(ACTIVE_KEY, comp.id)
    return comp
  }

  async function signUp(email, password, companyName, orgNr) {
    // Spara företagsuppgifterna i metadata. Själva företaget skapas vid första
    // inloggningen (efter ev. e-postbekräftelse), då en giltig session finns och
    // säkerhetsreglerna tillåter det. Inbjudna kollegor kopplas istället via acceptInvites.
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { company_name: companyName, org_nr: orgNr || null } },
    })
    if (error) throw error
    return data
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null); setCompanies([]); setCompany(null); setIsAdmin(false)
  }

  async function reloadCompany() {
    if (!user) return
    const list = await fetchCompanies(user.id)
    setCompanies(list)
    setCompany(prev => list.find(c => c.id === prev?.id) || list[0] || null)
  }

  return (
    <AuthContext.Provider value={{ user, company, companies, isAdmin, loading, signUp, signIn, signOut, reloadCompany, switchCompany, createCompany }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
