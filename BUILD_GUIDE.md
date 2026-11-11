# Reels Hub — Build Guide (for Claude Code)

A private web app for Kevin Qian's (K-Ching) Instagram, used by the DOBO team. It does four things:

1. **Publish** Reels and Trial Reels to Kevin's account (post now; no scheduling in v1)
2. **Insights** for Kevin's own content
3. **Creator research + outlier finder** for other accounts in the niche (via Apify)
4. **AI analyst** that knows Kevin's business, bio, courses, and voice

Single-account use only (Kevin). The Meta app stays in **Development mode**, so no App Review is needed.

---

## As built (November 2026): where the app differs from this guide

The sections below are the original plan. These changes were made while building; **the code and `CLAUDE.md` are the source of truth**.

- **Repo / URL:** `jus2neO/reels-hub` → `https://jus2neo.github.io/reels-hub/` (Vite `base: '/reels-hub/'`).
- **Login:** 6-digit email code (`verifyOtp`) instead of clicking a magic link; links get spent by email scanners and break PKCE across browsers. Custom SMTP (Gmail) is required; Supabase's built-in sender allows ~2 emails/hour.
- **Instagram:** new Meta apps can't use "API setup with Instagram login". Kevin's token comes from **API setup with Unified login** (needs a Business portfolio + a login configuration). It's a system-user token (`EAA…`) on **graph.facebook.com** that **never expires**, so `ig-refresh-token` skips it. `_shared/ig.ts` picks the host from the token type. Insights need `instagram_manage_insights` added to the configuration.
- **Thumbnails:** stored in **Supabase Storage** (public bucket `thumbs`, column `thumbnail_path`), not R2. R2 holds only videos waiting to be published.
- **Rescrape:** weekly (Mondays), not daily, to stay within Apify's free monthly credit.
- **Cron auth:** every cron job sends `x-cron-secret` from Vault (`cron_secret`), matching the `CRON_SECRET` function secret. All functions have the gateway JWT check off and authorize themselves.
- **AI analyst:** no AI API and no `ai-analyze` function. The AI page builds one prompt (system rules + active `knowledge_docs` + selected reels + question) and copies it for the team to paste into their own **ChatGPT or Claude subscription**. `ai_threads` is unused.
- **Supabase CLI v3:** remote commands need `--remote=<ref>`, and changes to production need `--yes`.

---

## 0. Kickoff prompt for Claude Code

Paste this into Claude Code along with this file:

> Read `BUILD_GUIDE.md` in full. We're building Reels Hub exactly as specified. Work phase by phase (Phase 1 → 4). Before writing code for a phase, list the files you'll create and ask me for any keys you need. Never put secret keys in frontend code or commit them to git. After each phase, run the acceptance checks at the end of that phase and tell me the results.

Save this file in the repo root as `BUILD_GUIDE.md` (and optionally copy the Architecture + Rules sections into `CLAUDE.md`).

---

## 1. Architecture

```
GitHub Pages (static React app)
        │  supabase-js (anon key + logged-in user)
        ▼
Supabase
 ├─ Auth (team logins, invite-only)
 ├─ Postgres (creators, reels, Kevin's media, publish log, knowledge base)
 ├─ Edge Functions (hold ALL secrets, call external APIs)
 │    ├─ Instagram API (graph.instagram.com)
 │    ├─ Apify API
 │    ├─ Claude API
 │    └─ Cloudflare R2 (presigned video upload URLs)
 └─ pg_cron (finish in-progress publishes, daily sync, token refresh)

Cloudflare R2 — temporary video storage (Meta pulls the video from a URL)
```

### Why this shape

- **GitHub Pages only serves static files.** Any key placed in frontend code is public. So every secret lives in Supabase Edge Function secrets.
- **Supabase anon key is safe in the frontend** as long as Row Level Security (RLS) is on for every table.
- **Videos go to Cloudflare R2, not Supabase Storage**, because Supabase Free caps files at 50 MB, and Reels can be up to 300 MB. R2 has a free tier and no egress fees.
- **GitHub Pages on a free GitHub account requires a public repo.** That's fine (no secrets in code). For a private repo, you'd need GitHub Pro/Team.

