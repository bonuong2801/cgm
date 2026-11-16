import React, { useState, useRef } from 'react';
import {
  Download,
  FolderSearch,
  FolderUp,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';

interface TopBarProps {
  driveUrlInput: string;
  onDriveUrlChange: (val: string) => void;
  onLoadDriveUrl: (e?: React.FormEvent) => void;
  onImportLocalFiles: (files: FileList | File[]) => void;
  onClearAllWorkspace: () => void;
  onOpenExportModal: () => void;
  isLoading: boolean;
  keptCount: number;
  totalCount: number;
  canUndoReject: boolean;
  onUndoReject: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const TopBar: React.FC<TopBarProps> = ({
  driveUrlInput,
  onDriveUrlChange,
  onLoadDriveUrl,
  onImportLocalFiles,
  onClearAllWorkspace,
  onOpenExportModal,
  isLoading,
  keptCount,
  totalCount,
  canUndoReject,
  onUndoReject,
  inputRef,
}) => {
  const [inputFocused, setInputFocused] = useState(false);
  const localFilesInputRef = useRef<HTMLInputElement | null>(null);
  const localFolderInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportLocalFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  return (
    <header className="h-15 bg-zinc-900 border-b border-zinc-800 px-5 flex items-center justify-between gap-4 shrink-0 select-none z-20">
      {/* Zone 1: Brand Title */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-sm tracking-wider shadow-sm">
          CGM
        </div>
        <span className="text-base font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0">
          CGM Studio
        </span>
      </div>

      {/* Zone 2: Google Drive Folder Link Input Bar + Bulk Local Computer Upload Buttons */}
      <div className="flex-1 max-w-3xl flex items-center gap-2">
        <form
          onSubmit={onLoadDriveUrl}
          className="flex-1 flex items-center gap-2"
        >
          <div
            className={`flex-1 flex items-center bg-zinc-950 border rounded-lg px-3 py-1.5 transition-colors ${
              inputFocused
                ? 'border-indigo-500 ring-1 ring-indigo-500/30'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <FolderSearch className="w-4 h-4 text-zinc-400 shrink-0 mr-2.5" />
            <input
              ref={inputRef}
              type="text"
              value={driveUrlInput}
              onChange={(e) => onDriveUrlChange(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Dán đường liên kết thư mục Google Drive công khai vào đây..."
              className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
              aria-label="Đường liên kết thư mục Google Drive"
            />
            {driveUrlInput && (
              <button
                type="button"
                onClick={() => onDriveUrlChange('')}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                title="Xóa đường dẫn"
              >
                Xóa
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !driveUrlInput.trim()}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>Đang tải...</span>
              </>
            ) : (
              <span>Tải Drive</span>
            )}
          </button>
        </form>

        {/* Hidden Inputs for Bulk Local Photo & Folder Upload */}
        <input
          ref={localFilesInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.svg,.avif,.mp4,.mov"
          onChange={handleFileChange}
          className="hidden"
        />
        <input
          ref={localFolderInputRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => localFilesInputRef.current?.click()}
          disabled={isLoading}
          className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          title="Chọn hàng loạt ảnh từ máy tính (giữ Shift hoặc Ctrl+A để chọn nhiều ảnh cùng lúc)"
        >
          <ImagePlus className="w-3.5 h-3.5 shrink-0" />
          <span>Tải hàng loạt ảnh</span>
        </button>

        <button
          type="button"
          onClick={() => localFolderInputRef.current?.click()}
          disabled={isLoading}
          className="px-3 py-2 text-xs font-medium text-zinc-200 hover:text-white bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors hidden sm:flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          title="Tải toàn bộ ảnh trong một thư mục từ máy tính"
        >
          <FolderUp className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>Tải cả thư mục</span>
        </button>
      </div>

      {/* Zone 3: Clear Workspace + Undo + Global Batch Export Button */}
      <div className="flex items-center gap-2 shrink-0">
        {totalCount > 0 && (
          <button
            type="button"
            onClick={onClearAllWorkspace}
            className="px-2.5 py-2 text-xs font-medium text-zinc-400 hover:text-rose-300 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            title="Xóa danh sách ảnh hiện tại để tải đợt ảnh mới"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Làm mới</span>
          </button>
        )}

        {canUndoReject && (
          <button
            type="button"
            onClick={onUndoReject}
            className="px-3 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            title="Hoàn tác thao tác loại bỏ vừa rồi (Phím tắt: Z)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Hoàn tác (Z)</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenExportModal}
          disabled={keptCount === 0}
          className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors flex items-center gap-2 shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Xuất hàng loạt</span>
          {totalCount > 0 && (
            <span className="font-mono tabular-nums text-indigo-100 font-normal">
              ({keptCount}/{totalCount})
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
