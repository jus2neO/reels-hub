import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (see web/.env.example)')
}

// PKCE is required with HashRouter: the default implicit flow returns
// "#access_token=..." in the URL hash, which the router would treat as a route.
// PKCE returns "?code=..." instead, which supabase-js exchanges on load.
export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** Where magic links send the user back to (the app root, e.g. https://jus2neo.github.io/IG_Hub_MET/). */
export const appRootUrl = () => window.location.origin + import.meta.env.BASE_URL
