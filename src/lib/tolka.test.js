import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocka supabase-klienten som tolka.js importerar.
const invoke = vi.fn()
const getSession = vi.fn()
const rpc = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: (...a) => invoke(...a) }, auth: { getSession: () => getSession() }, rpc: (...a) => rpc(...a) },
}))

import { tolkaDocument } from './tolka'

const withSession = (token = 'user-token-abc') => getSession.mockResolvedValue({ data: { session: { access_token: token } } })
const noSession = () => getSession.mockResolvedValue({ data: { session: null } })

beforeEach(() => { invoke.mockReset(); getSession.mockReset(); rpc.mockReset().mockResolvedValue({ data: null, error: null }) })

describe('tolkaDocument – auth (Tolka-flödet)', () => {
  it('inloggad användare kan tolka och får resultatet', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { ok: true, result: { beskrivning: 'Kvitto' } }, error: null })
    const r = await tolkaDocument('doc-1')
    expect(r).toEqual({ beskrivning: 'Kvitto' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('skickar Authorization: Bearer <access_token> till edge-funktionen (krav 3/4)', async () => {
    withSession('tok-xyz')
    invoke.mockResolvedValue({ data: { result: {} }, error: null })
    await tolkaDocument('doc-1')
    const [fn, opts] = invoke.mock.calls[0]
    expect(fn).toBe('tolka-underlag')
    expect(opts.body).toEqual({ document_id: 'doc-1' })
    expect(opts.headers.Authorization).toBe('Bearer tok-xyz')
  })

  it('oinloggad/utgången session: nekas med åtgärdbart fel, anropar ALDRIG edge (krav 8)', async () => {
    noSession()
    await expect(tolkaDocument('doc-1')).rejects.toThrow('Sessionen har gått ut. Logga in igen.')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('edge svarar "Ej inloggad" -> mappas till åtgärdbart sessionsfel (krav 8)', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { error: 'Ej inloggad' }, error: null })
    // data.error kastas som-är först; men "Ej inloggad" via error-kanalen mappas. Testa error-kanalen:
    invoke.mockResolvedValue({ data: null, error: { message: 'Ej inloggad', context: { json: async () => ({ error: 'Ej inloggad' }) } } })
    await expect(tolkaDocument('doc-1')).rejects.toThrow('Sessionen har gått ut. Logga in igen.')
  })

  it('användare från annat company nekas (edge: "Ingen åtkomst")', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { error: 'Ingen åtkomst' }, error: null })
    await expect(tolkaDocument('doc-foreign')).rejects.toThrow('Ingen åtkomst')
  })

  it('dokument från rätt company tolkas (resultat returneras)', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { ok: true, result: { beskrivning: 'Faktura', konteringsrader: [] } }, error: null })
    const r = await tolkaDocument('doc-own')
    expect(r.beskrivning).toBe('Faktura')
  })

  it('kvot/429: visar kvot-meddelande och gör INGET omförsök', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { error: 'Gemini-fel (429): quota' }, error: null })
    await expect(tolkaDocument('doc-1')).rejects.toThrow(/kvot är tillfälligt slut/i)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('service-lås: svensk låsorsak, INGET omförsök (Fas 2-härdning)', async () => {
    withSession()
    invoke.mockResolvedValue({ data: null, error: { message: 'edge', context: { json: async () => ({ error: 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.', code: 'service_locked' }) } } })
    await expect(tolkaDocument('doc-1')).rejects.toThrow(/Tjänsten är pausad/)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('övergående fel: gör ETT omförsök och lyckas', async () => {
    withSession()
    invoke
      .mockResolvedValueOnce({ data: null, error: { message: 'cold start', context: { json: async () => { throw new Error('no json') } } } })
      .mockResolvedValueOnce({ data: { result: { beskrivning: 'ok' } }, error: null })
    const r = await tolkaDocument('doc-1')
    expect(r.beskrivning).toBe('ok')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('loggar document_interpreted (behandlingshistorik) utan råtext/känsligt (BFL)', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { result: { leverantor: 'Acme AB', belopp_inkl_moms: 1250, moms_belopp: 250, invoice_type: 'debit', beskrivning: 'känslig råtext här', konteringsrader: [{ konto: '4000' }], ocr: '999' } }, error: null })
    await tolkaDocument('doc-1')
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('log_accounting_audit')
    expect(args.p_action).toBe('document_interpreted')
    expect(args.p_entity).toBe('document')
    expect(args.p_entity_ref).toBe('doc-1')
    expect(args.p_source).toBe('ocr')
    expect(args.p_metadata).toMatchObject({ leverantor: 'Acme AB', belopp_inkl_moms: 1250, invoice_type: 'debit' })
    expect(JSON.stringify(args.p_metadata)).not.toContain('känslig')   // ingen råtext
    expect(args.p_metadata.konteringsrader).toBeUndefined()
    expect(args.p_metadata.beskrivning).toBeUndefined()
  })

  it('audit-fel stoppar INTE tolkningen (best-effort)', async () => {
    withSession()
    invoke.mockResolvedValue({ data: { result: { beskrivning: 'ok' } }, error: null })
    rpc.mockRejectedValueOnce(new Error('audit nere'))
    const r = await tolkaDocument('doc-1')
    expect(r.beskrivning).toBe('ok')
  })
})
