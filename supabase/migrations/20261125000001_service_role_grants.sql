-- The edge functions use the service role. Newer Supabase projects no longer
-- grant it table access by default, so grant it explicitly.
grant select, insert, update, delete
  on public.profiles, public.mail_connections, public.deadlines, public.briefings, public.oauth_states
  to service_role;
