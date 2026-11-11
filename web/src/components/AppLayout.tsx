import {
  BarChart3,
  Bot,
  LayoutDashboard,
  LogOut,
  Menu,
  Sparkles,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/publish', label: 'Publish', icon: Upload },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/creators', label: 'Creators', icon: Users },
  { to: '/outliers', label: 'Outliers', icon: Sparkles },
  { to: '/ai', label: 'AI', icon: Bot },
]

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useAuth()
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="px-2 py-3 text-base font-semibold tracking-tight">Reels Hub</div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-sidebar-border pt-3">
        <div className="truncate px-2 pb-2 text-xs text-muted-foreground">{session?.user.email}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => supabase.auth.signOut()}>
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <div className="sticky top-0 h-svh">
          <Sidebar />
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 border-r border-sidebar-border bg-sidebar">
            <Button variant="ghost" size="icon" className="absolute top-3 right-2" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-4" />
          </Button>
          <span className="font-semibold">Reels Hub</span>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
