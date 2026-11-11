// Cron (every minute): finishes posts in 'processing'. Rows are claimed with FOR UPDATE SKIP LOCKED
// (claim_processing_posts), so overlapping runs can't publish the same post twice.
import { adminClient } from '../_shared/admin.ts'
import { authorize } from '../_shared/auth.ts'
import { json } from '../_shared/cors.ts'
import { getToken, igGet, igPost } from '../_shared/ig.ts'
import { deleteObject } from '../_shared/r2.ts'

const GIVE_UP_AFTER_MS = 30 * 60 * 1000

Deno.serve(async (req) => {
  const admin = adminClient()
  const caller = await authorize(req, admin)
  if (caller?.kind !== 'cron') return json(req, { error: 'Unauthorized' }, 401)

  const { data: posts, error } = await admin.rpc('claim_processing_posts', { lease_seconds: 90 })
  if (error) return json(req, { error: error.message }, 500)
  if (!posts?.length) return json(req, { handled: 0 })

  const tok = await getToken(admin)
  const results: Record<string, string> = {}

  for (const p of posts) {
    try {
      const c = await igGet(`/${p.container_id}`, { fields: 'status_code,status' }, tok.access_token)
      const code = c.status_code as string

      if (code === 'FINISHED') {
        const media = await igPost(`/${tok.ig_user_id}/media_publish`, { creation_id: p.container_id }, tok.access_token)
        const now = new Date().toISOString()
        await admin
          .from('posts')
          .update({ status: 'published', ig_media_id: media.id, published_at: now, locked_until: null, error: null })
          .eq('id', p.id)
        // Seed kevin_media so Insights shows it right away (ig-sync fills in the rest).
        await admin.from('kevin_media').upsert(
          {
            ig_media_id: media.id,
            caption: p.caption,
            media_type: 'VIDEO',
            media_product_type: 'REELS',
            posted_at: now,
            is_trial: p.is_trial,
            duration_sec: p.duration_sec,
          },
          { onConflict: 'ig_media_id' },
        )
        await deleteObject(p.r2_key)
        if (p.cover_r2_key) await deleteObject(p.cover_r2_key)
        results[p.id] = 'published'
      } else if (code === 'ERROR' || code === 'EXPIRED') {
        await admin
          .from('posts')
          .update({ status: 'failed', error: `Instagram ${code.toLowerCase()}: ${c.status ?? 'no details'}`, locked_until: null })
          .eq('id', p.id)
        results[p.id] = 'failed'
      } else if (code === 'PUBLISHED') {
        await admin.from('posts').update({ status: 'published', locked_until: null }).eq('id', p.id)
        results[p.id] = 'already published'
      } else if (Date.now() - new Date(p.created_at).getTime() > GIVE_UP_AFTER_MS) {
        await admin
          .from('posts')
          .update({ status: 'failed', error: 'Instagram was still processing after 30 minutes', locked_until: null })
          .eq('id', p.id)
        results[p.id] = 'timed out'
      } else {
        // IN_PROGRESS: release the lease so the next run checks again.
        await admin.from('posts').update({ locked_until: null }).eq('id', p.id)
        results[p.id] = 'in progress'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(p.id, msg)
      // Leave it processing (lease expires) unless it has been stuck too long.
      if (Date.now() - new Date(p.created_at).getTime() > GIVE_UP_AFTER_MS) {
        await admin.from('posts').update({ status: 'failed', error: msg, locked_until: null }).eq('id', p.id)
      }
      results[p.id] = `error: ${msg}`
    }
  }
  return json(req, { handled: posts.length, results })
})
