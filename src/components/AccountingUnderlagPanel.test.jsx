// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import AccountingUnderlagPanel, { safeName, isAllowedFile, validateUnderlagFile } from './AccountingUnderlagPanel'
import DocumentSplitLayout from './viewer/DocumentSplitLayout'
import { MAX_ATTACHMENT_BYTES } from '../lib/inboxAddresses'

// Mocka tunga/extern-beroenden så testet fokuserar på panelens egen logik.
const h = vi.hoisted(() => {
  const state = { uploadPath: null, insertArg: null }
  const single = vi.fn(async () => ({ data: { id: 'doc1', company_id: 'c1', file_name: 'kvitto.pdf', storage_path: state.uploadPath }, error: null }))
  const insert = vi.fn(arg => { state.insertArg = arg; return { select: () => ({ single }) } })
  const upload = vi.fn(async path => { state.uploadPath = path; return { error: null } })
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }))
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { state, single, insert, upload, createSignedUrl, toast }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: h.upload, createSignedUrl: h.createSignedUrl }) },
    // Kedjbar query: stöder både insert (uppladdning) och loadInbox-kedjan
    // select().eq().is().order().limit() som returnerar en tom inkorg.
    from: () => {
      const q = { insert: h.insert }
      q.select = () => q; q.eq = () => q; q.is = () => q; q.order = () => q
      q.update = () => q; q.limit = async () => ({ data: [], error: null })
      return q
    },
  },
}))
vi.mock('react-hot-toast', () => ({ default: h.toast }))
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
    expect(h.toast.error).toHaveBeenCalledWith('Filtypen stöds inte. Ladda upp PDF eller bild.')
  })
})

describe('validateUnderlagFile – typ + storlek (krav 12-17)', () => {
  it('godkänner PDF/JPG/PNG/WEBP inom storleksgränsen', () => {
    expect(validateUnderlagFile({ type: 'application/pdf', name: 'a.pdf', size: 1000 })).toBeNull()
    expect(validateUnderlagFile({ type: 'image/jpeg', name: 'b.jpg', size: 1000 })).toBeNull()
    expect(validateUnderlagFile({ type: 'image/webp', name: 'c.webp', size: 1000 })).toBeNull()
  })
  it('blockerar otillåtna typer (exe/html/zip) med tydligt fel (krav 14/16)', () => {
    expect(validateUnderlagFile({ type: 'application/x-msdownload', name: 'x.exe', size: 1 })).toBe('Filtypen stöds inte. Ladda upp PDF eller bild.')
    expect(validateUnderlagFile({ type: 'text/html', name: 'x.html', size: 1 })).toBe('Filtypen stöds inte. Ladda upp PDF eller bild.')
    expect(validateUnderlagFile({ type: 'application/zip', name: 'x.zip', size: 1 })).toBe('Filtypen stöds inte. Ladda upp PDF eller bild.')
  })
  it('blockerar för stor fil (krav 15/17)', () => {
    expect(validateUnderlagFile({ type: 'application/pdf', name: 'big.pdf', size: MAX_ATTACHMENT_BYTES + 1 })).toBe('Filen är för stor.')
  })
})

// Hjälpare: gör input.click spårbar och hämta dropzonen (role=button med aria-label).
const getDropzone = () => screen.getByRole('button', { name: /Ladda upp underlag/i })
const spyPicker = container => {
  const input = container.querySelector('input[type=file]')
  input.click = vi.fn()
  return input
}

describe('AccountingUnderlagPanel – dropzone & filväljare (krav 1-9/18-20)', () => {
  it('klick på tom-ytan öppnar filväljaren', () => {
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    const input = spyPicker(container)
    fireEvent.click(getDropzone())
    expect(input.click).toHaveBeenCalled()
  })

  it('klick på toolbar-knappen "Ladda upp" öppnar samma filväljare', () => {
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    const input = spyPicker(container)
    const toolbarBtn = screen.getAllByText('Ladda upp').map(n => n.closest('button')).find(Boolean)
    fireEvent.click(toolbarBtn)
    expect(input.click).toHaveBeenCalled()
  })

  it('Enter och Space öppnar filväljaren när dropzonen har fokus (krav 19)', () => {
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    const input = spyPicker(container)
    fireEvent.keyDown(getDropzone(), { key: 'Enter' })
    fireEvent.keyDown(getDropzone(), { key: ' ' })
    expect(input.click).toHaveBeenCalledTimes(2)
  })

  it('dragover visar aktivt drop-läge ("Släpp filen här")', () => {
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    expect(screen.queryByText('Släpp filen här')).toBeNull()
    fireEvent.dragOver(container.firstChild)
    expect(screen.getByText('Släpp filen här')).toBeTruthy()
  })

  it('drop med PDF triggar upload', async () => {
    const onSelected = vi.fn()
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={onSelected} />)
    const file = new File(['x'], 'kvitto.pdf', { type: 'application/pdf' })
    fireEvent.drop(container.firstChild, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(h.upload).toHaveBeenCalled())
    expect(onSelected).toHaveBeenCalled()
  })

  it('drop med bild triggar upload', async () => {
    const onSelected = vi.fn()
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={onSelected} />)
    const file = new File(['x'], 'foto.png', { type: 'image/png' })
    fireEvent.drop(container.firstChild, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(h.upload).toHaveBeenCalled())
  })

  it('drop med otillåten filtyp blockeras (ingen upload, fel visas)', async () => {
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    fireEvent.drop(container.firstChild, { dataTransfer: { files: [new File(['x'], 'a.zip', { type: 'application/zip' })] } })
    await Promise.resolve()
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledWith('Filtypen stöds inte. Ladda upp PDF eller bild.')
  })

  it('drop med för stor fil blockeras', async () => {
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={() => {}} />)
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 })
    fireEvent.drop(container.firstChild, { dataTransfer: { files: [big] } })
    await Promise.resolve()
    expect(h.upload).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledWith('Filen är för stor.')
  })

  it('flera filer: tar första och informerar (krav 11)', async () => {
    const onSelected = vi.fn()
    const { container } = render(<AccountingUnderlagPanel company={company} doc={null} onSelected={onSelected} />)
    const f1 = new File(['x'], 'ett.pdf', { type: 'application/pdf' })
    const f2 = new File(['y'], 'tva.pdf', { type: 'application/pdf' })
    fireEvent.drop(container.firstChild, { dataTransfer: { files: [f1, f2] } })
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1))
    expect(h.toast).toHaveBeenCalledWith('Endast en fil i taget – tar den första.')
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
