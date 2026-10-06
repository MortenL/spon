import { useEffect } from 'react';
import { movePlayhead, togglePlaying } from '@/gcode/playback';
import { buildTimeline, stepTime } from '@/gcode/timeline';
import { openViaPicker, saveDocument } from '@/state/documents';
import { allPrograms } from '@/state/programList';
import { runCommand } from '@/state/camView';
import { appStore } from '@/state/store';
import { removeSelectedTabCommand } from '@/state/tabEdits';

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

/**
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo-redo, Ctrl+S save (Shift = Save As), Ctrl+O open, F fit,
 * Esc deselects a tab or cancels a CAM pick or lay-flat picking, Space play/pause, ←/→ step one move, Home/End jump,
 * Delete/Backspace removes the selected tab. (Delete, Ctrl+D and Alt+↑/↓ on the selected operation live in the
 * Operations panel; it leaves Delete alone while a tab is selected or once this handler has used the key.)
 */
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
        const tl = buildTimeline(allPrograms(s), s.programData);
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
      if (!mod && !e.altKey && (key === 'delete' || key === 'backspace') && s.selectedTab) {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
        e.preventDefault();
        const command = removeSelectedTabCommand(s);
        if (command) runCommand(command);
        else s.selectTab(null);
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
      } else if (key === 'escape') {
        if (s.selectedTab) s.selectTab(null);
        else if (s.camPick) s.setCamPick(null);
        else if (s.pickMode !== 'none') s.setPickMode('none');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
