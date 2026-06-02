import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import ConfirmDialog from '../components/kontoplan/ConfirmDialog'
import toast from 'react-hot-toast'

// Vad som kan återställas. Grupperat efter hur destruktivt det är.
const GROUPS = [
  {
    titel: 'Bokföring & transaktioner', poster: [
      ['bookkeeping', 'Verifikationer', 'Alla verifikationer och deras rader/ändringar raderas.'],
      ['customer_invoices', 'Kundfakturor', 'Alla kundfakturor och fakturarader raderas.'],
      ['supplier_invoices', 'Leverantörsfakturor', 'Alla leverantörsfakturor raderas.'],
      ['bank_transactions', 'Banktransaktioner', 'Alla inlästa banktransaktioner raderas.'],
      ['documents', 'Underlag/dokument', 'Alla uppladdade underlag i inkorgen raderas.'],
      ['salaries', 'Löner', 'Alla löneunderlag raderas.'],
    ],
  },
  {
    titel: 'Register', poster: [
      ['products', 'Produkter/artiklar', 'Hela artikelregistret raderas.'],
      ['customers', 'Kunder', 'Hela kundregistret raderas.'],
      ['suppliers', 'Leverantörer', 'Hela leverantörsregistret raderas.'],
      ['chart_of_accounts', 'Kontoplan', 'Hela kontoplanen raderas (även konton som används i bokföring – endast vid full återställning).'],
    ],
  },
  {
    titel: 'Inställningar', poster: [
      ['settings', 'Kör om startguiden', 'Markerar företaget som ej konfigurerat så att startguiden visas igen. Sparade inställningar skrivs inte över förrän du går igenom guiden.'],
    ],
  },
]

export default function Aterstall() {
  const { company, isAdmin, reloadCompany } = useAuth()
  const navigate = useNavigate()
  const [opts, setOpts] = useState({})
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (k, v) => setOpts(o => ({ ...o, [k]: v }))
  const chosen = Object.entries(opts).filter(([, v]) => v).map(([k]) => k)
  const allInGroup = g => g.poster.every(([k]) => opts[k])
  const toggleGroup = g => { const v = !allInGroup(g); setOpts(o => { const n = { ...o }; g.poster.forEach(([k]) => n[k] = v); return n }) }

  async function run() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('reset_company', { p_company: company.id, p_opts: opts })
      if (error) throw error
      const d = data?.deleted || {}
      const sum = Object.entries(d).filter(([, n]) => typeof n === 'number' && n > 0).map(([k, n]) => `${n} ${k}`).join(', ')
      toast.success('Återställning klar' + (sum ? `: ${sum} raderade` : ''))
      setConfirm(false); setOpts({})
      if (opts.settings) { reloadCompany?.(); }
    } catch (e) {
      toast.error('Återställning misslyckades: ' + (e.message || e))
    }
    setBusy(false)
  }

  return (
    <div className="pb-16">
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-alert-triangle text-red-600" /> Återställ företag</span>
        <button className="btn" onClick={() => navigate('/installningar')}><i className="ti ti-arrow-left" /> Tillbaka</button>
      </div>

      <div className="p-7 max-w-3xl">
        <div className="rounded-xl border p-4 bg-red-50 mb-6 text-sm text-red-800" style={{ borderColor: 'rgba(220,38,38,0.3)' }}>
          <div className="font-semibold mb-1"><i className="ti ti-alert-triangle mr-1" />Detta går inte att ångra</div>
          Återställning raderar permanent valda data för <b>{company?.name}</b>. Använd detta för att nollställa ett test- eller demoföretag innan skarp drift. Ta en SIE-export först om du vill kunna återskapa något.
        </div>

        {GROUPS.map(g => (
          <div key={g.titel} className="bg-white rounded-xl mb-4 overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <div className="px-4 py-2.5 bg-gray-50 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-sm font-semibold">{g.titel}</span>
              <button className="text-xs text-blue-600 hover:underline" onClick={() => toggleGroup(g)}>{allInGroup(g) ? 'Avmarkera alla' : 'Markera alla'}</button>
            </div>
            {g.poster.map(([k, label, desc]) => (
              <label key={k} className="flex items-start gap-3 px-4 py-3 border-b cursor-pointer hover:bg-gray-50" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                <input type="checkbox" className="w-4 h-4 mt-0.5" checked={!!opts[k]} onChange={e => set(k, e.target.checked)} />
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-gray-500">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        ))}

        <div className="flex items-center justify-between mt-6">
          <span className="text-xs text-gray-500">{chosen.length} valda</span>
          <button className="btn btn-danger px-6 py-2" disabled={!chosen.length} onClick={() => setConfirm(true)}>
            <i className="ti ti-trash" /> Återställ valda data
          </button>
        </div>
      </div>

      <ConfirmDialog open={confirm} danger title="Bekräfta återställning" confirmLabel="Återställ permanent"
        confirmText={company?.name} busy={busy} onCancel={() => !busy && setConfirm(false)} onConfirm={run}>
        <p>Du är på väg att <b>permanent radera</b> följande för <b>{company?.name}</b>:</p>
        <ul className="list-disc pl-5 text-xs text-gray-600">
          {GROUPS.flatMap(g => g.poster).filter(([k]) => opts[k]).map(([k, label]) => <li key={k}>{label}</li>)}
        </ul>
      </ConfirmDialog>
    </div>
  )
}
