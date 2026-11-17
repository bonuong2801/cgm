import React, { useState, useRef } from 'react';
import {
  Download,
  FolderSearch,
  FolderUp,
  ImagePlus,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

interface TopBarProps {
  driveUrlInput: string;
  onDriveUrlChange: (val: string) => void;
  onLoadDriveUrl: (e?: React.FormEvent) => void;
  onImportLocalFiles: (files: FileList | File[]) => void;
  onClearAllWorkspace: () => void;
  onOpenExportModal: () => void;
  onRunAiCull: () => void;
  onCancelAiCull: () => void;
  aiCullProgress: { running: boolean; done: number; total: number } | null;
  isLoading: boolean;
  keptCount: number;
  totalCount: number;
  canUndoReject: boolean;
  onUndoReject: () => void;
  isLeftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
  isRightInspectorOpen: boolean;
  onToggleRightInspector: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const TopBar: React.FC<TopBarProps> = ({
  driveUrlInput,
  onDriveUrlChange,
  onLoadDriveUrl,
  onImportLocalFiles,
  onClearAllWorkspace,
  onOpenExportModal,
  onRunAiCull,
  onCancelAiCull,
  aiCullProgress,
  isLoading,
  keptCount,
  totalCount,
  canUndoReject,
  onUndoReject,
  isLeftSidebarOpen,
  onToggleLeftSidebar,
  isRightInspectorOpen,
  onToggleRightInspector,
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
    <header className="h-14 bg-zinc-900 border-b border-zinc-800 px-3.5 flex items-center justify-between gap-3 shrink-0 select-none z-20">
      {/* Zone 1: Left Sidebar Toggle + Brand Title */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleLeftSidebar}
          aria-label={
            isLeftSidebarOpen ? 'Thu gọn thanh thư mục trái' : 'Mở thanh thư mục trái'
          }
          title={
            isLeftSidebarOpen ? 'Thu gọn thanh thư mục' : 'Mở thanh thư mục'
          }
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          {isLeftSidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </button>

        <img
          src="/logo-cgm.png"
          alt="CGM Studio Logo"
          className="w-8 h-8 rounded-lg object-cover border border-zinc-800 shadow-sm shrink-0"
        />
        <span className="text-sm font-bold tracking-tight text-zinc-100 whitespace-nowrap hidden md:inline">
          CGM Studio
        </span>
      </div>

      {/* Zone 2: Google Drive Folder Link Input + Bulk Local Import */}
      <div className="flex-1 max-w-3xl flex items-center gap-2 min-w-0">
        <form
          onSubmit={onLoadDriveUrl}
          className="flex-1 flex items-center gap-1.5 min-w-0"
        >
          <div
            className={`flex-1 flex items-center bg-zinc-950 border rounded-lg px-2.5 py-1.5 transition-colors min-w-0 ${
              inputFocused
                ? 'border-indigo-500 ring-1 ring-indigo-500/30'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <FolderSearch
              className="w-4 h-4 text-zinc-400 shrink-0 mr-2"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="text"
              value={driveUrlInput}
              onChange={(e) => onDriveUrlChange(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Dán link thư mục Google Drive công khai (hỗ trợ đệ quy nhiều cấp)..."
              className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none min-w-0"
              aria-label="Đường liên kết thư mục Google Drive"
            />
            {driveUrlInput && (
              <button
                type="button"
                onClick={() => onDriveUrlChange('')}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-1 whitespace-nowrap shrink-0 cursor-pointer"
                aria-label="Xóa đường dẫn Drive"
              >
                Xóa
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !driveUrlInput.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Đang tải...</span>
              </>
            ) : (
              <span>Tải Drive</span>
            )}
          </button>
        </form>

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
          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          title="Chọn hàng loạt ảnh từ máy tính"
        >
          <ImagePlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Tải ảnh</span>
        </button>

        <button
          type="button"
          onClick={() => localFolderInputRef.current?.click()}
          disabled={isLoading}
          className="px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:text-white bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors hidden lg:flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          title="Tải nguyên thư mục nhiều cấp từ máy tính"
        >
          <FolderUp
            className="w-3.5 h-3.5 text-indigo-400 shrink-0"
            aria-hidden="true"
          />
          <span>Tải thư mục</span>
        </button>
      </div>

      {/* Zone 3: AI Cull + Clear + Undo + Export + Right Inspector Toggle */}
      <div className="flex items-center gap-1.5 shrink-0">
        {totalCount > 0 &&
          (aiCullProgress?.running ? (
            <button
              type="button"
              onClick={onCancelAiCull}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Dừng tiến trình AI lọc ảnh"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="font-mono tabular-nums">
                AI {aiCullProgress.done}/{aiCullProgress.total}
              </span>
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onRunAiCull}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors hidden md:flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Dùng Gemini AI phát hiện ảnh nhắm mắt, rung nhòe và tự chấm sao (1-5)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span className="hidden xl:inline">AI lọc ảnh lỗi</span>
            </button>
          ))}

        {totalCount > 0 && (
          <button
            type="button"
            onClick={onClearAllWorkspace}
            className="p-1.5 xl:px-2.5 xl:py-1.5 text-xs font-medium text-zinc-400 hover:text-rose-300 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer"
            title="Xóa danh sách hiện tại & giải phóng RAM"
            aria-label="Làm mới không gian làm việc"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">Làm mới</span>
          </button>
        )}

        {canUndoReject && (
          <button
            type="button"
            onClick={onUndoReject}
            className="px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer"
            title="Hoàn tác thao tác loại bỏ vừa rồi (Phím Z)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            <span className="hidden sm:inline">Hoàn tác</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenExportModal}
          disabled={keptCount === 0}
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors flex items-center gap-1.5 shadow-sm whitespace-nowrap cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Xuất file</span>
          {totalCount > 0 && (
            <span className="font-mono tabular-nums text-indigo-100 font-normal">
              ({keptCount}/{totalCount})
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleRightInspector}
          aria-label={
            isRightInspectorOpen
              ? 'Thu gọn bảng chỉnh sửa phải'
              : 'Mở bảng chỉnh sửa phải'
          }
          title={
            isRightInspectorOpen
              ? 'Thu gọn bảng chỉnh sửa & ghép Logo'
              : 'Mở bảng chỉnh sửa & ghép Logo'
          }
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          {isRightInspectorOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4" />
          )}
        </button>
      </div>
    </header>
  );
};
