import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function InkomnaFakturor({ tolkningMode = false }) {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [results, setResults] = useState({})
  const fileRef = useRef()

  useEffect(() => { if (company) load() }, [company?.id])

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

  async function visa(d) {
    const { data: s } = await supabase.storage.from('underlag').createSignedUrl(d.storage_path, 3600)
    if (s?.signedUrl) window.open(s.signedUrl, '_blank')
  }

  async function del(d) {
    if (!confirm(`Radera "${d.file_name}"?`)) return
    await supabase.storage.from('underlag').remove([d.storage_path])
    await supabase.from('documents').delete().eq('id', d.id)
    toast.success('Raderat'); load()
  }

  async function invokeTolka(id) {
    const { data, error } = await supabase.functions.invoke('tolka-underlag', { body: { document_id: id } })
    if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
    if (data?.error) throw new Error(data.error)
    return data.result
  }
  async function tolka(d) {
    setBusyId(d.id)
    try {
      let r; try { r = await invokeTolka(d.id) } catch { r = await invokeTolka(d.id) }
      setResults(p => ({ ...p, [d.id]: r }))
      toast.success('Tolkat')
    } catch (e) { toast.error('Tolkning misslyckades: ' + (e.message || e)) }
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
    <div className="p-7">
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
          : 'Inkomna underlag (ej bokförda). Klicka Skapa leverantörsfaktura så öppnas editorn med bilden kopplad och tolkad automatiskt.'}
      </div>
    </div>
  )
}
