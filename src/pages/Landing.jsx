import { useState } from 'react'
import { BRAND } from '../lib/brand'
import { appLoginUrl } from '../lib/host'

// Marknads-/skalsida på bokpilot.se. Unik blandning (ej kopia) inspirerad av
// svenska bokföringstjänster, med AI-copilot-vinkel + e-handelspaket.
// CTA:er slussar till appen (app.bokpilot.se/login).

const FEATURES = [
  { icon: 'ti-sparkles', title: 'AI-assistent', text: 'Fråga om din ekonomi i klartext och få svar direkt – som att ha en redovisningskonsult i fickan.' },
  { icon: 'ti-file-import', title: 'Fakturatolkning', text: 'Fota eller mejla in underlaget. AI:n läser, konterar och föreslår rätt konto åt dig.' },
  { icon: 'ti-shield-check', title: 'AI-granskning', text: 'Löpande kontroll mot bokföringslagen och god redovisningssed – fel fångas innan de blir problem.' },
  { icon: 'ti-chart-arcs', title: 'AI-ekonomichef', text: 'Månadsrapport med nyckeltal, trender och en skriven kommentar om hur det faktiskt går.' },
  { icon: 'ti-building-bank', title: 'Kassa & bank', text: 'Smart matchning av banktransaktioner mot fakturor och kvitton. Mindre prickande, mer flyt.' },
  { icon: 'ti-receipt-tax', title: 'Moms & bokslut', text: 'Momsdeklaration med rätt SKV-rutor och en kontoplan enligt BAS 2026 – färdigt att lämna in.' },
]

const STEPS = [
  { n: '1', icon: 'ti-plug-connected', title: 'Koppla ihop', text: 'Anslut bank och ladda in dina underlag. Migrering från andra system går smidigt.' },
  { n: '2', icon: 'ti-wand', title: 'Låt AI:n jobba', text: 'BokPilot tolkar, konterar och granskar automatiskt. Du behöver inte kunna debet och kredit.' },
  { n: '3', icon: 'ti-chart-dots', title: 'Få full koll', text: 'Realtidsöverblick, rapporter och en AI-ekonomichef som säger till när något behöver din blick.' },
]

const PLANS = [
  { name: 'Start', price: '99', tagline: 'Enskild firma & nystartat', features: ['Löpande bokföring', 'Fakturering', 'Momsrapport', 'BAS 2026-kontoplan', '1 användare'], cta: 'Kom igång' },
  { name: 'Plus', price: '249', tagline: 'Växande företag', popular: true, features: ['Allt i Start', 'AI-assistent', 'AI-fakturatolkning', 'Kassa & bank med smart matchning', 'Obegränsade verifikationer'], cta: 'Kom igång' },
  { name: 'Pro', price: '499', tagline: 'Byrå & flera bolag', features: ['Allt i Plus', 'AI-granskning', 'AI-ekonomichef', 'Flera bolag & team', 'Behörigheter', 'Prioriterad support'], cta: 'Kom igång' },
]

const ECOM_PACKAGES = [
  { name: 'E-handel Bas', price: '199', volume: 'Upp till 250 ordrar/mån', features: ['1 butikskoppling (Shopify eller WooCommerce)', 'Automatisk försäljningsbokföring', 'Moms på varje order', 'Daglig synk'], cta: 'Välj Bas' },
  { name: 'E-handel Växa', price: '399', volume: 'Upp till 1 500 ordrar/mån', popular: true, features: ['Flera butikskopplingar', 'Stripe, Klarna & PayPal', 'Avgifts- & utbetalningshantering', 'OSS-moms (EU-försäljning)', 'Lageravstämning'], cta: 'Välj Växa' },
  { name: 'E-handel Skala', price: '799', volume: 'Obegränsade ordrar', features: ['Alla integrationer', 'Marknadsplatser (Amazon, CDON)', 'Multivaluta', 'Automatiska avstämningar', 'Dedikerad kontakt'], cta: 'Välj Skala' },
]

