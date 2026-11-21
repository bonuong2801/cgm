import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import { Check, Crop as CropIcon, RotateCcw, X } from 'lucide-react';
import type { CropArea, DriveMediaItem } from '../types/media.ts';
import { attachAuthToStreamUrl } from '../lib/supabaseClient.ts';
import { buildImageFallbackSources } from '../utils/mediaMath.ts';

interface CropModalProps {
  item: DriveMediaItem | null;
  onClose: () => void;
  onApplyCrop: (
    itemId: string,
    payload: {
      aspectRatioLabel: string;
      aspectRatioValue: number | null;
      cropPercent: CropArea | null;
      croppedAreaPixels: CropArea | null;
    }
  ) => void;
}

interface AspectPreset {
  label: string;
  getAspect: (naturalW: number, naturalH: number) => number | undefined;
}

const ASPECT_PRESETS: AspectPreset[] = [
  {
    label: 'Tỷ lệ gốc',
    getAspect: (w, h) => (w > 0 && h > 0 ? w / h : 3 / 2),
  },
  {
    label: '1:1 (Vuông)',
    getAspect: () => 1,
  },
  {
    label: '4:5 (Dọc MXH)',
    getAspect: () => 4 / 5,
  },
  {
    label: '16:9 (Ngang)',
    getAspect: () => 16 / 9,
  },
  {
    label: '3:2 (Máy ảnh)',
    getAspect: () => 3 / 2,
  },
  {
    label: '9:16 (Story/Reels)',
    getAspect: () => 9 / 16,
  },
  {
    label: 'Tự do',
    getAspect: () => undefined,
  },
];

export const CropModal: React.FC<CropModalProps> = ({
  item,
  onClose,
  onApplyCrop,
}) => {
  // ALL React hooks MUST execute unconditionally before any early return
  const isRotatedPerpendicular =
    item?.edit.rotation === 90 || item?.edit.rotation === 270;
  const effectiveW = item
    ? isRotatedPerpendicular
      ? item.height
      : item.width
    : 1600;
  const effectiveH = item
    ? isRotatedPerpendicular
      ? item.width
      : item.height
    : 1067;

  const [selectedPresetLabel, setSelectedPresetLabel] =
    useState<string>('Tỷ lệ gốc');
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [freeWidthRatio, setFreeWidthRatio] = useState<number>(1.5);
  const [latestAreaPercent, setLatestAreaPercent] = useState<CropArea | null>(
    null
  );
  const [latestAreaPixels, setLatestAreaPixels] = useState<CropArea | null>(
    null
  );
  const [cropSrcIndex, setCropSrcIndex] = useState<number>(0);

  const cropImageSources = useMemo(() => {
    if (!item || item.mediaType !== 'image') return [];
    const streamUrl = item.isLocal
      ? item.downloadUrl
      : attachAuthToStreamUrl(item.downloadUrl);
    return buildImageFallbackSources({
      id: item.id,
      mediaType: item.mediaType,
      isLocal: item.isLocal,
      gridThumbUrl: item.gridThumbUrl,
      previewUrl: item.previewUrl,
      streamUrl,
      useHighRes: true,
    });
  }, [
    item?.id,
    item?.mediaType,
    item?.isLocal,
    item?.gridThumbUrl,
    item?.previewUrl,
    item?.downloadUrl,
  ]);

  // Sync crop modal state whenever a different photo is opened
  useEffect(() => {
    if (!item || item.mediaType !== 'image') return;
    setSelectedPresetLabel(item.edit.aspectRatioLabel || 'Tỷ lệ gốc');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropSrcIndex(0);
    setFreeWidthRatio(effectiveW / Math.max(1, effectiveH));
    setLatestAreaPercent(item.edit.cropPercent);
    setLatestAreaPixels(item.edit.croppedAreaPixels);
  }, [item?.id, effectiveW, effectiveH]);

  const onCropComplete = useCallback(
    (croppedArea: Area, croppedAreaPixels: Area) => {
      setLatestAreaPercent({
        x: croppedArea.x,
        y: croppedArea.y,
        width: croppedArea.width,
        height: croppedArea.height,
      });
      setLatestAreaPixels({
        x: croppedAreaPixels.x,
        y: croppedAreaPixels.y,
        width: croppedAreaPixels.width,
        height: croppedAreaPixels.height,
      });
    },
    []
  );

  if (!item || item.mediaType !== 'image') return null;

  const currentPreset =
    ASPECT_PRESETS.find((p) => p.label === selectedPresetLabel) ||
    ASPECT_PRESETS[0];

  const computedAspect =
    selectedPresetLabel === 'Tự do'
      ? freeWidthRatio
      : currentPreset.getAspect(effectiveW, effectiveH) || 1;

  const handleSave = () => {
    onApplyCrop(item.id, {
      aspectRatioLabel: selectedPresetLabel,
      aspectRatioValue: computedAspect ?? null,
      cropPercent: latestAreaPercent,
      croppedAreaPixels: latestAreaPixels,
    });
    onClose();
  };

  const handleResetCrop = () => {
    onApplyCrop(item.id, {
      aspectRatioLabel: 'Tỷ lệ gốc',
      aspectRatioValue: null,
      cropPercent: null,
      croppedAreaPixels: null,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cắt khung hình ảnh ${item.name}`}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[94dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-zinc-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CropIcon className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <h2 className="text-xs sm:text-sm font-bold text-zinc-100 truncate">
              Cắt khung hình — {item.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng cắt ảnh"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive Cropper Canvas */}
        <div className="relative h-[42dvh] sm:h-[52dvh] bg-zinc-950 w-full shrink-0">
          <Cropper
            image={cropImageSources[cropSrcIndex] || item.previewUrl}
            crop={crop}
            zoom={zoom}
            rotation={item.edit.rotation}
            aspect={computedAspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            mediaProps={{
              referrerPolicy: 'no-referrer',
              onError: () =>
                setCropSrcIndex((idx) =>
                  idx + 1 < cropImageSources.length ? idx + 1 : idx
                ),
            }}
            showGrid={true}
          />
        </div>

        {/* Aspect Ratio Presets & Controls */}
        <div className="p-3.5 sm:p-5 pb-safe bg-zinc-900 border-t border-zinc-800 space-y-3 sm:space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs font-semibold text-zinc-400">
                Chọn tỷ lệ khung hình chuẩn
              </span>
              {latestAreaPercent && (
                <span className="text-[11px] sm:text-xs font-mono tabular-nums text-zinc-400">
                  {Math.round((latestAreaPercent.width / 100) * effectiveW)} ×{' '}
                  {Math.round((latestAreaPercent.height / 100) * effectiveH)} px
                </span>
              )}
            </div>

            <div className="flex sm:flex-wrap items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
              {ASPECT_PRESETS.map((preset) => {
                const active = selectedPresetLabel === preset.label;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSelectedPresetLabel(preset.label)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-amber-500 text-zinc-950 font-bold border-amber-400'
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-1">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Phóng to vùng cắt (Zoom)</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {selectedPresetLabel === 'Tự do' && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">
                    Tỷ lệ ngang / dọc tùy chỉnh (Tự do)
                  </span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {freeWidthRatio.toFixed(2)} : 1
                  </span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={2.6}
                  step={0.05}
                  value={freeWidthRatio}
                  onChange={(e) => setFreeWidthRatio(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleResetCrop}
              className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Hủy vùng cắt (Về ảnh gốc)</span>
              <span className="sm:hidden">Về gốc</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 rounded-lg text-xs font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Áp dụng</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
