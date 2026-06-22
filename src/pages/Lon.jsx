// Löner (lönekörningar). Steg 2 av lönemodulen byggs härnäst – kräver Anställda-registret
// (finns under Lön → Anställda). Period → välj anställda → granska & bokför.
export default function Lon() {
  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">Löner</span>
        <button className="btn btn-primary opacity-60 cursor-not-allowed" disabled title="Byggs i nästa steg">
          <i className="ti ti-plus" /> Ny lönekörning
        </button>
      </div>
      <div className="p-7">
        <div className="bg-white rounded-xl p-12 text-center text-gray-400" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
          <i className="ti ti-calendar-dollar text-4xl block mb-3 opacity-30" />
          <div className="font-medium text-gray-500 mb-1">Lönekörningar byggs i nästa steg</div>
          <div className="text-sm">Lägg till dina anställda under <b>Lön → Anställda</b> först – sedan kör vi lön (period → anställda → granska &amp; bokför).</div>
        </div>
      </div>
    </div>
  )
}
