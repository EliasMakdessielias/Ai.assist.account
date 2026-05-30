import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

const FORSLAG = [
  'Hur mycket har jag på banken?',
  'Hur mycket moms ska jag betala?',
  'Vilka leverantörsfakturor förfaller snart?',
  'Visa resultatet hittills i år',
  'Vilka är mina största kostnader?',
]

export default function Assistent() {
  const { company } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [ctx, setCtx] = useState(null)
  const endRef = useRef()

  useEffect(() => { if (company) buildContext() }, [company?.id])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function buildContext() {
    const [{ data: accs }, { data: rows }, { data: fy }, { data: sup }, { data: cust }] = await Promise.all([
      supabase.from('accounts').select('account_nr, name, opening_balance').eq('company_id', company.id),
      supabase.from('verifikation_rows').select('account_nr, debet, kredit, verifikationer!inner(company_id, datum)').eq('verifikationer.company_id', company.id),
      supabase.from('fiscal_years').select('*').eq('company_id', company.id).order('year', { ascending: false }),
      supabase.from('supplier_invoices').select('total_amount, paid_amount, status, makulerad, due_date, invoice_nr, suppliers(name)').eq('company_id', company.id).eq('status', 'unpaid'),
      supabase.from('invoices').select('total_amount, status, invoice_nr, customers(name)').eq('company_id', company.id).eq('status', 'sent'),
    ])
    const active = (fy || []).find(y => y.status === 'active') || (fy || [])[0]
    const from = active?.start_date || `${new Date().getFullYear()}-01-01`
    const tom = active?.end_date || `${new Date().getFullYear()}-12-31`
    const OB = nr => (accs || []).find(a => a.account_nr === nr)?.opening_balance || 0
    const accName = nr => (accs || []).find(a => a.account_nr === nr)?.name || nr
    const belopp = r => (r.debet || 0) - (r.kredit || 0)
    const saldo = pre => (accs || []).filter(a => pre.test(a.account_nr)).reduce((s, a) => s + OB(a.account_nr) + (rows || []).filter(r => r.account_nr === a.account_nr && r.verifikationer.datum <= tom).reduce((t, r) => t + belopp(r), 0), 0)
    const periodSum = pre => (rows || []).filter(r => pre.test(r.account_nr) && r.verifikationer.datum >= from && r.verifikationer.datum <= tom).reduce((t, r) => t + belopp(r), 0)

    const intakter = -periodSum(/^3/)
    const kostnader = periodSum(/^[4-7]/)
    const finans = periodSum(/^8/)
    const resultat = intakter - kostnader - finans
    const utgMoms = -periodSum(/^26[123]/)
    const ingMoms = periodSum(/^264/)

    // Top kostnadskonton
    const kByKonto = {}
    ;(rows || []).filter(r => /^[4-7]/.test(r.account_nr) && r.verifikationer.datum >= from && r.verifikationer.datum <= tom).forEach(r => { kByKonto[r.account_nr] = (kByKonto[r.account_nr] || 0) + belopp(r) })
    const toppKostnader = Object.entries(kByKonto).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([nr, v]) => ({ konto: `${nr} ${accName(nr)}`, belopp: Math.round(v) }))

    const obetaldaLev = (sup || []).filter(s => !s.makulerad).map(s => ({ leverantor: s.suppliers?.name || '', fakturanr: s.invoice_nr || '', belopp: Math.round((s.total_amount || 0) - (s.paid_amount || 0)), forfaller: s.due_date, forfallen: s.due_date && s.due_date < today() }))
      .sort((a, b) => String(a.forfaller).localeCompare(String(b.forfaller))).slice(0, 12)
    const obetaldaKund = (cust || []).map(c => ({ kund: c.customers?.name || '', fakturanr: c.invoice_nr || '', belopp: Math.round(c.total_amount || 0) })).slice(0, 12)

    setCtx({
      period: { from, tom },
      bokforingsmetod: company.bokforingsmetod || 'faktura',
      momsperiod: company.momsperiod || null,
      likvida_medel: Math.round(saldo(/^19/)),
      kundfordringar: Math.round(saldo(/^1510/)),
      leverantorsskulder: Math.round(saldo(/^2440/)),
      resultat_hittills: Math.round(resultat),
      intakter: Math.round(intakter),
      kostnader: Math.round(kostnader),
      finansiella_poster: Math.round(finans),
      moms: { utgaende: Math.round(utgMoms), ingaende: Math.round(ingMoms), att_betala: Math.round(utgMoms - ingMoms) },
      topp_kostnader: toppKostnader,
      obetalda_leverantorsfakturor: { antal: (sup || []).length, summa: obetaldaLev.reduce((s, x) => s + x.belopp, 0), lista: obetaldaLev },
      obetalda_kundfakturor: { antal: (cust || []).length, summa: obetaldaKund.reduce((s, x) => s + x.belopp, 0), lista: obetaldaKund },
    })
  }

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    const newMsgs = [...messages, { role: 'user', text: q }]
    setMessages(newMsgs)
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('assistent-ai', { body: { question: q, context: ctx, history: messages } })
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error)
      setMessages([...newMsgs, { role: 'assistant', text: data.svar }])
    } catch (e) { setMessages([...newMsgs, { role: 'assistant', text: '⚠️ ' + (e.message || e) }]) }
    setBusy(false)
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="bg-white border-b px-7 h-14 flex items-center justify-between shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-sparkles text-purple-600" /> AI-assistent</span>
        {messages.length > 0 && <button className="btn text-xs py-1 px-3" onClick={() => setMessages([])}>Ny chatt</button>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-10">
              <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center mx-auto mb-3"><i className="ti ti-message-chatbot text-2xl text-purple-600" /></div>
              <div className="font-medium text-gray-800 mb-1">Fråga om din bokföring</div>
              <div className="text-sm text-gray-500 mb-5">Jag svarar utifrån {company?.name}:s data. Jag ändrar inget – bara läser och räknar.</div>
              <div className="flex flex-col gap-2 max-w-md mx-auto">
                {FORSLAG.map(f => <button key={f} className="text-left text-sm px-4 py-2.5 rounded-xl bg-white hover:bg-gray-50" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }} onClick={() => send(f)} disabled={!ctx}>{f}</button>)}
              </div>
              {!ctx && <div className="text-xs text-gray-400 mt-4">Laddar din ekonomidata…</div>}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-white text-gray-800'}`} style={m.role === 'user' ? {} : { border: '0.5px solid rgba(0,0,0,0.10)' }}>{m.text}</div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="bg-white rounded-2xl px-4 py-2.5 text-sm text-gray-400" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>Tänker…</div></div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t bg-white px-4 py-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea className="input flex-1 resize-none" rows={1} placeholder="Skriv en fråga…" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} disabled={!ctx} />
          <button className="text-white rounded-lg px-4 py-2.5" style={{ background: '#6d28d9' }} onClick={() => send()} disabled={busy || !input.trim() || !ctx}><i className="ti ti-send" /></button>
        </div>
        <div className="max-w-2xl mx-auto text-[11px] text-gray-400 mt-1.5 text-center">AI-assistenten är ett beslutsstöd och kan ha fel – kontrollera viktiga siffror. Inga ändringar görs.</div>
      </div>
    </div>
  )
}
