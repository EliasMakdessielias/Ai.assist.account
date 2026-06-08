import { describe, it, expect } from 'vitest'
import {
  OCR_PROVIDERS, emptyOcrResult, normalizeOcrResult, normalizeFolioResult,
  ocrConfig, resolveOcrPlan, runOcrWithFallback,
} from './ocrProviders'

describe('normalisering (krav 10)', () => {
  it('emptyOcrResult har alla fält', () => {
    expect(Object.keys(emptyOcrResult('x'))).toEqual(
      ['providerName', 'rawText', 'pages', 'layoutBlocks', 'confidence', 'processingTimeMs', 'errors', 'fallbackUsed'])
  })
  it('normalizeFolioResult mappar Folio -> gemensamt format', () => {
    const r = normalizeFolioResult({ text: 'Faktura 123', pages: [{ page: 1, text: 'Faktura 123', blocks: [{ text: '123' }] }], confidence: 0.9 }, { processingTimeMs: 420 })
    expect(r.providerName).toBe('folio_ocr')
    expect(r.rawText).toBe('Faktura 123')
    expect(r.pages).toHaveLength(1)
    expect(r.layoutBlocks).toHaveLength(1)
    expect(r.confidence).toBe(0.9)
    expect(r.processingTimeMs).toBe(420)
  })
  it('härleder rawText från pages om text saknas', () => {
    expect(normalizeOcrResult({ pages: [{ text: 'A' }, { text: 'B' }] }, { providerName: 'folio_ocr' }).rawText).toBe('A\n\nB')
  })
})

describe('feature flags (krav 4)', () => {
  it('default: Folio AV, fallback PÅ, gemini primary', () => {
    const c = ocrConfig({})
    expect(c).toEqual({ primary: 'gemini', secondary: 'folio_ocr', folioEnabled: false, fallbackEnabled: true })
  })
  it('aktiverar Folio + respekterar fallback-flagga', () => {
    expect(ocrConfig({ ENABLE_FOLIO_OCR: 'true' }).folioEnabled).toBe(true)
    expect(ocrConfig({ ENABLE_OCR_FALLBACK: 'false' }).fallbackEnabled).toBe(false)
  })
})

describe('resolveOcrPlan', () => {
  it('utan Folio: bara primary', () => {
    expect(resolveOcrPlan(ocrConfig({}))).toEqual({ primary: 'gemini', secondary: null, fallback: true })
  })
  it('med Folio aktiverat: secondary = folio_ocr', () => {
    expect(resolveOcrPlan(ocrConfig({ ENABLE_FOLIO_OCR: '1' }))).toEqual({ primary: 'gemini', secondary: 'folio_ocr', fallback: true })
  })
})

describe('safe uninstall / Folio av (krav 14)', () => {
  const gemini = async () => normalizeOcrResult({ text: 'gemini-text' }, { providerName: 'gemini' })
  it('Folio avstängd: planen kör endast Gemini (befintligt flöde opåverkat)', async () => {
    const plan = resolveOcrPlan(ocrConfig({ ENABLE_FOLIO_OCR: 'false' }))
    expect(plan.secondary).toBe(null)
    const r = await runOcrWithFallback({ plan, providers: { gemini } })
    expect(r.providerName).toBe('gemini'); expect(r.fallbackUsed).toBe(false)
  })
  it('Folio-provider saknas helt: faller tillbaka utan att krascha', async () => {
    const plan = { primary: 'gemini', secondary: 'folio_ocr', fallback: true }
    const r = await runOcrWithFallback({ plan, providers: { gemini } }) // ingen folio_ocr-fn
    expect(r.providerName).toBe('gemini'); expect(r.fallbackUsed).toBe(true)
    expect(r.errors.some(e => e.provider === 'folio_ocr' && e.error === 'provider_unavailable')).toBe(true)
  })
})

describe('runOcrWithFallback (krav 5/15)', () => {
  const gemini = async () => normalizeOcrResult({ text: 'gemini-text' }, { providerName: 'gemini' })
  it('utan secondary: kör primary', async () => {
    const r = await runOcrWithFallback({ plan: { primary: 'gemini', secondary: null, fallback: true }, providers: { gemini } })
    expect(r.providerName).toBe('gemini'); expect(r.fallbackUsed).toBe(false)
  })
  it('Folio lyckas: används som secondary (ingen fallback)', async () => {
    const folio = async () => normalizeFolioResult({ text: 'folio-text' })
    const r = await runOcrWithFallback({ plan: { primary: 'gemini', secondary: 'folio_ocr', fallback: true }, providers: { gemini, folio_ocr: folio } })
    expect(r.providerName).toBe('folio_ocr'); expect(r.fallbackUsed).toBe(false)
  })
  it('Folio misslyckas + fallback på: faller tillbaka till primary', async () => {
    const folio = async () => { throw new Error('folio down') }
    const r = await runOcrWithFallback({ plan: { primary: 'gemini', secondary: 'folio_ocr', fallback: true }, providers: { gemini, folio_ocr: folio } })
    expect(r.providerName).toBe('gemini'); expect(r.fallbackUsed).toBe(true)
    expect(r.errors.some(e => e.provider === 'folio_ocr')).toBe(true)
  })
  it('Folio misslyckas + fallback AV: misslyckas utan trasig post', async () => {
    const folio = async () => { throw new Error('timeout') }
    const r = await runOcrWithFallback({ plan: { primary: 'gemini', secondary: 'folio_ocr', fallback: false }, providers: { gemini, folio_ocr: folio } })
    expect(r.failed).toBe(true); expect(r.rawText).toBe('')
  })
  it('Folio timeout -> fallback (samma som failure)', async () => {
    const folio = async () => { const e = new Error('aborted'); throw e }
    const r = await runOcrWithFallback({ plan: { primary: 'gemini', secondary: 'folio_ocr', fallback: true }, providers: { gemini, folio_ocr: folio } })
    expect(r.providerName).toBe('gemini'); expect(r.fallbackUsed).toBe(true)
  })
})
