import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { CLASS_NAMES } from '../lib/kontoplan'
import { fetchAccountsPage, fetchAllAccountNumbers } from '../lib/accountsQuery'
import ImportWizard from '../components/kontoplan/ImportWizard'
import AccountEditModal from '../components/kontoplan/AccountEditModal'
import ConfirmDialog from '../components/kontoplan/ConfirmDialog'
import toast from 'react-hot-toast'

const PER_PAGE = 100

export default function Kontoplan() {
  const { company } = useAuth()
  const [items, setItems] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('alla')
  const [classFilter, setClassFilter] = useState('alla')
  const [sort, setSort] = useState({ key: 'account_nr', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [existingNrs, setExistingNrs] = useState([])

  const [showImport, setShowImport] = useState(false)
  const [editAccount, setEditAccount] = useState(undefined)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(null)

  // Debounce sökfältet så vi inte gör en query per tangenttryck.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Återställ till sida 1 när filter/sök ändras.
  useEffect(() => { setPage(1) }, [debouncedSearch, statusFilter, classFilter])

  const loadPage = useCallback(async () => {
    if (!company) return
    setLoading(true)
    try {
      const res = await fetchAccountsPage(supabase, {
        companyId: company.id, search: debouncedSearch, status: statusFilter,
        accountClass: classFilter, page, pageSize: PER_PAGE, sort,
      })
      setItems(res.items)
      setTotalCount(res.totalCount)
      setTotalPages(res.totalPages)
    } catch (e) { toast.error('Kunde inte ladda kontoplan: ' + e.message) }
    setLoading(false)
  }, [company, debouncedSearch, statusFilter, classFilter, page, sort])

  useEffect(() => { loadPage() }, [loadPage])

  const loadExisting = useCallback(async () => {
    if (!company) return
    try { setExistingNrs(await fetchAllAccountNumbers(supabase, company.id)) } catch { /* tyst */ }
  }, [company])
  useEffect(() => { loadExisting() }, [loadExisting])

  // Anropas efter mutationer (skapa/redigera/radera/importera/töm).
  async function refresh() { await Promise.all([loadPage(), loadExisting()]) }

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
    setPage(1)
  }
  const sortIcon = key => sort.key !== key ? 'ti-arrows-sort' : sort.dir === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending'

  async function doDelete(account, { inactivateInstead = false } = {}) {
    setBusy(true)
    try {
      if (inactivateInstead) {
        const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', account.id)
        if (error) throw error
        toast.success(`Konto ${account.account_nr} inaktiverat`)
      } else {
        const { error } = await supabase.rpc('delete_account_safe', { p_company: company.id, p_account_nr: account.account_nr })
        if (error) throw error
        toast.success(`Konto ${account.account_nr} raderat`)
      }
      setConfirmDelete(null)
      await refresh()
    } catch (e) {
      if (String(e.message || '').includes('KONTO_ANVANDS')) {
        setConfirmDelete(d => d ? { ...d, _used: true } : d)
        toast('Kontot används i bokföringen – inaktivera istället', { icon: 'ℹ️' })
      } else toast.error(e.message)
    }
    setBusy(false)
  }

  async function doClear() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('clear_chart_of_accounts', { p_company: company.id })
      if (error) throw error
      const d = data || {}
      toast.success(`Kontoplan tömd: ${d.deleted || 0} raderade, ${d.deactivated || 0} inaktiverade (används i bokföring)`)
      setConfirmClear(false)
      await refresh()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  async function openHistory() {
    const { data } = await supabase.from('account_import_batches').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(50)
    setHistory(data || [])
  }

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Kontoplan</span>
        <div className="flex items-center gap-2">
          <button className="btn text-xs" onClick={openHistory}><i className="ti ti-history" /> Importhistorik</button>
          <button className="btn btn-danger text-xs" onClick={() => setConfirmClear(true)}><i className="ti ti-trash" /> Töm kontoplan</button>
          <button className="btn" onClick={() => setShowImport(true)}><i className="ti ti-upload" /> Ladda upp ny kontoplan</button>
          <button className="btn btn-primary" onClick={() => setEditAccount(null)}><i className="ti ti-plus" /> Skapa konto</button>
        </div>
      </div>

      <div className="p-7">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input className="input pl-8 w-64" placeholder="Konto, benämning" value={search}
                onChange={e => setSearch(e.target.value)} />
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            </div>
            {['alla', 'aktiva', 'inaktiva'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`btn text-xs ${statusFilter === s ? 'bg-gray-100' : ''}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
            <select className="input text-xs py-1 w-44" value={classFilter} onChange={e => setClassFilter(e.target.value)}>
              <option value="alla">Alla kontoklasser</option>
              {Object.entries(CLASS_NAMES).filter(([k]) => k !== '6').map(([k, v]) => <option key={k} value={k}>{k} – {v}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{totalCount.toLocaleString('sv-SE')} konton</span>
            <button className="btn text-xs py-1 px-2" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><i className="ti ti-chevron-left" /></button>
            <span>{page} / {totalPages}</span>
            <button className="btn text-xs py-1 px-2" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><i className="ti ti-chevron-right" /></button>
          </div>
        </div>

        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <table className="tbl w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 border-b bg-gray-200 w-24 cursor-pointer select-none" style={{ borderColor: 'rgba(0,0,0,0.10)' }} onClick={() => toggleSort('account_nr')}>Konto <i className={`ti ${sortIcon('account_nr')}`} /></th>
                <th className="text-left px-4 py-2.5 border-b cursor-pointer select-none" style={{ borderColor: 'rgba(0,0,0,0.10)' }} onClick={() => toggleSort('name')}>Benämning <i className={`ti ${sortIcon('name')}`} /></th>
                <th className="text-left px-4 py-2.5 border-b w-44 cursor-pointer select-none" style={{ borderColor: 'rgba(0,0,0,0.10)' }} onClick={() => toggleSort('account_class')}>Kontoklass <i className={`ti ${sortIcon('account_class')}`} /></th>
                <th className="text-left px-4 py-2.5 border-b w-32" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Momskod</th>
                <th className="text-left px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Status</th>
                <th className="text-right px-4 py-2.5 border-b w-24" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">Laddar kontoplan...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-12 text-gray-400">Inga konton matchar. Skapa ett eller ladda upp en kontoplan.</td></tr>
              ) : items.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 border-b font-medium cursor-pointer" style={{ borderColor: 'rgba(0,0,0,0.08)' }} onClick={() => setEditAccount(a)}>{a.account_nr}</td>
                  <td className="px-4 py-2.5 border-b cursor-pointer" style={{ borderColor: 'rgba(0,0,0,0.08)' }} onClick={() => setEditAccount(a)}>{a.name}</td>
                  <td className="px-4 py-2.5 border-b text-xs text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{a.account_class ? `${a.account_class} – ${CLASS_NAMES[a.account_class]}` : '—'}</td>
                  <td className="px-4 py-2.5 border-b text-xs text-gray-400" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>{a.vat_code || '—'}</td>
                  <td className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    {a.is_active ? <span className="badge-active"><i className="ti ti-check text-xs" /> Aktiv</span> : <span className="badge-draft">Inaktiv</span>}
                  </td>
                  <td className="px-4 py-2.5 border-b text-right" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                    <button className="text-gray-400 hover:text-blue-600 px-1" title="Redigera" onClick={() => setEditAccount(a)}><i className="ti ti-pencil" /></button>
                    <button className="text-gray-400 hover:text-red-600 px-1" title="Radera" onClick={() => setConfirmDelete(a)}><i className="ti ti-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ImportWizard open={showImport} companyId={company?.id} existingNrs={existingNrs}
        onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh() }} />

      <AccountEditModal open={editAccount !== undefined} account={editAccount} companyId={company?.id} existingNrs={existingNrs}
        onClose={() => setEditAccount(undefined)} onSaved={() => { setEditAccount(undefined); refresh() }} />

      <ConfirmDialog open={confirmClear} danger title="Töm hela kontoplanen?" confirmLabel="Töm kontoplan"
        confirmText="TÖM" busy={busy} onCancel={() => !busy && setConfirmClear(false)} onConfirm={doClear}>
        <p>Alla konton som <b>inte</b> används i bokföringen raderas. Konton som används i bokförda verifikationer <b>inaktiveras</b> istället (kan inte raderas enligt bokföringslagen).</p>
      </ConfirmDialog>

      <ConfirmDialog open={!!confirmDelete} danger={!confirmDelete?._used}
        title={confirmDelete?._used ? 'Kontot används' : `Radera konto ${confirmDelete?.account_nr}?`}
        confirmLabel={confirmDelete?._used ? 'Inaktivera kontot' : 'Radera'} busy={busy}
        onCancel={() => !busy && setConfirmDelete(null)}
        onConfirm={() => doDelete(confirmDelete, { inactivateInstead: !!confirmDelete?._used })}>
        {confirmDelete?._used
          ? <p>Konto <b>{confirmDelete?.account_nr} {confirmDelete?.name}</b> används i bokförda verifikationer och kan inte raderas. Vill du <b>inaktivera</b> det istället?</p>
          : <p>Vill du radera konto <b>{confirmDelete?.account_nr} {confirmDelete?.name}</b>? Om kontot används i bokföringen föreslås inaktivering istället.</p>}
      </ConfirmDialog>

      {history !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setHistory(null)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
              <span className="text-base font-medium"><i className="ti ti-history mr-2" />Importhistorik</span>
              <button className="text-gray-400 hover:text-gray-700" onClick={() => setHistory(null)}><i className="ti ti-x" /></button>
            </div>
            {history.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">Inga importer ännu.</div>
            ) : (
              <table className="tbl w-full text-sm">
                <thead><tr className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase">
                  <th className="text-left px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Datum</th>
                  <th className="text-left px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Fil</th>
                  <th className="text-left px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Läge</th>
                  <th className="text-left px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Resultat</th>
                  <th className="text-left px-4 py-2 border-b" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>Av</th>
                </tr></thead>
                <tbody>
                  {history.map(b => (
                    <tr key={b.id}>
                      <td className="px-4 py-2 border-b text-xs" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{new Date(b.created_at).toLocaleString('sv-SE')}</td>
                      <td className="px-4 py-2 border-b text-xs" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.filename || '—'}</td>
                      <td className="px-4 py-2 border-b text-xs" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.mode}</td>
                      <td className="px-4 py-2 border-b text-xs text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.inserted} nya, {b.updated} uppd.{b.deactivated ? `, ${b.deactivated} inakt.` : ''}{b.deleted ? `, ${b.deleted} rad.` : ''}</td>
                      <td className="px-4 py-2 border-b text-xs" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{b.imported_by_email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
