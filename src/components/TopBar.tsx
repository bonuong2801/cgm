import React, { useState, useRef } from 'react';
import {
  Crown,
  Download,
  FolderSearch,
  FolderUp,
  ImagePlus,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Shield,
  Trash2,
} from 'lucide-react';
import type { PlanEntitlements, UserProfile } from '../types/auth.ts';

interface TopBarProps {
  profile: UserProfile | null;
  entitlements: PlanEntitlements;
  onOpenUpgradeModal: (reason?: string) => void;
  onSignOut: () => void;
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
  isLeftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
  isRightInspectorOpen: boolean;
  onToggleRightInspector: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const TopBar: React.FC<TopBarProps> = ({
  profile,
  entitlements,
  onOpenUpgradeModal,
  onSignOut,
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
    <header className="h-13 bg-[#121215] border-b border-white/10 px-3 flex items-center justify-between gap-2.5 shrink-0 select-none z-20">
      {/* Zone 1: Left Sidebar Toggle + Official Brand Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleLeftSidebar}
          aria-label={
            isLeftSidebarOpen ? 'Thu gọn thanh thư mục trái' : 'Mở thanh thư mục trái'
          }
          title={
            isLeftSidebarOpen ? 'Thu gọn thanh thư mục' : 'Mở thanh thư mục'
          }
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors cursor-pointer"
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
          className="w-8 h-8 rounded-lg object-cover border border-amber-400/35 shadow-sm shrink-0"
        />
        <span className="text-sm font-bold tracking-wide text-zinc-100 whitespace-nowrap hidden xl:inline">
          CGM STUDIO
        </span>
      </div>

      {/* Zone 2: Google Drive Input + Bulk Local Import */}
      <div className="flex-1 max-w-2xl flex items-center gap-1.5 min-w-0">
        <form
          onSubmit={onLoadDriveUrl}
          className="flex-1 flex items-center gap-1.5 min-w-0"
        >
          <div
            className={`flex-1 flex items-center bg-[#09090B] border rounded-lg px-2.5 py-1.5 transition-colors min-w-0 ${
              inputFocused
                ? 'border-amber-500/70 ring-1 ring-amber-500/25'
                : 'border-white/10 hover:border-white/20'
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
              placeholder="Dán link thư mục Google Drive công khai..."
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
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:pointer-events-none text-zinc-100 border border-white/10 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Tải...</span>
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
          className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600/90 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          title="Chọn hàng loạt ảnh từ máy tính"
        >
          <ImagePlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">Tải ảnh</span>
        </button>

        <button
          type="button"
          onClick={() => localFolderInputRef.current?.click()}
          disabled={isLoading}
          className="px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:text-white bg-[#09090B] hover:bg-zinc-800 border border-white/10 rounded-lg transition-colors hidden xl:flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          title="Tải nguyên thư mục nhiều cấp từ máy tính"
        >
          <FolderUp
            className="w-3.5 h-3.5 text-amber-400 shrink-0"
            aria-hidden="true"
          />
          <span>Thư mục</span>
        </button>
      </div>

      {/* Zone 3: Clear + Undo + Export + Account Tier Badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        {totalCount > 0 && (
          <button
            type="button"
            onClick={onClearAllWorkspace}
            className="p-1.5 text-xs font-medium text-zinc-400 hover:text-rose-300 bg-[#09090B] hover:bg-zinc-800 border border-white/10 rounded-lg transition-colors cursor-pointer"
            title="Làm mới danh sách ảnh hiện tại"
            aria-label="Làm mới không gian làm việc"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}

        {canUndoReject && (
          <button
            type="button"
            onClick={onUndoReject}
            className="p-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-[#09090B] hover:bg-zinc-800 border border-white/10 rounded-lg transition-colors cursor-pointer"
            title="Hoàn tác loại bỏ (Phím Z)"
            aria-label="Hoàn tác loại bỏ"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenExportModal}
          disabled={keptCount === 0}
          className="px-3 py-1.5 text-xs font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors flex items-center gap-1.5 shadow-sm whitespace-nowrap cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Xuất</span>
          {totalCount > 0 && (
            <span className="font-mono tabular-nums text-zinc-900/80 font-semibold">
              ({keptCount})
            </span>
          )}
        </button>

        {/* Account Tier CTA / Status Badge */}
        {entitlements.isPro ? (
          <button
            type="button"
            onClick={() => onOpenUpgradeModal()}
            title={`${profile?.email || ''} — Đã mở khóa Full chức năng${
              profile?.role === 'admin' ? ' (Quản trị viên — bấm để tạo Mã VIP)' : ''
            }`}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-xs font-semibold text-emerald-300 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            {profile?.role === 'admin' ? (
              <Shield className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>PRO FULL</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onOpenUpgradeModal()}
            title={`${profile?.email || ''} — Đang dùng Tài khoản Thường. Bấm để Mở khóa Full chức năng!`}
            className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 text-xs font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer shadow-xs"
          >
            <Crown className="w-3.5 h-3.5" />
            <span>Mở khóa Full</span>
          </button>
        )}

        {profile && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Đăng xuất tài khoản"
            title={`Đăng xuất (${profile.email})`}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-300 hover:bg-white/5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}

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
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors cursor-pointer"
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
