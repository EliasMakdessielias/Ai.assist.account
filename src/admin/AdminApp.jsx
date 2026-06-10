import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { APP_ORIGIN } from '../lib/host'
import Login from '../pages/Login'
import AdminLayout from './AdminLayout'
import ControlCenter from './ControlCenter'
import Systemovervakning from '../pages/Systemovervakning'
import SupportAdmin from '../pages/SupportAdmin'
import BillingAdmin from '../pages/BillingAdmin'
import OcrTest from '../pages/OcrTest'

// Härled ett robust access-objekt ur platformAccess (my_platform_access).
// Tål både gamla formen (före read_only-migrationen) och nya (canViewBilling/isReadOnly).
function deriveAccess(pa) {
  if (!pa) return null
  const access = {
    isSuperadmin: !!pa.isSuperadmin,
    isReadOnly: !!pa.isReadOnly,
    roles: pa.roles || [],
    canViewOperations: !!pa.canViewOperations || !!pa.isSuperadmin,
    canViewSupport: !!pa.canViewSupport || !!pa.isSuperadmin,
    canViewBilling: !!pa.canViewBilling || !!pa.canManageBilling || !!pa.isSuperadmin,
  }
  access.canAccess = access.isSuperadmin || access.canViewOperations || access.canViewSupport || access.canViewBilling || access.isReadOnly
  return access
}

function Forbidden({ email, onSignOut }) {
  return (
    <div className="flex h-screen items-center justify-center bg-surface-3 p-6">
      <div className="bg-white rounded-xl p-8 max-w-md text-center" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <i className="ti ti-shield-lock text-4xl text-amber-500 block mb-3" />
        <div className="text-lg font-semibold mb-1">Ingen åtkomst till Control Center</div>
        <p className="text-sm text-gray-500 mb-5">Kontot <b>{email}</b> saknar plattformsroll. Kontakta en superadmin för att få åtkomst.</p>
        <div className="flex justify-center gap-2.5">
          <a className="btn" href={APP_ORIGIN}><i className="ti ti-external-link" /> Till kundappen</a>
          <button className="btn" onClick={onSignOut}><i className="ti ti-logout" /> Logga ut</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminApp() {
  const { user, loading, platformAccess, signOut } = useAuth()
  const toaster = <Toaster position="bottom-right" toastOptions={{ duration: 3000, style: { background: '#1a1a18', color: '#fff', fontSize: '13px' } }} />

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Laddar…</div>
  if (!user) return <>{toaster}<Login /></>

  const access = deriveAccess(platformAccess)
  if (!access || !access.canAccess) return <>{toaster}<Forbidden email={user.email} onSignOut={signOut} /></>

  return (
    <>
      {toaster}
      <Routes>
        <Route path="/" element={<AdminLayout access={access} />}>
          <Route index element={<ControlCenter access={access} />} />
          {access.canViewBilling && <Route path="billing" element={<BillingAdmin />} />}
          {access.canViewSupport && <Route path="support" element={<SupportAdmin />} />}
          {access.canViewOperations && <Route path="system" element={<Systemovervakning />} />}
          {access.canViewOperations && <Route path="ocr" element={<OcrTest />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  )
}
