// Gemensam gul flik för att dölja/visa dokumentpanelen (samma knapp gör båda).
// Renderas alltid (utanför {open && panel}) så att den fungerar både som "dölj" och "visa".
// Placeras som flex-barn mellan arbetsytan och underlagspanelen i en `flex h-screen`-layout.
export default function ViewerToggleTab({ open, onToggle, className = '' }) {
  const label = open ? 'Dölj underlag' : 'Visa underlag'
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      className={`self-center -mr-px z-20 w-7 h-12 rounded-l-lg bg-amber-400 hover:bg-amber-500 text-gray-900 flex items-center justify-center shadow shrink-0 ${className}`}
    >
      <i className={`ti ${open ? 'ti-chevron-right' : 'ti-chevron-left'}`} />
    </button>
  )
}
