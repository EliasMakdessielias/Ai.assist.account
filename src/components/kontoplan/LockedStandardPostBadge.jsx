// Diskret markering för låsta standardkonton (systemkonton).
// Visas endast när kontot är låst – stödjer både camelCase (isLocked,
// isBlockedForManualBooking) och projektets snake_case (is_locked,
// is_blocked_for_manual_booking).

export function isAccountLocked(account) {
  return account?.isBlockedForManualBooking === true
    || account?.isLocked === true
    || account?.is_blocked_for_manual_booking === true
    || account?.is_locked === true
}

const TOOLTIP = 'Detta konto är en låst standardpost och kan inte redigeras eller raderas.'

export default function LockedStandardPostBadge({ account, className = '' }) {
  if (!isAccountLocked(account)) return null
  return (
    <span
      role="note"
      aria-label={`Ej redigerbar standardpost. ${TOOLTIP}`}
      title={TOOLTIP}
      className={`inline-flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap ${className}`}
    >
      <i className="ti ti-lock text-[11px]" aria-hidden="true" />
      <span>Ej redigerbar standardpost</span>
    </span>
  )
}
