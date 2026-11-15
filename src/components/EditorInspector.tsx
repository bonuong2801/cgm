import React, { useRef, useState } from 'react';
import {
  Check,
  Copy,
  Crop,
  Film,
  FolderSync,
  Image as ImageIcon,
  Play,
  RotateCcw,
  RotateCw,
  Sliders,
  Stamp,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_EDIT_CONFIG,
  DEFAULT_LOGO_CONFIG,
  DriveMediaItem,
  EditConfig,
  LogoConfig,
  LogoPosition,
} from '../types/media';
import { loadImageElement } from '../services/imageProcessor';
import { formatVideoDuration } from './VirtualMediaGrid';

export type LogoApplyScope = 'checked-or-all' | 'current-folder' | 'single';

interface EditorInspectorProps {
  selectedItem: DriveMediaItem | null;
  checkedCount: number;
  keptPhotoCount: number;
  currentFolderPhotoCount: number;
  globalLogo: LogoConfig;
  logoScope: LogoApplyScope;
  onChangeLogoScope: (scope: LogoApplyScope) => void;
  onBatchUpdateLogo: (
    updater: (prev: LogoConfig) => LogoConfig,
    scopeOverride?: LogoApplyScope
  ) => number;
  onUpdateEdit: (itemId: string, updater: (prev: EditConfig) => EditConfig) => void;
  onOpenCropModal: (item: DriveMediaItem) => void;
  onOpenLightbox: (item: DriveMediaItem) => void;
  onSyncCurrentFolder: (sourceEdit: EditConfig) => number;
  onSyncAllFolders: (sourceEdit: EditConfig) => number;
}

const LOGO_POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: 'top-left', label: 'Góc trên trái' },
  { value: 'top-right', label: 'Góc trên phải' },
  { value: 'center', label: 'Chính giữa' },
  { value: 'bottom-left', label: 'Góc dưới trái' },
  { value: 'bottom-right', label: 'Góc dưới phải' },
];

