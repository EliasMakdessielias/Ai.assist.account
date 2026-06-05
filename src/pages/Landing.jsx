import { BRAND } from '../lib/brand'
import { appLoginUrl } from '../lib/host'

// Skal-/marknadssida som visas på bokpilot.se. Innehåller en CTA-knapp som
// slussar vidare till appen (app.bokpilot.se) där inloggning sker.
export default function Landing() {
  const loginUrl = appLoginUrl()

  const features = [
    { icon: 'ti-sparkles', title: 'AI-assistent', text: 'Ställ frågor om din bokföring och få svar direkt.' },
    { icon: 'ti-file-import', title: 'Automatisk fakturatolkning', text: 'Ladda upp underlag – AI:n konterar åt dig.' },
    { icon: 'ti-shield-check', title: 'AI-granskning', text: 'Kontroll mot bokföringslagen och god redovisningssed.' },
    { icon: 'ti-chart-arcs', title: 'AI-ekonomichef', text: 'Månadsrapport med nyckeltal och kommentar.' },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 sm:px-10 h-16 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight">{BRAND.appName}</span>
          <span className="hidden sm:inline text-[11px] text-gray-400">{BRAND.tagline}</span>
        </div>
        <a href={loginUrl} className="text-sm font-medium text-blue-700 hover:underline flex items-center gap-1.5">
          Logga in <i className="ti ti-arrow-right" />
        </a>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-3xl text-center py-20">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-full px-3 py-1 mb-6">
            <i className="ti ti-sparkles" /> Bokföring med AI
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
            Smartare bokföring för svenska företag
          </h1>
          <p className="mt-5 text-lg text-gray-500 max-w-xl mx-auto">
            {BRAND.appName} automatiserar din bokföring med AI – fakturatolkning,
            smart kontering och granskning. Mindre pappersarbete, mer kontroll.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <a href={loginUrl}
              className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white font-medium text-[15px] rounded-lg px-7 py-3 transition-colors shadow-sm">
              Logga in <i className="ti ti-arrow-right" />
            </a>
          </div>
          <p className="mt-3 text-xs text-gray-400">Du slussas vidare till app.bokpilot.se</p>

          {/* Features */}
          <div className="mt-16 grid sm:grid-cols-2 gap-4 text-left">
            {features.map(f => (
              <div key={f.title} className="flex items-start gap-3 rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <i className={`ti ${f.icon} text-lg`} />
                </div>
                <div>
                  <div className="font-medium text-[15px]">{f.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{f.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t px-6 sm:px-10 py-6 text-xs text-gray-400 flex flex-col sm:flex-row items-center justify-between gap-2" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <span>© {new Date().getFullYear()} {BRAND.companyName}</span>
        <a href={loginUrl} className="text-blue-700 hover:underline font-medium">Till appen →</a>
      </footer>
    </div>
  )
}
