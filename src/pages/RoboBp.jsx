// ROBO-bp Etapp B – samlad tabbad huvudvy (/robo-bp). ENDAST UI-skelett + routing, ingen ny affärslogik.
// Licensgrindad (robo_bp). Återanvänder befintlig panel (useRoboBp.open) och befintlig /robo-bp/kontroller.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRoboBp } from '../context/RoboBpContext'
import { supabase } from '../lib/supabase'
import { RISK_META } from '../lib/roboBp'
import toast from 'react-hot-toast'

const TABS = [
  { key: 'assistent', label: 'Assistenten', icon: 'ti-message-chatbot' },
  { key: 'kontroller', label: 'Kontroller', icon: 'ti-checklist' },
  { key: 'rapporter', label: 'Rapporter', icon: 'ti-chart-bar' },
  { key: 'dokument', label: 'Dokument', icon: 'ti-files' },
  { key: 'installningar', label: 'Inställningar', icon: 'ti-settings' },
]

// Rekommenderade promptförslag (visning – ingen ny AI-logik; klick öppnar befintlig panel).
const PROMPTS = [
  'Vilka risker eller avvikelser ser du i bokföringen just nu?',
  'Vad bygger du ditt svar på?',
  'Vilka kontroller bör jag skapa?',
  'Finns det något som kräver manuell granskning?',
  'Vilka är de största kostnadsposterna?',
  'Sammanfatta bolagets ekonomiska läge.',
  'Bedöm den kortsiktiga betalningsförmågan.',
]

function ComingSoon({ icon, title, text, beta }) {
  return (
    <div className="bg-white rounded-2xl p-10 text-center" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
      <i className={`ti ${icon} text-3xl text-gray-300 block mb-2`} />
      <div className="text-gray-700 font-medium">
        {title}{beta && <span className="ml-2 text-[10px] align-middle px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">BETA</span>}
      </div>
      <div className="text-sm text-gray-400 mt-1">{text}</div>
    </div>
  )
}

