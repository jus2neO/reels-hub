import type { KevinMedia, OutlierReel } from './api'
import { fmtDuration } from './format'

export type KnowledgeDoc = {
  id: string
  title: string
  category: string | null
  content: string
  active: boolean
  updated_at: string
}

export const DOC_CATEGORIES = ['bio', 'business', 'course', 'offer', 'voice', 'past_captions', 'faq'] as const

/** Role + rules for the AI (BUILD_GUIDE.md Section 9). Works in ChatGPT or Claude. */
export const SYSTEM_PROMPT = `You are the content strategist for Kevin Qian (K-Ching), a sports and Thai massage therapist and educator who trains massage therapists. You work with the DOBO creative team.

You will receive: (1) a knowledge base about Kevin's business, courses, offers, bio and voice, and (2) Instagram data — Kevin's own Reel metrics and/or outlier Reels from other creators.

Rules:
- Ground every claim in the data provided. Cite reels by @username + views.
- When explaining outliers, look at hook (first line of caption), topic, format, length, and audience fit, not just numbers.
- When adapting ideas for Kevin, stay technically accurate for massage therapy and within a massage therapist's scope of practice (no medical diagnosis or treatment claims).
- Write hooks and captions in Kevin's first-person voice: reflective, story-driven, practical.
- Be concise. Use short sections and bullets.`

export const QUICK_ACTIONS = [
  {
    label: 'Why did these outperform?',
    prompt:
      'For each selected reel, explain why it outperformed the creator\'s usual reels: the hook, topic, format, length and audience fit. Then list the 3–5 patterns they share.',
  },
  {
    label: 'Adapt these for Kevin',
    prompt:
      "Adapt each selected outlier into a Reel idea for Kevin. For each: the hook (first line, in Kevin's voice), a 4–6 beat outline, which of his courses or offers it naturally leads to, and a caption with a comment-keyword CTA from the knowledge base.",
  },
  {
    label: 'Write 10 hooks',
    prompt:
      "Using the selected reels as inspiration, write 10 scroll-stopping hooks for Kevin in his voice. Vary the angle (myth-bust, story, mistake, quick win, client result). After each hook, note in one line which reel inspired it.",
  },
  {
    label: 'What should Kevin post this week?',
    prompt:
      "Based on Kevin's recent performance and the selected outliers, propose 5 Reels for Kevin to post this week. For each: hook, format, length, why it should work (cite the data), and whether to post it as a Trial Reel first.",
  },
] as const

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))
const date = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
const clip = (s: string | null, max = 700) => {
  const t = (s ?? '').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t || '(no caption)'
}

function outlierBlock(r: OutlierReel, kevinMedian: number | null) {
  return [
    `### @${r.username} — ${num(r.views)} views (${r.outlier_score ?? '—'}× their median)`,
    `- Followers: ${num(r.followers)} · views/follower: ${r.views_per_follower ?? '—'} · creator median: ${num(Math.round(r.median_views))}${
      kevinMedian && r.views ? ` · ${(r.views / kevinMedian).toFixed(1)}× Kevin's median` : ''
    }`,
    `- Likes: ${num(r.likes)} · comments: ${num(r.comments)} · length: ${fmtDuration(r.duration_sec)} · posted: ${date(r.posted_at)}`,
    `- Link: ${r.url ?? `https://www.instagram.com/reel/${r.shortcode}/`}`,
    `- Caption:\n${clip(r.caption)}`,
  ].join('\n')
}

function kevinBlock(m: KevinMedia) {
  const i = m.insights ?? {}
  const avg = i.ig_reels_avg_watch_time != null ? `${(i.ig_reels_avg_watch_time / 1000).toFixed(1)}s` : '—'
  return [
    `### Kevin's Reel — ${num(i.views)} views${m.is_trial ? ' (Trial Reel)' : ''}`,
    `- Reach: ${num(i.reach)} · likes: ${num(i.likes ?? i.like_count)} · comments: ${num(i.comments ?? i.comments_count)} · shares: ${num(i.shares)} · saves: ${num(i.saved)}`,
    `- Avg watch time: ${avg} · length: ${fmtDuration(m.duration_sec)} · posted: ${date(m.posted_at)}`,
    m.permalink ? `- Link: ${m.permalink}` : null,
    `- Caption:\n${clip(m.caption)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Assemble one self-contained prompt to paste into ChatGPT or Claude. */
export function buildPrompt(opts: {
  docs: KnowledgeDoc[]
  outliers: OutlierReel[]
  kevinReels: KevinMedia[]
  kevinMedian: number | null
  question: string
}): string {
  const { docs, outliers, kevinReels, kevinMedian, question } = opts
  const parts = [SYSTEM_PROMPT]

  const active = docs.filter((d) => d.active && d.content.trim())
  parts.push(
    active.length
      ? `## Knowledge base about Kevin\n\n${active.map((d) => `### ${d.title}${d.category ? ` (${d.category})` : ''}\n${d.content.trim()}`).join('\n\n')}`
      : '## Knowledge base about Kevin\n(Empty: answer from the data only, and say what information about Kevin would help.)',
  )

  if (kevinMedian != null) parts.push(`## Benchmark\nKevin's median views per Reel: ${num(Math.round(kevinMedian))}.`)
  if (outliers.length) parts.push(`## Outlier Reels from other creators (${outliers.length})\n\n${outliers.map((r) => outlierBlock(r, kevinMedian)).join('\n\n')}`)
  if (kevinReels.length) parts.push(`## Kevin's own Reels (${kevinReels.length})\n\n${kevinReels.map(kevinBlock).join('\n\n')}`)
  if (!outliers.length && !kevinReels.length) parts.push('## Instagram data\n(No reels selected.)')

  parts.push(`## Task\n${question.trim() || 'Give me your top observations and recommendations.'}`)
  return parts.join('\n\n---\n\n')
}
