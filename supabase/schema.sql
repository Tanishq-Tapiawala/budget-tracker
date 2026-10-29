-- Paste into your Supabase project's SQL Editor, then run once.
create table if not exists public.user_ledgers (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_ledgers enable row level security;
revoke all on public.user_ledgers from anon;
grant select, insert, update on public.user_ledgers to authenticated;

drop policy if exists "owner can read ledger" on public.user_ledgers;
drop policy if exists "owner can create ledger" on public.user_ledgers;
drop policy if exists "owner can update ledger" on public.user_ledgers;

create policy "owner can read ledger" on public.user_ledgers
  for select to authenticated using (auth.uid() = owner_id);
create policy "owner can create ledger" on public.user_ledgers
  for insert to authenticated with check (auth.uid() = owner_id);
create policy "owner can update ledger" on public.user_ledgers
  for update to authenticated using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
