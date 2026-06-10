// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WhatsAppSupportButton from './WhatsAppSupportButton'

// Stabil auth-kontext (företag + användare).
vi.mock('../hooks/useAuth', () => {
  const auth = { company: { name: 'Acme AB', org_nr: '556677-8899', archive_number: 'A123', service_state: 'active' }, user: { email: 'ulla@acme.se' } }
  return { useAuth: () => auth }
})

const NUM_KEY = 'VITE_BOKPILOT_SUPPORT_WHATSAPP_NUMBER'
const renderAt = (path = '/support', props = {}) =>
  render(<MemoryRouter initialEntries={[path]}><WhatsAppSupportButton {...props} /></MemoryRouter>)

beforeEach(() => { cleanup() })
afterEach(() => { vi.unstubAllEnvs() })

describe('WhatsAppSupportButton', () => {
  it('renderar knapp + korrekt wa.me-länk när numret finns', () => {
    vi.stubEnv(NUM_KEY, '+46 70 123 45 67')
    renderAt('/support')
    const link = screen.getByRole('link', { name: /Kontakta support via WhatsApp/ })
    const href = link.getAttribute('href')
    expect(href.startsWith('https://wa.me/46701234567?text=')).toBe(true)
    const msg = decodeURIComponent(href.split('?text=')[1])
    expect(msg).toContain('Företag: Acme AB')
    expect(msg).toContain('Användare: ulla@acme.se')
    expect(msg).toContain('Sida: /support')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('visar GDPR-varningen', () => {
    vi.stubEnv(NUM_KEY, '46701234567')
    renderAt('/support')
    expect(screen.getByText(/Skicka inte bokföringsunderlag eller känsliga dokument via WhatsApp/)).toBeTruthy()
  })

  it('döljer knappen helt när numret saknas', () => {
    vi.stubEnv(NUM_KEY, '')
    const { container } = renderAt('/support')
    expect(container.querySelector('a')).toBeNull()
    expect(screen.queryByText(/WhatsApp/)).toBeNull()
  })

  it('låsvy: pausat företag ger knapp med Status i texten', () => {
    vi.stubEnv(NUM_KEY, '46701234567')
    renderAt('/', { company: { name: 'Acme AB', service_state: 'paused' } })
    const link = screen.getByRole('link', { name: /Kontakta support via WhatsApp/ })
    const msg = decodeURIComponent(link.getAttribute('href').split('?text=')[1])
    expect(msg).toContain('Status: paused')
  })

  it('kan dölja hjälptexten med showHint=false', () => {
    vi.stubEnv(NUM_KEY, '46701234567')
    renderAt('/support', { showHint: false })
    expect(screen.queryByText(/Skicka inte bokföringsunderlag/)).toBeNull()
    expect(screen.getByRole('link', { name: /Kontakta support via WhatsApp/ })).toBeTruthy()
  })
})
