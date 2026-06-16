// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyText, copyWithToast } from './clipboard'

const origClipboard = navigator.clipboard
const setClipboard = v => Object.defineProperty(navigator, 'clipboard', { value: v, configurable: true })
// jsdom saknar execCommand – definiera den så den kan stubbas.
const setExec = ret => { document.execCommand = vi.fn().mockReturnValue(ret); return document.execCommand }

afterEach(() => { setClipboard(origClipboard); delete document.execCommand; vi.restoreAllMocks() })

describe('copyText', () => {
  it('använder navigator.clipboard när det finns', async () => {
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    expect(await copyText('a@b.se')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('a@b.se')
  })

  it('faller tillbaka på execCommand när clipboard saknas', async () => {
    setClipboard(undefined)
    const exec = setExec(true)
    expect(await copyText('x@y.se')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('faller tillbaka när clipboard.writeText avvisar (rejicerar)', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    const exec = setExec(true)
    expect(await copyText('z@z.se')).toBe(true)
    expect(exec).toHaveBeenCalled()
  })

  it('returnerar false för tom text och när allt misslyckas', async () => {
    expect(await copyText('')).toBe(false)
    setClipboard(undefined)
    setExec(false)
    expect(await copyText('a')).toBe(false)
  })
})

describe('copyWithToast', () => {
  beforeEach(() => { setClipboard({ writeText: vi.fn().mockResolvedValue() }) })
  it('visar success-toast vid lyckad kopiering', async () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    await copyWithToast('a@b.se', toast)
    expect(toast.success).toHaveBeenCalledWith('E-postadress kopierad')
    expect(toast.error).not.toHaveBeenCalled()
  })
  it('visar fel-toast när kopiering misslyckas', async () => {
    setClipboard(undefined)
    setExec(false)
    const toast = { success: vi.fn(), error: vi.fn() }
    await copyWithToast('a@b.se', toast)
    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
