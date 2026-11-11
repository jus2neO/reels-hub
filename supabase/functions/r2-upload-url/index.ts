// Returns a presigned R2 PUT URL so the browser uploads the video (or cover) straight to R2.
// Body: { filename, contentType, size }
import { adminClient } from '../_shared/admin.ts'
import { authorize } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { presign } from '../_shared/r2.ts'

const LIMITS: Record<string, number> = {
  'video/mp4': 300 * 1024 * 1024,
  'video/quicktime': 300 * 1024 * 1024,
  'image/jpeg': 8 * 1024 * 1024,
  'image/png': 8 * 1024 * 1024,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  const caller = await authorize(req, adminClient())
  if (caller?.kind !== 'user') return json(req, { error: 'Unauthorized' }, 401)

  try {
    const { filename, contentType, size } = await req.json()
    const limit = LIMITS[contentType]
    if (!limit) return json(req, { error: 'Use an MP4 or MOV video, or a JPG/PNG cover.' }, 400)
    if (typeof size === 'number' && size > limit) {
      return json(req, { error: `File too large (max ${Math.round(limit / 1024 / 1024)} MB).` }, 400)
    }
    const safe = String(filename ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
    const key = `uploads/${crypto.randomUUID()}-${safe}`
    return json(req, { uploadUrl: await presign('PUT', key, 3600), key })
  } catch (e) {
    console.error(e)
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
