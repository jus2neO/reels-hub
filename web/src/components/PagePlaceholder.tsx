export function PagePlaceholder({ title, description, phase }: { title: string; description: string; phase: number }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      <p className="mt-6 rounded-md border border-dashed p-6 text-sm text-muted-foreground">Coming in Phase {phase}.</p>
    </div>
  )
}
