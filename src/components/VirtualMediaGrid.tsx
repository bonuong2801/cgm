import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Crop,
  FolderUp,
  ImageOff,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Maximize2,
  PanelBottom,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  SplitSquareHorizontal,
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
  type StarRating,
  getActiveLogos,
  isPhotoEdited,
} from '../types/media.ts';
import { attachAuthToStreamUrl } from '../lib/supabaseClient.ts';
import {
  buildCssFilterString,
  buildImageFallbackSources,
  computeCursorZoomState,
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
  fitAspectRatioInBox,
  getInstantPaintState,
  resolveDetectedDimensions,
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
  onCompareOriginalChange: (comparing: boolean) => void;
  onSelectItem: (item: DriveMediaItem) => void;
  onPrevItem: () => void;
  onNextItem: () => void;
  onRateItem: (itemId: string, rating: StarRating) => void;
  onToggleCheckItem: (
    itemId: string,
    shiftKey: boolean,
    e: React.MouseEvent
  ) => void;
  onSelectAllVisiblePhotos: () => void;
  onClearCheckedItems: () => void;
  onOpenLightbox: (item: DriveMediaItem) => void;
  onOpenCropModal: (item: DriveMediaItem) => void;
  onToggleRejectStatus: (item: DriveMediaItem, e?: React.MouseEvent) => void;
  onUpdateDetectedDimensions?: (
    itemId: string,
    width: number,
    height: number
  ) => void;
  canFreeDragLogo: boolean;
  onRequestUpgrade: (reason: string) => void;
  onMoveLogoLayer: (
    logoId: string,
    customXPercent: number,
    customYPercent: number
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

// ponytail: fixed 16-image decoded bitmap LRU; tune if preview memory budget changes
const MAX_PRELOADED_IMAGES = 16;
const MAX_READY_URLS = 400;
const preloadedImageCache = new Map<string, HTMLImageElement>();
const preloadedReadyUrls = new Set<string>();

export function isPreviewImagePreloaded(url: string): boolean {
  return Boolean(url) && preloadedReadyUrls.has(url);
}

export function markPreviewImageReady(url: string): void {
  if (!url) return;
  if (preloadedReadyUrls.has(url)) {
    preloadedReadyUrls.delete(url);
  }
  preloadedReadyUrls.add(url);
  while (preloadedReadyUrls.size > MAX_READY_URLS) {
    const oldestUrl = preloadedReadyUrls.values().next().value;
    if (!oldestUrl) break;
    preloadedReadyUrls.delete(oldestUrl);
  }
}

export function preloadPreviewImages(urls: string[]): void {
  if (typeof Image === 'undefined') return;

  for (const url of urls) {
    if (!url || url.startsWith('data:')) continue;

    const existing = preloadedImageCache.get(url);
    if (existing) {
      preloadedImageCache.delete(url);
      preloadedImageCache.set(url, existing);
      continue;
    }

    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => {
      markPreviewImageReady(url);
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {});
      }
    };
    img.onerror = () => {
      preloadedImageCache.delete(url);
      preloadedReadyUrls.delete(url);
    };
    img.src = url;
    preloadedImageCache.set(url, img);

    while (preloadedImageCache.size > MAX_PRELOADED_IMAGES) {
      const oldestKey = preloadedImageCache.keys().next().value;
      if (!oldestKey) break;
      preloadedImageCache.delete(oldestKey);
      preloadedReadyUrls.delete(oldestKey);
    }
  }
}

