import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const REGISTERS = {
  kunder: { namn: 'kundregister', table: 'customers', allow: ['name', 'org_nr', 'contact_person', 'email', 'phone', 'address', 'payment_terms'] },
  artiklar: { namn: 'artikelregister', table: 'products', allow: ['name', 'article_nr', 'price', 'unit', 'vat_rate', 'account_nr', 'description'] },
  leverantorer: { namn: 'leverantörsregister', table: 'suppliers', allow: ['name', 'org_nr', 'bankgiro', 'plusgiro', 'iban', 'email', 'phone', 'faktura_adress', 'postnr', 'ort', 'land', 'vat_nummer', 'kontonr', 'betalningsvillkor'] },
  kontoplan: { namn: 'kontoplan', table: 'accounts', allow: ['account_nr', 'name', 'is_active'] },
}

function downloadCsv(name, rows, cols) {
  if (!rows.length) { toast('Inget att exportera', { icon: 'ℹ️' }); return }
  const c = cols || Object.keys(rows[0])
  const esc = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [c.join(';'), ...rows.map(r => c.map(k => esc(r[k])).join(';'))].join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
  toast.success(`${rows.length} rader exporterade`)
}

function parseCsv(text) {
  const t = text.replace(/^﻿/, '')
  const lines = t.split(/\r?\n/).filter(l => l.trim() !== '')
  if (!lines.length) return []
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ','
  const pl = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else { if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = '' } else cur += c } } out.push(cur); return out.map(s => s.trim()) }
  const header = pl(lines[0])
  return lines.slice(1).map(l => { const cells = pl(l); const o = {}; header.forEach((h, i) => o[h] = cells[i] ?? ''); return o })
}

