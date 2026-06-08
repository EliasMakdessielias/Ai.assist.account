import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { eventLabel, eventIcon } from '../lib/notifications'
import toast from 'react-hot-toast'

const fmtTime = ts => {
  if (!ts) return ''
  const d = new Date(ts), now = new Date(), diff = (now - d) / 1000
  if (diff < 60) return 'nyss'
  if (diff < 3600) return `${Math.floor(diff / 60)} min sedan`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h sedan`
  return d.toLocaleDateString('sv-SE')
}

// In-app notiscenter: klocka med olästa-räknare + dropdown.
export default function NotificationCenter({ collapsed = false }) {
  const { user, company } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const ref = useRef(null)

  async function load() {
    if (!user) return
    const { data } = await supabase.from('notification_queue')
      .select('id, subject, body, link_url, read_at, created_at, event_id, notification_events(event_type)')
      .eq('channel', 'in_app').order('created_at', { ascending: false }).limit(40)
    setItems(data || [])
  }
  useEffect(() => { if (user) load() }, [user?.id, company?.id])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [user?.id])
  useEffect(() => {
    if (!open) return
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const unread = items.filter(n => !n.read_at).length

  async function markRead(n) {
    if (n.read_at) return
    setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
    await supabase.from('notification_queue').update({ read_at: new Date().toISOString() }).eq('id', n.id)
  }
  async function markAll() {
    const ids = items.filter(n => !n.read_at).map(n => n.id)
    if (!ids.length) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(x => ({ ...x, read_at: x.read_at || now })))
    await supabase.from('notification_queue').update({ read_at: now }).in('id', ids)
    toast.success('Alla markerade som lästa')
  }
  function clickNotis(n) {
    markRead(n)
    setOpen(false)
    if (n.link_url) navigate(n.link_url)
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen(o => !o); if (!open) load() }} title="Notiser" aria-label="Notiser"
        className="relative text-gray-400 hover:text-gray-700 p-1">
        <i className="ti ti-bell text-xl" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-600 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute z-[60] bg-white rounded-lg shadow-xl overflow-hidden ${collapsed ? 'left-full ml-2 bottom-0' : 'right-0 mt-2'}`}
          style={{ border: '0.5px solid rgba(0,0,0,0.12)', width: 340, maxWidth: '90vw' }}>
          <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            <span className="text-sm font-semibold">Notiser</span>
            {unread > 0 && <button className="text-xs text-blue-700 hover:underline" onClick={markAll}>Markera alla som lästa</button>}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">
                <i className="ti ti-bell-off text-3xl block mb-2 opacity-40" />Inga notiser
              </div>
            ) : items.map(n => {
              const et = n.notification_events?.event_type
              return (
                <button key={n.id} onClick={() => clickNotis(n)}
                  className={`w-full text-left px-4 py-2.5 flex gap-3 hover:bg-gray-50 border-b ${n.read_at ? '' : 'bg-blue-50/40'}`}
                  style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                  <i className={`ti ${eventIcon(et)} text-base mt-0.5 ${n.read_at ? 'text-gray-400' : 'text-blue-700'}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] truncate ${n.read_at ? 'text-gray-700' : 'font-medium text-gray-900'}`}>{n.subject || eventLabel(et)}</div>
                    {n.body && <div className="text-xs text-gray-500 line-clamp-2">{n.body}</div>}
                    <div className="text-[11px] text-gray-400 mt-0.5">{fmtTime(n.created_at)}</div>
                  </div>
                  {!n.read_at && <span className="w-2 h-2 rounded-full bg-blue-600 mt-1.5 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
