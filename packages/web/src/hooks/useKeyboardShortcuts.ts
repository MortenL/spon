import { useEffect } from 'react';
import { movePlayhead, togglePlaying } from '@/gcode/playback';
import { buildTimeline, stepTime } from '@/gcode/timeline';
import { openViaPicker, saveDocument } from '@/state/documents';
import { appStore } from '@/state/store';

const PLAYBACK_KEYS = [' ', 'arrowleft', 'arrowright', 'home', 'end'];

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/**
 * Like isTyping, but doesn't count a range input (the timeline scrubber) or a select (the speed
 * picker) as typing: dragging the scrubber or picking a speed shouldn't stop Space/←/→/Home/End
 * from still working as playback keys. Text and number inputs still block them.
 */
function isTypingForPlaybackKeys(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement && target.type === 'range') return false;
  if (target instanceof HTMLSelectElement) return false;
  return isTyping(target);
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
      const playbackKey = !mod && PLAYBACK_KEYS.includes(key);
      if (playbackKey ? isTypingForPlaybackKeys(e.target) : isTyping(e.target)) return;
      if (playbackKey) {
        const tl = buildTimeline(s.job.programs, s.programData);
        if (tl.total <= 0) return;
        if (key === ' ') {
          if (e.target instanceof HTMLButtonElement) return; // a focused button handles Space itself
          e.preventDefault();
          togglePlaying(tl);
          return;
        }
        e.preventDefault(); // stop the native range/select behaviour (value step, jump to end) from also firing
        s.setPlaying(false);
        if (key === 'home') movePlayhead(0);
        else if (key === 'end') movePlayhead(tl.total);
        else movePlayhead(stepTime(tl, s.programData, s.playhead, key === 'arrowright' ? 1 : -1));
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