### Rules (put these in CLAUDE.md)

- No secrets in `/web`. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are allowed there.
- RLS enabled on every table. Token table is service-role only.
- Every view is created `with (security_invoker = true)`. A plain view runs as its owner and bypasses RLS, which would expose it to the public anon key.
- Supabase Auth uses `flowType: 'pkce'` (required with `HashRouter`; see Section 2).
- Store all timestamps in UTC; convert only for display.
- All external API calls go through Edge Functions.
- Instagram API version lives in one constant (`IG_API_VERSION = "v26.0"`); don't hardcode it elsewhere.
- TypeScript everywhere. Keep functions small; one Edge Function per job.

---

## 2. Tech stack

### Frontend (`/web`)

| Purpose | Package |
|---|---|
| Build tool | `vite` + `@vitejs/plugin-react` |
| Language | TypeScript |
| UI | `react`, `react-dom` |
| Styling | `tailwindcss` |
| Components | `shadcn/ui` (Radix-based) + `lucide-react` icons |
| Routing | `react-router-dom` — use **`HashRouter`** (GitHub Pages has no SPA fallback, so refresh on `/outliers` would 404 otherwise) |
| Data fetching | `@tanstack/react-query` |
| Tables (filter/sort) | `@tanstack/react-table` |
| Charts | `recharts` |
| Backend client | `@supabase/supabase-js` — create the client with `{ auth: { flowType: 'pkce' } }`. The default implicit flow returns `#access_token=...` in the URL hash, which `HashRouter` reads as a route, so magic-link login breaks. PKCE returns `?code=` instead. |
| Dates | `date-fns` |
| Markdown (AI answers) | `react-markdown` |

### Backend (`/supabase`)

- Supabase CLI (`supabase init`, `supabase functions new`, `supabase db push`)
- Edge Functions run on Deno (TypeScript)
- `aws4fetch` (for signing R2 presigned URLs inside Deno)
- Postgres extensions: `pg_cron`, `pg_net`

### Repo layout

```
reels-hub/
├─ BUILD_GUIDE.md
├─ CLAUDE.md
├─ web/                     # React app → GitHub Pages
│  ├─ src/
│  │  ├─ pages/             # Login, Dashboard, Publish, Insights, Creators, Outliers, AI
│  │  ├─ components/
│  │  ├─ lib/supabase.ts
│  │  └─ lib/api.ts         # wrappers around supabase.functions.invoke()
│  └─ vite.config.ts        # base: '/reels-hub/'
├─ supabase/
│  ├─ migrations/           # SQL schema
│  └─ functions/
│     ├─ _shared/           # ig.ts, apify.ts, claude.ts, r2.ts, cors.ts, auth.ts
│     ├─ apify-start/
│     ├─ apify-webhook/
│     ├─ r2-upload-url/
│     ├─ ig-publish/        # "Post now": creates the container
│     ├─ ig-publish-queue/  # cron every minute: finishes processing posts
│     ├─ ig-sync/           # daily: Kevin's media + insights
│     ├─ ig-refresh-token/  # weekly
│     └─ ai-analyze/
└─ .github/workflows/deploy.yml
```

---

## 3. Accounts and keys to collect (do this first)

| Service | What to get | Where it goes |
|---|---|---|
| GitHub | Repo `reels-hub` (github.com/jus2neO/reels-hub), Pages enabled (Source: GitHub Actions) | — |
| Supabase | Project URL, anon key, service role key | URL + anon → GitHub Actions secrets for the build. Service role → never leaves Supabase |
| Cloudflare R2 | Account ID, bucket name, R2 API token (Access Key ID + Secret) | Supabase function secrets |
| Meta | Instagram App ID, Instagram App Secret, Kevin's long-lived token, Kevin's IG user ID | Secrets + `ig_tokens` table |
| Apify | API token | Supabase function secrets |
| Anthropic | API key (console.anthropic.com, add billing) | Supabase function secrets |

