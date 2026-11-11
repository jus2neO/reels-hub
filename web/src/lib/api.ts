import { supabase } from './supabase'

export type Creator = {
  id: string
  username: string
  full_name: string | null
  followers: number | null
  posts_count: number | null
  is_verified: boolean | null
  tags: string[]
  is_benchmark: boolean
  last_scraped_at: string | null
  scrape_error: string | null
  created_at: string
}

export type CreatorStats = {
  creator_id: string
  reel_count: number
  median_views: number | null
  latest_reel_at: string | null
}

export type ScrapeRun = {
  id: string
  kind: 'profiles' | 'reels'
  usernames: string[]
  status: 'running' | 'succeeded' | 'failed'
  item_count: number | null
  error: string | null
  created_at: string
  finished_at: string | null
}

export type OutlierReel = {
  id: string
  creator_id: string
  shortcode: string
  url: string | null
  caption: string | null
  views: number | null
  likes: number | null
  comments: number | null
  duration_sec: number | null
  posted_at: string | null
  thumbnail_url: string | null
  thumbnail_path: string | null
  username: string
  followers: number | null
  is_benchmark: boolean
  tags: string[]
  median_views: number
  sample_size: number
  outlier_score: number | null
  views_per_follower: number | null
}

/** Unwraps a Supabase error into a thrown Error so React Query shows it. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** Call an Edge Function and surface its JSON `error` message on failure. */
export async function invoke<T>(fn: string, body?: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: body ?? {} })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const detail = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(detail?.error ?? error.message)
  }
  return data as T
}

/** Start Apify scrapes. No usernames = all tracked creators. */
export const startScrape = (usernames?: string[]) =>
  invoke<{ started: { kind: string; runId: string }[]; usernames: number }>('apify-start', { usernames })

export type PostRow = {
  id: string
  caption: string | null
  is_trial: boolean
  trial_strategy: 'MANUAL' | 'SS_PERFORMANCE' | null
  share_to_feed: boolean
  status: 'processing' | 'published' | 'failed'
  ig_media_id: string | null
  error: string | null
  created_at: string
  published_at: string | null
}

export type ReelInsights = {
  views?: number
  reach?: number
  likes?: number
  comments?: number
  shares?: number
  saved?: number
  total_interactions?: number
  ig_reels_avg_watch_time?: number // ms
  ig_reels_video_view_total_time?: number // ms
  like_count?: number
  comments_count?: number
}

export type KevinMedia = {
  ig_media_id: string
  caption: string | null
  media_product_type: string | null
  permalink: string | null
  thumbnail_url: string | null
  thumbnail_path: string | null
  posted_at: string | null
  duration_sec: number | null
  is_trial: boolean
  insights: ReelInsights | null
  insights_updated_at: string | null
}

export type AccountDay = {
  day: string
  followers: number | null
  views: number | null
  reach: number | null
  accounts_engaged: number | null
  total_interactions: number | null
}

export const thumbUrl = (r: { thumbnail_path: string | null; thumbnail_url: string | null }) =>
  r.thumbnail_path ? supabase.storage.from('thumbs').getPublicUrl(r.thumbnail_path).data.publicUrl : r.thumbnail_url
