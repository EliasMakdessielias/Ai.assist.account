import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'

// AI-stöd för bokföring av ett kopplat underlag (kvitto/leverantörsfaktura).
// Diskret, glödande knapp (FAB) nere till höger. När ett underlag är kopplat och tolkat
// "lyser" knappen mjukt för att bjuda in – annars vilar den. Panelen förklarar hur underlaget
// bör bokföras och kan ge ett konteringsförslag som användaren själv väljer att tillämpa.
//
// Props:
//   kind: 'leverantorsfaktura' | 'kvitto' | 'verifikation'
//   doc: aktuellt kopplat dokument ({ id, file_name, tolkning, tolkad }) eller null
//   accounts: [{ account_nr, name, is_active }] – kontoplan som AI-kontext
//   onApply(konteringsforslag): fyll formulärets rader (förälder mappar till sin radform)
export default function BokforAIAssistent({ kind = 'verifikation', doc = null, accounts = [], onApply }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])   // { role:'user'|'assistant', text }
  const [forslag, setForslag] = useState(null)    // senaste konteringsförslag
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const askedRef = useRef(false)
  const endRef = useRef(null)

  const kontoplan = useMemo(
    () => accounts.filter(a => a.is_active !== false).map(a => `${a.account_nr} ${a.name}`).join('\n'),
    [accounts])

  // Nytt underlag → nollställ konversationen.
  useEffect(() => { setMessages([]); setForslag(null); askedRef.current = false }, [doc?.id])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function ask(fraga) {
    if (busy) return
    if (!doc?.tolkning) {
      setMessages(m => [...m, ...(fraga ? [{ role: 'user', text: fraga }] : []),
        { role: 'assistant', text: 'Koppla ett underlag (bild/PDF) och klicka "Tolka underlaget" först – då kan jag föreslå hur det ska bokföras.' }])
      return
    }
    setBusy(true)
    if (fraga) setMessages(m => [...m, { role: 'user', text: fraga }])
    try {
      const { data, error } = await supabase.functions.invoke('bokfor-ai', {
        body: { kind, tolkning: doc.tolkning, kontoplan, fraga: fraga || null, history: messages.slice(-6) },
      })
      if (error) { let msg = error.message; try { const b = await error.context.json(); if (b?.error) msg = b.error } catch { /* ignore */ } throw new Error(msg) }
      if (data?.error) throw new Error(data.error)
      setMessages(m => [...m, { role: 'assistant', text: data.svar || 'Jag kunde inte svara just nu.' }])
      if (Array.isArray(data.konteringsforslag) && data.konteringsforslag.length) setForslag(data.konteringsforslag)
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: 'Kunde inte svara: ' + (e.message || e) }])
    }
    setBusy(false)
  }

  function openPanel() {
    setOpen(true)
    if (!askedRef.current && doc?.tolkning) { askedRef.current = true; ask(null) }
  }
  function send() {
    const q = input.trim(); if (!q) return
    setInput(''); ask(q)
  }
  function applyForslag() {
    if (forslag && onApply) onApply(forslag)
  }

  const glow = !open && doc?.tolkad   // bjud in när ett tolkat underlag är kopplat

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 no-print">
      {open && (
        <div className="w-[360px] max-w-[calc(100vw-2.5rem)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ border: '1px solid rgba(0,0,0,0.12)', maxHeight: 'min(70vh, 560px)' }}>
          <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ background: 'linear-gradient(90deg,#6d28d9,#7c3aed)' }}>
            <span className="text-white text-sm font-semibold flex items-center gap-2"><i className="ti ti-sparkles" /> AI-bokföringshjälp</span>
            <button className="text-white/80 hover:text-white text-lg" onClick={() => setOpen(false)} title="Stäng"><i className="ti ti-x" /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-surface-3">
            {messages.length === 0 && !busy && (
              <div className="text-center text-gray-400 text-sm py-6">
                <i className="ti ti-receipt-2 text-3xl block mb-2 opacity-30" />
                {doc?.tolkad ? 'Fråga hur det kopplade underlaget ska bokföras.' : 'Koppla och tolka ett underlag så hjälper jag dig bokföra det.'}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] text-sm rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`}
                  style={m.role === 'user' ? undefined : { border: '0.5px solid rgba(0,0,0,0.10)' }}>{m.text}</div>
              </div>
            ))}
            {busy && <div className="flex justify-start"><div className="bg-white text-gray-400 text-sm rounded-2xl rounded-bl-sm px-3 py-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>Tänker…</div></div>}

            {forslag && onApply && (
              <div className="bg-white rounded-xl p-3" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Konteringsförslag</div>
                <table className="w-full text-[13px] tabular-nums">
                  <tbody>
                    {forslag.map((r, i) => (
                      <tr key={i}>
                        <td className="py-0.5 pr-2 font-medium">{r.konto}</td>
                        <td className="py-0.5 pr-2 text-gray-500 truncate">{r.benamning || ''}</td>
                        <td className="py-0.5 text-right">{r.debet ? Number(r.debet).toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="py-0.5 text-right pl-2">{r.kredit ? Number(r.kredit).toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn-green w-full mt-2 justify-center" onClick={applyForslag}><i className="ti ti-arrow-down-to-arc" /> Använd förslaget</button>
                <div className="text-[11px] text-gray-400 mt-1.5 text-center">Granska alltid förslaget innan du bokför.</div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="px-3 py-2.5 bg-white shrink-0 flex items-end gap-2" style={{ borderTop: '1px solid rgba(0,0,0,0.10)' }}>
            <textarea className="input flex-1 resize-none" rows={1} placeholder="Fråga om bokföringen…" value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button className="btn btn-primary px-3" onClick={send} disabled={busy || !input.trim()} title="Skicka"><i className="ti ti-send" /></button>
          </div>
        </div>
      )}

      <button onClick={() => (open ? setOpen(false) : openPanel())}
        className={`w-14 h-14 rounded-full text-white flex items-center justify-center shrink-0 ${glow ? 'ai-glow' : 'shadow-lg'}`}
        style={{ background: 'linear-gradient(135deg,#6d28d9,#7c3aed)' }}
        title="AI-bokföringshjälp">
        <i className={`ti ${open ? 'ti-x' : 'ti-sparkles'} text-2xl`} />
      </button>
    </div>
  )
}
