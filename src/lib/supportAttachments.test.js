import { describe, it, expect } from 'vitest'
import {
  MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, ALLOWED_EXT, BLOCKED_EXT,
  fileExt, safeFileName, validateFile, validateFiles, attachmentPath, formatBytes,
} from './supportAttachments'

const f = (name, size = 1000, type = '') => ({ name, size, type })

describe('konstanter (krav 5)', () => {
  it('10 MB / 5 filer', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024)
    expect(MAX_FILES_PER_MESSAGE).toBe(5)
  })
  it('tillåtna + blockerade filtyper (krav 3/4)', () => {
    expect(ALLOWED_EXT).toEqual(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'xlsx', 'docx', 'json'])
    for (const b of ['exe', 'bat', 'cmd', 'js', 'msi', 'ps1', 'sh', 'html']) expect(BLOCKED_EXT).toContain(b)
  })
})

describe('fileExt + safeFileName (anti path-traversal, krav 6/13)', () => {
  it('extraherar ext', () => { expect(fileExt('Faktura.PDF')).toBe('pdf'); expect(fileExt('x')).toBe('') })
  it('saniterar filnamn och tar bort sökväg', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\temp\\min fil!.pdf')).toBe('min_fil_.pdf')
    expect(safeFileName('skärm bild.png')).toMatch(/\.png$/)
  })
})

describe('validateFile (krav 3/4/5)', () => {
  it('tillåter giltiga', () => {
    expect(validateFile(f('faktura.pdf', 5000))).toBeNull()
    expect(validateFile(f('bild.png'))).toBeNull()
    expect(validateFile(f('data.json'))).toBeNull()
  })
  it('blockerar riskabla filtyper', () => {
    expect(validateFile(f('virus.exe'))).toMatch(/blockerad/i)
    expect(validateFile(f('script.js'))).toMatch(/blockerad/i)
    expect(validateFile(f('page.html'))).toMatch(/blockerad/i)
  })
  it('avvisar ej stödda filtyper', () => { expect(validateFile(f('arkiv.rar'))).toMatch(/stöds inte/i) })
  it('avvisar för stora filer', () => { expect(validateFile(f('stor.pdf', 11 * 1024 * 1024))).toMatch(/för stor/i) })
})

describe('validateFiles (max antal)', () => {
  it('max 5 filer', () => {
    const six = Array.from({ length: 6 }, (_, i) => f(`f${i}.pdf`))
    expect(validateFiles(six)).toMatch(/Max 5/)
    expect(validateFiles(six.slice(0, 5))).toBeNull()
  })
  it('returnerar första felet', () => {
    expect(validateFiles([f('ok.pdf'), f('bad.exe')])).toMatch(/bad\.exe/)
  })
})

describe('attachmentPath (krav 6)', () => {
  it('bygger {company}/{ticket}/{ref}/{säkert namn}', () => {
    expect(attachmentPath('comp', 'tick', 'msg', '../hack.pdf')).toBe('comp/tick/msg/hack.pdf')
  })
})

describe('formatBytes', () => {
  it('formaterar', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB')
  })
})
