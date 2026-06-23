// AI Bokslut & Årsredovisning – typer, konstanter, färger och hjälpfunktioner (klient).
// Regelmotorn, behörighet och licens är auktoritativa i databasen (RPC + RLS + has_ai_feature).
// Arkitektur: UI ⇄ lib ⇄ SECURITY DEFINER-RPC. AI kopplas aldrig direkt till UI (AI-edge i Steg 2).

// Licens-/paketnyckel.
export const FEATURE_KEY = 'ai_bokslut_arsredovisning'
export const NOT_LICENSED_MESSAGE = 'AI Bokslut & Årsredovisning ingår inte i din nuvarande plan.'
export const AI_WARNING = 'AI-genererat utkast. Måste granskas och godkännas av redovisningskonsult innan användning.'

// Regelverk: K2 nu, K3 förberett (utbyggbart utan omskrivning).
export const REGELVERK = ['K2']
export const REGELVERK_PLANNED = ['K3']

// Behörighetsnycklar (de ursprungliga typerna; rollmappning enforced i DB, se nedan).
export const PERMISSIONS = {
  READ: 'ai_bokslut_read',
  RUN: 'ai_bokslut_run_analysis',
  REVIEW: 'ai_bokslut_review',
  APPROVE: 'ai_bokslut_approve',
  CREATE_DRAFT: 'ai_bokslut_create_draft_adjustment',
}

// Rollbaserad behörighet – AUKTORITATIVT i databasen via RPC bokslut_can / bokslut_my_permissions
// (mot user_companies.role). Detta är endast en spegling för UI/dokumentation.
// admin = full; member = läsa/köra analys/tilldela/kommentera, men EJ markera klar/ignorera/godkänna.
export const BOKSLUT_ACTIONS = ['read', 'run_analysis', 'assign_check', 'comment_check', 'resolve_check', 'ignore_check', 'approve_later', 'create_draft_later']
export const BOKSLUT_ROLE_ACTIONS = {
  admin: ['read', 'run_analysis', 'assign_check', 'comment_check', 'resolve_check', 'ignore_check', 'approve_later', 'create_draft_later'],
  member: ['read', 'run_analysis', 'assign_check', 'comment_check'],
}

// Manuella statusövergångar som admin får sätta (enforced i RPC set_bokslut_engagement_status).
// 'last' låser engagemanget – inga ändringar därefter (endast läsning).
export const ADMIN_SETTABLE_STATUSES = [
  { key: 'klar_for_konsult', label: 'Klar för konsult', icon: 'ti-user-check' },
  { key: 'godkand', label: 'Godkänn', icon: 'ti-circle-check' },
  { key: 'avvisad', label: 'Avvisa', icon: 'ti-circle-x' },
  { key: 'last', label: 'Lås', icon: 'ti-lock' },
]

// Engagemangsstatus (översikt).
export const ENGAGEMENT_STATUS_META = {
  ej_paborjad: { label: 'Ej påbörjad', chip: 'bg-gray-100 text-gray-500' },
  pagar: { label: 'Pågår', chip: 'bg-blue-100 text-blue-700' },
  kraver_granskning: { label: 'Kräver granskning', chip: 'bg-red-100 text-red-700' },
  klar_for_konsult: { label: 'Klar för redovisningskonsult', chip: 'bg-green-100 text-green-700' },
  godkand: { label: 'Godkänd', chip: 'bg-green-100 text-green-700' },
  avvisad: { label: 'Avvisad', chip: 'bg-amber-100 text-amber-700' },
  last: { label: 'Låst', chip: 'bg-gray-200 text-gray-600' },
}

// Risknivå.
export const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
export const RISK_META = {
  critical: { label: 'Kritisk', dot: '#dc2626', chip: 'bg-red-100 text-red-700', row: 'rgba(220,38,38,0.06)' },
  high: { label: 'Hög', dot: '#f97316', chip: 'bg-orange-100 text-orange-700', row: 'rgba(249,115,22,0.05)' },
  medium: { label: 'Medel', dot: '#3b82f6', chip: 'bg-blue-100 text-blue-700', row: 'transparent' },
  low: { label: 'Låg', dot: '#9ca3af', chip: 'bg-gray-100 text-gray-500', row: 'transparent' },
}
export const riskRank = r => RISK_ORDER[r] ?? 9

