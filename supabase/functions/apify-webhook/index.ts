// Receives Apify run events. Validates the shared secret, then (in the background, so Apify
// gets a fast 200 and doesn't retry) fetches the dataset and upserts creators / reels.
// URL: /functions/v1/apify-webhook?secret=<APIFY_WEBHOOK_SECRET>&kind=profiles|reels
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient, requireEnv, safeEqual } from '../_shared/admin.ts'
import { datasetItems, startRun } from '../_shared/apify.ts'

type Item = Record<string, any>
type Kind = 'profiles' | 'reels' | 'discover' | 'candidate_profiles'

const CANDIDATE_PROFILE_BATCH = 40 // profiles to look up per discovery search (cost control)

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret') ?? ''
  if (!safeEqual(secret, requireEnv('APIFY_WEBHOOK_SECRET'))) return new Response('Forbidden', { status: 403 })

  const kind = url.searchParams.get('kind') as Kind
  if (!['profiles', 'reels', 'discover', 'candidate_profiles'].includes(kind)) return new Response('Bad kind', { status: 400 })

  const payload = await req.json().catch(() => null)
  const run = payload?.resource
  if (!run?.id) return new Response('Bad payload', { status: 400 })

  EdgeRuntime.waitUntil(handle(kind, payload.eventType as string, run).catch((e) => console.error('webhook failed', e)))
  return new Response('ok')
})

async function handle(kind: Kind, eventType: string, run: Item) {
  const admin = adminClient()
  const { data: runRow } = await admin.from('scrape_runs').select('usernames, terms').eq('apify_run_id', run.id).maybeSingle()
  const usernames: string[] = runRow?.usernames ?? []
  const terms: string[] = runRow?.terms ?? []

  if (eventType !== 'ACTOR.RUN.SUCCEEDED') {
    const error = `${kind} scrape ${String(run.status ?? eventType).toLowerCase()}: ${run.statusMessage ?? 'no details'}`
    await finishRun(admin, run.id, 'failed', null, error)
    if (usernames.length && (kind === 'profiles' || kind === 'reels')) {
      await admin.from('creators').update({ scrape_error: error }).in('username', usernames)
    }
    return
  }

  try {
    const items = await datasetItems<Item>(run.defaultDatasetId)
    const count =
      kind === 'profiles'
        ? await saveProfiles(admin, items)
        : kind === 'reels'
          ? await saveReels(admin, items)
          : kind === 'discover'
            ? await saveDiscovery(admin, items, terms)
            : await saveCandidateProfiles(admin, items)
    await finishRun(admin, run.id, 'succeeded', count, null)
  } catch (e) {
    await finishRun(admin, run.id, 'failed', null, e instanceof Error ? e.message : String(e))
    throw e
  }
}

async function finishRun(admin: SupabaseClient, runId: string, status: string, count: number | null, error: string | null) {
  await admin
    .from('scrape_runs')
    .update({ status, item_count: count, error, finished_at: new Date().toISOString() })
    .eq('apify_run_id', runId)
}

const usernameFromItem = (it: Item): string | undefined =>
  (it.username ?? it.ownerUsername ?? String(it.inputUrl ?? '').split('/').filter(Boolean).pop())?.toLowerCase()

async function saveProfiles(admin: SupabaseClient, items: Item[]): Promise<number> {
  let saved = 0
  const now = new Date().toISOString()
  for (const it of items) {
    const username = usernameFromItem(it)
    if (!username) continue
    if (it.error) {
      await admin.from('creators').update({ scrape_error: `Profile: ${it.errorDescription ?? it.error}` }).eq('username', username)
      continue
    }
    const { error } = await admin
      .from('creators')
      .upsert(
        {
          username,
          full_name: it.fullName ?? null,
          followers: it.followersCount ?? null,
          following: it.followsCount ?? null,
          posts_count: it.postsCount ?? null,
          bio: it.biography ?? null,
          is_verified: it.verified ?? null,
          profile_pic_url: it.profilePicUrlHD ?? it.profilePicUrl ?? null,
          last_scraped_at: now,
          scrape_error: null,
        },
        { onConflict: 'username' },
      )
    if (error) throw error
    saved++
  }
  return saved
}

