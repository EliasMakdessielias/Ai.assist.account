import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
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
import KontoDetalj from './pages/KontoDetalj'
import Installningar from './pages/Installningar'
import Rakenskapsar from './pages/Rakenskapsar'
import Team from './pages/Team'
import Admin from './pages/Admin'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Laddar...</div>
  if (!user) return <Navigate to="/login" />
  return children
}

export default function App() {
  return (
    <>
      <Toaster position="bottom-right" toastOptions={{ duration: 3000, style: { background: '#1a1a18', color: '#fff', fontSize: '13px' } }} />
      <Routes>
        <Route path="/login" element={<Login />} />
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
          <Route path="installningar/kassa-bankkonton" element={<KassaBankKonton />} />
          <Route path="installningar/import-export" element={<ImportExport />} />
          <Route path="installningar/sie" element={<Sie />} />
          <Route path="installningar/kontoplan" element={<Kontoplan />} />
          <Route path="installningar/kontoplan/:nr" element={<KontoDetalj />} />
        </Route>
      </Routes>
    </>
  )
}
