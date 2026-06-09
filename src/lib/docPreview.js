import { useState, useEffect } from 'react'

// Gemensam logik för dokument-previews (faktura-bild / PDF) i panelerna
// "Koppla bild" / "Fakturaunderlag" / "Kopplade bilder".
//
// Modell: previewytan mäts med en ResizeObserver (content-box, dvs. exkl.
// padding). Bildens/PDF:ens storlek räknas ut i PIXLAR utifrån den uppmätta
// bredden och aktuell zoomnivå `scale`:
//   scale = 1  -> fyller ytan exakt (100%).
//   scale > 1  -> större än ytan (scrollas i overflow:auto-containern).
//   scale < 1  -> mindre och centrerad.
// Det gör att bilden ALLTID anpassas till panelens aktuella storlek – när
// användaren drar i splittern räknas måtten om (debounce:at) i stället för att
// bilden ligger kvar i gammal storlek.
//
// Bild och PDF renderas via <img>/<iframe>, inte canvas, så webbläsaren
// rasteriserar skarpt utifrån devicePixelRatio automatiskt (ingen suddighet
// vid 100%, inga canvas-dimensioner att uppdatera manuellt).

// Bredd i px för en bild/PDF givet containerns innerbredd och zoom.
// Returnerar null innan containern har mätts (då används en %-fallback i UI:t).
export function previewWidthPx(containerWidth, scale) {
  if (!containerWidth || containerWidth <= 0) return null
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1
  return Math.max(1, Math.round(containerWidth * s))
}

// Höjd i px för en PDF (iframe). Vid zoom <= 1 fylls ytan (höjd = container),
// vid zoom > 1 blir den högre och scrollas. Returnerar null före mätning.
export function previewHeightPx(containerHeight, scale) {
  if (!containerHeight || containerHeight <= 0) return null
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1
  return Math.max(1, Math.round(containerHeight * Math.max(1, s)))
}

// "Fit-to-width"-zoom (Auto-läge): anpassar dokumentet efter panelens BREDD, inte höjden.
//   scale = (containerW - horizontalPadding) / naturalW
// Höjden begränsar INTE skalan – dokumentet får bli högre än panelen och läses med vertikal
// scroll, medan horisontell scroll undviks (bredden ryms). Skalan är NATURLIG-relativ
// (1 = dokumentets pixlar i 1:1) och klampas till [min, max]. Returnerar null innan
// container/dokument har mätts (då används fallback i UI:t).
//   - Bredare panel  => större skala (växer)
//   - Smalare panel  => mindre skala (krymper)
// `containerH`/`naturalH` tas emot för bakåtkompatibel signatur men används inte (fit-to-width).
// `padding` = horisontell padding så dokumentet inte klistrar mot kanterna.
export function computeAutoScale(containerW, _containerH, naturalW, _naturalH, opts = {}) {
  const { min = 0.4, max = 2.5, padding = 24 } = opts
  if (!containerW || !naturalW) return null
  const s = (containerW - padding) / naturalW
  if (!Number.isFinite(s) || s <= 0) return null
  return Math.max(min, Math.min(max, Math.round(s * 1000) / 1000))
}

// Resolverar dokumentvisarens bredd (px) för split-vyer (t.ex. leverantörsfaktura).
// Standard = `fraction` av total fönsterbredd (45% → ger ~10/45/45 med sidomenyn).
// Ett sparat localStorage-värde respekteras OM det är giltigt: ett ändligt tal inom
// [minPx, maxFraction*viewportW]. Ogiltigt (NaN, för smalt, för brett) → standard.
export function resolveViewerWidth(savedRaw, viewportW, opts = {}) {
  const { fraction = 0.45, minPx = 360, maxFraction = 0.75 } = opts
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1200
  const def = Math.round(vw * fraction)
  const maxPx = Math.round(vw * maxFraction)
  const v = Number(savedRaw)
  return (Number.isFinite(v) && v >= minPx && v <= maxPx) ? Math.round(v) : def
}

// Sidomenyns bredd (px) – speglar Layout.jsx: utfälld = max(220, 10% av fönstret),
// hopfälld = 72. Används för att räkna ut den tillgängliga arbetsytan (fönster − sidomeny)
// så att dokumentvisaren kan ta ~50% av ytan EFTER sidomenyn (≈ 45% av hela fönstret).
export function sidebarWidth(viewportW, collapsed = false) {
  if (collapsed) return 72
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1200
  return Math.max(220, Math.round(vw * 0.10))
}

// Klampar en manuell zoomnivå till tillåtet intervall.
export function clampScale(scale, min = 0.4, max = 2.5) {
  const s = Number(scale)
  if (!Number.isFinite(s)) return 1
  return Math.max(min, Math.min(max, s))
}

// Mäter ett element med ResizeObserver och returnerar { width, height } i px
// (content-box). Debounce:at så att täta resize-events (t.ex. under en
// splitter-dragning) inte gör UI:t segt. Faller tillbaka till {0,0} i miljöer
// utan ResizeObserver (då används %-fallback i komponenterna).
export function useContainerSize(ref, debounceMs = 80) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    let timer, raf, ro
    const apply = rect => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const w = Math.round(rect.width), h = Math.round(rect.height)
        setSize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
      }, debounceMs)
    }
    // Vänta tills elementet faktiskt är monterat (kan ske efter async-laddning),
    // koppla sedan på ResizeObservern. Annars missas containern helt (cw=0).
    const attach = () => {
      const el = ref?.current
      if (!el) { raf = requestAnimationFrame(attach); return }
      ro = new ResizeObserver(entries => { const e = entries[0]; if (e) apply(e.contentRect) })
      ro.observe(el)
    }
    attach()
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); ro?.disconnect() }
  }, [ref, debounceMs])
  return size
}
