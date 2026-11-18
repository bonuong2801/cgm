import { useEffect, useRef } from 'react';
import type { StarRating } from '../types/media.ts';

export interface KeyboardShortcutHandlers {
  onPrevItem: () => void;
  onNextItem: () => void;
  onRejectCurrent: () => void;
  onKeepCurrent: () => void;
  onRateCurrent: (rating: StarRating) => void;
  onUndoLastReject: () => void;
  onOpenCropModal: () => void;
  onToggleLightbox: () => void;
  onCloseModal: () => void;
  onCompareOriginalChange: (comparing: boolean) => void;
  isAnyModalOpen: boolean;
}

/**
 * Studio Keyboard Shortcuts (bound once via ref — zero listener churn on re-renders):
 * - ArrowLeft / ArrowRight: Previous / Next media item
 * - Space: Toggle full-screen Lightbox
 * - X / Delete / Backspace: Reject current item & advance
 * - P / U: Mark Kept / Restore current item
 * - 1..5: Toggle 1..5 Star Rating on current item
 * - Hold `\`: Instant Before / After original comparison
 * - Z (or Ctrl/Cmd+Z): Undo last rejection
 * - C: Open Crop modal
 * - Escape: Close active modal
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const h = ref.current;
      if (isEditableTarget(e.target)) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === '\\') {
        if (!e.repeat) {
          h.onCompareOriginalChange(true);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (h.isAnyModalOpen) {
          e.preventDefault();
          h.onCloseModal();
        }
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        h.onToggleLightbox();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        h.onPrevItem();
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        h.onNextItem();
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
          h.onRejectCurrent();
        }
        return;
      }

      if ((e.key === 'p' || e.key === 'P' || e.key === 'u' || e.key === 'U') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        h.onKeepCurrent();
        return;
      }

      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        ['1', '2', '3', '4', '5'].includes(e.key)
      ) {
        e.preventDefault();
        h.onRateCurrent(Number(e.key) as StarRating);
        return;
      }

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        h.onUndoLastReject();
        return;
      }

      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        h.onOpenCropModal();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') {
        ref.current.onCompareOriginalChange(false);
      }
    };

    const handleWindowBlur = () => {
      ref.current.onCompareOriginalChange(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);
}
