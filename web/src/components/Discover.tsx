import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ExternalLink, EyeOff, Loader2, Plus, Search } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { invoke, must, startScrape } from '@/lib/api'
import { fmtNum } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type Candidate = {
  username: string
  full_name: string | null
  followers: number | null
  posts_count: number | null
  is_verified: boolean | null
  bio: string | null
  sources: string[]
  hits: number
  best_views: number | null
  best_reel_url: string | null
  best_caption: string | null
  status: 'new' | 'added' | 'dismissed'
  profile_scraped_at: string | null
}

const RANGES = [
  { label: 'Any size', min: 0, max: Infinity },
  { label: '1k–20k', min: 1000, max: 20000 },
  { label: '20k–100k', min: 20000, max: 100000 },
  { label: '100k+', min: 100000, max: Infinity },
]

const SUGGESTED = 'sportsmassage, thaimassage, massagetherapist, deeptissuemassage, mobility'

/** Find new creators by searching reels under hashtags / keywords. */
export function Discover({ trackedUsernames, searching }: { trackedUsernames: Set<string>; searching: boolean }) {
  const qc = useQueryClient()
  const [terms, setTerms] = useState('')
  const [keyword, setKeyword] = useState(false)
  const [range, setRange] = useState(1)
  const [sort, setSort] = useState<'hits' | 'best_views' | 'followers'>('hits')
  const [notice, setNotice] = useState<string | null>(null)

  const candidates = useQuery({
    queryKey: ['creator_candidates'],
    queryFn: async () =>
      must(await supabase.from('creator_candidates').select('*').eq('status', 'new').order('hits', { ascending: false }).limit(500)) as Candidate[],
    refetchInterval: searching ? 10_000 : false,
  })

  const search = useMutation({
    mutationFn: () =>
      invoke<{ terms: string[] }>('apify-start', {
        mode: 'discover',
        terms: terms.split(/[,\s]+/).filter(Boolean),
        keyword,
      }),
    onSuccess: (d) => {
      setNotice(`Searching ${d.terms.map((t) => (keyword ? `"${t}"` : `#${t}`)).join(', ')}. Results appear below in 2–4 minutes; follower counts fill in shortly after.`)
      qc.invalidateQueries({ queryKey: ['scrape_runs'] })
    },
  })

  const add = useMutation({
    mutationFn: async (c: Candidate) => {
      must(await supabase.from('creators').upsert({ username: c.username, full_name: c.full_name }, { onConflict: 'username', ignoreDuplicates: true }))
      must(await supabase.from('creator_candidates').update({ status: 'added' }).eq('username', c.username))
      await startScrape([c.username])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator_candidates'] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      qc.invalidateQueries({ queryKey: ['scrape_runs'] })
    },
  })

  const dismiss = useMutation({
    mutationFn: async (c: Candidate) => must(await supabase.from('creator_candidates').update({ status: 'dismissed' }).eq('username', c.username)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator_candidates'] }),
  })

  const shown = useMemo(() => {
    const r = RANGES[range]
    return (candidates.data ?? [])
      .filter((c) => !trackedUsernames.has(c.username))
      .filter((c) => range === 0 || (c.followers != null && c.followers >= r.min && c.followers <= r.max))
      .sort((a, b) => ((b[sort] ?? -1) as number) - ((a[sort] ?? -1) as number))
  }, [candidates.data, trackedUsernames, range, sort])
  const pendingFollowers = (candidates.data ?? []).filter((c) => !c.profile_scraped_at && !trackedUsernames.has(c.username)).length

  function onSearch(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    search.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discover creators</CardTitle>
        <CardDescription>
          Search recent Reels by hashtag or keyword to find accounts in the niche. Each search uses a little Apify credit (about 5–15¢ for a few
          hashtags).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={SUGGESTED} className="flex-1" />
          <div className="flex rounded-md border p-0.5 text-sm">
            {[false, true].map((k) => (
              <button
                key={String(k)}
                type="button"
                onClick={() => setKeyword(k)}
                className={cn('rounded px-2.5 py-1', keyword === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
              >
                {k ? 'Keywords' : 'Hashtags'}
              </button>
            ))}
          </div>
          <Button type="submit" disabled={search.isPending || !terms.trim()}>
            {search.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Search
          </Button>
        </form>
        <p className="-mt-2 text-xs text-muted-foreground">Up to 5 at a time, separated by commas. About 50 recent Reels are checked per term.</p>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        {search.error && <p className="text-sm text-destructive">{search.error.message}</p>}
        {(add.error || dismiss.error) && <p className="text-sm text-destructive">{(add.error ?? dismiss.error)!.message}</p>}

        {(candidates.data?.length ?? 0) > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Followers:</span>
              {RANGES.map((r, i) => (
                <Badge key={r.label} variant={range === i ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setRange(i)}>
                  {r.label}
                </Badge>
              ))}
              <span className="ml-2 text-muted-foreground">Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="h-7 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="hits">Times found</option>
                <option value="best_views">Best reel views</option>
                <option value="followers">Followers</option>
              </select>
              {searching && pendingFollowers > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  {pendingFollowers} follower counts loading
                </span>
              )}
            </div>

            <div className="flex max-h-[28rem] flex-col divide-y overflow-y-auto rounded-md border">
              {shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">No candidates in this follower range yet.</p>}
              {shown.map((c) => (
                <div key={c.username} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        @{c.username}
                      </a>
                      {c.is_verified && <BadgeCheck className="size-3.5 text-sky-500" />}
                      <span className="text-muted-foreground tabular-nums">
                        {c.followers != null ? `${fmtNum(c.followers)} followers` : c.profile_scraped_at ? 'followers unknown' : searching ? 'loading…' : 'followers not checked'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · found {c.hits}× in {c.sources.join(', ')}
                      </span>
                    </div>
                    {c.full_name && <p className="truncate text-xs text-muted-foreground">{c.full_name}</p>}
                    {c.best_caption && (
                      <a
                        href={c.best_reel_url ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span className="shrink-0 font-medium tabular-nums">{fmtNum(c.best_views)} views:</span>
                        <span className="truncate">{c.best_caption.split('\n')[0]}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" disabled={add.isPending} onClick={() => add.mutate(c)}>
                      <Plus className="size-3.5" />
                      Add
                    </Button>
                    <Button size="icon" variant="ghost" title="Not relevant: hide" onClick={() => dismiss.mutate(c)}>
                      <EyeOff className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
