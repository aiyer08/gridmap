-- GridMap — tracker schema.
--
-- One table. Every row is something a user did (or politely declined) and the
-- grams of CO2e it avoided. Safe to run more than once.
--
-- Apply with: Supabase dashboard → SQL Editor → paste → Run.
-- See supabase/README.md for the full checklist.

-- gen_random_uuid() lives here. Supabase projects usually have it already.
create extension if not exists pgcrypto;

create table if not exists public.logged_actions (
  id uuid primary key default gen_random_uuid(),

  -- Deleting an account should take its history with it, hence the cascade.
  -- The default lets an insert omit user_id and still land on the right row.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 'shift' = ran an appliance in a cleaner window. 'habit' = a small everyday win.
  kind text not null check (kind in ('shift', 'habit')),

  -- Appliance id (APPLIANCES) for shifts, habit id (HABITS) for habits. Kept as
  -- text rather than a foreign key: the catalogue lives in the app, and an old
  -- row should stay readable after we rename or retire an entry.
  subject_id text not null,

  -- Denormalised label, so history renders correctly even if the catalogue changes.
  label text not null,

  logged_at timestamptz not null default now(),

  -- Never negative: a forecast that moved the wrong way is not the user's fault,
  -- so the app floors savings at zero before it ever gets here.
  grams_saved numeric(12, 2) not null default 0 check (grams_saved >= 0),

  -- What the run would have cost at the baseline time, and what it actually cost.
  -- Nullable because habits have no baseline.
  baseline_grams numeric(12, 2),
  actual_grams numeric(12, 2),

  -- Declining a suggestion is a completely fine outcome. It is recorded so the
  -- UI can respond kindly, and it is worth exactly zero grams — never negative.
  status text not null default 'done' check (status in ('done', 'declined')),
  constraint declined_actions_are_zero
    check (status <> 'declined' or grams_saved = 0),

  -- EIA balancing authority the numbers came from, e.g. 'CISO'.
  region_ba text,

  created_at timestamptz not null default now()
);

-- Every read is "this user's history, newest first".
create index if not exists logged_actions_user_logged_at_idx
  on public.logged_actions (user_id, logged_at desc);

-- Supports the weekly/streak grouping without scanning a whole account.
create index if not exists logged_actions_user_status_idx
  on public.logged_actions (user_id, status);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The browser talks to PostgREST with the anon key, so these policies are the
-- only thing standing between users' histories. No policy = no access.
-- ---------------------------------------------------------------------------

alter table public.logged_actions enable row level security;

drop policy if exists "own rows: select" on public.logged_actions;
create policy "own rows: select"
  on public.logged_actions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.logged_actions;
create policy "own rows: insert"
  on public.logged_actions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "own rows: update" on public.logged_actions;
create policy "own rows: update"
  on public.logged_actions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.logged_actions;
create policy "own rows: delete"
  on public.logged_actions for delete
  to authenticated
  using (auth.uid() = user_id);
