import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import Utbetalningar from '../components/Utbetalningar'

const fmt = n => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }

const TABS = ['Leverantörsfakturor', 'Utbetalningar', 'Inkomna fakturor', 'Skicka för tolkning']
const PAGE_SIZE = 100

// Status-definitioner (matchar Spiris färgkodning)
const STATES = {
  ejbokford: { label: 'Ej bokförd', dot: '#eab308', row: 'rgba(234,179,8,0.07)' },
  obetald: { label: 'Obetald', dot: '#f87171', row: 'rgba(248,113,113,0.06)' },
  forfallen: { label: 'Obetald förfallen', dot: '#dc2626', row: 'rgba(220,38,38,0.09)' },
  under: { label: 'Under betalning', dot: '#818cf8', row: 'rgba(129,140,248,0.08)' },
  slutbetald: { label: 'Slutbetald', dot: '#34d399', row: 'rgba(52,211,153,0.10)' },
  makulerad: { label: 'Makulerad', dot: '#9ca3af', row: 'rgba(156,163,175,0.10)' },
}
const CHIPS = [
  { key: 'attHantera', label: 'Att hantera', dot: '#6b7280' },
  { key: 'all', label: 'Alla', dot: null },
  { key: 'ejbokford', label: 'Ej bokförda', dot: STATES.ejbokford.dot },
  { key: 'obetald', label: 'Obetalda', dot: STATES.obetald.dot },
  { key: 'forfallen', label: 'Obetalda förfallna', dot: STATES.forfallen.dot },
  { key: 'under', label: 'Under betalning', dot: STATES.under.dot },
  { key: 'slutbetald', label: 'Slutbetalda', dot: STATES.slutbetald.dot },
  { key: 'makulerad', label: 'Makulerade', dot: STATES.makulerad.dot },
]

const emptyForm = () => ({ supplier_id: '', invoice_nr: '', ocr: '', invoice_date: today(), due_date: addDays(today(), 30), excl: '', vat_rate: 25, kostnadskonto: '4000', currency: 'SEK' })

