-- Reels Hub initial schema (BUILD_GUIDE.md Section 5)
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
