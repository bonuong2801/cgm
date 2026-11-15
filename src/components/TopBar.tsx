import React, { useState } from 'react';
import {
  Download,
  FolderSearch,
  Loader2,
  RotateCcw,
} from 'lucide-react';

interface TopBarProps {
  driveUrlInput: string;
  onDriveUrlChange: (val: string) => void;
  onLoadDriveUrl: (e?: React.FormEvent) => void;
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
  onOpenExportModal,
  isLoading,
  keptCount,
  totalCount,
  canUndoReject,
  onUndoReject,
  inputRef,
}) => {
  const [inputFocused, setInputFocused] = useState(false);

  return (
    <header className="h-15 bg-zinc-900 border-b border-zinc-800 px-5 flex items-center justify-between gap-6 shrink-0 select-none z-20">
      {/* Zone 1: Brand Title */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-sm tracking-wider shadow-sm">
          CGM
        </div>
        <span className="text-base font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0">
          CGM Studio
        </span>
      </div>

      {/* Zone 2: Google Drive Folder Link Input Bar */}
      <form
        onSubmit={onLoadDriveUrl}
        className="flex-1 max-w-2xl flex items-center gap-2"
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
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              <span>Đang quét...</span>
            </>
          ) : (
            <span>Tải thư mục</span>
          )}
        </button>
      </form>

      {/* Zone 3: Undo Action + Global Batch Export Button */}
      <div className="flex items-center gap-3 shrink-0">
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
          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors flex items-center gap-2 shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Xuất hàng loạt</span>
          {totalCount > 0 && (
            <span className="font-mono tabular-nums text-emerald-100 font-normal">
              ({keptCount}/{totalCount})
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
