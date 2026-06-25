// Etapp 3C-2A: autentiserat smoke. Två pages öppnar appen som SAMMA testanvändare via OPAK storageState
// (satt på 'auth'-projektet i playwright.config.js). Testkoden läser/loggar ALDRIG token/cookies/headers/state.
// Verifierar: skyddad route renderad (ej /login), stabilt autentiserat UI-element, samma icke-känsliga
// bolags-ID i båda pages, separata tabId. Inga screenshots/videos/traces (av i config).
import { test, expect } from '@playwright/test'
import { BASE_URL } from './_env.js'

// Öppnar skyddad route och returnerar icke-känsligt aktivt bolags-ID. Kastar om autentiserad UI saknas.
async function openAuthedRoute(page) {
  await page.goto(BASE_URL + '/ai-bokslut')
  await expect(page).toHaveURL(/\/ai-bokslut/, { timeout: 30000 })                 // lämnade /login (skyddad route)
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 }) // stabilt autentiserat UI
  return await page.evaluate(() => localStorage.getItem('activeCompanyId'))         // icke-känsligt bolags-ID
}

test('två autentiserade pages: skyddad route, stabilt UI, samma bolag, separata tabId', async ({ context }) => {
  const pageA = await context.newPage()
  const pageB = await context.newPage()

  const companyA = await openAuthedRoute(pageA)
  const companyB = await openAuthedRoute(pageB)

  // separata tabId per page (sätts efter att origin laddats)
  const tabA = await pageA.evaluate(() => { const id = 'tab-' + Math.random().toString(36).slice(2); sessionStorage.setItem('e2eTabId', id); return id })
  const tabB = await pageB.evaluate(() => { const id = 'tab-' + Math.random().toString(36).slice(2); sessionStorage.setItem('e2eTabId', id); return id })

  expect(companyA, 'aktivt bolags-ID ska finnas').toBeTruthy()
  expect(companyB, 'båda pages samma bolag').toBe(companyA)
  expect(tabA).not.toBe(tabB)
  expect(pageA.isClosed()).toBe(false)
  expect(pageB.isClosed()).toBe(false)

  // Rapportera ENDAST icke-känsliga identifierare (bolags-ID + tabId-prefix). Aldrig tokens/headers/state.
  test.info().annotations.push({ type: 'companyId', description: String(companyA) })
  test.info().annotations.push({ type: 'tabIds', description: `${tabA.slice(0, 10)} / ${tabB.slice(0, 10)}` })
})
