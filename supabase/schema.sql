-- ============================================================================
-- CGM STUDIO — SUPABASE SCHEMA (ĐÃ TRIỂN KHAI TỰ ĐỘNG TRÊN PROJECT cgm-studio)
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table private.app_secrets enable row level security;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  tier text not null default 'free' check (tier in ('free', 'pro')),
  pro_expires_at timestamptz null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tài khoản đăng ký ĐẦU TIÊN tự động nhận quyền Admin + Pro Vĩnh viễn;
-- tất cả các tài khoản đăng ký sau tự động ở gói Thường ('free').
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_admin boolean;
begin
  perform pg_advisory_xact_lock(9283741);
  select exists(select 1 from public.profiles where role = 'admin') into v_has_admin;

  insert into public.profiles (id, email, full_name, avatar_url, tier, pro_expires_at, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''),
    case when v_has_admin then 'free' else 'pro' end,
    null,
    case when v_has_admin then 'user' else 'admin' end
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.license_keys (
  code text primary key,
  plan_type text not null default 'lifetime' check (plan_type in ('monthly', 'yearly', 'lifetime')),
  duration_days integer null,
  max_uses integer not null default 1 check (max_uses >= 1),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  note text,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_license_keys_created_by on public.license_keys(created_by);

create table if not exists public.license_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.license_keys(code) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);

create index if not exists idx_license_redemptions_user_id on public.license_redemptions(user_id);

create table if not exists public.payment_orders (
  order_code text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null check (plan_id in ('monthly', 'yearly', 'lifetime')),
  amount_vnd integer not null check (amount_vnd > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  provider_tx_id text,
  paid_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_orders_user_status on public.payment_orders(user_id, status);

alter table public.profiles enable row level security;
alter table public.license_keys enable row level security;
alter table public.license_redemptions enable row level security;
alter table public.payment_orders enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.license_keys from anon, authenticated;
revoke all on public.license_redemptions from anon, authenticated;
revoke all on public.payment_orders from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.payment_orders to authenticated;

create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can view own payment orders"
  on public.payment_orders for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "No direct client access to license_keys"
  on public.license_keys for select
  to authenticated
  using (false);

create policy "No direct client access to license_redemptions"
  on public.license_redemptions for select
  to authenticated
  using (false);

create policy "No direct access to private secrets"
  on private.app_secrets for select
  to authenticated
  using (false);
