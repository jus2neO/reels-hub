import { Loader2, MailCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { appRootUrl, supabase } from '@/lib/supabase'

function friendlyError(message: string) {
  if (/signup|not allowed|not found/i.test(message)) return "This email hasn't been invited to Reels Hub."
  if (/rate limit|security purposes/i.test(message)) return 'Too many emails sent. Wait a minute and try again.'
  if (/expired|invalid/i.test(message)) return 'That code is wrong or has expired. Check the newest email, or send a new code.'
  return message
}

export default function Login() {
  const { session, loading, linkError } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(linkError)

  if (!loading && session) return <Navigate to="/" replace />

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    // The same email contains a 6-digit code and a link; either one signs you in.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: appRootUrl() },
    })
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    setCode('')
    setSent(true)
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(friendlyError(error.message))
    // On success, onAuthStateChange sets the session and this page redirects to the Dashboard.
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reels Hub</CardTitle>
          <CardDescription>
            {sent ? 'Enter the code from your email.' : 'Sign in with the email you were invited with.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <form onSubmit={verifyCode} className="flex flex-col gap-4">
              <div className="flex items-start gap-2 text-sm">
                <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  We sent a sign-in code to <span className="font-medium">{email}</span>.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  maxLength={10}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="text-center text-lg tracking-[0.4em]"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy || code.length < 6}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Sign in
              </Button>
              <div className="flex justify-between text-sm">
                <Button type="button" variant="link" size="sm" className="px-0" onClick={() => { setSent(false); setError(null) }}>
                  Use a different email
                </Button>
                <Button type="button" variant="link" size="sm" className="px-0" disabled={busy} onClick={() => sendCode()}>
                  Send a new code
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={sendCode} className="flex flex-col gap-4">
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
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Send sign-in code
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
