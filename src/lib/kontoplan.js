// Ren logik för kontoplan-import. Inga beroenden på React eller Supabase –
// så att allt kan enhetstestas isolerat (se src/lib/kontoplan.test.js).

// --- Filtolkning (CSV/semikolon eller komma, med citationstecken) ---------
export function parseDelimited(text) {
  const t = String(text ?? '').replace(/^﻿/, '')
  const lines = t.split(/\r?\n/).filter(l => l.trim() !== '')
  if (!lines.length) return { header: [], rows: [] }
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ','
  const parseLine = line => {
    const out = []; let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
        else cur += c
      } else {
        if (c === '"') q = true
        else if (c === delim) { out.push(cur); cur = '' }
        else cur += c
      }
    }
    out.push(cur)
    return out.map(s => s.trim())
  }
  return { header: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) }
}

// --- Kolumnmappning: stöder Fortnox-export och projektets egna CSV ---------
const ALIASES = {
  account_nr: ['accountnumber', 'account_nr', 'accountno', 'kontonummer', 'kontonr', 'konto'],
  name: ['accountname', 'name', 'benämning', 'benamning', 'kontonamn', 'namn'],
  is_active: ['isactive', 'is_active', 'aktiv', 'aktivt', 'active'],
  vat_code: ['vatcodeandpercent', 'vat_code', 'vatcode', 'momskod', 'moms'],
  sru: ['sru'],
  is_blocked: ['isblockedformanualbooking', 'is_blocked_for_manual_booking', 'blockerad', 'last', 'låst', 'systemkonto'],
}

const normalize = h => String(h ?? '').toLowerCase().replace(/\s+/g, '').replace(/[._-]/g, '')

export function mapColumns(header) {
  const map = {}
  header.forEach((h, i) => {
    const n = normalize(h)
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (map[field] == null && aliases.some(a => normalize(a) === n)) { map[field] = i; break }
    }
  })
  return map
}

export function parseBool(v, dflt = true) {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === '') return dflt
  return /^(1|true|ja|aktiv|active|x|yes)$/.test(s)
}

// Tolkar redan uppdelade rubrik+rader (från CSV eller Excel) till konton.
// Returnerar { ok, error, accounts, header }.
export function parseRows(header, rows) {
  const map = mapColumns(header)
  if (map.account_nr == null || map.name == null) {
    return { ok: false, error: 'Filen saknar kolumner för kontonummer och/eller benämning.', accounts: [], header }
  }
  const cell = (cells, i) => String(cells[i] ?? '').trim()
  const accounts = rows
    .map((cells, idx) => ({
      _line: idx + 2,
      account_nr: cell(cells, map.account_nr),
      name: cell(cells, map.name),
      is_active: map.is_active != null ? parseBool(cells[map.is_active]) : true,
      vat_code: map.vat_code != null ? cell(cells, map.vat_code) : '',
      sru: map.sru != null ? cell(cells, map.sru) : '',
      is_blocked_for_manual_booking: map.is_blocked != null ? parseBool(cells[map.is_blocked], false) : false,
    }))
    .filter(a => a.account_nr !== '' || a.name !== '')
  return { ok: true, accounts, header }
}

// Tolkar en CSV-/semikolonfil (text) till konton.
export function parseAccountsFile(text) {
  const { header, rows } = parseDelimited(text)
  return parseRows(header, rows)
}

// --- BAS-klass/typ (speglar serverns bas_class/bas_type) -------------------
export function basClass(nr) {
  const s = String(nr ?? '')
  return /^[1-8]/.test(s) ? parseInt(s[0], 10) : null
}
export function basType(nr) {
  return ({ 1: 'tillgång', 2: 'eget_kapital_skuld', 3: 'intäkt', 4: 'kostnad', 5: 'kostnad', 6: 'kostnad', 7: 'kostnad', 8: 'finansiell' })[basClass(nr)] || null
}
export const CLASS_NAMES = {
  1: 'Tillgångar', 2: 'Eget kapital & skulder', 3: 'Intäkter',
  4: 'Material och varor', 5: 'Övriga externa kostnader', 6: 'Övriga externa kostnader',
  7: 'Personal och avskrivningar', 8: 'Finansiella poster',
}

// --- Validering: struktur, numeriskt kontonr, dubbletter i filen ----------
export function validateAccounts(accounts) {
  const errors = []
  const seen = new Map()
  const duplicatesInFile = new Set()
  for (const a of accounts) {
    if (!a.account_nr) errors.push({ line: a._line, message: 'Saknar kontonummer' })
    else if (!/^\d{3,4}$/.test(a.account_nr)) errors.push({ line: a._line, account_nr: a.account_nr, message: 'Kontonummer måste vara 3–4 siffror' })
    if (!a.name) errors.push({ line: a._line, account_nr: a.account_nr, message: 'Saknar benämning' })
    if (a.account_nr) {
      if (seen.has(a.account_nr)) duplicatesInFile.add(a.account_nr)
      else seen.set(a.account_nr, a._line)
    }
  }
  duplicatesInFile.forEach(nr => errors.push({ account_nr: nr, message: 'Dubblett i filen' }))
  return { valid: errors.length === 0, errors, duplicatesInFile: [...duplicatesInFile] }
}

// --- Förhandsberäkna importens effekt mot befintliga konton ---------------
// mode: 'replace' | 'add' | 'update'
// existing: array av kontonummer (string) ELLER objekt { account_nr, is_locked }.
// Låsta befintliga konton bevaras: de ignoreras vid import och raderas aldrig.
export function planImport(accounts, existing, mode) {
  const norm = (existing || []).map(e =>
    typeof e === 'string' ? { account_nr: String(e), is_locked: false }
      : { account_nr: String(e.account_nr), is_locked: !!e.is_locked })
  const byNr = new Map(norm.map(e => [e.account_nr, e]))
  const fileNrs = new Set(accounts.map(a => a.account_nr))
  let inserted = 0, updated = 0, skipped = 0, ignoredLocked = 0, newLocked = 0
  for (const a of accounts) {
    const ex = byNr.get(a.account_nr)
    const blocked = !!a.is_blocked_for_manual_booking
    if (ex && ex.is_locked) { ignoredLocked++; continue }  // bevaras exakt
    if (mode === 'add') {
      if (ex) skipped++; else { inserted++; if (blocked) newLocked++ }
    } else if (mode === 'update') {
      if (ex) { updated++; if (blocked) newLocked++ } else skipped++
    } else { // replace
      if (ex) { updated++; if (blocked) newLocked++ } else { inserted++; if (blocked) newLocked++ }
    }
  }
  // replace: befintliga konton som saknas i filen och INTE är låsta tas bort
  const missing = mode === 'replace' ? norm.filter(e => !fileNrs.has(e.account_nr) && !e.is_locked).map(e => e.account_nr) : []
  const preservedLocked = norm.filter(e => e.is_locked).length
  return { mode, inserted, updated, skipped, ignoredLocked, newLocked, missing, missingCount: missing.length, preservedLocked }
}
