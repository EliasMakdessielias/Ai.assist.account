import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import UnderlagPanel from '../components/UnderlagPanel'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)

const STATES = {
  ejbokford: { label: 'Ej bokförd', bg: 'rgba(234,179,8,0.18)', color: '#92700a' },
  obetald: { label: 'Obetald', bg: 'rgba(248,113,113,0.18)', color: '#b91c1c' },
  forfallen: { label: 'Obetald förfallen', bg: 'rgba(220,38,38,0.2)', color: '#991b1b' },
  under: { label: 'Under betalning', bg: 'rgba(129,140,248,0.18)', color: '#4338ca' },
  slutbetald: { label: 'Slutbetald', bg: 'rgba(52,211,153,0.2)', color: '#1a7a2e' },
  makulerad: { label: 'Makulerad', bg: 'rgba(156,163,175,0.2)', color: '#4b5563' },
}

export default function VisaLeverantorsfaktura() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { company } = useAuth()
  const [inv, setInv] = useState(null)
  const [rows, setRows] = useState([])
  const [verNr, setVerNr] = useState(null)
  const [docs, setDocs] = useState([])
  const [idx, setIdx] = useState(0)
  const [panelOpen, setPanelOpen] = useState(true)
  const [coupling, setCoupling] = useState(false)
  const [scale, setScale] = useState(1)
  const [rot, setRot] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data: i } = await supabase.from('supplier_invoices').select('*, suppliers(name, org_nr, bankgiro)').eq('id', id).single()
    setInv(i)
    if (i?.verifikation_id) {
      const [{ data: r }, { data: v }, { data: d }] = await Promise.all([
        supabase.from('verifikation_rows').select('*').eq('verifikation_id', i.verifikation_id).order('sort_order'),
        supabase.from('verifikationer').select('ver_nr').eq('id', i.verifikation_id).maybeSingle(),
        supabase.from('documents').select('*').eq('verifikation_id', i.verifikation_id).order('created_at'),
      ])
      setRows(r || [])
      setVerNr(v?.ver_nr || null)
      const withUrls = await Promise.all((d || []).map(async doc => {
        const { data: s } = await supabase.storage.from('underlag').createSignedUrl(doc.storage_path, 3600)
        return { ...doc, url: s?.signedUrl || null }
      }))
      setDocs(withUrls)
    } else {
      // Ej bokförd – syntetisera kontering ur fakturahuvudet
      const moms = i?.vat_amount || 0, net = (i?.total_amount || 0) - moms
      setRows([
        { account_nr: '2440', account_name: 'Leverantörsskulder', debet: 0, kredit: i?.total_amount || 0 },
        ...(moms > 0 ? [{ account_nr: '2640', account_name: 'Ingående moms', debet: moms, kredit: 0 }] : []),
        { account_nr: i?.kostnadskonto || '4000', account_name: '', debet: net, kredit: 0 },
      ])
      setDocs([])
    }
    setLoading(false)
  }

  function stateOf(i) {
    if (!i) return 'ejbokford'
    if (i.makulerad) return 'makulerad'
    const total = i.total_amount || 0, paid = i.paid_amount || 0
    if (total > 0 && paid >= total - 0.005) return 'slutbetald'
    if (paid > 0.005) return 'under'
    if (!i.bokford) return 'ejbokford'
    return i.due_date < today() ? 'forfallen' : 'obetald'
  }

  async function couple(docId) {
    if (!inv?.verifikation_id) { toast.error('Bokför fakturan först för att kunna koppla bild'); return }
    const { error } = await supabase.from('documents').update({ verifikation_id: inv.verifikation_id }).eq('id', docId)
    if (error) throw error
    toast.success('Bild kopplad'); setCoupling(false); load()
  }
  async function kopplaBort(docId) {
    await supabase.from('documents').update({ verifikation_id: null }).eq('id', docId)
    toast.success('Bild bortkopplad'); load()
  }
  async function makulera() {
    if (!confirm(`Makulera leverantörsfaktura ${inv.lopnr}?`)) return
    await supabase.from('supplier_invoices').update({ makulerad: true }).eq('id', inv.id)
    toast.success('Makulerad'); navigate('/leverantorsfakturor')
  }

  if (loading) return <div className="p-12 text-center text-gray-400">Laddar…</div>
  if (!inv) return <div className="p-12 text-center text-gray-400">Leverantörsfaktura hittades inte</div>

  const st = STATES[stateOf(inv)]
  const sumD = rows.reduce((s, r) => s + (r.debet || 0), 0)
  const sumK = rows.reduce((s, r) => s + (r.kredit || 0), 0)
  const current = docs[idx] || null
  const isImg = current && (current.mime_type?.startsWith('image') || /\.(png|jpe?g|gif|webp|heic)$/i.test(current.file_name || ''))

  const F = ({ label, value, w = '' }) => (
    <div className={w}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="input bg-gray-50 text-gray-700 truncate">{value || ' '}</div>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Vänster: faktura */}
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-bold tracking-tight">LEVERANTÖRSFAKTURA {inv.lopnr || ''}</span>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
            {verNr && <span className="text-xs text-gray-400">VER.NR: {verNr}</span>}
          </div>
          <div className="flex items-center gap-2.5">
            <button className="btn" onClick={() => navigate('/leverantorsfakturor/ny')}><i className="ti ti-plus" /> Skapa leverantörsfaktura</button>
            <button className="btn font-medium" style={{ background: '#f5c518', color: '#1a1a1a', borderColor: '#f5c518' }} onClick={() => navigate('/leverantorsfakturor')}><i className="ti ti-list" /> Visa lista</button>
            {!panelOpen && <button className="btn" onClick={() => setPanelOpen(true)}><i className="ti ti-photo" /> Visa bilder</button>}
          </div>
        </div>

        <div className="p-7">
          <div className="grid grid-cols-12 gap-4 mb-4">
            <F label="Leverantör" value={inv.suppliers ? `${inv.suppliers.org_nr || ''} - ${inv.suppliers.name}` : '–'} w="col-span-5" />
            <F label="Fakturadatum" value={inv.invoice_date} w="col-span-2" />
            <F label="Förfallodatum" value={inv.due_date} w="col-span-2" />
            <F label="Total" value={fmt(inv.total_amount)} w="col-span-1" />
            <F label="Moms" value={fmt(inv.vat_amount)} w="col-span-2" />
            <F label="OCR" value={inv.ocr} w="col-span-5" />
            <F label="Fakturanummer" value={inv.invoice_nr} w="col-span-4" />
            <F label="Valuta" value={inv.currency || 'SEK'} w="col-span-1" />
            <F label="Kurs" value="1" w="col-span-1" />
            <F label="Enhet" value="1" w="col-span-1" />
          </div>

          {/* Kontering */}
          <div className="text-sm font-medium mb-2">Kontering</div>
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2.5 border-b w-28" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Konto</th>
                  <th className="text-left px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kontobenämning</th>
                  <th className="text-left px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Transaktionsinfo</th>
                  <th className="text-right px-3 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Debet</th>
                  <th className="text-right px-3 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Kredit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 border-b font-medium" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.account_nr}</td>
                    <td className="px-3 py-2.5 border-b text-gray-700" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.account_name}</td>
                    <td className="px-3 py-2.5 border-b text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.transaction_info || ''}</td>
                    <td className="px-3 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.debet ? fmt(r.debet) : ''}</td>
                    <td className="px-3 py-2.5 border-b text-right tabular-nums" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{r.kredit ? fmt(r.kredit) : ''}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-medium">
                  <td colSpan="3" className="px-3 py-2.5 text-right text-gray-500">Summa</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(sumD)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(sumK)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center mt-8 pt-5 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            {!inv.makulerad && stateOf(inv) !== 'slutbetald' && <button className="btn" onClick={makulera}>Makulera</button>}
            <div className="ml-auto flex items-center gap-2.5">
              {!inv.bokford && !inv.makulerad && <button className="btn btn-green" onClick={() => navigate(`/leverantorsfakturor/ny?edit=${inv.id}`)}><i className="ti ti-edit" /> Redigera / Bokför</button>}
              {verNr && <Link to={`/bokforing/${inv.verifikation_id}`} className="btn"><i className="ti ti-book" /> Visa verifikation</Link>}
              <button className="btn btn-primary" onClick={() => navigate('/leverantorsfakturor')}>Stäng</button>
            </div>
          </div>
        </div>
      </div>

      {/* Höger: KOPPLADE BILDER */}
      {panelOpen && (
        coupling ? (
          <div className="w-[44%] border-l bg-white flex flex-col" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-sm font-semibold">KOPPLA BILD</span>
              <button className="btn text-xs py-1 px-2" onClick={() => setCoupling(false)}>Stäng</button>
            </div>
            <div className="flex-1 overflow-hidden"><UnderlagPanel company={{ id: inv.company_id }} onCouple={couple} title="VÄLJ FRÅN INKORGEN" /></div>
          </div>
        ) : (
          <div className="w-[44%] border-l bg-white flex flex-col" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-sm font-semibold">KOPPLADE BILDER {docs.length} ({docs.length})</span>
              <div className="flex items-center gap-3 text-gray-500">
                <button title="Rotera" onClick={() => setRot(r => (r + 90) % 360)}><i className="ti ti-rotate-clockwise" /></button>
                <button title="Zooma in" onClick={() => setScale(s => Math.min(3, s + 0.2))}><i className="ti ti-zoom-in" /></button>
                <button title="Zooma ut" onClick={() => setScale(s => Math.max(0.4, s - 0.2))}><i className="ti ti-zoom-out" /></button>
                {current?.url && <a href={current.url} download title="Ladda ner"><i className="ti ti-download" /></a>}
                <button title="Dölj panel" onClick={() => setPanelOpen(false)}><i className="ti ti-x" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4">
              {docs.length === 0 ? (
                <div className="text-center text-gray-400">
                  <i className="ti ti-photo-off text-4xl block mb-2 opacity-30" />
                  Inga kopplade bilder
                </div>
              ) : !current?.url ? (
                <div className="text-gray-400">Kunde inte ladda bilden</div>
              ) : isImg ? (
                <img src={current.url} alt="" style={{ transform: `scale(${scale}) rotate(${rot}deg)`, transition: 'transform .15s' }} className="max-w-full shadow-lg bg-white" />
              ) : (
                <iframe src={current.url} title="underlag" className="w-full h-full bg-white" style={{ minHeight: '70vh' }} />
              )}
            </div>

            {docs.length > 1 && (
              <div className="px-5 py-2 border-t flex items-center justify-center gap-3 text-sm" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                <button className="btn text-xs py-1 px-2" disabled={idx === 0} onClick={() => { setIdx(i => i - 1); setScale(1); setRot(0) }}><i className="ti ti-chevron-left" /></button>
                <span>{idx + 1} / {docs.length}</span>
                <button className="btn text-xs py-1 px-2" disabled={idx >= docs.length - 1} onClick={() => { setIdx(i => i + 1); setScale(1); setRot(0) }}><i className="ti ti-chevron-right" /></button>
              </div>
            )}

            <div className="px-5 py-3 border-t flex items-center justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              {current && <button className="btn" onClick={() => kopplaBort(current.id)}>Koppla bort</button>}
              <button className="btn btn-green" onClick={() => setCoupling(true)}>Koppla fler</button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
