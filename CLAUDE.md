# Reels Hub

Private web app for Kevin Qian's (K-Ching) Instagram, used by the DOBO team: publish Reels / Trial Reels (post now only, no scheduling in v1), Kevin's insights, creator research + outlier finder (Apify), and an AI analyst (Claude API).

**The full spec is in `BUILD_GUIDE.md`. Read it before starting any phase.** Work phase by phase (1 → 4). Before writing code for a phase, list the files you'll create and ask for any keys needed. After each phase, run that phase's acceptance checks and report the results.

## Architecture

```
GitHub Pages (static React app, HashRouter)
        │  supabase-js (anon key + logged-in user, PKCE auth)
        ▼
Supabase
 ├─ Auth (team logins, invite-only, magic link)
 ├─ Postgres (creators, reels, Kevin's media, publish log, knowledge base)
 ├─ Edge Functions (hold ALL secrets, call external APIs)
 │    ├─ Instagram API (graph.instagram.com)
 │    ├─ Apify API
 │    ├─ Claude API
 │    └─ Cloudflare R2 (presigned upload/download URLs)
 └─ pg_cron (finish in-progress publishes, daily sync, token refresh, weekly rescrape)

Cloudflare R2 — temporary video storage (Meta pulls the video from a URL) + thumbnail copies
```

Repo layout: `web/` (Vite + React + TS → GitHub Pages, `base: '/reels-hub/'`), `supabase/migrations/`, `supabase/functions/` (one function per job, shared code in `_shared/`), `.github/workflows/deploy.yml`.

## Rules

- No secrets in `/web`. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are allowed there. Never commit keys to git.
- RLS enabled on every table. `ig_tokens` is service-role only (RLS on, no policies).
- Every view is created `with (security_invoker = true)`. A plain view runs as its owner and bypasses RLS, exposing it to the public anon key.
- Supabase Auth uses `flowType: 'pkce'` (required with `HashRouter`) and `shouldCreateUser: false`.
- All external API calls go through Edge Functions.
- All Edge Functions have the gateway JWT check off and authorize themselves (`_shared/auth.ts`): cron calls send `x-cron-secret` (Vault `cron_secret` = function secret `CRON_SECRET`), the Apify webhook checks `APIFY_WEBHOOK_SECRET`, user calls are verified with `auth.getUser`.
- Anything that loops over many items must batch or page across runs, to stay under the Edge Function time limit.
- Instagram API version lives in one constant (`IG_API_VERSION` in `_shared/ig.ts`); don't hardcode it elsewhere. Kevin's token is a Unified-login system-user token (`EAA…`, graph.facebook.com, never expires); `_shared/ig.ts` picks the host from the token type.
- Always display thumbnails from Supabase Storage (bucket `thumbs`, column `thumbnail_path`), never the stored Instagram CDN URL (it expires). R2 holds only videos waiting to be published.
- Store all timestamps in UTC; convert only for display (Manila + Montreal).
- TypeScript everywhere. Keep functions small; one Edge Function per job.
- AI output about massage stays within a massage therapist's scope of practice (no medical diagnosis or treatment claims).
