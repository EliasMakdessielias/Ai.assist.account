import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { tolkaDocument } from '../lib/tolka'
import { INBOX_CATEGORIES as KATS } from '../lib/inboxAddresses'
import DocumentSplitLayout from '../components/viewer/DocumentSplitLayout'
import DocumentViewerPanel from '../components/viewer/DocumentViewerPanel'
import { useDocumentViewerLayout } from '../lib/viewer/useDocumentViewerLayout'
import { sectionSlug, sanitizeFilename, dedupeNames, zipFileName, checkZipLimits, partialSummary } from '../lib/inboxDownload'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Inkorg() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [docs, setDocs] = useState([])
  const [kat, setKat] = useState('kvitto')
  const [selected, setSelected] = useState(null)
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [addrs, setAddrs] = useState({})
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef()
  // Gemensam dokumentvisare till höger – egen layout-nyckel (krockar ej med andra moduler).
  const { panelW, dragging, startResize } = useDocumentViewerLayout({ widthKey: 'bokpilot.inkorg.viewerW' })

  const cur = KATS.find(k => k.key === kat)
  const inboxAddr = addrs.underlag || ''

  useEffect(() => { if (company) load() }, [company?.id])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    const [{ data }, { data: ia }] = await Promise.all([
      supabase.from('documents').select('*, verifikationer(ver_nr)').eq('company_id', company.id).order('created_at', { ascending: false }),
      supabase.from('inbox_addresses').select('inbox_type, email_address, is_active').eq('company_id', company.id),
    ])
    setDocs(data || [])
    setAddrs(Object.fromEntries((ia || []).filter(a => a.is_active).map(a => [a.inbox_type, a.email_address])))
    setSelected(prev => (data || []).find(d => d.id === prev?.id) || null)
    if (!silent) setLoading(false)
  }

  // Auto-uppdatera så inmejlade underlag dyker upp utan manuell omladdning
  // (vid fönster-fokus + var 45:e sekund). Tyst – ingen spinner.
  useEffect(() => {
    if (!company) return
    const refresh = () => { if (!document.hidden) load(true) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const iv = setInterval(refresh, 45000)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); clearInterval(iv) }
  }, [company?.id])

  useEffect(() => {
    let active = true; setUrl(null)
    if (!selected || !selected.storage_path) return
    supabase.storage.from('underlag').createSignedUrl(selected.storage_path, 3600).then(({ data }) => { if (active) setUrl(data?.signedUrl || null) })
    return () => { active = false }
  }, [selected?.id])

  async function tolkaDoc(doc, silent) {
    setBusyId(doc.id)
    try {
      const r = await tolkaDocument(doc.id)
      await supabase.from('documents').update({ tolkning: r, tolkad: true }).eq('id', doc.id)
      if (!silent) toast.success('Tolkat')
      setBusyId(null); return true
    } catch (e) { if (!silent) toast.error(e.message || String(e)); setBusyId(null); return false }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    const created = []
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${company.id}/${crypto.randomUUID()}-${safe}`
      const { error: upErr } = await supabase.storage.from('underlag').upload(path, file, { contentType: file.type })
      if (upErr) { toast.error(`Kunde inte ladda upp ${file.name}: ${upErr.message}`); continue }
      const { data: row, error: insErr } = await supabase.from('documents').insert({
        company_id: company.id, storage_path: path, file_name: file.name, mime_type: file.type, file_size: file.size, kategori: kat,
      }).select().single()
      if (!insErr && row) created.push(row)
    }
    if (created.length) toast.success(`${created.length} underlag uppladdat`)
    e.target.value = ''
    setUploading(false)
    await load()
    // Auto-tolka kvitton/leverantörsfakturor
    if (cur.tolka && created.length) {
      const t = toast.loading(`Tolkar ${created.length} underlag…`)
      let stopped = false
      for (const d of created) { if (!await tolkaDoc(d, true)) { stopped = true; break } }
      toast.dismiss(t)
      if (stopped) toast.error('AI-tolkning kunde inte slutföras (kvot/fel) – du kan tolka manuellt senare.')
      else toast.success('Tolkning klar')
      load()
    }
  }

  async function flytta(doc, nyKat) {
    if (!nyKat) return
    await supabase.from('documents').update({ kategori: nyKat }).eq('id', doc.id)
    toast.success('Flyttad'); load()
  }
  async function handleDelete(doc) {
    if (!confirm(`Radera "${doc.file_name}"?`)) return
    await supabase.storage.from('underlag').remove([doc.storage_path])
    await supabase.from('documents').delete().eq('id', doc.id)
    if (selected?.id === doc.id) setSelected(null)
    toast.success('Raderat'); load()
  }

  function skapa(doc) {
    if (cur.create === 'lev') navigate(`/leverantorsfakturor/ny?doc=${doc.id}&tolka=1`)
    else navigate(`/bokforing/ny?underlag=${doc.id}&tolka=1`)
  }

  // ---- Nedladdning (krav A–F) ----
  function triggerBlobDownload(blob, filename) {
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = u; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 4000)
  }
  // Fire-and-forget audit (krav F.5) – loggar metadata, aldrig filinnehåll. .then() krävs
  // för att supabase-js (lat query-builder) faktiskt ska skicka anropet.
  function auditDownload(kind, count) {
    supabase.rpc('log_inbox_download', { p_company_id: company.id, p_section: sectionSlug(kat), p_kind: kind, p_file_count: count }).then(() => {}, () => {})
  }
  // Enskild fil: signerad URL (kort TTL, RLS-skyddad) med Content-Disposition (saneras filnamn).
  async function downloadSingle(doc) {
    if (!doc?.storage_path) return toast.error('Filen saknas i lagringen')
    const name = sanitizeFilename(doc.file_name)
    const { data, error } = await supabase.storage.from('underlag').createSignedUrl(doc.storage_path, 120, { download: name })
    if (error || !data?.signedUrl) return toast.error('Kunde inte ladda ner filen')
    const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noreferrer'
    document.body.appendChild(a); a.click(); a.remove()
    auditDownload('single', 1)
  }
  // ZIP av en lista underlag. selected=true för "Ladda ner valda" (annat filnamn).
  async function downloadZip(list, { selected }) {
    const slug = sectionSlug(kat)
    const withFile = (list || []).filter(d => d.storage_path)
    let fail = (list || []).length - withFile.length          // saknar fil -> hoppa över (krav 6)
    const lim = checkZipLimits(withFile.map(d => ({ size: d.file_size })))
    if (!lim.ok) {
      if (lim.reason === 'empty') return toast.error('Inga filer att ladda ner')
      if (lim.reason === 'too_many') return toast.error(`För många filer (max ${lim.limit}). Markera färre.`)
      if (lim.reason === 'too_large') return toast.error('Filpaketet är för stort (max 150 MB). Markera färre.')
      return toast.error('Kunde inte skapa ZIP')
    }
    setDownloading(true)
    const id = toast.loading('Förbereder ZIP…')
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const paths = withFile.map(d => d.storage_path)
      const { data: signed } = await supabase.storage.from('underlag').createSignedUrls(paths, 120)
      const urlByPath = Object.fromEntries((signed || []).map(s => [s.path, s.signedUrl]))
      const names = dedupeNames(withFile.map(d => sanitizeFilename(d.file_name)))   // unika namn (krav D.3)
      let ok = 0
      for (let i = 0; i < withFile.length; i++) {
        toast.loading(`Hämtar filer (${i + 1}/${withFile.length})…`, { id })
        try {
          const url = urlByPath[withFile[i].storage_path]
          if (!url) throw new Error('no url')
          const res = await fetch(url); if (!res.ok) throw new Error('http ' + res.status)
          zip.file(names[i], await res.blob())
          ok++
        } catch { fail++ }
      }
      if (ok === 0) { toast.error('Inga filer kunde hämtas', { id }); return }
      toast.loading('Skapar ZIP…', { id })
      const blob = await zip.generateAsync({ type: 'blob' })
      toast.loading('Laddar ner…', { id })
      triggerBlobDownload(blob, zipFileName(slug, { selected }))
      auditDownload(selected ? 'selected' : 'section', ok)
      toast.success(partialSummary(ok, fail), { id })
    } catch {
      toast.error('Kunde inte skapa ZIP', { id })
    } finally {
      setDownloading(false)
    }
  }

  const summary = t => {
    if (!t) return null
    const lev = t.leverantor || t.leverantör || t.supplier
    const tot = t.belopp_inkl_moms ?? t.total ?? t.belopp
    const dat = t.fakturadatum || t.datum
    return [lev, dat, tot != null ? `${fmt(tot)} kr` : null].filter(Boolean).join(' · ')
  }

  const visible = docs.filter(d => (d.kategori || 'dokument') === kat && !d.verifikation_id)
  const counts = Object.fromEntries(KATS.map(k => [k.key, docs.filter(d => (d.kategori || 'dokument') === k.key && !d.verifikation_id).length]))
  const fileIcon = m => m === 'application/pdf' ? 'ti-file-type-pdf' : m?.startsWith('image/') ? 'ti-photo' : 'ti-file'
  // Klassificeringsbadge (detekterad typ-confidence/status) för e-postunderlag.
  function classBadge(d) {
    const conf = d.confidence != null ? Math.round(Number(d.confidence) * 100) : null
    if (d.status === 'unsupported') return <span className="text-[11px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded">Filtyp stöds ej</span>
    if (d.status === 'needs_review') return <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Behöver granskas{conf != null ? ` · ${conf}%` : ''}</span>
    return <span className="text-[11px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded">Klassificerad{conf != null ? ` · ${conf}%` : ''}</span>
  }

  const selVisible = visible.filter(d => sel.has(d.id))
  const toggleSel = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => { const ids = visible.map(d => d.id); const all = ids.length && ids.every(i => sel.has(i)); setSel(s => { const n = new Set(s); ids.forEach(i => all ? n.delete(i) : n.add(i)); return n }) }
  async function tolkaMarkerade() {
    if (!selVisible.length) return
    const t = toast.loading(`Tolkar ${selVisible.length} underlag…`)
    let stopped = false
    for (const d of selVisible) { if (!await tolkaDoc(d, true)) { stopped = true; break } }
    toast.dismiss(t)
    if (stopped) toast.error('AI-tolkning kunde inte slutföras (kvot/fel) – försök igen senare.')
    else toast.success('Tolkning klar')
    setSel(new Set()); load()
  }
  async function flyttaMarkerade(nyKat) {
    if (!nyKat || !selVisible.length) return
    for (const d of selVisible) await supabase.from('documents').update({ kategori: nyKat }).eq('id', d.id)
    toast.success(`${selVisible.length} flyttade`); setSel(new Set()); load()
  }
  async function raderaMarkerade() {
    if (!selVisible.length || !confirm(`Radera ${selVisible.length} dokument? Detta går inte att ångra.`)) return
    for (const d of selVisible) { await supabase.storage.from('underlag').remove([d.storage_path]); await supabase.from('documents').delete().eq('id', d.id) }
    toast.success(`${selVisible.length} raderade`); setSel(new Set()); load()
  }

  const viewerDocs = selected ? [{ id: selected.id, url, file_name: selected.file_name, mime_type: selected.mime_type }] : []
  const viewerPanel = selected ? (
    <DocumentViewerPanel
      docs={viewerDocs} index={0} title={selected.file_name}
      onClose={() => setSelected(null)} dragging={dragging} emptyIcon={cur.icon}
      footer={cur.create ? (
        <button className="btn btn-green w-full justify-center py-2" onClick={() => skapa(selected)}>
          <i className="ti ti-file-plus" /> {cur.create === 'lev' ? 'Skapa leverantörsfaktura' : 'Skapa verifikation'}
        </button>
      ) : null}
    />
  ) : null

  return (
    <DocumentSplitLayout open={!!selected} panelW={panelW} startResize={startResize} panel={viewerPanel}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-base font-medium">Inkorg</span>
          <div className="flex items-center gap-2.5">
            <button className="btn" onClick={() => downloadZip(visible, { selected: false })} disabled={downloading || visible.length === 0}
              title={visible.length === 0 ? 'Inga filer i fliken' : `Ladda ner alla ${cur.label.toLowerCase()} som ZIP`}>
              <i className="ti ti-download" /> Ladda ner alla{visible.length ? ` (${visible.length})` : ''}
            </button>
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <i className="ti ti-upload" /> {uploading ? 'Laddar upp…' : `Ladda upp till ${cur.label}`}
            </button>
          </div>
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleUpload} />
        </div>

        {/* Kategori-flikar */}
        <div className="bg-white border-b flex gap-0 px-7 overflow-x-auto" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          {KATS.map(k => (
            <button key={k.key} onClick={() => { setKat(k.key); setSelected(null); setSel(new Set()) }}
              className={`px-4 py-2.5 text-[13.5px] whitespace-nowrap border-b-[2.5px] -mb-px transition-colors flex items-center gap-2 ${kat === k.key ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
              <i className={`ti ${k.icon}`} /> {k.label}
              {counts[k.key] > 0 && <span className="bg-blue-100 text-blue-700 text-[10px] font-semibold px-1.5 rounded-full">{counts[k.key]}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-7">
          {/* Mejla in-adress */}
          <div className="flex items-center gap-3 bg-gray-50 border rounded-lg px-4 py-2.5 mb-4 text-sm" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
            <i className="ti ti-mail text-gray-500" />
            <span className="text-gray-500">Mejla in underlag till:</span>
            <span className="font-medium text-gray-800 font-mono">{inboxAddr}</span>
            <button className="btn text-xs py-1 px-2 ml-1" disabled={!inboxAddr} onClick={() => { navigator.clipboard?.writeText(inboxAddr); toast.success('E-postadress kopierad') }}><i className="ti ti-copy" /> Kopiera</button>
            <span className="text-xs text-green-700 ml-auto flex items-center gap-1"><i className="ti ti-sparkles" /> Klassificeras automatiskt</span>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-400">Laddar…</div>
          ) : visible.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <i className={`ti ${cur.icon} text-4xl block mb-2 opacity-30`} />
              <div className="font-medium text-gray-500 mb-1">Inga {cur.label.toLowerCase()} i inkorgen</div>
              <div className="text-sm">Ladda upp eller mejla in till adressen ovan.</div>
            </div>
          ) : (
            <>
            {selVisible.length > 0 && (
              <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3 text-sm flex-wrap">
                <span className="font-medium">{selVisible.length} markerade</span>
                <button className="btn text-xs py-1 px-3" onClick={() => downloadZip(selVisible, { selected: true })} disabled={downloading}>
                  <i className="ti ti-download" /> Ladda ner valda ({selVisible.length})
                </button>
                {cur.tolka && <button className="btn btn-green text-xs py-1 px-3" onClick={tolkaMarkerade}><i className="ti ti-sparkles" /> Tolka markerade</button>}
                <span className="text-gray-500 ml-1">Flytta till:</span>
                <select className="input text-xs py-1 w-auto" value="" onChange={e => flyttaMarkerade(e.target.value)}>
                  <option value="">Välj…</option>
                  {KATS.filter(k => k.key !== kat).map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
                <button className="btn btn-danger text-xs py-1 px-3" onClick={raderaMarkerade}><i className="ti ti-trash" /> Radera markerade</button>
                <button className="text-gray-500 text-xs underline ml-auto" onClick={() => setSel(new Set())}>Avmarkera alla</button>
              </div>
            )}
            <div className="bg-white rounded-xl overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2.5 border-b w-8" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                      <input type="checkbox" checked={visible.length > 0 && visible.every(d => sel.has(d.id))} onChange={toggleAll} />
                    </th>
                    <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Fil</th>
                    {cur.tolka && <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Tolkning</th>}
                    <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Uppladdad</th>
                    <th className="px-4 py-2.5 border-b w-56" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(d => (
                    <tr key={d.id} className={`cursor-pointer hover:bg-gray-50 ${selected?.id === d.id ? 'bg-blue-50' : ''}`} onClick={() => setSelected(d)}>
                      <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleSel(d.id)} />
                      </td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        <span className="flex items-center gap-2"><i className={`ti ${fileIcon(d.mime_type)} text-gray-400`} /> {d.file_name}</span>
                        {d.source === 'email' && <div className="mt-1">{classBadge(d)}</div>}
                      </td>
                      {cur.tolka && (
                        <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                          {busyId === d.id ? <span className="text-gray-400">Tolkar…</span> : d.tolkad ? (summary(d.tolkning) || <span className="text-green-700">Tolkad</span>) : <span className="text-gray-300">Ej tolkad</span>}
                        </td>
                      )}
                      <td className="px-4 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{d.created_at?.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <select className="input text-xs py-1 w-auto" title="Ändra kategori" value={d.kategori || 'dokument'} onChange={e => flytta(d, e.target.value)}>
                            {KATS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                          </select>
                          {cur.tolka && <button className="btn text-xs py-1 px-2.5" onClick={() => tolkaDoc(d)} disabled={busyId === d.id}>{busyId === d.id ? '…' : (d.tolkad ? 'Tolka om' : 'Tolka')}</button>}
                          {cur.create && (
                            <button className="btn btn-green text-xs py-1 px-2.5 whitespace-nowrap" onClick={() => skapa(d)}>
                              <i className="ti ti-file-plus" /> {cur.create === 'lev' ? 'Skapa faktura' : 'Skapa ver.'}
                            </button>
                          )}
                          <button className="text-gray-300 hover:text-blue-600 px-1 disabled:opacity-40" title="Ladda ner fil" onClick={() => downloadSingle(d)} disabled={!d.storage_path}><i className="ti ti-download" /></button>
                          <button className="text-gray-300 hover:text-red-600 px-1" title="Radera" onClick={() => handleDelete(d)}><i className="ti ti-trash" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </div>
    </DocumentSplitLayout>
  )
}
