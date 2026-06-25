// Etapp 3C-2A: auth-FRITT smoke. Bevisar att två RIKTIGA pages kan leva i SAMMA BrowserContext,
// har separata identiteter, delar origin-lagring, och att page B överlever att page A stängs.
import { test, expect } from '@playwright/test'
import { BASE_URL } from './_env.js'

test('två pages i samma context: separata id, delad origin, oberoende livscykel', async ({ context }) => {
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.goto(BASE_URL)
  await pageB.goto(BASE_URL)

  expect(pageA).not.toBe(pageB)                       // verkliga separata page-objekt
  expect(context.pages().length).toBeGreaterThanOrEqual(2)

  // separata tabId per page
  const idA = await pageA.evaluate(() => { const id = 'tab-' + Math.random().toString(36).slice(2); sessionStorage.setItem('e2eTabId', id); return id })
  const idB = await pageB.evaluate(() => { const id = 'tab-' + Math.random().toString(36).slice(2); sessionStorage.setItem('e2eTabId', id); return id })
  expect(idA).not.toBe(idB)

  // delad origin-lagring (samma context + origin) – det som Web Locks/BroadcastChannel-ledarskap bygger på
  await pageA.evaluate(() => localStorage.setItem('e2eShared', 'A'))
  const seenByB = await pageB.evaluate(() => localStorage.getItem('e2eShared'))
  expect(seenByB).toBe('A')

  // stäng A → B fortsätter fungera
  await pageA.close()
  expect(pageA.isClosed()).toBe(true)
  await pageB.reload()
  expect(await pageB.title()).toBeTruthy()

  await pageB.evaluate(() => localStorage.removeItem('e2eShared')) // städa origin-lagring
})
