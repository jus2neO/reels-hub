import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { RequireAuth } from '@/components/RequireAuth'
import { AuthProvider } from '@/lib/auth'
import Login from '@/pages/Login'
import { AI, Creators, Dashboard, Insights, Outliers, Publish } from '@/pages'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
})

// HashRouter: GitHub Pages has no SPA fallback, so /outliers would 404 on refresh.
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="publish" element={<Publish />} />
                <Route path="insights" element={<Insights />} />
                <Route path="creators" element={<Creators />} />
                <Route path="outliers" element={<Outliers />} />
                <Route path="ai" element={<AI />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
