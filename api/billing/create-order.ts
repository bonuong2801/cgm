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
    const { supabaseClient } = await verifyRequestUser(request);
    const bank = getVietQrBankConfig();

    if (!bank.configured) {
      return jsonApi(
        {
          error:
            'Kênh thanh toán tự động qua mã QR hiện đang tạm bảo trì. Vui lòng chuyển sang tab Nhập Mã Kích Hoạt hoặc thử lại sau.',
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

    const orderCode = `CGM${crypto.randomInt(1_000_000, 9_999_999)}`;

    const { data: rpcData, error: rpcErr } = await supabaseClient.rpc(
      'create_my_payment_order',
      {
        p_order_code: orderCode,
        p_plan_id: planId,
        p_amount_vnd: selectedPlan.amountVnd,
      }
    );

    if (rpcErr) {
      return jsonApi(
        { error: 'Không thể khởi tạo mã thanh toán lúc này. Vui lòng thử lại sau ít phút.' },
        500
      );
    }

    const expiresAt =
      rpcData?.expires_at ||
      new Date(Date.now() + 30 * 60 * 1000).toISOString();

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
      {
        error:
          'Không thể tạo mã thanh toán QR lúc này. Vui lòng thử lại hoặc dùng Mã Kích Hoạt.',
      },
      500
    );
  }
}

export default { fetch: POST };
