import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import ConfirmDialog from '../components/kontoplan/ConfirmDialog'
import { PURGE_CONFIRM_PHRASE, summarizePurge } from '../lib/purgeTestData'
import { ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_DESC } from '../lib/platformRoles'
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
  const [roles, setRoles] = useState(null)
  const [grant, setGrant] = useState({ email: '', role: 'operations_admin' })

  useEffect(() => { if (isAdmin) { load(); loadRoles() } }, [isAdmin])

  async function loadRoles() {
    const { data } = await supabase.rpc('admin_list_platform_roles')
    setRoles(data || [])
  }
  async function grantRole() {
    if (!grant.email.trim()) return toast.error('Ange e-post')
    const { error } = await supabase.rpc('admin_grant_platform_role', { p_email: grant.email.trim(), p_role: grant.role })
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte tilldela roll')
    toast.success(`${ROLE_LABELS[grant.role]} tilldelad ${grant.email.trim()}`)
    setGrant(g => ({ ...g, email: '' })); loadRoles()
  }
  async function revokeRole(email, role) {
    const { error } = await supabase.rpc('admin_revoke_platform_role', { p_email: email, p_role: role })
    if (error) return toast.error(error.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ta bort roll')
    toast.success('Roll borttagen'); loadRoles()
  }

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
        {/* Plattformsroller */}
        <div className="bg-white rounded-xl p-5 mb-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><i className="ti ti-users-group text-purple-600" /> Plattformsroller</h2>
          <p className="text-xs text-gray-500 mb-3">Delegera drift/support/billing utan full superadmin. Superadmin hanteras separat. Alla ändringar loggas.</p>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">E-post</label>
              <input className="input text-sm" placeholder="person@bokpilot.se" value={grant.email} onChange={e => setGrant(g => ({ ...g, email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Roll</label>
              <select className="input text-sm" value={grant.role} onChange={e => setGrant(g => ({ ...g, role: e.target.value }))}>
                {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <button className="btn btn-primary text-sm py-2" onClick={grantRole}><i className="ti ti-plus" /> Tilldela</button>
          </div>
          <p className="text-[11px] text-gray-400 mb-3">{ROLE_DESC[grant.role]}</p>
          {roles === null ? <div className="text-xs text-gray-400">Laddar roller…</div>
            : roles.length === 0 ? <div className="text-xs text-gray-400">Inga tilldelade roller (utöver superadmin).</div>
            : (
              <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                {roles.map(r => (
                  <div key={`${r.email}:${r.role}`} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                    <span><span className="font-medium">{r.email}</span> <span className="text-gray-400">·</span> <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-xs">{ROLE_LABELS[r.role] || r.role}</span></span>
                    <button className="text-gray-300 hover:text-red-600" title="Ta bort roll" onClick={() => revokeRole(r.email, r.role)}><i className="ti ti-trash" /></button>
                  </div>
                ))}
              </div>
            )}
        </div>

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
          <br /><b>Töm testdata</b> rensar affärsdata (fakturor, verifikationer, dokument m.m.) för ett företag men behåller <b>hela kontoplanen</b>, användare, behörigheter och inställningar.
        </div>
      </div>

      {/* Bekräftelse: kräver exakt "RADERA TESTDATA" */}
      <ConfirmDialog open={!!purgeTarget} danger title="Töm testdata"
        confirmLabel="Töm testdata permanent" confirmText={PURGE_CONFIRM_PHRASE} busy={purgeBusy}
        onCancel={() => !purgeBusy && setPurgeTarget(null)} onConfirm={runPurge}>
        <p>Detta raderar uppladdade dokument, fakturor, bokföringsposter och testtransaktioner för <b>{purgeTarget?.name}</b>. <b>Kontoplanen och systemets grundinställningar behålls.</b> Åtgärden kan inte ångras.</p>
        <p className="text-xs text-gray-500">Raderas: kund-/leverantörsfakturor, verifikationer & bokföringsrader, banktransaktioner, filer & underlag (OCR/AI), importhistorik, produkter, kunder och leverantörer.</p>
        <p className="text-xs text-gray-500">Bevaras: <b>hela kontoplanen</b>, användare, roller & behörigheter, företagsprofil, moms- och systeminställningar.</p>
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
                    <td className="py-1 text-gray-600"><i className="ti ti-list-numbers text-gray-400 mr-1" />Kontoplan bevarad (konton kvar)</td>
                    <td className="py-1 text-right font-medium text-green-700">{purgeSummary.preservedAccounts.toLocaleString('sv-SE')}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-3">Kontoplan, användare, behörigheter och systeminställningar bevarades.</p>
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
