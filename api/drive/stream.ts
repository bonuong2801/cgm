const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const VALID_DRIVE_ID = /^[-\w]{15,120}$/;

function getServerDriveApiKey(): string {
  const candidates = [
    process.env.GOOGLE_API_KEY,
    process.env.VITE_GOOGLE_API_KEY,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (
      trimmed &&
      trimmed !== 'your_google_drive_api_key_here' &&
      trimmed !== 'MY_GOOGLE_API_KEY'
    ) {
      return trimmed;
    }
  }
  return '';
}

/**
 * Zero-RAM Binary Media & Video Range Stream Proxy for Google Drive files.
 * - Hides GOOGLE_API_KEY from browser URLs and DevTools
 * - Passes `acknowledgeAbuse=true` & `supportsAllDrives=true` so 50MB+ photos & videos bypass Drive warning walls
 * - Forwards HTTP `Range` headers so HTML5 `<video>` seeking works natively
 * - Sets CORS headers so Worker `OffscreenCanvas` / `fetch()` never hits Tainted Canvas errors
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fileId = (url.searchParams.get('id') || '').trim();

  if (!VALID_DRIVE_ID.test(fileId)) {
    return new Response(JSON.stringify({ error: 'File ID không hợp lệ.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const apiKey = getServerDriveApiKey();
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Chưa cấu hình GOOGLE_API_KEY trên Server.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  }

  const upstreamUrl = `${DRIVE_API_BASE}/${encodeURIComponent(
    fileId
  )}?alt=media&acknowledgeAbuse=true&supportsAllDrives=true&key=${encodeURIComponent(
    apiKey
  )}`;

  const upstreamHeaders = new Headers();
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    upstreamHeaders.set('Range', rangeHeader);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: upstreamHeaders,
      signal: request.signal,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(
        JSON.stringify({
          error: `Google Drive từ chối tải file gốc (HTTP ${upstream.status}). Có thể vượt hạn mức tải trong ngày của Drive.`,
        }),
        {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      );
    }

    const resHeaders = new Headers();
    const passthrough = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
    ];
    for (const h of passthrough) {
      const val = upstream.headers.get(h);
      if (val) resHeaders.set(h, val);
    }
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: err?.message || 'Lỗi kết nối khi truyền luồng dữ liệu từ Drive.',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  }
}

export default { fetch: GET };
