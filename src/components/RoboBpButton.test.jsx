// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import RoboBpButton from './RoboBpButton'

const robo = { licensed: true, openWith: vi.fn() }
vi.mock('../context/RoboBpContext', () => ({ useRoboBp: () => robo }))

beforeEach(() => { cleanup(); robo.licensed = true; robo.openWith = vi.fn() })
afterEach(() => cleanup())

describe('RoboBpButton – skickar rätt kontext (point 15)', () => {
  it.each([['bokforing'], ['leverantorsfakturor'], ['manadskontroll']])(
    'öppnar med korrekt vy-kontext från %s', view => {
      render(<RoboBpButton view={view} />)
      fireEvent.click(screen.getByRole('button', { name: /Fråga ROBO-bp/ }))
      expect(robo.openWith).toHaveBeenCalledWith({ view, selection: null })
    })

  it('skickar med vald referens (selection) om sådan finns', () => {
    render(<RoboBpButton view="bokforing" selection={{ type: 'verification', id: 'V1' }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(robo.openWith).toHaveBeenCalledWith({ view: 'bokforing', selection: { type: 'verification', id: 'V1' } })
  })

  it('renderas INTE utan ROBO-bp-licens', () => {
    robo.licensed = false
    const { container } = render(<RoboBpButton view="bokforing" />)
    expect(container.querySelector('button')).toBeNull()
  })
})
