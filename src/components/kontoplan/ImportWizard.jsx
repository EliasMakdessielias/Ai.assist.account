import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseAccountsFile, parseRows, validateAccounts, planImport } from '../../lib/kontoplan'
import ConfirmDialog from './ConfirmDialog'
import toast from 'react-hot-toast'

const MODES = [
  { key: 'add', titel: 'Lägg till nya', text: 'Importera endast konton som inte redan finns. Befintliga lämnas orörda.', ikon: 'ti-plus' },
  { key: 'update', titel: 'Uppdatera befintliga', text: 'Uppdatera konton som matchar på kontonummer. Nya konton i filen hoppas över.', ikon: 'ti-refresh' },
  { key: 'replace', titel: 'Ersätt hela kontoplanen', text: 'Importera filen och ta bort konton som saknas. Använda konton inaktiveras istället för att raderas.', ikon: 'ti-trash', danger: true },
]

// companyId, existingNrs (string[]), onDone(), onClose()
export default function ImportWizard({ open, companyId, existingNrs = [], onDone, onClose }) {
  const fileRef = useRef()
  const [filename, setFilename] = useState('')
  const [parsed, setParsed] = useState(null)       // { accounts, header }
  const [validation, setValidation] = useState(null)
  const [mode, setMode] = useState('add')
  const [busy, setBusy] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)

  if (!open) return null

  function reset() { setFilename(''); setParsed(null); setValidation(null); setMode('add') }
  function close() { if (!busy) { reset(); onClose?.() } }

  function handleParsed(res) {
    if (!res.ok) { toast.error(res.error); setParsed(null); return }
    setParsed(res)
    setValidation(validateAccounts(res.accounts))
  }

  function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setFilename(f.name)
    const rd = new FileReader()
    rd.onerror = () => toast.error('Kunde inte läsa filen')
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      rd.onload = async () => {
        try {
          const XLSX = await import('xlsx')   // laddas dynamiskt först vid behov
          const wb = XLSX.read(rd.result, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
          const header = (grid[0] || []).map(h => String(h))
          handleParsed(parseRows(header, grid.slice(1)))
        } catch { toast.error('Kunde inte tolka Excel-filen'); setParsed(null) }
      }
      rd.readAsArrayBuffer(f)
    } else {
      rd.onload = () => handleParsed(parseAccountsFile(String(rd.result)))
      rd.readAsText(f, 'utf-8')
    }
  }

  const plan = parsed ? planImport(parsed.accounts, existingNrs, mode) : null

  async function runImport() {
    if (!parsed) return
    setBusy(true)
    try {
      const rows = parsed.accounts.map(a => ({
        account_nr: a.account_nr, name: a.name, is_active: a.is_active, vat_code: a.vat_code, sru: a.sru,
        is_blocked_for_manual_booking: a.is_blocked_for_manual_booking,
      }))
      const { data, error } = await supabase.rpc('import_chart_of_accounts', {
        p_company: companyId, p_mode: mode, p_filename: filename, p_rows: rows,
      })
      if (error) throw error
      const d = data || {}
      toast.success(`Import klar: ${d.inserted || 0} nya, ${d.updated || 0} uppdaterade${d.new_locked ? `, ${d.new_locked} låsta` : ''}${d.ignored_locked ? `, ${d.ignored_locked} låsta bevarade` : ''}${d.deactivated ? `, ${d.deactivated} inaktiverade` : ''}${d.deleted ? `, ${d.deleted} raderade` : ''}`)
      setConfirmReplace(false); reset(); onDone?.()
    } catch (e) {
      toast.error('Import misslyckades: ' + (e.message || e))
    }
    setBusy(false)
  }

  function onPrimary() {
    if (!validation?.valid) return toast.error('Åtgärda valideringsfelen först')
    if (mode === 'replace') setConfirmReplace(true)
    else runImport()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-base font-medium"><i className="ti ti-upload mr-2" />Ladda upp ny kontoplan</span>
          <button className="text-gray-400 hover:text-gray-700" onClick={close}><i className="ti ti-x" /></button>
        </div>

        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />

        {!parsed ? (
          <div className="px-5 py-8 text-center">
            <button className="rounded-xl border-2 border-dashed w-full py-10 hover:border-blue-400 transition-colors"
              style={{ borderColor: 'rgba(0,0,0,0.15)' }} onClick={() => fileRef.current?.click()}>
              <i className="ti ti-file-upload text-4xl text-blue-600 block mb-2" />
              <div className="font-medium text-sm">Välj en kontoplanfil (CSV eller Excel)</div>
              <div className="text-xs text-gray-500 mt-1">Stöder Fortnox-export (.csv/.xlsx) och projektets egna CSV-format</div>
            </button>
            <div className="text-xs text-gray-400 mt-3">Filen måste minst innehålla kolumner för kontonummer och benämning.</div>
          </div>
        ) : (
          <div className="px-5 py-5 space-y-5">
            <div className="text-sm flex items-center gap-2">
              <i className="ti ti-file-text text-gray-400" />
              <span className="font-medium">{filename}</span>
              <span className="text-gray-400">· {parsed.accounts.length} rader</span>
              <button className="btn text-xs py-0.5 px-2 ml-auto" onClick={reset}>Byt fil</button>
            </div>

            {/* Valideringsfel */}
            {validation && !validation.valid && (
              <div className="rounded-lg border p-3 bg-red-50" style={{ borderColor: 'rgba(220,38,38,0.3)' }}>
                <div className="text-sm font-medium text-red-700 mb-1"><i className="ti ti-alert-circle mr-1" />{validation.errors.length} valideringsfel</div>
                <ul className="text-xs text-red-700 max-h-32 overflow-auto list-disc pl-5">
                  {validation.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>{e.line ? `Rad ${e.line}: ` : ''}{e.account_nr ? `konto ${e.account_nr} – ` : ''}{e.message}</li>
                  ))}
                  {validation.errors.length > 50 && <li>…och {validation.errors.length - 50} till</li>}
                </ul>
              </div>
            )}

            {/* Dubblettvarning */}
            {validation?.duplicatesInFile.length > 0 && (
              <div className="rounded-lg border p-3 bg-amber-50 text-xs text-amber-800" style={{ borderColor: 'rgba(217,119,6,0.3)' }}>
                <i className="ti ti-alert-triangle mr-1" />Dubbletter i filen: {validation.duplicatesInFile.join(', ')}
              </div>
            )}

            {/* Läge-väljare */}
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Importläge</div>
              <div className="grid gap-2">
                {MODES.map(m => (
                  <button key={m.key} onClick={() => setMode(m.key)}
                    className={`text-left rounded-lg border p-3 flex items-start gap-3 transition-colors ${mode === m.key ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
                    style={mode === m.key ? {} : { borderColor: 'rgba(0,0,0,0.12)' }}>
                    <i className={`ti ${m.ikon} mt-0.5 ${m.danger ? 'text-red-600' : 'text-blue-600'}`} />
                    <div>
                      <div className="text-sm font-medium">{m.titel}</div>
                      <div className="text-xs text-gray-500">{m.text}</div>
                    </div>
                    {mode === m.key && <i className="ti ti-check text-blue-600 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Förhandsgranskning */}
            {plan && (
              <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <div className="grid grid-cols-3 gap-y-3 gap-x-2 text-center">
                  <div><div className="text-lg font-semibold text-green-700">{plan.inserted}</div><div className="text-[11px] text-gray-500">Nya</div></div>
                  <div><div className="text-lg font-semibold text-blue-700">{plan.updated}</div><div className="text-[11px] text-gray-500">Uppdateras</div></div>
                  <div><div className="text-lg font-semibold text-purple-700">{plan.newLocked}</div><div className="text-[11px] text-gray-500">Nya låsta</div></div>
                  <div><div className="text-lg font-semibold text-amber-600">{plan.ignoredLocked}</div><div className="text-[11px] text-gray-500">Ignorerade (låsta)</div></div>
                  <div><div className="text-lg font-semibold text-gray-500">{plan.skipped}</div><div className="text-[11px] text-gray-500">Hoppas över</div></div>
                  <div><div className="text-lg font-semibold text-gray-500">{validation?.duplicatesInFile.length || 0}</div><div className="text-[11px] text-gray-500">Dubbletter</div></div>
                </div>
                {plan.ignoredLocked > 0 && (
                  <div className="text-xs text-amber-700 border-t pt-2 mt-3" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    <i className="ti ti-lock mr-1" />{plan.ignoredLocked} låsta systemkonton bevaras oförändrade och påverkas inte av importen.
                  </div>
                )}
                {mode === 'replace' && (
                  <div className="text-xs text-amber-700 border-t pt-2 mt-2" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    <i className="ti ti-info-circle mr-1" />{plan.missingCount} olåsta konton saknas i filen och tas bort (använda inaktiveras). {plan.preservedLocked} låsta konton skyddas.
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2.5">
              <button className="btn" onClick={close} disabled={busy}>Avbryt</button>
              <button className={`btn ${mode === 'replace' ? 'btn-danger' : 'btn-green'}`} onClick={onPrimary} disabled={busy || !validation?.valid}>
                {busy ? 'Importerar…' : mode === 'replace' ? 'Ersätt kontoplan' : 'Importera'}
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmReplace} danger title="Ersätt hela kontoplanen?"
        confirmLabel="Ja, ersätt" busy={busy} confirmText="ERSÄTT"
        onCancel={() => !busy && setConfirmReplace(false)} onConfirm={runImport}>
        <p>Den nuvarande kontoplanen kommer att <b>ersättas</b> med filen <b>{filename}</b>.</p>
        <p>Konton som saknas i filen tas bort. Konton som används i bokförda verifikationer raderas <b>inte</b> – de inaktiveras automatiskt för att bevara revisionsspåret.</p>
        {plan && <p className="text-xs text-gray-500">{plan.inserted} nya, {plan.updated} uppdateras, {plan.missingCount} tas bort/inaktiveras.</p>}
      </ConfirmDialog>
    </div>
  )
}