### Supabase function secrets (set with `supabase secrets set`)

```
IG_APP_ID=
IG_APP_SECRET=
IG_USER_ID=
APIFY_TOKEN=
APIFY_WEBHOOK_SECRET=        # random string you make up
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=             # e.g. claude-sonnet-5-5 (or claude-opus-5-5 for deeper analysis); confirm at docs.claude.com/en/docs/about-claude/models
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

---

## 4. Meta app setup (Development mode, Kevin only)

Use **Instagram API with Instagram Login** (host: `graph.instagram.com`). It doesn't need a Facebook Page.

1. Kevin's Instagram must be a **Business or Creator** account (it is, 83k followers; Trial Reels available).
2. Go to developers.facebook.com → **My Apps → Create App** → choose the Instagram use case ("Manage messaging & content on Instagram") → Business type.
3. In the app: **Instagram → API setup with Instagram business login**.
4. **App Roles → Roles → Instagram Testers** → add Kevin's IG username. Kevin accepts the invite (Instagram app → Settings → Website permissions / Apps and websites → Tester invites).
5. Back in API setup: **Add account** → log in as Kevin → **Generate token**. This gives a long-lived token (about 60 days). Copy it plus the IG user ID.
6. Permissions to enable:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_insights`
7. Leave the app in **Development mode**. Don't submit for review.
8. Copy **Instagram App ID** and **Instagram App Secret** (these are different from the Facebook App ID).

> v1 uses the dashboard-generated token. A full OAuth login flow isn't needed for a single account. The `ig-refresh-token` cron keeps it alive.

---

## 5. Database schema (`supabase/migrations/0001_init.sql`)

```sql
-- Token storage (service role only)
create table ig_tokens (
  id int primary key default 1,
  ig_user_id text not null,
  access_token text not null,
  expires_at timestamptz,
  updated_at timestamptz default now()
);
alter table ig_tokens enable row level security;  -- no policies = no client access

-- Creators we track (niche research)
create table creators (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  full_name text,
  followers int,
  following int,
  posts_count int,
  bio text,
  is_verified boolean,
  tags text[] default '{}',          -- e.g. {'sports massage','mobility'}
  is_benchmark boolean default false, -- true for Kevin
  last_scraped_at timestamptz,
  created_at timestamptz default now()
);

-- Scraped reels from tracked creators
create table reels (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators(id) on delete cascade,
  shortcode text unique not null,
  url text,
  caption text,
  hashtags text[],
  views bigint,
  likes bigint,
  comments bigint,
  duration_sec numeric,
  posted_at timestamptz,
  thumbnail_url text,                 -- original IG CDN URL (expires within days)
  thumbnail_r2_key text,              -- our copy in R2; the UI uses this
  audio_name text,
  raw jsonb,                          -- full Apify item, for fields we didn't map
  scraped_at timestamptz default now()
);
create index on reels (creator_id, posted_at desc);

-- Kevin's own media + insights (from Instagram API)
create table kevin_media (
  ig_media_id text primary key,
  caption text,
  media_type text,
  media_product_type text,
  permalink text,
  thumbnail_url text,                 -- original IG CDN URL (expires)
  thumbnail_r2_key text,              -- our copy in R2; the UI uses this
  posted_at timestamptz,
  duration_sec numeric,               -- IG API doesn't return this; copied from posts when published via Reels Hub
  is_trial boolean default false,
  insights jsonb,                     -- {views, reach, likes, comments, shares, saved, avg_watch_time, ...}
  insights_updated_at timestamptz
);

-- Kevin's account-level daily insights (Dashboard)
create table kevin_account_daily (
  day date primary key,
  followers int,
  views bigint,
  reach bigint,
  accounts_engaged int,
  total_interactions int,
  updated_at timestamptz default now()
);

-- Publish log (post now only; no scheduling in v1)
create type post_status as enum ('processing','published','failed');
create table posts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id),
  r2_key text not null,
  caption text,
  cover_r2_key text,
  thumb_offset_ms int,
  duration_sec numeric,               -- read in the browser from the video file before upload
  share_to_feed boolean default true,
  is_trial boolean default false,
  trial_strategy text check (trial_strategy in ('MANUAL','SS_PERFORMANCE')),
  status post_status default 'processing',
  container_id text,
  ig_media_id text,
  error text,
  created_at timestamptz default now(),
  published_at timestamptz
);
create index on posts (status) where status = 'processing';

-- AI knowledge base about Kevin
create table knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,                      -- bio | business | course | offer | voice | past_captions | faq
  content text not null,
  active boolean default true,
  updated_at timestamptz default now()
);

-- AI conversation history
create table ai_threads (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id),
  title text,
  messages jsonb default '[]',
  created_at timestamptz default now()
);

-- RLS: any logged-in team member can read/write app tables
do $$
declare t text;
begin
  foreach t in array array['creators','reels','kevin_media','kevin_account_daily','posts','knowledge_docs','ai_threads'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
```

