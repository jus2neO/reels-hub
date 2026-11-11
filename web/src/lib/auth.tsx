import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

type AuthState = {
  session: Session | null
  loading: boolean
  /** Error passed back in the magic-link redirect (e.g. expired link). */
  linkError: string | null
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, linkError: null })

/** Remove ?code=… / ?error=… left by the magic-link redirect, keeping the hash route. */
function cleanAuthParams() {
  const { search, pathname, hash } = window.location
  if (search) window.history.replaceState(null, '', pathname + hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [linkError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('error_description')
  })

  useEffect(() => {
    // getSession waits for supabase-js to finish exchanging a ?code= from the URL.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      cleanAuthParams()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => sub.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ session, loading, linkError }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
