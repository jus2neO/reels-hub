-- pg_net gives up waiting after 5s by default. Wait up to 150s (the Edge Function limit) so a cron
-- call's recorded response is the function's real result, not a client timeout.
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
    body := body,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function _call_function(text, jsonb) from public, anon, authenticated;
