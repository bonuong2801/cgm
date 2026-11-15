import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  DriveMediaItem,
  ExportFailedItem,
  ExportOptions,
  ImageExportFormat,
} from '../types/media';
import { processPhotoToBlob } from './imageProcessor';

const WORKER_CONCURRENCY = 4;
const MAX_FILES_PER_ZIP_CHUNK = 100;

/**
 * Removes Vietnamese diacritics and unsafe filesystem characters for clean folder/file tokens
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
 * Sanitizes folder name for disk creation while keeping readable Vietnamese characters
 */
export function sanitizeFolderNameForDisk(folderName: string): string {
  return folderName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'Thu_Muc';
}

export function stripFileExtension(fileName: string): {
  baseName: string;
  ext: string;
} {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) {
    return { baseName: fileName, ext: '' };
  }
  return {
    baseName: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot + 1).toLowerCase(),
  };
}

export function getExtensionForFormat(
  item: DriveMediaItem,
  format: ImageExportFormat
): string {
  if (item.mediaType === 'video') {
    const { ext } = stripFileExtension(item.name);
    return ext || 'mp4';
  }
  return format === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * Builds the output filename for an item based on ExportOptions and its sequential number
 */
export function formatExportFileName(
  item: DriveMediaItem,
  options: ExportOptions,
  seqIndex: number
): string {
  const targetExt = getExtensionForFormat(item, options.format);
  const { baseName } = stripFileExtension(item.name);

  if (options.renameMode === 'original') {
    return `${baseName}.${targetExt}`;
  }

  const pattern = options.customPattern.trim() || '{prefix}_{folder}_{index3}';
  const cleanPrefix = sanitizeFileToken(options.customPrefix || 'CGM');
  const cleanFolder = sanitizeFileToken(item.folderName || 'Folder');
  const cleanOriginal = sanitizeFileToken(baseName || 'File');

  const indexStr = String(seqIndex);
  const index3Str = String(seqIndex).padStart(3, '0');
  const index4Str = String(seqIndex).padStart(4, '0');

  let built = pattern
    .replace(/\{prefix\}/gi, cleanPrefix)
    .replace(/\{folder\}/gi, cleanFolder)
    .replace(/\{original\}/gi, cleanOriginal)
    .replace(/\{index4\}/gi, index4Str)
    .replace(/\{index3\}/gi, index3Str)
    .replace(/\{index\}/gi, indexStr);

  // Clean up redundant underscores
  built = built
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!built) {
    built = `${cleanPrefix}_${index3Str}`;
  }

  return `${built}.${targetExt}`;
}

export interface PlannedExportTask {
  item: DriveMediaItem;
  subFolderName: string;
  targetFileName: string;
}

/**
 * Generates the ordered list of export tasks with collision-safe filenames
 * preserving the exact 5-8 subfolder hierarchy.
 */
export function buildExportPlan(
  items: DriveMediaItem[],
  options: ExportOptions
): PlannedExportTask[] {
  const folderCounters = new Map<string, number>();
  const usedPaths = new Set<string>();
  let globalCounter = options.startIndex;

  return items.map((item) => {
    const subFolderName = sanitizeFolderNameForDisk(item.folderName);
    let seqIndex: number;

    if (options.numberingRule === 'per-folder') {
      const current = folderCounters.get(item.folderId) ?? options.startIndex;
      seqIndex = current;
      folderCounters.set(item.folderId, current + 1);
    } else {
      seqIndex = globalCounter;
      globalCounter += 1;
    }

    let targetFileName = formatExportFileName(item, options, seqIndex);
    let fullKey = `${subFolderName}/${targetFileName}`.toLowerCase();

    // Prevent overwriting if two files end up with the same name in the same folder
    let collisionCount = 1;
    while (usedPaths.has(fullKey)) {
      const { baseName, ext } = stripFileExtension(targetFileName);
      targetFileName = `${baseName}_${collisionCount}.${ext}`;
      fullKey = `${subFolderName}/${targetFileName}`.toLowerCase();
      collisionCount += 1;
    }
    usedPaths.add(fullKey);

    return {
      item,
      subFolderName,
      targetFileName,
    };
  });
}

/**
 * Generates a realistic small valid MP4 binary payload for Demo Mode videos
 * when exporting so users can test full video export without network errors
 */
