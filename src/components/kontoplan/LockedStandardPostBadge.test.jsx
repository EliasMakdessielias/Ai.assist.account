// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import LockedStandardPostBadge, { isAccountLocked } from './LockedStandardPostBadge'
import AccountRowActions from './AccountRowActions'

afterEach(cleanup)

describe('isAccountLocked', () => {
  it('är låst vid is_locked, isLocked, is_blocked_for_manual_booking eller isBlockedForManualBooking', () => {
    expect(isAccountLocked({ is_locked: true })).toBe(true)
    expect(isAccountLocked({ isLocked: true })).toBe(true)
    expect(isAccountLocked({ is_blocked_for_manual_booking: true })).toBe(true)
    expect(isAccountLocked({ isBlockedForManualBooking: true })).toBe(true)
  })
  it('är inte låst för vanligt konto', () => {
    expect(isAccountLocked({ is_locked: false })).toBe(false)
    expect(isAccountLocked({})).toBe(false)
    expect(isAccountLocked(null)).toBe(false)
  })
})

describe('LockedStandardPostBadge', () => {
  it('visar "Ej redigerbar standardpost" för låst konto', () => {
    render(<LockedStandardPostBadge account={{ is_locked: true }} />)
    expect(screen.getByText('Ej redigerbar standardpost')).toBeTruthy()
  })
  it('visar markeringen även för camelCase isBlockedForManualBooking', () => {
    render(<LockedStandardPostBadge account={{ isBlockedForManualBooking: true }} />)
    expect(screen.getByText('Ej redigerbar standardpost')).toBeTruthy()
  })
  it('visar INGET för olåst konto', () => {
    const { container } = render(<LockedStandardPostBadge account={{ is_locked: false }} />)
    expect(container.innerHTML).toBe('')
  })
  it('har tooltip (title) och tillgänglighetslabel för screen readers', () => {
    render(<LockedStandardPostBadge account={{ is_locked: true }} />)
    const el = screen.getByLabelText(/Ej redigerbar standardpost\. Detta konto är en låst standardpost/i)
    expect(el.getAttribute('title')).toBe('Detta konto är en låst standardpost och kan inte redigeras eller raderas.')
  })
})

describe('AccountRowActions', () => {
  it('låst konto: edit/delete-knappar visas inte (ej klickbara) – markering istället', () => {
    const onEdit = vi.fn(), onDelete = vi.fn()
    render(<AccountRowActions account={{ account_nr: '1930', is_locked: true }} onEdit={onEdit} onDelete={onDelete} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Ej redigerbar standardpost')).toBeTruthy()
  })
  it('olåst konto: edit/delete-knappar finns och anropar handlers', () => {
    const onEdit = vi.fn(), onDelete = vi.fn()
    render(<AccountRowActions account={{ account_nr: '4010', is_locked: false }} onEdit={onEdit} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText('Redigera'))
    fireEvent.click(screen.getByLabelText('Radera'))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
