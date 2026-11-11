import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

export function requireEnv(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing secret ${name}`)
  return v
}

/** Service-role key: the legacy env var, or the first key in SUPABASE_SECRET_KEYS (new key format). */
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    const first = Object.values(parsed)[0]
    if (first) return first
  }
  throw new Error('No service role key available')
}

/** Client that bypasses RLS. Only use inside Edge Functions. */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}
