import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, CheckCircle2, Loader2, RefreshCw, Star, Trash2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { must, startScrape, type Creator, type CreatorStats, type ScrapeRun } from '@/lib/api'
import { fmtAgo, fmtNum, parseTags, parseUsernames } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Discover } from '@/components/Discover'

export default function Creators() {
  const qc = useQueryClient()
  const [usernamesText, setUsernamesText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [benchmark, setBenchmark] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const creators = useQuery({
    queryKey: ['creators'],
    queryFn: async () => must(await supabase.from('creators').select('*').order('followers', { ascending: false, nullsFirst: false })) as Creator[],
  })
  const stats = useQuery({
    queryKey: ['creator_stats'],
    queryFn: async () => must(await supabase.from('creator_stats').select('*')) as CreatorStats[],
  })
  const runs = useQuery({
    queryKey: ['scrape_runs'],
    queryFn: async () => must(await supabase.from('scrape_runs').select('*').order('created_at', { ascending: false }).limit(8)) as ScrapeRun[],
    // Poll while anything is running, then refresh the creator list once it finishes.
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'running') ? 8000 : false),
  })
  const anyRunning = (runs.data ?? []).some((r) => r.status === 'running')
  useEffect(() => {
    // A scrape just finished (or the page loaded): refresh the creator list and stats.
    if (!anyRunning) {
      qc.invalidateQueries({ queryKey: ['creators'] })
      qc.invalidateQueries({ queryKey: ['creator_stats'] })
    }
  }, [anyRunning, qc])

  const statsById = useMemo(() => new Map((stats.data ?? []).map((s) => [s.creator_id, s])), [stats.data])
  const allTags = useMemo(() => [...new Set((creators.data ?? []).flatMap((c) => c.tags))].sort(), [creators.data])
  const shown = (creators.data ?? []).filter((c) => !tagFilter || c.tags.includes(tagFilter))

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['scrape_runs'] })
    qc.invalidateQueries({ queryKey: ['creators'] })
  }

  const add = useMutation({
    mutationFn: async () => {
      const usernames = parseUsernames(usernamesText)
      if (usernames.length === 0) throw new Error('Paste at least one valid Instagram username.')
      const tags = parseTags(tagsText)
      const rows = usernames.map((username) => ({ username, tags, is_benchmark: benchmark }))
      must(await supabase.from('creators').upsert(rows, { onConflict: 'username', ignoreDuplicates: true }))
      await startScrape(usernames)
      return usernames.length
    },
    onSuccess: (n) => {
      setUsernamesText('')
      setBenchmark(false)
      setNotice(`Added ${n} creator${n === 1 ? '' : 's'}. Scraping now; this usually takes 1–3 minutes.`)
      refreshAll()
    },
  })

  const scrape = useMutation({
    mutationFn: (usernames?: string[]) => startScrape(usernames),
    onSuccess: (d) => {
      setNotice(`Scraping ${d.usernames} creator${d.usernames === 1 ? '' : 's'}. This usually takes 1–3 minutes.`)
      refreshAll()
    },
  })

  const remove = useMutation({
    mutationFn: async (c: Creator) => must(await supabase.from('creators').delete().eq('id', c.id)),
    onSuccess: refreshAll,
  })

  const toggleBenchmark = useMutation({
    mutationFn: async (c: Creator) => must(await supabase.from('creators').update({ is_benchmark: !c.is_benchmark }).eq('id', c.id)),
    onSuccess: refreshAll,
  })

  function onAdd(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    add.mutate()
  }

  const error = add.error ?? scrape.error ?? remove.error ?? creators.error

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Creators</h1>
          <p className="text-muted-foreground">Accounts we track for outlier research. Rescraped automatically every week.</p>
        </div>
        <Button variant="outline" disabled={scrape.isPending || anyRunning || !creators.data?.length} onClick={() => scrape.mutate(undefined)}>
          {scrape.isPending || anyRunning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {anyRunning ? 'Scraping…' : 'Scrape all now'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add creators</CardTitle>
          <CardDescription>Paste usernames or profile links: one per line, or separated by commas.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAdd} className="grid gap-4 md:grid-cols-[1fr_280px]">
            <Textarea
              value={usernamesText}
              onChange={(e) => setUsernamesText(e.target.value)}
              placeholder={'@creator_one\ncreator_two\nhttps://instagram.com/creator_three'}
              rows={4}
            />
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tags">Tags (optional)</Label>
                <Input id="tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="sports massage, mobility" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={benchmark} onChange={(e) => setBenchmark(e.target.checked)} className="size-4 accent-primary" />
                This is Kevin (benchmark account)
              </label>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending && <Loader2 className="size-4 animate-spin" />}
                Add & scrape
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <Discover
        trackedUsernames={new Set((creators.data ?? []).map((c) => c.username))}
        searching={(runs.data ?? []).some((r) => r.status === 'running' && (r.kind === 'discover' || r.kind === 'candidate_profiles'))}
      />

      {(runs.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Recent scrapes</h2>
          <div className="flex flex-wrap gap-2">
            {runs.data!.map((r) => (
              <div key={r.id} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs" title={r.error ?? undefined}>
                {r.status === 'running' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                {r.status === 'succeeded' && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                {r.status === 'failed' && <XCircle className="size-3.5 text-destructive" />}
                <span className="font-medium">{r.kind === 'candidate_profiles' ? 'follower lookup' : r.kind}</span>
                <span className="text-muted-foreground">
                  {r.kind === 'discover' ? r.terms.join(', ') : `${r.usernames.length} acct`} · {r.status === 'succeeded' ? `${r.item_count ?? 0} items · ` : ''}
                  {fmtAgo(r.created_at)}
                </span>
                {r.status === 'failed' && <span className="max-w-64 truncate text-destructive">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Tag:</span>
          <Badge variant={tagFilter === null ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setTagFilter(null)}>
            all
          </Badge>
          {allTags.map((t) => (
            <Badge key={t} variant={tagFilter === t ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setTagFilter(t)}>
              {t}
            </Badge>
          ))}
        </div>
      )}

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Creator</th>
                <th className="px-3 py-2.5 text-right font-medium">Followers</th>
                <th className="px-3 py-2.5 text-right font-medium">Reels tracked</th>
                <th className="px-3 py-2.5 text-right font-medium">Median views</th>
                <th className="px-3 py-2.5 font-medium">Tags</th>
                <th className="px-3 py-2.5 font-medium">Last scraped</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {creators.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-4 animate-spin" />
                  </td>
                </tr>
              )}
              {!creators.isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No creators yet. Add some above.
                  </td>
                </tr>
              )}
              {shown.map((c) => {
                const s = statsById.get(c.id)
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          @{c.username}
                        </a>
                        {c.is_verified && <BadgeCheck className="size-3.5 text-sky-500" />}
                        {c.is_benchmark && <Badge variant="secondary">Kevin</Badge>}
                      </div>
                      {c.full_name && <div className="max-w-64 truncate text-xs text-muted-foreground">{c.full_name}</div>}
                      {c.scrape_error && (
                        <div className="mt-0.5 flex max-w-72 items-center gap-1 text-xs text-destructive" title={c.scrape_error}>
                          <AlertTriangle className="size-3 shrink-0" />
                          <span className="truncate">{c.scrape_error}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(c.followers)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {s?.reel_count ?? 0}
                      {(s?.reel_count ?? 0) > 0 && (s?.reel_count ?? 0) < 10 && (
                        <span className="ml-1 text-xs text-muted-foreground" title="Outlier scores need at least 10 reels">
                          (low)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(s?.median_views)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <Badge key={t} variant="outline" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{c.last_scraped_at ? fmtAgo(c.last_scraped_at) : 'pending'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={c.is_benchmark ? 'Unmark as Kevin' : 'Mark as Kevin (benchmark)'}
                          onClick={() => toggleBenchmark.mutate(c)}
                        >
                          <Star className={c.is_benchmark ? 'size-4 fill-amber-400 text-amber-400' : 'size-4'} />
                        </Button>
                        <Button variant="ghost" size="icon" title="Scrape now" disabled={anyRunning} onClick={() => scrape.mutate([c.username])}>
                          <RefreshCw className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove"
                          onClick={() => {
                            if (confirm(`Remove @${c.username} and all its scraped reels?`)) remove.mutate(c)
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
