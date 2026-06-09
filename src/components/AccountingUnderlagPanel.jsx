import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import DocumentViewerPanel from './viewer/DocumentViewerPanel'
import { MAX_ATTACHMENT_BYTES } from '../lib/inboxAddresses'

// [DOCUMENT_VIEWER] Höger dokumentpanel för Bokföring → Registrera dagskassa / Registrera kvitto.
// Komponerar den gemensamma visaren (DocumentViewerPanel) med en "VÄLJ BILD"-toolbar,
// drag & drop, ett lugnt tomt läge och en ta-bort-åtgärd. Återanvänder all viewer-logik
// (zoom/rotation/förstoringsglas/fit-to-width) från DocumentViewerPanel – ingen duplicering.
//
// Säkerhet: laddar upp till privata bucketen `underlag` under `{company_id}/…` (storage-RLS
// kräver att mappen = användarens företag) och visar endast signerade URL:er. Filnamn saneras
// och path traversal blockeras (safeName). RLS i DB är den verkliga garanten – frontend litar inte ensam.

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'
const ACCEPT_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const ACCEPT_EXT = /\.(pdf|png|jpe?g|webp)$/i

// Sanera filnamn + blockera path traversal: ta bort ev. katalogdelar (\\ /), tillåt bara
// [A-Za-z0-9._-], och låt inte namnet börja med punkt(er) (".." → "_").
export function safeName(name) {
  const base = String(name || 'underlag').split(/[\\/]/).pop()
  const cleaned = base.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '_')
  return cleaned || 'underlag'
}

export function isAllowedFile(file) {
  if (!file) return false
  return ACCEPT_MIME.includes(String(file.type || '').toLowerCase()) || ACCEPT_EXT.test(file.name || '')
}

// Validerar en fil mot underlags-policyn (typ + storlek). Returnerar felmeddelande
// eller null om filen är OK. Storleksgräns = befintlig underlag-policy (MAX_ATTACHMENT_BYTES).
export function validateUnderlagFile(file) {
  if (!file) return 'Ingen fil vald.'
  if (!isAllowedFile(file)) return 'Filtypen stöds inte. Ladda upp PDF eller bild.'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'Filen är för stor.'
  return null
}

export default function AccountingUnderlagPanel({ company, kategori = 'dokument', doc, onSelected, onRemove, dragging = false }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function upload(file) {
    if (!company?.id || !file) return
    const validationError = validateUnderlagFile(file)
    if (validationError) { toast.error(validationError); return }
    setUploading(true)
    try {
      const path = `${company.id}/${crypto.randomUUID()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from('underlag').upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (upErr) throw upErr
      const { data: row, error: insErr } = await supabase.from('documents').insert({
        company_id: company.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        kategori,
        source: 'manual',
      }).select().single()
      if (insErr) throw insErr
      const { data: signed } = await supabase.storage.from('underlag').createSignedUrl(path, 3600)
      onSelected?.({ ...row, url: signed?.signedUrl || null })
      toast.success('Underlag uppladdat')
    } catch (err) {
      toast.error('Kunde inte ladda upp underlag: ' + (err.message || String(err)))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  // En fil åt gången (enklaste säkra lösning): ta första filen, informera om fler valdes.
  function handleFiles(files) {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    if (list.length > 1) toast('Endast en fil i taget – tar den första.')
    upload(list[0])
  }

  // Delad filväljare för toolbar-knapp, tom-ytan och tangentbord (ingen duplicerad logik).
  const openPicker = () => { if (!uploading) inputRef.current?.click() }
  function onDropzoneKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openPicker() }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer?.files)
  }

  const toolBtn = 'text-xs flex items-center gap-1 text-gray-400 cursor-not-allowed'

  return (
    <div className="flex flex-col h-full"
      onDragEnter={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
      onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={onDrop}>

      {/* VÄLJ BILD – toolbar */}
      <div className="bg-white border-b px-5 h-12 flex items-center gap-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[13px] font-semibold text-gray-700 mr-auto">VÄLJ BILD</span>
        <button className={toolBtn} type="button" disabled title="Ej tillgängligt"><i className="ti ti-help-circle" /> Saknas text?</button>
        <button className={toolBtn} type="button" disabled title="Ej tillgängligt"><i className="ti ti-refresh" /></button>
        <button className={toolBtn} type="button" disabled title="Ej tillgängligt"><i className="ti ti-mail" /> E-posta bild</button>
        <button className="text-xs text-blue-700 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed" type="button" onClick={openPicker} disabled={uploading}>
          <i className="ti ti-upload" /> {uploading ? 'Laddar upp…' : 'Ladda upp'}
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={e => handleFiles(e.target.files)} />
      </div>

      {/* Innehåll: visare när underlag finns, annars interaktiv dropzone */}
      <div className="flex-1 min-h-0 relative">
        {doc ? (
          <>
            <DocumentViewerPanel
              docs={[doc]}
              index={0}
              title="KOPPLAT UNDERLAG"
              dragging={dragging}
              footer={onRemove ? (
                <button className="btn btn-danger text-xs py-1 px-2" type="button" onClick={onRemove}>
                  <i className="ti ti-trash text-xs" /> Ta bort underlag
                </button>
              ) : null}
            />
            {/* Drop-overlay vid ersättning av befintligt underlag */}
            {dragOver && (
              <div className="absolute inset-2 z-10 flex items-center justify-center bg-blue-50/90 border-2 border-dashed border-blue-400 rounded-lg pointer-events-none">
                <div className="text-blue-700 font-medium"><i className="ti ti-upload mr-1" /> Släpp filen här</div>
              </div>
            )}
          </>
        ) : (
          // Hela tom-ytan är dropzone: klickbar, tangentbordsfokuserbar, drag & drop.
          <div
            role="button"
            tabIndex={0}
            aria-label="Ladda upp underlag – klicka, eller dra och släpp en PDF eller bild"
            aria-disabled={uploading}
            onClick={openPicker}
            onKeyDown={onDropzoneKeyDown}
            className={`h-full flex flex-col items-center justify-center text-center px-8 outline-none transition-colors border-2 ${
              uploading ? 'cursor-wait border-transparent bg-white'
                : dragOver ? 'cursor-copy border-dashed border-blue-400 bg-blue-50'
                : 'cursor-pointer border-transparent bg-white hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset'
            }`}
          >
            {uploading ? (
              <>
                <i className="ti ti-loader-2 text-5xl text-gray-400 mb-4 animate-spin" />
                <div className="text-sm font-medium text-gray-600">Laddar upp…</div>
              </>
            ) : dragOver ? (
              <>
                <i className="ti ti-upload text-5xl text-blue-500 mb-4" />
                <div className="text-sm font-semibold text-blue-700">Släpp filen här</div>
              </>
            ) : (
              <>
                <i className="ti ti-cloud-upload text-5xl text-green-600/70 mb-4" />
                <div className="text-sm font-medium text-gray-700 mb-1">Det finns inga tillgängliga underlag att koppla.</div>
                <div className="text-sm text-gray-500 mb-5">
                  Dra och släpp ett underlag här eller klicka på <span className="text-blue-700 underline">Ladda upp</span>.
                </div>
                <div className="flex items-start gap-2 text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 max-w-sm text-left">
                  <i className="ti ti-info-circle mt-0.5 shrink-0" />
                  <span>När underlaget är uppladdat är det sparat och arkiverat digitalt. Från och med 1 juli 2024 räcker det att spara underlag digitalt.</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
