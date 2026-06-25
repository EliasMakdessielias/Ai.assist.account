import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import HelpButton from '../components/HelpButton'
import { useAutosaveDraft } from '../hooks/useAutosaveDraft'
import AutosaveIndicator from '../components/offline/AutosaveIndicator'
import RestoreDraftBanner from '../components/offline/RestoreDraftBanner'
import { isAutosavePilotEnabled, fetchPilotServerEnabled } from '../lib/offline/flags'
import { fetchSyncServerEnabled, isSyncQueueEnabled, syncQueueDiagnostics } from '../lib/offline/flags'
import { useSyncQueue } from '../hooks/useSyncQueue'
import { SyncStatusIndicator, CheckSyncBadge, PendingSyncList, ConflictReviewDialog } from '../components/SyncQueueUI'
import { commitCheckComment } from '../lib/offline/commit'
import {
  FEATURE_KEY, NOT_LICENSED_MESSAGE, AI_WARNING, ENGAGEMENT_STATUS_META, ADMIN_SETTABLE_STATUSES, RISK_META, CHECK_STATUS_META,
  ATTACHMENT_TYPES, ATTACHMENT_TYPE_LABEL, ATTACHMENT_STATUS_META, attachmentTypeForCategory, hasDifferens,
  SUGGESTION_TYPE_LABEL, AI_SUGGESTION_STATUS_META, AI_SUGGESTION_WARNING, confidencePct,
  ANNUAL_REPORT_WARNING, NO_COMPARATIVE_MESSAGE, DRAFT_STATUS_META, SECTION_STATUS_META, SECTION_LABEL, STRUCTURED_FIELD_LABEL,
  VALIDATION_WARNING, VALIDATION_SEVERITY_META, VALIDATION_STATUS_META, VALIDATION_SOURCE_LABEL,
  validationSummary, approveBlockReason, lockBlockReason,
  AI_TEXT_WARNING, AI_TEXT_SECTIONS_NOTE,
  EXPORT_TYPE_LABEL, EXPORT_STATUS_META, QUALITY_STATUS_META, QUALITY_CHECK_LABEL, exportWarnings,
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
  const [arDraft, setArDraft] = useState(null)
  const [arSections, setArSections] = useState([])
  const [arValidation, setArValidation] = useState([])
  const [arExports, setArExports] = useState([])
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [validating, setValidating] = useState(false)
  const [generatingTexts, setGeneratingTexts] = useState(false)
  const [autosavePilotServer, setAutosavePilotServer] = useState(false)   // Etapp 2C: serverstyrd flagga
  const [syncServerEnabled, setSyncServerEnabled] = useState(false)        // Etapp 3C: serverstyrd synkkö-flagga (default av)
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

  // Etapp 2E: serverflaggan bunden till AKTUELLT companyId. Nollställ direkt vid byte (autosave startar inte
  // förrän rätt bolags flagga verifierats), och ignorera sent svar från ett tidigare bolag (request generation).
  useEffect(() => {
    setAutosavePilotServer(false)
    if (!company?.id) return
    let cancelled = false
    fetchPilotServerEnabled(supabase, company.id).then(v => { if (!cancelled) setAutosavePilotServer(v) })
    return () => { cancelled = true }
  }, [company?.id])

  // Etapp 3C: synkkö-flaggan (offline_autosave_sync) bunden till AKTUELLT companyId, samma cancellation-mönster. Default av.
  useEffect(() => {
    setSyncServerEnabled(false)
    if (!company?.id) return
    let cancelled = false
    fetchSyncServerEnabled(supabase, company.id).then(v => { if (!cancelled) setSyncServerEnabled(v) })
    return () => { cancelled = true }
  }, [company?.id])

  const syncEnabled = isSyncQueueEnabled({ serverEnabled: syncServerEnabled })
  const syncQueue = useSyncQueue({ enabled: syncEnabled, supabase, userId: user?.id, companyId: company?.id })
  useEffect(() => {
    try { window.__syncDiag = syncQueueDiagnostics({ serverEnabled: syncServerEnabled, companyId: company?.id, pendingCount: syncQueue.counts.pending + syncQueue.counts.retry_wait, leaderMode: syncQueue.leaderMode, isLeader: syncQueue.isLeader, leaderTabId: syncQueue.leaderTabId }) } catch { /* ignore */ }
  }, [syncServerEnabled, company?.id, syncQueue.counts.pending, syncQueue.counts.retry_wait, syncQueue.leaderMode, syncQueue.isLeader, syncQueue.leaderTabId])

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
    // K2-årsredovisningsutkast (Steg 2C-1): läs befintligt utkast (skapas ej automatiskt vid besök).
    const { data: dr } = await supabase.from('annual_report_drafts').select('*').eq('engagement_id', eng.id).maybeSingle()
    let sec = [], val = [], exp = []
    if (dr) {
      const [{ data: s }, { data: v }, { data: ex }] = await Promise.all([
        supabase.rpc('annual_report_list_sections', { p_draft: dr.id }),
        supabase.rpc('annual_report_list_validation_items', { p_draft: dr.id }),
        supabase.rpc('annual_report_list_exports', { p_draft: dr.id }),
      ])
      sec = s || []; val = v || []; exp = ex || []
    }
    setArDraft(dr || null); setArSections(sec); setArValidation(val); setArExports(exp)
  }, [company?.id, fyId, licensed])
  useEffect(() => { loadEngagement() }, [loadEngagement])
  // Etapp 2B: stäng drawers vid kontextbyte (bolag/räkenskapsår) så ingen tidigare kontexts text/utkast visas.
  useEffect(() => { setSelected(null); setEditAttachment(null) }, [company?.id, fyId])

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

  async function generateDraft() {
    if (!engagement) return
    setGeneratingDraft(true)
    try { const { error } = await supabase.rpc('annual_report_generate_k2_draft', { p_engagement: engagement.id }); if (error) throw error; toast.success(arDraft ? 'K2-utkast uppdaterat' : 'K2-utkast skapat'); await loadEngagement() }
    catch (e) { await logDenied({ company: company?.id, engagement: engagement.id }, 'generate_k2_draft', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skapa K2-utkast') }
    setGeneratingDraft(false)
  }

  async function runValidation() {
    if (!arDraft) return
    setValidating(true)
    try { const { data, error } = await supabase.rpc('annual_report_run_validation', { p_draft: arDraft.id }); if (error) throw error; toast.success(`Validering klar: ${data?.open ?? 0} öppna punkter`); await loadEngagement() }
    catch (e) { await logDenied({ company: company?.id, engagement: engagement.id }, 'run_validation', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte validera utkast') }
    setValidating(false)
  }

  async function generateTexts() {
    if (!arDraft) return
    setGeneratingTexts(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('annual-report-ai', { body: { draft_id: arDraft.id }, headers: { Authorization: `Bearer ${session?.access_token}` } })
      if (error) { let m = error.message, code; try { const b = await error.context.json(); if (b?.error) m = b.error; code = b?.code } catch { /* ignore */ } const e2 = new Error(m); e2.code = code; throw e2 }
      if (data?.error) { const e2 = new Error(data.error); e2.code = data.code; throw e2 }
      toast.success(`${data?.updated ?? 0} AI-texter genererade (kräver granskning)`); await loadEngagement()
    } catch (e) { await logDenied({ company: company?.id, engagement: engagement.id }, 'generate_ai_texts', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte generera AI-texter') }
    setGeneratingTexts(false)
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

      {/* Årsredovisningsutkast K2 (Steg 2C-1) */}
      <div className="mt-5">
        {engagement && <AnnualReportPanel engagement={engagement} company={company} fy={fy} draft={arDraft} sections={arSections} validation={arValidation} exports={arExports} perms={perms} locked={locked} generating={generatingDraft} validating={validating} generatingTexts={generatingTexts} onGenerate={generateDraft} onValidate={runValidation} onGenerateTexts={generateTexts} onChanged={loadEngagement} />}
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

      {selected && <CheckDrawer key={selected.id} check={selected} user={user} company={company} fy={fy} pilotServerEnabled={autosavePilotServer} syncEnabled={syncEnabled} syncQueue={syncQueue} perms={perms} locked={locked} hasAttachment={linkedCheckIds.has(selected.id)}
        onCreateAttachment={c => { setSelected(null); setEditAttachment({ _fromCheck: true, check_id: c.id, type: attachmentTypeForCategory(c.category), account_nr: c.account_nr || '', saldo_huvudbok: c.saldo ?? '', title: 'Bilaga – ' + categoryLabel(c.category) }) }}
        onClose={() => setSelected(null)} onChanged={loadEngagement} navigate={navigate} />}
      {editAttachment && <AttachmentModal initial={editAttachment} engagement={engagement} perms={perms} locked={locked} onClose={() => setEditAttachment(null)} onSaved={async () => { setEditAttachment(null); await loadEngagement() }} />}
    </div>
  )
}

function CheckDrawer({ check, user, company, fy, pilotServerEnabled = false, syncEnabled = false, syncQueue = null, perms = {}, locked = false, hasAttachment = false, onCreateAttachment, onClose, onChanged, navigate }) {
  const NO_RESOLVE = 'Endast admin kan markera kontroller som klara/ignorerade'
  const LOCKED = 'Engagemanget är låst – inga ändringar tillåts'
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')
  const [conflictOp, setConflictOp] = useState(null)

  // Etapp 3C: synkkö-prototyp (avstängd om inte syncEnabled). EXAKT en entitet: denna check-kommentar.
  const syncOn = !!syncEnabled && !!syncQueue
  const syncIdentity = { userId: user?.id, companyId: company?.id, fiscalYearId: fy?.id, engagementId: check.engagement_id, entityType: 'bokslut_check_comment', entityId: check.id }
  const baseRevision = check.comment_revision   // serverbaserad revision; saknas → kan ej synka (hämta serverversion först)
  const checkOps = syncOn ? (syncQueue.operations || []).filter(o => o.entityId === check.id) : []

  // Etapp 2A–2C: lokal autosave-pilot för kommentarsutkast. Aktivering är serverstyrd i byggd miljö.
  const pilotOn = isAutosavePilotEnabled({ serverEnabled: pilotServerEnabled })
  const autosaveIdentity = {
    userId: user?.id, companyId: company?.id, fiscalYearId: fy?.id,
    engagementId: check.engagement_id, entityType: 'bokslut_check_comment', fieldId: check.id,
  }
  const autosave = useAutosaveDraft({ enabled: pilotOn, identity: autosaveIdentity, value: comment })

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
            {pilotOn && autosave.restorable && (
              <RestoreDraftBanner
                draft={autosave.restorable}
                companyName={company?.name}
                fiscalYearLabel={fy ? `${fy.year}` : null}
                currentValue={comment}
                onRestore={() => { const p = autosave.restore(); if (p != null) setComment(p) }}
                onDiscard={() => autosave.discard()}
                onKeep={() => autosave.dismissBanner()}
              />
            )}
            {pilotOn && autosave.otherTab && !autosave.conflict && (
              <div className="text-[11px] text-amber-700 mb-1"><i className="ti ti-windows mr-0.5" />Det här utkastet redigeras även i en annan flik.</div>
            )}
            {pilotOn && autosave.conflict && (
              <div className="rounded-lg border px-3 py-2 mb-2 text-[12px]" style={{ borderColor: 'rgba(220,38,38,0.45)', background: '#fef2f2' }}>
                <div className="font-medium text-red-700"><i className="ti ti-git-merge mr-1" />En nyare lokal version finns i en annan flik</div>
                <div className="text-red-700/90 mt-0.5">Din text sparades inte – inget skrivs över. Välj hur du vill fortsätta.</div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button className="btn text-xs" onClick={() => { const p = autosave.resolveLoadNewer(); if (p != null) setComment(p) }}><i className="ti ti-download" /> Läs in nyare version</button>
                  <button className="btn text-xs" onClick={async () => { const p = await autosave.resolveKeepSeparate(); if (p != null) setComment(p) }}><i className="ti ti-copy" /> Behåll min text som separat lokalt utkast</button>
                </div>
              </div>
            )}
            {pilotOn && autosave.readError && (
              <div className="text-[11px] text-red-600 mb-1">
                <i className="ti ti-database-off mr-0.5" />Lokalt utkast kunde inte läsas. Autospar är pausat.
                <button className="ml-2 underline" onClick={() => autosave.retryRead()}>Försök igen</button>
              </div>
            )}
            <div className="flex gap-2">
              <textarea className="input text-sm flex-1" rows={2} placeholder="Skriv en kommentar…" value={comment} onChange={e => setComment(e.target.value)} />
              <button className="btn btn-primary self-end" disabled={busy || locked || !comment.trim() || !perms.comment_check} onClick={async () => {
                setBusy(true)
                try {
                  await commitCheckComment(supabase, check.id, comment)   // kastar vid ALLA fel; true endast vid bekräftad respons
                  toast.success('Kommentar sparad')
                  if (pilotOn) await autosave.clearLocal()                // server bekräftat → ta bort lokalt utkast
                  setComment('')
                  await onChanged()
                } catch (e) {
                  // Offline/timeout/abort/401/403/500/felaktigt svar → behåll lokalt utkast (raderas EJ), ingen success-notis.
                  await logDenied({ engagement: check.engagement_id }, 'bokslut_comment_check', e)
                  toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara kommentaren på servern')
                }
                setBusy(false)
              }}><i className="ti ti-send" /></button>
            </div>
            {pilotOn && <div className="mt-1"><AutosaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} storageError={autosave.storageError} /></div>}

            {/* Etapp 3C: synkkö-prototyp (avstängd om inte syncEnabled). Skapar aldrig en bokföringsåtgärd. */}
            {syncOn && (
              <div className="mt-3 border-t pt-3 space-y-2" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400 uppercase tracking-wide">Serversynk (intern prototyp)</span>
                  <span className="flex items-center gap-3">
                    <SyncStatusIndicator counts={syncQueue.counts} reauthNeeded={syncQueue.reauthNeeded} />
                    <CheckSyncBadge operations={syncQueue.operations} entityId={check.id} />
                  </span>
                </div>
                {baseRevision == null
                  ? <div className="text-[12px] text-amber-700"><i className="ti ti-cloud-download mr-0.5" />Serverversion behöver hämtas innan synk</div>
                  : (
                    <div className="flex flex-wrap gap-2">
                      <button className="btn text-sm" disabled={busy || locked || !comment.trim() || !perms.comment_check} title={locked ? LOCKED : undefined}
                        onClick={async () => {
                          const r = await syncQueue.enqueueComment(syncIdentity, { operationType: syncQueue.OP_UPSERT, comment, baseRevision })
                          if (r.ok) toast.success('Köad för serversynk'); else if (r.reason === 'too_large') toast.error('Kommentaren är för lång (max 8000 byte)'); else if (r.reason === 'base_revision_missing') toast.error('Serverversion behöver hämtas innan synk'); else toast.error('Kunde inte köa')
                        }}><i className="ti ti-cloud-up" /> Köa serversynk</button>
                      {check.comment != null && <button className="btn text-sm" disabled={busy || locked || !perms.comment_check}
                        onClick={async () => { const r = await syncQueue.enqueueComment(syncIdentity, { operationType: syncQueue.OP_CLEAR, baseRevision }); if (r.ok) toast.success('Rensning köad') }}><i className="ti ti-eraser" /> Köa rensning</button>}
                    </div>
                  )}
                <PendingSyncList operations={checkOps} onRetry={syncQueue.retry} onReview={op => setConflictOp(op)} onDiscard={syncQueue.discardOperation} />
              </div>
            )}
            {syncOn && conflictOp && (
              <ConflictReviewDialog operation={conflictOp} localText={comment} canOverwrite={!!perms.resolve_check}
                onClose={() => setConflictOp(null)}
                onLoadServer={async () => {
                  // behörighetskontrollerad läsning (RLS) av serverns aktuella kommentar → ersätter formulärtexten efter användarens val
                  const { data, error } = await supabase.from('bokslut_checks').select('comment').eq('id', check.id).maybeSingle()
                  if (!error) setComment(data?.comment ?? '')
                  await syncQueue.discardOperation(conflictOp.operationId); setConflictOp(null); await onChanged()
                }}
                onKeepSeparate={async () => { await syncQueue.discardOperation(conflictOp.operationId); setConflictOp(null); toast.success('Din text behålls lokalt – inget skrevs över') }}
                onOverwrite={async () => {
                  const cr = conflictOp.serverResult?.currentRevision
                  if (cr == null) { toast.error('Saknar serverrevision'); return }
                  const r = await syncQueue.enqueueComment(syncIdentity, { operationType: syncQueue.OP_OVERWRITE, comment, baseRevision: cr })
                  if (r.ok) { await syncQueue.discardOperation(conflictOp.operationId); setConflictOp(null); toast.success('Överskrivning köad (kräver admin på servern)') }
                }} />
            )}

            {pilotOn && autosave.forks.length > 0 && (
              <div className="mt-2 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(0,0,0,0.1)', background: '#fafafa' }}>
                <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Separata lokala konfliktkopior ({autosave.forks.length})</div>
                <div className="space-y-1">
                  {autosave.forks.map(f => (
                    <div key={f.id} className="flex items-center gap-2">
                      <span className="text-gray-400 shrink-0">{fmt(f.updatedAt)}</span>
                      <span className="truncate text-gray-700 flex-1" title={f.payload}>{f.payload}</span>
                      <button className="underline text-purple-600 shrink-0" onClick={() => { const p = autosave.restoreFork(f); if (p != null) setComment(p) }}>Återställ</button>
                      <button className="underline text-gray-500 shrink-0" onClick={() => autosave.deleteFork(f.id)}>Radera</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

// ── K2-årsredovisningsutkast (Steg 2C-1). Struktur + spårbarhet. Bokför aldrig, lämnar inte in, godkänner inte automatiskt. ──
function AnnualReportPanel({ engagement, company, fy, draft, sections, validation, exports, perms, locked, generating, validating, generatingTexts, onGenerate, onValidate, onGenerateTexts, onChanged }) {
  const [openSection, setOpenSection] = useState(null)
  const [busy, setBusy] = useState(false)
  const draftLocked = draft?.status === 'locked'
  const readOnly = locked || draftLocked
  const canWrite = perms.annual_report_write && !readOnly
  const vsum = useMemo(() => validationSummary(validation), [validation])
  const approveBlock = approveBlockReason(validation)
  const lockBlock = lockBlockReason(validation)

  async function setDraftStatus(s) {
    if (!draft) return
    if (s === 'locked' && !window.confirm('Lås utkastet? Efter låsning kan utkastet och dess sektioner inte ändras.')) return
    setBusy(true)
    try { const { error } = await supabase.rpc('annual_report_set_draft_status', { p_draft: draft.id, p_status: s, p_comment: null }); if (error) throw error; toast.success('Status uppdaterad'); await onChanged() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'annual_report_draft_status:' + s, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ändra status') }
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        <span className="text-[13px] font-semibold flex items-center gap-1.5"><i className="ti ti-file-text text-purple-600" /> Årsredovisningsutkast (K2)</span>
        {draft && <Chip meta={DRAFT_STATUS_META[draft.status]} />}
        {draftLocked && <span className="text-[11px] text-gray-500"><i className="ti ti-lock mr-0.5" />Låst utkast</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {draft && perms.annual_report_write && !readOnly && (
            <button className="btn text-sm" disabled={generatingTexts} onClick={onGenerateTexts} title={AI_TEXT_SECTIONS_NOTE}>
              <i className={`ti ${generatingTexts ? 'ti-loader-2 animate-spin' : 'ti-sparkles'}`} /> {generatingTexts ? 'Skriver…' : 'Generera AI-texter'}
            </button>
          )}
          {draft && perms.annual_report_write && (
            <button className="btn text-sm" disabled={validating} onClick={onValidate}>
              <i className={`ti ${validating ? 'ti-loader-2 animate-spin' : 'ti-checklist'}`} /> {validating ? 'Validerar…' : 'Validera utkast'}
            </button>
          )}
          {perms.annual_report_write && !locked && (
            <button className="btn btn-primary text-sm" disabled={generating || draftLocked} onClick={onGenerate}>
              <i className={`ti ${generating ? 'ti-loader-2 animate-spin' : (draft ? 'ti-refresh' : 'ti-file-plus')}`} /> {generating ? 'Arbetar…' : (draft ? 'Uppdatera utkast' : 'Skapa K2-utkast')}
            </button>
          )}
        </div>
      </div>
      <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}><i className="ti ti-alert-triangle mr-1" />{ANNUAL_REPORT_WARNING}</div>
      {draft && <div className="px-4 py-2 text-[11px] text-purple-700 bg-purple-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}><i className="ti ti-sparkles mr-1" />{AI_TEXT_WARNING} {AI_TEXT_SECTIONS_NOTE}</div>}

      {!draft ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          Inget årsredovisningsutkast ännu.{perms.annual_report_write && !locked ? ' Klicka "Skapa K2-utkast".' : ' Endast behörig användare kan skapa utkast.'}
        </div>
      ) : (
        <>
          <div className="px-4 py-2.5 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 text-[12px] border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
            <div><span className="text-gray-400">Regelverk:</span> {draft.regelverk || 'K2'}</div>
            <div><span className="text-gray-400">Period:</span> {draft.period_start || '–'} – {draft.period_end || '–'}</div>
            <div><span className="text-gray-400">Skapat:</span> {draft.generated_at ? fmt(draft.generated_at) : '–'}</div>
            <div><span className="text-gray-400">Granskat/godkänt:</span> {draft.approved_at ? `Godkänt ${fmt(draft.approved_at)}` : (draft.reviewed_at ? `Granskat ${fmt(draft.reviewed_at)}` : '–')}</div>
          </div>

          <div className="divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
            {sections.map(s => (
              <button key={s.id} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2" onClick={() => setOpenSection(s)}>
                <i className="ti ti-chevron-right text-gray-300" />
                <span className="text-[13px] font-medium">{SECTION_LABEL[s.section_key] || s.title}</span>
                {s.ai_generated && <span className="text-[10px] bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">AI-text</span>}
                {s.requires_review && <span className="text-[10px] text-amber-600"><i className="ti ti-eye" /> kräver granskning</span>}
                <span className="ml-auto"><Chip meta={SECTION_STATUS_META[s.review_status]} /></span>
              </button>
            ))}
            {sections.length === 0 && <div className="px-4 py-4 text-center text-sm text-gray-400">Inga sektioner. Klicka "Uppdatera utkast".</div>}
          </div>

          {/* Validering (Steg 2C-2) */}
          <AnnualReportValidation engagement={engagement} draft={draft} items={validation} summary={vsum} canWrite={canWrite} onChanged={onChanged} />

          {/* Export/PDF (Steg 2C-4) */}
          <AnnualReportExport engagement={engagement} company={company} fy={fy} draft={draft} sections={sections} validation={validation} exports={exports} canExport={perms.annual_report_write} onChanged={onChanged} />

          {canWrite && (
            <div className="px-4 py-2.5 border-t flex flex-col gap-1.5" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[11px] text-gray-400 mr-1">Utkaststatus:</span>
                <button className="btn text-xs" disabled={busy} onClick={() => setDraftStatus('reviewed')}><i className="ti ti-eye-check" /> Markera granskad</button>
                <button className="btn text-xs" disabled={busy || !!approveBlock} title={approveBlock || ''} onClick={() => setDraftStatus('approved')}><i className="ti ti-circle-check" /> Godkänn</button>
                <button className="btn text-xs" disabled={busy} onClick={() => setDraftStatus('rejected')}><i className="ti ti-circle-x" /> Avvisa</button>
                <button className="btn text-xs" disabled={busy || !!lockBlock} title={lockBlock || ''} onClick={() => setDraftStatus('locked')}><i className="ti ti-lock" /> Lås</button>
              </div>
              {approveBlock && <div className="text-[11px] text-red-600"><i className="ti ti-lock-x mr-1" />Godkännande blockerat: {approveBlock}</div>}
              {!approveBlock && lockBlock && <div className="text-[11px] text-red-600"><i className="ti ti-lock-x mr-1" />Låsning blockerad: {lockBlock}</div>}
            </div>
          )}
        </>
      )}

      {openSection && <AnnualReportSectionDrawer section={openSection} engagement={engagement} canWrite={canWrite} onClose={() => setOpenSection(null)} onChanged={async () => { await onChanged() }} />}
    </div>
  )
}

// ── K2-validering (Steg 2C-2): kontrollstöd + granskningsspärrar. Ändrar aldrig bokföring. ──
function AnnualReportValidation({ engagement, draft, items, summary, canWrite, onChanged }) {
  const [busyId, setBusyId] = useState(null)
  async function setStatus(item, status) {
    let reason = null
    if (status === 'ignored') {
      reason = window.prompt('Ange en motivering för att ignorera punkten:')
      if (reason === null || reason.trim() === '') { if (reason !== null) toast.error('Motivering krävs.'); return }
    }
    setBusyId(item.id)
    try { const { error } = await supabase.rpc('annual_report_set_validation_item_status', { p_item: item.id, p_status: status, p_comment: reason }); if (error) throw error; toast.success('Uppdaterad'); await onChanged() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'validation_status:' + status, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte uppdatera') }
    setBusyId(null)
  }
  const SummaryChip = ({ n, label, cls }) => <span className={`text-[11px] rounded-full px-2 py-0.5 ${cls}`}>{n} {label}</span>
  const hasRun = items.length > 0
  return (
    <div className="border-t" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold flex items-center gap-1.5"><i className="ti ti-shield-check text-purple-600" /> Validering</span>
        {hasRun ? (
          <div className="flex flex-wrap gap-1.5">
            <SummaryChip n={summary.critical} label="kritiska" cls="bg-red-100 text-red-700" />
            <SummaryChip n={summary.high} label="höga" cls="bg-orange-100 text-orange-700" />
            <SummaryChip n={summary.warning} label="varningar" cls="bg-blue-100 text-blue-700" />
            <SummaryChip n={summary.open} label="öppna totalt" cls="bg-gray-100 text-gray-600" />
          </div>
        ) : <span className="text-[11px] text-gray-400">Ej validerad ännu. Klicka "Validera utkast".</span>}
      </div>
      <div className="px-4 pb-2 text-[11px] text-amber-700"><i className="ti ti-info-circle mr-1" />{VALIDATION_WARNING}</div>
      {hasRun && (
        <div className="divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
          {items.map(it => {
            const sev = VALIDATION_SEVERITY_META[it.severity]
            return (
              <div key={it.id} className={`px-4 py-2.5 ${it.status !== 'open' ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: sev?.dot }} />{sev?.label}</span>
                  <Chip meta={VALIDATION_STATUS_META[it.status]} />
                  {it.source && it.source !== 'rule' && <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{VALIDATION_SOURCE_LABEL[it.source] || it.source}</span>}
                </div>
                <div className="text-[13px] font-medium mt-1">{it.title}</div>
                {it.description && <div className="text-[12px] text-gray-600 mt-0.5">{it.description}</div>}
                {it.suggested_action && <div className="text-[12px] text-blue-900 bg-blue-50 rounded px-2 py-1 mt-1"><i className="ti ti-arrow-right mr-1" />{it.suggested_action}</div>}
                {it.status === 'ignored' && it.ignored_reason && <div className="text-[11px] text-gray-500 mt-1"><span className="font-medium">Ignorerad:</span> {it.ignored_reason}</div>}
                {canWrite && it.status === 'open' && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button className="btn text-xs" disabled={busyId === it.id} onClick={() => setStatus(it, 'resolved')}><i className="ti ti-check" /> Markera löst</button>
                    <button className="btn text-xs" disabled={busyId === it.id} onClick={() => setStatus(it, 'ignored')}><i className="ti ti-eye-off" /> Ignorera</button>
                  </div>
                )}
                {canWrite && it.status !== 'open' && (
                  <div className="mt-2"><button className="btn text-xs" disabled={busyId === it.id} onClick={() => setStatus(it, 'open')}><i className="ti ti-rotate" /> Återöppna</button></div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── K2-export/PDF (Steg 2C-4): gransknings-export. Ingen e-inlämning, ingen signering, inget skickas externt. ──
function AnnualReportExport({ engagement, company, fy, draft, sections, validation, exports, canExport, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [preview, setPreview] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const warnings = useMemo(() => exportWarnings({ draft, sections, validation }), [draft, sections, validation])

  async function runExport(type) {
    if (!sections || sections.length === 0) { toast.error('Skapa årsredovisningsutkast först.'); return }
    setBusy(type)
    let exportId = null
    try {
      const { data, error } = await supabase.rpc('annual_report_prepare_export', { p_draft: draft.id, p_export_type: type }); if (error) throw error
      exportId = data?.export_id
      setPreview({ autoPrint: type === 'review_pdf' })
      const fname = `arsredovisning-utkast-${draft.period_end || ''}.html`
      await supabase.rpc('annual_report_mark_export_ready', { p_export: exportId, p_file_path: null, p_file_name: fname, p_file_size: null })
      await onChanged()
    } catch (e) {
      if (exportId) { try { await supabase.rpc('annual_report_mark_export_failed', { p_export: exportId, p_error: e.message }) } catch { /* ignore */ } }
      await logDenied({ engagement: engagement.id }, 'export:' + type, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte exportera')
    }
    setBusy(null)
  }

  // Serverrenderad arkiv-PDF via edge (pdf-lib → storage). Ingen inlämning, ingen signering.
  async function generateArchivePdf() {
    if (!sections || sections.length === 0) { toast.error('Skapa årsredovisningsutkast först.'); return }
    setBusy('archive_pdf')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('annual-report-pdf', { body: { draft_id: draft.id }, headers: { Authorization: `Bearer ${session?.access_token}` } })
      if (error) { let m = error.message, code; try { const b = await error.context.json(); if (b?.error) m = b.error; code = b?.code } catch { /* ignore */ } const e2 = new Error(m); e2.code = code; throw e2 }
      if (data?.error) { const e2 = new Error(data.error); e2.code = data.code; throw e2 }
      toast.success(`Arkiv-PDF skapad (${data?.page_count ?? '?'} sidor, kvalitet: ${data?.quality_status ?? '?'})`); await onChanged()
    } catch (e) { await logDenied({ engagement: engagement.id }, 'export:archive_pdf', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte skapa arkiv-PDF') }
    setBusy(null)
  }

  async function downloadPdf(ex) {
    try {
      const { data, error } = await supabase.rpc('annual_report_get_export_download_url', { p_export: ex.id }); if (error) throw error
      const { data: signed, error: sErr } = await supabase.storage.from(data.bucket).createSignedUrl(data.path, 120)
      if (sErr || !signed?.signedUrl) throw new Error('Kunde inte skapa nedladdningslänk')
      window.open(signed.signedUrl, '_blank', 'noopener')
    } catch (e) { await logDenied({ engagement: engagement.id }, 'export_download', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ladda ner') }
  }

  return (
    <div className="border-t" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold flex items-center gap-1.5"><i className="ti ti-file-export text-purple-600" /> Export / gransknings-PDF</span>
        <span className="text-[11px] text-gray-400">Ingen inlämning eller signering – endast för granskning.</span>
        {canExport && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn text-sm" disabled={busy} onClick={() => runExport('html_preview')}><i className={`ti ${busy === 'html_preview' ? 'ti-loader-2 animate-spin' : 'ti-eye'}`} /> Förhandsgranska export</button>
            <button className="btn text-sm" disabled={busy} onClick={() => runExport('review_pdf')}><i className={`ti ${busy === 'review_pdf' ? 'ti-loader-2 animate-spin' : 'ti-printer'}`} /> Skapa gransknings-PDF</button>
            <button className="btn btn-primary text-sm" disabled={busy} onClick={generateArchivePdf}><i className={`ti ${busy === 'archive_pdf' ? 'ti-loader-2 animate-spin' : 'ti-file-download'}`} /> {busy === 'archive_pdf' ? 'Renderar…' : 'Skapa arkiv-PDF'}</button>
          </div>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="px-4 pb-2 flex flex-col gap-1">
          {warnings.map((w, i) => (
            <div key={i} className={`text-[11px] ${w.level === 'error' ? 'text-red-600' : w.level === 'ai' ? 'text-purple-600' : 'text-amber-700'}`}>
              <i className={`ti ${w.level === 'error' ? 'ti-alert-triangle' : w.level === 'ai' ? 'ti-sparkles' : 'ti-file-alert'} mr-1`} />{w.text}
            </div>
          ))}
        </div>
      )}
      {exports && exports.length > 0 && (
        <div className="px-4 pb-2.5">
          <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Exporthistorik</div>
          <div className="space-y-1">
            {exports.slice(0, 8).map(ex => {
              const isPdf = ex.export_type === 'archive_pdf'
              const qr = ex.quality_report || {}
              const checks = qr.checks || qr.edge_checks || null
              return (
                <div key={ex.id} className="text-[12px] text-gray-600">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip meta={EXPORT_STATUS_META[ex.status]} />
                    <span>{EXPORT_TYPE_LABEL[ex.export_type] || ex.export_type}</span>
                    {isPdf && ex.quality_status && <Chip meta={QUALITY_STATUS_META[ex.quality_status]} />}
                    <span className="text-gray-400">{ex.generated_at ? fmt(ex.generated_at) : '–'}</span>
                    {ex.file_name && <span className="text-gray-400">· {ex.file_name}</span>}
                    {isPdf && ex.status === 'ready' && <button className="text-purple-600 hover:underline" onClick={() => downloadPdf(ex)}><i className="ti ti-download mr-0.5" />Ladda ner PDF</button>}
                    {!isPdf && ex.status === 'ready' && <button className="text-purple-600 hover:underline" onClick={() => setPreview({ autoPrint: false })}>Öppna förhandsvisning</button>}
                    {ex.status === 'failed' && ex.error && <span className="text-red-600">· {ex.error}</span>}
                    {isPdf && (checks || qr.db_recheck) && <button className="text-gray-400 hover:text-gray-700" onClick={() => setExpanded(expanded === ex.id ? null : ex.id)}>{expanded === ex.id ? 'Dölj kvalitet' : 'Visa kvalitet'}</button>}
                  </div>
                  {isPdf && expanded === ex.id && (
                    <div className="ml-6 mt-1 mb-1 p-2 bg-gray-50 rounded text-[11px] space-y-0.5" style={{ border: '0.5px solid rgba(0,0,0,0.06)' }}>
                      {qr.page_count !== undefined && <div className="text-gray-500">Sidor: {qr.page_count} · Storlek: {ex.file_size ?? '–'} byte{ex.checksum ? ` · SHA-256: ${String(ex.checksum).slice(0, 12)}…` : ''}</div>}
                      {checks && Object.entries(checks).map(([k, v]) => (
                        <div key={k} className={v ? 'text-green-700' : 'text-red-600'}><i className={`ti ${v ? 'ti-check' : 'ti-x'} mr-1`} />{QUALITY_CHECK_LABEL[k] || k}</div>
                      ))}
                      {qr.db_recheck && <div className="text-gray-500 pt-1 border-t mt-1" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>Senaste DB-kontroll: fil i storage: {String(qr.db_recheck.file_in_storage)} · storlek &gt; 0: {String(qr.db_recheck.file_size_positive)}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {preview && <AnnualReportExportPreview company={company} fy={fy} draft={draft} sections={sections} validation={validation} autoPrint={preview.autoPrint} onClose={() => setPreview(null)} />}
    </div>
  )
}

// Print-vänlig förhandsvisning (#printable utnyttjar @media print i index.css → ingen sidebar i utskrift).
function AnnualReportExportPreview({ company, fy, draft, sections, validation, autoPrint, onClose }) {
  const warnings = useMemo(() => exportWarnings({ draft, sections, validation }), [draft, sections, validation])
  const byKey = useMemo(() => Object.fromEntries((sections || []).map(s => [s.section_key, s])), [sections])
  useEffect(() => { if (autoPrint) { const t = setTimeout(() => window.print(), 450); return () => clearTimeout(t) } }, [autoPrint])

  const StructuredTable = ({ sd }) => {
    const keys = Object.keys(STRUCTURED_FIELD_LABEL).filter(k => sd?.[k] !== undefined && sd?.[k] !== null)
    if (keys.length === 0) return null
    return (
      <>
        <table className="w-full text-[13px] my-2" style={{ borderCollapse: 'collapse' }}>
          <tbody>
            {keys.map(k => (
              <tr key={k} style={{ borderBottom: '0.5px solid #ddd' }}>
                <td className="py-1 pr-4">{STRUCTURED_FIELD_LABEL[k]}</td>
                <td className="py-1 text-right tabular-nums" style={{ whiteSpace: 'nowrap' }}>{fmtAmount(sd[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {'balanserar' in (sd || {}) && <div className="text-[12px]" style={{ color: sd.balanserar ? '#15803d' : '#b91c1c' }}>{sd.balanserar ? 'Balansräkningen balanserar.' : 'Balansräkningen balanserar inte – kräver manuell granskning.'}</div>}
        {sd?.jamforelsetal && <div className="text-[11px] text-gray-500 mt-0.5">{sd.jamforelsetal}</div>}
      </>
    )
  }
  const Section = ({ k }) => {
    const s = byKey[k]
    if (!s) return null
    const sd = s.structured_data || {}
    const structured = k === 'resultatrakning' || k === 'balansrakning'
    return (
      <section className="mt-6" style={{ breakInside: 'avoid' }}>
        <h2 className="text-[15px] font-semibold border-b pb-1 mb-2" style={{ borderColor: '#ccc' }}>
          {SECTION_LABEL[k]} {s.ai_generated && <span className="text-[10px] font-normal text-purple-600">(AI-genererad – kräver granskning)</span>}
        </h2>
        {structured && <StructuredTable sd={sd} />}
        {s.content && <div className="text-[13px] whitespace-pre-wrap leading-relaxed">{s.content}</div>}
      </section>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto">
      <div className="no-print sticky top-0 z-10 bg-gray-50 border-b px-4 py-2 flex items-center gap-2" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
        <span className="text-sm font-semibold">Förhandsvisning – årsredovisningsutkast (K2)</span>
        <span className="text-[11px] text-gray-500">Granskning – ingen inlämning/signering</span>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-primary text-sm" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut / Spara som PDF</button>
          <button className="btn text-sm" onClick={onClose}><i className="ti ti-x" /> Stäng</button>
        </div>
      </div>

      <div id="printable" className="mx-auto" style={{ maxWidth: '800px', padding: '32px', color: '#111' }}>
        {warnings.map((w, i) => (
          <div key={i} className="mb-2 px-3 py-2 text-[13px] font-medium rounded" style={{
            printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
            border: '1px solid', borderColor: w.level === 'error' ? '#dc2626' : w.level === 'ai' ? '#7c3aed' : '#d97706',
            background: w.level === 'error' ? '#fef2f2' : w.level === 'ai' ? '#faf5ff' : '#fffbeb',
            color: w.level === 'error' ? '#b91c1c' : w.level === 'ai' ? '#6d28d9' : '#b45309',
          }}>{w.text}</div>
        ))}

        <div className="text-center mt-4 mb-6">
          <div className="text-[20px] font-bold">{company?.name || '—'}</div>
          <div className="text-[13px] text-gray-600">Org.nr {company?.org_nr || '—'}</div>
          <div className="text-[15px] font-semibold mt-3">Årsredovisning</div>
          <div className="text-[13px] text-gray-600">för räkenskapsåret {draft?.period_start || (fy?.start_date) || '—'} – {draft?.period_end || (fy?.end_date) || '—'}</div>
          <div className="text-[12px] text-gray-500 mt-0.5">Regelverk: {draft?.regelverk || 'K2'} (BFNAR 2016:10)</div>
        </div>

        <Section k="forvaltningsberattelse" />
        <Section k="resultatrakning" />
        <Section k="balansrakning" />
        <Section k="noter" />
        <Section k="faststallelseintyg" />
        <Section k="underskriftssida" />

        <div className="mt-8 pt-3 text-[11px] text-gray-500" style={{ borderTop: '0.5px solid #ccc' }}>
          Genererad {fmt(new Date().toISOString())} · BokPilot · Gransknings-exempel – ej för inlämning till Bolagsverket. Beloppen i resultat- och balansräkning är hämtade från bokföringen och har inte ändrats av AI.
        </div>
      </div>
    </div>
  )
}

// Sektion-editor/drawer: innehåll + strukturerad RR/BR-tabell + källreferenser + granskningsstatus.
function AnnualReportSectionDrawer({ section, engagement, canWrite, onClose, onChanged, reopen }) {
  const [content, setContent] = useState(section.content || '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const sd = section.structured_data || {}
  const refs = section.source_references || {}
  const structuredKeys = Object.keys(STRUCTURED_FIELD_LABEL).filter(k => sd[k] !== undefined && sd[k] !== null)
  const dirty = content !== (section.content || '')

  async function save() {
    setBusy(true)
    try { const { error } = await supabase.rpc('annual_report_update_section', { p_section: section.id, p_content: content, p_review_comment: comment || null }); if (error) throw error; toast.success('Sektion sparad'); await onChanged(); onClose() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'annual_report_update_section', e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte spara') }
    setBusy(false)
  }
  async function setStatus(s) {
    setBusy(true)
    try { const { error } = await supabase.rpc('annual_report_set_section_status', { p_section: section.id, p_status: s, p_comment: comment || null }); if (error) throw error; toast.success('Status uppdaterad'); await onChanged(); onClose() }
    catch (e) { await logDenied({ engagement: engagement.id }, 'annual_report_section_status:' + s, e); toast.error(e.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ändra status') }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative bg-white w-full max-w-lg h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          <span className="text-sm font-semibold">{SECTION_LABEL[section.section_key] || section.title}</span>
          <Chip meta={SECTION_STATUS_META[section.review_status]} />
          {section.ai_generated && <span className="text-[10px] bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">AI-text</span>}
          <button className="ml-auto text-gray-400 hover:text-gray-700" onClick={onClose}><i className="ti ti-x" /></button>
        </div>

        <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50"><i className="ti ti-alert-triangle mr-1" />{ANNUAL_REPORT_WARNING}</div>
        {section.ai_generated && (
          <div className="px-4 py-2 text-[11px] text-purple-700 bg-purple-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
            <div><i className="ti ti-sparkles mr-1" />{AI_TEXT_WARNING}</div>
            <div className="text-purple-500 mt-0.5 flex flex-wrap gap-x-3">
              {section.ai_model && <span>Modell: {section.ai_model}</span>}
              {section.ai_prompt_version && <span>Prompt: {section.ai_prompt_version}</span>}
              {section.ai_generated_at && <span>Genererad: {fmt(section.ai_generated_at)}</span>}
              {section.requires_review && <span><i className="ti ti-eye mr-0.5" />Kräver granskning</span>}
            </div>
          </div>
        )}

        <div className="p-4 space-y-4">
          {structuredKeys.length > 0 && (
            <div>
              <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Strukturerad data (från huvudboken – ändras ej av AI)</div>
              <table className="w-full text-[13px]">
                <tbody>
                  {structuredKeys.map(k => (
                    <tr key={k} className="border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                      <td className="py-1 text-gray-600">{STRUCTURED_FIELD_LABEL[k]}</td>
                      <td className="py-1 text-right font-medium tabular-nums">{fmtAmount(sd[k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {'balanserar' in sd && (
                <div className={`text-[12px] mt-1 ${sd.balanserar ? 'text-green-700' : 'text-red-700'}`}>
                  <i className={`ti ${sd.balanserar ? 'ti-circle-check' : 'ti-alert-triangle'} mr-1`} />
                  {sd.balanserar ? 'Balansräkningen balanserar.' : 'Balansräkningen balanserar inte – kräver manuell granskning.'}
                </div>
              )}
              <div className="text-[11px] text-gray-400 mt-1">{NO_COMPARATIVE_MESSAGE}</div>
            </div>
          )}

          <div>
            <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Text</div>
            {canWrite ? (
              <textarea className="input w-full text-[13px] leading-relaxed" rows={10} value={content} onChange={e => setContent(e.target.value)} />
            ) : (
              <div className="text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded p-3">{section.content || '—'}</div>
            )}
          </div>

          {Object.keys(refs).length > 0 && (
            <div className="text-[11px] text-gray-400">
              <i className="ti ti-database mr-1" />Källa: {Object.entries(refs).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </div>
          )}
          {section.review_comment && <div className="text-[12px] text-gray-500"><span className="font-medium">Kommentar:</span> {section.review_comment}</div>}

          {canWrite && (
            <>
              <input className="input w-full text-[13px]" placeholder="Granskningskommentar (valfri)" value={comment} onChange={e => setComment(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary text-sm" disabled={busy || !dirty} onClick={save}><i className="ti ti-device-floppy" /> Spara text</button>
                <button className="btn text-sm" disabled={busy} onClick={() => setStatus('reviewed')}><i className="ti ti-eye-check" /> Granskad</button>
                <button className="btn text-sm" disabled={busy} onClick={() => setStatus('approved')}><i className="ti ti-circle-check" /> Godkänn</button>
                <button className="btn text-sm" disabled={busy} onClick={() => setStatus('rejected')}><i className="ti ti-circle-x" /> Avvisa</button>
              </div>
              <p className="text-[11px] text-gray-400">Att spara text återställer sektionen till "Kräver granskning". Inga verifikationer skapas och ingen bokföring ändras.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
