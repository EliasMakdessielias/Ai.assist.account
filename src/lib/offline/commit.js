// Servspar-helper för pilotens kommentar — Etapp 2C/2D. Renodlad så att utfallet per serverfall är testbart.
// Kastar vid ALLA fel (Supabase {error}: 401/403/500/felaktigt svar, eller kastat: timeout/abort/offline).
// Returnerar true ENDAST vid bekräftad, validerad lyckad respons. Anroparen rensar lokalt utkast först då.
//
// Timeout (Etapp 2D): en RIKTIG AbortController kopplas via Supabase-adaptern (.abortSignal), så att själva
// RPC/HTTP-anropet avbryts på nätverksnivå vid timeout – inte bara UI-väntan. Timeout skiljs från 401/403/500
// och valideringsfel, raderar inte utkastet och startar INGEN automatisk retry i denna etapp.
// 15 000 ms valt: en enkel INSERT-RPC svarar normalt på <1 s; 15 s ger marginal på svaga mobilnät utan att
// låta ett hängt anrop blockera användaren i evighet.
export const COMMIT_TIMEOUT_MS = 15000

export async function commitCheckComment(supabase, checkId, comment, { timeoutMs = COMMIT_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const builder = supabase.rpc('bokslut_comment_check', { p_check: checkId, p_comment: comment })
    // Skicka AbortSignal genom produktionsadaptern när den stöds (postgrest-js .abortSignal → fetch signal).
    const res = (builder && typeof builder.abortSignal === 'function') ? await builder.abortSignal(ctrl.signal) : await builder
    if (!res || typeof res !== 'object') throw new Error('Ogiltigt svar från servern')   // felaktigt RPC-svar
    if (res.error) throw res.error                                                         // 401/403/500/Supabase-fel
    return true
  } catch (e) {
    if ((e && e.name === 'AbortError') || ctrl.signal.aborted) {
      const te = new Error('Tidsgräns nådd – servern svarade inte i tid. Utkastet finns kvar lokalt på enheten.')
      te.code = 'TIMEOUT'
      throw te
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}
