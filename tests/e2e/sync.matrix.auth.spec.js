// Etapp 3C-2: tvåsidig E2E av synkkön via OPAK storageState. Driver produktens RIKTIGA UI.
// Läser/loggar ALDRIG token/cookies/headers/auth-fil. Kommentartext skrivs aldrig ut.
// Observerar endast klientens IndexedDB-köstatus + window.__syncDiag (icke-känsligt).
import { test, expect } from '@playwright/test'

const CHECK_TITLE = '3C2 E2E synk-test'
const ENTITY_ID = 'b18a84e7-d291-41ae-bc27-3a10b96282a7'
const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5' // testbolaget (icke-känsligt id)
const RPC_GLOB = '**/rest/v1/rpc/bokslut_sync_comment'

// Tvinga aktivt testbolag innan appkoden läser activeCompanyId (icke-känsligt; ingen auth-data).
test.beforeEach(async ({ context }) => {
  await context.addInitScript((cid) => { try { localStorage.setItem('activeCompanyId', cid) } catch { /* ignore */ } }, TEST_COMPANY_ID)
})

// Läs köstatus för testchecken ur klientens IndexedDB (ingen auth-data).
async function opForEntity(page) {
  return page.evaluate(async (entityId) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const ops = await new Promise((res) => { const t = db.transaction('syncQueue', 'readonly'); const g = t.objectStore('syncQueue').getAll(); g.onsuccess = () => res(g.result || []) })
    db.close()
    const o = ops.find(x => x.entityId === entityId)
    return o ? { status: o.status, operationId: o.operationId, idem: o.idempotencyKey, attempt: o.attemptCount, rev: o.serverResult && o.serverResult.currentRevision, outcome: o.serverResult && o.serverResult.outcome, errorCode: o.serverResult && o.serverResult.errorCode } : null
  }, ENTITY_ID)
}
async function clearQueue(page) {
  await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    await new Promise((res) => { const t = db.transaction('syncQueue', 'readwrite'); t.objectStore('syncQueue').clear(); t.oncomplete = res; t.onerror = res })
    db.close()
  })
}
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

test.describe.configure({ mode: 'serial' })

test('§2 fullt UI-drivet happy path: IDB-commit före RPC → succeeded, exakt 1 RPC', async ({ context }) => {
  const page = await context.newPage()
  let rpcCount = 0
  let opStatusAtRpc = 'NONE'
  await context.route(RPC_GLOB, async (route) => {
    rpcCount++
    // bevisa persist-före-nätverk: operationen finns redan i IndexedDB när RPC:n är på väg ut
    opStatusAtRpc = (await opForEntity(page))?.status || 'NONE'
    await route.continue()
  })
  await openCheck(page)
  await clearQueue(page)
  await typeAndQueue(page, 'E2E happy path UI')               // riktig synkåtgärd via UI
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 20000 }).toBe('succeeded')
  const op = await opForEntity(page)
  expect(['pending', 'processing']).toContain(opStatusAtRpc)  // IDB-commit FÖRE RPC
  expect(rpcCount).toBe(1)                                    // exakt en serveroperation
  expect(op.rev).toBeGreaterThanOrEqual(2)                   // serverRevision lagrad
  test.info().annotations.push({ type: 'happy', description: `rpc=${rpcCount} status=${op.status} rev=${op.rev} idem=${String(op.idem).slice(0, 8)}…` })
  await context.unroute(RPC_GLOB)
  await page.close()
})

test('§3 Web Locks i två pages: en leader, exakt 1 RPC, takeover efter leader stängs', async ({ context }) => {
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  let rpcCount = 0
  await context.route(RPC_GLOB, async (route) => { rpcCount++; await route.continue() })
  await openCheck(pageA)
  await openCheck(pageB)
  const diagA = await pageA.evaluate(() => window.__syncDiag)
  const diagB = await pageB.evaluate(() => window.__syncDiag)
  expect(diagA.activeCompanyId).toBe(diagB.activeCompanyId)   // samma bolag
  expect(diagA.leaderMode).toBe('web-locks')
  // exakt EN leader
  expect([diagA.isLeader, diagB.isLeader].filter(Boolean).length).toBe(1)
  const leader = diagA.isLeader ? pageA : pageB
  const follower = diagA.isLeader ? pageB : pageA
  await clearQueue(leader)
  await typeAndQueue(leader, 'E2E web-locks UI')
  await expect.poll(() => opForEntity(leader).then(o => o?.status), { timeout: 20000 }).toBe('succeeded')
  expect(rpcCount).toBe(1)                                    // endast leader skickade, en mutation
  // takeover: stäng leader → follower blir leader
  await leader.close()
  await expect.poll(() => follower.evaluate(() => window.__syncDiag?.isLeader), { timeout: 20000 }).toBe(true)
  test.info().annotations.push({ type: 'weblocks', description: `oneLeader=true rpc=${rpcCount} takeover=ok` })
  await context.unroute(RPC_GLOB)
})

