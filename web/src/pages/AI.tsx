import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, ClipboardCopy, ExternalLink, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { must, type Creator, type CreatorStats, type KevinMedia, type OutlierReel } from '@/lib/api'
import { fmtAgo, fmtNum } from '@/lib/format'
import { buildPrompt, DOC_CATEGORIES, QUICK_ACTIONS, type KnowledgeDoc } from '@/lib/prompt'
import { useSelection } from '@/lib/selection'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const AI_TOOLS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
]

const useDocs = () =>
  useQuery({
    queryKey: ['knowledge_docs'],
    queryFn: async () => must(await supabase.from('knowledge_docs').select('*').order('category').order('title')) as KnowledgeDoc[],
  })

export default function AI() {
  const [tab, setTab] = useState<'ask' | 'kb'>('ask')
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
          <p className="text-muted-foreground">
            Builds a ready-to-paste prompt with Kevin's knowledge base and the reels you picked. Paste it into ChatGPT or Claude.
          </p>
        </div>
        <div className="flex rounded-md border p-0.5 text-sm">
          {(['ask', 'kb'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn('rounded px-3 py-1.5', tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t === 'ask' ? 'Ask' : 'Knowledge base'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'ask' ? <Ask onEditKb={() => setTab('kb')} /> : <KnowledgeBase />}
    </div>
  )
}

/* ───────────── Ask ───────────── */

function Ask({ onEditKb }: { onEditKb: () => void }) {
  const sel = useSelection()
  const [question, setQuestion] = useState<string>(QUICK_ACTIONS[0].prompt)
  const [includeRecent, setIncludeRecent] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const docs = useDocs()
  const outliers = useQuery({
    queryKey: ['ai_outliers', sel.outliers],
    enabled: sel.outliers.length > 0,
    queryFn: async () => must(await supabase.from('reel_outliers').select('*').in('id', sel.outliers)) as OutlierReel[],
  })
  const kevinSelected = useQuery({
    queryKey: ['ai_kevin', sel.kevin],
    enabled: sel.kevin.length > 0,
    queryFn: async () => must(await supabase.from('kevin_media').select('*').in('ig_media_id', sel.kevin)) as KevinMedia[],
  })
  const kevinRecent = useQuery({
    queryKey: ['ai_kevin_recent'],
    enabled: includeRecent,
    queryFn: async () =>
      must(await supabase.from('kevin_media').select('*').eq('media_product_type', 'REELS').order('posted_at', { ascending: false }).limit(10)) as KevinMedia[],
  })
  const kevinMedian = useQuery({
    queryKey: ['ai_kevin_median'],
    queryFn: async () => {
      const k = must(await supabase.from('creators').select('id').eq('is_benchmark', true).limit(1)) as Pick<Creator, 'id'>[]
      if (!k[0]) return null
      const s = must(await supabase.from('creator_stats').select('*').eq('creator_id', k[0].id)) as CreatorStats[]
      return s[0]?.median_views ?? null
    },
  })

  const outlierRows = (outliers.data ?? []).filter((r) => sel.outliers.includes(r.id))
  const kevinRows = useMemo(() => {
    const picked = (kevinSelected.data ?? []).filter((m) => sel.kevin.includes(m.ig_media_id))
    if (!includeRecent) return picked
    const seen = new Set(picked.map((m) => m.ig_media_id))
    return [...picked, ...(kevinRecent.data ?? []).filter((m) => !seen.has(m.ig_media_id))]
  }, [kevinSelected.data, kevinRecent.data, includeRecent, sel.kevin])

  const prompt = useMemo(
    () => buildPrompt({ docs: docs.data ?? [], outliers: outlierRows, kevinReels: kevinRows, kevinMedian: kevinMedian.data ?? null, question }),
    [docs.data, outlierRows, kevinRows, kevinMedian.data, question],
  )
  const activeDocs = (docs.data ?? []).filter((d) => d.active && d.content.trim()).length
  const loading = outliers.isFetching || kevinSelected.isFetching || kevinRecent.isFetching || docs.isLoading

  async function copy(openUrl?: string, tool?: string) {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(tool ?? 'clipboard')
      setTimeout(() => setCopied(null), 4000)
    } catch {
      setCopied('failed')
    }
    if (openUrl) window.open(openUrl, '_blank', 'noopener')
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Reels to analyze</CardTitle>
          <CardDescription>
            Tick reels on <Link to="/outliers" className="underline">Outliers</Link> or <Link to="/insights" className="underline">Insights</Link>, then
            come back here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sel.count === 0 && <p className="text-sm text-muted-foreground">No reels selected yet.</p>}
          <div className="flex flex-col gap-1.5">
            {outlierRows.map((r) => (
              <SelectedRow
                key={r.id}
                label={`@${r.username}`}
                meta={`${fmtNum(r.views)} views · ${r.outlier_score}×`}
                text={r.caption}
                onRemove={() => sel.toggle('outliers', r.id)}
              />
            ))}
            {(kevinSelected.data ?? [])
              .filter((m) => sel.kevin.includes(m.ig_media_id))
              .map((m) => (
                <SelectedRow
                  key={m.ig_media_id}
                  label="Kevin"
                  meta={`${fmtNum(m.insights?.views)} views${m.is_trial ? ' · trial' : ''}`}
                  text={m.caption}
                  onRemove={() => sel.toggle('kevin', m.ig_media_id)}
                />
              ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={includeRecent} onCheckedChange={setIncludeRecent} />
              Also include Kevin's 10 latest Reels
            </label>
            {sel.count > 0 && (
              <Button variant="ghost" size="sm" onClick={sel.clear}>
                Clear selection
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Question</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((a) => (
              <Button key={a.label} variant={question === a.prompt ? 'default' : 'outline'} size="sm" onClick={() => setQuestion(a.prompt)}>
                <Sparkles className="size-3.5" />
                {a.label}
              </Button>
            ))}
          </div>
          <Textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Or ask anything…" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Copy and paste into your AI</CardTitle>
          <CardDescription>
            Includes {activeDocs} knowledge doc{activeDocs === 1 ? '' : 's'}
            {activeDocs === 0 && (
              <>
                {' '}
                (empty:{' '}
                <button type="button" className="underline" onClick={onEditKb}>
                  add Kevin's info
                </button>{' '}
                for much better answers)
              </>
            )}{' '}
            · {outlierRows.length + kevinRows.length} reels · {prompt.length.toLocaleString()} characters
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {AI_TOOLS.map((t) => (
              <Button key={t.name} disabled={loading} onClick={() => copy(t.url, t.name)}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                Copy & open {t.name}
              </Button>
            ))}
            <Button variant="outline" disabled={loading} onClick={() => copy()}>
              <ClipboardCopy className="size-4" />
              Copy only
            </Button>
          </div>
          {copied && copied !== 'failed' && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700">
              <Check className="size-4" />
              Copied. {copied !== 'clipboard' ? `In ${copied}, ` : ''}paste with Ctrl+V and send.
            </p>
          )}
          {copied === 'failed' && <p className="text-sm text-destructive">Couldn't copy automatically. Select the text below and copy it.</p>}
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">Preview prompt</summary>
            <pre className="max-h-96 overflow-auto border-t px-3 py-2 text-xs whitespace-pre-wrap">{prompt}</pre>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}

function SelectedRow({ label, meta, text, onRemove }: { label: string; meta: string; text: string | null; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="shrink-0 font-medium">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{text?.split('\n')[0]}</span>
      <Button variant="ghost" size="icon" className="size-7" onClick={onRemove} title="Remove">
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

/* ───────────── Knowledge base ───────────── */

const STARTER_DOCS: { title: string; category: string; hint: string }[] = [
  { title: "Kevin's bio and story", category: 'bio', hint: 'Background, credentials, competitions, why he teaches.' },
  { title: 'K-Ching business overview', category: 'business', hint: 'What K-Ching is, Maximum Efficiency Techniques, who the audience is.' },
  { title: 'Courses and offers', category: 'course', hint: 'Each course/offer: name, who it’s for, outcome, price, link.' },
  { title: 'Voice and caption rules', category: 'voice', hint: 'Tone, words he uses/avoids, structure of a caption, scope-of-practice rules.' },
  { title: 'Best past captions', category: 'past_captions', hint: '20–30 of his best captions with view counts.' },
  { title: 'Comment-keyword CTAs', category: 'offer', hint: 'Each keyword (e.g. HIP47) and what it sends.' },
]

type Draft = { id?: string; title: string; category: string; content: string; active: boolean }

function KnowledgeBase() {
  const qc = useQueryClient()
  const docs = useDocs()
  const [draft, setDraft] = useState<Draft | null>(null)

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const row = { title: d.title.trim(), category: d.category || null, content: d.content, active: d.active, updated_at: new Date().toISOString() }
      if (d.id) must(await supabase.from('knowledge_docs').update(row).eq('id', d.id))
      else must(await supabase.from('knowledge_docs').insert(row))
    },
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['knowledge_docs'] })
    },
  })
  const toggle = useMutation({
    mutationFn: async (d: KnowledgeDoc) => must(await supabase.from('knowledge_docs').update({ active: !d.active }).eq('id', d.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge_docs'] }),
  })
  const remove = useMutation({
    mutationFn: async (d: KnowledgeDoc) => must(await supabase.from('knowledge_docs').delete().eq('id', d.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge_docs'] }),
  })

  const existingTitles = new Set((docs.data ?? []).map((d) => d.title))
  const missingStarters = STARTER_DOCS.filter((s) => !existingTitles.has(s.title))

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Everything the AI should know about Kevin. Active docs are added to every prompt. Keep them factual and up to date: prices, links, current offers.
      </p>

      {draft ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cat">Category</Label>
                <select
                  id="cat"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">—</option>
                  {DOC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="content">Content</Label>
              <Textarea id="content" rows={14} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            </div>
            {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
            <div className="flex gap-2">
              <Button disabled={!draft.title.trim() || save.isPending} onClick={() => save.mutate(draft)}>
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Save
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDraft({ title: '', category: '', content: '', active: true })}>
            <Plus className="size-4" />
            New doc
          </Button>
          {missingStarters.map((s) => (
            <Button key={s.title} variant="outline" size="sm" title={s.hint} onClick={() => setDraft({ title: s.title, category: s.category, content: '', active: true })}>
              <BookOpen className="size-3.5" />
              {s.title}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {docs.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {docs.data?.length === 0 && <p className="text-sm text-muted-foreground">No docs yet. Start with the suggested ones above.</p>}
        {docs.data?.map((d) => (
          <Card key={d.id} className={cn('gap-2 py-3', !d.active && 'opacity-60')}>
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">{d.title}</span>
                {d.category && <Badge variant="outline">{d.category.replace('_', ' ')}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {d.content.length.toLocaleString()} chars · updated {fmtAgo(d.updated_at)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Switch checked={d.active} onCheckedChange={() => toggle.mutate(d)} title={d.active ? 'Included in prompts' : 'Not included'} />
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => setDraft({ id: d.id, title: d.title, category: d.category ?? '', content: d.content, active: d.active })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Delete" onClick={() => confirm(`Delete "${d.title}"?`) && remove.mutate(d)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <p className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{d.content || '(empty)'}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
