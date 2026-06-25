// Etapp 3C-2 (kvarvarande): split-brain, konflikt-UI, autosave-felmatris. Mot den HÄRDADE builden.
// Opak storageState; läser/loggar aldrig auth-fil/tokens. Kommentartext skrivs aldrig ut.
import { test, expect } from '@playwright/test'

const CHECK_TITLE = '3C2 E2E synk-test'
const ENTITY_ID = '86adca1a-d02c-48d5-8a0b-3cf5905d2924'
const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const FY_ID = '93098d68-d265-4ca2-b9c5-e350db97991f'
const ENG_ID = '886fdfc8-6da0-4508-bdee-fef1f94de818'
const USER_ID = '3baa21a4-7461-43cd-b3ae-1088842a853c'
const RPC_GLOB = '**/rest/v1/rpc/bokslut_sync_comment'

test.use({ storageState: undefined })   // ärver auth-projektets storageState
test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

const idb = {
  ops: (page) => page.evaluate(async (eid) => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    const all = await new Promise((res) => { const t = db.transaction('syncQueue', 'readonly'); const g = t.objectStore('syncQueue').getAll(); g.onsuccess = () => res(g.result || []) })
    db.close(); return all.filter(o => o.entityId === eid)
  }, ENTITY_ID),
  clearQueue: (page) => page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    await new Promise((res) => { const t = db.transaction('syncQueue', 'readwrite'); t.objectStore('syncQueue').clear(); t.oncomplete = res; t.onerror = res }); db.close()
  }),
  autosaveCount: (page) => page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    const n = await new Promise((res) => { const t = db.transaction('autosaveEntries', 'readonly'); const c = t.objectStore('autosaveEntries').count(); c.onsuccess = () => res(c.result) }); db.close(); return n
  }),
}
async function op1(page) { return (await idb.ops(page))[0] || null }
async function openCheck(page) {
  await page.goto('/ai-bokslut')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByText(CHECK_TITLE).first().click()
  await expect(page.getByText('Serversynk (intern prototyp)')).toBeVisible({ timeout: 15000 })
}
async function typeAndQueue(page, text) {
  await page.getByPlaceholder('Skriv en kommentar…').fill(text)
  await page.getByRole('button', { name: /Köa serversynk/ }).click()
}

test('§1 split-brain (broadcast + fördröjda BC-meddelanden): en leader (lägst tabId), exakt 1 RPC, ingen dubbelmutation', async ({ context }) => {
  await context.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { configurable: true, get: () => undefined }) } catch { /* ignore */ } })
  await context.addInitScript(() => { try { const P = BroadcastChannel.prototype.postMessage; BroadcastChannel.prototype.postMessage = function (m) { setTimeout(() => { try { P.call(this, m) } catch { /* ignore */ } }, 250) } } catch { /* ignore */ } })
  let rpc = 0
  await context.route(RPC_GLOB, async (route) => { rpc++; await route.continue() })
  const A = await context.newPage(); const B = await context.newPage()
  await openCheck(A); await openCheck(B)
  const rpcDuringElection = rpc                                   // direkt efter laddning – election-settle pågår
  const ta = (await A.evaluate(() => window.__syncDiag)).leaderTabId
  const tb = (await B.evaluate(() => window.__syncDiag)).leaderTabId
  expect((await A.evaluate(() => window.__syncDiag)).leaderMode).toBe('broadcast-lease')
  const lowPage = ta < tb ? A : B, highPage = ta < tb ? B : A
  // konvergens: LÄGST tabId blir ensam stabil ledare
  await expect.poll(async () => {
    const lo = await lowPage.evaluate(() => !!window.__syncDiag?.isLeader)
    const hi = await highPage.evaluate(() => !!window.__syncDiag?.isLeader)
    return lo && !hi
  }, { timeout: 25000 }).toBe(true)
  const leader = lowPage
  await idb.clearQueue(leader)
  await typeAndQueue(leader, 'E2E split-brain')
  await expect.poll(() => op1(leader).then(o => o?.status), { timeout: 25000 }).toBe('succeeded')
  expect(rpcDuringElection).toBe(0)                              // INGEN RPC under election-settle
  expect(rpc).toBe(1)                                            // exakt EN RPC trots två pages + fördröjda meddelanden
  test.info().annotations.push({ type: 'splitbrain', description: `leaderTabId<followerTabId rpcElection=${rpcDuringElection} rpcTotal=${rpc}` })
  await context.unroute(RPC_GLOB)
})

