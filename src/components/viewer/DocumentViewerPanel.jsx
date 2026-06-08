import { useEffect, useRef, useState } from 'react'
import { useContainerSize, previewWidthPx } from '../../lib/docPreview'
import { useAutoFitToWidth } from '../../lib/viewer/useAutoFitToWidth'
import { useMagnifier } from '../../lib/viewer/useMagnifier'
import PdfCanvas from '../PdfCanvas'
import DocMagnifier from '../DocMagnifier'

// [DOCUMENT_VIEWER] Gemensam dokument-/fakturavisare (höger panel).
// Återanvänds i leverantörsfaktura, Inkorg, verifikation, inkomna fakturor m.fl.
// Stöd: PDF (PdfCanvas, DPR-skarp) + bild, Auto = fit-to-width, manuell zoom, rotation,
// förstoringsglas (DocMagnifier), bläddring mellan flera underlag, nedladdning.
// Säkerhet: visar bara `url` som anroparen skapat (signed URL från privat bucket) – komponenten
// hämtar inga filer själv och skapar inga publika URL:er.
//
// docs: [{ id, url, file_name, mime_type }]   (url = signerad URL eller null)
// index/onIndexChange: aktuellt dokument. footer: valfria åtgärdsknappar längst ned.
// dragging: true under splitter-drag → stäng av förstoringsglaset.
export function docKind(doc) {
  const m = doc?.mime_type || ''
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (/\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(doc?.file_name || '')) return 'image'
  if (/\.pdf$/i.test(doc?.file_name || '')) return 'pdf'
  return 'other'
}

export default function DocumentViewerPanel({
  docs = [], index = 0, onIndexChange, title = 'UNDERLAG',
  onClose, footer, dragging = false, emptyText = 'Inga underlag', emptyIcon = 'ti-photo-off',
}) {
  const previewRef = useRef(null)
  const { width: cw, height: ch } = useContainerSize(previewRef)
  const { mode, setMode, effScale, sliderValue, zoomLabel, setManual, bumpManual, natural, setNatural, resetAuto } = useAutoFitToWidth(cw, ch, { min: 0.35 })
  const [magnifier, setMagnifier] = useMagnifier()
  const [rot, setRot] = useState(0)

  const current = docs[index] || null
  const kind = docKind(current)

  // Återställ Auto (fit-to-width) + rotation vid dokumentbyte.
  useEffect(() => { resetAuto(); setRot(0) }, [current?.id, resetAuto])

  // Ctrl/Cmd + skrollhjul zoomar (vanlig skroll panorerar) → manuellt läge.
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const onWheel = e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); bumpManual(-Math.sign(e.deltaY) * 0.15) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [bumpManual])

  const canPrev = index > 0
  const canNext = index < docs.length - 1
  const go = i => onIndexChange?.(Math.min(docs.length - 1, Math.max(0, i)))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b px-5 h-14 flex items-center justify-between shrink-0 gap-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight truncate" title={current?.file_name || title}>{title}</span>
        <div className="flex items-center gap-2.5 text-gray-500 shrink-0">
          <span className="text-sm tabular-nums">{docs.length ? `${index + 1} (${docs.length})` : '0 (0)'}</span>
          {onClose && <button title="Dölj panel" className="hover:text-gray-900 text-lg" onClick={onClose}><i className="ti ti-x" /></button>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b px-5 h-10 flex items-center gap-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="ml-auto flex items-center gap-2 text-gray-500 shrink-0">
          <button title="Rotera" onClick={() => setRot(r => (r + 90) % 360)} disabled={!current}><i className="ti ti-rotate-clockwise" /></button>
          <button title="Anpassa till bredd (Auto)" onClick={() => setMode('auto')}
            className={`text-xs font-medium px-2 py-0.5 rounded flex items-center gap-1 ${mode === 'auto' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <i className="ti ti-aspect-ratio" /> Auto
          </button>
          <button title={magnifier ? 'Förstoringsglas på (klicka för att stänga av)' : 'Förstoringsglas av'} onClick={() => setMagnifier(m => !m)}
            className={`px-1.5 py-0.5 rounded ${magnifier ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
            <i className="ti ti-zoom-in" />
          </button>
          <input type="range" min="0.4" max="2.5" step="0.05" value={sliderValue} aria-label="Zoom" title="Justera storlek"
            className="w-20 accent-blue-600 cursor-pointer" onChange={e => setManual(parseFloat(e.target.value))} />
          <span className="text-xs tabular-nums w-16 text-right" title={mode === 'auto' ? 'Anpassad till bredd' : 'Manuell zoom'}>{zoomLabel}</span>
          {current?.url && <a href={current.url} target="_blank" rel="noreferrer" download={current.file_name} title="Ladda ner"><i className="ti ti-download" /></a>}
        </div>
      </div>

      {/* Förhandsvisning */}
      <div ref={previewRef} className="flex-1 overflow-auto bg-gray-100 p-4 relative">
        <DocMagnifier enabled={magnifier && !dragging && !!current?.url} scrollRef={previewRef} className="min-h-full">
          {docs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-gray-400">
              <div><i className={`ti ${emptyIcon} text-4xl block mb-2 opacity-30`} />{emptyText}</div>
            </div>
          ) : !current?.url ? (
            <div className="h-full flex items-center justify-center text-gray-400">Hämtar förhandsvisning…</div>
          ) : kind === 'image' ? (
            <div className="min-h-full flex items-center justify-center">
              <img src={current.url} alt={current.file_name} draggable={false} onLoad={e => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                className="block shadow-lg bg-white select-none"
                style={{ width: natural.w ? `${Math.round(natural.w * effScale)}px` : (previewWidthPx(cw, effScale) ? `${previewWidthPx(cw, effScale)}px` : `${effScale * 100}%`), maxWidth: 'none', height: 'auto', transform: rot ? `rotate(${rot}deg)` : undefined }} />
            </div>
          ) : kind === 'pdf' ? (
            <div className="min-h-full flex items-start justify-center">
              <PdfCanvas url={current.url} scale={effScale} onNaturalSize={setNatural} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-center text-gray-500">
              <div><i className="ti ti-file text-4xl block mb-2 opacity-40" />{current.file_name}</div>
            </div>
          )}
        </DocMagnifier>

        {/* Bläddringspilar (flera underlag) */}
        {docs.length > 1 && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-600 hover:text-gray-900 disabled:opacity-30 z-10"
              onClick={() => go(index - 1)} disabled={!canPrev}><i className="ti ti-chevron-left" /></button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center text-gray-600 hover:text-gray-900 disabled:opacity-30 z-10"
              onClick={() => go(index + 1)} disabled={!canNext}><i className="ti ti-chevron-right" /></button>
          </>
        )}
      </div>

      {/* Filnamn + valfria åtgärder */}
      {(current || footer) && (
        <div className="bg-white border-t px-5 py-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          {current && <div className="text-xs text-gray-500 mb-2 truncate" title={current.file_name}>{current.file_name}</div>}
          {footer}
        </div>
      )}
    </div>
  )
}
