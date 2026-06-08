import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  METRIC_LABEL, STATUS_META, BAR_CLASS, TEXT_CLASS, USAGE_SORT_OPTIONS, OVERALL_STATUS_FILTERS,
} from '../lib/planLimits'
import { STATUS_LABELS as SUB_STATUS_LABELS, TONE_CLASS } from '../lib/billing'
import toast from 'react-hot-toast'

const Pill = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.gray}`}>{children}</span>
)
const fmt = ts => ts ? new Date(ts).toLocaleDateString('sv-SE') : '–'

export default function UsageOverview({ plans, goToCompany }) {
  const [filters, setFilters] = useState({ status: '', planId: '', sort: 'percent_desc', search: '' })
  const [data, setData] = useState({ total: 0, rows: [] })
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [suggest, setSuggest] = useState({ planId: '', message: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const { data: d, error } = await supabase.rpc('admin_plan_usage_overview', {
      p_search: filters.search || null, p_plan_id: filters.planId || null, p_status: filters.status || null,
      p_sort: filters.sort, p_limit: 100, p_offset: 0,
    })
    if (error) toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ladda'); else setData(d || { total: 0, rows: [] })
    setLoading(false)
  }, [filters])
  useEffect(() => { load() }, [load])

  async function openDetail(id) {
    const { data, error } = await supabase.rpc('admin_company_usage_detail', { p_company_id: id })
    if (error) return toast.error('Kunde inte hämta detaljer')
    setDetail(data); setSuggest({ planId: '', message: '' })
  }
  async function sendSuggestion() {
    if (!suggest.planId) return toast.error('Välj en plan att föreslå')
    setBusy(true)
    const { error } = await supabase.rpc('admin_send_upgrade_suggestion', { p_company_id: detail.company.id, p_plan_id: suggest.planId, p_message: suggest.message })
    setBusy(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skicka')
    toast.success('Uppgraderingsförslag skickat'); setSuggest({ planId: '', message: '' })
  }

  return (
    <div className="p-7">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input className="input text-sm max-w-xs" placeholder="Sök företag/org.nr" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
        <select className="input text-sm py-1" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          {OVERALL_STATUS_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label === 'Alla' ? 'Alla statusar' : o.label}</option>)}
        </select>
        <select className="input text-sm py-1" value={filters.planId} onChange={e => setFilters(f => ({ ...f, planId: e.target.value }))}>
          <option value="">Alla planer</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input text-sm py-1" value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))}>
          {USAGE_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{data.total} företag</span>
      </div>

      <div className="bg-white rounded-xl overflow-hidden overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
            {['Företag', 'Plan', 'Status', 'Risk', 'Förbrukning', 'Överskridna', 'Senaste aktivitet', ''].map((h, i) =>
              <th key={i} className="text-left px-3 py-2 border-b whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="8" className="text-center py-8 text-gray-400">Laddar…</td></tr>
              : data.rows.length === 0 ? <tr><td colSpan="8" className="text-center py-8 text-gray-400">Inga företag</td></tr>
              : data.rows.map(r => {
                const meta = STATUS_META[r.overall] || STATUS_META.ok
                return (
                  <tr key={r.company_id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" style={{ borderColor: 'rgba(0,0,0,0.05)' }} onClick={() => openDetail(r.company_id)}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.company_name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.plan_name || '–'}</td>
                    <td className="px-3 py-2">{r.sub_status ? <Pill tone="gray">{SUB_STATUS_LABELS[r.sub_status] || r.sub_status}</Pill> : '–'}</td>
                    <td className="px-3 py-2"><span className={`text-xs font-medium ${TEXT_CLASS[meta.tone]}`}>{meta.label}</span></td>
                    <td className="px-3 py-2 w-40">
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${BAR_CLASS[meta.tone]}`} style={{ width: `${Math.min(100, r.max_pct || 0)}%` }} /></div>
                      <span className="text-[10px] text-gray-400">{r.max_pct || 0}%</span>
                    </td>
                    <td className="px-3 py-2 text-center">{r.exceeded_count > 0 ? <span className="text-red-600 font-medium">{r.exceeded_count}</span> : <span className="text-gray-300">0</span>}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmt(r.last_activity)}</td>
                    <td className="px-3 py-2 text-right"><i className="ti ti-chevron-right text-gray-400" /></td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Detalj-drawer */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between sticky top-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="font-medium">{detail.company?.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setDetail(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-500">
                {detail.plan?.name || 'Ingen plan'} · {detail.subscription?.status ? (SUB_STATUS_LABELS[detail.subscription.status] || detail.subscription.status) : '–'}
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Förbrukning</div>
                <div className="space-y-2">
                  {(detail.limits || []).map(l => {
                    const meta = STATUS_META[l.status] || STATUS_META.unlimited
                    return (
                      <div key={l.metric}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-gray-600">{METRIC_LABEL[l.metric] || l.metric}</span>
                          <span className={TEXT_CLASS[meta.tone]}>{l.used} / {l.limit === null ? '∞' : l.limit}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${BAR_CLASS[meta.tone]}`} style={{ width: `${l.status === 'unlimited' ? 0 : Math.min(100, l.percentUsed || 0)}%` }} /></div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Senaste varningar</div>
                {(detail.recent_alerts || []).length === 0 ? <div className="text-xs text-gray-400">Inga</div>
                  : <ul className="text-xs text-gray-600 space-y-0.5">{detail.recent_alerts.map((a, i) => <li key={i}>{fmt(a.created_at)} · {a.metric} ({a.used}/{a.lim}) {a.event_type === 'plan_limit_exceeded' ? '⛔' : '⚠️'}</li>)}</ul>}
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Billing-ärenden</div>
                {(detail.billing_tickets || []).length === 0 ? <div className="text-xs text-gray-400">Inga</div>
                  : <ul className="text-xs text-gray-600 space-y-0.5">{detail.billing_tickets.map(t => <li key={t.id}>{fmt(t.created_at)} · {t.subject} ({t.status})</li>)}</ul>}
              </div>

              {/* Skicka uppgraderingsförslag */}
              <div className="border-t pt-3" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Skicka uppgraderingsförslag</div>
                <select className="input text-sm mb-2" value={suggest.planId} onChange={e => setSuggest(s => ({ ...s, planId: e.target.value }))}>
                  <option value="">Välj plan…</option>{plans.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <textarea className="input text-sm mb-2" rows={2} placeholder="Valfritt meddelande till kunden" value={suggest.message} onChange={e => setSuggest(s => ({ ...s, message: e.target.value }))} />
                <div className="flex gap-2">
                  <button className="btn btn-primary text-sm flex-1" disabled={busy} onClick={sendSuggestion}><i className="ti ti-send" /> Skicka förslag</button>
                  <button className="btn text-sm" onClick={() => goToCompany(detail.company.id)}>Ändra plan</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
