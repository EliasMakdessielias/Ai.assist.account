// Diskret lokal autosave-indikator — Etapp 2A. Endast lokal status; ordet "synkad" används aldrig.
const fmtTime = ts => { try { return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function AutosaveIndicator({ status, lastSavedAt, storageError }) {
  if (storageError || status === 'error') {
    return <span className="text-[11px] text-red-600"><i className="ti ti-alert-triangle mr-0.5" />Lokal lagring misslyckades</span>
  }
  if (status === 'saving') {
    return <span className="text-[11px] text-gray-400"><i className="ti ti-loader-2 animate-spin mr-0.5" />Sparar lokalt…</span>
  }
  if (status === 'saved') {
    return (
      <span className="text-[11px] text-gray-500" title="Endast på den här enheten. Inte sparat på servern.">
        <i className="ti ti-device-floppy mr-0.5" />Sparat lokalt på den här enheten{lastSavedAt ? ` · ${fmtTime(lastSavedAt)}` : ''}
        <span className="text-amber-600 ml-1">· Ännu inte sparad på servern</span>
      </span>
    )
  }
  return null
}
