import { useState } from 'react'

// Återanvändbar bekräftelsedialog. Stödjer stark bekräftelse via inskrivning
// (confirmText) – används för destruktiva åtgärder som Ersätt/Töm/Återställ.
export default function ConfirmDialog({
  open, title, children, confirmLabel = 'Bekräfta', cancelLabel = 'Avbryt',
  danger = false, confirmText = null, busy = false, onConfirm, onCancel,
}) {
  const [typed, setTyped] = useState('')
  if (!open) return null
  const locked = confirmText && typed.trim() !== confirmText.trim()

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => !busy && onCancel?.()}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <i className={`ti ${danger ? 'ti-alert-triangle text-red-600' : 'ti-help-circle text-blue-600'}`} />
          <span className="text-base font-medium">{title}</span>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700 space-y-3">
          {children}
          {confirmText && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Skriv <b>{confirmText}</b> för att bekräfta
              </label>
              <input className="input" value={typed} onChange={e => setTyped(e.target.value)} disabled={busy} autoFocus />
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <button className="btn" onClick={() => onCancel?.()} disabled={busy}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onConfirm?.()} disabled={busy || locked}>
            {busy ? 'Arbetar…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
