// BokPilot email-kö-processor.
// Hämtar pending email-notiser ur notification_queue, skickar via SMTP (nodemailer),
// spårar leverans i notification_deliveries och retryar med exponentiell backoff.
// Inga credentials hårdkodas — allt via .env. Loggar aldrig lösenord eller fullt mailinnehåll.
//
// Körningar:
//   node index.mjs            -> processa kön (en batch)
//   node index.mjs --verify   -> verifiera SMTP-anslutning (skickar inget)
//   node index.mjs --test you@example.com  -> skicka ett testmail (krav 11)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import {
  deliveryDecision, failureTransition, isValidEmail,
  unsubscribeUrl, emailFooter, buildEmailHtml,
} from '../../src/lib/emailDelivery.js'
import { MANDATORY_EVENTS } from '../../src/lib/notifications.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- enkel .env-laddare (samma mönster som imap-import) ---
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  } catch { /* .env valfri om env redan satt i miljön */ }
}
loadEnv()

const need = k => { const v = process.env[k]; if (!v) { console.error(`Saknar miljövariabel: ${k}`); process.exit(1) } return v }
const SUPABASE_URL = need('SUPABASE_URL')
const SERVICE_KEY = need('SUPABASE_SERVICE_ROLE_KEY')
const SMTP_FROM = need('SMTP_FROM')
const UNSUB_SECRET = process.env.NOTIF_UNSUB_SECRET || ''
const UNSUB_BASE = process.env.UNSUB_BASE_URL || ''
const BATCH = parseInt(process.env.EMAIL_BATCH_SIZE || '20', 10)
const STUCK_MINUTES = 15

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function transport() {
  return nodemailer.createTransport({
    host: need('SMTP_HOST'),
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: need('SMTP_USER'), pass: need('SMTP_PASSWORD') },
  })
}

const isMandatory = et => MANDATORY_EVENTS.includes(et)
const nowIso = () => new Date().toISOString()

// Logga provider-metadata utan secrets/innehåll.
async function logProvider(queueId, status, meta) {
  try {
    await sb.from('notification_provider_logs').insert({ queue_id: queueId, provider: 'smtp', channel: 'email', status, meta })
  } catch { /* loggning får aldrig stoppa leverans */ }
}

// Skriv leveransspårning (en rad per köpost, uppdateras över försök).
async function trackDelivery(queueId, fields) {
  await sb.from('notification_deliveries')
    .upsert({ queue_id: queueId, channel: 'email', provider: 'smtp', last_attempt_at: nowIso(), ...fields }, { onConflict: 'queue_id' })
}

async function markSent(row, messageId) {
  await sb.from('notification_queue').update({ status: 'sent', error_message: null, updated_at: nowIso() }).eq('id', row.id)
  await trackDelivery(row.id, { status: 'sent', provider_message_id: messageId || null, delivered_at: nowIso(), failed_at: null, failure_reason: null })
  await logProvider(row.id, 'sent', { messageId: messageId || null })
}

async function markFailed(row, reason) {
  const t = failureTransition(row, reason)
  await sb.from('notification_queue').update({
    status: t.status, attempt_count: t.attempt_count, next_retry_at: t.next_retry_at,
    error_message: t.error_message, updated_at: nowIso(),
  }).eq('id', row.id)
  await trackDelivery(row.id, { status: t.status === 'failed' ? 'failed' : 'retrying', failed_at: t.status === 'failed' ? nowIso() : null, failure_reason: String(reason).slice(0, 300) })
  await logProvider(row.id, t.status === 'failed' ? 'failed' : 'retry', { attempt: t.attempt_count, willRetryAt: t.next_retry_at, code: String(reason).slice(0, 120) })
  return t
}

async function markSkipped(row, reason) {
  await sb.from('notification_queue').update({ status: 'skipped', error_message: reason, updated_at: nowIso() }).eq('id', row.id)
  await logProvider(row.id, 'skipped', { reason })
}

// Lösenord/secrets aldrig till opt-out-check: läs preferens för (user, event, email).
async function isOptedOut(userId, companyId, eventType) {
  if (isMandatory(eventType)) return false // obligatoriska kan ej väljas bort
  const { data } = await sb.from('notification_preferences')
    .select('enabled').eq('user_id', userId).eq('event_type', eventType).eq('channel', 'email')
    .limit(1)
  if (data && data.length && data[0].enabled === false) return true
  return false
}

async function resolveEmail(userId) {
  if (!userId) return null
  const { data, error } = await sb.auth.admin.getUserById(userId)
  if (error || !data?.user) return null
  return data.user.email || null
}

