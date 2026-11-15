import React, { useState, useCallback } from 'react';
import Cropper, { Area, Point } from 'react-easy-crop';
import { Check, Crop as CropIcon, RotateCcw, X } from 'lucide-react';
import { CropArea, DriveMediaItem } from '../types/media';

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
    label: 'Tự do',
    getAspect: () => undefined,
  },
];

export const CropModal: React.FC<CropModalProps> = ({
  item,
  onClose,
  onApplyCrop,
}) => {
  if (!item || item.mediaType !== 'image') return null;

  const isRotatedPerpendicular =
    item.edit.rotation === 90 || item.edit.rotation === 270;
  const effectiveW = isRotatedPerpendicular ? item.height : item.width;
  const effectiveH = isRotatedPerpendicular ? item.width : item.height;

  const [selectedPresetLabel, setSelectedPresetLabel] = useState<string>(
    item.edit.aspectRatioLabel || 'Tỷ lệ gốc'
  );
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [freeWidthRatio, setFreeWidthRatio] = useState<number>(
    effectiveW / Math.max(1, effectiveH)
  );

  const [latestAreaPercent, setLatestAreaPercent] = useState<CropArea | null>(
    item.edit.cropPercent
  );
  const [latestAreaPixels, setLatestAreaPixels] = useState<CropArea | null>(
    item.edit.croppedAreaPixels
  );

  const currentPreset =
    ASPECT_PRESETS.find((p) => p.label === selectedPresetLabel) ||
    ASPECT_PRESETS[0];

  const computedAspect =
    selectedPresetLabel === 'Tự do'
      ? freeWidthRatio
      : currentPreset.getAspect(effectiveW, effectiveH) || 1;

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
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-6 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CropIcon className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-zinc-100">
              Cắt khung hình &amp; Tỷ lệ ảnh — {item.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive Cropper Canvas */}
        <div className="relative h-[52vh] bg-zinc-950 w-full">
          <Cropper
            image={item.previewUrl}
            crop={crop}
            zoom={zoom}
            rotation={item.edit.rotation}
            aspect={computedAspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            showGrid={true}
          />
        </div>

        {/* Aspect Ratio Presets & Controls */}
        <div className="p-5 bg-zinc-900 border-t border-zinc-800 space-y-4">
          {/* Aspect Ratio Buttons */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400">
                Chọn tỷ lệ khung hình chuẩn
              </span>
              {latestAreaPixels && (
                <span className="text-xs font-mono tabular-nums text-zinc-400">
                  Vùng cắt: {Math.round(latestAreaPixels.width)} ×{' '}
                  {Math.round(latestAreaPixels.height)} px
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {ASPECT_PRESETS.map((preset) => {
                const active = selectedPresetLabel === preset.label;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSelectedPresetLabel(preset.label)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Zoom & Free Aspect Ratio Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
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
                className="w-full accent-indigo-500 cursor-pointer"
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
                  min={0.5}
                  max={2.4}
                  step={0.05}
                  value={freeWidthRatio}
                  onChange={(e) => setFreeWidthRatio(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleResetCrop}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Hủy vùng cắt (Về ảnh gốc)</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Áp dụng vùng cắt</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
