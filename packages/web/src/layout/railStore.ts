import type { Job } from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type PanelId = 'model' | 'orientation' | 'stock' | 'origin' | 'text' | 'operations' | 'post' | 'programs';
export const PANEL_IDS: readonly PanelId[] = ['model', 'orientation', 'stock', 'origin', 'text', 'operations', 'post', 'programs'];
export const WIDTH = { min: 260, max: 560, default: 320 } as const;

export interface Settings { get(key: string): string | null; set(key: string, value: string | null): void }
export interface RailState {
  open: PanelId;
  hidden: boolean;
  width: number;
  /** A rail click: opens `id`, or hides the panel when `id` is already open and shown. */
  select(id: PanelId): void;
  /** Opens `id` and makes sure the panel is shown (automatic switches). */
  show(id: PanelId): void;
  setWidth(px: number): void;
}

const KEY = { open: 'spon.rail.open', hidden: 'spon.rail.hidden', width: 'spon.rail.width' } as const;
const clampWidth = (px: number) => Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, px)));

/** Missing or non-numeric gives the default; 0 gives the minimum; anything else is clamped. */
function initialWidth(text: string | null | undefined): number {
  if (!text?.trim()) return WIDTH.default;
  const n = Number(text);
  return Number.isFinite(n) ? clampWidth(n) : WIDTH.default;
}

function safe(settings: Settings): Settings {
  return {
    get: (k) => { try { return settings.get(k); } catch { return null; } },
    set: (k, v) => { try { settings.set(k, v); } catch { /* not remembered */ } },
  };
}

export function createRailStore(raw: Settings): StoreApi<RailState> {
  const s = safe(raw);
  const storedOpen = s.get(KEY.open);
  return createStore<RailState>()((set, get) => ({
    open: (PANEL_IDS as readonly string[]).includes(storedOpen ?? '') ? (storedOpen as PanelId) : 'model',
    hidden: s.get(KEY.hidden) === '1',
    width: initialWidth(s.get(KEY.width)),
    select(id) {
      const { open, hidden } = get();
      if (id === open && !hidden) {
        set({ hidden: true });
        s.set(KEY.hidden, '1');
      } else get().show(id);
    },
    show(id) {
      set({ open: id, hidden: false });
      s.set(KEY.open, id);
      s.set(KEY.hidden, null);
    },
    setWidth(px) {
      const width = clampWidth(px);
      if (width === get().width) return;
      set({ width });
      s.set(KEY.width, String(width));
    },
  }));
}

const browserSettings: Settings = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
};
export const railStore = createRailStore(browserSettings);
export const useRail = <T>(selector: (s: RailState) => T): T => useStore(railStore, selector);

type JobLists = Pick<Job, 'model' | 'operations' | 'programs'>;
const added = (prev: readonly { id: string }[], next: readonly { id: string }[]) => next.some((x) => !prev.some((p) => p.id === x.id));

/** Spec §4.3: the panel a job change should bring forward (a new model, then a new program, then a new operation), or null. */
export function autoPanel(prev: JobLists, next: JobLists): PanelId | null {
  if (next.model && next.model.blobId !== prev.model?.blobId) return 'model';
  if (added(prev.programs, next.programs)) return 'programs';
  if (added(prev.operations, next.operations)) return 'operations';
  return null;
}
