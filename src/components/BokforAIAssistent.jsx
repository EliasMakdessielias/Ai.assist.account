import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import regelverkMd from '../../docs/AI_BOKFORINGSHJALP_REGELVERK.md?raw'

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
//   openSignal: ökas av föräldern (t.ex. efter "Tolka underlaget") för att öppna panelen + fråga direkt
export default function BokforAIAssistent({ kind = 'verifikation', doc = null, accounts = [], onApply, openSignal = 0 }) {
  const { company, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])   // { role:'user'|'assistant', text }
  const [forslag, setForslag] = useState(null)    // senaste konteringsförslag
  const [meta, setMeta] = useState(null)          // { konfidens, kraver, regelstod, version }
  const [logId, setLogId] = useState(null)        // ai_bokforing_logg-rad för senaste förslag
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const askedRef = useRef(false)
  const endRef = useRef(null)
  const dragRef = useRef(null)

  // Position (avstånd från höger/nederkant). Sparas så knappen ligger kvar där användaren släpper den.
  const FAB = 56, EDGE = 8
  const [pos, setPos] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('bokpilot.aiassist.pos') || 'null'); if (s && typeof s.right === 'number') return s } catch { /* ignore */ }
    return { right: 20, bottom: 20 }
  })
  useEffect(() => { try { localStorage.setItem('bokpilot.aiassist.pos', JSON.stringify(pos)) } catch { /* ignore */ } }, [pos])
  function clampPos(p) {
    const maxR = Math.max(EDGE, window.innerWidth - FAB - EDGE)
    const maxB = Math.max(EDGE, window.innerHeight - FAB - EDGE)
    return { right: Math.min(maxR, Math.max(EDGE, p.right)), bottom: Math.min(maxB, Math.max(EDGE, p.bottom)) }
  }
  useEffect(() => { const onR = () => setPos(p => clampPos(p)); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR) }, [])

  // Dra-och-släpp av knappen. Liten rörelse = klick (öppna/stäng); större = flytt.
  function onFabPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    const s = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false }
    dragRef.current = s
    const move = ev => {
      const dx = ev.clientX - s.x, dy = ev.clientY - s.y
      if (!s.moved && Math.abs(dx) + Math.abs(dy) > 4) s.moved = true
      if (s.moved) setPos(clampPos({ right: s.right - dx, bottom: s.bottom - dy }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      if (!s.moved) { open ? setOpen(false) : openPanel() }   // klick = toggla panelen
      dragRef.current = null
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const kontoplan = useMemo(
    () => accounts.filter(a => a.is_active !== false).map(a => `${a.account_nr} ${a.name}`).join('\n'),
    [accounts])

  // Nytt underlag → nollställ konversationen.
  useEffect(() => { setMessages([]); setForslag(null); setMeta(null); setLogId(null); askedRef.current = false }, [doc?.id])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function ask(fraga) {
    if (busy) return
    // Utan fråga och utan tolkat underlag finns inget att besvara – bjud in till att chatta.
    if (!fraga && !doc?.tolkning) {
      setMessages(m => [...m, { role: 'assistant', text: 'Ställ en fråga om bokföring (svaren kommer från regelverket/källorna), eller koppla och tolka ett underlag så föreslår jag hur det ska bokföras.' }])
      return
    }
    setBusy(true)
    if (fraga) setMessages(m => [...m, { role: 'user', text: fraga }])
    try {
      const { data, error } = await supabase.functions.invoke('bokfor-ai', {
        body: { kind, tolkning: doc?.tolkning || null, kontoplan, fraga: fraga || null, history: messages.slice(-6), kb: regelverkMd },
      })
      if (error) { let msg = error.message; try { const b = await error.context.json(); if (b?.error) msg = b.error } catch { /* ignore */ } throw new Error(msg) }
      if (data?.error) throw new Error(data.error)
      setMessages(m => [...m, { role: 'assistant', text: data.svar || 'Jag kunde inte svara just nu.' }])
      const f = Array.isArray(data.konteringsforslag) ? data.konteringsforslag : []
      const m2 = { konfidens: typeof data.konfidens === 'number' ? data.konfidens : null, kraver: !!data.kraver_manuell_granskning, regelstod: data.regelstod || null, version: data.regelverkVersion || null, kallor: Array.isArray(data.kallor) ? data.kallor : [] }
      setMeta(m2)
      if (f.length) setForslag(f)
      // Spårbarhet: logga förslaget (regelverksversion, confidence, granskning) – best-effort.
      if (f.length && company?.id) {
        try {
          const { data: row } = await supabase.from('ai_bokforing_logg').insert({
            company_id: company.id, document_id: doc?.id || null, kind, fraga: fraga || null, svar: data.svar || null,
            konteringsforslag: f, konfidens: m2.konfidens, kraver_manuell_granskning: m2.kraver,
            regelverk_version: m2.version, model: data.model || null, applied: false, created_by: user?.id || null,
          }).select('id').single()
          setLogId(row?.id || null)
        } catch { /* loggning är icke-kritisk */ }
      }
    } catch (e) {
      const raw = String(e?.message || e)
      const friendly = /Failed to fetch|NetworkError|load failed/i.test(raw)
        ? 'Kunde inte nå AI-tjänsten. Kontrollera anslutningen och försök igen.'
        : raw
      setMessages(m => [...m, { role: 'assistant', text: friendly }])
    }
    setBusy(false)
  }

  function openPanel() {
    setOpen(true)
    if (!askedRef.current && doc?.tolkning) { askedRef.current = true; ask(null) }
  }
  // Föräldern kan be panelen öppnas + fråga direkt (t.ex. efter "Tolka underlaget").
  useEffect(() => {
    if (openSignal > 0 && doc?.tolkning) { setOpen(true); askedRef.current = true; ask(null) }
  }, [openSignal]) // eslint-disable-line react-hooks/exhaustive-deps
  function send() {
    const q = input.trim(); if (!q) return
    setInput(''); ask(q)
  }
  const needsReview = !!meta?.kraver || (meta?.konfidens != null && meta.konfidens < 0.8)
  function applyForslag() {
    if (!forslag || !onApply) return
    if (needsReview && !window.confirm('AI:n flaggar osäkerhet eller att mänsklig granskning krävs. Förslaget infogas endast för granskning – du bokför själv. Fortsätta?')) return
    onApply(forslag)
    if (logId) supabase.from('ai_bokforing_logg').update({ applied: true }).eq('id', logId).then(() => {}, () => {})
  }

  const glow = !open && doc?.tolkad   // bjud in när ett tolkat underlag är kopplat

  // Placera panelen över eller under knappen beroende på var det finns mest plats.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const fabTop = vh - pos.bottom - FAB
  const placeAbove = fabTop >= pos.bottom
  const panelMaxH = Math.min(560, Math.max(220, (placeAbove ? fabTop : pos.bottom) - 12))
  const panelStyle = placeAbove
    ? { right: pos.right, bottom: pos.bottom + FAB + 12, maxHeight: panelMaxH }
    : { right: pos.right, top: fabTop + FAB + 12, maxHeight: panelMaxH }

  return (
    <>
      {open && (
        <div className="fixed z-40 w-[360px] max-w-[calc(100vw-2.5rem)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden no-print"
          style={{ ...panelStyle, border: '1px solid rgba(0,0,0,0.12)' }}>
          <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ background: 'linear-gradient(90deg,#6d28d9,#7c3aed)' }}>
            <span className="text-white text-sm font-semibold flex items-center gap-2"><i className="ti ti-sparkles" /> AI-bokföringshjälp</span>
            <button className="text-white/80 hover:text-white text-lg" onClick={() => setOpen(false)} title="Stäng"><i className="ti ti-x" /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-surface-3">
            {messages.length === 0 && !busy && (
              <div className="text-center text-gray-400 text-sm py-6">
                <i className="ti ti-receipt-2 text-3xl block mb-2 opacity-30" />
                {doc?.tolkad ? 'Fråga hur det kopplade underlaget ska bokföras – eller ställ en bokföringsfråga.' : 'Ställ en bokföringsfråga – svaren kommer från regelverket/källorna. Koppla ett underlag för konteringsförslag.'}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] text-sm rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`}
                  style={m.role === 'user' ? undefined : { border: '0.5px solid rgba(0,0,0,0.10)' }}>{m.text}</div>
              </div>
            ))}
            {busy && <div className="flex justify-start"><div className="bg-white text-gray-400 text-sm rounded-2xl rounded-bl-sm px-3 py-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>Tänker…</div></div>}

            {!busy && needsReview && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[13px] text-amber-800 flex items-start gap-2">
                <i className="ti ti-alert-triangle-filled text-amber-500 mt-0.5 shrink-0" />
                <span>Mänsklig granskning krävs{meta?.konfidens != null ? ` (säkerhet ${Math.round(meta.konfidens * 100)} %)` : ''}. Kontrollera underlaget innan du bokför.</span>
              </div>
            )}

            {forslag && onApply && (
              <div className="bg-white rounded-xl p-3" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Konteringsförslag</span>
                  {meta?.konfidens != null && <span className="text-[11px] text-gray-400">säkerhet {Math.round(meta.konfidens * 100)} %</span>}
                </div>
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
                {meta?.regelstod && <div className="text-[11px] text-gray-500 mt-1.5"><i className="ti ti-book-2 mr-1" />{meta.regelstod}</div>}
                <button className={`btn w-full mt-2 justify-center ${needsReview ? '' : 'btn-green'}`} onClick={applyForslag}>
                  <i className="ti ti-arrow-down-to-arc" /> {needsReview ? 'Infoga för granskning' : 'Använd förslaget'}
                </button>
                <div className="text-[11px] text-gray-400 mt-1.5 text-center">
                  Granska alltid förslaget innan du bokför.{meta?.version ? ` · Bygger på Bokpilots regelverk v${meta.version}` : ''}
                </div>
              </div>
            )}
            {!busy && meta && messages.some(m => m.role === 'assistant') && (
              <div className="bg-white rounded-xl p-3" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><i className="ti ti-books" /> Källor</div>
                <div className="flex flex-wrap gap-1.5">
                  {(meta.kallor?.length ? meta.kallor : [{ label: `BokPilots regelverk${meta.version ? ` v${meta.version}` : ''}`, avsnitt: null }]).map((k, i) => (
                    <a key={i} href={`/regelverk${k.avsnitt ? `#avsnitt-${k.avsnitt}` : ''}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full px-2.5 py-0.5" title="Öppna källan i regelverket">
                      <i className="ti ti-book-2" /> {k.label || (k.avsnitt ? `Avsnitt ${k.avsnitt}` : 'Källa')}
                    </a>
                  ))}
                </div>
                <div className="text-[10px] text-gray-400 mt-1.5">Svaren kommer från BokPilots regelverk{meta.version ? ` v${meta.version}` : ''} (sammanfattning av de inmatade källorna). Klicka för att öppna källan.</div>
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

      <button onPointerDown={onFabPointerDown}
        className={`fixed z-40 w-14 h-14 rounded-full text-white flex items-center justify-center no-print ${glow ? 'ai-glow' : 'shadow-lg'}`}
        style={{ right: pos.right, bottom: pos.bottom, background: 'linear-gradient(135deg,#6d28d9,#7c3aed)', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
        title="AI-bokföringshjälp – dra för att flytta">
        <i className={`ti ${open ? 'ti-x' : 'ti-sparkles'} text-2xl`} />
      </button>
    </>
  )
}
