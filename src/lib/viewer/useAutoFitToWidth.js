import { useState, useCallback } from 'react'
import { computeAutoScale, clampScale } from '../docPreview'

// [DOCUMENT_VIEWER] Gemensam Auto-fit-to-width + manuell zoom för dokumentvisaren.
// Auto-läget skalar dokumentet efter panelens BREDD (computeAutoScale = fit-to-width);
// höjden begränsar inte – långa dokument scrollas vertikalt. Manuellt läge behåller
// användarens zoom och skrivs inte över när panelen ändrar storlek.
//
//   const { effScale, sliderValue, zoomLabel, mode, setMode, setManual, bumpManual,
//           natural, setNatural, resetAuto } = useAutoFitToWidth(cw, ch, { min: 0.35 })
//
// cw/ch = uppmätt containerstorlek (ch tas emot men begränsar inte fit-to-width).
export function useAutoFitToWidth(cw, ch, opts = {}) {
  const [mode, setMode] = useState('auto')          // 'auto' (fit-to-width) | 'manual'
  const [manualScale, setManualScale] = useState(1) // naturlig-relativ skala
  const [natural, setNatural] = useState({ w: 0, h: 0 })

  const autoScale = computeAutoScale(cw, ch, natural.w, natural.h, opts)
  const effScale = mode === 'auto' ? (autoScale ?? 1) : manualScale
  const sliderValue = clampScale(mode === 'auto' ? (autoScale ?? 1) : manualScale)
  const zoomLabel = mode === 'auto'
    ? (autoScale ? `Auto · ${Math.round(autoScale * 100)}%` : 'Auto')
    : `Manual · ${Math.round(manualScale * 100)}%`

  const setManual = useCallback(v => { setMode('manual'); setManualScale(clampScale(v)) }, [])
  const bumpManual = useCallback(d => { setMode('manual'); setManualScale(s => clampScale(s + d)) }, [])
  // Återställ till Auto (fit-to-width) och nollställ uppmätt naturlig storlek (vid dokumentbyte).
  const resetAuto = useCallback(() => { setMode('auto'); setManualScale(1); setNatural({ w: 0, h: 0 }) }, [])

  return { mode, setMode, manualScale, autoScale, effScale, sliderValue, zoomLabel, setManual, bumpManual, natural, setNatural, resetAuto }
}
