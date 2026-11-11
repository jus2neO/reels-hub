import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

/** The only place the Instagram API version lives. */
export const IG_API_VERSION = 'v26.0'
const BASE = `https://graph.instagram.com/${IG_API_VERSION}`

export type IgToken = { ig_user_id: string; access_token: string; expires_at: string | null }

export async function getToken(admin: SupabaseClient): Promise<IgToken> {
  const { data, error } = await admin.from('ig_tokens').select('ig_user_id, access_token, expires_at').eq('id', 1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No Instagram token stored yet (ig_tokens is empty)')
  return data as IgToken
}

export class IgError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message)
  }
}

async function call(method: 'GET' | 'POST', path: string, params: Record<string, string | undefined>, token: string) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v)
  qs.set('access_token', token)
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const res =
    method === 'GET'
      ? await fetch(`${url}${url.includes('?') ? '&' : '?'}${qs}`)
      : await fetch(url, { method: 'POST', body: qs })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    const msg = body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${res.status}`
    throw new IgError(`Instagram: ${msg}`, res.status, body.error?.code)
  }
  return body
}

export const igGet = (path: string, params: Record<string, string | undefined>, token: string) => call('GET', path, params, token)
export const igPost = (path: string, params: Record<string, string | undefined>, token: string) => call('POST', path, params, token)
