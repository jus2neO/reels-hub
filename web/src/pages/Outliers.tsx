import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, Loader2, Play } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { must, thumbUrl, type Creator, type CreatorStats, type OutlierReel } from '@/lib/api'
import { fmtAgo, fmtDuration, fmtNum } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useSelection } from '@/lib/selection'
import { AnalyzeBar } from '@/components/AnalyzeBar'

type Filters = {
  minFollowers: string
  maxFollowers: string
  minScore: string
  minVpf: string
  withinDays: string // '' = any time
  duration: '' | 'short' | 'mid' | 'long'
  tag: string
  keyword: string
  includeKevin: boolean
  sort: 'outlier_score' | 'views' | 'views_per_follower' | 'posted_at'
}

const DEFAULTS: Filters = {
  minFollowers: '',
  maxFollowers: '',
  minScore: '3',
  minVpf: '',
  withinDays: '90',
  duration: '',
  tag: '',
  keyword: '',
  includeKevin: false,
  sort: 'outlier_score',
}

const FOLLOWER_PRESETS = [
  { label: 'Any size', min: '', max: '' },
  { label: '1k–20k', min: '1000', max: '20000' },
  { label: '20k–100k', min: '20000', max: '100000' },
  { label: '100k+', min: '100000', max: '' },
]

