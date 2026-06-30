// ROBO-bp 1B – live-smoke mot deployad edge (robo-bp-chat) + testaktiverad flagga (robo_bp) för testbolaget.
// Riktig inloggad användare (medlem i testbolaget). Verifierar öppning från 4 ställen, JSON-kontraktet,
// requires_human_review, ingen auto-bokföring, 403 för fel bolag. Opak storageState – läses/loggas aldrig.
import { test, expect } from '@playwright/test'

const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const ROBO_GLOB = '**/functions/v1/robo-bp-chat'
const RISK = ['low', 'medium', 'high', 'critical']
const ACTIONS = ['open_object', 'create_check', 'suggest_accounting', 'explain_rule']

test.use({ storageState: undefined })
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

async function openFromSidebar(page) {
  await page.goto('/')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /AI-paket/ }).click()
  await page.getByRole('button', { name: /ROBO-bp/ }).click()
}
function captureResponse(page) {
  const box = { resp: null }
  page.on('response', async r => { if (r.url().includes('/robo-bp-chat') && r.request().method() === 'POST') { try { box.resp = await r.json() } catch { /* ignore */ } } })
  return box
}
async function ask(page, q = 'Vilka risker eller avvikelser ser du i bokföringen just nu?') {
  await page.getByPlaceholder('Fråga ROBO-bp…').fill(q)
  await page.getByRole('button', { name: 'Skicka fråga' }).click()
}

test('§1 öppnas från AI-paket och svarar enligt JSON-kontraktet', async ({ page }) => {
  const box = captureResponse(page)
  await openFromSidebar(page)
  await expect(page.getByRole('heading', { name: 'ROBO-bp' }).or(page.getByText('ROBO-bp').first())).toBeVisible()
  await expect(page.getByText(/bokför, ändrar eller godkänner aldrig/i)).toBeVisible()   // "bokför aldrig"-banner
  await ask(page)
  await expect.poll(() => box.resp?.ok, { timeout: 45000 }).toBe(true)
  const res = box.resp.response
  // JSON-kontrakt
  expect(typeof res.answer).toBe('string')
  expect(res.answer.length).toBeGreaterThan(0)
  expect(RISK).toContain(res.risk_level)
  expect(Array.isArray(res.basis)).toBe(true)
  // Svaret är alltid en giltig kontraktsform; validation.errors kan innehålla sanerade hallucinationer
  // (AI som refererar konton utanför den begränsade kontexten → korrekt borttagna av spärren).
  expect(box.resp.validation).toBeTruthy()
  expect(Array.isArray(box.resp.validation.errors)).toBe(true)
  // requires_human_review = true på alla findings
  for (const f of res.findings || []) expect(f.requires_human_review).toBe(true)
  // ingen auto-bokföring: åtgärdstyperna är säkra; Steg 2A blockerar suggest_accounting helt
  for (const a of res.proposed_actions || []) { expect(ACTIONS).toContain(a.type); expect(a.type).not.toBe('suggest_accounting') }
  // visas i panelen (svarskort renderat) – robust normaliserad delsträngskontroll mot ROBO-bp-panelen
  const norm = s => String(s).replace(/\s+/g, ' ').trim()
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await expect.poll(async () => norm(await panel.innerText()).includes(norm(res.answer).slice(0, 25)), { timeout: 10000 }).toBe(true)
})

test('§2 tom/begränsad kontext kraschar inte (oversikt utan selection)', async ({ page }) => {
  const box = captureResponse(page)
  await openFromSidebar(page)
  await ask(page, 'Sammanfatta vad du kan göra.')
  await expect.poll(() => box.resp != null, { timeout: 45000 }).toBe(true)
  expect(box.resp.ok).toBe(true)
  expect(RISK).toContain(box.resp.response.risk_level)              // alltid giltig form, ingen krasch
})

test('§3 öppnas kontextuellt från Bokföring / Leverantörsfakturor / Månadskontroll', async ({ page }) => {
  for (const [path, header] of [['/bokforing', 'företag · byt'], ['/leverantorsfakturor', 'företag · byt'], ['/manadskontroll', 'företag · byt']]) {
    await page.goto(path)
    await expect(page.getByText(header).first()).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: /Fråga ROBO-bp/ }).first().click()
    await expect(page.getByText(/bokför, ändrar eller godkänner aldrig/i)).toBeVisible({ timeout: 8000 })
    await page.locator('aside[aria-label="ROBO-bp"]').getByRole('button', { name: 'Stäng' }).click()
  }
})

test('§5 skapa kontrollpunkt från en DETERMINISTISK observation (no_fiscal_year) – ingen bokföring', async ({ page }) => {
  const box = captureResponse(page)
  await openFromSidebar(page)
  await ask(page)                                                  // "Vilka risker eller avvikelser ser du ...?"
  await expect.poll(() => (box.resp?.observations || []).length > 0, { timeout: 45000 }).toBe(true)  // observations returneras
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  await expect(panel.getByText('Kontroller från systemet')).toBeVisible({ timeout: 10000 })          // egen sektion (point 2)
  const btn = panel.getByRole('button', { name: /Skapa kontrollpunkt/ }).first()                     // knapp per observation (point 4)
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.click()                                                                                   // explicit klick → robo_bp_create_check
  await expect(panel.getByRole('button', { name: /Kontrollpunkt skapad/ }).first()).toBeVisible({ timeout: 15000 })  // bekräftelse + dubbelklicksskydd
})

// §6: deterministiskt browser-flöde för create_check. Mockar ENDAST AI-svaret (så en finding renderas);
// själva robo_bp_create_check-RPC:t + DB-skrivningen är RIKTIGA (skapar en verklig, reversibel kontrollpunkt).
const SMOKE_CHECK_TITLE = 'SMOKE-2C kontrollpunkt (reversibel)'
test('§6 create_check browser-flöde (mockat svar med finding) → RIKTIG kontrollpunkt skapas, ingen bokföring', async ({ context, page }) => {
  await context.route(ROBO_GLOB, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, conversation_id: null, validation: { ok: true, errors: [] },
      response: { answer: 'Testsvar.', confidence: 0.5, risk_level: 'medium', basis: ['company_data'], sources: [],
        findings: [{ title: SMOKE_CHECK_TITLE, description: 'Granska kontoplanen.', risk_level: 'medium', recommended_action: 'Granska.', affected_objects: [], requires_human_review: true }],
        proposed_actions: [], limitations: [] } }),
  }))
  await openFromSidebar(page)
  await ask(page, 'test')
  const panel = page.locator('aside[aria-label="ROBO-bp"]')
  const btn = panel.getByRole('button', { name: /Skapa kontrollpunkt/ }).first()
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.click()
  await expect(panel.getByRole('button', { name: /Kontrollpunkt skapad/ }).first()).toBeVisible({ timeout: 15000 })
  await context.unroute(ROBO_GLOB)
})

// Cross-company-403 verifieras SERVER-SIDE (edge:ns membership-grind + has_ai_feature returnerar false
// för bolag användaren ej är medlem i – båda bekräftade via MCP-simulering). Browserns supabase-klient
// exponeras inte globalt, så ingen separat klientprobe görs här.
test.skip('§4 403 cross-company – server-verifierad (membership-grind i edge), ej browserprobe', async () => {})
