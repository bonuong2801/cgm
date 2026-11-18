import {
  EditConfig,
  ExportMaxDimension,
  ImageExportFormat,
  getActiveLogos,
} from '../types/media.ts';
import {
  buildCssFilterString,
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
} from '../utils/mediaMath.ts';

export interface WorkerRenderRequest {
  jobId: number;
  sourceBlob?: Blob;
  downloadUrl?: string;
  edit: EditConfig;
  format: ImageExportFormat;
  quality: number;
  maxDimension: ExportMaxDimension;
}

export interface WorkerRenderResponse {
  jobId: number;
  ok: boolean;
  blob?: Blob;
  error?: string;
}

const logoBitmapCache = new Map<string, ImageBitmap>();

async function getLogoBitmap(dataUrl: string): Promise<ImageBitmap> {
  const cached = logoBitmapCache.get(dataUrl);
  if (cached) return cached;

  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  if (logoBitmapCache.size > 30) {
    const oldestKey = logoBitmapCache.keys().next().value;
    if (oldestKey) {
      logoBitmapCache.get(oldestKey)?.close();
      logoBitmapCache.delete(oldestKey);
    }
  }
  logoBitmapCache.set(dataUrl, bmp);
  return bmp;
}

async function renderJob(req: WorkerRenderRequest): Promise<Blob> {
  let rawBlob = req.sourceBlob;
  if (!rawBlob) {
    if (!req.downloadUrl) {
      throw new Error('Thiếu nguồn dữ liệu ảnh để xuất.');
    }
    const res = await fetch(req.downloadUrl);
    if (!res.ok) {
      throw new Error(
        'Không thể tải ảnh gốc chất lượng cao. Vui lòng kiểm tra kết nối mạng.'
      );
    }
    rawBlob = await res.blob();
  }

  const srcBmp = await createImageBitmap(rawBlob);
  try {
    const srcW = srcBmp.width;
    const srcH = srcBmp.height;
    const geom = computeFrameGeometry(srcW, srcH, req.edit, req.maxDimension);

    const canvas = new OffscreenCanvas(geom.outW, geom.outH);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không đủ bộ nhớ để xử lý bức ảnh này.');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (req.format === 'image/jpeg') {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, geom.outW, geom.outH);
    }

    // Single-pass Crop + Rotation + Resize without intermediate full-res canvas
    ctx.save();
    ctx.filter = buildCssFilterString(req.edit);
    ctx.scale(geom.scale, geom.scale);
    ctx.translate(geom.rotW / 2 - geom.cropX, geom.rotH / 2 - geom.cropY);
    if (req.edit.rotation !== 0) {
      ctx.rotate((req.edit.rotation * Math.PI) / 180);
    }
    ctx.drawImage(srcBmp, -srcW / 2, -srcH / 2, srcW, srcH);
    ctx.restore();

    // Natural Color Temperature (Warm / Cool) via GPU soft-light blend
    const warmthTint = computeWarmthTint(req.edit.warmth);
    if (warmthTint) {
      ctx.save();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(${warmthTint.rgb}, ${warmthTint.alpha})`;
      ctx.fillRect(0, 0, geom.outW, geom.outH);
      ctx.restore();
    }

    // Composite ALL active Logo Layers in exact stack order (unaffected by photo filters)
    const activeLogos = getActiveLogos(req.edit);
    if (activeLogos.length > 0) {
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';

      for (const layer of activeLogos) {
        const logoBmp = await getLogoBitmap(layer.dataUrl);
        const placement = computeSmartLogoPlacement(
          geom.outW,
          geom.outH,
          layer
        );
        ctx.save();
        ctx.globalAlpha = Math.max(0.1, Math.min(1, layer.opacity / 100));
        ctx.drawImage(
          logoBmp,
          placement.x,
          placement.y,
          placement.width,
          placement.height
        );
        ctx.restore();
      }
    }

    return await canvas.convertToBlob({
      type: req.format,
      quality: req.format === 'image/png' ? undefined : req.quality,
    });
  } finally {
    srcBmp.close();
  }
}

self.onmessage = async (event: MessageEvent<WorkerRenderRequest>) => {
  const req = event.data;
  try {
    const blob = await renderJob(req);
    const msg: WorkerRenderResponse = { jobId: req.jobId, ok: true, blob };
    self.postMessage(msg);
  } catch (err: any) {
    const msg: WorkerRenderResponse = {
      jobId: req.jobId,
      ok: false,
      error:
        err?.message ||
        'Không thể xử lý bức ảnh này. Vui lòng kiểm tra lại định dạng ảnh.',
    };
    self.postMessage(msg);
  }
};
