import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { invoke, must, thumbUrl, type KevinMedia } from '@/lib/api'
import { fmtAgo, fmtDuration, fmtNum } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useSelection } from '@/lib/selection'
import { AnalyzeBar } from '@/components/AnalyzeBar'

type Row = KevinMedia & {
  views: number | null
  reach: number | null
  shares: number | null
  saved: number | null
  likes: number | null
  comments: number | null
  avgWatch: number | null // seconds
  er: number | null // engagement rate, % of reach
}

const COLS: { key: keyof Row; label: string; fmt: (r: Row) => string }[] = [
  { key: 'views', label: 'Views', fmt: (r) => fmtNum(r.views) },
  { key: 'reach', label: 'Reach', fmt: (r) => fmtNum(r.reach) },
  { key: 'likes', label: 'Likes', fmt: (r) => fmtNum(r.likes) },
  { key: 'comments', label: 'Comments', fmt: (r) => fmtNum(r.comments) },
  { key: 'shares', label: 'Shares', fmt: (r) => fmtNum(r.shares) },
  { key: 'saved', label: 'Saves', fmt: (r) => fmtNum(r.saved) },
  { key: 'avgWatch', label: 'Avg watch', fmt: (r) => (r.avgWatch == null ? '—' : `${r.avgWatch.toFixed(1)}s`) },
  { key: 'er', label: 'Eng. rate', fmt: (r) => (r.er == null ? '—' : `${r.er.toFixed(1)}%`) },
  { key: 'posted_at', label: 'Posted', fmt: (r) => fmtAgo(r.posted_at) },
]

