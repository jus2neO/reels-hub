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

/** Start Apify scrapes. No usernames = all tracked creators. */
export async function startScrape(usernames?: string[]) {
  const { data, error } = await supabase.functions.invoke('apify-start', { body: { usernames } })
  if (error) {
    // Surface the function's JSON error message when there is one.
    const ctx = (error as { context?: Response }).context
    const detail = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(detail?.error ?? error.message)
  }
  return data as { started: { kind: string; runId: string }[]; usernames: number }
}

export const thumbUrl = (r: { thumbnail_path: string | null; thumbnail_url: string | null }) =>
  r.thumbnail_path ? supabase.storage.from('thumbs').getPublicUrl(r.thumbnail_path).data.publicUrl : r.thumbnail_url
