import { useState } from 'react'

// Återställningsbanner för lokalt utkast — Etapp 2A. Återställer ALDRIG automatiskt; kräver aktivt val.
const fmt = ts => { try { return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '—' } }

export default function RestoreDraftBanner({ draft, companyName, fiscalYearLabel, currentValue, onRestore, onDiscard, onKeep }) {
  const [showDiff, setShowDiff] = useState(false)
  if (!draft) return null
  const hasCurrent = String(currentValue ?? '').trim() !== ''

  return (
    <div className="rounded-lg border px-3 py-2.5 mb-2 text-[12px]" style={{ borderColor: 'rgba(245,158,11,0.45)', background: '#fffbeb' }}>
      <div className="flex items-start gap-2">
        <i className="ti ti-history text-amber-600 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-amber-800">Lokalt utkast hittat på den här enheten</div>
          <div className="text-amber-700/90 mt-0.5">
            Sparat {fmt(draft.updatedAt)}{companyName ? ` · ${companyName}` : ''}{fiscalYearLabel ? ` · ${fiscalYearLabel}` : ''}.
            Finns endast lokalt på den här enheten – inte på servern.
          </div>

          {showDiff && (
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Nuvarande i formuläret</div>
                <div className="bg-white rounded px-2 py-1 whitespace-pre-wrap text-gray-700" style={{ border: '0.5px solid rgba(0,0,0,0.1)' }}>{hasCurrent ? currentValue : <span className="text-gray-400">(tomt)</span>}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Lokalt utkast</div>
                <div className="bg-white rounded px-2 py-1 whitespace-pre-wrap text-gray-700" style={{ border: '0.5px solid rgba(0,0,0,0.1)' }}>{draft.payload}</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-2">
            <button className="btn text-xs" onClick={onRestore}><i className="ti ti-arrow-back-up" /> Återställ lokalt utkast</button>
            {hasCurrent && <button className="btn text-xs" onClick={() => setShowDiff(s => !s)}><i className="ti ti-arrows-diff" /> {showDiff ? 'Dölj skillnad' : 'Visa skillnad'}</button>}
            <button className="btn text-xs" onClick={onKeep}><i className="ti ti-check" /> Behåll nuvarande</button>
            <button className="btn text-xs" onClick={onDiscard}><i className="ti ti-trash" /> Radera lokalt utkast</button>
          </div>
        </div>
      </div>
    </div>
  )
}
