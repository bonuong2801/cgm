import {
  DEFAULT_EDIT_CONFIG,
  DriveFolder,
  DriveMediaItem,
  LogoConfig,
} from '../types/media';

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
 * Recursively extracts all File objects from Drag & Drop DataTransferItemList
 * (supports dragging and dropping both bulk image selections AND entire folders from Windows Explorer / macOS Finder)
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
 * Instant Zero-Blocking Bulk Photo & Folder Importer:
 * Converts hundreds or thousands of File objects from the user's computer into
 * DriveFolder[] and DriveMediaItem[] in milliseconds using ObjectURLs without
 * decoding full-resolution bitmaps upfront.
 * Dimensions are automatically updated lazily as thumbnails render or during Canvas export.
 */
export async function importFilesFromComputer(
  fileList: FileList | File[],
  existingGlobalLogo?: LogoConfig,
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

    // Determine subfolder name from webkitRelativePath if available
    const relPath = (file as any).webkitRelativePath as string | undefined;
    let folderName = 'Ảnh tải từ máy tính';
    if (relPath && relPath.includes('/')) {
      const segments = relPath.split('/').filter(Boolean);
      if (segments.length >= 2) {
        folderName = segments[segments.length - 2];
      }
    }

    const folderId = `local_folder_${folderName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')}`;

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
      edit: {
        ...DEFAULT_EDIT_CONFIG,
        logo: existingGlobalLogo
          ? { ...existingGlobalLogo }
          : { ...DEFAULT_EDIT_CONFIG.logo },
      },
    });
  }

  return {
    folders: Array.from(folderMap.values()),
    items,
  };
}
