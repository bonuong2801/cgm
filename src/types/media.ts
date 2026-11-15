export type MediaType = 'image' | 'video';

export type CullingStatus = 'kept' | 'rejected';

export type LogoPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export interface CropArea {
  x: number; // pixel x or percentage depending on context
  y: number;
  width: number;
  height: number;
}

export interface LogoConfig {
  enabled: boolean;
  dataUrl: string | null;
  fileName: string | null;
  naturalWidth: number;
  naturalHeight: number;
  position: LogoPosition;
  scalePercent: number; // 5% - 40% of shorter edge
  marginPercent: number; // 1% - 15% of shorter edge
  opacity: number; // 10 - 100 (%)
}

export interface EditConfig {
  brightness: number; // 50 - 150, default 100
  contrast: number; // 50 - 150, default 100
  saturation: number; // 0 - 200, default 100
  warmth: number; // 0 - 50, default 0 (sepia %)
  rotation: 0 | 90 | 180 | 270;
  aspectRatioLabel: string; // e.g. 'Tỷ lệ gốc', '1:1 (Vuông)', etc.
  aspectRatioValue: number | null; // null = original or free
  cropPercent: CropArea | null; // { x, y, width, height } in % (0..100) for fast CSS preview & resolution-independent export
  croppedAreaPixels: CropArea | null; // exact pixel coordinates from react-easy-crop
  logo: LogoConfig;
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
  edit: EditConfig;
  isDemo?: boolean;
}

export type MediaTypeFilter = 'all' | 'image' | 'video';

export type RenameMode = 'original' | 'custom';
export type NumberingRule = 'per-folder' | 'continuous';
export type ExportScope = 'all-folders' | 'current-folder';
export type ImageExportFormat = 'image/jpeg' | 'image/webp';
export type ImageQualityPreset = 0.8 | 0.92 | 1.0;

export interface ExportOptions {
  scope: ExportScope;
  includeVideos: boolean;
  format: ImageExportFormat;
  quality: ImageQualityPreset;
  renameMode: RenameMode;
  customPattern: string; // e.g. "{prefix}_{folder}_{index3}"
  customPrefix: string; // e.g. "CGM_SuKien"
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

export const DEFAULT_LOGO_CONFIG: LogoConfig = {
  enabled: false,
  dataUrl: null,
  fileName: null,
  naturalWidth: 0,
  naturalHeight: 0,
  position: 'bottom-right',
  scalePercent: 16,
  marginPercent: 4,
  opacity: 90,
};

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
  logo: { ...DEFAULT_LOGO_CONFIG },
};

export function isPhotoEdited(edit: EditConfig): {
  isCropped: boolean;
  isColorEdited: boolean;
  isWatermarked: boolean;
  hasAnyEdit: boolean;
} {
  const isCropped =
    edit.croppedAreaPixels !== null ||
    edit.cropPercent !== null ||
    edit.rotation !== 0;
  const isColorEdited =
    edit.brightness !== 100 ||
    edit.contrast !== 100 ||
    edit.saturation !== 100 ||
    edit.warmth !== 0;
  const isWatermarked = Boolean(edit.logo.enabled && edit.logo.dataUrl);

  return {
    isCropped,
    isColorEdited,
    isWatermarked,
    hasAnyEdit: isCropped || isColorEdited || isWatermarked,
  };
}
