import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { serviceStateMeta, canMutateServiceState } from '../lib/adminCompanies'
import { TONE_CLASS } from '../lib/systemStatus'

const fmt = ts => ts ? new Date(ts).toLocaleString('sv-SE') : '–'
const fmtD = ts => ts ? new Date(ts).toLocaleDateString('sv-SE') : '–'
const Pill = ({ meta }) => <span className={`text-xs px-2 py-0.5 rounded ${TONE_CLASS[meta.tone] || TONE_CLASS.gray}`}>{meta.label}</span>

const Box = ({ title, children, action }) => (
  <section className="bg-white rounded-xl p-5 mb-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
    <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-gray-700">{title}</h2>{action}</div>
    {children}
  </section>
)
const Row = ({ k, v }) => <div className="flex justify-between text-sm py-1 border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}><span className="text-gray-400">{k}</span><span className="text-gray-800 font-medium text-right">{v ?? '–'}</span></div>

export default function ForetagProfil({ access }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null)      // { target: 'paused'|'blocked'|'active' }
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const canMutate = canMutateServiceState(access)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error: err } = await supabase.rpc('admin_get_company', { p_company_id: id })
    if (err) setError(err.message?.replace(/^.*?:\s*/, '') || 'Kunde inte ladda företaget')
    else { setData(res); setError(null) }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  async function applyState() {
    setBusy(true)
    const { error: err } = await supabase.rpc('admin_set_company_service_state', {
      p_company_id: id, p_state: modal.target, p_reason: reason || null, p_note: note || null, p_notify: notify,
    })
    setBusy(false)
    if (err) return toast.error(err.message?.replace(/^.*?:\s*/, '') || 'Åtgärden misslyckades')
    toast.success(modal.target === 'active' ? 'Tjänsten återaktiverad' : modal.target === 'blocked' ? 'Företaget blockerat' : 'Företaget pausat')
    setModal(null); setReason(''); setNote(''); setNotify(true)
    await load()
  }

  if (loading) return <div className="p-12 text-center text-gray-400">Laddar…</div>
  if (error) return <div className="p-12 text-center text-gray-400"><i className="ti ti-lock mr-1" />{error}</div>
  const c = data.company, sub = data.subscription, u = data.usage

  return (
    <div className="p-7 max-w-[1100px]">
      <button className="text-sm text-gray-500 hover:text-gray-800 mb-3" onClick={() => navigate('/foretag')}><i className="ti ti-arrow-left mr-1" /> Alla företag</button>
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{c.name} <Pill meta={serviceStateMeta(c.service_state)} /></h1>
          <p className="text-sm text-gray-400">{c.org_nr || '–'}{c.archive_number ? ` · arkiv ${c.archive_number}` : ''} · skapad {fmtD(c.created_at)}</p>
        </div>
        {canMutate ? (
          <div className="flex gap-2">
            {c.service_state === 'active' ? (
              <>
                <button className="btn" onClick={() => setModal({ target: 'paused' })}><i className="ti ti-player-pause" /> Pausa</button>
                <button className="btn btn-danger" onClick={() => setModal({ target: 'blocked' })}><i className="ti ti-ban" /> Blockera</button>
              </>
            ) : (
              <button className="btn btn-green" onClick={() => setModal({ target: 'active' })}><i className="ti ti-player-play" /> Återaktivera</button>
            )}
          </div>
        ) : <span className="text-xs text-gray-400 self-center"><i className="ti ti-eye mr-1" />Läsläge</span>}
      </div>

      {c.service_state !== 'active' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800">
          <b>{serviceStateMeta(c.service_state).label}</b> sedan {fmt(c.service_changed_at)}. Orsak: {c.service_reason || '—'}.
          {c.service_note && <div className="text-xs text-amber-700 mt-1">Intern not: {c.service_note}</div>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Box title="Grunddata">
          <Row k="E-post" v={c.email} /><Row k="Telefon" v={c.phone} /><Row k="Adress" v={[c.address, c.postnr, c.postort].filter(Boolean).join(', ')} />
          <Row k="Företagsform" v={c.foretagsform} /><Row k="Momsperiod" v={c.momsperiod} /><Row k="Onboardad" v={c.onboarded ? 'Ja' : 'Nej'} />
        </Box>
        <Box title="Abonnemang & betalning">
          <Row k="Plan" v={sub?.plan_name} /><Row k="Status" v={sub?.status} /><Row k="Period" v={sub?.billing_period} />
          <Row k="Trial slutar" v={fmtD(sub?.trial_ends_at)} /><Row k="Nästa debitering" v={fmtD(sub?.next_billing_at)} />
          <Row k="Betalstatus" v={sub?.payment_status} /><Row k="Senaste betalning" v={fmtD(sub?.last_payment_at)} />
        </Box>
        <Box title="Usage & dokument">
          <Row k="Användare" v={u.users} /><Row k="Dokument totalt" v={u.documents} /><Row k="Inkomna via e-post" v={u.inbound} />
          <Row k="Verifikationer" v={u.verifikationer} /><Row k="Öppna supportärenden" v={u.open_tickets} />
        </Box>
        <Box title={`Användare (${data.users.length})`}>
          {data.users.length === 0 ? <p className="text-sm text-gray-400">Inga användare</p> : data.users.map(usr => (
            <Row key={usr.user_id} k={`${usr.email} · ${usr.role}`} v={`senast ${fmtD(usr.last_sign_in_at)}`} />
          ))}
        </Box>
        <Box title="Inkommande underlag (senaste)">
          {data.recent_inbound.length === 0 ? <p className="text-sm text-gray-400">Inga inkomna underlag</p> : data.recent_inbound.map((d, i) => (
            <Row key={i} k={d.file_name} v={fmtD(d.created_at)} />
          ))}
        </Box>
        <Box title="Supporthistorik">
          {data.support.length === 0 ? <p className="text-sm text-gray-400">Inga ärenden</p> : data.support.map(t => (
            <Row key={t.id} k={t.subject} v={`${t.status} · ${fmtD(t.created_at)}`} />
          ))}
        </Box>
      </div>

      <Box title="Audit history">
        {data.audit.length === 0 ? <p className="text-sm text-gray-400">Inga loggposter</p> : (
          <div className="space-y-1.5">
            {data.audit.map((a, i) => (
              <div key={i} className="text-xs flex items-start gap-2 py-1 border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                <span className="text-gray-400 shrink-0 w-32">{fmt(a.created_at)}</span>
                <span className="font-medium text-gray-700">{a.action}</span>
                <span className="text-gray-400 truncate">{a.actor_email}</span>
                {a.detail?.new_state && <span className="text-gray-500">→ {a.detail.previous_state} ⇒ {a.detail.new_state}{a.detail.reason ? ` (${a.detail.reason})` : ''}</span>}
              </div>
            ))}
          </div>
        )}
      </Box>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-6" onClick={() => !busy && setModal(null)}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-1">
              {modal.target === 'active' ? 'Återaktivera tjänsten' : modal.target === 'blocked' ? 'Blockera företaget' : 'Pausa företaget'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">{c.name}. Ingen data raderas – endast tillgången till appen ändras.</p>
            {modal.target !== 'active' && (
              <>
                <label className="block text-xs font-medium text-gray-500 mb-1">Orsak (visas för kunden)</label>
                <input className="input mb-3" value={reason} onChange={e => setReason(e.target.value)} placeholder="t.ex. Obetald faktura" />
                <label className="block text-xs font-medium text-gray-500 mb-1">Intern kommentar (visas aldrig för kund)</label>
                <textarea className="input mb-3" rows={2} value={note} onChange={e => setNote(e.target.value)} />
              </>
            )}
            <label className="flex items-center gap-2 text-sm mb-5 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={notify} onChange={e => setNotify(e.target.checked)} /> Notifiera kundens administratörer (in-app + e-post)
            </label>
            <div className="flex justify-end gap-2.5">
              <button className="btn" onClick={() => setModal(null)} disabled={busy}>Avbryt</button>
              <button className={`btn ${modal.target === 'active' ? 'btn-green' : 'btn-danger'}`} onClick={applyState} disabled={busy}>
                {busy ? 'Sparar…' : modal.target === 'active' ? 'Återaktivera' : modal.target === 'blocked' ? 'Blockera' : 'Pausa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
