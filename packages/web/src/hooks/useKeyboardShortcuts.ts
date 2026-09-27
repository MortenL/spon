import { useEffect } from 'react';
import { buildTimeline, stepTime } from '@/gcode/timeline';
import { openViaPicker, saveDocument } from '@/state/documents';
import { appStore } from '@/state/store';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo-redo, Ctrl+S save (Shift = Save As), Ctrl+O open, F fit, Esc cancels picking, Space play/pause, ←/→ step one move, Home/End jump. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = appStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void saveDocument(e.shiftKey);
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        void openViaPicker();
        return;
      }
      if (isTyping(e.target)) return;
      if (!mod && [' ', 'arrowleft', 'arrowright', 'home', 'end'].includes(key)) {
        const tl = buildTimeline(s.job.programs, s.programData);
        if (tl.total <= 0) return;
        if (key === ' ') {
          if (e.target instanceof HTMLButtonElement) return; // a focused button handles Space itself
          e.preventDefault();
          if (!s.playing && s.playhead >= tl.total) s.setPlayhead(0);
          s.setPlaying(!s.playing);
          return;
        }
        e.preventDefault();
        s.setPlaying(false);
        if (key === 'home') s.setPlayhead(0);
        else if (key === 'end') s.setPlayhead(tl.total);
        else s.setPlayhead(stepTime(tl, s.programData, s.playhead, key === 'arrowright' ? 1 : -1));
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (!mod && key === 'f') {
        s.requestView('fit');
      } else if (key === 'escape' && s.pickMode !== 'none') {
        s.setPickMode('none');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
