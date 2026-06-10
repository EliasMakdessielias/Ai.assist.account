// Gemensam server-side service-state-guard för edge functions / workers (Fas 2-härdning).
// Service_role bypassar RLS och write-lock-triggern (auth.uid() IS NULL), DÄRFÖR måste
// bakgrundsflödena själva respektera companies.service_state. Inga dolda undantag.
//
// active                → tillåt affärsmutation (skapa document, OCR, tolkning)
// paused / blocked      → neka kontrollerat med ren svensk orsak
//
// Återanvänds av inbound-email, tolka-underlag och ocr-folio. IMAP-importern hanterar
// det kontrollerade webhook-svaret (se scripts/imap-import/parse.mjs classifyWebhookOutcome).

export const SERVICE_PAUSED_MESSAGE = 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.'
export const LOCK_STATES = ['paused', 'blocked']

export function isServiceLocked(state?: string | null): boolean {
  return !!state && LOCK_STATES.includes(state)
}

// Läser service_state via service-role-klienten. Default 'active' om company_id saknas.
// Kastar vid GENUINT DB-fel (tekniskt fel) så anroparen kan rapportera system_error –
// service-lock ska ALDRIG förväxlas med ett tekniskt fel.
export async function getCompanyServiceState(admin: any, companyId: string | null): Promise<string> {
  if (!companyId) return 'active'
  const { data, error } = await admin.from('companies').select('service_state').eq('id', companyId).maybeSingle()
  if (error) throw new Error('service_state_read_failed: ' + (error.message || 'okänt fel'))
  return (data?.service_state as string) || 'active'
}

// { ok, state }. ok=false ⇒ paused/blocked → neka affärsmutation kontrollerat.
export async function assertCompanyAcceptsUnderlag(admin: any, companyId: string | null): Promise<{ ok: boolean; state: string }> {
  const state = await getCompanyServiceState(admin, companyId)
  return { ok: !isServiceLocked(state), state }
}
