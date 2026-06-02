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

// Tolkar en hel fil till konton. Returnerar { ok, error, accounts, header }.
export function parseAccountsFile(text) {
  const { header, rows } = parseDelimited(text)
  const map = mapColumns(header)
  if (map.account_nr == null || map.name == null) {
    return { ok: false, error: 'Filen saknar kolumner för kontonummer och/eller benämning.', accounts: [], header }
  }
  const accounts = rows
    .map((cells, idx) => ({
      _line: idx + 2,
      account_nr: (cells[map.account_nr] ?? '').trim(),
      name: (cells[map.name] ?? '').trim(),
      is_active: map.is_active != null ? parseBool(cells[map.is_active]) : true,
      vat_code: map.vat_code != null ? (cells[map.vat_code] ?? '').trim() : '',
      sru: map.sru != null ? (cells[map.sru] ?? '').trim() : '',
    }))
    .filter(a => a.account_nr !== '' || a.name !== '')
  return { ok: true, accounts, header }
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
export function planImport(accounts, existingNrs, mode) {
  const existing = new Set((existingNrs || []).map(String))
  const fileNrs = new Set(accounts.map(a => a.account_nr))
  let inserted = 0, updated = 0, skipped = 0
  for (const a of accounts) {
    const has = existing.has(a.account_nr)
    if (mode === 'add') has ? skipped++ : inserted++
    else if (mode === 'update') has ? updated++ : skipped++
    else has ? updated++ : inserted++ // replace
  }
  const missing = mode === 'replace' ? (existingNrs || []).filter(n => !fileNrs.has(String(n))) : []
  return { mode, inserted, updated, skipped, missing, missingCount: missing.length }
}
