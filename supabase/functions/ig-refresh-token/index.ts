// Weekly cron: refreshes Kevin's long-lived Instagram token (valid ~60 days; must be 24h+ old to refresh).
import { adminClient } from '../_shared/admin.ts'
import { authorize } from '../_shared/auth.ts'
import { json } from '../_shared/cors.ts'
import { getToken } from '../_shared/ig.ts'

Deno.serve(async (req) => {
  const admin = adminClient()
  if ((await authorize(req, admin))?.kind !== 'cron') return json(req, { error: 'Unauthorized' }, 401)

  try {
    const tok = await getToken(admin)
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tok.access_token)}`,
    )
    const body = await res.json()
    if (!res.ok || !body.access_token) throw new Error(body.error?.message ?? `HTTP ${res.status}`)
    const expires = new Date(Date.now() + Number(body.expires_in ?? 0) * 1000).toISOString()
    const { error } = await admin
      .from('ig_tokens')
      .update({ access_token: body.access_token, expires_at: expires, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) throw error
    return json(req, { ok: true, expires_at: expires })
  } catch (e) {
    console.error(e)
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