### Outlier view (`0002_outliers.sql`)

```sql
-- security_invoker makes the view respect RLS on reels/creators.
-- Without it the view runs as its owner and anyone with the public anon key can read it.
create view reel_outliers with (security_invoker = true) as
with medians as (
  select creator_id,
         percentile_cont(0.5) within group (order by views) as median_views,
         count(*) as sample_size
  from reels
  where views is not null
  group by creator_id
)
select r.*,
       c.username, c.followers, c.is_benchmark,
       m.median_views, m.sample_size,
       round((r.views / nullif(m.median_views,0))::numeric, 2) as outlier_score,
       round((r.views::numeric / nullif(c.followers,0)), 2)     as views_per_follower
from reels r
join creators c on c.id = r.creator_id
join medians m on m.creator_id = r.creator_id
where m.sample_size >= 10;            -- scores from fewer reels aren't reliable
```

- **outlier_score** = this reel's views ÷ the creator's median views (5 = 5x their normal)
- **views_per_follower** = views ÷ followers (above 1 means it reached far beyond their audience)
- Creators with fewer than 10 scraped reels are excluded by the view.
- **Kevin's median for comparison:** scrape Kevin through Apify like any other creator (he's the `is_benchmark` row), so his reels land in `reels` and his median uses the same public view count as everyone else. `kevin_media` stays the source for his private insights (reach, saves, watch time).

---

## 6. API reference (what the Edge Functions call)

### 6.1 Instagram API (Instagram Login)

Base: `https://graph.instagram.com/v26.0`. All calls take `access_token=<token>` read from `ig_tokens`.

> Before starting, confirm `v26.0` is still a supported version in Meta's Graph API changelog and update `IG_API_VERSION` if not.

**Account info**
```
GET /me?fields=user_id,username,followers_count,media_count
```

**Kevin's media list**
```
GET /{IG_USER_ID}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=50
```
Follow `paging.next` to page through.

**Reel insights**
```
GET /{MEDIA_ID}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time
```

**Account insights**
```
GET /{IG_USER_ID}/insights?metric=views,reach,accounts_engaged,total_interactions&period=day&metric_type=total_value&since=<unix>&until=<unix>
GET /{IG_USER_ID}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=country
```
> Meta renames insight metrics fairly often. If a metric errors, check the current Insights reference and drop/rename it. Don't let one bad metric fail the whole sync.

**Publish a Reel / Trial Reel: 3 steps**

