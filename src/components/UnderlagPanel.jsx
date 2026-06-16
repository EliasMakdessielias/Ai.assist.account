import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { tolkaDocument } from '../lib/tolka'
import { useContainerSize, previewWidthPx, computeAutoScale, clampScale, resolveViewerWidth, sidebarWidth } from '../lib/docPreview'
import PdfCanvas from './PdfCanvas'
import DocMagnifier from './DocMagnifier'

// Höger panel: företagets Inkorg av underlag (ej kopplade dokument).
// Ladda upp, bläddra (1 av N), förhandsvisa bild/PDF och Koppla till verifikationen.
// Layout: när `widthKey` anges äger panelen sin bredd via localStorage med 45%-standard
// (50% av ytan EFTER sidomenyn ≈ 45% av hela fönstret → ~10/45/45). Utan `widthKey`
// behålls tidigare beteende (initial bredd = `width`-propen), så övriga anropare påverkas ej.
const MIN_PANEL = 420       // krav 8: minsta panelbredd
const MIN_WORKSPACE = 520   // krav 7: arbetsytan får inte kollapsa

// Tillåtna underlagstyper vid uppladdning (knapp + drag-and-drop). Validering sker på både
// MIME-typ och filändelse (HEIC saknar ofta korrekt MIME). Originalfilen lämnas oförändrad.
const ACCEPT_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'webp']
const ACCEPT_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp']
const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.heic,.webp,application/pdf,image/png,image/jpeg,image/heic,image/heif,image/webp'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024  // 25 MB per fil

function fileExtOf(name = '') { const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : '' }
// Returnerar ett svenskt felmeddelande om filen inte får laddas upp, annars null.
export function validateUploadFile(f) {
  const ext = fileExtOf(f.name)
  const mimeOk = ACCEPT_MIME.includes(String(f.type || '').toLowerCase())
  if (!mimeOk && !ACCEPT_EXT.includes(ext)) return `Filtypen stöds inte (${ext || f.type || 'okänd'}). Tillåtna: PDF, JPG, PNG, HEIC, WEBP.`
  if (f.size > MAX_UPLOAD_BYTES) return `Filen är för stor (${(f.size / 1024 / 1024).toFixed(1)} MB, max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`
  return null
}

function sidebarCollapsedNow() {
  try { return localStorage.getItem('sidebarCollapsed') === '1' } catch { return false }
}
// Standardbredd för split-panelen: 50% av (fönster − sidomeny), respekterar giltig sparad bredd.
function defaultSplitWidth(widthKey) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const avail = Math.max(MIN_PANEL, vw - sidebarWidth(vw, sidebarCollapsedNow()))
  let saved = null
  try { saved = widthKey ? localStorage.getItem(widthKey) : null } catch { /* ignore */ }
  return resolveViewerWidth(saved, avail, { fraction: 0.5, minPx: MIN_PANEL })
}

