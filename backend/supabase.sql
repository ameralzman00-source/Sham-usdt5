create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

grant all on table public.app_state to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_state' and policyname = 'service_role_all'
  ) then
    create policy service_role_all on public.app_state
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
