import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  CheckSquare,
  Crop,
  FolderUp,
  ImagePlus,
  Maximize2,
  Play,
  RotateCcw,
  Search,
  Sliders,
  Square,
  Stamp,
  Star,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  type DriveMediaItem,
  type QuickFilterOption,
  type SortByOption,
  getActiveLogos,
  isPhotoEdited,
} from '../types/media.ts';
import {
  buildCssFilterString,
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
} from '../utils/mediaMath.ts';
import { extractFilesFromDataTransfer } from '../services/localFileLoader.ts';

interface VirtualMediaGridProps {
  items: DriveMediaItem[];
  selectedItemId: string | null;
  checkedItemIds: Set<string>;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  quickFilter: QuickFilterOption;
  onQuickFilterChange: (f: QuickFilterOption) => void;
  sortBy: SortByOption;
  onSortByChange: (s: SortByOption) => void;
  compareOriginal: boolean;
  onSelectItem: (item: DriveMediaItem) => void;
  onToggleCheckItem: (
    itemId: string,
    shiftKey: boolean,
    e: React.MouseEvent
  ) => void;
  onSelectAllVisiblePhotos: () => void;
  onClearCheckedItems: () => void;
  onOpenLightbox: (item: DriveMediaItem) => void;
  onToggleRejectStatus: (item: DriveMediaItem, e?: React.MouseEvent) => void;
  onUpdateDetectedDimensions?: (
    itemId: string,
    width: number,
    height: number
  ) => void;
  gridColumns: number;
  onFocusDriveInput: () => void;
  onImportLocalFiles: (files: FileList | File[]) => void;
  hasAnyLoadedItems: boolean;
}

