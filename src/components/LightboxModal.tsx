import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Maximize,
  Move,
  RotateCcw,
  SplitSquareHorizontal,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type DriveMediaItem,
  type StarRating,
  getActiveLogos,
} from '../types/media.ts';
import { attachAuthToStreamUrl } from '../lib/supabaseClient.ts';
import { computeFrameGeometry } from '../utils/mediaMath.ts';
import { LiveEditedPhotoPreview } from './VirtualMediaGrid.tsx';

interface LightboxModalProps {
  item: DriveMediaItem | null;
  canFreeDragLogo: boolean;
  onRequestUpgrade: (reason: string) => void;
  compareOriginal: boolean;
  onCompareOriginalChange: (comparing: boolean) => void;
  onRateItem: (itemId: string, rating: StarRating) => void;
  onMoveLogoLayer: (
    logoId: string,
    customXPercent: number,
    customYPercent: number
  ) => void;
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
  canFreeDragLogo,
  onRequestUpgrade,
  compareOriginal,
  onCompareOriginalChange,
  onRateItem,
  onMoveLogoLayer,
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
  const [videoFallbackIframe, setVideoFallbackIframe] =
    useState<boolean>(false);
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null);

  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    setVideoFallbackIframe(false);
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
  const canStreamNativeVideo =
    item.downloadUrl.startsWith('blob:') ||
    item.downloadUrl.startsWith('/api/drive/stream');
  const driveEmbedUrl = `https://drive.google.com/file/d/${item.id}/preview`;
  const activeLogoCount = isVideo ? 0 : getActiveLogos(item.edit).length;
  const previewGeom = isVideo
    ? null
    : computeFrameGeometry(item.width, item.height, item.edit, 0);

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
      role="dialog"
      aria-modal="true"
      aria-label={`Xem chi tiết ${item.name}`}
      className="fixed inset-0 z-50 bg-black/94 backdrop-blur-xs flex flex-col select-none"
      onClick={onClose}
    >
      {/* Top Header Bar */}
      <div
        className="h-14 px-5 bg-zinc-900/95 border-b border-zinc-800 flex items-center justify-between gap-4 shrink-0 z-30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
            {currentIndex + 1} / {totalFiltered}
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            ·
          </span>
          <span className="text-sm font-semibold text-zinc-100 truncate">
            {item.name}
          </span>
          <div className="hidden lg:flex items-center gap-0.5 ml-2">
            {([1, 2, 3, 4, 5] as StarRating[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onRateItem(item.id, item.rating === s ? 0 : s)}
                aria-label={`${s} sao`}
                className="p-0.5 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    item.rating >= s
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Center Zoom Controls for Photos */}
        {!isVideo && (
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 shrink-0">
            <button
              type="button"
              onClick={() => handleSetZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Thu nhỏ ảnh"
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
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
              aria-label="Mức phóng to"
              className="w-24 accent-indigo-500 cursor-pointer"
            />

            <span className="w-12 text-center text-xs font-mono tabular-nums text-zinc-200 font-semibold">
              {Math.round(zoom * 100)}%
            </span>

            <button
              type="button"
              onClick={() => handleSetZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Phóng to ảnh"
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-zinc-800 mx-0.5" />

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
              >
                {preset}x
              </button>
            ))}

            {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
              <button
                type="button"
                onClick={handleResetZoom}
                aria-label="Đặt lại khung hình chuẩn"
                className="p-1.5 rounded hover:bg-zinc-800 text-amber-400 cursor-pointer"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!isVideo && (
            <>
              <button
                type="button"
                onPointerDown={() => onCompareOriginalChange(true)}
                onPointerUp={() => onCompareOriginalChange(false)}
                onPointerLeave={() => onCompareOriginalChange(false)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer ${
                  compareOriginal
                    ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                    : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-200'
                }`}
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden md:inline">So sánh gốc (\)</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenCrop(item)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Crop className="w-3.5 h-3.5 text-indigo-400" />
                <span>Cắt (C)</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => onToggleReject(item)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              item.status === 'kept'
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {item.status === 'kept' ? (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Loại bỏ (X)</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Khôi phục</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng màn hình phóng to"
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div
        ref={viewportRef}
        className="flex-1 relative flex items-center justify-center p-6 overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="File trước"
          className="absolute left-5 z-20 w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div
          className="w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleClickPhoto}
        >
          {isVideo ? (
            canStreamNativeVideo && !videoFallbackIframe ? (
              <div className="w-full max-w-4xl aspect-video bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex items-center justify-center">
                <video
                  src={attachAuthToStreamUrl(item.downloadUrl)}
                  controls
                  autoPlay
                  onError={() => setVideoFallbackIframe(true)}
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="w-full max-w-4xl aspect-video bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                <iframe
                  src={driveEmbedUrl}
                  title={item.name}
                  className="w-full h-full border-0"
                  allow="autoplay; fullscreen"
                />
              </div>
            )
          ) : (
            <div
              className="flex items-center justify-center"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 120ms ease-out',
                cursor:
                  zoom > 1
                    ? isDragging
                      ? 'grabbing'
                      : 'grab'
                    : 'default',
              }}
            >
              <LiveEditedPhotoPreview
                item={item}
                useHighRes={true}
                preferOriginal={!isVideo && zoom > 1.05}
                showOriginal={compareOriginal}
                activeLogoId={selectedLogoId}
                onSelectLogoLayer={setSelectedLogoId}
                onInteractiveMoveLogo={
                  zoom === 1
                    ? (logoId, xPct, yPct) => {
                        if (!canFreeDragLogo) {
                          onRequestUpgrade(
                            'Tính năng kéo-thả đặt tọa độ Logo tự do trên ảnh dành cho Tài khoản Mở khóa Full (Pro).'
                          );
                          return;
                        }
                        onMoveLogoLayer(logoId, xPct, yPct);
                      }
                    : undefined
                }
                style={{
                  width: `min(82vw, calc(78vh * ${previewGeom?.cropW || 1600} / ${Math.max(1, previewGeom?.cropH || 1067)}))`,
                }}
                className="rounded-lg shadow-2xl border border-zinc-800"
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="File tiếp theo"
          className="absolute right-5 z-20 w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
        >
          <ChevronRight className="w-6 h-6" />
        </button>

        {!isVideo && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400 flex items-center gap-3 pointer-events-none shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <span>Cuộn chuột: Zoom tới 500%</span>
            {zoom === 1 && activeLogoCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-300 flex items-center gap-1">
                  <Move className="w-3 h-3" />
                  <span>
                    Kéo trực tiếp từng Logo để sắp xếp bố cục nhiều Logo
                  </span>
                </span>
              </>
            )}
            {zoom > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-indigo-300 flex items-center gap-1">
                  <Move className="w-3 h-3" />
                  <span>Giữ chuột trái để kéo xem chi tiết</span>
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
