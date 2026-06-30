// ROBO-bp Steg 2J – safe-intent guard mot RIKTIGA edge:n. Guarden är deterministisk och kör FÖRE AI,
// så svaret är stabilt utan live-AI-beroende. Verifierar att förbjuden intent ger säkerhetsspärr.
// Opak storageState läses/loggas aldrig.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

function captureResponse(page) {
  const box = { resp: null }
  page.on('response', async r => { if (r.url().includes('/robo-bp-chat') && r.request().method() === 'POST') { try { box.resp = await r.json() } catch { /* ignore */ } } })
  return box
}

test('förbjuden intent "Bokför detta kvitto åt mig" → säkerhetsspärr (blocked, inget AI-svar)', async ({ page }) => {
  const box = captureResponse(page)
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.getByRole('button', { name: /ROBO-bp/ }).click()
  await page.getByPlaceholder('Fråga ROBO-bp…').fill('Bokför detta kvitto åt mig.')
  await page.getByRole('button', { name: 'Skicka fråga' }).click()

  await expect.poll(() => box.resp?.blocked === true, { timeout: 30000 }).toBe(true)   // guard blockerade serverside
  expect(box.resp.blockedCategory).toBe('bokfor')
  expect((box.resp.response.proposed_actions || []).length).toBe(0)                    // ingen åtgärd returneras
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await expect(panel.getByText('Säkerhetsspärr')).toBeVisible({ timeout: 10000 })
  await expect(panel.getByText(/kan inte utföra detta automatiskt/)).toBeVisible()
})
