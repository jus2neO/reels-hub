// Pulls Kevin's account + media insights from the Instagram API.
// Called daily by pg_cron and by the "Sync now" button. Works within a time budget so it never hits
// the Edge Function limit: each run first fills in Reels from the last year that have never been
// synced (newest first), then refreshes Reels from the last 90 days. Repeated runs finish a backfill.
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
const REFRESH_DAYS = 90 // re-pull insights for Reels this recent
const BACKFILL_DAYS = 365 // never-synced Reels older than this are skipped
const STALE_MS = 12 * 3600_000 // don't refresh a Reel synced within the last 12h
const BUDGET_MS = 100_000 // stop starting new work after this (function limit is ~150s)
const PARALLEL = 4
const DAY = 86400_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  const admin = adminClient()
  if (!(await authorize(req, admin))) return json(req, { error: 'Unauthorized' }, 401)

  const startedAt = Date.now()
  const outOfTime = () => Date.now() - startedAt > BUDGET_MS
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
    const dayStarts = Array.from({ length: accountDays }, (_, k) => startOfUtcDay(Date.now() - (k + 1) * DAY))
    await inBatches(dayStarts, PARALLEL, async (start) => {
      if (state.noInsights) return
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
      if (state.noInsights) return
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
    })
    await admin
      .from('kevin_account_daily')
      .upsert({ day: new Date().toISOString().slice(0, 10), followers: me.followers_count, updated_at: new Date().toISOString() }, { onConflict: 'day' })

    // 3. Media list (newest first), back to BACKFILL_DAYS. Listing is cheap; insights are the slow part.
    const backfillCutoff = Date.now() - BACKFILL_DAYS * DAY
    const refreshCutoff = Date.now() - REFRESH_DAYS * DAY
    const media: Record<string, any>[] = []
    let next: string | undefined = `/${tok.ig_user_id}/media`
    let params: Record<string, string> = {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: '50',
    }
    while (next && media.length < 1000) {
      const page = await igGet(next, params, t)
      media.push(...page.data)
      const last = page.data[page.data.length - 1]
      if (last && new Date(last.timestamp).getTime() < backfillCutoff) break
      next = page.paging?.next
      params = {} // the next URL already carries the query
    }

    // 4. Pick the work: never-synced Reels first (newest first), then stale recent Reels.
    const reels = media.filter((m) => m.media_product_type === 'REELS' && new Date(m.timestamp).getTime() >= backfillCutoff)
    const existing: { ig_media_id: string; thumbnail_path: string | null; insights_updated_at: string | null }[] = []
    for (let i = 0; i < reels.length; i += 200) {
      const { data } = await admin
        .from('kevin_media')
        .select('ig_media_id, thumbnail_path, insights_updated_at')
        .in('ig_media_id', reels.slice(i, i + 200).map((m) => m.id))
      existing.push(...(data ?? []))
    }
    const known = new Map(existing.map((e) => [e.ig_media_id, e]))
    const synced = (id: string) => (known.get(id)?.insights_updated_at ? new Date(known.get(id)!.insights_updated_at!).getTime() : 0)
    const neverSynced = reels.filter((m) => !synced(m.id))
    const stale = reels.filter(
      (m) => synced(m.id) && new Date(m.timestamp).getTime() >= refreshCutoff && Date.now() - synced(m.id) > STALE_MS,
    )
    const todo = [...neverSynced, ...stale]
    let done = 0

    await inBatches(todo, PARALLEL, async (m) => {
      if (outOfTime()) return
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
      if (!known.get(m.id)?.thumbnail_path && m.thumbnail_url) await copyThumb(admin, m.id, m.thumbnail_url)
      done++
    })

    return json(req, {
      followers: me.followers_count,
      reelsSynced: done,
      reelsRemaining: todo.length - done,
      complete: done === todo.length,
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

/** Run fn over items, `size` at a time. */
async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

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