const selectCls =
  'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export default function Outliers() {
  const [f, setF] = useState<Filters>(DEFAULTS)
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const filters = useDeferredValue(f)

  const creators = useQuery({
    queryKey: ['creators'],
    queryFn: async () => must(await supabase.from('creators').select('*')) as Creator[],
  })
  const stats = useQuery({
    queryKey: ['creator_stats'],
    queryFn: async () => must(await supabase.from('creator_stats').select('*')) as CreatorStats[],
  })
  const kevin = useMemo(() => {
    const k = creators.data?.find((c) => c.is_benchmark)
    const s = k && stats.data?.find((x) => x.creator_id === k.id)
    return k ? { username: k.username, median: s?.median_views ?? null, reels: s?.reel_count ?? 0 } : null
  }, [creators.data, stats.data])
  const allTags = useMemo(() => [...new Set((creators.data ?? []).flatMap((c) => c.tags))].sort(), [creators.data])

  const reels = useQuery({
    queryKey: ['outliers', filters],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('reel_outliers').select('*')
      const num = (s: string) => (s.trim() === '' ? null : Number(s))
      if (num(filters.minScore) != null) q = q.gte('outlier_score', num(filters.minScore)!)
      if (num(filters.minFollowers) != null) q = q.gte('followers', num(filters.minFollowers)!)
      if (num(filters.maxFollowers) != null) q = q.lte('followers', num(filters.maxFollowers)!)
      if (num(filters.minVpf) != null) q = q.gte('views_per_follower', num(filters.minVpf)!)
      if (filters.withinDays) q = q.gte('posted_at', new Date(Date.now() - Number(filters.withinDays) * 86400_000).toISOString())
      if (filters.duration === 'short') q = q.lt('duration_sec', 15)
      if (filters.duration === 'mid') q = q.gte('duration_sec', 15).lte('duration_sec', 60)
      if (filters.duration === 'long') q = q.gt('duration_sec', 60)
      if (filters.tag) q = q.contains('tags', [filters.tag])
      if (filters.keyword.trim()) q = q.ilike('caption', `%${filters.keyword.trim().replace(/[%_]/g, '')}%`)
      if (!filters.includeKevin) q = q.eq('is_benchmark', false)
      q = q.order(filters.sort, { ascending: false, nullsFirst: false }).limit(200)
      return must(await q) as OutlierReel[]
    },
  })

  const preset = FOLLOWER_PRESETS.findIndex((p) => p.min === f.minFollowers && p.max === f.maxFollowers)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outliers</h1>
          <p className="text-muted-foreground">Reels that beat their creator's median views. Creators need 10+ tracked reels to be scored.</p>
        </div>
        <div className="rounded-md border px-3 py-2 text-sm">
          {kevin ? (
            <>
              <span className="text-muted-foreground">Kevin's median: </span>
              <span className="font-semibold tabular-nums">{fmtNum(kevin.median)}</span>
              <span className="text-muted-foreground"> views · {kevin.reels} reels</span>
            </>
          ) : (
            <span className="text-muted-foreground">Mark Kevin's account with ★ on Creators to compare</span>
          )}
        </div>
      </div>

      <Card className="gap-0 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 xl:grid-cols-8">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Followers</Label>
            <div className="flex gap-1.5">
              <select
                className={cn(selectCls, 'w-28')}
                value={preset === -1 ? 'custom' : String(preset)}
                onChange={(e) => {
                  const p = FOLLOWER_PRESETS[Number(e.target.value)]
                  if (p) setF((prev) => ({ ...prev, minFollowers: p.min, maxFollowers: p.max }))
                }}
              >
                {FOLLOWER_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
                {preset === -1 && <option value="custom">Custom</option>}
              </select>
              <Input inputMode="numeric" placeholder="min" value={f.minFollowers} onChange={(e) => set('minFollowers', e.target.value)} />
              <Input inputMode="numeric" placeholder="max" value={f.maxFollowers} onChange={(e) => set('maxFollowers', e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="score">Min score</Label>
            <Input id="score" inputMode="decimal" value={f.minScore} onChange={(e) => set('minScore', e.target.value)} placeholder="3" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vpf">Min views/follower</Label>
            <Input id="vpf" inputMode="decimal" value={f.minVpf} onChange={(e) => set('minVpf', e.target.value)} placeholder="e.g. 1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="within">Posted within</Label>
            <select id="within" className={selectCls} value={f.withinDays} onChange={(e) => set('withinDays', e.target.value)}>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="">Any time</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duration">Length</Label>
            <select id="duration" className={selectCls} value={f.duration} onChange={(e) => set('duration', e.target.value as Filters['duration'])}>
              <option value="">Any</option>
              <option value="short">Under 15s</option>
              <option value="mid">15–60s</option>
              <option value="long">Over 60s</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag">Tag</Label>
            <select id="tag" className={selectCls} value={f.tag} onChange={(e) => set('tag', e.target.value)}>
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sort">Sort by</Label>
            <select id="sort" className={selectCls} value={f.sort} onChange={(e) => set('sort', e.target.value as Filters['sort'])}>
              <option value="outlier_score">Outlier score</option>
              <option value="views">Views</option>
              <option value="views_per_follower">Views/follower</option>
              <option value="posted_at">Newest</option>
            </select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5 md:col-span-3 xl:col-span-6">
            <Label htmlFor="kw">Caption keyword</Label>
            <Input id="kw" value={f.keyword} onChange={(e) => set('keyword', e.target.value)} placeholder="e.g. hamstring, posture, IT band" />
          </div>
          <div className="col-span-2 flex items-end gap-4 pb-2 text-sm md:col-span-1 xl:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.includeKevin} onChange={(e) => set('includeKevin', e.target.checked)} className="size-4 accent-primary" />
              Include Kevin
            </label>
            <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => setF(DEFAULTS)}>
              Reset
            </button>
          </div>
        </div>
      </Card>

      {reels.error && <p className="text-sm text-destructive">{reels.error.message}</p>}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {reels.isFetching && <Loader2 className="size-3.5 animate-spin" />}
        {reels.data && `${reels.data.length}${reels.data.length === 200 ? '+' : ''} reels`}
      </div>

      {reels.data && reels.data.length === 0 && !reels.isFetching && (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No reels match. Try a lower min score or a longer time range, or add creators on the Creators page.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {reels.data?.map((r) => <ReelCard key={r.id} r={r} kevinMedian={kevin?.median ?? null} />)}
      </div>
      <AnalyzeBar />
    </div>
  )
}

function ReelCard({ r, kevinMedian }: { r: OutlierReel; kevinMedian: number | null }) {
  const hook = (r.caption ?? '').split('\n').find((l) => l.trim()) ?? ''
  const src = thumbUrl(r)
  const vsKevin = kevinMedian && r.views ? r.views / kevinMedian : null
  const sel = useSelection()
  const selected = sel.outliers.includes(r.id)
  return (
    <a
      href={r.url ?? `https://www.instagram.com/reel/${r.shortcode}/`}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="relative aspect-[9/16] bg-muted">
        {src && <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
        <div className="absolute top-2 left-2">
          <Badge className="bg-black/75 text-white tabular-nums backdrop-blur">{r.outlier_score?.toFixed(1)}×</Badge>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 pb-1.5 text-xs text-white">
          <span className="flex items-center gap-1 font-medium tabular-nums">
            <Play className="size-3 fill-white" />
            {fmtNum(r.views)}
          </span>
          <span className="tabular-nums">{fmtDuration(r.duration_sec)}</span>
        </div>
        <button
          type="button"
          title={selected ? 'Remove from AI selection' : 'Select for AI analysis'}
          onClick={(e) => {
            e.preventDefault() // don't open the reel
            sel.toggle('outliers', r.id)
          }}
          className={cn(
            'absolute top-2 right-2 flex size-6 items-center justify-center rounded-md border-2 border-white shadow transition-opacity',
            selected ? 'bg-primary opacity-100' : 'bg-black/30 opacity-70 group-hover:opacity-100',
          )}
        >
          {selected && <Check className="size-4 text-primary-foreground" />}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">@{r.username}</span>
          <span className="shrink-0 text-muted-foreground">{fmtNum(r.followers)}</span>
        </div>
        {hook && <p className="line-clamp-2 text-muted-foreground">{hook}</p>}
        <div className="mt-auto flex flex-wrap gap-x-2 gap-y-0.5 pt-1 text-muted-foreground tabular-nums">
          <span title="Views ÷ followers">{r.views_per_follower ?? '—'} v/f</span>
          <span title="Creator's median views">med {fmtNum(r.median_views)}</span>
          {vsKevin != null && <span title="Views compared to Kevin's median">{vsKevin.toFixed(1)}× Kevin</span>}
          <span>{fmtAgo(r.posted_at)}</span>
        </div>
      </div>
    </a>
  )
}
