// ROBO-bp Etapp B – samlad tabbad huvudvy (/robo-bp). ENDAST UI-skelett + routing, ingen ny affärslogik.
// Licensgrindad (robo_bp). Återanvänder befintlig panel (useRoboBp.open) och befintlig /robo-bp/kontroller.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRoboBp } from '../context/RoboBpContext'
import { supabase } from '../lib/supabase'

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

  // Antal öppna kontrollpunkter via befintlig RLS SELECT (ingen ny kontrollmotor).
  const loadOpenChecks = useCallback(async () => {
    if (!company?.id) { setOpenChecks(null); return }
    const { count } = await supabase.from('robo_bp_checks')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id).in('status', ['open', 'in_progress'])
    setOpenChecks(count ?? 0)
  }, [company?.id])
  useEffect(() => { if (licensed) loadOpenChecks() }, [licensed, loadOpenChecks])

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
