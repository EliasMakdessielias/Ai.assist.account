import { useEffect } from 'react'
import { useSectionActions } from '../components/SectionTabsLayout'

// Löner (lönekörningar) – flik under Lön. Steg 2 av lönemodulen byggs härnäst.
// Period → välj anställda → granska & bokför. Action ligger i den delade toppraden.
export default function Lon() {
  const { setActions } = useSectionActions()
  useEffect(() => {
    setActions(
      <button className="btn btn-primary opacity-60 cursor-not-allowed" disabled title="Byggs i nästa steg">
        <i className="ti ti-plus" /> Ny lönekörning
      </button>
    )
    return () => setActions(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white rounded-xl p-12 text-center text-gray-400" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
      <i className="ti ti-calendar-dollar text-4xl block mb-3 opacity-30" />
      <div className="font-medium text-gray-500 mb-1">Lönekörningar byggs i nästa steg</div>
      <div className="text-sm">Lägg till dina anställda under fliken <b>Anställda</b> först – sedan kör vi lön (period → anställda → granska &amp; bokför).</div>
    </div>
  )
}