const INTEGRATIONS = ['Shopify', 'WooCommerce', 'Stripe', 'Klarna', 'PayPal', 'Fortnox-import', 'Amazon', 'CDON']

const FAQ = [
  { q: 'Behöver jag kunna bokföring för att använda BokPilot?', a: 'Nej. AI:n konterar och granskar åt dig, och förklarar i klartext. Du får full koll utan att kunna debet och kredit – men allt följer BAS 2026 och bokföringslagen.' },
  { q: 'Hur funkar e-handelstjänsten?', a: 'Du kopplar din butik (t.ex. Shopify eller WooCommerce) och dina betalleverantörer. BokPilot bokför försäljning, avgifter och moms automatiskt – inklusive OSS för EU-försäljning. Välj paket efter hur många ordrar du har i månaden.' },
  { q: 'Kan jag byta från Fortnox, Visma eller Bokio?', a: 'Ja. Du kan importera kontoplan och historik via SIE-filer, så kommer du igång utan att tappa data.' },
  { q: 'Är min data säker?', a: 'All data lagras krypterat hos Supabase i EU med Row Level Security – varje företag ser bara sin egen information. Verifikationer låses efter bokföring enligt lag.' },
  { q: 'Kostar det något att testa?', a: 'Du provar BokPilot gratis i 30 dagar. Inga bindningstider – avsluta när du vill.' },
]

function Price({ value }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-4xl font-bold tracking-tight">{value}</span>
      <span className="text-gray-400 text-sm font-medium">kr/mån</span>
    </div>
  )
}

function PlanCard({ p }) {
  const loginUrl = appLoginUrl()
  return (
    <div className={`relative flex flex-col rounded-2xl bg-white p-6 ${p.popular ? 'ring-2 ring-blue-600 shadow-xl' : 'shadow-sm'}`}
      style={{ border: p.popular ? 'none' : '0.5px solid rgba(0,0,0,0.10)' }}>
      {p.popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-semibold px-3 py-1 rounded-full">Populärast</span>}
      <div className="font-semibold text-lg">{p.name}</div>
      {p.tagline && <div className="text-sm text-gray-500 mb-4">{p.tagline}</div>}
      {p.volume && <div className="text-sm text-gray-500 mb-4">{p.volume}</div>}
      <Price value={p.price} />
      <ul className="mt-5 space-y-2.5 flex-1">
        {p.features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
            <i className="ti ti-check text-blue-600 mt-0.5 shrink-0" /> {f}
          </li>
        ))}
      </ul>
      <a href={loginUrl}
        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${p.popular ? 'bg-blue-700 text-white hover:bg-blue-800' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}>
        {p.cta} <i className="ti ti-arrow-right" />
      </a>
    </div>
  )
}

