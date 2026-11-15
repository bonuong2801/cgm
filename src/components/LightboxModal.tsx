import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Maximize,
  Move,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DriveMediaItem } from '../types/media';
import { LiveEditedPhotoPreview } from './VirtualMediaGrid';

interface LightboxModalProps {
  item: DriveMediaItem | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleReject: (item: DriveMediaItem) => void;
  onOpenCrop: (item: DriveMediaItem) => void;
  currentIndex: number;
  totalFiltered: number;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.35;

export const LightboxModal: React.FC<LightboxModalProps> = ({
  item,
  onClose,
  onPrev,
  onNext,
  onToggleReject,
  onOpenCrop,
  currentIndex,
  totalFiltered,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Reset zoom and pan when switching media items
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
  }, [item?.id]);

  const handleSetZoom = useCallback((nextZoomVal: number) => {
    const clamped = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Number(nextZoomVal.toFixed(2)))
    );
    setZoom(clamped);
    if (clamped <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Keyboard shortcuts for zooming (+, -, 0) inside Lightbox
  useEffect(() => {
    if (!item || item.mediaType === 'video') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleSetZoom(zoom + ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleSetZoom(zoom - ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        handleResetZoom();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, zoom, handleSetZoom, handleResetZoom]);

  // Smooth Mouse Wheel Zoom
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !item || item.mediaType === 'video') return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0018;
      setZoom((prevZoom) => {
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, Number((prevZoom + delta * prevZoom).toFixed(2)))
        );
        if (nextZoom <= 1) {
          setPan({ x: 0, y: 0 });
        }
        return nextZoom;
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [item]);

  if (!item) return null;

  const isVideo = item.mediaType === 'video';
  const driveEmbedUrl = `https://drive.google.com/file/d/${item.id}/preview`;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isVideo || e.button !== 0) return;
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleDoubleClickPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVideo) return;
    if (zoom > 1.05) {
      handleResetZoom();
    } else {
      handleSetZoom(2.5);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/94 backdrop-blur-xs flex flex-col select-none"
      onClick={onClose}
    >
      {/* Top Header Bar */}
      <div
        className="h-14 px-6 bg-zinc-900/95 border-b border-zinc-800 flex items-center justify-between gap-4 shrink-0 z-30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
            {currentIndex + 1} / {totalFiltered}
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            ·
          </span>
          <span className="text-sm font-semibold text-zinc-100 truncate">
            {item.name}
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            ·
          </span>
          <span className="text-xs text-zinc-400 truncate">
            {item.folderName}
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            ·
          </span>
          <span className="text-xs font-mono tabular-nums text-zinc-500 shrink-0">
            {item.width}×{item.height}px
          </span>
        </div>

        {/* Center Zoom Controls for Photos */}
        {!isVideo && (
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 shrink-0">
            <button
              type="button"
              onClick={() => handleSetZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
              title="Thu nhỏ (Phím - hoặc cuộn chuột xuống)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(e) => handleSetZoom(Number(e.target.value))}
              className="w-24 accent-indigo-500 cursor-pointer"
              title="Thanh trượt phóng to / thu nhỏ ảnh"
            />

            <span className="w-12 text-center text-xs font-mono tabular-nums text-zinc-200 font-semibold">
              {Math.round(zoom * 100)}%
            </span>

            <button
              type="button"
              onClick={() => handleSetZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
              title="Phóng to (Phím + hoặc cuộn chuột lên)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-zinc-800 mx-0.5" />

            {/* Quick Zoom Presets */}
            {[1, 2, 3, 4].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() =>
                  preset === 1 ? handleResetZoom() : handleSetZoom(preset)
                }
                className={`px-2 py-1 rounded text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                  Math.abs(zoom - preset) < 0.1
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
                title={
                  preset === 1
                    ? 'Vừa khung hình (100% - Phím 0)'
                    : `Phóng to ${preset * 100}% để soi chi tiết`
                }
              >
                {preset}x
              </button>
            ))}

            {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
              <button
                type="button"
                onClick={handleResetZoom}
                className="p-1.5 rounded hover:bg-zinc-800 text-amber-400 cursor-pointer"
                title="Đặt lại khung hình chuẩn (Phím 0)"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Right Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {!isVideo && (
            <button
              type="button"
              onClick={() => onOpenCrop(item)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Crop className="w-3.5 h-3.5 text-indigo-400" />
              <span>Cắt khung hình (C)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onToggleReject(item)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              item.status === 'kept'
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {item.status === 'kept' ? (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Loại bỏ file này (X)</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Khôi phục lại</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
            title="Đóng (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Viewport with Wheel Zoom & Drag-to-Pan */}
      <div
        ref={viewportRef}
        className="flex-1 relative flex items-center justify-center p-6 overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Previous Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-5 z-20 w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
          title="File trước (Mũi tên trái)"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        {/* Media Content */}
        <div
          className="max-w-5xl max-h-full w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleClickPhoto}
        >
          {isVideo ? (
            <div className="w-full max-w-4xl aspect-video bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
              <iframe
                src={driveEmbedUrl}
                title={item.name}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
              />
            </div>
          ) : (
            <div
              className="max-w-full max-h-full flex items-center justify-center"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 120ms ease-out',
                cursor:
                  zoom > 1
                    ? isDragging
                      ? 'grabbing'
                      : 'grab'
                    : 'zoom-in',
              }}
            >
              <LiveEditedPhotoPreview
                item={item}
                useHighRes={true}
                className="max-h-[78vh] max-w-[82vw] rounded-lg shadow-2xl border border-zinc-800"
              />
            </div>
          )}
        </div>

        {/* Next Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-5 z-20 w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
          title="File tiếp theo (Mũi tên phải)"
        >
          <ChevronRight className="w-6 h-6" />
        </button>

        {/* Bottom Hint Bar for Zoom/Pan */}
        {!isVideo && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400 flex items-center gap-3 pointer-events-none shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <span>Cuộn chuột: Phóng to / Thu nhỏ (tới 500%)</span>
            <span aria-hidden="true">·</span>
            <span>Nhấp đúp: Phóng nhanh 2.5x</span>
            {zoom > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-indigo-300 flex items-center gap-1">
                  <Move className="w-3 h-3" />
                  <span>Giữ chuột trái và kéo để di chuyển xem chi tiết</span>
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
