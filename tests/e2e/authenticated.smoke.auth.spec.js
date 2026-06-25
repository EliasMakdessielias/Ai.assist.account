// Etapp 3C-2A: autentiserat smoke. Två pages öppnar appen som SAMMA testanvändare via OPAK storageState
// (satt på 'auth'-projektet i playwright.config.js). Testkoden läser ALDRIG token/cookies/headers/state.
// Verifierar endast att autentiserad UI visas i båda pages och att samma aktiva bolag visas.
import { test, expect } from '@playwright/test'
import { BASE_URL } from './_env.js'

test('två autentiserade pages: samma användare, samma bolag', async ({ context }) => {
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.goto(BASE_URL + '/ai-bokslut')
  await pageB.goto(BASE_URL + '/ai-bokslut')

  // autentiserad route (ej redirigerad till /login)
  await expect(pageA).toHaveURL(/\/ai-bokslut/, { timeout: 30000 })
  await expect(pageB).toHaveURL(/\/ai-bokslut/, { timeout: 30000 })

  // båda visar företagsväljaren (autentiserad layout) – jämför synlig UI-text, inga tokens
  const labelA = (await pageA.getByText('företag · byt').first().textContent().catch(() => '')) || ''
  const labelB = (await pageB.getByText('företag · byt').first().textContent().catch(() => '')) || ''
  expect(labelA.length).toBeGreaterThan(0)
  expect(labelB).toBe(labelA) // samma aktiva bolag i båda pages
})
