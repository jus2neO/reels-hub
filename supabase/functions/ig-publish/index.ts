// "Post now": records the post and creates the Instagram container. ig-publish-queue (cron, every
// minute) finishes it once Meta has processed the video, so the user can close the tab.
// Body: { r2Key, caption, coverR2Key?, thumbOffsetMs?, durationSec?, shareToFeed, isTrial, trialStrategy? }
import { adminClient } from '../_shared/admin.ts'
import { authorize } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { getToken, igPost } from '../_shared/ig.ts'
import { presign } from '../_shared/r2.ts'

// Meta fetches the video while processing; give the URL plenty of headroom.
const VIDEO_URL_TTL = 6 * 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  const admin = adminClient()
  const caller = await authorize(req, admin)
  if (caller?.kind !== 'user') return json(req, { error: 'Unauthorized' }, 401)

  const b = await req.json().catch(() => ({}))
  if (typeof b.r2Key !== 'string' || !b.r2Key.startsWith('uploads/')) return json(req, { error: 'Missing video' }, 400)
  const caption = String(b.caption ?? '').slice(0, 2200)
  const isTrial = Boolean(b.isTrial)
  const trialStrategy = isTrial ? (b.trialStrategy === 'SS_PERFORMANCE' ? 'SS_PERFORMANCE' : 'MANUAL') : null

  const { data: post, error: insErr } = await admin
    .from('posts')
    .insert({
      created_by: caller.userId,
      r2_key: b.r2Key,
      caption,
      cover_r2_key: typeof b.coverR2Key === 'string' ? b.coverR2Key : null,
      thumb_offset_ms: Number.isFinite(b.thumbOffsetMs) ? Math.round(b.thumbOffsetMs) : null,
      duration_sec: Number.isFinite(b.durationSec) ? b.durationSec : null,
      share_to_feed: b.shareToFeed !== false,
      is_trial: isTrial,
      trial_strategy: trialStrategy,
      status: 'processing',
    })
    .select()
    .single()
  if (insErr) return json(req, { error: insErr.message }, 500)

  try {
    const tok = await getToken(admin)
    const params: Record<string, string | undefined> = {
      media_type: 'REELS',
      video_url: await presign('GET', post.r2_key, VIDEO_URL_TTL),
      caption,
      cover_url: post.cover_r2_key ? await presign('GET', post.cover_r2_key, VIDEO_URL_TTL) : undefined,
      thumb_offset: post.thumb_offset_ms != null && !post.cover_r2_key ? String(post.thumb_offset_ms) : undefined,
    }
    if (isTrial) {
      // Trial Reels are shown to non-followers first; graduation is MANUAL (in the app) or SS_PERFORMANCE (auto).
      params.trial_params = JSON.stringify({ graduation_strategy: trialStrategy })
    } else {
      params.share_to_feed = post.share_to_feed ? 'true' : 'false'
    }
    const container = await igPost(`/${tok.ig_user_id}/media`, params, tok.access_token)
    await admin.from('posts').update({ container_id: container.id }).eq('id', post.id)
    return json(req, { id: post.id, status: 'processing' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from('posts').update({ status: 'failed', error: msg }).eq('id', post.id)
    return json(req, { id: post.id, status: 'failed', error: msg }, 502)
  }
})
