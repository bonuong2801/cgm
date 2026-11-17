import React, { useRef, useState, useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  Copy,
  CopyPlus,
  Crop,
  Eye,
  EyeOff,
  Film,
  FolderSync,
  Image as ImageIcon,
  Move,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Sliders,
  SplitSquareHorizontal,
  Stamp,
  Star,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_EDIT_CONFIG,
  DriveMediaItem,
  EditConfig,
  LogoAnchorPosition,
  LogoLayer,
  LogoPosition,
  LogoSetPreset,
  StarRating,
  cloneLogoLayers,
  createLogoLayer,
} from '../types/media.ts';
import { readLogoFileToDataUrl } from '../services/imageProcessor.ts';
import {
   formatVideoDuration,
  LiveEditedPhotoPreview,
} from './VirtualMediaGrid.tsx';

export type LogoApplyScope = 'checked-or-all' | 'current-folder' | 'single';

interface EditorInspectorProps {
  selectedItem: DriveMediaItem | null;
  checkedCount: number;
  keptPhotoCount: number;
  currentFolderPhotoCount: number;
  globalLogos: LogoLayer[];
  logoPresets: LogoSetPreset[];
  onSaveLogoPreset: (name: string, logos: LogoLayer[]) => void;
  onDeleteLogoPreset: (presetId: string) => void;
  logoScope: LogoApplyScope;
  onChangeLogoScope: (scope: LogoApplyScope) => void;
  onBatchUpdateLogos: (
    updater: (prev: LogoLayer[]) => LogoLayer[],
    scopeOverride?: LogoApplyScope
  ) => number;
  onUpdateEdit: (
    itemId: string,
    updater: (prev: EditConfig) => EditConfig
  ) => void;
  onRateItem: (itemId: string, rating: StarRating) => void;
  compareOriginal: boolean;
  onCompareOriginalChange: (comparing: boolean) => void;
  onOpenCropModal: (item: DriveMediaItem) => void;
  onOpenLightbox: (item: DriveMediaItem) => void;
  onSyncCheckedPhotos: (sourceEdit: EditConfig) => number;
  onSyncCurrentFolder: (sourceEdit: EditConfig) => number;
  onSyncAllFolders: (sourceEdit: EditConfig) => number;
}

const ANCHOR_GRID_3X3: { value: LogoAnchorPosition; short: string; label: string }[] = [
  { value: 'top-left', short: '↖ Trên-Trái', label: 'Góc trên trái' },
  { value: 'top-center', short: '↑ Giữa-Trên', label: 'Chính giữa trên' },
  { value: 'top-right', short: '↗ Trên-Phải', label: 'Góc trên phải' },
  { value: 'middle-left', short: '← Trái-Giữa', label: 'Cạnh trái giữa' },
  { value: 'center', short: '┼ Chính giữa', label: 'Chính giữa ảnh' },
  { value: 'middle-right', short: '→ Phải-Giữa', label: 'Cạnh phải giữa' },
  { value: 'bottom-left', short: '↙ Dưới-Trái', label: 'Góc dưới trái' },
  { value: 'bottom-center', short: '↓ Giữa-Dưới', label: 'Chính giữa dưới' },
  { value: 'bottom-right', short: '↘ Dưới-Phải', label: 'Góc dưới phải' },
];

