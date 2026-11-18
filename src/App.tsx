import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useAuth } from './contexts/AuthContext.tsx';
import { AuthGateScreen } from './components/AuthGateScreen.tsx';
import { UpgradeModal } from './components/UpgradeModal.tsx';
import {
  CropArea,
  CullingStatus,
  DriveFolder,
  DriveMediaItem,
  EditConfig,
  LogoLayer,
  LogoSetPreset,
  MediaTypeFilter,
  QuickFilterOption,
  SortByOption,
  StarRating,
  cloneLogoLayers,
  isPhotoEdited,
} from './types/media.ts';
import { crawlGoogleDriveFolder } from './services/driveApi.ts';
import {
  generateCompactThumbnailsInBackground,
  importFilesFromComputer,
  revokeMediaObjectUrls,
} from './services/localFileLoader.ts';
import {
  clearSavedSessionItems,
  loadLogoPresets,
  loadSavedSession,
  saveLogoPresets,
  saveWorkspaceSession,
} from './services/sessionStore.ts';
import { runSmartAiCullBatch } from './services/aiCullClient.ts';
import { toUserFriendlyError } from './utils/userMessages.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { TopBar } from './components/TopBar.tsx';
import { FolderSidebar } from './components/FolderSidebar.tsx';
import { VirtualMediaGrid } from './components/VirtualMediaGrid.tsx';
import {
  EditorInspector,
  LogoApplyScope,
} from './components/EditorInspector.tsx';
import { LightboxModal } from './components/LightboxModal.tsx';
import { CropModal } from './components/CropModal.tsx';
import { ExportModal } from './components/ExportModal.tsx';

export default function App() {
  const { isConfigured, isLoadingAuth, session } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="h-screen w-screen bg-zinc-950 text-zinc-300 flex flex-col items-center justify-center gap-3 select-none">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        <span className="text-xs text-zinc-400">
          Đang xác thực phiên đăng nhập CGM Studio...
        </span>
      </div>
    );
  }

  if (!isConfigured || !session) {
    return <AuthGateScreen isSupabaseConfigured={isConfigured} />;
  }

  return <StudioWorkspace />;
}

