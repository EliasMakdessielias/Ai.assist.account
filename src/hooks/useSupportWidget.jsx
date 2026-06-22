import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '../lib/supabase'

// Global state för supportwidgeten: öppet/stängt-läge, antal olästa supportsvar och realtime.
// Konversationen lever vidare i bakgrunden (panelen är alltid monterad, döljs visuellt).
const SupportWidgetContext = createContext(null)

export function useSupportWidget() {
  const ctx = useContext(SupportWidgetContext)
  if (!ctx) throw new Error('useSupportWidget måste användas inom SupportWidgetProvider')
  return ctx
}

export function SupportWidgetProvider({ children }) {
  const { user, company } = useAuth()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [connError, setConnError] = useState(false)

  // Olästa = supportsvar (is_admin) i egna icke-stängda ärenden, nyare än senaste läsning (server-side).
  const refreshUnread = useCallback(async () => {
    if (!user) { setUnread(0); return }
    const { data, error } = await supabase.rpc('support_unread_count')
    if (!error) setUnread(Number(data) || 0)
  }, [user])

  useEffect(() => { refreshUnread() }, [refreshUnread, company?.id])

  // Realtime: nya supportsvar uppdaterar badge utan sidrefresh (RLS gäller → bara egna ärenden).
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('support-widget-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        if (payload.new?.is_admin) refreshUnread()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnError(false)
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnError(true)
      })
    return () => { supabase.removeChannel(ch) }
  }, [user, refreshUnread])

  const openSupport = useCallback(() => setOpen(true), [])
  const closeSupport = useCallback(() => setOpen(false), [])
  const toggleSupport = useCallback(() => setOpen(o => !o), [])

  const value = { open, openSupport, closeSupport, toggleSupport, unread, setUnread, refreshUnread, connError }
  return <SupportWidgetContext.Provider value={value}>{children}</SupportWidgetContext.Provider>
}
