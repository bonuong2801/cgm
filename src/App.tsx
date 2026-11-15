import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AlertCircle, X } from 'lucide-react';
import {
  CropArea,
  CullingStatus,
  DriveFolder,
  DriveMediaItem,
  EditConfig,
  MediaTypeFilter,
} from './types/media';
import { crawlGoogleDriveFolder } from './services/driveApi';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TopBar } from './components/TopBar';
import { FolderSidebar } from './components/FolderSidebar';
import { VirtualMediaGrid } from './components/VirtualMediaGrid';
import { EditorInspector } from './components/EditorInspector';
import { LightboxModal } from './components/LightboxModal';
import { CropModal } from './components/CropModal';
import { ExportModal } from './components/ExportModal';

export default function App() {
  const driveInputRef = useRef<HTMLInputElement | null>(null);

  const [driveUrlInput, setDriveUrlInput] = useState<string>('');
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [items, setItems] = useState<DriveMediaItem[]>([]);

  // Filtering & View State
  const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL');
  const [mediaTypeFilter, setMediaTypeFilter] =
    useState<MediaTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<CullingStatus>('kept');
  const [gridColumns, setGridColumns] = useState<number>(4);

  // Selection & Modals
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  const [cropModalItemId, setCropModalItemId] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  // Undo History for Soft-Delete Culling
  const [rejectedHistoryIds, setRejectedHistoryIds] = useState<string[]>([]);

  // Async Loading & Error Banner
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatusText, setLoadingStatusText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Combined 3-Way Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedFolderId !== 'ALL' && item.folderId !== selectedFolderId) {
        return false;
      }
      if (mediaTypeFilter !== 'all' && item.mediaType !== mediaTypeFilter) {
        return false;
      }
      if (item.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [items, selectedFolderId, mediaTypeFilter, statusFilter]);

  // Keep selectedItemId valid when filters change
  useEffect(() => {
    if (filteredItems.length === 0) {
      return;
    }
    const stillVisible = filteredItems.some((i) => i.id === selectedItemId);
    if (!stillVisible) {
      setSelectedItemId(filteredItems[0].id);
    }
  }, [filteredItems, selectedItemId]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) || null,
    [items, selectedItemId]
  );

  const lightboxItem = useMemo(
    () => items.find((i) => i.id === lightboxItemId) || null,
    [items, lightboxItemId]
  );

  const cropModalItem = useMemo(
    () => items.find((i) => i.id === cropModalItemId) || null,
    [items, cropModalItemId]
  );

  const selectedFolderName = useMemo(() => {
    if (selectedFolderId === 'ALL') return 'Tất cả thư mục';
    return (
      folders.find((f) => f.id === selectedFolderId)?.name || 'Thư mục con'
    );
  }, [folders, selectedFolderId]);

  // Load Public Google Drive Folder Link
  const handleLoadDriveUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!driveUrlInput.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setLoadingStatusText('Đang kết nối Google Drive API v3...');

    try {
      const result = await crawlGoogleDriveFolder(driveUrlInput, (msg) =>
        setLoadingStatusText(msg)
      );
      setFolders(result.folders);
      setItems(result.items);
      setSelectedFolderId('ALL');
      setStatusFilter('kept');
      setRejectedHistoryIds([]);
      setSelectedItemId(result.items[0]?.id || null);
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          'Không thể tải thư mục Google Drive. Vui lòng kiểm tra quyền chia sẻ công khai.'
      );
    } finally {
      setIsLoading(false);
      setLoadingStatusText('');
    }
  };

  // Soft-Delete Culling: Toggle Kept / Rejected
  const handleToggleRejectStatus = useCallback(
    (targetItem: DriveMediaItem, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();

      const currentIdxInFiltered = filteredItems.findIndex(
        (i) => i.id === targetItem.id
      );
      const nextCandidate =
        filteredItems[currentIdxInFiltered + 1] ||
        filteredItems[currentIdxInFiltered - 1] ||
        null;

      const newStatus: CullingStatus =
        targetItem.status === 'kept' ? 'rejected' : 'kept';

      setItems((prev) =>
        prev.map((i) =>
          i.id === targetItem.id ? { ...i, status: newStatus } : i
        )
      );

      if (newStatus === 'rejected') {
        setRejectedHistoryIds((prev) => [...prev, targetItem.id]);
      } else {
        setRejectedHistoryIds((prev) =>
          prev.filter((id) => id !== targetItem.id)
        );
      }

      // Automatically advance selection and Lightbox to next item
      if (nextCandidate) {
        if (selectedItemId === targetItem.id) {
          setSelectedItemId(nextCandidate.id);
        }
        if (lightboxItemId === targetItem.id) {
          setLightboxItemId(nextCandidate.id);
        }
      } else if (lightboxItemId === targetItem.id) {
        setLightboxItemId(null);
      }
    },
    [filteredItems, selectedItemId, lightboxItemId]
  );

  // Undo Last Rejection (Shortcut: Z)
  const handleUndoLastReject = useCallback(() => {
    if (rejectedHistoryIds.length === 0) return;
    const lastId = rejectedHistoryIds[rejectedHistoryIds.length - 1];

    setItems((prev) =>
      prev.map((i) => (i.id === lastId ? { ...i, status: 'kept' } : i))
    );
    setRejectedHistoryIds((prev) => prev.slice(0, -1));
    setSelectedItemId(lastId);
  }, [rejectedHistoryIds]);

  // Navigate Previous / Next Item
  const handleNavigate = useCallback(
    (direction: -1 | 1) => {
      if (filteredItems.length === 0) return;
      const activeId = lightboxItemId || selectedItemId;
      const idx = filteredItems.findIndex((i) => i.id === activeId);
      const nextIdx =
        idx === -1
          ? 0
          : (idx + direction + filteredItems.length) % filteredItems.length;
      const target = filteredItems[nextIdx];
      if (!target) return;

      setSelectedItemId(target.id);
      if (lightboxItemId) {
        setLightboxItemId(target.id);
      }
    },
    [filteredItems, lightboxItemId, selectedItemId]
  );

  // Update Photo EditConfig
  const handleUpdateEdit = useCallback(
    (itemId: string, updater: (prev: EditConfig) => EditConfig) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, edit: updater(item.edit) } : item
        )
      );
    },
    []
  );

  // Apply Crop from CropModal
  const handleApplyCrop = useCallback(
    (
      itemId: string,
      payload: {
        aspectRatioLabel: string;
        aspectRatioValue: number | null;
        cropPercent: CropArea | null;
        croppedAreaPixels: CropArea | null;
      }
    ) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                edit: {
                  ...item.edit,
                  aspectRatioLabel: payload.aspectRatioLabel,
                  aspectRatioValue: payload.aspectRatioValue,
                  cropPercent: payload.cropPercent,
                  croppedAreaPixels: payload.croppedAreaPixels,
                },
              }
            : item
        )
      );
    },
    []
  );

  // Tier 2 Batch Sync: Sync Color + Logo to all kept photos in active folder (preserving individual Crop)
  const handleSyncCurrentFolder = useCallback(
    (sourceEdit: EditConfig): number => {
      const targetFolderId =
        selectedFolderId !== 'ALL'
          ? selectedFolderId
          : selectedItem?.folderId || '';
      if (!targetFolderId) return 0;

      let count = 0;
      setItems((prev) =>
        prev.map((item) => {
          if (
            item.mediaType === 'image' &&
            item.status === 'kept' &&
            item.folderId === targetFolderId
          ) {
            count += 1;
            return {
              ...item,
              edit: {
                ...item.edit,
                brightness: sourceEdit.brightness,
                contrast: sourceEdit.contrast,
                saturation: sourceEdit.saturation,
                warmth: sourceEdit.warmth,
                logo: { ...sourceEdit.logo },
              },
            };
          }
          return item;
        })
      );
      return count;
    },
    [selectedFolderId, selectedItem]
  );

  // Tier 3 Batch Sync: Sync Color + Logo across ALL kept photos in all folders (preserving individual Crop)
  const handleSyncAllFolders = useCallback((sourceEdit: EditConfig): number => {
    let count = 0;
    setItems((prev) =>
      prev.map((item) => {
        if (item.mediaType === 'image' && item.status === 'kept') {
          count += 1;
          return {
            ...item,
            edit: {
              ...item.edit,
              brightness: sourceEdit.brightness,
              contrast: sourceEdit.contrast,
              saturation: sourceEdit.saturation,
              warmth: sourceEdit.warmth,
              logo: { ...sourceEdit.logo },
            },
          };
        }
        return item;
      })
    );
    return count;
  }, []);

  // Register Global Keyboard Shortcuts
  useKeyboardShortcuts({
    onPrevItem: () => handleNavigate(-1),
    onNextItem: () => handleNavigate(1),
    onRejectCurrent: () => {
      const activeId = lightboxItemId || selectedItemId;
      const target = items.find((i) => i.id === activeId);
      if (target) {
        handleToggleRejectStatus(target);
      }
    },
    onUndoLastReject: handleUndoLastReject,
    onOpenCropModal: () => {
      const activeId = lightboxItemId || selectedItemId;
      const target = items.find((i) => i.id === activeId);
      if (target && target.mediaType === 'image') {
        setCropModalItemId(target.id);
      }
    },
    onCloseModal: () => {
      if (cropModalItemId) {
        setCropModalItemId(null);
      } else if (lightboxItemId) {
        setLightboxItemId(null);
      } else if (isExportModalOpen) {
        setIsExportModalOpen(false);
      }
    },
    isAnyModalOpen: Boolean(
      cropModalItemId || lightboxItemId || isExportModalOpen
    ),
  });

  const totalKeptCount = useMemo(
    () => items.filter((i) => i.status === 'kept').length,
    [items]
  );

  const currentLightboxIndex = useMemo(() => {
    if (!lightboxItemId) return 0;
    const idx = filteredItems.findIndex((i) => i.id === lightboxItemId);
    return idx >= 0 ? idx : 0;
  }, [filteredItems, lightboxItemId]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Top Studio Bar */}
      <TopBar
        inputRef={driveInputRef}
        driveUrlInput={driveUrlInput}
        onDriveUrlChange={setDriveUrlInput}
        onLoadDriveUrl={handleLoadDriveUrl}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        isLoading={isLoading}
        keptCount={totalKeptCount}
        totalCount={items.length}
        canUndoReject={rejectedHistoryIds.length > 0}
        onUndoReject={handleUndoLastReject}
      />

      {/* Actionable Vietnamese Error / Status Banner */}
      {errorMessage && (
        <div className="bg-rose-500/15 border-b border-rose-500/30 px-5 py-2.5 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-300 hover:text-white p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isLoading && loadingStatusText && (
        <div className="bg-indigo-500/15 border-b border-indigo-500/30 px-5 py-2 text-xs text-indigo-200 flex items-center justify-center shrink-0">
          {loadingStatusText}
        </div>
      )}

      {/* 3-Pane Studio Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Pane: Folder Hierarchy & 3-Way Filters */}
        <FolderSidebar
          folders={folders}
          items={items}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          mediaTypeFilter={mediaTypeFilter}
          onSelectMediaType={setMediaTypeFilter}
          statusFilter={statusFilter}
          onSelectStatusFilter={setStatusFilter}
          gridColumns={gridColumns}
          onChangeGridColumns={setGridColumns}
        />

        {/* Center Pane: 60fps Virtualized Media Grid */}
        <VirtualMediaGrid
          items={filteredItems}
          selectedItemId={selectedItemId}
          onSelectItem={(item) => setSelectedItemId(item.id)}
          onOpenLightbox={(item) => {
            setSelectedItemId(item.id);
            setLightboxItemId(item.id);
          }}
          onToggleRejectStatus={handleToggleRejectStatus}
          gridColumns={gridColumns}
          onFocusDriveInput={() => driveInputRef.current?.focus()}
          hasAnyLoadedItems={items.length > 0}
        />

        {/* Right Pane: Photo Editor, Smart Logo Watermarking & 3-Tier Sync */}
        <EditorInspector
          selectedItem={selectedItem}
          onUpdateEdit={handleUpdateEdit}
          onOpenCropModal={(item) => setCropModalItemId(item.id)}
          onOpenLightbox={(item) => setLightboxItemId(item.id)}
          onSyncCurrentFolder={handleSyncCurrentFolder}
          onSyncAllFolders={handleSyncAllFolders}
        />
      </div>

      {/* Full-Screen Lightbox & Video Iframe Stream Player */}
      <LightboxModal
        item={lightboxItem}
        onClose={() => setLightboxItemId(null)}
        onPrev={() => handleNavigate(-1)}
        onNext={() => handleNavigate(1)}
        onToggleReject={(item) => handleToggleRejectStatus(item)}
        onOpenCrop={(item) => setCropModalItemId(item.id)}
        currentIndex={currentLightboxIndex}
        totalFiltered={filteredItems.length}
      />

      {/* Interactive Aspect-Ratio Crop Modal */}
      <CropModal
        item={cropModalItem}
        onClose={() => setCropModalItemId(null)}
        onApplyCrop={handleApplyCrop}
      />

      {/* Batch Export & Custom Renaming Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        allItems={items}
        selectedFolderId={selectedFolderId}
        selectedFolderName={selectedFolderName}
      />
    </div>
  );
}