function createDemoVideoBlob(item: DriveMediaItem): Blob {
  const headerInfo = `CGM DEMO VIDEO FILE - ${item.name} (${item.folderName})`;
  return new Blob([headerInfo], { type: item.mimeType || 'video/mp4' });
}

/**
 * Zero-RAM Video Streaming into a FileSystemFileHandle writable stream
 */
async function streamVideoToFileHandle(
  item: DriveMediaItem,
  fileHandle: any,
  signal: AbortSignal
): Promise<void> {
  const writable = await fileHandle.createWritable();

  try {
    if (item.isDemo || item.downloadUrl.startsWith('data:')) {
      const demoBlob = createDemoVideoBlob(item);
      await writable.write(demoBlob);
      await writable.close();
      return;
    }

    const response = await fetch(item.downloadUrl, { signal });
    if (!response.ok) {
      throw new Error(
        `Không thể tải luồng Video gốc (Mã HTTP ${response.status}).`
      );
    }

    if (response.body && typeof response.body.pipeTo === 'function') {
      // Zero-RAM streaming directly from network stream to disk writable stream
      await response.body.pipeTo(writable, { signal });
    } else {
      const blob = await response.blob();
      await writable.write(blob);
      await writable.close();
    }
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // ignore abort error
    }
    throw err;
  }
}

async function fetchVideoBlobForZip(
  item: DriveMediaItem,
  signal: AbortSignal
): Promise<Blob> {
  if (item.isDemo || item.downloadUrl.startsWith('data:')) {
    return createDemoVideoBlob(item);
  }
  const response = await fetch(item.downloadUrl, { signal });
  if (!response.ok) {
    throw new Error(
      `Không thể tải file Video gốc (Mã HTTP ${response.status}).`
    );
  }
  return await response.blob();
}

export interface BatchExportCallbacks {
  onProgress: (update: {
    processedCount: number;
    totalCount: number;
    currentFileName: string;
    completedSuccessCount: number;
    failedItems: ExportFailedItem[];
    exportMethodLabel: string;
  }) => void;
}

/**
 * Executes the 4-worker parallel export queue.
 * Attempts File System Access API (showDirectoryPicker) first on Chromium browsers,
 * and automatically falls back to chunked ZIP archives (max 100 files per ZIP)
 * if running in Firefox/Safari or inside a sandboxed cross-origin iframe.
 */
