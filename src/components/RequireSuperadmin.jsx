import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Route-guard: ENDAST plattforms-superadmin (platformAccess.isSuperadmin = is_superadmin() i DB) får rendera barnet.
// Alla andra – vanlig member, company admin, ops, support, billing – omdirigeras (default till "/").
// Används för interna verktyg som OCR-test, så att de inte bara döljs i menyn utan blockeras route-mässigt.
export default function RequireSuperadmin({ children, redirectTo = '/' }) {
  const { loading, platformAccess } = useAuth()
  if (loading) return null                                  // vänta in access innan beslut (undvik felaktig redirect)
  return platformAccess?.isSuperadmin ? children : <Navigate to={redirectTo} replace />
}
