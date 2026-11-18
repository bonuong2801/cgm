import {
  getActiveLogos,
  type DriveMediaItem,
  type ExportMaxDimension,
  type ImageExportFormat,
} from '../types/media.ts';
import { attachAuthToStreamUrl } from '../lib/supabaseClient.ts';
import {
  buildCssFilterString,
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
} from '../utils/mediaMath.ts';
import type {
  WorkerRenderRequest,
  WorkerRenderResponse,
} from '../workers/exportWorker.ts';

export { buildCssFilterString, computeSmartLogoPlacement };

const logoImageCache = new Map<string, HTMLImageElement>();

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Không thể giải mã dữ liệu hình ảnh.'));
    img.src = src;
  });
}

/**
 * Reads an uploaded Logo file (PNG, WebP, JPG, or SVG) and normalizes SVGs into
 * a crisp high-res PNG DataURL so both DOM and Worker OffscreenCanvas decode it reliably.
 */
export async function readLogoFileToDataUrl(file: File): Promise<{
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Không thể đọc tệp Logo.'));
    reader.readAsDataURL(file);
  });

  const img = await loadImageElement(rawDataUrl);
  const natW = img.naturalWidth || 600;
  const natH = img.naturalHeight || 200;

  // Rasterize SVG once to transparent high-res PNG so Web Worker createImageBitmap succeeds 100%
  if (
    file.type === 'image/svg+xml' ||
    rawDataUrl.startsWith('data:image/svg+xml')
  ) {
    const targetW = Math.min(2048, Math.max(800, natW * 2));
    const targetH = Math.max(1, Math.round(targetW * (natH / Math.max(1, natW))));
    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const pngDataUrl = c.toDataURL('image/png');
      c.width = 0;
      c.height = 0;
      return {
        dataUrl: pngDataUrl,
        naturalWidth: targetW,
        naturalHeight: targetH,
      };
    }
  }

  return { dataUrl: rawDataUrl, naturalWidth: natW, naturalHeight: natH };
}

async function getCachedLogoImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = logoImageCache.get(dataUrl);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }
  const img = await loadImageElement(dataUrl);
  logoImageCache.set(dataUrl, img);
  return img;
}

// Lazy 4-Worker Pool for background OffscreenCanvas rendering
interface PoolSlot {
  worker: Worker;
  busy: boolean;
}

let workerPool: PoolSlot[] | null = null;
let workerSupported: boolean | null = null;
let nextJobId = 1;
const pendingJobs = new Map<
  number,
  {
    resolve: (blob: Blob) => void;
    reject: (err: Error) => void;
    slot: PoolSlot;
  }
>();
const waitQueue: Array<(slot: PoolSlot) => void> = [];

function ensureWorkerPool(size = 4): PoolSlot[] | null {
  if (workerSupported === false) return null;
  if (workerPool) return workerPool;

  if (
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    workerSupported = false;
    return null;
  }

  try {
    const slots: PoolSlot[] = [];
    for (let i = 0; i < size; i++) {
      const w = new Worker(
        new URL('../workers/exportWorker.ts', import.meta.url),
        { type: 'module' }
      );
      const slot: PoolSlot = { worker: w, busy: false };
      w.onmessage = (ev: MessageEvent<WorkerRenderResponse>) => {
        const res = ev.data;
        const entry = pendingJobs.get(res.jobId);
        if (!entry) return;
        pendingJobs.delete(res.jobId);

        const nextWaiter = waitQueue.shift();
        if (nextWaiter) {
          nextWaiter(entry.slot);
        } else {
          entry.slot.busy = false;
        }

        if (res.ok && res.blob) {
          entry.resolve(res.blob);
        } else {
          entry.reject(new Error(res.error || 'Không thể xử lý bức ảnh này.'));
        }
      };
      w.onerror = () => {
        workerSupported = false;
      };
      slots.push(slot);
    }
    workerSupported = true;
    workerPool = slots;
    return slots;
  } catch {
    workerSupported = false;
    return null;
  }
}

function acquireWorkerSlot(pool: PoolSlot[]): Promise<PoolSlot> {
  const free = pool.find((s) => !s.busy);
  if (free) {
    free.busy = true;
    return Promise.resolve(free);
  }
  return new Promise((resolve) => {
    waitQueue.push(resolve);
  });
}

