import { BRAND } from '../lib/brand'

// "Under uppbyggnad"-sida som visas publikt på bokpilot.se medan produkten
// fortfarande utvecklas. Medvetet UTAN väg in i appen (appen nås bara via
// app.bokpilot.se). Vi som utvecklar kan förhandsvisa riktiga landningssidan
// via ?landing och appen via app-subdomänen.
export default function ComingSoon() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/70 to-white" />

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-xl text-center py-20">
          <div className="text-2xl font-bold tracking-tight mb-8">{BRAND.appName}</div>

          <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-100/70 rounded-full px-3 py-1 mb-7">
            <i className="ti ti-tools" /> Under uppbyggnad
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
            Något nytt är på väg
          </h1>
          <p className="mt-5 text-lg text-gray-500">
            Vi bygger {BRAND.appName} – en AI-driven bokföringstjänst för svenska företag
            och e-handlare. Snart öppnar vi portarna.
          </p>

          <div className="mt-9 inline-flex items-center gap-2 text-sm text-gray-400">
            <i className="ti ti-sparkles text-blue-500" /> Bokföring på autopilot – kommer snart
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {BRAND.companyName}
      </footer>
    </div>
  )
}