function appendRetryParam(url: string, attempt: number): string {
  if (
    !url ||
    attempt <= 0 ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cgm_r=${attempt}`;
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
  preferOriginal?: boolean;
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
  preferOriginal = false,
  showOriginal = false,
  activeLogoId = null,
  onSelectLogoLayer,
  onInteractiveMoveLogo,
  onDimensionsDetected,
  className = '',
  style,
}) => {
  const streamUrl = useMemo(
    () =>
      item.isLocal ? item.downloadUrl : attachAuthToStreamUrl(item.downloadUrl),
    [item.isLocal, item.downloadUrl]
  );
  const candidateSources = useMemo(
    () =>
      buildImageFallbackSources({
        id: item.id,
        mediaType: item.mediaType,
        isLocal: item.isLocal,
        gridThumbUrl: item.gridThumbUrl,
        previewUrl: item.previewUrl,
        streamUrl,
        useHighRes,
      }),
    [
      item.id,
      item.mediaType,
      item.isLocal,
      item.gridThumbUrl,
      item.previewUrl,
      streamUrl,
      useHighRes,
    ]
  );

  const [sourceIndex, setSourceIndex] = useState<number>(0);
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [loadedOriginalUrl, setLoadedOriginalUrl] = useState<string | null>(
    null
  );
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setSourceIndex(0);
    setRetryAttempt(0);
    setLoadFailed(false);
    setLoadedSrc(null);
    setLoadedOriginalUrl(null);
  }, [item.id, useHighRes, item.gridThumbUrl, item.previewUrl]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      !preferOriginal ||
      item.isLocal ||
      item.mediaType !== 'image' ||
      !streamUrl ||
      loadedOriginalUrl
    ) {
      return;
    }

    if (candidateSources[sourceIndex] === streamUrl) {
      markPreviewImageReady(streamUrl);
      setLoadedOriginalUrl(streamUrl);
      return;
    }

    let cancelled = false;
    const preloader = new Image();
    preloader.referrerPolicy = 'no-referrer';
    preloader.onload = () => {
      if (cancelled) return;
      markPreviewImageReady(streamUrl);
      setLoadedOriginalUrl(streamUrl);
      if (
        onDimensionsDetected &&
        preloader.naturalWidth > 0 &&
        preloader.naturalHeight > 0
      ) {
        const resolved = resolveDetectedDimensions(
          item.width,
          item.height,
          preloader.naturalWidth,
          preloader.naturalHeight
        );
        if (resolved) {
          onDimensionsDetected(item.id, resolved.width, resolved.height);
        }
      }
    };
    preloader.onerror = () => {
      // Keep sharp thumbnail preview on screen if original stream fails
    };
    preloader.src = streamUrl;

    return () => {
      cancelled = true;
      preloader.onload = null;
      preloader.onerror = null;
    };
  }, [
    preferOriginal,
    item.id,
    item.isLocal,
    item.mediaType,
    item.width,
    item.height,
    streamUrl,
    loadedOriginalUrl,
    candidateSources,
    sourceIndex,
    onDimensionsDetected,
  ]);

  const activeCandidate = candidateSources[sourceIndex] || '';
  const src =
    loadedOriginalUrl || appendRetryParam(activeCandidate, retryAttempt);
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
    markPreviewImageReady(src);
    setLoadedSrc(src);
    const natW = e.currentTarget.naturalWidth;
    const natH = e.currentTarget.naturalHeight;
    if (onDimensionsDetected && natW > 0 && natH > 0) {
      const resolved = resolveDetectedDimensions(
        item.width,
        item.height,
        natW,
        natH
      );
      if (resolved) {
        onDimensionsDetected(item.id, resolved.width, resolved.height);
      }
    }
  };

  const handleImageError = () => {
    if (loadedOriginalUrl) {
      setLoadedOriginalUrl(null);
      return;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (sourceIndex + 1 < candidateSources.length) {
      const nextIdx = sourceIndex + 1;
      if (nextIdx === 1) {
        setSourceIndex(1);
      } else {
        retryTimerRef.current = window.setTimeout(
          () => {
            retryTimerRef.current = null;
            setSourceIndex(nextIdx);
          },
          300 + Math.floor(Math.random() * 450)
        );
      }
      return;
    }
    if (!item.isLocal && retryAttempt < 1) {
      retryTimerRef.current = window.setTimeout(
        () => {
          retryTimerRef.current = null;
          setRetryAttempt(1);
          setSourceIndex(0);
        },
        900 + Math.floor(Math.random() * 700)
      );
      return;
    }
    setLoadFailed(true);
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

  const isCurrentSrcReady =
    Boolean(src) && (loadedSrc === src || isPreviewImagePreloaded(src));
  const showInstantBaseLayer =
    useHighRes &&
    !item.isLocal &&
    !isCurrentSrcReady &&
    Boolean(item.gridThumbUrl) &&
    item.gridThumbUrl !== src;

  const imageLayerStyle: React.CSSProperties = isPerpendicular
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
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        transform:
          edit.rotation !== 0 ? `rotate(${edit.rotation}deg)` : undefined,
        filter: cssFilter,
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
      {loadFailed || !src ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/95 p-3 text-center z-20">
          <ImageOff className="w-6 h-6 text-zinc-600" aria-hidden="true" />
          <span className="text-[11px] font-medium text-zinc-400">
            Không tải được ảnh
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLoadFailed(false);
              setRetryAttempt((n) => n + 1);
              setSourceIndex(0);
            }}
            className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Thử lại</span>
          </button>
        </div>
      ) : (
        <div
          className="absolute pointer-events-none"
          style={{
            width: `${(100 / Math.max(1, cp.width)) * 100}%`,
            height: `${(100 / Math.max(1, cp.height)) * 100}%`,
            left: `${-(cp.x / Math.max(1, cp.width)) * 100}%`,
            top: `${-(cp.y / Math.max(1, cp.height)) * 100}%`,
          }}
        >
          {showInstantBaseLayer && (
            <img
              src={item.gridThumbUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
              className="max-w-none select-none pointer-events-none block"
              style={imageLayerStyle}
            />
          )}
          <img
            src={src}
            alt={item.name}
            referrerPolicy="no-referrer"
            loading={useHighRes ? 'eager' : 'lazy'}
            fetchPriority={useHighRes ? 'high' : undefined}
            decoding={isCurrentSrcReady ? 'sync' : 'async'}
            onLoad={handleImageLoaded}
            onError={handleImageError}
            className="max-w-none select-none pointer-events-none block"
            style={{
              ...imageLayerStyle,
              opacity: showInstantBaseLayer ? 0 : 1,
            }}
          />
        </div>
      )}

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

const VideoThumbnailImage: React.FC<{ item: DriveMediaItem }> = ({ item }) => {
  const candidates = useMemo(
    () =>
      buildImageFallbackSources({
        id: item.id,
        mediaType: 'video',
        isLocal: item.isLocal,
        gridThumbUrl: item.gridThumbUrl,
        previewUrl: item.previewUrl,
        useHighRes: false,
      }),
    [item.id, item.isLocal, item.gridThumbUrl, item.previewUrl]
  );
  const [sourceIndex, setSourceIndex] = useState<number>(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [item.id, item.gridThumbUrl]);

  const src = candidates[sourceIndex];
  if (!src || sourceIndex >= candidates.length) {
    return null;
  }

  return (
    <img
      src={src}
      alt={item.name}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={() => setSourceIndex((prev) => prev + 1)}
      className="w-full h-full object-cover select-none pointer-events-none"
    />
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
  onCompareOriginalChange,
  onSelectItem,
  onPrevItem,
  onNextItem,
  onRateItem,
  onToggleCheckItem,
  onSelectAllVisiblePhotos,
  onClearCheckedItems,
  onOpenLightbox,
  onOpenCropModal,
  onToggleRejectStatus,
  onUpdateDetectedDimensions,
  canFreeDragLogo,
  onRequestUpgrade,
  onMoveLogoLayer,
  gridColumns,
  onFocusDriveInput,
  onImportLocalFiles,
  hasAnyLoadedItems,
}) => {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const loupeViewportRef = useRef<HTMLDivElement | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);
  const bulkFolderInputRef = useRef<HTMLInputElement | null>(null);

  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'loupe' | 'grid'>('loupe');
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null);
  const [loupeBounds, setLoupeBounds] = useState<{
    width: number;
    height: number;
  }>({ width: 760, height: 480 });

  const selectedIndex = useMemo(() => {
    if (items.length === 0) return -1;
    if (selectedItemId) {
      const idx = items.findIndex((i) => i.id === selectedItemId);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [items, selectedItemId]);

  const activeItem =
    selectedIndex >= 0 ? items[selectedIndex] || null : null;

  const [committedLoupeItem, setCommittedLoupeItem] =
    useState<DriveMediaItem | null>(activeItem);
  const [isLoupeScrubbing, setIsLoupeScrubbing] = useState<boolean>(false);
  const [loupeTransform, setLoupeTransform] = useState<{
    itemId: string | null;
    zoom: number;
    pan: { x: number; y: number };
  }>({ itemId: null, zoom: 1, pan: { x: 0, y: 0 } });
  const [isLoupePanning, setIsLoupePanning] = useState<boolean>(false);
  const loupePanStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const lastLoupeNavAtRef = useRef<number>(0);
  const loupeScrubTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setLoupeTransform({ itemId: null, zoom: 1, pan: { x: 0, y: 0 } });
    setIsLoupePanning(false);
    loupePanStartRef.current = null;
  }, [activeItem?.id, viewMode]);

  useEffect(() => {
    const el = loupeViewportRef.current;
    if (
      !el ||
      viewMode !== 'loupe' ||
      !hasAnyLoadedItems ||
      items.length === 0 ||
      !activeItem ||
      activeItem.mediaType !== 'image'
    ) {
      return;
    }

    const activeId = activeItem.id;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorOffset = {
        x: e.clientX - (rect.left + rect.width / 2),
        y: e.clientY - (rect.top + rect.height / 2),
      };
      setLoupeTransform((prev) => {
        const baseZoom = prev.itemId === activeId ? prev.zoom : 1;
        const basePan =
          prev.itemId === activeId ? prev.pan : { x: 0, y: 0 };
        const next = computeCursorZoomState(
          baseZoom,
          basePan,
          e.deltaY,
          cursorOffset,
          1,
          5
        );
        return { itemId: activeId, zoom: next.zoom, pan: next.pan };
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [
    viewMode,
    hasAnyLoadedItems,
    items.length > 0,
    activeItem?.id,
    activeItem?.mediaType,
  ]);

  useEffect(() => {
    return () => {
      if (loupeScrubTimerRef.current !== null) {
        window.clearTimeout(loupeScrubTimerRef.current);
        loupeScrubTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = loupeViewportRef.current;
    if (!el || viewMode !== 'loupe' || !hasAnyLoadedItems || items.length === 0) {
      return;
    }

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setLoupeBounds({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, hasAnyLoadedItems, items.length > 0]);

  useEffect(() => {
    if (viewMode !== 'loupe' || !activeItem) {
      if (loupeScrubTimerRef.current !== null) {
        window.clearTimeout(loupeScrubTimerRef.current);
        loupeScrubTimerRef.current = null;
      }
      lastLoupeNavAtRef.current = 0;
      setIsLoupeScrubbing(false);
      setCommittedLoupeItem(activeItem);
      return;
    }

    const now = Date.now();
    const rapid =
      lastLoupeNavAtRef.current > 0 && now - lastLoupeNavAtRef.current < 160;
    lastLoupeNavAtRef.current = now;

    if (rapid) {
      setIsLoupeScrubbing(true);
      if (loupeScrubTimerRef.current !== null) {
        window.clearTimeout(loupeScrubTimerRef.current);
      }
      loupeScrubTimerRef.current = window.setTimeout(() => {
        loupeScrubTimerRef.current = null;
        setIsLoupeScrubbing(false);
      }, 140);
    }

    const { canSwapImmediately } = getInstantPaintState(
      activeItem,
      isPreviewImagePreloaded
    );
    if (canSwapImmediately) {
      setCommittedLoupeItem(activeItem);
      return;
    }

    const urlsToLoad = Array.from(
      new Set(
        [
          activeItem.gridThumbUrl,
          ...(rapid ? [] : [activeItem.previewUrl]),
        ].filter(Boolean)
      )
    );
    if (urlsToLoad.length === 0) {
      setCommittedLoupeItem(activeItem);
      return;
    }

    let cancelled = false;
    let settled = false;
    let errorCount = 0;
    let loaders: HTMLImageElement[] = [];
    let safetyTimer: number | undefined;

    const commit = () => {
      if (cancelled || settled) return;
      settled = true;
      if (safetyTimer !== undefined) {
        window.clearTimeout(safetyTimer);
        safetyTimer = undefined;
      }
      setCommittedLoupeItem(activeItem);
    };

    const delayTimer = window.setTimeout(
      () => {
        if (cancelled) return;
        safetyTimer = window.setTimeout(commit, 2500);
        loaders = urlsToLoad.map((url) => {
          const loader = new Image();
          loader.referrerPolicy = 'no-referrer';
          loader.onload = () => {
            markPreviewImageReady(url);
            commit();
          };
          loader.onerror = () => {
            errorCount += 1;
            if (errorCount >= urlsToLoad.length) {
              commit();
            }
          };
          loader.src = url;
          return loader;
        });
      },
      rapid ? 95 : 0
    );

    return () => {
      cancelled = true;
      window.clearTimeout(delayTimer);
      if (safetyTimer !== undefined) {
        window.clearTimeout(safetyTimer);
      }
      for (const loader of loaders) {
        loader.onload = null;
        loader.onerror = null;
      }
    };
  }, [activeItem?.id, viewMode]);

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

  const filmstripVirtualizer = useVirtualizer({
    horizontal: true,
    count: items.length,
    getScrollElement: () => filmstripRef.current,
    estimateSize: () => 104,
    overscan: 8,
  });

  // Re-measure virtual rows cleanly when column density changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [gridColumns, rowVirtualizer]);

  // Keep selected filmstrip card centered/visible in horizontal scrub rail
  useEffect(() => {
    if (viewMode !== 'loupe' || selectedIndex < 0 || selectedIndex >= items.length) {
      return;
    }
    try {
      filmstripVirtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    } catch {
      // ignore if container has not measured yet
    }
  }, [viewMode, selectedIndex, items.length, filmstripVirtualizer]);

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
        className="flex-1 bg-[#08080A] flex items-center justify-center p-8 select-none"
      >
        {hiddenInputs}

        <div
          className={`max-w-xl w-full bg-[#121215] border-2 border-dashed rounded-xl p-8 text-center space-y-5 transition-colors ${
            isDraggingOver
              ? 'border-amber-400 bg-amber-500/10'
              : 'border-white/15 hover:border-white/25'
          }`}
        >
          <div className="w-14 h-14 rounded-xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center mx-auto text-amber-400">
            <UploadCloud className="w-7 h-7" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-bold text-zinc-100">
              Tải hàng loạt ảnh từ máy tính hoặc dán link Google Drive
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Không gian{' '}
              <strong className="text-amber-300">Obsidian Lightroom Pro</strong>
              : soi từng tấm lớn kèm dải Filmstrip lướt nhanh ở dưới,{' '}
              <strong className="text-emerald-300">ghép nhiều Logo cùng lúc</strong>
              , chỉnh màu tự nhiên, cắt tỷ lệ và xuất hàng loạt giữ trọn độ nét.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => bulkFileInputRef.current?.click()}
              className="px-5 py-2.5 text-xs font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <ImagePlus className="w-4 h-4" aria-hidden="true" />
              <span>Chọn hàng loạt ảnh từ máy</span>
            </button>

            <button
              type="button"
              onClick={() => bulkFolderInputRef.current?.click()}
              className="px-4 py-2.5 text-xs font-semibold text-zinc-200 bg-[#09090B] hover:bg-zinc-800 border border-white/10 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FolderUp
                className="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
              <span>Tải nguyên thư mục ảnh</span>
            </button>

            <button
              type="button"
              onClick={onFocusDriveInput}
              className="px-4 py-2.5 text-xs font-medium text-zinc-300 hover:text-white bg-[#09090B] hover:bg-zinc-800 border border-white/10 rounded-lg transition-colors cursor-pointer"
            >
              Dán link Google Drive
            </button>
          </div>
        </div>
      </main>
    );
  }

  const instantLoupeState = activeItem
    ? getInstantPaintState(activeItem, isPreviewImagePreloaded)
    : null;
  const loupeStageItem =
    !activeItem ||
    !committedLoupeItem ||
    committedLoupeItem.id === activeItem.id ||
    instantLoupeState?.canSwapImmediately
      ? activeItem
      : committedLoupeItem;
  const isLoupePending = Boolean(
    activeItem && loupeStageItem && loupeStageItem.id !== activeItem.id
  );
  const loupeGeom =
    loupeStageItem && loupeStageItem.mediaType === 'image'
      ? computeFrameGeometry(
          loupeStageItem.width,
          loupeStageItem.height,
          loupeStageItem.edit,
          0
        )
      : null;
  const loupeFit = loupeGeom
    ? fitAspectRatioInBox(
        Math.max(200, loupeBounds.width - 96),
        Math.max(180, loupeBounds.height - 20),
        loupeGeom.cropW,
        loupeGeom.cropH
      )
    : { width: 640, height: 420 };

  const effectiveLoupeZoom =
    activeItem && loupeTransform.itemId === activeItem.id
      ? loupeTransform.zoom
      : 1;
  const effectiveLoupePan =
    activeItem && loupeTransform.itemId === activeItem.id
      ? loupeTransform.pan
      : { x: 0, y: 0 };

  const handleResetLoupeZoom = () => {
    setLoupeTransform({ itemId: null, zoom: 1, pan: { x: 0, y: 0 } });
    setIsLoupePanning(false);
    loupePanStartRef.current = null;
  };

  const handleLoupeMouseDown = (e: React.MouseEvent) => {
    if (!activeItem || activeItem.mediaType !== 'image' || e.button !== 0) {
      return;
    }
    if (effectiveLoupeZoom <= 1) return;
    e.preventDefault();
    setIsLoupePanning(true);
    loupePanStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: effectiveLoupePan.x,
      panY: effectiveLoupePan.y,
    };
  };

  const handleLoupeMouseMove = (e: React.MouseEvent) => {
    if (!isLoupePanning || !loupePanStartRef.current || !activeItem) return;
    const dx = e.clientX - loupePanStartRef.current.clientX;
    const dy = e.clientY - loupePanStartRef.current.clientY;
    const basePan = loupePanStartRef.current;
    setLoupeTransform((prev) => ({
      itemId: activeItem.id,
      zoom: prev.itemId === activeItem.id ? prev.zoom : effectiveLoupeZoom,
      pan: {
        x: basePan.panX + dx,
        y: basePan.panY + dy,
      },
    }));
  };

  const handleLoupeMouseUp = () => {
    setIsLoupePanning(false);
    loupePanStartRef.current = null;
  };

  const handleLoupeDoubleClick = (e: React.MouseEvent) => {
    if (!activeItem) return;
    if (activeItem.mediaType === 'video') {
      onOpenLightbox(activeItem);
      return;
    }
    if (effectiveLoupeZoom > 1.05) {
      handleResetLoupeZoom();
      return;
    }
    const el = loupeViewportRef.current;
    const targetZoom = 2.5;
    if (el) {
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - (rect.left + rect.width / 2);
      const offsetY = e.clientY - (rect.top + rect.height / 2);
      setLoupeTransform({
        itemId: activeItem.id,
        zoom: targetZoom,
        pan: {
          x: Number((offsetX * (1 - targetZoom)).toFixed(1)),
          y: Number((offsetY * (1 - targetZoom)).toFixed(1)),
        },
      });
    } else {
      setLoupeTransform({
        itemId: activeItem.id,
        zoom: targetZoom,
        pan: { x: 0, y: 0 },
      });
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDraggingOver) setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDropFiles}
      className="flex-1 bg-[#08080A] flex flex-col min-w-0 overflow-hidden select-none relative"
    >
      {hiddenInputs}

      {isDraggingOver && (
        <div className="absolute inset-4 z-30 rounded-xl bg-amber-950/80 border-2 border-dashed border-amber-400 flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="w-10 h-10 text-amber-400 mb-2" />
          <span className="text-sm font-bold text-white">
            Thả ảnh hoặc thư mục vào đây để thêm hàng loạt
          </span>
        </div>
      )}

      {/* Sub-header: Search, Quick Filters, Sort, Loupe/Grid Mode & Multi-Select */}
      <div className="px-4 py-2 bg-[#121215] border-b border-white/10 flex flex-wrap items-center justify-between gap-2.5 shrink-0 text-xs">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Filename Search */}
          <div className="flex items-center bg-[#09090B] border border-white/10 rounded-md px-2 py-1 w-44 focus-within:border-amber-500/70">
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
            className="px-2 py-1 rounded-md bg-[#09090B] border border-white/10 text-xs text-zinc-300 focus:outline-none focus:border-amber-500/70 cursor-pointer"
          >
            <option value="all">Tất cả ({items.length})</option>
            <option value="edited">Đã chỉnh sửa / gắn Logo</option>
            <option value="unwatermarked">Chưa gắn Logo</option>
            <option value="rated">Đã chấm sao (★)</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as SortByOption)}
            aria-label="Sắp xếp danh sách"
            className="px-2 py-1 rounded-md bg-[#09090B] border border-white/10 text-xs text-zinc-300 focus:outline-none focus:border-amber-500/70 cursor-pointer"
          >
            <option value="name-asc">Tên A → Z</option>
            <option value="name-desc">Tên Z → A</option>
            <option value="rating-desc">Sao cao nhất</option>
            <option value="resolution-desc">Độ phân giải lớn</option>
          </select>

          {checkedItemIds.size > 0 && (
            <span className="text-emerald-400 font-medium truncate">
              · Đã chọn {checkedItemIds.size} ảnh
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Obsidian Loupe vs Grid Mode Toggle */}
          <div
            className="flex items-center bg-[#09090B] border border-white/10 rounded-md p-0.5 mr-1"
            role="group"
            aria-label="Chế độ hiển thị ảnh"
          >
            <button
              type="button"
              onClick={() => setViewMode('loupe')}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer transition-colors ${
                viewMode === 'loupe'
                  ? 'bg-amber-500 text-zinc-950 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Xem ảnh lớn + dải Filmstrip phía dưới (Lightroom)"
            >
              <PanelBottom className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Loupe</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer transition-colors ${
                viewMode === 'grid'
                  ? 'bg-amber-500 text-zinc-950 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Xem dạng lưới nhiều cột"
            >
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Lưới</span>
            </button>
          </div>

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
                className="px-2.5 py-1 rounded bg-[#09090B] hover:bg-zinc-800 border border-white/10 text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span>Chọn hết ({visiblePhotoCount})</span>
              </button>
              {checkedItemIds.size > 0 && (
                <button
                  type="button"
                  onClick={onClearCheckedItems}
                  className="px-2 py-1 rounded bg-[#09090B] hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
                >
                  Bỏ chọn ({checkedItemIds.size})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <main className="flex-1 bg-[#08080A] flex items-center justify-center p-8 select-none">
          <div className="max-w-md text-center space-y-2">
            <p className="text-sm font-semibold text-zinc-300">
              Không có file nào khớp với bộ lọc / tìm kiếm hiện tại
            </p>
            <p className="text-xs text-zinc-500">
              Hãy thử xóa từ khóa tìm kiếm, đổi bộ lọc nhanh về &ldquo;Tất cả&rdquo;, hoặc chuyển tab trạng thái ở thanh bên trái.
            </p>
          </div>
        </main>
      ) : viewMode === 'loupe' && activeItem && loupeStageItem ? (
        <main className="flex-1 bg-[#08080A] flex flex-col min-h-0 overflow-hidden">
          {/* Center Large Loupe Stage (Scroll wheel to zoom, drag to pan, double-click 1x/2.5x) */}
          <div
            ref={loupeViewportRef}
            onMouseDown={handleLoupeMouseDown}
            onMouseMove={handleLoupeMouseMove}
            onMouseUp={handleLoupeMouseUp}
            onMouseLeave={handleLoupeMouseUp}
            onDoubleClick={handleLoupeDoubleClick}
            className="flex-1 relative flex items-center justify-center p-4 min-h-0 overflow-hidden"
          >
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={onPrevItem}
              aria-label="Ảnh trước"
              className="absolute left-3.5 z-20 w-9 h-9 rounded-full bg-[#16161B]/90 hover:bg-zinc-800 border border-white/15 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {loupeStageItem.mediaType === 'video' ? (
              <div
                onClick={() => onOpenLightbox(activeItem)}
                className="relative w-full max-w-2xl aspect-video max-h-full bg-[#121215] border border-white/15 rounded-xl overflow-hidden shadow-2xl cursor-pointer group flex items-center justify-center"
              >
                <VideoThumbnailImage item={loupeStageItem} />
                <div className="absolute inset-0 bg-black/35 group-hover:bg-black/45 transition-colors flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                    <Play className="w-6 h-6 fill-zinc-950 ml-0.5" />
                  </div>
                </div>
                <div className="absolute bottom-3 right-3 px-2.5 py-0.5 rounded bg-black/80 text-xs font-mono tabular-nums text-zinc-100">
                  {formatVideoDuration(loupeStageItem.durationMillis)}
                </div>
              </div>
            ) : (
              <div
                className="relative flex items-center justify-center"
                style={{
                  transform: `translate3d(${effectiveLoupePan.x}px, ${effectiveLoupePan.y}px, 0) scale(${effectiveLoupeZoom})`,
                  transformOrigin: 'center center',
                  transition:
                    isLoupePanning || loupeTransform.itemId !== activeItem.id
                      ? 'none'
                      : 'transform 90ms ease-out',
                  cursor:
                    effectiveLoupeZoom > 1
                      ? isLoupePanning
                        ? 'grabbing'
                        : 'grab'
                      : 'default',
                }}
              >
                <LiveEditedPhotoPreview
                  key={loupeStageItem.id}
                  item={loupeStageItem}
                  useHighRes={
                    !isLoupeScrubbing ||
                    isPreviewImagePreloaded(loupeStageItem.previewUrl)
                  }
                  preferOriginal={!isLoupePending && effectiveLoupeZoom > 1.05}
                  showOriginal={compareOriginal && !isLoupePending}
                  activeLogoId={selectedLogoId}
                  onSelectLogoLayer={setSelectedLogoId}
                  onInteractiveMoveLogo={
                    !isLoupePending && effectiveLoupeZoom === 1
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
                  onDimensionsDetected={onUpdateDetectedDimensions}
                  style={{
                    width: `${loupeFit.width}px`,
                    height: `${loupeFit.height}px`,
                  }}
                  className="rounded-lg shadow-2xl border border-white/15"
                />
                {!isLoupePending && activeItem.status === 'rejected' && (
                  <div className="absolute inset-0 bg-black/55 flex items-center justify-center pointer-events-none rounded-lg">
                    <span className="px-3.5 py-1.5 rounded-md bg-rose-600/95 text-xs font-bold text-white shadow">
                      ĐÃ LOẠI BỎ
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={onNextItem}
              aria-label="Ảnh tiếp theo"
              className="absolute right-3.5 z-20 w-9 h-9 rounded-full bg-[#16161B]/90 hover:bg-zinc-800 border border-white/15 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Floating Bottom Pill Action Toolbar */}
          <div className="shrink-0 flex justify-center pb-2.5 px-3">
            <div className="px-3.5 py-1.5 rounded-full bg-[#16161B]/95 border border-white/15 shadow-2xl flex flex-wrap items-center justify-center gap-2 text-xs">
              <button
                type="button"
                onClick={onPrevItem}
                aria-label="Ảnh trước"
                className="p-1 rounded-full hover:bg-white/10 text-zinc-300 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="font-mono tabular-nums text-zinc-400">
                {selectedIndex + 1} / {items.length}
              </span>
              <span
                className="font-medium text-zinc-100 max-w-44 truncate"
                title={activeItem.name}
              >
                {activeItem.name}
              </span>
              {isLoupePending && (
                <Loader2
                  className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0"
                  aria-label="Đang tải ảnh"
                />
              )}

              <button
                type="button"
                onClick={onNextItem}
                aria-label="Ảnh sau"
                className="p-1 rounded-full hover:bg-white/10 text-zinc-300 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <span className="text-white/15" aria-hidden="true">
                |
              </span>

              <div
                className="flex items-center gap-0.5"
                role="group"
                aria-label="Chấm sao"
              >
                {([1, 2, 3, 4, 5] as StarRating[]).map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() =>
                      onRateItem(
                        activeItem.id,
                        activeItem.rating === star ? 0 : star
                      )
                    }
                    aria-label={`${star} sao`}
                    className="p-0.5 cursor-pointer"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        activeItem.rating >= star
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-zinc-600 hover:text-zinc-400'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <span className="text-white/15" aria-hidden="true">
                |
              </span>

              {activeItem.mediaType === 'image' && (
                <>
                  <button
                    type="button"
                    onPointerDown={() => onCompareOriginalChange(true)}
                    onPointerUp={() => onCompareOriginalChange(false)}
                    onPointerLeave={() => onCompareOriginalChange(false)}
                    className={`px-2 py-0.5 rounded-full border flex items-center gap-1 cursor-pointer ${
                      compareOriginal
                        ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                        : 'bg-[#09090B] border-white/10 text-zinc-300 hover:text-white'
                    }`}
                  >
                    <SplitSquareHorizontal className="w-3 h-3 text-sky-400" />
                    <span className="hidden md:inline">Gốc (\)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenCropModal(activeItem)}
                    className="px-2 py-0.5 rounded-full bg-[#09090B] hover:bg-zinc-800 border border-white/10 text-zinc-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Crop className="w-3 h-3 text-amber-400" />
                    <span>Cắt (C)</span>
                  </button>
                </>
              )}

              {activeItem.mediaType === 'image' && effectiveLoupeZoom > 1.01 && (
                <button
                  type="button"
                  onClick={handleResetLoupeZoom}
                  title="Bấm để đưa về 100% (hoặc nhấp đúp lên ảnh)"
                  className="px-2 py-0.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-mono tabular-nums flex items-center gap-1 cursor-pointer"
                >
                  <span>{Math.round(effectiveLoupeZoom * 100)}%</span>
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleRejectStatus(activeItem)}
                className={`px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1 cursor-pointer ${
                  activeItem.status === 'kept'
                    ? 'bg-rose-600/95 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600/95 hover:bg-emerald-500 text-white'
                }`}
              >
                {activeItem.status === 'kept' ? (
                  <>
                    <Trash2 className="w-3 h-3" />
                    <span>Loại (X)</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3 h-3" />
                    <span>Khôi phục</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Virtualized Horizontal Filmstrip */}
          <div
            ref={filmstripRef}
            onWheel={(e) => {
              if (
                filmstripRef.current &&
                Math.abs(e.deltaY) > Math.abs(e.deltaX)
              ) {
                filmstripRef.current.scrollLeft += e.deltaY;
              }
            }}
            className="h-22 bg-[#101013] border-t border-white/10 px-3 py-2 shrink-0 overflow-x-auto overflow-y-hidden"
          >
            <div
              style={{
                width: `${filmstripVirtualizer.getTotalSize()}px`,
                height: '100%',
                position: 'relative',
              }}
            >
              {filmstripVirtualizer.getVirtualItems().map((virtualItem) => {
                const item = items[virtualItem.index];
                if (!item) return null;
                const isSelected = activeItem.id === item.id;
                const isChecked = checkedItemIds.has(item.id);

                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectItem(item)}
                    onDoubleClick={() => onOpenLightbox(item)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '96px',
                      height: '68px',
                      transform: `translateX(${virtualItem.start}px)`,
                    }}
                    className={`group rounded-md overflow-hidden border-2 bg-[#08080A] cursor-pointer transition-all ${
                      isSelected
                        ? 'border-amber-400 ring-2 ring-amber-400/35'
                        : isChecked
                        ? 'border-emerald-500/80'
                        : 'border-white/10 hover:border-white/30 opacity-75 hover:opacity-100'
                    }`}
                  >
                    {item.mediaType === 'video' ? (
                      <>
                        <VideoThumbnailImage item={item} />
                        <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                          <Play className="w-4 h-4 fill-white text-white drop-shadow" />
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

                    {item.mediaType === 'image' && (
                      <button
                        type="button"
                        onClick={(e) =>
                          onToggleCheckItem(item.id, e.shiftKey, e)
                        }
                        aria-label={isChecked ? 'Bỏ chọn ảnh' : 'Chọn ảnh'}
                        className={`absolute top-1 left-1 p-0.5 rounded border z-20 cursor-pointer ${
                          isChecked
                            ? 'opacity-100 bg-emerald-600 border-emerald-500 text-white'
                            : 'opacity-0 group-hover:opacity-100 bg-black/75 border-white/25 text-zinc-200'
                        }`}
                      >
                        {isChecked ? (
                          <CheckSquare className="w-3 h-3" />
                        ) : (
                          <Square className="w-3 h-3" />
                        )}
                      </button>
                    )}

                    {item.rating > 0 && (
                      <div className="absolute bottom-1 right-1 px-1 rounded bg-black/80 text-[10px] font-mono text-amber-300 flex items-center gap-0.5 z-10">
                        <span>★{item.rating}</span>
                      </div>
                    )}

                    {item.status === 'rejected' && (
                      <div className="absolute inset-0 bg-rose-950/65 flex items-center justify-center text-[10px] font-bold text-rose-200 pointer-events-none z-10">
                        LOẠI
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      ) : (
        <main ref={parentRef} className="flex-1 overflow-y-auto p-4 bg-[#08080A]">
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
                          className={`group relative rounded-lg bg-[#121215] border transition-colors overflow-hidden flex flex-col cursor-pointer ${
                            isSelected
                              ? 'border-amber-400 ring-2 ring-amber-400/35'
                              : isChecked
                              ? 'border-emerald-500/80 ring-1 ring-emerald-500/30'
                              : 'border-white/10 hover:border-white/25'
                          }`}
                        >
                          <div className="relative w-full aspect-4/3 bg-[#09090B] flex items-center justify-center overflow-hidden">
                            {item.mediaType === 'video' ? (
                              <>
                                <VideoThumbnailImage item={item} />
                                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/45 transition-colors flex items-center justify-center">
                                  <div className="w-11 h-11 rounded-full bg-[#121215]/90 border border-white/15 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
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
                                    : 'opacity-0 group-hover:opacity-100 bg-[#121215]/85 border-white/15 text-zinc-300 hover:text-white'
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
                                className="p-1.5 rounded-md bg-[#121215]/90 hover:bg-zinc-800 text-zinc-200 border border-white/15 shadow-xs cursor-pointer"
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
                            {editFlags.hasAnyEdit && (
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
                                    className="flex items-center gap-1 text-amber-300 shrink-0"
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
                          <div className="px-3 py-2 bg-[#121215] border-t border-white/10 flex items-center justify-between gap-2">
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
