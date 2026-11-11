import { Loader2 } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
