-- Phase 2: creator research (Apify scraping)

-- One row per Apify run, so the Creators page can show running / failed scrapes.
create table scrape_runs (
  id uuid primary key default gen_random_uuid(),
  apify_run_id text unique,
  kind text not null check (kind in ('profiles','reels')),
  usernames text[] not null default '{}',
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  item_count int,
  error text,
  started_by uuid references auth.users(id),   -- null when started by the weekly cron
  created_at timestamptz default now(),
  finished_at timestamptz
);
create index on scrape_runs (created_at desc);

alter table scrape_runs enable row level security;
-- Team can read run status; only Edge Functions (service role) write it.
create policy team_read on scrape_runs for select to authenticated using (true);

-- Extra profile fields from the Apify profile scraper
alter table creators add column profile_pic_url text;
alter table creators add column scrape_error text;   -- last failure for this creator, cleared on success

-- Public bucket for thumbnail copies (Instagram CDN URLs expire within days).
-- Public read is fine: these are thumbnails of public Instagram posts.
-- Only Edge Functions (service role) can write.
insert into storage.buckets (id, name, public)
values ('thumbs', 'thumbs', true)
on conflict (id) do nothing;

-- Scheduling
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Weekly rescrape of all tracked creators (Mondays 19:00 UTC = Tue 03:00 Manila, Mon 14:00/15:00 Montreal).
-- The shared secret lives in Vault (name 'cron_secret') and in the CRON_SECRET function secret;
-- it is set outside of git.
select cron.schedule(
  'creators-rescrape-weekly',
  '0 19 * * 1',
  $$
  select net.http_post(
    url := 'https://kyrpcccqrcmpuayqksaw.supabase.co/functions/v1/apify-start',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"kind":"rescrape"}'::jsonb
  );
  $$
);

-- Thumbnails are stored in Supabase Storage (bucket 'thumbs'), not R2, so use a neutral column name.
alter table reels rename column thumbnail_r2_key to thumbnail_path;
alter table kevin_media rename column thumbnail_r2_key to thumbnail_path;
