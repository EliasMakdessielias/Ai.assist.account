import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

// Höger panel: företagets Inkorg av underlag (ej kopplade dokument).
// Ladda upp, bläddra (1 av N), förhandsvisa bild/PDF och Koppla till verifikationen.
export default function UnderlagPanel({ company, attachIds = [], onToggleAttach, onTolkat, onCouple, selectDocId, title = 'VÄLJ UNDERLAG', reloadSignal, onClose, width = 520 }) {
  const [docs, setDocs] = useState([])
  const [idx, setIdx] = useState(0)
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const [coupling, setCoupling] = useState(false)
  const [scale, setScale] = useState(1)
  const [w, setW] = useState(width)
  const fileRef = useRef()

  function startResize(e) {
    e.preventDefault()
    const move = ev => setW(Math.min(window.innerWidth - 340, Math.max(360, window.innerWidth - ev.clientX)))
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
  useEffect(() => {
    let active = true
    setUrl(null)
    setScale(1)
    if (!current) return
    supabase.storage.from('underlag').createSignedUrl(current.storage_path, 3600).then(({ data }) => {
      if (active) setUrl(data?.signedUrl || null)
    })
    return () => { active = false }
  }, [current?.id])

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    let ok = 0
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${company.id}/${crypto.randomUUID()}-${safe}`
      const { error: upErr } = await supabase.storage.from('underlag').upload(path, file, { contentType: file.type })
      if (upErr) { toast.error(`Kunde inte ladda upp ${file.name}: ${upErr.message}`); continue }
      const { error: insErr } = await supabase.from('documents').insert({
        company_id: company.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      if (insErr) { toast.error(`Fel vid registrering: ${insErr.message}`); continue }
      ok++
    }
    if (ok) toast.success(`${ok} underlag uppladdat`)
    e.target.value = ''
    setUploading(false)
    await loadInbox()
    setIdx(Math.max(0, docs.length + ok - 1)) // hoppa till det senast uppladdade
  }

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

  async function invokeTolka() {
    const { data, error } = await supabase.functions.invoke('tolka-underlag', {
      body: { document_id: current.id },
    })
    if (error) {
      // Plocka ut AI:ns riktiga felmeddelande ur svaret om det finns.
      let msg = error.message
      try { const body = await error.context.json(); if (body?.error) msg = body.error } catch { /* ignore */ }
      throw new Error(msg)
    }
    if (data?.error) throw new Error(data.error)
    return data.result
  }

  async function handleTolka() {
    if (!current) return
    setInterpreting(true)
    try {
      let result
      try {
        result = await invokeTolka()
      } catch (firstErr) {
        // Ett nytt försök – första anropet kan vara en kallstart.
        result = await invokeTolka()
      }
      if (!attachIds.includes(current.id)) onToggleAttach(current.id)
      onTolkat?.(result)
    } catch (err) {
      toast.error('Tolkning misslyckades: ' + (err.message || err))
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

  const isImage = current?.mime_type?.startsWith('image/')
  const isPdf = current?.mime_type === 'application/pdf'
  const isAttached = current && attachIds.includes(current.id)

  return (
    <>
    <div onMouseDown={startResize} className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors" title="Dra för att ändra storlek" />
    <div className="flex flex-col h-full bg-surface-3" style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', width: w, flexShrink: 0 }}>
      {/* Header */}
      <div className="bg-white border-b px-5 h-14 flex items-center justify-between shrink-0 gap-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight truncate">{title}</span>
        <div className="flex items-center gap-2.5 text-gray-500 shrink-0">
          <button title="Zooma ut" className="hover:text-gray-900 disabled:opacity-30" onClick={() => setScale(s => Math.max(0.4, +(s - 0.2).toFixed(2)))} disabled={!current}><i className="ti ti-zoom-out" /></button>
          <span className="text-xs w-9 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button title="Zooma in" className="hover:text-gray-900 disabled:opacity-30" onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(2)))} disabled={!current}><i className="ti ti-zoom-in" /></button>
          <span className="text-sm border-l pl-2.5" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>{docs.length ? `${idx + 1} (${docs.length})` : '0 (0)'}</span>
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
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleUpload} />
      </div>

      {/* Förhandsvisning */}
      <div className="flex-1 relative overflow-auto flex items-center justify-center p-4">
        {loading ? (
          <div className="text-gray-400">Laddar…</div>
        ) : !current ? (
          <div className="text-center text-gray-400">
            <i className="ti ti-inbox text-4xl block mb-2 opacity-30" />
            <div className="font-medium text-gray-500 mb-1">Inkorgen är tom</div>
            <div className="text-sm">Ladda upp kvitton eller fakturor här.</div>
          </div>
        ) : !url ? (
          <div className="text-gray-400">Hämtar förhandsvisning…</div>
        ) : isImage ? (
          <img src={url} alt={current.file_name} className="max-w-full max-h-full object-contain bg-white shadow" style={{ transform: `scale(${scale})`, transformOrigin: 'center top', transition: 'transform .12s' }} />
        ) : isPdf ? (
          <iframe src={url} title={current.file_name} className="bg-white shadow" style={{ width: `${100 * scale}%`, height: `${100 * scale}%`, minHeight: '100%' }} />
        ) : (
          <div className="text-center text-gray-500">
            <i className="ti ti-file text-4xl block mb-2 opacity-40" />
            {current.file_name}
          </div>
        )}

        {/* Bläddringspilar */}
        {docs.length > 1 && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-600 hover:text-gray-900 disabled:opacity-30"
              onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}><i className="ti ti-chevron-left" /></button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-600 hover:text-gray-900 disabled:opacity-30"
              onClick={() => setIdx(i => Math.min(docs.length - 1, i + 1))} disabled={idx === docs.length - 1}><i className="ti ti-chevron-right" /></button>
          </>
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
    </div>
    </>
  )
}
