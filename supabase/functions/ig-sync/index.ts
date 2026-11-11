// Pulls Kevin's account + media insights from the Instagram API.
// Called daily by pg_cron and by the "Sync now" button. First run backfills; later runs refresh
// the last 90 days of Reels and the last 3 days of account insights.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/admin.ts'
import { authorize } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { getToken, igGet, isPermissionError } from '../_shared/ig.ts'

const REEL_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'shares',
  'saved',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
]
const ACCOUNT_METRICS = ['views', 'reach', 'accounts_engaged', 'total_interactions']
const REFRESH_DAYS = 90
const DAY = 86400_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  const admin = adminClient()
  if (!(await authorize(req, admin))) return json(req, { error: 'Unauthorized' }, 401)

  try {
    const tok = await getToken(admin)
    const t = tok.access_token
    const warnings: string[] = []
    // Set when the token lacks instagram_manage_insights: skip insight calls, keep existing numbers.
    const state = { noInsights: false }

    // 1. Account basics → creators (benchmark row) + today's follower count.
    const me = await igGet(`/${tok.ig_user_id}`, { fields: 'username,followers_count,media_count' }, t)
    await admin
      .from('creators')
      .upsert({ username: String(me.username).toLowerCase(), followers: me.followers_count, is_benchmark: true }, { onConflict: 'username' })

    // 2. Account insights per day.
    const { count: dayCount } = await admin.from('kevin_account_daily').select('day', { count: 'exact', head: true })
    const accountDays = (dayCount ?? 0) === 0 ? 30 : 3
    for (let i = accountDays; i >= 1; i--) {
      if (state.noInsights) break
      const start = startOfUtcDay(Date.now() - i * DAY)
      const values = await metricsWithFallback(
        (metric) =>
          igGet(
            `/${tok.ig_user_id}/insights`,
            { metric, period: 'day', metric_type: 'total_value', since: String(start / 1000), until: String((start + DAY) / 1000) },
            t,
          ),
        ACCOUNT_METRICS,
        warnings,
        state,
      )
      if (state.noInsights) break
      await admin.from('kevin_account_daily').upsert(
        {
          day: new Date(start).toISOString().slice(0, 10),
          views: values.views ?? null,
          reach: values.reach ?? null,
          accounts_engaged: values.accounts_engaged ?? null,
          total_interactions: values.total_interactions ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'day' },
      )
    }
    await admin
      .from('kevin_account_daily')
      .upsert({ day: new Date().toISOString().slice(0, 10), followers: me.followers_count, updated_at: new Date().toISOString() }, { onConflict: 'day' })

    // 3. Media list (newest first). Backfill everything on first run, else stop past the refresh window.
    const { count: mediaCount } = await admin.from('kevin_media').select('ig_media_id', { count: 'exact', head: true })
    const backfill = (mediaCount ?? 0) < 5
    const cutoff = Date.now() - REFRESH_DAYS * DAY
    const media: Record<string, any>[] = []
    let next: string | undefined = `/${tok.ig_user_id}/media`
    let params: Record<string, string> = {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: '50',
    }
    while (next && media.length < 500) {
      const page = await igGet(next, params, t)
      media.push(...page.data)
      const last = page.data[page.data.length - 1]
      if (!backfill && last && new Date(last.timestamp).getTime() < cutoff) break
      next = page.paging?.next
      params = {} // the next URL already carries the query
    }

    // 4. Insights per Reel within the window (all Reels on backfill).
    const reels = media.filter((m) => m.media_product_type === 'REELS' && (backfill || new Date(m.timestamp).getTime() >= cutoff))
    const { data: existing } = await admin.from('kevin_media').select('ig_media_id, thumbnail_path').in('ig_media_id', reels.map((m) => m.id))
    const havePath = new Map((existing ?? []).map((e) => [e.ig_media_id, e.thumbnail_path]))

    for (const m of reels) {
      const insights = state.noInsights
        ? null
        : await metricsWithFallback((metric) => igGet(`/${m.id}/insights`, { metric }, t), REEL_METRICS, warnings, state)
      // Without the insights permission we still get likes/comments from the media list.
      const insightFields = {
        insights: { ...(insights ?? {}), like_count: m.like_count, comments_count: m.comments_count },
        insights_updated_at: new Date().toISOString(),
      }
      // Note: is_trial and duration_sec are not overwritten (set when published through Reels Hub).
      const { error } = await admin.from('kevin_media').upsert(
        {
          ig_media_id: m.id,
          caption: m.caption ?? null,
          media_type: m.media_type,
          media_product_type: m.media_product_type,
          permalink: m.permalink,
          thumbnail_url: m.thumbnail_url ?? null,
          posted_at: m.timestamp,
          ...insightFields,
        },
        { onConflict: 'ig_media_id' },
      )
      if (error) throw error
      if (!havePath.get(m.id) && m.thumbnail_url) await copyThumb(admin, m.id, m.thumbnail_url)
    }

    return json(req, {
      followers: me.followers_count,
      reelsSynced: reels.length,
      accountDays,
      insightsAvailable: !state.noInsights,
      warnings: [...new Set(warnings)].slice(0, 10),
    })
  } catch (e) {
    console.error(e)
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

const startOfUtcDay = (ms: number) => Math.floor(ms / DAY) * DAY

/**
 * Ask for all metrics in one call; if Meta rejects it (metrics get renamed or retired), ask one by one
 * and skip the ones that fail, so one bad metric never fails the whole sync.
 */
async function metricsWithFallback(
  fetchMetrics: (metric: string) => Promise<any>,
  metrics: string[],
  warnings: string[],
  state: { noInsights: boolean },
): Promise<Record<string, number>> {
  const read = (body: any) => {
    const out: Record<string, number> = {}
    for (const d of body.data ?? []) out[d.name] = d.total_value?.value ?? d.values?.[0]?.value
    return out
  }
  try {
    return read(await fetchMetrics(metrics.join(',')))
  } catch (e) {
    if (isPermissionError(e)) {
      state.noInsights = true
      warnings.push('Insights skipped: the Instagram token is missing the instagram_manage_insights permission.')
      return {}
    }
    const out: Record<string, number> = {}
    for (const metric of metrics) {
      try {
        Object.assign(out, read(await fetchMetrics(metric)))
      } catch (e) {
        warnings.push(`${metric}: ${e instanceof Error ? e.message : e}`)
      }
    }
    return out
  }
}

async function copyThumb(admin: SupabaseClient, id: string, url: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const path = `kevin/${id}.jpg`
    const up = await admin.storage
      .from('thumbs')
      .upload(path, await res.arrayBuffer(), { contentType: res.headers.get('content-type') ?? 'image/jpeg', upsert: true })
    if (!up.error) await admin.from('kevin_media').update({ thumbnail_path: path }).eq('ig_media_id', id)
  } catch (e) {
    console.error('thumb', id, e)
  }
}
