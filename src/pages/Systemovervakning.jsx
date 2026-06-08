import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  WORKER_COMPONENTS, componentLabel, STATUS_META, SEVERITY_META, TONE_CLASS,
  computeWorkerStatus, filterSystemErrors, formatAge, formatTime,
} from '../lib/systemStatus'
import toast from 'react-hot-toast'

const Pill = ({ tone, icon, children }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.gray}`}>
    {icon && <i className={`ti ${icon}`} />}{children}
  </span>
)

const Stat = ({ label, value, tone = 'gray', sub }) => (
  <div className="bg-white rounded-xl px-4 py-3 min-w-[120px]" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
    <div className={`text-2xl font-semibold ${tone === 'red' && value > 0 ? 'text-red-600' : tone === 'amber' && value > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{value}</div>
    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
  </div>
)

export default function Systemovervakning() {
  const { isAdmin } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [filters, setFilters] = useState({ component: '', severity: '', ack: '' })

  useEffect(() => { if (isAdmin) load() }, [isAdmin])
  async function load() {
    setLoading(true); setError(null)
    const { data: res, error: err } = await supabase.rpc('admin_system_overview')
    if (err) setError(err.message); else setData(res)
    setLoading(false)
  }
  async function action(rpc, params, okMsg) {
    setBusy(JSON.stringify(params))
    const { error: err } = await supabase.rpc(rpc, params)
    setBusy(null)
    if (err) return toast.error(err.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades')
    toast.success(okMsg); await load()
  }

  if (!isAdmin) return <div className="p-12 text-center text-gray-400">Ingen åtkomst.</div>

  const q = data?.queue || {}
  const errors = filterSystemErrors(data?.systemErrors, filters)
  const deliveries = data?.failedDeliveries || []
  const workers = (data?.workers || [])

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-activity-heartbeat text-purple-600" /> Systemövervakning</span>
        <div className="flex items-center gap-3">
          {data?.generatedAt && <span className="text-xs text-gray-400">Uppdaterad {formatTime(data.generatedAt)}</span>}
          <button className="btn text-sm" onClick={load} disabled={loading}><i className={`ti ti-refresh ${loading ? 'animate-spin' : ''}`} /> Uppdatera</button>
          <Link to="/admin" className="btn text-sm"><i className="ti ti-arrow-left" /> Superadmin</Link>
        </div>
      </div>

      <div className="p-7 space-y-7">
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">Kunde inte ladda: {error}</div>
        ) : loading && !data ? (
          <div className="text-center text-gray-400 py-16 text-sm">Laddar systemstatus…</div>
        ) : (
          <>
            {/* Worker health */}
            <section>
              <h2 className="text-sm font-semibold mb-3 text-gray-700">Worker health</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {WORKER_COMPONENTS.map(c => {
                  const w = workers.find(x => x.component === c.key) || { component: c.key, has_record: false, consecutive_failures: 0 }
                  const status = computeWorkerStatus(w)
                  const sm = STATUS_META[status]
                  return (
                    <div key={c.key} className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-2 text-sm font-medium"><i className={`ti ${c.icon} text-gray-500`} /> {c.label}</span>
                        <Pill tone={sm.tone} icon={sm.icon}>{sm.label}</Pill>
                      </div>
                      <div className="text-[11px] text-gray-400 mb-2">{c.mode}</div>
                      <dl className="text-xs text-gray-600 space-y-1">
                        <div className="flex justify-between"><dt className="text-gray-400">Senaste success</dt><dd>{formatTime(w.last_success_at)}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-400">Senaste fel</dt><dd>{formatTime(w.last_failure_at)}</dd></div>
                        <div className="flex justify-between"><dt className="text-gray-400">Consecutive failures</dt><dd className={w.consecutive_failures > 0 ? 'text-red-600 font-medium' : ''}>{w.consecutive_failures || 0}</dd></div>
                        {w.last_severity && <div className="flex justify-between"><dt className="text-gray-400">Senaste severity</dt><dd>{SEVERITY_META[w.last_severity]?.label || w.last_severity}</dd></div>}
                      </dl>
                      {w.last_error && <div className="mt-2 text-[11px] text-red-600 bg-red-50 rounded px-2 py-1 truncate" title={w.last_error}>{w.last_error}</div>}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Notification queue summary */}
            <section>
              <h2 className="text-sm font-semibold mb-3 text-gray-700">Notification queue (e-post)</h2>
              <div className="flex flex-wrap gap-3">
                <Stat label="Pending" value={q.pending || 0} tone="amber" />
                <Stat label="Processing" value={q.processing || 0} />
                <Stat label="Skickade idag" value={q.sent_today || 0} />
                <Stat label="Failed" value={q.failed || 0} tone="red" />
                <Stat label="Skipped" value={q.skipped || 0} />
                <Stat label="Cancelled" value={q.cancelled || 0} />
                <Stat label="Retries schemalagda" value={q.retries_scheduled || 0} tone="amber" />
                <Stat label="Äldsta pending" value={q.pending ? formatAge(q.oldest_pending_age_seconds) : '–'} />
              </div>
            </section>

            {/* System errors */}
            <section>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-sm font-semibold text-gray-700">System errors <span className="text-gray-400 font-normal">({errors.length})</span></h2>
                <div className="flex gap-2">
                  <select className="input text-xs py-1" value={filters.component} onChange={e => setFilters(f => ({ ...f, component: e.target.value }))}>
                    <option value="">Alla komponenter</option>
                    {WORKER_COMPONENTS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select className="input text-xs py-1" value={filters.severity} onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}>
                    <option value="">Alla severity</option>
                    <option value="warning">Varning</option><option value="error">Fel</option><option value="critical">Kritisk</option>
                  </select>
                  <select className="input text-xs py-1" value={filters.ack} onChange={e => setFilters(f => ({ ...f, ack: e.target.value }))}>
                    <option value="">Alla</option><option value="unack">Ej kvitterade</option><option value="ack">Kvitterade</option>
                  </select>
                </div>
              </div>
              <div className="bg-white rounded-xl overflow-hidden overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                    {['Tid', 'Komponent', 'Severity', 'Felkod', 'Meddelande', 'E-post', 'Status', ''].map((h, i) =>
                      <th key={i} className="text-left px-3 py-2 border-b whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {errors.length === 0 ? <tr><td colSpan="8" className="text-center py-8 text-gray-400">Inga system errors</td></tr>
                      : errors.map(e => {
                        const sev = SEVERITY_META[e.severity] || { label: e.severity, tone: 'gray' }
                        return (
                          <tr key={e.id} className="border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap" title={e.created_at}>{formatTime(e.created_at)}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{componentLabel(e.component)}</td>
                            <td className="px-3 py-2"><Pill tone={sev.tone}>{sev.label}</Pill></td>
                            <td className="px-3 py-2 font-mono text-[11px] text-gray-600 whitespace-nowrap">{e.error_code}</td>
                            <td className="px-3 py-2 text-gray-700 max-w-[280px] truncate" title={e.message}>{e.message}</td>
                            <td className="px-3 py-2">{e.has_email_queue ? <i className="ti ti-mail text-blue-600" title="E-post till admins köad" /> : <span className="text-gray-300">–</span>}</td>
                            <td className="px-3 py-2">{e.acknowledged ? <Pill tone="green" icon="ti-check">Kvitterad</Pill> : <span className="text-gray-400">Öppen</span>}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {!e.acknowledged && <button className="btn text-[11px] py-0.5 px-2" disabled={busy} onClick={() => action('admin_acknowledge_system_error', { p_event_id: e.id }, 'Kvitterad')}>Kvittera</button>}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Failed email deliveries */}
            <section>
              <h2 className="text-sm font-semibold mb-3 text-gray-700">E-postleveranser med fel <span className="text-gray-400 font-normal">({deliveries.length})</span></h2>
              <div className="bg-white rounded-xl overflow-hidden overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                    {['Mottagare', 'Ämne', 'Orsak', 'Försök', 'Nästa retry', 'Status', ''].map((h, i) =>
                      <th key={i} className="text-left px-3 py-2 border-b whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {deliveries.length === 0 ? <tr><td colSpan="7" className="text-center py-8 text-gray-400">Inga leveransfel</td></tr>
                      : deliveries.map(d => (
                        <tr key={d.queue_id} className="border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                          <td className="px-3 py-2 whitespace-nowrap">{d.recipient || '–'}</td>
                          <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={d.subject}>{d.subject}</td>
                          <td className="px-3 py-2 text-red-600 max-w-[220px] truncate" title={d.failure_reason}>{d.failure_reason || '–'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{d.attempt_count}/{d.max_attempts}</td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{d.next_retry_at ? formatTime(d.next_retry_at) : '–'}</td>
                          <td className="px-3 py-2"><Pill tone={d.status === 'failed' ? 'red' : 'amber'}>{d.status}</Pill></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button className="btn text-[11px] py-0.5 px-2 mr-1" disabled={busy} onClick={() => action('admin_retry_notification', { p_queue_id: d.queue_id }, 'Köad för nytt försök')}>Retry</button>
                            <button className="btn btn-danger text-[11px] py-0.5 px-2" disabled={busy} onClick={() => action('admin_cancel_notification', { p_queue_id: d.queue_id }, 'Avbruten')}>Avbryt</button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
