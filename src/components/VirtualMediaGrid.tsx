import React, { useRef, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CheckSquare,
  Crop,
  FolderUp,
  ImagePlus,
  Maximize2,
  Play,
  RotateCcw,
  Sliders,
  Square,
  Stamp,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  DriveMediaItem,
  LogoPosition,
  isPhotoEdited,
} from '../types/media';
import { buildCssFilterString } from '../services/imageProcessor';
import { extractFilesFromDataTransfer } from '../services/localFileLoader';

interface VirtualMediaGridProps {
  items: DriveMediaItem[];
  selectedItemId: string | null;
  checkedItemIds: Set<string>;
  onSelectItem: (item: DriveMediaItem) => void;
  onToggleCheckItem: (itemId: string, e: React.MouseEvent) => void;
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

export function getLogoOverlayPositionStyle(
  position: LogoPosition,
  marginPercent: number
): React.CSSProperties {
  const margin = `${marginPercent}%`;
  switch (position) {
    case 'top-left':
      return { top: margin, left: margin };
    case 'top-right':
      return { top: margin, right: margin };
    case 'bottom-left':
      return { bottom: margin, left: margin };
    case 'bottom-right':
      return { bottom: margin, right: margin };
    case 'center':
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
  }
}

/**
 * Renders a live preview of the photo inside a thumbnail or lightbox frame,
 * reflecting Rotation, Crop framing, CSS Filters (Brightness, Contrast, Saturation, Warmth),
 * and Proportional Smart Logo Watermark.
 */
export const LiveEditedPhotoPreview: React.FC<{
  item: DriveMediaItem;
  useHighRes?: boolean;
  onDimensionsDetected?: (itemId: string, w: number, h: number) => void;
  className?: string;
}> = ({ item, useHighRes = false, onDimensionsDetected, className = '' }) => {
  const src = useHighRes ? item.previewUrl : item.gridThumbUrl;
  const { edit } = item;
  const cssFilter = buildCssFilterString(edit);

  const cropPercent = edit.cropPercent;
  const hasCrop =
    cropPercent &&
    (cropPercent.width < 99.5 ||
      cropPercent.height < 99.5 ||
      cropPercent.x > 0.2 ||
      cropPercent.y > 0.2);

  // Determine aspect ratio of final cropped frame
  const isRotatedPerpendicular =
    edit.rotation === 90 || edit.rotation === 270;
  const baseW = isRotatedPerpendicular ? item.height : item.width;
  const baseH = isRotatedPerpendicular ? item.width : item.height;

  const finalW = hasCrop ? (cropPercent.width / 100) * baseW : baseW;
  const finalH = hasCrop ? (cropPercent.height / 100) * baseH : baseH;
  const isPortraitFrame = finalH > finalW;

  // Proportional sizing: logo width is scalePercent% of the SHORTER edge
  const logoCssWidthPercent = isPortraitFrame
    ? edit.logo.scalePercent
    : edit.logo.scalePercent * (finalH / Math.max(1, finalW));

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

  return (
    <div
      className={`relative overflow-hidden bg-zinc-950 flex items-center justify-center ${className}`}
      style={{
        aspectRatio: `${Math.round(finalW)} / ${Math.round(finalH)}`,
      }}
    >
      {hasCrop ? (
        <div className="relative w-full h-full overflow-hidden">
          <img
            src={src}
            alt={item.name}
            referrerPolicy="no-referrer"
            loading="lazy"
            onLoad={handleImageLoaded}
            className="max-w-none select-none pointer-events-none"
            style={{
              width: `${(100 / Math.max(1, cropPercent.width)) * 100}%`,
              height: `${(100 / Math.max(1, cropPercent.height)) * 100}%`,
              transform: `translate(-${cropPercent.x}%, -${cropPercent.y}%) rotate(${edit.rotation}deg)`,
              transformOrigin: 'top left',
              filter: cssFilter,
            }}
          />
        </div>
      ) : (
        <img
          src={src}
          alt={item.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={handleImageLoaded}
          className="w-full h-full object-contain select-none pointer-events-none transition-transform duration-150"
          style={{
            transform:
              edit.rotation !== 0 ? `rotate(${edit.rotation}deg)` : undefined,
            filter: cssFilter,
          }}
        />
      )}

      {/* Smart Logo Watermark Overlay (unaffected by photo CSS filter) */}
      {edit.logo.enabled && edit.logo.dataUrl && (
        <img
          src={edit.logo.dataUrl}
          alt="Logo Watermark"
          className="absolute pointer-events-none select-none object-contain z-10"
          style={{
            width: `${Math.max(4, logoCssWidthPercent)}%`,
            opacity: edit.logo.opacity / 100,
            ...getLogoOverlayPositionStyle(
              edit.logo.position,
              edit.logo.marginPercent
            ),
          }}
        />
      )}
    </div>
  );
};

export const VirtualMediaGrid: React.FC<VirtualMediaGridProps> = ({
  items,
  selectedItemId,
  checkedItemIds,
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

  // Group flat items into rows of `gridColumns` for @tanstack/react-virtual
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

  // Shared hidden inputs so both empty state and populated toolbar can trigger bulk upload
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

  // Empty State when no Drive folder or local files are loaded yet
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
            <UploadCloud className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-zinc-100">
              Tải hàng loạt ảnh từ máy tính hoặc dán link Google Drive
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Nhấn <strong className="text-zinc-200">&ldquo;Chọn hàng loạt ảnh từ máy&rdquo;</strong> (bấm <code className="text-emerald-300">Ctrl + A</code> hoặc giữ <code className="text-emerald-300">Shift</code> để chọn hàng trăm ảnh cùng lúc), hoặc <strong className="text-zinc-200">kéo thả nhiều ảnh / nguyên thư mục</strong> trực tiếp vào khung này để gắn Logo đồng loạt.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => bulkFileInputRef.current?.click()}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <ImagePlus className="w-4 h-4" />
              <span>Chọn hàng loạt ảnh từ máy (Nhiều ảnh)</span>
            </button>

            <button
              type="button"
              onClick={() => bulkFolderInputRef.current?.click()}
              className="px-4 py-2.5 text-xs font-semibold text-zinc-200 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FolderUp className="w-4 h-4 text-indigo-400" />
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

  // Empty filter state
  if (items.length === 0) {
    return (
      <main className="flex-1 bg-zinc-950 flex items-center justify-center p-8 select-none">
        {hiddenInputs}
        <div className="max-w-md text-center space-y-2">
          <p className="text-sm font-semibold text-zinc-300">
            Không có file nào khớp với bộ lọc hiện tại
          </p>
          <p className="text-xs text-zinc-500">
            Hãy thử chuyển đổi tab trạng thái &ldquo;Đang giữ / Đã loại bỏ&rdquo; hoặc chọn &ldquo;Tất cả thư mục&rdquo; ở thanh bên trái.
          </p>
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

      {/* Drag-and-drop overlay indicator when dropping more files */}
      {isDraggingOver && (
        <div className="absolute inset-4 z-30 rounded-xl bg-emerald-950/80 border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="w-10 h-10 text-emerald-400 mb-2" />
          <span className="text-sm font-bold text-white">
            Thả ảnh hoặc thư mục vào đây để thêm hàng loạt
          </span>
        </div>
      )}

      {/* Sub-header Multi-Select & Bulk Upload Bar */}
      <div className="h-10 px-4 bg-zinc-900/60 border-b border-zinc-800/80 flex items-center justify-between gap-4 shrink-0 text-xs">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-zinc-400 whitespace-nowrap">
            Hiển thị <strong className="text-zinc-200 font-mono">{items.length}</strong> file
          </span>
          {checkedItemIds.size > 0 && (
            <>
              <span className="text-zinc-700" aria-hidden="true">·</span>
              <span className="text-emerald-400 font-medium truncate">
                Đã tích chọn {checkedItemIds.size} ảnh để gắn Logo hàng loạt
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => bulkFileInputRef.current?.click()}
            className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Chọn thêm hàng loạt ảnh từ máy tính vào danh sách hiện tại"
          >
            <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />
            <span>+ Thêm hàng loạt ảnh</span>
          </button>

          {visiblePhotoCount > 0 && (
            <>
              <button
                type="button"
                onClick={onSelectAllVisiblePhotos}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span>Chọn tất cả ({visiblePhotoCount})</span>
              </button>
              {checkedItemIds.size > 0 && (
                <button
                  type="button"
                  onClick={onClearCheckedItems}
                  className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
                >
                  Bỏ chọn ({checkedItemIds.size})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Virtualized Grid Viewport */}
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
                        {/* Thumbnail Viewport */}
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
                              {/* Centered Play Overlay */}
                              <div className="absolute inset-0 bg-black/30 group-hover:bg-black/45 transition-colors flex items-center justify-center">
                                <div className="w-11 h-11 rounded-full bg-zinc-900/85 border border-zinc-700 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
                                  <Play className="w-5 h-5 fill-white ml-0.5" />
                                </div>
                              </div>
                              {/* Video Duration Text Overlay */}
                              <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-[11px] font-mono tabular-nums text-zinc-100">
                                {formatVideoDuration(item.durationMillis)}
                              </div>
                            </>
                          ) : (
                            <LiveEditedPhotoPreview
                              item={item}
                              useHighRes={false}
                              onDimensionsDetected={onUpdateDetectedDimensions}
                              className="w-full h-full"
                            />
                          )}

                          {/* Top-Left Multi-Select Checkbox for Photos */}
                          {item.mediaType === 'image' && (
                            <button
                              type="button"
                              onClick={(e) => onToggleCheckItem(item.id, e)}
                              className={`absolute top-2 left-2 p-1 rounded-md border transition-opacity z-20 cursor-pointer ${
                                isChecked
                                  ? 'opacity-100 bg-emerald-600 border-emerald-500 text-white'
                                  : 'opacity-0 group-hover:opacity-100 bg-zinc-900/85 border-zinc-700 text-zinc-300 hover:text-white'
                              }`}
                              title={
                                isChecked
                                  ? 'Bỏ chọn ảnh này'
                                  : 'Đánh dấu chọn ảnh này để gắn Logo hàng loạt'
                              }
                            >
                              {isChecked ? (
                                <CheckSquare className="w-3.5 h-3.5" />
                              ) : (
                                <Square className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}

                          {/* Hover Top-Right Quick Actions: Open Lightbox + Reject/Restore */}
                          <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenLightbox(item);
                              }}
                              className="p-1.5 rounded-md bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 shadow-xs cursor-pointer"
                              title="Phóng to soi chi tiết (Phím Space)"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={(e) => onToggleRejectStatus(item, e)}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 border shadow-xs cursor-pointer whitespace-nowrap shrink-0 ${
                                item.status === 'kept'
                                  ? 'bg-rose-600/95 hover:bg-rose-500 text-white border-rose-500'
                                  : 'bg-emerald-600/95 hover:bg-emerald-500 text-white border-emerald-500'
                              }`}
                              title={
                                item.status === 'kept'
                                  ? 'Loại bỏ khỏi danh sách xuất (Phím X)'
                                  : 'Khôi phục lại vào danh sách giữ'
                              }
                            >
                              {item.status === 'kept' ? (
                                <>
                                  <Trash2 className="w-3 h-3" />
                                  <span>Loại bỏ</span>
                                </>
                              ) : (
                                <>
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Khôi phục</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Subtle Edit Indicators at Bottom Left */}
                          {editFlags.hasAnyEdit && (
                            <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[11px] text-zinc-200 flex items-center gap-2 z-10">
                              {editFlags.isCropped && (
                                <span
                                  className="flex items-center gap-1 text-amber-300"
                                  title="Đã cắt khung hình hoặc xoay ảnh"
                                >
                                  <Crop className="w-3 h-3" />
                                  <span>Đã cắt</span>
                                </span>
                              )}
                              {editFlags.isColorEdited && (
                                <span
                                  className="flex items-center gap-1 text-indigo-300"
                                  title="Đã chỉnh ánh sáng / màu sắc"
                                >
                                  <Sliders className="w-3 h-3" />
                                  <span>Màu</span>
                                </span>
                              )}
                              {editFlags.isWatermarked && (
                                <span
                                  className="flex items-center gap-1 text-emerald-300"
                                  title="Đã đóng dấu Logo"
                                >
                                  <Stamp className="w-3 h-3" />
                                  <span>Logo</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Card Footer: Unboxed Clean Metadata */}
                        <div className="px-3 py-2 bg-zinc-900 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div
                              className="text-xs font-medium text-zinc-200 truncate"
                              title={item.name}
                            >
                              {item.name}
                            </div>
                            <div className="text-[11px] text-zinc-500 truncate flex items-center gap-1.5">
                              <span className="truncate">{item.folderName}</span>
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
    </div>
  );
};
