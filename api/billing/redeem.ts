import {
  ApiHttpError,
  jsonApi,
  mapDbProfileRow,
  verifyRequestUser,
} from '../_lib/supabaseAdmin.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId, supabaseAdmin } = await verifyRequestUser(request);

    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const cleanCode = String(body?.code || '')
      .trim()
      .toUpperCase();

    if (cleanCode.length < 4 || cleanCode.length > 64) {
      return jsonApi(
        { error: 'Vui lòng nhập Mã Kích Hoạt hợp lệ.' },
        400
      );
    }

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'redeem_license_key',
      {
        p_user_id: userId,
        p_code: cleanCode,
      }
    );

    if (rpcErr) {
      return jsonApi(
        {
          error: `Không thể kích hoạt mã (${rpcErr.message}). Hãy chắc chắn đã chạy file supabase/schema.sql.`,
        },
        500
      );
    }

    if (!rpcResult?.ok) {
      return jsonApi(
        {
          error:
            rpcResult?.error ||
            'Mã kích hoạt không hợp lệ hoặc đã hết lượt sử dụng.',
        },
        400
      );
    }

    const { data: updatedRow } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    return jsonApi({
      ok: true,
      planType: rpcResult.plan_type,
      profile: updatedRow ? mapDbProfileRow(updatedRow) : null,
    });
  } catch (err: any) {
    if (err instanceof ApiHttpError) {
      return jsonApi({ error: err.message, code: err.code }, err.status);
    }
    return jsonApi(
      { error: err?.message || 'Lỗi máy chủ khi kích hoạt mã.' },
      500
    );
  }
}

export default { fetch: POST };