// Status per kontrollpunkt.
export const CHECK_STATUS_META = {
  open: { label: 'Öppen', chip: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'Pågår', chip: 'bg-amber-100 text-amber-700' },
  needs_review: { label: 'Kräver granskning', chip: 'bg-purple-100 text-purple-700' },
  resolved: { label: 'Klar', chip: 'bg-green-100 text-green-700' },
  ignored: { label: 'Ignorerad', chip: 'bg-gray-100 text-gray-500' },
}
export const OPEN_CHECK_STATUSES = ['open', 'in_progress', 'needs_review']
export const isOpenCheck = s => OPEN_CHECK_STATUSES.includes(s)

// Kontrollområden i bokslutschecklistan (etiketter + gruppordning).
export const CHECKLIST_CATEGORIES = [
  { key: 'bankavstamning', label: 'Bankavstämning' },
  { key: 'moms', label: 'Moms' },
  { key: 'skattekonto', label: 'Skattekonto' },
  { key: 'kundfordringar', label: 'Kundfordringar' },
  { key: 'leverantorsskulder', label: 'Leverantörsskulder' },
  { key: 'anlaggningstillgangar', label: 'Anläggningstillgångar' },
  { key: 'avskrivningar', label: 'Avskrivningar' },
  { key: 'periodiseringar', label: 'Periodiseringar' },
  { key: 'lon_arbetsgivaravgift', label: 'Lön och arbetsgivaravgifter' },
  { key: 'skatt', label: 'Skatt' },
  { key: 'eget_kapital', label: 'Eget kapital' },
  { key: 'arets_resultat', label: 'Årets resultat' },
  { key: 'ovanliga_saldon', label: 'Ovanliga saldon' },
  { key: 'saknade_underlag', label: 'Saknade underlag' },
  { key: 'bokslutsverifikationer', label: 'Bokslutsverifikationer' },
  { key: 'noter', label: 'Noter till årsredovisning' },
]
export const CATEGORY_LABEL = Object.fromEntries(CHECKLIST_CATEGORIES.map(c => [c.key, c.label]))
export const categoryLabel = k => CATEGORY_LABEL[k] || k

// Sortera kontroller: risk först, sedan kategori, sedan titel.
export function sortChecks(checks) {
  return [...(checks || [])].sort((a, b) =>
    riskRank(a.risk_level) - riskRank(b.risk_level) ||
    (a.category || '').localeCompare(b.category || '') ||
    (a.title || '').localeCompare(b.title || '', 'sv'))
}

// Gruppera kontroller per kontrollområde (för checklistevy).
export function groupByCategory(checks) {
  const map = {}
  for (const c of checks || []) (map[c.category] = map[c.category] || []).push(c)
  return CHECKLIST_CATEGORIES.filter(cat => map[cat.key]?.length).map(cat => ({ ...cat, items: sortChecks(map[cat.key]) }))
}

