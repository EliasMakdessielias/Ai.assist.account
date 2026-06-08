import { useState, useEffect, useCallback } from 'react'
import { resolveViewerWidth } from '../docPreview'

// [DOCUMENT_VIEWER] Gemensam layout-state för split-vyer med dokumentpanel till höger.
// Hanterar panelbredd (px), öppna/dölj och dragbar splitter – per modul via egna
// localStorage-nycklar så att layouten INTE krockar mellan sidor (krav E/17/19).
// Standardbredd = 45% av fönstret (resolveViewerWidth); giltig sparad bredd respekteras,
// ogiltig (NaN / <360 / >75%) återställs till 45%.
//
//   const { panelW, open, setOpen, dragging, startResize } =
//     useDocumentViewerLayout({ widthKey: 'bokpilot.inkorg.viewerW', openKey: '…', defaultOpen: true })
export function useDocumentViewerLayout({ widthKey, openKey, defaultOpen = true } = {}) {
  const [panelW, setPanelW] = useState(() => {
    try { return resolveViewerWidth(widthKey ? localStorage.getItem(widthKey) : null, typeof window !== 'undefined' ? window.innerWidth : 1200) }
    catch { return resolveViewerWidth(null, 1200) }
  })
  const [open, setOpen] = useState(() => {
    try { return openKey ? localStorage.getItem(openKey) !== '0' : defaultOpen } catch { return defaultOpen }
  })
  const [dragging, setDragging] = useState(false)

  useEffect(() => { if (widthKey) try { localStorage.setItem(widthKey, String(panelW)) } catch { /* ignore */ } }, [panelW, widthKey])
  useEffect(() => { if (openKey) try { localStorage.setItem(openKey, open ? '1' : '0') } catch { /* ignore */ } }, [open, openKey])

  // Dragbar splitter (pointer = mus + touch + penna). Min 360px, max 75% av fönstret.
  const startResize = useCallback(e => {
    e.preventDefault()
    const maxW = Math.round(window.innerWidth * 0.75)
    setDragging(true)
    const move = ev => setPanelW(Math.min(maxW, Math.max(360, window.innerWidth - ev.clientX)))
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''; setDragging(false)
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }, [])

  return { panelW, setPanelW, open, setOpen, dragging, startResize }
}
