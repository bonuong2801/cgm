import React from 'react';
import { BookOpen, X } from 'lucide-react';

interface UserGuideModalProps {
  isOpen: boolean;
  hidePermanently: boolean;
  onToggleHidePermanently: (next: boolean) => void;
  onClose: () => void;
}

const GUIDE_STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: '1. Nạp ảnh từ Drive hoặc Máy tính',
    body: (
      <>
        Dán link thư mục Google Drive đã bật chia sẻ{' '}
        <em className="text-zinc-300">
          “Bất kỳ ai có đường liên kết đều có thể xem”
        </em>{' '}
        rồi bấm <strong className="text-zinc-200">Tải Drive</strong>, hoặc bấm{' '}
        <strong className="text-zinc-200">Tải ảnh / Thư mục</strong> (hỗ trợ
        kéo-thả trực tiếp vào màn hình).
      </>
    ),
  },
  {
    title: '2. Soi & lọc ảnh siêu nhanh',
    body: (
      <>
        <strong className="text-zinc-200">Lăn chuột hoặc chụm 2 ngón</strong> để
        zoom tới 500%, kéo để xem chi tiết, nhấp đúp để bật/tắt phóng to. Trên
        điện thoại &amp; iPad có thể <strong className="text-zinc-200">vuốt trái/phải</strong>{' '}
        đổi ảnh; trên máy tính dùng <Kbd>←</Kbd> <Kbd>→</Kbd>, <Kbd>X</Kbd>{' '}
        loại, <Kbd>P</Kbd> giữ, <Kbd>Z</Kbd> hoàn tác.
      </>
    ),
  },
  {
    title: '3. Chỉnh màu, cắt khung & ghép nhiều Logo',
    body: (
      <>
        Bảng bên phải có 2 tab:{' '}
        <strong className="text-zinc-200">Chỉnh màu &amp; Cắt</strong> (ánh
        sáng, màu sắc, cắt khung <Kbd>C</Kbd>, giữ <Kbd>\</Kbd> để so sánh ảnh
        gốc, đồng bộ hàng loạt) và{' '}
        <strong className="text-zinc-200">Multi-Logo</strong> (ghép nhiều lớp
        Logo, kéo đặt trực tiếp trên ảnh, lưu bộ Logo mẫu).
      </>
    ),
  },
  {
    title: '4. Chọn nhiều ảnh & xuất trọn độ nét',
    body: (
      <>
        Chuyển giữa <strong className="text-zinc-200">Loupe</strong> và{' '}
        <strong className="text-zinc-200">Lưới</strong> để tích chọn nhiều ảnh
        (giữ <Kbd>Shift</Kbd> để chọn cả dải). Xong việc, bấm nút{' '}
        <strong className="text-amber-300">Xuất</strong> màu vàng ở góc trên
        bên phải để lưu ảnh về máy.
      </>
    ),
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-white/10 font-mono text-[11px] text-amber-300">
      {children}
    </kbd>
  );
}

export const UserGuideModal: React.FC<UserGuideModalProps> = ({
  isOpen,
  hidePermanently,
  onToggleHidePermanently,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-guide-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2.5 sm:p-4 select-none"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full bg-[#121215] border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-white/10 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400 shrink-0">
              <BookOpen className="w-4.5 h-4.5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="user-guide-title"
                className="text-sm font-bold text-zinc-100"
              >
                Hướng dẫn sử dụng CGM Studio
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Quy trình lọc ảnh, chỉnh màu, gắn nhiều Logo và xuất ảnh nhanh
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hướng dẫn"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-3.5 text-xs">
          {GUIDE_STEPS.map((step) => (
            <div
              key={step.title}
              className="bg-[#09090B] border border-white/10 rounded-xl p-3.5 sm:p-4 space-y-1.5"
            >
              <div className="font-semibold text-amber-300">{step.title}</div>
              <p className="text-zinc-400 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="px-4 sm:px-5 py-3.5 pb-safe bg-[#0B0B0D] border-t border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={hidePermanently}
              onChange={(e) => onToggleHidePermanently(e.target.checked)}
              className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
            />
            <span>Không hiển thị lại vĩnh viễn khi đăng nhập</span>
          </label>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-zinc-950 cursor-pointer"
          >
            Bắt đầu làm việc
          </button>
        </div>
      </div>
    </div>
  );
};
