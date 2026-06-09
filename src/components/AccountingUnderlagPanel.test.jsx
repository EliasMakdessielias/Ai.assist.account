// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import AccountingUnderlagPanel, { safeName, isAllowedFile } from './AccountingUnderlagPanel'
import DocumentSplitLayout from './viewer/DocumentSplitLayout'

// Mocka tunga/extern-beroenden så testet fokuserar på panelens egen logik.
const h = vi.hoisted(() => {
  const state = { uploadPath: null, insertArg: null }
  const single = vi.fn(async () => ({ data: { id: 'doc1', company_id: 'c1', file_name: 'kvitto.pdf', storage_path: state.uploadPath }, error: null }))
  const insert = vi.fn(arg => { state.insertArg = arg; return { select: () => ({ single }) } })
  const upload = vi.fn(async path => { state.uploadPath = path; return { error: null } })
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }))
  return { state, single, insert, upload, createSignedUrl }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: h.upload, createSignedUrl: h.createSignedUrl }) },
    from: () => ({ insert: h.insert }),
  },
}))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
// Stubba den gemensamma visaren (drar annars in pdf.js m.m.) – vi verifierar bara att den får underlaget.
vi.mock('./viewer/DocumentViewerPanel', () => ({
  default: ({ docs, footer }) => (
    <div data-testid="viewer"><span data-testid="viewer-file">{docs?.[0]?.file_name}</span>{footer}</div>
  ),
  docKind: () => 'pdf',
}))

beforeEach(() => {
  cleanup()
  h.state.uploadPath = null
  h.state.insertArg = null
  vi.clearAllMocks()
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { ...globalThis.crypto, randomUUID: () => 'fixed-uuid' }
  else globalThis.crypto.randomUUID = () => 'fixed-uuid'
})

const company = { id: 'c1' }

describe('safeName – sanering + path traversal (krav 31/32)', () => {
  it('tar bort katalogdelar och otillåtna tecken', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd')             // basename → inga "/" kvar
    expect(safeName('..\\..\\win.ini')).toBe('win.ini')            // backslash-path strippas
    expect(safeName('a/b/c.pdf')).not.toMatch(/[\\/]/)             // aldrig sökvägstecken i resultatet
    expect(safeName('..')).toBe('_')                               // ren traversal-token nollställs
    expect(safeName('min faktura (1).pdf')).toBe('min_faktura_1_.pdf')
    expect(safeName('.bashrc')).toBe('_bashrc')                       // får ej börja med punkt
    expect(safeName('')).toBe('underlag')
  })
})

describe('isAllowedFile – tillåtna filtyper (krav 16)', () => {
  it('accepterar pdf/jpg/png/webp via mime eller ändelse', () => {
    expect(isAllowedFile({ type: 'application/pdf', name: 'a.pdf' })).toBe(true)
    expect(isAllowedFile({ type: '', name: 'b.JPEG' })).toBe(true)
    expect(isAllowedFile({ type: 'image/webp', name: 'c' })).toBe(true)
    expect(isAllowedFile({ type: 'image/png', name: 'd.png' })).toBe(true)
  })
  it('nekar otillåtna typer', () => {
    expect(isAllowedFile({ type: 'application/x-msdownload', name: 'x.exe' })).toBe(false)
    expect(isAllowedFile({ type: 'text/html', name: 'x.html' })).toBe(false)
    expect(isAllowedFile(null)).toBe(false)
  })
})

describe('AccountingUnderlagPanel – tomt läge (krav 4/21/22)', () => {
  it('visar lugn tom-vy med rubrik, hjälptext, infodruta och Ladda upp', () => {
    render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    expect(screen.getByText('VÄLJ BILD')).toBeTruthy()
    expect(screen.getByText('Det finns inga tillgängliga underlag att koppla.')).toBeTruthy()
    expect(screen.getByText(/Dra och släpp ett underlag här/)).toBeTruthy()
    expect(screen.getByText(/sparat och arkiverat digitalt/)).toBeTruthy()
    expect(screen.getAllByText('Ladda upp').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('viewer')).toBeNull()
  })
})

