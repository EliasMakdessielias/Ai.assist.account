// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import Dagskassa from './Dagskassa'
import Kvitto from './Kvitto'

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ company: { id: 'c1' }, user: { id: 'u1' } }) }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../lib/serier', () => ({ serie: () => 'K' }))

// Chainable supabase-mock som loggar alla anrop. await på query-objektet ger {error:null};
// .single() ger den skapade verifikationen.
const h = vi.hoisted(() => ({ log: [] }))
vi.mock('../lib/supabase', () => {
  const make = table => {
    const q = {
      insert: arg => { h.log.push({ table, op: 'insert', arg }); return q },
      update: arg => { h.log.push({ table, op: 'update', arg }); return q },
      select: () => q,
      eq: (col, val) => { h.log.push({ table, op: 'eq', col, val }); return q },
      in: () => q,
      single: async () => ({ data: { id: 'ver1', ver_nr: 'K1' }, error: null }),
      then: resolve => resolve({ error: null }),
    }
    return q
  }
  return { supabase: { from: table => make(table), rpc: async () => ({ data: 'K1', error: null }) } }
})

beforeEach(() => { cleanup(); h.log = []; vi.clearAllMocks() })
const setVal = (container, id, v) => fireEvent.change(container.querySelector('#' + id), { target: { value: v } })

describe('Registrera dagskassa – kopplar underlag till verifikation (krav 18/20/29)', () => {
  it('uppdaterar document.verifikation_id scopat på company_id och kallar onUnderlagLinked', async () => {
    const onLinked = vi.fn()
    const { container } = render(<Dagskassa underlagDoc={{ id: 'doc1' }} onUnderlagLinked={onLinked} />)
    setVal(container, 'ds-vg25', '100')   // exkl. moms 25% → netto 100, moms 25, totalt 125
    setVal(container, 'ds-kontant', '125')
    fireEvent.click(container.querySelector('#ds-bokfor'))

    await waitFor(() => expect(onLinked).toHaveBeenCalled())
    const upd = h.log.find(c => c.table === 'documents' && c.op === 'update')
    expect(upd.arg.verifikation_id).toBe('ver1')
    expect(upd.arg.kategori).toBe('dokument')
    // Tenant isolation: uppdateringen filtreras på company_id.
    expect(h.log.some(c => c.table === 'documents' && c.op === 'eq' && c.col === 'company_id' && c.val === 'c1')).toBe(true)
  })

  it('utan valt underlag görs ingen document-uppdatering', async () => {
    const { container } = render(<Dagskassa underlagDoc={null} onUnderlagLinked={vi.fn()} />)
    setVal(container, 'ds-vg25', '100')
    setVal(container, 'ds-kontant', '125')
    fireEvent.click(container.querySelector('#ds-bokfor'))
    await waitFor(() => expect(h.log.some(c => c.table === 'verifikationer')).toBe(true))
    expect(h.log.some(c => c.table === 'documents')).toBe(false)
  })
})

describe('Registrera kvitto – kopplar underlag med kategori "kvitto" (krav 18/19/29)', () => {
  it('uppdaterar document.verifikation_id + kategori kvitto, scopat på company_id', async () => {
    const onLinked = vi.fn()
    const { container } = render(<Kvitto underlagDoc={{ id: 'doc1' }} onUnderlagLinked={onLinked} />)
    setVal(container, 'kv-c0', '100')      // första kostnadsraden inkl. moms
    setVal(container, 'kv-kontant', '100')
    fireEvent.click(container.querySelector('#kv-bokfor'))

    await waitFor(() => expect(onLinked).toHaveBeenCalled())
    const upd = h.log.find(c => c.table === 'documents' && c.op === 'update')
    expect(upd.arg.verifikation_id).toBe('ver1')
    expect(upd.arg.kategori).toBe('kvitto')
    expect(h.log.some(c => c.table === 'documents' && c.op === 'eq' && c.col === 'company_id' && c.val === 'c1')).toBe(true)
  })
})
