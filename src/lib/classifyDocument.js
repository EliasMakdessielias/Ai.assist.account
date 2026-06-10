// Regelbaserad klassificering av inkommande underlag (kvitto / leverantörsfaktura
// / kundfaktura / avtal / dokument / okänd). Använder filnamn, MIME-typ, e-postämne,
// e-posttext och ev. OCR-/AI-text. Returnerar { type, confidence (0-1), status }.
//
// Status:
//   confidence hög (>= CLASSIFIED_THRESHOLD) -> 'classified'
//   confidence låg                            -> 'needs_review'
//   filtyp stöds ej                           -> 'unsupported'
//
// AI/OCR är valfria signaler: skicka ocrText (t.ex. från tolka-underlag) för bättre
// träffsäkerhet. Motorn är avsiktligt deterministisk och enhetstestbar.

export const DOC_TYPES = ['kvitto', 'leverantorsfaktura', 'avtal', 'dokument', 'okand']
export const CLASSIFIED_THRESHOLD = 0.6

// Vid lika poäng vinner kategorin tidigast i denna prioritet.
const PRIORITY = ['leverantorsfaktura', 'kvitto', 'avtal', 'dokument']

// Starka nyckelord (ger basvikt) + stödjande signaler (mindre vikt).
const STRONG = {
  kvitto: ['kvitto', 'receipt', 'kassakvitto', 'kortköp'],
  leverantorsfaktura: ['leverantörsfaktura', 'faktura', 'invoice'],
  avtal: ['avtal', 'kontrakt', 'agreement', 'contract'],
}
const SUPPORT = {
  kvitto: ['butik', 'betaldatum', 'kvittonr', 'kortbetalning', 'swish', 'summa'],
  leverantorsfaktura: ['ocr', 'bankgiro', 'plusgiro', 'förfallodatum', 'fakturanummer', 'fakturanr', 'att betala', 'momsreg', 'org.nr'],
  avtal: ['signerat', 'signerad', 'parterna', 'parter', 'villkor', 'undertecknat', 'giltighetstid'],
}
const STRONG_WEIGHT = 0.6
const SUPPORT_WEIGHT = 0.12

function countHits(hay, words) {
  let n = 0
  for (const w of words) if (hay.includes(w)) n++
  return n
}

export function classifyDocument(input = {}, opts = {}) {
  const { filename = '', mimeType = '', subject = '', bodyText = '', ocrText = '' } = input
  if (opts.supported === false) return { type: 'okand', confidence: 0, status: 'unsupported' }

  const hay = `${filename} ${subject} ${bodyText} ${ocrText}`.toLowerCase()
  const scores = {}
  for (const cat of ['kvitto', 'leverantorsfaktura', 'avtal']) {
    const strong = countHits(hay, STRONG[cat]) > 0 ? STRONG_WEIGHT : 0
    const support = countHits(hay, SUPPORT[cat]) * SUPPORT_WEIGHT
    scores[cat] = strong > 0 ? strong + support : support * 0.5 // stödsignal utan starkt ord väger lätt
  }
  // DOCX/Word utan annan signal lutar mot dokument/avtal
  if (/\.docx?$/i.test(filename) || /word|officedocument/.test(mimeType)) {
    scores.avtal = (scores.avtal || 0) + 0.1
    scores.dokument = 0.25
  }

  let best = null, bestScore = 0
  for (const cat of PRIORITY) {
    const s = scores[cat] || 0
    if (s > bestScore) { bestScore = s; best = cat }
  }

  if (!best || bestScore <= 0) {
    return { type: 'okand', confidence: 0, status: 'needs_review' }
  }
  const confidence = Math.min(0.97, Math.round(bestScore * 100) / 100)
  const status = confidence >= CLASSIFIED_THRESHOLD ? 'classified' : 'needs_review'
  return { type: best, confidence, status }
}
