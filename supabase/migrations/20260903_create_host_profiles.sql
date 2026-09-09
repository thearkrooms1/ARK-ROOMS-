-- ==============================================================================
-- Migration: Create host_profiles table with Row Level Security (RLS)
-- Description: Establishes secure host identity for TheArk Rooms marketplace (Phase 1)
-- ==============================================================================

-- 1. Create table host_profiles
create table if not exists public.host_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  host_status text not null default 'active' check (host_status in ('pending', 'active', 'suspended')),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint uq_host_profiles_user_id unique (user_id)
);

-- Index on user_id for quick lookups
create index if not exists idx_host_profiles_user_id on public.host_profiles(user_id);
create index if not exists idx_host_profiles_status on public.host_profiles(host_status);

-- 2. Enable Row Level Security (RLS)
alter table public.host_profiles enable row level security;

-- Drop existing policies if any to ensure idempotency
drop policy if exists "Hosts can view own host profile" on public.host_profiles;
drop policy if exists "Admins can view all host profiles" on public.host_profiles;
drop policy if exists "Users can register own host profile" on public.host_profiles;
drop policy if exists "Admins can update host profiles" on public.host_profiles;
drop policy if exists "Admins can delete host profiles" on public.host_profiles;

-- 3. Policy: Authenticated users can view their own host profile
create policy "Hosts can view own host profile"
  on public.host_profiles for select
  to authenticated
  using (auth.uid() = user_id);

-- 4. Policy: Administrators can view all host profiles
create policy "Admins can view all host profiles"
  on public.host_profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- 5. Policy: Authenticated users can register their own host profile
-- Prevents users from inserting someone else's user_id or setting suspended status
create policy "Users can register own host profile"
  on public.host_profiles for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and host_status in ('active', 'pending')
  );

-- 6. Policy: Only Administrators can update host profiles
-- CRITICAL: Hosts cannot change their own host_status (e.g. from suspended/pending to active)
create policy "Admins can update host profiles"
  on public.host_profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- 7. Policy: Only Administrators can delete host profiles
create policy "Admins can delete host profiles"
  on public.host_profiles for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