export function formatLogoPositionBadge(pos: LogoPosition, xPct: number, yPct: number): string {
  if (pos === 'custom') {
    return `Tự do (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;
  }
  return ANCHOR_GRID_3X3.find((a) => a.value === pos)?.label || pos;
}

export const EditorInspector: React.FC<EditorInspectorProps> = ({
  selectedItem,
  checkedCount,
  keptPhotoCount,
  currentFolderPhotoCount,
  globalLogos,
  logoPresets,
  onSaveLogoPreset,
  onDeleteLogoPreset,
  logoScope,
  onChangeLogoScope,
  onBatchUpdateLogos,
  onUpdateEdit,
  onRateItem,
  compareOriginal,
  onCompareOriginalChange,
  onOpenCropModal,
  onOpenLightbox,
  onSyncCheckedPhotos,
  onSyncCurrentFolder,
  onSyncAllFolders,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceLayerInputRef = useRef<HTMLInputElement | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [presetNameInput, setPresetNameInput] = useState<string>('');
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const showTemporaryFeedback = (msg: string) => {
    setSyncFeedback(msg);
    window.setTimeout(() => {
      setSyncFeedback((prev) => (prev === msg ? null : prev));
    }, 3400);
  };

  // Active logo stack displayed in Inspector
  const activeLogosStack: LogoLayer[] =
    selectedItem && selectedItem.mediaType === 'image'
      ? selectedItem.edit.logos
      : globalLogos;

  // Keep activeLayerId valid whenever logo stack changes
  useEffect(() => {
    if (activeLogosStack.length === 0) {
      setActiveLayerId(null);
      return;
    }
    if (!activeLogosStack.some((l) => l.id === activeLayerId)) {
      setActiveLayerId(activeLogosStack[activeLogosStack.length - 1].id);
    }
  }, [activeLogosStack, activeLayerId]);

  const activeLayer =
    activeLogosStack.find((l) => l.id === activeLayerId) ||
    activeLogosStack[0] ||
    null;

  // Upload 1 or MULTIPLE logo files simultaneously and composite them onto the photo!
  const handleAddLogoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = '';

    try {
      const decodedList = await Promise.all(
        files.map(async (f) => ({
          fileName: f.name,
          ...(await readLogoFileToDataUrl(f)),
        }))
      );

      let newestId: string | null = null;
      const affected = onBatchUpdateLogos((prev) => {
        const next = cloneLogoLayers(prev);
        for (const d of decodedList) {
          const layer = createLogoLayer(
            {
              dataUrl: d.dataUrl,
              fileName: d.fileName,
              naturalWidth: d.naturalWidth,
              naturalHeight: d.naturalHeight,
            },
            next.length
          );
          newestId = layer.id;
          next.push(layer);
        }
        return next;
      });

      if (newestId) setActiveLayerId(newestId);
      showTemporaryFeedback(
        decodedList.length > 1
          ? `Đã ghép đồng thời ${decodedList.length} Logo mới vào ${affected} ảnh!`
          : `Đã thêm lớp Logo "${decodedList[0].fileName}" vào ${affected} ảnh!`
      );
    } catch {
      showTemporaryFeedback('Không thể đọc định dạng file Logo đã chọn.');
    }
  };

  const handleReplaceSelectedLayerFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeLayer) return;

    try {
      const decoded = await readLogoFileToDataUrl(file);
      const targetId = activeLayer.id;
      const affected = onBatchUpdateLogos((prev) =>
        prev.map((l) =>
          l.id === targetId
            ? {
                ...l,
                dataUrl: decoded.dataUrl,
                fileName: file.name,
                naturalWidth: decoded.naturalWidth,
                naturalHeight: decoded.naturalHeight,
                enabled: true,
              }
            : { ...l }
        )
      );
      showTemporaryFeedback(
        `Đã thay thế hình Logo "${file.name}" trên ${affected} ảnh.`
      );
    } catch {
      // ignore
    }
  };

  const updateLayerById = (
    layerId: string,
    patcher: (layer: LogoLayer) => LogoLayer
  ) => {
    onBatchUpdateLogos((prev) =>
      prev.map((l) => (l.id === layerId ? patcher(l) : { ...l }))
    );
  };

  const handleDuplicateLayer = (layer: LogoLayer) => {
    let dupId = '';
    onBatchUpdateLogos((prev) => {
      const dup = createLogoLayer(
        {
          ...layer,
          id: undefined,
          fileName: `${layer.fileName} (Bản sao)`,
          position: undefined,
        },
        prev.length
      );
      dupId = dup.id;
      return [...cloneLogoLayers(prev), dup];
    });
    if (dupId) setActiveLayerId(dupId);
  };

  const handleMoveLayerOrder = (layerId: string, dir: -1 | 1) => {
    onBatchUpdateLogos((prev) => {
      const next = cloneLogoLayers(prev);
      const idx = next.findIndex((l) => l.id === layerId);
      const swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= next.length) return next;
      const tmp = next[idx];
      next[idx] = next[swapIdx];
      next[swapIdx] = tmp;
      return next;
    });
  };

  const handleDeleteLayer = (layerId: string) => {
    const affected = onBatchUpdateLogos((prev) =>
      prev.filter((l) => l.id !== layerId).map((l) => ({ ...l }))
    );
    showTemporaryFeedback(`Đã xóa 1 lớp Logo trên ${affected} ảnh.`);
  };

  const handleClearAllLogos = () => {
    const affected = onBatchUpdateLogos(() => []);
    showTemporaryFeedback(`Đã gỡ toàn bộ các lớp Logo khỏi ${affected} ảnh.`);
  };

  const handleInteractiveDragLogo = (
    logoId: string,
    customXPercent: number,
    customYPercent: number
  ) => {
    updateLayerById(logoId, (l) => ({
      ...l,
      position: 'custom',
      customXPercent,
      customYPercent,
    }));
  };

  const handleSaveCurrentSetAsPreset = () => {
    if (activeLogosStack.length === 0) return;
    const label =
      presetNameInput.trim() ||
      `Bộ ${activeLogosStack.length} Logo (${new Date().toLocaleDateString('vi-VN')})`;
    onSaveLogoPreset(label, activeLogosStack);
    setPresetNameInput('');
    showTemporaryFeedback(`Đã lưu mẫu "${label}" vào bộ nhớ trình duyệt!`);
  };

  const handleApplySavedPreset = (preset: LogoSetPreset) => {
    const cloned = cloneLogoLayers(preset.logos);
    const affected = onBatchUpdateLogos(() => cloned);
    if (cloned[0]) setActiveLayerId(cloned[0].id);
    showTemporaryFeedback(
      `Đã áp dụng mẫu "${preset.name}" (${cloned.length} Logo) vào ${affected} ảnh!`
    );
  };

  const renderMultiLogoComposer = () => (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
          <Stamp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
          <span>Ghép nhiều Logo ({activeLogosStack.length} lớp)</span>
        </span>
        {activeLogosStack.length > 0 && (
          <button
            type="button"
            onClick={handleClearAllLogos}
            className="text-[11px] text-zinc-500 hover:text-rose-400 cursor-pointer"
          >
            Xóa hết
          </button>
        )}
      </div>

      {/* Interactive Drag Canvas Preview right inside Inspector */}
      {selectedItem &&
        selectedItem.mediaType === 'image' &&
        activeLogosStack.length > 0 && (
          <div className="space-y-1">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 flex flex-col items-center">
              <LiveEditedPhotoPreview
                item={selectedItem}
                useHighRes={false}
                showOriginal={compareOriginal}
                activeLogoId={activeLayer?.id || null}
                onSelectLogoLayer={setActiveLayerId}
                onInteractiveMoveLogo={handleInteractiveDragLogo}
                className="max-h-40 w-full rounded"
              />
            </div>
            <p className="text-[10px] text-emerald-400/90 flex items-center gap-1">
              <Move className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>
                Mẹo: Nhấp và kéo trực tiếp từng Logo trên khung này (hoặc phím Space) để đặt vị trí tự do!
              </span>
            </p>
          </div>
        )}

      {/* Batch Scope Selector */}
      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5">
        <span className="text-[11px] font-medium text-zinc-400 block">
          Tự động áp dụng bộ Logo này cho:
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
            <span className="truncate pr-2">
              {checkedCount > 0
                ? `Các ảnh đã tích chọn (${checkedCount})`
                : 'Tất cả ảnh Đang giữ'}
            </span>
            <span className="font-mono tabular-nums text-[11px] shrink-0">
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
            <span>Toàn bộ Folder hiện tại</span>
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

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/svg+xml,image/jpeg,image/webp"
        onChange={handleAddLogoFiles}
        className="hidden"
      />
      <input
        ref={replaceLayerInputRef}
        type="file"
        accept="image/png,image/svg+xml,image/jpeg,image/webp"
        onChange={handleReplaceSelectedLayerFile}
        className="hidden"
      />

      {/* Add 1 or Multiple Logos Button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs"
      >
        <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {activeLogosStack.length > 0
            ? 'Thêm Logo khác vào cùng bức ảnh'
            : 'Tải lên 1 hoặc nhiều Logo cùng lúc'}
        </span>
      </button>

      {/* Multi-Logo Layer Stack List */}
      {activeLogosStack.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-zinc-400 flex items-center justify-between">
            <span>Các lớp Logo trên ảnh (nhấp để chỉnh riêng):</span>
            <span className="font-mono text-zinc-500">
              {activeLogosStack.filter((l) => l.enabled).length}/
              {activeLogosStack.length} bật
            </span>
          </div>

          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
            {activeLogosStack.map((layer, idx) => {
              const isSelected = activeLayer?.id === layer.id;
              return (
                <div
                  key={layer.id}
                  onClick={() => setActiveLayerId(layer.id)}
                  className={`p-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-emerald-500/12 border-emerald-500/45'
                      : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-zinc-500 w-3.5 shrink-0">
                      #{idx + 1}
                    </span>
                    <img
                      src={layer.dataUrl}
                      alt={layer.fileName}
                      className={`w-9 h-7 object-contain bg-zinc-900 rounded p-0.5 shrink-0 ${
                        layer.enabled ? '' : 'opacity-35 grayscale'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-zinc-200 truncate">
                        {layer.fileName}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {formatLogoPositionBadge(
                          layer.position,
                          layer.customXPercent,
                          layer.customYPercent
                        )}{' '}
                        · {layer.scalePercent}%
                      </div>
                    </div>
                  </div>

                  {/* Layer Action Icons */}
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        updateLayerById(layer.id, (l) => ({
                          ...l,
                          enabled: !l.enabled,
                        }))
                      }
                      aria-label={layer.enabled ? 'Ẩn lớp Logo' : 'Hiện lớp Logo'}
                      title={layer.enabled ? 'Tạm ẩn Logo này' : 'Bật lại Logo này'}
                      className="p-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                    >
                      {layer.enabled ? (
                        <Eye className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-zinc-600" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDuplicateLayer(layer)}
                      aria-label="Nhân bản lớp Logo"
                      title="Nhân bản thêm 1 Logo giống hệt"
                      className="p-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                    </button>

                    {activeLogosStack.length > 1 && (
                      <>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveLayerOrder(layer.id, -1)}
                          aria-label="Đưa lớp xuống dưới"
                          title="Đổi thứ tự lớp"
                          className="p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-25 cursor-pointer"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === activeLogosStack.length - 1}
                          onClick={() => handleMoveLayerOrder(layer.id, 1)}
                          aria-label="Đưa lớp lên trên"
                          title="Đổi thứ tự lớp"
                          className="p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-25 cursor-pointer"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteLayer(layer.id)}
                      aria-label="Xóa lớp Logo"
                      title="Xóa lớp Logo này"
                      className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Logo Layer Detailed Controls */}
      {activeLayer && (
        <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-emerald-300 truncate">
              Đang chỉnh: {activeLayer.fileName}
            </span>
            <button
              type="button"
              onClick={() => replaceLayerInputRef.current?.click()}
              className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer shrink-0"
            >
              Đổi ảnh khác
            </button>
          </div>

          {/* 3x3 Visual Anchor Grid */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Vị trí đặt lớp Logo này</span>
              {activeLayer.position === 'custom' && (
                <span className="text-[10px] font-mono text-emerald-400">
                  Kéo tự do
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {ANCHOR_GRID_3X3.map((pos) => (
                <button
                  key={pos.value}
                  type="button"
                  onClick={() =>
                    updateLayerById(activeLayer.id, (l) => ({
                      ...l,
                      position: pos.value,
                    }))
                  }
                  title={pos.label}
                  className={`py-1.5 px-1.5 rounded text-[11px] font-medium border text-center transition-colors cursor-pointer truncate ${
                    activeLayer.position === pos.value
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/45'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {pos.short}
                </button>
              ))}
            </div>
          </div>

          {/* Custom X/Y Sliders when in Free-Drag Custom Position */}
          {activeLayer.position === 'custom' ? (
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">Tọa độ Ngang (X)</span>
                  <span className="font-mono text-zinc-200">
                    {Math.round(activeLayer.customXPercent)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={activeLayer.customXPercent}
                  onChange={(e) =>
                    updateLayerById(activeLayer.id, (l) => ({
                      ...l,
                      customXPercent: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">Tọa độ Dọc (Y)</span>
                  <span className="font-mono text-zinc-200">
                    {Math.round(activeLayer.customYPercent)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={activeLayer.customYPercent}
                  onChange={(e) =>
                    updateLayerById(activeLayer.id, (l) => ({
                      ...l,
                      customYPercent: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>
          ) : (
            /* Margin Percent when anchored to 3x3 grid */
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Khoảng cách lề</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {activeLayer.marginPercent}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={activeLayer.marginPercent}
                onChange={(e) =>
                  updateLayerById(activeLayer.id, (l) => ({
                    ...l,
                    marginPercent: Number(e.target.value),
                  }))
                }
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>
          )}

          {/* Scale Percent: 4% - 50% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Kích thước (theo cạnh ngắn)</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {activeLayer.scalePercent}%
              </span>
            </div>
            <input
              type="range"
              min={4}
              max={50}
              step={1}
              value={activeLayer.scalePercent}
              onChange={(e) =>
                updateLayerById(activeLayer.id, (l) => ({
                  ...l,
                  scalePercent: Number(e.target.value),
                }))
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Opacity: 10% - 100% */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ mờ</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {activeLayer.opacity}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={activeLayer.opacity}
              onChange={(e) =>
                updateLayerById(activeLayer.id, (l) => ({
                  ...l,
                  opacity: Number(e.target.value),
                }))
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Saved Multi-Logo Set Presets (IndexedDB) */}
      {(activeLogosStack.length > 0 || logoPresets.length > 0) && (
        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
          <div className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
            <BookmarkCheck
              className="w-3.5 h-3.5 text-indigo-400"
              aria-hidden="true"
            />
            <span>Bộ Logo mẫu của Studio ({logoPresets.length})</span>
          </div>

          {activeLogosStack.length > 0 && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={presetNameInput}
                onChange={(e) => setPresetNameInput(e.target.value)}
                placeholder="Tên mẫu (VD: Hội nghị 3 tài trợ)..."
                aria-label="Tên bộ Logo mẫu"
                className="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleSaveCurrentSetAsPreset}
                className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-[11px] font-medium text-white flex items-center gap-1 shrink-0 cursor-pointer"
                title="Lưu bố cục nhiều Logo hiện tại để dùng lại lần sau"
              >
                <BookmarkPlus className="w-3 h-3" />
                <span>Lưu</span>
              </button>
            </div>
          )}

          {logoPresets.length > 0 && (
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {logoPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-zinc-900 border border-zinc-800/80 text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => handleApplySavedPreset(preset)}
                    className="flex-1 text-left text-zinc-300 hover:text-emerald-300 truncate cursor-pointer"
                    title={`Áp dụng bộ "${preset.name}"`}
                  >
                    {preset.name}{' '}
                    <span className="text-zinc-500 font-mono">
                      ({preset.logos.length} Logo)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteLogoPreset(preset.id)}
                    aria-label={`Xóa mẫu ${preset.name}`}
                    className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );

  if (!selectedItem) {
    return (
      <aside className="w-82 bg-zinc-900 border-l border-zinc-800 p-4 flex flex-col justify-between select-none shrink-0 overflow-y-auto">
        {keptPhotoCount > 0 || logoPresets.length > 0 ? (
          <div className="space-y-4">
            {renderMultiLogoComposer()}
            {syncFeedback && (
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 leading-relaxed">
                {syncFeedback}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center items-center text-center">
            <div className="w-10 h-10 rounded-lg bg-zinc-800/80 flex items-center justify-center text-zinc-400 mb-3">
              <ImageIcon className="w-5 h-5" aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold text-zinc-300">
              Chưa chọn file phương tiện
            </p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Tải ảnh từ máy tính hoặc Google Drive để cắt khung, chỉnh màu và ghép nhiều Logo lên cùng 1 bức ảnh.
            </p>
          </div>
        )}
      </aside>
    );
  }

  if (selectedItem.mediaType === 'video') {
    return (
      <aside className="w-82 bg-zinc-900 border-l border-zinc-800 p-5 flex flex-col justify-between select-none shrink-0 overflow-y-auto">
        <div className="space-y-4">
          <div className="pb-3 border-b border-zinc-800">
            <span className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" aria-hidden="true" />
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
            <Play className="w-3.5 h-3.5 fill-white" aria-hidden="true" />
            <span>Phát Video trực tiếp (Hỗ trợ tua nhanh)</span>
          </button>
        </div>
      </aside>
    );
  }

  const { edit } = selectedItem;

  const handleResetAllPhotoEdits = () => {
    onUpdateEdit(selectedItem.id, () => ({
      ...DEFAULT_EDIT_CONFIG,
      logos: [],
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
    <aside className="w-82 bg-zinc-900 border-l border-zinc-800 flex flex-col h-full shrink-0 select-none overflow-hidden">
      {/* Inspector Header + Star Rating */}
      <div className="p-3.5 border-b border-zinc-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div
              className="text-xs font-bold text-zinc-100 truncate"
              title={selectedItem.name}
            >
              {selectedItem.name}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">
              {selectedItem.folderName} · {selectedItem.width}×
              {selectedItem.height}
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetAllPhotoEdits}
            className="px-2 py-1 rounded-md bg-zinc-950 hover:bg-zinc-800 text-[11px] font-medium text-zinc-300 border border-zinc-800 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Đặt lại toàn bộ chỉnh sửa của ảnh này"
          >
            <RotateCcw className="w-3 h-3 text-amber-400" />
            <span>Reset</span>
          </button>
        </div>

        {/* Star Rating Bar + Before/After Hold Button */}
        <div className="flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-0.5"
            role="group"
            aria-label="Chấm sao cho ảnh"
          >
            {([1, 2, 3, 4, 5] as StarRating[]).map((star) => (
              <button
                key={star}
                type="button"
                onClick={() =>
                  onRateItem(
                    selectedItem.id,
                    selectedItem.rating === star ? 0 : star
                  )
                }
                aria-label={`${star} sao`}
                title={`Chấm ${star} sao (Phím ${star})`}
                className="p-1 rounded hover:bg-zinc-800 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    selectedItem.rating >= star
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-zinc-600'
                  }`}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onPointerDown={() => onCompareOriginalChange(true)}
            onPointerUp={() => onCompareOriginalChange(false)}
            onPointerLeave={() => onCompareOriginalChange(false)}
            className={`px-2 py-1 rounded text-[11px] font-medium border flex items-center gap-1 cursor-pointer transition-colors ${
              compareOriginal
                ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:text-white'
            }`}
            title="Nhấn giữ chuột (hoặc giữ phím \) để so sánh với ảnh gốc chưa sửa"
          >
            <SplitSquareHorizontal className="w-3 h-3 text-sky-400" />
            <span>Giữ xem gốc (\)</span>
          </button>
        </div>
      </div>

      {/* Scrollable Inspector Controls */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
        <button
          type="button"
          onClick={() => onOpenLightbox(selectedItem)}
          className="w-full py-2 px-3 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-semibold text-indigo-200 flex items-center justify-between cursor-pointer transition-colors"
        >
          <span>Mở màn hình lớn &amp; kéo đặt Logo</span>
          <span className="font-mono text-[11px] text-indigo-300">Space</span>
        </button>

        {/* 1. Multi-Logo Layer Composer */}
        <div>{renderMultiLogoComposer()}</div>

        {syncFeedback && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 leading-relaxed">
            {syncFeedback}
          </div>
        )}

        {/* 2. Cropping & Rotation */}
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Xoay ảnh nhanh</span>
              <button
                type="button"
                onClick={() =>
                  onUpdateEdit(selectedItem.id, (prev) => ({
                    ...prev,
                    rotation: ((prev.rotation + 90) % 360) as
                      | 0
                      | 90
                      | 180
                      | 270,
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

        {/* 3. Lighting & Natural Color Temperature */}
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

          {/* Brightness */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ sáng</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {edit.brightness}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={150}
              step={1}
              value={edit.brightness}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (p) => ({
                  ...p,
                  brightness: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Contrast */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ tương phản</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {edit.contrast}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={150}
              step={1}
              value={edit.contrast}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (p) => ({
                  ...p,
                  contrast: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Saturation */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Độ bão hòa</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {edit.saturation}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={edit.saturation}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (p) => ({
                  ...p,
                  saturation: Number(e.target.value),
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Natural Color Temperature: -50 (Cool) to +50 (Warm) */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Nhiệt độ màu (Lạnh ↔ Ấm)</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {edit.warmth > 0 ? `+${edit.warmth}` : edit.warmth}
              </span>
            </div>
            <input
              type="range"
              min={-50}
              max={50}
              step={1}
              value={edit.warmth}
              onChange={(e) =>
                onUpdateEdit(selectedItem.id, (p) => ({
                  ...p,
                  warmth: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </section>

        {/* 4. Batch Sync Controls (Checked Photos / Current Folder / All Folders) */}
        <section className="pt-4 border-t border-zinc-800 space-y-2">
          <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
            <FolderSync className="w-3.5 h-3.5 text-indigo-400" />
            <span>Đồng bộ Màu &amp; Bộ Logo hàng loạt</span>
          </div>

          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Giữ nguyên vùng cắt (Crop) riêng của từng tấm ảnh</span>
          </div>

          {checkedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                const count = onSyncCheckedPhotos(edit);
                showTemporaryFeedback(
                  `Đã đồng bộ Màu & ${edit.logos.length} lớp Logo cho ${count} ảnh đã tích chọn!`
                );
              }}
              className="w-full py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-xs font-semibold text-emerald-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Đồng bộ cho {checkedCount} ảnh đã tích chọn</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const count = onSyncCurrentFolder(edit);
              showTemporaryFeedback(
                `Đã đồng bộ Màu & ${edit.logos.length} lớp Logo cho ${count} ảnh trong "${selectedItem.folderName}".`
              );
            }}
            className="w-full py-2 px-3 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Đồng bộ cho cả Folder hiện tại</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const count = onSyncAllFolders(edit);
              showTemporaryFeedback(
                `Đã đồng bộ Màu & ${edit.logos.length} lớp Logo cho toàn bộ ${count} ảnh đang giữ!`
              );
            }}
            className="w-full py-2 px-3 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-semibold text-indigo-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <FolderSync className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Đồng bộ cho TẤT CẢ Folder</span>
          </button>
        </section>
      </div>
    </aside>
  );
};
