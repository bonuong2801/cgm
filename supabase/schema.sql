-- ============================================================================
-- CGM STUDIO — SUPABASE SCHEMA (AUTH, ACCOUNT TIERING, LICENSE KEYS & VIETQR)
-- Hướng dẫn: Dán toàn bộ nội dung file này vào Supabase SQL Editor và bấm RUN.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. BẢNG PROFILES (Lưu cấp bậc tài khoản: 'free' vs 'pro' & quyền 'admin')
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  tier text not null default 'free' check (tier in ('free', 'pro')),
  pro_expires_at timestamptz null, -- NULL khi tier='pro' nghĩa là Mở khóa Vĩnh viễn
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tự động tạo dòng profile 'free' ngay khi người dùng Đăng ký Email hoặc Google Login
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, tier, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''),
    'free',
    'user'
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. BẢNG MÃ KÍCH HOẠT (LICENSE KEYS) & LỊCH SỬ KÍCH HOẠT
create table if not exists public.license_keys (
  code text primary key,
  plan_type text not null default 'lifetime' check (plan_type in ('monthly', 'yearly', 'lifetime')),
  duration_days integer null, -- 30, 365, hoặc NULL (vĩnh viễn)
  max_uses integer not null default 1 check (max_uses >= 1),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  note text,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.license_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.license_keys(code) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);

-- 3. BẢNG ĐƠN THANH TOÁN TỰ ĐỘNG VIETQR (PAYMENT ORDERS)
create table if not exists public.payment_orders (
  order_code text primary key, -- Mã chữ-số liền (VD: CGM839214) để ngân hàng không cắt ký tự
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null check (plan_id in ('monthly', 'yearly', 'lifetime')),
  amount_vnd integer not null check (amount_vnd > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  provider_tx_id text,
  paid_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_orders_user_status
  on public.payment_orders(user_id, status);

-- 4. BẬT ROW LEVEL SECURITY (CHỐNG USER TỰ SỬA CỘT TIER TỪ TRÌNH DUYỆT)
alter table public.profiles enable row level security;
alter table public.license_keys enable row level security;
alter table public.license_redemptions enable row level security;
alter table public.payment_orders enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can view own payment orders" on public.payment_orders;
create policy "Users can view own payment orders"
  on public.payment_orders for select
  using (auth.uid() = user_id);

-- Lưu ý: Không tạo policy INSERT/UPDATE cho client trên profiles & license_keys.
-- Chỉ Server (/api) dùng SUPABASE_SERVICE_ROLE_KEY mới được nâng cấp tài khoản.

-- 5. HÀM NGUYÊN TỬ KÍCH HOẠT MÃ LICENSE KEY (CHỐNG RACE CONDITION)
create or replace function public.redeem_license_key(
  p_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean_code text := upper(trim(p_code));
  v_key public.license_keys%rowtype;
  v_profile public.profiles%rowtype;
  v_new_expires timestamptz;
  v_base_time timestamptz;
begin
  select * into v_key
  from public.license_keys
  where code = v_clean_code
  for update;

  if not found or not v_key.is_active then
    return jsonb_build_object('ok', false, 'error', 'Mã kích hoạt không tồn tại hoặc đã bị vô hiệu hóa.');
  end if;

  if v_key.used_count >= v_key.max_uses then
    return jsonb_build_object('ok', false, 'error', 'Mã kích hoạt này đã hết lượt sử dụng.');
  end if;

  if exists (
    select 1 from public.license_redemptions
    where code = v_clean_code and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Tài khoản của bạn đã từng sử dụng mã kích hoạt này.');
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Không tìm thấy hồ sơ người dùng.');
  end if;

  if v_key.plan_type = 'lifetime' or v_key.duration_days is null then
    v_new_expires := null;
  else
    -- Nếu tài khoản đang là Vĩnh viễn thì giữ nguyên Vĩnh viễn
    if v_profile.tier = 'pro' and v_profile.pro_expires_at is null then
      v_new_expires := null;
    else
      v_base_time := greatest(coalesce(v_profile.pro_expires_at, now()), now());
      v_new_expires := v_base_time + make_interval(days => v_key.duration_days);
    end if;
  end if;

  insert into public.license_redemptions (code, user_id)
  values (v_clean_code, p_user_id);

  update public.license_keys
  set used_count = used_count + 1
  where code = v_clean_code;

  update public.profiles
  set tier = 'pro',
      pro_expires_at = v_new_expires,
      updated_at = now()
  where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'plan_type', v_key.plan_type,
    'pro_expires_at', v_new_expires
  );
end;
$$;

-- 6. HÀM NGUYÊN TỬ XÁC NHẬN ĐƠN VIETQR KHI NHẬN WEBHOOK NGÂN HÀNG
create or replace function public.fulfill_payment_order(
  p_order_code text,
  p_paid_amount integer,
  p_tx_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean_order text := upper(trim(p_order_code));
  v_order public.payment_orders%rowtype;
  v_profile public.profiles%rowtype;
  v_new_expires timestamptz;
  v_base_time timestamptz;
  v_days integer;
begin
  select * into v_order
  from public.payment_orders
  where order_code = v_clean_order
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- Idempotent: nếu đã thanh toán rồi thì trả về thành công luôn
  if v_order.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'user_id', v_order.user_id);
  end if;

  if p_paid_amount < v_order.amount_vnd then
    return jsonb_build_object('ok', false, 'error', 'UNDERPAID');
  end if;

  select * into v_profile
  from public.profiles
  where id = v_order.user_id
  for update;

  if v_order.plan_id = 'lifetime' then
    v_new_expires := null;
  else
    v_days := case when v_order.plan_id = 'yearly' then 365 else 30 end;
    if v_profile.tier = 'pro' and v_profile.pro_expires_at is null then
      v_new_expires := null;
    else
      v_base_time := greatest(coalesce(v_profile.pro_expires_at, now()), now());
      v_new_expires := v_base_time + make_interval(days => v_days);
    end if;
  end if;

  update public.payment_orders
  set status = 'paid',
      provider_tx_id = coalesce(p_tx_id, provider_tx_id),
      paid_at = now()
  where order_code = v_clean_order;

  update public.profiles
  set tier = 'pro',
      pro_expires_at = v_new_expires,
      updated_at = now()
  where id = v_order.user_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_order.user_id,
    'plan_id', v_order.plan_id,
    'pro_expires_at', v_new_expires
  );
end;
$$;

revoke execute on function public.redeem_license_key(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_license_key(uuid, text) to service_role;

revoke execute on function public.fulfill_payment_order(text, integer, text) from public, anon, authenticated;
grant execute on function public.fulfill_payment_order(text, integer, text) to service_role;

-- ============================================================================
-- GỢI Ý CẤP QUYỀN ADMIN CHO TÀI KHOẢN CỦA BẠN (Chạy sau khi đăng ký tài khoản):
-- update public.profiles set role = 'admin', tier = 'pro', pro_expires_at = null
-- where email = 'email_cua_ban@gmail.com';
-- ============================================================================
