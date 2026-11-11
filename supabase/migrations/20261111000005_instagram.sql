-- Phase 3: Kevin's Instagram (publish + insights)

-- Claim processing posts for one cron run. FOR UPDATE SKIP LOCKED + a short lease means two
-- overlapping runs never handle the same post (no double publish).
alter table posts add column locked_until timestamptz;

create or replace function claim_processing_posts(lease_seconds int default 90)
returns setof posts
language sql
security definer
set search_path = public
as $$
  update posts p
     set locked_until = now() + make_interval(secs => lease_seconds)
   where p.id in (
     select id from posts
      where status = 'processing'
        and container_id is not null
        and (locked_until is null or locked_until < now())
      order by created_at
      limit 10
      for update skip locked
   )
  returning p.*;
$$;
revoke all on function claim_processing_posts(int) from public, anon, authenticated;

-- Team members only see / create their own drafts through ig-publish; everyone on the team can read the log.
-- (posts already has the team_all policy from 0001.)

-- Cron jobs. All send the shared secret from Vault ('cron_secret'); see 0003.
create or replace function _call_function(fn text, body jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://kyrpcccqrcmpuayqksaw.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := body
  );
$$;
revoke all on function _call_function(text, jsonb) from public, anon, authenticated;

-- Finish in-progress publishes (Meta processes the video for ~1–3 min).
select cron.schedule('ig-publish-queue', '* * * * *', $$ select _call_function('ig-publish-queue') $$);
-- Daily sync of Kevin's media + insights (18:00 UTC = 02:00 Manila, 13:00/14:00 Montreal).
select cron.schedule('ig-sync-daily', '0 18 * * *', $$ select _call_function('ig-sync') $$);
-- Weekly token refresh (long-lived tokens last ~60 days).
select cron.schedule('ig-token-weekly', '0 3 * * 1', $$ select _call_function('ig-refresh-token') $$);
