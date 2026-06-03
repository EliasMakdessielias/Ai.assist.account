import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import ConfirmDialog from '../components/kontoplan/ConfirmDialog'
import { PURGE_CONFIRM_PHRASE, summarizePurge } from '../lib/purgeTestData'
import toast from 'react-hot-toast'

export default function Admin() {
  const { isAdmin, user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState(null)   // företag att tömma
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeSummary, setPurgeSummary] = useState(null)

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  async function runPurge() {
    if (!purgeTarget) return
    setPurgeBusy(true)
    try {
      const { data, error } = await supabase.rpc('purge_test_data', { p_company: purgeTarget.id })
      if (error) throw error
      setPurgeSummary({ company: purgeTarget, ...summarizePurge(data) })
      setPurgeTarget(null)
      toast.success('Testdata tömd')
      await load()
    } catch (e) { toast.error(e.message) }
    setPurgeBusy(false)
  }

  async function call(body) {
    const { data: res, error: err } = await supabase.functions.invoke('admin', { body })
    if (err) {
      let msg = err.message
      try { const b = await err.context.json(); if (b?.error) msg = b.error } catch { /* ignore */ }
      throw new Error(msg)
    }
    if (res?.error) throw new Error(res.error)
    return res
  }

  async function load() {
    setLoading(true); setError(null)
    try { setData(await call({ action: 'list' })) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function setActive(u, active) {
    setBusy(true)
    try { await call({ action: active ? 'activate' : 'deactivate', user_id: u.id }); toast.success(active ? 'Aktiverat' : 'Avstängt'); await load() }
    catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  async function deleteUser(u) {
    if (!confirm(`Radera kontot ${u.email}? Användaren och dess företag/data raderas permanent.`)) return
    setBusy(true)
    try { await call({ action: 'delete_user', user_id: u.id }); toast.success('Konto raderat'); await load() }
    catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  if (!isAdmin) return <div className="p-12 text-center text-gray-400">Ingen åtkomst.</div>

  // Aktivt = har ett ej-pausat företag, ELLER (inget företag men förgodkänt konto).
  const isActive = r => r.company ? !r.company.suspended : !!r.u.approved

  // Bygg en kontocentrerad lista.
  const rows = (data?.users || []).map(u => {
    const member = (data.members || []).find(m => m.user_id === u.id)
    const company = member ? (data.companies || []).find(c => c.id === member.company_id) : null
    return { u, company, ver: company ? (data.verCounts?.[company.id] || 0) : 0 }
  }).sort((a, b) => (isActive(a) ? 1 : 0) - (isActive(b) ? 1 : 0))

  const pending = rows.filter(r => !isActive(r)).length
  const visible = rows.filter(r => !search ||
    (r.u.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.company?.name || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-shield-lock text-purple-600" /> Superadmin</span>
        <span className="text-sm text-gray-500">
          {pending > 0 && <span className="text-amber-700 font-medium mr-3">{pending} väntar på aktivering</span>}
          {rows.length} konton
        </span>
      </div>

      <div className="p-7">
        <div className="mb-4 relative max-w-sm">
          <input className="input pl-8" placeholder="Sök e-post eller företag" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            Kunde inte ladda admin-data: {error}
            <div className="text-xs text-red-500 mt-1">Är server-funktionen "admin" deployad?</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>E-post</th>
                  <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Företag</th>
                  <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Registrerad</th>
                  <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bekräftad</th>
                  <th className="text-left px-4 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                  <th className="px-4 py-2.5 border-b w-52" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="6" className="text-center py-12 text-gray-400">Laddar…</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan="6" className="text-center py-12 text-gray-400">Inga konton.</td></tr>
                ) : visible.map(r => {
                  const { u, company } = r
                  const active = isActive(r)
                  return (
                    <tr key={u.id} className={!active ? 'bg-amber-50/40' : ''}>
                      <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        {u.email}{u.id === user.id && <span className="text-xs text-gray-400"> · du</span>}
                      </td>
                      <td className="px-4 py-2.5 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{company?.name || <span className="text-gray-400">– (ej inloggad än)</span>}</td>
                      <td className="px-4 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{u.created_at?.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{u.confirmed ? <i className="ti ti-check text-green-600" /> : <span className="text-amber-600 text-xs">väntar</span>}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        {active
                          ? <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'rgba(52,211,153,0.15)', color: '#1a7a2e' }}>{company ? 'Aktivt' : 'Förgodkänd'}</span>
                          : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">{company ? 'Ej aktivt' : 'Väntar'}</span>}
                      </td>
                      <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                        {company && <button className="btn text-xs py-1 px-2 mr-1.5" disabled={busy} title="Töm testdata för detta företag" onClick={() => setPurgeTarget(company)}><i className="ti ti-eraser" /> Töm testdata</button>}
                        {u.id !== user.id && (active
                          ? <button className="btn btn-danger text-xs py-1 px-3 mr-1.5" disabled={busy} onClick={() => setActive(u, false)}>Stäng av</button>
                          : <button className="btn btn-green text-xs py-1 px-3 mr-1.5" disabled={busy} onClick={() => setActive(u, true)}>Aktivera</button>)}
                        {u.id !== user.id && <button className="text-gray-300 hover:text-red-600 align-middle" title="Radera konto" disabled={busy} onClick={() => deleteUser(u)}><i className="ti ti-trash" /></button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-gray-400 mt-4">
          Du ser alla registrerade konton. <b>Aktivera</b> släpper in nya företag, <b>Stäng av</b> blockerar dem (på databasnivå), och <b>papperskorgen</b> raderar kontot + dess data permanent.
          <br /><b>Töm testdata</b> rensar all affärsdata för ett företag men behåller användare, behörigheter, inställningar och låsta systemkonton.
        </div>
      </div>

      {/* Bekräftelse: kräver exakt "RADERA TESTDATA" */}
      <ConfirmDialog open={!!purgeTarget} danger title="Töm testdata"
        confirmLabel="Töm testdata permanent" confirmText={PURGE_CONFIRM_PHRASE} busy={purgeBusy}
        onCancel={() => !purgeBusy && setPurgeTarget(null)} onConfirm={runPurge}>
        <p>Detta kommer att radera <b>all testdata permanent</b> för <b>{purgeTarget?.name}</b>. Åtgärden kan inte ångras.</p>
        <p className="text-xs text-gray-500">Raderas: kund-/leverantörsfakturor, verifikationer, banktransaktioner, filer & underlag, importhistorik, produkter, kunder, leverantörer och olåsta konton.</p>
        <p className="text-xs text-gray-500">Bevaras: användare, behörigheter, företagsinställningar och <b>låsta systemkonton</b>.</p>
      </ConfirmDialog>

      {/* Sammanfattning efter tömning */}
      {purgeSummary && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPurgeSummary(null)}>
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium"><i className="ti ti-circle-check text-green-600 mr-2" />Testdata tömd – {purgeSummary.company.name}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setPurgeSummary(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4">
              <table className="w-full text-sm">
                <tbody>
                  {purgeSummary.deleted.map(r => (
                    <tr key={r.key}>
                      <td className="py-1 text-gray-600">{r.label}</td>
                      <td className="py-1 text-right font-medium">{r.count.toLocaleString('sv-SE')}</td>
                    </tr>
                  ))}
                  <tr className="border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                    <td className="py-1.5 font-semibold">Totalt raderade poster</td>
                    <td className="py-1.5 text-right font-semibold">{purgeSummary.totalDeleted.toLocaleString('sv-SE')}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-gray-600"><i className="ti ti-lock text-gray-400 mr-1" />Bevarade låsta systemkonton</td>
                    <td className="py-1 text-right font-medium text-purple-700">{purgeSummary.preservedLockedAccounts.toLocaleString('sv-SE')}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-3">Användare, behörigheter och företagsinställningar bevarades.</p>
            </div>
            <div className="px-5 py-4 border-t flex justify-end" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn btn-primary" onClick={() => setPurgeSummary(null)}>Klart</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
