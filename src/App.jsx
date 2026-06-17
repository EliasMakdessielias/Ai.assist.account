import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuth } from './hooks/useAuth'
import { isMarketingHost, isAdminHost } from './lib/host'
import AdminApp from './admin/AdminApp'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import ComingSoon from './pages/ComingSoon'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Bokforing from './pages/Bokforing'
import Inkorg from './pages/Inkorg'
import NyVerifikation from './pages/NyVerifikation'
import VisaVerifikation from './pages/VisaVerifikation'
import Fakturor from './pages/Fakturor'
import NyFaktura from './pages/NyFaktura'
import VisaFaktura from './pages/VisaFaktura'
import Leverantorsfakturor from './pages/Leverantorsfakturor'
import NyLeverantorsfaktura from './pages/NyLeverantorsfaktura'
import VisaLeverantorsfaktura from './pages/VisaLeverantorsfaktura'
import KassaBank from './pages/KassaBank'
import Lon from './pages/Lon'
import Rapporter from './pages/Rapporter'
import Moms from './pages/Moms'
import Kunder from './pages/Kunder'
import Leverantorer from './pages/Leverantorer'
import Produkter from './pages/Produkter'
import Kontoplan from './pages/Kontoplan'
import KassaBankKonton from './pages/KassaBankKonton'
import ImportExport from './pages/ImportExport'
import Sie from './pages/Sie'
import Granskning from './pages/Granskning'
import Regelverk from './pages/Regelverk'
import Kontoanalys from './pages/Kontoanalys'
import Assistent from './pages/Assistent'
import Ekonomichef from './pages/Ekonomichef'
import KontoDetalj from './pages/KontoDetalj'
import Installningar from './pages/Installningar'
import Rakenskapsar from './pages/Rakenskapsar'
import Team from './pages/Team'
import Admin from './pages/Admin'
import Aterstall from './pages/Aterstall'
import Artikelkontering from './pages/Artikelkontering'
import Bokforingsmallar from './pages/Bokforingsmallar'
import Notiser from './pages/Notiser'
import Systemovervakning from './pages/Systemovervakning'
import OcrTest from './pages/OcrTest'
import SupportAdmin from './pages/SupportAdmin'
import Support from './pages/Support'
import BillingAdmin from './pages/BillingAdmin'
import Abonnemang from './pages/Abonnemang'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Laddar...</div>
  if (!user) return <Navigate to="/login" />
  return children
}

export default function App() {
  // Värd-/lägeslogik:
  // - bokpilot.se / www (apex) → "Kommer snart" (publikt gated under utveckling)
  // - ?landing (valfri värd) → förhandsvisa riktiga landningssidan (för oss som bygger)
  // - ?soon (valfri värd) → förhandsvisa Kommer snart lokalt
  // - allt annat (app.bokpilot.se, localhost, *.vercel.app) → appen
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  if (params.has('landing')) return <Landing />
  if (params.has('soon')) return <ComingSoon />
  if (isMarketingHost()) return <ComingSoon />
  // admin.bokpilot.se (eller ?admin lokalt) → separat Control Center-skal, ej kundappen.
  if (isAdminHost()) return <AdminApp />

  return (
    <>
      <Toaster position="bottom-right" toastOptions={{ duration: 3000, style: { background: '#1a1a18', color: '#fff', fontSize: '13px' } }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Kontoanalys i eget fönster: egen route UTANFÖR Layout (ingen sidebar/huvudnav),
            men inloggningsskyddad (ProtectedRoute) → samma session/aktiva företag + RLS. */}
        <Route path="/kontoanalys/popout" element={<ProtectedRoute><Kontoanalys popout /></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="bokforing" element={<Bokforing />} />
          <Route path="inkorg" element={<Inkorg />} />
          <Route path="bokforing/ny" element={<NyVerifikation />} />
          <Route path="bokforing/:id" element={<VisaVerifikation />} />
          <Route path="fakturor" element={<Fakturor />} />
          <Route path="fakturor/ny" element={<NyFaktura />} />
          <Route path="fakturor/:id" element={<VisaFaktura />} />
          <Route path="leverantorsfakturor" element={<Leverantorsfakturor />} />
          <Route path="leverantorsfakturor/ny" element={<NyLeverantorsfaktura />} />
          <Route path="leverantorsfakturor/:id" element={<VisaLeverantorsfaktura />} />
          <Route path="kassa-bank" element={<KassaBank />} />
          <Route path="lon" element={<Lon />} />
          <Route path="rapporter" element={<Rapporter />} />
          <Route path="moms" element={<Moms />} />
          <Route path="kunder" element={<Kunder />} />
          <Route path="leverantorer" element={<Leverantorer />} />
          <Route path="produkter" element={<Produkter />} />
          <Route path="installningar" element={<Installningar />} />
          <Route path="installningar/rakenskapsar" element={<Rakenskapsar />} />
          <Route path="installningar/team" element={<Team />} />
          <Route path="admin" element={<Admin />} />
          <Route path="admin/system" element={<Systemovervakning />} />
          <Route path="admin/ocr-test" element={<OcrTest />} />
          <Route path="admin/support" element={<SupportAdmin />} />
          <Route path="support" element={<Support />} />
          <Route path="support/:ticketId" element={<Support />} />
          <Route path="admin/billing" element={<BillingAdmin />} />
          <Route path="installningar/kassa-bankkonton" element={<KassaBankKonton />} />
          <Route path="installningar/import-export" element={<ImportExport />} />
          <Route path="installningar/sie" element={<Sie />} />
          <Route path="granskning" element={<Granskning />} />
          <Route path="regelverk" element={<Regelverk />} />
          <Route path="kontoanalys" element={<Kontoanalys />} />
          <Route path="assistent" element={<Assistent />} />
          <Route path="ekonomichef" element={<Ekonomichef />} />
          <Route path="installningar/kontoplan" element={<Kontoplan />} />
          <Route path="installningar/kontoplan/:nr" element={<KontoDetalj />} />
          <Route path="installningar/aterstall" element={<Aterstall />} />
          <Route path="installningar/artikelkontering" element={<Artikelkontering />} />
          <Route path="installningar/bokforingsmallar" element={<Bokforingsmallar />} />
          <Route path="installningar/notiser" element={<Notiser />} />
          <Route path="installningar/abonnemang" element={<Abonnemang />} />
        </Route>
      </Routes>
    </>
  )
}
