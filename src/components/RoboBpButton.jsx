// Kontextuell öppnare för ROBO-bp. Placeras på sidor (Bokföring, Leverantörsfakturor,
// Månadskontroll, …) och skickar AKTUELL kontext (vy + ev. vald referens) till panelen.
// Renderas inte alls om bolaget saknar ROBO-bp-licens.
import { useRoboBp } from '../context/RoboBpContext'

export default function RoboBpButton({ view, selection = null, label = 'Fråga ROBO-bp', className = '', compact = false }) {
  const { licensed, openWith } = useRoboBp()
  if (!licensed) return null
  return (
    <button
      type="button"
      onClick={() => openWith({ view, selection })}
      title="Öppna ROBO-bp med den här vyn som kontext"
      className={className || `inline-flex items-center gap-1.5 ${compact ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]'} rounded-lg font-medium text-white bg-gradient-to-r from-violet-600 to-blue-600 hover:brightness-110`}>
      <i className="ti ti-robot" />
      {!compact && <span>{label}</span>}
    </button>
  )
}
