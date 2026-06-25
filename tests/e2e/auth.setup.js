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
  test.setTimeout(10 * 60 * 1000) // 10 min för manuell inmatning
  await page.goto(BASE_URL + '/login')
  /* eslint-disable no-console */
  console.log('\n========================================================================')
  console.log('  Logga in MANUELLT i webbläsarfönstret som öppnades.')
  console.log('  Stäng INTE fönstret – vänta tills du ser raden: "OPAK storageState sparad".')
  console.log('========================================================================\n')
  // Vänta tills appen lämnat /login (robust: bara pathname-kontroll, ingen brittle textmatchning).
  await page.waitForURL((url) => !/\/login(\/|$)/.test(new URL(url).pathname), { timeout: 10 * 60 * 1000 })
  // Bästa-effort: vänta in att appen hunnit skriva session/aktivt bolag innan state fångas (ej fatal).
  try { await page.getByText('ÖVERSIKT').first().waitFor({ timeout: 20000 }) } catch { /* ignore – sparar ändå */ }
  await page.waitForTimeout(2500) // settle: säkerställ att localStorage/session är persisterad
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
  await context.storageState({ path: AUTH_FILE }) // skrivs direkt till fil; innehåll läses/loggas aldrig
  console.log('\n>>> OPAK storageState sparad. Kör nu: npm run e2e:smoke:auth\n')
  /* eslint-enable no-console */
})
