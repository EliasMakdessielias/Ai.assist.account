import { useEffect, useRef, useState } from 'react'

// App-styrd PDF-rendering via pdf.js → <canvas>. Vi kontrollerar zoom själva
// (till skillnad från <iframe> som har egen intern zoom och inte följer panelen).
// - `scale` = naturlig-relativ skala (1 = sidans pixlar vid viewport-scale 1).
// - DPR-skarp: canvas ritas i devicePixelRatio, CSS-storlek = sid-px * scale.
// - Rapporterar första sidans naturliga storlek via onNaturalSize (driver Auto-fit).
// pdf.js laddas lazy (dynamisk import) så huvudbundlen inte växer i onödan.

let _pdfjs = null
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs
  const lib = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  lib.GlobalWorkerOptions.workerSrc = workerUrl
  _pdfjs = lib
  return lib
}

export default function PdfCanvas({ url, scale = 1, onNaturalSize }) {
  const [pages, setPages] = useState([])     // [{ pageNum, page, w, h }]
  const [err, setErr] = useState(false)
  const canvasRefs = useRef([])
  const renderTasks = useRef([])
  const natRef = useRef(null)

  // Ladda dokumentet + sidornas mått.
  useEffect(() => {
    let cancelled = false
    setErr(false); setPages([]); canvasRefs.current = []; renderTasks.current = []
    if (!url) return
    ;(async () => {
      try {
        const lib = await loadPdfjs()
        const pdf = await lib.getDocument({ url }).promise
        if (cancelled) { pdf.destroy?.(); return }
        const ps = []
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          const vp = page.getViewport({ scale: 1 })
          ps.push({ pageNum: n, page, w: vp.width, h: vp.height })
        }
        if (cancelled) return
        setPages(ps)
        if (ps[0]) { const nat = { w: Math.round(ps[0].w), h: Math.round(ps[0].h) }; natRef.current = nat; onNaturalSize?.(nat) }
      } catch (e) { if (!cancelled) setErr(true) }
    })()
    return () => { cancelled = true }
  }, [url])

  // Rendera om vid scale-ändring (debouncas uppströms via ResizeObserver).
  useEffect(() => {
    if (!pages.length) return
    const dpr = window.devicePixelRatio || 1
    const s = Math.max(0.05, scale || 1)
    pages.forEach((p, i) => {
      const canvas = canvasRefs.current[i]
      if (!canvas) return
      try { renderTasks.current[i]?.cancel?.() } catch { /* ignore */ }
      const vp = p.page.getViewport({ scale: s * dpr })
      canvas.width = Math.max(1, Math.floor(vp.width))
      canvas.height = Math.max(1, Math.floor(vp.height))
      canvas.style.width = `${Math.max(1, Math.round(p.w * s))}px`
      canvas.style.height = `${Math.max(1, Math.round(p.h * s))}px`
      const ctx = canvas.getContext('2d')
      const task = p.page.render({ canvasContext: ctx, viewport: vp })
      renderTasks.current[i] = task
      task.promise.catch(() => { /* avbruten render – ignorera */ })
    })
    return () => { renderTasks.current.forEach(t => { try { t?.cancel?.() } catch { /* ignore */ } }) }
  }, [pages, scale])

  if (err) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Kunde inte visa PDF</div>
  if (!pages.length) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Laddar PDF…</div>
  return (
    <div className="flex flex-col items-center gap-3">
      {pages.map((p, i) => (
        <canvas key={p.pageNum} ref={el => (canvasRefs.current[i] = el)} className="bg-white shadow block select-none" />
      ))}
    </div>
  )
}
