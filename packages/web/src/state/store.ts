import {
  type Adjacency, createJob, type Drawing, type Job, type LengthUnit, type Mesh, type MeshDiagnostics, type NewModel, type ParsedProgram, setModel,
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

export interface ProgramData {
  status: 'parsing' | 'ready' | 'failed';
  /** Decoded text, for the line list. */
  text: string;
  parsed: ParsedProgram | null;
  error: string | null;
}

export type Visibility = 'rapids' | 'model' | 'stock';
export type DockTab = 'gcode' | 'analysis';

export interface LoadedDocument {
  job: Job;
  geometry: ModelGeometry | null;
  modelBytes: Uint8Array | null;
  warnings: string[];
  dirty: boolean;
  fileHandle: FileSystemFileHandle | null;
  programBytes: Record<string, Uint8Array>;
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
  /** Original program bytes by blobId (saved into .spon files). */
  programBytes: Record<string, Uint8Array>;
  /** Parsed program data by blobId (view state, not undoable). */
  programData: Record<string, ProgramData>;
  activeProgramId: string | null;
  selectedLine: number | null;
  /** Global timeline position, seconds. */
  playhead: number;
  playing: boolean;
  speed: number;
  visibility: Record<Visibility, boolean>;
  dockTab: DockTab;

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
  setProgramBytes(blobId: string, bytes: Uint8Array): void;
  setProgramData(blobId: string, data: ProgramData): void;
  /** Drops programBytes/programData entries for blobs no longer referenced (see referencedBlobIds). */
  pruneProgramData(keepIds: readonly string[]): void;
  setActiveProgram(id: string | null): void;
  setSelectedLine(line: number | null): void;
  setPlayhead(seconds: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  toggleVisibility(v: Visibility): void;
  setDockTab(tab: DockTab): void;
}

/** Keeps `activeProgramId` if `job` still has it, otherwise falls back to the first program, or null. */
function activeProgramIdFor(job: Job, activeProgramId: string | null): string | null {
  if (activeProgramId !== null && job.programs.some((p) => p.id === activeProgramId)) return activeProgramId;
  return job.programs[0]?.id ?? null;
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
    programBytes: {},
    programData: {},
    activeProgramId: null,
    selectedLine: null,
    playhead: 0,
    playing: false,
    speed: 1,
    visibility: { rapids: true, model: true, stock: true },
    dockTab: 'gcode',

    commit(update) {
      const { job, past } = get();
      const next = update(job);
      if (next === job) return;
      set({ job: next, past: [...past, job].slice(-UNDO_LIMIT), future: [], dirty: true });
    },
    undo() {
      const { job, past, future, activeProgramId } = get();
      const previous = past.at(-1);
      if (!previous) return;
      set({
        job: previous, past: past.slice(0, -1), future: [job, ...future], dirty: true,
        activeProgramId: activeProgramIdFor(previous, activeProgramId),
      });
    },
    redo() {
      const { job, past, future, activeProgramId } = get();
      const [next, ...rest] = future;
      if (!next) return;
      set({
        job: next, past: [...past, job].slice(-UNDO_LIMIT), future: rest, dirty: true,
        activeProgramId: activeProgramIdFor(next, activeProgramId),
      });
    },
    loadDocument(doc) {
      set({
        ...doc, past: [], future: [], pickMode: 'none', hiddenLayers: [], pendingImport: null,
        programData: {}, activeProgramId: doc.job.programs[0]?.id ?? null, selectedLine: null, playhead: 0, playing: false,
      });
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
    setProgramBytes(blobId, bytes) {
      set({ programBytes: { ...get().programBytes, [blobId]: bytes } });
    },
    setProgramData(blobId, data) {
      set({ programData: { ...get().programData, [blobId]: data } });
    },
    pruneProgramData(keepIds) {
      const keep = new Set(keepIds);
      const { programBytes, programData } = get();
      set({
        programBytes: Object.fromEntries(Object.entries(programBytes).filter(([id]) => keep.has(id))),
        programData: Object.fromEntries(Object.entries(programData).filter(([id]) => keep.has(id))),
      });
    },
    setActiveProgram(activeProgramId) {
      set({ activeProgramId, selectedLine: null });
    },
    setSelectedLine(selectedLine) {
      set({ selectedLine });
    },
    setPlayhead(playhead) {
      set({ playhead: Math.max(0, playhead) });
    },
    setPlaying(playing) {
      set({ playing });
    },
    setSpeed(speed) {
      set({ speed });
    },
    toggleVisibility(v) {
      const visibility = get().visibility;
      set({ visibility: { ...visibility, [v]: !visibility[v] } });
    },
    setDockTab(dockTab) {
      set({ dockTab });
    },
  }));
}

export const appStore = createAppStore();

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
