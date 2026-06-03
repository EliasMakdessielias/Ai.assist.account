import LockedStandardPostBadge, { isAccountLocked } from './LockedStandardPostBadge'

// Åtgärdscell i kontoplanstabellen. Låsta konton visar markeringen
// "Ej redigerbar standardpost" i stället för edit/delete-knappar – så att
// redigering/radering varken är klickbar eller öppnar någon modal.
export default function AccountRowActions({ account, onEdit, onDelete }) {
  if (isAccountLocked(account)) {
    return <LockedStandardPostBadge account={account} />
  }
  return (
    <span className="inline-flex">
      <button aria-label="Redigera" title="Redigera" className="text-gray-400 hover:text-blue-600 px-1"
        onClick={() => onEdit?.(account)}><i className="ti ti-pencil" /></button>
      <button aria-label="Radera" title="Radera" className="text-gray-400 hover:text-red-600 px-1"
        onClick={() => onDelete?.(account)}><i className="ti ti-trash" /></button>
    </span>
  )
}
