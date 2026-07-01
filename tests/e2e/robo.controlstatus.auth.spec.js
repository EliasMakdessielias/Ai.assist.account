// ROBO-bp Etapp C2 – status per observation i en kontrollkörning (open/resolved/dismissed).
// Deterministisk (RIKTIG RPC + demo-data, ingen AI). Rör ALDRIG bokföring. Täcker alla 4 övergångar.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

test('statusflöde: open→resolved, open→dismissed, resolved→open, dismissed→open (utan reload)', async ({ page }) => {
  await page.goto('/robo-bp')
  await page.getByRole('tab', { name: /Kontroller/ }).click()
  await page.getByRole('button', { name: 'Ny bokföringskontroll' }).click()

  const rows = page.locator('[data-testid="control-observations"] > div')
  await expect.poll(async () => await rows.count(), { timeout: 20000 }).toBeGreaterThanOrEqual(3)

  const unbal = page.getByTestId('obs-unbalanced_ver')
  const supov = page.getByTestId('obs-supplier_overdue')
  await expect(unbal).toBeVisible()
  await expect(supov).toBeVisible()

  // open → resolved (chip "Löst" exakt, samt att Ångra-knappen ersätter open-knapparna)
  await unbal.getByRole('button', { name: 'Markera som löst' }).click()
  await expect(unbal.getByRole('button', { name: 'Ångra markering' })).toBeVisible()
  await expect(unbal.getByText('Löst', { exact: true })).toBeVisible()
  await expect(unbal.getByRole('button', { name: 'Markera som löst' })).toHaveCount(0)

  // open → dismissed
  await supov.getByRole('button', { name: 'Inte ett problem' }).click()
  await expect(supov.getByRole('button', { name: 'Ångra markering' })).toBeVisible()
  await expect(supov.getByText('Inte ett problem', { exact: true })).toBeVisible()

  // resolved → open
  await unbal.getByRole('button', { name: 'Ångra markering' }).click()
  await expect(unbal.getByRole('button', { name: 'Markera som löst' })).toBeVisible()

  // dismissed → open
  await supov.getByRole('button', { name: 'Ångra markering' }).click()
  await expect(supov.getByRole('button', { name: 'Inte ett problem' })).toBeVisible()
})