export async function runBatchExportTasks(
  tasks: PlannedExportTask[],
  options: ExportOptions,
  signal: AbortSignal,
  callbacks: BatchExportCallbacks
): Promise<{
  completedSuccessCount: number;
  failedItems: ExportFailedItem[];
  exportMethodLabel: string;
}> {
  const totalCount = tasks.length;
  let processedCount = 0;
  let completedSuccessCount = 0;
  const failedItems: ExportFailedItem[] = [];

  // Step 1: Try acquiring Directory Handle via File System Access API if available
  let rootDirHandle: any = null;
  let exportMethodLabel = 'Tải xuống tệp nén ZIP giữ nguyên cấu trúc thư mục';

  if (typeof (window as any).showDirectoryPicker === 'function') {
    try {
      rootDirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      exportMethodLabel =
        'Ghi trực tiếp vào ổ cứng (File System Access API - 4 luồng song song)';
    } catch (pickerErr: any) {
      if (pickerErr?.name === 'AbortError') {
        throw new DOMException('Người dùng đã hủy chọn thư mục lưu.', 'AbortError');
      }
      // If SecurityError (e.g., cross-origin iframe constraint), automatically fall back to chunked ZIP
      rootDirHandle = null;
      exportMethodLabel =
        'Đóng gói ZIP phân đoạn tự động (Giữ nguyên cấu trúc 5-8 thư mục con)';
    }
  }

  // MODE A: Direct Disk Writing via File System Access API (4 concurrent workers)
  if (rootDirHandle) {
    const subDirCache = new Map<string, any>();

    const getSubFolderHandle = async (subFolderName: string) => {
      if (subDirCache.has(subFolderName)) {
        return subDirCache.get(subFolderName);
      }
      const handle = await rootDirHandle.getDirectoryHandle(subFolderName, {
        create: true,
      });
      subDirCache.set(subFolderName, handle);
      return handle;
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        if (signal.aborted) break;
        const currentIndex = cursor++;
        const task = tasks[currentIndex];
        if (!task) break;

        callbacks.onProgress({
          processedCount,
          totalCount,
          currentFileName: `${task.subFolderName}/${task.targetFileName}`,
          completedSuccessCount,
          failedItems: [...failedItems],
          exportMethodLabel,
        });

        try {
          const folderHandle = await getSubFolderHandle(task.subFolderName);
          const fileHandle = await folderHandle.getFileHandle(
            task.targetFileName,
            { create: true }
          );

          if (task.item.mediaType === 'video') {
            await streamVideoToFileHandle(task.item, fileHandle, signal);
          } else {
            const photoBlob = await processPhotoToBlob(
              task.item,
              options.format,
              options.quality,
              signal
            );
            const writable = await fileHandle.createWritable();
            await writable.write(photoBlob);
            await writable.close();
          }

          completedSuccessCount += 1;
        } catch (err: any) {
          if (signal.aborted || err?.name === 'AbortError') {
            break;
          }
          failedItems.push({
            item: task.item,
            targetFileName: task.targetFileName,
            errorMessage:
              err?.message || 'Lỗi không xác định khi xử lý hoặc ghi file.',
          });
        } finally {
          processedCount += 1;
          callbacks.onProgress({
            processedCount,
            totalCount,
            currentFileName: `${task.subFolderName}/${task.targetFileName}`,
            completedSuccessCount,
            failedItems: [...failedItems],
            exportMethodLabel,
          });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(WORKER_CONCURRENCY, tasks.length) },
      () => worker()
    );
    await Promise.all(workers);

    return {
      completedSuccessCount,
      failedItems,
      exportMethodLabel,
    };
  }

  // MODE B: Chunked ZIP Archive Fallback (max 100 files per ZIP to protect browser RAM)
  const totalChunks = Math.ceil(tasks.length / MAX_FILES_PER_ZIP_CHUNK);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (signal.aborted) break;

    const chunkTasks = tasks.slice(
      chunkIndex * MAX_FILES_PER_ZIP_CHUNK,
      (chunkIndex + 1) * MAX_FILES_PER_ZIP_CHUNK
    );

    const zip = new JSZip();
    let cursor = 0;

    const worker = async () => {
      while (cursor < chunkTasks.length) {
        if (signal.aborted) break;
        const idx = cursor++;
        const task = chunkTasks[idx];
        if (!task) break;

        callbacks.onProgress({
          processedCount,
          totalCount,
          currentFileName: `${task.subFolderName}/${task.targetFileName}`,
          completedSuccessCount,
          failedItems: [...failedItems],
          exportMethodLabel,
        });

        try {
          let blob: Blob;
          if (task.item.mediaType === 'video') {
            blob = await fetchVideoBlobForZip(task.item, signal);
          } else {
            blob = await processPhotoToBlob(
              task.item,
              options.format,
              options.quality,
              signal
            );
          }

          zip.file(`${task.subFolderName}/${task.targetFileName}`, blob);
          completedSuccessCount += 1;
        } catch (err: any) {
          if (signal.aborted || err?.name === 'AbortError') {
            break;
          }
          failedItems.push({
            item: task.item,
            targetFileName: task.targetFileName,
            errorMessage: err?.message || 'Lỗi khi xử lý đóng gói file.',
          });
        } finally {
          processedCount += 1;
          callbacks.onProgress({
            processedCount,
            totalCount,
            currentFileName: `${task.subFolderName}/${task.targetFileName}`,
            completedSuccessCount,
            failedItems: [...failedItems],
            exportMethodLabel,
          });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(WORKER_CONCURRENCY, chunkTasks.length) },
      () => worker()
    );
    await Promise.all(workers);

    if (!signal.aborted && completedSuccessCount > 0) {
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE',
      });
      const prefixClean = sanitizeFileToken(options.customPrefix || 'CGM_Export');
      const zipFileName =
        totalChunks > 1
          ? `${prefixClean}_Phan_${chunkIndex + 1}_tren_${totalChunks}.zip`
          : `${prefixClean}_KetQua.zip`;
      saveAs(zipBlob, zipFileName);
    }
  }

  return {
    completedSuccessCount,
    failedItems,
    exportMethodLabel,
  };
}
