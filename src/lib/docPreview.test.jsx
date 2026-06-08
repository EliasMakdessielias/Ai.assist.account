// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { previewWidthPx, previewHeightPx, useContainerSize, computeAutoScale, clampScale, resolveViewerWidth } from './docPreview'

describe('resolveViewerWidth – dokumentvisarens standardbredd (45%) + validering', () => {
  it('utan sparat värde: 45% av fönstret (krav 1/2)', () => {
    expect(resolveViewerWidth(null, 2000)).toBe(900)
    expect(resolveViewerWidth(undefined, 1440)).toBe(648)
  })
  it('respekterar giltig sparad bredd (krav 3)', () => {
    expect(resolveViewerWidth('700', 2000)).toBe(700)
    expect(resolveViewerWidth(1100, 2000)).toBe(1100)
  })
  it('ogiltig sparad bredd återställs till 45% (krav 4)', () => {
    expect(resolveViewerWidth('abc', 2000)).toBe(900)   // NaN
    expect(resolveViewerWidth('100', 2000)).toBe(900)   // < minPx 360
    expect(resolveViewerWidth('1900', 2000)).toBe(900)  // > 75% (1500)
    expect(resolveViewerWidth('', 2000)).toBe(900)      // tomt -> NaN-aktigt
  })
  it('respekterar gränserna min 360 / max 75%', () => {
    expect(resolveViewerWidth('360', 2000)).toBe(360)   // exakt min ok
    expect(resolveViewerWidth('1500', 2000)).toBe(1500) // exakt max ok
    expect(resolveViewerWidth('359', 2000)).toBe(900)   // strax under min
  })
  it('faller tillbaka på 1200px-fönster om viewport saknas', () => {
    expect(resolveViewerWidth(null, 0)).toBe(540)       // 1200*0.45
    expect(resolveViewerWidth(null, NaN)).toBe(540)
  })
})

describe('computeAutoScale – fit-to-width (Auto)', () => {
  it('returnerar null innan container/dokument mätts', () => {
    expect(computeAutoScale(0, 800, 1000, 1400)).toBeNull()
    expect(computeAutoScale(600, 800, 0, 0)).toBeNull()
  })
  it('skalar efter bredden: scale = (containerW - padding) / naturalW (krav 1)', () => {
    expect(computeAutoScale(1000, 800, 2000, 1000, { padding: 0 })).toBe(0.5)
    // horisontell padding dras av (krav 6): (1000-24)/2000 = 0.488
    expect(computeAutoScale(1000, 800, 2000, 1000)).toBe(0.488)
  })
  it('höjden begränsar INTE skalan – höga dokument blir inte små (krav 2/3/10)', () => {
    // Tidigare (fit-to-page) hade höjden bundit detta till 0.25; nu rent breddbaserat = 1.
    expect(computeAutoScale(1000, 500, 1000, 2000, { padding: 0 })).toBe(1)
    // Mycket högt dokument, smal panel: fortfarande breddstyrt.
    expect(computeAutoScale(800, 300, 800, 4000, { padding: 0 })).toBe(1)
  })
  it('växer när panelen blir bredare, krymper när den blir smalare (krav 8/9)', () => {
    const narrow = computeAutoScale(600, 800, 1200, 800, { padding: 0 })
    const wide = computeAutoScale(1000, 800, 1200, 800, { padding: 0 })
    expect(narrow).toBe(0.5)
    expect(wide).toBeGreaterThan(narrow)
  })
  it('mycket brett dokument klampas så det passar bredden (krav 7)', () => {
    // brett dok (naturalW 5000) i smal panel -> liten skala (men ej under min)
    expect(computeAutoScale(900, 800, 5000, 1000, { padding: 0, min: 0.1 })).toBe(0.18)
  })
  it('respekterar min/max', () => {
    expect(computeAutoScale(100, 100, 5000, 5000, { padding: 0, min: 0.4, max: 2.5 })).toBe(0.4) // klampas upp
    expect(computeAutoScale(5000, 5000, 100, 100, { padding: 0, min: 0.4, max: 2.5 })).toBe(2.5) // klampas ner
  })
})

