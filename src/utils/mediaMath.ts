import type {
  CropArea,
  EditConfig,
  ExportMaxDimension,
  LogoLayer,
} from '../types/media.ts';

/**
 * Normalizes Vietnamese diacritics (including đ/Đ) into clean ASCII tokens
 * safe for both folder IDs and custom filename tokens without collisions.
 */
export function sanitizeFileToken(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Sanitizes a single or nested folder path (e.g. "Ngày 1 / Lễ Cưới") into
 * clean relative segments ("Ngày 1/Lễ Cưới") safe for disk & ZIP creation.
 */
export function sanitizeFolderNameForDisk(folderPath: string): string {
  const segments = folderPath
    .split(/[\\/]+/)
    .map((seg) => seg.replace(/[<>:"|?*\x00-\x1F]/g, '_').trim())
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..');

  return segments.length > 0 ? segments.join('/') : 'Thu_Muc';
}

/**
 * Builds CSS/Canvas2D filter string for brightness, contrast, and saturation.
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
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Computes natural color temperature tint (Warm amber > 0, Cool sky-blue < 0)
 * applied via `soft-light` blend mode in both CSS and OffscreenCanvas.
 */
export function computeWarmthTint(
  warmth: number
): { rgb: string; alpha: number } | null {
  if (!warmth) return null;
  const clamped = Math.max(-50, Math.min(50, warmth));
  const alpha = Number(((Math.abs(clamped) / 50) * 0.36).toFixed(3));
  if (alpha <= 0.005) return null;
  return {
    rgb: clamped > 0 ? '255, 146, 43' : '56, 152, 255',
    alpha,
  };
}

export interface FrameGeometry {
  rotW: number;
  rotH: number;
  cropPercent: CropArea;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  outW: number;
  outH: number;
  scale: number;
}

/**
 * Single source of truth for Rotation + Crop + MaxDimension geometry.
 * Ensures LiveEditedPhotoPreview (CSS) and Worker/Canvas export produce identical framing.
 */
export function computeFrameGeometry(
  srcW: number,
  srcH: number,
  edit: EditConfig,
  maxDimension: ExportMaxDimension = 0
): FrameGeometry {
  const safeSrcW = Math.max(1, srcW);
  const safeSrcH = Math.max(1, srcH);
  const isPerpendicular = edit.rotation === 90 || edit.rotation === 270;
  const rotW = isPerpendicular ? safeSrcH : safeSrcW;
  const rotH = isPerpendicular ? safeSrcW : safeSrcH;

  let cp: CropArea = { x: 0, y: 0, width: 100, height: 100 };
  if (edit.cropPercent) {
    const x = Math.max(0, Math.min(99, edit.cropPercent.x));
    const y = Math.max(0, Math.min(99, edit.cropPercent.y));
    const width = Math.max(1, Math.min(100 - x, edit.cropPercent.width));
    const height = Math.max(1, Math.min(100 - y, edit.cropPercent.height));
    cp = { x, y, width, height };
  } else if (edit.croppedAreaPixels) {
    const pxX = Math.max(0, Math.min(rotW - 1, edit.croppedAreaPixels.x));
    const pxY = Math.max(0, Math.min(rotH - 1, edit.croppedAreaPixels.y));
    const pxW = Math.max(1, Math.min(rotW - pxX, edit.croppedAreaPixels.width));
    const pxH = Math.max(
      1,
      Math.min(rotH - pxY, edit.croppedAreaPixels.height)
    );
    cp = {
      x: (pxX / rotW) * 100,
      y: (pxY / rotH) * 100,
      width: (pxW / rotW) * 100,
      height: (pxH / rotH) * 100,
    };
  }

  const cropX = Math.round((cp.x / 100) * rotW);
  const cropY = Math.round((cp.y / 100) * rotH);
  const cropW = Math.max(
    1,
    Math.min(rotW - cropX, Math.round((cp.width / 100) * rotW))
  );
  const cropH = Math.max(
    1,
    Math.min(rotH - cropY, Math.round((cp.height / 100) * rotH))
  );

  const longestEdge = Math.max(cropW, cropH);
  const scale =
    maxDimension > 0 && longestEdge > maxDimension
      ? maxDimension / longestEdge
      : 1;

  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  return {
    rotW,
    rotH,
    cropPercent: cp,
    cropX,
    cropY,
    cropW,
    cropH,
    outW,
    outH,
    scale,
  };
}

/**
 * Calculates exact Logo placement in pixel space (x, y, width, height) for BOTH
 * 9-anchor positions AND free-drag `custom` (center X% / Y%) positions.
 * Driven by shorter-edge proportional sizing so portrait & landscape photos look uniform.
 */
export function computeSmartLogoPlacement(
  finalWidth: number,
  finalHeight: number,
  logo: LogoLayer
): { x: number; y: number; width: number; height: number } {
  const safeW = Math.max(1, finalWidth);
  const safeH = Math.max(1, finalHeight);
  const shortSide = Math.min(safeW, safeH);
  const logoAspect =
    logo.naturalWidth > 0 && logo.naturalHeight > 0
      ? logo.naturalWidth / logo.naturalHeight
      : 2.5;

  const targetLogoWidth = Math.min(
    safeW,
    Math.max(8, (shortSide * logo.scalePercent) / 100)
  );
  const targetLogoHeight = Math.min(safeH, targetLogoWidth / logoAspect);
  const marginPx = (shortSide * logo.marginPercent) / 100;

  let x = marginPx;
  let y = marginPx;

  switch (logo.position) {
    case 'top-left':
      x = marginPx;
      y = marginPx;
      break;
    case 'top-center':
      x = (safeW - targetLogoWidth) / 2;
      y = marginPx;
      break;
    case 'top-right':
      x = safeW - targetLogoWidth - marginPx;
      y = marginPx;
      break;
    case 'middle-left':
      x = marginPx;
      y = (safeH - targetLogoHeight) / 2;
      break;
    case 'center':
      x = (safeW - targetLogoWidth) / 2;
      y = (safeH - targetLogoHeight) / 2;
      break;
    case 'middle-right':
      x = safeW - targetLogoWidth - marginPx;
      y = (safeH - targetLogoHeight) / 2;
      break;
    case 'bottom-left':
      x = marginPx;
      y = safeH - targetLogoHeight - marginPx;
      break;
    case 'bottom-center':
      x = (safeW - targetLogoWidth) / 2;
      y = safeH - targetLogoHeight - marginPx;
      break;
    case 'bottom-right':
      x = safeW - targetLogoWidth - marginPx;
      y = safeH - targetLogoHeight - marginPx;
      break;
    case 'custom': {
      const centerX = (logo.customXPercent / 100) * safeW;
      const centerY = (logo.customYPercent / 100) * safeH;
      x = centerX - targetLogoWidth / 2;
      y = centerY - targetLogoHeight / 2;
      break;
    }
  }

  x = Math.max(0, Math.min(safeW - targetLogoWidth, x));
  y = Math.max(0, Math.min(safeH - targetLogoHeight, y));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(targetLogoWidth)),
    height: Math.max(1, Math.round(targetLogoHeight)),
  };
}

/**
 * Builds stable, non-expiring Google Drive thumbnail URLs for grid and lightbox previews.
 */
export function buildStableDriveThumbnailUrls(fileId: string): {
  gridThumbUrl: string;
  previewUrl: string;
} {
  const encodedId = encodeURIComponent(fileId);
  return {
    gridThumbUrl: `https://drive.google.com/thumbnail?id=${encodedId}&sz=w800`,
    previewUrl: `https://drive.google.com/thumbnail?id=${encodedId}&sz=w2400`,
  };
}

/**
 * Resolves camera image/video dimensions with Drive EXIF rotation (90/270 deg swap).
 */
export function resolveOrientedMediaDimensions(
  rawWidth?: number,
  rawHeight?: number,
  exifRotation?: number
): { width: number; height: number } {
  const w = rawWidth && rawWidth > 0 ? rawWidth : 1600;
  const h = rawHeight && rawHeight > 0 ? rawHeight : 1067;
  if (exifRotation === 1 || exifRotation === 3) {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}

/**
 * Upgrades expired lh3 or undersized legacy Drive thumbnail URLs (e.g. from IndexedDB)
 * to stable non-expiring URLs while leaving local blob:/data: URLs untouched.
 */
export function normalizeDriveMediaUrls<
  T extends {
    id: string;
    isLocal?: boolean;
    gridThumbUrl: string;
    previewUrl: string;
  },
>(item: T): T {
  if (
    item.isLocal ||
    !item.id ||
    item.gridThumbUrl.startsWith('blob:') ||
    item.gridThumbUrl.startsWith('data:')
  ) {
    return item;
  }

  const needsUpgrade = (url: string, expectedSize: string): boolean =>
    !url ||
    url.includes('googleusercontent.com') ||
    (url.includes('drive.google.com/thumbnail') &&
      !url.includes(`sz=${expectedSize}`));

  if (
    needsUpgrade(item.gridThumbUrl, 'w800') ||
    needsUpgrade(item.previewUrl, 'w2400')
  ) {
    return {
      ...item,
      ...buildStableDriveThumbnailUrls(item.id),
    };
  }

  return item;
}

function dedupeTruthyUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Builds an ordered, deduplicated fallback chain for <img> rendering of Drive or local media.
 */
export function buildImageFallbackSources(params: {
  id: string;
  mediaType: 'image' | 'video';
  isLocal?: boolean;
  gridThumbUrl: string;
  previewUrl: string;
  streamUrl?: string;
  useHighRes: boolean;
}): string[] {
  if (params.isLocal) {
    return dedupeTruthyUrls([
      params.useHighRes ? params.previewUrl : params.gridThumbUrl,
      params.previewUrl,
      params.gridThumbUrl,
    ]);
  }

  const encodedId = encodeURIComponent(params.id);
  const lh3Direct = (size: string) =>
    `https://lh3.googleusercontent.com/d/${encodedId}=${size}`;
  const driveThumb = (size: string) =>
    `https://drive.google.com/thumbnail?id=${encodedId}&sz=${size}`;
  const imageStreamFallback =
    params.mediaType === 'image' ? params.streamUrl || '' : '';

  if (params.useHighRes) {
    return dedupeTruthyUrls([
      params.previewUrl,
      lh3Direct('w2400'),
      driveThumb('w1600'),
      imageStreamFallback,
      params.gridThumbUrl,
    ]);
  }

  return dedupeTruthyUrls([
    params.gridThumbUrl,
    lh3Direct('w800'),
    driveThumb('w480'),
    imageStreamFallback,
  ]);
}

/**
 * Decides whether a loaded <img>'s naturalWidth/naturalHeight should update stored item dimensions
 * without letting low-res grid thumbnails overwrite full camera metadata.
 */
export function resolveDetectedDimensions(
  currentW: number,
  currentH: number,
  natW: number,
  natH: number
): { width: number; height: number } | null {
  if (natW <= 0 || natH <= 0 || (currentW === natW && currentH === natH)) {
    return null;
  }

  if (
    (currentW === 1600 && currentH === 1067) ||
    (currentW === 1800 && currentH === 1200)
  ) {
    return { width: natW, height: natH };
  }

  if (natW * natH > currentW * currentH) {
    return { width: natW, height: natH };
  }

  const curRatio = currentW / Math.max(1, currentH);
  const natRatio = natW / Math.max(1, natH);
  const ratioDiff =
    Math.abs(curRatio - natRatio) / Math.max(curRatio, natRatio);
  if (ratioDiff <= 0.06) {
    return null;
  }

  const swappedRatio = currentH / Math.max(1, currentW);
  const swappedDiff =
    Math.abs(swappedRatio - natRatio) / Math.max(swappedRatio, natRatio);
  if (swappedDiff <= 0.06) {
    return { width: currentH, height: currentW };
  }

  return { width: natW, height: natH };
}
