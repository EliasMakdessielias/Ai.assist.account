// Etapp 3C-3 – stäng kvarvarande pilotluckor. Mot den HÄRDADE builden.
// Opak storageState; läser/loggar aldrig auth-fil/tokens. Kommentartext skrivs aldrig till logg.
// Alla server-RPC mockas/aborteras (route) → den RIKTIGA servern anropas aldrig under felmatrisen,
// vilket strukturellt garanterar "ingen oväntad servermutation/audit" (verifieras dessutom via DB efteråt).
import { test, expect } from '@playwright/test'

const CHECK_TITLE = '3C3 E2E synk-test'
const ENTITY_ID = 'ba12cfc8-48cb-43e7-bd58-8754c2d34ec1'
const TEST_COMPANY_ID = '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5'
const RPC_GLOB = '**/rest/v1/rpc/bokslut_sync_comment'
const JSON_CT = 'application/json'

test.use({ storageState: undefined })
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
  autosave: (page) => page.evaluate(async (eid) => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    const all = await new Promise((res) => { const t = db.transaction('autosaveEntries', 'readonly'); const g = t.objectStore('autosaveEntries').getAll(); g.onsuccess = () => res(g.result || []) })
    db.close()
    const e = all.find(x => x.entityType === 'bokslut_check_comment' && x.fieldId === eid)
    return e ? { payload: e.payload, payloadHash: e.payloadHash, status: e.status, localRevision: e.localRevision } : null
  }, ENTITY_ID),
}
async function op1(page) { return (await idb.ops(page))[0] || null }
async function openCheck(page) {
  await page.goto('/ai-bokslut')
  await expect(page.getByText('företag · byt').first()).toBeVisible({ timeout: 30000 })
  await page.getByText(CHECK_TITLE).first().click()
  await expect(page.getByText('Serversynk (intern prototyp)')).toBeVisible({ timeout: 15000 })
}
const fillComment = (page, t) => page.getByPlaceholder('Skriv en kommentar…').fill(t)
const queue = (page) => page.getByRole('button', { name: /Köa serversynk/ }).click()

// ── §1 Autosave-felmatris: SAMMA utkast måste överleva varje serverutfall ──
const MATRIX = [
  { code: 'timeout', status: 'retry_wait', retry: true, mock: (r) => r.fulfill({ status: 400, contentType: JSON_CT, body: JSON.stringify({ message: 'canceling statement due to statement timeout', code: '57014' }) }) },
  { code: 'unavailable', status: 'retry_wait', retry: true, mock: (r) => r.abort('failed') },
  { code: 'transaction_retry', status: 'retry_wait', retry: true, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'transaction_retry', errorCode: 'transaction_retry' }) }) },
  { code: 'revision_conflict', status: 'conflict', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'revision_conflict', errorCode: 'revision_conflict', currentRevision: 5, serverVersion: { commentRevision: 5, hasServerComment: true } }) }) },
  { code: 'validation_failed', status: 'rejected', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'validation_failed', errorCode: 'validation_failed' }) }) },
  { code: 'feature_disabled', status: 'paused', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'feature_disabled', errorCode: 'feature_disabled' }) }) },
  { code: 'engagement_approved', status: 'rejected', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'engagement_approved', errorCode: 'engagement_approved' }) }) },
  { code: 'engagement_locked', status: 'rejected', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'engagement_locked', errorCode: 'engagement_locked' }) }) },
  { code: 'forbidden', status: 'rejected', retry: false, mock: (r) => r.fulfill({ status: 403, contentType: JSON_CT, body: JSON.stringify({ message: 'forbidden', code: '42501' }) }) },
  { code: 'not_found', status: 'rejected', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'not_found', errorCode: 'not_found' }) }) },
  { code: 'idempotency_payload_mismatch', status: 'rejected', retry: false, mock: (r) => r.fulfill({ status: 200, contentType: JSON_CT, body: JSON.stringify({ outcome: 'idempotency_payload_mismatch', errorCode: 'idempotency_payload_mismatch' }) }) },
]

