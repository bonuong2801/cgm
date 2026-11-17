import crypto from 'node:crypto';
import { extractOrderCodeFromTransferContent } from '../../src/utils/entitlements.ts';
import { getSupabaseAdmin, jsonApi } from '../_lib/supabaseAdmin.ts';

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies PayOS HMAC-SHA256 webhook signature (sorted key=value&... of `data` object).
 */
export function verifyPayOsSignature(
  dataObj: Record<string, unknown>,
  signature: string,
  checksumKey: string
): boolean {
  if (!dataObj || !signature || !checksumKey) return false;
  const sortedKeys = Object.keys(dataObj).sort();
  const queryStr = sortedKeys
    .map((k) => {
      const val = dataObj[k];
      const normalized =
        val === null || val === undefined
          ? ''
          : typeof val === 'object'
          ? JSON.stringify(val)
          : String(val);
      return `${k}=${normalized}`;
    })
    .join('&');

  const computed = crypto
    .createHmac('sha256', checksumKey)
    .update(queryStr)
    .digest('hex');

  return safeTimingEqual(computed.toLowerCase(), signature.toLowerCase());
}

export interface ParsedWebhookTransfer {
  orderCode: string;
  paidAmount: number;
  txId: string;
}

/**
 * Authenticates & parses incoming bank transfer webhooks from either SePay or PayOS.
 */
export function verifyAndParseBankWebhook(
  headers: Headers,
  payload: any,
  env: { sepaySecret?: string; payosChecksumKey?: string }
): { ok: true; transfer: ParsedWebhookTransfer | null } | { ok: false; status: number; error: string } {
  const sepaySecret = (env.sepaySecret || '').trim();
  const payosKey = (env.payosChecksumKey || '').trim();

  if (
    (!sepaySecret || sepaySecret === 'your_sepay_webhook_secret') &&
    !payosKey
  ) {
    return {
      ok: false,
      status: 503,
      error: 'Webhook secret not configured on server.',
    };
  }

  // Path A: PayOS signed payload (`data` + `signature`)
  if (payload?.signature && payload?.data && payosKey) {
    if (!verifyPayOsSignature(payload.data, String(payload.signature), payosKey)) {
      return { ok: false, status: 401, error: 'Invalid PayOS signature.' };
    }
    const desc = String(
      payload.data.description || payload.data.orderCode || ''
    );
    const orderCode = extractOrderCodeFromTransferContent(desc);
    const paidAmount = Math.round(Number(payload.data.amount) || 0);
    if (!orderCode || paidAmount <= 0) {
      return { ok: true, transfer: null };
    }
    return {
      ok: true,
      transfer: {
        orderCode,
        paidAmount,
        txId: String(payload.data.reference || payload.data.orderCode || ''),
      },
    };
  }

  // Path B: SePay Authorization header (`Apikey <SECRET>` or `Bearer <SECRET>`)
  if (sepaySecret && sepaySecret !== 'your_sepay_webhook_secret') {
    const authHeader = (headers.get('authorization') || '').trim();
    const tokenMatch = authHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
    const providedSecret = tokenMatch?.[1]?.trim() || '';

    if (!providedSecret || !safeTimingEqual(providedSecret, sepaySecret)) {
      return { ok: false, status: 401, error: 'Invalid SePay webhook key.' };
    }

    // Ignore outgoing bank transfers
    if (payload?.transferType && payload.transferType !== 'in') {
      return { ok: true, transfer: null };
    }

    const content = String(
      payload?.content || payload?.description || payload?.code || ''
    );
    const orderCode = extractOrderCodeFromTransferContent(content);
    const paidAmount = Math.round(
      Number(payload?.transferAmount ?? payload?.amount) || 0
    );

    if (!orderCode || paidAmount <= 0) {
      return { ok: true, transfer: null };
    }

    return {
      ok: true,
      transfer: {
        orderCode,
        paidAmount,
        txId: String(payload?.id || payload?.referenceCode || ''),
      },
    };
  }

  return { ok: false, status: 401, error: 'Unauthorized webhook request.' };
}

export async function POST(request: Request): Promise<Response> {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return jsonApi({ error: 'Invalid JSON payload' }, 400);
  }

  const verified = verifyAndParseBankWebhook(request.headers, payload, {
    sepaySecret: process.env.SEPAY_WEBHOOK_SECRET,
    payosChecksumKey: process.env.PAYOS_CHECKSUM_KEY,
  });

  if (!verified.ok) {
    return jsonApi({ error: verified.error }, verified.status);
  }

  // Unrelated bank transaction without CGMxxxxxx code -> acknowledge 200 so provider stops retrying
  if (!verified.transfer) {
    return jsonApi({ success: true, ignored: true });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('fulfill_payment_order', {
      p_order_code: verified.transfer.orderCode,
      p_paid_amount: verified.transfer.paidAmount,
      p_tx_id: verified.transfer.txId,
    });

    if (error) {
      return jsonApi({ error: error.message }, 500);
    }

    return jsonApi({
      success: true,
      fulfilled: Boolean(data?.ok),
      detail: data,
    });
  } catch (err: any) {
    return jsonApi({ error: err?.message || 'Webhook processing error' }, 500);
  }
}

export default { fetch: POST };
