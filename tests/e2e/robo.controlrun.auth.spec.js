// ROBO-bp Etapp C1 – "Ny bokföringskontroll" mot demo-data. Deterministisk (RIKTIG RPC, ingen AI).
// Verifierar att en kontrollkörning skapas och att minst 5 observationer/avvikelser visas.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

test('Ny bokföringskontroll → körning skapas + minst 5 avvikelser visas', async ({ page }) => {
  await page.goto('/robo-bp')
  await page.getByRole('tab', { name: /Kontroller/ }).click()
  await page.getByRole('button', { name: 'Ny bokföringskontroll' }).click()

  const rows = page.locator('[data-testid="control-observations"] > div')
  await expect.poll(async () => await rows.count(), { timeout: 20000 }).toBeGreaterThanOrEqual(5)
  await expect(page.getByTestId('deviation-count')).toBeVisible()
  // Kända demo-avvikelser ska synas
  await expect(page.locator('[data-testid="control-observations"]').getByText(/obalanserade/)).toBeVisible()
  await expect(page.locator('[data-testid="control-observations"]').getByText(/förfallen/).first()).toBeVisible()
})