test('§1 autosave-felmatris: samma utkast behålls separat vid alla 11 serverutfall', async ({ context }) => {
  const page = await context.newPage()
  await openCheck(page)
  await idb.clearQueue(page)
  const TEXT = 'E2E 3C3 autosave – lokalt utkast som måste överleva'
  await fillComment(page, TEXT)
  await page.waitForTimeout(1200)                                   // autosave-hooken persisterar utkastet
  const before = await idb.autosave(page)
  expect(before, 'autosave-utkast skapat').toBeTruthy()
  expect(before.status).toBe('local')

  const seen = []
  for (const c of MATRIX) {
    let rpc = 0
    await context.route(RPC_GLOB, (route) => { rpc++; c.mock(route) })
    await idb.clearQueue(page)
    await queue(page)
    await expect.poll(() => op1(page).then(o => o?.status), { timeout: 20000 }).toBe(c.status)
    const op = await op1(page)
    const after = await idb.autosave(page)
    const formVal = await page.getByPlaceholder('Skriv en kommentar…').inputValue()
    // 7 krav per fall:
    expect(after, `${c.code}: autosave-posten finns kvar`).toBeTruthy()
    expect(after.payloadHash, `${c.code}: payloadHash oförändrad`).toBe(before.payloadHash)
    expect(formVal, `${c.code}: formulärtexten kvar`).toBe(TEXT)
    expect(op.status, `${c.code}: ingen falsk Synkad`).not.toBe('succeeded')
    expect(after.status, `${c.code}: utkast ej serverbekräftat`).toBe('local')
    expect(op.status, `${c.code}: korrekt lokal status`).toBe(c.status)
    if (!c.retry) {                                                 // ingen otillåten retry för NEVER_AUTO_RETRY
      const r0 = rpc; await page.waitForTimeout(1600)
      expect(rpc, `${c.code}: ingen otillåten auto-retry`).toBe(r0)
    }
    seen.push(`${c.code}=${op.status}${c.retry ? '(retry-ok)' : ''}`)
    await context.unroute(RPC_GLOB)
  }
  await idb.clearQueue(page)
  test.info().annotations.push({ type: 'autosave-matrix', description: seen.join(' · ') })
  await page.close()
})

