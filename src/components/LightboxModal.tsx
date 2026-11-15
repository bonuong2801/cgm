import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Film,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { DriveMediaItem } from '../types/media';
import {
  LiveEditedPhotoPreview,
  formatVideoDuration,
} from './VirtualMediaGrid';

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
  const [demoVideoPlaying, setDemoVideoPlaying] = useState(true);
  const [demoVideoProgress, setDemoVideoProgress] = useState(0);

  useEffect(() => {
    setDemoVideoPlaying(true);
    setDemoVideoProgress(0);
  }, [item?.id]);

  useEffect(() => {
    if (!item || item.mediaType !== 'video' || !item.isDemo || !demoVideoPlaying) {
      return;
    }
    const timer = window.setInterval(() => {
      setDemoVideoProgress((prev) => (prev >= 100 ? 0 : prev + 1.5));
    }, 200);
    return () => window.clearInterval(timer);
  }, [item, demoVideoPlaying]);

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
            item.isDemo ? (
              /* Interactive Demo Mode Video Player + Google Drive Embed Structure Info */
              <div className="w-full max-w-4xl aspect-video bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-2xl relative">
                <div className="relative flex-1 overflow-hidden flex items-center justify-center">
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    className={`w-full h-full object-cover transition-transform duration-500 ${
                      demoVideoPlaying ? 'scale-103' : 'scale-100'
                    }`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/40 flex flex-col justify-between p-6">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
                        <Film className="w-4 h-4" />
                        <span>
                          Trình phát Video trực tiếp (Google Drive Iframe Stream)
                        </span>
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-300">
                        Thời lượng: {formatVideoDuration(item.durationMillis)}
                      </span>
                    </div>

                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => setDemoVideoPlaying((p) => !p)}
                        className="w-16 h-16 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white flex items-center justify-center shadow-xl cursor-pointer transition-transform hover:scale-105"
                      >
                        {demoVideoPlaying ? (
                          <Pause className="w-7 h-7 fill-white" />
                        ) : (
                          <Play className="w-7 h-7 fill-white ml-1" />
                        )}
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-200"
                          style={{ width: `${demoVideoProgress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>
                          {demoVideoPlaying ? 'Đang phát luồng mẫu...' : 'Đã tạm dừng'}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          Embed URL: {driveEmbedUrl}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Real Google Drive Video Adaptive Streaming Iframe */
              <div className="w-full max-w-4xl aspect-video bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                <iframe
                  src={driveEmbedUrl}
                  title={item.name}
                  className="w-full h-full border-0"
                  allow="autoplay; fullscreen"
                />
              </div>
            )
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
