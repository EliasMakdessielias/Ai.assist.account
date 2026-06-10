// Ren, testbar logik för nedladdning från Inkorgen (enskild fil / ZIP av valda / ZIP av sektion).
// Innehåller INGEN IO – filhämtning/ZIP-bygge sker i komponenten med signerade URL:er (RLS-skyddade).

// Inkorgs-kategori (documents.kategori) -> section slug för filnamn (krav B).
export const SECTION_SLUGS = {
  kvitto: 'kvitton',
  leverantorsfaktura: 'leverantorsfakturor',
  dokument: 'dokument',
  avtal: 'avtal',
  okand: 'behover_granskas',
}
export function sectionSlug(katKey) {
  return SECTION_SLUGS[katKey] || 'dokument'
}

// Saneras filnamn (krav C.1/F.3/F.4): blockerar path traversal (../, /, \), null-bytes och
// styrtecken; tillåter endast [A-Za-z0-9._-]; behåller filändelsen. Tomt -> fallback.
// Ordning: ta basnamn (allt före sista slash bort) -> allowlist (tar bort styrtecken/null,
// ersätter otillåtet med _) -> trimma ledande/avslutande punkter/_/-, vilket även neutraliserar
// rena "."/".."-namn.
export function sanitizeFilename(name, fallback = 'fil') {
  let s = String(name ?? '')
  s = s.replace(/^.*[\\/]/, '')                       // basnamn – tar bort all path (../, /, \)
  s = s.replace(/[^A-Za-z0-9._-]+/g, '_')             // allowlist (rensar null-bytes/styrtecken)
  s = s.replace(/^[._-]+/, '').replace(/[._-]+$/, '') // trimma kanttecken (blockerar "."/"..")
  return s || fallback
}

// Dela upp i { base, ext } där ext inkluderar punkten ('' om ingen).
export function splitExt(name) {
  const i = String(name).lastIndexOf('.')
  if (i <= 0) return { base: String(name), ext: '' }
  return { base: name.slice(0, i), ext: name.slice(i) }
}

// Undvik dubbletter i ZIP genom suffix: faktura.pdf, faktura_2.pdf, faktura_3.pdf (krav D.3).
// Jämförelse är skiftlägesokänslig (ZIP/filsystem kan vara det).
export function dedupeNames(names) {
  const used = new Set()
  return names.map(raw => {
    const name = raw || 'fil'
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name }
    const { base, ext } = splitExt(name)
    let c = 2, candidate
    do { candidate = `${base}_${c}${ext}`; c++ } while (used.has(candidate.toLowerCase()))
    used.add(candidate.toLowerCase())
    return candidate
  })
}

// ZIP-filnamn (krav D.1/D.2): {slug}_valda_{date}.zip för valda, annars {slug}_{date}.zip.
export function zipFileName(slug, { selected = false, date } = {}) {
  const d = date || new Date().toISOString().slice(0, 10)
  return `${slug}${selected ? '_valda' : ''}_${d}.zip`
}

// Gränser för client-side ZIP (krav D.4). Dokumenterat: max 50 filer / 150 MB totalt.
export const MAX_ZIP_FILES = 50
export const MAX_ZIP_BYTES = 150 * 1024 * 1024

export function checkZipLimits(files = []) {
  const n = files.length
  const total = files.reduce((s, f) => s + (Number(f?.size) || 0), 0)
  if (n === 0) return { ok: false, reason: 'empty' }
  if (n > MAX_ZIP_FILES) return { ok: false, reason: 'too_many', limit: MAX_ZIP_FILES, count: n }
  if (total > MAX_ZIP_BYTES) return { ok: false, reason: 'too_large', limit: MAX_ZIP_BYTES, total }
  return { ok: true, count: n, total }
}

// Sammanfattning av partiell nedladdning (krav D.6).
export function partialSummary(okCount, failCount) {
  if (failCount <= 0) return `${okCount} fil${okCount === 1 ? '' : 'er'} nedladdade.`
  return `${okCount} fil${okCount === 1 ? '' : 'er'} laddades ner, ${failCount} kunde inte hämtas.`
}
