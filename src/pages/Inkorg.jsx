import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const FILTERS = [
  { key: 'inbox', label: 'Inkorgen' },
  { key: 'kopplade', label: 'Kopplade' },
  { key: 'alla', label: 'Alla' },
]

export default function Inkorg() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [docs, setDocs] = useState([])
  const [filter, setFilter] = useState('inbox')
  const [selected, setSelected] = useState(null)
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  useEffect(() => { if (company) load() }, [company])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('documents')
      .select('*, verifikationer(ver_nr, datum)')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
    if (!error) {
      setDocs(data || [])
      setSelected(prev => (data || []).find(d => d.id === prev?.id) || null)
    }
    setLoading(false)
  }

  // Signerad URL för förhandsvisning av valt underlag.
  useEffect(() => {
    let active = true
    setUrl(null)
    if (!selected) return
    supabase.storage.from('underlag').createSignedUrl(selected.storage_path, 3600).then(({ data }) => {
      if (active) setUrl(data?.signedUrl || null)
    })
    return () => { active = false }
  }, [selected?.id])

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
      const { error: insErr } = await supabase.from('documents').insert({
        company_id: company.id, storage_path: path, file_name: file.name, mime_type: file.type, file_size: file.size,
      })
      if (!insErr) ok++
    }
    if (ok) toast.success(`${ok} underlag uppladdat`)
    e.target.value = ''
    setUploading(false)
    load()
  }

  async function handleDelete(doc) {
    if (!confirm(`Radera underlaget "${doc.file_name}"? Detta går inte att ångra.`)) return
    await supabase.storage.from('underlag').remove([doc.storage_path])
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) return toast.error('Kunde inte radera: ' + error.message)
    if (selected?.id === doc.id) setSelected(null)
    toast.success('Underlag raderat')
    load()
  }

  function skapaVerifikation(doc) {
    navigate(`/bokforing/ny?underlag=${doc.id}`)
  }

  const visible = docs.filter(d =>
    filter === 'alla' ? true : filter === 'kopplade' ? d.verifikation_id : !d.verifikation_id
  )
  const inboxCount = docs.filter(d => !d.verifikation_id).length

  const fileIcon = m => m === 'application/pdf' ? 'ti-file-type-pdf' : m?.startsWith('image/') ? 'ti-photo' : 'ti-file'

  return (
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <span className="text-base font-medium">Inkorg{inboxCount ? ` (${inboxCount})` : ''}</span>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <i className="ti ti-upload" /> {uploading ? 'Laddar upp…' : 'Ladda upp underlag'}
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleUpload} />
        </div>

        <div className="bg-white border-b flex gap-0 px-7" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-2.5 text-[13.5px] border-b-[2.5px] -mb-px transition-colors ${
                filter === f.key ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-7">
          {loading ? (
            <div className="text-center py-16 text-gray-400">Laddar…</div>
          ) : visible.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <i className="ti ti-inbox text-4xl block mb-2 opacity-30" />
              <div className="font-medium text-gray-500 mb-1">Inga underlag här</div>
              <div className="text-sm">Ladda upp kvitton och fakturor med knappen uppe till höger.</div>
            </div>
          ) : (
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Fil</th>
                    <th className="text-left px-4 py-2.5 border-b w-40" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Uppladdad</th>
                    <th className="text-left px-4 py-2.5 border-b w-44" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                    <th className="px-4 py-2.5 border-b w-48" style={{ borderColor: 'rgba(0,0,0,0.10)' }} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(d => (
                    <tr key={d.id} className={`cursor-pointer hover:bg-gray-50 ${selected?.id === d.id ? 'bg-blue-50' : ''}`} onClick={() => setSelected(d)}>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        <span className="flex items-center gap-2"><i className={`ti ${fileIcon(d.mime_type)} text-gray-400`} /> {d.file_name}</span>
                      </td>
                      <td className="px-4 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{d.created_at?.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        {d.verifikation_id ? (
                          <button className="text-blue-700 text-xs flex items-center gap-1 hover:underline"
                            onClick={e => { e.stopPropagation(); navigate(`/bokforing/${d.verifikation_id}`) }}>
                            <i className="ti ti-link" /> Kopplad ({d.verifikationer?.ver_nr || '–'})
                          </button>
                        ) : (
                          <span className="text-amber-600 text-xs flex items-center gap-1"><i className="ti ti-inbox" /> I inkorgen</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 border-b text-right whitespace-nowrap" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                        {!d.verifikation_id && (
                          <button className="btn btn-green text-xs py-1 px-2.5 mr-1.5" title="Skapa verifikation från detta underlag"
                            onClick={e => { e.stopPropagation(); skapaVerifikation(d) }}>
                            <i className="ti ti-file-plus" /> Skapa verifikation
                          </button>
                        )}
                        <button className="text-gray-300 hover:text-red-600 align-middle" title="Radera" onClick={e => { e.stopPropagation(); handleDelete(d) }}>
                          <i className="ti ti-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Förhandsvisning av valt underlag */}
      {selected && (
        <div className="flex flex-col h-full bg-surface-3" style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', width: 520 }}>
          <div className="bg-white border-b px-5 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
            <span className="text-[15px] font-bold tracking-tight truncate" title={selected.file_name}>{selected.file_name}</span>
            <button className="text-gray-400 hover:text-gray-700" onClick={() => setSelected(null)}><i className="ti ti-x" /></button>
          </div>
          <div className="bg-white border-b px-5 h-10 flex items-center gap-4 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
            {url && <a className="text-sm text-gray-500 flex items-center gap-1" href={url} target="_blank" rel="noreferrer" download={selected.file_name}><i className="ti ti-download" /> Ladda ner</a>}
            {selected.verifikation_id && (
              <button className="text-sm text-blue-700 flex items-center gap-1" onClick={() => navigate(`/bokforing/${selected.verifikation_id}`)}>
                <i className="ti ti-external-link" /> Öppna verifikation
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            {!url ? <div className="text-gray-400">Hämtar…</div>
              : selected.mime_type?.startsWith('image/') ? <img src={url} alt={selected.file_name} className="max-w-full max-h-full object-contain bg-white shadow" />
              : selected.mime_type === 'application/pdf' ? <iframe src={url} title={selected.file_name} className="w-full h-full bg-white shadow" />
              : <a href={url} target="_blank" rel="noreferrer" className="text-blue-700">{selected.file_name}</a>}
          </div>
          {!selected.verifikation_id && (
            <div className="bg-white border-t px-5 py-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn btn-green w-full justify-center py-2" onClick={() => skapaVerifikation(selected)}>
                <i className="ti ti-file-plus" /> Skapa verifikation från detta underlag
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
