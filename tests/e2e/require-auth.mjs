// Etapp 3C-2A: hård guard för autentiserade E2E-kommandon. Avbryter TYDLIGT om opak
// storageState saknas eller är gammal. Läser ALDRIG filens innehåll – bara att den finns + mtime.
import fs from 'node:fs'
import path from 'node:path'

const AUTH_FILE = path.resolve('playwright/.auth/user.json')
const MAX_AGE_MS = 12 * 60 * 60 * 1000 // 12h – var konservativ; kör om e2e:auth vid behov

if (!fs.existsSync(AUTH_FILE)) {
  console.error('\n[e2e] Autentiseringsstate saknas. Kör först:  npm run e2e:auth   (manuell inloggning i headed browser).\n')
  process.exit(1)
}
const ageMs = Date.now() - fs.statSync(AUTH_FILE).mtimeMs
if (ageMs > MAX_AGE_MS) {
  console.error(`\n[e2e] Autentiseringsstate är äldre än 12h. Kör om:  npm run e2e:auth\n`)
  process.exit(1)
}
console.log('[e2e] Autentiseringsstate finns (opak).')
