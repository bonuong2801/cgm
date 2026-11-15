import { useEffect } from 'react';

interface KeyboardShortcutHandlers {
  onPrevItem: () => void;
  onNextItem: () => void;
  onRejectCurrent: () => void;
  onUndoLastReject: () => void;
  onOpenCropModal: () => void;
  onToggleLightbox: () => void;
  onCloseModal: () => void;
  isAnyModalOpen: boolean;
}

/**
 * Keyboard Shortcuts for high-speed photo culling & editing:
 * - ArrowLeft / ArrowRight: Navigate to previous / next media item
 * - Space: Toggle full-screen zoomable Loupe / Lightbox view
 * - X or Delete: Reject current item (and automatically advance to next item)
 * - Z (or Ctrl+Z / Cmd+Z): Undo last rejection
 * - C: Open Crop modal for the currently selected photo
 * - Escape: Close active modal
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (handlers.isAnyModalOpen) {
          e.preventDefault();
          handlers.onCloseModal();
        }
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        handlers.onToggleLightbox();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlers.onPrevItem();
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handlers.onNextItem();
        return;
      }

      if (
        e.key === 'x' ||
        e.key === 'X' ||
        e.key === 'Delete' ||
        e.key === 'Backspace'
      ) {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handlers.onRejectCurrent();
        }
        return;
      }

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        handlers.onUndoLastReject();
        return;
      }

      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlers.onOpenCropModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
