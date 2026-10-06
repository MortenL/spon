import {
  applyCommand, applyCommands, type CadBodySummary, type CadFormat, createJob, type GeometryCatalog, type Job,
  type JobCommand, type LengthUnit, type ModelGeometry, type NewModel, type ParsedProgram, type ProgramRef, setModel, type TextSummary, type Vec2, type Vec3,
} from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CamFile, CamPickTarget, InspectorTab, OperationSummary } from './camTypes';
import type { CamOutput } from './cam';
import { allPrograms } from './programList';

export const UNDO_LIMIT = 100;

export type { ModelGeometry } from '@sponcam/core';

export type PickMode = 'none' | 'face' | 'edge';
export type ViewPreset = 'fit' | 'top' | 'front' | 'right' | 'iso';

export interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  geometry: ModelGeometry;
  warnings: string[];
  suggestedUnits: LengthUnit;
}

/** A STEP/IGES file with several bodies, waiting for the body dialog. */
export interface PendingBodies {
  fileName: string;
  bytes: Uint8Array;
  format: CadFormat;
  bodies: CadBodySummary[];
}

/** An SVG without real-world units, waiting for the scale dialog. */
export interface PendingScale {
  fileName: string;
  bytes: Uint8Array;
  rawSize: Vec2;
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
  fontBytes: Record<string, Uint8Array>;
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
  pendingBodies: PendingBodies | null;
  pendingScale: PendingScale | null;
  busy: string | null;
  /** Original program bytes by blobId (saved into .spon files). */
  programBytes: Record<string, Uint8Array>;
  /** Parsed program data by blobId (view state, not undoable). */
  programData: Record<string, ProgramData>;
  /** Original bytes of uploaded fonts by blobId (saved into .spon files). */
  fontBytes: Record<string, Uint8Array>;
  /** Font blob ids registered but not yet used by any text; pruning keeps them until a text references them. */
  pendingFontIds: string[];
  activeProgramId: string | null;
  selectedLine: number | null;
  /** Global timeline position, seconds. */
  playhead: number;
  playing: boolean;
  speed: number;
  visibility: Record<Visibility, boolean>;
  dockTab: DockTab;
  /** Programs produced by the CAM pipeline (not stored, not undoable; see allPrograms). */
  generatedPrograms: ProgramRef[];
  camFiles: CamFile[];
  camResults: Record<string, OperationSummary>;
  catalog: GeometryCatalog | null;
  /** Laid-out texts from the last generation (program coordinates). */
  camTexts: TextSummary[];
  camStatus: 'idle' | 'generating';
  selectedOperationId: string | null;
  selectedTextId: string | null;
  /** The text whose surface face is being picked in the viewport. */
  textPick: string | null;
  camPick: { operationId: string; target: CamPickTarget } | null;
  /**
   * The tab selected in the viewport (of the selected operation): its contour and its index within the contour.
   * Cleared when the selected operation changes and by every job edit, undo and redo, since they may renumber tabs.
   */
  selectedTab: { refIndex: number; index: number } | null;
  inspectorTab: InspectorTab;