export default function Insights() {
  const qc = useQueryClient()
  const [sort, setSort] = useState<keyof Row>('posted_at')
  const [filter, setFilter] = useState<'all' | 'trial' | 'regular'>('all')
  const sel = useSelection()

  const media = useQuery({
    queryKey: ['kevin_media'],
    queryFn: async () =>
      must(await supabase.from('kevin_media').select('*').eq('media_product_type', 'REELS').order('posted_at', { ascending: false })) as KevinMedia[],
  })

  const sync = useMutation({
    mutationFn: () => invoke<{ reelsSynced: number; warnings: string[] }>('ig-sync'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['kevin_media'] })
      qc.invalidateQueries({ queryKey: ['account_daily'] })
    },
  })

  const rows: Row[] = useMemo(
    () =>
      (media.data ?? []).map((m) => {
        const i = m.insights ?? {}
        const reach = i.reach ?? null
        const interactions = i.total_interactions ?? null
        return {
          ...m,
          views: i.views ?? null,
          reach,
          shares: i.shares ?? null,
          saved: i.saved ?? null,
          likes: i.likes ?? i.like_count ?? null,
          comments: i.comments ?? i.comments_count ?? null,
          avgWatch: i.ig_reels_avg_watch_time != null ? i.ig_reels_avg_watch_time / 1000 : null,
          er: reach && interactions != null ? (interactions / reach) * 100 : null,
        }
      }),
    [media.data],
  )

  const shown = useMemo(() => {
    const f = rows.filter((r) => filter === 'all' || (filter === 'trial' ? r.is_trial : !r.is_trial))
    return [...f].sort((a, b) => {
      const av = a[sort] as number | string | null
      const bv = b[sort] as number | string | null
      if (av == null) return 1
      if (bv == null) return -1
      return av < bv ? 1 : av > bv ? -1 : 0
    })
  }, [rows, sort, filter])

  const viewsSeries = useMemo(
    () =>
      [...rows]
        .filter((r) => r.posted_at && r.views != null)
        .sort((a, b) => a.posted_at!.localeCompare(b.posted_at!))
        .slice(-40)
        .map((r) => ({ date: r.posted_at!.slice(5, 10), views: r.views, hook: r.caption?.split('\n')[0]?.slice(0, 60) })),
    [rows],
  )
  const watchVsDuration = rows.filter((r) => r.duration_sec && r.avgWatch != null).map((r) => ({ duration: r.duration_sec, avgWatch: r.avgWatch, views: r.views ?? 0 }))

  const lastSync = rows.reduce<string | null>((max, r) => (r.insights_updated_at && (!max || r.insights_updated_at > max) ? r.insights_updated_at : max), null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="text-muted-foreground">Kevin's Reels from the Instagram API. Synced daily{lastSync ? ` · last sync ${fmtAgo(lastSync)}` : ''}.</p>
        </div>
        <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sync now
        </Button>
      </div>
      {sync.error && <p className="text-sm text-destructive">{sync.error.message}</p>}
      {sync.data?.warnings?.length ? (
        <p className="text-xs text-amber-700">Some metrics were skipped: {sync.data.warnings.join('; ')}</p>
      ) : null}

      {rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Views per Reel</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={viewsSeries}>
                  <CartesianGrid vertical={false} strokeOpacity={0.2} />
                  <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => fmtNum(v)} width={40} />
                  <Tooltip formatter={(v) => fmtNum(Number(v))} labelFormatter={(_l, p) => p?.[0]?.payload?.hook ?? ''} />
                  <Bar dataKey="views" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Avg watch time vs length</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {watchVsDuration.length === 0 ? (
                <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                  Appears once Reels are published through Reels Hub (Instagram doesn't report video length).
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeOpacity={0.2} />
                    <XAxis dataKey="duration" name="Length" unit="s" fontSize={11} type="number" />
                    <YAxis dataKey="avgWatch" name="Avg watch" unit="s" fontSize={11} type="number" width={40} />
                    <ZAxis dataKey="views" range={[40, 300]} name="Views" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter data={watchVsDuration} fill="var(--chart-2)" />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex gap-1.5">
        {(['all', 'regular', 'trial'] as const).map((f) => (
          <Badge key={f} variant={filter === f ? 'default' : 'outline'} className="cursor-pointer capitalize" onClick={() => setFilter(f)}>
            {f === 'all' ? 'All Reels' : f === 'trial' ? 'Trial Reels' : 'Regular'}
          </Badge>
        ))}
      </div>

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 pl-4" title="Select for AI analysis" />
                <th className="px-4 py-2.5 text-left font-medium">Reel</th>
                {COLS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                    <button type="button" onClick={() => setSort(c.key)} className={cn('inline-flex items-center gap-1 hover:text-foreground', sort === c.key && 'text-foreground')}>
                      {c.label}
                      {sort === c.key && <ArrowDown className="size-3" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {media.isLoading && (
                <tr>
                  <td colSpan={COLS.length + 2} className="py-8 text-center">
                    <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!media.isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 2} className="px-4 py-8 text-center text-muted-foreground">
                    No Reels yet. Click Sync now once Kevin's Instagram is connected.
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const src = thumbUrl(r)
                return (
                  <tr key={r.ig_media_id} className={cn('border-b last:border-0 hover:bg-muted/30', sel.kevin.includes(r.ig_media_id) && 'bg-muted/50')}>
                    <td className="pl-4">
                      <input
                        type="checkbox"
                        aria-label="Select for AI analysis"
                        className="size-4 accent-primary"
                        checked={sel.kevin.includes(r.ig_media_id)}
                        onChange={() => sel.toggle('kevin', r.ig_media_id)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <a href={r.permalink ?? '#'} target="_blank" rel="noreferrer" className="group flex items-center gap-3">
                        <div className="h-14 w-8 shrink-0 overflow-hidden rounded bg-muted">{src && <img src={src} alt="" loading="lazy" className="size-full object-cover" />}</div>
                        <div className="min-w-0">
                          <p className="line-clamp-2 max-w-80 text-sm group-hover:underline">{r.caption?.split('\n')[0] || '(no caption)'}</p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {r.is_trial && <Badge variant="secondary">Trial</Badge>}
                            {r.duration_sec != null && <span>{fmtDuration(r.duration_sec)}</span>}
                            <ExternalLink className="size-3 opacity-0 group-hover:opacity-100" />
                          </div>
                        </div>
                      </a>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        {c.fmt(r)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <AnalyzeBar />
    </div>
  )
}
