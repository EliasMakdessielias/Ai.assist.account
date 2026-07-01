// ROBO-bp Etapp B – samlad tabbad vy (/robo-bp). DETERMINISTISK, ingen AI. Verifierar licensgrind,
// flikar, att Assistenten öppnar befintlig panel, att Kontroller länkar till kontrollvyn, att
// Rapporter/Dokument/Inställningar visar "senare etapp", samt AI-paket-länken. Opak storageState läses aldrig.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

test('§1 flikar renderas + Assistenten öppnar panelen + kommande-lägen', async ({ page }) => {
  await page.goto('/robo-bp')
  for (const t of ['Assistenten', 'Kontroller', 'Rapporter', 'Dokument', 'Inställningar'])
    await expect(page.getByRole('tab', { name: new RegExp(t) })).toBeVisible({ timeout: 30000 })

  // Assistenten (default) → öppna befintlig panel
  await page.getByRole('button', { name: 'Öppna ROBO-bp' }).click()
  await expect(page.locator('aside[aria-label="ROBO-bp"]')).toBeVisible({ timeout: 10000 })
  await page.locator('aside[aria-label="ROBO-bp"]').getByRole('button', { name: 'Stäng' }).click()

  // Rapporter / Dokument / Inställningar → "senare etapp"
  await page.getByRole('tab', { name: /Rapporter/ }).click()
  await expect(page.getByText('Rapporter byggs i senare etapp.')).toBeVisible()
  await page.getByRole('tab', { name: /Dokument/ }).click()
  await expect(page.getByText(/senare etapp/)).toBeVisible()
  await expect(page.getByText('BETA')).toBeVisible()
  await page.getByRole('tab', { name: /Inställningar/ }).click()
  await expect(page.getByText('Kontrollinställningar byggs i senare etapp.')).toBeVisible()
})

test('§2 Kontroller-fliken länkar till befintliga /robo-bp/kontroller', async ({ page }) => {
  await page.goto('/robo-bp')
  await page.getByRole('tab', { name: /Kontroller/ }).click()
  await page.getByRole('button', { name: 'Öppna kontrollpunkter' }).click()
  await expect(page).toHaveURL(/\/robo-bp\/kontroller/)
})

test('§3 AI-paket-menyn har en ROBO-bp-länk till /robo-bp', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.locator('a[href="/robo-bp"]').click()
  await expect(page).toHaveURL(/\/robo-bp$/)
  await expect(page.getByRole('tab', { name: /Assistenten/ })).toBeVisible({ timeout: 10000 })
})
