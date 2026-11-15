import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { DriveMediaItem } from '../types/media';
import { LiveEditedPhotoPreview } from './VirtualMediaGrid';

interface LightboxModalProps {
  item: DriveMediaItem | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleReject: (item: DriveMediaItem) => void;
  onOpenCrop: (item: DriveMediaItem) => void;
  currentIndex: number;
  totalFiltered: number;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  item,
  onClose,
  onPrev,
  onNext,
  onToggleReject,
  onOpenCrop,
  currentIndex,
  totalFiltered,
}) => {
  if (!item) return null;

  const isVideo = item.mediaType === 'video';
  const driveEmbedUrl = `https://drive.google.com/file/d/${item.id}/preview`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/92 backdrop-blur-xs flex flex-col select-none"
      onClick={onClose}
    >
      {/* Top Header Bar */}
      <div
        className="h-14 px-6 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between gap-4 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
            {currentIndex + 1} / {totalFiltered}
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            ·
          </span>
          <span className="text-sm font-semibold text-zinc-100 truncate">
            {item.name}
          </span>
          <span className="text-zinc-700" aria-hidden="true">
            ·
          </span>
          <span className="text-xs text-zinc-400 truncate">
            {item.folderName}
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {!isVideo && (
            <button
              type="button"
              onClick={() => onOpenCrop(item)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Crop className="w-3.5 h-3.5 text-indigo-400" />
              <span>Cắt khung hình (C)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onToggleReject(item)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              item.status === 'kept'
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {item.status === 'kept' ? (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Loại bỏ file này (X)</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Khôi phục lại</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
            title="Đóng (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden">
        {/* Previous Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-5 z-20 w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
          title="File trước (Mũi tên trái)"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        {/* Media Content */}
        <div
          className="max-w-5xl max-h-full w-full h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {isVideo ? (
            <div className="w-full max-w-4xl aspect-video bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
              <iframe
                src={driveEmbedUrl}
                title={item.name}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
              />
            </div>
          ) : (
            <div className="max-w-full max-h-full flex items-center justify-center">
              <LiveEditedPhotoPreview
                item={item}
                useHighRes={true}
                className="max-h-[78vh] max-w-[82vw] rounded-lg shadow-2xl border border-zinc-800"
              />
            </div>
          )}
        </div>

        {/* Next Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-5 z-20 w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg cursor-pointer transition-transform active:scale-95"
          title="File tiếp theo (Mũi tên phải)"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
