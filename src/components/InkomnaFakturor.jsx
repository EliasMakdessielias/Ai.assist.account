import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { tolkaDocument } from '../lib/tolka'
import DocumentViewerPanel from './viewer/DocumentViewerPanel'
import { useDocumentViewerLayout } from '../lib/viewer/useDocumentViewerLayout'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function InkomnaFakturor({ tolkningMode = false }) {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [results, setResults] = useState({})
  const [selected, setSelected] = useState(null)
  const [selUrl, setSelUrl] = useState(null)
  const fileRef = useRef()
  // Gemensam dokumentvisare (egen layout-nyckel för inkomna fakturor).
  const { panelW, dragging, startResize } = useDocumentViewerLayout({ widthKey: 'bokpilot.levfaktura.inkomna.viewerW' })

  useEffect(() => { if (company) load() }, [company?.id])

  // Signerad URL för valt underlag (privat bucket) – endast filer användaren har åtkomst till.
  useEffect(() => {
    let active = true; setSelUrl(null)
    if (!selected?.storage_path) return
    supabase.storage.from('underlag').createSignedUrl(selected.storage_path, 3600).then(({ data }) => { if (active) setSelUrl(data?.signedUrl || null) })
    return () => { active = false }
  }, [selected?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('documents').select('*').eq('company_id', company.id).is('verifikation_id', null).order('created_at', { ascending: false })
    const list = data || []
    const withUrls = await Promise.all(list.map(async d => {
      if (!d.mime_type?.startsWith('image/')) return { ...d, thumb: null }
      const { data: s } = await supabase.storage.from('underlag').createSignedUrl(d.storage_path, 3600)
      return { ...d, thumb: s?.signedUrl || null }
    }))
    setDocs(withUrls)
    setLoading(false)
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    let ok = 0
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${company.id}/${crypto.randomUUID()}-${safe}`
      const { error: upErr } = await supabase.storage.from('underlag').upload(path, file, { contentType: file.type })
      if (upErr) { toast.error(`Kunde inte ladda upp ${file.name}: ${upErr.message}`); continue }
      const { error: insErr } = await supabase.from('documents').insert({ company_id: company.id, storage_path: path, file_name: file.name, mime_type: file.type, file_size: file.size })
      if (insErr) { toast.error('Fel: ' + insErr.message); continue }
      ok++
    }
    if (ok) toast.success(`${ok} fil(er) uppladdade`)
    e.target.value = ''
    setUploading(false)
    load()
  }

  // Visa underlaget i den gemensamma högerpanelen (i stället för ny flik).
  function visa(d) { setSelected(d) }

  async function del(d) {
    if (!confirm(`Radera "${d.file_name}"?`)) return
    await supabase.storage.from('underlag').remove([d.storage_path])
    await supabase.from('documents').delete().eq('id', d.id)
    if (selected?.id === d.id) setSelected(null)
    toast.success('Raderat'); load()
  }

  async function tolka(d) {
    setBusyId(d.id)
    try {
      const r = await tolkaDocument(d.id)
      await supabase.from('documents').update({ tolkning: r, tolkad: true }).eq('id', d.id)
      setResults(p => ({ ...p, [d.id]: r }))
      toast.success('Tolkat')
    } catch (e) { toast.error(e.message || String(e)) }
    setBusyId(null)
  }

  const skapaFaktura = d => navigate(`/leverantorsfakturor/ny?doc=${d.id}&tolka=1`)
  const summary = r => {
    if (!r) return null
    const lev = r.leverantor || r.leverantör || r.supplier || r.saljare
    const tot = r.total ?? r.belopp ?? r.summa
    const dat = r.fakturadatum || r.datum
    return [lev, dat, tot != null ? `${fmt(tot)} kr` : null].filter(Boolean).join(' · ')
  }

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 3.5rem)' }}>
      <div className="flex-1 min-w-0 overflow-y-auto p-7">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-[15px] font-bold tracking-tight">{tolkningMode ? 'SKICKA FÖR TOLKNING' : 'INKOMNA FAKTUROR'}</span>
        <button className="btn btn-primary ml-auto" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <i className="ti ti-upload" /> {uploading ? 'Laddar upp…' : 'Ladda upp fakturor'}
        </button>
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleUpload} />
      </div>

      {tolkningMode && (
        <div onClick={() => fileRef.current?.click()} className="cursor-pointer border-2 border-dashed rounded-xl py-10 text-center text-gray-400 hover:bg-gray-50 mb-5" style={{ borderColor: 'rgba(0,0,0,0.15)' }}>
          <i className="ti ti-cloud-upload text-4xl block mb-2 opacity-40" />
          Dra hit eller klicka för att ladda upp fakturor – tolka dem med AI och skapa leverantörsfakturor
        </div>
      )}

      <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 border-b w-16" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
              <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Filnamn</th>
              <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Uppladdad</th>
              {tolkningMode && <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Tolkning</th>}
              <th className="px-4 py-2.5 border-b w-72" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={tolkningMode ? 5 : 4} className="text-center py-12 text-gray-400">Laddar…</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={tolkningMode ? 5 : 4} className="text-center py-14 text-gray-400">
                <i className="ti ti-inbox text-3xl block mb-2 opacity-30" />
                Inga inkomna fakturor – ladda upp eller e-posta in underlag
              </td></tr>
            ) : docs.map(d => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  {d.thumb
                    ? <img src={d.thumb} alt="" className="w-10 h-10 object-cover rounded border" style={{ borderColor: 'rgba(0,0,0,0.1)' }} />
                    : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400"><i className="ti ti-file-text" /></div>}
                </td>
                <td className="px-4 py-2 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{d.file_name}</td>
                <td className="px-4 py-2 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{(d.created_at || '').slice(0, 10)}</td>
                {tolkningMode && <td className="px-4 py-2 border-b text-gray-600" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{summary(results[d.id]) || <span className="text-gray-300">–</span>}</td>}
                <td className="px-4 py-2 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                  <button className="btn text-xs py-1 px-2.5 mr-1.5" onClick={() => visa(d)}><i className="ti ti-eye" /></button>
                  {tolkningMode && <button className="btn text-xs py-1 px-2.5 mr-1.5" onClick={() => tolka(d)} disabled={busyId === d.id}>{busyId === d.id ? 'Tolkar…' : 'Tolka'}</button>}
                  <button className="btn btn-green text-xs py-1 px-2.5 mr-1.5" onClick={() => skapaFaktura(d)}>Skapa leverantörsfaktura</button>
                  <button className="text-gray-300 hover:text-red-600 align-middle" title="Radera" onClick={() => del(d)}><i className="ti ti-trash" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-400 mt-3">
        {tolkningMode
          ? 'Ladda upp fakturor och klicka Tolka för att läsa ut leverantör, datum och belopp med AI. Klicka sedan Skapa leverantörsfaktura så fylls fältet i automatiskt.'
          : 'Inkomna underlag (ej bokförda). Klicka på ögat för att förhandsgranska i panelen till höger.'}
      </div>
      </div>

      {selected && (
        <>
          <div onPointerDown={startResize} role="separator" aria-orientation="vertical" title="Dra för att ändra storlek"
            className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors" style={{ touchAction: 'none' }} />
          <div className="bg-white flex flex-col h-full" style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', width: panelW, flexShrink: 0 }}>
            <DocumentViewerPanel
              docs={[{ id: selected.id, url: selUrl, file_name: selected.file_name, mime_type: selected.mime_type }]} index={0}
              title={selected.file_name} onClose={() => setSelected(null)} dragging={dragging}
              footer={<button className="btn btn-green w-full justify-center py-2" onClick={() => skapaFaktura(selected)}><i className="ti ti-file-plus" /> Skapa leverantörsfaktura</button>} />
          </div>
        </>
      )}
    </div>
  )
}
