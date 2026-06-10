import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  SUB_STATUSES, BILLING_PERIODS, STATUS_LABELS, PERIOD_LABELS, STATUS_META, TONE_CLASS,
  formatPrice, formatLimit,
} from '../lib/billing'
import UsageOverview from '../components/UsageOverview'
import { stripeCustomerUrl, isValidStripeId, planStripeStatus, stripeConfigSummary } from '../lib/stripeBilling'
import toast from 'react-hot-toast'

const Pill = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.gray}`}>{children}</span>
)
const toDate = ts => ts ? new Date(ts).toISOString().slice(0, 10) : ''
const fromDate = d => d ? new Date(d + 'T00:00:00Z').toISOString() : null
const fmt = ts => ts ? new Date(ts).toLocaleDateString('sv-SE') : '–'
const emptyPlan = () => ({ id: null, name: '', description: '', monthly_price: 0, yearly_price: 0, max_users: '', max_companies: '', max_invoices_per_month: '', max_documents_per_month: '', max_storage_mb: '', max_ai_operations_per_month: '', support_level: 'email', features: '', stripe_product_id: '', stripe_price_monthly: '', stripe_price_yearly: '' })

export default function BillingAdmin() {
  const { platformAccess } = useAuth()
  const canManage = !!platformAccess?.canManageBilling
  const [tab, setTab] = useState('subs')
  const [subs, setSubs] = useState([])
  const [plans, setPlans] = useState([])
  const [sel, setSel] = useState(null)        // admin_get_subscription
  const [dates, setDates] = useState({ trial: '', period: '' })
  const [grace, setGrace] = useState('')        // grace_until (date)
  const [discount, setDiscount] = useState('')  // discount_percent
  const [filters, setFilters] = useState({ status: '', planId: '', search: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [planEdit, setPlanEdit] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.rpc('admin_list_subscriptions', { p_status: filters.status || null, p_plan_id: filters.planId || null, p_search: filters.search || null }),
      supabase.rpc('admin_list_plans'),
    ])
    setSubs(s || []); setPlans(p || []); setLoading(false)
  }, [filters])
  useEffect(() => { if (canManage) load() }, [canManage, load])

  async function openCompany(id) {
    const { data, error } = await supabase.rpc('admin_get_subscription', { p_company_id: id })
    if (error) return toast.error('Kunde inte hämta')
    setSel(data); setDates({ trial: toDate(data.subscription?.trial_ends_at), period: toDate(data.subscription?.current_period_end) })
    setGrace(toDate(data.subscription?.grace_until)); setDiscount(data.subscription?.discount_percent ?? '')
  }
  async function act(rpc, params, okMsg) {
    setBusy(true)
    const { error } = await supabase.rpc(rpc, params)
    setBusy(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades')
    toast.success(okMsg); await load(); if (sel?.company?.id) await openCompany(sel.company.id)
  }
  async function savePlan() {
    const p = planEdit
    if (!p.name.trim()) return toast.error('Ange namn')
    if (!isValidStripeId(p.stripe_product_id, 'prod_')) return toast.error('Stripe product id måste börja med prod_')
    if (!isValidStripeId(p.stripe_price_monthly, 'price_')) return toast.error('Monthly price id måste börja med price_')
    if (!isValidStripeId(p.stripe_price_yearly, 'price_')) return toast.error('Yearly price id måste börja med price_')
    const num = v => v === '' || v === null ? null : Number(v)
    setBusy(true)
    const { error } = await supabase.rpc('admin_upsert_plan', {
      p_id: p.id, p_name: p.name, p_description: p.description || null, p_monthly: Number(p.monthly_price) || 0, p_yearly: Number(p.yearly_price) || 0,
      p_max_users: num(p.max_users), p_max_companies: num(p.max_companies), p_max_invoices: num(p.max_invoices_per_month),
      p_max_documents: num(p.max_documents_per_month), p_max_storage_mb: num(p.max_storage_mb), p_max_ai: num(p.max_ai_operations_per_month),
      p_support_level: p.support_level || null,
      p_features: typeof p.features === 'string' ? p.features.split(',').map(s => s.trim()).filter(Boolean) : (p.features || []),
      p_stripe_product_id: p.stripe_product_id || null, p_stripe_price_monthly: p.stripe_price_monthly || null, p_stripe_price_yearly: p.stripe_price_yearly || null,
    })
    setBusy(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara plan')
    toast.success('Plan sparad'); setPlanEdit(null); await load()
  }

  if (!canManage) return (
    <div className="p-12 text-center">
      <i className="ti ti-lock text-4xl text-gray-300 block mb-3" />
      <div className="text-gray-600 font-medium">Ingen åtkomst</div>
      <div className="text-sm text-gray-400 mt-1">Billing kräver rollen <b>billing_admin</b> eller <b>superadmin</b>.</div>
    </div>
  )
  const activePlans = plans.filter(p => p.is_active)
  const s = sel?.subscription

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-credit-card text-purple-600" /> Billing
          {(() => { const cfg = stripeConfigSummary(plans); return (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.status === 'ready' ? 'bg-green-100 text-green-700' : cfg.status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}
              title="Stripe price-id per plan. Saknas koppling → checkout faller tillbaka till supportärende.">
              <i className="ti ti-brand-stripe" /> {cfg.connected}/{cfg.total} planer kopplade
            </span>) })()}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5 text-sm">
            <button className={`px-3 py-1 rounded-md ${tab === 'subs' ? 'bg-white shadow-sm' : 'text-gray-500'}`} onClick={() => setTab('subs')}>Abonnemang</button>
            <button className={`px-3 py-1 rounded-md ${tab === 'usage' ? 'bg-white shadow-sm' : 'text-gray-500'}`} onClick={() => setTab('usage')}>Plananvändning</button>
            <button className={`px-3 py-1 rounded-md ${tab === 'plans' ? 'bg-white shadow-sm' : 'text-gray-500'}`} onClick={() => setTab('plans')}>Planer</button>
          </div>
          <Link to="/admin" className="btn text-sm"><i className="ti ti-arrow-left" /> Superadmin</Link>
        </div>
      </div>

      {tab === 'subs' && (
        <div className="flex" style={{ minHeight: 'calc(100vh - 56px)' }}>
          <div className="w-[400px] border-r" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            <div className="p-3 border-b space-y-2" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
              <input className="input text-sm" placeholder="Sök företag/org.nr" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <select className="input text-xs py-1" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                  <option value="">Alla statusar</option>{SUB_STATUSES.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                </select>
                <select className="input text-xs py-1" value={filters.planId} onChange={e => setFilters(f => ({ ...f, planId: e.target.value }))}>
                  <option value="">Alla planer</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-y-auto">
              {loading ? <div className="p-6 text-center text-gray-400 text-sm">Laddar…</div>
                : subs.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Inga företag</div>
                : subs.map(r => (
                  <button key={r.company_id} onClick={() => openCompany(r.company_id)}
                    className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 ${sel?.company?.id === r.company_id ? 'bg-blue-50/50' : ''}`} style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{r.company_name}</span>
                      {r.status ? <Pill tone={STATUS_META[r.status]?.tone}>{STATUS_LABELS[r.status]}</Pill> : <span className="text-[11px] text-gray-400">Ingen plan</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{r.plan_name || '–'}{r.billing_period ? ` · ${PERIOD_LABELS[r.billing_period]}` : ''}</div>
                  </button>
                ))}
            </div>
          </div>

          <div className="flex-1 p-6 bg-gray-50">
            {!sel ? <div className="h-full flex items-center justify-center text-gray-400 text-sm">Välj ett företag</div> : (
              <div className="max-w-2xl space-y-4">
                <h1 className="text-lg font-semibold">{sel.company?.name} <span className="text-sm text-gray-400 font-normal">{sel.company?.org_nr}</span></h1>

                <div className="bg-white rounded-xl p-4 grid grid-cols-2 gap-3" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div><label className="block text-[11px] text-gray-500 mb-1">Plan</label>
                    <select className="input text-sm py-1" value={s?.plan_id || ''} disabled={busy}
                      onChange={e => e.target.value && act('admin_set_company_plan', { p_company_id: sel.company.id, p_plan_id: e.target.value, p_billing_period: s?.billing_period || 'monthly' }, 'Plan uppdaterad')}>
                      <option value="">Ingen plan</option>{activePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select></div>
                  <div><label className="block text-[11px] text-gray-500 mb-1">Betalningsperiod</label>
                    <select className="input text-sm py-1" value={s?.billing_period || 'monthly'} disabled={busy || !s?.plan_id}
                      onChange={e => act('admin_set_company_plan', { p_company_id: sel.company.id, p_plan_id: s.plan_id, p_billing_period: e.target.value }, 'Period uppdaterad')}>
                      {BILLING_PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
                    </select></div>
                  <div><label className="block text-[11px] text-gray-500 mb-1">Status</label>
                    <select className="input text-sm py-1" value={s?.status || 'trial'} disabled={busy}
                      onChange={e => act('admin_set_subscription_status', { p_company_id: sel.company.id, p_status: e.target.value }, 'Status uppdaterad')}>
                      {SUB_STATUSES.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                    </select>
                    <span className="text-[10px] text-gray-400">Pausa/avsluta = välj status</span></div>
                </div>

                <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div><label className="block text-[11px] text-gray-500 mb-1">Provperiod slutar</label>
                      <input type="date" className="input text-sm py-1" value={dates.trial} onChange={e => setDates(d => ({ ...d, trial: e.target.value }))} /></div>
                    <div><label className="block text-[11px] text-gray-500 mb-1">Periodens slut</label>
                      <input type="date" className="input text-sm py-1" value={dates.period} onChange={e => setDates(d => ({ ...d, period: e.target.value }))} /></div>
                  </div>
                  <button className="btn text-sm" disabled={busy} onClick={() => act('admin_set_subscription_dates', { p_company_id: sel.company.id, p_trial_ends_at: fromDate(dates.trial), p_current_period_end: fromDate(dates.period) }, 'Datum sparade')}>Spara datum</button>
                </div>

                <div className="bg-white rounded-xl p-4 text-xs text-gray-500" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className="font-semibold text-gray-600 mb-1">Betalning (Stripe)</div>
                  <div>Provider: {s?.payment_provider || '–'} · Betalstatus: {s?.payment_status || '–'} · Nästa debitering: {fmt(s?.next_billing_at)}</div>
                  <div className="mt-1">Kund-ID: {s?.payment_customer_id
                    ? <a href={stripeCustomerUrl(s.payment_customer_id)} target="_blank" rel="noopener" className="text-blue-600 hover:underline">{s.payment_customer_id}</a>
                    : '–'} · Prenumeration: {s?.payment_subscription_id || '–'}</div>
                  <div className="mt-1">Senaste betalning: {fmt(s?.last_payment_at)} · Skapad: {fmt(s?.created_at)} · Pausad: {fmt(s?.suspended_at)} · Avslutad: {fmt(s?.cancelled_at)}</div>
                  <div className="mt-1">Misslyckad betalning: {fmt(s?.last_payment_failed_at)} · Nästa försök: {fmt(s?.next_payment_attempt_at)} · Senaste faktura: {s?.stripe_latest_invoice_id || '–'}</div>
                </div>

                {/* Fas 3: grace period, rabatt, service-state-sync */}
                <div className="bg-white rounded-xl p-4 space-y-3" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                  <div className="text-xs font-semibold text-gray-600 flex items-center justify-between">
                    <span><i className="ti ti-shield-half text-purple-600" /> Tjänst & grace</span>
                    <span className="text-[10px] text-gray-400">Tjänstelås: {sel.company?.service_state || 'active'}{sel.company?.service_state_manual ? ' (manuell)' : ''}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[11px] text-gray-500 mb-1">Grace till</label>
                      <input type="date" className="input text-sm py-1" value={grace} onChange={e => setGrace(e.target.value)} /></div>
                    <div className="flex items-end">
                      <button className="btn text-sm" disabled={busy} onClick={() => act('admin_set_subscription_grace', { p_company_id: sel.company.id, p_grace_until: fromDate(grace) }, 'Grace-period sparad')}>Sätt grace</button></div>
                    <div><label className="block text-[11px] text-gray-500 mb-1">Rabatt (%)</label>
                      <input type="number" min="0" max="100" className="input text-sm py-1" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" /></div>
                    <div className="flex items-end">
                      <button className="btn text-sm" disabled={busy} onClick={() => act('admin_set_subscription_discount', { p_company_id: sel.company.id, p_percent: Number(discount) || 0 }, 'Rabatt sparad')}>Sätt rabatt</button></div>
                  </div>
                  <button className="btn text-sm" disabled={busy} onClick={() => act('admin_sync_service_state', { p_company_id: sel.company.id }, 'Tjänstelås synkat från billing')}>
                    <i className="ti ti-refresh" /> Sync tjänstelås från billing
                  </button>
                  <p className="text-[10px] text-gray-400">Admin-manuell paus/blockering (Företag-vyn) skrivs aldrig över av Stripe. Använd Återaktivera där för att släppa låset.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'usage' && <UsageOverview plans={plans} goToCompany={(id) => { setTab('subs'); openCompany(id) }} />}

      {tab === 'plans' && (
        <div className="p-7 max-w-4xl">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Planer</h2>
            <button className="btn btn-primary text-sm" onClick={() => setPlanEdit(emptyPlan())}><i className="ti ti-plus" /> Ny plan</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map(p => (
              <div key={p.id} className={`bg-white rounded-xl p-4 ${p.is_active ? '' : 'opacity-60'}`} style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">{p.name}</span>
                  {p.is_active ? <Pill tone="green">Aktiv</Pill> : <Pill tone="gray">Inaktiv</Pill>}
                </div>
                <div className="text-xs text-gray-500 mb-1">{p.description}</div>
                {(() => { const st = planStripeStatus(p); return (
                  <div className="text-[10px] mb-1">{st.connected
                    ? <span className="text-green-600"><i className="ti ti-brand-stripe" /> Stripe kopplad{st.monthly ? ' · mån' : ''}{st.yearly ? ' · år' : ''}</span>
                    : <span className="text-gray-400"><i className="ti ti-plug-connected-x" /> Saknar Stripe price-id</span>}</div>) })()}
                <div className="text-sm font-medium">{formatPrice(p.monthly_price)}/mån · {formatPrice(p.yearly_price)}/år</div>
                <div className="text-[11px] text-gray-500 mt-2 space-y-0.5">
                  <div>Användare: {formatLimit(p.max_users)} · Företag: {formatLimit(p.max_companies)}</div>
                  <div>Fakturor/mån: {formatLimit(p.max_invoices_per_month)} · Underlag/mån: {formatLimit(p.max_documents_per_month)}</div>
                  <div>Lagring: {formatLimit(p.max_storage_mb)} MB · AI/mån: {formatLimit(p.max_ai_operations_per_month)}</div>
                  <div>Support: {p.support_level || '–'}</div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="btn text-xs flex-1" onClick={() => setPlanEdit({ ...p, features: (p.features || []).join(', ') })}>Redigera</button>
                  <button className="btn text-xs" disabled={busy} onClick={() => act('admin_set_plan_active', { p_id: p.id, p_active: !p.is_active }, p.is_active ? 'Inaktiverad' : 'Aktiverad')}>{p.is_active ? 'Inaktivera' : 'Aktivera'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {planEdit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPlanEdit(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{planEdit.id ? 'Redigera plan' : 'Ny plan'}</div>
            <div className="p-5 space-y-3">
              {[['name', 'Namn'], ['description', 'Beskrivning']].map(([k, l]) => (
                <div key={k}><label className="block text-xs text-gray-500 mb-1">{l}</label>
                  <input className="input text-sm" value={planEdit[k] || ''} onChange={e => setPlanEdit(p => ({ ...p, [k]: e.target.value }))} /></div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                {[['monthly_price', 'Pris/mån (kr)'], ['yearly_price', 'Pris/år (kr)'], ['max_users', 'Max användare'], ['max_companies', 'Max företag'],
                  ['max_invoices_per_month', 'Max fakturor/mån'], ['max_documents_per_month', 'Max underlag/mån'], ['max_storage_mb', 'Max lagring (MB)'], ['max_ai_operations_per_month', 'Max AI/mån']].map(([k, l]) => (
                  <div key={k}><label className="block text-xs text-gray-500 mb-1">{l}</label>
                    <input type="number" className="input text-sm" value={planEdit[k] ?? ''} onChange={e => setPlanEdit(p => ({ ...p, [k]: e.target.value }))} /></div>
                ))}
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">Supportnivå</label>
                <input className="input text-sm" value={planEdit.support_level || ''} onChange={e => setPlanEdit(p => ({ ...p, support_level: e.target.value }))} /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Funktioner (kommaseparerade)</label>
                <input className="input text-sm" value={planEdit.features || ''} onChange={e => setPlanEdit(p => ({ ...p, features: e.target.value }))} /></div>

              <div className="border-t pt-3 mt-1" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                <div className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1"><i className="ti ti-brand-stripe text-purple-600" /> Stripe-koppling</div>
                <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                  1. Skapa en produkt i Stripe. 2. Skapa två återkommande priser (månad + år). 3. Kopiera respektive
                  <code className="bg-gray-100 px-1 rounded">price_…</code>-id och klistra in nedan. Lämna tomt tills Stripe är aktiverat.
                </p>
                {[['stripe_product_id', 'Produkt-id (prod_…)', 'prod_…'], ['stripe_price_monthly', 'Pris-id månad (price_…)', 'price_…'], ['stripe_price_yearly', 'Pris-id år (price_…)', 'price_…']].map(([k, l, ph]) => (
                  <div key={k} className="mb-2"><label className="block text-[11px] text-gray-500 mb-0.5">{l}</label>
                    <input className="input text-sm font-mono" placeholder={ph} value={planEdit[k] || ''} onChange={e => setPlanEdit(p => ({ ...p, [k]: e.target.value.trim() }))} /></div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setPlanEdit(null)}>Avbryt</button>
              <button className="btn btn-primary" disabled={busy} onClick={savePlan}>Spara</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