export default function Leverantorsfakturor() {
  const { company, user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState(0)
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [banks, setBanks] = useState([])
  const [bank, setBank] = useState('1930')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [sel, setSel] = useState(new Set())
  const [page, setPage] = useState(0)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (company) load() }, [company?.id])

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: sup }, { data: bk }] = await Promise.all([
      supabase.from('supplier_invoices').select('*, suppliers(name, org_nr, bankgiro)').eq('company_id', company.id).order('invoice_date', { ascending: false }),
      supabase.from('suppliers').select('id, name, org_nr').eq('company_id', company.id).order('name'),
      supabase.from('accounts').select('account_nr, name').eq('company_id', company.id).like('account_nr', '19%').eq('is_active', true).order('account_nr'),
    ])
    setItems(inv || [])
    setSuppliers(sup || [])
    setBanks(bk || [])
    if ((bk || []).length && !(bk || []).some(b => b.account_nr === bank)) setBank((bk.find(b => b.account_nr === '1930') || bk[0]).account_nr)
    setSel(new Set())
    setLoading(false)
  }

  const todayStr = today()
  function stateOf(i) {
    if (i.makulerad) return 'makulerad'
    const total = i.total_amount || 0, paid = i.paid_amount || 0
    if (total > 0 && paid >= total - 0.005) return 'slutbetald'
    if (paid > 0.005) return 'under'
    if (!i.bokford) return 'ejbokford'
    return i.due_date < todayStr ? 'forfallen' : 'obetald'
  }

  const enriched = useMemo(() => items.map(i => ({ ...i, _state: stateOf(i), _saldo: (i.total_amount || 0) - (i.paid_amount || 0) })), [items])

  const matchFilter = i => {
    if (filter === 'all') return true
    if (filter === 'attHantera') return ['ejbokford', 'forfallen'].includes(i._state)
    return i._state === filter
  }
  const matchSearch = i => !search || `${i.lopnr || ''} ${i.suppliers?.org_nr || ''} ${i.suppliers?.name || ''} ${i.ocr || ''} ${i.invoice_nr || ''}`.toLowerCase().includes(search.toLowerCase())

  const filtered = enriched.filter(i => matchFilter(i) && matchSearch(i))
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE)

  const counts = useMemo(() => {
    const c = { all: enriched.length, attHantera: 0 }
    Object.keys(STATES).forEach(k => c[k] = 0)
    enriched.forEach(i => { c[i._state]++; if (['ejbokford', 'forfallen'].includes(i._state)) c.attHantera++ })
    return c
  }, [enriched])

  const selItems = enriched.filter(i => sel.has(i.id))
  const selSum = selItems.reduce((s, i) => s + (i._saldo || i.total_amount || 0), 0)
  const canBokfor = selItems.length > 0 && selItems.every(i => !i.bokford && !i.makulerad)
  const canBetala = selItems.length > 0 && selItems.every(i => i.bokford && i._state !== 'slutbetald' && !i.makulerad)

  function toggle(id) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function toggleAll() {
    const ids = pageRows.map(r => r.id)
    const allSel = ids.every(id => sel.has(id))
    setSel(s => { const n = new Set(s); ids.forEach(id => allSel ? n.delete(id) : n.add(id)); return n })
  }

  // --- Skapa ---
  const fvat = form ? num(form.excl) * (num(form.vat_rate) / 100) : 0
  const ftotal = form ? num(form.excl) + fvat : 0
  async function save() {
    if (!form.supplier_id) return toast.error('Välj en leverantör')
    if (num(form.excl) <= 0) return toast.error('Ange belopp')
    setSaving(true)
    const lopnr = Math.max(0, ...items.map(i => i.lopnr || 0)) + 1
    const { error } = await supabase.from('supplier_invoices').insert({
      company_id: company.id, supplier_id: form.supplier_id, invoice_nr: form.invoice_nr || null, ocr: form.ocr || null,
      invoice_date: form.invoice_date, due_date: form.due_date, currency: form.currency || 'SEK',
      amount_excl_vat: num(form.excl), vat_amount: fvat, total_amount: ftotal, kostnadskonto: form.kostnadskonto || '4000',
      status: 'unpaid', lopnr,
    })
    setSaving(false)
    if (error) return toast.error('Kunde inte spara: ' + error.message)
    toast.success('Leverantörsfaktura registrerad')
    setForm(null); load()
  }

  async function aktiveraKonton(nrs) {
    const used = [...new Set(nrs)]
    await supabase.from('accounts').update({ is_active: true }).eq('company_id', company.id).in('account_nr', used).eq('is_active', false)
  }

  // --- Bokför markerade ---
  async function bokforMarkerade() {
    if (!canBokfor) return
    setBusy(true)
    try {
      for (const i of selItems) {
        const rows = []
        rows.push({ nr: i.kostnadskonto || '4000', name: '', debet: i.amount_excl_vat || 0, kredit: 0 })
        if ((i.vat_amount || 0) > 0.005) rows.push({ nr: '2640', name: 'Ingående moms', debet: i.vat_amount, kredit: 0 })
        rows.push({ nr: '2440', name: 'Leverantörsskulder', debet: 0, kredit: i.total_amount || 0 })
        const td = rows.reduce((s, r) => s + r.debet, 0), tk = rows.reduce((s, r) => s + r.kredit, 0)
        const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: 'L - Leverantörsfaktura' })
        const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
          company_id: company.id, ver_nr: nr || 'L' + Date.now(), ver_serie: 'L - Leverantörsfaktura',
          datum: i.invoice_date, beskrivning: `Lev.faktura ${i.suppliers?.name || ''} ${i.invoice_nr || ''}`.trim(),
          total_debet: td, total_kredit: tk, created_by: user.id,
        }).select().single()
        if (e1) throw e1
        await supabase.from('verifikation_rows').insert(rows.map((r, ix) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: r.name, debet: r.debet, kredit: r.kredit, sort_order: ix })))
        await aktiveraKonton(rows.map(r => r.nr))
        await supabase.from('supplier_invoices').update({ bokford: true, verifikation_id: ver.id }).eq('id', i.id)
      }
      toast.success(`${selItems.length} faktura(or) bokförd(a)`)
      load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setBusy(false)
  }

  // --- Betala markerade ---
  async function betalaMarkerade() {
    if (!canBetala) return
    const bk = banks.find(b => b.account_nr === bank)
    setBusy(true)
    try {
      for (const i of selItems) {
        const saldo = (i.total_amount || 0) - (i.paid_amount || 0)
        if (saldo <= 0.005) continue
        const rows = [
          { nr: '2440', name: 'Leverantörsskulder', debet: saldo, kredit: 0 },
          { nr: bank, name: bk?.name || 'Bank', debet: 0, kredit: saldo },
        ]
        const td = rows.reduce((s, r) => s + r.debet, 0), tk = rows.reduce((s, r) => s + r.kredit, 0)
        const { data: nr } = await supabase.rpc('next_ver_nr', { p_company_id: company.id, p_serie: 'U - Utbetalning' })
        const { data: ver, error: e1 } = await supabase.from('verifikationer').insert({
          company_id: company.id, ver_nr: nr || 'U' + Date.now(), ver_serie: 'U - Utbetalning',
          datum: todayStr, beskrivning: `Betalning ${i.suppliers?.name || ''} ${i.invoice_nr || ''}`.trim(),
          total_debet: td, total_kredit: tk, created_by: user.id,
        }).select().single()
        if (e1) throw e1
        await supabase.from('verifikation_rows').insert(rows.map((r, ix) => ({ verifikation_id: ver.id, account_nr: r.nr, account_name: r.name, debet: r.debet, kredit: r.kredit, sort_order: ix })))
        await aktiveraKonton(rows.map(r => r.nr))
        await supabase.from('supplier_invoices').update({ paid_amount: i.total_amount, paid_date: todayStr, status: 'paid', betalning_ver_id: ver.id }).eq('id', i.id)
      }
      toast.success('Betalning bokförd')
      load()
    } catch (e) { toast.error('Fel: ' + e.message) }
    setBusy(false)
  }

  async function makulera(i) {
    if (!confirm(`Makulera faktura ${i.lopnr || ''} (${i.suppliers?.name})?`)) return
    await supabase.from('supplier_invoices').update({ makulerad: true }).eq('id', i.id)
    toast.success('Makulerad'); load()
  }

  const Th = ({ children, r }) => <th className={`${r ? 'text-right' : 'text-left'} px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b whitespace-nowrap`} style={{ borderColor: 'rgba(0,0,0,0.10)' }}>{children}</th>
  const Td = ({ children, r, cls = '' }) => <td className={`px-3 py-2.5 border-b ${r ? 'text-right tabular-nums' : ''} ${cls}`} style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{children}</td>
  const inboxAddr = `inbox.lev.${(company?.id || '').slice(0, 7)}@bocker-arkiv.se`

  return (
    <div className="pb-20">
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="flex gap-0 -mb-px h-full items-stretch">
          {TABS.map((t, i) => (
            <button key={i} onClick={() => setTab(i)} className={`px-4 text-[13.5px] whitespace-nowrap border-b-[2.5px] transition-colors ${i === tab ? 'text-gray-900 font-medium border-blue-700' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>{t}</button>
          ))}
        </div>
      </div>

      {tab === 1 ? <Utbetalningar /> : tab !== 0 ? (
        <div className="text-center py-20 text-gray-400">
          <i className="ti ti-tools text-3xl block mb-2 opacity-30" />
          {TABS[tab]} – kommer snart
        </div>
      ) : (
        <div className="p-7">
          {/* Rubrik-rad */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-[15px] font-bold tracking-tight">LEVERANTÖRSFAKTUROR – LISTA</span>
            <div className="relative">
              <input className="input pl-8 w-80" placeholder="Löpnr, Leverantörsnr, Namn, OCR/Faktnr" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            </div>
            <button className="text-sm text-blue-700 hover:underline" onClick={() => setAdvanced(a => !a)}>{advanced ? 'Stäng utökad sökning' : 'Utökad sökning'}</button>
            <button className="btn ml-auto font-medium" style={{ background: '#f5c518', color: '#1a1a1a', borderColor: '#f5c518' }} onClick={() => setForm(emptyForm())}><i className="ti ti-plus" /> Skapa leverantörsfaktura</button>
          </div>

          {/* Verktygsrad */}
          <div className="flex items-center justify-end gap-5 mb-4 text-[13px] text-gray-500 flex-wrap">
            <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => { navigator.clipboard?.writeText(inboxAddr); toast.success('E-postadress kopierad') }} title="Kopiera adress">
              <i className="ti ti-mail" /> E-posta in underlag: <span className="text-gray-700">{inboxAddr}</span>
            </button>
            <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })}><i className="ti ti-photo" /> Ladda ner kopplade bilder</button>
            <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => window.print()}><i className="ti ti-printer" /> Skriv ut lista</button>
            <button className="flex items-center gap-1.5 hover:text-gray-800" onClick={() => toast('Kommer snart', { icon: 'ℹ️' })}><i className="ti ti-refresh" /> Behandla betalfiler</button>
          </div>

          {/* Statuschips */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {CHIPS.map(c => (
              <button key={c.key} onClick={() => { setFilter(c.key); setPage(0) }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] border transition-colors ${filter === c.key ? 'bg-gray-100 border-gray-400 text-gray-900 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {c.dot && <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.dot }} />}
                {c.label}
                <span className="text-gray-400">{counts[c.key] ?? 0}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
              <span>{filtered.length} st</span>
              {pageCount > 1 && (
                <div className="flex items-center gap-1.5">
                  <button className="btn text-xs py-1 px-2" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}><i className="ti ti-chevron-left" /></button>
                  <span>{curPage + 1} / {pageCount}</span>
                  <button className="btn text-xs py-1 px-2" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}><i className="ti ti-chevron-right" /></button>
                </div>
              )}
            </div>
          </div>

          {/* Tabell */}
          <div className="bg-white rounded-xl overflow-x-auto" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2.5 border-b w-8" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
                    <input type="checkbox" checked={pageRows.length > 0 && pageRows.every(r => sel.has(r.id))} onChange={toggleAll} />
                  </th>
                  <Th>Löpnr</Th><Th>Typ</Th><Th>Leverantörsnr</Th><Th>Namn</Th><Th>OCR</Th><Th>Faktnr</Th>
                  <Th>Fakturadatum</Th><Th>Förfallodatum</Th><Th r>Totalt</Th><Th r>Saldo</Th><Th r>Moms</Th><Th>Valuta</Th><Th>Slutbetald</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="15" className="text-center py-12 text-gray-400">Laddar…</td></tr>
                ) : pageRows.length === 0 ? (
                  <tr><td colSpan="15" className="text-center py-12 text-gray-400"><i className="ti ti-file-import text-3xl block mb-2 opacity-30" />{items.length ? 'Inga i denna vy.' : 'Inga leverantörsfakturor än.'}</td></tr>
                ) : pageRows.map(i => {
                  const st = STATES[i._state]
                  return (
                    <tr key={i.id} className="hover:brightness-95 transition-all" style={{ background: st?.row }}>
                      <td className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.06)' }}><input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
                      <Td>{i.lopnr || '–'}</Td>
                      <Td>F</Td>
                      <Td cls="text-gray-600">{i.suppliers?.org_nr || '–'}</Td>
                      <Td cls="font-medium">{i.suppliers?.name || '–'}</Td>
                      <Td cls="text-gray-600">{i.ocr || ''}</Td>
                      <Td cls="text-gray-600">{i.invoice_nr || ''}</Td>
                      <Td cls="text-gray-600">{i.invoice_date}</Td>
                      <Td cls="text-gray-600">{i.due_date}</Td>
                      <Td r>{fmt(i.total_amount)}</Td>
                      <Td r>{fmt(i._saldo)}</Td>
                      <Td r>{fmt(i.vat_amount)}</Td>
                      <Td cls="text-gray-600">{i.currency || 'SEK'}</Td>
                      <Td cls="text-gray-600">{i.paid_date || ''}</Td>
                      <Td>
                        <div className="flex items-center gap-2 text-gray-300">
                          {i.verifikation_id && <button title="Visa verifikation" className="hover:text-blue-600" onClick={() => navigate(`/bokforing/${i.verifikation_id}`)}><i className="ti ti-eye" /></button>}
                          {!i.makulerad && i._state !== 'slutbetald' && <button title="Makulera" className="hover:text-red-600" onClick={() => makulera(i)}><i className="ti ti-ban" /></button>}
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottenrad: markerade + åtgärder */}
      {tab === 0 && (
        <div className="fixed bottom-0 left-[230px] right-0 bg-white border-t px-7 py-3 flex items-center gap-4 z-20" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="text-[13px] text-gray-500">
            <div>({sel.size} markerade)</div>
            <div>Summa SEK markerade: <b className="text-gray-800 tabular-nums">{fmt(selSum)}</b></div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <button className="btn" disabled={!selItems.length} onClick={() => window.print()}>Skriv ut verifikation</button>
            <button className="btn btn-primary" disabled={!canBokfor || busy} onClick={bokforMarkerade}>{busy ? '…' : 'Bokför'}</button>
            <select className="input w-48" value={bank} onChange={e => setBank(e.target.value)}>
              {banks.length === 0 && <option value="1930">1930 – Företagskonto</option>}
              {banks.map(b => <option key={b.account_nr} value={b.account_nr}>{b.account_nr} – {b.name}</option>)}
            </select>
            <button className="btn btn-green px-6" disabled={!canBetala || busy} onClick={betalaMarkerade}>{busy ? '…' : 'Betala'}</button>
          </div>
        </div>
      )}

      {/* Skapa-modal */}
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setForm(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Skapa leverantörsfaktura</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setForm(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Leverantör *</label>
                <select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">Välj leverantör…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.org_nr ? ` (${s.org_nr})` : ''}</option>)}
                </select>
                {suppliers.length === 0 && <div className="text-xs text-amber-700 mt-1">Inga leverantörer än – lägg till under Leverantörer.</div>}
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Fakturanummer</label><input className="input" value={form.invoice_nr} onChange={e => setForm(f => ({ ...f, invoice_nr: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">OCR</label><input className="input" value={form.ocr} onChange={e => setForm(f => ({ ...f, ocr: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Fakturadatum</label><input className="input" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Förfallodatum</label><input className="input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Kostnadskonto</label><input className="input" value={form.kostnadskonto} onChange={e => setForm(f => ({ ...f, kostnadskonto: e.target.value }))} placeholder="4000" /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Momssats</label>
                <select className="input" value={form.vat_rate} onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))}>
                  <option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option>
                </select>
              </div>
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-500 mb-1">Belopp exkl. moms *</label><input className="input" inputMode="decimal" value={form.excl} onChange={e => setForm(f => ({ ...f, excl: e.target.value }))} placeholder="0,00" /></div>
              <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex justify-between py-0.5"><span className="text-gray-500">Moms</span><span className="tabular-nums">{fmt(fvat)}</span></div>
                <div className="flex justify-between py-0.5 font-semibold"><span>Totalt</span><span className="tabular-nums">{fmt(ftotal)} kr</span></div>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2.5" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <button className="btn" onClick={() => setForm(null)} disabled={saving}>Avbryt</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Sparar…' : 'Registrera'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
