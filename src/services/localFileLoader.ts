import {
  DEFAULT_EDIT_CONFIG,
  cloneLogoLayers,
  type DriveFolder,
  type DriveMediaItem,
  type LogoLayer,
} from '../types/media.ts';
import {
  sanitizeFileToken,
  sanitizeFolderNameForDisk,
} from '../utils/mediaMath.ts';

export interface LocalImportResult {
  folders: DriveFolder[];
  items: DriveMediaItem[];
}

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'bmp',
  'gif',
  'svg',
  'avif',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);

function detectMediaTypeFromFile(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

/**
 * Revokes all local `blob:` ObjectURLs owned by media items so browser RAM is freed immediately.
 */
export function revokeMediaObjectUrls(items: DriveMediaItem[]): void {
  const revoked = new Set<string>();
  for (const item of items) {
    for (const url of [item.gridThumbUrl, item.previewUrl, item.downloadUrl]) {
      if (url && url.startsWith('blob:') && !revoked.has(url)) {
        revoked.add(url);
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    }
  }
}

/**
 * Recursively extracts all File objects from Drag & Drop DataTransferItemList,
 * preserving multi-level folder hierarchies.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<File[]> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files || []);
  }

  const collectedFiles: File[] = [];

  const readEntry = async (entry: any, pathPrefix = ''): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        entry.file(
          (f: File) => {
            if (pathPrefix && !(f as any).webkitRelativePath) {
              try {
                Object.defineProperty(f, 'webkitRelativePath', {
                  value: `${pathPrefix}/${f.name}`,
                  configurable: true,
                });
              } catch {
                // ignore
              }
            }
            resolve(f);
          },
          () => resolve(null)
        );
      });
      if (file) collectedFiles.push(file);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

      const readAllEntries = async (): Promise<any[]> => {
        const all: any[] = [];
        while (true) {
          const batch: any[] = await new Promise((resolve) => {
            dirReader.readEntries(
              (entries: any[]) => resolve(entries || []),
              () => resolve([])
            );
          });
          if (batch.length === 0) break;
          all.push(...batch);
        }
        return all;
      };

      const children = await readAllEntries();
      for (const child of children) {
        await readEntry(child, nextPrefix);
      }
    }
  };

  const entries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof (item as any).webkitGetAsEntry === 'function') {
      const entry = (item as any).webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
  }

  if (entries.length > 0) {
    await Promise.all(entries.map((entry) => readEntry(entry, '')));
    if (collectedFiles.length > 0) {
      return collectedFiles;
    }
  }

  return Array.from(dataTransfer.files || []);
}

/**
 * Extracts multi-level relative folder path from `webkitRelativePath` without flattening nested dirs
 * or colliding accented Vietnamese folder names.
 */
export function resolveRelativeFolderPath(relPath?: string): {
  folderId: string;
  folderName: string;
} {
  if (!relPath || !relPath.includes('/')) {
    return {
      folderId: 'local_folder_anh_tai_tu_may_tinh',
      folderName: 'Ảnh tải từ máy tính',
    };
  }

  const segments = relPath.split('/').filter(Boolean);
  // Drop trailing filename; if >=3 segments (Root/Sub1/File), drop top root only when subfolders exist
  const dirSegments = segments.slice(0, -1);
  const meaningfulDirs =
    dirSegments.length >= 2 ? dirSegments.slice(1) : dirSegments;
  const folderName = sanitizeFolderNameForDisk(meaningfulDirs.join('/'));
  const token =
    meaningfulDirs.map((s) => sanitizeFileToken(s) || 'dir').join('__') ||
    'default';

  return {
    folderId: `local_folder_${token.toLowerCase()}`,
    folderName,
  };
}

/**
 * Generates compact 480px JPEG thumbnails asynchronously in background batches
 * so scrolling 1,000 local 24MP photos uses ~25MB GPU RAM instead of 3GB+.
 */
export function generateCompactThumbnailsInBackground(
  items: DriveMediaItem[],
  onBatchReady: (
    updates: Array<{
      id: string;
      thumbUrl: string;
      width: number;
      height: number;
    }>
  ) => void
): () => void {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return () => {};
  }

  let cancelled = false;
  const targets = items.filter(
    (i) => i.mediaType === 'image' && i.rawFile && !i.rawFile.type.includes('svg')
  );

  (async () => {
    const BATCH_SIZE = 12;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      if (cancelled) return;
      const slice = targets.slice(i, i + BATCH_SIZE);
      const batchUpdates: Array<{
        id: string;
        thumbUrl: string;
        width: number;
        height: number;
      }> = [];

      await Promise.all(
        slice.map(async (item) => {
          if (cancelled || !item.rawFile) return;
          try {
            // Decode once to inspect true natural dimensions, then draw downscaled to 480px
            const fullBmp = await createImageBitmap(item.rawFile);
            const natW = fullBmp.width;
            const natH = fullBmp.height;
            const scale = Math.min(1, 480 / Math.max(natW, natH));
            const tw = Math.max(1, Math.round(natW * scale));
            const th = Math.max(1, Math.round(natH * scale));

            const canvas = new OffscreenCanvas(tw, th);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(fullBmp, 0, 0, tw, th);
              fullBmp.close();
              const thumbBlob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: 0.8,
              });
              if (!cancelled) {
                batchUpdates.push({
                  id: item.id,
                  thumbUrl: URL.createObjectURL(thumbBlob),
                  width: natW,
                  height: natH,
                });
              }
            } else {
              fullBmp.close();
            }
          } catch {
            // Keep original ObjectURL if browser cannot decode format via ImageBitmap
          }
        })
      );

      if (!cancelled && batchUpdates.length > 0) {
        onBatchReady(batchUpdates);
      }
      // Yield to main thread frame budget
      await new Promise((r) => setTimeout(r, 16));
    }
  })();

  return () => {
    cancelled = true;
  };
}

