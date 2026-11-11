import { Sparkles, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useSelection } from '@/lib/selection'

/** Sticky bar shown while reels are selected for AI analysis. */
export function AnalyzeBar() {
  const sel = useSelection()
  const navigate = useNavigate()
  if (sel.count === 0) return null
  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-full border bg-background/95 py-1.5 pr-1.5 pl-4 text-sm shadow-lg backdrop-blur">
      <span>
        <span className="font-medium tabular-nums">{sel.count}</span> selected
      </span>
      <Button size="sm" variant="ghost" onClick={sel.clear} title="Clear selection">
        <X className="size-4" />
      </Button>
      <Button size="sm" className="rounded-full" onClick={() => navigate('/ai')}>
        <Sparkles className="size-4" />
        Analyze with AI
      </Button>
    </div>
  )
}
