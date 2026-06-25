// Etapp 3C-2A: raderar opak auth-state + alla E2E-artefakter. Loggar aldrig filinnehåll.
import fs from 'node:fs'
import path from 'node:path'

const targets = ['playwright/.auth', 'test-results', 'playwright-report', 'blob-report', 'traces', 'videos', 'screenshots']
for (const t of targets) {
  const p = path.resolve(t)
  try { fs.rmSync(p, { recursive: true, force: true }); console.log('[e2e:cleanup] borttagen:', t) } catch { /* ignore */ }
}
console.log('[e2e:cleanup] klart – opak auth-state + artefakter borttagna.')
