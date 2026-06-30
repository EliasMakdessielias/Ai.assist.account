// ROBO-bp Steg 2H – DETERMINISTISK E2E för decision_basis. Mockar ett svar med ENBART en observation
// (inga findings) → enda "Skapa kontrollpunkt"-knappen är observationens → riktig check med
// decision_basis = system_observation. create_check-RPC + DB-skrivning är RIKTIGA. Ingen live-AI.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const ROBO_GLOB = '**/functions/v1/robo-bp-chat'
const OBS_TITLE = 'DECISION-2H observation (reversibel)'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
  await context.route(ROBO_GLOB, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, conversation_id: null, validation: { ok: true, errors: [] },
      observations: [{ code: 'unbalanced_ver', severity: 'high', text: OBS_TITLE, count: 1 }],
      meta: { view: 'oversikt', contextCounts: { accounts: 4 }, observationCounts: { total: 1, codes: ['unbalanced_ver'] } },
      response: { answer: 'Systembaserat svar.', confidence: 0.6, risk_level: 'high', basis: ['company_data'], sources: [], findings: [], proposed_actions: [], limitations: [] },
    }),
  }))
})

test('2H create från observation → decision_basis=system_observation (riktig RPC)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.getByRole('button', { name: /ROBO-bp/ }).click()
  await page.getByPlaceholder('Fråga ROBO-bp…').fill('Vilka avvikelser finns?')
  await page.getByRole('button', { name: 'Skicka fråga' }).click()
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await expect(panel.getByText('Kontroller från systemet')).toBeVisible({ timeout: 10000 })
  const btn = panel.getByRole('button', { name: /Skapa kontrollpunkt/ }).first()   // enda knappen = observationens
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.click()
  await expect(panel.getByRole('button', { name: /Kontrollpunkt skapad/ }).first()).toBeVisible({ timeout: 15000 })
})
