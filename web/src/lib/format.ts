const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : compact.format(n))

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`
  return `${Math.floor(s / (86400 * 365))}y ago`
}

export const fmtDuration = (sec: number | null | undefined) =>
  sec == null ? '—' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

/** Parse pasted usernames: "@a, b\nhttps://instagram.com/c/" → ["a","b","c"] */
export function parseUsernames(text: string): string[] {
  const out = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/instagram\.com\/([^/?#]+)/i)
      return (m ? m[1] : t).replace(/^@/, '').toLowerCase()
    })
    .filter((u) => /^[a-z0-9._]{1,30}$/.test(u) && !['p', 'reel', 'reels', 'explore'].includes(u))
  return [...new Set(out)]
}

export const parseTags = (text: string) =>
  [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