test('§2 konflikt-UI: metadata utan servertext, overwrite skapar ny op (currentRevision som base), gammal löst', async ({ context }) => {
  let rpc = 0
  await context.route(RPC_GLOB, async (route) => { rpc++; await route.continue() })
  const page = await context.newPage()
  await openCheck(page)
  await idb.clearQueue(page)
  // skapa en konflikt: köa, injicera stale baseRevision, synka
  await typeAndQueue(page, 'E2E konflikt min lokala text')
  await page.evaluate(async (eid) => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    await new Promise((res) => { const t = db.transaction('syncQueue', 'readwrite'); const os = t.objectStore('syncQueue'); const g = os.getAll(); g.onsuccess = () => { const o = (g.result || []).find(x => x.entityId === eid); if (o) { o.baseRevision = 1; os.put(o) } }; t.oncomplete = res })
    db.close(); window.dispatchEvent(new Event('online'))
  }, ENTITY_ID)
  await expect.poll(() => op1(page).then(o => o?.status), { timeout: 20000 }).toBe('conflict')
  const conflictOp = await op1(page)
  // öppna konfliktdialogen
  await page.getByRole('button', { name: /Granska konflikt/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Konflikt kräver granskning' })).toBeVisible({ timeout: 8000 })
  // metadata visas, men INGEN servertext i dialogen/idb
  await expect(page.getByText(/Servern har en sparad kommentar|Servern saknar kommentar/)).toBeVisible()
  const dialogHasServerText = await page.evaluate(() => (document.querySelector('.fixed.z-50')?.textContent || '').includes('HEMLIG'))
  expect(dialogHasServerText).toBe(false)
  // Overwrite (admin) → ny op, currentRevision som base, gammal op borta (löst)
  await page.getByRole('button', { name: /Skriv över med bekräftelse/i }).click()
  await expect.poll(async () => { const ops = await idb.ops(page); return ops.some(o => o.operationType === 'overwrite_comment') }, { timeout: 10000 }).toBe(true)
  const ops = await idb.ops(page)
  const ow = ops.find(o => o.operationType === 'overwrite_comment')
  expect(ow.operationId).not.toBe(conflictOp.operationId)        // ny operationId
  expect(ow.idempotencyKey).not.toBe(conflictOp.idempotencyKey)  // ny idempotencyKey
  expect(ops.find(o => o.operationId === conflictOp.operationId)).toBeFalsy()  // gammal konfliktop borttagen (löst)
  await expect.poll(() => idb.ops(page).then(os => os.find(o => o.operationType === 'overwrite_comment')?.status), { timeout: 20000 }).toBe('succeeded')
  test.info().annotations.push({ type: 'conflictUI', description: `metadataOnly=true newOp=${ow.operationId.slice(0, 8)} overwrite=succeeded` })
  await context.unroute(RPC_GLOB)
  await page.close()
})

test('§4 autosave-felmatris: autosave-utkast BEHÅLLS vid sync-fel (worker rör aldrig autosave-storen)', async ({ context }) => {
  const page = await context.newPage()
  // testa representativa fel: feature_disabled (flagga av i RPC-svar simuleras via 403? nej) → använd validation_failed + revision_conflict + unavailable
  const cases = [
    { name: 'unavailable', route: (r) => r.abort('failed'), base: null },
    { name: 'revision_conflict', route: null, base: 1, stale: true },
    { name: 'validation_failed_too_large', route: null, base: null, big: true },
  ]
  for (const c of cases) {
    if (c.route) await context.route(RPC_GLOB, (route) => c.route(route))
    await openCheck(page)
    await idb.clearQueue(page)
    const text = c.big ? 'x'.repeat(8001) : ('E2E autosave ' + c.name)
    await page.getByPlaceholder('Skriv en kommentar…').fill(text)
    await page.waitForTimeout(1200)                              // låt autosave-hooken spara utkastet lokalt
    const autosaveBefore = await idb.autosaveCount(page)
    expect(autosaveBefore).toBeGreaterThan(0)                    // autosave-utkast finns
    await page.getByRole('button', { name: /Köa serversynk/ }).click().catch(() => {})
    if (c.stale) {
      await page.evaluate(async (eid) => { const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) }); await new Promise((res) => { const t = db.transaction('syncQueue', 'readwrite'); const os = t.objectStore('syncQueue'); const g = os.getAll(); g.onsuccess = () => { const o = (g.result || []).find(x => x.entityId === eid); if (o) { o.baseRevision = 1; os.put(o) } }; t.oncomplete = res }); db.close(); window.dispatchEvent(new Event('online')) }, ENTITY_ID)
    }
    // vänta tills op:en nått ett icke-success-tillstånd
    await expect.poll(() => op1(page).then(o => o ? o.status : (c.big ? 'novalidate' : 'none')), { timeout: 20000 }).not.toBe('succeeded')
    const autosaveAfter = await idb.autosaveCount(page)
    expect(autosaveAfter).toBeGreaterThanOrEqual(autosaveBefore) // utkastet BEHÅLLS vid fel
    if (c.route) await context.unroute(RPC_GLOB)
  }
  test.info().annotations.push({ type: 'autosave', description: 'utkast behållet vid unavailable/revision_conflict/validation_failed' })
  await page.close()
})

