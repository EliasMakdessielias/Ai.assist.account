import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import {
  FEATURE_KEY, NOT_LICENSED_MESSAGE, AI_WARNING, ENGAGEMENT_STATUS_META, RISK_META, CHECK_STATUS_META,
  isOpenCheck, groupByCategory, categoryLabel, fiscalYearLabel, fmtAmount,
} from '../lib/bokslut'

const fmt = ts => { try { return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '–' } }
const Chip = ({ meta }) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta?.chip || 'bg-gray-100 text-gray-500'}`}>{meta?.label || '—'}</span>
const RiskChip = ({ r }) => { const m = RISK_META[r]; return <span className="inline-flex items-center gap-1 text-[12px] font-medium"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: m?.dot }} />{m?.label || r}</span> }

function Stat({ label, value, tone = 'gray' }) {
  const tones = { red: 'text-red-600', orange: 'text-orange-600', gray: 'text-gray-800' }
  return (
    <div className="bg-white rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${tones[tone]}`}>{value}</div>
    </div>
  )
}

// Platshållarkort för Steg 2 (layouten är komplett; funktionerna byggs additivt).
function ComingCard({ icon, title, text }) {
  return (
    <div className="bg-white rounded-xl p-4 opacity-80" style={{ border: '0.5px dashed rgba(0,0,0,0.18)' }}>
      <div className="flex items-center gap-2 mb-1"><i className={`ti ${icon} text-purple-600`} /><span className="text-sm font-medium">{title}</span><span className="ml-auto text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">Kommer i nästa steg</span></div>
      <div className="text-[12px] text-gray-500 leading-snug">{text}</div>
    </div>
  )
}

