import {
  type Adjacency, createJob, type Drawing, type Job, type LengthUnit, type Mesh, type MeshDiagnostics, type NewModel, setModel,
  type Vec3,
} from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export const UNDO_LIMIT = 100;

export type ModelGeometry =
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; rawPoints: Float32Array }
  | { kind: 'drawing'; drawing: Drawing; rawPoints: Float32Array };

export type PickMode = 'none' | 'face' | 'edge';
export type ViewPreset = 'fit' | 'top' | 'front' | 'right' | 'iso';

export interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  geometry: ModelGeometry;
  warnings: string[];
  suggestedUnits: LengthUnit;
}

export interface LoadedDocument {
  job: Job;
  geometry: ModelGeometry | null;
  modelBytes: Uint8Array | null;
  warnings: string[];
  dirty: boolean;
  fileHandle: FileSystemFileHandle | null;
}

export interface AppState {
  job: Job;
  geometry: ModelGeometry | null;
  /** Original bytes of the imported model file, saved into .spon files. */
  modelBytes: Uint8Array | null;
  warnings: string[];
  past: Job[];
  future: Job[];
  dirty: boolean;
  fileHandle: FileSystemFileHandle | null;
  pickMode: PickMode;
  showEdges: boolean;
  hiddenLayers: string[];
  cursor: Vec3 | null;
  viewRequest: { preset: ViewPreset; nonce: number };
  pendingImport: PendingImport | null;
  busy: string | null;

  commit(update: (job: Job) => Job): void;
  undo(): void;
  redo(): void;
  loadDocument(doc: LoadedDocument): void;
  applyImportedModel(model: NewModel, geometry: ModelGeometry, modelBytes: Uint8Array, warnings: string[]): void;
  markSaved(handle: FileSystemFileHandle | null): void;
  setPickMode(mode: PickMode): void;
  toggleEdges(): void;
  toggleLayer(name: string): void;
  setCursor(point: Vec3 | null): void;
  requestView(preset: ViewPreset): void;
  setPendingImport(pending: PendingImport | null): void;
  setBusy(message: string | null): void;
}

export function createAppStore(initialJob: Job = createJob()): StoreApi<AppState> {
  return createStore<AppState>()((set, get) => ({
    job: initialJob,
    geometry: null,
    modelBytes: null,
    warnings: [],
    past: [],
    future: [],
    dirty: false,
    fileHandle: null,
    pickMode: 'none',
    showEdges: true,
    hiddenLayers: [],
    cursor: null,
    viewRequest: { preset: 'fit', nonce: 0 },
    pendingImport: null,
    busy: null,

    commit(update) {
      const { job, past } = get();
      const next = update(job);
      if (next === job) return;
      set({ job: next, past: [...past, job].slice(-UNDO_LIMIT), future: [], dirty: true });
    },
    undo() {
      const { job, past, future } = get();
      const previous = past.at(-1);
      if (!previous) return;
      set({ job: previous, past: past.slice(0, -1), future: [job, ...future], dirty: true });
    },
    redo() {
      const { job, past, future } = get();
      const [next, ...rest] = future;
      if (!next) return;
      set({ job: next, past: [...past, job].slice(-UNDO_LIMIT), future: rest, dirty: true });
    },
    loadDocument(doc) {
      set({ ...doc, past: [], future: [], pickMode: 'none', hiddenLayers: [], pendingImport: null });
    },
    applyImportedModel(model, geometry, modelBytes, warnings) {
      // A new model starts a new undo history, so undo never refers to a discarded model blob.
      set({ job: setModel(get().job, model), geometry, modelBytes, warnings, past: [], future: [], dirty: true, pickMode: 'none', hiddenLayers: [] });
    },
    markSaved(handle) {
      set({ dirty: false, fileHandle: handle });
    },
    setPickMode(pickMode) {
      set({ pickMode });
    },
    toggleEdges() {
      set({ showEdges: !get().showEdges });
    },
    toggleLayer(name) {
      const hidden = get().hiddenLayers;
      set({ hiddenLayers: hidden.includes(name) ? hidden.filter((n) => n !== name) : [...hidden, name] });
    },
    setCursor(cursor) {
      set({ cursor });
    },
    requestView(preset) {
      set({ viewRequest: { preset, nonce: get().viewRequest.nonce + 1 } });
    },
    setPendingImport(pendingImport) {
      set({ pendingImport });
    },
    setBusy(busy) {
      set({ busy });
    },
  }));
}

export const appStore = createAppStore();

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
