import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import UnderlagPanel from '../components/UnderlagPanel'
import DocumentViewerPanel from '../components/viewer/DocumentViewerPanel'
import RattaVerifikationModal from '../components/RattaVerifikationModal'
import { useDocumentViewerLayout } from '../lib/viewer/useDocumentViewerLayout'

export default function VisaVerifikation() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { company } = useAuth()
  const [ver, setVer] = useState(null)
  const [rows, setRows] = useState([])
  const [docs, setDocs] = useState([])
  const [idx, setIdx] = useState(0)
  // Gemensam dokumentvisar-layout (egen nyckel för bokföringsmodulen).
  const { panelW, open: panelOpen, setOpen: setPanelOpen, dragging, startResize } =
    useDocumentViewerLayout({ widthKey: 'bokpilot.bokforing.viewerW', openKey: 'bokpilot.bokforing.viewerOpen' })
  const [loading, setLoading] = useState(true)
  const [couplingMode, setCouplingMode] = useState(false)
  const [korrigerad, setKorrigerad] = useState(null)   // legacy-rättelse (verifikation_andringar) -> info
  const [arRattelse, setArRattelse] = useState(null)   // legacy: denna ver ÄR en rättelse -> info
  const [rattaOpen, setRattaOpen] = useState(false)    // spårbar rättelsekedja via RPC
  const [kedja, setKedja] = useState({})               // id -> ver_nr för länkade verifikationer (status-relationer)
  const [ersattning, setErsattning] = useState(null)   // { id, ver_nr } som ersätter denna rättade ver

  useEffect(() => { loadVer() }, [id])

  async function loadAndringar() {
    // Har denna verifikation rättats? (original_id = id)
    const { data: korr } = await supabase.from('verifikation_andringar')
      .select('*').eq('original_id', id).order('skapad', { ascending: false }).limit(1).maybeSingle()
    if (korr?.rattelse_id) {
      const { data: rv } = await supabase.from('verifikationer').select('ver_nr').eq('id', korr.rattelse_id).maybeSingle()
      setKorrigerad({ ...korr, ver_nr: rv?.ver_nr })
    } else setKorrigerad(null)

    // Är denna verifikation själv en rättelse? (rattelse_id = id)
    const { data: ar } = await supabase.from('verifikation_andringar')
      .select('*').eq('rattelse_id', id).maybeSingle()
    if (ar?.original_id) {
      const { data: ov } = await supabase.from('verifikationer').select('ver_nr').eq('id', ar.original_id).maybeSingle()
      setArRattelse({ ...ar, ver_nr: ov?.ver_nr, original_id: ar.original_id })
    } else setArRattelse(null)
  }


  // Kopplar ett underlag från Inkorgen till denna verifikation (efterhandskoppling).
  async function couple(docId) {
    const { error } = await supabase.from('documents').update({ verifikation_id: id }).eq('id', docId)
    if (error) throw error
    toast.success('Underlag kopplat till verifikationen')
    await loadVer()
  }

  // Status-relationerna (makulering/rättelsekedja): slå upp ver_nr för länkade verifikationer.
  async function loadKedja(v) {
    const ids = [v.rattad_av, v.rattar, v.ersatter, v.makulerad_av, v.motverkar].filter(Boolean)
    if (ids.length) {
      const { data } = await supabase.from('verifikationer').select('id, ver_nr').in('id', ids)
      setKedja(Object.fromEntries((data || []).map(x => [x.id, x.ver_nr])))
    } else setKedja({})
    if (v.status === 'rattad') {
      const { data: e } = await supabase.from('verifikationer').select('id, ver_nr').eq('ersatter', v.id).limit(1).maybeSingle()
      setErsattning(e || null)
    } else setErsattning(null)
  }

  async function loadVer() {
    const { data: v } = await supabase.from('verifikationer').select('*').eq('id', id).single()
    const { data: r } = await supabase.from('verifikation_rows').select('*').eq('verifikation_id', id).order('sort_order')
    const { data: d } = await supabase.from('documents').select('*').eq('verifikation_id', id).order('created_at')
    const withUrls = await Promise.all((d || []).map(async doc => {
      const { data: s } = await supabase.storage.from('underlag').createSignedUrl(doc.storage_path, 3600)
      return { ...doc, url: s?.signedUrl || null }
    }))
    setVer(v)
    setRows(r || [])
    setDocs(withUrls)
    setLoading(false)
    if (v) loadKedja(v)
    loadAndringar()
  }

  if (loading) return <div className="p-12 text-center text-gray-400">Laddar...</div>
  if (!ver) return <div className="p-12 text-center text-gray-400">Verifikation hittades inte</div>

  const totalD = rows.reduce((s, r) => s + (r.debet || 0), 0)
  const totalK = rows.reduce((s, r) => s + (r.kredit || 0), 0)
  const fmt = n => Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-[15px] font-bold tracking-tight">VERIFIKATION {ver.ver_nr}</span>
        <div className="flex items-center gap-2.5">
          {(ver.status ?? 'aktiv') === 'aktiv' && !korrigerad && (
            <button className="btn" style={{ borderColor: '#A32D2D', color: '#A32D2D' }} onClick={() => setRattaOpen(true)}>
              <i className="ti ti-pencil-minus" /> Rätta
            </button>
          )}
          <button className={`btn ${couplingMode ? 'btn-primary' : ''}`} onClick={() => setCouplingMode(m => !m)}>
            <i className="ti ti-paperclip" /> {couplingMode ? 'Stäng koppling' : 'Koppla underlag'}
          </button>
          <Link to="/bokforing/ny" className="btn"><i className="ti ti-plus" /> Skapa verifikation</Link>
          <button className="btn btn-primary" onClick={() => navigate('/bokforing')}><i className="ti ti-list" /> Visa lista</button>
        </div>
      </div>

      <div className="bg-white border-b px-7 h-10 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-xs text-green-700 font-medium flex items-center gap-1"><i className="ti ti-lock text-sm" /> Bokförd: {ver.created_at?.replace('T', ' ').slice(0, 19)}</span>
        <div className="flex gap-5 no-print">
          <button className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut</button>
          <button className="text-sm text-gray-400 flex items-center gap-1"
            onClick={() => navigate(`/bokforing/ny`)}><i className="ti ti-copy" /> Ny verifikation</button>
        </div>
      </div>

      <div id="printable" className="p-7 max-w-3xl flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <div className="text-[11px] text-gray-500 font-medium mb-1">Beskrivning</div>
            <div className="text-sm font-medium py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{ver.beskrivning}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500 font-medium mb-1">Verifikationsserie</div>
            <div className="text-sm py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{ver.ver_serie}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500 font-medium mb-1">Bokföringsdatum</div>
            <div className="text-sm py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{ver.datum}</div>
          </div>
        </div>

        {ver.kommentar && (
          <div className="mb-6">
            <div className="text-[11px] text-gray-500 font-medium mb-1">Kommentar</div>
            <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{ver.kommentar}</div>
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Benämning</th>
                <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Debet</th>
                <th className="text-right px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kredit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{r.account_nr}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{r.account_name}</td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {r.debet > 0 ? fmt(r.debet) : ''}
                  </td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {r.kredit > 0 ? fmt(r.kredit) : ''}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-medium">
                <td colSpan="2" className="text-right px-4 py-2.5 border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Summa</td>
                <td className="text-right px-4 py-2.5 border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{fmt(totalD)}</td>
                <td className="text-right px-4 py-2.5 border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{fmt(totalK)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 px-4 py-3 bg-green-50 rounded-lg text-xs text-green-700 flex items-center gap-2">
          <i className="ti ti-lock text-sm" />
          Denna verifikation är bokförd och kan inte ändras enligt 5 kap. 5 § bokföringslagen (1999:1078).
        </div>

        {ver.status === 'makulerad' && (
          <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-ban" /> Makulerad</div>
            <div>Verifikationen är makulerad och nollställd av en motverifikation. Originalet bevaras enligt Bokföringslagen.</div>
            {ver.makulerad_av && kedja[ver.makulerad_av] && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${ver.makulerad_av}`)}>
                <i className="ti ti-arrow-right" /> Visa motverifikation {kedja[ver.makulerad_av]}
              </button>
            )}
          </div>
        )}

        {ver.status === 'motverifikation' && ver.motverkar && (
          <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-ban" /> Motverifikation</div>
            <div>Denna verifikation nollar en makulerad verifikation.</div>
            {kedja[ver.motverkar] && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${ver.motverkar}`)}>
                <i className="ti ti-arrow-left" /> Visa makulerad verifikation {kedja[ver.motverkar]}
              </button>
            )}
          </div>
        )}

        {ver.status === 'rattad' && (
          <div className="mt-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-pencil-minus" /> Rättad</div>
            <div>Verifikationen är rättad: en rättelseverifikation har vänt raderna{ersattning ? ' och en ersättningsverifikation har bokförts' : ''}. Originalet bevaras enligt Bokföringslagen.</div>
            {ver.rattad_av && kedja[ver.rattad_av] && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${ver.rattad_av}`)}>
                <i className="ti ti-arrow-right" /> Visa rättelseverifikation {kedja[ver.rattad_av]}
              </button>
            )}
            {ersattning && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${ersattning.id}`)}>
                <i className="ti ti-arrow-right" /> Visa ersättningsverifikation {ersattning.ver_nr}
              </button>
            )}
          </div>
        )}

        {ver.status === 'rattelse' && ver.rattar && (
          <div className="mt-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-arrow-back-up" /> Rättelseverifikation</div>
            <div>Denna verifikation vänder raderna i en rättad verifikation (spårbar rättelsekedja).</div>
            {kedja[ver.rattar] && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${ver.rattar}`)}>
                <i className="ti ti-arrow-left" /> Visa ursprunglig verifikation {kedja[ver.rattar]}
              </button>
            )}
          </div>
        )}

        {ver.ersatter && (
          <div className="mt-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-replace" /> Ersättningsverifikation</div>
            <div>Denna verifikation ersätter en rättad verifikation med korrekt bokföring.</div>
            {kedja[ver.ersatter] && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${ver.ersatter}`)}>
                <i className="ti ti-arrow-left" /> Ersätter verifikation {kedja[ver.ersatter]}
              </button>
            )}
          </div>
        )}

        {korrigerad && (
          <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-pencil-minus" /> Rättad</div>
            <div>Rättad {korrigerad.skapad?.replace('T', ' ').slice(0, 16)}{korrigerad.utford_av_epost ? ` av ${korrigerad.utford_av_epost}` : ''}.</div>
            <div>Orsak: <span className="font-medium">{korrigerad.orsak}</span></div>
            {korrigerad.ver_nr && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${korrigerad.rattelse_id}`)}>
                <i className="ti ti-arrow-right" /> Visa rättelseverifikation {korrigerad.ver_nr}
              </button>
            )}
          </div>
        )}

        {arRattelse && (
          <div className="mt-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            <div className="font-semibold flex items-center gap-1.5 mb-1"><i className="ti ti-arrow-back-up" /> Rättelseverifikation</div>
            <div>Detta är en rättelse av verifikation {arRattelse.ver_nr}. Orsak: <span className="font-medium">{arRattelse.orsak}</span></div>
            {arRattelse.ver_nr && (
              <button className="text-blue-700 font-medium hover:underline mt-1 flex items-center gap-1"
                onClick={() => navigate(`/bokforing/${arRattelse.original_id}`)}>
                <i className="ti ti-arrow-left" /> Visa ursprunglig verifikation {arRattelse.ver_nr}
              </button>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Hopfällningspil för underlagspanelen */}
      {!couplingMode && docs.length > 0 && (
        <button
          className="self-center -mr-px z-20 w-7 h-12 rounded-l-lg bg-amber-400 hover:bg-amber-500 text-gray-900 flex items-center justify-center shadow shrink-0"
          onClick={() => setPanelOpen(o => !o)}
          title={panelOpen ? 'Dölj underlag' : 'Visa underlag'}>
          <i className={`ti ${panelOpen ? 'ti-chevron-right' : 'ti-chevron-left'}`} />
        </button>
      )}

      {/* Kopplingsläge: Inkorgen med förhandsvisning, koppla direkt */}
      {couplingMode && (
        <UnderlagPanel company={{ id: ver.company_id }} onCouple={couple} title="KOPPLA UNDERLAG" onClose={() => setCouplingMode(false)} />
      )}

      {/* Spårbar rättelsekedja: RPC skapar rättelseverifikationen, sedan bokförs ersättningen. */}
      {rattaOpen && (
        <RattaVerifikationModal ver={ver} company={company} onClose={() => setRattaOpen(false)}
          onDone={res => {
            setRattaOpen(false)
            toast.success(`Rättelseverifikation ${res?.rattelse_nr || ''} skapad – bokför nu den korrigerade verifikationen`)
            navigate(`/bokforing/ny?ersatter=${id}&datum=${res?.datum || ''}`)
          }} />
      )}

      {/* Underlag – högerpanel (kopplade), gemensam dokumentvisare med splitter */}
      {!couplingMode && docs.length > 0 && panelOpen && (
        <>
          <div onPointerDown={startResize} role="separator" aria-orientation="vertical" title="Dra för att ändra storlek"
            className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors" style={{ touchAction: 'none' }} />
          <div className="bg-white flex flex-col h-full" style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', width: panelW, flexShrink: 0 }}>
            <DocumentViewerPanel
              docs={docs} index={idx} onIndexChange={setIdx} title="UNDERLAG"
              onClose={() => setPanelOpen(false)} dragging={dragging} emptyText="Inget underlag" />
          </div>
        </>
      )}

    </div>
  )
}
