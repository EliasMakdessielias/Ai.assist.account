// [DOCUMENT_VIEWER] Gemensam split-layout: arbetsyta (vänster, flex) + dragbar splitter +
// dokumentpanel (höger, fast px-bredd). Behåller appens 10/45/45-känsla (sidomeny ~10% via
// Layout, arbetsyta flex ~45%, viewer ~45% standard). Layout-state kommer från
// useDocumentViewerLayout (panelW/open/dragging/startResize) som anroparen äger.
//
//   <DocumentSplitLayout open={open} panelW={panelW} startResize={startResize} onToggle={() => setOpen(o => !o)}
//                        panel={<DocumentViewerPanel … />}>
//     {/* hela vänster arbetsyta, t.ex. <div className="flex-1 …">…</div> */}
//   </DocumentSplitLayout>
//
// onToggle (valfritt): renderar en vertikalt centrerad flik-knapp i kanten för att visa/dölja
// panelen ("Visa bild"/"Dölj bild"). Utan onToggle är beteendet oförändrat (övriga moduler).
export default function DocumentSplitLayout({ open = true, panelW, startResize, panel, children, onToggle }) {
  return (
    <div className="flex h-screen overflow-hidden relative">
      {children}
      {open && panel && (
        <>
          <div onPointerDown={startResize} role="separator" aria-orientation="vertical" title="Dra för att ändra storlek"
            className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors" style={{ touchAction: 'none' }} />
          <div className="bg-white flex flex-col h-full" style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', width: panelW, flexShrink: 0 }}>
            {panel}
          </div>
        </>
      )}
      {onToggle && (
        <button type="button" onClick={onToggle}
          title={open ? 'Dölj bild' : 'Visa bild'} aria-label={open ? 'Dölj bild' : 'Visa bild'}
          className="absolute top-1/2 -translate-y-1/2 z-20 w-6 h-14 rounded-l-md bg-yellow-400 hover:bg-yellow-500 text-gray-800 shadow flex items-center justify-center"
          style={{ right: open ? panelW : 0 }}>
          <i className={`ti ${open ? 'ti-chevron-right' : 'ti-chevron-left'}`} />
        </button>
      )}
    </div>
  )
}
