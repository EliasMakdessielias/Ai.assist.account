// Servspar-helper för pilotens kommentar — Etapp 2C. Renodlad så att utfallet per serverfall är testbart.
// Kastar vid ALLA fel (Supabase {error}: 401/403/500/felaktigt svar, eller kastat: timeout/abort/offline).
// Returnerar true ENDAST vid bekräftad, validerad lyckad respons. Anroparen rensar lokalt utkast först då.
export async function commitCheckComment(supabase, checkId, comment) {
  const res = await supabase.rpc('bokslut_comment_check', { p_check: checkId, p_comment: comment })
  if (!res || typeof res !== 'object') throw new Error('Ogiltigt svar från servern')   // felaktigt RPC-svar
  if (res.error) throw res.error                                                         // 401/403/500/Supabase-fel
  return true
}
