import { Link } from 'react-router-dom'

// Kontextuell hjälpknapp: öppnar rätt handboksartikel direkt (/help/:slug).
// Lägg i valfri vy: <HelpButton slug="bokfora-kvitto" /> eller med egen etikett.
// variant: 'icon' (rund "?") eller 'text' (knapp med "Hjälp").
export default function HelpButton({ slug, label = 'Hjälp', variant = 'icon', className = '' }) {
  const to = slug ? `/help/${slug}` : '/help'
  if (variant === 'text') {
    return (
      <Link to={to} title="Öppna hjälp för den här vyn"
        className={`inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 ${className}`}>
        <i className="ti ti-help-circle" /> {label}
      </Link>
    )
  }
  return (
    <Link to={to} title="Hjälp för den här vyn" aria-label="Hjälp"
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-blue-700 hover:bg-blue-50 ${className}`}>
      <i className="ti ti-help-circle text-lg" />
    </Link>
  )
}
