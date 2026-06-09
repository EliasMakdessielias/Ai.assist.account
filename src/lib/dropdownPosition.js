// Collision-aware positionering för popover/dropdown (t.ex. NotificationCenter).
// Klockan ligger i vänster sidomeny → dropdownen ska öppnas INÅT mot arbetsytan
// (till höger om triggern), aldrig ut till vänster utanför appen. Flippar till vänster
// endast om den inte får plats, och clampas alltid helt inom viewporten.
//
//   computeDropdownPos(triggerRect, window.innerWidth, window.innerHeight)
//   -> { left, top, width, maxHeight }  (fixed-koordinater)
export const DROPDOWN_W = 320

export function computeDropdownPos(rect, vw, vh, opts = {}) {
  const { gap = 8, margin = 8, preferredWidth = DROPDOWN_W, maxH = 480, topReserve = 80 } = opts
  const width = Math.min(preferredWidth, Math.max(0, vw - margin * 2))
  const maxHeight = Math.max(0, Math.min(maxH, vh - topReserve))

  // Horisontellt: öppna åt höger om triggern (mot arbetsytan), flippa vänster vid behov.
  let left = rect.right + gap
  if (left + width > vw - margin) {
    const flipped = rect.left - gap - width
    left = flipped >= margin ? flipped : (vw - margin - width)
  }
  left = Math.max(margin, Math.min(left, vw - margin - width))

  // Vertikalt: linjera nära triggern; justera uppåt om den krockar med nederkanten.
  let top = rect.top
  if (top + maxHeight > vh - margin) top = vh - margin - maxHeight
  top = Math.max(margin, top)

  return { left, top, width, maxHeight }
}
