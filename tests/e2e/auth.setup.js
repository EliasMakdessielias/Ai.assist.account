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
  // Steg 1: vänta tills appen lämnat /login.
  await page.waitForURL((url) => !/\/login(\/|$)/.test(new URL(url).pathname), { timeout: 10 * 60 * 1000 })
  // Steg 2 (OBLIGATORISK autentiserad kontroll – får ALDRIG spara enbart för att /login lämnats):
  //   skyddad route renderad + stabil företagsväljare + aktivt bolag i localStorage.
  //   Ingen token/session/response läses eller loggas.
  let authed = false
  try {
    await page.goto(BASE_URL + '/ai-bokslut')
    await page.waitForURL((url) => /\/ai-bokslut/.test(new URL(url).pathname), { timeout: 30000 }) // ej omdirigerad till /login
    await page.getByText('företag · byt').first().waitFor({ timeout: 30000 })                       // stabil autentiserad meny
    authed = await page.evaluate(() => !!localStorage.getItem('activeCompanyId'))                   // aktivt bolag finns
  } catch { authed = false }
  if (!authed) {
    try { fs.rmSync(AUTH_FILE, { force: true }) } catch { /* ignore */ } // radera ev. ofullständig fil
    throw new Error('AUTH_CHECK_FAILED: autentiserad route/element verifierades inte – ingen storageState sparad')
  }
  await page.waitForTimeout(1500) // settle
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
  await context.storageState({ path: AUTH_FILE }) // skrivs direkt till fil; innehåll läses/loggas aldrig
  console.log('\n>>> OPAK storageState sparad (autentiserad kontroll godkänd). Kör nu: npm run e2e:smoke:auth\n')
  /* eslint-enable no-console */
})
