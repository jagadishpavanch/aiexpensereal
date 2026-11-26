-- One row per synced record. The app's TypeScript types define `data`;
-- the database enforces ownership and ordering only.
create table public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null check (collection in (
    'transactions','categories','accounts','budgets','goals','rules','bills','people','splits','prefs')),
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, collection, id)
);

create index records_user_updated on public.records (user_id, updated_at);

alter table public.records enable row level security;

grant select, insert, update on public.records to authenticated;

create policy "Users read their own records" on public.records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their own records" on public.records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users change their own records" on public.records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.records_touch() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();
