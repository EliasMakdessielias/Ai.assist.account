export default function Lon() {
  const titles = { Fakturor:'Fakturor', Leverantorsfakturor:'Leverantörsfakturor', KassaBank:'Kassa och bank', Lon:'Lön', Rapporter:'Rapporter', Moms:'Moms', Kunder:'Kunder', Leverantorer:'Leverantörer', Produkter:'Produkter', Installningar:'Inställningar' }
  const title = titles['Lon'] || 'Lon'
  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium">{title}</span>
      </div>
      <div className="p-7">
        <div className="text-center py-16 text-gray-400">
          <i className="ti ti-tools text-4xl block mb-3 opacity-30" />
          <div className="font-medium text-gray-500 mb-1">{title}</div>
          <div className="text-sm">Denna sida byggs ut i nästa steg.</div>
        </div>
      </div>
    </div>
  )
}
