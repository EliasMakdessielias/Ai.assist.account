import { describe, it, expect } from 'vitest'
import { validateUploadFile } from './UnderlagPanel'

const file = (name, type, size = 1000) => ({ name, type, size })

describe('validateUploadFile', () => {
  it('accepterar PDF/PNG/JPG/HEIC/WEBP via MIME', () => {
    expect(validateUploadFile(file('a.pdf', 'application/pdf'))).toBe(null)
    expect(validateUploadFile(file('a.png', 'image/png'))).toBe(null)
    expect(validateUploadFile(file('a.jpg', 'image/jpeg'))).toBe(null)
    expect(validateUploadFile(file('a.heic', 'image/heic'))).toBe(null)
    expect(validateUploadFile(file('a.webp', 'image/webp'))).toBe(null)
  })

  it('accepterar via filändelse när MIME saknas (vanligt för HEIC)', () => {
    expect(validateUploadFile(file('skannad.HEIC', ''))).toBe(null)
    expect(validateUploadFile(file('faktura.pdf', ''))).toBe(null)
  })

  it('blockerar otillåten filtyp med svenskt fel', () => {
    const err = validateUploadFile(file('virus.exe', 'application/octet-stream'))
    expect(err).toMatch(/stöds inte/i)
  })

  it('blockerar för stor fil', () => {
    const err = validateUploadFile(file('stor.pdf', 'application/pdf', 30 * 1024 * 1024))
    expect(err).toMatch(/för stor/i)
  })

  it('för stor fil men gränsfall under 25 MB är ok', () => {
    expect(validateUploadFile(file('ok.pdf', 'application/pdf', 24 * 1024 * 1024))).toBe(null)
  })
})
