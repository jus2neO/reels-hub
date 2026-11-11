// Starts Apify scrapes (profile + reels) for tracked creators.
// Called by the Creators page ("Scrape now") with a user JWT, or weekly by pg_cron with x-cron-secret.
// Body: { usernames?: string[], limit?: number }  — no usernames = all tracked creators.
//    or { mode: 'discover', terms: string[], keyword?: boolean, limit?: number } — find new creators.
import { adminClient } from '../_shared/admin.ts'
import { startRun, type ScrapeKind } from '../_shared/apify.ts'
import { authorize, type Caller } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

const DEFAULT_REELS_PER_CREATOR = 30
const MAX_REELS_PER_CREATOR = 100

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405)

  const admin = adminClient()
  const caller = await authorize(req, admin)
  if (!caller) return json(req, { error: 'Unauthorized' }, 401)

  try {
    const body = await req.json().catch(() => ({}))
    if (body.mode === 'discover') return await discover(req, admin, caller, body)
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_REELS_PER_CREATOR, 1), MAX_REELS_PER_CREATOR)

    let usernames: string[]
    if (Array.isArray(body.usernames) && body.usernames.length > 0) {
      usernames = body.usernames.map((u: unknown) => String(u).trim().toLowerCase()).filter(Boolean)
    } else {
      const { data, error } = await admin.from('creators').select('username')
      if (error) throw error
      usernames = (data ?? []).map((c) => c.username)
    }
    if (usernames.length === 0) return json(req, { error: 'No creators to scrape' }, 400)

    const inputs: Record<ScrapeKind, unknown> = {
      profiles: { usernames },
      reels: { username: usernames, resultsLimit: limit, skipPinnedPosts: true },
    }

    const runs = []
    for (const kind of ['profiles', 'reels'] as ScrapeKind[]) {
      const runId = await startRun(kind, inputs[kind])
      const { error } = await admin.from('scrape_runs').insert({
        apify_run_id: runId,
        kind,
        usernames,
        started_by: caller.kind === 'user' ? caller.userId : null,
      })
      if (error) throw error
      runs.push({ kind, runId })
    }
    return json(req, { started: runs, usernames: usernames.length })
  } catch (e) {
    console.error(e)
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

const MAX_TERMS = 5
const DEFAULT_DISCOVER_LIMIT = 50 // reels per hashtag/keyword

/** Search reels under hashtags (or keywords); apify-webhook turns their owners into candidates. */
async function discover(req: Request, admin: ReturnType<typeof adminClient>, caller: Caller, body: any) {
  const terms: string[] = [
    ...new Set<string>(
      (Array.isArray(body.terms) ? body.terms : [])
        .map((t: unknown) => String(t).trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_TERMS)
  if (terms.length === 0) return json(req, { error: 'Enter at least one hashtag or keyword' }, 400)
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_DISCOVER_LIMIT, 10), 100)
  const keyword = Boolean(body.keyword)

  const runId = await startRun('discover', { hashtags: terms, keywordSearch: keyword, resultsType: 'reels', resultsLimit: limit })
  const { error } = await admin.from('scrape_runs').insert({
    apify_run_id: runId,
    kind: 'discover',
    terms: terms.map((t) => (keyword ? t : '#' + t)),
    started_by: caller.kind === 'user' ? caller.userId : null,
  })
  if (error) throw error
  return json(req, { started: [{ kind: 'discover', runId }], terms })
}
