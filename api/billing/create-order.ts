import crypto from 'node:crypto';
import type { PlanId, VietQrOrderResponse } from '../../src/types/auth.ts';
import {
  ApiHttpError,
  getServerBillingPlans,
  getVietQrBankConfig,
  jsonApi,
  verifyRequestUser,
} from '../_lib/supabaseAdmin.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId, supabaseAdmin } = await verifyRequestUser(request);
    const bank = getVietQrBankConfig();

    if (!bank.configured) {
      return jsonApi(
        {
          error:
            'Chưa cấu hình tài khoản ngân hàng VietQR (VIETQR_BANK_ID, VIETQR_ACCOUNT_NO, VIETQR_ACCOUNT_NAME) trên Server. Vui lòng dùng tab Nhập Mã Kích Hoạt hoặc cấu hình biến môi trường.',
          code: 'VIETQR_NOT_CONFIGURED',
        },
        503
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      planId?: PlanId;
    };
    const planId: PlanId =
      body?.planId === 'monthly' ||
      body?.planId === 'yearly' ||
      body?.planId === 'lifetime'
        ? body.planId
        : 'yearly';

    const plans = getServerBillingPlans();
    const selectedPlan = plans[planId];

    // Generate clean alphanumeric memo code (`CGM` + 7 random digits) so banks never strip characters
    const orderCode = `CGM${crypto.randomInt(1_000_000, 9_999_999)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabaseAdmin
      .from('payment_orders')
      .insert({
        order_code: orderCode,
        user_id: userId,
        plan_id: planId,
        amount_vnd: selectedPlan.amountVnd,
        status: 'pending',
        expires_at: expiresAt,
      });

    if (insertErr) {
      return jsonApi(
        {
          error: `Không thể khởi tạo đơn thanh toán (${insertErr.message}).`,
        },
        500
      );
    }

    const qrImageUrl = `https://img.vietqr.io/image/${encodeURIComponent(
      bank.bankId
    )}-${encodeURIComponent(
      bank.accountNo
    )}-compact2.png?amount=${encodeURIComponent(
      String(selectedPlan.amountVnd)
    )}&addInfo=${encodeURIComponent(
      orderCode
    )}&accountName=${encodeURIComponent(bank.accountName)}`;

    const payload: VietQrOrderResponse = {
      orderCode,
      planId,
      amountVnd: selectedPlan.amountVnd,
      qrImageUrl,
      bankId: bank.bankId,
      accountNo: bank.accountNo,
      accountName: bank.accountName,
      expiresAt,
    };

    return jsonApi(payload);
  } catch (err: any) {
    if (err instanceof ApiHttpError) {
      return jsonApi({ error: err.message, code: err.code }, err.status);
    }
    return jsonApi(
      { error: err?.message || 'Lỗi tạo đơn VietQR.' },
      500
    );
  }
}

export default { fetch: POST };