async function saveReels(admin: SupabaseClient, items: Item[]): Promise<number> {
  const reels = items.filter((it) => !it.error && it.shortCode && (it.type === 'Video' || it.productType === 'clips'))

  // Report creators the scraper couldn't read (private, renamed, not found).
  for (const it of items.filter((x) => x.error)) {
    const username = usernameFromItem(it)
    if (username) await admin.from('creators').update({ scrape_error: `Reels: ${it.errorDescription ?? it.error}` }).eq('username', username)
  }
  if (reels.length === 0) return 0

  const owners = [...new Set(reels.map((r) => String(r.ownerUsername ?? '').toLowerCase()).filter(Boolean))]
  const { data: creators, error: cErr } = await admin.from('creators').select('id, username').in('username', owners)
  if (cErr) throw cErr
  const creatorId = new Map((creators ?? []).map((c) => [c.username, c.id]))

  const rows = reels
    .filter((r) => creatorId.has(String(r.ownerUsername).toLowerCase())) // skip collab reels from untracked accounts
    .map((r) => ({
      creator_id: creatorId.get(String(r.ownerUsername).toLowerCase()),
      shortcode: r.shortCode,
      url: r.url ?? `https://www.instagram.com/reel/${r.shortCode}/`,
      caption: r.caption ?? null,
      hashtags: r.hashtags ?? [],
      // Play count matches what Instagram shows on Reels; fall back to view count.
      views: r.videoPlayCount ?? r.videoViewCount ?? null,
      likes: r.likesCount != null && r.likesCount >= 0 ? r.likesCount : null, // -1 = likes hidden
      comments: r.commentsCount ?? null,
      duration_sec: r.videoDuration ?? null,
      posted_at: r.timestamp ?? null,
      thumbnail_url: r.displayUrl ?? null,
      audio_name: r.musicInfo ? `${r.musicInfo.artist_name ?? ''} · ${r.musicInfo.song_name ?? ''}` : null,
      raw: r,
      scraped_at: new Date().toISOString(),
    }))

  // Keep thumbnails we already copied.
  const { data: existing } = await admin
    .from('reels')
    .select('shortcode, thumbnail_path')
    .in('shortcode', rows.map((r) => r.shortcode))
  const havePath = new Map((existing ?? []).map((e) => [e.shortcode, e.thumbnail_path as string | null]))

  const { error } = await admin.from('reels').upsert(rows, { onConflict: 'shortcode' })
  if (error) throw error

  // Copy missing thumbnails into Storage (Instagram CDN URLs expire within days).
  const todo = rows.filter((r) => r.thumbnail_url && !havePath.get(r.shortcode))
  await pool(todo, 8, async (r) => {
    const path = `reels/${r.shortcode}.jpg`
    const res = await fetch(r.thumbnail_url!)
    if (!res.ok) return
    const up = await admin.storage
      .from('thumbs')
      .upload(path, await res.arrayBuffer(), { contentType: res.headers.get('content-type') ?? 'image/jpeg', upsert: true })
    if (!up.error) await admin.from('reels').update({ thumbnail_path: path }).eq('shortcode', r.shortcode)
  })

  await admin
    .from('creators')
    .update({ last_scraped_at: new Date().toISOString() })
    .in('id', [...new Set(rows.map((r) => r.creator_id))])
  return rows.length
}

/** Group discovered reels by owner and merge them into creator_candidates, then look up follower counts. */
async function saveDiscovery(admin: SupabaseClient, items: Item[], terms: string[]): Promise<number> {
  type Row = { username: string; full_name: string | null; hits: number; best_views: number; best_reel_url: string | null; best_caption: string | null }
  const byOwner = new Map<string, Row>()
  for (const it of items) {
    if (it.error || !it.ownerUsername) continue
    const username = String(it.ownerUsername).toLowerCase()
    const views = Number(it.videoPlayCount ?? it.videoViewCount ?? 0)
    const cur = byOwner.get(username) ?? { username, full_name: it.ownerFullName ?? null, hits: 0, best_views: -1, best_reel_url: null, best_caption: null }
    cur.hits++
    if (views > cur.best_views) {
      cur.best_views = views
      cur.best_reel_url = it.url ?? (it.shortCode ? 'https://www.instagram.com/reel/' + it.shortCode + '/' : null)
      cur.best_caption = it.caption ? String(it.caption).slice(0, 500) : null
    }
    byOwner.set(username, cur)
  }
  const rows = [...byOwner.values()]
  if (rows.length === 0) return 0
  const { error } = await admin.rpc('merge_creator_candidates', { rows, terms })
  if (error) throw error

  // Follower counts for new candidates not looked up yet (most frequent first), skipping tracked creators.
  const { data: tracked } = await admin.from('creators').select('username').in('username', rows.map((r) => r.username))
  const trackedSet = new Set((tracked ?? []).map((t) => t.username))
  const { data: need } = await admin
    .from('creator_candidates')
    .select('username')
    .in('username', rows.map((r) => r.username).filter((u) => !trackedSet.has(u)))
    .is('profile_scraped_at', null)
    .order('hits', { ascending: false })
    .limit(CANDIDATE_PROFILE_BATCH)
  const lookup = (need ?? []).map((n) => n.username)
  if (lookup.length) {
    const runId = await startRun('candidate_profiles', { usernames: lookup })
    await admin.from('scrape_runs').insert({ apify_run_id: runId, kind: 'candidate_profiles', usernames: lookup, terms })
  }
  return rows.length
}

async function saveCandidateProfiles(admin: SupabaseClient, items: Item[]): Promise<number> {
  let saved = 0
  const now = new Date().toISOString()
  for (const it of items) {
    const username = usernameFromItem(it)
    if (!username) continue
    const patch = it.error
      ? { profile_scraped_at: now }
      : {
          full_name: it.fullName ?? null,
          followers: it.followersCount ?? null,
          posts_count: it.postsCount ?? null,
          is_verified: it.verified ?? null,
          bio: it.biography ?? null,
          profile_scraped_at: now,
          updated_at: now,
        }
    const { error } = await admin.from('creator_candidates').update(patch).eq('username', username)
    if (error) throw error
    if (!it.error) saved++
  }
  return saved
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item).catch((e) => console.error('thumbnail failed', e))
    }
  })
  await Promise.all(workers)
}
