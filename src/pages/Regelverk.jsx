import { useEffect } from 'react'
import regelverkMd from '../../docs/AI_BOKFORINGSHJALP_REGELVERK.md?raw'

// Enkel, beroendefri markdown-rendering för regelverket. Huvudavsnitt ("## N. …") får ett
// ankare `avsnitt-N` som AI-bokföringshjälpens källhänvisningar länkar till.
function inline(s) {
  return String(s).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)
}

function renderMd(md) {
  const out = []
  let tbl = null
  const flush = () => {
    if (tbl) {
      out.push(<pre key={`t${out.length}`} className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto my-2" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>{tbl.join('\n')}</pre>)
      tbl = null
    }
  }
  md.split('\n').forEach((ln, i) => {
    if (ln.startsWith('|')) { (tbl ||= []).push(ln); return }
    flush()
    if (/^#\s+/.test(ln)) out.push(<h1 key={i} className="text-2xl font-bold mt-6 mb-2">{inline(ln.replace(/^#\s+/, ''))}</h1>)
    else if (/^##\s+/.test(ln)) {
      const m = ln.match(/^##\s+(\d+)\./)
      out.push(<h2 key={i} id={m ? `avsnitt-${m[1]}` : undefined} className="text-lg font-semibold mt-6 mb-1.5 scroll-mt-20">{inline(ln.replace(/^##\s+/, ''))}</h2>)
    } else if (/^###\s+/.test(ln)) out.push(<h3 key={i} className="text-base font-semibold mt-4 mb-1">{inline(ln.replace(/^###\s+/, ''))}</h3>)
    else if (/^>\s?/.test(ln)) out.push(<blockquote key={i} className="border-l-4 border-purple-300 bg-purple-50 px-3 py-2 my-2 text-sm text-gray-700">{inline(ln.replace(/^>\s?/, ''))}</blockquote>)
    else if (/^[-*]\s+/.test(ln)) out.push(<li key={i} className="ml-5 list-disc text-sm text-gray-700 leading-relaxed">{inline(ln.replace(/^[-*]\s+/, ''))}</li>)
    else if (ln.trim() === '') out.push(<div key={i} className="h-2" />)
    else out.push(<p key={i} className="text-sm text-gray-700 leading-relaxed">{inline(ln)}</p>)
  })
  flush()
  return out
}

export default function Regelverk() {
  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1))
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }, [])
  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <span className="text-base font-medium flex items-center gap-2"><i className="ti ti-book-2 text-purple-600" /> Regelverk – AI-bokföringshjälp</span>
      </div>
      <div className="p-7 max-w-4xl">{renderMd(regelverkMd)}</div>
    </div>
  )
}
