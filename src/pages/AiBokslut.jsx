import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import HelpButton from '../components/HelpButton'
import {
  FEATURE_KEY, NOT_LICENSED_MESSAGE, AI_WARNING, ENGAGEMENT_STATUS_META, ADMIN_SETTABLE_STATUSES, RISK_META, CHECK_STATUS_META,
  ATTACHMENT_TYPES, ATTACHMENT_TYPE_LABEL, ATTACHMENT_STATUS_META, attachmentTypeForCategory, hasDifferens,
  SUGGESTION_TYPE_LABEL, AI_SUGGESTION_STATUS_META, AI_SUGGESTION_WARNING, confidencePct,
  isOpenCheck, groupByCategory, categoryLabel, fiscalYearLabel, fmtAmount,
} from '../lib/bokslut'

const fmt = ts => { try { return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '–' } }
const Chip = ({ meta }) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta?.chip || 'bg-gray-100 text-gray-500'}`}>{meta?.label || '—'}</span>
const RiskChip = ({ r }) => { const m = RISK_META[r]; return <span className="inline-flex items-center gap-1 text-[12px] font-medium"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: m?.dot }} />{m?.label || r}</span> }

// Logga nekad åtgärd (behörighet/lås/licens/medlemskap) via separat RPC i egen transaktion.
// Skriver i bokslut_denied_log (endast plattformsadmin kan läsa). Stör aldrig originalfelet/UI.
async function logDenied({ company = null, engagement = null }, attempted, err) {
  const msg = err?.message || ''
  const denied = err?.code === '42501' || /behörighet saknas|låst|licens|medlem|forbidden|not_licensed/i.test(msg)
  if (!denied) return
  try {
    await supabase.rpc('log_bokslut_denied', {
      p_action: attempted, p_reason: msg, p_company: company, p_engagement: engagement,
      p_context: { route: '/ai-bokslut' },
    })
  } catch { /* loggning får ej störa */ }
}

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
  const [attachments, setAttachments] = useState([])
  const [editAttachment, setEditAttachment] = useState(null)
  const [aiSuggestions, setAiSuggestions] = useState([])
  const [generatingAi, setGeneratingAi] = useState(false)
  const loggedNoLicenseRef = useRef(null)

  // Logga försök att öppna modulen utan licens (en gång per bolag).
  useEffect(() => {
    if (licensed === false && company?.id && loggedNoLicenseRef.current !== company.id) {
      loggedNoLicenseRef.current = company.id
      logDenied({ company: company.id }, 'open_module', { message: 'Licens saknas (ai_bokslut_arsredovisning)' })
    }
  }, [licensed, company?.id])

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
    const [{ data: ch }, { data: au }, { data: at }, { data: sg }] = await Promise.all([
      supabase.from('bokslut_checks').select('*').eq('engagement_id', eng.id),
      supabase.from('bokslut_audit_log').select('*').eq('engagement_id', eng.id).order('created_at', { ascending: false }).limit(15),
      supabase.rpc('bokslut_list_attachments', { p_engagement: eng.id }),
      supabase.rpc('bokslut_list_ai_suggestions', { p_engagement: eng.id }),
    ])
    setChecks(ch || []); setAudit(au || []); setAttachments(at || []); setAiSuggestions(sg || [])
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
    catch (e) { await logDenied({ company: company?.id, engagement: engagement.id }, 'run_analysis', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Analysen misslyckades') }
    setRunning(false)
  }

  async function setEngStatus(s) {
    if (!engagement) return
    if (s === 'last' && !window.confirm('Lås engagemanget? Efter låsning kan inga ändringar göras – endast läsning. Det går inte att låsa upp.')) return
    try { const { error } = await supabase.rpc('set_bokslut_engagement_status', { p_engagement: engagement.id, p_status: s }); if (error) throw error; toast.success('Status uppdaterad'); await loadEngagement() }
    catch (e) { await logDenied({ company: company?.id, engagement: engagement.id }, 'set_status:' + s, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ändra status') }
  }

  async function generateAi() {
    if (!engagement) return
    setGeneratingAi(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('bokslut-ai', { body: { engagement_id: engagement.id }, headers: { Authorization: `Bearer ${session?.access_token}` } })
      if (error) { let m = error.message, code; try { const b = await error.context.json(); if (b?.error) m = b.error; code = b?.code } catch { /* ignore */ } const e2 = new Error(m); e2.code = code; throw e2 }
      if (data?.error) { const e2 = new Error(data.error); e2.code = data.code; throw e2 }
      toast.success(`${data?.created ?? 0} AI-förslag genererade`); await loadEngagement()
    } catch (e) { await logDenied({ company: company?.id, engagement: engagement.id }, 'generate_ai_suggestions', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte generera AI-förslag') }
    setGeneratingAi(false)
  }

  const fy = years.find(y => y.id === fyId)
  const locked = engagement?.status === 'last'
  const openChecks = useMemo(() => checks.filter(c => isOpenCheck(c.status)), [checks])
  const groups = useMemo(() => groupByCategory(checks), [checks])
  const linkedCheckIds = useMemo(() => new Set(attachments.map(a => a.check_id).filter(Boolean)), [attachments])

  if (licensed === false) {
    return (
      <div className="p-6 max-w-[1100px]">
        <div className="text-[15px] font-bold tracking-tight mb-4 flex items-center gap-2"><i className="ti ti-report-analytics text-purple-600" /> AI BOKSLUT & ÅRSREDOVISNING <HelpButton slug="ai-bokslut-arsredovisning" variant="icon" /></div>
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
          <button className="btn btn-primary font-medium" onClick={runAnalysis} disabled={running || !engagement || locked}><i className={`ti ${running ? 'ti-loader-2 animate-spin' : 'ti-player-play'}`} /> {running ? 'Analyserar…' : 'Kör analys'}</button>
          <HelpButton slug="ai-bokslut-arsredovisning" variant="icon" />
        </div>
      </div>

      {/* Statusövergångar (admin) */}
      {engagement && perms.manage_status && !locked && (
        <div className="flex items-center gap-2 mb-3 flex-wrap text-sm">
          <span className="text-[12px] text-gray-400">Ändra status:</span>
          {ADMIN_SETTABLE_STATUSES.filter(s => s.key !== engagement.status).map(s => (
            <button key={s.key} className={`btn text-sm ${s.key === 'last' ? 'text-red-600' : ''}`} onClick={() => setEngStatus(s.key)}><i className={`ti ${s.icon}`} /> {s.label}</button>
          ))}
        </div>
      )}
      {locked && (
        <div className="flex items-center gap-2 bg-gray-100 border rounded-lg px-4 py-2 mb-3 text-[13px] text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <i className="ti ti-lock text-gray-500" /> Engagemanget är <b className="mx-1">låst</b> – endast läsning. Inga ändringar eller ny analys kan göras.
        </div>
      )}
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

      {/* Bokslutsbilagor (Steg 2A) */}
      {engagement && <AttachmentsPanel engagement={engagement} attachments={attachments} perms={perms} locked={locked} onOpen={setEditAttachment} onCreate={() => setEditAttachment({})} onChanged={loadEngagement} />}

      {/* AI-förslag (Steg 2B) */}
      <div className="mt-5">
        {engagement && <AiSuggestionsPanel engagement={engagement} suggestions={aiSuggestions} perms={perms} locked={locked} generating={generatingAi} onGenerate={generateAi} onChanged={loadEngagement} checks={checks} attachments={attachments} />}
      </div>

      {/* Återstående Steg 2 – platshållare */}
      <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2 mt-5">Årsredovisning</div>
      <div className="grid md:grid-cols-2 gap-3">
        <ComingCard icon="ti-file-text" title="Årsredovisningsutkast (K2)" text="Förvaltningsberättelse, resultat- och balansräkning, noter, fastställelseintyg och underskriftssida. AI-utkast som måste granskas. (Steg 2C)" />
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

      {selected && <CheckDrawer check={selected} user={user} perms={perms} locked={locked} hasAttachment={linkedCheckIds.has(selected.id)}
        onCreateAttachment={c => { setSelected(null); setEditAttachment({ _fromCheck: true, check_id: c.id, type: attachmentTypeForCategory(c.category), account_nr: c.account_nr || '', saldo_huvudbok: c.saldo ?? '', title: 'Bilaga – ' + categoryLabel(c.category) }) }}
        onClose={() => setSelected(null)} onChanged={loadEngagement} navigate={navigate} />}
      {editAttachment && <AttachmentModal initial={editAttachment} engagement={engagement} perms={perms} locked={locked} onClose={() => setEditAttachment(null)} onSaved={async () => { setEditAttachment(null); await loadEngagement() }} />}
    </div>
  )
}

function CheckDrawer({ check, user, perms = {}, locked = false, hasAttachment = false, onCreateAttachment, onClose, onChanged, navigate }) {
  const NO_RESOLVE = 'Endast admin kan markera kontroller som klara/ignorerade'
  const LOCKED = 'Engagemanget är låst – inga ändringar tillåts'
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')

  async function act(rpc, args, ok) {
    setBusy(true)
    try { const { error } = await supabase.rpc(rpc, args); if (error) throw error; if (ok) toast.success(ok); await onChanged() }
    catch (e) { await logDenied({ engagement: check.engagement_id }, args?.p_status ? `${rpc}:${args.p_status}` : rpc, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades') }
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
            {check.status !== 'in_progress' && isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || locked || !perms.comment_check} title={locked ? LOCKED : undefined} onClick={() => setStatus('in_progress', 'Markerad som påbörjad')}><i className="ti ti-player-play" /> Påbörja</button>}
            {isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || locked || !perms.resolve_check} title={locked ? LOCKED : (!perms.resolve_check ? NO_RESOLVE : undefined)} onClick={() => setStatus('resolved', 'Markerad som klar')}><i className="ti ti-check" /> Klar</button>}
            {check.status !== 'needs_review' && isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || locked || !perms.comment_check} title={locked ? LOCKED : undefined} onClick={() => setStatus('needs_review', 'Markerad för granskning')}><i className="ti ti-eye" /> Kräver granskning</button>}
            {isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || locked || !perms.ignore_check} title={locked ? LOCKED : (!perms.ignore_check ? NO_RESOLVE : undefined)} onClick={() => setStatus('ignored', 'Ignorerad')}><i className="ti ti-eye-off" /> Ignorera</button>}
            {!isOpenCheck(check.status) && <button className="btn text-sm" disabled={busy || locked || !perms.resolve_check} title={locked ? LOCKED : (!perms.resolve_check ? NO_RESOLVE : undefined)} onClick={() => setStatus('open', 'Återöppnad')}><i className="ti ti-rotate" /> Återöppna</button>}
            {check.assigned_to === user?.id
              ? <button className="btn text-sm" disabled={busy || locked || !perms.assign_check} title={locked ? LOCKED : undefined} onClick={() => act('bokslut_assign_check', { p_check: check.id, p_user: null }, 'Tilldelning borttagen')}><i className="ti ti-user-off" /> Ta bort mig</button>
              : <button className="btn text-sm" disabled={busy || locked || !perms.assign_check} title={locked ? LOCKED : undefined} onClick={() => act('bokslut_assign_check', { p_check: check.id, p_user: user.id }, 'Tilldelad dig')}><i className="ti ti-user-check" /> Tilldela mig</button>}
          </div>
          {locked
            ? <div className="text-[11px] text-gray-400 -mt-2"><i className="ti ti-lock mr-0.5" />Engagemanget är låst – endast läsning.</div>
            : !perms.resolve_check && <div className="text-[11px] text-gray-400 -mt-2"><i className="ti ti-info-circle mr-0.5" />Din roll (medlem) kan granska och kommentera. Endast admin markerar klar/ignorerar.</div>}

          {/* Koppling till bokslutsbilaga */}
          {(hasAttachment || (!locked && perms.attachment_write)) && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {hasAttachment && <span className="text-[11px] text-green-700 inline-flex items-center"><i className="ti ti-paperclip mr-0.5" />Bokslutsbilaga kopplad</span>}
              {!locked && perms.attachment_write && <button className="btn text-sm" disabled={busy} onClick={() => onCreateAttachment(check)}><i className="ti ti-paperclip" /> Skapa bilaga från kontroll</button>}
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Kommentar</div>
            {check.comment && <div className="bg-gray-50 rounded-lg px-3 py-2 text-[13px] mb-2">{check.comment}</div>}
            <div className="flex gap-2">
              <textarea className="input text-sm flex-1" rows={2} placeholder="Skriv en kommentar…" value={comment} onChange={e => setComment(e.target.value)} />
              <button className="btn btn-primary self-end" disabled={busy || locked || !comment.trim() || !perms.comment_check} onClick={async () => { await act('bokslut_comment_check', { p_check: check.id, p_comment: comment }, 'Kommentar sparad'); setComment('') }}><i className="ti ti-send" /></button>
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

// ── Bokslutsbilagor: lista + förslag + skapa (Steg 2A) ──
function AttachmentsPanel({ engagement, attachments, perms, locked, onOpen, onCreate, onChanged }) {
  const [suggesting, setSuggesting] = useState(false)
  async function suggest() {
    setSuggesting(true)
    try { const { data, error } = await supabase.rpc('bokslut_generate_attachment_suggestions', { p_engagement: engagement.id }); if (error) throw error; toast.success(`${data || 0} bilageförslag skapade`); await onChanged() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'generate_attachment_suggestions', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte föreslå bilagor') }
    setSuggesting(false)
  }
  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        <span className="text-[13px] font-semibold flex items-center gap-1.5"><i className="ti ti-paperclip text-purple-600" /> Bokslutsbilagor</span>
        <span className="text-[11px] text-gray-400">{attachments.length} st</span>
        {!locked && perms.attachment_write && (
          <div className="ml-auto flex items-center gap-2">
            <button className="btn text-sm" disabled={suggesting} onClick={suggest}><i className={`ti ${suggesting ? 'ti-loader-2 animate-spin' : 'ti-wand'}`} /> Föreslå bilagor</button>
            <button className="btn btn-primary text-sm" onClick={onCreate}><i className="ti ti-plus" /> Skapa bilaga</button>
          </div>
        )}
      </div>
      <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}><i className="ti ti-info-circle mr-1" />Bilagor är underlag för granskning – inte automatisk bokföring.</div>
      {attachments.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">Inga bokslutsbilagor ännu.{!locked && perms.attachment_write ? ' Skapa en eller använd "Föreslå bilagor".' : ''}</div>
      ) : (
        <table className="w-full text-sm">
          <thead><tr>{['Typ', 'Konto', 'Saldo huvudbok', 'Avstämt', 'Differens', 'Status', 'Granskad'].map((h, i) => <th key={h} className={`${i >= 2 && i <= 4 ? 'text-right' : 'text-left'} px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b`} style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{h}</th>)}</tr></thead>
          <tbody>
            {attachments.map(a => (
              <tr key={a.id} className="hover:bg-gray-50 cursor-pointer border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }} onClick={() => onOpen(a)}>
                <td className="px-3 py-2.5"><div className="font-medium">{ATTACHMENT_TYPE_LABEL[a.type] || a.type}</div><div className="text-[11px] text-gray-400">{a.title}</div></td>
                <td className="px-3 py-2.5 text-gray-600">{a.account_nr || '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.saldo_huvudbok != null ? fmtAmount(a.saldo_huvudbok) : '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.avstamt_belopp != null ? fmtAmount(a.avstamt_belopp) : '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.differens != null ? <span className={hasDifferens(a) ? 'text-red-600 font-semibold' : 'text-green-600'}>{fmtAmount(a.differens)}</span> : '—'}</td>
                <td className="px-3 py-2.5"><Chip meta={ATTACHMENT_STATUS_META[a.status]} /></td>
                <td className="px-3 py-2.5 text-[11px] text-gray-400">{a.reviewed_at ? fmt(a.reviewed_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Skapa/redigera bokslutsbilaga (modal) ──
function AttachmentModal({ initial, engagement, perms, locked, onClose, onSaved }) {
  const isNew = !initial.id
  const [form, setForm] = useState({
    type: initial.type || 'ovrigt', title: initial.title || '', account_nr: initial.account_nr || '',
    saldo_huvudbok: initial.saldo_huvudbok ?? '', avstamt_belopp: initial.avstamt_belopp ?? '',
    source: initial.source || '', comment: initial.comment || '',
  })
  const [busy, setBusy] = useState(false)
  const num = v => { if (v === '' || v === null || v === undefined) return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n }
  const saldo = num(form.saldo_huvudbok), avst = num(form.avstamt_belopp)
  const diff = (saldo != null && avst != null) ? Math.round((saldo - avst) * 100) / 100 : null
  const canWrite = !!perms.attachment_write && !locked

  async function save() {
    if (!form.title.trim()) return toast.error('Titel krävs')
    setBusy(true)
    try {
      if (isNew) {
        const { error } = await supabase.rpc('bokslut_create_attachment', { p_engagement: engagement.id, p_type: form.type, p_title: form.title, p_account_nr: form.account_nr || null, p_saldo: saldo, p_avstamt: avst, p_source: form.source || null, p_source_data: {}, p_check_id: initial.check_id || null })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('bokslut_update_attachment', { p_attachment: initial.id, p_title: form.title, p_account_nr: form.account_nr || null, p_saldo: saldo, p_avstamt: avst, p_source: form.source || null, p_source_data: null, p_comment: form.comment || null })
        if (error) throw error
      }
      toast.success('Bilaga sparad'); await onSaved()
    } catch (e) { await logDenied({ engagement: engagement.id }, isNew ? 'create_attachment' : 'update_attachment', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara') }
    setBusy(false)
  }
  async function setStatus(s) {
    setBusy(true)
    try { const { error } = await supabase.rpc('bokslut_set_attachment_status', { p_attachment: initial.id, p_status: s, p_comment: null }); if (error) throw error; toast.success('Status uppdaterad'); await onSaved() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'attachment_status:' + s, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ändra status') }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between sticky top-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="text-base font-semibold">{isNew ? 'Ny bokslutsbilaga' : 'Bokslutsbilaga'}</div>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-3 py-2"><i className="ti ti-info-circle mr-1" />Underlag för granskning – inte automatisk bokföring.</div>
          {!isNew && <div className="flex items-center gap-2"><Chip meta={ATTACHMENT_STATUS_META[initial.status]} />{initial.reviewed_at && <span className="text-[11px] text-gray-400">Granskad {fmt(initial.reviewed_at)}</span>}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[11px] text-gray-500 mb-1">Typ</label>
              <select className="input text-sm w-full" value={form.type} disabled={!canWrite || !isNew} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {ATTACHMENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select></div>
            <div><label className="block text-[11px] text-gray-500 mb-1">Konto</label><input className="input text-sm w-full" value={form.account_nr} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, account_nr: e.target.value }))} /></div>
          </div>
          <div><label className="block text-[11px] text-gray-500 mb-1">Titel</label><input className="input text-sm w-full" value={form.title} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div className="grid grid-cols-3 gap-3 items-end">
            <div><label className="block text-[11px] text-gray-500 mb-1">Saldo huvudbok</label><input className="input text-sm w-full text-right" value={form.saldo_huvudbok} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, saldo_huvudbok: e.target.value }))} /></div>
            <div><label className="block text-[11px] text-gray-500 mb-1">Avstämt belopp</label><input className="input text-sm w-full text-right" value={form.avstamt_belopp} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, avstamt_belopp: e.target.value }))} /></div>
            <div><label className="block text-[11px] text-gray-500 mb-1">Differens</label><div className={`input text-sm text-right tabular-nums ${diff != null && Math.abs(diff) > 0.5 ? 'text-red-600 font-semibold' : 'text-green-600'}`} style={{ background: '#f8f8f8' }}>{diff != null ? fmtAmount(diff) : '—'}</div></div>
          </div>
          {diff != null && Math.abs(diff) > 0.5 && <div className="text-[12px] text-red-600"><i className="ti ti-alert-triangle mr-1" />Differens {fmtAmount(diff)} kr – stäm av innan bokslut.</div>}
          <div><label className="block text-[11px] text-gray-500 mb-1">Källa</label><input className="input text-sm w-full" value={form.source} disabled={!canWrite} placeholder="t.ex. kontoutdrag, reskontra" onChange={e => setForm(f => ({ ...f, source: e.target.value }))} /></div>
          {!isNew && <div><label className="block text-[11px] text-gray-500 mb-1">Kommentar</label><textarea className="input text-sm w-full" rows={2} value={form.comment} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} /></div>}
        </div>
        <div className="px-5 py-3 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          {!isNew && canWrite && <>
            <button className="btn text-sm" disabled={busy} onClick={() => setStatus('needs_review')}>Kräver granskning</button>
            <button className="btn text-sm" disabled={busy} onClick={() => setStatus('reviewed')}>Granskad</button>
            {perms.attachment_approve && <button className="btn text-sm" disabled={busy} onClick={() => setStatus('approved')}><i className="ti ti-circle-check" /> Godkänn</button>}
            <button className="btn text-sm" disabled={busy} onClick={() => setStatus('ignored')}>Ignorera</button>
          </>}
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={onClose} disabled={busy}>Stäng</button>
            {canWrite && <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Sparar…' : 'Spara'}</button>}
          </div>
        </div>
        {locked && <div className="px-5 pb-3 text-[11px] text-gray-400"><i className="ti ti-lock mr-0.5" />Engagemanget är låst – endast läsning.</div>}
      </div>
    </div>
  )
}

// ── AI-förslag: granskningsstöd (Steg 2B). Ingen bokföring, inga verifikationer. ──
function AiSuggestionsPanel({ engagement, suggestions, perms, locked, generating, onGenerate, onChanged, checks, attachments }) {
  const [busyId, setBusyId] = useState(null)
  const checkById = useMemo(() => Object.fromEntries((checks || []).map(c => [c.id, c.title])), [checks])
  const attById = useMemo(() => Object.fromEntries((attachments || []).map(a => [a.id, a.title])), [attachments])
  async function setStatus(s, sug) {
    setBusyId(sug.id)
    try { const { error } = await supabase.rpc('bokslut_set_ai_suggestion_status', { p_suggestion: sug.id, p_status: s, p_comment: null }); if (error) throw error; toast.success('Status uppdaterad'); await onChanged() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'ai_suggestion_status:' + s, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ändra status') }
    setBusyId(null)
  }
  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        <span className="text-[13px] font-semibold flex items-center gap-1.5"><i className="ti ti-bulb text-purple-600" /> AI-förslag</span>
        <span className="text-[11px] text-gray-400">{suggestions.length} st</span>
        {!locked && perms.ai_suggestion_write && <button className="btn btn-primary text-sm ml-auto" disabled={generating} onClick={onGenerate}><i className={`ti ${generating ? 'ti-loader-2 animate-spin' : 'ti-sparkles'}`} /> {generating ? 'Genererar…' : 'Generera AI-förslag'}</button>}
      </div>
      <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}><i className="ti ti-info-circle mr-1" />{AI_SUGGESTION_WARNING}</div>
      {suggestions.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">Inga AI-förslag ännu.{!locked && perms.ai_suggestion_write ? ' Klicka "Generera AI-förslag".' : ''}</div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
          {suggestions.map(s => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <RiskChip r={s.risk_level} />
                <span className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{SUGGESTION_TYPE_LABEL[s.suggestion_type] || s.suggestion_type}</span>
                <span className="text-[11px] text-gray-400">Säkerhet {confidencePct(s.confidence)}</span>
                <Chip meta={AI_SUGGESTION_STATUS_META[s.status]} />
                {s.model && <span className="text-[10px] text-gray-300">{s.model}</span>}
              </div>
              <div className="text-[14px] font-medium mt-1">{s.title}</div>
              {s.summary && <div className="text-[13px] text-gray-700 mt-0.5">{s.summary}</div>}
              {s.reasoning && <div className="text-[12px] text-gray-500 mt-1 whitespace-pre-wrap leading-relaxed"><span className="font-medium text-gray-600">Varför:</span> {s.reasoning}</div>}
              {s.suggested_next_action && <div className="text-[12px] text-blue-900 bg-blue-50 rounded px-2 py-1 mt-1.5"><i className="ti ti-arrow-right mr-1" />{s.suggested_next_action}</div>}
              <div className="text-[11px] text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {s.related_check_id && <span><i className="ti ti-list-check mr-0.5" />Kontroll: {checkById[s.related_check_id] || '—'}</span>}
                {s.related_attachment_id && <span><i className="ti ti-paperclip mr-0.5" />Bilaga: {attById[s.related_attachment_id] || '—'}</span>}
                {s.reviewed_at && <span>Granskad {fmt(s.reviewed_at)}</span>}
                {s.source_data && Object.keys(s.source_data).length > 0 && <span title={JSON.stringify(s.source_data)}><i className="ti ti-database mr-0.5" />Källdata</span>}
              </div>
              {!locked && perms.ai_suggestion_write && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <button className="btn text-xs" disabled={busyId === s.id} onClick={() => setStatus('accepted', s)}><i className="ti ti-check" /> Acceptera</button>
                  <button className="btn text-xs" disabled={busyId === s.id} onClick={() => setStatus('rejected', s)}><i className="ti ti-x" /> Avvisa</button>
                  <button className="btn text-xs" disabled={busyId === s.id} onClick={() => setStatus('ignored', s)}><i className="ti ti-eye-off" /> Ignorera</button>
                  <button className="btn text-xs" disabled={busyId === s.id} onClick={() => setStatus('resolved', s)}><i className="ti ti-circle-check" /> Åtgärdad</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