export default function AiBokslut() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [licensed, setLicensed] = useState(null)
  const [years, setYears] = useState([])
  const [fyId, setFyId] = useState('')
  const [engagement, setEngagement] = useState(null)
  const [checks, setChecks] = useState([])
  const [audit, setAudit] = useState([])
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState(null)
  const [perms, setPerms] = useState({})

  useEffect(() => {
    if (!company?.id) return
    setLicensed(null)
    supabase.rpc('has_ai_feature', { p_company: company.id, p_key: FEATURE_KEY }).then(({ data }) => setLicensed(!!data))
    supabase.rpc('bokslut_my_permissions', { p_company: company.id }).then(({ data }) => setPerms(data || {}))
    supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false }).then(({ data }) => {
      setYears(data || [])
      const active = (data || []).find(y => y.status === 'active') || (data || [])[0]
      setFyId(prev => prev || active?.id || '')
    })
  }, [company?.id])

  const loadEngagement = useCallback(async () => {
    if (!company?.id || !fyId || !licensed) return
    const { data: eng, error } = await supabase.rpc('bokslut_get_or_create', { p_company: company.id, p_fiscal_year_id: fyId })
    if (error) { toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte öppna engagemang'); return }
    setEngagement(eng)
    const [{ data: ch }, { data: au }] = await Promise.all([
      supabase.from('bokslut_checks').select('*').eq('engagement_id', eng.id),
      supabase.from('bokslut_audit_log').select('*').eq('engagement_id', eng.id).order('created_at', { ascending: false }).limit(15),
    ])
    setChecks(ch || []); setAudit(au || [])
  }, [company?.id, fyId, licensed])
  useEffect(() => { loadEngagement() }, [loadEngagement])

  useEffect(() => {
    if (!engagement?.id) return
    const ch = supabase.channel(`bokslut-${engagement.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bokslut_checks', filter: `engagement_id=eq.${engagement.id}` }, loadEngagement)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [engagement?.id, loadEngagement])

  async function runAnalysis() {
    if (!engagement) return
    setRunning(true)
    try { await supabase.rpc('run_bokslut_analysis', { p_engagement: engagement.id }); toast.success('Analys körd'); await loadEngagement() }
    catch (e) { toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Analysen misslyckades') }
    setRunning(false)
  }

  const fy = years.find(y => y.id === fyId)
  const openChecks = useMemo(() => checks.filter(c => isOpenCheck(c.status)), [checks])
  const groups = useMemo(() => groupByCategory(checks), [checks])

  if (licensed === false) {
    return (
      <div className="p-6 max-w-[1100px]">
        <div className="text-[15px] font-bold tracking-tight mb-4 flex items-center gap-2"><i className="ti ti-report-analytics text-purple-600" /> AI BOKSLUT & ÅRSREDOVISNING</div>
        <div className="bg-white rounded-xl p-8 text-center" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <i className="ti ti-lock text-4xl text-gray-300 block mb-2" />
          <div className="text-sm text-gray-700 mb-1">{NOT_LICENSED_MESSAGE}</div>
          <div className="text-xs text-gray-400">Kontakta BokPilot för att lägga till AI Bokslut & Årsredovisning i din plan.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <span className="text-[15px] font-bold tracking-tight flex items-center gap-2"><i className="ti ti-report-analytics text-purple-600" /> AI BOKSLUT & ÅRSREDOVISNING</span>
        <span className="text-[11px] bg-purple-50 text-purple-700 rounded-full px-2 py-0.5">AI-paket</span>
        {engagement && <Chip meta={ENGAGEMENT_STATUS_META[engagement.status]} />}
        <select className="input w-auto text-sm" value={fyId} onChange={e => { setFyId(e.target.value); setEngagement(null); setChecks([]) }}>
          {years.map(y => <option key={y.id} value={y.id}>{fiscalYearLabel(y)}</option>)}
        </select>
        <span className="text-[12px] text-gray-400">Regelverk: <b className="text-gray-600">K2</b></span>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-primary font-medium" onClick={runAnalysis} disabled={running || !engagement}><i className={`ti ${running ? 'ti-loader-2 animate-spin' : 'ti-player-play'}`} /> {running ? 'Analyserar…' : 'Kör analys'}</button>
        </div>
      </div>
      <div className="text-[12px] text-gray-500 mb-3">{company?.name} · {company?.org_nr || '—'} · Räkenskapsår {fy?.year || '—'}{engagement?.last_analysis_at ? ` · Senaste analys ${fmt(engagement.last_analysis_at)}` : ''} · Ansvarig: {engagement?.ansvarig_user_id === user?.id ? (user?.email || 'Du') : '—'}</div>

      {/* Beständig AI-varning */}
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-amber-800">
        <i className="ti ti-alert-triangle text-amber-500 mt-0.5" />
        <span>{AI_WARNING} AI varken bokför, ändrar låsta perioder eller lämnar in årsredovisningen.</span>
      </div>

      {/* Sammanfattning */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Öppna kontroller" value={engagement?.open_count ?? openChecks.length} />
        <Stat label="Kritiska risker" value={engagement?.critical_count ?? 0} tone="red" />
        <Stat label="Höga risker" value={engagement?.high_count ?? 0} tone="orange" />
        <Stat label="Status" value={ENGAGEMENT_STATUS_META[engagement?.status]?.label || '—'} />
      </div>

      {/* Checklista per kontrollområde */}
      {!engagement || checks.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center mb-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <i className="ti ti-list-check text-4xl text-gray-300 block mb-2" />
          <div className="text-sm text-gray-600 mb-1">Ingen analys körd för {fy?.year || 'året'} ännu.</div>
          <div className="text-xs text-gray-400 mb-4">Kör analysen för att bygga bokslutschecklistan och hitta risker/avvikelser.</div>
          <button className="btn btn-primary" onClick={runAnalysis} disabled={running || !engagement}><i className="ti ti-player-play" /> Kör analys</button>
        </div>
      ) : (
        <div className="space-y-3 mb-5">
          {groups.map(g => (
            <div key={g.key} className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                <span className="text-[13px] font-semibold">{g.label}</span>
                <span className="text-[11px] text-gray-400">{g.items.filter(i => isOpenCheck(i.status)).length} öppna</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {g.items.map(c => (
                    <tr key={c.id} className="hover:brightness-95 transition-all cursor-pointer border-b last:border-0" style={{ background: isOpenCheck(c.status) ? RISK_META[c.risk_level]?.row : 'rgba(0,0,0,0.015)', borderColor: 'rgba(0,0,0,0.05)' }} onClick={() => setSelected(c)}>
                      <td className="px-4 py-2.5 w-28"><RiskChip r={c.risk_level} /></td>
                      <td className="px-2 py-2.5"><div className="font-medium leading-snug">{c.title}</div>{c.account_nr && <div className="text-[11px] text-gray-400">Konto {c.account_nr}</div>}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-gray-600 w-32">{c.saldo !== null && c.saldo !== undefined ? fmtAmount(c.saldo) : ''}</td>
                      <td className="px-2 py-2.5 w-36"><Chip meta={CHECK_STATUS_META[c.status]} /></td>
                      <td className="px-4 py-2.5 text-right w-24" onClick={e => e.stopPropagation()}>{c.action_url && <button className="text-blue-700 hover:underline text-[13px]" onClick={() => navigate(c.action_url)}>Gå till</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Steg 2 – platshållare så hela arbetsflödet syns */}
      <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">AI-stöd & utkast</div>
      <div className="grid md:grid-cols-3 gap-3">
        <ComingCard icon="ti-bulb" title="AI-förslag" text="Källbundna förslag och utkast till bokslutsverifikationer (status 'Förslag, ej bokförd'). Kräver granskning – bokförs aldrig automatiskt." />
        <ComingCard icon="ti-paperclip" title="Bokslutsbilagor" text="Bank, kund-/leverantörsreskontra, moms, skatt, anläggningar m.m. med saldo enligt huvudbok, avstämt belopp och differens." />
        <ComingCard icon="ti-file-text" title="Årsredovisningsutkast (K2)" text="Förvaltningsberättelse, resultat- och balansräkning, noter, fastställelseintyg och underskriftssida. AI-utkast som måste granskas." />
      </div>

      {/* Spårbarhet (audit) */}
      {audit.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">Senaste händelser (revisionsspår)</div>
          <div className="bg-white rounded-xl px-4 py-2 text-[12px] text-gray-500 space-y-0.5" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            {audit.map(a => <div key={a.id}>{fmt(a.created_at)} · {a.action}{a.model ? ` (${a.model})` : ''}</div>)}
          </div>
        </div>
      )}

      {selected && <CheckDrawer check={selected} user={user} perms={perms} onClose={() => setSelected(null)} onChanged={loadEngagement} navigate={navigate} />}
    </div>
  )
}

function CheckDrawer({ check, user, perms = {}, onClose, onChanged, navigate }) {
  const NO_RESOLVE = 'Endast admin kan markera kontroller som klara/ignorerade'
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')

  async function act(rpc, args, ok) {
    setBusy(true)
    try { const { error } = await supabase.rpc(rpc, args); if (error) throw error; if (ok) toast.success(ok); await onChanged() }
    catch (e) { toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades') }
    setBusy(false)
  }
  const setStatus = (s, label) => act('bokslut_set_check_status', { p_check: check.id, p_status: s, p_comment: null }, label)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-start justify-between gap-2 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><RiskChip r={check.risk_level} /><Chip meta={CHECK_STATUS_META[check.status]} /></div>
            <div className="text-[15px] font-semibold mt-1 leading-snug">{check.title}</div>
            <div className="text-[11px] text-gray-400">{categoryLabel(check.category)}{check.account_nr ? ` · Konto ${check.account_nr}` : ''}</div>
          </div>
          <button className="text-gray-400 hover:text-gray-700 p-1" onClick={onClose}><i className="ti ti-x text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {check.description && <p className="text-sm text-gray-700 leading-relaxed">{check.description}</p>}
          {check.saldo !== null && check.saldo !== undefined && <div className="text-sm"><span className="text-gray-400">Saldo enligt huvudbok:</span> <b className="tabular-nums">{fmtAmount(check.saldo)} kr</b></div>}
          {check.suggested_action && <div className="bg-blue-50 rounded-lg p-3 text-[13px] text-blue-900"><i className="ti ti-bulb mr-1" />{check.suggested_action}</div>}
          {check.action_url && <button className="btn btn-primary w-full" onClick={() => navigate(check.action_url)}><i className="ti ti-arrow-right" /> Gå till åtgärd</button>}

          <div className="flex flex-wrap gap-2">
            {check.status !== 'in_progress' && isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || !perms.comment_check} onClick={() => setStatus('in_progress', 'Markerad som påbörjad')}><i className="ti ti-player-play" /> Påbörja</button>}
            {isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || !perms.resolve_check} title={!perms.resolve_check ? NO_RESOLVE : undefined} onClick={() => setStatus('resolved', 'Markerad som klar')}><i className="ti ti-check" /> Klar</button>}
            {check.status !== 'needs_review' && isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || !perms.comment_check} onClick={() => setStatus('needs_review', 'Markerad för granskning')}><i className="ti ti-eye" /> Kräver granskning</button>}
            {isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || !perms.ignore_check} title={!perms.ignore_check ? NO_RESOLVE : undefined} onClick={() => setStatus('ignored', 'Ignorerad')}><i className="ti ti-eye-off" /> Ignorera</button>}
            {!isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || !perms.resolve_check} title={!perms.resolve_check ? NO_RESOLVE : undefined} onClick={() => setStatus('open', 'Återöppnad')}><i className="ti ti-rotate" /> Återöppna</button>}
            {check.assigned_to === user?.id
              ? <button className="btn text-sm" disabled={busy || !perms.assign_check} onClick={() => act('bokslut_assign_check', { p_check: check.id, p_user: null }, 'Tilldelning borttagen')}><i className="ti ti-user-off" /> Ta bort mig</button>
              : <button className="btn text-sm" disabled={busy || !perms.assign_check} onClick={() => act('bokslut_assign_check', { p_check: check.id, p_user: user.id }, 'Tilldelad dig')}><i className="ti ti-user-check" /> Tilldela mig</button>}
          </div>
          {!perms.resolve_check && <div className="text-[11px] text-gray-400 -mt-2"><i className="ti ti-info-circle mr-0.5" />Din roll (medlem) kan granska och kommentera. Endast admin markerar klar/ignorerar.</div>}

          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Kommentar</div>
            {check.comment && <div className="bg-gray-50 rounded-lg px-3 py-2 text-[13px] mb-2">{check.comment}</div>}
            <div className="flex gap-2">
              <textarea className="input text-sm flex-1" rows={2} placeholder="Skriv en kommentar…" value={comment} onChange={e => setComment(e.target.value)} />
              <button className="btn btn-primary self-end" disabled={busy || !comment.trim() || !perms.comment_check} onClick={async () => { await act('bokslut_comment_check', { p_check: check.id, p_comment: comment }, 'Kommentar sparad'); setComment('') }}><i className="ti ti-send" /></button>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Spårbarhet</div>
            <div className="text-[12px] text-gray-500 space-y-1">
              <div><span className="text-gray-400">Regel:</span> {check.rule_key}</div>
              <div><span className="text-gray-400">Källa:</span> {check.source || '—'}</div>
              <div><span className="text-gray-400">Skapad:</span> {fmt(check.created_at)}</div>
              <div><span className="text-gray-400">Senast uppdaterad:</span> {fmt(check.updated_at)}</div>
              {check.source_data && Object.keys(check.source_data).length > 0 && (
                <pre className="bg-gray-50 rounded p-2 text-[11px] text-gray-600 overflow-x-auto mt-1">{JSON.stringify(check.source_data, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
