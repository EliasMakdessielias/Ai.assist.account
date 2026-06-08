// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDocumentViewerLayout } from './useDocumentViewerLayout'
import { useAutoFitToWidth } from './useAutoFitToWidth'
import { docKind } from '../../components/viewer/DocumentViewerPanel'

beforeEach(() => localStorage.clear())
const def = () => Math.round(window.innerWidth * 0.45)

describe('docKind – fil-typdetektering', () => {
  it('via mime', () => {
    expect(docKind({ mime_type: 'image/png' })).toBe('image')
    expect(docKind({ mime_type: 'application/pdf' })).toBe('pdf')
    expect(docKind({ mime_type: 'text/plain' })).toBe('other')
  })
  it('via filändelse som fallback', () => {
    expect(docKind({ file_name: 'kvitto.JPG' })).toBe('image')
    expect(docKind({ file_name: 'faktura.pdf' })).toBe('pdf')
    expect(docKind({ file_name: 'avtal.docx' })).toBe('other')
    expect(docKind(null)).toBe('other')
  })
})

describe('useDocumentViewerLayout – localStorage-nycklar krockar inte (krav 17/19)', () => {
  it('default 45% utan sparat värde', () => {
    const { result } = renderHook(() => useDocumentViewerLayout({ widthKey: 'k.inkorg' }))
    expect(result.current.panelW).toBe(def())
  })
  it('skriver till sin EGEN nyckel, läcker inte till andra moduler', () => {
    const a = renderHook(() => useDocumentViewerLayout({ widthKey: 'mod.a' }))
    act(() => a.result.current.setPanelW(700))
    expect(localStorage.getItem('mod.a')).toBe('700')
    expect(localStorage.getItem('mod.b')).toBeNull()
    const b = renderHook(() => useDocumentViewerLayout({ widthKey: 'mod.b' }))
    expect(b.result.current.panelW).toBe(def()) // egen default, opåverkad av mod.a
  })
  it('respekterar giltig sparad bredd, återställer ogiltig (krav 3/4)', () => {
    localStorage.setItem('mod.valid', '650')
    localStorage.setItem('mod.invalid', '50')
    const v = renderHook(() => useDocumentViewerLayout({ widthKey: 'mod.valid' }))
    const iv = renderHook(() => useDocumentViewerLayout({ widthKey: 'mod.invalid' }))
    expect(v.result.current.panelW).toBe(650)
    expect(iv.result.current.panelW).toBe(def())
  })
  it('open-state har egen nyckel', () => {
    localStorage.setItem('mod.open', '0')
    const { result } = renderHook(() => useDocumentViewerLayout({ widthKey: 'mod.w', openKey: 'mod.open' }))
    expect(result.current.open).toBe(false)
  })
})

describe('useAutoFitToWidth – fit-to-width + manuell zoom', () => {
  it('auto-läge ger breddbaserad effScale (höjden påverkar ej)', () => {
    const { result } = renderHook(() => useAutoFitToWidth(1000, 800, { padding: 0 }))
    act(() => result.current.setNatural({ w: 2000, h: 4000 }))
    expect(result.current.effScale).toBe(0.5)            // (1000)/2000
    expect(result.current.zoomLabel).toBe('Auto · 50%')
  })
  it('manuell zoom behålls och skrivs inte över av auto', () => {
    const { result } = renderHook(() => useAutoFitToWidth(1000, 800, { padding: 0 }))
    act(() => result.current.setNatural({ w: 2000, h: 1000 }))
    act(() => result.current.setManual(1.3))
    expect(result.current.mode).toBe('manual')
    expect(result.current.effScale).toBe(1.3)
    expect(result.current.zoomLabel).toBe('Manual · 130%')
  })
  it('resetAuto återgår till fit-to-width', () => {
    const { result } = renderHook(() => useAutoFitToWidth(1000, 800, { padding: 0 }))
    act(() => result.current.setManual(2))
    act(() => result.current.resetAuto())
    expect(result.current.mode).toBe('auto')
  })
})
