import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { computeBillingMetrics, summarizeWorkerHealth, countOpenTickets, fmtSek } from '../lib/adminMetrics'
import { STATUS_META, TONE_CLASS } from '../lib/systemStatus'

// Control Center-dashboard. Komponerar BEFINTLIGA admin-RPC:er (inga nya datamodeller):
//   admin_list_subscriptions + subscription_plans (RLS-katalog) → billing-nyckeltal
//   admin_system_overview → worker health + kö
//   list_support_tickets → öppna ärenden
// Varje sektion laddas oberoende och visar ärlig status om en RPC inte är åtkomlig för rollen.

const Card = ({ label, value, sub, tone = 'gray' }) => (
  <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
    <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-gray-900'}`}>{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
)

const Section = ({ title, children, error }) => (
  <section className="mb-7">
    <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
    {error ? <div className="bg-white rounded-xl p-4 text-sm text-gray-400" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}><i className="ti ti-lock mr-1" />{error}</div> : children}
  </section>
)

export default function ControlCenter({ access }) {
  const [billing, setBilling] = useState({ loading: true, data: null, error: null })
  const [system, setSystem] = useState({ loading: true, data: null, error: null })
  const [support, setSupport] = useState({ loading: true, count: null, error: null })

  useEffect(() => {
    let active = true
    ;(async () => {
      if (access.canViewBilling || access.isSuperadmin) {
        const [{ data: subs, error: e1 }, { data: plans }] = await Promise.all([
          supabase.rpc('admin_list_subscriptions', { p_status: null, p_plan_id: null, p_search: null }),
          supabase.from('subscription_plans').select('id, name, monthly_price, yearly_price'),
        ])
        if (active) setBilling(e1 ? { loading: false, data: null, error: 'Ingen billing-åtkomst' } : { loading: false, data: computeBillingMetrics(subs || [], plans || []), error: null })
      } else if (active) setBilling({ loading: false, data: null, error: 'Kräver billing- eller read-only-roll' })
    })()
    ;(async () => {
      if (access.canViewOperations || access.isSuperadmin) {
        const { data, error } = await supabase.rpc('admin_system_overview')
        if (active) setSystem(error ? { loading: false, data: null, error: 'Ingen drift-åtkomst' } : { loading: false, data, error: null })
      } else if (active) setSystem({ loading: false, data: null, error: 'Kräver operations- eller read-only-roll' })
    })()
    ;(async () => {
      if (access.canViewSupport || access.isSuperadmin) {
        const { data, error } = await supabase.rpc('list_support_tickets', { p_status: null, p_priority: null, p_assigned_admin_id: null, p_search: null })
        if (active) setSupport(error ? { loading: false, count: null, error: 'Ingen support-åtkomst' } : { loading: false, count: countOpenTickets(data || []), error: null })
      } else if (active) setSupport({ loading: false, count: null, error: 'Kräver support- eller read-only-roll' })
    })()
    return () => { active = false }
  }, [access])

  const b = billing.data
  const health = system.data ? summarizeWorkerHealth(system.data.workers || []) : null
  const q = system.data?.queue || {}

  return (
    <div className="p-7 max-w-[1400px]">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Control Center</h1>
          <p className="text-sm text-gray-400">Översikt över BokPilot-plattformen{access.isReadOnly ? ' · läsläge' : ''}.</p>
        </div>
      </div>

      <Section title="Företag & abonnemang" error={billing.error}>
        {billing.loading ? <Skeleton /> : b && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card label="Företag totalt" value={b.totalCompanies} sub={`${b.companiesWithSub} med abonnemang`} />
            <Card label="Aktiva" value={b.activeCompanies} />
            <Card label="Trial" value={b.trial} />
            <Card label="Past due" value={b.pastDue} tone={b.pastDue ? 'amber' : 'gray'} />
            <Card label="Misslyckade bet." value={b.failedPayments} tone={b.failedPayments ? 'red' : 'gray'} />
            <Card label="Pausade/blockerade" value={b.paused} tone={b.paused ? 'red' : 'gray'} />
            <Card label="Avslutade" value={b.cancelled + b.expired} />
          </div>
        )}
      </Section>

      <Section title="Intäkter (MRR/ARR)" error={billing.error}>
        {billing.loading ? <Skeleton /> : b && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="MRR" value={fmtSek(b.mrr)} sub="aktiva abonnemang" />
            <Card label="ARR" value={fmtSek(b.arr)} />
            <Card label="ARPC" value={fmtSek(b.arpc)} sub="snitt per aktivt företag" />
            <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Intäkt per plan</div>
              {Object.keys(b.revenueByPlan).length === 0 ? <div className="text-xs text-gray-400">Inga aktiva abonnemang</div> :
                Object.entries(b.revenueByPlan).map(([plan, v]) => (
                  <div key={plan} className="flex justify-between text-sm py-0.5"><span className="text-gray-600">{plan}</span><span className="tabular-nums font-medium">{fmtSek(v)}</span></div>
                ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-2">Churn, trial conversion och health score levereras i Fas 7.</p>
      </Section>

      <Section title="Systemhälsa" error={system.error}>
        {system.loading ? <Skeleton /> : health && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <Card label="Friska jobb" value={`${health.counts.healthy}/${health.total}`} tone={health.worst === 'healthy' ? 'gray' : 'gray'} />
              <Card label="Varningar" value={health.counts.warning} tone={health.counts.warning ? 'amber' : 'gray'} />
              <Card label="Fel" value={health.counts.failing} tone={health.counts.failing ? 'red' : 'gray'} />
              <Card label="Kö: pending / failed" value={`${q.pending ?? 0} / ${q.failed ?? 0}`} tone={(q.failed || 0) > 0 ? 'red' : 'gray'} />
            </div>
            <div className="bg-white rounded-xl p-4 flex flex-wrap gap-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              {health.perComponent.map(c => {
                const m = STATUS_META[c.status]
                return <span key={c.key} className={`text-xs px-2 py-1 rounded ${TONE_CLASS[m.tone]}`} title={m.label}><i className={`ti ${m.icon} mr-1`} />{c.label}</span>
              })}
            </div>
          </>
        )}
      </Section>

      <Section title="Support" error={support.error}>
        {support.loading ? <Skeleton /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Öppna ärenden" value={support.count ?? 0} tone={(support.count || 0) > 0 ? 'amber' : 'gray'} />
          </div>
        )}
      </Section>
    </div>
  )
}

const Skeleton = () => <div className="h-20 bg-white rounded-xl animate-pulse" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }} />
