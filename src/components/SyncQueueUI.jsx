// Synkkö-UI (intern prototyp) — Etapp 3C. Diskreta komponenter. Visar ALDRIG "Synkad" innan servern
// returnerat succeeded/no_change. Konflikt skrivs ALDRIG över automatiskt – kräver explicit användarval.
import { QUEUE_STATUS } from '../lib/offline/syncQueue'

const LABEL = {
  pending: 'Väntar på synk', processing: 'Synkroniserar…', succeeded: 'Synkad',
  paused: 'Synk pausad', conflict: 'Konflikt kräver granskning', retry_wait: 'Försöker igen senare', rejected: 'Synk nekad',
}
const DOT = {
  pending: 'bg-amber-400', processing: 'bg-blue-500', succeeded: 'bg-green-500',
  paused: 'bg-gray-400', conflict: 'bg-red-500', retry_wait: 'bg-amber-400', rejected: 'bg-red-400',
}

// Sammanfattande, diskret köstatus (badge). Härleder den mest angelägna statusen.
export function SyncStatusIndicator({ counts, reauthNeeded }) {
  if (!counts) return null
  let key = null
  if (reauthNeeded || counts.paused > 0) key = QUEUE_STATUS.PAUSED
  else if (counts.conflict > 0) key = QUEUE_STATUS.CONFLICT
  else if (counts.processing > 0) key = QUEUE_STATUS.PROCESSING
  else if (counts.pending > 0 || counts.retry_wait > 0) key = QUEUE_STATUS.PENDING
  else if (counts.rejected > 0) key = QUEUE_STATUS.REJECTED
  if (!key) return null
  const active = counts.pending + counts.processing + counts.retry_wait
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-600" title={reauthNeeded ? 'Återautentisering krävs' : undefined}>
      <span className={`inline-block w-2 h-2 rounded-full ${DOT[key]}`} />
      {LABEL[key]}{active > 1 ? ` (${active})` : ''}
    </span>
  )
}

// Status för EN specifik check (entityId). Visar Synkad endast vid bekräftat serverresultat.
export function CheckSyncBadge({ operations, entityId }) {
  const ops = (operations || []).filter(o => o.entityId === entityId)
  if (!ops.length) return null
  const latest = ops[0]
  const key = latest.status
  if (key === QUEUE_STATUS.SUCCEEDED) return <span className="inline-flex items-center gap-1 text-[11px] text-green-600"><span className={`w-1.5 h-1.5 rounded-full ${DOT.succeeded}`} />Synkad</span>
  if (!LABEL[key]) return null
  return <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><span className={`w-1.5 h-1.5 rounded-full ${DOT[key]}`} />{LABEL[key]}</span>
}

export function RetryAction({ onRetry, label = 'Försök igen' }) {
  return <button type="button" className="text-[12px] text-blue-600 hover:underline" onClick={onRetry}><i className="ti ti-refresh" /> {label}</button>
}

// Lista över väntande/problematiska operationer (utan kommentartext).
export function PendingSyncList({ operations, onRetry, onReview, onDiscard }) {
  const visible = (operations || []).filter(o => o.status !== QUEUE_STATUS.SUCCEEDED)
  if (!visible.length) return null
  return (
    <div className="border border-gray-200 rounded-lg divide-y">
      {visible.map(o => (
        <div key={o.operationId} className="flex items-center justify-between px-3 py-2 text-[12px]">
          <span className="inline-flex items-center gap-1.5 text-gray-700">
            <span className={`w-2 h-2 rounded-full ${DOT[o.status]}`} />
            {LABEL[o.status]}{o.attemptCount > 1 ? ` · försök ${o.attemptCount}` : ''}
          </span>
          <span className="flex items-center gap-3">
            {o.status === QUEUE_STATUS.CONFLICT && <button type="button" className="text-blue-600 hover:underline" onClick={() => onReview?.(o)}>Granska konflikt</button>}
            {(o.status === QUEUE_STATUS.RETRY_WAIT || o.status === QUEUE_STATUS.PAUSED) && <RetryAction onRetry={() => onRetry?.(o.operationId)} />}
            {(o.status === QUEUE_STATUS.REJECTED || o.status === QUEUE_STATUS.CONFLICT) && <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => onDiscard?.(o.operationId)} title="Ta bort ur kön">✕</button>}
          </span>
        </div>
      ))}
    </div>
  )
}

// Konfliktgranskning. Visar lokal text + serverversionens metadata. Tre val. Ingen automatisk överskrivning.
export function ConflictReviewDialog({ operation, localText, canOverwrite, onLoadServer, onKeepSeparate, onOverwrite, onClose }) {
  if (!operation) return null
  const sv = operation.serverResult || {}
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2 text-red-600"><i className="ti ti-alert-triangle" /><h3 className="font-medium">Konflikt kräver granskning</h3></div>
        <p className="text-[13px] text-gray-600 mb-3">Servern har en nyare version av kommentaren än den du redigerat. Välj hur du vill lösa konflikten – ingenting skrivs över automatiskt.</p>
        <div className="grid grid-cols-2 gap-3 mb-3 text-[12px]">
          <div className="border rounded-lg p-2">
            <div className="text-gray-500 mb-1">Din text (lokalt)</div>
            <div className="whitespace-pre-wrap break-words text-gray-800">{localText || <span className="text-gray-400">(tom)</span>}</div>
          </div>
          <div className="border rounded-lg p-2">
            <div className="text-gray-500 mb-1">Serverversion</div>
            <div className="text-gray-700">
              {sv.hasServerComment ? 'Servern har en sparad kommentar.' : 'Servern saknar kommentar.'}
              <div className="mt-1 text-[11px] text-gray-500">
                Revision: {sv.serverCommentRevision ?? '—'}<br />
                {sv.changedAt && <>Ändrad: {new Date(sv.changedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}<br /></>}
                {sv.changedBy && <>Av: {String(sv.changedBy).slice(0, 8)}…</>}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button className="btn text-sm" onClick={onLoadServer}><i className="ti ti-download" /> Läs in serverversion</button>
          <button className="btn text-sm" onClick={onKeepSeparate}><i className="ti ti-copy" /> Behåll min text som separat lokalt utkast</button>
          {canOverwrite && <button className="btn btn-primary text-sm" onClick={onOverwrite}><i className="ti ti-arrow-up" /> Skriv över med bekräftelse (admin)</button>}
        </div>
        <div className="text-right mt-3"><button className="text-[12px] text-gray-500 hover:underline" onClick={onClose}>Stäng</button></div>
      </div>
    </div>
  )
}
