// ROBO-bp Steg 2F – DETERMINISTISK E2E för samlade kontrollpunktsvyn (/robo-bp/kontroller).
// Ingen live-AI. Testdata seedas via MCP före körning (SEED-2F-titlar). Verifierar panel-navigation,
// listning för aktivt bolag, att annat bolags checks döljs, filtrering och statusändring (riktig RPC).
// Opak storageState läses/loggas aldrig.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const A = 'SEED-2F A hög/öppen (reversibel)'
const B = 'SEED-2F B medel/påbörjad (reversibel)'
const OTHER = 'SEED-2F OTHER annat bolag (reversibel)'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

test('§1 panelens "Visa alla kontrollpunkter" navigerar till /robo-bp/kontroller', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.getByRole('button', { name: /ROBO-bp/ }).click()
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await panel.getByRole('button', { name: 'Visa alla kontrollpunkter' }).click()
  await expect(page).toHaveURL(/\/robo-bp\/kontroller/)
})

test('§2 listar aktivt bolags checks, döljer annat bolags, filtrerar status/risk, ändrar status', async ({ page }) => {
  await page.goto('/robo-bp/kontroller')
  await expect(page.getByText(A)).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(B)).toBeVisible()
  await expect(page.getByText(OTHER)).toHaveCount(0)                 // annat bolags check döljs (point 14)

  // Filter status = Öppen → bara A (B är påbörjad).
  await page.getByLabel('Status').selectOption({ label: 'Öppen' })
  await expect(page.getByText(A)).toBeVisible()
  await expect(page.getByText(B)).toHaveCount(0)

  // Filter risk = Hög (status fortfarande Öppen) → fortfarande A.
  await page.getByLabel('Risk').selectOption({ label: 'Hög' })
  await expect(page.getByText(A)).toBeVisible()

  // Risk = Medel + status Öppen → inget (B är medel men påbörjad) → tomt filterläge.
  await page.getByLabel('Risk').selectOption({ label: 'Medel' })
  await expect(page.getByTestId('robo-checks-empty')).toBeVisible()

  // Återställ filter → ändra status på A (open → in_progress).
  await page.getByLabel('Status').selectOption({ label: 'Alla' })
  await page.getByLabel('Risk').selectOption({ label: 'Alla' })
  const rowA = page.getByRole('row', { name: new RegExp(A.replace(/[()/]/g, '.')) })
  await rowA.getByRole('button', { name: 'Påbörja' }).click()
  await expect(rowA.getByText('Påbörjad')).toBeVisible({ timeout: 10000 })
  await expect(rowA.getByRole('button', { name: 'Påbörja' })).toHaveCount(0)   // open-åtgärd borta → persisterat
})