// Bokslutsbilagor (Steg 2A): typer, statusar och mappning kontrollområde → bilagetyp.
export const ATTACHMENT_TYPES = [
  { key: 'bank', label: 'Bank' },
  { key: 'kundfordringar', label: 'Kundfordringar' },
  { key: 'leverantorsskulder', label: 'Leverantörsskulder' },
  { key: 'moms', label: 'Moms' },
  { key: 'skattekonto', label: 'Skattekonto' },
  { key: 'anlaggningstillgangar', label: 'Anläggningstillgångar' },
  { key: 'avskrivningar', label: 'Avskrivningar' },
  { key: 'periodiseringar', label: 'Periodiseringar' },
  { key: 'skatt', label: 'Skatt' },
  { key: 'eget_kapital', label: 'Eget kapital' },
  { key: 'arets_resultat', label: 'Årets resultat' },
  { key: 'ovrigt', label: 'Övrigt' },
]
export const ATTACHMENT_TYPE_LABEL = Object.fromEntries(ATTACHMENT_TYPES.map(t => [t.key, t.label]))
export const ATTACHMENT_STATUS_META = {
  draft: { label: 'Utkast', chip: 'bg-gray-100 text-gray-500' },
  needs_review: { label: 'Kräver granskning', chip: 'bg-purple-100 text-purple-700' },
  reviewed: { label: 'Granskad', chip: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Godkänd', chip: 'bg-green-100 text-green-700' },
  ignored: { label: 'Ignorerad', chip: 'bg-gray-100 text-gray-500' },
}
// Kontrollkategori → bilagetyp (för "Skapa bilaga från kontroll").
export const CATEGORY_TO_ATTACHMENT_TYPE = {
  bankavstamning: 'bank', kundfordringar: 'kundfordringar', leverantorsskulder: 'leverantorsskulder',
  moms: 'moms', skattekonto: 'skattekonto', anlaggningstillgangar: 'anlaggningstillgangar',
  avskrivningar: 'avskrivningar', periodiseringar: 'periodiseringar', skatt: 'skatt',
  eget_kapital: 'eget_kapital', arets_resultat: 'arets_resultat',
}
export const attachmentTypeForCategory = c => CATEGORY_TO_ATTACHMENT_TYPE[c] || 'ovrigt'
export const hasDifferens = a => a && a.differens !== null && a.differens !== undefined && Math.abs(Number(a.differens)) > 0.5

// AI-förslag (Steg 2B): granskningsstöd. Bokför aldrig, kräver mänsklig bedömning.
export const SUGGESTION_TYPE_LABEL = {
  risk_explanation: 'Riskförklaring', next_action: 'Nästa åtgärd', missing_documentation: 'Saknat underlag',
  attachment_review: 'Bilagegranskning', balance_issue: 'Balansavvikelse', vat_issue: 'Moms', tax_issue: 'Skatt',
  equity_issue: 'Eget kapital', payroll_issue: 'Lön', manual_review_required: 'Kräver manuell granskning',
}
export const AI_SUGGESTION_STATUS_META = {
  draft: { label: 'Utkast', chip: 'bg-gray-100 text-gray-500' },
  needs_review: { label: 'Kräver granskning', chip: 'bg-purple-100 text-purple-700' },
  accepted: { label: 'Accepterad', chip: 'bg-green-100 text-green-700' },
  rejected: { label: 'Avvisad', chip: 'bg-red-100 text-red-700' },
  resolved: { label: 'Åtgärdad', chip: 'bg-green-100 text-green-700' },
  ignored: { label: 'Ignorerad', chip: 'bg-gray-100 text-gray-500' },
}
export const AI_SUGGESTION_WARNING = 'AI-förslag är granskningsstöd. De bokför inte och måste bedömas av behörig användare.'
export const confidencePct = c => (c === null || c === undefined) ? '–' : `${Math.round(Number(c) * 100)} %`

// K2-årsredovisningsutkast (Steg 2C-1): struktur. Bokför aldrig, lämnar inte in, godkänner inte automatiskt.
export const ANNUAL_REPORT_WARNING = 'AI-genererat årsredovisningsutkast. Måste granskas och godkännas av behörig redovisningskonsult innan användning. BokPilot lämnar inte in årsredovisningen automatiskt.'
export const NO_COMPARATIVE_MESSAGE = 'Jämförelsetal saknas eller kunde inte beräknas.'
export const DRAFT_STATUS_META = {
  draft: { label: 'Utkast', chip: 'bg-gray-100 text-gray-500' },
  needs_review: { label: 'Kräver granskning', chip: 'bg-purple-100 text-purple-700' },
  reviewed: { label: 'Granskad', chip: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Godkänd', chip: 'bg-green-100 text-green-700' },
  rejected: { label: 'Avvisad', chip: 'bg-red-100 text-red-700' },
  locked: { label: 'Låst', chip: 'bg-gray-200 text-gray-600' },
}
export const SECTION_STATUS_META = {
  needs_review: { label: 'Kräver granskning', chip: 'bg-purple-100 text-purple-700' },
  reviewed: { label: 'Granskad', chip: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Godkänd', chip: 'bg-green-100 text-green-700' },
  rejected: { label: 'Avvisad', chip: 'bg-red-100 text-red-700' },
}
// Sektionsordning + etiketter för K2-utkastet.
export const ANNUAL_REPORT_SECTIONS = [
  { key: 'forvaltningsberattelse', label: 'Förvaltningsberättelse' },
  { key: 'resultatrakning', label: 'Resultaträkning' },
  { key: 'balansrakning', label: 'Balansräkning' },
  { key: 'noter', label: 'Noter' },
  { key: 'faststallelseintyg', label: 'Fastställelseintyg' },
  { key: 'underskriftssida', label: 'Underskriftssida' },
]
export const SECTION_LABEL = Object.fromEntries(ANNUAL_REPORT_SECTIONS.map(s => [s.key, s.label]))
// RR/BR är strukturerad data från huvudboken – fält → svensk etikett (visas som tabell, ej fri AI-text).
export const STRUCTURED_FIELD_LABEL = {
  rorelsens_intakter: 'Rörelsens intäkter',
  rorelsens_kostnader: 'Rörelsens kostnader',
  finansiella_poster_och_skatt: 'Finansiella poster och skatt',
  arets_resultat: 'Årets resultat',
  summa_tillgangar: 'Summa tillgångar',
  eget_kapital_och_skulder: 'Eget kapital och skulder',
  balanskontroll_differens: 'Balanskontroll (differens)',
}
export const isDraftLocked = d => !!d && (d.status === 'locked')

// K2-validering (Steg 2C-2): granskningsstöd som spärrar godkännande/låsning. Ändrar aldrig bokföring.
export const VALIDATION_WARNING = 'Valideringen är ett kontrollstöd. Den ersätter inte redovisningskonsultens ansvar.'
export const VALIDATION_SEVERITY_META = {
  critical: { label: 'Kritisk', dot: '#dc2626', chip: 'bg-red-100 text-red-700' },
  high: { label: 'Hög', dot: '#f97316', chip: 'bg-orange-100 text-orange-700' },
  warning: { label: 'Varning', dot: '#3b82f6', chip: 'bg-blue-100 text-blue-700' },
  info: { label: 'Info', dot: '#9ca3af', chip: 'bg-gray-100 text-gray-500' },
}
export const VALIDATION_STATUS_META = {
  open: { label: 'Öppen', chip: 'bg-purple-100 text-purple-700' },
  resolved: { label: 'Löst', chip: 'bg-green-100 text-green-700' },
  ignored: { label: 'Ignorerad', chip: 'bg-gray-100 text-gray-500' },
}
export const VALIDATION_SEVERITY_ORDER = { critical: 0, high: 1, warning: 2, info: 3 }
// Källtyp → svensk etikett (för "Gå till"-länk i valideringslistan).
export const VALIDATION_SOURCE_LABEL = {
  section: 'Sektion', bokslut_check: 'Kontroll', bokslut_attachment: 'Bilaga',
  ai_suggestion: 'AI-förslag', engagement: 'Engagemang', rule: 'Regel',
}
// Sammanräkning av öppna valideringspunkter per allvarlighetsgrad.
export function validationSummary(items) {
  const open = (items || []).filter(i => i.status === 'open')
  return {
    open: open.length,
    critical: open.filter(i => i.severity === 'critical').length,
    high: open.filter(i => i.severity === 'high').length,
    warning: open.filter(i => i.severity === 'warning').length,
    info: open.filter(i => i.severity === 'info').length,
  }
}
// Spärr-logik (speglar DB; auktoritativt i RPC). Returnerar orsakstext eller null.
export function approveBlockReason(items) {
  const s = validationSummary(items)
  if (s.critical + s.high > 0) return `${s.critical + s.high} öppna valideringspunkter (hög/kritisk) måste åtgärdas eller ignoreras före godkännande.`
  return null
}
export function lockBlockReason(items) {
  const s = validationSummary(items)
  if (s.critical > 0) return `${s.critical} öppna kritiska valideringspunkter måste åtgärdas eller ignoreras före låsning.`
  return null
}

export const fiscalYearLabel = fy => fy ? `${fy.year} (${fy.start_date} – ${fy.end_date})` : ''
export const fmtAmount = n => (n === null || n === undefined) ? '–' : Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * @typedef {'low'|'medium'|'high'|'critical'} BokslutRiskLevel
 * @typedef {'open'|'in_progress'|'needs_review'|'resolved'|'ignored'} AccountantReviewStatus
 * @typedef {{ id, company_id, fiscal_year_id, regelverk, status, ansvarig_user_id, last_analysis_at, open_count, critical_count, high_count }} BokslutAnalysis
 * @typedef {{ id, engagement_id, category, title, description, account_nr, saldo, risk_level: BokslutRiskLevel, status: AccountantReviewStatus, suggested_action, source, action_url, rule_key, assigned_to, comment, source_data }} BokslutCheck
 * @typedef {{ key, label }} BokslutChecklistCategory
 * @typedef {{ what_detected, why_relevant, accounts_affected, suggested_action, risk_level: BokslutRiskLevel, source, confidence, requires_manual_review }} BokslutFinding
 * @typedef {BokslutFinding & { id, status: 'forslag_ej_bokford'|'approved'|'rejected', suggested_adjustment }} BokslutSuggestion  // Steg 2
 * @typedef {{ rows: Array<{account_nr, debet, kredit}>, beskrivning, status: 'forslag_ej_bokford' }} SuggestedAdjustment       // Steg 2
 * @typedef {{ key, title, content }} AnnualReportDraftSection  // Steg 2
 * @typedef {{ id, regelverk, sections: AnnualReportDraftSection[], status, warning }} AnnualReportDraft  // Steg 2
 * @typedef {{ type, account_nr, saldo_huvudbok, avstamt_belopp, differens, source, comment, status, granskad_av, granskad_at }} Bokslutsbilaga  // Steg 2
 * @typedef {{ kind, ref, label }} SourceReference
 * @typedef {{ action, user_id, reason, created_at }} ReviewAction
 * @typedef {{ key, name, included }} AiPackageFeature
 */
