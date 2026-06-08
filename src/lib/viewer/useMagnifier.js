import { useState, useEffect } from 'react'

// [DOCUMENT_VIEWER] Delad på/av-preferens för förstoringsglaset (DocMagnifier).
// EN gemensam localStorage-nyckel ger konsekvent beteende i alla dokumentvisare
// (krav 18 – dokumenterat medvetet val). Själva linsen renderas av DocMagnifier
// (lens 240px, 1.75x, clamp inom viewer, fungerar efter vertikal scroll).
export const MAGNIFIER_KEY = 'bokpilot.viewer.magnifier'

export function useMagnifier() {
  const [magnifier, setMagnifier] = useState(() => {
    try { return localStorage.getItem(MAGNIFIER_KEY) !== '0' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem(MAGNIFIER_KEY, magnifier ? '1' : '0') } catch { /* ignore */ } }, [magnifier])
  return [magnifier, setMagnifier]
}
