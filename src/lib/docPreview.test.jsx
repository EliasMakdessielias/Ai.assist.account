// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { previewWidthPx, previewHeightPx, useContainerSize } from './docPreview'

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
