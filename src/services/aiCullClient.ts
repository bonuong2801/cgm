import type { DriveMediaItem, StarRating } from '../types/media.ts';
import {
  attachAuthToStreamUrl,
  getAuthHeaders,
} from '../lib/supabaseClient.ts';
import { loadImageElement } from './imageProcessor.ts';

export interface AiCullItemOutcome {
  id: string;
  reject: boolean;
  rating: StarRating;
  reason: string;
}

async function renderCompactBase64Jpeg(item: DriveMediaItem): Promise<string> {
  if (item.rawFile && typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(item.rawFile);
    try {
      const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(bmp, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    } finally {
      bmp.close();
    }
  }

  // Remote Drive photo: fetch via stream proxy or thumbnail blob so canvas is clean
  const fetchUrl = item.downloadUrl.startsWith('/api/')
    ? attachAuthToStreamUrl(item.downloadUrl)
    : item.gridThumbUrl;
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(objUrl);
    const scale = Math.min(
      1,
      320 / Math.max(img.naturalWidth || 320, img.naturalHeight || 320)
    );
    const w = Math.max(1, Math.round((img.naturalWidth || 320) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 240) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

/**
 * Evaluates photos in batches of 10 via `/api/ai/cull` (Gemini 2.5 Flash Vision),
 * reporting incremental culling suggestions and 1-5 star ratings.
 */
export async function runSmartAiCullBatch(
  photos: DriveMediaItem[],
  onProgress: (done: number, total: number) => void,
  onBatchOutcome: (outcomes: AiCullItemOutcome[]) => void,
  signal?: AbortSignal
): Promise<{ totalAnalyzed: number; totalFlaggedReject: number }> {
  const BATCH_SIZE = 10;
  let totalAnalyzed = 0;
  let totalFlaggedReject = 0;

  for (let i = 0; i < photos.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const slice = photos.slice(i, i + BATCH_SIZE);

    const encodedBatch: Array<{ id: string; name: string; base64Jpeg: string }> =
      [];
    await Promise.all(
      slice.map(async (item) => {
        try {
          const base64Jpeg = await renderCompactBase64Jpeg(item);
          encodedBatch.push({ id: item.id, name: item.name, base64Jpeg });
        } catch {
          // skip unreadable item
        }
      })
    );

    if (encodedBatch.length === 0) continue;

    const res = await fetch('/api/ai/cull', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      signal,
      body: JSON.stringify({ photos: encodedBatch }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data?.error || `Không thể chạy AI lọc ảnh (HTTP ${res.status}).`
      );
    }

    const outcomes: AiCullItemOutcome[] = (data.results || []).map(
      (r: any) => ({
        id: String(r.id),
        reject: Boolean(r.reject),
        rating: (Math.max(1, Math.min(5, Number(r.rating) || 3)) as StarRating),
        reason: String(r.reason || ''),
      })
    );

    totalAnalyzed += outcomes.length;
    totalFlaggedReject += outcomes.filter((o) => o.reject).length;
    onBatchOutcome(outcomes);
    onProgress(Math.min(photos.length, i + slice.length), photos.length);
  }

  return { totalAnalyzed, totalFlaggedReject };
}