export function formatVideoDuration(durationMillis?: number): string {
  if (!durationMillis || durationMillis <= 0) return '00:00';
  const totalSeconds = Math.floor(durationMillis / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Renders an exact 1:1 live preview of a photo including:
 * - Unified Rotation (0/90/180/270) + Resolution-Independent Crop framing
 * - CSS Color Filters + GPU Soft-Light Color Temperature (Warm/Cool)
 * - Multiple Composited Logo Layers (9-anchor + custom X%/Y% free drag!)
 * - Optional Before/After Original view (`showOriginal`)
 */
export const LiveEditedPhotoPreview: React.FC<{
  item: DriveMediaItem;
  useHighRes?: boolean;
  showOriginal?: boolean;
  activeLogoId?: string | null;
  onSelectLogoLayer?: (logoId: string) => void;
  onInteractiveMoveLogo?: (
    logoId: string,
    customXPercent: number,
    customYPercent: number
  ) => void;
  onDimensionsDetected?: (itemId: string, w: number, h: number) => void;
  className?: string;
  style?: React.CSSProperties;
}> = ({
  item,
  useHighRes = false,
  showOriginal = false,
  activeLogoId = null,
  onSelectLogoLayer,
  onInteractiveMoveLogo,
  onDimensionsDetected,
  className = '',
  style,
}) => {
  const primarySrc = useHighRes ? item.previewUrl : item.gridThumbUrl;
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  useEffect(() => {
    setFallbackSrc(null);
  }, [primarySrc]);
  const src = fallbackSrc || primarySrc;
  const { edit } = item;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draggingLogoId, setDraggingLogoId] = useState<string | null>(null);

  const geom = computeFrameGeometry(item.width, item.height, edit, 0);
  const cp = geom.cropPercent;
  const isPerpendicular = edit.rotation === 90 || edit.rotation === 270;

  const cssFilter = showOriginal ? 'none' : buildCssFilterString(edit);
  const warmthTint = showOriginal ? null : computeWarmthTint(edit.warmth);
  const activeLogos = showOriginal ? [] : getActiveLogos(edit);

  const handleImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const natW = e.currentTarget.naturalWidth;
    const natH = e.currentTarget.naturalHeight;
    if (
      onDimensionsDetected &&
      natW > 0 &&
      natH > 0 &&
      (natW !== item.width || natH !== item.height)
    ) {
      onDimensionsDetected(item.id, natW, natH);
    }
  };

  const handleLogoPointerDown = (
    logoId: string,
    e: React.PointerEvent<HTMLImageElement>
  ) => {
    if (!onInteractiveMoveLogo) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectLogoLayer?.(logoId);
    setDraggingLogoId(logoId);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleLogoPointerMove = (
    logoId: string,
    e: React.PointerEvent<HTMLImageElement>
  ) => {
    if (!onInteractiveMoveLogo || draggingLogoId !== logoId) return;
    const frameEl = containerRef.current;
    if (!frameEl) return;
    const rect = frameEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const xPct = Math.max(
      0,
      Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)
    );
    const yPct = Math.max(
      0,
      Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)
    );
    onInteractiveMoveLogo(
      logoId,
      Number(xPct.toFixed(2)),
      Number(yPct.toFixed(2))
    );
  };

  const handleLogoPointerUp = (
    logoId: string,
    e: React.PointerEvent<HTMLImageElement>
  ) => {
    if (draggingLogoId === logoId) {
      setDraggingLogoId(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-zinc-950 select-none ${className}`}
      style={{
        ...style,
        aspectRatio: `${geom.cropW} / ${geom.cropH}`,
      }}
    >
      {/* Unified Rotated + Cropped Sheet */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: `${(100 / Math.max(1, cp.width)) * 100}%`,
          height: `${(100 / Math.max(1, cp.height)) * 100}%`,
          left: `${-(cp.x / Math.max(1, cp.width)) * 100}%`,
          top: `${-(cp.y / Math.max(1, cp.height)) * 100}%`,
        }}
      >
        <img
          src={src}
          alt={item.name}
          referrerPolicy="no-referrer"
          loading={useHighRes ? 'eager' : 'lazy'}
          onLoad={handleImageLoaded}
          onError={() => {
            if (useHighRes && item.gridThumbUrl && src !== item.gridThumbUrl) {
              setFallbackSrc(item.gridThumbUrl);
            }
          }}
          className="max-w-none select-none pointer-events-none block"
          style={
            isPerpendicular
              ? {
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: `${(geom.rotH / Math.max(1, geom.rotW)) * 100}%`,
                  height: `${(geom.rotW / Math.max(1, geom.rotH)) * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${edit.rotation}deg)`,
                  filter: cssFilter,
                }
              : {
                  width: '100%',
                  height: '100%',
                  transform:
                    edit.rotation !== 0
                      ? `rotate(${edit.rotation}deg)`
                      : undefined,
                  filter: cssFilter,
                }
          }
        />
      </div>

      {/* Natural Color Temperature Tint (Warm / Cool) */}
      {warmthTint && (
        <div
          className="absolute inset-0 pointer-events-none z-5"
          style={{
            backgroundColor: `rgba(${warmthTint.rgb}, ${warmthTint.alpha})`,
            mixBlendMode: 'soft-light',
          }}
        />
      )}

      {/* Multiple Composited Logo Layers (exact 1:1 coordinate match with Worker Canvas) */}
      {activeLogos.map((layer, index) => {
        const placement = computeSmartLogoPlacement(
          geom.cropW,
          geom.cropH,
          layer
        );
        const isLayerSelected = activeLogoId === layer.id;
        const isInteractive = Boolean(onInteractiveMoveLogo);

        return (
          <img
            key={layer.id}
            src={layer.dataUrl}
            alt={layer.fileName || `Logo ${index + 1}`}
            onPointerDown={
              isInteractive
                ? (e) => handleLogoPointerDown(layer.id, e)
                : undefined
            }
            onPointerMove={
              isInteractive
                ? (e) => handleLogoPointerMove(layer.id, e)
                : undefined
            }
            onPointerUp={
              isInteractive
                ? (e) => handleLogoPointerUp(layer.id, e)
                : undefined
            }
            className={`absolute select-none object-contain ${
              isInteractive
                ? `pointer-events-auto cursor-move rounded-xs ${
                    isLayerSelected
                      ? 'ring-1 ring-emerald-400/90 shadow-sm'
                      : 'hover:ring-1 hover:ring-white/60'
                  }`
                : 'pointer-events-none'
            }`}
            style={{
              zIndex: 10 + index,
              left: `${(placement.x / Math.max(1, geom.cropW)) * 100}%`,
              top: `${(placement.y / Math.max(1, geom.cropH)) * 100}%`,
              width: `${(placement.width / Math.max(1, geom.cropW)) * 100}%`,
              height: `${(placement.height / Math.max(1, geom.cropH)) * 100}%`,
              opacity: layer.opacity / 100,
              touchAction: isInteractive ? 'none' : undefined,
            }}
            title={
              isInteractive
                ? `Kéo chuột để di chuyển "${layer.fileName}" tự do trên ảnh`
                : undefined
            }
          />
        );
      })}

      {/* Before / After Original Indicator Pill */}
      {showOriginal && (
        <div className="absolute top-2 left-2 z-30 px-2 py-0.5 rounded bg-sky-500/90 text-[10px] font-bold text-white shadow">
          ẢNH GỐC (TRƯỚC KHI SỬA)
        </div>
      )}
    </div>
  );
};

export const VirtualMediaGrid: React.FC<VirtualMediaGridProps> = ({
  items,
  selectedItemId,
  checkedItemIds,
  searchQuery,
  onSearchQueryChange,
  quickFilter,
  onQuickFilterChange,
  sortBy,
  onSortByChange,
  compareOriginal,
  onSelectItem,
  onToggleCheckItem,
  onSelectAllVisiblePhotos,
  onClearCheckedItems,
  onOpenLightbox,
  onToggleRejectStatus,
  onUpdateDetectedDimensions,
  gridColumns,
  onFocusDriveInput,
  onImportLocalFiles,
  hasAnyLoadedItems,
}) => {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);
  const bulkFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const visiblePhotoCount = useMemo(
    () => items.filter((i) => i.mediaType === 'image').length,
    [items]
  );

  const rows = useMemo(() => {
    const result: DriveMediaItem[][] = [];
    for (let i = 0; i < items.length; i += gridColumns) {
      result.push(items.slice(i, i + gridColumns));
    }
    return result;
  }, [items, gridColumns]);

  const estimatedRowHeight = useMemo(() => {
    switch (gridColumns) {
      case 2:
        return 420;
      case 3:
        return 300;
      case 4:
        return 245;
      case 5:
        return 210;
      case 6:
        return 185;
      default:
        return 245;
    }
  }, [gridColumns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 4,
  });

  // Re-measure virtual rows cleanly when column density changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [gridColumns, rowVirtualizer]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportLocalFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const extracted = await extractFilesFromDataTransfer(e.dataTransfer);
    if (extracted.length > 0) {
      onImportLocalFiles(extracted);
    }
  };

  const hiddenInputs = (
    <>
      <input
        ref={bulkFileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.svg,.avif,.mp4,.mov"
        onChange={handleFileInputChange}
        className="hidden"
      />
      <input
        ref={bulkFolderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={handleFileInputChange}
        className="hidden"
      />
    </>
  );

  if (!hasAnyLoadedItems) {
    return (
      <main
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDraggingOver) setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDropFiles}
        className="flex-1 bg-zinc-950 flex items-center justify-center p-8 select-none"
      >
        {hiddenInputs}

        <div
          className={`max-w-xl w-full bg-zinc-900 border-2 border-dashed rounded-xl p-8 text-center space-y-5 transition-colors ${
            isDraggingOver
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <div className="w-14 h-14 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
            <UploadCloud className="w-7 h-7" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-zinc-100">
              Tải hàng loạt ảnh từ máy tính hoặc dán link Google Drive
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Hỗ trợ <strong className="text-emerald-300">ghép nhiều Logo cùng lúc lên 1 bức ảnh</strong> (Nhà tổ chức + Nhà tài trợ + Studio), chỉnh màu tự nhiên, cắt tỷ lệ và xuất hàng loạt tốc độ cao, giữ trọn độ nét.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => bulkFileInputRef.current?.click()}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <ImagePlus className="w-4 h-4" aria-hidden="true" />
              <span>Chọn hàng loạt ảnh từ máy</span>
            </button>

            <button
              type="button"
              onClick={() => bulkFolderInputRef.current?.click()}
              className="px-4 py-2.5 text-xs font-semibold text-zinc-200 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FolderUp
                className="w-4 h-4 text-indigo-400"
                aria-hidden="true"
              />
              <span>Tải nguyên thư mục ảnh</span>
            </button>

            <button
              type="button"
              onClick={onFocusDriveInput}
              className="px-4 py-2.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              Dán link Google Drive
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDraggingOver) setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDropFiles}
      className="flex-1 bg-zinc-950 flex flex-col min-w-0 overflow-hidden select-none relative"
    >
      {hiddenInputs}

      {isDraggingOver && (
        <div className="absolute inset-4 z-30 rounded-xl bg-emerald-950/80 border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="w-10 h-10 text-emerald-400 mb-2" />
          <span className="text-sm font-bold text-white">
            Thả ảnh hoặc thư mục vào đây để thêm hàng loạt
          </span>
        </div>
      )}

      {/* Sub-header: Search, Quick Filters, Sort & Multi-Select Bar */}
      <div className="px-4 py-2 bg-zinc-900/75 border-b border-zinc-800/90 flex flex-wrap items-center justify-between gap-2.5 shrink-0 text-xs">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Filename Search */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 w-44 focus-within:border-indigo-500">
            <Search
              className="w-3.5 h-3.5 text-zinc-500 mr-1.5 shrink-0"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Tìm tên file..."
              aria-label="Tìm kiếm theo tên file"
              className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange('')}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                aria-label="Xóa từ khóa tìm kiếm"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Quick Filter */}
          <select
            value={quickFilter}
            onChange={(e) =>
              onQuickFilterChange(e.target.value as QuickFilterOption)
            }
            aria-label="Bộ lọc nhanh"
            className="px-2 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">Tất cả ({items.length})</option>
            <option value="edited">Đã chỉnh sửa / gắn Logo</option>
            <option value="unwatermarked">Chưa gắn Logo</option>
            <option value="rated">Đã chấm sao (★)</option>
            <option value="ai-flagged">AI gợi ý kiểm tra</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as SortByOption)}
            aria-label="Sắp xếp danh sách"
            className="px-2 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="name-asc">Tên A → Z</option>
            <option value="name-desc">Tên Z → A</option>
            <option value="rating-desc">Sao cao nhất</option>
            <option value="resolution-desc">Độ phân giải lớn</option>
          </select>

          {checkedItemIds.size > 0 && (
            <span className="text-emerald-400 font-medium truncate">
              · Đã chọn {checkedItemIds.size} ảnh (Giữ Shift để chọn dải)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => bulkFileInputRef.current?.click()}
            className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
            title="Thêm ảnh từ máy tính vào danh sách"
          >
            <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">+ Thêm ảnh</span>
          </button>

          {visiblePhotoCount > 0 && (
            <>
              <button
                type="button"
                onClick={onSelectAllVisiblePhotos}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span>Chọn hết ({visiblePhotoCount})</span>
              </button>
              {checkedItemIds.size > 0 && (
                <button
                  type="button"
                  onClick={onClearCheckedItems}
                  className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
                >
                  Bỏ chọn ({checkedItemIds.size})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <main className="flex-1 bg-zinc-950 flex items-center justify-center p-8 select-none">
          <div className="max-w-md text-center space-y-2">
            <p className="text-sm font-semibold text-zinc-300">
              Không có file nào khớp với bộ lọc / tìm kiếm hiện tại
            </p>
            <p className="text-xs text-zinc-500">
              Hãy thử xóa từ khóa tìm kiếm, đổi bộ lọc nhanh về &ldquo;Tất cả&rdquo;, hoặc chuyển tab trạng thái ở thanh bên trái.
            </p>
          </div>
        </main>
      ) : (
        <main ref={parentRef} className="flex-1 overflow-y-auto p-4">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowItems = rows[virtualRow.index] || [];

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-3.5"
                >
                  <div
                    className="grid gap-3.5"
                    style={{
                      gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                    }}
                  >
                    {rowItems.map((item) => {
                      const isSelected = selectedItemId === item.id;
                      const isChecked = checkedItemIds.has(item.id);
                      const editFlags =
                        item.mediaType === 'image'
                          ? isPhotoEdited(item.edit)
                          : {
                              isCropped: false,
                              isColorEdited: false,
                              isWatermarked: false,
                              activeLogoCount: 0,
                              hasAnyEdit: false,
                            };

                      return (
                        <div
                          key={item.id}
                          onClick={() => onSelectItem(item)}
                          onDoubleClick={() => onOpenLightbox(item)}
                          className={`group relative rounded-lg bg-zinc-900 border transition-colors overflow-hidden flex flex-col cursor-pointer ${
                            isSelected
                              ? 'border-indigo-500 ring-2 ring-indigo-500/40'
                              : isChecked
                              ? 'border-emerald-500/80 ring-1 ring-emerald-500/30'
                              : 'border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <div className="relative w-full aspect-4/3 bg-zinc-950 flex items-center justify-center overflow-hidden">
                            {item.mediaType === 'video' ? (
                              <>
                                <img
                                  src={item.gridThumbUrl}
                                  alt={item.name}
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  className="w-full h-full object-cover select-none pointer-events-none"
                                />
                                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/45 transition-colors flex items-center justify-center">
                                  <div className="w-11 h-11 rounded-full bg-zinc-900/85 border border-zinc-700 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
                                    <Play className="w-5 h-5 fill-white ml-0.5" />
                                  </div>
                                </div>
                                <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-[11px] font-mono tabular-nums text-zinc-100">
                                  {formatVideoDuration(item.durationMillis)}
                                </div>
                              </>
                            ) : (
                              <LiveEditedPhotoPreview
                                item={item}
                                useHighRes={false}
                                showOriginal={compareOriginal && isSelected}
                                onDimensionsDetected={
                                  onUpdateDetectedDimensions
                                }
                                className="max-w-full max-h-full w-full h-full"
                              />
                            )}

                            {/* Top-Left Multi-Select Checkbox (supports Shift+Click range!) */}
                            {item.mediaType === 'image' && (
                              <button
                                type="button"
                                onClick={(e) =>
                                  onToggleCheckItem(item.id, e.shiftKey, e)
                                }
                                aria-label={
                                  isChecked ? 'Bỏ chọn ảnh' : 'Chọn ảnh'
                                }
                                className={`absolute top-2 left-2 p-1 rounded-md border transition-opacity z-20 cursor-pointer ${
                                  isChecked
                                    ? 'opacity-100 bg-emerald-600 border-emerald-500 text-white'
                                    : 'opacity-0 group-hover:opacity-100 bg-zinc-900/85 border-zinc-700 text-zinc-300 hover:text-white'
                                }`}
                                title="Tích chọn ảnh (Giữ Shift + Click để chọn cả dải ảnh liên tiếp)"
                              >
                                {isChecked ? (
                                  <CheckSquare className="w-3.5 h-3.5" />
                                ) : (
                                  <Square className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            {/* Hover Top-Right Quick Actions */}
                            <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenLightbox(item);
                                }}
                                aria-label="Phóng to soi chi tiết"
                                className="p-1.5 rounded-md bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 shadow-xs cursor-pointer"
                                title="Phóng to & kéo đặt nhiều Logo (Phím Space)"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => onToggleRejectStatus(item, e)}
                                className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 border shadow-xs cursor-pointer whitespace-nowrap ${
                                  item.status === 'kept'
                                    ? 'bg-rose-600/95 hover:bg-rose-500 text-white border-rose-500'
                                    : 'bg-emerald-600/95 hover:bg-emerald-500 text-white border-emerald-500'
                                }`}
                              >
                                {item.status === 'kept' ? (
                                  <>
                                    <Trash2 className="w-3 h-3" />
                                    <span>Loại</span>
                                  </>
                                ) : (
                                  <>
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Khôi phục</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Bottom-Left Edit & Multi-Logo Indicators */}
                            {(editFlags.hasAnyEdit || item.aiReason) && (
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[11px] text-zinc-200 flex items-center gap-2 z-10 max-w-[75%]">
                                {editFlags.isCropped && (
                                  <span
                                    className="flex items-center gap-1 text-amber-300 shrink-0"
                                    title="Đã cắt khung hình hoặc xoay ảnh"
                                  >
                                    <Crop className="w-3 h-3" />
                                  </span>
                                )}
                                {editFlags.isColorEdited && (
                                  <span
                                    className="flex items-center gap-1 text-indigo-300 shrink-0"
                                    title="Đã chỉnh ánh sáng / màu sắc"
                                  >
                                    <Sliders className="w-3 h-3" />
                                  </span>
                                )}
                                {editFlags.isWatermarked && (
                                  <span
                                    className="flex items-center gap-1 text-emerald-300 shrink-0 font-medium"
                                    title={`Đã ghép ${editFlags.activeLogoCount} lớp Logo`}
                                  >
                                    <Stamp className="w-3 h-3" />
                                    <span>
                                      {editFlags.activeLogoCount > 1
                                        ? `${editFlags.activeLogoCount} Logo`
                                        : 'Logo'}
                                    </span>
                                  </span>
                                )}
                                {item.aiReason && (
                                  <span
                                    className="flex items-center gap-1 text-amber-300 truncate"
                                    title={`Đánh giá AI: ${item.aiReason}`}
                                  >
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    <span className="truncate">
                                      {item.aiReason}
                                    </span>
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Bottom-Right Star Rating Badge */}
                            {item.rating > 0 && (
                              <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[11px] font-mono text-amber-300 flex items-center gap-0.5 z-10">
                                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                <span>{item.rating}</span>
                              </div>
                            )}
                          </div>

                          {/* Card Footer */}
                          <div className="px-3 py-2 bg-zinc-900 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div
                                className="text-xs font-medium text-zinc-200 truncate"
                                title={item.name}
                              >
                                {item.name}
                              </div>
                              <div className="text-[11px] text-zinc-500 truncate flex items-center gap-1.5">
                                <span className="truncate">
                                  {item.folderName}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums shrink-0">
                                  {item.width}×{item.height}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}
    </div>
  );
};
