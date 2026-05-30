import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

function downloadCsv(name, rows) {
  if (!rows.length) { toast('Inget att exportera', { icon: 'ℹ️' }); return }
  const cols = Object.keys(rows[0])
  const esc = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
  toast.success(`${rows.length} rader exporterade`)
}

export default function ImportExport() {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  async function expKunder() {
    const { data } = await supabase.from('customers').select('*').eq('company_id', company.id).order('name')
    downloadCsv('kundregister.csv', (data || []).map(({ id, company_id, created_at, ...r }) => r))
  }
  async function expLeverantorer() {
    const { data } = await supabase.from('suppliers').select('*').eq('company_id', company.id).order('name')
    downloadCsv('leverantorsregister.csv', (data || []).map(({ id, company_id, created_at, ...r }) => r))
  }
  async function expArtiklar() {
    const { data } = await supabase.from('products').select('*').eq('company_id', company.id).order('name')
    downloadCsv('artikelregister.csv', (data || []).map(({ id, company_id, created_at, ...r }) => r))
  }
  async function expKontoplan() {
    const { data } = await supabase.from('accounts').select('account_nr, name, is_active').eq('company_id', company.id).order('account_nr')
    downloadCsv('kontoplan.csv', data || [])
  }

  const ITEMS = [
    { namn: 'Import och export av kundregister', fn: expKunder },
    { namn: 'Import och export av artikelregister', fn: expArtiklar },
    { namn: 'Import och export av leverantörsregister', fn: expLeverantorer },
    { namn: 'Skapa fil till Skatteverket för One Stop Shop', soon: true },
    { namn: 'Import och export av resultatenheter', soon: true },
    { namn: 'Ladda ner bildunderlag', fn: () => navigate('/inkorg') },
    { namn: 'Skapa fil till banken med leverantörsfakturor att betala', soon: true },
    { namn: 'SIE – export av kundfakturor och inbetalningar', fn: () => navigate('/installningar/sie') },
    { namn: 'SIE – import och export av bokföringsdata', fn: () => navigate('/installningar/sie') },
    { namn: 'Betalningsfil för utbetalning av löner', soon: true },
    { namn: 'Import och export av kontoplan', fn: expKontoplan },
  ]
  const visible = ITEMS.filter(i => !search || i.namn.toLowerCase().includes(search.toLowerCase()))

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
              onClick={() => it.soon ? toast('Kommer snart', { icon: 'ℹ️' }) : it.fn()}>
              <span className="text-sm">{it.namn}</span>
              <i className={`ti ${it.soon ? 'ti-clock text-gray-300' : 'ti-chevron-right text-gray-400'}`} />
            </button>
          ))}
        </div>
        <div className="text-right text-xs text-gray-400 mt-3">{visible.length} poster visas</div>
      </div>
    </div>
  )
}