export const EditorInspector: React.FC<EditorInspectorProps> = ({
  selectedItem,
  checkedCount,
  keptPhotoCount,
  currentFolderPhotoCount,
  globalLogo,
  logoScope,
  onChangeLogoScope,
  onBatchUpdateLogo,
  onUpdateEdit,
  onOpenCropModal,
  onOpenLightbox,
  onSyncCurrentFolder,
  onSyncAllFolders,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const showTemporaryFeedback = (msg: string) => {
    setSyncFeedback(msg);
    window.setTimeout(() => {
      setSyncFeedback((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Active logo config to display in the Logo panel (from selected photo or global batch logo)
  const activeLogo: LogoConfig =
    selectedItem && selectedItem.mediaType === 'image'
      ? selectedItem.edit.logo
      : globalLogo;

  const handleUploadLogoFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const img = await loadImageElement(dataUrl);
        const affected = onBatchUpdateLogo((prev) => ({
          ...prev,
          enabled: true,
          dataUrl,
          fileName: file.name,
          naturalWidth: img.naturalWidth || 300,
          naturalHeight: img.naturalHeight || 100,
        }));
        showTemporaryFeedback(
          `Đã tự động gắn Logo "${file.name}" hàng loạt vào ${affected} ảnh đã chọn!`
        );
      } catch {
        // ignore invalid image
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const updateLogoField = <K extends keyof LogoConfig>(
    key: K,
    value: LogoConfig[K]
  ) => {
    onBatchUpdateLogo((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleRemoveLogo = () => {
    const affected = onBatchUpdateLogo((prev) => ({
      ...prev,
      enabled: false,
      dataUrl: null,
      fileName: null,
    }));
    showTemporaryFeedback(`Đã gỡ bỏ Logo khỏi ${affected} ảnh.`);
  };

  // Render Reusable Smart Logo Watermarking Section (works even before clicking a single photo!)
  const renderLogoSection = () => (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <Stamp className="w-3.5 h-3.5 text-emerald-400" />
          <span>Đóng dấu Logo hàng loạt</span>
        </span>
        {activeLogo.dataUrl && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={activeLogo.enabled}
              onChange={(e) => updateLogoField('enabled', e.target.checked)}
              className="accent-emerald-500 rounded cursor-pointer"
            />
            <span>Bật</span>
          </label>
        )}
      </div>

      {/* Scope Selector for Automatic Batch Logo Insertion */}
      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5">
        <span className="text-[11px] font-medium text-zinc-400 block">
          Khi tải lên hoặc chỉnh sửa Logo, tự động áp dụng cho:
        </span>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onChangeLogoScope('checked-or-all')}
            className={`w-full px-2.5 py-1.5 rounded text-xs font-medium text-left flex items-center justify-between cursor-pointer transition-colors ${
              logoScope === 'checked-or-all'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <span>
              {checkedCount > 0
                ? `Các ảnh đã đánh dấu chọn (${checkedCount} ảnh)`
                : 'Tất cả ảnh Đang giữ (Hàng loạt)'}
            </span>
            <span className="font-mono tabular-nums text-[11px]">
              {checkedCount > 0 ? checkedCount : keptPhotoCount} ảnh
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChangeLogoScope('current-folder')}
            className={`w-full px-2.5 py-1.5 rounded text-xs font-medium text-left flex items-center justify-between cursor-pointer transition-colors ${
              logoScope === 'current-folder'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <span>Toàn bộ ảnh trong Folder hiện tại</span>
            <span className="font-mono tabular-nums text-[11px]">
              {currentFolderPhotoCount} ảnh
            </span>
          </button>

          {selectedItem && selectedItem.mediaType === 'image' && (
            <button
              type="button"
              onClick={() => onChangeLogoScope('single')}
              className={`w-full px-2.5 py-1.5 rounded text-xs font-medium text-left flex items-center justify-between cursor-pointer transition-colors ${
                logoScope === 'single'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <span>Chỉ 1 ảnh đang xem</span>
              <span className="font-mono tabular-nums text-[11px]">1 ảnh</span>
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/svg+xml,image/jpeg,image/webp"
        onChange={handleUploadLogoFile}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
      >
        <Upload className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {activeLogo.dataUrl
            ? 'Đổi file Logo khác (Áp dụng hàng loạt)'
            : 'Tải Logo lên & Gắn hàng loạt ngay'}
        </span>
      </button>

      {activeLogo.dataUrl && (
        <div className="space-y-3 pt-1">
          <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={activeLogo.dataUrl}
                alt="Preview Logo"
                className="w-10 h-7 object-contain bg-zinc-900 rounded p-0.5 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-zinc-200 truncate">
                  {activeLogo.fileName || 'Logo_Da_Tai.png'}
                </div>
                <div className="text-[10px] text-emerald-400">
                  Đã đồng bộ tự động theo phạm vi chọn
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveLogo}
              className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
              title="Xóa Logo hàng loạt"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 5 Anchor Positions */}
          <div className="space-y-1.5">
            <span className="text-xs text-zinc-400 block">
              Vị trí đặt Logo
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {LOGO_POSITIONS.map((pos) => (
                <button
                  key={pos.value}
                  type="button"
                  onClick={() => updateLogoField('position', pos.value)}
                  className={`py-1.5 px-2.5 rounded-md text-xs font-medium border text-left transition-colors cursor-pointer ${
                    pos.value === 'center' ? 'col-span-2 text-center' : ''
                  } ${
                    activeLogo.position === pos.value
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scale Percent: 5% - 40% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Kích thước (theo cạnh ngắn)</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {activeLogo.scalePercent}%
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={activeLogo.scalePercent}
              onChange={(e) =>
                updateLogoField('scalePercent', Number(e.target.value))
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Margin Percent: 1% - 15% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Khoảng cách lề</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {activeLogo.marginPercent}%
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={15}
              step={1}
              value={activeLogo.marginPercent}
              onChange={(e) =>
                updateLogoField('marginPercent', Number(e.target.value))
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Opacity: 10% - 100% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ mờ</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {activeLogo.opacity}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={activeLogo.opacity}
              onChange={(e) =>
                updateLogoField('opacity', Number(e.target.value))
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>
      )}
    </section>
  );

  if (!selectedItem) {
    return (
      <aside className="w-80 bg-zinc-900 border-l border-zinc-800 p-4 flex flex-col justify-between select-none shrink-0 overflow-y-auto">
        {keptPhotoCount > 0 ? (
          <div className="space-y-4">
            {renderLogoSection()}
            {syncFeedback && (
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 leading-relaxed">
                {syncFeedback}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center items-center text-center">
            <div className="w-10 h-10 rounded-lg bg-zinc-800/80 flex items-center justify-center text-zinc-400 mb-3">
              <ImageIcon className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-zinc-300">
              Chưa chọn file phương tiện
            </p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Tải thư mục Google Drive và nhấp vào ảnh để cắt khung hình, chỉnh sáng, hoặc đóng dấu Logo hàng loạt.
            </p>
          </div>
        )}
      </aside>
    );
  }

  // Video Selected State
  if (selectedItem.mediaType === 'video') {
    return (
      <aside className="w-80 bg-zinc-900 border-l border-zinc-800 p-5 flex flex-col justify-between select-none shrink-0 overflow-y-auto">
        <div className="space-y-4">
          <div className="pb-3 border-b border-zinc-800">
            <span className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" />
              <span>Thông tin tệp Video</span>
            </span>
            <h2
              className="text-sm font-bold text-zinc-100 truncate mt-1"
              title={selectedItem.name}
            >
              {selectedItem.name}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              Thư mục: {selectedItem.folderName}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">Định dạng gốc</span>
              <span className="font-mono text-zinc-200">
                {selectedItem.mimeType}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Độ phân giải</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {selectedItem.width} × {selectedItem.height}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Thời lượng phát</span>
              <span className="font-mono tabular-nums text-emerald-400">
                {formatVideoDuration(selectedItem.durationMillis)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenLightbox(selectedItem)}
            className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Phát Video trực tiếp</span>
          </button>

          <p className="text-xs text-zinc-400 leading-relaxed pt-2">
            Tệp video được giữ nguyên chất lượng gốc và sẽ được tải trực tiếp bằng luồng Zero-RAM vào đúng thư mục con khi xuất hàng loạt.
          </p>
        </div>
      </aside>
    );
  }

  const { edit } = selectedItem;

  const handleResetAllPhotoEdits = () => {
    onUpdateEdit(selectedItem.id, () => ({
      ...DEFAULT_EDIT_CONFIG,
      logo: { ...DEFAULT_LOGO_CONFIG },
    }));
    showTemporaryFeedback('Đã đặt lại mặc định toàn bộ thông số của ảnh này.');
  };

  const handleResetColorOnly = () => {
    onUpdateEdit(selectedItem.id, (prev) => ({
      ...prev,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      warmth: 0,
    }));
  };

  return (
    <aside className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col h-full shrink-0 select-none overflow-hidden">
      {/* Inspector Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-400">
            Chỉnh sửa ảnh đang chọn
          </div>
          <div
            className="text-xs font-bold text-zinc-100 truncate mt-0.5"
            title={selectedItem.name}
          >
            {selectedItem.name}
          </div>
        </div>
        <button
          type="button"
          onClick={handleResetAllPhotoEdits}
          className="px-2.5 py-1.5 rounded-md bg-zinc-950 hover:bg-zinc-800 text-[11px] font-medium text-zinc-300 border border-zinc-800 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          title="Đặt lại toàn bộ chỉnh sửa của ảnh này về mặc định"
        >
          <RotateCcw className="w-3 h-3 text-amber-400" />
          <span>Đặt lại mặc định</span>
        </button>
      </div>

      {/* Scrollable Inspector Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Quick Zoom & Detail Inspection Trigger */}
        <button
          type="button"
          onClick={() => onOpenLightbox(selectedItem)}
          className="w-full py-2 px-3 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-semibold text-indigo-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <span>Phóng to soi chi tiết ảnh (tới 500%)</span>
          <span className="font-mono text-[11px] text-indigo-300">Phím Space</span>
        </button>

        {/* 1. Smart Batch Logo Watermarking (Moved near top for quick access) */}
        <div className="pt-1">{renderLogoSection()}</div>

        {syncFeedback && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 leading-relaxed">
            {syncFeedback}
          </div>
        )}

        {/* 2. Cropping & Quick Rotation */}
        <section className="pt-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Crop className="w-3.5 h-3.5 text-indigo-400" />
              <span>Cắt khung hình &amp; Xoay ảnh</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              {edit.aspectRatioLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onOpenCropModal(selectedItem)}
            className="w-full py-2 px-3 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-100 flex items-center justify-between cursor-pointer transition-colors"
          >
            <span>Mở bảng cắt tỷ lệ ảnh (Phím C)</span>
            <span className="text-[11px] font-mono text-indigo-400">
              {edit.cropPercent ? 'Đã cắt' : 'Gốc'}
            </span>
          </button>

          {/* 4-Step Rotation Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Xoay ảnh nhanh</span>
              <button
                type="button"
                onClick={() =>
                  onUpdateEdit(selectedItem.id, (prev) => ({
                    ...prev,
                    rotation: ((prev.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                  }))
                }
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                <RotateCw className="w-3 h-3" />
                <span>Xoay +90°</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-zinc-950 rounded-lg border border-zinc-800">
              {([0, 90, 180, 270] as const).map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() =>
                    onUpdateEdit(selectedItem.id, (prev) => ({
                      ...prev,
                      rotation: deg,
                    }))
                  }
                  className={`py-1 rounded text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                    edit.rotation === deg
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {deg}°
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Lighting & Color Adjustments */}
        <section className="pt-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Ánh sáng &amp; Màu sắc</span>
            </span>
            <button
              type="button"
              onClick={handleResetColorOnly}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Đặt lại màu
            </button>
          </div>

          {/* Brightness: 50% - 150% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ sáng</span>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-zinc-200">
                  {edit.brightness}%
                </span>
                {edit.brightness !== 100 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEdit(selectedItem.id, (p) => ({
                        ...p,
                        brightness: 100,
                      }))
                    }
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    100%
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={50}
              max={150}
              step={1}
              value={edit.brightness}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (prev) => ({
                  ...prev,
                  brightness: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Contrast: 50% - 150% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ tương phản</span>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-zinc-200">
                  {edit.contrast}%
                </span>
                {edit.contrast !== 100 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEdit(selectedItem.id, (p) => ({
                        ...p,
                        contrast: 100,
                      }))
                    }
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    100%
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={50}
              max={150}
              step={1}
              value={edit.contrast}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (prev) => ({
                  ...prev,
                  contrast: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Saturation: 0% - 200% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ bão hòa</span>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-zinc-200">
                  {edit.saturation}%
                </span>
                {edit.saturation !== 100 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEdit(selectedItem.id, (p) => ({
                        ...p,
                        saturation: 100,
                      }))
                    }
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    100%
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={edit.saturation}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (prev) => ({
                  ...prev,
                  saturation: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Warmth: 0% - 50% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ ấm</span>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-zinc-200">
                  {edit.warmth}%
                </span>
                {edit.warmth !== 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEdit(selectedItem.id, (p) => ({
                        ...p,
                        warmth: 0,
                      }))
                    }
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    0%
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={edit.warmth}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (prev) => ({
                  ...prev,
                  warmth: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>
        </section>

        {/* 4. 3-Tier Batch Sync Controls for Color & Logo */}
        <section className="pt-4 border-t border-zinc-800 space-y-2.5">
          <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
            <FolderSync className="w-3.5 h-3.5 text-indigo-400" />
            <span>Đồng bộ Màu sắc &amp; Ánh sáng</span>
          </div>

          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Logo đã tự động gắn hàng loạt theo tùy chọn phía trên</span>
          </div>

          <button
            type="button"
            onClick={() => {
              const count = onSyncCurrentFolder(edit);
              showTemporaryFeedback(
                `Đã đồng bộ Màu & Logo cho ${count} ảnh trong thư mục "${selectedItem.folderName}".`
              );
            }}
            className="w-full py-2 px-3 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Đồng bộ Màu cho cả Folder hiện tại</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const count = onSyncAllFolders(edit);
              showTemporaryFeedback(
                `Đã đồng bộ Màu & Logo cho toàn bộ ${count} ảnh đang giữ ở tất cả thư mục!`
              );
            }}
            className="w-full py-2 px-3 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-semibold text-indigo-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <FolderSync className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Đồng bộ Màu cho TẤT CẢ Folder</span>
          </button>
        </section>
      </div>
    </aside>
  );
};