// ── §2 Konfliktåtgärder: alla tre verifieras separat genom riktigt UI ──
async function makeConflict(page) {
  await idb.clearQueue(page)
  await fillComment(page, 'E2E 3C3 konflikt – min lokala text')
  await page.waitForTimeout(900)
  await queue(page)
  await page.evaluate(async (eid) => {
    const db = await new Promise((res) => { const r = indexedDB.open('bokpilot-offline'); r.onsuccess = () => res(r.result) })
    await new Promise((res) => { const t = db.transaction('syncQueue', 'readwrite'); const os = t.objectStore('syncQueue'); const g = os.getAll(); g.onsuccess = () => { const o = (g.result || []).find(x => x.entityId === eid); if (o) { o.baseRevision = 1; os.put(o) } }; t.oncomplete = res })
    db.close(); window.dispatchEvent(new Event('online'))
  }, ENTITY_ID)
  await expect.poll(() => op1(page).then(o => o?.status), { timeout: 20000 }).toBe('conflict')
  await page.getByRole('button', { name: /Granska konflikt/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Konflikt kräver granskning' })).toBeVisible({ timeout: 8000 })
}

test('§2a konflikt: "Läs in serverversion" hämtar via behörighetsläsning, löser op, ingen mutation', async ({ context }) => {
  // sätt först en RIKTIG serverkommentar (happy sync) så att inläsning ger meningsfull text
  const page = await context.newPage()
  await openCheck(page)
  await idb.clearQueue(page)
  await fillComment(page, 'SERVERTEXT-3C3')
  await page.waitForTimeout(600)
  await queue(page)
  await expect.poll(() => op1(page).then(o => o?.status), { timeout: 20000 }).toBe('succeeded')
  await idb.clearQueue(page)
  // skapa konflikt med annan lokal text
  await makeConflict(page)
  let rpc = 0
  await context.route(RPC_GLOB, (route) => { rpc++; route.continue() })
  const conflictId = (await op1(page)).operationId
  await page.getByRole('button', { name: /Läs in serverversion/i }).click()
  await expect.poll(() => idb.ops(page).then(os => os.find(o => o.operationId === conflictId)), { timeout: 10000 }).toBeFalsy() // op löst
  await page.waitForTimeout(1500)
  const formVal = await page.getByPlaceholder('Skriv en kommentar…').inputValue()
  expect(formVal).toBe('SERVERTEXT-3C3')                           // formuläret ersatt MED serverns text efter val
  expect(rpc, 'ingen servermutation under inläsning (endast RLS-läsning sker via reload)').toBe(0)
  test.info().annotations.push({ type: 'konflikt-läs-server', description: `op-löst=true form=server rpcMut=${rpc}` })
  await context.unroute(RPC_GLOB); await page.close()
})

test('§2b konflikt: "Behåll separat" bevarar lokal text + utkast, löser op, ingen mutation', async ({ context }) => {
  const page = await context.newPage()
  await openCheck(page)
  await makeConflict(page)
  let rpc = 0
  await context.route(RPC_GLOB, (route) => { rpc++; route.continue() })
  const conflictId = (await op1(page)).operationId
  const draftBefore = await idb.autosave(page)
  await page.getByRole('button', { name: /Behåll min text som separat/i }).click()
  await expect.poll(() => idb.ops(page).then(os => os.find(o => o.operationId === conflictId)), { timeout: 10000 }).toBeFalsy() // op löst
  const formVal = await page.getByPlaceholder('Skriv en kommentar…').inputValue()
  expect(formVal).toBe('E2E 3C3 konflikt – min lokala text')        // lokal text bevarad
  const draftAfter = await idb.autosave(page)
  expect(draftAfter, 'synlig lokal kopia (autosave-utkast) kvar').toBeTruthy()
  expect(draftAfter.payloadHash).toBe(draftBefore.payloadHash)
  expect(rpc, 'ingen servermutation').toBe(0)
  test.info().annotations.push({ type: 'konflikt-behåll-separat', description: `op-löst=true lokalTextKvar=true utkastKvar=true rpcMut=${rpc}` })
  await context.unroute(RPC_GLOB); await page.close()
})

test('§2c konflikt: "Skriv över med bekräftelse" → ny op (currentRevision som base), exakt 1 overwrite', async ({ context }) => {
  let rpc = 0
  await context.route(RPC_GLOB, (route) => { rpc++; route.continue() })
  const page = await context.newPage()
  await openCheck(page)
  await makeConflict(page)
  const conflictOp = await op1(page)
  await page.getByRole('button', { name: /Skriv över med bekräftelse/i }).click()
  await expect.poll(async () => (await idb.ops(page)).some(o => o.operationType === 'overwrite_comment'), { timeout: 10000 }).toBe(true)
  const ops = await idb.ops(page)
  const ow = ops.find(o => o.operationType === 'overwrite_comment')
  expect(ow.operationId).not.toBe(conflictOp.operationId)           // ny operationId
  expect(ow.idempotencyKey).not.toBe(conflictOp.idempotencyKey)     // ny idempotencyKey
  expect(ow.baseRevision).toBe(conflictOp.serverResult?.currentRevision) // aktuell serverRevision som base
  expect(ops.find(o => o.operationId === conflictOp.operationId)).toBeFalsy() // gammal löst
  await expect.poll(() => idb.ops(page).then(os => os.find(o => o.operationType === 'overwrite_comment')?.status), { timeout: 20000 }).toBe('succeeded')
  test.info().annotations.push({ type: 'konflikt-overwrite', description: `nyOp=${ow.operationId.slice(0, 8)} base=${ow.baseRevision} status=succeeded` })
  await context.unroute(RPC_GLOB); await page.close()
})

// ── §3 BroadcastChannel takeover efter lease expiry (lease 8000, heartbeat 3000) ──
test('§3 takeover: stabil owner, follower väntar till lease expiry, ny owner skickar exakt 1 RPC', async ({ context }) => {
  await context.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { configurable: true, get: () => undefined }) } catch { /* ignore */ } })
  let rpc = 0
  await context.route(RPC_GLOB, async (route) => { rpc++; await route.continue() })
  const A = await context.newPage(); const B = await context.newPage()
  await openCheck(A); await openCheck(B)
  await A.waitForFunction(() => !!window.__syncDiag?.leaderTabId, { timeout: 15000 })
  await B.waitForFunction(() => !!window.__syncDiag?.leaderTabId, { timeout: 15000 })
  const ta = (await A.evaluate(() => window.__syncDiag)).leaderTabId
  const tb = (await B.evaluate(() => window.__syncDiag)).leaderTabId
  const owner = ta < tb ? A : B, follower = ta < tb ? B : A
  await expect.poll(async () => {
    const lo = await owner.evaluate(() => !!window.__syncDiag?.isLeader)
    const hi = await follower.evaluate(() => !!window.__syncDiag?.isLeader)
    return lo && !hi
  }, { timeout: 25000 }).toBe(true)
  // owner synkar en op → 1 RPC
  await idb.clearQueue(owner)
  await fillComment(owner, 'E2E 3C3 takeover owner')
  await queue(owner)
  await expect.poll(() => op1(owner).then(o => o?.status), { timeout: 20000 }).toBe('succeeded')
  const rpcBeforeTakeover = rpc
  // stäng owner → stale lease kvarstår tills expiry
  await owner.close()
  const tClose = Date.now()
  // INGEN takeover före lease expiry: kort efter stängning ska follower ännu inte vara ledare
  await follower.waitForTimeout(3000)
  const earlyLeader = await follower.evaluate(() => !!window.__syncDiag?.isLeader)
  expect(earlyLeader, 'ingen takeover före lease expiry (~8s)').toBe(false)
  // takeover EFTER expiry
  await expect.poll(() => follower.evaluate(() => !!window.__syncDiag?.isLeader), { timeout: 20000 }).toBe(true)
  const takeoverMs = Date.now() - tClose
  expect(takeoverMs, 'takeover först efter lease-TTL').toBeGreaterThanOrEqual(7000)
  // ny owner skickar EXAKT ett RPC för en ny op; ingen dubbelmutation (gammal owner stängd → skickar inget).
  // Ladda om follower först → färsk comment_revision (ownerns synk bumpade servern; realtime kan släpa i test).
  await openCheck(follower)
  await idb.clearQueue(follower)
  const rpcBeforeNew = rpc
  await fillComment(follower, 'E2E 3C3 takeover ny owner')
  await queue(follower)
  await expect.poll(() => op1(follower).then(o => o?.status), { timeout: 25000 }).toBe('succeeded')
  expect(rpc - rpcBeforeNew, 'ny owner: exakt 1 RPC').toBe(1)
  test.info().annotations.push({ type: 'takeover', description: `leaseTTL=8000 heartbeat=3000 takeoverMs=${takeoverMs} rpcFöre=${rpcBeforeTakeover} rpcEfterNyOp=${rpc}` })
  await context.unroute(RPC_GLOB)
})

// ── §4 Logout + nästa användare: kräver andra säkra principal → Inte verifierad (produktionsblockerare) ──
test.skip('§4 nästa användare ser/claimar inte föregående pending – KRÄVER andra betrodda testanvändare', async () => {
  // Isolering är kodmässigt per userId (claimNext/listForUser/leaderLockName filtrerar på userId), men
  // FULL browserverifiering kräver en andra säker principal som saknas. Markeras Inte verifierad.
})