export default function RoboBp() {
  const { company } = useAuth()
  const { licensed, open } = useRoboBp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('assistent')
  const [openChecks, setOpenChecks] = useState(null)
  const [latestRun, setLatestRun] = useState(null)
  const [running, setRunning] = useState(false)
  const [obsBusy, setObsBusy] = useState({})

  // Antal öppna kontrollpunkter via befintlig RLS SELECT (ingen ny kontrollmotor).
  const loadOpenChecks = useCallback(async () => {
    if (!company?.id) { setOpenChecks(null); return }
    const { count } = await supabase.from('robo_bp_checks')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id).in('status', ['open', 'in_progress'])
    setOpenChecks(count ?? 0)
  }, [company?.id])

  // Senaste kontrollkörning via RLS SELECT (Etapp C1).
  const loadLatestRun = useCallback(async () => {
    if (!company?.id) { setLatestRun(null); return }
    const { data } = await supabase.from('robo_bp_control_runs')
      .select('id, started_at, summary').eq('company_id', company.id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    setLatestRun(data || null)
  }, [company?.id])

  useEffect(() => { if (licensed) { loadOpenChecks(); loadLatestRun() } }, [licensed, loadOpenChecks, loadLatestRun])

  // Aktivt räkenskapsår (täcker idag, annars senaste). Skickas till körningen så no_fiscal_year utesluts.
  async function activeFiscalYearId() {
    if (!company?.id) return null
    const today = new Date().toISOString().slice(0, 10)
    const { data: cur } = await supabase.from('fiscal_years').select('id')
      .eq('company_id', company.id).lte('start_date', today).gte('end_date', today)
      .order('start_date', { ascending: false }).limit(1).maybeSingle()
    if (cur?.id) return cur.id
    const { data: last } = await supabase.from('fiscal_years').select('id')
      .eq('company_id', company.id).order('start_date', { ascending: false }).limit(1).maybeSingle()
    return last?.id || null
  }

  // Ny bokföringskontroll: deterministisk körning från befintliga observations. Rör ALDRIG bokföring.
  async function runControl() {
    if (running || !company?.id) return
    setRunning(true)
    try {
      const fyId = await activeFiscalYearId()
      const { error } = await supabase.rpc('robo_bp_run_control', { p_company: company.id, p_fiscal_year_id: fyId })
      if (error) throw new Error(error.message || 'fel')
      await loadLatestRun()
      toast.success('Kontroll klar – ingen bokföring har ändrats.')
    } catch (e) {
      toast.error(/forbidden|42501|behörig/i.test(e?.message || '') ? 'Du saknar behörighet att köra kontroll.' : (e?.message || 'Kunde inte köra kontroll'))
    } finally {
      setRunning(false)
    }
  }

  // C2: sätt status på en observation (open/resolved/dismissed). Endast run.summary – aldrig bokföring/checks.
  async function setObservationStatus(code, toStatus) {
    if (!latestRun?.id || obsBusy[code]) return
    setObsBusy(s => ({ ...s, [code]: true }))
    try {
      const { error } = await supabase.rpc('robo_bp_set_control_observation_status', { p_run_id: latestRun.id, p_code: code, p_status: toStatus })
      if (error) throw new Error(error.message || 'fel')
      await loadLatestRun()
    } catch (e) {
      toast.error(/forbidden|42501|behörig/i.test(e?.message || '') ? 'Du saknar behörighet att ändra status.' : (e?.message || 'Kunde inte ändra status'))
    } finally {
      setObsBusy(s => { const n = { ...s }; delete n[code]; return n })
    }
  }

  if (!licensed) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="bg-white rounded-2xl p-8 text-center" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
          <i className="ti ti-lock text-3xl text-gray-300 block mb-2" />
          <div className="text-gray-700 font-medium">ROBO-bp ingår inte i din plan</div>
          <div className="text-sm text-gray-400 mt-1">Den betalda AI-modulen aktiveras per bolag. Kontakta BokPilot för att aktivera.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-2 mb-1">
        <i className="ti ti-robot text-xl text-violet-600" />
        <h1 className="text-lg font-semibold">ROBO-bp</h1>
      </div>
      <p className="text-[13px] text-gray-500 mb-4">Redovisningskonsultens AI-kollega för granskning, avvikelseanalys och förklaringar. Bokför, ändrar eller godkänner aldrig något – allt kräver mänsklig granskning.</p>

      <div role="tablist" aria-label="ROBO-bp" className="flex flex-wrap gap-1 border-b mb-4" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-[13px] font-medium flex items-center gap-1.5 border-b-2 -mb-px ${tab === t.key ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <i className={`ti ${t.icon}`} /> {t.label}
            {t.key === 'kontroller' && openChecks > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">{openChecks}</span>}
          </button>
        ))}
      </div>

      {tab === 'assistent' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
            <div className="text-[15px] font-medium text-gray-900 mb-1">Fråga ROBO-bp om bokföringen</div>
            <p className="text-[13px] text-gray-500 mb-3">Ställ frågor om konton, verifikationer, moms, nyckeltal och rapporter. Svaren bygger på ditt bolags data och anger källa, underlag och confidence. ROBO-bp föreslår kontrollpunkter – aldrig automatiska bokningar.</p>
            <button onClick={() => open()} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-medium hover:brightness-110 inline-flex items-center gap-1.5">
              <i className="ti ti-robot" /> Öppna ROBO-bp
            </button>
          </div>
          <div className="bg-white rounded-2xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
            <div className="text-[13px] font-medium text-gray-700 mb-2">Rekommenderade frågor</div>
            <div className="flex flex-wrap gap-2">
              {PROMPTS.map((p, i) => (
                <button key={i} onClick={() => open()} className="text-[12px] text-left px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-violet-50 hover:border-violet-200">
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'kontroller' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[15px] font-medium text-gray-900">Bokföringskontroll</span>
              <button onClick={runControl} disabled={running}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 inline-flex items-center gap-1.5">
                {running ? <><i className="ti ti-loader animate-spin" /> Kör…</> : <><i className="ti ti-shield-search" /> Ny bokföringskontroll</>}
              </button>
            </div>
            <p className="text-[13px] text-gray-500">Deterministisk kontroll av bokföringen (obalans, saknade beskrivningar, förfallna fakturor m.m.). Ingen AI, ingen bokföring ändras.</p>

            {latestRun ? (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-2">
                  <i className="ti ti-clock" /> Senaste kontroll: {String(latestRun.started_at || '').slice(0, 16).replace('T', ' ')}
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold" data-testid="deviation-count">{latestRun.summary?.deviationCount ?? 0} avvikelser</span>
                </div>
                <div className="space-y-1.5" data-testid="control-observations">
                  {(latestRun.summary?.observations || []).map((o, i) => {
                    const m = RISK_META[o.severity] || { label: o.severity, color: '#6b7280' }
                    const st = o.status || 'open'
                    const busy = !!obsBusy[o.code]
                    return (
                      <div key={i} data-testid={`obs-${o.code}`} className="rounded-lg p-2" style={{ background: 'rgba(0,0,0,0.02)' }}>
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ background: m.color }}>{m.label}</span>
                          <span className="text-[12px] text-gray-800 flex-1">{o.text}</span>
                          {st === 'resolved' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold shrink-0">Löst</span>}
                          {st === 'dismissed' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 font-semibold shrink-0">Inte ett problem</span>}
                          <span className="text-[10px] text-gray-400 shrink-0">{o.code}</span>
                        </div>
                        <div className="flex gap-1 mt-1.5">
                          {st === 'open' ? (
                            <>
                              <button disabled={busy} onClick={() => setObservationStatus(o.code, 'resolved')} className="text-[11px] px-2 py-0.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-60">Markera som löst</button>
                              <button disabled={busy} onClick={() => setObservationStatus(o.code, 'dismissed')} className="text-[11px] px-2 py-0.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">Inte ett problem</button>
                            </>
                          ) : (
                            <button disabled={busy} onClick={() => setObservationStatus(o.code, 'open')} className="text-[11px] px-2 py-0.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60">Ångra markering</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {(latestRun.summary?.observations || []).length === 0 && (
                    <div className="text-[12px] text-gray-400">Inga avvikelser hittades i senaste kontrollen.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-gray-400">Ingen kontroll körd ännu. Klicka "Ny bokföringskontroll".</div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-5" style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[15px] font-medium text-gray-900">Kontrollpunkter</span>
              <span className="text-[12px] text-gray-400">{openChecks == null ? '' : `${openChecks} öppna`}</span>
            </div>
            <p className="text-[13px] text-gray-500 mb-3">Följ upp kontrollpunkter som skapats från ROBO-bp:s findings och observationer. Ingen bokföring ändras.</p>
            <button onClick={() => navigate('/robo-bp/kontroller')} className="px-4 py-2 rounded-lg border border-violet-200 text-violet-700 text-sm font-medium hover:bg-violet-50 inline-flex items-center gap-1.5">
              <i className="ti ti-checklist" /> Öppna kontrollpunkter
            </button>
          </div>
        </div>
      )}

      {tab === 'rapporter' && (
        <ComingSoon icon="ti-chart-bar" title="Rapporter" text="Rapporter byggs i senare etapp." />
      )}
      {tab === 'dokument' && (
        <ComingSoon icon="ti-files" title="Dokument" beta text="Dokumentstöd kommer i en senare etapp. Ingen uppladdning eller RAG i denna etapp." />
      )}
      {tab === 'installningar' && (
        <ComingSoon icon="ti-settings" title="Inställningar" text="Kontrollinställningar byggs i senare etapp." />
      )}
    </div>
  )
}
