// ROBO-bp Steg 2E – DETERMINISTISK UI/RPC-smoke för kontrollpunktslistan + statusflöde.
// Mockar ENDAST AI-svaret (deterministisk finding → ingen live-AI-flakiness). create_check + set_check_status
// + DB-skrivningar är RIKTIGA. Blockerande. Live-AI-smoke ligger separat i robo.smoke.auth.spec.js.
// Opak storageState läses/loggas aldrig. Förutsätter att testbolaget rensats på checks (MCP) innan körning.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const ROBO_GLOB = '**/functions/v1/robo-bp-chat'
const CHECK_TITLE = 'CHECK-2E status (reversibel)'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
  // Deterministisk finding via mock → "Skapa kontrollpunkt"-knapp utan att bero på live-Gemini.
  await context.route(ROBO_GLOB, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, conversation_id: null, observations: [], validation: { ok: true, errors: [] },
      response: { answer: 'Testsvar.', confidence: 0.5, risk_level: 'medium', basis: ['company_data'], sources: [],
        findings: [{ title: CHECK_TITLE, description: 'Granska.', risk_level: 'medium', recommended_action: 'Granska.', affected_objects: [], requires_human_review: true }],
        proposed_actions: [], limitations: [] } }),
  }))
})

async function openPanel(page) {
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.getByRole('button', { name: /ROBO-bp/ }).click()
}

test('2E lista: tomt läge → create uppdaterar listan → open→in_progress→done', async ({ page }) => {
  await openPanel(page)
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  const section = page.locator('section[aria-label="ROBO-bp kontrollpunkter"]')
  await expect(section).toBeVisible()
  await expect(section.getByText('Inga kontrollpunkter än')).toBeVisible()            // tomt läge (point 9)

  // Skapa kontrollpunkt (mockad finding → riktig robo_bp_create_check).
  await page.getByPlaceholder('Fråga ROBO-bp…').fill('test')
  await page.getByRole('button', { name: 'Skicka fråga' }).click()
  await panel.getByRole('button', { name: /Skapa kontrollpunkt/ }).first().click()
  await expect(panel.getByRole('button', { name: /Kontrollpunkt skapad/ }).first()).toBeVisible({ timeout: 15000 })

  // Listan uppdateras UTAN reload → raden syns med status Öppen (point 9).
  await expect(section.getByText(CHECK_TITLE)).toBeVisible({ timeout: 10000 })
  await expect(section.getByText('Öppen')).toBeVisible()

  // open → in_progress (vänta tills RPC persisterat + listan laddats om: "Påbörja" borta, "Klar" framme).
  await section.getByRole('button', { name: 'Påbörja' }).click()
  await expect(section.getByText('Påbörjad')).toBeVisible({ timeout: 10000 })
  await expect(section.getByRole('button', { name: 'Påbörja' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Klar' })).toHaveCount(1)

  // in_progress → done. Done har INGA åtgärder kvar → vänta tills "Avfärda" försvinner (bekräftar persisterat done).
  await section.getByRole('button', { name: 'Klar' }).click()
  await expect(section.getByRole('button', { name: 'Avfärda' })).toHaveCount(0, { timeout: 10000 })
  await expect(section.getByRole('button', { name: 'Klar' })).toHaveCount(0)             // done → inga vidare åtgärder
  await expect(section.locator('span').filter({ hasText: /^Klar$/ })).toBeVisible()      // statusbadge "Klar"
})
