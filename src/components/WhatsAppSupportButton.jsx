import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  buildWhatsAppMessage, buildWhatsAppUrl, getSupportWhatsAppNumber,
  WHATSAPP_BUTTON_LABEL, WHATSAPP_GDPR_WARNING,
} from '../lib/whatsappSupport'

// Snabb supportväg via WhatsApp (wa.me-länk). INGEN API-integration – bara en länk.
// Numret kommer från env (VITE_BOKPILOT_SUPPORT_WHATSAPP_NUMBER); saknas det döljs knappen.
// Förifyller en svensk text med företags-/användarkontext + GDPR-varning (skicka inte underlag).
export default function WhatsAppSupportButton({ company: companyProp, showHint = true, block = false, className = '' }) {
  const { company: companyCtx, user } = useAuth()
  const location = useLocation()
  const company = companyProp || companyCtx
  const number = getSupportWhatsAppNumber()
  if (!number) return null   // saknat nummer → ingen knapp

  const url = buildWhatsAppUrl(number, buildWhatsAppMessage({
    company_name: company?.name,
    org_number: company?.org_nr,
    archive_number: company?.archive_number,
    user_email: user?.email,
    current_path: location?.pathname,
    service_state: company?.service_state,
  }))

  return (
    <div className={className}>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className={`btn ${block ? 'w-full justify-center' : ''}`}
        style={{ background: '#25D366', borderColor: '#25D366', color: '#fff' }}>
        <i className="ti ti-brand-whatsapp" /> {WHATSAPP_BUTTON_LABEL}
      </a>
      {showHint && (
        <p className="text-[11px] text-gray-500 mt-2 leading-snug">
          <i className="ti ti-shield-lock mr-1 text-gray-400" />{WHATSAPP_GDPR_WARNING}
        </p>
      )}
    </div>
  )
}
