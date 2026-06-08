import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  CUSTOMER_STATUS_LABELS, customerStatusLabel, STATUS_META, TONE_CLASS, PERIOD_LABELS,
  formatPrice, formatLimit, isWarningStatus,
} from '../lib/billing'
import {
  METRIC_LABEL, STATUS_META as LIMIT_STATUS_META, BAR_CLASS, TEXT_CLASS, hasWarnings, worstStatus,
} from '../lib/planLimits'
import toast from 'react-hot-toast'

const Pill = ({ tone, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASS[tone] || TONE_CLASS.gray}`}>{children}</span>
)
const fmt = ts => ts ? new Date(ts).toLocaleDateString('sv-SE') : '–'

export default function Abonnemang() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [limits, setLimits] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])
  async function load() {
    setLoading(true)
    const [{ data: d, error }, { data: lim }] = await Promise.all([
      supabase.rpc('my_subscription', { p_company_id: company.id }),
      supabase.rpc('check_all_plan_limits', { p_company_id: company.id }),
    ])
    if (error) toast.error('Kunde inte ladda abonnemang'); else setData(d)
    setLimits(lim || [])
    setLoading(false)
  }
  async function requestChange(planId, planName) {
    if (!confirm(`Skicka en begäran om att byta till ${planName}? BokPilot kontaktar dig.`)) return
    setBusy(true)
    const { data: ticketId, error } = await supabase.rpc('request_subscription_change', { p_company_id: company.id, p_desired_plan_id: planId, p_message: '' })
    setBusy(false)
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skicka begäran')
    toast.success('Begäran skickad – du hittar den under Support')
    if (ticketId) navigate(`/support/${ticketId}`)
  }

  const sub = data?.subscription, plan = data?.plan
  const status = sub?.status
  const limitWarn = worstStatus(limits)

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Abonnemang</span>
        <Link to="/installningar" className="btn"><i className="ti ti-arrow-left" /> Inställningar</Link>
      </div>

      <div className="p-7 max-w-3xl space-y-5">
        {loading ? <div className="text-center text-gray-400 py-16 text-sm">Laddar…</div> : (
          <>
            {/* Varning vid kritisk status */}
            {isWarningStatus(status) && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <i className="ti ti-alert-triangle text-red-600 text-xl mt-0.5" />
                <div className="text-sm text-red-700">
                  <div className="font-medium">{customerStatusLabel(status)}</div>
                  <div className="text-red-600/90 mt-0.5">
                    {status === 'past_due' && 'Ditt abonnemang har en obetald avgift. Kontakta oss för att åtgärda.'}
                    {status === 'suspended' && 'Ditt abonnemang är avstängt. Kontakta oss för att återaktivera.'}
                    {status === 'expired' && 'Ditt abonnemang har gått ut. Välj en plan för att fortsätta.'}
                  </div>
                  <Link to="/support" className="text-red-700 underline text-xs mt-1 inline-block">Kontakta BokPilot</Link>
                </div>
              </div>
            )}

            {/* Nuvarande plan */}
            <div className="bg-white rounded-xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Nuvarande plan</div>
                  <h2 className="text-xl font-semibold">{plan?.name || 'Ingen plan vald'}</h2>
                  {plan?.description && <div className="text-sm text-gray-500">{plan.description}</div>}
                </div>
                {status && <Pill tone={STATUS_META[status]?.tone}>{customerStatusLabel(status)}</Pill>}
              </div>
              {plan && (
                <div className="text-sm text-gray-700">{formatPrice(plan.monthly_price)}/mån · {formatPrice(plan.yearly_price)}/år</div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm mt-3">
                <div><span className="text-gray-400 text-xs block">Betalningsperiod</span>{sub ? PERIOD_LABELS[sub.billing_period] : '–'}</div>
                <div><span className="text-gray-400 text-xs block">Supportnivå</span>{plan?.support_level || '–'}</div>
                {sub?.trial_ends_at && <div><span className="text-gray-400 text-xs block">Testperiod slutar</span>{fmt(sub.trial_ends_at)}</div>}
                <div><span className="text-gray-400 text-xs block">Period slutar</span>{fmt(sub?.current_period_end)}</div>
              </div>
            </div>

            {/* Plangräns-varning */}
            {hasWarnings(limits) && (
              <div className={`rounded-xl p-4 flex items-start gap-3 ${limitWarn === 'exceeded' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                <i className={`ti ti-gauge text-xl mt-0.5 ${limitWarn === 'exceeded' ? 'text-red-600' : 'text-amber-600'}`} />
                <div className="text-sm">
                  <div className={`font-medium ${limitWarn === 'exceeded' ? 'text-red-700' : 'text-amber-700'}`}>
                    {limitWarn === 'exceeded' ? 'Du har nått en eller flera plangränser' : 'Du närmar dig en eller flera plangränser'}
                  </div>
                  <div className="text-gray-600 mt-0.5">Dina bokföringsfunktioner fungerar som vanligt. Uppgradera för att höja gränserna.</div>
                </div>
              </div>
            )}

            {/* Limits + usage med progress bars */}
            <div className="bg-white rounded-xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <h3 className="text-sm font-semibold mb-3">Användning &amp; gränser</h3>
              <div className="space-y-3">
                {limits.map(l => {
                  const meta = LIMIT_STATUS_META[l.status] || LIMIT_STATUS_META.unlimited
                  const pct = l.status === 'unlimited' ? 0 : Math.min(100, l.percentUsed || 0)
                  return (
                    <div key={l.metric}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-600">{METRIC_LABEL[l.metric] || l.metric}</span>
                        <span className={`tabular-nums text-xs ${TEXT_CLASS[meta.tone]}`}>
                          {Number(l.used).toLocaleString('sv-SE')} / {l.limit === null ? 'Obegränsat' : Number(l.limit).toLocaleString('sv-SE')}
                          {l.status !== 'unlimited' && l.status !== 'ok' && ` · ${meta.label}`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${BAR_CLASS[meta.tone]}`} style={{ width: `${l.status === 'unlimited' ? 0 : pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Mjuka gränser – dina bokföringsfunktioner stängs inte av. Vid behov, begär uppgradering nedan.</p>
            </div>

            {/* Tillgängliga planer + uppgraderingsbegäran */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-gray-700">Tillgängliga planer</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(data?.plans || []).map(p => {
                  const current = plan && p.id === plan.id
                  return (
                    <div key={p.id} className={`bg-white rounded-xl p-4 ${current ? 'ring-2 ring-blue-500' : ''}`} style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-gray-500 mb-2 min-h-[32px]">{p.description}</div>
                      <div className="text-sm font-medium">{formatPrice(p.monthly_price)}<span className="text-gray-400 text-xs">/mån</span></div>
                      <ul className="text-[11px] text-gray-500 mt-2 space-y-0.5 min-h-[60px]">
                        {(p.features || []).slice(0, 4).map((f, i) => <li key={i}><i className="ti ti-check text-green-600" /> {f}</li>)}
                      </ul>
                      {current
                        ? <div className="text-center text-xs text-blue-600 font-medium py-2">Nuvarande plan</div>
                        : <button className="btn btn-primary w-full text-sm mt-2" disabled={busy} onClick={() => requestChange(p.id, p.name)}>Begär uppgradering</button>}
                    </div>
                  )
                })}
              </div>
              <div className="text-sm text-gray-500 mt-4">
                Har du frågor om ditt abonnemang? <Link to="/support" className="text-blue-700 hover:underline">Kontakta BokPilot</Link>.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
