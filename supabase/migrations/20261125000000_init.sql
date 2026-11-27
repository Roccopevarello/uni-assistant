-- Uni Assistant: phase 1 schema.
-- Secrets (AI key, mailbox tokens, Blackboard feed link) are stored encrypted by
-- the edge functions and are never readable from the app: the app's role can
-- only select the columns listed in the grants below.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  time_zone text not null default 'Europe/Madrid',
  briefing_hour smallint not null default 7 check (briefing_hour between 0 and 23),
  courses text[] not null default '{}',
  ai_provider text check (ai_provider in ('anthropic', 'openai')),
  ai_model text,
  ai_key_enc text,
  ai_key_hint text,
  blackboard_feed_enc text,
  has_blackboard_feed boolean generated always as (blackboard_feed_enc is not null) stored,
  calendar_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expo_push_token text,
  last_mail_check timestamptz,
  last_run_date date,
  last_run_error text,
  pending_questions jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table public.mail_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('microsoft', 'google')),
  email text not null,
  refresh_token_enc text not null,
  connected_at timestamptz not null default now(),
  primary key (user_id, provider, email)
);

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course text not null,
  task text not null,
  action text not null,
  due_date date not null,
  due_time text check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  source text not null check (source in ('email', 'blackboard')),
  source_ref text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index deadlines_user_due on public.deadlines (user_id, due_date);

create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_date date not null,
  headline text not null,
  overview jsonb not null,
  today jsonb not null,
  new_since_yesterday jsonb not null,
  watch_out jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, run_date)
);

-- Short-lived state for mailbox sign-in (PKCE).
create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  verifier text not null,
  return_to text,
  created_at timestamptz not null default now()
);

-- New sign-ups get a profile row.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security: each student sees only their own rows; writes go through edge functions.
alter table public.profiles enable row level security;
alter table public.mail_connections enable row level security;
alter table public.deadlines enable row level security;
alter table public.briefings enable row level security;
alter table public.oauth_states enable row level security;

create policy "own profile" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "own mailboxes" on public.mail_connections for select to authenticated using (user_id = auth.uid());
create policy "own deadlines" on public.deadlines for select to authenticated using (user_id = auth.uid());
create policy "own briefings" on public.briefings for select to authenticated using (user_id = auth.uid());
-- oauth_states: no policies, server only.

revoke all on public.profiles, public.mail_connections, public.deadlines, public.briefings, public.oauth_states from anon, authenticated;
grant select (user_id, time_zone, briefing_hour, courses, ai_provider, ai_model, ai_key_hint, has_blackboard_feed, calendar_token,
              last_mail_check, last_run_date, last_run_error, pending_questions, created_at)
  on public.profiles to authenticated;
grant select (user_id, provider, email, connected_at) on public.mail_connections to authenticated;
grant select on public.deadlines, public.briefings to authenticated;
