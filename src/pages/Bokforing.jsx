import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import Dagskassa from '../components/Dagskassa'

const verNum = v => parseInt((v.ver_nr || '').replace(/\D/g, ''), 10) || 0

const tabs = ['Verifikationer', 'Periodiseringar', 'Registrera dagskassa', 'Registrera kvitto', 'Stäm av konto', 'Sök belopp', 'Moms']

export default function Bokforing() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(0)
  const [verifikationer, setVerifikationer] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (company) loadVerifikationer()
  }, [company])

  async function loadVerifikationer() {
    setLoading(true)
    const { data, error } = await supabase
      .from('verifikationer')
      .select('*')
      .eq('company_id', company.id)
      .order('datum', { ascending: false })
      .limit(100)
    if (!error) setVerifikationer(data || [])
    setLoading(false)
  }

  const filtered = verifikationer.filter(v =>
    !search || v.ver_nr.toLowerCase().includes(search.toLowerCase()) || v.beskrivning.toLowerCase().includes(search.toLowerCase())
  )

  // Den senaste (högsta numret) i varje serie får raderas.
  const deletableIds = new Set()
  const maxPerSerie = {}
  verifikationer.forEach(v => {
    const n = verNum(v)
    if (!(v.ver_serie in maxPerSerie) || n > maxPerSerie[v.ver_serie].n) {
      maxPerSerie[v.ver_serie] = { n, id: v.id }
    }
  })
  Object.values(maxPerSerie).forEach(x => deletableIds.add(x.id))

  async function deleteVer(e, v) {
    e.stopPropagation()
    if (!confirm(`Radera verifikation ${v.ver_nr}? Detta går inte att ångra.`)) return
    const { error } = await supabase
      .from('verifikationer')
      .delete()
      .eq('id', v.id)
      .eq('company_id', company.id)
    if (error) { toast.error('Kunde inte radera: ' + error.message); return }
    toast.success(`Verifikation ${v.ver_nr} raderad`)
    loadVerifikationer()
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Bokföring</span>
        <Link to="/bokforing/ny" className="btn btn-primary"><i className="ti ti-plus" /> Skapa verifikation</Link>
      </div>

      {/* Subtabs */}
      <div className="bg-white border-b flex gap-0 px-7 overflow-x-auto" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-[13.5px] whitespace-nowrap border-b-[2.5px] transition-colors -mb-px ${
              i === activeTab ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-7">
        {activeTab === 0 && (
          <>
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex items-center gap-3">
                <span className="text-[15px] font-semibold">Verifikationer – lista</span>
                <div className="relative">
                  <input
                    className="input pl-8 w-64"
                    placeholder="Sök nr eller beskrivning"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{filtered.length} verifikationer</span>
              </div>
            </div>

            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="tbl w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Verifikationsnummer</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b bg-gray-200" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokföringsdatum</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                    <th className="px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="5" className="text-center py-12 text-gray-400">Laddar...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan="5" className="text-center py-12 text-gray-400">
                      <i className="ti ti-file-off text-3xl block mb-2 opacity-30" />
                      Inga verifikationer hittades
                    </td></tr>
                  ) : filtered.map(v => (
                    <tr
                      key={v.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => navigate(`/bokforing/${v.id}`)}
                    >
                      <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{v.ver_nr}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{v.datum}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{v.beskrivning}</td>
                      <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        {v.total_debet?.toLocaleString('sv-SE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        <button className="btn text-xs py-1 px-2" title="Visa"><i className="ti ti-eye text-xs" /></button>
                        {deletableIds.has(v.id) && (
                          <button className="btn btn-danger text-xs py-1 px-2 ml-1.5" title="Radera (senaste i serien)"
                            onClick={e => deleteVer(e, v)}><i className="ti ti-trash text-xs" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tabs[activeTab] === 'Registrera dagskassa' && <Dagskassa />}
        {activeTab !== 0 && tabs[activeTab] !== 'Registrera dagskassa' && (
          <div className="text-center py-16 text-gray-400">
            <i className="ti ti-tools text-3xl block mb-2 opacity-30" />
            {tabs[activeTab]} – kommer snart
          </div>
        )}
      </div>
    </div>
  )
}
