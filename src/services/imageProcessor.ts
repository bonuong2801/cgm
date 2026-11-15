import {
  DriveMediaItem,
  EditConfig,
  ImageExportFormat,
  LogoConfig,
} from '../types/media';

const logoImageCache = new Map<string, HTMLImageElement>();

/**
 * Loads an HTMLImageElement from an ObjectURL or DataURL safely
 */
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

async function getCachedLogoImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = logoImageCache.get(dataUrl);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }
  const img = await loadImageElement(dataUrl);
  logoImageCache.set(dataUrl, img);
  return img;
}

/**
 * Builds CSS filter string for both live DOM preview and Canvas 2D context
 */
export function buildCssFilterString(edit: EditConfig): string {
  const parts: string[] = [];
  if (edit.brightness !== 100) {
    parts.push(`brightness(${edit.brightness}%)`);
  }
  if (edit.contrast !== 100) {
    parts.push(`contrast(${edit.contrast}%)`);
  }
  if (edit.saturation !== 100) {
    parts.push(`saturate(${edit.saturation}%)`);
  }
  if (edit.warmth > 0) {
    parts.push(`sepia(${edit.warmth}%)`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Calculates Logo placement and dimensions using the Mandatory Proportional Sizing Formula:
 * Logo width is calculated relative to the SHORTER EDGE of the final cropped photo:
 * shortSide = Math.min(finalWidth, finalHeight)
 * so watermarks maintain identical visual weight across both landscape and portrait photos.
 */
export function computeSmartLogoPlacement(
  finalWidth: number,
  finalHeight: number,
  logo: LogoConfig
): { x: number; y: number; width: number; height: number } {
  const shortSide = Math.min(finalWidth, finalHeight);
  const logoAspect =
    logo.naturalWidth > 0 && logo.naturalHeight > 0
      ? logo.naturalWidth / logo.naturalHeight
      : 2.5;

  const targetLogoWidth = Math.max(12, (shortSide * logo.scalePercent) / 100);
  const targetLogoHeight = targetLogoWidth / logoAspect;
  const marginPx = (shortSide * logo.marginPercent) / 100;

  let x = marginPx;
  let y = marginPx;

  switch (logo.position) {
    case 'top-left':
      x = marginPx;
      y = marginPx;
      break;
    case 'top-right':
      x = finalWidth - targetLogoWidth - marginPx;
      y = marginPx;
      break;
    case 'bottom-left':
      x = marginPx;
      y = finalHeight - targetLogoHeight - marginPx;
      break;
    case 'bottom-right':
      x = finalWidth - targetLogoWidth - marginPx;
      y = finalHeight - targetLogoHeight - marginPx;
      break;
    case 'center':
      x = (finalWidth - targetLogoWidth) / 2;
      y = (finalHeight - targetLogoHeight) / 2;
      break;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(targetLogoWidth),
    height: Math.round(targetLogoHeight),
  };
}

/**
 * Fetches raw image binary as a Blob and creates a local ObjectURL
 * to prevent CORS Tainted Canvas errors. Falls back to previewUrl if needed.
 */
async function fetchImageAsObjectUrl(
  item: DriveMediaItem,
  signal?: AbortSignal
): Promise<{ objectUrl: string; revokeAfterUse: boolean }> {
  // If demo item or data URL, use directly
  if (
    item.downloadUrl.startsWith('data:') ||
    item.downloadUrl.startsWith('blob:')
  ) {
    return { objectUrl: item.downloadUrl, revokeAfterUse: false };
  }

  try {
    const response = await fetch(item.downloadUrl, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return {
      objectUrl: URL.createObjectURL(blob),
      revokeAfterUse: true,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    // Fallback to fetching previewUrl as blob
    const fallbackRes = await fetch(item.previewUrl, { signal });
    if (!fallbackRes.ok) {
      throw new Error(
        `Không thể tải dữ liệu ảnh gốc từ Google Drive (Mã lỗi ${fallbackRes.status}).`
      );
    }
    const blob = await fallbackRes.blob();
    return {
      objectUrl: URL.createObjectURL(blob),
      revokeAfterUse: true,
    };
  }
}

/**
 * Rotates an image onto an intermediate canvas so crop coordinates align cleanly
 */
function renderRotatedSourceCanvas(
  img: HTMLImageElement,
  rotation: 0 | 90 | 180 | 270
): HTMLCanvasElement {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const isPerpendicular = rotation === 90 || rotation === 270;
  const rotatedW = isPerpendicular ? srcH : srcW;
  const rotatedH = isPerpendicular ? srcW : srcH;

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rotatedW;
  rotCanvas.height = rotatedH;

  const rCtx = rotCanvas.getContext('2d');
  if (!rCtx) {
    throw new Error('Không thể khởi tạo bộ xử lý đồ họa Canvas 2D.');
  }

  rCtx.save();
  rCtx.translate(rotatedW / 2, rotatedH / 2);
  rCtx.rotate((rotation * Math.PI) / 180);
  rCtx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
  rCtx.restore();

  return rotCanvas;
}

/**
 * Mandatory Canvas Pipeline for Photos:
 * 1. Fetch raw image binary as a Blob and create a local ObjectURL to prevent CORS Tainted Canvas errors.
 * 2. Apply rotation and extract croppedAreaPixels / cropPercent onto an offscreen <canvas> sized to (finalWidth, finalHeight).
 * 3. Apply ctx.filter (brightness, contrast, saturation, sepia) and draw the photo.
 * 4. MANDATORY: Reset ctx.filter = 'none' before drawing the Logo so image color filters never distort the logo's true colors.
 * 5. Draw the Logo with ctx.globalAlpha = opacity, export via canvas.toBlob using the selected format/quality, and immediately call URL.revokeObjectURL.
 */
export async function processPhotoToBlob(
  item: DriveMediaItem,
  format: ImageExportFormat = 'image/jpeg',
  quality: number = 0.92,
  signal?: AbortSignal
): Promise<Blob> {
  const { objectUrl, revokeAfterUse } = await fetchImageAsObjectUrl(
    item,
    signal
  );

  try {
    const img = await loadImageElement(objectUrl);
    if (signal?.aborted) {
      throw new DOMException('Đã hủy xuất file', 'AbortError');
    }

    const edit = item.edit;
    const rotatedCanvas = renderRotatedSourceCanvas(img, edit.rotation);
    const rotW = rotatedCanvas.width;
    const rotH = rotatedCanvas.height;

    let cropX = 0;
    let cropY = 0;
    let finalWidth = rotW;
    let finalHeight = rotH;

    // Prefer resolution-independent cropPercent if available so even if previewUrl was 1600px
    // and full raw downloadUrl is 4000px, the exact cropped region scales accurately!
    if (edit.cropPercent) {
      cropX = Math.round((edit.cropPercent.x / 100) * rotW);
      cropY = Math.round((edit.cropPercent.y / 100) * rotH);
      finalWidth = Math.max(
        1,
        Math.round((edit.cropPercent.width / 100) * rotW)
      );
      finalHeight = Math.max(
        1,
        Math.round((edit.cropPercent.height / 100) * rotH)
      );
    } else if (edit.croppedAreaPixels) {
      cropX = Math.max(0, Math.round(edit.croppedAreaPixels.x));
      cropY = Math.max(0, Math.round(edit.croppedAreaPixels.y));
      finalWidth = Math.max(
        1,
        Math.min(rotW - cropX, Math.round(edit.croppedAreaPixels.width))
      );
      finalHeight = Math.max(
        1,
        Math.min(rotH - cropY, Math.round(edit.croppedAreaPixels.height))
      );
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = finalWidth;
    outCanvas.height = finalHeight;

    const ctx = outCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Không thể khởi tạo Canvas xuất ảnh.');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fill background for JPEG
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, finalWidth, finalHeight);
    }

    // Step 3: Apply color adjustments via ctx.filter and draw cropped region
    ctx.filter = buildCssFilterString(edit);
    ctx.drawImage(
      rotatedCanvas,
      cropX,
      cropY,
      finalWidth,
      finalHeight,
      0,
      0,
      finalWidth,
      finalHeight
    );

    // Step 4: MANDATORY - Reset ctx.filter = 'none' before drawing the Logo
    // so image color filters never distort the logo's true colors!
    ctx.filter = 'none';

    // Step 5: Draw Smart Logo Watermark if enabled
    if (edit.logo.enabled && edit.logo.dataUrl) {
      const logoImg = await getCachedLogoImage(edit.logo.dataUrl);
      const placement = computeSmartLogoPlacement(
        finalWidth,
        finalHeight,
        edit.logo
      );

      ctx.save();
      ctx.filter = 'none';
      ctx.globalAlpha = Math.max(0.1, Math.min(1, edit.logo.opacity / 100));
      ctx.drawImage(
        logoImg,
        placement.x,
        placement.y,
        placement.width,
        placement.height
      );
      ctx.restore();
    }

    const outputBlob = await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Không thể đóng gói file ảnh đầu ra.'));
        },
        format,
        quality
      );
    });

    // Clean up temporary canvas memory
    outCanvas.width = 0;
    outCanvas.height = 0;
    rotatedCanvas.width = 0;
    rotatedCanvas.height = 0;

    return outputBlob;
  } finally {
    if (revokeAfterUse) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
