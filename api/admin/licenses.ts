import crypto from 'node:crypto';
import type { PlanId } from '../../src/types/auth.ts';
import { getPlanDurationDays } from '../../src/utils/entitlements.ts';
import {
  ApiHttpError,
  jsonApi,
  verifyRequestUser,
} from '../_lib/supabaseAdmin.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRandomLicenseCode(planId: PlanId): string {
  const prefix =
    planId === 'lifetime' ? 'VIP' : planId === 'yearly' ? 'YRL' : 'MTH';
  const seg = (len: number) =>
    Array.from(
      { length: len },
      () => CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)]
    ).join('');
  return `CGM-${prefix}-${seg(4)}-${seg(4)}`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { profile, supabaseClient } = await verifyRequestUser(request);
    if (profile.role !== 'admin') {
      return jsonApi(
        { error: 'Chỉ quản trị viên mới có quyền truy cập.' },
        403
      );
    }

    const { data, error } = await supabaseClient.rpc('admin_list_licenses');
    if (error) return jsonApi({ error: error.message }, 500);
    return jsonApi({ licenses: data || [] });
  } catch (err: any) {
    if (err instanceof ApiHttpError) {
      return jsonApi({ error: err.message }, err.status);
    }
    return jsonApi({ error: 'Lỗi tải danh sách mã kích hoạt.' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { profile, supabaseClient } = await verifyRequestUser(request);
    if (profile.role !== 'admin') {
      return jsonApi({ error: 'Chỉ quản trị viên mới có quyền tạo mã.' }, 403);
    }

    const body = (await request.json().catch(() => ({}))) as {
      planType?: PlanId;
      count?: number;
      maxUses?: number;
      note?: string;
    };

    const planType: PlanId =
      body.planType === 'monthly' ||
      body.planType === 'yearly' ||
      body.planType === 'lifetime'
        ? body.planType
        : 'lifetime';

    const count = Math.max(
      1,
      Math.min(50, Math.round(Number(body.count) || 1))
    );
    const maxUses = Math.max(
      1,
      Math.min(10_000, Math.round(Number(body.maxUses) || 1))
    );
    const note = body.note ? String(body.note).slice(0, 120) : null;
    const durationDays = getPlanDurationDays(planType);

    const codes = Array.from({ length: count }, () =>
      generateRandomLicenseCode(planType)
    );

    const { data, error } = await supabaseClient.rpc('admin_create_licenses', {
      p_codes: codes,
      p_plan_type: planType,
      p_duration_days: durationDays,
      p_max_uses: maxUses,
      p_note: note,
    });

    if (error) return jsonApi({ error: error.message }, 500);
    return jsonApi({ created: data || [] });
  } catch (err: any) {
    if (err instanceof ApiHttpError) {
      return jsonApi({ error: err.message }, err.status);
    }
    return jsonApi({ error: 'Lỗi tạo mã kích hoạt.' }, 500);
  }
}

export async function handleAdminLicenses(request: Request): Promise<Response> {
  if (request.method === 'GET') return GET(request);
  if (request.method === 'POST') return POST(request);
  return jsonApi({ error: 'Method Not Allowed' }, 405);
}

export default { fetch: handleAdminLicenses };
