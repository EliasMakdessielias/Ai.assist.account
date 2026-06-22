// Sidkontext för supportwidgeten: när chatten öppnas kopplas användarens aktuella arbetsvy
// automatiskt (route, läsbart sidnamn, öppet objekt-id, användare, företag, roll, tid). Detta
// skickas till AI:n (aktuell vy) och bifogas i ärendetexten vid eskalering till mänsklig support.

// Route → läsbart sidnamn. Mer specifika mönster först (ny/objekt före listvy).
const ROUTE_LABELS = [
  [/^\/$/, 'Översikt'],
  [/^\/bokforing\/ny/, 'Bokföring – Skapa verifikation'],
  [/^\/bokforing\/[^/]+$/, 'Bokföring – Verifikation'],
  [/^\/bokforing/, 'Bokföring'],
  [/^\/inkorg/, 'Inkorg'],
  [/^\/leverantorsfakturor\/ny/, 'Leverantörsfaktura – Ny'],
  [/^\/leverantorsfakturor\/[^/]+$/, 'Leverantörsfaktura'],
  [/^\/leverantorsfakturor/, 'Leverantörsfakturor'],
  [/^\/fakturor\/ny/, 'Kundfaktura – Ny'],
  [/^\/fakturor\/[^/]+$/, 'Kundfaktura'],
  [/^\/fakturor/, 'Fakturor'],
  [/^\/kassa-bank/, 'Kassa & bank'],
  [/^\/lon\/anstallda/, 'Lön – Anställda'],
  [/^\/lon/, 'Lön – Löner'],
  [/^\/moms/, 'Moms'],
  [/^\/rapporter/, 'Rapporter'],
  [/^\/kunder/, 'Kunder'],
  [/^\/leverantorer/, 'Leverantörer'],
  [/^\/produkter/, 'Produkter'],
  [/^\/granskning/, 'Granskning'],
  [/^\/regelverk/, 'Regelverk'],
  [/^\/kontoanalys/, 'Kontoanalys'],
  [/^\/assistent/, 'AI-assistent'],
  [/^\/ekonomichef/, 'Ekonomichef'],
  [/^\/help/, 'Handbok'],
  [/^\/support/, 'Support'],
  [/^\/installningar\/kontoplan/, 'Inställningar – Kontoplan'],
  [/^\/installningar\/team/, 'Inställningar – Team'],
  [/^\/installningar/, 'Inställningar'],
  [/^\/admin\/support/, 'Adminsupport'],
  [/^\/admin/, 'Administration'],
]

// Läsbart sidnamn för en route.
export function pageLabel(pathname) {
  const p = String(pathname || '/')
  for (const [re, label] of ROUTE_LABELS) if (re.test(p)) return label
  return 'BokPilot'
}

// Öppet objekt-id ur route (sista uuid-/numeriska segmentet), t.ex. faktura-/verifikations-id.
export function openObjectId(pathname) {
  const seg = String(pathname || '').split('/').filter(Boolean).pop() || ''
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}$/.test(seg)) return seg
  if (/^\d+$/.test(seg)) return seg
  return null
}

// Full arbetskontext som fångas när supportchatten öppnas.
export function workContext({ pathname, user, company, role } = {}) {
  return {
    route: String(pathname || '/'),
    sida: pageLabel(pathname),
    objektId: openObjectId(pathname),
    namn: user?.email || null,
    epost: user?.email || null,
    company_id: company?.id || null,
    foretag: company?.name || null,
    roll: role || 'user',
    timestamp: new Date().toISOString(),
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  }
}

// Kort mening till AI:n ("aktuell vy") och som diskret rad i panelen.
export function contextSummary(ctx) {
  if (!ctx) return ''
  let s = `Användaren befinner sig på ${ctx.sida}`
  if (ctx.objektId) s += ` och arbetar med objekt ${ctx.objektId}`
  return s + '.'
}

// Strukturerat kontextblock som bifogas i ärendetexten vid eskalering.
export function contextBlock(ctx) {
  if (!ctx) return ''
  return [
    `Vy: ${ctx.sida} (${ctx.route})`,
    ctx.objektId && `Öppet objekt: ${ctx.objektId}`,
    `Företag: ${ctx.foretag || '—'}`,
    `Användare: ${ctx.epost || '—'}`,
    `Roll: ${ctx.roll}`,
    `Webbläsare: ${ctx.browser || '—'}`,
    `Tid: ${ctx.timestamp}`,
  ].filter(Boolean).join('\n')
}
