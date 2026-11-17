import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FolderTree,
  Loader2,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import {
  DriveMediaItem,
  ExportFailedItem,
  ExportMaxDimension,
  ExportOptions,
  ExportProgressState,
  ImageExportFormat,
  ImageQualityPreset,
  NumberingRule,
  RenameMode,
} from '../types/media.ts';
import {
  PlannedExportTask,
  buildExportPlan,
  formatExportFileName,
  runBatchExportTasks,
  sanitizeFolderNameForDisk,
} from '../services/batchExporter.ts';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: DriveMediaItem[];
  checkedItemIds: Set<string>;
  selectedFolderId: string;
  selectedFolderName: string;
}

const RENAME_TOKENS: { token: string; label: string; desc: string }[] = [
  { token: '{prefix}', label: '{prefix}', desc: 'Tiền tố tùy chỉnh' },
  { token: '{folder}', label: '{folder}', desc: 'Tên thư mục con' },
  { token: '{original}', label: '{original}', desc: 'Tên file gốc' },
  { token: '{index}', label: '{index}', desc: 'Số thứ tự (1, 2...)' },
  { token: '{index3}', label: '{index3}', desc: 'Số 3 chữ số (001)' },
  { token: '{index4}', label: '{index4}', desc: 'Số 4 chữ số (0001)' },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  allItems,
  checkedItemIds,
  selectedFolderId,
  selectedFolderName,
}) => {
  const [options, setOptions] = useState<ExportOptions>({
    scope: 'all-folders',
    includeVideos: true,
    format: 'image/jpeg',
    quality: 0.92,
    maxDimension: 0,
    skipReencodeIfUnedited: true,
    renameMode: 'custom',
    customPattern: '{prefix}_{folder}_{index3}',
    customPrefix: 'CGM_SuKien',
    startIndex: 1,
    numberingRule: 'per-folder',
  });

  // Sync sensible default scope whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setOptions((prev) => ({
      ...prev,
      scope:
        checkedItemIds.size > 0
          ? 'checked-only'
          : selectedFolderId === 'ALL'
          ? 'all-folders'
          : 'current-folder',
    }));
  }, [isOpen, checkedItemIds.size, selectedFolderId]);

  const [progress, setProgress] = useState<ExportProgressState>({
    isRunning: false,
    processedCount: 0,
    totalCount: 0,
    currentFileName: '',
    failedItems: [],
    completedSuccessCount: 0,
    exportMethodLabel: '',
  });

  const [hasFinishedRun, setHasFinishedRun] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const eligibleItems = useMemo(() => {
    return allItems.filter((item) => {
      if (options.scope === 'checked-only') {
        return checkedItemIds.has(item.id);
      }
      if (item.status !== 'kept') return false;
      if (
        options.scope === 'current-folder' &&
        selectedFolderId !== 'ALL' &&
        item.folderId !== selectedFolderId
      ) {
        return false;
      }
      if (!options.includeVideos && item.mediaType === 'video') {
        return false;
      }
      return true;
    });
  }, [
    allItems,
    checkedItemIds,
    options.scope,
    options.includeVideos,
    selectedFolderId,
  ]);

  const keptPhotosCount = useMemo(
    () => eligibleItems.filter((i) => i.mediaType === 'image').length,
    [eligibleItems]
  );

  const keptVideosCount = useMemo(
    () => eligibleItems.filter((i) => i.mediaType === 'video').length,
    [eligibleItems]
  );

  const samplePreviewItem = useMemo<DriveMediaItem>(() => {
    if (eligibleItems.length > 0) return eligibleItems[0];
    return {
      id: 'sample',
      name: 'DSC_0142.JPG',
      folderId: 'f1',
      folderName: '01_Le_Khai_Mac',
      mimeType: 'image/jpeg',
      mediaType: 'image',
      gridThumbUrl: '',
      previewUrl: '',
      downloadUrl: '',
      width: 1800,
      height: 1200,
      status: 'kept',
      rating: 0,
      edit: { logos: [] } as any,
    };
  }, [eligibleItems]);

  const livePreviewFileName = useMemo(() => {
    return formatExportFileName(
      samplePreviewItem,
      options,
      options.startIndex
    );
  }, [samplePreviewItem, options]);

  if (!isOpen) return null;

  const handleAppendToken = (token: string) => {
    setOptions((prev) => {
      const current = prev.customPattern.trim();
      const nextPattern = current ? `${current}_${token}` : token;
      return { ...prev, customPattern: nextPattern };
    });
  };

  const executeTasks = async (tasksToRun: PlannedExportTask[]) => {
    if (tasksToRun.length === 0) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setHasFinishedRun(false);

    setProgress({
      isRunning: true,
      processedCount: 0,
      totalCount: tasksToRun.length,
      currentFileName: tasksToRun[0]?.targetFileName || '',
      failedItems: [],
      completedSuccessCount: 0,
      exportMethodLabel: 'Đang khởi tạo 4 luồng OffscreenCanvas Worker...',
    });

    try {
      const result = await runBatchExportTasks(
        tasksToRun,
        options,
        controller.signal,
        {
          onProgress: (update) => {
            setProgress((prev) => ({
              ...prev,
              ...update,
            }));
          },
        }
      );

      setProgress((prev) => ({
        ...prev,
        isRunning: false,
        completedSuccessCount: result.completedSuccessCount,
        failedItems: result.failedItems,
        exportMethodLabel: result.exportMethodLabel,
      }));
      setHasFinishedRun(true);
    } catch (err: any) {
      setProgress((prev) => ({
        ...prev,
        isRunning: false,
        exportMethodLabel:
          err?.name === 'AbortError'
            ? 'Đã hủy tiến trình xuất file.'
            : err?.message || 'Đã dừng xuất file.',
      }));
      setHasFinishedRun(true);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleStartBatchExport = () => {
    const plan = buildExportPlan(eligibleItems, options);
    executeTasks(plan);
  };

  const handleRetryFailedItems = () => {
    const retryTasks: PlannedExportTask[] = progress.failedItems.map((f) => ({
      item: f.item,
      subFolderName: sanitizeFolderNameForDisk(f.item.folderName),
      targetFileName: f.targetFileName,
    }));
    executeTasks(retryTasks);
  };

  const handleCancelExport = () => {
    abortControllerRef.current?.abort();
  };

  const percentDone =
    progress.totalCount > 0
      ? Math.round((progress.processedCount / progress.totalCount) * 100)
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xuất hàng loạt ảnh và video"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 select-none"
      onClick={() => {
        if (!progress.isRunning) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FolderTree className="w-4 h-4 text-indigo-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-zinc-100">
              Xuất hàng loạt Ảnh (Ghép đa Logo) &amp; Video gốc
            </h2>
          </div>
          {!progress.isRunning && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng bảng xuất file"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. Export Scope */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 block">
              1. Phạm vi xuất dữ liệu
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={progress.isRunning}
                onClick={() =>
                  setOptions((p) => ({ ...p, scope: 'all-folders' }))
                }
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  options.scope === 'all-folders'
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60'
                }`}
              >
                <div className="text-xs font-semibold">Tất cả thư mục</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Giữ nguyên cây thư mục
                </div>
              </button>

              <button
                type="button"
                disabled={progress.isRunning || selectedFolderId === 'ALL'}
                onClick={() =>
                  setOptions((p) => ({ ...p, scope: 'current-folder' }))
                }
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                  options.scope === 'current-folder'
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60'
                }`}
              >
                <div className="text-xs font-semibold">Thư mục đang xem</div>
                <div className="text-[11px] text-zinc-400 mt-0.5 truncate">
                  {selectedFolderId === 'ALL'
                    ? 'Đang ở Tất cả'
                    : selectedFolderName}
                </div>
              </button>

              <button
                type="button"
                disabled={progress.isRunning || checkedItemIds.size === 0}
                onClick={() =>
                  setOptions((p) => ({ ...p, scope: 'checked-only' }))
                }
                className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                  options.scope === 'checked-only'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60'
                }`}
              >
                <div className="text-xs font-semibold">Ảnh đã tích chọn</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  {checkedItemIds.size > 0
                    ? `${checkedItemIds.size} ảnh đã chọn`
                    : 'Chưa tích chọn'}
                </div>
              </button>
            </div>
          </div>

          {/* 2. Video & Fast-Path Zero-Reencode Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                disabled={progress.isRunning}
                checked={options.includeVideos}
                onChange={(e) =>
                  setOptions((p) => ({
                    ...p,
                    includeVideos: e.target.checked,
                  }))
                }
                className="mt-0.5 accent-indigo-500 rounded cursor-pointer"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-200">
                  Xuất kèm Video gốc ({keptVideosCount} video)
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Truyền luồng Zero-RAM thẳng vào ổ cứng
                </div>
              </div>
            </label>

            <label className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                disabled={progress.isRunning}
                checked={options.skipReencodeIfUnedited}
                onChange={(e) =>
                  setOptions((p) => ({
                    ...p,
                    skipReencodeIfUnedited: e.target.checked,
                  }))
                }
                className="mt-0.5 accent-emerald-500 rounded cursor-pointer"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Giữ byte gốc nếu không sửa</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Bảo toàn EXIF &amp; nhanh gấp 10 lần cho ảnh mộc
                </div>
              </div>
            </label>
          </div>

          {/* 3. Format, Quality & Max Dimension Resize */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                3. Định dạng ảnh
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { val: 'image/jpeg', label: 'JPG' },
                    { val: 'image/webp', label: 'WebP' },
                    { val: 'image/png', label: 'PNG' },
                  ] as { val: ImageExportFormat; label: string }[]
                ).map((fmt) => (
                  <button
                    key={fmt.val}
                    type="button"
                    disabled={progress.isRunning}
                    onClick={() =>
                      setOptions((p) => ({ ...p, format: fmt.val }))
                    }
                    className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      options.format === fmt.val
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                Kích thước xuất (Resize)
              </label>
              <select
                disabled={progress.isRunning}
                value={options.maxDimension}
                onChange={(e) =>
                  setOptions((p) => ({
                    ...p,
                    maxDimension: Number(e.target.value) as ExportMaxDimension,
                  }))
                }
                className="w-full py-2 px-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={0}>Độ phân giải gốc (100%)</option>
                <option value={3840}>Chuẩn In / 4K (3840px)</option>
                <option value={2048}>Chuẩn MXH / Web (2048px)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                Chất lượng nén
              </label>
              <select
                disabled={progress.isRunning || options.format === 'image/png'}
                value={options.quality}
                onChange={(e) =>
                  setOptions((p) => ({
                    ...p,
                    quality: Number(e.target.value) as ImageQualityPreset,
                  }))
                }
                className="w-full py-2 px-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
              >
                <option value={0.8}>Tiết kiệm (80%)</option>
                <option value={0.92}>Tiêu chuẩn (92%)</option>
                <option value={1.0}>Tối đa (100%)</option>
              </select>
            </div>
          </div>

          {/* 4. Customizable Batch File Renaming */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <label className="text-xs font-semibold text-zinc-300 block">
              4. Đổi tên file hàng loạt
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  {
                    mode: 'original',
                    label: 'Giữ nguyên tên file gốc',
                  },
                  {
                    mode: 'custom',
                    label: 'Đổi tên hàng loạt theo mẫu tùy chỉnh',
                  },
                ] as { mode: RenameMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  disabled={progress.isRunning}
                  onClick={() =>
                    setOptions((p) => ({ ...p, renameMode: m.mode }))
                  }
                  className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-colors cursor-pointer ${
                    options.renameMode === m.mode
                      ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {options.renameMode === 'custom' && (
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 block">
                      Tiền tố tùy chỉnh ({'{prefix}'})
                    </label>
                    <input
                      type="text"
                      disabled={progress.isRunning}
                      value={options.customPrefix}
                      onChange={(e) =>
                        setOptions((p) => ({
                          ...p,
                          customPrefix: e.target.value,
                        }))
                      }
                      placeholder="VD: CGM_SuKien"
                      className="w-full px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 block">
                      Mẫu cấu trúc tên file
                    </label>
                    <input
                      type="text"
                      disabled={progress.isRunning}
                      value={options.customPattern}
                      onChange={(e) =>
                        setOptions((p) => ({
                          ...p,
                          customPattern: e.target.value,
                        }))
                      }
                      placeholder="{prefix}_{folder}_{index3}"
                      className="w-full px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] text-zinc-400 block">
                    Nhấp để chèn thẻ biến động:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {RENAME_TOKENS.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        disabled={progress.isRunning}
                        onClick={() => handleAppendToken(t.token)}
                        className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono text-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
                        title={t.desc}
                      >
                        <span>{t.label}</span>
                        <span className="font-sans text-zinc-500">
                          ({t.desc})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 block">
                      Số bắt đầu
                    </label>
                    <input
                      type="number"
                      min={0}
                      disabled={progress.isRunning}
                      value={options.startIndex}
                      onChange={(e) =>
                        setOptions((p) => ({
                          ...p,
                          startIndex: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 block">
                      Quy tắc đánh số thứ tự
                    </label>
                    <select
                      disabled={progress.isRunning}
                      value={options.numberingRule}
                      onChange={(e) =>
                        setOptions((p) => ({
                          ...p,
                          numberingRule: e.target.value as NumberingRule,
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="per-folder">
                        Đánh số lại theo từng thư mục
                      </option>
                      <option value="continuous">
                        Tăng liên tục toàn bộ
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="px-3.5 py-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-300 flex items-center gap-1.5 shrink-0">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span>Xem trước:</span>
              </span>
              <span className="text-xs font-mono text-indigo-200 font-semibold truncate">
                {sanitizeFolderNameForDisk(samplePreviewItem.folderName)}/
                {livePreviewFileName}
              </span>
            </div>
          </div>

          {/* 5. Progress & Retry */}
          {(progress.isRunning || hasFinishedRun) && (
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-200 flex items-center gap-2">
                  {progress.isRunning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span>Đang xử lý bằng 4 luồng Worker...</span>
                    </>
                  ) : progress.failedItems.length === 0 ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-300">
                        Hoàn tất xuất dữ liệu thành công!
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span className="text-amber-300">
                        Đã xử lý xong ({progress.failedItems.length} file lỗi)
                      </span>
                    </>
                  )}
                </span>

                <span className="font-mono tabular-nums text-zinc-300">
                  {progress.processedCount} / {progress.totalCount} file (
                  {percentDone}%)
                </span>
              </div>

              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-150"
                  style={{ width: `${percentDone}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 gap-2">
                <span className="truncate font-mono">
                  Đang xử lý: {progress.currentFileName || '---'}
                </span>
                <span className="shrink-0 text-zinc-500">
                  {progress.exportMethodLabel}
                </span>
              </div>

              {progress.failedItems.length > 0 && !progress.isRunning && (
                <div className="pt-2 border-t border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-rose-400">
                      Danh sách file gặp lỗi ({progress.failedItems.length}):
                    </span>
                    <button
                      type="button"
                      onClick={handleRetryFailedItems}
                      className="px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Thử lại các file lỗi</span>
                    </button>
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono text-zinc-400 bg-zinc-900 p-2 rounded">
                    {progress.failedItems.map((f: ExportFailedItem, idx) => (
                      <div key={idx} className="truncate">
                        • {f.targetFileName}: {f.errorMessage}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between">
          <div className="text-xs text-zinc-400 font-mono tabular-nums">
            Tổng xuất: {keptPhotosCount} ảnh · {keptVideosCount} video
          </div>

          <div className="flex items-center gap-2.5">
            {progress.isRunning ? (
              <button
                type="button"
                onClick={handleCancelExport}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer"
              >
                Hủy xuất
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={eligibleItems.length === 0}
                  onClick={handleStartBatchExport}
                  className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Bắt đầu xuất ({eligibleItems.length} file)</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
