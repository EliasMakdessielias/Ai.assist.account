// Edge Function: annual-report-pdf (Steg 2C-5)
// Serverrenderad ARKIV-PDF av K2-årsredovisningsutkastet (samma dokumentmodell som HTML-preview).
// Renderar med pdf-lib (ren JS, ingen headless-browser), laddar upp till privat storage-bucket, kör
// kvalitetskontroller och uppdaterar annual_report_exports. Detta är en GRANSKNINGS-/ARKIV-PDF –
// INGEN e-inlämning till Bolagsverket, INGEN signering, inget skickas externt, ingen bokföring ändras.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb, degrees } from 'https://esm.sh/pdf-lib@1.17.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const SECTION_ORDER = ['forvaltningsberattelse', 'resultatrakning', 'balansrakning', 'noter', 'faststallelseintyg', 'underskriftssida']
const SECTION_LABEL: Record<string, string> = {
  forvaltningsberattelse: 'Förvaltningsberättelse', resultatrakning: 'Resultaträkning', balansrakning: 'Balansräkning',
  noter: 'Noter', faststallelseintyg: 'Fastställelseintyg', underskriftssida: 'Underskriftssida',
}
const FIELD_LABEL: Record<string, string> = {
  rorelsens_intakter: 'Rörelsens intäkter', rorelsens_kostnader: 'Rörelsens kostnader',
  finansiella_poster_och_skatt: 'Finansiella poster och skatt', arets_resultat: 'Årets resultat',
  summa_tillgangar: 'Summa tillgångar', eget_kapital_och_skulder: 'Eget kapital och skulder',
  balanskontroll_differens: 'Balanskontroll (differens)',
}
const fmtAmount = (n: unknown) => (n === null || n === undefined || n === '') ? '–'
  : Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function toHex(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('') }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let userClient: any = null, exportId: string | null = null
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Ej inloggad' }, 401)

    const { draft_id } = await req.json()
    if (!draft_id) return json({ error: 'draft_id krävs' }, 400)

    // Skapa export-rad + hämta render-kontext (auktoriserar admin, kräver draft med sektioner).
    const { data: ctx, error: ctxErr } = await userClient.rpc('annual_report_request_server_pdf', { p_draft: draft_id })
    if (ctxErr) return json({ error: ctxErr.message?.replace(/^.*?:\s*/, '') || 'Kunde inte förbereda export', code: ctxErr.code }, ctxErr.code === '42501' ? 403 : 400)
    exportId = ctx.export_id

    const company = ctx.company || {}
    const draft = ctx.draft || {}
    const sections: any[] = ctx.sections || []
    const w = ctx.warnings || {}
    const byKey: Record<string, any> = Object.fromEntries(sections.map(s => [s.section_key, s]))

    // ── Rendera PDF ──
    const doc = await PDFDocument.create()
    const reg = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const A4 = { w: 595.28, h: 841.89 }
    const M = { l: 56, r: 56, t: 56, b: 64 }
    const maxW = A4.w - M.l - M.r
    let page = doc.addPage([A4.w, A4.h]); let y = A4.h - M.t

    const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - M.t }
    const ensure = (h: number) => { if (y - h < M.b) newPage() }
    const wrap = (s: string, font: any, size: number, width: number) => {
      const out: string[] = []
      for (const para of String(s ?? '').split('\n')) {
        if (para === '') { out.push(''); continue }
        let line = ''
        for (const word of para.split(/\s+/)) {
          const t = line ? line + ' ' + word : word
          if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = word } else line = t
        }
        if (line) out.push(line)
      }
      return out
    }
    const draw = (s: string, opt: any = {}) => {
      const size = opt.size ?? 10.5, font = opt.font ?? reg, color = opt.color ?? rgb(0.1, 0.1, 0.1), lh = size * 1.4
      for (const ln of wrap(s, font, size, maxW)) { ensure(lh); page.drawText(ln, { x: M.l, y: y - size, size, font, color }); y -= lh }
    }
    const gap = (h: number) => { y -= h }

    // Varningsrutor överst
    const warnings: { text: string; c: number[] }[] = []
    if (w.is_draft) warnings.push({ text: 'UTKAST – ej godkänd årsredovisning', c: [0.71, 0.33, 0.05] })
    if (w.has_high_critical) warnings.push({ text: 'VARNING: Utkastet har öppna valideringspunkter och är inte klart för användning.', c: [0.73, 0.11, 0.11] })
    if (w.has_ai) warnings.push({ text: 'Dokumentet innehåller AI-genererade texter som kräver mänsklig granskning.', c: [0.43, 0.16, 0.69] })
    for (const wn of warnings) {
      const lines = wrap(wn.text, bold, 10, maxW - 16); const boxH = lines.length * 13 + 12
      ensure(boxH + 6)
      page.drawRectangle({ x: M.l, y: y - boxH, width: maxW, height: boxH, borderColor: rgb(wn.c[0], wn.c[1], wn.c[2]), borderWidth: 1, color: rgb(1, 1, 1) })
      let ty = y - 14
      for (const ln of lines) { page.drawText(ln, { x: M.l + 8, y: ty - 8, size: 10, font: bold, color: rgb(wn.c[0], wn.c[1], wn.c[2]) }); ty -= 13 }
      y -= boxH + 8
    }

    // Rubrik
    gap(8)
    const center = (s: string, size: number, font: any, color = rgb(0.07, 0.07, 0.07)) => {
      const tw = font.widthOfTextAtSize(s, size); ensure(size * 1.5)
      page.drawText(s, { x: M.l + (maxW - tw) / 2, y: y - size, size, font, color }); y -= size * 1.5
    }
    center(company.name || '—', 18, bold)
    center('Org.nr ' + (company.org_nr || '—'), 11, reg, rgb(0.4, 0.4, 0.4))
    gap(8)
    center('Årsredovisning', 14, bold)
    center('för räkenskapsåret ' + (draft.period_start || '—') + ' – ' + (draft.period_end || '—'), 10.5, reg, rgb(0.4, 0.4, 0.4))
    center('Regelverk: ' + (draft.regelverk || 'K2') + ' (BFNAR 2016:10)', 10, reg, rgb(0.5, 0.5, 0.5))
    gap(14)

    const sectionHeading = (label: string, ai: boolean) => {
      ensure(28)
      page.drawText(label, { x: M.l, y: y - 13, size: 13, font: bold, color: rgb(0.07, 0.07, 0.07) }); y -= 16
      if (ai) { page.drawText('(AI-genererad – kräver granskning)', { x: M.l, y: y - 9, size: 9, font: reg, color: rgb(0.43, 0.16, 0.69) }); y -= 12 }
      page.drawLine({ start: { x: M.l, y }, end: { x: A4.w - M.r, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) }); y -= 8
    }
    const structuredTable = (sd: any) => {
      const keys = Object.keys(FIELD_LABEL).filter(k => sd && sd[k] !== undefined && sd[k] !== null)
      for (const k of keys) {
        ensure(15); const amt = fmtAmount(sd[k]); const aw = reg.widthOfTextAtSize(amt, 10.5)
        page.drawText(FIELD_LABEL[k], { x: M.l, y: y - 10.5, size: 10.5, font: reg, color: rgb(0.15, 0.15, 0.15) })
        page.drawText(amt, { x: A4.w - M.r - aw, y: y - 10.5, size: 10.5, font: reg, color: rgb(0.15, 0.15, 0.15) })
        y -= 13; page.drawLine({ start: { x: M.l, y: y + 2 }, end: { x: A4.w - M.r, y: y + 2 }, thickness: 0.3, color: rgb(0.9, 0.9, 0.9) })
      }
      if (sd && 'balanserar' in sd) { gap(2); draw(sd.balanserar ? 'Balansräkningen balanserar.' : 'Balansräkningen balanserar inte – kräver manuell granskning.', { size: 9.5, color: sd.balanserar ? rgb(0.08, 0.5, 0.18) : rgb(0.73, 0.11, 0.11) }) }
      if (sd && sd.jamforelsetal) draw(String(sd.jamforelsetal), { size: 9, color: rgb(0.5, 0.5, 0.5) })
    }

    const sectionsPresent: string[] = []
    for (const k of SECTION_ORDER) {
      const s = byKey[k]; if (!s) continue
      sectionsPresent.push(k); gap(10); sectionHeading(SECTION_LABEL[k], !!s.ai_generated)
      if (k === 'resultatrakning' || k === 'balansrakning') structuredTable(s.structured_data || {})
      if (s.content) { gap(2); draw(String(s.content), { size: 10.5 }) }
    }

    // Sidfot + sidnummer + diagonal UTKAST-vattenstämpel
    const pages = doc.getPages(); const total = pages.length
    const genStr = new Date().toISOString().slice(0, 16).replace('T', ' ')
    pages.forEach((pg, i) => {
      const footer = `BokPilot · Gransknings-/arkivexempel – ej för inlämning · Export ${exportId} · Genererad ${genStr}`
      pg.drawText(footer.slice(0, 120), { x: M.l, y: 36, size: 7.5, font: reg, color: rgb(0.55, 0.55, 0.55) })
      const pn = `Sida ${i + 1} av ${total}`; const pw = reg.widthOfTextAtSize(pn, 8)
      pg.drawText(pn, { x: A4.w - M.r - pw, y: 36, size: 8, font: reg, color: rgb(0.45, 0.45, 0.45) })
      if (w.is_draft) pg.drawText('UTKAST', { x: 120, y: 360, size: 90, font: bold, color: rgb(0.93, 0.93, 0.93), rotate: degrees(45) })
    })

    const bytes = await doc.save()
    const fileSize = bytes.byteLength
    const checksum = toHex(await crypto.subtle.digest('SHA-256', bytes))
    const path = ctx.storage_path as string
    const fileName = `arsredovisning-utkast-${draft.period_end || ''}.pdf`

    // Ladda upp till privat bucket via service role.
    const admin = createClient(SUPABASE_URL, SERVICE)
    const up = await admin.storage.from('annual-report-exports').upload(path, bytes, { contentType: 'application/pdf', upsert: true })
    if (up.error) throw new Error('Uppladdning misslyckades: ' + up.error.message)

    // Kvalitetskontroller (utifrån renderad input + output).
    const checks = {
      file_size_positive: fileSize > 0,
      has_pages: total >= 1,
      has_company_name: !!(company.name && String(company.name).trim()),
      has_org_nr: !!(company.org_nr && String(company.org_nr).trim()),
      has_all_sections: SECTION_ORDER.every(k => sectionsPresent.includes(k)),
      utkast_warning_present: w.is_draft ? warnings.some(x => x.text.startsWith('UTKAST')) : true,
      ai_warning_present: w.has_ai ? warnings.some(x => x.text.includes('AI-genererade')) : true,
      validation_warning_present: w.has_high_critical ? warnings.some(x => x.text.startsWith('VARNING')) : true,
    }
    const hardFail = !checks.file_size_positive || !checks.has_pages || !checks.has_all_sections || !checks.has_company_name
    const softWarn = !checks.has_org_nr
    const quality_status = hardFail ? 'failed' : (softWarn ? 'warning' : 'passed')
    const quality_report = { engine: 'pdf-lib', page_count: total, file_size: fileSize, checksum, generated_at: genStr, checks }

    const { error: finErr } = await userClient.rpc('annual_report_finalize_server_pdf', {
      p_export: exportId, p_storage_path: path, p_file_name: fileName, p_file_size: fileSize,
      p_checksum: checksum, p_render_engine: 'pdf-lib', p_quality_status: quality_status, p_quality_report: quality_report,
    })
    if (finErr) throw new Error(finErr.message)

    return json({ ok: true, export_id: exportId, file_size: fileSize, quality_status, page_count: total })
  } catch (err) {
    const msg = String((err as Error)?.message || err)
    if (userClient && exportId) { try { await userClient.rpc('annual_report_mark_export_failed', { p_export: exportId, p_error: msg }) } catch { /* ignore */ } }
    return json({ error: msg }, 400)
  }
})
