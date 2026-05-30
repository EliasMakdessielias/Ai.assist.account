// Edge Function: admin — plattformsadmin-hantering (lista konton, aktivera, stäng av, radera).
// Endast plattformsadmins (e-post i platform_admins) får anropa.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

    // Verifiera anropare
    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Ej inloggad' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: pa } = await admin.from('platform_admins').select('email').ilike('email', user.email!)
    if (!pa || !pa.length) return json({ error: 'Ingen åtkomst' }, 403)

    const { action, company_id, suspended, user_id } = await req.json()

    if (action === 'list') {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const users = (list?.users || []).map(u => ({
        id: u.id, email: u.email, created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at, confirmed: !!u.email_confirmed_at,
      }))
      const [{ data: companies }, { data: members }, { data: vers }] = await Promise.all([
        admin.from('companies').select('id, name, org_nr, created_at, suspended'),
        admin.from('user_companies').select('user_id, company_id, email, role'),
        admin.from('verifikationer').select('company_id'),
      ])
      const verCounts: Record<string, number> = {}
      ;(vers || []).forEach(v => { verCounts[v.company_id] = (verCounts[v.company_id] || 0) + 1 })
      return json({ ok: true, users, companies: companies || [], members: members || [], verCounts })
    }

    if (action === 'set_suspended') {
      if (!company_id) return json({ error: 'company_id saknas' }, 400)
      const { error } = await admin.from('companies').update({ suspended: !!suspended }).eq('id', company_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'delete_user') {
      if (!user_id) return json({ error: 'user_id saknas' }, 400)
      if (user_id === user.id) return json({ error: 'Du kan inte radera dig själv' }, 400)
      // Radera företag där användaren är enda medlemmen (kaskaderar all data), behåll delade.
      const { data: ucs } = await admin.from('user_companies').select('company_id').eq('user_id', user_id)
      for (const uc of ucs || []) {
        const { count } = await admin.from('user_companies').select('id', { count: 'exact', head: true }).eq('company_id', uc.company_id)
        if ((count || 0) <= 1) await admin.from('companies').delete().eq('id', uc.company_id)
      }
      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Okänd action' }, 400)
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 400)
  }
})
