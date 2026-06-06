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

// "Fit-to-panel"-zoom (Auto-läge): beräknar den skala som gör att hela
// dokumentet (naturlig storlek naturalW×naturalH) ryms i containern, begränsad
// till [min, max]. Skalan är NATURLIG-relativ (1 = dokumentets pixlar i 1:1).
// Returnerar null innan container/dokument har mätts (då används fallback i UI:t).
//   - Bredare panel  => större skala (växer)
//   - Smalare panel  => mindre skala (krymper)
export function computeAutoScale(containerW, containerH, naturalW, naturalH, opts = {}) {
  const { min = 0.4, max = 2.5, padding = 24 } = opts
  if (!containerW || !containerH || !naturalW || !naturalH) return null
  const s = Math.min((containerW - padding) / naturalW, (containerH - padding) / naturalH)
  if (!Number.isFinite(s) || s <= 0) return null
  return Math.max(min, Math.min(max, Math.round(s * 1000) / 1000))
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