export default function UnderlagPanel({ company, attachIds = [], onToggleAttach, onTolkat, onCouple, selectDocId, title = 'VÄLJ UNDERLAG', reloadSignal, onClose, width = 520, widthKey }) {
  const [docs, setDocs] = useState([])
  const [idx, setIdx] = useState(0)
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)      // drag-and-drop aktiv över panelen
  const [uploads, setUploads] = useState([])           // per-fil status: pending|uploading|uploaded|failed
  const dragDepth = useRef(0)                           // räknare så dragleave på barn inte släcker overlayn
  const [interpreting, setInterpreting] = useState(false)
  const [coupling, setCoupling] = useState(false)
  const [mode, setMode] = useState('auto')          // 'auto' (fit-to-panel) | 'manual'
  const [manualScale, setManualScale] = useState(1) // manuell zoom (naturlig-relativ för bild, container-relativ för PDF)
  const [natural, setNatural] = useState({ w: 0, h: 0 }) // bildens naturliga storlek (för fit-beräkning)
  const previewRef = useRef(null)
  const { width: cw, height: ch } = useContainerSize(previewRef)
  const [w, setW] = useState(() => widthKey ? defaultSplitWidth(widthKey) : width)
  // Spara användarens panelbredd per vy (krav 10) – bara när vyn äger en widthKey.
  useEffect(() => { if (widthKey) try { localStorage.setItem(widthKey, String(w)) } catch { /* ignore */ } }, [w, widthKey])
  const [magnifier, setMagnifier] = useState(() => { try { return localStorage.getItem('bokpilot.viewer.magnifier') !== '0' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('bokpilot.viewer.magnifier', magnifier ? '1' : '0') } catch { /* ignore */ } }, [magnifier])
  const fileRef = useRef()

  // Dragbar splitter: panel ∈ [420, min(75% av fönstret, fönster − sidomeny − 520)]
  // så arbetsytan aldrig kollapsar (krav 7/8/9).
  function startResize(e) {
    e.preventDefault()
    const vw = window.innerWidth
    const sb = sidebarWidth(vw, sidebarCollapsedNow())
    const max = Math.max(MIN_PANEL, Math.min(Math.round(vw * 0.75), vw - sb - MIN_WORKSPACE))
    const move = ev => setW(Math.min(max, Math.max(MIN_PANEL, vw - ev.clientX)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect = '' }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  useEffect(() => { if (company) loadInbox() }, [company, reloadSignal])

  async function loadInbox() {
    setLoading(true)
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('company_id', company.id)
      .is('verifikation_id', null)
      .order('created_at', { ascending: true })
    if (!error) {
      const list = data || []
      setDocs(list)
      const pre = selectDocId ? list.findIndex(d => d.id === selectDocId) : -1
      setIdx(pre >= 0 ? pre : prev => Math.min(prev, Math.max(0, list.length - 1)))
    }
    setLoading(false)
  }

  const current = docs[idx] || null

  // Hämta en signerad URL för det aktuella dokumentet (privat bucket).
  // Återställ till Auto (fit-to-panel) och nollställ naturlig storlek vid byte.
  useEffect(() => {
    let active = true
    setUrl(null)
    setMode('auto'); setManualScale(1); setNatural({ w: 0, h: 0 })
    if (!current) return
    supabase.storage.from('underlag').createSignedUrl(current.storage_path, 3600).then(({ data }) => {
      if (active) setUrl(data?.signedUrl || null)
    })
    return () => { active = false }
  }, [current?.id])

  // Auto-skala (fit-to-panel) för bild – räknas om automatiskt när panelen
  // ändrar storlek (useContainerSize → ResizeObserver med debounce).
  const autoScale = computeAutoScale(cw, ch, natural.w, natural.h)
  const isImage = current?.mime_type?.startsWith('image/')
  const isPdf = current?.mime_type === 'application/pdf'
  // Effektiv skala (naturlig-relativ för bild). Auto → fit, Manuell → manualScale.
  const effScale = mode === 'auto' ? (autoScale ?? 1) : manualScale
  const sliderValue = clampScale(mode === 'auto' ? (autoScale ?? 1) : manualScale)
  const zoomLabel = mode === 'auto'
    ? (autoScale ? `Auto · ${Math.round(autoScale * 100)}%` : 'Auto')
    : `Manual · ${Math.round(manualScale * 100)}%`
  const setManual = v => { setMode('manual'); setManualScale(clampScale(v)) }
  const bumpManual = delta => { setMode('manual'); setManualScale(s => clampScale(s + delta)) }

  // Ctrl/Cmd + skrollhjul zoomar (vanlig skroll panorerar) → går till manuellt läge.
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const onWheel = e => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      bumpManual(-Math.sign(e.deltaY) * 0.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Gemensam uppladdningspipeline för både "Ladda upp"-knappen och drag-and-drop.
  // Validerar varje fil, visar per-fil-status i panelen (inga popup-fel) och behåller
  // originalfilen oförändrad. Den första nya filen väljs automatiskt efteråt.
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length || uploading) return
    const items = files.map(f => ({ file: f, name: f.name, error: validateUploadFile(f) }))
    setUploads(items.map(it => ({ name: it.name, status: it.error ? 'failed' : 'pending', error: it.error || null })))
    const valid = items.map((it, i) => ({ ...it, i })).filter(it => !it.error)
    if (!valid.length) return  // bara ogiltiga filer → felen visas i panelen
    setUploading(true)
    const firstNewIndex = docs.length
    let ok = 0
    for (const it of valid) {
      setUploads(u => u.map((x, ix) => ix === it.i ? { ...x, status: 'uploading' } : x))
      const safe = it.file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${company.id}/${crypto.randomUUID()}-${safe}`
      const { error: upErr } = await supabase.storage.from('underlag').upload(path, it.file, { contentType: it.file.type })
      if (upErr) { setUploads(u => u.map((x, ix) => ix === it.i ? { ...x, status: 'failed', error: 'Uppladdning misslyckades: ' + upErr.message } : x)); continue }
      const { error: insErr } = await supabase.from('documents').insert({
        company_id: company.id, storage_path: path, file_name: it.file.name, mime_type: it.file.type, file_size: it.file.size,
      })
      if (insErr) { setUploads(u => u.map((x, ix) => ix === it.i ? { ...x, status: 'failed', error: 'Registrering misslyckades: ' + insErr.message } : x)); continue }
      setUploads(u => u.map((x, ix) => ix === it.i ? { ...x, status: 'uploaded' } : x))
      ok++
    }
    setUploading(false)
    if (ok) {
      await loadInbox()
      setIdx(firstNewIndex)                                   // välj den första nya filen
      setUploads(u => u.filter(x => x.status === 'failed'))   // behåll bara fel synliga
    }
  }

  async function handleUpload(e) {
    await uploadFiles(e.target.files)
    e.target.value = ''
  }

  const dragHasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files')
  function onDragEnter(e) { if (!dragHasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragOver(true) }
  function onDragOver(e) { if (!dragHasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  function onDragLeave(e) { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false) }
  function onDrop(e) { e.preventDefault(); dragDepth.current = 0; setDragOver(false); if (dragHasFiles(e)) uploadFiles(e.dataTransfer.files) }

  async function handleDelete() {
    if (!current) return
    if (!confirm(`Radera underlaget "${current.file_name}"? Detta går inte att ångra.`)) return
    await supabase.storage.from('underlag').remove([current.storage_path])
    const { error } = await supabase.from('documents').delete().eq('id', current.id)
    if (error) return toast.error('Kunde inte radera: ' + error.message)
    if (attachIds.includes(current.id)) onToggleAttach(current.id)
    toast.success('Underlag raderat')
    loadInbox()
  }

  async function handleTolka() {
    if (!current) return
    setInterpreting(true)
    try {
      const result = await tolkaDocument(current.id)
      await supabase.from('documents').update({ tolkning: result, tolkad: true }).eq('id', current.id)
      if (!attachIds.includes(current.id)) onToggleAttach(current.id)
      onTolkat?.(result)
    } catch (err) {
      toast.error(err.message || String(err))
    }
    setInterpreting(false)
  }

  // Koppla direkt till en befintlig verifikation (efterhandskoppling).
  async function handleCouple() {
    if (!current || !onCouple) return
    setCoupling(true)
    try {
      await onCouple(current.id)
      await loadInbox()
    } catch (err) {
      toast.error('Kunde inte koppla: ' + (err.message || err))
    }
    setCoupling(false)
  }

  const isAttached = current && attachIds.includes(current.id)

  return (
    <>
    <div onMouseDown={startResize} className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors" title="Dra för att ändra storlek" />
    <div className="flex flex-col h-full bg-surface-3 relative" style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', width: w, flexShrink: 0 }}
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* Header */}
      <div className="bg-white border-b px-5 h-14 flex items-center justify-between shrink-0 gap-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight truncate">{title}</span>
        <div className="flex items-center gap-2.5 text-gray-500 shrink-0">
          <span className="text-sm">{docs.length ? `${idx + 1} (${docs.length})` : '0 (0)'}</span>
          {onClose && <button title="Stäng" className="hover:text-gray-900 text-lg" onClick={onClose}><i className="ti ti-x" /></button>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b px-5 h-10 flex items-center gap-4 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <button className="text-sm text-blue-700 font-medium flex items-center gap-1 disabled:opacity-40"
          onClick={() => fileRef.current?.click()} disabled={uploading}>
          <i className="ti ti-upload" /> {uploading ? 'Laddar upp…' : 'Ladda upp'}
        </button>
        {url && (
          <a className="text-sm text-gray-500 flex items-center gap-1" href={url} target="_blank" rel="noreferrer" download={current?.file_name}>
            <i className="ti ti-download" /> Ladda ner
          </a>
        )}
        <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={handleUpload} />
        {current && (
          <div className="ml-auto flex items-center gap-2 text-gray-500 shrink-0">
            <button title="Anpassa till panel (Auto)" onClick={() => setMode('auto')}
              className={`text-xs font-medium px-2 py-0.5 rounded flex items-center gap-1 ${mode === 'auto' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <i className="ti ti-aspect-ratio" /> Auto
            </button>
            <button title={magnifier ? 'Förstoringsglas på' : 'Förstoringsglas av'} onClick={() => setMagnifier(m => !m)}
              className={`px-1.5 py-0.5 rounded ${magnifier ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
              <i className="ti ti-zoom-in" />
            </button>
            <input type="range" min="0.4" max="2.5" step="0.05" value={sliderValue} aria-label="Zoom" title="Justera storlek på underlaget"
              className="w-24 accent-blue-600 cursor-pointer" onChange={e => setManual(parseFloat(e.target.value))} />
            <span className="text-xs tabular-nums w-20 text-right" title={mode === 'auto' ? 'Anpassad till panelen' : 'Manuell zoom'}>{zoomLabel}</span>
          </div>
        )}
      </div>

      {/* Förhandsvisning */}
      <div className="flex-1 relative overflow-hidden">
        {/* Uppladdningsstatus per fil (krav: pending/uploading/uploaded/failed, fel i panelen) */}
        {uploads.length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[90%] max-w-md space-y-1.5">
            {uploads.map((u, i) => (
              <div key={i} className="bg-white rounded-lg shadow px-3 py-2 text-xs" style={{ border: '1px solid rgba(0,0,0,0.10)' }}>
                <div className="flex items-center gap-2">
                  <i className={`ti ${u.status === 'failed' ? 'ti-alert-circle text-red-600' : u.status === 'uploaded' ? 'ti-circle-check-filled text-green-600' : 'ti-loader-2 text-blue-600 animate-spin'}`} />
                  <span className="truncate flex-1" title={u.name}>{u.name}</span>
                  <span className={u.status === 'failed' ? 'text-red-600 font-medium' : 'text-gray-400'}>
                    {u.status === 'failed' ? 'Fel' : u.status === 'uploaded' ? 'Klar' : u.status === 'uploading' ? 'Laddar upp…' : 'Väntar'}
                  </span>
                </div>
                {u.status === 'failed' && u.error && <div className="text-red-600 mt-1 leading-snug">{u.error}</div>}
              </div>
            ))}
          </div>
        )}
        <div ref={previewRef} className="absolute inset-0 overflow-auto p-4">
        <DocMagnifier enabled={magnifier && !!url} scrollRef={previewRef} className="min-h-full">
        {loading ? (
          <div className="h-full flex items-center justify-center text-gray-400">Laddar…</div>
        ) : !current ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-400 px-6">
              <i className="ti ti-cloud-upload text-4xl block mb-2 opacity-30" />
              {uploading ? (
                <div className="font-medium text-gray-500">Laddar upp…</div>
              ) : (
                <>
                  <div className="font-medium text-gray-500 mb-1">Dra och släpp faktura, kvitto eller underlag här</div>
                  <div className="text-sm">PDF, JPG, PNG, HEIC eller WEBP</div>
                </>
              )}
            </div>
          </div>
        ) : !url ? (
          <div className="h-full flex items-center justify-center text-gray-400">Hämtar förhandsvisning…</div>
        ) : isImage ? (
          <div className="min-h-full flex items-center justify-center">
            <img src={url} alt={current.file_name} draggable={false} onLoad={e => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              className="block bg-white shadow select-none"
              style={{ width: natural.w ? `${Math.round(natural.w * effScale)}px` : (previewWidthPx(cw, effScale) ? `${previewWidthPx(cw, effScale)}px` : `${effScale * 100}%`), maxWidth: 'none', height: 'auto' }} />
          </div>
        ) : isPdf ? (
          <div className="min-h-full flex items-start justify-center">
            <PdfCanvas url={url} scale={effScale} onNaturalSize={setNatural} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <i className="ti ti-file text-4xl block mb-2 opacity-40" />
              {current.file_name}
            </div>
          </div>
        )}
        </DocMagnifier>
        </div>

        {/* Bläddringspilar */}
        {docs.length > 1 && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-600 hover:text-gray-900 disabled:opacity-30 z-10"
              onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}><i className="ti ti-chevron-left" /></button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-600 hover:text-gray-900 disabled:opacity-30 z-10"
              onClick={() => setIdx(i => Math.min(docs.length - 1, i + 1))} disabled={idx === docs.length - 1}><i className="ti ti-chevron-right" /></button>
          </>
        )}

        {/* Flytande zoomkontroll – alltid synlig */}
        {current && url && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white/95 rounded-full shadow-lg px-1.5 py-1" style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            <button title="Zooma ut" className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-700" onClick={() => bumpManual(-0.2)}><i className="ti ti-minus" /></button>
            <button title="Anpassa till panel (Auto)" className="text-xs tabular-nums px-2 min-w-[3.5rem] text-center text-gray-700 hover:text-gray-900" onClick={() => setMode('auto')}>{zoomLabel}</button>
            <button title="Zooma in" className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-700" onClick={() => bumpManual(0.2)}><i className="ti ti-plus" /></button>
          </div>
        )}
      </div>

      {/* Filnamn + åtgärder */}
      <div className="bg-white border-t px-5 py-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {current && <div className="text-xs text-gray-500 mb-2 truncate" title={current.file_name}>{current.file_name}</div>}
        {onCouple ? (
          <div className="flex justify-between items-center gap-2.5">
            <button className="btn btn-danger px-4" onClick={handleDelete} disabled={!current}>
              <i className="ti ti-trash" /> Radera
            </button>
            <button className="btn btn-green px-6" onClick={handleCouple} disabled={!current || coupling}>
              <i className="ti ti-link" /> {coupling ? 'Kopplar…' : 'Koppla till verifikationen'}
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center gap-2.5">
              <button className="btn px-4" style={{ background: '#6d28d9', color: '#fff', borderColor: '#6d28d9' }}
                onClick={handleTolka} disabled={!current || interpreting}>
                <i className="ti ti-sparkles" /> {interpreting ? 'Tolkar…' : 'Tolka underlaget'}
              </button>
              <div className="flex gap-2.5">
                <button className="btn btn-danger px-4" onClick={handleDelete} disabled={!current}>
                  <i className="ti ti-trash" /> Radera
                </button>
                <button className={`btn px-5 ${isAttached ? 'btn-primary' : 'btn-green'}`} onClick={() => onToggleAttach(current.id)} disabled={!current}>
                  <i className={`ti ${isAttached ? 'ti-link-off' : 'ti-link'}`} /> {isAttached ? 'Koppla bort' : 'Koppla'}
                </button>
              </div>
            </div>
            {attachIds.length > 0 && (
              <div className="text-xs text-green-700 mt-2 text-right">{attachIds.length} underlag kopplas vid bokföring</div>
            )}
          </>
        )}
      </div>
      {/* Drag-and-drop-overlay: hela panelen blir en tydlig dropzone (pekarhändelser av så
          släppet når panelens onDrop). */}
      {dragOver && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center bg-blue-50/85" style={{ border: '2px dashed #2563eb' }}>
          <div className="text-center text-blue-700">
            <i className="ti ti-cloud-upload text-5xl block mb-2" />
            <div className="font-semibold text-lg">Släpp filen för att ladda upp</div>
            <div className="text-sm text-blue-600/80 mt-1">PDF, JPG, PNG, HEIC eller WEBP</div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