Step 1: create the container
```
POST /{IG_USER_ID}/media
  media_type=REELS
  video_url=<R2 presigned GET URL, valid 1h>
  caption=<caption>
  share_to_feed=true
  cover_url=<optional, R2 presigned GET URL>
  thumb_offset=<optional, ms>
  trial_params={"graduation_strategy":"MANUAL"}     ← only for Trial Reels
→ { "id": "<CONTAINER_ID>" }
```
- `trial_params.graduation_strategy`: `MANUAL` (Kevin graduates it in the Instagram app) or `SS_PERFORMANCE` (Instagram graduates it automatically if it performs well).
- Graduating a trial manually can't be done through the API; it's done in the Instagram app.

Step 2: poll status
```
GET /{CONTAINER_ID}?fields=status_code
→ IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED
```
Meta recommends polling about once per minute, for up to 5 minutes. Containers expire after 24h.

> If container creation fails because Meta can't fetch the video (long presigned URLs are occasionally refused), fall back to a public R2 path with an unguessable key (e.g. a random UUID) and delete the object right after publishing.

Step 3: publish
```
POST /{IG_USER_ID}/media_publish
  creation_id=<CONTAINER_ID>
→ { "id": "<IG_MEDIA_ID>" }
```

**Publishing limit check**
```
GET /{IG_USER_ID}/content_publishing_limit
```
(Meta's docs state 100 API posts per rolling 24h in one place and 50 in another. Either way, far above what Kevin needs.)

**Reel file specs:** MP4 or MOV, 3 s to 15 min, max 300 MB, 9:16, 23–60 fps.

**Token refresh** (token must be at least 24h old and still valid)
```
GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<token>
→ { access_token, token_type, expires_in }
```

### 6.2 Apify

Base: `https://api.apify.com/v2`, auth header `Authorization: Bearer <APIFY_TOKEN>`.

| Actor | Use |
|---|---|
| `apify~instagram-profile-scraper` | Follower count, bio, post count for a list of usernames |
| `apify~instagram-reel-scraper` | Recent reels per username, with view/play counts |
| `apify~instagram-hashtag-scraper` | Discover new creators from niche hashtags |
| `apify~instagram-search-scraper` | Discover creators by keyword |

**Start a run (async, with webhook)**
```
POST /acts/apify~instagram-reel-scraper/runs?webhooks=<base64 JSON>
Body: { "username": ["creator1","creator2"], "resultsLimit": 30 }
```
Webhooks param = base64 of:
```json
[{ "eventTypes": ["ACTOR.RUN.SUCCEEDED","ACTOR.RUN.FAILED","ACTOR.RUN.TIMED_OUT","ACTOR.RUN.ABORTED"],
   "requestUrl": "https://<project>.supabase.co/functions/v1/apify-webhook?secret=<APIFY_WEBHOOK_SECRET>&kind=reels" }]
```

**On webhook:** check `eventType`. For failure events, record the error so the Creators page can show "scrape failed" instead of reels silently going missing. On success, read `resource.defaultDatasetId` from the payload, then:
```
GET /datasets/{datasetId}/items?clean=true&format=json
```
Upsert into `creators` / `reels` (match on `username` / `shortcode`). Store the full item in `reels.raw`. Copy each new thumbnail into R2 (`thumbs/<shortcode>.jpg`) and save `thumbnail_r2_key`. Instagram CDN URLs are signed and expire within days, and some refuse to load on other sites.

> **Field names:** do one small test run first and map the actual output fields (expected fields include `shortCode`, `url`, `caption`, `videoPlayCount`/`videoViewCount`, `likesCount`, `commentsCount`, `videoDuration`, `timestamp`, `ownerUsername`, `hashtags`). Use play count as `views` if both exist; it matches what Instagram shows on Reels.

Why async: Apify runs can take longer than an Edge Function's time limit. Starting the run and receiving a webhook avoids timeouts.

### 6.3 Claude API

```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: <ANTHROPIC_API_KEY>
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
{
  "model": "<ANTHROPIC_MODEL>",
  "max_tokens": 2000,
  "system": [
    { "type": "text", "text": "<role + rules>" },
    { "type": "text", "text": "<all active knowledge_docs, concatenated>",
      "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [
    { "role": "user", "content": "<question + JSON of the selected reels/metrics>" }
  ]
}
```
- The knowledge base block is **prompt-cached**, so repeated questions are cheaper and faster.
- No model training/fine-tuning. Update Kevin's knowledge by editing `knowledge_docs` in the app.

### 6.4 Cloudflare R2 (presigned URLs)

- S3-compatible endpoint: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/<key>`
- `r2-upload-url` function: returns a presigned **PUT** URL (browser uploads the file directly, so no size limit from the Edge Function). Sign it with the same `Content-Type` the browser will send, or the upload fails the signature check.
- `ig-publish`: generates a presigned **GET** URL (1 hour) and passes it as `video_url`.
- Use `aws4fetch` → `AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' })`, `sign(url, { method, aws: { signQuery: true } })`.
- Set bucket **CORS** to allow `PUT` and `GET` from `https://<github-username>.github.io`, with allowed header `Content-Type`.
- Delete the video (and cover) from R2 as soon as the post is `published`. Add a lifecycle rule on the `uploads/` prefix to delete objects after 2 days as a backstop for failed or abandoned uploads. Don't apply it to `thumbs/`.
- Thumbnails in `thumbs/` are served to the app via short-lived presigned GET URLs (or a public bucket/custom domain for that prefix only).

---

## 7. Edge Functions spec

All functions:
- Handle CORS (`OPTIONS` preflight) for the GitHub Pages origin.
- Verify the caller is a logged-in user (Supabase JWT), except cron/webhook functions, which check the service key or the webhook secret.
- **Gateway JWT check:** deploy `apify-webhook` with `--no-verify-jwt` (Apify sends no JWT, so the gateway would reject it before your secret check runs). For cron-called functions: new-style Supabase secret keys (`sb_secret_...`) aren't JWTs, so either set `verify_jwt = false` for those functions and compare the key inside the function, or call them with the legacy service-role JWT.
- **Time limits:** Edge Functions have a wall-clock limit (about 150 s on the Free plan). Anything that loops over many items must batch or page across runs.

| Function | Trigger | Does |
|---|---|---|
| `r2-upload-url` | Frontend | Input `{filename, contentType}` → returns `{uploadUrl, key}` (key under `uploads/`) |
| `ig-publish` | Frontend ("Post now") | Input `{r2Key, caption, coverR2Key?, thumbOffsetMs?, durationSec?, shareToFeed, isTrial, trialStrategy?}` → insert `posts` row → presign GET URL → create container → save `container_id`, status `processing`. On error, status `failed` + error. Returns the post id. |
| `ig-publish-queue` | pg_cron every minute | Claim `processing` posts atomically so overlapping cron runs can't double-publish (e.g. `select ... for update skip locked` inside an `rpc`, or an `update ... returning` claim). For each: check `status_code`; `FINISHED` → `media_publish` → `published` + save `ig_media_id` + `published_at`, copy `duration_sec` to `kevin_media`, delete the R2 objects; `ERROR`/`EXPIRED` → `failed` + error. Mark `failed` if still `IN_PROGRESS` after 30 min. |
| `ig-sync` | pg_cron daily + "Sync now" button | Pull Kevin's media list + insights per Reel → upsert `kevin_media` (copy thumbnails to R2). Pull account insights for recent days → upsert `kevin_account_daily`. Also upsert Kevin into `creators` with `is_benchmark=true` and his follower count. Refresh insights only for Reels from the last 90 days (plus a full backfill on first run, paged across calls) to stay under the time limit. |
| `ig-refresh-token` | pg_cron weekly | Refresh token, update `ig_tokens.access_token` + `expires_at` |
| `apify-start` | Frontend **and** pg_cron | Accepts either a logged-in user JWT or the service key (the daily rescrape cron calls it). Input `{kind: 'profiles'|'reels'|'hashtag'|'search', usernames?, query?, limit}` → starts Apify run with webhook. With no usernames from cron, scrape all tracked creators, including Kevin. |
| `apify-webhook` | Apify | Validate secret → on failure events, record the error → on success, fetch dataset → upsert creators/reels → copy thumbnails to R2 → set `last_scraped_at` |
| `ai-analyze` | Frontend | Input `{threadId?, question, context: {reelIds?, mode}}` → loads knowledge docs + referenced reels/metrics → calls Claude → saves to `ai_threads` → returns answer |

### pg_cron setup (SQL)

```sql
select cron.schedule('publish-queue', '* * * * *', $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/ig-publish-queue',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_KEY from Vault>')
  );
$$);
select cron.schedule('ig-sync-daily', '0 18 * * *', $$ ... ig-sync ... $$);
select cron.schedule('ig-token-weekly', '0 3 * * 1', $$ ... ig-refresh-token ... $$);
select cron.schedule('creators-rescrape', '0 19 * * *', $$ ... apify-start for all tracked creators ... $$);
```
Store the service role key in Supabase Vault and read it from there instead of pasting it into SQL.

---

## 8. Frontend pages

| Page | Features |
|---|---|
| **Login** | Magic link (email) via `signInWithOtp({ email, options: { shouldCreateUser: false } })`, PKCE flow. Public sign-ups disabled; invite team members from the Supabase dashboard. |
| **Dashboard** | Kevin's followers and last 30 days views/reach (from `kevin_account_daily`), top 5 Reels, posts currently processing, latest outliers. |
| **Publish** | Drag-drop video → read duration in the browser → uploads to R2 with progress bar → caption field (character count) → cover image or thumbnail offset → toggles: Share to feed, **Trial Reel** (+ strategy: Manual / Auto-graduate) → **Post now**. Posts usually go live within 1–3 minutes; the page can be closed, since the cron finishes the job. Post history list with status badges (processing / published / failed + error). No scheduling in v1. |
| **Insights** | Table of Kevin's Reels (sortable: views, reach, shares, saves, avg watch time, engagement rate). Trial vs regular filter. Charts: views over time, avg watch time vs duration (only Reels published through Reels Hub have a duration). "Ask AI about this" on any row. |
| **Creators** | Add by username (bulk paste), tags, discover via hashtag/keyword search, follower count, last scraped, "Scrape now". |
| **Outliers** | Main research view. Filters: follower range (e.g. 1k–20k), min outlier score (default 3), min views/follower, posted within (7/30/90 days), duration, tag, keyword in caption, min sample size. Cards with thumbnail, views, outlier score badge, views/follower, link to reel. Compare against Kevin's median views. Multi-select → "Analyze with AI". |
| **AI** | Chat with thread history. Quick actions: "Why did these outperform?", "Adapt these for Kevin", "Write 10 hooks from these outliers", "What should Kevin post this week?". Knowledge base editor tab (CRUD on `knowledge_docs`). |

---

## 9. AI system prompt (starting point for `ai-analyze`)

```
You are the content strategist for Kevin Qian (K-Ching), a sports and Thai
massage therapist and educator who trains massage therapists. You work with
the DOBO creative team.

You will receive: (1) a knowledge base about Kevin's business, courses,
offers, bio and voice, and (2) Instagram data — Kevin's own Reel metrics
and/or outlier Reels from other creators.

Rules:
- Ground every claim in the data provided. Cite reels by @username + views.
- When explaining outliers, look at hook (first line of caption), topic,
  format, length, and audience fit, not just numbers.
- When adapting ideas for Kevin, stay technically accurate for massage
  therapy and within a massage therapist's scope of practice (no medical
  diagnosis or treatment claims).
- Write hooks and captions in Kevin's first-person voice: reflective,
  story-driven, practical.
- Be concise. Use short sections and bullets.
```

### Knowledge base docs to load first

- Kevin's bio and story
- K-Ching business overview + Maximum Efficiency Techniques
- Each course/offer (name, who it's for, outcome, price, link)
- Voice and caption rules (from the K-Ching content skill)
- 20–30 of his best past captions + their view counts
- Comment-keyword CTAs in use and what each sends

---

## 10. Build phases

### Phase 1: Skeleton + auth + deploy
1. Create repo, scaffold `web` with Vite React TS, Tailwind, shadcn/ui.
2. `supabase init`, link project, run migration `0001`.
3. Login page (magic link, PKCE flow), protected routes, layout with sidebar.
4. GitHub Actions deploy to Pages.

**Acceptance:** site loads at `https://jus2neo.github.io/reels-hub/`, invited user can log in by clicking the magic link (lands logged in, not on a blank route), uninvited email can't, page refresh doesn't 404, and an anon-key request to `reel_outliers` / `creators` returns no rows.

### Phase 2: Creator research + outliers (no Meta needed)
1. Apify functions (`apify-start`, `apify-webhook`), test run, map fields, thumbnail copy to R2.
2. Creators page (add Kevin as the benchmark creator), Outliers view + page with filters.
3. Daily rescrape cron.

**Acceptance:** add 10 niche creators + Kevin → reels appear with outlier scores and thumbnails served from R2 → filter "under 20k followers, score ≥ 3" returns sensible results → Kevin's median shows for comparison → a deliberately failed run shows as failed on the Creators page.

### Phase 3: Kevin's Instagram (publish + insights)
1. Meta app setup (Section 4), store token in `ig_tokens`.
2. R2 bucket + CORS + lifecycle rule + `r2-upload-url`.
3. `ig-publish` + `ig-publish-queue` + cron; Publish page.
4. `ig-sync` (media + account insights) + Insights page + Dashboard; `ig-refresh-token` cron.

**Acceptance:** post a test **Trial Reel** (Manual) with "Post now", then close the tab → it still goes live within ~3 min and shows as a trial in Kevin's app; its R2 video is deleted afterwards; a failed upload shows the error on the Publish page; Insights page shows his recent Reels with metrics; Dashboard shows followers and 30-day views/reach.

### Phase 4: AI analyst
1. `knowledge_docs` editor; load Kevin's docs.
2. `ai-analyze` with prompt caching; AI page + "Analyze with AI" buttons on Outliers and Insights.

**Acceptance:** select 5 outliers → AI explains why each worked and gives Kevin-specific adaptations that mention his actual courses.

### Later (optional)
- Transcribe outlier reels (speech-to-text) so the AI can analyze spoken hooks, not just captions.
- Scheduled posting (add `scheduled_at` + a `scheduled` status; the existing cron picks them up when due, with Manila + Montreal times shown side by side).
- Saved filter presets, weekly AI digest email.

---

## 11. GitHub Actions deploy (`.github/workflows/deploy.yml`)

```yaml
name: Deploy
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: web/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@v4
```

In Supabase **Auth → URL Configuration**, set Site URL and Redirect URLs to `https://jus2neo.github.io/reels-hub/`.

---

## 12. Known limits

- **Edits app:** no public API. Edit in Edits → export → upload through Reels Hub.
- **Trial graduation:** `MANUAL` trials are graduated in the Instagram app, not via API.
- **Other creators' data:** only public numbers (views, likes, comments, followers). Reach, saves, shares and watch time are only available for Kevin's own account.
- **Apify** scrapes public Instagram data; results can occasionally break when Instagram changes. Keep the `raw` column so fields can be remapped.
- **No scheduling in v1:** someone has to click "Post now" at the moment the post should go live.
- **Reel duration** isn't available from the Instagram API, so duration-based charts only cover Reels published through Reels Hub.
- **Instagram thumbnails expire:** always use the R2 copy (`thumbnail_r2_key`), never the stored IG URL.
- **Costs:** Supabase, Cloudflare R2 and GitHub Pages free tiers should cover this. Apify and the Claude API are pay-as-you-go; check current pricing on each site and set spending limits.
