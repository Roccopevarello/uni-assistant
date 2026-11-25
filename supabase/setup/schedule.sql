-- Run once in the Supabase SQL editor after deploying the functions.
-- Calls the daily check every hour; each student is processed once a day,
-- at the first run on or after their briefing hour in their own time zone.
-- Replace the two placeholders first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<the CRON_SECRET you set for the functions>', 'cron_secret');

select cron.schedule(
  'uni-assistant-daily-check',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-check',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
