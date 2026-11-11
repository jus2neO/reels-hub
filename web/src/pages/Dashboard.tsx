import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { must, thumbUrl, type AccountDay, type KevinMedia, type OutlierReel, type PostRow } from '@/lib/api'
import { fmtAgo, fmtNum } from '@/lib/format'
import { supabase } from '@/lib/supabase'

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString()

export default function Dashboard() {
  const days = useQuery({
    queryKey: ['account_daily'],
    queryFn: async () =>
      must(await supabase.from('kevin_account_daily').select('*').gte('day', daysAgo(60).slice(0, 10)).order('day')) as AccountDay[],
  })
  const top = useQuery({
    queryKey: ['dashboard_top'],
    queryFn: async () => {
      const rows = must(
        await supabase.from('kevin_media').select('*').eq('media_product_type', 'REELS').gte('posted_at', daysAgo(30)),
      ) as KevinMedia[]
      return rows.sort((a, b) => (b.insights?.views ?? 0) - (a.insights?.views ?? 0)).slice(0, 5)
    },
  })
  const processing = useQuery({
    queryKey: ['posts', 'processing'],
    queryFn: async () => must(await supabase.from('posts').select('*').eq('status', 'processing').order('created_at')) as PostRow[],
    refetchInterval: 15_000,
  })
  const outliers = useQuery({
    queryKey: ['dashboard_outliers'],
    queryFn: async () =>
      must(
        await supabase
          .from('reel_outliers')
          .select('*')
          .eq('is_benchmark', false)
          .gte('posted_at', daysAgo(30))
          .gte('outlier_score', 3)
          .order('outlier_score', { ascending: false })
          .limit(6),
      ) as OutlierReel[],
  })

  const d = days.data ?? []
  const followers = [...d].reverse().find((x) => x.followers != null)?.followers ?? null
  const followers30 = d.find((x) => x.followers != null && x.day >= daysAgo(31).slice(0, 10))?.followers ?? null
  const sum = (from: number, to: number, k: 'views' | 'reach') =>
    d.filter((x) => x.day >= daysAgo(from).slice(0, 10) && x.day < daysAgo(to).slice(0, 10)).reduce((s, x) => s + (x[k] ?? 0), 0)
  const views30 = sum(30, 0, 'views')
  const reach30 = sum(30, 0, 'reach')
  const viewsPrev = sum(60, 30, 'views')
  const hasData = d.some((x) => x.views != null)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">@train.with.kching at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Followers" value={fmtNum(followers)} sub={followers != null && followers30 != null && followers30 !== followers ? `${followers - followers30 >= 0 ? '+' : ''}${fmtNum(followers - followers30)} in 30 days` : undefined} />
        <Stat
          label="Views · 30 days"
          value={hasData ? fmtNum(views30) : '—'}
          sub={hasData && viewsPrev > 0 ? `${views30 >= viewsPrev ? '+' : ''}${Math.round(((views30 - viewsPrev) / viewsPrev) * 100)}% vs prior 30` : undefined}
        />
        <Stat label="Reach · 30 days" value={hasData ? fmtNum(reach30) : '—'} sub="Sum of daily reach" />
        <Stat label="Posting now" value={String(processing.data?.length ?? 0)} sub={processing.data?.length ? 'Processing on Instagram' : 'Nothing in progress'} />
      </div>
      {!hasData && !days.isLoading && (
        <p className="text-sm text-muted-foreground">
          No Instagram data yet. Open <Link to="/insights" className="underline">Insights</Link> and click Sync now.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Top Reels · last 30 days</CardTitle>
            <Link to="/insights" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Insights <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {top.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {top.data?.length === 0 && <p className="text-sm text-muted-foreground">No Reels in the last 30 days.</p>}
            {top.data?.map((m) => {
              const src = thumbUrl(m)
              return (
                <a key={m.ig_media_id} href={m.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:opacity-80">
                  <div className="h-14 w-8 shrink-0 overflow-hidden rounded bg-muted">{src && <img src={src} alt="" className="size-full object-cover" />}</div>
                  <p className="line-clamp-2 flex-1 text-sm">{m.caption?.split('\n')[0] || '(no caption)'}</p>
                  <div className="text-right text-sm">
                    <div className="font-medium tabular-nums">{fmtNum(m.insights?.views)}</div>
                    <div className="text-xs text-muted-foreground">{fmtAgo(m.posted_at)}</div>
                  </div>
                </a>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Latest outliers · last 30 days</CardTitle>
            <Link to="/outliers" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Outliers <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            {outliers.data?.length === 0 && <p className="col-span-3 text-sm text-muted-foreground">No 3×+ outliers in the last 30 days.</p>}
            {outliers.data?.map((r) => {
              const src = thumbUrl(r)
              return (
                <a key={r.id} href={r.url ?? '#'} target="_blank" rel="noreferrer" className="group flex flex-col gap-1">
                  <div className="relative aspect-[9/16] overflow-hidden rounded-md bg-muted">
                    {src && <img src={src} alt="" loading="lazy" className="size-full object-cover" />}
                    <Badge className="absolute top-1.5 left-1.5 bg-black/75 text-white">{r.outlier_score?.toFixed(1)}×</Badge>
                  </div>
                  <span className="truncate text-xs font-medium">@{r.username}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtNum(r.views)} views</span>
                </a>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  )
}
