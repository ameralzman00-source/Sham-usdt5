create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare
  id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'app_state'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if id_type is not null and id_type <> 'text' then
    execute 'alter table public.app_state alter column id drop identity if exists';
    execute 'alter table public.app_state alter column id drop default';
    execute 'alter table public.app_state alter column id type text using id::text';
    execute 'alter table public.app_state alter column id set not null';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass and contype = 'p'
  ) then
    alter table public.app_state add primary key (id);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_state' and column_name = 'payload'
  ) then
    alter table public.app_state add column payload jsonb not null default '{}'::jsonb;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_state' and column_name = 'updated_at'
  ) then
    alter table public.app_state add column updated_at timestamptz not null default now();
  end if;
end $$;

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
