import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

// Etapp 1B: automatisk Service Worker-version. Ersätter __BUILD_ID__ i dist/sw.js efter bygget.
// Prioritet: Vercel/CI commit-SHA → git short SHA → content-hash av byggda assets (deterministiskt per build).
function swBuildId() {
  return {
    name: 'bokpilot-sw-build-id',
    apply: 'build',
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        const dist = path.resolve(process.cwd(), 'dist')
        const swPath = path.join(dist, 'sw.js')
        if (!fs.existsSync(swPath)) return

        let buildId =
          process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.COMMIT_REF ||
          process.env.VITE_BUILD_ID ||
          ''
        if (!buildId) { try { buildId = execSync('git rev-parse --short=12 HEAD').toString().trim() } catch { /* ignore */ } }
        if (!buildId) {
          // Fallback: deterministisk hash av asset-filnamn (innehåller redan Vites content-hashar).
          try {
            const assetsDir = path.join(dist, 'assets')
            const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).sort().join('|') : String(Date.now())
            buildId = crypto.createHash('sha256').update(files).digest('hex')
          } catch { buildId = 'unknown' }
        }
        buildId = String(buildId).slice(0, 12)

        const sw = fs.readFileSync(swPath, 'utf8').replaceAll('__BUILD_ID__', buildId)
        fs.writeFileSync(swPath, sw)
        // eslint-disable-next-line no-console
        console.log(`[bokpilot-sw-build-id] Service Worker buildId = ${buildId}`)
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), swBuildId()],
  // Vitest (enhets-/integrationstester). Playwright-E2E (tests/e2e) körs separat via `npm run e2e:*`
  // och får ALDRIG plockas upp av vitest (de importerar @playwright/test).
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
})
