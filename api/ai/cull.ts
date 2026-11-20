import {
  ApiHttpError,
  verifyRequestUser,
} from '../_lib/supabaseAdmin.ts';

const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL_CANDIDATES = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
];
const MAX_BATCH_PHOTOS = 12;
const MAX_BASE64_LEN = 350_000; // ~250KB max per thumbnail

export interface AiCullInputPhoto {
  id: string;
  name: string;
  base64Jpeg: string;
}

export interface AiCullPhotoResult {
  id: string;
  reject: boolean;
  rating: 1 | 2 | 3 | 4 | 5;
  reason: string;
}

function getGeminiApiKey(): string {
  const raw = process.env.GEMINI_API_KEY?.trim();
  if (
    raw &&
    raw !== 'MY_GEMINI_API_KEY' &&
    raw !== 'your_gemini_api_key_here'
  ) {
    return raw;
  }
  return '';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { entitlements } = await verifyRequestUser(request);
    if (!entitlements.canUseAiCull) {
      return jsonResponse(
        {
          error:
            'Tính năng AI lọc ảnh lỗi & chấm sao tự động chỉ dành cho Tài khoản Mở khóa Full (Pro).',
          code: 'PRO_REQUIRED',
        },
        403
      );
    }
  } catch (err: any) {
    if (err instanceof ApiHttpError) {
      return jsonResponse({ error: err.message, code: err.code }, err.status);
    }
    return jsonResponse({ error: 'Vui lòng đăng nhập tài khoản.' }, 401);
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          'Tính năng AI lọc ảnh hiện đang gặp sự cố hoặc tạm bảo trì. Vui lòng thử lại sau ít phút.',
        code: 'AI_UNAVAILABLE',
      },
      503
    );
  }

  let body: { photos?: AiCullInputPhoto[] };
  try {
    body = (await request.json()) as { photos?: AiCullInputPhoto[] };
  } catch {
    return jsonResponse({ error: 'Dữ liệu ảnh gửi lên không hợp lệ.' }, 400);
  }

  const photos = body?.photos;
  if (!Array.isArray(photos) || photos.length === 0) {
    return jsonResponse({ error: 'Danh sách ảnh cần phân tích đang trống.' }, 400);
  }
  if (photos.length > MAX_BATCH_PHOTOS) {
    return jsonResponse(
      { error: `Mỗi lượt chỉ phân tích tối đa ${MAX_BATCH_PHOTOS} ảnh.` },
      400
    );
  }

  const parts: any[] = [
    {
      text: [
        'Bạn là biên tập viên ảnh sự kiện chuyên nghiệp.',
        'Hãy đánh giá từng ảnh theo đúng thứ tự ID được cung cấp.',
        'Đặt reject=true CHỈ KHI ảnh bị lỗi kỹ thuật rõ rệt: rung nhòe/mất nét nặng, nhân vật chính nhắm mắt hoàn toàn, cháy sáng/tối đen hỏng chi tiết, hoặc chụp nhầm sàn nhà/che ống kính.',
        'Chấm rating từ 1 đến 5 (5 = sắc nét, khoảnh khắc & bố cục xuất sắc; 3-4 = đạt chuẩn giao khách; 1-2 = ảnh lỗi nên loại).',
        'Trường reason viết tiếng Việt ngắn gọn tối đa 8 từ (ví dụ: "Nhân vật nhắm mắt", "Rung nhòe mất nét", "Sắc nét, khoảnh khắc tốt").',
      ].join(' '),
    },
  ];

  for (const p of photos) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      typeof p.base64Jpeg !== 'string' ||
      p.base64Jpeg.length > MAX_BASE64_LEN
    ) {
      return jsonResponse(
        { error: 'Có tệp ảnh không đúng định dạng hỗ trợ. Vui lòng thử lại.' },
        400
      );
    }
    const cleanBase64 = p.base64Jpeg.replace(/^data:image\/\w+;base64,/, '');
    parts.push({ text: `Photo ID: ${p.id} (${p.name || 'image'})` });
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: cleanBase64,
      },
    });
  }

  try {
    const payload = JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            results: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  id: { type: 'STRING' },
                  reject: { type: 'BOOLEAN' },
                  rating: { type: 'INTEGER' },
                  reason: { type: 'STRING' },
                },
                required: ['id', 'reject', 'rating', 'reason'],
              },
            },
          },
          required: ['results'],
        },
      },
    });

    let upstream: Response | null = null;
    for (const model of GEMINI_MODEL_CANDIDATES) {
      const candidateRes = await fetch(
        `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: request.signal,
          body: payload,
        }
      );
      upstream = candidateRes;
      if (candidateRes.ok) break;
      // Only fall back to next model if current model is unavailable/overloaded
      if (candidateRes.status !== 404 && candidateRes.status !== 503) break;
    }

    if (!upstream || !upstream.ok) {
      const status = upstream?.status || 502;
      return jsonResponse(
        {
          error:
            status === 429
              ? 'Hệ thống AI đang có nhiều người sử dụng cùng lúc. Vui lòng đợi ít phút rồi thử lại.'
              : 'Tính năng AI lọc ảnh hiện đang gặp sự cố kết nối. Vui lòng thử lại sau.',
        },
        status >= 500 ? 502 : status
      );
    }

    const data = (await upstream.json()) as any;
    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || '{"results":[]}';
    const parsed = JSON.parse(rawText) as { results?: AiCullPhotoResult[] };

    const normalized: AiCullPhotoResult[] = (parsed.results || []).map((r) => ({
      id: String(r.id),
      reject: Boolean(r.reject),
      rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 3))) as
        | 1
        | 2
        | 3
        | 4
        | 5,
      reason: String(r.reason || '').slice(0, 80),
    }));

    return jsonResponse({ results: normalized });
  } catch {
    return jsonResponse(
      {
        error:
          'Tính năng AI lọc ảnh hiện đang tạm gián đoạn kết nối. Vui lòng thử lại sau ít phút.',
      },
      502
    );
  }
}

export default { fetch: POST };