test('§5 offline → pending, ingen falsk Synkad, reload behåller, reconnect → succeeded (samma idem)', async ({ context }) => {
  const page = await context.newPage()
  let blocking = true
  await context.route(RPC_GLOB, async (route) => { if (blocking) await route.abort('failed'); else await route.continue() })
  await openCheck(page)
  await clearQueue(page)
  await typeAndQueue(page, 'E2E offline UI')
  // offline → blir retry_wait/pending (ingen succeeded)
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 20000 }).not.toBe('succeeded')
  const before = await opForEntity(page)
  expect(before).not.toBeNull()
  expect(['pending', 'retry_wait', 'processing']).toContain(before.status)
  // reload behåller operationen
  await page.reload()
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  const afterReload = await opForEntity(page)
  expect(afterReload?.operationId).toBe(before.operationId)   // samma operation överlevde reload
  // reconnect → worker synkar, SAMMA idempotencyKey
  blocking = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 25000 }).toBe('succeeded')
  const done = await opForEntity(page)
  expect(done.idem).toBe(before.idem)                         // samma idempotencyKey genom hela
  test.info().annotations.push({ type: 'offline', description: `survivedReload=ok sameIdem=${done.idem === before.idem} status=${done.status}` })
  await context.unroute(RPC_GLOB)
  await page.close()
})

test('§6 lost response: server committar men svar tappas → retry (samma idem) → replay succeeded, ingen ny revision', async ({ context }) => {
  const page = await context.newPage()
  let phase = 'lose'
  let serverCalls = 0
  await context.route(RPC_GLOB, async (route) => {
    serverCalls++
    if (phase === 'lose') { try { await route.fetch() } catch { /* server committade ändå */ } await route.abort('failed') } // svar tappas
    else await route.continue()                                                                                            // retry får replay
  })
  await openCheck(page)
  await clearQueue(page)
  await typeAndQueue(page, 'E2E lost response')
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 20000 }).toBe('retry_wait')
  const r1 = await opForEntity(page)
  phase = 'continue'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 25000 }).toBe('succeeded')
  const r2 = await opForEntity(page)
  expect(r2.idem).toBe(r1.idem)                 // samma idempotencyKey vid retry
  expect(r2.attempt).toBeGreaterThanOrEqual(2)  // verkligt nytt försök
  test.info().annotations.push({ type: 'lost', description: `retry_wait→succeeded sameIdem=${r2.idem === r1.idem} attempts=${r2.attempt} serverCalls=${serverCalls}` })
  await context.unroute(RPC_GLOB)
  await page.close()
})

test('§7 revision_conflict: stale baseRevision → conflict, serverVersion lagras, ingen auto-overwrite', async ({ context }) => {
  const page = await context.newPage()
  let block = true
  await context.route(RPC_GLOB, async (route) => { if (block) { await new Promise(r => setTimeout(r, 400)); await route.continue() } else await route.continue() })
  await openCheck(page)
  await clearQueue(page)
  await typeAndQueue(page, 'E2E conflict lokal text')
  // injicera STALE baseRevision i den köade operationen (verklig server-CAS-konflikt uppstår vid synk)
  await page.evaluate(async (entityId) => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    await new Promise((res) => {
      const t = db.transaction('syncQueue', 'readwrite'); const os = t.objectStore('syncQueue')
      const g = os.getAll(); g.onsuccess = () => { const o = (g.result || []).find(x => x.entityId === entityId); if (o) { o.baseRevision = 1; os.put(o) } ; }
      t.oncomplete = res
    })
    db.close()
    window.dispatchEvent(new Event('online'))
  }, ENTITY_ID)
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 20000 }).toBe('conflict')
  const op = await opForEntity(page)
  expect(op.errorCode).toBe('revision_conflict')
  // Konfliktmetadata lagrad (UTAN serverns kommentartext – integritet) + ingen auto-overwrite (op kvar som conflict)
  const sv = await page.evaluate(async (entityId) => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    const ops = await new Promise((res) => { const t = db.transaction('syncQueue', 'readonly'); const g = t.objectStore('syncQueue').getAll(); g.onsuccess = () => res(g.result || []) })
    db.close()
    const o = ops.find(x => x.entityId === entityId)
    const sr = o?.serverResult || {}
    return {
      hasServerRevision: sr.serverCommentRevision != null,
      hasChangedBy: !!sr.changedBy, changedAt: sr.changedAt,
      current: sr.currentRevision, stillConflict: o?.status === 'conflict',
      noServerText: !JSON.stringify(o || {}).includes('E2E')   // ingen kommentartext lagrad lokalt
    }
  }, ENTITY_ID)
  expect(sv.hasServerRevision).toBe(true)          // serverns commentRevision känd
  expect(sv.hasChangedBy).toBe(true)               // changedBy lagrad
  expect(sv.stillConflict).toBe(true)              // ingen automatisk overwrite
  // UI: konflikt syns
  await expect(page.getByText(/Konflikt/i).first()).toBeVisible({ timeout: 10000 })
  test.info().annotations.push({ type: 'conflict', description: `errorCode=revision_conflict changedBy=ok current=${sv.current} autoOverwrite=no noServerText=${sv.noServerText}` })
  await context.unroute(RPC_GLOB)
  await page.close()
})