// OBS: kör SIST – bekräftad logout återkallar sessionen (auth-state städas efteråt).
test('§3 logout med pending: Avbryt behåller; Bekräfta stoppar worker + släpper lease, kö behålls, ingen RPC efter', async ({ context }) => {
  const page = await context.newPage()
  let rpc = 0, blocking = true
  await context.route(RPC_GLOB, async (route) => { rpc++; if (blocking) await route.abort('failed'); else await route.continue() })
  await openCheck(page)
  await idb.clearQueue(page)
  await page.getByPlaceholder('Skriv en kommentar…').fill('E2E logout pending')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /Köa serversynk/ }).click()
  await expect.poll(() => op1(page).then(o => o?.status), { timeout: 15000 }).not.toBe('succeeded')   // pending/retry (blockerad)
  const opBefore = await op1(page)
  expect(opBefore).not.toBeNull()
  await page.goto('/ai-bokslut')                    // reload → drawer-overlayn stängs (op kvar i IDB), sidomeny klickbar
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  // AVBRYT: avvisa logout-confirm → kvar inloggad, kö + worker behålls
  page.once('dialog', d => d.dismiss())
  await page.getByTitle('Logga ut').click()
  await page.waitForTimeout(1000)
  await expect(page).toHaveURL(/\/ai-bokslut/)
  expect((await op1(page))?.operationId).toBe(opBefore.operationId)                                   // op kvar efter Avbryt
  // BEKRÄFTA: logga ut → worker stoppas, lease släpps, kö BEHÅLLS (ej tyst raderad), ingen RPC efter
  const rpcBefore = rpc
  page.once('dialog', d => d.accept())
  await page.getByTitle('Logga ut').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
  blocking = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(2500)
  expect(rpc).toBe(rpcBefore)                       // INGEN RPC efter logout (worker stoppad, lease släppt)
  const opsAfter = await idb.ops(page)
  expect(opsAfter.length).toBeGreaterThan(0)        // kö behållen (ej tyst raderad)
  test.info().annotations.push({ type: 'logout', description: `cancel=keepSession confirm=stopWorker noRpcAfter=${rpc === rpcBefore} queueRetained=${opsAfter.length > 0}` })
  await context.unroute(RPC_GLOB)
  await page.close()
})
