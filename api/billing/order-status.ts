import {
  ApiHttpError,
  jsonApi,
  mapDbProfileRow,
  verifyRequestUser,
} from '../_lib/supabaseAdmin.ts';

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId, supabaseClient } = await verifyRequestUser(request);
    const url = new URL(request.url);
    const orderCode = (url.searchParams.get('orderCode') || '')
      .trim()
      .toUpperCase();

    if (!/^CGM\d{6,8}$/.test(orderCode)) {
      return jsonApi({ error: 'Mã đơn hàng không hợp lệ.' }, 400);
    }

    const { data: order, error } = await supabaseClient
      .from('payment_orders')
      .select('order_code, status, paid_at, plan_id')
      .eq('order_code', orderCode)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !order) {
      return jsonApi({ error: 'Không tìm thấy đơn thanh toán.' }, 404);
    }

    let updatedProfile = null;
    if (order.status === 'paid') {
      const { data: pRow } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (pRow) updatedProfile = mapDbProfileRow(pRow);
    }

    return jsonApi({
      orderCode: order.order_code,
      status: order.status,
      paidAt: order.paid_at,
      planId: order.plan_id,
      profile: updatedProfile,
    });
  } catch (err: any) {
    if (err instanceof ApiHttpError) {
      return jsonApi({ error: err.message, code: err.code }, err.status);
    }
    return jsonApi({ error: 'Lỗi kiểm tra trạng thái đơn.' }, 500);
  }
}

export default { fetch: GET };
