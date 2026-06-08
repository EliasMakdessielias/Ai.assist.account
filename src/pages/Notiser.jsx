import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  EVENT_GROUPS, NOTIFICATION_CHANNELS, CHANNEL_LABELS,
  eventIcon, eventLabel, channelStatus, STATUS_META, resolvePref,
} from '../lib/notifications'
import toast from 'react-hot-toast'

const toneClass = {
  green: 'text-green-600', amber: 'text-amber-600', blue: 'text-blue-600', gray: 'text-gray-400',
}

function Switch({ on, disabled, onClick, title }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title} aria-pressed={on}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-gray-300'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function Notiser() {
  const { user, company } = useAuth()
  const [prefs, setPrefs] = useState({})        // prefs[eventType][channel] = bool
  const [optIn, setOptIn] = useState({})        // optIn[channel] = bool
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(null)

  useEffect(() => { if (user && company) load() }, [user?.id, company?.id])

  async function load() {
    setLoading(true)
    const [{ data: rows }, { data: subs }] = await Promise.all([
      supabase.from('notification_preferences').select('event_type, channel, enabled').eq('company_id', company.id),
      supabase.from('notification_subscriptions').select('channel, opt_in, is_active'),
    ])
    const grid = {}
    for (const g of EVENT_GROUPS) for (const et of g.events) {
      grid[et] = {}
      for (const ch of NOTIFICATION_CHANNELS) grid[et][ch] = resolvePref(rows || [], et, ch)
    }
    const oi = {}
    for (const ch of NOTIFICATION_CHANNELS) {
      oi[ch] = (subs || []).some(s => s.channel === ch && s.opt_in && s.is_active)
    }
    setPrefs(grid); setOptIn(oi); setLoading(false)
  }

  async function toggle(et, ch) {
    const cur = prefs[et][ch], next = !cur
    setPrefs(p => ({ ...p, [et]: { ...p[et], [ch]: next } }))
    const { error } = await supabase.rpc('set_notification_preference', {
      p_company_id: company.id, p_event_type: et, p_channel: ch, p_enabled: next,
    })
    if (error) {
      setPrefs(p => ({ ...p, [et]: { ...p[et], [ch]: cur } }))
      toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara')
    }
  }

  async function sendTest(ch) {
    setTesting(ch)
    const { error } = await supabase.rpc('send_test_notification', { p_company_id: company.id, p_channel: ch })
    setTesting(null)
    if (error) return toast.error('Kunde inte skicka testnotis')
    toast.success(ch === 'in_app' ? 'Testnotis skickad – se klockan uppe till höger' : 'Testmail köat – levereras inom kort')
  }

  function Cell({ et, ch }) {
    const enabled = prefs[et]?.[ch] ?? false
    const status = channelStatus({ eventType: et, channel: ch, enabled, hasOptIn: optIn[ch] })
    const meta = STATUS_META[status]
    const locked = status === 'mandatory'
    const unavailable = status === 'provider_missing' || status === 'needs_opt_in'
    return (
      <div className="flex flex-col items-center gap-1">
        {locked
          ? <i className="ti ti-lock text-amber-500 text-lg" title="Obligatorisk – kan inte stängas av" />
          : <Switch on={enabled && !unavailable} disabled={unavailable} onClick={() => toggle(et, ch)} title={meta.label} />}
        <span className={`text-[10px] leading-none ${toneClass[meta.tone]}`}>{meta.label}</span>
      </div>
    )
  }

  const ChannelHeader = () => (
    <div className="grid grid-cols-[1fr_repeat(4,84px)] gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
      <span>Händelse</span>
      {NOTIFICATION_CHANNELS.map(ch => <span key={ch} className="text-center">{CHANNEL_LABELS[ch]}</span>)}
    </div>
  )

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Notiser</span>
        <Link to="/installningar" className="btn"><i className="ti ti-arrow-left" /> Inställningar</Link>
      </div>

      <div className="p-7 max-w-3xl">
        {/* Testnotis + förklaring */}
        <div className="bg-white rounded-xl p-5 mb-6 flex flex-wrap items-center justify-between gap-3" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <div>
            <h2 className="text-sm font-semibold">Skicka testnotis</h2>
            <p className="text-xs text-gray-500 mt-0.5">Verifiera att notiserna kommer fram till dig.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn text-sm" onClick={() => sendTest('in_app')} disabled={testing}>
              <i className="ti ti-bell" /> Testa i appen
            </button>
            <button className="btn text-sm" onClick={() => sendTest('email')} disabled={testing}>
              <i className="ti ti-mail" /> Testa e-post
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-4">
          Välj hur du vill bli notifierad per händelse. <span className="text-amber-600">Obligatoriska</span> säkerhets-
          och systemnotiser kan inte stängas av. SMS och Push kräver att en provider konfigureras och att du aktiverar opt-in.
        </p>

        {loading ? (
          <div className="text-center text-gray-400 py-16 text-sm">Laddar inställningar…</div>
        ) : EVENT_GROUPS.map(group => (
          <div key={group.key} className="bg-white rounded-xl mb-5 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <div className="px-4 py-2.5 bg-gray-50 border-b flex items-center gap-2" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
              <i className={`ti ${group.icon} text-gray-500`} />
              <span className="text-sm font-semibold">{group.label}</span>
            </div>
            <ChannelHeader />
            {group.events.map(et => (
              <div key={et} className="grid grid-cols-[1fr_repeat(4,84px)] gap-2 px-4 py-3 items-center border-b last:border-b-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <i className={`ti ${eventIcon(et)} text-gray-400`} />
                  <span className="text-sm text-gray-800 truncate">{eventLabel(et)}</span>
                </div>
                {NOTIFICATION_CHANNELS.map(ch => <Cell key={ch} et={et} ch={ch} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