// Återställ poster som fastnat i 'processing' (krasch mellan claim och utskick).
async function recoverStuck() {
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString()
  const { data } = await sb.from('notification_queue')
    .update({ status: 'pending', updated_at: nowIso() })
    .eq('status', 'processing').eq('channel', 'email').lt('updated_at', cutoff).select('id')
  if (data?.length) console.log(`Återställde ${data.length} fastnade poster -> pending`)
}

// Atomiskt claim: pending -> processing för en batch (förhindrar dubbelutskick).
async function claimBatch() {
  const { data: pend } = await sb.from('notification_queue')
    .select('id').eq('channel', 'email').eq('status', 'pending')
    .lte('scheduled_at', nowIso())
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso()}`)
    .order('priority', { ascending: false }).order('scheduled_at', { ascending: true })
    .limit(BATCH)
  const ids = (pend || []).map(r => r.id)
  if (!ids.length) return []
  const { data: claimed } = await sb.from('notification_queue')
    .update({ status: 'processing', updated_at: nowIso() })
    .in('id', ids).eq('status', 'pending')
    .select('*, notification_events(event_type), companies(name)')
  return claimed || []
}

async function processQueue() {
  await recoverStuck()
  const rows = await claimBatch()
  if (!rows.length) { console.log('Inga pending email-notiser.'); return { sent: 0, failed: 0, skipped: 0 } }
  console.log(`Bearbetar ${rows.length} email-notis(er)…`)
  const tx = transport()
  let sent = 0, failed = 0, skipped = 0
  for (const row of rows) {
    const eventType = row.notification_events?.event_type || row.object_type || 'notification'
    const companyName = row.companies?.name || null
    try {
      const email = await resolveEmail(row.user_id)
      if (await isOptedOut(row.user_id, row.company_id, eventType)) { await markSkipped(row, 'opted-out'); skipped++; continue }
      const decision = deliveryDecision(row, { recipientEmail: email })
      if (decision.action === 'fail') { await markFailed({ ...row, attempt_count: row.max_attempts }, decision.reason); failed++; continue }
      if (decision.action !== 'send') { await sb.from('notification_queue').update({ status: 'pending', updated_at: nowIso() }).eq('id', row.id); continue }

      const unsubUrl = UNSUB_SECRET && UNSUB_BASE ? unsubscribeUrl(UNSUB_BASE, row.user_id, eventType, UNSUB_SECRET) : null
      const footer = emailFooter({ companyName, unsubUrl })
      const html = buildEmailHtml({ subject: row.subject, body: row.body, linkUrl: row.link_url, footer })
      const headers = unsubUrl ? { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}

      const info = await tx.sendMail({
        from: SMTP_FROM, to: email,
        subject: row.subject || 'Notis från BokPilot',
        text: (row.body || '') + footer.text,
        html, headers,
      })
      await markSent(row, info.messageId)
      sent++
      console.log(`  ✓ sent -> ${email.replace(/(.{2}).*(@.*)/, '$1***$2')} (${eventType})`)
    } catch (err) {
      const t = await markFailed(row, err?.message || String(err))
      failed++
      console.log(`  ✗ fail (${eventType}) attempt ${t.attempt_count} -> ${t.status}`)
    }
  }
  tx.close()
  console.log(`Klart: ${sent} skickade, ${failed} misslyckade, ${skipped} överhoppade.`)
  return { sent, failed, skipped }
}

async function verifySmtp() {
  const tx = transport()
  await tx.verify()
  console.log('SMTP-anslutning OK (verify).')
  tx.close()
}

async function sendTest(to) {
  const dest = to && isValidEmail(to) ? to : process.env.SMTP_USER
  const tx = transport()
  const info = await tx.sendMail({
    from: SMTP_FROM, to: dest,
    subject: 'BokPilot — testnotis',
    text: 'Detta är ett testmail från BokPilots notifikationssystem (email-kö-processorn). Om du ser det här fungerar SMTP-leveransen.',
    html: buildEmailHtml({ subject: 'BokPilot — testnotis', body: 'Detta är ett testmail från BokPilots notifikationssystem (email-kö-processorn). Om du ser det här fungerar SMTP-leveransen.', footer: emailFooter({ companyName: null, unsubUrl: null }) }),
  })
  console.log(`Testmail skickat till ${dest}. messageId=${info.messageId}`)
  tx.close()
}

const args = process.argv.slice(2)
try {
  if (args.includes('--verify')) await verifySmtp()
  else if (args.includes('--test')) await sendTest(args[args.indexOf('--test') + 1])
  else await processQueue()
  process.exit(0)
} catch (err) {
  console.error('Fel:', err?.message || err)
  // Rapportera produktionskritiskt fel i kö-processorn till plattformsadmins (dedupe per timme).
  try { await sb.rpc('report_system_error', { p_component: 'email-worker', p_message: String(err?.message || err).slice(0, 300) }) } catch { /* rapportering får ej maskera ursprungsfelet */ }
  process.exit(1)
}
