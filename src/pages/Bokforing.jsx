import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import Dagskassa from '../components/Dagskassa'
import Kvitto from '../components/Kvitto'
import StamAvKonto from '../components/StamAvKonto'
import SokBelopp from '../components/SokBelopp'
import AccountingUnderlagPanel from '../components/AccountingUnderlagPanel'
import DocumentSplitLayout from '../components/viewer/DocumentSplitLayout'
import { useDocumentViewerLayout } from '../lib/viewer/useDocumentViewerLayout'

const verNum = v => parseInt((v.ver_nr || '').replace(/\D/g, ''), 10) || 0
const toAmt = s => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n }
const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tabs = ['Verifikationer', 'Periodiseringar', 'Registrera dagskassa', 'Registrera kvitto', 'Stäm av konto', 'Sök belopp']
const emptyFilt = { verNr: '', besk: '', bokfFrom: '', bokfTom: '', beloppFrom: '', beloppTom: '' }
const PAGE_SIZE = 100

export default function Bokforing() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(0)
  const [verifikationer, setVerifikationer] = useState([])
  const [search, setSearch] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [filt, setFilt] = useState({ ...emptyFilt })
  const [serie, setSerie] = useState('Alla')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dagskassaDoc, setDagskassaDoc] = useState(null)
  const [kvittoDoc, setKvittoDoc] = useState(null)
  const { panelW, open, setOpen, dragging, startResize } = useDocumentViewerLayout({
    widthKey: 'bokpilot.bokforing.registrera.viewerW',
    openKey: 'bokpilot.bokforing.registrera.viewerOpen',
  })

  useEffect(() => { if (company) loadVerifikationer() }, [company])

  async function loadVerifikationer() {
    setLoading(true)
    const { data, error } = await supabase.from('verifikationer').select('*').eq('company_id', company.id)
    if (!error) setVerifikationer(data || [])
    setLoading(false)
  }

  const series = ['Alla', ...[...new Set(verifikationer.map(v => (v.ver_serie || '')[0]).filter(Boolean))].sort()]

  const filtered = verifikationer.filter(v => {
    if (search && !`${v.ver_nr} ${v.beskrivning}`.toLowerCase().includes(search.toLowerCase())) return false
    if (serie !== 'Alla' && (v.ver_serie || '')[0] !== serie) return false
    if (filt.verNr && !(v.ver_nr || '').toLowerCase().includes(filt.verNr.toLowerCase())) return false
    if (filt.besk && !(v.beskrivning || '').toLowerCase().includes(filt.besk.toLowerCase())) return false
    if (filt.bokfFrom && v.datum < filt.bokfFrom) return false
    if (filt.bokfTom && v.datum > filt.bokfTom) return false
    const bf = toAmt(filt.beloppFrom), bt = toAmt(filt.beloppTom)
    if (bf != null && (v.total_debet || 0) < bf) return false
    if (bt != null && (v.total_debet || 0) > bt) return false
    return true
  }).sort((a, b) => (a.ver_serie || '').localeCompare(b.ver_serie || '', 'sv') || verNum(a) - verNum(b))

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE)

  function rensa() { setSearch(''); setFilt({ ...emptyFilt }); setSerie('Alla'); setPage(0) }

  // Makulering via motverifikation (BFL): originalet bevaras med status 'makulerad' och en
  // motverifikation med omvänd kontering skapas i samma serie. Inga nummerluckor uppstår,
  // så alla aktiva verifikationer kan makuleras (inte bara den senaste i serien).
  async function makuleraVer(e, v) {
    e.stopPropagation()
    if (!confirm(`Makulera verifikation ${v.ver_nr}? En motverifikation med omvänd kontering skapas och originalet bevaras.`)) return
    const { data, error } = await supabase.rpc('makulera_verifikation', { p_ver_id: v.id })
    if (error) { toast.error('Kunde inte makulera: ' + error.message); return }
    toast.success(`Verifikation ${v.ver_nr} makulerad (motverifikation ${data?.motverifikation_nr || ''})`)
    loadVerifikationer()
  }

  const Field = ({ label, k, type = 'text' }) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input className="input" type={type} value={filt[k]} onChange={e => { setFilt(p => ({ ...p, [k]: e.target.value })); setPage(0) }} />
    </div>
  )

  const registrationViewer = tabs[activeTab] === 'Registrera dagskassa' || tabs[activeTab] === 'Registrera kvitto'
  const activeDoc = tabs[activeTab] === 'Registrera dagskassa' ? dagskassaDoc : tabs[activeTab] === 'Registrera kvitto' ? kvittoDoc : null
  const setActiveDoc = tabs[activeTab] === 'Registrera dagskassa' ? setDagskassaDoc : setKvittoDoc
  const activeKategori = tabs[activeTab] === 'Registrera kvitto' ? 'kvitto' : 'dokument'
  const viewerPanel = registrationViewer ? (
    <AccountingUnderlagPanel
      company={company}
      kategori={activeKategori}
      doc={activeDoc}
      dragging={dragging}
      onSelected={setActiveDoc}
      onRemove={() => setActiveDoc(null)}
    />
  ) : null

  const content = (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Bokföring</span>
        <div className="flex items-center gap-2">
          {registrationViewer && (
            <button type="button" className="btn" onClick={() => setOpen(o => !o)} title={open ? 'Dölj bildpanelen' : 'Visa bildpanelen'}>
              <i className={`ti ${open ? 'ti-layout-sidebar-right-collapse' : 'ti-layout-sidebar-right-expand'}`} /> {open ? 'Dölj bild' : 'Visa bild'}
            </button>
          )}
          <Link to="/bokforing/ny" className="btn btn-primary"><i className="ti ti-plus" /> Skapa verifikation</Link>
        </div>
      </div>

      <div className="bg-white border-b flex gap-0 px-7 overflow-x-auto" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        {tabs.map((tab, i) => (
          <button key={i} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-[13.5px] whitespace-nowrap border-b-[2.5px] transition-colors -mb-px ${
              i === activeTab ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}>{tab}</button>
        ))}
      </div>

      <div className="p-7">
        {activeTab === 0 && (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="text-[15px] font-semibold">VERIFIKATIONER – LISTA</span>
              <div className="relative">
                <input className="input pl-8 w-72" placeholder="Verifikationsnummer, beskrivning" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
                <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              </div>
              <button className="text-sm text-blue-700 hover:underline" onClick={() => setAdvanced(a => !a)}>
                {advanced ? 'Stäng utökad sökning' : 'Utökad sökning'}
              </button>
            </div>

            {advanced && (
              <div className="bg-white rounded-xl p-5 mb-4" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Grunduppgifter</div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {Field({ label: 'Verifikationsnummer', k: 'verNr' })}
                  {Field({ label: 'Beskrivning', k: 'besk' })}
                  {Field({ label: 'Bokförd fr.o.m.', k: 'bokfFrom', type: 'date' })}
                  {Field({ label: 'Bokförd t.o.m.', k: 'bokfTom', type: 'date' })}
                </div>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Belopp</div>
                <div className="grid grid-cols-4 gap-3">
                  {Field({ label: 'Belopp fr.o.m.', k: 'beloppFrom' })}
                  {Field({ label: 'Belopp t.o.m.', k: 'beloppTom' })}
                </div>
                <div className="flex justify-end mt-3">
                  <button className="btn" onClick={rensa}>Rensa</button>
                </div>
              </div>
            )}

            <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
              <div className="w-64">
                <label className="block text-xs font-medium text-gray-500 mb-1">Verifikationsserie</label>
                <select className="input" value={serie} onChange={e => { setSerie(e.target.value); setPage(0) }}>
                  {series.map(s => <option key={s} value={s}>{s === 'Alla' ? 'Alla' : `${s} – serie`}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>{filtered.length} verifikationer</span>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button className="btn text-xs py-1 px-2" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}><i className="ti ti-chevron-left" /></button>
                    <span>Sida {curPage + 1} / {pageCount}</span>
                    <button className="btn text-xs py-1 px-2" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}><i className="ti ti-chevron-right" /></button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="tbl w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Verifikationsnummer</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Bokföringsdatum</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Beskrivning</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Belopp</th>
                    <th className="px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="5" className="text-center py-12 text-gray-400">Laddar...</td></tr>
                  ) : pageRows.length === 0 ? (
                    <tr><td colSpan="5" className="text-center py-12 text-gray-400">
                      <i className="ti ti-file-off text-3xl block mb-2 opacity-30" />
                      Inga verifikationer hittades
                    </td></tr>
                  ) : pageRows.map(v => (
                    <tr key={v.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/bokforing/${v.id}`)}>
                      <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        {v.ver_nr}
                        {v.status === 'makulerad' && <span className="ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-600">Makulerad</span>}
                        {v.status === 'motverifikation' && <span className="ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Motverifikation</span>}
                      </td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{v.datum}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{v.beskrivning}</td>
                      <td className="px-4 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{fmt(v.total_debet)}</td>
                      <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        <button className="btn text-xs py-1 px-2" title="Visa"><i className="ti ti-eye text-xs" /></button>
                        {(v.status ?? 'aktiv') === 'aktiv' && (
                          <button className="btn btn-danger text-xs py-1 px-2 ml-1.5" title="Makulera (motverifikation skapas)" onClick={e => makuleraVer(e, v)}><i className="ti ti-ban text-xs" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tabs[activeTab] === 'Registrera dagskassa' && <Dagskassa underlagDoc={dagskassaDoc} onUnderlagLinked={() => setDagskassaDoc(null)} />}
        {tabs[activeTab] === 'Registrera kvitto' && <Kvitto underlagDoc={kvittoDoc} onUnderlagLinked={() => setKvittoDoc(null)} />}
        {tabs[activeTab] === 'Stäm av konto' && <StamAvKonto />}
        {tabs[activeTab] === 'Sök belopp' && <SokBelopp />}
        {activeTab !== 0 && !['Registrera dagskassa', 'Registrera kvitto', 'Stäm av konto', 'Sök belopp'].includes(tabs[activeTab]) && (
          <div className="text-center py-16 text-gray-400">
            <i className="ti ti-tools text-3xl block mb-2 opacity-30" />
            {tabs[activeTab]} – kommer snart
          </div>
        )}
      </div>
    </div>
  )

  if (!registrationViewer) return content

  return (
    <DocumentSplitLayout open={open} panelW={panelW} startResize={startResize} panel={viewerPanel} onToggle={() => setOpen(o => !o)}>
      <div className="flex-1 overflow-hidden">
        {content}
      </div>
    </DocumentSplitLayout>
  )
}
