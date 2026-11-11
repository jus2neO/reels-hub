import { requireEnv } from './admin.ts'

const APIFY = 'https://api.apify.com/v2'

export const ACTORS = {
  profiles: 'apify~instagram-profile-scraper',
  reels: 'apify~instagram-reel-scraper',
} as const
export type ScrapeKind = keyof typeof ACTORS

function authHeaders() {
  return { Authorization: `Bearer ${requireEnv('APIFY_TOKEN')}` }
}

/** Start an actor run asynchronously; Apify calls apify-webhook when it finishes (or fails). */
export async function startRun(kind: ScrapeKind, input: unknown): Promise<string> {
  const webhookUrl =
    `${requireEnv('SUPABASE_URL')}/functions/v1/apify-webhook` +
    `?secret=${encodeURIComponent(requireEnv('APIFY_WEBHOOK_SECRET'))}&kind=${kind}`
  const webhooks = btoa(
    JSON.stringify([
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
        requestUrl: webhookUrl,
      },
    ]),
  )
  const res = await fetch(`${APIFY}/acts/${ACTORS[kind]}/runs?webhooks=${encodeURIComponent(webhooks)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Apify start ${kind} failed: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.data.id as string
}

/** All items of a dataset (pages through in chunks of 1000). */
export async function datasetItems<T = Record<string, unknown>>(datasetId: string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${APIFY}/datasets/${datasetId}/items?clean=true&format=json&limit=1000&offset=${offset}`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error(`Apify dataset ${datasetId} failed: ${res.status}`)
    const page = (await res.json()) as T[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}
