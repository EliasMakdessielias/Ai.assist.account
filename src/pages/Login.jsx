import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { BRAND } from '../lib/brand'
import toast from 'react-hot-toast'

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [orgNr, setOrgNr] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isSignUp) {
        await signUp(email, password, companyName, orgNr)
        toast.success('Konto skapat! Kontrollera din e-post.')
      } else {
        await signIn(email, password)
        toast.success('Inloggad!')
      }
      navigate('/')
    } catch (err) {
      toast.error(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-3 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">{BRAND.appName}</h1>
          <p className="text-sm text-gray-400 mt-1">{BRAND.tagline}</p>
        </div>

        <div className="bg-white rounded-xl p-8 shadow-sm" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <h2 className="text-lg font-medium mb-6">{isSignUp ? 'Skapa konto' : 'Logga in'}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Företagsnamn</label>
                  <input className="input" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Sverige AB" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Organisationsnummer</label>
                  <input className="input" value={orgNr} onChange={e => setOrgNr(e.target.value)} placeholder="556123-4567" />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">E-post</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="din@epost.se" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Lösenord</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minst 6 tecken" required />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center py-2.5">
              {loading ? 'Vänta...' : isSignUp ? 'Skapa konto' : 'Logga in'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            {isSignUp ? 'Har du redan ett konto?' : 'Inget konto?'}{' '}
            <button onClick={() => setIsSignUp(!isSignUp)} className="text-blue-700 font-medium hover:underline">
              {isSignUp ? 'Logga in' : 'Skapa konto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
