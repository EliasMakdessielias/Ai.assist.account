import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Team() {
  const { company, user } = useAuth()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: m }, { data: inv }] = await Promise.all([
      supabase.from('user_companies').select('id, user_id, email, role').eq('company_id', company.id),
      supabase.from('company_invites').select('*').eq('company_id', company.id).eq('status', 'pending').order('created_at'),
    ])
    setMembers(m || [])
    setInvites(inv || [])
    setLoading(false)
  }

  async function invite() {
    const e = email.trim().toLowerCase()
    if (!e || !e.includes('@')) return toast.error('Ange en giltig e-postadress')
    if (members.some(m => (m.email || '').toLowerCase() === e)) return toast.error('Personen är redan medlem')
    if (invites.some(i => i.email.toLowerCase() === e)) return toast.error('Inbjudan finns redan')
    setSaving(true)
    const { error } = await supabase.from('company_invites').insert({ company_id: company.id, email: e, role: 'member', status: 'pending', invited_by: user.id })
    setSaving(false)
    if (error) return toast.error('Kunde inte bjuda in: ' + error.message)
    toast.success('Inbjudan skapad')
    setEmail('')
    load()
  }

  async function cancelInvite(i) {
    await supabase.from('company_invites').delete().eq('id', i.id)
    load()
  }

  async function removeMember(m) {
    if (m.user_id === user.id) return toast.error('Du kan inte ta bort dig själv')
    if (!confirm(`Ta bort ${m.email || 'medlemmen'} från företaget?`)) return
    const { error } = await supabase.from('user_companies').delete().eq('id', m.id)
    if (error) return toast.error('Kunde inte ta bort: ' + error.message)
    toast.success('Medlem borttagen')
    load()
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Användare &amp; behörighet — {company?.name}</span>
      </div>

      <div className="p-7 max-w-2xl space-y-6">
        {/* Bjud in */}
        <div className="bg-white rounded-xl p-6" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <h2 className="text-sm font-semibold mb-1">Bjud in kollega</h2>
          <p className="text-xs text-gray-500 mb-3">Personen får tillgång till <b>{company?.name}</b> när hen loggar in eller registrerar sig med e-postadressen.</p>
          <div className="flex gap-2">
            <input className="input flex-1" type="email" placeholder="kollega@exempel.se" value={email}
              onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && invite()} />
            <button className="btn btn-primary" onClick={invite} disabled={saving}><i className="ti ti-user-plus" /> Bjud in</button>
          </div>
        </div>

        {/* Medlemmar */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <div className="px-4 py-2.5 text-sm font-medium border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Medlemmar</div>
          {loading ? <div className="text-center py-8 text-gray-400 text-sm">Laddar…</div> : (
            <table className="w-full text-sm">
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    <td className="px-4 py-2.5">{m.email || <span className="text-gray-400">(okänd e-post)</span>}{m.user_id === user.id && <span className="text-xs text-gray-400"> · du</span>}</td>
                    <td className="px-4 py-2.5 w-28"><span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{m.role === 'admin' ? 'Admin' : 'Medlem'}</span></td>
                    <td className="px-4 py-2.5 text-right w-16">
                      {m.user_id !== user.id && <button className="text-gray-300 hover:text-red-600" title="Ta bort" onClick={() => removeMember(m)}><i className="ti ti-trash" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Väntande inbjudningar */}
        {invites.length > 0 && (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <div className="px-4 py-2.5 text-sm font-medium border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Väntande inbjudningar</div>
            <table className="w-full text-sm">
              <tbody>
                {invites.map(i => (
                  <tr key={i.id} className="border-b last:border-0" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    <td className="px-4 py-2.5">{i.email}</td>
                    <td className="px-4 py-2.5 w-32"><span className="text-xs text-amber-700 flex items-center gap-1"><i className="ti ti-clock" /> Väntar</span></td>
                    <td className="px-4 py-2.5 text-right w-16"><button className="text-gray-300 hover:text-red-600" title="Avbryt" onClick={() => cancelInvite(i)}><i className="ti ti-trash" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-gray-400">
          Obs: appen skickar inget mejl automatiskt än. Be kollegan registrera sig / logga in med den inbjudna adressen — då kopplas hen till företaget.
        </div>
      </div>
    </div>
  )
}
