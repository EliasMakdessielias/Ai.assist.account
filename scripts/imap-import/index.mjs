// BokPilot – IMAP-importer för inkommande underlag (Hostinger).
//
// Läser olästa mejl i mailboxen underlag@bokpilot.se via IMAP, plockar ut
// mottagaradressen ({archiveNumber}underlag@bokpilot.se) ur To/Delivered-To/
// X-Original-To, och POSTar varje mejl till den deployade Supabase-funktionen
// `inbound-email` (som återanvänder befintlig parsing + klassificering + lagring).
//
// Idempotent: bara OLÄSTA mejl läses, och efter bearbetning markeras de \Seen
// och flyttas till Processed (eller Failed vid fel). Webhooken dedupar dessutom
// på Message-ID.
//
// Körs som schemalagd task (t.ex. var 5:e minut), se README.md.
//
// Miljövariabler (sätt som hemligheter – ALDRIG i kod/loggar):
//   IMAP_HOST, IMAP_PORT (993), IMAP_USER, IMAP_PASSWORD, IMAP_TLS (true)
//   INBOUND_WEBHOOK_URL  = https://<ref>.supabase.co/functions/v1/inbound-email
//   INBOUND_EMAIL_WEBHOOK_SECRET = samma secret som funktionen
//   IMAP_MAILBOX (INBOX), IMAP_PROCESSED (Processed), IMAP_FAILED (Failed)

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Ladda .env från skriptets mapp (om den finns) – enkel parser, inga deps.
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env')
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* ingen .env – använd process.env */ }

const env = (k, d) => process.env[k] ?? d
const INBOX_DOMAIN = 'bokpilot.se'

// Webhook-URL och secret kan anges med endera namnschemat.
const WEBHOOK_URL = env('INBOUND_EMAIL_WEBHOOK_URL') || env('INBOUND_WEBHOOK_URL')
const WEBHOOK_TOKEN = env('INBOUND_EMAIL_WEBHOOK_TOKEN') || env('INBOUND_EMAIL_WEBHOOK_SECRET')

const missing = []
for (const k of ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD']) if (!env(k)) missing.push(k)
if (!WEBHOOK_URL) missing.push('INBOUND_EMAIL_WEBHOOK_URL')
if (!WEBHOOK_TOKEN) missing.push('INBOUND_EMAIL_WEBHOOK_TOKEN')
if (missing.length) { console.error('Saknar miljövariabler: ' + missing.join(', ')); process.exit(1) }

const MAILBOX = env('IMAP_MAILBOX', 'INBOX')
const PROCESSED = env('IMAP_PROCESSED', 'Processed')
const FAILED = env('IMAP_FAILED', 'Failed')

// Plocka ut {archiveNumber}underlag@bokpilot.se ur en lista av header-värden.
function pickRecipient(values) {
  const cands = []
  for (const v of values) if (v) for (const p of String(v).split(',')) { const t = p.trim(); if (t) cands.push(t) }
  for (const c of cands) {
    const m = c.match(/<([^>]+)>/)
    const addr = (m ? m[1] : c).trim().toLowerCase()
    const at = addr.indexOf('@')
    if (at < 0) continue
    const local = addr.slice(0, at), domain = addr.slice(at + 1)
    if (domain !== INBOX_DOMAIN) continue
    if (/^\d+underlag$/.test(local)) return addr
  }
  return null
}

// Hitta/skapa en mapp och returnera dess fulla sökväg. Hanterar Hostingers
// "INBOX."-hierarki (mappar ligger under INBOX med t.ex. "." som avskiljare).
async function ensureMailbox(client, name) {
  let boxes = await client.list()
  const delim = boxes[0]?.delimiter || '.'
  const find = () => boxes.find(b => b.path === name || b.path === `INBOX${delim}${name}`)?.path
  let p = find()
  if (p) return p
  const path = `INBOX${delim}${name}`
  try { await client.mailboxCreate(path) } catch { /* kan redan finnas */ }
  boxes = await client.list()
  return find() || path
}

async function postToWebhook(body) {
  const sig = createHmac('sha256', WEBHOOK_TOKEN).update(body).digest('hex')
  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bokpilot-Signature': `sha256=${sig}` },
    body,
  })
  let jr = {}
  try { jr = await resp.json() } catch { /* ignore */ }
  return { ok: resp.ok, status: resp.status, body: jr }
}

async function run() {
  const client = new ImapFlow({
    host: env('IMAP_HOST'),
    port: Number(env('IMAP_PORT', 993)),
    secure: String(env('IMAP_TLS', 'true')) !== 'false',
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
    logger: false,
  })
  await client.connect()
  const processedPath = await ensureMailbox(client, PROCESSED)
  const failedPath = await ensureMailbox(client, FAILED)

  let processed = 0, failed = 0, rejected = 0
  const lock = await client.getMailboxLock(MAILBOX)
  try {
    const uids = await client.search({ seen: false }, { uid: true })
    for (const uid of uids) {
      let target = processedPath
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true })
        const mail = await simpleParser(msg.source)
        const recipient = pickRecipient([
          ...((mail.to?.value || []).map(v => v.address)),
          ...((mail.cc?.value || []).map(v => v.address)),
          mail.headers.get('delivered-to'),
          mail.headers.get('x-original-to'),
        ])
        if (!recipient) {
          rejected++; target = failedPath
          console.log(`uid ${uid}: ingen giltig underlagsadress – ignorerad`)
        } else {
          const attachments = (mail.attachments || []).map(a => ({
            filename: a.filename || 'bilaga',
            contentType: a.contentType || 'application/octet-stream',
            size: a.size || (a.content ? a.content.length : 0),
            contentBase64: a.content ? a.content.toString('base64') : '',
          }))
          const body = JSON.stringify({
            to: recipient,
            from: mail.from?.text || '',
            subject: mail.subject || '',
            text: mail.text || '',
            attachments,
            messageId: mail.messageId || `imap-${MAILBOX}-${uid}`,
            source: 'hostinger-imap',
          })
          const res = await postToWebhook(body)
          const st = res.body?.status
          if (res.ok && (st === 'received' || st === 'needs_review' || st === 'duplicate')) {
            processed++
            console.log(`uid ${uid}: ${st} (${res.body?.created ?? 0} poster)`)
          } else {
            failed++; target = failedPath
            console.log(`uid ${uid}: webhook ${res.status} ${st || ''} – flyttas till ${FAILED}`)
          }
        }
      } catch (e) {
        failed++; target = failedPath
        console.error(`uid ${uid}: fel vid bearbetning – ${e?.message || e}`)
      }
      try {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        await client.messageMove(uid, target, { uid: true })
      } catch (e) { console.error(`uid ${uid}: kunde inte flytta – ${e?.message || e}`) }
    }
  } finally {
    lock.release()
  }
  await client.logout()
  console.log(`Klart: ${processed} importerade, ${rejected} ignorerade, ${failed} fel.`)
}

run().catch(e => { console.error('IMAP-import avbröts:', e?.message || e); process.exit(1) })
