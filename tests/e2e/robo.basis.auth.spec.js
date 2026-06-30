// ROBO-bp Steg 2G – DETERMINISTISK E2E för "Underlag för svaret" (transparenssektionen).
// Mockar AI-svaret (inkl. meta) → ingen live-AI. Verifierar basis, contextCounts, observationCounts,
// källor, AI-utan-källa-varning, expand/collapse och varningsfraser. Skapar ingen DB-data.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const ROBO_GLOB = '**/functions/v1/robo-bp-chat'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

const mock = (context, body) => context.route(ROBO_GLOB, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))

async function openAndAsk(page) {
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.getByRole('button', { name: /ROBO-bp/ }).click()
  await page.getByPlaceholder('Fråga ROBO-bp…').fill('Vilket underlag bygger du ditt svar på?')
  await page.getByRole('button', { name: 'Skicka fråga' }).click()
}

test('§1 ai_inference utan källa → systemdata + varning + contextCounts + systemkontroll + expand/collapse', async ({ context, page }) => {
  await mock(context, {
    ok: true, conversation_id: null, validation: { ok: true, errors: [] },
    observations: [{ code: 'no_fiscal_year', severity: 'medium', text: 'Inget räkenskapsår valt.', count: 0 }],
    meta: { view: 'oversikt', contextCounts: { accounts: 12, verifications: 3 }, observationCounts: { total: 1, codes: ['no_fiscal_year'] } },
    response: { answer: 'Mitt svar.', confidence: 0.4, risk_level: 'medium', basis: ['company_data', 'ai_inference'], sources: [], findings: [], proposed_actions: [], limitations: [] },
  })
  await openAndAsk(page)
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  // Steg 2H: chips för beslutsnivå + confidence (systemberäknade) – company_data + observation → stark/databaserad.
  await expect(panel.getByText('Databaserad analys')).toBeVisible({ timeout: 10000 })
  await expect(panel.getByText('Stark grund')).toBeVisible()
  const toggle = panel.getByRole('button', { name: 'Underlag för svaret' })
  await expect(toggle).toBeVisible({ timeout: 10000 })
  await expect(panel.getByText('Systemdata (BokPilot)')).toHaveCount(0)          // kollapsad → dolt
  await toggle.click()
  await expect(panel.getByText('Systemdata (BokPilot)')).toBeVisible()           // basis-etikett
  await expect(panel.getByText(/AI-bedömning utan extern regelkälla/)).toBeVisible()  // point 6
  await expect(panel.getByText(/12 konton/)).toBeVisible()                       // contextCounts
  await expect(panel.getByText(/Systemkontroll:/)).toBeVisible()                 // observationCounts (point 7)
  await expect(panel.getByText(/no_fiscal_year/).first()).toBeVisible()          // observation code (basis + obs-sektion)
  await expect(panel.getByText('Detta är ett granskningsstöd, inte bokföring.')).toBeVisible()  // varningsfras
  await toggle.click()
  await expect(panel.getByText('Systemdata (BokPilot)')).toHaveCount(0)          // collapse igen
})

test('§2 med sources → källor visas, ingen "utan källa"-varning, inga konteringsförslag', async ({ context, page }) => {
  await mock(context, {
    ok: true, conversation_id: null, validation: { ok: true, errors: [] }, observations: [],
    meta: { view: 'moms', contextCounts: { accounts: 5 }, observationCounts: { total: 0, codes: [] } },
    response: { answer: 'Svar med källa.', confidence: 0.8, risk_level: 'low', basis: ['rule_source', 'ai_inference'], sources: [{ title: 'BFN K2 kap 5', type: 'bfn' }], findings: [], proposed_actions: [], limitations: [] },
  })
  await openAndAsk(page)
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await panel.getByRole('button', { name: 'Underlag för svaret' }).click()
  await expect(panel.getByText(/BFN K2 kap 5/).first()).toBeVisible()            // sources (point 4)
  await expect(panel.getByText('AI-bedömning utan extern regelkälla')).toHaveCount(0)  // har källa → ingen varning
  await expect(panel.getByText(/Kontrollera alltid innan åtgärd/)).toBeVisible()
  await expect(panel.getByRole('button', { name: /Bokför|kontera|suggest/i })).toHaveCount(0)  // inga konteringsförslag
})

test('§3 ai_inference utan källa/observation → chips "Svag" + "Kräver manuell granskning"', async ({ context, page }) => {
  await mock(context, {
    ok: true, conversation_id: null, validation: { ok: true, errors: [] }, observations: [],
    meta: { view: 'oversikt', contextCounts: {}, observationCounts: { total: 0, codes: [] } },
    response: { answer: 'Ren AI-bedömning.', confidence: 0.3, risk_level: 'medium', basis: ['ai_inference'], sources: [], findings: [], proposed_actions: [], limitations: [] },
  })
  await openAndAsk(page)
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await expect(panel.getByText('Svag')).toBeVisible({ timeout: 10000 })
  await expect(panel.getByText('Kräver manuell granskning')).toBeVisible()
  await expect(panel.getByText(/AI-säkerhet 30%/)).toBeVisible()                  // AI:s score visas separat
})
