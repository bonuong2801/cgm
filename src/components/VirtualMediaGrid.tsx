import React, { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Crop,
  Maximize2,
  Play,
  RotateCcw,
  Sliders,
  Stamp,
  Trash2,
} from 'lucide-react';
import {
  DriveMediaItem,
  LogoPosition,
  isPhotoEdited,
} from '../types/media';
import { buildCssFilterString } from '../services/imageProcessor';

interface VirtualMediaGridProps {
  items: DriveMediaItem[];
  selectedItemId: string | null;
  onSelectItem: (item: DriveMediaItem) => void;
  onOpenLightbox: (item: DriveMediaItem) => void;
  onToggleRejectStatus: (item: DriveMediaItem, e?: React.MouseEvent) => void;
  gridColumns: number;
  onFocusDriveInput: () => void;
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
  className?: string;
}> = ({ item, useHighRes = false, className = '' }) => {
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
  // In CSS, width % is relative to container width (finalW).
  // If landscape (finalW >= finalH), shortSide = finalH, so width% of container = scalePercent * (finalH / finalW).
  // If portrait (finalH > finalW), shortSide = finalW, so width% of container = scalePercent.
  const logoCssWidthPercent = isPortraitFrame
    ? edit.logo.scalePercent
    : edit.logo.scalePercent * (finalH / Math.max(1, finalW));

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
  onSelectItem,
  onOpenLightbox,
  onToggleRejectStatus,
  gridColumns,
  onFocusDriveInput,
  hasAnyLoadedItems,
}) => {
  const parentRef = useRef<HTMLDivElement | null>(null);

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

  // Empty State when no Drive folder is loaded yet
  if (!hasAnyLoadedItems) {
    return (
      <main className="flex-1 bg-zinc-950 flex items-center justify-center p-8 select-none">
        <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400 font-bold text-sm">
            CGM
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-zinc-100">
              Nhập đường liên kết thư mục Google Drive
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Dán đường liên kết thư mục Google Drive công khai (&ldquo;Bất kỳ ai có đường liên kết đều có thể xem&rdquo;) vào thanh tìm kiếm phía trên để tự động quét song song các thư mục con, lọc ảnh 60fps, chỉnh màu, đóng dấu logo và xuất hàng loạt.
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center">
            <button
              type="button"
              onClick={onFocusDriveInput}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              Dán link thư mục Google Drive ngay
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
    <main
      ref={parentRef}
      className="flex-1 bg-zinc-950 overflow-y-auto p-4 select-none"
    >
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
                            className="w-full h-full"
                          />
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
                            title="Phóng to xem chi tiết / phát video"
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
  );
};