describe('clampScale', () => {
  it('klampar till [min,max]', () => {
    expect(clampScale(0.1)).toBe(0.4)
    expect(clampScale(9)).toBe(2.5)
    expect(clampScale(1.2)).toBe(1.2)
    expect(clampScale('x')).toBe(1)
  })
})

describe('previewWidthPx – bredd i px utifrån container + zoom', () => {
  it('returnerar null innan containern mätts', () => {
    expect(previewWidthPx(0, 1)).toBeNull()
    expect(previewWidthPx(null, 1)).toBeNull()
    expect(previewWidthPx(undefined, 1)).toBeNull()
  })
  it('100% (scale=1) fyller containern exakt', () => {
    expect(previewWidthPx(800, 1)).toBe(800)
  })
  it('respekterar zoomnivå (50/75/125/150/200%)', () => {
    expect(previewWidthPx(800, 0.5)).toBe(400)
    expect(previewWidthPx(800, 0.75)).toBe(600)
    expect(previewWidthPx(800, 1.25)).toBe(1000)
    expect(previewWidthPx(800, 1.5)).toBe(1200)
    expect(previewWidthPx(800, 2)).toBe(1600)
  })
  it('avrundar till heltal px', () => {
    expect(previewWidthPx(801, 1.5)).toBe(Math.round(801 * 1.5))
  })
  it('faller tillbaka till 1x vid ogiltig zoom', () => {
    expect(previewWidthPx(800, 0)).toBe(800)
    expect(previewWidthPx(800, NaN)).toBe(800)
    expect(previewWidthPx(800, -2)).toBe(800)
  })
})

describe('previewHeightPx – PDF-höjd', () => {
  it('returnerar null innan containern mätts', () => {
    expect(previewHeightPx(0, 1)).toBeNull()
  })
  it('fyller höjden vid zoom <= 1 (klampas till minst 1x)', () => {
    expect(previewHeightPx(600, 1)).toBe(600)
    expect(previewHeightPx(600, 0.5)).toBe(600)
  })
  it('blir högre vid zoom > 1 (scrollas)', () => {
    expect(previewHeightPx(600, 1.5)).toBe(900)
    expect(previewHeightPx(600, 2)).toBe(1200)
  })
})

describe('useContainerSize – ResizeObserver med debounce', () => {
  let roInstances
  let OriginalRO
  beforeEach(() => {
    roInstances = []
    OriginalRO = global.ResizeObserver
    global.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.observe = vi.fn(); this.disconnect = vi.fn(); roInstances.push(this) }
    }
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    global.ResizeObserver = OriginalRO
  })

  function Probe() {
    const ref = useRef(null)
    const { width, height } = useContainerSize(ref, 80)
    return <div ref={ref} data-testid="p">{width}x{height}</div>
  }

  it('rapporterar uppmätt storlek efter debounce', () => {
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('p').textContent).toBe('0x0')
    act(() => { roInstances[0].cb([{ contentRect: { width: 812.4, height: 600.6 } }]) })
    // före debounce-fönstret: oförändrat
    expect(getByTestId('p').textContent).toBe('0x0')
    act(() => { vi.advanceTimersByTime(80) })
    expect(getByTestId('p').textContent).toBe('812x601')
  })

  it('debounce: bara sista måttet vinner vid täta events', () => {
    const { getByTestId } = render(<Probe />)
    act(() => {
      roInstances[0].cb([{ contentRect: { width: 400, height: 300 } }])
      vi.advanceTimersByTime(40)
      roInstances[0].cb([{ contentRect: { width: 900, height: 700 } }])
      vi.advanceTimersByTime(80)
    })
    expect(getByTestId('p').textContent).toBe('900x700')
  })

  it('observerar elementet och kopplar bort vid unmount', () => {
    const { unmount } = render(<Probe />)
    const ro = roInstances[0]
    expect(ro.observe).toHaveBeenCalledTimes(1)
    unmount()
    expect(ro.disconnect).toHaveBeenCalledTimes(1)
  })
})
