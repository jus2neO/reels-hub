import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { safeEqual } from './admin.ts'

export type Caller = { kind: 'user'; userId: string } | { kind: 'cron' }

/**
 * Accepts either the cron secret (x-cron-secret header, from pg_cron via Vault)
 * or a logged-in team member's Supabase JWT. Returns null if neither is valid.
 */
export async function authorize(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const cronSecret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (cronSecret && given && safeEqual(given, cronSecret)) return { kind: 'cron' }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return { kind: 'user', userId: data.user.id }
}
