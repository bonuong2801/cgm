import {
  isPhotoEdited,
  type DriveMediaItem,
  type ExportFailedItem,
  type ExportOptions,
  type ImageExportFormat,
} from '../types/media.ts';
import {
  sanitizeFileToken,
  sanitizeFolderNameForDisk,
} from '../utils/mediaMath.ts';
import { processPhotoToBlob } from './imageProcessor.ts';

function triggerNativeBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export { sanitizeFileToken, sanitizeFolderNameForDisk };

const WORKER_CONCURRENCY = 4;
const MAX_FILES_PER_ZIP_CHUNK = 100;

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

export function canBypassPhotoReencode(
  item: DriveMediaItem,
  options: ExportOptions
): boolean {
  if (item.mediaType !== 'image') return false;
  if (!options.skipReencodeIfUnedited) return false;
  if (options.maxDimension > 0) return false;
  if (isPhotoEdited(item.edit).hasAnyEdit) return false;

  const mime = item.mimeType.toLowerCase();
  if (options.format === 'image/jpeg') {
    return mime === 'image/jpeg' || mime === 'image/jpg';
  }
  return mime === options.format;
}

export function getExtensionForFormat(
  item: DriveMediaItem,
  options: ExportOptions
): string {
  if (item.mediaType === 'video') {
    const { ext } = stripFileExtension(item.name);
    return ext || 'mp4';
  }
  if (canBypassPhotoReencode(item, options)) {
    const { ext } = stripFileExtension(item.name);
    if (ext) return ext;
  }
  const fmt: ImageExportFormat = options.format;
  if (fmt === 'image/png') return 'png';
  if (fmt === 'image/webp') return 'webp';
  return 'jpg';
}

export function formatExportFileName(
  item: DriveMediaItem,
  options: ExportOptions,
  seqIndex: number
): string {
  const targetExt = getExtensionForFormat(item, options);
  const { baseName } = stripFileExtension(item.name);

  if (options.renameMode === 'original') {
    return `${baseName}.${targetExt}`;
  }

  const pattern = options.customPattern.trim() || '{prefix}_{folder}_{index3}';
  const cleanPrefix = sanitizeFileToken(options.customPrefix || 'CGM');
  const leafFolder = item.folderName.split('/').pop() || item.folderName || 'Folder';
  const cleanFolder = sanitizeFileToken(leafFolder);
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

async function streamRawItemToFileHandle(
  item: DriveMediaItem,
  fileHandle: any,
  signal: AbortSignal
): Promise<void> {
  const writable = await fileHandle.createWritable();

  try {
    if (item.rawFile) {
      await writable.write(item.rawFile);
      await writable.close();
      return;
    }

    const response = await fetch(item.downloadUrl, { signal });
    if (!response.ok) {
      throw new Error(
        `Không thể tải luồng dữ liệu gốc (Mã HTTP ${response.status}).`
      );
    }

    if (response.body && typeof response.body.pipeTo === 'function') {
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
      // ignore
    }
    throw err;
  }
}

async function fetchRawBlobForZip(
  item: DriveMediaItem,
  signal: AbortSignal
): Promise<Blob> {
  if (item.rawFile) return item.rawFile;
  const response = await fetch(item.downloadUrl, { signal });
  if (!response.ok) {
    throw new Error(`Không thể tải file gốc (Mã HTTP ${response.status}).`);
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

  let rootDirHandle: any = null;
  let exportMethodLabel = 'Tải xuống tệp nén ZIP giữ nguyên cấu trúc thư mục';

  if (typeof (window as any).showDirectoryPicker === 'function') {
    try {
      rootDirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      exportMethodLabel =
        'Ghi trực tiếp ổ cứng (OffscreenCanvas 4 Worker song song)';
    } catch (pickerErr: any) {
      if (pickerErr?.name === 'AbortError') {
        throw new DOMException(
          'Người dùng đã hủy chọn thư mục lưu.',
          'AbortError'
        );
      }
      rootDirHandle = null;
      exportMethodLabel =
        'Đóng gói ZIP phân đoạn tự động (Giữ nguyên cấu trúc thư mục con)';
    }
  }

  // MODE A: Direct Disk Writing via File System Access API (supports multi-level nested subfolders!)
  if (rootDirHandle) {
    const subDirCache = new Map<string, any>();

    const getNestedSubFolderHandle = async (subFolderPath: string) => {
      if (subDirCache.has(subFolderPath)) {
        return subDirCache.get(subFolderPath);
      }
      const segments = subFolderPath.split('/').filter(Boolean);
      let currentDir = rootDirHandle;
      let builtPath = '';
      for (const seg of segments) {
        builtPath = builtPath ? `${builtPath}/${seg}` : seg;
        if (subDirCache.has(builtPath)) {
          currentDir = subDirCache.get(builtPath);
        } else {
          currentDir = await currentDir.getDirectoryHandle(seg, {
            create: true,
          });
          subDirCache.set(builtPath, currentDir);
        }
      }
      return currentDir;
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
          const folderHandle = await getNestedSubFolderHandle(
            task.subFolderName
          );
          const fileHandle = await folderHandle.getFileHandle(
            task.targetFileName,
            { create: true }
          );

          if (
            task.item.mediaType === 'video' ||
            canBypassPhotoReencode(task.item, options)
          ) {
            await streamRawItemToFileHandle(task.item, fileHandle, signal);
          } else {
            const photoBlob = await processPhotoToBlob(
              task.item,
              options.format,
              options.quality,
              options.maxDimension,
              signal
            );
            const writable = await fileHandle.createWritable();
            await writable.write(photoBlob);
            await writable.close();
          }

          completedSuccessCount += 1;
        } catch (err: any) {
          if (signal.aborted || err?.name === 'AbortError') break;
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

    await Promise.all(
      Array.from(
        { length: Math.min(WORKER_CONCURRENCY, tasks.length) },
        () => worker()
      )
    );

    return { completedSuccessCount, failedItems, exportMethodLabel };
  }

  // MODE B: Chunked ZIP Archive Fallback (lazy-load JSZip only when needed)
  const { default: JSZip } = await import('jszip');
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
          if (
            task.item.mediaType === 'video' ||
            canBypassPhotoReencode(task.item, options)
          ) {
            blob = await fetchRawBlobForZip(task.item, signal);
          } else {
            blob = await processPhotoToBlob(
              task.item,
              options.format,
              options.quality,
              options.maxDimension,
              signal
            );
          }

          zip.file(`${task.subFolderName}/${task.targetFileName}`, blob);
          completedSuccessCount += 1;
        } catch (err: any) {
          if (signal.aborted || err?.name === 'AbortError') break;
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

    await Promise.all(
      Array.from(
        { length: Math.min(WORKER_CONCURRENCY, chunkTasks.length) },
        () => worker()
      )
    );

    if (!signal.aborted && completedSuccessCount > 0) {
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE',
      });
      const prefixClean = sanitizeFileToken(
        options.customPrefix || 'CGM_Export'
      );
      const zipFileName =
        totalChunks > 1
          ? `${prefixClean}_Phan_${chunkIndex + 1}_tren_${totalChunks}.zip`
          : `${prefixClean}_KetQua.zip`;
      triggerNativeBlobDownload(zipBlob, zipFileName);
    }
  }

  return { completedSuccessCount, failedItems, exportMethodLabel };
}
