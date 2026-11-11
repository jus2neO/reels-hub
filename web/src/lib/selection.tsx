import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/** Reels picked for AI analysis, shared between Outliers, Insights and the AI page (kept per browser tab). */
type Selection = {
  outliers: string[] // reels.id
  kevin: string[] // kevin_media.ig_media_id
}

type Ctx = Selection & {
  toggle: (kind: keyof Selection, id: string) => void
  set: (kind: keyof Selection, ids: string[]) => void
  clear: () => void
  count: number
}

const KEY = 'reels-hub-ai-selection'
const EMPTY: Selection = { outliers: [], kevin: [] }

function load(): Selection {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

const SelectionContext = createContext<Ctx | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [sel, setSel] = useState<Selection>(load)

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(sel))
    } catch {
      /* private mode: selection just won't survive a reload */
    }
  }, [sel])

  const toggle = useCallback((kind: keyof Selection, id: string) => {
    setSel((s) => ({ ...s, [kind]: s[kind].includes(id) ? s[kind].filter((x) => x !== id) : [...s[kind], id] }))
  }, [])
  const set = useCallback((kind: keyof Selection, ids: string[]) => setSel((s) => ({ ...s, [kind]: ids })), [])
  const clear = useCallback(() => setSel(EMPTY), [])

  return (
    <SelectionContext.Provider value={{ ...sel, toggle, set, clear, count: sel.outliers.length + sel.kevin.length }}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection() {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used inside SelectionProvider')
  return ctx
}
