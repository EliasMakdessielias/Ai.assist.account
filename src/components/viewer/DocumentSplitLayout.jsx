// [DOCUMENT_VIEWER] Gemensam split-layout: arbetsyta (vänster, flex) + dragbar splitter +
// dokumentpanel (höger, fast px-bredd). Behåller appens 10/45/45-känsla (sidomeny ~10% via
// Layout, arbetsyta flex ~45%, viewer ~45% standard). Layout-state kommer från
// useDocumentViewerLayout (panelW/open/dragging/startResize) som anroparen äger.
//
//   <DocumentSplitLayout open={open} panelW={panelW} startResize={startResize}
//                        panel={<DocumentViewerPanel … />}>
//     {/* hela vänster arbetsyta, t.ex. <div className="flex-1 …">…</div> */}
//   </DocumentSplitLayout>
export default function DocumentSplitLayout({ open = true, panelW, startResize, panel, children }) {
  return (
    <div className="flex h-screen overflow-hidden">
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
    </div>
  )
}