/**
 * Instant Zero-Blocking Bulk Photo & Folder Importer
 */
export async function importFilesFromComputer(
  fileList: FileList | File[],
  existingGlobalLogos: LogoLayer[] = [],
  onProgress?: (msg: string) => void
): Promise<LocalImportResult> {
  const rawArray = Array.from(fileList);
  const validEntries: { file: File; mediaType: 'image' | 'video' }[] = [];

  for (const file of rawArray) {
    const mediaType = detectMediaTypeFromFile(file);
    if (mediaType) {
      validEntries.push({ file, mediaType });
    }
  }

  if (validEntries.length === 0) {
    throw new Error(
      'Không tìm thấy tệp hình ảnh (JPG, PNG, WebP...) hoặc video hợp lệ trong các file đã chọn.'
    );
  }

  onProgress?.(`Đang nạp hàng loạt ${validEntries.length} file từ máy tính...`);

  const folderMap = new Map<string, DriveFolder>();
  const items: DriveMediaItem[] = [];
  const batchTimestamp = Date.now();

  for (let i = 0; i < validEntries.length; i++) {
    const { file, mediaType } = validEntries[i];
    const isVideo = mediaType === 'video';
    const objectUrl = URL.createObjectURL(file);
    const relPath = (file as any).webkitRelativePath as string | undefined;
    const { folderId, folderName } = resolveRelativeFolderPath(relPath);

    if (!folderMap.has(folderId)) {
      folderMap.set(folderId, {
        id: folderId,
        name: folderName,
      });
    }

    items.push({
      id: `local_item_${batchTimestamp}_${i}`,
      name: file.name,
      folderId,
      folderName,
      mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      mediaType,
      gridThumbUrl: objectUrl,
      previewUrl: objectUrl,
      downloadUrl: objectUrl,
      width: isVideo ? 1920 : 1800,
      height: isVideo ? 1080 : 1200,
      status: 'kept',
      isLocal: true,
      rawFile: file,
      edit: {
        ...DEFAULT_EDIT_CONFIG,
        logos: isVideo ? [] : cloneLogoLayers(existingGlobalLogos),
      },
    });
  }

  return {
    folders: Array.from(folderMap.values()),
    items,
  };
}