describe('AccountingUnderlagPanel – uppladdning + filkoppling + tenant (krav 15/17/27/29)', () => {
  it('laddar upp till {company_id}/-mapp, skapar document-rad och returnerar signerad URL', async () => {
    const onSelected = vi.fn()
    const { container } = render(<AccountingUnderlagPanel company={company} kategori="kvitto" doc={null} onSelected={onSelected} />)
    const input = container.querySelector('input[type=file]')
    const file = new File(['data'], 'kvitto.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(onSelected).toHaveBeenCalled())
    // Tenant: storage-sökväg under företagets mapp, document-rad scopas till company_id.
    expect(h.state.uploadPath.startsWith('c1/')).toBe(true)
    expect(h.state.insertArg.company_id).toBe('c1')
    expect(h.state.insertArg.kategori).toBe('kvitto')
    expect(h.state.insertArg.storage_path).toBe(h.state.uploadPath)
    // Signerad URL (ingen publik permanent URL).
    expect(h.createSignedUrl).toHaveBeenCalled()
    expect(onSelected.mock.calls[0][0].url).toBe('https://signed/x')
  })

  it('nekar otillåten filtyp utan att ladda upp', async () => {
    const onSelected = vi.fn()
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={onSelected} />)
    const input = container.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [new File(['x'], 'evil.exe', { type: 'application/x-msdownload' })] } })
    await Promise.resolve()
    expect(h.upload).not.toHaveBeenCalled()
    expect(onSelected).not.toHaveBeenCalled()
  })
})

describe('AccountingUnderlagPanel – med underlag (krav 13/25/26)', () => {
  it('visar visaren med filnamn och en ta-bort-åtgärd', () => {
    const onRemove = vi.fn()
    render(<AccountingUnderlagPanel company={company} doc={{ id: 'doc1', file_name: 'kvitto.pdf', url: 'https://signed/x', mime_type: 'application/pdf' }} onSelected={() => {}} onRemove={onRemove} />)
    expect(screen.getByTestId('viewer')).toBeTruthy()
    expect(screen.getByTestId('viewer-file').textContent).toBe('kvitto.pdf')
    const remove = screen.getByText('Ta bort underlag')
    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalled()
  })
})

describe('DocumentSplitLayout – visa/dölj + splitter + toggle (krav 1.3/1.4/1.5/1.7)', () => {
  it('öppen: panel + dragbar splitter syns, toggle visar "Dölj bild"', () => {
    render(
      <DocumentSplitLayout open panelW={500} startResize={() => {}} onToggle={() => {}} panel={<div data-testid="p">PANEL</div>}>
        <div>FORM</div>
      </DocumentSplitLayout>
    )
    expect(screen.getByTestId('p')).toBeTruthy()
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.getByLabelText('Dölj bild')).toBeTruthy()
  })

  it('stängd: panel + splitter borta, toggle visar "Visa bild"', () => {
    render(
      <DocumentSplitLayout open={false} panelW={500} startResize={() => {}} onToggle={() => {}} panel={<div data-testid="p">PANEL</div>}>
        <div>FORM</div>
      </DocumentSplitLayout>
    )
    expect(screen.queryByTestId('p')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByLabelText('Visa bild')).toBeTruthy()
  })

  it('klick på toggle anropar onToggle', () => {
    const onToggle = vi.fn()
    render(
      <DocumentSplitLayout open panelW={500} startResize={() => {}} onToggle={onToggle} panel={<div>PANEL</div>}>
        <div>FORM</div>
      </DocumentSplitLayout>
    )
    fireEvent.click(screen.getByLabelText('Dölj bild'))
    expect(onToggle).toHaveBeenCalled()
  })
})
