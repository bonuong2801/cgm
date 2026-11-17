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
