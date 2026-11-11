-- Creator discovery: hashtag / keyword search finds accounts posting Reels in the niche.

alter table scrape_runs drop constraint scrape_runs_kind_check;
alter table scrape_runs add constraint scrape_runs_kind_check
  check (kind in ('profiles', 'reels', 'discover', 'candidate_profiles'));
alter table scrape_runs add column terms text[] not null default '{}';  -- hashtags/keywords for discover runs

create table creator_candidates (
  username text primary key,
  full_name text,
  followers int,
  posts_count int,
  is_verified boolean,
  bio text,
  sources text[] not null default '{}',   -- hashtags/keywords that surfaced this account
  hits int not null default 0,            -- how many matching reels we saw from them
  best_views bigint,                      -- highest-view reel we saw
  best_reel_url text,
  best_caption text,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  profile_scraped_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on creator_candidates (status, hits desc);

alter table creator_candidates enable row level security;
create policy team_all on creator_candidates for all to authenticated using (true) with check (true);

-- Merge one search's results into candidates (called by apify-webhook with the service role).
-- rows: [{username, full_name, hits, best_views, best_reel_url, best_caption}], term: the hashtag/keyword
create or replace function merge_creator_candidates(rows jsonb, terms text[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into creator_candidates as c (username, full_name, sources, hits, best_views, best_reel_url, best_caption)
  select r->>'username',
         r->>'full_name',
         terms,
         (r->>'hits')::int,
         (r->>'best_views')::bigint,
         r->>'best_reel_url',
         r->>'best_caption'
    from jsonb_array_elements(rows) r
  on conflict (username) do update set
    full_name = coalesce(excluded.full_name, c.full_name),
    sources = (select array_agg(distinct s) from unnest(c.sources || excluded.sources) s),
    hits = c.hits + excluded.hits,
    best_views = greatest(c.best_views, excluded.best_views),
    best_reel_url = case when excluded.best_views > coalesce(c.best_views, 0) then excluded.best_reel_url else c.best_reel_url end,
    best_caption = case when excluded.best_views > coalesce(c.best_views, 0) then excluded.best_caption else c.best_caption end,
    updated_at = now();
$$;
revoke all on function merge_creator_candidates(jsonb, text[]) from public, anon, authenticated;