export default function ImportExport() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)   // { key }
  const [impRows, setImpRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  async function exportReg(reg) {
    const { data } = await supabase.from(reg.table).select(reg.allow.join(', ')).eq('company_id', company.id)
    downloadCsv(`${reg.namn}.csv`, data || [], reg.allow)
  }

  function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => { try { setImpRows(parseCsv(String(rd.result))) } catch { toast.error('Kunde inte tolka filen') } }
    rd.readAsText(f, 'utf-8')
  }

  async function doImport(reg) {
    const clean = (impRows || []).map(r => {
      const o = {}; reg.allow.forEach(c => { if (c in r && r[c] !== '') o[c] = r[c] })
      return o
    }).filter(o => Object.keys(o).length)
    if (!clean.length) return toast.error('Inga giltiga rader – kontrollera att rubrikerna matchar (' + reg.allow.join(', ') + ')')
    setBusy(true)
    try {
      if (reg.table === 'accounts') {
        const { data: ex } = await supabase.from('accounts').select('account_nr').eq('company_id', company.id)
        const have = new Set((ex || []).map(a => a.account_nr))
        const ins = [], upd = []
        clean.forEach(r => { if (!r.account_nr) return; if ('is_active' in r) r.is_active = /^(1|true|ja|aktiv)/i.test(String(r.is_active)); (have.has(r.account_nr) ? upd : ins).push(r) })
        if (ins.length) await supabase.from('accounts').insert(ins.map(r => ({ ...r, company_id: company.id })))
        for (const r of upd) await supabase.from('accounts').update({ name: r.name, ...('is_active' in r ? { is_active: r.is_active } : {}) }).eq('company_id', company.id).eq('account_nr', r.account_nr)
      } else {
        const { error } = await supabase.from(reg.table).insert(clean.map(r => ({ ...r, company_id: company.id })))
        if (error) throw error
      }
      toast.success(`${clean.length} rader importerade`)
      setModal(null); setImpRows(null)
    } catch (e) { toast.error('Import misslyckades: ' + e.message) }
    setBusy(false)
  }

  const ITEMS = [
    { namn: 'Import och export av kundregister', reg: 'kunder' },
    { namn: 'Import och export av artikelregister', reg: 'artiklar' },
    { namn: 'Import och export av leverantörsregister', reg: 'leverantorer' },
    { namn: 'Skapa fil till Skatteverket för One Stop Shop', soon: true },
    { namn: 'Import och export av resultatenheter', soon: true },
    { namn: 'Ladda ner bildunderlag', fn: () => navigate('/inkorg') },
    { namn: 'Skapa fil till banken med leverantörsfakturor att betala', soon: true },
    { namn: 'SIE – export av kundfakturor och inbetalningar', fn: () => navigate('/installningar/sie') },
    { namn: 'SIE – import och export av bokföringsdata', fn: () => navigate('/installningar/sie') },
    { namn: 'Betalningsfil för utbetalning av löner', soon: true },
    { namn: 'Import och export av kontoplan', reg: 'kontoplan' },
  ]
  const visible = ITEMS.filter(i => !search || i.namn.toLowerCase().includes(search.toLowerCase()))
  const reg = modal ? REGISTERS[modal.key] : null

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Import och export</span>
      </div>
      <div className="p-7">
        <div className="relative max-w-md mb-4">
          <input className="input pl-8" placeholder="Sök" value={search} onChange={e => setSearch(e.target.value)} />
          <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        </div>
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <div className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Namn</div>
          {visible.map((it, i) => (
            <button key={i} className="w-full text-left px-4 py-3 border-b hover:bg-gray-50 flex items-center justify-between gap-3" style={{ borderColor: 'rgba(0,0,0,0.06)' }}
              onClick={() => it.soon ? toast('Kommer snart', { icon: 'ℹ️' }) : it.reg ? (setModal({ key: it.reg }), setImpRows(null)) : it.fn()}>
              <span className="text-sm">{it.namn}</span>
              <i className={`ti ${it.soon ? 'ti-clock text-gray-300' : 'ti-chevron-right text-gray-400'}`} />
            </button>
          ))}
        </div>
        <div className="text-right text-xs text-gray-400 mt-3">{visible.length} poster visas</div>
      </div>

      {reg && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && setModal(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium">Import / export – {reg.namn}</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setModal(null)}><i className="ti ti-x" /></button>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
            {!impRows ? (
              <div className="px-5 py-6 grid grid-cols-2 gap-4">
                <button className="rounded-xl border-2 p-5 text-center hover:border-blue-400 transition-colors" style={{ borderColor: 'rgba(0,0,0,0.12)' }} onClick={() => exportReg(reg)}>
                  <i className="ti ti-download text-3xl text-blue-600 block mb-2" />
                  <div className="font-medium text-sm">Exportera</div>
                  <div className="text-xs text-gray-500 mt-1">Ladda ner som CSV</div>
                </button>
                <button className="rounded-xl border-2 p-5 text-center hover:border-green-400 transition-colors" style={{ borderColor: 'rgba(0,0,0,0.12)' }} onClick={() => fileRef.current?.click()}>
                  <i className="ti ti-upload text-3xl text-green-600 block mb-2" />
                  <div className="font-medium text-sm">Importera</div>
                  <div className="text-xs text-gray-500 mt-1">Läs in från CSV</div>
                </button>
              </div>
            ) : (
              <div className="px-5 py-5">
                <div className="text-sm mb-2">Filen innehåller <b>{impRows.length}</b> rader.</div>
                <div className="text-xs text-gray-500 mb-4">Kolumner som importeras: {reg.allow.join(', ')}. Rubriker som inte matchar ignoreras.{reg.table !== 'accounts' && ' Befintliga poster dubbleras inte automatiskt – importera inte samma fil två gånger.'}</div>
                <div className="flex gap-2.5">
                  <button className="btn btn-green" onClick={() => doImport(reg)} disabled={busy}>{busy ? 'Importerar…' : `Importera ${impRows.length} rader`}</button>
                  <button className="btn" onClick={() => setImpRows(null)} disabled={busy}>Tillbaka</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
