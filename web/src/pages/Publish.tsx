import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, FlaskConical, ImagePlus, Loader2, Upload, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { invoke, must, type PostRow } from '@/lib/api'
import { fmtAgo, fmtDuration } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const MAX_VIDEO_MB = 300
const CAPTION_MAX = 2200

type Upload = { file: File; url: string; duration: number | null; width: number; height: number; key: string | null; progress: number; error: string | null }

/** PUT a file to a presigned URL with upload progress. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('Upload failed (network or CORS)'))
    xhr.send(file)
  })
}

async function uploadToR2(file: File, onProgress: (pct: number) => void): Promise<string> {
  const { uploadUrl, key } = await invoke<{ uploadUrl: string; key: string }>('r2-upload-url', {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  })
  await putWithProgress(uploadUrl, file, onProgress)
  return key
}

function readVideoMeta(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
    v.onerror = () => reject(new Error("Couldn't read this video"))
    v.src = url
  })
}

export default function Publish() {
  const qc = useQueryClient()
  const [video, setVideo] = useState<Upload | null>(null)
  const [cover, setCover] = useState<{ file: File; url: string; key: string | null; progress: number } | null>(null)
  const [caption, setCaption] = useState('')
  const [thumbOffset, setThumbOffset] = useState(0)
  const [shareToFeed, setShareToFeed] = useState(true)
  const [isTrial, setIsTrial] = useState(false)
  const [strategy, setStrategy] = useState<'MANUAL' | 'SS_PERFORMANCE'>('MANUAL')
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)

  const posts = useQuery({
    queryKey: ['posts'],
    queryFn: async () => must(await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(20)) as PostRow[],
    refetchInterval: (q) => ((q.state.data ?? []).some((p) => p.status === 'processing') ? 10_000 : false),
  })

  useEffect(() => {
    const url = video?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [video?.url])

  async function pickVideo(file: File | undefined) {
    if (!file) return
    setDone(null)
    if (!['video/mp4', 'video/quicktime'].includes(file.type)) {
      setVideo({ file, url: '', duration: null, width: 0, height: 0, key: null, progress: 0, error: 'Use an MP4 or MOV file.' })
      return
    }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      setVideo({ file, url: '', duration: null, width: 0, height: 0, key: null, progress: 0, error: `Max ${MAX_VIDEO_MB} MB.` })
      return
    }
    const url = URL.createObjectURL(file)
    let meta = { duration: 0, width: 0, height: 0 }
    try {
      meta = await readVideoMeta(url)
    } catch {
      /* still allow upload; Instagram will validate */
    }
    const lengthError = meta.duration && (meta.duration < 3 || meta.duration > 15 * 60) ? 'Reels must be between 3 seconds and 15 minutes.' : null
    const base: Upload = { file, url, duration: meta.duration || null, width: meta.width, height: meta.height, key: null, progress: 0, error: lengthError }
    setVideo(base)
    setThumbOffset(0)
    if (lengthError) return
    try {
      const key = await uploadToR2(file, (progress) => setVideo((v) => (v && v.file === file ? { ...v, progress } : v)))
      setVideo((v) => (v && v.file === file ? { ...v, key, progress: 100 } : v))
    } catch (e) {
      setVideo((v) => (v && v.file === file ? { ...v, error: e instanceof Error ? e.message : String(e) } : v))
    }
  }

  async function pickCover(file: File | undefined) {
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) return
    const url = URL.createObjectURL(file)
    setCover({ file, url, key: null, progress: 0 })
    try {
      const key = await uploadToR2(file, (progress) => setCover((c) => (c && c.file === file ? { ...c, progress } : c)))
      setCover((c) => (c && c.file === file ? { ...c, key } : c))
    } catch {
      setCover(null)
    }
  }

  const publish = useMutation({
    mutationFn: () =>
      invoke<{ id: string; status: string }>('ig-publish', {
        r2Key: video!.key,
        caption,
        coverR2Key: cover?.key ?? undefined,
        thumbOffsetMs: cover ? undefined : Math.round(thumbOffset * 1000),
        durationSec: video!.duration ?? undefined,
        shareToFeed,
        isTrial,
        trialStrategy: isTrial ? strategy : undefined,
      }),
    onSuccess: () => {
      setDone(isTrial ? 'Trial Reel sent to Instagram.' : 'Reel sent to Instagram.')
      setVideo(null)
      setCover(null)
      setCaption('')
      setIsTrial(false)
      qc.invalidateQueries({ queryKey: ['posts'] })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  })

  const uploading = !!video && !video.key && !video.error
  const notVertical = video && video.width && video.height && Math.abs(video.width / video.height - 9 / 16) > 0.05
  const canPost = !!video?.key && !publish.isPending && (!cover || !!cover.key)

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    pickVideo(e.dataTransfer.files[0])
  }

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Publish</h1>
        <p className="text-muted-foreground">Post a Reel or Trial Reel to @train.with.kching. It goes live 1–3 minutes after you click Post; you can close the tab.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Video */}
        <div className="flex flex-col gap-3">
          {!video?.url ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted/50',
                dragging && 'border-primary bg-muted/50',
              )}
            >
              <Upload className="size-6" />
              <span className="font-medium text-foreground">Drop a video or click to choose</span>
              <span>MP4 or MOV · 9:16 · up to {MAX_VIDEO_MB} MB</span>
              {video?.error && <span className="px-4 text-destructive">{video.error}</span>}
            </button>
          ) : (
            <div className="relative overflow-hidden rounded-lg border bg-black">
              <video
                ref={previewRef}
                src={video.url}
                controls
                playsInline
                className="aspect-[9/16] w-full object-contain"
                onSeeked={(e) => !cover && setThumbOffset(e.currentTarget.currentTime)}
              />
              <Button size="icon" variant="secondary" className="absolute top-2 right-2" onClick={() => setVideo(null)} title="Remove video">
                <X className="size-4" />
              </Button>
            </div>
          )}
          <input ref={fileInput} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => pickVideo(e.target.files?.[0])} />

          {video?.url && (
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span className="truncate">{video.file.name}</span>
                <span className="shrink-0">
                  {(video.file.size / 1024 / 1024).toFixed(1)} MB · {fmtDuration(video.duration)}
                </span>
              </div>
              {video.error ? (
                <p className="text-destructive">{video.error}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${video.progress}%` }} />
                  </div>
                  <span className="w-20 text-right">{video.key ? 'Uploaded' : `${video.progress}%`}</span>
                </div>
              )}
              {notVertical && <p className="text-amber-600">This video isn't 9:16, so Instagram may crop or letterbox it.</p>}
            </div>
          )}
        </div>

        {/* Details */}
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="caption">Caption</Label>
                <span className={cn('text-xs text-muted-foreground', caption.length > CAPTION_MAX && 'text-destructive')}>
                  {caption.length}/{CAPTION_MAX}
                </span>
              </div>
              <Textarea id="caption" rows={8} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Hook on the first line…" />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Cover</Label>
              {cover ? (
                <div className="flex items-center gap-3">
                  <img src={cover.url} alt="" className="h-20 w-12 rounded object-cover" />
                  <span className="text-sm text-muted-foreground">{cover.key ? 'Custom cover uploaded' : `Uploading… ${cover.progress}%`}</span>
                  <Button variant="ghost" size="sm" onClick={() => setCover(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    Frame at <span className="font-medium text-foreground tabular-nums">{thumbOffset.toFixed(1)}s</span> (pause the preview on the frame you want)
                  </span>
                  <Button variant="outline" size="sm" onClick={() => coverInput.current?.click()}>
                    <ImagePlus className="size-4" />
                    Upload cover image
                  </Button>
                </div>
              )}
              <input ref={coverInput} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => pickCover(e.target.files?.[0])} />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <FlaskConical className="size-4" />
                  Trial Reel
                  <span className="font-normal text-muted-foreground">shown to non-followers first</span>
                </span>
                <Switch checked={isTrial} onCheckedChange={setIsTrial} />
              </label>
              {isTrial && (
                <div className="flex flex-col gap-1.5 pl-6 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="radio" name="strategy" checked={strategy === 'MANUAL'} onChange={() => setStrategy('MANUAL')} className="mt-1 accent-primary" />
                    <span>
                      <span className="font-medium">Manual</span>: Kevin decides in the Instagram app whether to share it with followers.
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="strategy" checked={strategy === 'SS_PERFORMANCE'} onChange={() => setStrategy('SS_PERFORMANCE')} className="mt-1 accent-primary" />
                    <span>
                      <span className="font-medium">Auto-graduate</span>: Instagram shares it with followers if it performs well.
                    </span>
                  </label>
                </div>
              )}
              <label className={cn('flex items-center justify-between gap-3', isTrial && 'opacity-50')}>
                <span className="text-sm font-medium">Also show in profile grid</span>
                <Switch checked={!isTrial && shareToFeed} disabled={isTrial} onCheckedChange={setShareToFeed} />
              </label>
            </div>

            {publish.error && <p className="text-sm text-destructive">{publish.error.message}</p>}
            {done && <p className="text-sm text-emerald-700">{done} Status below.</p>}

            <Button size="lg" disabled={!canPost || caption.length > CAPTION_MAX} onClick={() => publish.mutate()}>
              {publish.isPending || uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? 'Uploading video…' : isTrial ? 'Post Trial Reel now' : 'Post now'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent posts</CardTitle>
          <CardDescription>Updates automatically while a post is processing.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {posts.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing posted from Reels Hub yet.</p>}
          {posts.data?.map((p) => (
            <div key={p.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="mt-0.5">
                {p.status === 'processing' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                {p.status === 'published' && <CheckCircle2 className="size-4 text-emerald-600" />}
                {p.status === 'failed' && <XCircle className="size-4 text-destructive" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-medium capitalize">{p.status}</span>
                  {p.is_trial && <Badge variant="secondary">Trial · {p.trial_strategy === 'SS_PERFORMANCE' ? 'auto' : 'manual'}</Badge>}
                  <span className="text-muted-foreground">{fmtAgo(p.published_at ?? p.created_at)}</span>
                </div>
                <p className="truncate text-sm text-muted-foreground">{p.caption?.split('\n')[0] || '(no caption)'}</p>
                {p.error && <p className="text-xs text-destructive">{p.error}</p>}
              </div>
              {p.ig_media_id && (
                <a href={`https://www.instagram.com/train.with.kching/`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open Instagram">
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
