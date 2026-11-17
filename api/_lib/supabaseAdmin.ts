import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  BillingPlanOption,
  PlanEntitlements,
  PlanId,
  UserProfile,
} from '../../src/types/auth.ts';
import { getPlanEntitlements } from '../../src/utils/entitlements.ts';

export class ApiHttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonApi(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function getSupabaseUrl(): string {
  const raw = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();
  if (!raw || raw.includes('your-project-id')) return '';
  return raw;
}

function getServiceRoleKey(): string {
  const raw = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!raw || raw === 'your_supabase_service_role_secret_key') return '';
  return raw;
}

export function isServerSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getServiceRoleKey());
}

let cachedAdminClient: SupabaseClient | null = null;
let cachedKeySignature = '';

export function getSupabaseAdmin(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key) {
    throw new ApiHttpError(
      503,
      'Chưa cấu hình SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trên Server.',
      'SUPABASE_NOT_CONFIGURED'
    );
  }
  const sig = `${url}|${key.slice(0, 12)}`;
  if (!cachedAdminClient || cachedKeySignature !== sig) {
    cachedAdminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cachedKeySignature = sig;
  }
  return cachedAdminClient;
}

export function mapDbProfileRow(row: any): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email || ''),
    fullName: String(row.full_name || ''),
    avatarUrl: String(row.avatar_url || ''),
    tier: row.tier === 'pro' ? 'pro' : 'free',
    proExpiresAt: row.pro_expires_at ? String(row.pro_expires_at) : null,
    role: row.role === 'admin' ? 'admin' : 'user',
  };
}

export function extractBearerOrQueryToken(
  request: Request,
  allowQueryToken = false
): string {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  if (allowQueryToken) {
    const url = new URL(request.url);
    const qToken = (url.searchParams.get('token') || '').trim();
    if (qToken) return qToken;
  }
  return '';
}

export async function verifyRequestUser(
  request: Request,
  options?: { allowQueryToken?: boolean }
): Promise<{
  userId: string;
  email: string;
  profile: UserProfile;
  entitlements: PlanEntitlements;
  supabaseAdmin: SupabaseClient;
}> {
  const token = extractBearerOrQueryToken(
    request,
    Boolean(options?.allowQueryToken)
  );
  if (!token) {
    throw new ApiHttpError(
      401,
      'Vui lòng đăng nhập tài khoản để sử dụng chức năng này.',
      'UNAUTHORIZED'
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
    token
  );
  if (userErr || !userData?.user) {
    throw new ApiHttpError(
      401,
      'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
      'INVALID_TOKEN'
    );
  }

  const authUser = userData.user;
  let { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  // Safety bootstrap if trigger had not created row yet
  if (!profileRow) {
    const meta = authUser.user_metadata || {};
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: authUser.id,
          email: authUser.email || '',
          full_name: meta.full_name || meta.name || '',
          avatar_url: meta.avatar_url || meta.picture || '',
          tier: 'free',
          role: 'user',
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (insertErr || !inserted) {
      throw new ApiHttpError(
        500,
        'Chưa khởi tạo bảng `profiles` trên Supabase. Hãy chạy file `supabase/schema.sql` trong SQL Editor.',
        'SCHEMA_MISSING'
      );
    }
    profileRow = inserted;
  }

  const profile = mapDbProfileRow(profileRow);
  const entitlements = getPlanEntitlements(profile);

  return {
    userId: authUser.id,
    email: authUser.email || '',
    profile,
    entitlements,
    supabaseAdmin,
  };
}

export function getServerBillingPlans(): Record<PlanId, BillingPlanOption> {
  const monthly = Math.max(
    2000,
    Number(process.env.PLAN_MONTHLY_VND) || 99_000
  );
  const yearly = Math.max(
    2000,
    Number(process.env.PLAN_YEARLY_VND) || 599_000
  );
  const lifetime = Math.max(
    2000,
    Number(process.env.PLAN_LIFETIME_VND) || 1_290_000
  );

  return {
    monthly: {
      id: 'monthly',
      name: 'Gói 1 Tháng',
      durationLabel: '30 ngày Full chức năng',
      amountVnd: monthly,
    },
    yearly: {
      id: 'yearly',
      name: 'Gói 1 Năm',
      badge: 'Phổ biến nhất',
      durationLabel: '365 ngày Full chức năng',
      amountVnd: yearly,
    },
    lifetime: {
      id: 'lifetime',
      name: 'Mở khóa Vĩnh viễn',
      badge: 'Tiết kiệm nhất',
      durationLabel: 'Trọn đời không giới hạn',
      amountVnd: lifetime,
    },
  };
}

export function getVietQrBankConfig(): {
  configured: boolean;
  bankId: string;
  accountNo: string;
  accountName: string;
} {
  const bankId = (process.env.VIETQR_BANK_ID || '').trim();
  const accountNo = (process.env.VIETQR_ACCOUNT_NO || '').trim();
  const accountName = (process.env.VIETQR_ACCOUNT_NAME || '').trim();

  const configured = Boolean(
    bankId &&
      accountNo &&
      accountNo !== '0123456789' &&
      accountName &&
      accountName !== 'NGUYEN VAN A'
  );

  return { configured, bankId, accountNo, accountName };
}
