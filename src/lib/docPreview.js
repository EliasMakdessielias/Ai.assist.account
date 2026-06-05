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

// Mäter ett element med ResizeObserver och returnerar { width, height } i px
// (content-box). Debounce:at så att täta resize-events (t.ex. under en
// splitter-dragning) inte gör UI:t segt. Faller tillbaka till {0,0} i miljöer
// utan ResizeObserver (då används %-fallback i komponenterna).
export function useContainerSize(ref, debounceMs = 80) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref?.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const rect = entry.contentRect
      clearTimeout(timer)
      timer = setTimeout(() => {
        const w = Math.round(rect.width)
        const h = Math.round(rect.height)
        setSize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
      }, debounceMs)
    })
    ro.observe(el)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [ref, debounceMs])
  return size
}