export default function Landing() {
  const loginUrl = appLoginUrl()
  const [openFaq, setOpenFaq] = useState(0)
  const year = new Date().getFullYear()

  return (
    <div className="bg-white text-gray-900" style={{ scrollBehavior: 'smooth' }}>
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur border-b" style={{ borderColor: 'rgba(0,0,0,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight">{BRAND.appName}</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-gray-600">
            <a href="#funktioner" className="hover:text-gray-900">Funktioner</a>
            <a href="#ehandel" className="hover:text-gray-900">E-handel</a>
            <a href="#priser" className="hover:text-gray-900">Priser</a>
            <a href="#faq" className="hover:text-gray-900">Frågor</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href={loginUrl} className="hidden sm:inline text-sm font-medium text-gray-600 hover:text-gray-900">Logga in</a>
            <a href={loginUrl} className="inline-flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
              Kom igång <i className="ti ti-arrow-right" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/70 to-white" />
        <div className="max-w-6xl mx-auto px-5 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-100/70 rounded-full px-3 py-1 mb-6">
            <i className="ti ti-sparkles" /> Bokföring på autopilot
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05] max-w-3xl mx-auto">
            Din AI-copilot för<br className="hidden sm:block" /> företagets bokföring
          </h1>
          <p className="mt-6 text-lg text-gray-500 max-w-2xl mx-auto">
            {BRAND.appName} läser dina underlag, konterar, granskar och rapporterar – automatiskt.
            Du driver företaget, AI:n sköter siffrorna. Byggt för svenska företag och e-handlare.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href={loginUrl} className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white font-medium text-[15px] rounded-lg px-7 py-3 shadow-sm transition-colors">
              Prova gratis i 30 dagar <i className="ti ti-arrow-right" />
            </a>
            <a href="#funktioner" className="inline-flex items-center gap-2 text-gray-700 font-medium text-[15px] rounded-lg px-5 py-3 hover:bg-gray-100 transition-colors">
              Se hur det funkar
            </a>
          </div>
          <p className="mt-3 text-xs text-gray-400">Ingen bindningstid · Avsluta när du vill</p>

          {/* Produkt-preview */}
          <div className="mt-14 max-w-4xl mx-auto">
            <div className="rounded-2xl bg-white shadow-2xl overflow-hidden text-left" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="h-9 bg-gray-50 border-b flex items-center gap-1.5 px-4" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" /><span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
                <span className="ml-3 text-[11px] text-gray-400">app.bokpilot.se</span>
              </div>
              <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[['Intäkter', '482 300 kr'], ['Resultat', '128 940 kr'], ['Moms att betala', '31 050 kr'], ['Obetalt', '2 fakturor']].map(([k, v]) => (
                  <div key={k} className="rounded-xl p-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                    <div className="text-[11px] text-gray-400 uppercase tracking-wide">{k}</div>
                    <div className="text-lg font-semibold mt-1">{v}</div>
                  </div>
                ))}
                <div className="col-span-2 sm:col-span-4 rounded-xl p-4 bg-blue-50/60 flex items-start gap-3">
                  <i className="ti ti-sparkles text-blue-600 mt-0.5" />
                  <div className="text-sm text-gray-600"><b className="text-gray-900">AI-ekonomichef:</b> Resultatet är 18 % bättre än förra månaden. Likviditeten är god – överväg att betala in extra preliminärskatt.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust-rad */}
      <section className="border-y bg-gray-50/60" style={{ borderColor: 'rgba(0,0,0,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-gray-500">
          <span className="flex items-center gap-1.5"><i className="ti ti-flag text-blue-600" /> Byggt för svenska företag</span>
          <span className="flex items-center gap-1.5"><i className="ti ti-book text-blue-600" /> BAS 2026 & bokföringslagen</span>
          <span className="flex items-center gap-1.5"><i className="ti ti-lock text-blue-600" /> Krypterad data i EU</span>
          <span className="flex items-center gap-1.5"><i className="ti ti-refresh text-blue-600" /> Migrering via SIE</span>
        </div>
      </section>

      {/* Funktioner */}
      <section id="funktioner" className="scroll-mt-20 max-w-6xl mx-auto px-5 py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Allt företaget behöver – drivet av AI</h2>
          <p className="mt-4 text-gray-500">Sex verktyg som tar bort tråket ur bokföringen och ger dig kontrollen tillbaka.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl p-6 hover:shadow-md transition-shadow" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mb-4">
                <i className={`ti ${f.icon} text-xl`} />
              </div>
              <div className="font-semibold text-lg">{f.title}</div>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Så funkar det */}
      <section className="bg-gray-50/70 border-y" style={{ borderColor: 'rgba(0,0,0,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Igång på tre steg</h2>
            <p className="mt-4 text-gray-500">Från rörigt till ordning – utan krångel.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map(s => (
              <div key={s.n} className="relative bg-white rounded-2xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-8 h-8 rounded-full bg-blue-700 text-white text-sm font-semibold flex items-center justify-center">{s.n}</span>
                  <i className={`ti ${s.icon} text-xl text-blue-600`} />
                </div>
                <div className="font-semibold text-lg">{s.title}</div>
                <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* E-handel */}
      <section id="ehandel" className="scroll-mt-20 max-w-6xl mx-auto px-5 py-20">
        <div className="text-center max-w-2xl mx-auto mb-4">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-full px-3 py-1 mb-4">
            <i className="ti ti-shopping-cart" /> Nyhet
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Bokföring för e-handel</h2>
          <p className="mt-4 text-gray-500">
            Koppla din butik och dina betalleverantörer – {BRAND.appName} bokför försäljning, avgifter och moms
            automatiskt, inklusive OSS för EU-försäljning. Välj paket efter hur mycket du säljer.
          </p>
        </div>

        {/* Integrationslogos (text) */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 my-9">
          {INTEGRATIONS.map(i => (
            <span key={i} className="text-sm text-gray-600 bg-gray-100 rounded-full px-3.5 py-1.5">{i}</span>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-5 mt-6">
          {ECOM_PACKAGES.map(p => <PlanCard key={p.name} p={p} />)}
        </div>
        <p className="text-center text-xs text-gray-400 mt-6">Priser exkl. moms. E-handelspaket läggs till ovanpå din BokPilot-plan.</p>
      </section>

      {/* Priser */}
      <section id="priser" className="scroll-mt-20 bg-gray-50/70 border-y" style={{ borderColor: 'rgba(0,0,0,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 py-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Enkla priser som växer med dig</h2>
            <p className="mt-4 text-gray-500">Alla planer ingår 30 dagar gratis. Inga bindningstider.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {PLANS.map(p => <PlanCard key={p.name} p={p} />)}
          </div>
          <p className="text-center text-xs text-gray-400 mt-6">Priser exkl. moms. Byrå med många bolag? <a href={loginUrl} className="text-blue-700 hover:underline">Hör av dig.</a></p>
        </div>
      </section>

      {/* CTA-band */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="rounded-3xl bg-blue-700 text-white px-8 py-14 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Låt AI:n ta tråket.<br className="hidden sm:block" /> Du tar besluten.</h2>
          <p className="mt-4 text-blue-100 max-w-xl mx-auto">Kom igång på minuter. Prova {BRAND.appName} gratis i 30 dagar – ingen bindningstid.</p>
          <a href={loginUrl} className="mt-8 inline-flex items-center gap-2 bg-white text-blue-700 font-semibold text-[15px] rounded-lg px-7 py-3 hover:bg-blue-50 transition-colors">
            Kom igång nu <i className="ti ti-arrow-right" />
          </a>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 max-w-3xl mx-auto px-5 pb-20">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-10">Vanliga frågor</h2>
        <div className="space-y-3">
          {FAQ.map((item, i) => (
            <div key={i} className="rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <button onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left font-medium hover:bg-gray-50">
                {item.q}
                <i className={`ti ti-chevron-down text-gray-400 transition-transform shrink-0 ${openFaq === i ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === i && <div className="px-5 pb-4 text-sm text-gray-500 leading-relaxed">{item.a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="max-w-6xl mx-auto px-5 py-12 grid sm:grid-cols-4 gap-8 text-sm">
          <div className="sm:col-span-2">
            <div className="text-lg font-bold tracking-tight">{BRAND.appName}</div>
            <p className="mt-2 text-gray-500 max-w-xs">{BRAND.description}</p>
          </div>
          <div>
            <div className="font-semibold mb-3 text-gray-900">Produkt</div>
            <ul className="space-y-2 text-gray-500">
              <li><a href="#funktioner" className="hover:text-gray-900">Funktioner</a></li>
              <li><a href="#ehandel" className="hover:text-gray-900">E-handel</a></li>
              <li><a href="#priser" className="hover:text-gray-900">Priser</a></li>
              <li><a href={loginUrl} className="hover:text-gray-900">Logga in</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3 text-gray-900">Företag</div>
            <ul className="space-y-2 text-gray-500">
              <li>{BRAND.companyName}</li>
              <li><a href="#faq" className="hover:text-gray-900">Vanliga frågor</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t px-5 py-5 text-center text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          © {year} {BRAND.companyName} · {BRAND.appName}
        </div>
      </footer>
    </div>
  )
}
