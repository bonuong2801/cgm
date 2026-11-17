export type MediaType = 'image' | 'video';

export type CullingStatus = 'kept' | 'rejected';

export type StarRating = 0 | 1 | 2 | 3 | 4 | 5;

export type LogoAnchorPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type LogoPosition = LogoAnchorPosition | 'custom';

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Represents a single Logo layer composited onto a photo.
 * A photo can have multiple LogoLayers simultaneously (e.g., Organizer + Sponsor + Studio).
 */
export interface LogoLayer {
  id: string;
  enabled: boolean;
  dataUrl: string;
  fileName: string;
  naturalWidth: number;
  naturalHeight: number;
  position: LogoPosition;
  customXPercent: number; // 0 - 100 (center X% when position === 'custom')
  customYPercent: number; // 0 - 100 (center Y% when position === 'custom')
  scalePercent: number; // 4% - 50% of shorter edge
  marginPercent: number; // 0% - 20% of shorter edge
  opacity: number; // 10 - 100 (%)
}

/**
 * Saved preset in IndexedDB: stores an entire set of 1 or multiple LogoLayers
 * so event studios can re-apply a full multi-sponsor layout in 1 click.
 */
export interface LogoSetPreset {
  id: string;
  name: string;
  logos: LogoLayer[];
  createdAt: number;
}

export interface EditConfig {
  brightness: number; // 50 - 150, default 100
  contrast: number; // 50 - 150, default 100
  saturation: number; // 0 - 200, default 100
  warmth: number; // -50 (cool) to +50 (warm), default 0
  rotation: 0 | 90 | 180 | 270;
  aspectRatioLabel: string;
  aspectRatioValue: number | null;
  cropPercent: CropArea | null;
  croppedAreaPixels: CropArea | null;
  logos: LogoLayer[];
}

export interface DriveFolder {
  id: string;
  name: string;
  isRoot?: boolean;
}

export interface DriveMediaItem {
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  mimeType: string;
  mediaType: MediaType;
  gridThumbUrl: string;
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationMillis?: number;
  status: CullingStatus;
  rating: StarRating;
  aiReason?: string;
  isLocal?: boolean;
  rawFile?: File;
  edit: EditConfig;
}

export type MediaTypeFilter = 'all' | 'image' | 'video';
export type SortByOption =
  | 'name-asc'
  | 'name-desc'
  | 'rating-desc'
  | 'resolution-desc';
export type QuickFilterOption =
  | 'all'
  | 'edited'
  | 'unwatermarked'
  | 'rated'
  | 'ai-flagged';

export type RenameMode = 'original' | 'custom';
export type NumberingRule = 'per-folder' | 'continuous';
export type ExportScope = 'all-folders' | 'current-folder' | 'checked-only';
export type ImageExportFormat = 'image/jpeg' | 'image/webp' | 'image/png';
export type ImageQualityPreset = 0.8 | 0.92 | 1.0;
export type ExportMaxDimension = 0 | 3840 | 2048;

export interface ExportOptions {
  scope: ExportScope;
  includeVideos: boolean;
  format: ImageExportFormat;
  quality: ImageQualityPreset;
  maxDimension: ExportMaxDimension;
  skipReencodeIfUnedited: boolean;
  renameMode: RenameMode;
  customPattern: string;
  customPrefix: string;
  startIndex: number;
  numberingRule: NumberingRule;
}

export interface ExportFailedItem {
  item: DriveMediaItem;
  targetFileName: string;
  errorMessage: string;
}

export interface ExportProgressState {
  isRunning: boolean;
  processedCount: number;
  totalCount: number;
  currentFileName: string;
  failedItems: ExportFailedItem[];
  completedSuccessCount: number;
  exportMethodLabel: string;
}

export const AUTO_LOGO_ANCHOR_ORDER: LogoAnchorPosition[] = [
  'bottom-right',
  'top-left',
  'top-right',
  'bottom-left',
  'top-center',
  'bottom-center',
  'middle-left',
  'middle-right',
  'center',
];

export function createLogoLayer(
  partial: Pick<
    LogoLayer,
    'dataUrl' | 'fileName' | 'naturalWidth' | 'naturalHeight'
  > &
    Partial<LogoLayer>,
  existingCount = 0
): LogoLayer {
  const defaultAnchor =
    AUTO_LOGO_ANCHOR_ORDER[existingCount % AUTO_LOGO_ANCHOR_ORDER.length];
  return {
    id:
      partial.id ||
      `logo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    enabled: partial.enabled ?? true,
    dataUrl: partial.dataUrl,
    fileName: partial.fileName,
    naturalWidth: partial.naturalWidth,
    naturalHeight: partial.naturalHeight,
    position: partial.position ?? defaultAnchor,
    customXPercent: partial.customXPercent ?? 50,
    customYPercent: partial.customYPercent ?? 50,
    scalePercent: partial.scalePercent ?? 15,
    marginPercent: partial.marginPercent ?? 3.5,
    opacity: partial.opacity ?? 92,
  };
}

export function cloneLogoLayers(logos: LogoLayer[]): LogoLayer[] {
  return logos.map((l) => ({ ...l }));
}

export const DEFAULT_EDIT_CONFIG: EditConfig = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  rotation: 0,
  aspectRatioLabel: 'Tỷ lệ gốc',
  aspectRatioValue: null,
  cropPercent: null,
  croppedAreaPixels: null,
  logos: [],
};

export function getActiveLogos(edit: EditConfig): LogoLayer[] {
  return (edit.logos || []).filter((l) => Boolean(l.enabled && l.dataUrl));
}

export function isPhotoEdited(edit: EditConfig): {
  isCropped: boolean;
  isColorEdited: boolean;
  isWatermarked: boolean;
  activeLogoCount: number;
  hasAnyEdit: boolean;
} {
  const cp = edit.cropPercent;
  const hasMeaningfulCrop = Boolean(
    cp &&
      (cp.width < 99.8 || cp.height < 99.8 || cp.x > 0.1 || cp.y > 0.1)
  );
  const isCropped =
    hasMeaningfulCrop ||
    edit.croppedAreaPixels !== null ||
    edit.rotation !== 0;
  const isColorEdited =
    edit.brightness !== 100 ||
    edit.contrast !== 100 ||
    edit.saturation !== 100 ||
    edit.warmth !== 0;
  const activeLogoCount = getActiveLogos(edit).length;
  const isWatermarked = activeLogoCount > 0;

  return {
    isCropped,
    isColorEdited,
    isWatermarked,
    activeLogoCount,
    hasAnyEdit: isCropped || isColorEdited || isWatermarked,
  };
}
