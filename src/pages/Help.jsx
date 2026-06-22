import { useMemo, useState, useEffect } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import {
  HELP_ARTICLES, ARTICLE_BY_SLUG, CATEGORY_ICON,
  searchArticles, visibleArticles, visibleCategories, relatedOf,
} from '../help'

const FALLBACK = 'Jag hittar inget säkert svar i handboken. Kontrollera artiklarna eller kontakta support.'

// Renderar text där `kod` mellan backticks blir <code> (e-post, konton, felkoder).
function rich(text, key) {
  const parts = String(text || '').split(/(`[^`]+`)/g)
  return <span key={key}>{parts.map((p, i) => p.startsWith('`') && p.endsWith('`')
    ? <code key={i} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] text-gray-800" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{p.slice(1, -1)}</code>
    : <span key={i}>{p}</span>)}</span>
}

function Section({ title, children }) {
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-semibold text-gray-900 mb-2">{title}</h2>
      {children}
    </section>
  )
}

function Feedback({ article, companyId, userId }) {
  const [answer, setAnswer] = useState(null)
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)

  async function send(ans, withComment) {
    setAnswer(ans)
    if (ans === 'nej' && !withComment) return // visa kommentarsfält först
    await supabase.from('help_feedback').insert({
      article_id: article.id, article_slug: article.slug, company_id: companyId || null,
      answer: ans, comment: withComment ? (comment.trim() || null) : null,
    }).then(() => {}, () => {})
    setDone(true)
  }

  if (done) return <div className="mt-8 pt-5 border-t text-sm text-gray-500" style={{ borderColor: 'rgba(0,0,0,0.10)' }}><i className="ti ti-circle-check text-green-600 mr-1" /> Tack för din feedback!</div>

  return (
    <div className="mt-8 pt-5 border-t" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
      <div className="text-sm font-medium text-gray-700 mb-2">Hjälpte artikeln dig?</div>
      <div className="flex gap-2">
        <button className={`btn ${answer === 'ja' ? 'btn-green' : ''}`} onClick={() => send('ja', false)}><i className="ti ti-thumb-up" /> Ja</button>
        <button className={`btn ${answer === 'nej' ? 'btn-danger' : ''}`} onClick={() => send('nej', false)}><i className="ti ti-thumb-down" /> Nej</button>
      </div>
      {answer === 'nej' && (
        <div className="mt-3 max-w-md">
          <textarea className="input" rows={3} placeholder="Vad saknades eller blev fel? (valfritt)" value={comment} onChange={e => setComment(e.target.value)} />
          <button className="btn btn-primary mt-2" onClick={() => send('nej', true)}>Skicka feedback</button>
        </div>
      )}
    </div>
  )
}

function Article({ article, access, companyId, userId }) {
  const related = relatedOf(article, access)
  const navigate = useNavigate()
  const support = () => navigate('/support', { state: { fromHelp: article.slug, helpTitle: article.title } })
  return (
    <article className="max-w-3xl">
      <div className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-1">{article.category}</div>
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">{article.title}</h1>
      {article.summary && <p className="mt-2 text-[15px] text-gray-600 leading-relaxed">{rich(article.summary)}</p>}

      {article.purpose && <Section title="Vad används funktionen till?"><p className="text-sm text-gray-700 leading-relaxed">{rich(article.purpose)}</p></Section>}
      {article.when && <Section title="När ska du använda den?"><p className="text-sm text-gray-700 leading-relaxed">{rich(article.when)}</p></Section>}

      {article.steps?.length > 0 && (
        <Section title="Steg för steg">
          <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-700">{article.steps.map((s, i) => <li key={i}>{rich(s, i)}</li>)}</ol>
        </Section>
      )}

      {article.fields?.length > 0 && (
        <Section title="Viktiga fält">
          <dl className="space-y-1.5 text-sm">{article.fields.map(([k, v], i) => (
            <div key={i} className="flex gap-2"><dt className="font-medium text-gray-800 shrink-0">{rich(k)}:</dt><dd className="text-gray-600">{rich(v)}</dd></div>
          ))}</dl>
        </Section>
      )}

      {article.errors?.length > 0 && (
        <Section title="Vanliga fel – och så rättar du">
          <div className="space-y-2">{article.errors.map(([err, fix], i) => (
            <div key={i} className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <i className="ti ti-alert-triangle text-amber-500 mt-0.5 shrink-0" />
              <div><div className="font-medium text-amber-900">{rich(err)}</div><div className="text-amber-800">{rich(fix)}</div></div>
            </div>
          ))}</div>
        </Section>
      )}

      {article.example && (
        <Section title="Exempel">
          <div className="text-sm bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-blue-900">{rich(article.example)}</div>
        </Section>
      )}

      {related.length > 0 && (
        <Section title="Relaterade artiklar">
          <ul className="space-y-1">{related.map(r => (
            <li key={r.slug}><Link to={`/help/${r.slug}`} className="text-sm text-blue-700 hover:underline"><i className="ti ti-arrow-right text-xs mr-1" />{r.title}</Link></li>
          ))}</ul>
        </Section>
      )}

      <Feedback article={article} companyId={companyId} userId={userId} />

      <div className="mt-4 flex items-center justify-between text-[11px] text-gray-400">
        <span>Senast uppdaterad: {article.updatedAt} · Gäller {article.appVersion}</span>
        <button className="text-blue-700 hover:underline" onClick={support}><i className="ti ti-headset mr-1" />Hittar du inte svar? Kontakta support</button>
      </div>
    </article>
  )
}

// AI-hjälp grundad ENBART i handboken (retrieval). Hittar bästa artikel eller säger tydligt ifrån.
function AiHelp({ access }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  function ask() {
    const query = q.trim()
    if (!query) return
    const hits = searchArticles(query, access)
    setRes(hits.length ? { ok: true, hit: hits[0], more: hits.slice(1, 4) } : { ok: false })
  }
  return (
    <div className="bg-white rounded-xl p-5 mb-6 max-w-3xl" style={{ border: '0.5px solid rgba(0,0,0,0.12)' }}>
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-1"><i className="ti ti-sparkles text-purple-600" /> AI-hjälp</div>
      <p className="text-xs text-gray-400 mb-3">Ställ en fråga – svaren kommer enbart från handboken.</p>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="T.ex. Hur bokför jag ett kvitto?" value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }} />
        <button className="btn btn-primary" onClick={ask}>Fråga</button>
      </div>
      {res && (res.ok ? (
        <div className="mt-3 text-sm">
          <div className="text-gray-500 mb-1">Det här hittade jag i handboken:</div>
          <Link to={`/help/${res.hit.slug}`} className="font-medium text-blue-700 hover:underline">{res.hit.title}</Link>
          <p className="text-gray-700 mt-1">{rich(res.hit.summary)}</p>
          {res.more.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">Se även: {res.more.map((m, i) => <span key={m.slug}>{i > 0 && ', '}<Link to={`/help/${m.slug}`} className="text-blue-700 hover:underline">{m.title}</Link></span>)}</div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{FALLBACK}</div>
      ))}
    </div>
  )
}

export default function Help() {
  const { slug } = useParams()
  const { company, user, isAdmin, platformAccess } = useAuth()
  const access = useMemo(() => ({ isAdmin: !!isAdmin, canViewOps: !!platformAccess?.canViewOperations }), [isAdmin, platformAccess])
  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  const cats = useMemo(() => visibleCategories(access), [access])
  const articles = useMemo(() => visibleArticles(access), [access])
  const byCat = useMemo(() => {
    const m = {}
    for (const a of articles) (m[a.category] ||= []).push(a)
    return m
  }, [articles])

  const results = useMemo(() => searchArticles(query, access), [query, access])
  const article = slug ? ARTICLE_BY_SLUG[slug] : null
  const articleAllowed = article && articles.some(a => a.slug === article.slug)

  useEffect(() => { setNavOpen(false) }, [slug, location.key])

  return (
    <div>
      <div className="bg-white border-b sticky top-0 z-10 px-7 h-14 flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
        <div className="flex items-center gap-2">
          <button className="md:hidden text-gray-500" onClick={() => setNavOpen(o => !o)} aria-label="Visa kategorier"><i className="ti ti-menu-2 text-lg" /></button>
          <span className="text-base font-medium">Handbok</span>
        </div>
        <Link to="/support" className="text-sm text-gray-500 hover:text-blue-700"><i className="ti ti-headset mr-1" />Support</Link>
      </div>

      <div className="flex">
        {/* Vänster hjälpnavigering (infällbar på mobil) */}
        <aside className={`${navOpen ? 'block' : 'hidden'} md:block w-64 shrink-0 border-r bg-surface-3 h-[calc(100vh-3.5rem)] sticky top-14 overflow-y-auto`} style={{ borderColor: 'rgba(0,0,0,0.10)' }}>
          <div className="p-3">
            <div className="relative mb-2">
              <input className="input pl-8 text-sm" placeholder="Sök i handboken…" value={query} onChange={e => setQuery(e.target.value)} />
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            </div>
            {query ? (
              <div className="text-xs text-gray-500 px-1 py-2">{results.length} träff{results.length === 1 ? '' : 'ar'}</div>
            ) : cats.map(c => (
              <div key={c.key} className="mb-1.5">
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <i className={`ti ${CATEGORY_ICON[c.key]}`} /> {c.key}
                </div>
                {(byCat[c.key] || []).map(a => (
                  <Link key={a.slug} to={`/help/${a.slug}`}
                    className={`block px-3 py-1 text-[13px] rounded-md ${slug === a.slug ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {a.title}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Läsyta */}
        <main className="flex-1 min-w-0 p-7">
          {query ? (
            <div className="max-w-3xl">
              <h1 className="text-xl font-bold mb-3">Sökresultat</h1>
              {results.length === 0 ? (
                <div className="text-sm text-gray-500">
                  <p className="mb-3">Inga artiklar matchar "<b>{query}</b>".</p>
                  <p className="mb-2">Förslag: prova ett annat ord, eller bläddra i kategorierna till vänster.</p>
                  <Link to="/support" className="text-blue-700 hover:underline"><i className="ti ti-headset mr-1" />Kontakta support</Link>
                </div>
              ) : (
                <ul className="space-y-3">{results.map(a => (
                  <li key={a.slug}>
                    <Link to={`/help/${a.slug}`} className="font-medium text-blue-700 hover:underline">{a.title}</Link>
                    <div className="text-[11px] text-gray-400">{a.category}</div>
                    <p className="text-sm text-gray-600">{a.summary}</p>
                  </li>
                ))}</ul>
              )}
            </div>
          ) : slug ? (
            articleAllowed ? (
              <Article article={article} access={access} companyId={company?.id} userId={user?.id} />
            ) : (
              <div className="max-w-3xl text-sm text-gray-500">
                <h1 className="text-xl font-bold text-gray-800 mb-2">Artikeln hittades inte</h1>
                <p>Artikeln finns inte eller kräver behörighet du saknar. <Link to="/help" className="text-blue-700 hover:underline">Till handbokens start</Link>.</p>
              </div>
            )
          ) : (
            <div>
              <div className="max-w-3xl mb-5">
                <h1 className="text-2xl font-bold tracking-tight">Handbok & hjälp</h1>
                <p className="mt-1 text-[15px] text-gray-600">Sök, bläddra i kategorierna eller fråga AI-hjälpen. Allt svar kommer från BokPilots handbok.</p>
              </div>
              <AiHelp access={access} />
              <div className="max-w-3xl grid sm:grid-cols-2 gap-2">
                {cats.map(c => {
                  const first = (byCat[c.key] || [])[0]
                  return (
                    <Link key={c.key} to={first ? `/help/${first.slug}` : '/help'}
                      className="flex items-center gap-2.5 px-4 py-3 bg-white rounded-lg hover:bg-gray-50" style={{ border: '0.5px solid rgba(0,0,0,0.10)' }}>
                      <i className={`ti ${CATEGORY_ICON[c.key]} text-lg text-gray-500`} />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{c.key}</div>
                        <div className="text-[11px] text-gray-400">{(byCat[c.key] || []).length} artiklar</div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