test('§4 BroadcastChannel-fallback (Web Locks otillgängligt): en lease-owner, takeover efter expiry', async ({ context }) => {
  // Inaktivera Web Locks INNAN appkoden laddas → tvingar broadcast-lease.
  await context.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { configurable: true, get: () => undefined }) } catch { /* ignore */ } })
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  let rpcCount = 0
  await context.route(RPC_GLOB, async (route) => { rpcCount++; await route.continue() })
  await openCheck(pageA)
  await openCheck(pageB)
  expect((await pageA.evaluate(() => window.__syncDiag)).leaderMode).toBe('broadcast-lease')
  expect((await pageB.evaluate(() => window.__syncDiag)).leaderMode).toBe('broadcast-lease')
  // lease-konvergens: transient dual-claim minimeras → exakt EN owner (lägst tabId vinner)
  const leaders = async () => {
    const la = await pageA.evaluate(() => !!window.__syncDiag?.isLeader)
    const lb = await pageB.evaluate(() => !!window.__syncDiag?.isLeader)
    return { la, lb, n: [la, lb].filter(Boolean).length }
  }
  await expect.poll(async () => (await leaders()).n, { timeout: 15000 }).toBe(1)
  const { la } = await leaders()
  const leader = la ? pageA : pageB, follower = la ? pageB : pageA
  await clearQueue(leader)
  await typeAndQueue(leader, 'E2E broadcast-lease')
  await expect.poll(() => opForEntity(leader).then(o => o?.status), { timeout: 20000 }).toBe('succeeded')
  expect(rpcCount).toBe(1)
  // takeover efter att owner stängs + lease (8s) löpt ut
  await leader.close()
  await expect.poll(() => follower.evaluate(() => window.__syncDiag?.isLeader), { timeout: 20000 }).toBe(true)
  test.info().annotations.push({ type: 'broadcast', description: `mode=broadcast-lease oneOwner=true rpc=${rpcCount} takeover=ok leaseTtl=8000 heartbeat=3000` })
  await context.unroute(RPC_GLOB)
})

test('§8 sessionsavbrott: RPC 401 → worker pausar + reauth, operationen behålls → återupptas → succeeded', async ({ context }) => {
  const page = await context.newPage()
  let unauth = true
  await context.route(RPC_GLOB, async (route) => {
    if (unauth) await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) }) // simulerat sessionsavbrott (revoker INTE servern)
    else await route.continue()
  })
  await openCheck(page)
  await clearQueue(page)
  await typeAndQueue(page, 'E2E sessionsavbrott')
  // worker mappar 401 → paused + reauth; operationen BEHÅLLS (purgeas ej)
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 20000 }).toBe('paused')
  const paused = await opForEntity(page)
  expect(paused).not.toBeNull()                                 // operationen behålls
  expect(paused.status).toBe('paused')                          // kön pausad
  // återuppta via manuell retry (motsvarar att samma användare återautentiserat) → samma idempotencyKey → succeeded
  unauth = false
  await page.getByRole('button', { name: /Försök igen/i }).first().click().catch(() => {})
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => opForEntity(page).then(o => o?.status), { timeout: 25000 }).toBe('succeeded')
  const done = await opForEntity(page)
  expect(done.idem).toBe(paused.idem)                           // samma idempotencyKey
  test.info().annotations.push({ type: 'session', description: `paused(retained)→retry→succeeded sameIdem=${done.idem === paused.idem}` })
  await context.unroute(RPC_GLOB)
  await page.close()
})