  commit(update: (job: Job) => Job): void;
  /** Applies a CAM job edit through applyCommand; CommandError propagates to the caller. */
  dispatch(command: JobCommand): void;
  /** Applies several job commands as one undo step, all or none; a CommandError names the failing command. */
  dispatchBatch(commands: readonly JobCommand[]): void;
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
  setPendingBodies(pending: PendingBodies | null): void;
  setPendingScale(pending: PendingScale | null): void;
  setBusy(message: string | null): void;
  setProgramBytes(blobId: string, bytes: Uint8Array): void;
  setProgramData(blobId: string, data: ProgramData): void;
  /** Stores uploaded font bytes; the blob stays safe from pruning until a text references it or the document is replaced. */
  addFontBytes(blobId: string, bytes: Uint8Array): void;
  setPendingFontIds(ids: string[]): void;
  /** Drops programBytes/programData entries for blobs no longer referenced (see referencedBlobIds). */
  pruneProgramData(keepIds: readonly string[]): void;
  setActiveProgram(id: string | null): void;
  setSelectedLine(line: number | null): void;
  setPlayhead(seconds: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  toggleVisibility(v: Visibility): void;
  setDockTab(tab: DockTab): void;
  setCamOutput(output: CamOutput): void;
  setCamStatus(status: 'idle' | 'generating'): void;
  selectOperation(id: string | null): void;
  /** Selecting a text clears the selected operation and the reverse. */
  selectText(id: string | null): void;
  setTextPick(textId: string | null): void;
  setCamPick(pick: { operationId: string; target: CamPickTarget } | null): void;
  selectTab(tab: { refIndex: number; index: number } | null): void;
  setInspectorTab(tab: InspectorTab): void;
}

/** Keeps `activeProgramId` if it's still in `programs`, otherwise falls back to the first program, or null. */
function activeProgramIdFor(programs: readonly ProgramRef[], activeProgramId: string | null): string | null {
  if (activeProgramId !== null && programs.some((p) => p.id === activeProgramId)) return activeProgramId;
  return programs[0]?.id ?? null;
}

/** Clears the text selection and face pick when the text they name is no longer in the job (undo of an add, a removal by Claude). */
function textSelectionFor(job: Job, s: Pick<AppState, 'selectedTextId' | 'textPick'>): Partial<Pick<AppState, 'selectedTextId' | 'textPick'>> {
  const gone = (id: string | null) => id !== null && !job.texts.some((t) => t.id === id);
  return {
    ...(gone(s.selectedTextId) ? { selectedTextId: null } : {}),
    ...(gone(s.textPick) ? { textPick: null } : {}),
  };
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
    pendingBodies: null,
    pendingScale: null,
    busy: null,
    programBytes: {},
    programData: {},
    fontBytes: {},
    pendingFontIds: [],
    activeProgramId: null,
    selectedLine: null,
    playhead: 0,
    playing: false,
    speed: 1,
    visibility: { rapids: true, model: true, stock: true },
    dockTab: 'gcode',
    generatedPrograms: [],
    camFiles: [],
    camResults: {},
    catalog: null,
    camTexts: [],
    camStatus: 'idle',
    selectedOperationId: null,
    selectedTextId: null,
    textPick: null,
    camPick: null,
    selectedTab: null,
    inspectorTab: 'geometry',

    commit(update) {
      const { job, past } = get();
      const next = update(job);
      if (next === job) return;
      set({ job: next, past: [...past, job].slice(-UNDO_LIMIT), future: [], dirty: true, selectedTab: null, ...textSelectionFor(next, get()) });
    },
    dispatch(command) {
      get().commit((job) => applyCommand(job, command));
    },
    dispatchBatch(commands) {
      get().commit((job) => applyCommands(job, commands));
    },
    undo() {
      const { job, past, future, activeProgramId, generatedPrograms } = get();
      const previous = past.at(-1);
      if (!previous) return;
      set({
        job: previous, past: past.slice(0, -1), future: [job, ...future], dirty: true, selectedTab: null, ...textSelectionFor(previous, get()),
        activeProgramId: activeProgramIdFor(allPrograms({ job: previous, generatedPrograms }), activeProgramId),
      });
    },
    redo() {
      const { job, past, future, activeProgramId, generatedPrograms } = get();
      const [next, ...rest] = future;
      if (!next) return;
      set({
        job: next, past: [...past, job].slice(-UNDO_LIMIT), future: rest, dirty: true, selectedTab: null, ...textSelectionFor(next, get()),
        activeProgramId: activeProgramIdFor(allPrograms({ job: next, generatedPrograms }), activeProgramId),
      });
    },
    loadDocument(doc) {
      set({
        ...doc, past: [], future: [], pickMode: 'none', hiddenLayers: [], pendingImport: null, pendingBodies: null, pendingScale: null,
        programData: {}, pendingFontIds: [], activeProgramId: doc.job.programs[0]?.id ?? null, selectedLine: null, playhead: 0, playing: false,
        generatedPrograms: [], camFiles: [], camResults: {}, catalog: null, camTexts: [], selectedOperationId: null, selectedTextId: null, textPick: null, camPick: null, selectedTab: null,
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
      set({ pickMode, ...(pickMode !== 'none' ? { camPick: null, textPick: null } : {}) });
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
    setPendingBodies(pendingBodies) {
      set({ pendingBodies });
    },
    setPendingScale(pendingScale) {
      set({ pendingScale });
    },
    setBusy(busy) {
      set({ busy });
    },
    setProgramBytes(blobId, bytes) {
      set({ programBytes: { ...get().programBytes, [blobId]: bytes } });
    },
    addFontBytes(blobId, bytes) {
      const { fontBytes, pendingFontIds } = get();
      set({ fontBytes: { ...fontBytes, [blobId]: bytes }, pendingFontIds: pendingFontIds.includes(blobId) ? pendingFontIds : [...pendingFontIds, blobId] });
    },
    setPendingFontIds(pendingFontIds) {
      set({ pendingFontIds });
    },
    setProgramData(blobId, data) {
      set({ programData: { ...get().programData, [blobId]: data } });
    },
    pruneProgramData(keepIds) {
      const keep = new Set(keepIds);
      const { programBytes, programData, fontBytes } = get();
      // an object is replaced only when an entry is dropped, so a no-op prune does not wake subscribers
      const kept = <T,>(record: Record<string, T>): Record<string, T> => {
        const entries = Object.entries(record);
        const filtered = entries.filter(([id]) => keep.has(id));
        return filtered.length === entries.length ? record : Object.fromEntries(filtered);
      };
      const next = { fontBytes: kept(fontBytes), programBytes: kept(programBytes), programData: kept(programData) };
      if (next.fontBytes !== fontBytes || next.programBytes !== programBytes || next.programData !== programData) set(next);
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
    setCamOutput(out) {
      const kept = Object.fromEntries(Object.entries(get().programData).filter(([id]) => !id.startsWith('gen:')));
      const next = {
        generatedPrograms: out.programs, camFiles: out.files, camResults: out.results, catalog: out.catalog, camTexts: out.texts,
        camStatus: 'idle' as const, programData: { ...kept, ...out.programData },
      };
      const programs = allPrograms({ job: get().job, generatedPrograms: out.programs });
      const active = get().activeProgramId;
      set({ ...next, activeProgramId: active !== null && programs.some((p) => p.id === active) ? active : (programs[0]?.id ?? null) });
    },
    setCamStatus(camStatus) {
      set({ camStatus });
    },
    selectOperation(id) {
      set({
        selectedOperationId: id, ...(id !== get().selectedOperationId ? { camPick: null, selectedTab: null } : {}),
        ...(id !== null ? { selectedTextId: null, textPick: null } : {}),
      });
    },
    selectText(id) {
      set({
        selectedTextId: id, ...(id !== get().selectedTextId ? { textPick: null } : {}),
        ...(id !== null ? { selectedOperationId: null, camPick: null, selectedTab: null } : {}),
      });
    },
    setTextPick(textId) {
      set({ textPick: textId, ...(textId !== null ? { camPick: null, pickMode: 'none' as const } : {}) });
    },
    setCamPick(camPick) {
      set({ camPick, ...(camPick !== null ? { pickMode: 'none' as const, textPick: null } : {}) });
    },
    selectTab(selectedTab) {
      set({ selectedTab });
    },
    setInspectorTab(inspectorTab) {
      set({ inspectorTab });
    },
  }));
}

export const appStore = createAppStore();

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
