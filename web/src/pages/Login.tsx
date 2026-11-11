import { Loader2, MailCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { appRootUrl, supabase } from '@/lib/supabase'

export default function Login() {
  const { session, loading, linkError } = useAuth()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(linkError)

  if (!loading && session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: appRootUrl() },
    })
    setSending(false)
    if (error) {
      // Supabase returns a "signups not allowed" style error for emails that weren't invited.
      setError(/signup|not allowed|not found/i.test(error.message) ? "This email hasn't been invited to Reels Hub." : error.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reels Hub</CardTitle>
          <CardDescription>Sign in with the email you were invited with.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center text-sm">
              <MailCheck className="size-8 text-primary" />
              <p>
                Check <span className="font-medium">{email}</span> for a sign-in link.
              </p>
              <p className="text-muted-foreground">Open it in this same browser.</p>
              <Button variant="link" size="sm" onClick={() => setSent(false)}>
                Use a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={sending}>
                {sending && <Loader2 className="size-4 animate-spin" />}
                Send magic link
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
