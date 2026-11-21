import React, { useMemo } from 'react';
import {
  CheckCircle2,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Trash2,
} from 'lucide-react';
import type {
  CullingStatus,
  DriveFolder,
  DriveMediaItem,
  MediaTypeFilter,
} from '../types/media.ts';

interface FolderSidebarProps {
  folders: DriveFolder[];
  items: DriveMediaItem[];
  selectedFolderId: string;
  onSelectFolder: (folderId: string) => void;
  mediaTypeFilter: MediaTypeFilter;
  onSelectMediaType: (filter: MediaTypeFilter) => void;
  statusFilter: CullingStatus;
  onSelectStatusFilter: (status: CullingStatus) => void;
  gridColumns: number;
  onChangeGridColumns: (cols: number) => void;
}

export const FolderSidebar: React.FC<FolderSidebarProps> = ({
  folders,
  items,
  selectedFolderId,
  onSelectFolder,
  mediaTypeFilter,
  onSelectMediaType,
  statusFilter,
  onSelectStatusFilter,
  gridColumns,
  onChangeGridColumns,
}) => {
  // Single O(N) pass for all folder & global counts instead of repeated O(F * N) scans
  const statsSummary = useMemo(() => {
    let totalKept = 0;
    let totalRejected = 0;
    let totalVideos = 0;
    let scopedKeptCount = 0;
    let scopedRejectedCount = 0;

    const perFolder = new Map<
      string,
      { kept: number; total: number; videos: number }
    >();

    for (const item of items) {
      if (item.status === 'kept') totalKept++;
      else totalRejected++;
      if (item.mediaType === 'video') totalVideos++;

      const entry = perFolder.get(item.folderId) || {
        kept: 0,
        total: 0,
        videos: 0,
      };
      entry.total++;
      if (item.status === 'kept') entry.kept++;
      if (item.mediaType === 'video') entry.videos++;
      perFolder.set(item.folderId, entry);

      const inScopedFolder =
        selectedFolderId === 'ALL' || item.folderId === selectedFolderId;
      const inScopedMedia =
        mediaTypeFilter === 'all' || item.mediaType === mediaTypeFilter;
      if (inScopedFolder && inScopedMedia) {
        if (item.status === 'kept') scopedKeptCount++;
        else scopedRejectedCount++;
      }
    }

    return {
      totalKept,
      totalRejected,
      totalVideos,
      scopedKeptCount,
      scopedRejectedCount,
      perFolder,
    };
  }, [items, selectedFolderId, mediaTypeFilter]);

  return (
    <aside className="w-66 bg-[#101013] border-r border-white/10 flex flex-col h-full shrink-0 select-none">
      {/* Section 1: Culling Status Filter */}
      <div className="p-3.5 border-b border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-400">
            Trạng thái chọn lọc
          </span>
          <span className="text-xs font-mono tabular-nums text-zinc-500">
            {statsSummary.totalKept} giữ · {statsSummary.totalRejected} loại
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#09090B] rounded-lg border border-white/10">
          <button
            type="button"
            onClick={() => onSelectStatusFilter('kept')}
            className={`px-2.5 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-between whitespace-nowrap cursor-pointer ${
              statusFilter === 'kept'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle2
                className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                aria-hidden="true"
              />
              <span>Đang giữ</span>
            </span>
            <span className="font-mono tabular-nums text-[11px] opacity-85">
              {statsSummary.scopedKeptCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectStatusFilter('rejected')}
            className={`px-2.5 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-between whitespace-nowrap cursor-pointer ${
              statusFilter === 'rejected'
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Trash2
                className="w-3.5 h-3.5 text-rose-400 shrink-0"
                aria-hidden="true"
              />
              <span>Đã loại</span>
            </span>
            <span className="font-mono tabular-nums text-[11px] opacity-85">
              {statsSummary.scopedRejectedCount}
            </span>
          </button>
        </div>

        {/* Media Type Filter */}
        <div className="space-y-1.5 pt-0.5">
          <span className="text-xs font-semibold text-zinc-400 block">
            Loại phương tiện
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#09090B] rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => onSelectMediaType('all')}
              className={`py-1.5 px-2 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mediaTypeFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Tất cả
            </button>
            <button
              type="button"
              onClick={() => onSelectMediaType('image')}
              className={`py-1.5 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
                mediaTypeFilter === 'image'
                  ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ImageIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>Ảnh</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectMediaType('video')}
              className={`py-1.5 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
                mediaTypeFilter === 'video'
                  ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Film className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>Video</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Multi-Level Subfolder List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="px-2 pb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-400">
            Thư mục ({folders.length})
          </span>
          <span className="text-[11px] font-mono tabular-nums text-zinc-500">
            Giữ / Tổng
          </span>
        </div>

        <button
          type="button"
          onClick={() => onSelectFolder('ALL')}
          className={`w-full px-3 py-2 rounded-lg text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
            selectedFolderId === 'ALL'
              ? 'bg-amber-500/15 text-amber-200 border border-amber-500/35'
              : 'text-zinc-300 hover:bg-white/5 border border-transparent'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Layers
              className={`w-4 h-4 shrink-0 ${
                selectedFolderId === 'ALL' ? 'text-amber-400' : 'text-zinc-400'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">
                Tất cả thư mục
              </div>
              <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                {folders.length} thư mục · {statsSummary.totalVideos} video
              </div>
            </div>
          </div>
          <span
            className={`text-xs font-mono tabular-nums shrink-0 ${
              selectedFolderId === 'ALL'
                ? 'text-amber-200 font-semibold'
                : 'text-zinc-300'
            }`}
          >
            {statsSummary.totalKept}/{items.length}
          </span>
        </button>

        {folders.map((folder) => {
          const stats = statsSummary.perFolder.get(folder.id) || {
            kept: 0,
            total: 0,
            videos: 0,
          };
          const isSelected = selectedFolderId === folder.id;

          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => onSelectFolder(folder.id)}
              className={`w-full px-3 py-2 rounded-lg text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                isSelected
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/35'
                  : 'text-zinc-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {isSelected ? (
                  <FolderOpen
                    className="w-4 h-4 text-amber-400 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <Folder
                    className="w-4 h-4 text-zinc-500 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <div
                    className="text-xs font-medium truncate"
                    title={folder.name}
                  >
                    {folder.name}
                  </div>
                  <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                    {stats.total - stats.videos} ảnh · {stats.videos} video
                  </div>
                </div>
              </div>
              <span
                className={`text-xs font-mono tabular-nums shrink-0 ${
                  isSelected ? 'text-amber-200 font-semibold' : 'text-zinc-400'
                }`}
              >
                {stats.kept}/{stats.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* Section 3: Grid Density & Studio Shortcuts */}
      <div className="p-3 border-t border-white/10 bg-[#0B0B0D]/70 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Số cột chế độ Lưới</span>
          <div className="flex items-center gap-1 bg-[#09090B] p-0.5 rounded-md border border-white/10">
            {[2, 3, 4, 5, 6].map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => onChangeGridColumns(cols)}
                className={`w-6 h-6 text-xs font-mono tabular-nums rounded transition-colors cursor-pointer ${
                  gridColumns === cols
                    ? 'bg-amber-500 text-zinc-950 font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={`Hiển thị ${cols} cột`}
              >
                {cols}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-zinc-400 space-y-1 pt-1 border-t border-white/10">
          <div className="font-semibold text-zinc-300 mb-1">
            Phím tắt Studio
          </div>
          <div className="flex justify-between">
            <span>Chuyển ảnh trước / sau</span>
            <span className="font-mono text-amber-300">← / →</span>
          </div>
          <div className="flex justify-between">
            <span>Phóng to &amp; kéo đặt Logo</span>
            <span className="font-mono text-emerald-400">Space</span>
          </div>
          <div className="flex justify-between">
            <span>So sánh Ảnh gốc (Giữ phím)</span>
            <span className="font-mono text-sky-400">\</span>
          </div>
          <div className="flex justify-between">
            <span>Chấm sao nhanh</span>
            <span className="font-mono text-amber-300">1 – 5</span>
          </div>
          <div className="flex justify-between">
            <span>Giữ (P) / Loại bỏ (X)</span>
            <span className="font-mono text-rose-400">P / X</span>
          </div>
          <div className="flex justify-between">
            <span>Cắt khung (C) · Hoàn tác (Z)</span>
            <span className="font-mono text-zinc-300">C / Z</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
