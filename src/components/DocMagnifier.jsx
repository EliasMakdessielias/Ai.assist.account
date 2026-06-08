import { useRef, useState, useEffect, useCallback } from 'react'

// Hover-förstoringsglas över dokumentytan (faktura-bild eller PDF-canvas).
// - Förstorar området under muspekaren med 50% utöver aktuell visningsskala
//   (effektiv skala = currentDocumentScale * 1.5, eftersom vi förstorar det
//   redan skalade elementet). Fungerar i både Auto Fit- och Manual-läge.
// - <img>: CSS background (background-size/position) av samma bild-URL.
// - <canvas> (PDF): drawImage-utsnitt till en egen DPR-skarp lins-canvas.
// - Linsen är position:fixed och följer musen; klampas till scroll-ytan så att
//   toolbaren aldrig täcks. requestAnimationFrame-throttlad. Döljs när musen lämnar.
export const LENS = 240   // diameter px (större för läsning av små siffror)
export const MAG = 1.75   // +75% utöver aktuell visningsskala

// Klampa linsens box så den ALLTID ligger helt inom viewer-ytan (täcker ej toolbar,
// hamnar ej utanför containern). Sampling sker fortfarande vid muspekaren.
export function clampLensBox(cx, cy, rect, size = LENS) {
  let left = cx - size / 2, top = cy - size / 2
  if (rect) {
    left = Math.min(Math.max(left, rect.left), Math.max(rect.left, rect.right - size))
    top = Math.min(Math.max(top, rect.top), Math.max(rect.top, rect.bottom - size))
  }
  return { left, top }
}

export default function DocMagnifier({ enabled = true, scrollRef, className = '', children }) {
  const lensCanvasRef = useRef(null)
  const raf = useRef(0)
  const [lens, setLens] = useState(null)

  const clear = useCallback(() => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; setLens(null) }, [])

  const onMove = useCallback((e) => {
    if (!enabled) return
    const el = e.target
    const tag = el && el.tagName
    if (tag !== 'IMG' && tag !== 'CANVAS') { setLens(null); return }
    const cx = e.clientX, cy = e.clientY
    const rect = el.getBoundingClientRect()
    const mx = cx - rect.left, my = cy - rect.top
    if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) { setLens(null); return }
    // Klampa linsens box till scroll-ytan (täck inte toolbar, alltid helt synlig).
    const sr = scrollRef?.current?.getBoundingClientRect()
    const { left: boxL, top: boxT } = clampLensBox(cx, cy, sr)
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      if (tag === 'IMG') {
        setLens({ boxL, boxT, kind: 'img', src: el.currentSrc || el.src,
          bgW: rect.width * MAG, bgH: rect.height * MAG, bgX: -(mx * MAG - LENS / 2), bgY: -(my * MAG - LENS / 2) })
      } else {
        setLens({ boxL, boxT, kind: 'canvas', el, rectW: rect.width, rectH: rect.height, mx, my })
      }
    })
  }, [enabled, scrollRef])

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])

  // Rita PDF-canvas-utsnitt (DPR-skarpt) – respekterar källans interna pixeltäthet.
  useEffect(() => {
    if (lens?.kind !== 'canvas') return
    const out = lensCanvasRef.current; if (!out) return
    const { el, rectW, rectH, mx, my } = lens
    const dpr = window.devicePixelRatio || 1
    out.width = Math.round(LENS * dpr); out.height = Math.round(LENS * dpr)
    const ctx = out.getContext('2d'); if (!ctx) return
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    const rx = el.width / rectW, ry = el.height / rectH      // källpixel per CSS-px
    const cropDisp = LENS / MAG                              // CSS-px att beskära
    const sx = (mx - cropDisp / 2) * rx, sy = (my - cropDisp / 2) * ry
    const sw = cropDisp * rx, sh = cropDisp * ry
    ctx.clearRect(0, 0, out.width, out.height)
    try { ctx.drawImage(el, sx, sy, sw, sh, 0, 0, out.width, out.height) } catch { /* utanför kant – ignorera */ }
  }, [lens])

  return (
    <div className={className} onMouseMove={onMove} onMouseLeave={clear}
      title={enabled ? 'Förstoringsglas' : undefined} style={{ cursor: enabled ? 'zoom-in' : undefined }}>
      {children}
      {enabled && lens && (
        <div style={{
          position: 'fixed', left: lens.boxL, top: lens.boxT, width: LENS, height: LENS,
          borderRadius: '50%', border: '1px solid rgba(0,0,0,0.25)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)', overflow: 'hidden', pointerEvents: 'none', zIndex: 70, background: '#fff',
          ...(lens.kind === 'img' ? {
            backgroundImage: `url("${lens.src}")`, backgroundRepeat: 'no-repeat',
            backgroundSize: `${lens.bgW}px ${lens.bgH}px`, backgroundPosition: `${lens.bgX}px ${lens.bgY}px`,
          } : {}),
        }}>
          {lens.kind === 'canvas' && <canvas ref={lensCanvasRef} style={{ width: LENS, height: LENS, display: 'block' }} />}
        </div>
      )}
    </div>
  )
}