function StudioWorkspace() {
  const {
    profile,
    entitlements,
    refreshProfile,
    applyUpdatedProfile,
    signOut,
  } = useAuth();
  const driveInputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<DriveMediaItem[]>([]);
  const thumbCancelRef = useRef<(() => void) | null>(null);
  const lastCheckedIdRef = useRef<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  const [driveUrlInput, setDriveUrlInput] = useState<string>('');
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [items, setItems] = useState<DriveMediaItem[]>([]);
  itemsRef.current = items;

  // Responsive Collapsible Panes
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState<boolean>(
    () => typeof window === 'undefined' || window.innerWidth >= 1024
  );
  const [isRightInspectorOpen, setIsRightInspectorOpen] = useState<boolean>(
    () => typeof window === 'undefined' || window.innerWidth >= 1200
  );

  // Filtering, Search, Quick Filter & Sort
  const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL');
  const [mediaTypeFilter, setMediaTypeFilter] =
    useState<MediaTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<CullingStatus>('kept');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<QuickFilterOption>('all');
  const [sortBy, setSortBy] = useState<SortByOption>('name-asc');
  const [gridColumns, setGridColumns] = useState<number>(4);

  // Selection, Multi-Check & Multi-Logo Layer Stack
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(new Set());
  const [logoScope, setLogoScope] =
    useState<LogoApplyScope>('checked-or-all');
  const [globalLogos, setGlobalLogos] = useState<LogoLayer[]>([]);
  const [logoPresets, setLogoPresets] = useState<LogoSetPreset[]>([]);
  const [compareOriginal, setCompareOriginal] = useState<boolean>(false);

  // Modals
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  const [cropModalItemId, setCropModalItemId] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);

  const handleOpenUpgradeModal = useCallback((reason?: string) => {
    setUpgradeReason(reason || null);
    setIsUpgradeModalOpen(true);
  }, []);

  // Undo History for Soft-Delete Culling
  const [rejectedHistoryIds, setRejectedHistoryIds] = useState<string[]>([]);

  // Loading, AI Culling & Status Banners
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatusText, setLoadingStatusText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [aiCullProgress, setAiCullProgress] = useState<{
    running: boolean;
    done: number;
    total: number;
  } | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3800);
  }, []);

  // Hydrate saved session & studio Multi-Logo Presets from IndexedDB on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [savedSession, savedPresets] = await Promise.all([
        loadSavedSession(),
        loadLogoPresets(),
      ]);
      if (!mounted) return;
      if (savedPresets.length > 0) {
        setLogoPresets(savedPresets);
      }
      if (savedSession) {
        if (savedSession.globalLogos?.length > 0) {
          setGlobalLogos(savedSession.globalLogos);
        }
        if (savedSession.items?.length > 0) {
          setDriveUrlInput(savedSession.driveUrlInput || '');
          setFolders(savedSession.folders || []);
          setItems(savedSession.items);
          setSelectedItemId(savedSession.items[0]?.id || null);
          showToast(
            `Đã tự động khôi phục phiên làm việc trước (${savedSession.items.length} file).`
          );
        }
      }
      setSessionHydrated(true);
    })();

    return () => {
      mounted = false;
      thumbCancelRef.current?.();
      revokeMediaObjectUrls(itemsRef.current);
    };
  }, [showToast]);

  // Debounced auto-save to IndexedDB whenever Drive session or globalLogos changes
  useEffect(() => {
    if (!sessionHydrated) return;
    const timer = window.setTimeout(() => {
      saveWorkspaceSession({
        driveUrlInput,
        folders,
        items,
        globalLogos,
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [sessionHydrated, driveUrlInput, folders, items, globalLogos]);

  // Warn before accidental tab close if local PC photos have unsaved edits
  useEffect(() => {
    const hasUnsavedLocalWork = items.some(
      (i) => i.isLocal && (i.status === 'rejected' || isPhotoEdited(i.edit).hasAnyEdit)
    );
    if (!hasUnsavedLocalWork) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [items]);

  // Combined Filtered + Searched + Sorted Items
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matched = items.filter((item) => {
      if (selectedFolderId !== 'ALL' && item.folderId !== selectedFolderId) {
        return false;
      }
      if (mediaTypeFilter !== 'all' && item.mediaType !== mediaTypeFilter) {
        return false;
      }
      if (item.status !== statusFilter) {
        return false;
      }
      if (q && !item.name.toLowerCase().includes(q)) {
        return false;
      }

      if (quickFilter !== 'all') {
        if (quickFilter === 'rated') return item.rating > 0;
        if (quickFilter === 'ai-flagged') return Boolean(item.aiReason);
        if (item.mediaType !== 'image') return false;
        const flags = isPhotoEdited(item.edit);
        if (quickFilter === 'edited') return flags.hasAnyEdit;
        if (quickFilter === 'unwatermarked') return !flags.isWatermarked;
      }

      return true;
    });

    if (sortBy === 'name-asc') return matched;

    const sorted = [...matched];
    if (sortBy === 'name-desc') {
      sorted.sort((a, b) => b.name.localeCompare(a.name, 'vi'));
    } else if (sortBy === 'rating-desc') {
      sorted.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'vi'));
    } else if (sortBy === 'resolution-desc') {
      sorted.sort((a, b) => b.width * b.height - a.width * a.height);
    }
    return sorted;
  }, [
    items,
    selectedFolderId,
    mediaTypeFilter,
    statusFilter,
    searchQuery,
    quickFilter,
    sortBy,
  ]);

  useEffect(() => {
    if (filteredItems.length === 0) return;
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

  // Load Google Drive Folder via `/api/drive/crawl`
  const handleLoadDriveUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!driveUrlInput.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setLoadingStatusText('Đang kết nối và tải danh sách ảnh từ Google Drive...');

    try {
      const result = await crawlGoogleDriveFolder(
        driveUrlInput,
        globalLogos,
        (msg) => setLoadingStatusText(msg)
      );

      thumbCancelRef.current?.();
      revokeMediaObjectUrls(itemsRef.current);

      setFolders(result.folders);
      setItems(result.items);
      setSelectedFolderId('ALL');
      setStatusFilter('kept');
      setRejectedHistoryIds([]);
      setCheckedItemIds(new Set());
      setSelectedItemId(result.items[0]?.id || null);
    } catch (err: any) {
      setErrorMessage(
        toUserFriendlyError(
          err,
          'Không thể mở thư mục Google Drive lúc này. Vui lòng kiểm tra đường liên kết hoặc thử lại sau.'
        )
      );
    } finally {
      setIsLoading(false);
      setLoadingStatusText('');
    }
  };

  // Import Local Photos / Folders in Bulk + Background Compact 480px Thumbnail Generation
  const handleImportLocalFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setIsLoading(true);
      setErrorMessage(null);
      setLoadingStatusText('Đang nạp hàng loạt ảnh từ máy tính...');

      try {
        const result = await importFilesFromComputer(
          fileList,
          globalLogos,
          (msg) => setLoadingStatusText(msg)
        );

        setFolders((prevFolders) => {
          const map = new Map<string, DriveFolder>();
          for (const f of prevFolders) map.set(f.id, f);
          for (const f of result.folders) map.set(f.id, f);
          return Array.from(map.values());
        });

        setItems((prevItems) => [...prevItems, ...result.items]);
        setStatusFilter('kept');
        if (!selectedItemId && result.items[0]) {
          setSelectedItemId(result.items[0].id);
        }

        // Generate 480px thumbnails in background to slash GPU/RAM usage by 95%
        thumbCancelRef.current?.();
        thumbCancelRef.current = generateCompactThumbnailsInBackground(
          result.items,
          (batchUpdates) => {
            const updateMap = new Map(batchUpdates.map((u) => [u.id, u]));
            setItems((prev) =>
              prev.map((item) => {
                const hit = updateMap.get(item.id);
                if (!hit) return item;
                return {
                  ...item,
                  gridThumbUrl: hit.thumbUrl,
                  width: hit.width,
                  height: hit.height,
                };
              })
            );
          }
        );
      } catch (err: any) {
        setErrorMessage(
          toUserFriendlyError(err, 'Không thể đọc tệp ảnh từ máy tính.')
        );
      } finally {
        setIsLoading(false);
        setLoadingStatusText('');
      }
    },
    [globalLogos, selectedItemId]
  );

  // Microtask-batched dimension detection so 24 simultaneous `onLoad`s trigger 1 single state update
  const pendingDimsRef = useRef<Map<string, { w: number; h: number }>>(
    new Map()
  );
  const dimFlushScheduledRef = useRef<boolean>(false);

  const handleUpdateDetectedDimensions = useCallback(
    (itemId: string, width: number, height: number) => {
      pendingDimsRef.current.set(itemId, { w: width, h: height });
      if (dimFlushScheduledRef.current) return;
      dimFlushScheduledRef.current = true;

      queueMicrotask(() => {
        dimFlushScheduledRef.current = false;
        const updates = new Map(pendingDimsRef.current);
        pendingDimsRef.current.clear();
        if (updates.size === 0) return;

        setItems((prev) => {
          let changed = false;
          const next = prev.map((item) => {
            const hit = updates.get(item.id);
            if (hit && (item.width !== hit.w || item.height !== hit.h)) {
              changed = true;
              return { ...item, width: hit.w, height: hit.h };
            }
            return item;
          });
          return changed ? next : prev;
        });
      });
    },
    []
  );

  // Clear workspace & release 100% of local ObjectURLs
  const handleClearAllWorkspace = useCallback(() => {
    thumbCancelRef.current?.();
    aiAbortRef.current?.abort();
    revokeMediaObjectUrls(itemsRef.current);

    setFolders([]);
    setItems([]);
    setDriveUrlInput('');
    setSelectedFolderId('ALL');
    setSelectedItemId(null);
    setLightboxItemId(null);
    setCropModalItemId(null);
    setCheckedItemIds(new Set());
    setRejectedHistoryIds([]);
    setErrorMessage(null);
    clearSavedSessionItems(globalLogos);
  }, [globalLogos]);

  // Multi-select checkbox toggle with Shift+Click range support!
  const handleToggleCheckItem = useCallback(
    (itemId: string, shiftKey: boolean, e: React.MouseEvent) => {
      e.stopPropagation();

      setCheckedItemIds((prev) => {
        const next = new Set(prev);
        const willCheck = !next.has(itemId);

        if (shiftKey && lastCheckedIdRef.current) {
          const idxA = filteredItems.findIndex(
            (i) => i.id === lastCheckedIdRef.current
          );
          const idxB = filteredItems.findIndex((i) => i.id === itemId);
          if (idxA !== -1 && idxB !== -1) {
            const start = Math.min(idxA, idxB);
            const end = Math.max(idxA, idxB);
            for (let k = start; k <= end; k++) {
              const candidate = filteredItems[k];
              if (candidate?.mediaType === 'image') {
                if (willCheck) next.add(candidate.id);
                else next.delete(candidate.id);
              }
            }
            lastCheckedIdRef.current = itemId;
            return next;
          }
        }

        if (willCheck) next.add(itemId);
        else next.delete(itemId);
        lastCheckedIdRef.current = itemId;
        return next;
      });
    },
    [filteredItems]
  );

  const handleSelectAllVisiblePhotos = useCallback(() => {
    setCheckedItemIds((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) {
        if (item.mediaType === 'image') {
          next.add(item.id);
        }
      }
      return next;
    });
  }, [filteredItems]);

  const handleClearCheckedItems = useCallback(() => {
    setCheckedItemIds(new Set());
  }, []);

  // Soft-Delete Culling
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

  const handleUndoLastReject = useCallback(() => {
    if (rejectedHistoryIds.length === 0) return;
    const lastId = rejectedHistoryIds[rejectedHistoryIds.length - 1];

    setItems((prev) =>
      prev.map((i) => (i.id === lastId ? { ...i, status: 'kept' } : i))
    );
    setRejectedHistoryIds((prev) => prev.slice(0, -1));
    setSelectedItemId(lastId);
  }, [rejectedHistoryIds]);

  const handleRateItem = useCallback((itemId: string, rating: StarRating) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, rating } : i))
    );
  }, []);

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

  /**
   * Batch Multi-Logo Layer Stack Update across 'single', 'current-folder', or 'checked-or-all'
   */
  const handleBatchUpdateLogos = useCallback(
    (
      updater: (prev: LogoLayer[]) => LogoLayer[],
      scopeOverride?: LogoApplyScope
    ): number => {
      const effectiveScope = scopeOverride || logoScope;
      const baseStack =
        selectedItem && selectedItem.mediaType === 'image'
          ? selectedItem.edit.logos
          : globalLogos;
      const nextLogos = updater(baseStack);
      setGlobalLogos(cloneLogoLayers(nextLogos));

      const targetFolderId =
        selectedFolderId !== 'ALL'
          ? selectedFolderId
          : selectedItem?.folderId || '';

      let affectedCount = 0;

      setItems((prev) =>
        prev.map((item) => {
          if (item.mediaType !== 'image') return item;

          let shouldApply = false;
          if (effectiveScope === 'single') {
            shouldApply = item.id === selectedItemId;
          } else if (effectiveScope === 'current-folder') {
            shouldApply =
              item.status === 'kept' && item.folderId === targetFolderId;
          } else {
            shouldApply =
              checkedItemIds.size > 0
                ? checkedItemIds.has(item.id)
                : item.status === 'kept';
          }

          if (shouldApply) {
            affectedCount += 1;
            return {
              ...item,
              edit: {
                ...item.edit,
                logos: cloneLogoLayers(nextLogos),
              },
            };
          }
          return item;
        })
      );

      return affectedCount;
    },
    [
      logoScope,
      selectedItem,
      globalLogos,
      selectedFolderId,
      selectedItemId,
      checkedItemIds,
    ]
  );

  // Move a specific LogoLayer interactively inside Lightbox
  const handleMoveLightboxLogoLayer = useCallback(
    (logoId: string, customXPercent: number, customYPercent: number) => {
      handleBatchUpdateLogos((prev) =>
        prev.map((l) =>
          l.id === logoId
            ? { ...l, position: 'custom', customXPercent, customYPercent }
            : { ...l }
        )
      );
    },
    [handleBatchUpdateLogos]
  );

  // Saved Multi-Logo Set Presets in IndexedDB
  const handleSaveLogoPreset = useCallback(
    (name: string, logos: LogoLayer[]) => {
      const newPreset: LogoSetPreset = {
        id: `preset_${Date.now()}`,
        name,
        logos: cloneLogoLayers(logos),
        createdAt: Date.now(),
      };
      setLogoPresets((prev) => {
        const next = [newPreset, ...prev];
        saveLogoPresets(next);
        return next;
      });
    },
    []
  );

  const handleDeleteLogoPreset = useCallback((presetId: string) => {
    setLogoPresets((prev) => {
      const next = prev.filter((p) => p.id !== presetId);
      saveLogoPresets(next);
      return next;
    });
  }, []);

  // Apply Crop
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

  // Sync Color + Multi-Logo Stack to Checked Photos
  const handleSyncCheckedPhotos = useCallback(
    (sourceEdit: EditConfig): number => {
      let count = 0;
      setItems((prev) =>
        prev.map((item) => {
          if (item.mediaType === 'image' && checkedItemIds.has(item.id)) {
            count += 1;
            return {
              ...item,
              edit: {
                ...item.edit,
                brightness: sourceEdit.brightness,
                contrast: sourceEdit.contrast,
                saturation: sourceEdit.saturation,
                warmth: sourceEdit.warmth,
                logos: cloneLogoLayers(sourceEdit.logos),
              },
            };
          }
          return item;
        })
      );
      return count;
    },
    [checkedItemIds]
  );

  // Sync Color + Multi-Logo Stack to Current Folder
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
                logos: cloneLogoLayers(sourceEdit.logos),
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

  // Sync Color + Multi-Logo Stack to ALL Kept Photos
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
              logos: cloneLogoLayers(sourceEdit.logos),
            },
          };
        }
        return item;
      })
    );
    return count;
  }, []);

  // AI Smart Culling via `/api/ai/cull`
  const handleRunAiCull = useCallback(async () => {
    const targetPhotos = filteredItems.filter(
      (i) => i.mediaType === 'image' && i.status === 'kept'
    );
    if (targetPhotos.length === 0) {
      setErrorMessage('Không có ảnh nào trong danh sách hiện tại để AI phân tích.');
      return;
    }

    const controller = new AbortController();
    aiAbortRef.current = controller;
    setErrorMessage(null);
    setAiCullProgress({ running: true, done: 0, total: targetPhotos.length });

    try {
      const summary = await runSmartAiCullBatch(
        targetPhotos,
        (done, total) => setAiCullProgress({ running: true, done, total }),
        (outcomes) => {
          const outcomeMap = new Map(outcomes.map((o) => [o.id, o]));
          const newlyRejectedIds: string[] = [];

          setItems((prev) =>
            prev.map((item) => {
              const hit = outcomeMap.get(item.id);
              if (!hit) return item;
              if (hit.reject && item.status === 'kept') {
                newlyRejectedIds.push(item.id);
              }
              return {
                ...item,
                status: hit.reject ? 'rejected' : item.status,
                rating: item.rating > 0 ? item.rating : hit.rating,
                aiReason: hit.reason || undefined,
              };
            })
          );

          if (newlyRejectedIds.length > 0) {
            setRejectedHistoryIds((prev) => [...prev, ...newlyRejectedIds]);
          }
        },
        controller.signal
      );

      showToast(
        `AI đã chấm sao ${summary.totalAnalyzed} ảnh và tự động lọc ${summary.totalFlaggedReject} ảnh lỗi vào mục "Đã loại".`
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMessage(
          toUserFriendlyError(
            err,
            'Tính năng AI lọc ảnh hiện đang gặp sự cố hoặc tạm bảo trì. Vui lòng thử lại sau ít phút.'
          )
        );
      }
    } finally {
      aiAbortRef.current = null;
      setAiCullProgress(null);
    }
  }, [filteredItems, showToast]);

  const handleCancelAiCull = useCallback(() => {
    aiAbortRef.current?.abort();
    setAiCullProgress(null);
  }, []);

  // Register Global Studio Keyboard Shortcuts
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
    onKeepCurrent: () => {
      const activeId = lightboxItemId || selectedItemId;
      const target = items.find((i) => i.id === activeId);
      if (target && target.status !== 'kept') {
        handleToggleRejectStatus(target);
      } else {
        handleNavigate(1);
      }
    },
    onRateCurrent: (rating) => {
      const activeId = lightboxItemId || selectedItemId;
      const target = items.find((i) => i.id === activeId);
      if (target) {
        handleRateItem(target.id, target.rating === rating ? 0 : rating);
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
    onToggleLightbox: () => {
      if (cropModalItemId || isExportModalOpen || isUpgradeModalOpen) return;
      if (lightboxItemId) {
        setLightboxItemId(null);
      } else if (selectedItemId) {
        setLightboxItemId(selectedItemId);
      }
    },
    onCloseModal: () => {
      if (isUpgradeModalOpen) {
        setIsUpgradeModalOpen(false);
      } else if (cropModalItemId) {
        setCropModalItemId(null);
      } else if (lightboxItemId) {
        setLightboxItemId(null);
      } else if (isExportModalOpen) {
        setIsExportModalOpen(false);
      }
    },
    onCompareOriginalChange: setCompareOriginal,
    isAnyModalOpen: Boolean(
      cropModalItemId ||
        lightboxItemId ||
        isExportModalOpen ||
        isUpgradeModalOpen
    ),
  });

  const { totalKeptCount, keptPhotoCount, currentFolderPhotoCount } =
    useMemo(() => {
      const targetFolderId =
        selectedFolderId !== 'ALL'
          ? selectedFolderId
          : selectedItem?.folderId || '';

      let totalKept = 0;
      let keptPhotos = 0;
      let folderPhotos = 0;

      for (const i of items) {
        if (i.status === 'kept') {
          totalKept++;
          if (i.mediaType === 'image') {
            keptPhotos++;
            if (!targetFolderId || i.folderId === targetFolderId) {
              folderPhotos++;
            }
          }
        }
      }

      return {
        totalKeptCount: totalKept,
        keptPhotoCount: keptPhotos,
        currentFolderPhotoCount: folderPhotos,
      };
    }, [items, selectedFolderId, selectedItem]);

  const currentLightboxIndex = useMemo(() => {
    if (!lightboxItemId) return 0;
    const idx = filteredItems.findIndex((i) => i.id === lightboxItemId);
    return idx >= 0 ? idx : 0;
  }, [filteredItems, lightboxItemId]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Top Studio Bar */}
      <TopBar
        profile={profile}
        entitlements={entitlements}
        onOpenUpgradeModal={handleOpenUpgradeModal}
        onSignOut={signOut}
        inputRef={driveInputRef}
        driveUrlInput={driveUrlInput}
        onDriveUrlChange={setDriveUrlInput}
        onLoadDriveUrl={handleLoadDriveUrl}
        onImportLocalFiles={handleImportLocalFiles}
        onClearAllWorkspace={handleClearAllWorkspace}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onRunAiCull={handleRunAiCull}
        onCancelAiCull={handleCancelAiCull}
        aiCullProgress={aiCullProgress}
        isLoading={isLoading}
        keptCount={totalKeptCount}
        totalCount={items.length}
        canUndoReject={rejectedHistoryIds.length > 0}
        onUndoReject={handleUndoLastReject}
        isLeftSidebarOpen={isLeftSidebarOpen}
        onToggleLeftSidebar={() => setIsLeftSidebarOpen((v) => !v)}
        isRightInspectorOpen={isRightInspectorOpen}
        onToggleRightInspector={() => setIsRightInspectorOpen((v) => !v)}
      />

      {/* Actionable Vietnamese Error Banner */}
      {errorMessage && (
        <div className="bg-rose-500/15 border-b border-rose-500/30 px-5 py-2 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            aria-label="Đóng thông báo lỗi"
            className="text-rose-300 hover:text-white p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Toast Info Banner */}
      {toastMessage && (
        <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-5 py-2 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            aria-label="Đóng thông báo"
            className="text-emerald-300 hover:text-white p-1 cursor-pointer"
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
        {isLeftSidebarOpen && (
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
        )}

        <VirtualMediaGrid
          items={filteredItems}
          selectedItemId={selectedItemId}
          checkedItemIds={checkedItemIds}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          quickFilter={quickFilter}
          onQuickFilterChange={setQuickFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          compareOriginal={compareOriginal}
          onSelectItem={(item) => setSelectedItemId(item.id)}
          onToggleCheckItem={handleToggleCheckItem}
          onSelectAllVisiblePhotos={handleSelectAllVisiblePhotos}
          onClearCheckedItems={handleClearCheckedItems}
          onOpenLightbox={(item) => {
            setSelectedItemId(item.id);
            setLightboxItemId(item.id);
          }}
          onToggleRejectStatus={handleToggleRejectStatus}
          onUpdateDetectedDimensions={handleUpdateDetectedDimensions}
          gridColumns={gridColumns}
          onFocusDriveInput={() => driveInputRef.current?.focus()}
          onImportLocalFiles={handleImportLocalFiles}
          hasAnyLoadedItems={items.length > 0}
        />

        {isRightInspectorOpen && (
          <EditorInspector
            entitlements={entitlements}
            onRequestUpgrade={handleOpenUpgradeModal}
            selectedItem={selectedItem}
            checkedCount={checkedItemIds.size}
            keptPhotoCount={keptPhotoCount}
            currentFolderPhotoCount={currentFolderPhotoCount}
            globalLogos={globalLogos}
            logoPresets={logoPresets}
            onSaveLogoPreset={handleSaveLogoPreset}
            onDeleteLogoPreset={handleDeleteLogoPreset}
            logoScope={logoScope}
            onChangeLogoScope={setLogoScope}
            onBatchUpdateLogos={handleBatchUpdateLogos}
            onUpdateEdit={handleUpdateEdit}
            onRateItem={handleRateItem}
            compareOriginal={compareOriginal}
            onCompareOriginalChange={setCompareOriginal}
            onOpenCropModal={(item) => setCropModalItemId(item.id)}
            onOpenLightbox={(item) => setLightboxItemId(item.id)}
            onSyncCheckedPhotos={handleSyncCheckedPhotos}
            onSyncCurrentFolder={handleSyncCurrentFolder}
            onSyncAllFolders={handleSyncAllFolders}
          />
        )}
      </div>

      {/* Full-Screen Lightbox with Native Video Seek & Multi-Logo Dragging */}
      <LightboxModal
        item={lightboxItem}
        canFreeDragLogo={entitlements.canFreeDragLogo}
        onRequestUpgrade={handleOpenUpgradeModal}
        compareOriginal={compareOriginal}
        onCompareOriginalChange={setCompareOriginal}
        onRateItem={handleRateItem}
        onMoveLogoLayer={handleMoveLightboxLogoLayer}
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
        entitlements={entitlements}
        onRequestUpgrade={handleOpenUpgradeModal}
        onClose={() => setIsExportModalOpen(false)}
        allItems={items}
        checkedItemIds={checkedItemIds}
        selectedFolderId={selectedFolderId}
        selectedFolderName={selectedFolderName}
      />

      {/* Pro Account Unlock Modal (Automatic VietQR + License Key + Admin Generator) */}
      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        reasonBanner={upgradeReason}
        profile={profile}
        onClose={() => setIsUpgradeModalOpen(false)}
        onUnlockedSuccess={(updatedProfile, msg) => {
          if (updatedProfile) {
            applyUpdatedProfile(updatedProfile);
          } else {
            refreshProfile();
          }
          showToast(msg);
        }}
      />
    </div>
  );
}
