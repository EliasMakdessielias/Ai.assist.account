// Etapp 3C-2A: skapar OPAK storageState via MANUELL inloggning i headed Chromium.
// Användaren skriver själv in e-post + lösenord. Testkoden:
//   - läser ALDRIG access/refresh token, cookies, Authorization-header eller storageState-innehåll
//   - väntar bara på en autentiserad app-route och sparar context.storageState() direkt till fil
//   - loggar ENDAST att filen skapats, aldrig dess innehåll
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { AUTH_FILE, BASE_URL } from './_env.js'

test('manuell inloggning → spara opak storageState', async ({ page, context }) => {
  test.setTimeout(6 * 60 * 1000) // 6 min för manuell inmatning
  await page.goto(BASE_URL + '/login')
  // eslint-disable-next-line no-console
  console.log('\n>>> Logga in MANUELLT i fönstret. Väntar på autentiserad route (lämnar /login) ...\n')
  await page.waitForURL((url) => !/\/login/.test(new URL(url).pathname), { timeout: 6 * 60 * 1000 })
  await expect(page.getByText('ÖVERSIKT').first()).toBeVisible({ timeout: 30000 }) // autentiserad layout
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
  await context.storageState({ path: AUTH_FILE }) // skrivs direkt till fil; innehåll läses aldrig
  // eslint-disable-next-line no-console
  console.log('>>> Opak storageState sparad. Kör nu: npm run e2e:smoke:auth (eller e2e:sync).\n')
})
