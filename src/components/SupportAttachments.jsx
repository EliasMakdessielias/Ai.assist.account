import { useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { validateFiles, formatBytes, ACCEPT_ATTR, MAX_FILES_PER_MESSAGE, downloadSupportAttachment } from '../lib/supportAttachments'

// Filväljare + chips för valda filer (innan skick). Validerar filtyp/storlek/antal i frontend.
// compact=true → enbart gem-ikon (för täta inmatningsrader), utan etikett/chips.
export function AttachmentPicker({ files, onChange, disabled, compact }) {
  const ref = useRef(null)
  function add(e) {
    const picked = [...e.target.files]
    const next = [...files, ...picked].slice(0, MAX_FILES_PER_MESSAGE)
    const err = validateFiles(next)
    e.target.value = ''
    if (err) return toast.error(err)
    onChange(next)
  }
  if (compact) {
    return (
      <>
        <button type="button" className="text-gray-400 hover:text-gray-700 p-1.5" title="Bifoga fil" disabled={disabled} onClick={() => ref.current?.click()}><i className="ti ti-paperclip text-lg" /></button>
        <input ref={ref} type="file" multiple hidden accept={ACCEPT_ATTR} onChange={add} />
      </>
    )
  }
  return (
    <div>
      <button type="button" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1" disabled={disabled} onClick={() => ref.current?.click()}>
        <i className="ti ti-paperclip" /> Bifoga fil
      </button>
      <input ref={ref} type="file" multiple hidden accept={ACCEPT_ATTR} onChange={add} />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-gray-100 rounded px-2 py-0.5 text-[11px] text-gray-700">
              <i className="ti ti-file" />{f.name} <span className="text-gray-400">({formatBytes(f.size)})</span>
              <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => onChange(files.filter((_, x) => x !== i))}><i className="ti ti-x" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Visa uppladdade bilagor i tråden – klick öppnar via signerad URL.
export function AttachmentList({ items, onTone = 'light' }) {
  if (!items?.length) return null
  async function open(att) {
    try { await downloadSupportAttachment(supabase, att) }
    catch { toast.error('Kunde inte öppna bilagan') }
  }
  const cls = onTone === 'dark' ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {items.map(a => (
        <button key={a.id} type="button" onClick={() => open(a)} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${cls}`} title={`${a.file_name} (${formatBytes(a.file_size)})`}>
          <i className="ti ti-paperclip" /><span className="max-w-[160px] truncate">{a.file_name}</span>
        </button>
      ))}
    </div>
  )
}
