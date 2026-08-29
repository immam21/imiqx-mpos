-- OneCounter auth support schema for Supabase
-- Password credentials are managed by Supabase Auth in auth.users.
-- This schema stores tenant/profile/role links used by the app.

create extension if not exists "pgcrypto";

create table if not exists app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'manager' check (role in ('cashier', 'manager', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_store_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id text not null,
  store_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, business_id, store_id)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at on app_users;
create trigger trg_app_users_updated_at
before update on app_users
for each row execute function set_updated_at();

-- Auto-create app profile after a new Supabase auth user is created
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table app_users enable row level security;
alter table user_store_access enable row level security;

-- Basic self-access policies
drop policy if exists "app_users_select_own" on app_users;
create policy "app_users_select_own"
on app_users for select
using (auth.uid() = id);

drop policy if exists "app_users_update_own" on app_users;
create policy "app_users_update_own"
on app_users for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "user_store_access_select_own" on user_store_access;
create policy "user_store_access_select_own"
on user_store_access for select
using (auth.uid() = user_id);