async function processPhotoMainThreadFallback(
  item: DriveMediaItem,
  format: ImageExportFormat,
  quality: number,
  maxDimension: ExportMaxDimension,
  signal?: AbortSignal
): Promise<Blob> {
  let objectUrl = item.downloadUrl;
  let revokeAfterUse = false;

  if (item.rawFile) {
    objectUrl = URL.createObjectURL(item.rawFile);
    revokeAfterUse = true;
  } else if (
    !item.downloadUrl.startsWith('data:') &&
    !item.downloadUrl.startsWith('blob:')
  ) {
    const response = await fetch(attachAuthToStreamUrl(item.downloadUrl), {
      signal,
    });
    if (!response.ok) {
      throw new Error(
        'Không thể tải dữ liệu ảnh gốc chất lượng cao. Vui lòng thử lại.'
      );
    }
    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);
    revokeAfterUse = true;
  }

  try {
    const img = await loadImageElement(objectUrl);
    if (signal?.aborted) {
      throw new DOMException('Đã hủy xuất file', 'AbortError');
    }

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const geom = computeFrameGeometry(srcW, srcH, item.edit, maxDimension);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = geom.outW;
    outCanvas.height = geom.outH;

    const ctx = outCanvas.getContext('2d');
    if (!ctx) throw new Error('Không thể khởi tạo Canvas xuất ảnh.');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (format === 'image/jpeg') {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, geom.outW, geom.outH);
    }

    ctx.save();
    ctx.filter = buildCssFilterString(item.edit);
    ctx.scale(geom.scale, geom.scale);
    ctx.translate(geom.rotW / 2 - geom.cropX, geom.rotH / 2 - geom.cropY);
    if (item.edit.rotation !== 0) {
      ctx.rotate((item.edit.rotation * Math.PI) / 180);
    }
    ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
    ctx.restore();

    const warmthTint = computeWarmthTint(item.edit.warmth);
    if (warmthTint) {
      ctx.save();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(${warmthTint.rgb}, ${warmthTint.alpha})`;
      ctx.fillRect(0, 0, geom.outW, geom.outH);
      ctx.restore();
    }

    const activeLogos = getActiveLogos(item.edit);
    if (activeLogos.length > 0) {
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      for (const layer of activeLogos) {
        const logoImg = await getCachedLogoImage(layer.dataUrl);
        const placement = computeSmartLogoPlacement(
          geom.outW,
          geom.outH,
          layer
        );
        ctx.save();
        ctx.globalAlpha = Math.max(0.1, Math.min(1, layer.opacity / 100));
        ctx.drawImage(
          logoImg,
          placement.x,
          placement.y,
          placement.width,
          placement.height
        );
        ctx.restore();
      }
    }

    const outputBlob = await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error('Không thể đóng gói file ảnh.')),
        format,
        format === 'image/png' ? undefined : quality
      );
    });

    outCanvas.width = 0;
    outCanvas.height = 0;
    return outputBlob;
  } finally {
    if (revokeAfterUse) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Renders an edited/multi-logo photo into an output Blob using the 4-thread
 * OffscreenCanvas Worker Pool (keeping UI at 60fps), falling back cleanly if unavailable.
 */
export async function processPhotoToBlob(
  item: DriveMediaItem,
  format: ImageExportFormat = 'image/jpeg',
  quality: number = 0.92,
  maxDimension: ExportMaxDimension = 0,
  signal?: AbortSignal
): Promise<Blob> {
  if (signal?.aborted) {
    throw new DOMException('Đã hủy xuất file', 'AbortError');
  }

  const pool = ensureWorkerPool();
  if (!pool) {
    return processPhotoMainThreadFallback(
      item,
      format,
      quality,
      maxDimension,
      signal
    );
  }

  let sourceBlob: Blob | undefined = item.rawFile;
  let resolvedUrl: string | undefined;

  if (!sourceBlob) {
    if (item.downloadUrl.startsWith('blob:')) {
      const r = await fetch(item.downloadUrl, { signal });
      sourceBlob = await r.blob();
    } else {
      resolvedUrl = new URL(
        attachAuthToStreamUrl(item.downloadUrl),
        window.location.origin
      ).href;
    }
  }

  const slot = await acquireWorkerSlot(pool);
  if (signal?.aborted) {
    const nextWaiter = waitQueue.shift();
    if (nextWaiter) nextWaiter(slot);
    else slot.busy = false;
    throw new DOMException('Đã hủy xuất file', 'AbortError');
  }

  const jobId = nextJobId++;
  const req: WorkerRenderRequest = {
    jobId,
    sourceBlob,
    downloadUrl: resolvedUrl,
    edit: item.edit,
    format,
    quality,
    maxDimension,
  };

  return new Promise<Blob>((resolve, reject) => {
    pendingJobs.set(jobId, { resolve, reject, slot });
    slot.worker.postMessage(req);
  });
}
