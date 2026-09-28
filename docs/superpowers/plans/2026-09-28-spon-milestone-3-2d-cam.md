# Spon Milestone 3 — 2D/2.5D CAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Spon into a CAM tool. You pick profile, pocket and drill geometry from a DXF drawing or from an oriented STL. Spon then generates toolpaths with linked heights, post-processes them for GRBL, LinuxCNC or Fanuc, and feeds the G-code into the Milestone 2 simulator and exporter.

**Architecture:**
- All CAM logic lives in `@sponcam/core` as pure TypeScript:
  - feature resolution;
  - heights;
  - operations that produce a `Toolpath` move list;
  - a declarative post engine;
  - a JSON-serialisable command layer.
- Offsetting and booleans use `clipper2-ts` on polylines. An arc fitter turns the results back into lines and arcs.
- The web app runs generation in the existing Comlink worker, debounced, with a generation counter.
- Generated programs are shown alongside imported ones in the Milestone 2 timeline.

**Tech Stack:**
- TypeScript 7, Vitest 5;
- `clipper2-ts` 2.0.1-18 (BSL-1.0), new;
- `fflate` (zip);
- React + react-three-fiber, zustand, Comlink;
- Radix-based shadcn/ui;
- Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-2d-cam-design.md`. Read it together with this plan. It is the authority; this plan is its argument.

## Global Constraints

- Browser-only. Heavy work runs in the Comlink worker.
- `@sponcam/core` stays free of React, three.js and the DOM.
- Lengths are stored in mm and stored angles in degrees. Angles inside geometry code are radians.
- No GPL dependencies. The only new dependency is `clipper2-ts` (BSL-1.0), pinned to `2.0.1-18`.
- Every job edit added in Milestone 3 goes through `applyCommand` / the store's `dispatch`, and is undoable.
- Posted G-code must parse in the Milestone 2 interpreter with **zero error-severity diagnostics**.
- Performance targets:
  - a typical job generates, posts and analyses in < 300 ms in the worker;
  - a pocket with 1,000 contour segments generates in < 2 s at 0.002 mm tolerance.
- Default tolerance is 0.002 mm. Clipper coordinates are integers at 1e5 per mm.
- UI components are Radix-based shadcn/ui. Follow the existing panels: `PanelSection`, `NumericField`/`LengthField`, `ToggleGroup type="single"`, `data-state`.
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line. Any Claude model name is correct.
- Never push, and never rewrite history.

## Clarifications to the spec (binding for this plan)

1. **Generated programs live in the store, not in `job.programs`.**
   - The store holds `generatedPrograms: ProgramRef[]`, each with `source: 'generated'`, `operationIds`, `inTimeline: true`, and a stable id and blobId of `gen:<file name>`.
   - The timeline and the program list use `allPrograms(state) = [...generatedPrograms, ...job.programs]`, so generated programs come first, in machining order.
   - Stored `ProgramRef`s get `source: 'imported'` through the migration.
   - This keeps regeneration out of the undo history. It satisfies spec §3.1: generated programs are not stored, are regenerated when the job loads, and can't be removed by hand.
2. **Core geometry type.** Core defines `CamGeometry = { kind: 'mesh'; mesh; adjacency; rawPoints } | { kind: 'drawing'; drawing; rawPoints }`. The web `ModelGeometry` already has this shape, so it can be passed straight in. `describeGeometry(job, geometry: CamGeometry)` uses this type.
3. **Heights `from` values.**
   - The allowed values are `'stockTop' | 'stockBottom' | 'modelTop' | 'modelBottom' | 'contour' | 'face' | 'origin' | 'holeBottom' | 'retract' | 'feed' | 'top'`. Each height accepts the subset in spec §5.
   - `'origin'` means an absolute Z in program coordinates, where Z = 0 is the WCS.
   - For a DXF hole, `'holeBottom'` resolves to the stock bottom, because a drawing's holes are through holes.
4. **Tab positions.** `t` is a fraction (0–1) of the **tool-centre lap length** of contour `refIndex`, where `refIndex` is the index in the operation's resolved contour list. The lead start point uses the same convention.
5. **Profile entry with leads.**
   - When entry is `auto` or `ramp` and the lead-in is long enough (lead length × tan(rampAngle) ≥ the drop), the tool descends along the lead-in.
   - Otherwise it ramps along the path over whole laps, and the lead-in is skipped for that level.
   - `helix` is treated as `ramp` for profiles.
   - Open paths always plunge. The `entry-plunge` warning is raised unless the mode is `plunge`.
6. **Units of posted output.**
   - A job with `displayUnits: 'in'` posts `G20`, with coordinates and feeds divided by 25.4 and `decimals + 1` decimals.
   - Fanuc `G82` dwell is written as `P` in integer milliseconds, which is Fanuc's meaning. The Milestone 2 simulator reads P as seconds, so time estimates for Fanuc G82 are pessimistic. This is accepted and noted in the UI help text.
   - Every other dwell uses `G4 P<seconds>` for GRBL and LinuxCNC, and `G4 X<seconds>` for Fanuc.
7. **Drill cycles.**
   - Cycles use G98 (return to the initial level, which is the retract height), with R = feed height, Z = hole bottom, and Q = peck.
   - Expanded cycles (GRBL) reproduce this exactly with G0 and G1 moves.
8. **Worker model sync.** The worker keeps its own copy of the model geometry, sent by `setCamModel` whenever the store's `geometry` object changes. Generation calls only send the job (JSON) and the analysis context.
9. **Operation order in posting.** Posting follows the order of the enabled operations. With split-by-tool, **consecutive** operations that use the same tool go into one file. The files are numbered `01`, `02`, … in order.
10. **An operation with any error diagnostic produces no toolpath** (spec §6 "errors block that operation"). Spec §4's "the other faces are still machined" is satisfied only in the diagnostics: the working references are resolved, and the error names the broken one. Nothing is posted for that operation until it is fixed.
11. **What blocks export.**
    - Blocking: operation errors, post-processor errors (interpreter errors in posted G-code), and having nothing generated.
    - Warnings that need confirmation: operation warnings, and **all** Milestone 2 analysis diagnostics of generated programs, including `below-stock-bottom`, which a through-cut profile triggers on purpose.
12. **Fanuc numbers keep a trailing decimal point** (`X40.`). Without it, Fanuc reads the value in least increments. The other dialects strip it, as spec §7 says.
13. **A geometry list in the inspector.** The Geometry tab lists the `describeGeometry` catalog (contours, faces, holes) as tickable entries, next to viewport picking. This is spec §8a's non-viewport picking, and the e2e tests use it.

## File structure

**Core, new files**
```
packages/core/src/
├─ tools/types.ts             Tool, ToolPreset, ToolType, MATERIALS
├─ tools/starterLibrary.ts     starterLibrary(): Tool[]
├─ tools/library.ts            Spon library file (export/import) + Fusion importer
├─ post/types.ts               DialectId, PostSettings, defaultPostSettings()
├─ post/format.ts              number/word formatting, sanitizeName
├─ post/dialects.ts            DIALECTS: Record<DialectId, Dialect>
├─ post/engine.ts              postProcess(job, toolpaths, opts) → PostFile[]
├─ post/check.ts               postedErrors(text) (round-trip parse check)
├─ cam/types.ts                operations, refs, heights, Toolpath, Move, CamDiagnostic
├─ cam/defaults.ts             newOperation(), defaultHeights()
├─ cam/context.ts              CamGeometry, CamContext, camContext(), transform helpers
├─ cam/heights.ts              resolveHeights()
├─ cam/features/chain.ts       chainPaths(), nestLoops()
├─ cam/features/dxf.ts         dxfPathsProgram(), nearestDxfPath()
├─ cam/features/mesh.ts        faceLoops(), fitCircle(), holeDepth(), resolveFaceRef()
├─ cam/features/resolve.ts     resolveGeometry(op, ctx) → ResolvedGeometry
├─ cam/features/describe.ts    describeGeometry(job, geometry)
├─ cam/ops/writer.ts           MoveWriter, lap emission with tabs, helix, ramp laps
├─ cam/ops/leads.ts            leadIn(), leadOut()
├─ cam/ops/tabs.ts             tabIntervals()
├─ cam/ops/profile.ts          profileToolpath()
├─ cam/ops/pocket.ts           pocketToolpath()
├─ cam/ops/drill.ts            drillToolpath()
├─ cam/generate.ts             generateOperation(), generateJob(), GenerationCache
├─ geometry/offset/clipper.ts  Poly, offsetPolys, booleans, regions, sweeps
├─ geometry/offset/pathOps.ts  path length, pointAt, reverse, rotate start, flatten, area
├─ geometry/offset/arcFit.ts   fitArcs()
└─ job/commands.ts             JobCommand, CommandError, applyCommand()
```

**Core, modified files**
- `job/types.ts` (Job v3, ProgramRef.source)
- `job/defaults.ts`
- `job/programs.ts` (`source: 'imported'`)
- `io/migrations.ts`
- `index.ts` (exports)
- `package.json` (`clipper2-ts`)

**Core tests (new)**
`test/job-v3.test.ts`, `test/commands.test.ts`, `test/offset.test.ts`, `test/arcfit.test.ts`, `test/features-dxf.test.ts`, `test/features-mesh.test.ts`, `test/heights.test.ts`, `test/ops-writer.test.ts`, `test/ops-profile.test.ts`, `test/ops-pocket.test.ts`, `test/ops-drill.test.ts`, `test/generate.test.ts`, `test/post.test.ts`, `test/post-roundtrip.test.ts`, `test/tools.test.ts`.

New fixture helpers:
- `test/fixtures/plateBuilder.ts`: a plate with a blind pocket and holes, built as a triangle soup.
- `test/fixtures/camDxf.ts`: the DXF text for the CAM part.

**Web, new files**
- `state/cam.ts`: the pipeline;
- `state/toolLibrary.ts`: IndexedDB;
- `state/export.ts`;
- `panels/OperationsPanel.tsx`, `panels/PostPanel.tsx`;
- `inspector/Inspector.tsx`, `inspector/GeometryTab.tsx`, `inspector/ToolTab.tsx`, `inspector/HeightsTab.tsx`, `inspector/PassesTab.tsx`;
- `tools/ToolLibraryDialog.tsx`;
- `viewport/CamOverlays.tsx`, `viewport/camPick.ts`;
- `components/ui/select.tsx`, `components/ui/tabs.tsx`, `components/ui/checkbox.tsx` (shadcn Radix, added only if they are missing).

**Web, modified files**
`state/store.ts`, `state/programs.ts`, `gcode/playback.ts`, `gcode/timeline.ts` users, `panels/ProgramsPanel.tsx`, `dock/AnalysisView.tsx`, `dock/GcodeList.tsx`, `layout/LeftPanel.tsx`, `layout/TopBar.tsx`, `App.tsx`, `viewport/Viewport.tsx`, `viewport/ModelObject.tsx`, `workers/import.worker.ts`, `workers/importClient.ts`, `hooks/useKeyboardShortcuts.ts`, `state/documents.ts`.

**Fixtures**
- `packages/core/test/fixtures/cam-part.dxf`
- `packages/core/test/fixtures/plate-pocket.stl`

Both are written by `make-fixtures.mjs`.

---
### Task 1: Job schema v3 and the CAM, tool and post types

**Files:**
- Create: `packages/core/src/cam/types.ts`, `packages/core/src/tools/types.ts`, `packages/core/src/post/types.ts`
- Modify: `packages/core/src/job/types.ts`, `packages/core/src/job/defaults.ts`, `packages/core/src/job/programs.ts`, `packages/core/src/io/migrations.ts`, `packages/core/src/index.ts`
- Modify tests: `packages/core/test/job-programs.test.ts` (schemaVersion 2 → 3, in two places), `packages/core/test/job-update.test.ts` (schemaVersion 2 → 3), `packages/core/test/spon.test.ts` (`read.job.schemaVersion` 2 → 3; the "newer schema" test uses 4 instead of 3)
- Test: `packages/core/test/job-v3.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - all types in `cam/types.ts`, `tools/types.ts` and `post/types.ts`, exactly as below;
  - `defaultPostSettings(dialect)`;
  - `Job.schemaVersion: 3` with `tools`, `operations`, `post` and `tolerance`;
  - `ProgramRef.source` and `ProgramRef.operationIds`;
  - `DEFAULT_TOLERANCE = 0.002`.

- [ ] **Step 1: Write the types**

`packages/core/src/tools/types.ts`:
```ts
export type ToolType = 'flat' | 'ball' | 'bull' | 'vbit' | 'drill' | 'chamfer';
export const TOOL_TYPES: readonly ToolType[] = ['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer'];

export const MATERIALS = ['Softwood', 'Hardwood / MDF', 'Plastics', 'Aluminium'] as const;

export interface ToolPreset {
  /** Material name, e.g. "Hardwood / MDF". */
  name: string;
  rpm: number;
  /** mm/min */
  feed: number;
  /** mm/min */
  plungeFeed: number;
  /** mm */
  stepdown: number;
  /** % of the tool diameter, (0, 100] */
  stepoverPct: number;
  coolant: 'off' | 'flood' | 'mist';
}

/** All lengths in mm, angles in degrees. */
export interface Tool {
  id: string;
  name: string;
  type: ToolType;
  /** T number */
  number: number;
  diameter: number;
  cornerRadius: number;
  /** Included tip angle: V-bits, drills and chamfer mills; 0 otherwise. */
  tipAngleDeg: number;
  fluteLength: number;
  stickout: number;
  flutes: number;
  presets: ToolPreset[];
  vendor?: string;
  productId?: string;
}
```

`packages/core/src/post/types.ts`:
```ts
export type DialectId = 'grbl' | 'linuxcnc' | 'fanuc';
export const DIALECT_IDS: readonly DialectId[] = ['grbl', 'linuxcnc', 'fanuc'];

export interface PostSettings {
  dialect: DialectId;
  /** One file per run of consecutive operations with the same tool. */
  splitByTool: boolean;
  /** Decimals for mm output; inch output uses decimals + 1. */
  decimals: number;
  arcFormat: 'ij' | 'r';
  lineNumbers: boolean;
  lineNumberStep: number;
  /** Emit M7/M8/M9 at all. */
  coolant: boolean;
  /** Seconds to wait after the spindle starts (0 = none). */
  spindleDwell: number;
  /** Extra line after the modal setup line, e.g. "G40 G49 G80"; empty = none. */
  safeStart: string;
  /** Fanuc O-number. */
  programNumber: number;
  extension: 'nc' | 'gcode' | 'tap';
}

export function defaultPostSettings(dialect: DialectId): PostSettings {
  const base: PostSettings = {
    dialect, splitByTool: false, decimals: 3, arcFormat: 'ij', lineNumbers: false, lineNumberStep: 10,
    coolant: true, spindleDwell: 0, safeStart: '', programNumber: 1000, extension: 'nc',
  };
  if (dialect === 'grbl') return { ...base, splitByTool: true };
  if (dialect === 'fanuc') return { ...base, safeStart: 'G40 G49 G80' };
  return base;
}
```

`packages/core/src/cam/types.ts`:
```ts
import type { Vec2 } from '../geometry/path2d';
import type { Vec3 } from '../geometry/vec3';

export type Coolant = 'off' | 'flood' | 'mist';
export type OperationType = 'profile' | 'pocket' | 'drill';

/** A planar face of the mesh, in model-local (raw, pre-orientation) coordinates. */
export interface MeshFaceRef { kind: 'meshFace'; blobId: string; seed: number; normal: Vec3; point: Vec3 }
/** One path of the DXF drawing. */
export interface DxfPathRef { kind: 'dxfPath'; blobId: string; layer: number; path: number }
/** One boundary loop of a face (loop 0 = the outer loop). */
export interface MeshLoopRef { kind: 'meshLoop'; face: MeshFaceRef; loop: number }
/** An inner loop of a face that fits a circle. */
export interface MeshHoleRef { kind: 'meshHole'; face: MeshFaceRef; loop: number }
export type GeometryRef = DxfPathRef | MeshFaceRef | MeshLoopRef | MeshHoleRef;

export type HeightFrom =
  | 'stockTop' | 'stockBottom' | 'modelTop' | 'modelBottom' | 'contour' | 'face' | 'origin' | 'holeBottom'
  | 'retract' | 'feed' | 'top';
export interface HeightSpec { from: HeightFrom; offset: number; face?: MeshFaceRef }
export interface Heights { clearance: HeightSpec; retract: HeightSpec; feed: HeightSpec; top: HeightSpec; bottom: HeightSpec }
export type HeightName = keyof Heights;
export const HEIGHT_NAMES: readonly HeightName[] = ['clearance', 'retract', 'feed', 'top', 'bottom'];
/** Allowed references per height (spec §5). */
export const HEIGHT_FROM: Readonly<Record<HeightName, readonly HeightFrom[]>> = {
  clearance: ['stockTop', 'modelTop', 'origin', 'retract'],
  retract: ['stockTop', 'modelTop', 'origin', 'feed'],
  feed: ['stockTop', 'modelTop', 'origin', 'top'],
  top: ['stockTop', 'modelTop', 'contour', 'face', 'origin'],
  bottom: ['stockTop', 'stockBottom', 'modelTop', 'modelBottom', 'contour', 'face', 'origin', 'holeBottom'],
};

export interface Feeds { presetName: string | null; rpm: number; feed: number; plungeFeed: number; coolant: Coolant }
export interface EntrySettings { mode: 'auto' | 'helix' | 'ramp' | 'plunge'; helixDiameterPct: number; rampAngleDeg: number }
/** Position along contour `refIndex`'s tool-centre lap, as a fraction t ∈ [0, 1) of its length. */
export interface LapPosition { refIndex: number; t: number }
export interface LeadSettings { mode: 'none' | 'arc' | 'line'; length: number; startPoint: 'auto' | LapPosition }
export interface TabSettings {
  enabled: boolean;
  shape: 'rect' | 'triangle';
  width: number;
  height: number;
  placement: 'count' | 'spacing';
  count: number;
  spacing: number;
  /** null = automatic; set once the user drags a tab. */
  positions: LapPosition[] | null;
}

export interface OperationBase {
  id: string;
  name: string;
  enabled: boolean;
  toolId: string | null;
  feeds: Feeds;
  heights: Heights;
  geometry: GeometryRef[];
}
export interface ProfileOp extends OperationBase {
  type: 'profile';
  side: 'outside' | 'inside' | 'on';
  direction: 'climb' | 'conventional';
  stepdown: number;
  stockRadial: number;
  stockAxial: number;
  finishPass: boolean;
  entry: EntrySettings;
  leads: LeadSettings;
  tabs: TabSettings;
}
export interface PocketOp extends OperationBase {
  type: 'pocket';
  direction: 'climb' | 'conventional';
  stepdown: number;
  stepoverPct: number;
  stockRadial: number;
  stockAxial: number;
  finishWalls: boolean;
  finishFloor: boolean;
  entry: EntrySettings;
}
export type DrillCycle = 'drill' | 'dwell' | 'peck' | 'chipbreak';
export interface DrillOp extends OperationBase {
  type: 'drill';
  cycle: DrillCycle;
  peck: number;
  dwellSeconds: number;
  diameterFilter: { min: number; max: number } | null;
}
export type Operation = ProfileOp | PocketOp | DrillOp;

type AllFields = Omit<ProfileOp, 'id' | 'type'> & Omit<PocketOp, 'id' | 'type'> & Omit<DrillOp, 'id' | 'type'>;
/** Any operation field; object-valued fields are merged one level deep. */
export type OperationPatch = {
  [K in keyof AllFields]?: K extends 'heights' ? Partial<Heights> : K extends 'feeds' | 'entry' | 'leads' | 'tabs' ? Partial<AllFields[K]> : AllFields[K];
};

// ── toolpaths ────────────────────────────────────────────────────────────
export type Move =
  | { kind: 'rapid'; to: Vec3 }
  | { kind: 'line'; to: Vec3; feed: number }
  /** XY-plane arc from the current position; `to.z` may differ (helix). A full circle has `to` equal to the start. */
  | { kind: 'arc'; to: Vec3; center: Vec2; ccw: boolean; feed: number }
  | {
      kind: 'cycle'; cycle: DrillCycle; at: Vec2; top: number; bottom: number;
      /** R plane (feed height). */ r: number;
      /** Initial level returned to after the hole (G98). */ retract: number;
      peck: number; dwell: number; feed: number;
    };

export interface Toolpath {
  operationId: string;
  operationName: string;
  toolId: string;
  rpm: number;
  coolant: Coolant;
  clearance: number;
  moves: Move[];
}

export type CamSeverity = 'error' | 'warning';
export type CamCode =
  | 'no-tool' | 'no-geometry' | 'ref-missing' | 'ref-changed' | 'face-not-horizontal' | 'open-contour' | 'no-stock'
  | 'heights-invalid' | 'offset-collapsed' | 'tool-too-large' | 'tool-undersize' | 'entry-plunge' | 'unmachined-area'
  | 'tab-skipped' | 'stepdown-exceeds-flute' | 'feed-exceeds-machine' | 'internal';
export interface CamDiagnostic {
  operationId: string;
  severity: CamSeverity;
  code: CamCode;
  message: string;
  /** Index into the operation's geometry list, when the problem belongs to one reference. */
  ref?: number;
}
```

In `packages/core/src/job/types.ts`:
- add these imports:
  ```ts
  import type { Operation } from '../cam/types';
  import type { PostSettings } from '../post/types';
  import type { Tool } from '../tools/types';
  ```
- then change `ProgramRef` and `Job`:
```ts
export interface ProgramRef {
  id: string;
  /** Original file name (or generated file name). */
  name: string;
  /** Key of the program bytes (programs/<blobId>.nc in .spon, IndexedDB blobs). */
  blobId: string;
  /** Included in the combined back-to-back timeline. */
  inTimeline: boolean;
  /** Stored programs are always 'imported'; generated programs exist only in the web store. */
  source: 'imported' | 'generated';
  /** Generated programs: the operations that produced them. */
  operationIds?: string[];
}

/** All lengths in mm, angles in degrees. */
export interface Job {
  schemaVersion: 3;
  id: string;
  name: string;
  displayUnits: LengthUnit;
  model: ModelRef | null;
  stock: Stock;
  wcs: Wcs;
  machine: MachineProfile;
  /** List order is playback order. */
  programs: ProgramRef[];
  /** Copies of the library tools this job uses. */
  tools: Tool[];
  /** List order is machining order. */
  operations: Operation[];
  post: PostSettings;
  /** Chord / arc-fit tolerance in mm. */
  tolerance: number;
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/job-v3.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addProgram, createJob, DEFAULT_TOLERANCE, defaultPostSettings, migrateJob, readSpon, writeSpon } from '../src';
import v1Job from './fixtures/job-v1.json';

describe('job schema v3', () => {
  it('creates v3 jobs with empty CAM data and GRBL post defaults', () => {
    const job = createJob();
    expect(job.schemaVersion).toBe(3);
    expect(job.tools).toEqual([]);
    expect(job.operations).toEqual([]);
    expect(job.post).toEqual(defaultPostSettings('grbl'));
    expect(job.tolerance).toBe(DEFAULT_TOLERANCE);
    expect(DEFAULT_TOLERANCE).toBe(0.002);
  });

  it('marks added programs as imported', () => {
    const job = addProgram(createJob(), { name: 'a.nc', blobId: 'p1' });
    expect(job.programs[0].source).toBe('imported');
  });

  it('migrates v2 jobs: programs become imported, CAM fields get defaults', () => {
    const { tools: _t, operations: _o, post: _p, tolerance: _tol, ...rest } = createJob('Old');
    const v2 = { ...rest, schemaVersion: 2, programs: [{ id: 'x', name: 'a.nc', blobId: 'p1', inTimeline: true }] };
    const job = migrateJob(v2);
    expect(job.schemaVersion).toBe(3);
    expect(job.programs[0]).toEqual({ id: 'x', name: 'a.nc', blobId: 'p1', inTimeline: true, source: 'imported' });
    expect(job.tools).toEqual([]);
    expect(job.operations).toEqual([]);
    expect(job.post).toEqual(defaultPostSettings('grbl'));
    expect(job.tolerance).toBe(0.002);
  });

  it('migrates v1 jobs all the way to v3', () => {
    const job = migrateJob(v1Job);
    expect(job.schemaVersion).toBe(3);
    expect(job.operations).toEqual([]);
  });

  it('round-trips CAM fields through .spon', () => {
    const job = { ...createJob(), tolerance: 0.01, post: defaultPostSettings('fanuc') };
    expect(readSpon(writeSpon(job, {})).job).toEqual(job);
  });

  it('gives each dialect its defaults', () => {
    expect(defaultPostSettings('grbl').splitByTool).toBe(true);
    expect(defaultPostSettings('linuxcnc').splitByTool).toBe(false);
    expect(defaultPostSettings('fanuc')).toMatchObject({ splitByTool: false, safeStart: 'G40 G49 G80', programNumber: 1000 });
  });

  it('rejects v3 data without the CAM fields', () => {
    const { operations: _o, ...broken } = createJob();
    expect(() => migrateJob(broken)).toThrow(/not a valid job/);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/job-v3.test.ts`
Expected: FAIL. `DEFAULT_TOLERANCE` and `defaultPostSettings` are not exported, and `schemaVersion` is 2.

- [ ] **Step 4: Implement**

`packages/core/src/job/defaults.ts`:
- add the imports `import { defaultPostSettings } from '../post/types';`;
- export `export const DEFAULT_TOLERANCE = 0.002;`;
- in `createJob` set `schemaVersion: 3` and append:
```ts
    tools: [],
    operations: [],
    post: defaultPostSettings('grbl'),
    tolerance: DEFAULT_TOLERANCE,
```

`packages/core/src/job/programs.ts`, in `addProgram`: add `source: 'imported'` to the new `ProgramRef` literal.

`packages/core/src/io/migrations.ts`:
```ts
import { DEFAULT_MACHINE_PRESET, machinePreset } from '../job/machine';
import type { Job } from '../job/types';
import { defaultPostSettings } from '../post/types';
import { SponFileError } from './errors';

export const CURRENT_SCHEMA_VERSION = 3;

export type Migration = (job: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a schemaVersion-n job to n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v1 → v2 (Milestone 2): machine profile and program list
  1: (job) => ({ ...job, machine: machinePreset(DEFAULT_MACHINE_PRESET), programs: [] }),
  // v2 → v3 (Milestone 3): tools, operations, post settings, tolerance; stored programs are imported
  2: (job) => ({
    ...job,
    programs: (Array.isArray(job.programs) ? job.programs : []).map((p) => ({ ...(p as object), source: 'imported' })),
    tools: [],
    operations: [],
    post: defaultPostSettings('grbl'),
    tolerance: 0.002,
  }),
};
```
Keep `migrateJob` unchanged. In `assertJobShape`, extend `ok` with:
```ts
    Array.isArray(job.tools) && Array.isArray(job.operations) &&
    typeof job.post === 'object' && job.post !== null && typeof job.tolerance === 'number' &&
```

`packages/core/src/index.ts`: append
```ts
export * from './tools/types';
export * from './post/types';
export * from './cam/types';
```

Update the existing tests listed under **Files** (schemaVersion 2 → 3; in the "refuses jobs from a newer schema" test, use `schemaVersion: 4`).

- [ ] **Step 5: Run the core suite and the typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm typecheck`
Expected: all tests pass, and core and web typecheck clean. If the web typecheck fails because of an object literal typed `ProgramRef` or `Job` that lacks the new fields, add `source: 'imported'`, or the four CAM fields via `createJob()`, at that literal. Do not loosen the types.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): job schema v3 with tools, operations, post settings and tolerance"
```

---

### Task 2: Operation defaults and the job command layer

**Files:**
- Create: `packages/core/src/cam/defaults.ts`, `packages/core/src/job/commands.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/commands.test.ts`

**Interfaces:**
- Consumes (Task 1): types; existing `renameJob`, `setDisplayUnits`, `setImportUnits`, `rotateQuarter`, `layFlat`, `setZSpin`, `resetOrientation`, `setStock`, `setWcs` (`job/update.ts`); `setMachineProfile`, `applyMachinePreset`, `moveProgram`, `setProgramInTimeline`, `removeProgram` (`job/programs.ts`).
- Produces:
  - `newOperation(type: OperationType, opts: { id: string; name: string; tool: Tool | null; modelKind: ModelKind | null }): Operation`
  - `defaultHeights(type: OperationType, modelKind: ModelKind | null): Heights`
  - `OPERATION_LABELS: Record<OperationType, string>`
  - `type JobCommand` (spec §8a); `class CommandError extends Error`; `applyCommand(job: Job, command: JobCommand): Job`

- [ ] **Step 1: Write the failing test**

`packages/core/test/commands.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, createJob, defaultHeights, type Job, type JobCommand, newOperation, type Tool } from '../src';

const tool: Tool = {
  id: 't6', name: '6 mm flat', type: 'flat', number: 2, diameter: 6, cornerRadius: 0, tipAngleDeg: 0,
  fluteLength: 20, stickout: 30, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, stepdown: 3, stepoverPct: 45, coolant: 'off' }],
};
const run = (job: Job, ...commands: JobCommand[]) => commands.reduce(applyCommand, job);
const withTool = () => applyCommand(createJob(), { type: 'addTool', tool });

describe('newOperation', () => {
  it('takes feeds, stepdown and stepover from the tool preset', () => {
    const op = newOperation('pocket', { id: 'o1', name: 'Pocket 1', tool, modelKind: 'mesh' });
    expect(op).toMatchObject({
      id: 'o1', type: 'pocket', enabled: true, toolId: 't6', stepdown: 3, stepoverPct: 45,
      feeds: { presetName: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, coolant: 'off' },
      entry: { mode: 'auto', helixDiameterPct: 90, rampAngleDeg: 3 },
    });
    expect(op.heights.bottom).toEqual({ from: 'contour', offset: 0 });
  });

  it('uses spec defaults for heights, leads and tabs', () => {
    expect(defaultHeights('profile', 'mesh')).toEqual({
      clearance: { from: 'retract', offset: 10 }, retract: { from: 'stockTop', offset: 5 }, feed: { from: 'top', offset: 2 },
      top: { from: 'stockTop', offset: 0 }, bottom: { from: 'stockBottom', offset: -0.2 },
    });
    expect(defaultHeights('pocket', 'drawing').bottom).toEqual({ from: 'stockTop', offset: -3 });
    expect(defaultHeights('drill', 'mesh').bottom).toEqual({ from: 'holeBottom', offset: 0 });
    const p = newOperation('profile', { id: 'p', name: 'P', tool, modelKind: 'mesh' });
    expect(p).toMatchObject({ side: 'outside', direction: 'climb', leads: { mode: 'arc', length: 3, startPoint: 'auto' } });
    expect(p.type === 'profile' && p.tabs).toEqual({ enabled: false, shape: 'rect', width: 6, height: 2, placement: 'count', count: 4, spacing: 50, positions: null });
  });

  it('falls back to neutral feeds without a tool', () => {
    const op = newOperation('drill', { id: 'd', name: 'D', tool: null, modelKind: null });
    expect(op).toMatchObject({ toolId: null, feeds: { presetName: null, rpm: 10000, feed: 1000, plungeFeed: 300 }, cycle: 'drill', peck: 1, dwellSeconds: 0.5 });
  });
});

describe('applyCommand', () => {
  it('adds, names, updates, reorders, duplicates, toggles and removes operations', () => {
    let job = run(withTool(),
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'a' },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'b' },
    );
    expect(job.operations.map((o) => [o.id, o.name])).toEqual([['a', 'Profile 1'], ['b', 'Profile 2']]);
    job = applyCommand(job, { type: 'updateOperation', id: 'a', patch: { side: 'inside', heights: { top: { from: 'origin', offset: 1 } }, tabs: { enabled: true } } });
    const a = job.operations[0];
    expect(a.type === 'profile' && [a.side, a.tabs.enabled, a.tabs.width]).toEqual(['inside', true, 6]);
    expect(a.heights.top).toEqual({ from: 'origin', offset: 1 });
    expect(a.heights.bottom).toEqual({ from: 'stockBottom', offset: -0.2 });
    job = applyCommand(job, { type: 'moveOperation', id: 'b', delta: -1 });
    expect(job.operations.map((o) => o.id)).toEqual(['b', 'a']);
    expect(applyCommand(job, { type: 'moveOperation', id: 'b', delta: -1 })).toBe(job);
    job = applyCommand(job, { type: 'duplicateOperation', id: 'b', newId: 'c' });
    expect(job.operations.map((o) => [o.id, o.name])).toEqual([['b', 'Profile 2'], ['c', 'Profile 2 copy'], ['a', 'Profile 1']]);
    job = applyCommand(job, { type: 'setOperationEnabled', id: 'c', enabled: false });
    expect(job.operations[1].enabled).toBe(false);
    job = applyCommand(job, { type: 'removeOperation', id: 'c' });
    expect(job.operations.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('manages job tools and post settings', () => {
    let job = withTool();
    expect(job.tools).toEqual([tool]);
    job = applyCommand(job, { type: 'updateTool', id: 't6', patch: { number: 7 } });
    expect(job.tools[0].number).toBe(7);
    job = applyCommand(job, { type: 'setPost', patch: { dialect: 'fanuc', lineNumbers: true } });
    expect(job.post).toMatchObject({ dialect: 'fanuc', lineNumbers: true, decimals: 3 });
    job = applyCommand(job, { type: 'setTolerance', tolerance: 0.01 });
    expect(job.tolerance).toBe(0.01);
    job = applyCommand(job, { type: 'removeTool', id: 't6' });
    expect(job.tools).toEqual([]);
  });

  it('wraps the Milestone 1 and 2 edits', () => {
    const job = run(createJob(), { type: 'renameJob', name: 'Bracket' }, { type: 'setWcs', patch: { workOffset: 'G55' } },
      { type: 'setMachineProfile', patch: { maxFeed: 5000 } }, { type: 'setDisplayUnits', unit: 'in' });
    expect([job.name, job.wcs.workOffset, job.machine.maxFeed, job.displayUnits]).toEqual(['Bracket', 'G55', 5000, 'in']);
  });

  it('rejects invalid commands with CommandError', () => {
    const job = run(withTool(), { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'd' });
    const bad: JobCommand[] = [
      { type: 'updateOperation', id: 'nope', patch: {} },
      { type: 'updateOperation', id: 'd', patch: { side: 'inside' } },
      { type: 'updateOperation', id: 'd', patch: { peck: -1 } },
      { type: 'addOperation', opType: 'pocket', toolId: 'missing' },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'd' },
      { type: 'removeTool', id: 't6' },
      { type: 'addTool', tool },
      { type: 'setTolerance', tolerance: 0 },
      { type: 'updateOperation', id: 'd', patch: { toolId: 'missing' } },
    ];
    for (const c of bad) expect(() => applyCommand(job, c), JSON.stringify(c)).toThrow(CommandError);
  });

  it('serialises every command through JSON unchanged', () => {
    const commands: JobCommand[] = [
      { type: 'addTool', tool },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'p', name: 'Main pocket' },
      { type: 'updateOperation', id: 'p', patch: { stepoverPct: 30, geometry: [{ kind: 'dxfPath', blobId: 'b', layer: 0, path: 2 }] } },
      { type: 'setPost', patch: { dialect: 'linuxcnc' } },
    ];
    const direct = run(createJob(), ...commands);
    const viaJson = run(createJob(), ...(JSON.parse(JSON.stringify(commands)) as JobCommand[]));
    expect({ ...viaJson, id: direct.id }).toEqual(direct);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/commands.test.ts`
Expected: FAIL. The module does not export `applyCommand`.

- [ ] **Step 3: Implement `cam/defaults.ts`**

```ts
import type { ModelKind } from '../import/importFile';
import type { Tool } from '../tools/types';
import type { Feeds, Heights, Operation, OperationType } from './types';

export const OPERATION_LABELS: Readonly<Record<OperationType, string>> = { profile: 'Profile', pocket: 'Pocket', drill: 'Drill' };

export function defaultHeights(type: OperationType, modelKind: ModelKind | null): Heights {
  const bottom =
    type === 'profile' ? { from: 'stockBottom' as const, offset: -0.2 }
    : type === 'drill' ? { from: 'holeBottom' as const, offset: 0 }
    : modelKind === 'drawing' ? { from: 'stockTop' as const, offset: -3 } // a drawing's contours lie at the stock top
    : { from: 'contour' as const, offset: 0 };
  return {
    clearance: { from: 'retract', offset: 10 },
    retract: { from: 'stockTop', offset: 5 },
    feed: { from: 'top', offset: 2 },
    top: { from: 'stockTop', offset: 0 },
    bottom,
  };
}

function feedsFor(tool: Tool | null): Feeds {
  const p = tool?.presets[0];
  return p
    ? { presetName: p.name, rpm: p.rpm, feed: p.feed, plungeFeed: p.plungeFeed, coolant: p.coolant }
    : { presetName: null, rpm: 10000, feed: 1000, plungeFeed: 300, coolant: 'off' };
}

export function newOperation(type: OperationType, opts: { id: string; name: string; tool: Tool | null; modelKind: ModelKind | null }): Operation {
  const { id, name, tool, modelKind } = opts;
  const d = tool?.diameter ?? 6;
  const preset = tool?.presets[0];
  const base = { id, name, enabled: true, toolId: tool?.id ?? null, feeds: feedsFor(tool), heights: defaultHeights(type, modelKind), geometry: [] };
  const stepdown = preset?.stepdown ?? Math.max(0.5, d / 2);
  const entry = { mode: 'auto' as const, helixDiameterPct: 90, rampAngleDeg: 3 };
  if (type === 'profile') {
    return {
      ...base, type, side: 'outside', direction: 'climb', stepdown, stockRadial: 0, stockAxial: 0, finishPass: false, entry,
      leads: { mode: 'arc', length: d / 2, startPoint: 'auto' },
      tabs: { enabled: false, shape: 'rect', width: Math.max(4, d), height: 2, placement: 'count', count: 4, spacing: 50, positions: null },
    };
  }
  if (type === 'pocket') {
    return {
      ...base, type, direction: 'climb', stepdown, stepoverPct: preset?.stepoverPct ?? 40, stockRadial: 0, stockAxial: 0,
      finishWalls: false, finishFloor: false, entry,
    };
  }
  return { ...base, type, cycle: 'drill', peck: tool ? Math.max(0.5, Math.round(tool.diameter * 10) / 20) : 1, dwellSeconds: 0.5, diameterFilter: null };
}
```
Check: for the 6 mm tool the peck is `round(60)/20 = 3`. That's half the diameter, rounded to 0.05 mm. The test without a tool expects `peck: 1`.

- [ ] **Step 4: Implement `job/commands.ts`**

```ts
import { newOperation, OPERATION_LABELS } from '../cam/defaults';
import type { Operation, OperationPatch, OperationType } from '../cam/types';
import type { Vec3 } from '../geometry/vec3';
import type { PostSettings } from '../post/types';
import type { Tool } from '../tools/types';
import type { LengthUnit } from '../units/units';
import type { MachinePresetName } from './machine';
import { applyMachinePreset, type MachinePatch, moveProgram, removeProgram, setMachineProfile, setProgramInTimeline } from './programs';
import type { Job, Stock, Wcs } from './types';
import { layFlat, renameJob, resetOrientation, rotateQuarter, setDisplayUnits, setImportUnits, setStock, setWcs, setZSpin } from './update';

export type JobCommand =
  | { type: 'renameJob'; name: string }
  | { type: 'setDisplayUnits'; unit: LengthUnit }
  | { type: 'setImportUnits'; unit: LengthUnit }
  | { type: 'rotateQuarter'; axis: 'x' | 'y'; direction: 1 | -1 }
  | { type: 'layFlat'; rawNormal: Vec3 }
  | { type: 'setZSpin'; degrees: number }
  | { type: 'resetOrientation' }
  | { type: 'setStock'; stock: Stock }
  | { type: 'setWcs'; patch: Partial<Wcs> }
  | { type: 'setMachineProfile'; patch: MachinePatch }
  | { type: 'applyMachinePreset'; name: MachinePresetName }
  | { type: 'moveProgram'; id: string; delta: -1 | 1 }
  | { type: 'setProgramInTimeline'; id: string; inTimeline: boolean }
  | { type: 'removeProgram'; id: string }
  | { type: 'addOperation'; opType: OperationType; toolId: string | null; id?: string; name?: string }
  | { type: 'updateOperation'; id: string; patch: OperationPatch }
  | { type: 'removeOperation'; id: string }
  | { type: 'duplicateOperation'; id: string; newId?: string }
  | { type: 'moveOperation'; id: string; delta: -1 | 1 }
  | { type: 'setOperationEnabled'; id: string; enabled: boolean }
  | { type: 'addTool'; tool: Tool }
  | { type: 'updateTool'; id: string; patch: Partial<Omit<Tool, 'id'>> }
  | { type: 'removeTool'; id: string }
  | { type: 'setPost'; patch: Partial<PostSettings> }
  | { type: 'setTolerance'; tolerance: number };

export class CommandError extends Error {
  override name = 'CommandError';
}

const COMMON_KEYS = ['name', 'enabled', 'toolId', 'feeds', 'heights', 'geometry'];
const OP_KEYS: Readonly<Record<OperationType, readonly string[]>> = {
  profile: [...COMMON_KEYS, 'side', 'direction', 'stepdown', 'stockRadial', 'stockAxial', 'finishPass', 'entry', 'leads', 'tabs'],
  pocket: [...COMMON_KEYS, 'direction', 'stepdown', 'stepoverPct', 'stockRadial', 'stockAxial', 'finishWalls', 'finishFloor', 'entry'],
  drill: [...COMMON_KEYS, 'cycle', 'peck', 'dwellSeconds', 'diameterFilter'],
};
const NESTED = new Set(['heights', 'feeds', 'entry', 'leads', 'tabs']);
const POSITIVE = ['stepdown', 'peck'];
const NON_NEGATIVE = ['stockRadial', 'stockAxial', 'dwellSeconds'];

function findOp(job: Job, id: string): Operation {
  const op = job.operations.find((o) => o.id === id);
  if (!op) throw new CommandError(`No operation with id ${id}`);
  return op;
}

function checkTool(job: Job, toolId: string | null): Tool | null {
  if (toolId === null) return null;
  const tool = job.tools.find((t) => t.id === toolId);
  if (!tool) throw new CommandError(`No tool with id ${toolId} in this job`);
  return tool;
}

function patchOperation(job: Job, op: Operation, patch: OperationPatch): Operation {
  const allowed = OP_KEYS[op.type];
  const next: Record<string, unknown> = { ...op };
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) throw new CommandError(`"${key}" does not apply to a ${op.type} operation`);
    if (POSITIVE.includes(key) && !((value as number) > 0)) throw new CommandError(`${key} must be greater than 0`);
    if (NON_NEGATIVE.includes(key) && !((value as number) >= 0)) throw new CommandError(`${key} must not be negative`);
    if (key === 'stepoverPct' && !((value as number) > 0 && (value as number) <= 100)) throw new CommandError('stepoverPct must be in (0, 100]');
    if (key === 'toolId') checkTool(job, value as string | null);
    next[key] = NESTED.has(key) ? { ...(op as unknown as Record<string, object>)[key], ...(value as object) } : value;
  }
  return next as unknown as Operation;
}

const replaceOp = (job: Job, op: Operation): Job => ({ ...job, operations: job.operations.map((o) => (o.id === op.id ? op : o)) });

export function applyCommand(job: Job, c: JobCommand): Job {
  switch (c.type) {
    case 'renameJob': return renameJob(job, c.name);
    case 'setDisplayUnits': return setDisplayUnits(job, c.unit);
    case 'setImportUnits': return setImportUnits(job, c.unit);
    case 'rotateQuarter': return rotateQuarter(job, c.axis, c.direction);
    case 'layFlat': return layFlat(job, c.rawNormal);
    case 'setZSpin': return setZSpin(job, c.degrees);
    case 'resetOrientation': return resetOrientation(job);
    case 'setStock': return setStock(job, c.stock);
    case 'setWcs': return setWcs(job, c.patch);
    case 'setMachineProfile': return setMachineProfile(job, c.patch);
    case 'applyMachinePreset': return applyMachinePreset(job, c.name);
    case 'moveProgram': return moveProgram(job, c.id, c.delta);
    case 'setProgramInTimeline': return setProgramInTimeline(job, c.id, c.inTimeline);
    case 'removeProgram': return removeProgram(job, c.id);
    case 'addOperation': {
      const tool = checkTool(job, c.toolId);
      const id = c.id ?? crypto.randomUUID();
      if (job.operations.some((o) => o.id === id)) throw new CommandError(`An operation with id ${id} already exists`);
      const n = job.operations.filter((o) => o.type === c.opType).length + 1;
      const op = newOperation(c.opType, { id, name: c.name ?? `${OPERATION_LABELS[c.opType]} ${n}`, tool, modelKind: job.model?.kind ?? null });
      return { ...job, operations: [...job.operations, op] };
    }
    case 'updateOperation': return replaceOp(job, patchOperation(job, findOp(job, c.id), c.patch));
    case 'removeOperation': findOp(job, c.id); return { ...job, operations: job.operations.filter((o) => o.id !== c.id) };
    case 'duplicateOperation': {
      const op = findOp(job, c.id);
      const id = c.newId ?? crypto.randomUUID();
      if (job.operations.some((o) => o.id === id)) throw new CommandError(`An operation with id ${id} already exists`);
      const copy = { ...structuredClone(op), id, name: `${op.name} copy` };
      const i = job.operations.indexOf(op);
      return { ...job, operations: [...job.operations.slice(0, i + 1), copy, ...job.operations.slice(i + 1)] };
    }
    case 'moveOperation': {
      const i = job.operations.indexOf(findOp(job, c.id));
      const j = i + c.delta;
      if (j < 0 || j >= job.operations.length) return job;
      const operations = [...job.operations];
      [operations[i], operations[j]] = [operations[j], operations[i]];
      return { ...job, operations };
    }
    case 'setOperationEnabled': {
      const op = findOp(job, c.id);
      return op.enabled === c.enabled ? job : replaceOp(job, { ...op, enabled: c.enabled });
    }
    case 'addTool':
      if (job.tools.some((t) => t.id === c.tool.id)) throw new CommandError(`A tool with id ${c.tool.id} is already in the job`);
      return { ...job, tools: [...job.tools, structuredClone(c.tool)] };
    case 'updateTool': {
      const tool = checkTool(job, c.id)!;
      return { ...job, tools: job.tools.map((t) => (t === tool ? { ...t, ...c.patch, id: t.id } : t)) };
    }
    case 'removeTool': {
      checkTool(job, c.id);
      const user = job.operations.find((o) => o.toolId === c.id);
      if (user) throw new CommandError(`Tool is used by operation "${user.name}"`);
      return { ...job, tools: job.tools.filter((t) => t.id !== c.id) };
    }
    case 'setPost': return { ...job, post: { ...job.post, ...c.patch } };
    case 'setTolerance':
      if (!(c.tolerance > 0 && c.tolerance <= 1)) throw new CommandError('tolerance must be in (0, 1] mm');
      return { ...job, tolerance: c.tolerance };
  }
}
```

`index.ts`: append `export * from './cam/defaults';` and `export * from './job/commands';`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/commands.test.ts && pnpm typecheck`
Expected: PASS. If `MachinePatch` is not exported from `job/programs.ts`, export it (it is declared there).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): operation defaults and a JSON-serialisable job command layer"
```

---
### Task 3: Offsetting foundation — Clipper wrapper, path operations, arc fitting

**Files:**
- Modify: `packages/core/package.json` (add the dependency `"clipper2-ts": "2.0.1-18"`, pinned exactly)
- Create: `packages/core/src/geometry/offset/pathOps.ts`, `packages/core/src/geometry/offset/clipper.ts`, `packages/core/src/geometry/offset/arcFit.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/offset.test.ts`, `packages/core/test/arcfit.test.ts`

**Interfaces:**
- Consumes: `Path2D`, `Segment`, `ArcSegment`, `Vec2`, `arcPoint`, `segmentStart`, `segmentEnd`, `tessellatePath` (`geometry/path2d.ts`).
- Produces:
  - `pathOps.ts`: `v2`, `dist2`, `segmentLength`, `pathLength`, `segmentPointAt`, `pointAt`, `splitSegment`, `subPath`, `reverseSegment`, `reversePath`, `rotateStart`, `flattenPath`, `polyArea`, `pathArea`, `orientPath`, `pathFromPoints`, `nearestS`, `pathStart`, `pathEnd`, `cornerDistances`, `arcSweepBetween`.
  - `clipper.ts`: `CLIP_SCALE`, `type Poly`, `interface Region`, `offsetPolys`, `sweepPolylines`, `unionPolys`, `differencePolys`, `intersectPolys`, `polysToRegions`, `regionPolys`, `pointInPolys`, `segmentInside`, `polysArea`.
  - `arcFit.ts`: `fitArcs(points: Vec2[], closed: boolean, tol: number): Path2D`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @sponcam/core add clipper2-ts@2.0.1-18 --save-exact`
Expected: `packages/core/package.json` lists `"clipper2-ts": "2.0.1-18"`.

- [ ] **Step 2: Write the failing tests**

`packages/core/test/offset.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  type ArcSegment, nearestS, offsetPolys, pathArea, pathFromPoints, pathLength, pointAt, pointInPolys, type Poly, polysArea,
  polysToRegions, reversePath, rotateStart, segmentInside, subPath, sweepPolylines, unionPolys, v2,
} from '../src';

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)];
const cw = (p: Poly): Poly => [...p].reverse();

describe('clipper wrapper', () => {
  it('offsets a rectangle inward and outward with round corners', () => {
    const inner = offsetPolys([rect(0, 0, 20, 10)], -3, 0.002);
    expect(inner).toHaveLength(1);
    expect(polysArea(inner)).toBeCloseTo(56, 6);
    const outer = offsetPolys([rect(0, 0, 20, 10)], 3, 0.002);
    expect(polysArea(outer)).toBeCloseTo(26 * 16 - 36 + 9 * Math.PI, 1);
    expect(offsetPolys([rect(0, 0, 20, 10)], -6, 0.002)).toEqual([]);
  });

  it('keeps islands as holes and splits narrow necks into separate regions', () => {
    const region = offsetPolys([rect(0, 0, 20, 10), cw(rect(8, 3, 12, 7))], -1, 0.002);
    const regions = polysToRegions(region);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    const dumbbell = unionPolys([rect(0, 0, 20, 20), rect(19, 9, 41, 11), rect(40, 0, 60, 20)]);
    expect(polysToRegions(offsetPolys(dumbbell, -2, 0.002))).toHaveLength(2);
  });

  it('sweeps a disc along open and closed polylines', () => {
    const open = sweepPolylines([{ points: [v2(0, 0), v2(10, 0)], closed: false }], 1, 0.002);
    expect(polysArea(open)).toBeCloseTo(20 + Math.PI, 1);
    const ring = sweepPolylines([{ points: rect(0, 0, 10, 10), closed: true }], 1, 0.002);
    expect(polysArea(ring)).toBeCloseTo(12 * 12 - 4 + Math.PI - 8 * 8, 1);
  });

  it('tests points and segments against polygon sets (even-odd)', () => {
    const polys = [rect(0, 0, 10, 10), cw(rect(4, 4, 6, 6))];
    expect(pointInPolys(v2(1, 1), polys)).toBe(true);
    expect(pointInPolys(v2(5, 5), polys)).toBe(false);
    expect(pointInPolys(v2(11, 5), polys)).toBe(false);
    expect(segmentInside(v2(1, 1), v2(9, 1), polys)).toBe(true);
    expect(segmentInside(v2(1, 5), v2(9, 5), polys)).toBe(false);
  });
});

describe('path operations', () => {
  const square = pathFromPoints(rect(0, 0, 10, 10), true);
  const arc: ArcSegment = { kind: 'arc', center: v2(0, 0), radius: 2, startAngle: 0, sweep: Math.PI };

  it('measures, samples and splits paths', () => {
    expect(pathLength(square)).toBe(40);
    expect(pathLength({ segments: [arc], closed: false })).toBeCloseTo(2 * Math.PI, 12);
    const p = pointAt(square, 15);
    expect([p.point.x, p.point.y, p.tangent.x, p.tangent.y, p.segment]).toEqual([10, 5, 0, 1, 1]);
    const half = pointAt({ segments: [arc], closed: false }, Math.PI);
    expect(half.point.x).toBeCloseTo(0, 12);
    expect(half.point.y).toBeCloseTo(2, 12);
    expect(half.tangent.x).toBeCloseTo(-1, 12);
    const piece = subPath(square, 5, 25);
    expect(pathLength({ segments: piece, closed: false })).toBeCloseTo(20, 12);
    expect(piece).toHaveLength(3);
  });

  it('reverses, re-starts and orients closed paths', () => {
    expect(pathArea(square)).toBeCloseTo(100, 9);
    expect(pathArea(reversePath(square))).toBeCloseTo(-100, 9);
    const r = rotateStart(square, 15);
    expect(pathLength(r)).toBeCloseTo(40, 12);
    expect(r.segments[0].kind === 'line' && r.segments[0].from).toEqual({ x: 10, y: 5 });
  });

  it('finds the nearest distance along a path', () => {
    expect(nearestS(square, v2(12, 5))).toEqual({ s: 15, distance: 2 });
    const n = nearestS({ segments: [arc], closed: false }, v2(0, 5));
    expect(n.s).toBeCloseTo(Math.PI, 9);
    expect(n.distance).toBeCloseTo(3, 9);
  });
});
```

`packages/core/test/arcfit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fitArcs, flattenPath, offsetPolys, type Path2D, v2, type Vec2 } from '../src';

const circlePoints = (cx: number, cy: number, r: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => v2(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)));

function maxDeviation(points: Vec2[], path: Path2D): number {
  const flat = flattenPath(path, 1e-4);
  const segDist = (p: Vec2, a: Vec2, b: Vec2) => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < flat.length; i++) best = Math.min(best, segDist(p, flat[i], flat[(i + 1) % flat.length]));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('fitArcs', () => {
  it('recovers a full circle from a 64-facet polygon', () => {
    const pts = circlePoints(5, 5, 4, 64);
    const path = fitArcs(pts, true, 0.002);
    expect(path.segments).toHaveLength(1);
    const s = path.segments[0];
    expect(s.kind).toBe('arc');
    if (s.kind === 'arc') {
      expect(s.radius).toBeCloseTo(4, 9);
      expect(Math.abs(s.sweep)).toBeCloseTo(2 * Math.PI, 9);
      expect(s.sweep).toBeGreaterThan(0);
    }
  });

  it('keeps sharp corners as lines', () => {
    const path = fitArcs([v2(0, 0), v2(10, 0), v2(10, 5), v2(0, 5)], true, 0.002);
    expect(path.segments.map((s) => s.kind)).toEqual(['line', 'line', 'line', 'line']);
  });

  it('turns a rounded rectangle into 4 lines and 4 quarter arcs', () => {
    const [poly] = offsetPolys([[v2(0, 0), v2(20, 0), v2(20, 10), v2(0, 10)]], 3, 0.002);
    const path = fitArcs(poly, true, 0.002);
    expect(path.segments.filter((s) => s.kind === 'line')).toHaveLength(4);
    const arcs = path.segments.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(4);
    for (const a of arcs) if (a.kind === 'arc') expect(a.radius).toBeCloseTo(3, 2);
    expect(maxDeviation(poly, path)).toBeLessThanOrEqual(0.0021);
  });

  it('merges colinear points into one line and handles degenerate input', () => {
    expect(fitArcs([v2(0, 0), v2(1, 0), v2(2, 0), v2(3, 0)], false, 0.002).segments).toHaveLength(1);
    expect(fitArcs([v2(1, 1)], false, 0.002).segments).toEqual([]);
    expect(fitArcs([v2(1, 1), v2(1, 1)], false, 0.002).segments).toEqual([]);
  });

  it('keeps arc end points exactly on the input points', () => {
    const pts = circlePoints(0, 0, 10, 40).slice(0, 11); // a quarter-plus arc, open
    const path = fitArcs(pts, false, 0.002);
    expect(path.segments).toHaveLength(1);
    const s = path.segments[0];
    if (s.kind !== 'arc') throw new Error('expected an arc');
    const end = { x: s.center.x + s.radius * Math.cos(s.startAngle + s.sweep), y: s.center.y + s.radius * Math.sin(s.startAngle + s.sweep) };
    expect(end.x).toBeCloseTo(pts[10].x, 9);
    expect(end.y).toBeCloseTo(pts[10].y, 9);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @sponcam/core exec vitest run test/offset.test.ts test/arcfit.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 4: Implement `pathOps.ts`**

```ts
import { type ArcSegment, arcPoint, type Path2D, type Segment, segmentEnd, segmentStart, tessellatePath, type Vec2 } from '../path2d';

const TAU = 2 * Math.PI;

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export function segmentLength(s: Segment): number {
  return s.kind === 'line' ? dist2(s.from, s.to) : s.radius * Math.abs(s.sweep);
}

export function pathLength(p: Path2D): number {
  let total = 0;
  for (const s of p.segments) total += segmentLength(s);
  return total;
}

export const pathStart = (p: Path2D): Vec2 => segmentStart(p.segments[0]);
export const pathEnd = (p: Path2D): Vec2 => segmentEnd(p.segments[p.segments.length - 1]);

/** Point and unit tangent (direction of travel) at distance `d` from the segment start, clamped to the segment. */
export function segmentPointAt(s: Segment, d: number): { point: Vec2; tangent: Vec2 } {
  const len = segmentLength(s);
  const t = len > 0 ? Math.min(1, Math.max(0, d / len)) : 0;
  if (s.kind === 'line') {
    const dx = s.to.x - s.from.x;
    const dy = s.to.y - s.from.y;
    return { point: v2(s.from.x + dx * t, s.from.y + dy * t), tangent: len > 0 ? v2(dx / len, dy / len) : v2(1, 0) };
  }
  const a = s.startAngle + s.sweep * t;
  const dir = s.sweep >= 0 ? 1 : -1;
  return { point: arcPoint(s, a), tangent: v2(-Math.sin(a) * dir, Math.cos(a) * dir) };
}

/** Point, tangent and segment index at distance `s` along the path (clamped to the path). */
export function pointAt(p: Path2D, s: number): { point: Vec2; tangent: Vec2; segment: number } {
  let rest = Math.max(0, s);
  for (let i = 0; i < p.segments.length; i++) {
    const len = segmentLength(p.segments[i]);
    if (rest <= len || i === p.segments.length - 1) return { ...segmentPointAt(p.segments[i], rest), segment: i };
    rest -= len;
  }
  return { point: v2(0, 0), tangent: v2(1, 0), segment: -1 };
}

/** Splits a segment at distance `d` from its start. */
export function splitSegment(s: Segment, d: number): [Segment, Segment] {
  if (s.kind === 'line') {
    const m = segmentPointAt(s, d).point;
    return [{ kind: 'line', from: s.from, to: m }, { kind: 'line', from: m, to: s.to }];
  }
  const len = segmentLength(s);
  const first = len > 0 ? s.sweep * Math.min(1, Math.max(0, d / len)) : 0;
  return [{ ...s, sweep: first }, { ...s, startAngle: s.startAngle + first, sweep: s.sweep - first }];
}

/** Segments covering distances [s0, s1] of the path (no wrap-around); zero-length pieces are dropped. */
export function subPath(p: Path2D, s0: number, s1: number): Segment[] {
  const out: Segment[] = [];
  let acc = 0;
  for (const seg of p.segments) {
    const len = segmentLength(seg);
    const a = acc;
    acc += len;
    if (len <= 0 || acc <= s0 + 1e-12 || a >= s1 - 1e-12) continue;
    let piece: Segment = seg;
    const hi = Math.min(len, s1 - a);
    const lo = Math.max(0, s0 - a);
    if (hi < len - 1e-12) piece = splitSegment(piece, hi)[0];
    if (lo > 1e-12) piece = splitSegment(piece, lo)[1];
    if (segmentLength(piece) > 1e-12) out.push(piece);
  }
  return out;
}

export function reverseSegment(s: Segment): Segment {
  return s.kind === 'line' ? { kind: 'line', from: s.to, to: s.from } : { ...s, startAngle: s.startAngle + s.sweep, sweep: -s.sweep };
}

export function reversePath(p: Path2D): Path2D {
  return { closed: p.closed, segments: p.segments.map(reverseSegment).reverse() };
}

/** A closed path re-started at distance `s`. Open paths are returned unchanged. */
export function rotateStart(p: Path2D, s: number): Path2D {
  const total = pathLength(p);
  if (!p.closed || total <= 0) return p;
  const at = ((s % total) + total) % total;
  if (at < 1e-9 || total - at < 1e-9) return p;
  return { closed: true, segments: [...subPath(p, at, total), ...subPath(p, 0, at)] };
}

/** Polyline through the path; a closed path's repeated end point is dropped. */
export function flattenPath(p: Path2D, tol: number): Vec2[] {
  const pts = tessellatePath(p, tol);
  if (p.closed && pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  return pts;
}

/** Signed area (counter-clockwise positive) of a closed polygon. */
export function polyArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return sum / 2;
}

export function pathArea(p: Path2D, tol = 1e-3): number {
  return polyArea(flattenPath(p, tol));
}

/** The path with counter-clockwise (ccw = true) or clockwise orientation. */
export function orientPath(p: Path2D, ccw: boolean): Path2D {
  const a = pathArea(p);
  return a === 0 || a > 0 === ccw ? p : reversePath(p);
}

export function pathFromPoints(points: readonly Vec2[], closed: boolean): Path2D {
  const segments: Segment[] = [];
  const n = points.length;
  for (let i = 0; i + 1 < n; i++) segments.push({ kind: 'line', from: points[i], to: points[i + 1] });
  if (closed && n > 2) segments.push({ kind: 'line', from: points[n - 1], to: points[0] });
  return { segments, closed };
}

/** Signed sweep from angle a0 to a1 in the given direction, in (0, 2π] (ccw) or [−2π, 0) (cw). */
export function arcSweepBetween(a0: number, a1: number, ccw: boolean): number {
  let d = (a1 - a0) % TAU;
  if (ccw) {
    if (d <= 1e-12) d += TAU;
    return d;
  }
  if (d >= -1e-12) d -= TAU;
  return d;
}

function nearestOnSegment(s: Segment, q: Vec2): { d: number; distance: number } {
  if (s.kind === 'line') {
    const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((q.x - s.from.x) * dx + (q.y - s.from.y) * dy) / len2)) : 0;
    return { d: t * Math.sqrt(len2), distance: Math.hypot(q.x - s.from.x - dx * t, q.y - s.from.y - dy * t) };
  }
  const a: ArcSegment = s;
  const sweepAbs = Math.abs(a.sweep);
  const dir = a.sweep >= 0 ? 1 : -1;
  let rel = ((Math.atan2(q.y - a.center.y, q.x - a.center.x) - a.startAngle) * dir) % TAU;
  if (rel < 0) rel += TAU;
  if (rel <= sweepAbs) return { d: rel * a.radius, distance: Math.abs(dist2(q, a.center) - a.radius) };
  const ds = dist2(q, arcPoint(a, a.startAngle));
  const de = dist2(q, arcPoint(a, a.startAngle + a.sweep));
  return ds <= de ? { d: 0, distance: ds } : { d: sweepAbs * a.radius, distance: de };
}

/** Distance along the path of the point nearest to `q`, and how far `q` is from it. */
export function nearestS(p: Path2D, q: Vec2): { s: number; distance: number } {
  let best = { s: 0, distance: Infinity };
  let acc = 0;
  for (const seg of p.segments) {
    const n = nearestOnSegment(seg, q);
    if (n.distance < best.distance - 1e-12) best = { s: acc + n.d, distance: n.distance };
    acc += segmentLength(seg);
  }
  return best;
}

/** Distances along the path where the direction turns by more than `minTurnDeg` between consecutive segments (closed paths include the joint at 0). */
export function cornerDistances(p: Path2D, minTurnDeg: number): number[] {
  const out: number[] = [];
  const cos = Math.cos((minTurnDeg * Math.PI) / 180);
  const n = p.segments.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const len = segmentLength(p.segments[i]);
    const next = i + 1 < n ? p.segments[i + 1] : p.closed ? p.segments[0] : null;
    if (next) {
      const t0 = segmentPointAt(p.segments[i], len).tangent;
      const t1 = segmentPointAt(next, 0).tangent;
      if (t0.x * t1.x + t0.y * t1.y < cos) out.push(i + 1 < n ? acc + len : 0);
    }
    acc += len;
  }
  return out.sort((a, b) => a - b);
}
```

- [ ] **Step 5: Implement `clipper.ts`**

```ts
import {
  booleanOpWithPolyTree, ClipType, difference, EndType, FillRule, inflatePaths, intersect, JoinType, type Path64,
  pointInPolygon, PointInPolygonResult, type PolyPath64, PolyTree64, union,
} from 'clipper2-ts';
import type { Vec2 } from '../path2d';
import { polyArea, v2 } from './pathOps';

/** Clipper works in integers: 1e5 units per mm (10 nm resolution). */
export const CLIP_SCALE = 1e5;

/** A closed polygon without a repeated end point. Outer boundaries run counter-clockwise, holes clockwise. */
export type Poly = Vec2[];
export interface Region { outer: Poly; holes: Poly[] }

const toPath = (p: readonly Vec2[]): Path64 => p.map((v) => ({ x: Math.round(v.x * CLIP_SCALE), y: Math.round(v.y * CLIP_SCALE) }));
const fromPath = (p: Path64): Poly => p.map((v) => v2(v.x / CLIP_SCALE, v.y / CLIP_SCALE));
const toPaths = (ps: readonly (readonly Vec2[])[]): Path64[] => ps.map(toPath);
const fromPaths = (ps: Path64[]): Poly[] => ps.map(fromPath);
const arcTol = (tol: number) => Math.max(tol, 1e-4) * CLIP_SCALE;

/** Offsets closed polygons by `delta` mm (negative = inward) with round joins. The result is normalised: outers CCW, holes CW. */
export function offsetPolys(polys: readonly Poly[], delta: number, tol: number): Poly[] {
  if (!polys.length) return [];
  return fromPaths(inflatePaths(toPaths(polys), delta * CLIP_SCALE, JoinType.Round, EndType.Polygon, 2, arcTol(tol)));
}

/** The area covered by a disc of `radius` moving along each polyline (closed polylines sweep a band). */
export function sweepPolylines(lines: readonly { points: readonly Vec2[]; closed: boolean }[], radius: number, tol: number): Poly[] {
  const open = lines.filter((l) => !l.closed && l.points.length > 1).map((l) => toPath(l.points));
  const closed = lines.filter((l) => l.closed && l.points.length > 2).map((l) => toPath(l.points));
  const parts: Path64[] = [];
  if (open.length) parts.push(...inflatePaths(open, radius * CLIP_SCALE, JoinType.Round, EndType.Round, 2, arcTol(tol)));
  if (closed.length) parts.push(...inflatePaths(closed, radius * CLIP_SCALE, JoinType.Round, EndType.Joined, 2, arcTol(tol)));
  return parts.length ? fromPaths(union(parts, FillRule.NonZero)) : [];
}

export function unionPolys(a: readonly Poly[], b: readonly Poly[] = []): Poly[] {
  return fromPaths(union(toPaths(a), toPaths(b), FillRule.NonZero));
}
export function differencePolys(a: readonly Poly[], b: readonly Poly[]): Poly[] {
  return fromPaths(difference(toPaths(a), toPaths(b), FillRule.NonZero));
}
export function intersectPolys(a: readonly Poly[], b: readonly Poly[]): Poly[] {
  return fromPaths(intersect(toPaths(a), toPaths(b), FillRule.NonZero));
}

/** Splits a polygon set into separate regions (each outer with its own holes); islands inside holes become regions of their own. */
export function polysToRegions(polys: readonly Poly[]): Region[] {
  if (!polys.length) return [];
  const tree = new PolyTree64();
  booleanOpWithPolyTree(ClipType.Union, toPaths(polys), null, tree, FillRule.NonZero);
  const out: Region[] = [];
  const visit = (node: PolyPath64) => {
    const holes: Poly[] = [];
    for (let i = 0; i < node.count; i++) {
      const hole = node.child(i);
      holes.push(fromPath(hole.poly ?? []));
      for (let j = 0; j < hole.count; j++) visit(hole.child(j));
    }
    out.push({ outer: fromPath(node.poly ?? []), holes });
  };
  for (let i = 0; i < tree.count; i++) visit(tree.child(i));
  return out;
}

export const regionPolys = (r: Region): Poly[] => [r.outer, ...r.holes];

/** Total signed area of a normalised polygon set (holes subtract). */
export function polysArea(polys: readonly Poly[]): number {
  return polys.reduce((sum, p) => sum + polyArea(p), 0);
}

/** Even-odd containment; points on a boundary count as inside. */
export function pointInPolys(p: Vec2, polys: readonly Poly[]): boolean {
  const q = { x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) };
  let inside = false;
  for (const poly of polys) {
    const r = pointInPolygon(q, toPath(poly));
    if (r === PointInPolygonResult.IsOn) return true;
    if (r === PointInPolygonResult.IsInside) inside = !inside;
  }
  return inside;
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Proper crossing of segments p1p2 and p3p4 (touching at end points does not count). */
function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const eps = 1e-12;
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** True when segment a→b crosses no polygon edge and its midpoint is inside the set. */
export function segmentInside(a: Vec2, b: Vec2, polys: readonly Poly[]): boolean {
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) if (segmentsCross(a, b, poly[i], poly[(i + 1) % poly.length])) return false;
  }
  return pointInPolys(v2((a.x + b.x) / 2, (a.y + b.y) / 2), polys);
}
```

- [ ] **Step 6: Implement `arcFit.ts`**

```ts
import type { ArcSegment, Path2D, Segment, Vec2 } from '../path2d';
import { arcSweepBetween, dist2, v2 } from './pathOps';

const MAX_RUN = 1500;
const MAX_TURN = Math.cos(Math.PI / 4); // consecutive chords may turn at most 45° inside one arc

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  return v2((a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d);
}

/** An arc through pts[i..j] within `tol`, turning consistently, or null. */
function arcThrough(pts: readonly Vec2[], i: number, j: number, tol: number): ArcSegment | null {
  const m = (i + j) >> 1;
  const c = circumcenter(pts[i], pts[m], pts[j]);
  if (!c) return null;
  const r = dist2(c, pts[i]);
  if (r > 1e4) return null;
  const turn = Math.sign(cross(pts[i], pts[m], pts[j]));
  let travelled = 0;
  for (let k = i + 1; k <= j; k++) {
    if (k < j && Math.abs(dist2(c, pts[k]) - r) > tol) return null;
    if (k < j) {
      const t = cross(pts[k - 1], pts[k], pts[k + 1]);
      if (Math.sign(t) !== turn && Math.abs(t) > 1e-12) return null;
      const ax = pts[k].x - pts[k - 1].x, ay = pts[k].y - pts[k - 1].y, bx = pts[k + 1].x - pts[k].x, by = pts[k + 1].y - pts[k].y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < MAX_TURN) return null;
    }
    const a0 = Math.atan2(pts[k - 1].y - c.y, pts[k - 1].x - c.x);
    const a1 = Math.atan2(pts[k].y - c.y, pts[k].x - c.x);
    travelled += Math.abs(arcSweepBetween(a0, a1, turn > 0));
  }
  if (travelled >= 2 * Math.PI - 1e-9) return null;
  const startAngle = Math.atan2(pts[i].y - c.y, pts[i].x - c.x);
  return { kind: 'arc', center: c, radius: r, startAngle, sweep: turn > 0 ? travelled : -travelled };
}

function lineFits(pts: readonly Vec2[], i: number, j: number, tol: number): boolean {
  const a = pts[i], b = pts[j];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 1e-12) return false;
  let lastT = 0;
  for (let k = i + 1; k < j; k++) {
    const t = ((pts[k].x - a.x) * dx + (pts[k].y - a.y) * dy) / (len * len);
    if (t < lastT - 1e-9 || t > 1 + 1e-9) return false;
    lastT = t;
    if (Math.abs(cross(a, b, pts[k])) / len > tol) return false;
  }
  return true;
}

function dedupe(input: readonly Vec2[], closed: boolean, eps: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of input) if (!out.length || dist2(out[out.length - 1], p) > eps) out.push(p);
  if (closed && out.length > 1 && dist2(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

/**
 * Where to start fitting a closed polygon: its sharpest corner if one turns by more than 45°, otherwise the
 * start of its longest chord (a straight edge), so no arc is split across the start point.
 */
function fitStart(pts: readonly Vec2[]): number {
  let sharp = 0, sharpCos = Infinity, longest = 0, longestLen = -1;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[(k + n - 1) % n], q = pts[k], r = pts[(k + 1) % n];
    const ax = q.x - p.x, ay = q.y - p.y, bx = r.x - q.x, by = r.y - q.y;
    const lb = Math.hypot(bx, by);
    const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * lb || 1);
    if (c < sharpCos) { sharpCos = c; sharp = k; }
    if (lb > longestLen) { longestLen = lb; longest = k; }
  }
  return sharpCos < MAX_TURN ? sharp : longest;
}

/** Replaces runs of polyline points with lines and arcs that stay within `tol` of every input point. */
export function fitArcs(input: readonly Vec2[], closed: boolean, tol: number): Path2D {
  let pts = dedupe(input, closed, tol * 1e-3);
  if (pts.length < 2) return { segments: [], closed };
  if (closed) {
    if (pts.length >= 8) {
      // the whole ring as one circle: centre from three spread points, every point within tol
      const c = circumcenter(pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor((2 * pts.length) / 3)]);
      const turn = Math.sign(cross(pts[0], pts[1], pts[2]));
      if (c && turn !== 0) {
        const r = dist2(c, pts[0]);
        if (r <= 1e4 && pts.every((p) => Math.abs(dist2(c, p) - r) <= tol)) {
          return { closed, segments: [{ kind: 'arc', center: c, radius: r, startAngle: Math.atan2(pts[0].y - c.y, pts[0].x - c.x), sweep: turn * 2 * Math.PI }] };
        }
      }
    }
    const k = fitStart(pts);
    pts = [...pts.slice(k), ...pts.slice(0, k), pts[k]];
  }
  const segments: Segment[] = [];
  const n = pts.length;
  let i = 0;
  while (i < n - 1) {
    let arc: ArcSegment | null = null;
    let arcEnd = -1;
    for (let j = i + 3; j < n && j - i <= MAX_RUN; j++) {
      const a = arcThrough(pts, i, j, tol);
      if (!a) break;
      arc = a;
      arcEnd = j;
    }
    let lineEnd = i + 1;
    for (let j = i + 2; j < n && j - i <= MAX_RUN; j++) {
      if (!lineFits(pts, i, j, tol)) break;
      lineEnd = j;
    }
    if (arc && arcEnd > lineEnd) {
      segments.push(arc);
      i = arcEnd;
    } else {
      segments.push({ kind: 'line', from: pts[i], to: pts[lineEnd] });
      i = lineEnd;
    }
  }
  return { segments, closed };
}
```

Notes for the implementer:
- `arcThrough` returns `null` for a whole closed ring, because the travelled angle reaches 2π. The explicit full-circle check at the top of `fitArcs` handles that case.
- An arc's end angle is computed from its centre, so it lands on the input point `pts[j]` up to floating-point error, since the circumcentre passes through `pts[i]` and `pts[j]`. The test "keeps arc end points exactly on the input points" pins this down.

`index.ts`: append
```ts
export * from './geometry/offset/pathOps';
export * from './geometry/offset/clipper';
export * from './geometry/offset/arcFit';
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/offset.test.ts test/arcfit.test.ts && pnpm typecheck`
Expected: PASS.

If the rounded-rectangle test finds 5 lines, a short line sits between an arc and the next straight edge: Clipper can emit two nearly coincident points at a tangent joint. Handle it by making `dedupe`'s epsilon `tol * 0.5`, then re-run. Do not relax the test.

- [ ] **Step 8: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): clipper2 offsetting wrapper, path operations and arc fitting"
```

---
### Task 4: CAM context, DXF features, chaining and nesting, CAM part fixture

**Files:**
- Create: `packages/core/src/cam/context.ts`, `packages/core/src/cam/features/chain.ts`, `packages/core/src/cam/features/dxf.ts`
- Modify: `packages/core/test/fixtures/make-fixtures.mjs` (add `cam-part.dxf`), `packages/core/src/index.ts`
- Create (generated, then committed): `packages/core/test/fixtures/cam-part.dxf`
- Create: `packages/core/test/fixtures/camSetup.ts` (shared test setup; later tasks add to it)
- Test: `packages/core/test/features-dxf.test.ts`

**Interfaces:**
- Consumes:
  - `computePlacement`, `applyPlacement`, `stockBox`, `wcsPoint`, `Placement` (`job/derive.ts`);
  - `Mesh`, `Adjacency`, `Drawing`;
  - Task 3 `pathOps`/`clipper`.
- Produces:
  - `type CamGeometry`, `interface CamContext`, `camContext(job, geometry)`, `toProgram(ctx, raw)`, `drawingPathToProgram(ctx, path)`
  - `chainPaths(paths, tol): { closed: Path2D[]; open: Path2D[] }`
  - `interface Shape { outer: Path2D; islands: Path2D[] }`, `nestLoops(loops, tol): Shape[]`
  - `circleOf(path): { center: Vec2; diameter: number } | null`
  - `drawingPath(drawing, layer, path): Path2D | null`
  - `nearestDxfPath(ctx, q: Vec2, maxDist: number, hiddenLayers?: ReadonlySet<string>): DxfPathRef | null`

- [ ] **Step 1: Add the fixture**

In `packages/core/test/fixtures/make-fixtures.mjs`, add this function before the `writeFileSync` calls:
```js
function camPartDxf() {
  const line = (x1, y1, x2, y2) => [[0, 'LINE'], [8, 'POCKET'], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];
  const circle = (layer, x, y, r) => [[0, 'CIRCLE'], [8, layer], [10, x], [20, y], [30, 0], [40, r]];
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 3],
    [0, 'LAYER'], [2, 'OUTLINE'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'POCKET'], [70, 0], [62, 3], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'HOLES'], [70, 0], [62, 1], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, 'OUTLINE'], [90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 60], [10, 0], [20, 60],
    // pocket rectangle as four separate lines; the third one runs backwards, to exercise chaining
    ...line(30, 20, 70, 20), ...line(70, 20, 70, 40), ...line(30, 40, 70, 40), ...line(30, 40, 30, 20),
    ...circle('POCKET', 50, 30, 4), // island
    ...circle('HOLES', 10, 10, 3), ...circle('HOLES', 90, 10, 3), ...circle('HOLES', 10, 50, 3), ...circle('HOLES', 90, 50, 3),
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}
```
Then add `writeFileSync(join(here, 'cam-part.dxf'), camPartDxf());`, and extend the final `console.log` to list `cam-part.dxf`.

Run: `node packages/core/test/fixtures/make-fixtures.mjs`
Expected: it prints the file list. `git status` shows `cam-part.dxf` as new, and the existing fixtures unchanged, because their bytes are identical.

- [ ] **Step 2: Write the shared test setup and the failing test**

`packages/core/test/fixtures/camSetup.ts`:
```ts
import { readFileSync } from 'node:fs';
import { type CamGeometry, createJob, importFile, pathsToPoints, setModel, setStock } from '../../src';

/** The CAM part drawing as a job: auto stock with a 5 mm margin and 6 mm thickness. */
export function camPartSetup() {
  const r = importFile('cam-part.dxf', readFileSync(new URL('./cam-part.dxf', import.meta.url)));
  if (!r.ok || r.kind !== 'drawing') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'drawing', drawing: r.drawing, rawPoints: pathsToPoints(r.drawing.layers.flatMap((l) => l.paths)) };
  let job = setModel(createJob(), { sourceName: 'cam-part.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 6 } });
  const layer = (name: string) => r.drawing.layers.findIndex((l) => l.name === name);
  return { job, geometry, drawing: r.drawing, layer };
}
```
`packages/core/test/features-dxf.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { camContext, chainPaths, circleOf, drawingPath, drawingPathToProgram, nearestDxfPath, nestLoops, pathArea, setZSpin, v2 } from '../src';
import { camPartSetup } from './fixtures/camSetup';

describe('CAM context for a drawing', () => {
  it('puts the drawing on the stock top with program zero at the stock corner', () => {
    const { job, geometry } = camPartSetup();
    const ctx = camContext(job, geometry);
    expect(ctx.origin).toEqual({ x: -55, y: -35, z: 0 });
    expect(ctx.stock).toEqual({ min: { x: 0, y: 0, z: -6 }, max: { x: 110, y: 70, z: 0 } });
    expect(ctx.model).toEqual({ min: { x: 5, y: 5, z: 0 }, max: { x: 105, y: 65, z: 0 } });
    expect(ctx.tolerance).toBe(0.002);
  });

  it('maps drawing paths into program coordinates, including the Z spin', () => {
    const { job, geometry, drawing, layer } = camPartSetup();
    const hole = drawingPath(drawing, layer('HOLES'), 0)!;
    expect(circleOf(drawingPathToProgram(camContext(job, geometry), hole))).toEqual({ center: { x: 15, y: 15 }, diameter: 6 });
    const spun = camContext(setZSpin(job, 90), geometry);
    const c = circleOf(drawingPathToProgram(spun, hole))!;
    // spun 90°: stock is 70 × 110; the hole at raw (10,10) lands at program (55, 15)
    expect(c.center.x).toBeCloseTo(55, 9);
    expect(c.center.y).toBeCloseTo(15, 9);
  });
});

describe('chaining and nesting', () => {
  it('chains loose lines into one closed loop and keeps circles closed', () => {
    const { drawing, layer } = camPartSetup();
    const { closed, open } = chainPaths(drawing.layers[layer('POCKET')].paths, 0.002);
    expect(open).toEqual([]);
    expect(closed).toHaveLength(2);
    expect(closed.map((p) => Math.abs(pathArea(p))).sort((a, b) => a - b)[1]).toBeCloseTo(800, 6);
  });

  it('leaves unconnected pieces open', () => {
    const { drawing, layer } = camPartSetup();
    const lines = drawing.layers[layer('POCKET')].paths.slice(0, 3);
    const { closed, open } = chainPaths(lines, 0.002);
    expect(closed).toEqual([]);
    expect(open).toHaveLength(1);
    expect(open[0].segments).toHaveLength(3);
  });

  it('nests loops into outers (CCW) with islands (CW)', () => {
    const { drawing, layer } = camPartSetup();
    const { closed } = chainPaths(drawing.layers[layer('POCKET')].paths, 0.002);
    const shapes = nestLoops(closed, 0.002);
    expect(shapes).toHaveLength(1);
    expect(pathArea(shapes[0].outer)).toBeCloseTo(800, 6);
    expect(shapes[0].islands).toHaveLength(1);
    expect(pathArea(shapes[0].islands[0])).toBeLessThan(0);
    const all = nestLoops([...closed, ...drawing.layers[layer('OUTLINE')].paths], 0.002);
    // outline > pocket (island of the outline) > circle (a new outer inside the pocket's hole)
    expect(all).toHaveLength(2);
  });
});

describe('picking DXF paths', () => {
  it('finds the nearest path within range, skipping hidden layers', () => {
    const { job, geometry, layer } = camPartSetup();
    const ctx = camContext(job, geometry);
    expect(nearestDxfPath(ctx, v2(18.2, 15), 1)).toEqual({ kind: 'dxfPath', blobId: 'd1', layer: layer('HOLES'), path: 0 });
    expect(nearestDxfPath(ctx, v2(5.3, 30), 1)).toEqual({ kind: 'dxfPath', blobId: 'd1', layer: layer('OUTLINE'), path: 0 });
    expect(nearestDxfPath(ctx, v2(15, 15), 1)).toBeNull();
    expect(nearestDxfPath(ctx, v2(18.2, 15), 1, new Set(['HOLES']))).toBeNull();
  });
});
```

Check the 90° spin by hand:
- Rotating raw (x, y) by +90° gives (−y, x). The outline spans x ∈ [−60, 0] and y ∈ [0, 100], so its centre is (−30, 50).
- The translation is therefore (30, −50). With a 5 mm margin the stock spans [−35, 35] × [−55, 55], and the WCS corner is (−35, −55).
- The hole at raw (10, 10) rotates to (−10, 10), shifts to (20, −40), and ends at program (55, 15).

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/features-dxf.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 4: Implement `cam/context.ts`**

```ts
import type { Adjacency } from '../geometry/adjacency';
import type { BBox } from '../geometry/bbox';
import type { Mesh } from '../geometry/mesh';
import type { Path2D, Segment, Vec2 } from '../geometry/path2d';
import { v3sub, type Vec3, vec3 } from '../geometry/vec3';
import type { Drawing } from '../import/dxf/dxf';
import { applyPlacement, computePlacement, type Placement, stockBox, wcsPoint } from '../job/derive';
import type { Job } from '../job/types';

/** The loaded model as CAM needs it; the web app's ModelGeometry has this shape. */
export type CamGeometry =
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; rawPoints: ArrayLike<number> }
  | { kind: 'drawing'; drawing: Drawing; rawPoints: ArrayLike<number> };

export interface CamContext {
  job: Job;
  geometry: CamGeometry | null;
  placement: Placement | null;
  /** WCS point in scene coordinates; program coordinates = scene − origin. */
  origin: Vec3;
  /** Stock box in program coordinates. */
  stock: BBox | null;
  /** Placed model box in program coordinates. */
  model: BBox | null;
  tolerance: number;
}

const shift = (b: BBox, o: Vec3): BBox => ({ min: v3sub(b.min, o), max: v3sub(b.max, o) });

export function camContext(job: Job, geometry: CamGeometry | null): CamContext {
  const placement = job.model && geometry && geometry.kind === job.model.kind ? computePlacement(job.model, geometry.rawPoints) : null;
  const box = stockBox(job, placement);
  const origin = box ? wcsPoint(job.wcs, box) : vec3(0, 0, 0);
  return {
    job, geometry, placement, origin,
    stock: box ? shift(box, origin) : null,
    model: placement ? shift(placement.bbox, origin) : null,
    tolerance: job.tolerance,
  };
}

/** A raw model point in program coordinates (requires a placement). */
export function toProgram(ctx: CamContext, raw: Vec3): Vec3 {
  if (!ctx.placement) throw new Error('No model placement');
  return v3sub(applyPlacement(ctx.placement, raw), ctx.origin);
}

/** A drawing path (raw DXF units) in program coordinates: scale, spin about Z, placement shift, minus the WCS point. */
export function drawingPathToProgram(ctx: CamContext, path: Path2D): Path2D {
  const p = ctx.placement;
  if (!p) throw new Error('No model placement');
  const theta = ((ctx.job.model?.transform.zDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta), k = p.scale;
  const tx = p.translation.x - ctx.origin.x, ty = p.translation.y - ctx.origin.y;
  const map = (v: Vec2): Vec2 => ({ x: (v.x * cos - v.y * sin) * k + tx, y: (v.x * sin + v.y * cos) * k + ty });
  const seg = (s: Segment): Segment =>
    s.kind === 'line'
      ? { kind: 'line', from: map(s.from), to: map(s.to) }
      : { ...s, center: map(s.center), radius: s.radius * k, startAngle: s.startAngle + theta };
  return { closed: path.closed, segments: path.segments.map(seg) };
}
```

- [ ] **Step 5: Implement `cam/features/chain.ts`**

```ts
import { pointInPolys } from '../../geometry/offset/clipper';
import { dist2, flattenPath, orientPath, pathEnd, pathLength, pathStart, polyArea, reversePath } from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentEnd, segmentStart } from '../../geometry/path2d';

/** Joins open paths end to end (reversing where needed) when their end points are within `tol`. */
export function chainPaths(paths: readonly Path2D[], tol: number): { closed: Path2D[]; open: Path2D[] } {
  const closed: Path2D[] = [];
  const pieces: Path2D[] = [];
  for (const p of paths) {
    if (!p.segments.length) continue;
    if (p.closed || (dist2(pathStart(p), pathEnd(p)) <= tol && pathLength(p) > 2 * tol)) closed.push({ ...p, closed: true });
    else pieces.push(p);
  }
  const used = pieces.map(() => false);
  const open: Path2D[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let segs: Segment[] = [...pieces[i].segments];
    for (let grown = true; grown; ) {
      grown = false;
      const start = segmentStart(segs[0]);
      const end = segmentEnd(segs[segs.length - 1]);
      for (let j = 0; j < pieces.length; j++) {
        if (used[j]) continue;
        const q = pieces[j];
        const qs = pathStart(q), qe = pathEnd(q);
        if (dist2(end, qs) <= tol) segs = [...segs, ...q.segments];
        else if (dist2(end, qe) <= tol) segs = [...segs, ...reversePath(q).segments];
        else if (dist2(start, qe) <= tol) segs = [...q.segments, ...segs];
        else if (dist2(start, qs) <= tol) segs = [...reversePath(q).segments, ...segs];
        else continue;
        used[j] = true;
        grown = true;
        break;
      }
    }
    const path: Path2D = { segments: segs, closed: false };
    if (dist2(pathStart(path), pathEnd(path)) <= tol && pathLength(path) > 2 * tol) closed.push({ ...path, closed: true });
    else open.push(path);
  }
  return { closed, open };
}

export interface Shape {
  /** Counter-clockwise. */
  outer: Path2D;
  /** Clockwise. */
  islands: Path2D[];
}

/** Groups closed loops by containment: even depth = outer, odd depth = island of the smallest loop around it. */
export function nestLoops(loops: readonly Path2D[], tol: number): Shape[] {
  const flat = loops.map((l) => flattenPath(l, Math.max(tol, 0.01)));
  const areas = flat.map((f) => Math.abs(polyArea(f)));
  const contains = (o: number, i: number) => o !== i && areas[o] > areas[i] && pointInPolys(flat[i][0], [flat[o]]);
  const depth = loops.map((_, i) => loops.filter((_, j) => contains(j, i)).length);
  const shapes = new Map<number, Shape>();
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) shapes.set(i, { outer: orientPath(l, true), islands: [] });
  });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    let parent = -1;
    for (let j = 0; j < loops.length; j++) {
      if (depth[j] === depth[i] - 1 && contains(j, i) && (parent < 0 || areas[j] < areas[parent])) parent = j;
    }
    shapes.get(parent)?.islands.push(orientPath(l, false));
  });
  return [...shapes.values()];
}
```

- [ ] **Step 6: Implement `cam/features/dxf.ts`**

```ts
import { dist2, nearestS } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Drawing } from '../../import/dxf/dxf';
import { type CamContext, drawingPathToProgram } from '../context';
import type { DxfPathRef } from '../types';

export function drawingPath(drawing: Drawing, layer: number, path: number): Path2D | null {
  return drawing.layers[layer]?.paths[path] ?? null;
}

/** A path made only of arcs with one centre and radius, sweeping a full turn. */
export function circleOf(path: Path2D, eps = 1e-6): { center: Vec2; diameter: number } | null {
  const first = path.segments[0];
  if (!first || first.kind !== 'arc') return null;
  let sweep = 0;
  for (const s of path.segments) {
    if (s.kind !== 'arc' || dist2(s.center, first.center) > eps || Math.abs(s.radius - first.radius) > eps) return null;
    sweep += s.sweep;
  }
  return Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-6 ? { center: first.center, diameter: 2 * first.radius } : null;
}

/** The drawing path nearest to program point `q`, if within `maxDist` mm. */
export function nearestDxfPath(ctx: CamContext, q: Vec2, maxDist: number, hiddenLayers?: ReadonlySet<string>): DxfPathRef | null {
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing' || !ctx.job.model || !ctx.placement) return null;
  let best: DxfPathRef | null = null;
  let bestDist = maxDist;
  g.drawing.layers.forEach((l, layer) => {
    if (hiddenLayers?.has(l.name)) return;
    l.paths.forEach((p, path) => {
      const d = nearestS(drawingPathToProgram(ctx, p), q).distance;
      if (d <= bestDist) {
        bestDist = d;
        best = { kind: 'dxfPath', blobId: ctx.job.model!.blobId, layer, path };
      }
    });
  });
  return best;
}
```

`index.ts`: append
```ts
export * from './cam/context';
export * from './cam/features/chain';
export * from './cam/features/dxf';
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/features-dxf.test.ts && pnpm typecheck`
Expected: PASS. If `ctx.origin`, `ctx.stock` or `ctx.model` differ only by `-0` against `0`, compare with `toBeCloseTo` per field rather than changing the code.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): CAM context, DXF chaining, loop nesting and path picking"
```

---
### Task 5: Mesh faces and holes, reference resolution, `describeGeometry`, plate fixture

**Files:**
- Create: `packages/core/src/cam/features/mesh.ts`, `packages/core/src/cam/features/resolve.ts`, `packages/core/src/cam/features/describe.ts`
- Modify: `packages/core/test/fixtures/make-fixtures.mjs` (add `plate-pocket.stl`), `packages/core/src/index.ts`
- Create (generated, then committed): `packages/core/test/fixtures/plate-pocket.stl`
- Modify: `packages/core/test/fixtures/camSetup.ts` (add `plateSetup`, `faceAt`)
- Test: `packages/core/test/features-mesh.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `CamContext`, `camContext`, `toProgram`, `drawingPathToProgram`, `chainPaths`, `nestLoops`, `Shape`, `circleOf`, `drawingPath`;
  - Task 3: `fitArcs`, `polyArea`, `orientPath`;
  - existing: `planarRegion`, `vertexAt`, `triangleNormal`, `triangleVertices`, `triangleCount`, `quatRotate`.
- Produces:
  - `boundaryLoops(mesh, adjacency, tris): number[][]`
  - `interface FaceGeometry { tris: number[]; z: number; loops: Path2D[] }`: loop 0 is the outer loop (CCW), the others are CW.
  - `faceGeometry(ctx, tris): FaceGeometry`
  - `resolveFaceRef(ctx, ref): { ok: true; face: FaceGeometry } | { ok: false; code: CamCode; message: string }`
  - `holeBottom(ctx, center, radius, top): { bottom: number; through: boolean }`
  - `interface ResolvedContour { path: Path2D; z: number; ref: number }`, `interface ResolvedShape { shape: Shape; z: number; ref: number }`, `interface ResolvedHole { center: Vec2; diameter: number; top: number; bottom: number; through: boolean; ref: number }`
  - `interface ResolvedGeometry { contours; shapes; holes; diagnostics: CamDiagnostic[]; faceZ(ref: MeshFaceRef): number | null }`
  - `resolveGeometry(op: Operation, ctx: CamContext): ResolvedGeometry`
  - `interface GeometryCatalog`, `describeGeometry(job, geometry): GeometryCatalog`
  - `faceRefFromTriangle(mesh, blobId, tri): MeshFaceRef`

- [ ] **Step 1: Add the plate fixture**

At the top of `packages/core/test/fixtures/make-fixtures.mjs`, add `import { triangulate } from 'clipper2-ts';`. Then add this function:
```js
// 80 × 50 × 10 plate: blind pocket (x 10–40, y 15–35, floor z 6) with a blind Ø6 hole (centre 25,25, bottom z 3),
// and two through holes Ø8 at (60,15) and (60,35). All holes are 16-gons; coordinates are on a 0.001 mm grid.
function platePocketTriangles() {
  const round = (v) => Math.round(v * 1000) / 1000;
  const circle = (cx, cy, r, ccw) => {
    const pts = Array.from({ length: 16 }, (_, i) => [round(cx + r * Math.cos((2 * Math.PI * i) / 16)), round(cy + r * Math.sin((2 * Math.PI * i) / 16))]);
    return ccw ? pts : pts.reverse();
  };
  const rect = (x0, y0, x1, y1, ccw) => (ccw ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
  const outer = rect(0, 0, 80, 50, true);
  const pocket = rect(10, 15, 40, 35, false);
  const blind = circle(25, 25, 3, false);
  const thru1 = circle(60, 15, 4, false);
  const thru2 = circle(60, 35, 4, false);
  const tris = [];
  // triangulated flat face at height z; up = normal +Z (else -Z)
  const face = (loops, z, up) => {
    const { solution } = triangulate(loops.map((l) => l.map(([x, y]) => ({ x: Math.round(x * 1000), y: Math.round(y * 1000) }))));
    for (const t of solution) {
      let [a, b, c] = t.map((p) => [p.x / 1000, p.y / 1000, z]);
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if ((cross > 0) !== up) [b, c] = [c, b];
      tris.push([...a, ...b, ...c]);
    }
  };
  // vertical walls along a loop from z0 to z1; normal is to the right of travel
  const walls = (loop, z0, z1) => {
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
      tris.push([ax, ay, z0, bx, by, z0, bx, by, z1], [ax, ay, z0, bx, by, z1, ax, ay, z1]);
    }
  };
  face([outer, pocket, thru1, thru2], 10, true); // top
  face([rect(10, 15, 40, 35, true), blind], 6, true); // pocket floor
  face([circle(25, 25, 3, true)], 3, true); // blind hole bottom
  face([outer, thru1, thru2], 0, false); // bottom
  walls(outer, 0, 10);
  walls(pocket, 6, 10);
  walls(blind, 3, 6);
  walls(thru1, 0, 10);
  walls(thru2, 0, 10);
  return tris;
}
```
`binaryStl` in the script takes triangle arrays already. Give it an optional header argument, defaulting to the current box header text so `box-20x10x5.stl` stays byte-identical:
```js
function binaryStl(tris, header = 'Spon fixture: 20 x 10 x 5 mm box') {
  const bytes = new Uint8Array(84 + 50 * tris.length);
  bytes.set(new TextEncoder().encode(header));
  // … unchanged …
}
```
Then write the plate: `writeFileSync(join(here, 'plate-pocket.stl'), binaryStl(platePocketTriangles(), 'Spon fixture: plate with pocket and holes'));`, and extend the `console.log`.

Run: `node packages/core/test/fixtures/make-fixtures.mjs`
Expected: `plate-pocket.stl` is written. `git status` shows only the two new fixture files and the script change; `box-20x10x5.stl` and `plate-mm.dxf` are unchanged.

- [ ] **Step 2: Extend the shared setup and write the failing test**

Append to `packages/core/test/fixtures/camSetup.ts`, adding `faceRefFromTriangle` and `type MeshFaceRef` to its `../../src` import:
```ts
/** The plate fixture as a job: identity orientation, auto stock with a 5 mm XY margin and no Z margin (program Z 0 = plate top). */
export function plateSetup() {
  const r = importFile('plate-pocket.stl', readFileSync(new URL('./plate-pocket.stl', import.meta.url)));
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
  let job = setModel(createJob(), { sourceName: 'plate-pocket.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry, mesh: r.mesh };
}

/** A face ref whose seed triangle is up-facing at raw height z and contains raw point (x, y). */
export function faceAt(mesh: CamGeometry & { kind: 'mesh' }, x: number, y: number, z: number): MeshFaceRef {
  const { indices, positions, normals } = mesh.mesh;
  for (let t = 0; t < indices.length / 3; t++) {
    if (normals[t * 3 + 2] < 0.99) continue;
    const v = [0, 1, 2].map((k) => indices[t * 3 + k]);
    if (v.some((i) => Math.abs(positions[i * 3 + 2] - z) > 1e-6)) continue;
    const [a, b, c] = v.map((i) => ({ x: positions[i * 3], y: positions[i * 3 + 1] }));
    const s = (p: typeof a, q: typeof a) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return faceRefFromTriangle(mesh.mesh, 'm1', t);
  }
  throw new Error(`no face at ${x},${y},${z}`);
}
```

`packages/core/test/features-mesh.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, type CamGeometry, circleOf, describeGeometry, layFlat, pathArea, resolveFaceRef, resolveGeometry, vec3 } from '../src';
import { faceAt, plateSetup } from './fixtures/camSetup';

describe('mesh faces', () => {
  it('resolves the top face with its outer loop, pocket rim and two round holes', () => {
    const { job, geometry } = plateSetup();
    const ctx = camContext(job, geometry);
    const res = resolveFaceRef(ctx, faceAt(geometry as CamGeometry & { kind: 'mesh' }, 5, 5, 10));
    if (!res.ok) throw new Error(res.message);
    expect(res.face.z).toBeCloseTo(0, 9);
    expect(res.face.loops).toHaveLength(4);
    expect(pathArea(res.face.loops[0])).toBeCloseTo(4000, 3);
    const circles = res.face.loops.slice(1).map((l) => circleOf(l)).filter((c) => c !== null);
    expect(circles).toHaveLength(2);
    for (const c of circles) expect(c!.diameter).toBeCloseTo(8, 2);
    for (const l of res.face.loops.slice(1)) expect(pathArea(l)).toBeLessThan(0);
  });

  it('reports changed, non-horizontal and missing faces', () => {
    const { job, geometry } = plateSetup();
    const ctx = camContext(job, geometry);
    const top = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 5, 5, 10);
    expect(resolveFaceRef(ctx, { ...top, normal: vec3(1, 0, 0) })).toMatchObject({ ok: false, code: 'ref-changed' });
    expect(resolveFaceRef(ctx, { ...top, seed: 1e9 })).toMatchObject({ ok: false, code: 'ref-missing' });
    expect(resolveFaceRef(ctx, { ...top, blobId: 'other' })).toMatchObject({ ok: false, code: 'ref-missing' });
    const tipped = camContext(layFlat(job, vec3(1, 0, 0)), geometry); // the +X side now faces down
    expect(resolveFaceRef(tipped, top)).toMatchObject({ ok: false, code: 'face-not-horizontal' });
  });
});

describe('resolveGeometry', () => {
  it('pocket from a face: outer loop plus islands; profile: outer loop; drill: the face holes', () => {
    const { job, geometry } = plateSetup();
    const floor = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 12, 17, 6);
    let j = applyCommand(job, { type: 'addOperation', opType: 'pocket', toolId: null, id: 'p' });
    j = applyCommand(j, { type: 'updateOperation', id: 'p', patch: { geometry: [floor] } });
    const ctx = camContext(j, geometry);
    const pocket = resolveGeometry(j.operations[0], ctx);
    expect(pocket.diagnostics).toEqual([]);
    expect(pocket.shapes).toHaveLength(1);
    expect(pocket.shapes[0].z).toBeCloseTo(-4, 9);
    expect(pocket.shapes[0].shape.islands).toHaveLength(1);
    j = applyCommand(j, { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' });
    j = applyCommand(j, { type: 'updateOperation', id: 'd', patch: { geometry: [floor, faceAt(geometry as CamGeometry & { kind: 'mesh' }, 5, 5, 10)] } });
    const drill = resolveGeometry(j.operations[1], camContext(j, geometry));
    expect(drill.holes.map((h) => [Math.round(h.diameter), h.through, Math.round(h.bottom)])).toEqual([[6, false, -7], [8, true, -10], [8, true, -10]]);
    expect(drill.holes[0].center.x).toBeCloseTo(30, 2);
    expect(drill.holes[0].center.y).toBeCloseTo(30, 2);
    expect(drill.holes[0].top).toBeCloseTo(-4, 9);
  });

  it('reports broken references per index and keeps the good ones', () => {
    const { job, geometry } = plateSetup();
    const floor = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 12, 17, 6);
    let j = applyCommand(job, { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' });
    j = applyCommand(j, { type: 'updateOperation', id: 'p', patch: { geometry: [{ ...floor, seed: 1e9 }, floor] } });
    const res = resolveGeometry(j.operations[0], camContext(j, geometry));
    expect(res.contours).toHaveLength(1);
    expect(res.diagnostics).toMatchObject([{ severity: 'error', code: 'ref-missing', ref: 0 }]);
  });
});

describe('describeGeometry', () => {
  it('lists up-facing faces top-down and the holes with depths', () => {
    const { job, geometry } = plateSetup();
    const cat = describeGeometry(job, geometry);
    expect(cat.faces.map((f) => Math.round(f.z))).toEqual([0, -4, -7]);
    expect(cat.faces[0].loops.map((l) => l.kind)).toEqual(['outer', 'hole', 'hole', 'hole']);
    // hole loops are fitted as true circles, so the face area is 80·50 − 30·20 − 2·π·4² (flattened at 0.01 mm)
    expect(Math.abs(cat.faces[0].area - (80 * 50 - 30 * 20 - 2 * Math.PI * 16))).toBeLessThan(1);
    expect(cat.holes.map((h) => [Math.round(h.diameter), h.through, Math.round(h.top), Math.round(h.bottom)]).sort()).toEqual(
      [[6, false, -4, -7], [8, true, 0, -10], [8, true, 0, -10]],
    );
    expect(cat.contours).toEqual([]);
  });
});
```

The hole loops are fitted back into true circles (Task 3's `fitArcs`), so the face area uses π·r² for the two Ø8 holes. Flattening at 0.01 mm loses about 0.2 mm² per circle, well inside the 1 mm² allowance.

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/features-mesh.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 4: Implement `cam/features/mesh.ts`**

```ts
import type { Adjacency } from '../../geometry/adjacency';
import { type Mesh, triangleCount, triangleNormal, triangleVertices, vertexAt } from '../../geometry/mesh';
import { fitArcs } from '../../geometry/offset/arcFit';
import { orientPath, polyArea, v2 } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import { planarRegion } from '../../geometry/planarRegion';
import { quatRotate } from '../../geometry/quat';
import { v3dot, vec3 } from '../../geometry/vec3';
import { type CamContext, toProgram } from '../context';
import type { CamCode, MeshFaceRef } from '../types';

const COS_1DEG = Math.cos(Math.PI / 180);

export function faceRefFromTriangle(mesh: Mesh, blobId: string, tri: number): MeshFaceRef {
  const [a, b, c] = triangleVertices(mesh, tri);
  return { kind: 'meshFace', blobId, seed: tri, normal: triangleNormal(mesh, tri), point: vec3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3) };
}

/** Boundary loops of a triangle set as vertex-index cycles; the region is on the left of travel (seen from its normal). */
export function boundaryLoops(mesh: Mesh, adjacency: Adjacency, tris: readonly number[]): number[][] {
  const inRegion = new Set(tris);
  const next = new Map<number, number[]>();
  for (const t of tris) {
    for (let e = 0; e < 3; e++) {
      const nb = adjacency.neighbors[t * 3 + e];
      if (nb >= 0 && inRegion.has(nb)) continue;
      const a = mesh.indices[t * 3 + e];
      const b = mesh.indices[t * 3 + ((e + 1) % 3)];
      const list = next.get(a);
      if (list) list.push(b);
      else next.set(a, [b]);
    }
  }
  const loops: number[][] = [];
  while (next.size) {
    const start = Math.min(...next.keys());
    const loop = [start];
    let v = start;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const list = next.get(v);
      if (!list) break;
      const b = list.pop()!;
      if (!list.length) next.delete(v);
      if (b === start) break;
      loop.push(b);
      v = b;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export interface FaceGeometry {
  tris: number[];
  /** Height of the face in program coordinates. */
  z: number;
  /** Loop 0 = outer (counter-clockwise); the others are holes (clockwise); program coordinates. */
  loops: Path2D[];
}

export function faceGeometry(ctx: CamContext, tris: number[]): FaceGeometry {
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh') throw new Error('No mesh loaded');
  const loops3 = boundaryLoops(g.mesh, g.adjacency, tris).map((loop) => loop.map((vi) => toProgram(ctx, vertexAt(g.mesh, vi))));
  let zSum = 0, n = 0;
  for (const loop of loops3) for (const p of loop) { zSum += p.z; n++; }
  const polys: Vec2[][] = loops3.map((loop) => loop.map((p) => v2(p.x, p.y)));
  const order = polys.map((p, i) => ({ i, area: Math.abs(polyArea(p)) })).sort((a, b) => b.area - a.area).map((o) => o.i);
  const loops = order.map((i, k) => orientPath(fitArcs(polys[i], true, ctx.tolerance), k === 0));
  return { tris, z: n ? zSum / n : 0, loops };
}

/** Checks a face reference against the loaded mesh and the current orientation, then builds its geometry. */
export function resolveFaceRef(ctx: CamContext, ref: MeshFaceRef): { ok: true; face: FaceGeometry } | { ok: false; code: CamCode; message: string } {
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh' || !ctx.job.model || ctx.job.model.blobId !== ref.blobId || !ctx.placement) {
    return { ok: false, code: 'ref-missing', message: 'The model this face belongs to is not loaded' };
  }
  if (!Number.isInteger(ref.seed) || ref.seed < 0 || ref.seed >= triangleCount(g.mesh)) {
    return { ok: false, code: 'ref-missing', message: 'The picked face no longer exists in the model' };
  }
  if (v3dot(triangleNormal(g.mesh, ref.seed), ref.normal) < COS_1DEG) {
    return { ok: false, code: 'ref-changed', message: 'The picked face has changed; pick it again' };
  }
  if (quatRotate(ctx.placement.rotation, ref.normal).z < COS_1DEG) {
    return { ok: false, code: 'face-not-horizontal', message: 'The face is not horizontal and facing up in the current orientation' };
  }
  return { ok: true, face: faceGeometry(ctx, planarRegion(g.mesh, g.adjacency, ref.seed)) };
}

const upFacing = new WeakMap<CamContext, { x: number; y: number; z: number }[]>();

/** Centroids (program coordinates) of all triangles facing up within 1°. */
function upFacingCentroids(ctx: CamContext): { x: number; y: number; z: number }[] {
  const cached = upFacing.get(ctx);
  if (cached) return cached;
  const out: { x: number; y: number; z: number }[] = [];
  const g = ctx.geometry;
  if (g && g.kind === 'mesh' && ctx.placement) {
    for (let t = 0; t < triangleCount(g.mesh); t++) {
      if (quatRotate(ctx.placement.rotation, triangleNormal(g.mesh, t)).z < COS_1DEG) continue;
      const [a, b, c] = triangleVertices(g.mesh, t);
      out.push(toProgram(ctx, vec3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3)));
    }
  }
  upFacing.set(ctx, out);
  return out;
}

/** Bottom of a round hole: the highest up-facing face below its top inside its radius; otherwise a through hole to the model bottom. */
export function holeBottom(ctx: CamContext, center: Vec2, radius: number, top: number): { bottom: number; through: boolean } {
  let best = -Infinity;
  for (const c of upFacingCentroids(ctx)) {
    if (c.z < top - 1e-6 && Math.hypot(c.x - center.x, c.y - center.y) < radius * 0.999 && c.z > best) best = c.z;
  }
  return best > -Infinity ? { bottom: best, through: false } : { bottom: ctx.model?.min.z ?? top, through: true };
}
```

- [ ] **Step 5: Implement `cam/features/resolve.ts`**

```ts
import { orientPath } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import { type CamContext, drawingPathToProgram } from '../context';
import type { CamCode, CamDiagnostic, MeshFaceRef, Operation } from '../types';
import { chainPaths, nestLoops, type Shape } from './chain';
import { circleOf, drawingPath } from './dxf';
import { type FaceGeometry, holeBottom, resolveFaceRef } from './mesh';

export interface ResolvedContour { path: Path2D; z: number; ref: number }
export interface ResolvedShape { shape: Shape; z: number; ref: number }
export interface ResolvedHole { center: Vec2; diameter: number; top: number; bottom: number; through: boolean; ref: number }
export interface ResolvedGeometry {
  contours: ResolvedContour[];
  shapes: ResolvedShape[];
  holes: ResolvedHole[];
  diagnostics: CamDiagnostic[];
  /** Z of any face reference (for the "face" height reference), or null if it does not resolve. */
  faceZ(ref: MeshFaceRef): number | null;
}

const MIN_HOLE_SEGMENTS = 8;

export function resolveGeometry(op: Operation, ctx: CamContext): ResolvedGeometry {
  const out: ResolvedGeometry = {
    contours: [], shapes: [], holes: [], diagnostics: [],
    faceZ: (ref) => {
      const r = resolveFaceRef(ctx, ref);
      return r.ok ? r.face.z : null;
    },
  };
  const fail = (ref: number, code: CamCode, message: string, severity: 'error' | 'warning' = 'error') =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ref });
  const faceCache = new Map<string, ReturnType<typeof resolveFaceRef>>();
  const face = (ref: MeshFaceRef) => {
    const key = `${ref.blobId}:${ref.seed}`;
    if (!faceCache.has(key)) faceCache.set(key, resolveFaceRef(ctx, ref));
    return faceCache.get(key)!;
  };
  const holeFromLoop = (f: FaceGeometry, loop: number, ref: number): boolean => {
    const path = f.loops[loop];
    const c = loop > 0 && path ? circleOf(path) : null;
    if (!c) return false;
    const hb = holeBottom(ctx, c.center, c.diameter / 2, f.z);
    out.holes.push({ center: c.center, diameter: c.diameter, top: f.z, bottom: hb.bottom, through: hb.through, ref });
    return true;
  };

  // DXF references of one operation are chained together
  const dxf: { path: Path2D; ref: number }[] = [];
  const drawingZ = -ctx.origin.z; // a drawing lies at scene Z = 0
  op.geometry.forEach((g, i) => {
    if (g.kind === 'dxfPath') {
      const model = ctx.job.model;
      const geo = ctx.geometry;
      const raw = geo && geo.kind === 'drawing' && model && model.blobId === g.blobId && ctx.placement ? drawingPath(geo.drawing, g.layer, g.path) : null;
      if (!raw) return fail(i, 'ref-missing', 'The picked drawing path no longer exists');
      dxf.push({ path: drawingPathToProgram(ctx, raw), ref: i });
      return;
    }
    const faceRef = g.kind === 'meshFace' ? g : g.face;
    const r = face(faceRef);
    if (!r.ok) return fail(i, r.code, r.message);
    const f = r.face;
    if (g.kind === 'meshFace') {
      if (op.type === 'profile') out.contours.push({ path: f.loops[0], z: f.z, ref: i });
      else if (op.type === 'pocket') out.shapes.push({ shape: { outer: f.loops[0], islands: f.loops.slice(1) }, z: f.z, ref: i });
      else for (let k = 1; k < f.loops.length; k++) holeFromLoop(f, k, i);
      return;
    }
    const path = f.loops[g.loop];
    if (!path) return fail(i, 'ref-missing', 'The picked edge loop no longer exists');
    if (g.kind === 'meshHole' || op.type === 'drill') {
      if (!holeFromLoop(f, g.loop, i)) fail(i, 'ref-changed', 'The picked loop is not a round hole');
      return;
    }
    if (op.type === 'profile') out.contours.push({ path, z: f.z, ref: i });
    else out.shapes.push({ shape: { outer: orientPath(path, true), islands: [] }, z: f.z, ref: i });
  });

  if (dxf.length) {
    const firstRef = dxf[0].ref;
    if (op.type === 'drill') {
      for (const d of dxf) {
        const c = circleOf(d.path);
        if (!c) fail(d.ref, 'no-geometry', 'Only circles can be drilled; this path is skipped', 'warning');
        else out.holes.push({ center: c.center, diameter: c.diameter, top: drawingZ, bottom: ctx.stock?.min.z ?? drawingZ, through: true, ref: d.ref });
      }
    } else {
      const { closed, open } = chainPaths(dxf.map((d) => d.path), ctx.tolerance);
      if (op.type === 'profile') {
        for (const path of closed) out.contours.push({ path, z: drawingZ, ref: firstRef });
        for (const path of open) {
          if (op.side === 'on') out.contours.push({ path, z: drawingZ, ref: firstRef });
          else fail(firstRef, 'open-contour', 'An open chain can only be profiled on the line');
        }
      } else {
        for (const shape of nestLoops(closed, ctx.tolerance)) out.shapes.push({ shape, z: drawingZ, ref: firstRef });
        if (open.length) fail(firstRef, 'open-contour', 'Pockets need closed contours; open chains are skipped');
      }
    }
  }
  return out;
}
```

- [ ] **Step 6: Implement `cam/features/describe.ts`**

```ts
import { pathLength } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import { triangleCount, triangleNormal } from '../../geometry/mesh';
import { planarRegion } from '../../geometry/planarRegion';
import { quatRotate } from '../../geometry/quat';
import type { Job } from '../../job/types';
import { camContext, type CamGeometry, drawingPathToProgram } from '../context';
import type { DxfPathRef, MeshFaceRef, MeshHoleRef } from '../types';
import { circleOf } from './dxf';
import { faceGeometry, faceRefFromTriangle, holeBottom } from './mesh';
import { flattenPath, polyArea } from '../../geometry/offset/pathOps';

export interface CatalogFace {
  ref: MeshFaceRef;
  z: number;
  area: number;
  loops: { index: number; kind: 'outer' | 'hole'; length: number; circle: { center: Vec2; diameter: number } | null }[];
}
export interface CatalogContour {
  ref: DxfPathRef;
  layer: string;
  closed: boolean;
  length: number;
  bbox: { min: Vec2; max: Vec2 };
  circle: { center: Vec2; diameter: number } | null;
}
export interface CatalogHole { ref: MeshHoleRef | DxfPathRef; center: Vec2; diameter: number; top: number; bottom: number; through: boolean }
export interface GeometryCatalog { faces: CatalogFace[]; contours: CatalogContour[]; holes: CatalogHole[] }

const COS_1DEG = Math.cos(Math.PI / 180);

/** Everything pickable, described in program coordinates (spec §8a). */
export function describeGeometry(job: Job, geometry: CamGeometry): GeometryCatalog {
  const ctx = camContext(job, geometry);
  const out: GeometryCatalog = { faces: [], contours: [], holes: [] };
  const model = job.model;
  if (!model || !ctx.placement) return out;
  if (geometry.kind === 'mesh') {
    const visited = new Uint8Array(triangleCount(geometry.mesh));
    for (let t = 0; t < visited.length; t++) {
      if (visited[t] || quatRotate(ctx.placement.rotation, triangleNormal(geometry.mesh, t)).z < COS_1DEG) continue;
      const tris = planarRegion(geometry.mesh, geometry.adjacency, t);
      for (const r of tris) visited[r] = 1;
      const f = faceGeometry(ctx, tris);
      const ref = faceRefFromTriangle(geometry.mesh, model.blobId, t);
      const loops = f.loops.map((l, index) => ({ index, kind: index === 0 ? 'outer' as const : 'hole' as const, length: pathLength(l), circle: index > 0 ? circleOf(l) : null }));
      out.faces.push({ ref, z: f.z, area: f.loops.reduce((a, l) => a + polyArea(flattenPath(l, 0.01)), 0), loops });
      for (const l of loops) {
        if (!l.circle) continue;
        const hb = holeBottom(ctx, l.circle.center, l.circle.diameter / 2, f.z);
        out.holes.push({ ref: { kind: 'meshHole', face: ref, loop: l.index }, center: l.circle.center, diameter: l.circle.diameter, top: f.z, ...hb });
      }
    }
    out.faces.sort((a, b) => b.z - a.z);
  } else {
    const z = -ctx.origin.z;
    geometry.drawing.layers.forEach((layer, li) => {
      layer.paths.forEach((raw, pi) => {
        const path = drawingPathToProgram(ctx, raw);
        const pts = flattenPath(path, 0.01);
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const ref: DxfPathRef = { kind: 'dxfPath', blobId: model.blobId, layer: li, path: pi };
        const circle = circleOf(path);
        out.contours.push({
          ref, layer: layer.name, closed: path.closed, length: pathLength(path), circle,
          bbox: { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } },
        });
        if (circle) out.holes.push({ ref, center: circle.center, diameter: circle.diameter, top: z, bottom: ctx.stock?.min.z ?? z, through: true });
      });
    });
  }
  return out;
}
```
Merge the two `pathOps` imports into one import line.

`index.ts`: append
```ts
export * from './cam/features/mesh';
export * from './cam/features/resolve';
export * from './cam/features/describe';
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/features-mesh.test.ts && pnpm typecheck`
Expected: PASS.
- If the top face's area is off by exactly one hole, the triangulation included a hole as filled. Check that `triangulate` got the holes with the opposite orientation to the outer; the fixture builds them CW. Fix it in the fixture script, not in the test.
- The `drill.holes` order follows the order of the geometry list (the floor first, then the top face's loops in loop order). Keep that order.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): mesh face loops, hole detection, geometry resolution and describeGeometry"
```

---
### Task 6: Heights

**Files:**
- Create: `packages/core/src/cam/heights.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/heights.test.ts`

**Interfaces:**
- Consumes: `CamContext`, `camContext` (Task 4); `Heights`, `HEIGHT_FROM`, `MeshFaceRef` (Task 1); `defaultHeights` (Task 2); `camPartSetup` (test helper, Task 4).
- Produces:
  - `interface ResolvedHeights { clearance: number; retract: number; feed: number; top: number; bottom: number }`
  - `interface HeightInputs { contourZ: number | null; holeBottom: number | null; faceZ?: (ref: MeshFaceRef) => number | null }`
  - `resolveHeights(h: Heights, ctx: CamContext, inputs: HeightInputs): { values: ResolvedHeights | null; errors: string[] }`

- [ ] **Step 1: Write the failing test**

`packages/core/test/heights.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { camContext, createJob, defaultHeights, type Heights, resolveHeights, vec3 } from '../src';
import { camPartSetup } from './fixtures/camSetup';

const none = { contourZ: null, holeBottom: null };

describe('resolveHeights', () => {
  const { job, geometry } = camPartSetup(); // stock top 0, stock bottom −6
  const ctx = camContext(job, geometry);

  it('resolves the profile defaults from the stock', () => {
    expect(resolveHeights(defaultHeights('profile', 'drawing'), ctx, none)).toEqual({
      values: { top: 0, bottom: -6.2, feed: 2, retract: 5, clearance: 15 }, errors: [],
    });
  });

  it('uses the contour Z, hole bottom, picked faces and absolute values', () => {
    const h: Heights = { ...defaultHeights('pocket', 'mesh'), bottom: { from: 'contour', offset: -0.5 } };
    expect(resolveHeights(h, ctx, { contourZ: -2, holeBottom: null }).values?.bottom).toBe(-2.5);
    const d = defaultHeights('drill', 'mesh');
    expect(resolveHeights(d, ctx, { contourZ: 0, holeBottom: -4 }).values?.bottom).toBe(-4);
    const face = { kind: 'meshFace' as const, blobId: 'm', seed: 0, normal: vec3(0, 0, 1), point: vec3(0, 0, 0) };
    const hf: Heights = { ...h, bottom: { from: 'face', offset: 0, face } };
    expect(resolveHeights(hf, ctx, { ...none, faceZ: () => -3 }).values?.bottom).toBe(-3);
    const abs: Heights = { ...h, top: { from: 'origin', offset: 1 }, bottom: { from: 'origin', offset: -1 } };
    expect(resolveHeights(abs, ctx, none).values).toMatchObject({ top: 1, bottom: -1, feed: 3 });
  });

  it('reports invalid combinations and missing references', () => {
    const base = defaultHeights('profile', 'drawing');
    expect(resolveHeights({ ...base, bottom: { from: 'origin', offset: 1 } }, ctx, none).errors).toEqual(['Bottom height must be below top height']);
    expect(resolveHeights({ ...base, top: { from: 'holeBottom', offset: 0 } }, ctx, none).errors[0]).toMatch(/Top height cannot be measured from/);
    expect(resolveHeights({ ...base, retract: { from: 'origin', offset: 0 } }, ctx, none).errors).toEqual(['Retract height must not be below feed height']);
    expect(resolveHeights({ ...base, bottom: { from: 'contour', offset: 0 } }, ctx, none).errors).toEqual(['Bottom height needs a contour']);
    expect(resolveHeights(base, camContext(createJob(), null), none).errors[0]).toBe('Top height needs stock');
    expect(resolveHeights({ ...base, bottom: { from: 'face', offset: 0 } }, ctx, none).errors).toEqual(['Bottom height needs a picked face']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/heights.test.ts`
Expected: FAIL. `resolveHeights` is not exported.

- [ ] **Step 3: Implement `cam/heights.ts`**

```ts
import type { CamContext } from './context';
import { HEIGHT_FROM, type HeightName, type Heights, type HeightSpec, type MeshFaceRef } from './types';

export interface ResolvedHeights { clearance: number; retract: number; feed: number; top: number; bottom: number }
export interface HeightInputs {
  /** Z of the contour, hole top or face being machined. */
  contourZ: number | null;
  holeBottom: number | null;
  faceZ?: (ref: MeshFaceRef) => number | null;
}

const LABEL: Record<HeightName, string> = { clearance: 'Clearance', retract: 'Retract', feed: 'Feed', top: 'Top', bottom: 'Bottom' };
/** Order of evaluation: every height only refers to heights resolved before it. */
const ORDER: readonly HeightName[] = ['top', 'bottom', 'feed', 'retract', 'clearance'];

export function resolveHeights(h: Heights, ctx: CamContext, inputs: HeightInputs): { values: ResolvedHeights | null; errors: string[] } {
  const errors: string[] = [];
  const v: Partial<ResolvedHeights> = {};
  const need = (name: HeightName, what: string): null => {
    errors.push(`${LABEL[name]} height needs ${what}`);
    return null;
  };
  const base = (name: HeightName, spec: HeightSpec): number | null => {
    if (!HEIGHT_FROM[name].includes(spec.from)) {
      errors.push(`${LABEL[name]} height cannot be measured from ${spec.from}`);
      return null;
    }
    switch (spec.from) {
      case 'stockTop': return ctx.stock ? ctx.stock.max.z : need(name, 'stock');
      case 'stockBottom': return ctx.stock ? ctx.stock.min.z : need(name, 'stock');
      case 'modelTop': return ctx.model ? ctx.model.max.z : need(name, 'a model');
      case 'modelBottom': return ctx.model ? ctx.model.min.z : need(name, 'a model');
      case 'contour': return inputs.contourZ ?? need(name, 'a contour');
      case 'face': {
        const z = spec.face && inputs.faceZ ? inputs.faceZ(spec.face) : null;
        return z ?? need(name, 'a picked face');
      }
      case 'origin': return 0;
      case 'holeBottom': return inputs.holeBottom ?? need(name, 'a hole');
      case 'top': return v.top ?? null;
      case 'feed': return v.feed ?? null;
      case 'retract': return v.retract ?? null;
    }
  };
  for (const name of ORDER) {
    const b = base(name, h[name]);
    if (b !== null) v[name] = b + h[name].offset;
  }
  if (errors.length) return { values: null, errors };
  const r = v as ResolvedHeights;
  if (r.bottom >= r.top) errors.push('Bottom height must be below top height');
  if (r.feed < r.top) errors.push('Feed height must not be below top height');
  if (r.retract < r.feed) errors.push('Retract height must not be below feed height');
  if (r.clearance < r.retract) errors.push('Clearance height must not be below retract height');
  return errors.length ? { values: null, errors } : { values: r, errors };
}
```
`index.ts`: append `export * from './cam/heights';`.

Check the expected error text against the test:
- With `retract` from origin + 0 while `feed` = 2, the only failure is retract < feed. Clearance comes from retract + 10 = 10 ≥ 0, so it doesn't fail.
- With no stock, `top` fails first with "Top height needs stock". Retract also fails, but the test only checks `errors[0]`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/heights.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): resolve operation heights from references and offsets"
```

---

### Task 7: Toolpath building blocks — move writer, laps with tabs, helix, ramps, leads, tab placement

**Files:**
- Create: `packages/core/src/cam/ops/writer.ts`, `packages/core/src/cam/ops/leads.ts`, `packages/core/src/cam/ops/tabs.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ops-writer.test.ts`

**Interfaces:**
- Consumes: Task 3 `pathOps` (`pathLength`, `segmentLength`, `subPath`, `segmentPointAt`, `cornerDistances`, `pointAt`); `Move`, `TabSettings` (Task 1).
- Produces:
  - `depthLevels(top: number, bottom: number, stepdown: number): number[]`
  - `class MoveWriter { moves: Move[]; pos: Vec3 | null; rapid(to); line(to, feed); arc(to, center, ccw, feed); cycle(c); up(z); travel(xy, safeZ, downZ); segment(s, z0, z1, feed) }`
  - `interface TabProfile { top: number; base: number; intervals: TabInterval[] }`, `interface TabInterval { s0: number; s1: number; shape: 'rect' | 'triangle' }`
  - `emitLap(w, path, zStart, zEnd, feed, tabs: TabProfile | null): void`
  - `emitRampLaps(w, path, zFrom, zTo, angleDeg, feed, tabs): void`
  - `emitHelix(w, center, radius, zFrom, zTo, angleDeg, feed): void`
  - `leadIn(P, T, freeLeft: boolean, mode, length): Segment[]`, `leadOut(P, T, freeLeft, mode, length): Segment[]`
  - `tabIntervals(path, settings, toolRadius, explicitT: number[] | null): { intervals: (TabInterval & { center: number })[]; skipped: number }`

- [ ] **Step 1: Write the failing test**

`packages/core/test/ops-writer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  depthLevels, emitHelix, emitLap, emitRampLaps, leadIn, leadOut, type Move, MoveWriter, pathFromPoints, pathLength, segmentPointAt,
  type TabSettings, tabIntervals, v2, vec3,
} from '../src';

const square = pathFromPoints([v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)], true); // CCW, length 40
const ends = (moves: Move[]) => moves.map((m) => (m.kind === 'cycle' ? null : [m.kind, +m.to.x.toFixed(3), +m.to.y.toFixed(3), +m.to.z.toFixed(3)]));
const tabs = (o: Partial<TabSettings>): TabSettings => ({ enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, positions: null, ...o });

describe('depthLevels', () => {
  it('splits the depth into equal steps no deeper than the stepdown', () => {
    expect(depthLevels(0, -6, 2)).toEqual([-2, -4, -6]);
    expect(depthLevels(0, -5, 2).map((z) => +z.toFixed(4))).toEqual([-1.6667, -3.3333, -5]);
    expect(depthLevels(0, -6.0000000001, 2)).toHaveLength(3);
    expect(depthLevels(0, 0, 1)).toEqual([]);
    expect(depthLevels(-1, 0, 1)).toEqual([]);
  });
});

describe('MoveWriter', () => {
  it('skips zero-length moves and travels up, across and down', () => {
    const w = new MoveWriter();
    w.travel(v2(5, 5), 10, 2);
    w.rapid(vec3(5, 5, 2));
    w.line(vec3(5, 5, 0), 100);
    w.travel(v2(0, 0), 10, 2);
    expect(ends(w.moves)).toEqual([
      ['rapid', 5, 5, 10], ['rapid', 5, 5, 2], ['line', 5, 5, 0], ['rapid', 5, 5, 10], ['rapid', 0, 0, 10], ['rapid', 0, 0, 2],
    ]);
  });

  it('writes a very short arc as a line so it never becomes a full circle', () => {
    const w = new MoveWriter();
    w.rapid(vec3(1, 0, 0));
    w.segment({ kind: 'arc', center: v2(0, 0), radius: 1, startAngle: 0, sweep: 1e-5 }, 0, 0, 100);
    expect(w.moves[1].kind).toBe('line');
  });
});

describe('emitLap', () => {
  it('follows a closed path at constant Z', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -1));
    emitLap(w, square, -1, -1, 500, null);
    expect(ends(w.moves).slice(1)).toEqual([['line', 10, 0, -1], ['line', 10, 10, -1], ['line', 0, 10, -1], ['line', 0, 0, -1]]);
  });

  it('ramps Z linearly with distance', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, 0));
    emitLap(w, square, 0, -2, 500, null);
    expect(ends(w.moves).slice(1).map((m) => m![3])).toEqual([-0.5, -1, -1.5, -2]);
  });

  it('lifts over rectangular tabs with vertical moves', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -5));
    emitLap(w, square, -5, -5, 500, { top: -3, base: -5, intervals: [{ s0: 5, s1: 8, shape: 'rect' }] });
    expect(ends(w.moves).slice(1, 6)).toEqual([['line', 5, 0, -5], ['line', 5, 0, -3], ['line', 8, 0, -3], ['line', 8, 0, -5], ['line', 10, 0, -5]]);
  });

  it('ramps over triangular tabs', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -5));
    emitLap(w, square, -5, -5, 500, { top: -3, base: -5, intervals: [{ s0: 4, s1: 8, shape: 'triangle' }] });
    expect(ends(w.moves).slice(1, 5)).toEqual([['line', 4, 0, -5], ['line', 6, 0, -3], ['line', 8, 0, -5], ['line', 10, 0, -5]]);
  });

  it('clamps a descending ramp to a tab where it passes below the tab top', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -2));
    // Z goes −2 → −6 over 40 mm, i.e. −0.1/mm; it reaches the tab top −3 at s = 10, inside the tab [8, 14]
    emitLap(w, square, -2, -6, 500, { top: -3, base: -6, intervals: [{ s0: 8, s1: 14, shape: 'rect' }] });
    const zs = ends(w.moves).slice(1).map((m) => m![3]);
    expect(zs.slice(0, 4)).toEqual([-2.8, -3, -3, -3.4]);
  });
});

describe('ramps and helix', () => {
  it('descends over whole laps without exceeding the ramp angle', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, 0));
    emitRampLaps(w, square, 0, -3, 3, 500, null); // 40 mm per lap × tan 3° ≈ 2.1 mm → 2 laps
    const z = ends(w.moves).slice(1).map((m) => m![3]);
    expect(z).toHaveLength(8);
    expect(z[3]).toBe(-1.5);
    expect(z[7]).toBe(-3);
  });

  it('spirals down in half circles and finishes with a full circle at depth', () => {
    const w = new MoveWriter();
    w.rapid(vec3(5, 0, 1));
    emitHelix(w, v2(3, 0), 2, 1, -2, 3, 500); // per rev 2π·2·tan3° ≈ 0.659 → 5 revs → 10 halves, then 2 halves
    expect(w.moves.slice(1).every((m) => m.kind === 'arc' && m.ccw && m.center.x === 3)).toBe(true);
    expect(w.moves).toHaveLength(13);
    const last = w.moves[12];
    expect(last.kind !== 'cycle' && [last.to.x, last.to.z]).toEqual([5, -2]);
  });
});

describe('leads', () => {
  it('builds tangent quarter-arc leads on the free side', () => {
    const P = v2(10, 0), T = v2(1, 0);
    const [inArc] = leadIn(P, T, false, 'arc', 2); // free side on the right (−Y)
    const end = segmentPointAt(inArc, Infinity);
    expect(end.point.x).toBeCloseTo(10, 12);
    expect(end.point.y).toBeCloseTo(0, 12);
    expect(end.tangent.x).toBeCloseTo(1, 12);
    expect(inArc.kind === 'arc' && inArc.center).toEqual({ x: 10, y: -2 });
    const [outArc] = leadOut(P, T, false, 'arc', 2);
    const start = segmentPointAt(outArc, 0);
    expect(start.tangent.x).toBeCloseTo(1, 12);
    expect(leadIn(P, T, true, 'line', 3)).toEqual([{ kind: 'line', from: { x: 10, y: 3 }, to: P }]);
    expect(leadIn(P, T, true, 'none', 3)).toEqual([]);
  });
});

describe('tabIntervals', () => {
  const rect = pathFromPoints([v2(0, 0), v2(100, 0), v2(100, 50), v2(0, 50)], true); // corners at 0, 100, 150, 250

  it('spreads tabs evenly and sizes them by width plus the tool diameter', () => {
    const r = tabIntervals(rect, tabs({ count: 4 }), 3, null);
    expect(r.skipped).toBe(0);
    expect(r.intervals.map((i) => [i.s0, i.s1])).toEqual([[32.5, 42.5], [107.5, 117.5], [182.5, 192.5], [257.5, 267.5]]);
  });

  it('shifts tabs away from sharp corners and skips those that cannot fit', () => {
    // 30 mm square, 8 tabs: centres at 7.5, 22.5, … are 7.5 mm from a corner; a tab needs 5 + 4 = 9 mm → shifted to 9, 21, …
    const shifted = tabIntervals(pathFromPoints([v2(0, 0), v2(30, 0), v2(30, 30), v2(0, 30)], true), tabs({ count: 8 }), 3, null);
    expect(shifted.skipped).toBe(0);
    expect(shifted.intervals.slice(0, 2).map((i) => +i.center.toFixed(6))).toEqual([9, 21]);
    // 16 mm square: an edge is shorter than 2 × 9 mm, so no position works
    const r = tabIntervals(pathFromPoints([v2(0, 0), v2(16, 0), v2(16, 16), v2(0, 16)], true), tabs({ count: 4 }), 3, null);
    expect(r.intervals).toEqual([]);
    expect(r.skipped).toBe(4);
    expect(tabIntervals(square, tabs({ width: 40 }), 3, null)).toEqual({ intervals: [], skipped: 4 });
  });

  it('places explicit positions as given (clamped inside the lap)', () => {
    const r = tabIntervals(rect, tabs({}), 3, [0.5]);
    expect(r.intervals.map((i) => i.center)).toEqual([150]);
    expect(pathLength(rect)).toBe(300);
  });
});
```

Some expected values, checked by hand:
- **Descending ramp over a tab:** the breakpoints are the segment ends (10, 20, 30, 40), the tab (8, 14) and the crossing at s = 10.
  - s = 8: z = −2.8, where the tab starts. At 8⁺, zLin(8) = −2.8 is above −3, so the tab has no effect: max(−2.8, −3) = −2.8, and there's no vertical jump.
  - s = 10: z = −3, the crossing and a segment end.
  - At the tab's end s = 14⁻, z = −3. At 14⁺, zLin = −3.4, so the tool drops vertically to −3.4.

  The first four moves therefore end at z −2.8 (s = 8), −3 (s = 10), −3 (s = 14) and −3.4 (the vertical drop), which is what the test asserts.
- **Helix:** the drop is 3 mm and one revolution descends 0.6585 mm, so it takes ⌈4.556⌉ = 5 revolutions, i.e. 10 half-circle arcs. Two more halves at depth make 12 arcs, and with the initial rapid that's 13 moves. The last arc ends at the start side, x = center.x + r = 5.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-writer.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 3: Implement `cam/ops/writer.ts`**

```ts
import { pathLength, segmentLength, subPath } from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentEnd, type Vec2 } from '../../geometry/path2d';
import type { Vec3 } from '../../geometry/vec3';
import type { Move } from '../types';

const EPS = 1e-9;
/** An arc whose chord is shorter than this is written as a line (a near-zero arc would read as a full circle). */
const MIN_ARC_CHORD = 1e-3;
const p3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const same = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.z - b.z) < EPS;

/** Equal depth levels from just below `top` down to `bottom`, each step no deeper than `stepdown`. */
export function depthLevels(top: number, bottom: number, stepdown: number): number[] {
  const depth = top - bottom;
  if (!(depth > EPS) || !(stepdown > 0)) return [];
  const n = Math.max(1, Math.ceil(depth / stepdown - 1e-9));
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? bottom : top - (depth * (k + 1)) / n));
}

type CycleMove = Extract<Move, { kind: 'cycle' }>;

export class MoveWriter {
  readonly moves: Move[] = [];
  pos: Vec3 | null = null;

  rapid(to: Vec3): void {
    if (this.pos && same(this.pos, to)) return;
    this.moves.push({ kind: 'rapid', to });
    this.pos = to;
  }

  line(to: Vec3, feed: number): void {
    if (this.pos && same(this.pos, to)) return;
    this.moves.push({ kind: 'line', to, feed });
    this.pos = to;
  }

  /** XY arc from the current position; `to` equal to the current XY means a full circle. */
  arc(to: Vec3, center: Vec2, ccw: boolean, feed: number): void {
    this.moves.push({ kind: 'arc', to, center, ccw, feed });
    this.pos = to;
  }

  cycle(c: CycleMove): void {
    this.moves.push(c);
    this.pos = p3(c.at.x, c.at.y, c.retract);
  }

  /** Straight up (rapid) to `z` if the tool is below it. */
  up(z: number): void {
    if (this.pos && this.pos.z < z - EPS) this.rapid(p3(this.pos.x, this.pos.y, z));
  }

  /** Up to `safeZ`, across to `xy`, then rapid down to `downZ`. */
  travel(xy: Vec2, safeZ: number, downZ: number): void {
    if (!this.pos) this.rapid(p3(xy.x, xy.y, safeZ));
    else {
      this.up(safeZ);
      this.rapid(p3(xy.x, xy.y, this.pos.z));
    }
    if (downZ < this.pos!.z - EPS) this.rapid(p3(xy.x, xy.y, downZ));
  }

  /** One path segment from the current position (at the segment start), Z moving linearly from z0 to z1. */
  segment(s: Segment, _z0: number, z1: number, feed: number): void {
    const end = segmentEnd(s);
    const to = p3(end.x, end.y, z1);
    const fullCircle = s.kind === 'arc' && Math.abs(Math.abs(s.sweep) - 2 * Math.PI) < 1e-9;
    if (s.kind === 'line' || (!fullCircle && segmentLength(s) < MIN_ARC_CHORD * 2 && Math.hypot(end.x - (this.pos?.x ?? end.x), end.y - (this.pos?.y ?? end.y)) < MIN_ARC_CHORD)) {
      this.line(to, feed);
    } else {
      this.arc(to, s.center, s.sweep > 0, feed);
    }
  }
}

export interface TabInterval { s0: number; s1: number; shape: 'rect' | 'triangle' }
/** Tabs on one lap: material stays up to `top`; triangles fall to `base` at their ends. */
export interface TabProfile { top: number; base: number; intervals: TabInterval[] }

/**
 * Follows `path` from its start (the tool must be at the path start), with Z moving linearly from zStart to zEnd
 * over the whole length. Tabs raise Z: rectangular tabs with vertical moves, triangular tabs with ramps.
 */
export function emitLap(w: MoveWriter, path: Path2D, zStart: number, zEnd: number, feed: number, tabs: TabProfile | null): void {
  const total = pathLength(path);
  if (total <= EPS) return;
  const intervals = tabs?.intervals ?? [];
  const zLin = (s: number) => zStart + ((zEnd - zStart) * s) / total;
  const tabZ = (s: number, side: -1 | 1): number => {
    let z = -Infinity;
    for (const iv of intervals) {
      if (iv.shape === 'rect') {
        const inside = side < 0 ? s > iv.s0 + EPS && s <= iv.s1 + EPS : s >= iv.s0 - EPS && s < iv.s1 - EPS;
        if (inside) z = Math.max(z, tabs!.top);
      } else if (s >= iv.s0 - EPS && s <= iv.s1 + EPS) {
        const mid = (iv.s0 + iv.s1) / 2;
        const half = (iv.s1 - iv.s0) / 2;
        z = Math.max(z, tabs!.top - ((tabs!.top - tabs!.base) * Math.abs(s - mid)) / half);
      }
    }
    return z;
  };
  const zAt = (s: number, side: -1 | 1) => Math.max(zLin(s), tabZ(s, side));
  const clamp = (s: number) => Math.min(total, Math.max(0, s));

  const marks = new Set<number>([0, total]);
  let acc = 0;
  for (const seg of path.segments) marks.add(clamp((acc += segmentLength(seg))));
  for (const iv of intervals) {
    marks.add(clamp(iv.s0));
    marks.add(clamp(iv.s1));
    if (iv.shape === 'triangle') marks.add(clamp((iv.s0 + iv.s1) / 2));
  }
  let sorted = [...marks].sort((a, b) => a - b);
  const crossings: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b - a < EPS) continue;
    const fa = zLin(a) - tabZ(a, 1), fb = zLin(b) - tabZ(b, -1);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) crossings.push(a + ((b - a) * fa) / (fa - fb));
  }
  sorted = [...new Set([...sorted, ...crossings])].sort((a, b) => a - b);

  const start = w.pos!;
  const z0 = zAt(0, 1);
  if (Math.abs(start.z - z0) > EPS) w.line(p3(start.x, start.y, z0), feed);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b - a < 1e-7) continue;
    const za = zAt(a, 1), zb = zAt(b, -1);
    let s = a;
    for (const seg of subPath(path, a, b)) {
      const len = segmentLength(seg);
      w.segment(seg, za + ((zb - za) * (s - a)) / (b - a), za + ((zb - za) * (s + len - a)) / (b - a), feed);
      s += len;
    }
    const after = zAt(b, 1);
    if (b < total - EPS && Math.abs(after - zb) > EPS) w.line(p3(w.pos!.x, w.pos!.y, after), feed);
  }
}

/** Ramps down along a closed path from zFrom to zTo over whole laps, never steeper than `angleDeg`. */
export function emitRampLaps(w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number, tabs: TabProfile | null): void {
  const total = pathLength(path);
  const drop = zFrom - zTo;
  if (drop <= EPS || total <= EPS) return;
  const perLap = total * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180);
  const laps = Math.max(1, Math.ceil(drop / perLap - 1e-9));
  for (let k = 0; k < laps; k++) emitLap(w, path, zFrom - (drop * k) / laps, zFrom - (drop * (k + 1)) / laps, feed, tabs);
}

/**
 * Helical entry around `c` with radius r (tool centre path), starting at (c.x + r, c.y, zFrom); descends in
 * counter-clockwise half circles no steeper than `angleDeg`, then one full circle at zTo.
 */
export function emitHelix(w: MoveWriter, c: Vec2, r: number, zFrom: number, zTo: number, angleDeg: number, feed: number): void {
  const drop = zFrom - zTo;
  const perRev = 2 * Math.PI * r * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180);
  const halves = Math.max(2, 2 * Math.ceil(drop / Math.max(perRev, 1e-6) - 1e-9));
  for (let k = 1; k <= halves; k++) w.arc(p3(k % 2 === 1 ? c.x - r : c.x + r, c.y, zFrom - (drop * k) / halves), c, true, feed);
  w.arc(p3(c.x - r, c.y, zTo), c, true, feed);
  w.arc(p3(c.x + r, c.y, zTo), c, true, feed);
}
```
The test for the helix counts 13 moves. That's 1 rapid + 10 descending halves + 2 halves at depth.

About the short-arc rule in `segment`: an arc is written as a line when it isn't a full circle and both its length and its chord are under the thresholds (arc length < 0.002 mm, chord < 0.001 mm). The test's arc has length 1e-5 and chord 1e-5, so it becomes a line.

- [ ] **Step 4: Implement `cam/ops/leads.ts`**

```ts
import type { Segment, Vec2 } from '../../geometry/path2d';
import type { LeadSettings } from '../types';

const left = (t: Vec2): Vec2 => ({ x: -t.y, y: t.x });

/**
 * Lead-in ending at P, arriving along the unit tangent T. `freeLeft` = the free (waste) side is to the left of travel.
 * Arc: a quarter circle of radius `length`, tangent to the path at P. Line: straight in from `length` away on the free side.
 */
export function leadIn(P: Vec2, T: Vec2, freeLeft: boolean, mode: LeadSettings['mode'], length: number): Segment[] {
  if (mode === 'none' || !(length > 0)) return [];
  const n = freeLeft ? left(T) : { x: -left(T).x, y: -left(T).y };
  if (mode === 'line') return [{ kind: 'line', from: { x: P.x + n.x * length, y: P.y + n.y * length }, to: P }];
  const c = { x: P.x + n.x * length, y: P.y + n.y * length };
  const startAngle = Math.atan2(-T.y, -T.x); // the start point is c − T·R
  return [{ kind: 'arc', center: c, radius: length, startAngle, sweep: freeLeft ? Math.PI / 2 : -Math.PI / 2 }];
}

/** Lead-out starting at P, leaving along T, turning away to the free side. */
export function leadOut(P: Vec2, T: Vec2, freeLeft: boolean, mode: LeadSettings['mode'], length: number): Segment[] {
  if (mode === 'none' || !(length > 0)) return [];
  const n = freeLeft ? left(T) : { x: -left(T).x, y: -left(T).y };
  if (mode === 'line') return [{ kind: 'line', from: P, to: { x: P.x + n.x * length, y: P.y + n.y * length } }];
  const c = { x: P.x + n.x * length, y: P.y + n.y * length };
  const startAngle = Math.atan2(-n.y, -n.x); // P = c − n·R
  return [{ kind: 'arc', center: c, radius: length, startAngle, sweep: freeLeft ? Math.PI / 2 : -Math.PI / 2 }];
}
```

Check the lead-in arc with P = (10, 0), T = (1, 0) and the free side on the right (freeLeft = false):
- n = −left(T) = −(0, 1) = (0, −1), so c = (10, −2).
- The arc starts at c − T·R = (8, −2), i.e. at angle atan2(0, −1) = π, and sweeps −π/2 (clockwise).
- It ends at angle π/2, which is (10, 0) = P. The clockwise tangent there is (sin a, −cos a) = (1, 0) = T.

- [ ] **Step 5: Implement `cam/ops/tabs.ts`**

```ts
import { cornerDistances, pathLength } from '../../geometry/offset/pathOps';
import type { Path2D } from '../../geometry/path2d';
import type { TabSettings } from '../types';
import type { TabInterval } from './writer';

/**
 * Tab intervals along a closed tool-centre lap. Each covers the tab width plus the tool diameter.
 * Automatic tabs keep at least one tab width between their edges and any corner sharper than 30°, shifting
 * by up to half their spacing; tabs that cannot be placed are counted as skipped. Explicit positions (fractions of
 * the lap) are placed as given, clamped inside the lap.
 */
export function tabIntervals(
  path: Path2D, t: TabSettings, toolRadius: number, explicitT: number[] | null,
): { intervals: (TabInterval & { center: number })[]; skipped: number } {
  const total = pathLength(path);
  const half = t.width / 2 + toolRadius;
  const n = explicitT ? explicitT.length : t.placement === 'count' ? Math.max(1, Math.round(t.count)) : Math.max(1, Math.floor(total / t.spacing));
  if (!(total > 0) || 2 * half >= total) return { intervals: [], skipped: n };
  const make = (center: number) => ({ s0: center - half, s1: center + half, center, shape: t.shape });
  if (explicitT) {
    return { intervals: explicitT.map((f) => make(Math.min(total - half, Math.max(half, f * total)))), skipped: 0 };
  }
  const corners = path.closed ? cornerDistances(path, 30) : [];
  const cyc = (a: number, b: number) => { const d = Math.abs(a - b) % total; return Math.min(d, total - d); };
  const fits = (c: number) => c - half >= 0 && c + half <= total && corners.every((k) => cyc(k, c) >= half + t.width - 1e-9);
  const intervals: (TabInterval & { center: number })[] = [];
  let skipped = 0;
  const step = total / (n * 40);
  for (let i = 0; i < n; i++) {
    const base = ((i + 0.5) * total) / n;
    let placed: number | null = null;
    for (let j = 0; j <= 20 && placed === null; j++) {
      for (const c of j === 0 ? [base] : [base + j * step, base - j * step]) if (placed === null && fits(c)) placed = c;
    }
    if (placed === null) skipped++;
    else intervals.push(make(placed));
  }
  return { intervals, skipped };
}
```
Check against the tests:
- On the 300 mm rectangle with 4 tabs and the tool radius 3: half = 2 + 3 = 5, and the centres fall at 37.5, 112.5, 187.5 and 262.5.
- Corner distances: 262.5 is 12.5 from the corner at 250, 112.5 is 12.5 from 100, and 187.5 is 37.5 from 150. Each needs ≥ 9, so all four fit.
- The 30 × 30 square with 8 tabs has centres every 15 mm starting at 7.5, so each centre is 7.5 mm from a corner. Shifts go in steps of 0.375 mm: 7.5 + 4 × 0.375 = 9 fits, and so does 22.5 − 1.5 = 21.
- On the 16 × 16 square, any centre on an edge is less than 9 mm from one of its two corners, so all 4 tabs are skipped.

- With `width: 40` on the 40 mm square, half = 23 and 46 ≥ 40, so the result is `{ intervals: [], skipped: 4 }`.

`index.ts`: append
```ts
export * from './cam/ops/writer';
export * from './cam/ops/leads';
export * from './cam/ops/tabs';
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-writer.test.ts && pnpm typecheck`
Expected: PASS. `noUnusedParameters` accepts `_z0` in `segment` because of the underscore prefix. If the helix count is off by 2, check `halves` against the comment in Step 3; do not change the test.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): move writer, laps with tabs, ramps, helix entry, leads and tab placement"
```

---
### Task 8: Profile operation

**Files:**
- Create: `packages/core/src/cam/ops/output.ts`, `packages/core/src/cam/ops/profile.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/test/fixtures/camSetup.ts` (add `tool6`, `geoOf`, `cutMoves`)
- Test: `packages/core/test/ops-profile.test.ts`

**Interfaces:**
- Consumes:
  - Task 7: `MoveWriter`, `depthLevels`, `emitLap`, `emitRampLaps`, `leadIn`, `leadOut`, `tabIntervals`, `TabProfile`
  - Task 6: `resolveHeights`, `ResolvedHeights`
  - Task 5: `ResolvedGeometry`, `ResolvedContour`
  - Task 3: `offsetPolys`, `fitArcs`, `pathOps`
- Produces:
  - `output.ts`:
    - `interface OpOverlays { tabs: { refIndex: number; t: number; point: Vec2 }[]; laps: { refIndex: number; points: Vec2[]; z: number }[]; unmachined: { polys: Vec2[][]; z: number }[] }`
    - `interface OpOutput { toolpath: Toolpath | null; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; overlays: OpOverlays }`
    - `emptyOverlays()`
  - `profile.ts`: `profileToolpath(op: ProfileOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`
  - Tab `refIndex` is the running index of tool-centre laps within the operation (0, 1, …), in the order they are cut.

Profile rules (spec §6, and plan clarification 5):

**Tool-centre path**
- A closed contour with side `outside` or `inside` is offset by `r + stockRadial`, outward or inward. The offset can collapse (error `offset-collapsed`) or split, in which case each piece is a separate lap.
- `on` and open contours use the contour itself.

**Direction and sides**
- A closed lap runs clockwise when `(side !== 'inside') === (direction === 'climb')`, and counter-clockwise otherwise.
- The free (waste) side is outside the loop for `outside` and `on`, and inside it for `inside`.

**Start point**
- `auto`: the midpoint of the longest line segment, or, with no lines, the midpoint of the longest arc.
- Explicit: `t × length` of the lap whose `refIndex` matches.

**Per depth level** (closed laps): the tool sits at the lead start S (or at P, the lap start, when there is no lead), at the previous level (`feed` height for the first level).
- `plunge`: plunge vertically at S to the level with `plungeFeed`, then follow the lead-in at the level.
- `auto` / `ramp` / `helix`: if lead-in length × tan(rampAngle) ≥ the drop, descend along the lead-in. Otherwise follow the lead-in flat, then use `emitRampLaps` along the lap.
- Then one flat lap at the level (with tabs), then the lead-out.
- If another level follows, the tool goes back from the lead-out end to S at the same Z.

**Open laps**
- They plunge at the start and alternate direction on each level.
- They produce warning `entry-plunge` once per operation unless the mode is `plunge`.

**Tabs** (closed laps only, when `tabs.enabled`)
- `tabTop = bottom + tabs.height`.
- Tabs apply on every level whose Z is below `tabTop`, including the ramp laps down to it.
- Tabs that couldn't be placed produce warning `tab-skipped`.

**Depths and finish pass**
- Roughing levels = `depthLevels(top, bottom + stockAxial, stepdown)`.
- `finishPass` adds, after the roughing of each contour, laps at `bottom` along the path offset by `r` (stock 0). These laps are entered from feed height like the first level.

**Travel and retract**
- The first travel of the operation is at clearance height, later travels at retract height. The tool always descends to feed height before entering.
- After each contour the tool goes up to retract; at the end of the operation, up to clearance.

- [ ] **Step 1: Extend the shared test setup**

Append to `packages/core/test/fixtures/camSetup.ts`, merging `type CutMove`'s needs into the existing `../../src` import (add `type Move`, `type Path2D`, `type ResolvedGeometry`, `type Tool`):
```ts
export const tool6: Tool = {
  id: 't6', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, stepdown: 3, stepoverPct: 45, coolant: 'off' }],
};

/** A ResolvedGeometry built by hand (contours, shapes or holes in program coordinates). */
export function geoOf(parts: Partial<Pick<ResolvedGeometry, 'contours' | 'shapes' | 'holes'>>): ResolvedGeometry {
  return { contours: [], shapes: [], holes: [], diagnostics: [], faceZ: () => null, ...parts };
}

export type CutMove = Extract<Move, { kind: 'line' | 'arc' }>;
/** Feed moves (lines and arcs) of a move list. */
export const cutMoves = (moves: readonly Move[]): CutMove[] => moves.filter((m): m is CutMove => m.kind === 'line' || m.kind === 'arc');

/** Rectangle contour in program coordinates, counter-clockwise. */
export function rectPath(x0: number, y0: number, x1: number, y1: number): Path2D {
  const p = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return { closed: true, segments: p.map((from, i) => ({ kind: 'line' as const, from, to: p[(i + 1) % 4] })) };
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/ops-profile.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommand, camContext, newOperation, polyArea, type ProfileOp, profileToolpath, type ResolvedContour, v2,
} from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup(); // stock top 0, bottom −6; program X 0–110, Y 0–70
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: tool6 }), geometry);
const outline: ResolvedContour = { path: rectPath(5, 5, 105, 65), z: 0, ref: 0 };
const profile = (patch: Partial<ProfileOp> = {}): ProfileOp =>
  ({ ...(newOperation('profile', { id: 'p', name: 'Profile', tool: tool6, modelKind: 'drawing' }) as ProfileOp), ...patch });
const zs = (moves: ReturnType<typeof cutMoves>) => [...new Set(moves.map((m) => +m.to.z.toFixed(4)))];

describe('profileToolpath', () => {
  it('cuts outside the contour, offset by the tool radius, in depth levels, climb = clockwise', () => {
    const noLeads = { mode: 'none' as const, length: 0, startPoint: 'auto' as const };
    const out = profileToolpath(profile({ leads: noLeads }), tool6, ctx, geoOf({ contours: [outline] }));
    expect(out.diagnostics).toEqual([]);
    const tp = out.toolpath!;
    expect(tp.moves[0]).toEqual({ kind: 'rapid', to: { x: expect.any(Number), y: expect.any(Number), z: 15 } });
    expect(tp.moves.at(-1)!.kind === 'rapid' && tp.moves.at(-1)!.to.z).toBe(15);
    expect(tp.clearance).toBe(15);
    const bottom = cutMoves(tp.moves).filter((m) => Math.abs(m.to.z + 6.2) < 1e-9);
    const xs = bottom.map((m) => m.to.x), ys = bottom.map((m) => m.to.y);
    expect(Math.max(...xs)).toBeCloseTo(108, 6);
    expect(Math.min(...ys)).toBeCloseTo(2, 6);
    expect(Math.min(...cutMoves(tp.moves).map((m) => m.to.z))).toBeCloseTo(-6.2, 9);
    // the flat bottom lap runs clockwise
    const lap = bottom.filter((m) => m.kind === 'line').map((m) => v2(m.to.x, m.to.y));
    expect(polyArea(lap)).toBeLessThan(0);
    expect(out.heights).toEqual({ top: 0, bottom: -6.2, feed: 2, retract: 5, clearance: 15 });
  });

  it('goes counter-clockwise for conventional milling and cuts inside for side "inside"', () => {
    const conv = profileToolpath(profile({ direction: 'conventional' }), tool6, ctx, geoOf({ contours: [outline] })).toolpath!;
    const lap = cutMoves(conv.moves).filter((m) => m.kind === 'line' && Math.abs(m.to.z + 6.2) < 1e-9).map((m) => v2(m.to.x, m.to.y));
    expect(polyArea(lap)).toBeGreaterThan(0);
    const inside = profileToolpath(profile({ side: 'inside', leads: { mode: 'none', length: 0, startPoint: 'auto' } }), tool6, ctx,
      geoOf({ contours: [{ path: rectPath(35, 25, 75, 45), z: 0, ref: 0 }] })).toolpath!;
    const xs = cutMoves(inside.moves).map((m) => m.to.x);
    expect(Math.min(...xs)).toBeCloseTo(38, 6);
    expect(Math.max(...xs)).toBeCloseTo(72, 6);
  });

  it('reports a collapsed inside offset', () => {
    const out = profileToolpath(profile({ side: 'inside' }), tool6, ctx, geoOf({ contours: [{ path: rectPath(0, 0, 5, 5), z: 0, ref: 3 }] }));
    expect(out.toolpath).toBeNull();
    expect(out.diagnostics).toMatchObject([{ severity: 'error', code: 'offset-collapsed', ref: 3 }]);
  });

  it('leaves radial and axial stock, then finishes at full size', () => {
    const out = profileToolpath(profile({ stockRadial: 0.5, stockAxial: 0.3, finishPass: true }), tool6, ctx, geoOf({ contours: [outline] }));
    const cuts = cutMoves(out.toolpath!.moves);
    const rough = cuts.filter((m) => Math.abs(m.to.z + 5.9) < 1e-9);
    expect(Math.max(...rough.map((m) => m.to.x))).toBeCloseTo(108.5, 6);
    const finish = cuts.filter((m) => Math.abs(m.to.z + 6.2) < 1e-9);
    expect(Math.max(...finish.map((m) => m.to.x))).toBeCloseTo(108, 6);
    expect(zs(cuts)).toEqual(expect.arrayContaining([-2.95, -5.9, -6.2]));
  });

  it('raises the path over tabs on levels below the tab top', () => {
    const op = profile({ tabs: { enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, positions: null } });
    const out = profileToolpath(op, tool6, ctx, geoOf({ contours: [outline] }));
    expect(out.diagnostics).toEqual([]);
    const atTabTop = cutMoves(out.toolpath!.moves).filter((m) => Math.abs(m.to.z + 4.2) < 1e-9);
    expect(atTabTop.length).toBeGreaterThanOrEqual(8); // up + across, for each of 4 tabs on the last level
    expect(out.overlays.tabs).toHaveLength(4);
    expect(out.overlays.laps).toMatchObject([{ refIndex: 0, z: -4.2 }]);
  });

  it('profiles open chains on the line with plunges and a warning', () => {
    const open = { closed: false, segments: [{ kind: 'line' as const, from: v2(10, 10), to: v2(50, 10) }] };
    const out = profileToolpath(profile({ side: 'on' }), tool6, ctx, geoOf({ contours: [{ path: open, z: 0, ref: 0 }] }));
    expect(out.diagnostics.map((d) => d.code)).toEqual(['entry-plunge']);
    const cuts = cutMoves(out.toolpath!.moves).filter((m) => m.kind === 'line' && m.to.y === 10 && m.to.z < 0);
    expect(cuts.map((m) => m.to.x)).toContain(50);
    expect(cuts.map((m) => m.to.x)).toContain(10);
  });

  it('descends along the lead-in when it is long enough', () => {
    const base = profile().heights;
    // feed height 0.04 above the top: the first drop is 0.24 mm ≤ lead-in length 4.712 × tan 3° = 0.2469 mm
    const op = profile({ stepdown: 0.2, heights: { ...base, feed: { from: 'top', offset: 0.04 }, bottom: { from: 'stockTop', offset: -0.2 } } });
    const tp = profileToolpath(op, tool6, ctx, geoOf({ contours: [outline] })).toolpath!;
    // lead-in quarter arc: length π/2 × 3 ≈ 4.71 mm × tan 3° ≈ 0.247 ≥ drop 0.2 → the first descending move is the lead-in arc
    const firstDown = cutMoves(tp.moves).find((m) => m.to.z < 0)!;
    expect(firstDown.kind).toBe('arc');
  });
});
```

Some expected values, checked by hand:
- **Depth levels.** Top 0, bottom −6.2, stepdown 3 give ⌈6.2 / 3⌉ = 3 levels: −2.0667, −4.1333 and −6.2. With `stockAxial` 0.3 the roughing bottom is −5.9, which needs ⌈5.9 / 3⌉ = 2 levels: −2.95 and −5.9. The finish pass then cuts at −6.2.
- **No leads in the first test.** The first test turns leads off, so every move at −6.2 lies on the tool-centre lap (x 2–108, y 2–68). With leads on, the quarter-arc leads reach 3 mm further out.
- **Tabs.** The tab top is −6.2 + 2 = −4.2. Only the last level (−6.2) and its ramp lap are below it; −4.1333 is above.

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-profile.test.ts`
Expected: FAIL. `profileToolpath` is not exported.

- [ ] **Step 4: Implement `cam/ops/output.ts`**

```ts
import type { Vec2 } from '../../geometry/path2d';
import type { ResolvedHeights } from '../heights';
import type { CamDiagnostic, Toolpath } from '../types';

export interface OpOverlays {
  /** Tab centres: lap index, fraction of the lap and program XY. */
  tabs: { refIndex: number; t: number; point: Vec2 }[];
  /** Tool-centre laps (flattened) that carry tabs, at the tab top Z, for dragging tabs. */
  laps: { refIndex: number; points: Vec2[]; z: number }[];
  /** Pocket material the tool cannot reach, at the pocket floor. */
  unmachined: { polys: Vec2[][]; z: number }[];
}

export interface OpOutput {
  toolpath: Toolpath | null;
  diagnostics: CamDiagnostic[];
  /** Heights of the first feature (for the heights planes in the viewport). */
  heights: ResolvedHeights | null;
  overlays: OpOverlays;
}

export const emptyOverlays = (): OpOverlays => ({ tabs: [], laps: [], unmachined: [] });
```

- [ ] **Step 5: Implement `cam/ops/profile.ts`**

```ts
import { fitArcs } from '../../geometry/offset/arcFit';
import { offsetPolys } from '../../geometry/offset/clipper';
import {
  flattenPath, orientPath, pathLength, pathStart, pointAt, polyArea, reversePath, rotateStart, segmentLength,
} from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentStart } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, ProfileOp } from '../types';
import { leadIn, leadOut } from './leads';
import { emptyOverlays, type OpOutput } from './output';
import { tabIntervals } from './tabs';
import { depthLevels, emitLap, emitRampLaps, MoveWriter, type TabProfile } from './writer';

/** Tool-centre laps of a contour: offset outward/inward by `offset`, or the contour itself for "on" and open paths. */
function centreLaps(path: Path2D, side: ProfileOp['side'], offset: number, tol: number): Path2D[] | null {
  if (!path.closed || side === 'on' || offset === 0) return [path];
  const poly = flattenPath(orientPath(path, true), tol);
  const res = offsetPolys([poly], side === 'outside' ? offset : -offset, tol).filter((p) => polyArea(p) > 0);
  return res.length ? res.map((p) => fitArcs(p, true, tol)) : null;
}

/** Midpoint of the longest line segment, else of the longest arc. */
function autoStart(path: Path2D): number {
  let best = 0, bestLen = -1, bestIsLine = false, acc = 0;
  for (const s of path.segments) {
    const len = segmentLength(s);
    const isLine = s.kind === 'line';
    if ((isLine && !bestIsLine) || (isLine === bestIsLine && len > bestLen)) {
      best = acc + len / 2;
      bestLen = len;
      bestIsLine = isLine;
    }
    acc += len;
  }
  return best;
}

export function profileToolpath(op: ProfileOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const tol = ctx.tolerance;
  const r = tool.diameter / 2;
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const tanA = Math.tan((Math.max(0.1, angle) * Math.PI) / 180);
  const w = new MoveWriter();
  let clearance = -Infinity;
  let lapIndex = 0;
  let plungeWarned = false;

  const emitSegs = (segs: Segment[], z0: number, z1: number) => {
    const total = segs.reduce((a, s) => a + segmentLength(s), 0);
    let acc = 0;
    for (const s of segs) {
      const len = segmentLength(s);
      w.segment(s, z0 + ((z1 - z0) * acc) / total, z0 + ((z1 - z0) * (acc + len)) / total, feed);
      acc += len;
    }
  };

  /** Cuts one closed lap at the given levels; the tool travels to it first. */
  const cutClosed = (lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean) => {
    const index = lapIndex++;
    const wantCW = (op.side !== 'inside') === (op.direction === 'climb');
    let path = orientPath(lap, !wantCW);
    const total = pathLength(path);
    const explicitStart = op.leads.startPoint !== 'auto' && op.leads.startPoint.refIndex === index ? op.leads.startPoint.t * total : null;
    path = rotateStart(path, explicitStart ?? autoStart(path));
    const P = pathStart(path);
    const T = pointAt(path, 0).tangent;
    const freeLeft = op.side === 'inside' ? !wantCW : wantCW; // CW loop: outside is on the left
    const inSegs = leadIn(P, T, freeLeft, op.leads.mode, op.leads.length);
    const outSegs = leadOut(P, T, freeLeft, op.leads.mode, op.leads.length);
    const S = inSegs.length ? segmentStart(inSegs[0]) : P;
    const inLen = inSegs.reduce((a, s) => a + segmentLength(s), 0);

    let tabsAt: (z: number) => TabProfile | null = () => null;
    if (op.tabs.enabled) {
      const explicit = op.tabs.positions ? op.tabs.positions.filter((p) => p.refIndex === index).map((p) => p.t) : null;
      const { intervals, skipped } = tabIntervals(path, op.tabs, r, explicit);
      if (skipped) diag('warning', 'tab-skipped', `${skipped} tab(s) did not fit and were skipped`);
      const top = h.bottom + op.tabs.height;
      const profile: TabProfile = { top, base: h.bottom, intervals };
      tabsAt = (z) => (intervals.length && z < top - 1e-9 ? profile : null);
      for (const iv of intervals) out.overlays.tabs.push({ refIndex: index, t: iv.center / total, point: pointAt(path, iv.center).point });
      if (intervals.length || op.tabs.positions) out.overlays.laps.push({ refIndex: index, points: flattenPath(path, 0.01), z: top });
    }

    w.travel(S, first ? h.clearance : h.retract, h.feed);
    let prev = h.feed;
    levels.forEach((z, i) => {
      const drop = prev - z;
      if (op.entry.mode === 'plunge') {
        w.line({ x: S.x, y: S.y, z }, plunge);
        emitSegs(inSegs, z, z);
      } else if (inSegs.length && inLen * tanA >= drop - 1e-9) {
        emitSegs(inSegs, prev, z);
      } else {
        emitSegs(inSegs, prev, prev);
        emitRampLaps(w, path, prev, z, angle, feed, tabsAt(z));
      }
      emitLap(w, path, z, z, feed, tabsAt(z));
      emitSegs(outSegs, z, z);
      if (i < levels.length - 1 && inSegs.length) w.line({ x: S.x, y: S.y, z }, feed);
      prev = z;
    });
    w.up(h.retract);
  };

  const cutOpen = (lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean) => {
    lapIndex++;
    if (op.entry.mode !== 'plunge' && !plungeWarned) {
      diag('warning', 'entry-plunge', 'Open contours are entered with a plunge');
      plungeWarned = true;
    }
    let path = lap;
    w.travel(pathStart(path), first ? h.clearance : h.retract, h.feed);
    for (const z of levels) {
      w.line({ x: w.pos!.x, y: w.pos!.y, z }, plunge);
      emitLap(w, path, z, z, feed, null);
      path = reversePath(path);
    }
    w.up(h.retract);
  };

  let first = true;
  geo.contours.forEach((c) => {
    const hr = resolveHeights(op.heights, ctx, { contourZ: c.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, c.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const laps = centreLaps(c.path, op.side, r + op.stockRadial, tol);
    if (!laps) return diag('error', 'offset-collapsed', 'The tool does not fit inside this contour', c.ref);
    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    for (const lap of laps) {
      (lap.closed ? cutClosed : cutOpen)(lap, levels, h, first);
      first = false;
    }
    if (op.finishPass && c.path.closed) {
      for (const lap of centreLaps(c.path, op.side, r, tol) ?? []) cutClosed(lap, [h.bottom], h, false);
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
```

Check the lead direction for an outside, climb (clockwise) lap. For a clockwise loop the interior is on the right, so outside is on the left: `freeLeft = wantCW = true`, and the lead-in arcs in from outside. For `inside` + climb the loop is counter-clockwise, the interior is on the left, and the free side is the interior: `freeLeft = !wantCW = true`.

`index.ts`: append `export * from './cam/ops/output';` and `export * from './cam/ops/profile';`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-profile.test.ts && pnpm typecheck`
Expected: PASS.

If "goes counter-clockwise for conventional" fails on its sign, check `orientPath(lap, !wantCW)`: `orientPath(p, true)` means counter-clockwise.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): profile toolpaths with leads, ramps, tabs, stock to leave and finish pass"
```

---

### Task 9: Pocket operation (offset clearing)

**Files:**
- Create: `packages/core/src/cam/ops/pocket.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ops-pocket.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 3 and 5–8: `offsetPolys`, `polysToRegions`, `regionPolys`, `pointInPolys`, `segmentInside`, `sweepPolylines`, `differencePolys`, `fitArcs`, `pathOps`, `resolveHeights`, `MoveWriter`, `depthLevels`, `emitLap`, `emitRampLaps`, `emitHelix`, `OpOutput`, `emptyOverlays`
- Produces: `pocketToolpath(op: PocketOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`

Pocket rules (spec §6):

**Region and rings**
- The region is the outer loop (CCW) plus the islands (CW).
- Ring level k is `offsetPolys(region, -(r + stockRadial + k·stepover))`, for k = 0, 1, … until it is empty, where stepover = diameter × stepoverPct / 100.
- An empty level 0 gives error `offset-collapsed`.
- Level 0, split with `polysToRegions`, gives the **areas**. Each ring polygon belongs to the area that contains its first vertex.

**Ring direction**
- Climb: outer rings (positive area) counter-clockwise, hole rings clockwise. Conventional: the reverse.
- Ring polygons go through `fitArcs`.

**Order of cutting**
- Area by area. Within an area, every depth level, and within a level, rings from innermost (highest k) to outermost.
- Each ring starts at its point nearest the tool.
- Rings are linked by a straight feed move when `segmentInside(from, to, area polys)`. Otherwise the tool goes up to 1 mm above the previous level, travels across, and plunges down.

**Entry per area and level** (the tool starts at feed height for the first level, else 1 mm above the previous level)
- `auto` / `helix`: helix radius rh = diameter × helixDiameterPct / 200.
  - The centre is the innermost ring's start point if it lies in `offsetPolys(area, -rh)`. Otherwise it is the nearest vertex of that inner region.
  - If that inner region is empty (the helix doesn't fit), both `auto` and `helix` fall back to a ramp along the innermost ring, without a warning.
- `ramp`: `emitRampLaps` along the innermost ring.
- `plunge`: plunge at the innermost ring start, without a warning, because the user chose it. `auto` and `helix` never plunge (a ramp along a ring is always possible), so pockets never raise `entry-plunge`.

**Unmachined material**
- target = `offsetPolys(region, -stockRadial)` (or the region itself when stockRadial = 0), minus `sweepPolylines(all rings, r)`.
- Keep each remaining region whose `offsetPolys(regionPolys, -0.025)` is non-empty. Any kept region produces one warning `unmachined-area` per shape, and the kept polygons go into `overlays.unmachined` at the floor Z.

**Finishing**
- `finishWalls`: after roughing, laps at `bottom` along `offsetPolys(region, -r)` (stock 0), each entered by ramp laps from feed height.
- `finishFloor` with `stockAxial > 0`: the ring sequence again at `bottom`.
- The tool goes up to retract after each area and each finishing pass, and up to clearance at the end.

- [ ] **Step 1: Write the failing test**

`packages/core/test/ops-pocket.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, newOperation, type PocketOp, pocketToolpath, type ResolvedShape, v2 } from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup();
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: tool6 }), geometry);
const circle = (cx: number, cy: number, r: number) => ({
  closed: true, segments: [{ kind: 'arc' as const, center: v2(cx, cy), radius: r, startAngle: 0, sweep: -2 * Math.PI }],
});
const withIsland: ResolvedShape = { shape: { outer: rectPath(35, 25, 75, 45), islands: [circle(55, 35, 4)] }, z: 0, ref: 0 };
const ccwCircle = (cx: number, cy: number, r: number) => ({
  closed: true, segments: [{ kind: 'arc' as const, center: v2(cx, cy), radius: r, startAngle: 0, sweep: 2 * Math.PI }],
});
const pocket = (patch: Partial<PocketOp> = {}): PocketOp =>
  ({ ...(newOperation('pocket', { id: 'k', name: 'Pocket', tool: tool6, modelKind: 'drawing' }) as PocketOp), ...patch });

describe('pocketToolpath', () => {
  it('keeps the tool centre inside the pocket and clear of the island', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [withIsland] }));
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    for (const m of cutMoves(out.toolpath!.moves)) {
      expect(m.to.x).toBeGreaterThanOrEqual(38 - 1e-6);
      expect(m.to.x).toBeLessThanOrEqual(72 + 1e-6);
      expect(m.to.y).toBeGreaterThanOrEqual(28 - 1e-6);
      expect(m.to.y).toBeLessThanOrEqual(42 + 1e-6);
      expect(Math.hypot(m.to.x - 55, m.to.y - 35)).toBeGreaterThanOrEqual(7 - 1e-3);
    }
    expect(Math.min(...cutMoves(out.toolpath!.moves).map((m) => m.to.z))).toBeCloseTo(-3, 9);
  });

  it('enters with a helix and warns about the four square corners it cannot reach', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [withIsland] }));
    const firstCut = cutMoves(out.toolpath!.moves)[0];
    expect(firstCut.kind).toBe('arc');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['unmachined-area']);
    expect(out.overlays.unmachined).toHaveLength(1);
    expect(out.overlays.unmachined[0].polys).toHaveLength(4);
    expect(out.overlays.unmachined[0].z).toBe(-3);
  });

  it('clears a round pocket with no unmachined warning', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [{ shape: { outer: ccwCircle(55, 35, 15), islands: [] }, z: 0, ref: 0 }] }));
    expect(out.diagnostics).toEqual([]);
  });

  it('steps down in levels and finishes the floor when axial stock is left', () => {
    const op = pocket({ stepdown: 1, stockAxial: 0.5, finishFloor: true });
    const cuts = cutMoves(pocketToolpath(op, tool6, ctx, geoOf({ shapes: [withIsland] })).toolpath!.moves);
    const flat = [...new Set(cuts.filter((m) => m.kind === 'line').map((m) => +m.to.z.toFixed(4)))];
    expect(flat).toEqual(expect.arrayContaining([-0.8333, -1.6667, -2.5, -3]));
  });

  it('reports a tool that does not fit', () => {
    const big = { ...tool6, id: 'big', diameter: 30 };
    const out = pocketToolpath(pocket(), big, ctx, geoOf({ shapes: [withIsland] }));
    expect(out.toolpath).toBeNull();
    expect(out.diagnostics).toMatchObject([{ severity: 'error', code: 'offset-collapsed' }]);
  });

  it('clears separate areas of a pocket one after the other', () => {
    // two 20 × 20 rooms joined by a 4 mm corridor the 6 mm tool cannot enter
    const outer = { closed: true, segments: [
      [v2(0, 0), v2(20, 0)], [v2(20, 0), v2(20, 8)], [v2(20, 8), v2(40, 8)], [v2(40, 8), v2(40, 0)], [v2(40, 0), v2(60, 0)],
      [v2(60, 0), v2(60, 20)], [v2(60, 20), v2(40, 20)], [v2(40, 20), v2(40, 12)], [v2(40, 12), v2(20, 12)], [v2(20, 12), v2(20, 20)],
      [v2(20, 20), v2(0, 20)], [v2(0, 20), v2(0, 0)],
    ].map(([from, to]) => ({ kind: 'line' as const, from, to })) };
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [{ shape: { outer, islands: [] }, z: 0, ref: 0 }] }));
    const rooms = cutMoves(out.toolpath!.moves).map((m) => (m.to.x < 20 ? 'L' : m.to.x > 40 ? 'R' : '')).join('');
    expect(rooms).toMatch(/^(L+R+|R+L+)$/); // one room is finished completely before the other starts
  });
});
```

Check the numbers:
- With `stepdown: 1`, top 0 and a roughing bottom of −3 + 0.5 = −2.5, there are 3 levels: −0.8333, −1.6667 and −2.5. The floor finish adds −3.
- The corridor is 4 mm wide, so the 6 mm tool's level-0 offset (−3) separates the two rooms. That gives two areas.
- The island is a full clockwise arc, as `nestLoops` would produce. The keep-out check uses 7 − 0.001, allowing for arc-fit and flattening error.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-pocket.test.ts`
Expected: FAIL. `pocketToolpath` is not exported.

- [ ] **Step 3: Implement `cam/ops/pocket.ts`**

```ts
import { fitArcs } from '../../geometry/offset/arcFit';
import {
  differencePolys, offsetPolys, type Poly, pointInPolys, polysToRegions, regionPolys, segmentInside, sweepPolylines,
} from '../../geometry/offset/clipper';
import { dist2, flattenPath, nearestS, orientPath, pathStart, polyArea, rotateStart } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, PocketOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { depthLevels, emitHelix, emitLap, emitRampLaps, MoveWriter } from './writer';

interface Ring { k: number; path: Path2D; poly: Poly }
interface Area { polys: Poly[]; rings: Ring[] }

const LIFT = 1; // mm above the previous level for moves inside the pocket

export function pocketToolpath(op: PocketOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const tol = ctx.tolerance;
  const r = tool.diameter / 2;
  const stepover = Math.max(0.01, (tool.diameter * op.stepoverPct) / 100);
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;

  const orientRing = (poly: Poly): Path2D => {
    const outerRing = polyArea(poly) > 0;
    const ccw = outerRing === (op.direction === 'climb');
    return orientPath(fitArcs(poly, true, tol), ccw);
  };
  const startNear = (path: Path2D, p: Vec2 | null): Path2D => (p ? rotateStart(path, nearestS(path, p).s) : path);

  /** Clears one area at the given levels; `startZ` is where the entry begins for the first level. */
  const clearArea = (area: Area, levels: number[], h: ResolvedHeights, startZ: number) => {
    const rings = [...area.rings].sort((a, b) => b.k - a.k);
    let prev = startZ;
    levels.forEach((z, li) => {
      const entryZ = li === 0 ? startZ : Math.min(h.feed, prev + LIFT);
      let ring = startNear(rings[0].path, w.pos);
      const rh = (tool.diameter * op.entry.helixDiameterPct) / 200;
      const inner = op.entry.mode === 'auto' || op.entry.mode === 'helix' ? offsetPolys(area.polys, -rh, tol) : [];
      if (inner.length && rh > 0) {
        const start = pathStart(ring);
        let c = start;
        if (!pointInPolys(start, inner)) {
          let best = Infinity;
          for (const poly of inner) for (const p of poly) if (dist2(p, start) < best) { best = dist2(p, start); c = p; }
        }
        const hStart = { x: c.x + rh, y: c.y };
        if (w.pos && w.pos.z <= entryZ + 1e-9 && segmentInside(w.pos, hStart, area.polys)) w.line({ ...hStart, z: entryZ }, feed);
        else w.travel(hStart, first ? h.clearance : Math.max(entryZ, w.pos ? w.pos.z : h.retract), entryZ);
        first = false;
        emitHelix(w, c, rh, entryZ, z, angle, feed);
        ring = startNear(ring, w.pos);
        const s = pathStart(ring);
        if (segmentInside(w.pos!, s, area.polys)) w.line({ ...s, z }, feed);
        else {
          w.up(z + LIFT);
          w.rapid({ ...s, z: z + LIFT });
          w.line({ ...s, z }, plunge);
        }
      } else {
        w.travel(pathStart(ring), first ? h.clearance : Math.max(entryZ, w.pos ? w.pos.z : h.retract), entryZ);
        first = false;
        if (op.entry.mode === 'plunge') w.line({ ...pathStart(ring), z }, plunge);
        else emitRampLaps(w, ring, entryZ, z, angle, feed, null);
      }
      emitLap(w, ring, z, z, feed, null);
      for (const next of rings.slice(1)) {
        const path = startNear(next.path, w.pos);
        const s = pathStart(path);
        if (segmentInside(w.pos!, s, area.polys)) w.line({ ...s, z }, feed);
        else {
          w.up(z + LIFT);
          w.rapid({ ...s, z: z + LIFT });
          w.line({ ...s, z }, plunge);
        }
        emitLap(w, path, z, z, feed, null);
      }
      prev = z;
    });
    w.up(h.retract);
  };

  geo.shapes.forEach((sh) => {
    const hr = resolveHeights(op.heights, ctx, { contourZ: sh.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, sh.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const region: Poly[] = [
      flattenPath(orientPath(sh.shape.outer, true), tol),
      ...sh.shape.islands.map((i) => flattenPath(orientPath(i, false), tol)),
    ];
    const ringLevels: Poly[][] = [];
    for (let k = 0; k < 100000; k++) {
      const off = offsetPolys(region, -(r + op.stockRadial + k * stepover), tol);
      if (!off.length) break;
      ringLevels.push(off);
    }
    if (!ringLevels.length) return diag('error', 'offset-collapsed', 'The tool does not fit in this pocket', sh.ref);
    const areas: Area[] = polysToRegions(ringLevels[0]).map((reg) => ({ polys: regionPolys(reg), rings: [] }));
    ringLevels.forEach((level, k) => {
      for (const poly of level) {
        const area = areas.find((a) => pointInPolys(poly[0], a.polys)) ?? areas[0];
        area.rings.push({ k, poly, path: orientRing(poly) });
      }
    });

    // material the tool cannot reach
    const target = op.stockRadial > 0 ? offsetPolys(region, -op.stockRadial, tol) : region;
    const swept = sweepPolylines(areas.flatMap((a) => a.rings.map((ring) => ({ points: ring.poly, closed: true }))), r, tol);
    const left = polysToRegions(differencePolys(target, swept)).filter((reg) => offsetPolys(regionPolys(reg), -0.025, tol).length > 0);
    if (left.length) {
      diag('warning', 'unmachined-area', `The tool cannot reach ${left.length} area(s) of this pocket`, sh.ref);
      out.overlays.unmachined.push({ polys: left.flatMap(regionPolys), z: h.bottom });
    }

    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    for (const area of areas) clearArea(area, levels, h, h.feed);
    if (op.finishFloor && op.stockAxial > 0) for (const area of areas) clearArea(area, [h.bottom], h, h.feed);
    if (op.finishWalls) {
      for (const poly of offsetPolys(region, -r, tol)) {
        const path = orientRing(poly);
        w.travel(pathStart(path), h.retract, h.feed);
        emitRampLaps(w, path, h.feed, h.bottom, angle, feed, null);
        emitLap(w, path, h.bottom, h.bottom, feed, null);
        w.up(h.retract);
      }
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
```

`index.ts`: append `export * from './cam/ops/pocket';`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-pocket.test.ts && pnpm typecheck`
Expected: PASS.
- **Four corners test:** if it finds more than 4 unmachined polygons, look at the slivers around the island. The −0.025 width filter should drop them. If Clipper returns duplicate touching pieces, merge them with `unionPolys` before `polysToRegions`, i.e. `polysToRegions(unionPolys(differencePolys(target, swept)))`.
- **Round pocket test:** it expects no unmachined area. The rings' swept band must cover the whole circle: the stepover of 2.7 mm is less than the tool diameter, and the innermost ring's inner edge covers the centre.

  If a tiny central island remains (the innermost ring's radius is more than r away from the centre), cover it by adding the helix disc to the swept area. Add `{ points: [c], closed: false }` for each area's helix centre, at radius r + rh. Only do this if the test fails, and record it in the report.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): pocket offset clearing with islands, helix entry, finishing and unmachined areas"
```

---
### Task 10: Drill operation and job generation (cache, isolation, common checks)

**Files:**
- Create: `packages/core/src/cam/ops/drill.ts`, `packages/core/src/cam/generate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ops-drill.test.ts`, `packages/core/test/generate.test.ts`

**Interfaces:**
- Consumes: `resolveGeometry` (Task 5), `profileToolpath` (Task 8), `pocketToolpath` (Task 9), `OpOutput`/`emptyOverlays`, `MoveWriter`, `resolveHeights`, `camContext`.
- Produces:
  - `drillToolpath(op: DrillOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`
  - `interface OperationResult extends OpOutput { operationId: string; key: string }`
  - `class GenerationCache` (a `Map<string, { key: string; geometry: CamGeometry | null; result: OperationResult }>` wrapper with `get`/`set`)
  - `operationKey(op, job): string`
  - `generateOperation(op: Operation, ctx: CamContext): OperationResult`: never throws
  - `generateJob(job: Job, geometry: CamGeometry | null, cache?: GenerationCache): OperationResult[]`: one result per operation, in job order

Rules:
- Disabled operations give `{ toolpath: null, diagnostics: [] }`.
- `no-tool` is an error when `toolId` is null or unknown, and `no-geometry` is an error when there is no geometry.
- Reference diagnostics from `resolveGeometry` are merged in.
- **An operation with any error diagnostic has `toolpath: null`.** This is spec §6 "errors block that operation"; record it as plan clarification 10.
- Common warnings:
  - `stepdown-exceeds-flute`: profile or pocket with `stepdown > tool.fluteLength`;
  - `feed-exceeds-machine`: `feeds.feed > job.machine.maxFeed`.
- Exceptions become an `internal` error: "Generation failed: …".
- A cached result is reused when both the operation key and the geometry object are identical.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/ops-drill.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, type DrillOp, drillToolpath, newOperation, type Tool, v2 } from '../src';
import { camPartSetup, geoOf } from './fixtures/camSetup';

const drill6: Tool = {
  id: 'd6', name: '6 mm drill', type: 'drill', number: 3, diameter: 6, cornerRadius: 0, tipAngleDeg: 118, fluteLength: 35, stickout: 45, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 6000, feed: 600, plungeFeed: 300, stepdown: 6, stepoverPct: 50, coolant: 'off' }],
};
const { job, geometry } = camPartSetup(); // stock top 0, bottom −6
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: drill6 }), geometry);
const hole = (x: number, y: number, d = 6, ref = 0) => ({ center: v2(x, y), diameter: d, top: 0, bottom: -6, through: true, ref });
const holes = [hole(15, 15), hole(95, 15), hole(15, 55), hole(95, 55)];
const drillOp = (patch: Partial<DrillOp> = {}): DrillOp =>
  ({ ...(newOperation('drill', { id: 'd', name: 'Drill', tool: drill6, modelKind: 'drawing' }) as DrillOp), ...patch });

describe('drillToolpath', () => {
  it('orders holes nearest-neighbour from the origin and emits one cycle per hole', () => {
    const out = drillToolpath(drillOp({ cycle: 'peck', peck: 2 }), drill6, ctx, geoOf({ holes }));
    expect(out.diagnostics).toEqual([]);
    const cycles = out.toolpath!.moves.filter((m) => m.kind === 'cycle');
    expect(cycles.map((c) => c.kind === 'cycle' && [c.at.x, c.at.y])).toEqual([[15, 15], [15, 55], [95, 55], [95, 15]]);
    expect(cycles[0]).toEqual({ kind: 'cycle', cycle: 'peck', at: v2(15, 15), top: 0, bottom: -6, r: 2, retract: 5, peck: 2, dwell: 0.5, feed: 300 });
    expect(out.toolpath!.moves.slice(0, 2)).toEqual([{ kind: 'rapid', to: { x: 15, y: 15, z: 15 } }, { kind: 'rapid', to: { x: 15, y: 15, z: 5 } }]);
    expect(out.toolpath!.moves.at(-1)).toEqual({ kind: 'rapid', to: { x: 95, y: 15, z: 15 } });
  });

  it('checks the tool against the hole size and applies the diameter filter', () => {
    const big = drillToolpath(drillOp(), { ...drill6, diameter: 8 }, ctx, geoOf({ holes }));
    expect(big.toolpath).toBeNull();
    expect(big.diagnostics[0]).toMatchObject({ severity: 'error', code: 'tool-too-large' });
    const small = drillToolpath(drillOp(), { ...drill6, diameter: 5 }, ctx, geoOf({ holes }));
    expect(small.diagnostics.map((d) => d.code)).toEqual(['tool-undersize']);
    expect(small.toolpath).not.toBeNull();
    const filtered = drillToolpath(drillOp({ diameterFilter: { min: 7, max: 9 } }), drill6, ctx, geoOf({ holes }));
    expect(filtered.diagnostics).toMatchObject([{ severity: 'error', code: 'no-geometry' }]);
    const some = drillToolpath(drillOp({ diameterFilter: { min: 7, max: 9 } }), drill6, ctx, geoOf({ holes: [...holes, hole(50, 30, 8)] }));
    expect(some.toolpath!.moves.filter((m) => m.kind === 'cycle')).toHaveLength(1);
  });
});
```
The filtered case: the 8 mm hole passes the filter, and the 6 mm drill is under 90 % of 8 mm (7.2), so that result also carries `tool-undersize`. The test only counts cycles.

`packages/core/test/generate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, GenerationCache, generateJob, type Job, type JobCommand } from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

function camJob(): { job: Job; geometry: ReturnType<typeof camPartSetup>['geometry'] } {
  const { job, geometry, layer } = camPartSetup();
  const ref = (l: string, path: number) => ({ kind: 'dxfPath' as const, blobId: 'd1', layer: layer(l), path });
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'pocket' },
    { type: 'updateOperation', id: 'pocket', patch: { geometry: [0, 1, 2, 3, 4].map((i) => ref('POCKET', i)) } },
    { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'drill' },
    { type: 'updateOperation', id: 'drill', patch: { geometry: [0, 1, 2, 3].map((i) => ref('HOLES', i)) } },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'profile' },
    { type: 'updateOperation', id: 'profile', patch: { geometry: [ref('OUTLINE', 0)], tabs: { enabled: true } } },
  ];
  return { job: commands.reduce(applyCommand, job), geometry };
}

describe('generateJob', () => {
  it('generates every operation of the CAM part without errors', () => {
    const { job, geometry } = camJob();
    const results = generateJob(job, geometry);
    expect(results.map((r) => r.operationId)).toEqual(['pocket', 'drill', 'profile']);
    for (const r of results) {
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(r.toolpath?.moves.length).toBeGreaterThan(0);
    }
    expect(results[0].diagnostics.map((d) => d.code)).toEqual(['unmachined-area']);
  });

  it('reports missing tools and geometry, and skips disabled operations', () => {
    const { job, geometry } = camJob();
    const j = [
      { type: 'addOperation', opType: 'pocket', toolId: null, id: 'notool' },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'nogeo' },
      { type: 'setOperationEnabled', id: 'drill', enabled: false },
    ].reduce((acc, c) => applyCommand(acc, c as JobCommand), job);
    const byId = Object.fromEntries(generateJob(j, geometry).map((r) => [r.operationId, r]));
    expect(byId.notool.diagnostics).toMatchObject([{ severity: 'error', code: 'no-tool' }]);
    expect(byId.nogeo.diagnostics).toMatchObject([{ severity: 'error', code: 'no-geometry' }]);
    expect(byId.drill).toMatchObject({ toolpath: null, diagnostics: [] });
  });

  it('warns about stepdowns deeper than the flutes and feeds above the machine maximum', () => {
    const { job, geometry } = camJob();
    const j = applyCommand(applyCommand(job, { type: 'updateOperation', id: 'profile', patch: { stepdown: 25 } }),
      { type: 'updateOperation', id: 'pocket', patch: { feeds: { feed: 99999 } } });
    const byId = Object.fromEntries(generateJob(j, geometry).map((r) => [r.operationId, r]));
    expect(byId.profile.diagnostics.map((d) => d.code)).toContain('stepdown-exceeds-flute');
    expect(byId.pocket.diagnostics.map((d) => d.code)).toContain('feed-exceeds-machine');
  });

  it('reuses cached results for unchanged operations', () => {
    const { job, geometry } = camJob();
    const cache = new GenerationCache();
    const a = generateJob(job, geometry, cache);
    const b = generateJob(job, geometry, cache);
    expect(b[0]).toBe(a[0]);
    const changed = applyCommand(job, { type: 'updateOperation', id: 'drill', patch: { peck: 1.5 } });
    const c = generateJob(changed, geometry, cache);
    expect(c[0]).toBe(a[0]);
    expect(c[1]).not.toBe(a[1]);
    expect(c[2]).toBe(a[2]);
    expect(generateJob(job, { ...geometry }, cache)[0]).not.toBe(a[0]); // a different geometry object invalidates
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-drill.test.ts test/generate.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 3: Implement `cam/ops/drill.ts`**

```ts
import { dist2 } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry, ResolvedHole } from '../features/resolve';
import { resolveHeights } from '../heights';
import type { CamCode, CamSeverity, DrillOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { MoveWriter } from './writer';

export function drillToolpath(op: DrillOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const f = op.diameterFilter;
  const holes = geo.holes.filter((h) => !f || (h.diameter >= f.min - 1e-9 && h.diameter <= f.max + 1e-9));
  if (!holes.length) {
    diag('error', 'no-geometry', f ? 'No holes match the diameter filter' : 'There are no holes to drill');
    return out;
  }
  let undersize = false;
  for (const h of holes) {
    if (tool.diameter > h.diameter + ctx.tolerance) diag('error', 'tool-too-large', `The ${tool.diameter} mm tool is larger than a ${h.diameter.toFixed(2)} mm hole`, h.ref);
    else if (tool.diameter < 0.9 * h.diameter) undersize = true;
  }
  if (undersize) diag('warning', 'tool-undersize', 'The tool is more than 10 % smaller than some holes');
  if (out.diagnostics.some((d) => d.severity === 'error')) return out;

  const ordered: ResolvedHole[] = [];
  const left = [...holes];
  let at: Vec2 = { x: 0, y: 0 };
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (dist2(left[i].center, at) < dist2(left[best].center, at) - 1e-12) best = i;
    const [h] = left.splice(best, 1);
    ordered.push(h);
    at = h.center;
  }

  const w = new MoveWriter();
  let clearance = -Infinity;
  for (const h of ordered) {
    const hr = resolveHeights(op.heights, ctx, { contourZ: h.top, holeBottom: h.bottom, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, h.ref);
      continue;
    }
    const v = hr.values;
    out.heights ??= v;
    clearance = Math.max(clearance, v.clearance);
    if (!w.pos) w.travel(h.center, v.clearance, v.retract);
    else if (Math.abs(w.pos.z - v.retract) > 1e-9) w.travel(h.center, Math.max(w.pos.z, v.retract), v.retract);
    w.cycle({
      kind: 'cycle', cycle: op.cycle, at: h.center, top: v.top, bottom: v.bottom, r: v.feed, retract: v.retract,
      peck: op.peck, dwell: op.dwellSeconds, feed: op.feeds.plungeFeed,
    });
  }
  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
```

Check the tie-breaking in nearest-neighbour order. From (15, 15), the hole (15, 55) is 40 mm away and (95, 15) is 80 mm, so (15, 55) comes next. From there, (95, 55) at 80 mm beats (95, 15) at 89.4 mm.

- [ ] **Step 4: Implement `cam/generate.ts`**

```ts
import type { Job } from '../job/types';
import { camContext, type CamContext, type CamGeometry } from './context';
import { resolveGeometry } from './features/resolve';
import { drillToolpath } from './ops/drill';
import { emptyOverlays, type OpOutput } from './ops/output';
import { pocketToolpath } from './ops/pocket';
import { profileToolpath } from './ops/profile';
import type { CamDiagnostic, Operation } from './types';

export interface OperationResult extends OpOutput {
  operationId: string;
  /** Everything the result depends on, except the geometry object. */
  key: string;
}

export class GenerationCache {
  private entries = new Map<string, { key: string; geometry: CamGeometry | null; result: OperationResult }>();
  get(id: string, key: string, geometry: CamGeometry | null): OperationResult | null {
    const e = this.entries.get(id);
    return e && e.key === key && e.geometry === geometry ? e.result : null;
  }
  set(id: string, geometry: CamGeometry | null, result: OperationResult): void {
    this.entries.set(id, { key: result.key, geometry, result });
  }
  /** Drops entries for operations that no longer exist. */
  retain(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
  }
}

export function operationKey(op: Operation, job: Job): string {
  return JSON.stringify([op, job.tools.find((t) => t.id === op.toolId) ?? null, job.tolerance, job.model, job.stock, job.wcs, job.machine.maxFeed]);
}

export function generateOperation(op: Operation, ctx: CamContext): OperationResult {
  const base: OperationResult = { operationId: op.id, key: operationKey(op, ctx.job), toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  if (!op.enabled) return base;
  const err = (code: CamDiagnostic['code'], message: string): OperationResult => ({
    ...base, diagnostics: [{ operationId: op.id, severity: 'error', code, message }],
  });
  try {
    const tool = ctx.job.tools.find((t) => t.id === op.toolId);
    if (!tool) return err('no-tool', 'Choose a tool for this operation');
    if (!op.geometry.length) return err('no-geometry', 'Pick geometry for this operation');
    const geo = resolveGeometry(op, ctx);
    const res = op.type === 'profile' ? profileToolpath(op, tool, ctx, geo) : op.type === 'pocket' ? pocketToolpath(op, tool, ctx, geo) : drillToolpath(op, tool, ctx, geo);
    const diagnostics: CamDiagnostic[] = [...geo.diagnostics, ...res.diagnostics];
    const warn = (code: CamDiagnostic['code'], message: string) => diagnostics.push({ operationId: op.id, severity: 'warning', code, message });
    if (op.type !== 'drill' && op.stepdown > tool.fluteLength) warn('stepdown-exceeds-flute', `Stepdown ${op.stepdown} mm is deeper than the ${tool.fluteLength} mm flutes`);
    if (op.feeds.feed > ctx.job.machine.maxFeed) warn('feed-exceeds-machine', `Feed ${op.feeds.feed} mm/min is above the machine maximum of ${ctx.job.machine.maxFeed}`);
    const failed = diagnostics.some((d) => d.severity === 'error');
    return { ...base, ...res, diagnostics, toolpath: failed ? null : res.toolpath };
  } catch (e) {
    return err('internal', `Generation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function generateJob(job: Job, geometry: CamGeometry | null, cache?: GenerationCache): OperationResult[] {
  let ctx: CamContext | null = null;
  const results = job.operations.map((op) => {
    const key = operationKey(op, job);
    const hit = cache?.get(op.id, key, geometry);
    if (hit) return hit;
    ctx ??= camContext(job, geometry);
    const result = generateOperation(op, ctx);
    cache?.set(op.id, geometry, result);
    return result;
  });
  cache?.retain(job.operations.map((o) => o.id));
  return results;
}
```

`index.ts`: append `export * from './cam/ops/drill';` and `export * from './cam/generate';`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/ops-drill.test.ts test/generate.test.ts && pnpm typecheck`
Expected: PASS. If `generateJob` finds a second diagnostic on the pocket (for example a tab or plunge warning), read it before changing the test. The CAM part pocket should report exactly `unmachined-area`, for the four sharp corners.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): drill toolpaths and cached, fault-isolated job generation"
```

---

### Task 11: Post-processor engine, dialects and round-trip check

**Files:**
- Create: `packages/core/src/post/format.ts`, `packages/core/src/post/dialects.ts`, `packages/core/src/post/engine.ts`, `packages/core/src/post/check.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/post.test.ts`, `packages/core/test/post-roundtrip.test.ts`

**Interfaces:**
- Consumes: `Toolpath`, `Move` (Task 1); `Job`; `arcSweepBetween` (Task 3); `interpretProgram` (Milestone 2); `generateJob` (Task 10).
- Produces:
  - `fmtNum(v, decimals, trailingDot?)`, `sanitizeName(name)`
  - `interface Dialect`, `DIALECTS: Record<DialectId, Dialect>`
  - `interface PostSection { operationId: string; firstLine: number; lastLine: number }`: 0-based text lines of one operation in its file
  - `interface PostFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[] }`
  - `postProcess(job: Job, toolpaths: readonly Toolpath[], opts?: { date?: string }): PostFile[]`
  - `postedErrors(text: string, workOffset: WorkOffset): Diagnostic[]`

Plan clarification 12: Fanuc writes a **trailing decimal point** on every length and feed, so `40` is written `X40.`. Without it, Fanuc reads the value in least increments (0.040 mm). Other dialects strip the point.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/post.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, createJob, defaultPostSettings, fmtNum, type Job, postProcess, type Tool, type Toolpath } from '../src';

const t1: Tool = { id: 'a', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2, presets: [] };
const t2: Tool = { id: 'b', name: '5 mm drill', type: 'drill', number: 2, diameter: 5, cornerRadius: 0, tipAngleDeg: 118, fluteLength: 30, stickout: 40, flutes: 2, presets: [] };
const A: Toolpath = {
  operationId: 'A', operationName: 'Profile A', toolId: 'a', rpm: 18000, coolant: 'flood', clearance: 15,
  moves: [
    { kind: 'rapid', to: { x: 10, y: 10, z: 15 } },
    { kind: 'rapid', to: { x: 10, y: 10, z: 2 } },
    { kind: 'line', to: { x: 10, y: 10, z: -1 }, feed: 300 },
    { kind: 'line', to: { x: 20, y: 10, z: -1 }, feed: 1000 },
    { kind: 'arc', to: { x: 30, y: 10, z: -1 }, center: { x: 25, y: 10 }, ccw: false, feed: 1000 },
    { kind: 'arc', to: { x: 30, y: 10, z: -1 }, center: { x: 25, y: 10 }, ccw: true, feed: 1000 },
    { kind: 'rapid', to: { x: 30, y: 10, z: 15 } },
  ],
};
const cycle = (x: number) => ({ kind: 'cycle' as const, cycle: 'peck' as const, at: { x, y: 40 }, top: 0, bottom: -6, r: 2, retract: 5, peck: 2, dwell: 0, feed: 200 });
const B: Toolpath = {
  operationId: 'B', operationName: 'Drill B', toolId: 'b', rpm: 3000, coolant: 'off', clearance: 15,
  moves: [{ kind: 'rapid', to: { x: 40, y: 40, z: 15 } }, { kind: 'rapid', to: { x: 40, y: 40, z: 5 } }, cycle(40), cycle(50), { kind: 'rapid', to: { x: 50, y: 40, z: 15 } }],
};
function bracket(dialect: 'grbl' | 'linuxcnc' | 'fanuc', patch = {}): Job {
  const job = [t1, t2].reduce((j, tool) => applyCommand(j, { type: 'addTool', tool }), createJob('Bracket'));
  return { ...job, post: { ...defaultPostSettings(dialect), ...patch } };
}
const lines = (text: string) => text.trimEnd().split('\n');

describe('fmtNum', () => {
  it('rounds, strips zeros and never writes −0', () => {
    expect([fmtNum(1.5, 3), fmtNum(2, 3), fmtNum(-0.0001, 3), fmtNum(0.12345, 3), fmtNum(-3.1, 3)]).toEqual(['1.5', '2', '0', '0.123', '-3.1']);
    expect([fmtNum(2, 3, true), fmtNum(0, 3, true), fmtNum(1.25, 3, true)]).toEqual(['2.', '0.', '1.25']);
  });
});

describe('postProcess', () => {
  it('writes LinuxCNC: one file, M6 + G43, canned cycles, modal suppression', () => {
    const [file, ...rest] = postProcess(bracket('linuxcnc'), [A, B], { date: '2026-09-28' });
    expect(rest).toEqual([]);
    expect(file.name).toBe('Bracket.nc');
    expect(file.operationIds).toEqual(['A', 'B']);
    expect(file.tools).toEqual([1, 2]);
    expect(file.sections).toEqual([{ operationId: 'A', firstLine: 6, lastLine: 18 }, { operationId: 'B', firstLine: 19, lastLine: 30 }]);
    expect(lines(file.text)).toEqual([
      '(Bracket)', '(Spon 2026-09-28)', '(T1 D=6 flat - 6 mm flat)', '(T2 D=5 drill - 5 mm drill)',
      'G21 G90 G17 G94', 'G54',
      '(Profile A)', 'T1 M6', 'G43 H1', 'S18000 M3', 'M8',
      'G0 Z15', 'X10 Y10', 'Z2', 'G1 Z-1 F300', 'X20 F1000', 'G2 X30 Y10 I5 J0', 'G3 X30 Y10 I-5 J0', 'G0 Z15',
      '(Drill B)', 'M9', 'T2 M6', 'G43 H2', 'S3000 M3',
      'G0 Z15', 'X40 Y40', 'Z5', 'G98 G83 X40 Y40 Z-6 R2 Q2 F200', 'X50 Y40', 'G80', 'G0 Z15',
      'M9', 'M5', 'G53 G0 Z0', 'M2',
    ]);
  });

  it('writes GRBL split by tool with expanded peck cycles', () => {
    const files = postProcess(bracket('grbl'), [A, B], { date: '2026-09-28' });
    expect(files.map((f) => f.name)).toEqual(['Bracket-01-T1.nc', 'Bracket-02-T2.nc']);
    expect(lines(files[0].text)).toEqual([
      '(Bracket)', '(Spon 2026-09-28)', '(T1 D=6 flat - 6 mm flat)', 'G21 G90 G17 G94', 'G54',
      '(Profile A)', 'S18000 M3', 'M8', 'G0 Z15', 'X10 Y10', 'Z2', 'G1 Z-1 F300', 'X20 F1000', 'G2 X30 Y10 I5 J0', 'G3 X30 Y10 I-5 J0', 'G0 Z15',
      'M9', 'M5', 'M30',
    ]);
    const peck = ['Z2', 'G1 Z-2', 'G0 Z2', 'Z-1.5', 'G1 Z-4', 'G0 Z2', 'Z-3.5', 'G1 Z-6', 'G0 Z5'];
    expect(lines(files[1].text)).toEqual([
      '(Bracket)', '(Spon 2026-09-28)', '(T2 D=5 drill - 5 mm drill)', 'G21 G90 G17 G94', 'G54',
      '(Drill B)', 'S3000 M3', 'G0 Z15', 'X40 Y40', 'Z5',
      'Z2', 'G1 Z-2 F200', ...peck.slice(2), 'X50 Y40', ...peck, 'Z15',
      'M9', 'M5', 'M30',
    ]);
  });

  it('pauses for a manual tool change when GRBL is not split', () => {
    const [file] = postProcess(bracket('grbl', { splitByTool: false }), [A, B], { date: 'x' });
    const l = lines(file.text);
    expect(l.slice(l.indexOf('(Drill B)'), l.indexOf('(Drill B)') + 5)).toEqual(['(Drill B)', 'M9', 'M5', 'M0', '(Change to T2: 5 mm drill)']);
  });

  it('writes Fanuc in upper case with O-number, % lines, trailing decimal points and G28', () => {
    const [file] = postProcess(bracket('fanuc'), [A, B], { date: '2026-09-28' });
    const l = lines(file.text);
    expect(l.slice(0, 4)).toEqual(['%', 'O1000 (BRACKET)', '(BRACKET)', '(SPON 2026-09-28)']);
    expect(l).toContain('G40 G49 G80');
    expect(l).toContain('G2 X30. Y10. I5. J0.');
    expect(l).toContain('G98 G83 X40. Y40. Z-6. R2. Q2. F200.');
    expect(l.slice(-4)).toEqual(['G91 G28 Z0', 'G90', 'M30', '%']);
  });

  it('supports line numbers, R-format arcs, inch output, spindle dwell and dwell cycles', () => {
    const numbered = lines(postProcess(bracket('linuxcnc', { lineNumbers: true }), [A], { date: 'd' })[0].text);
    expect(numbered.slice(0, 2)).toEqual(['N10 (Bracket)', 'N20 (Spon d)']);
    const r = postProcess(bracket('linuxcnc', { arcFormat: 'r' }), [A], { date: 'd' })[0].text;
    expect(r).toContain('G2 X30 Y10 R5\n');
    expect(r).toContain('G3 X30 Y10 I-5 J0\n'); // full circles always use I/J
    const inch = { ...bracket('linuxcnc'), displayUnits: 'in' as const };
    const t = postProcess(inch, [A], { date: 'd' })[0].text;
    expect(t).toContain('G20 G90 G17 G94');
    expect(t).toContain('X0.3937 Y0.3937');
    expect(postProcess(bracket('linuxcnc', { spindleDwell: 2 }), [A], { date: 'd' })[0].text).toContain('S18000 M3\nG4 P2\n');
    const dwellB: Toolpath = { ...B, moves: B.moves.map((m) => (m.kind === 'cycle' ? { ...m, cycle: 'dwell' as const, dwell: 0.5 } : m)) };
    expect(postProcess(bracket('linuxcnc'), [dwellB], { date: 'd' })[0].text).toContain('G98 G82 X40 Y40 Z-6 R2 P0.5 F200');
    expect(postProcess(bracket('fanuc'), [dwellB], { date: 'd' })[0].text).toContain('G98 G82 X40. Y40. Z-6. R2. P500 F200.');
    expect(postProcess(bracket('linuxcnc'), [], {})).toEqual([]);
  });
});
```

`packages/core/test/post-roundtrip.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommand, defaultPostSettings, generateJob, interpretProgram, type Job, type JobCommand, MoveKind, postedErrors, postProcess, type Toolpath,
} from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

function camJob(): { job: Job; toolpaths: Toolpath[] } {
  const { job, geometry, layer } = camPartSetup();
  const ref = (l: string, path: number) => ({ kind: 'dxfPath' as const, blobId: 'd1', layer: layer(l), path });
  const j = ([
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'pocket' },
    { type: 'updateOperation', id: 'pocket', patch: { geometry: [0, 1, 2, 3, 4].map((i) => ref('POCKET', i)) } },
    { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'drill' },
    { type: 'updateOperation', id: 'drill', patch: { geometry: [0, 1, 2, 3].map((i) => ref('HOLES', i)), cycle: 'peck', peck: 2 } },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'profile' },
    { type: 'updateOperation', id: 'profile', patch: { geometry: [ref('OUTLINE', 0)], tabs: { enabled: true, shape: 'triangle' } } },
  ] as JobCommand[]).reduce(applyCommand, job);
  return { job: j, toolpaths: generateJob(j, geometry).map((r) => r.toolpath!).filter(Boolean) };
}

/** XY-Z box of the feed moves a toolpath describes (line/arc end points, and each cycle's hole centre at its bottom). */
function expectedBox(tps: Toolpath[]) {
  const pts: number[][] = [];
  for (const tp of tps) for (const m of tp.moves) {
    if (m.kind === 'line' || m.kind === 'arc') pts.push([m.to.x, m.to.y, m.to.z]);
    if (m.kind === 'cycle') pts.push([m.at.x, m.at.y, m.bottom]);
  }
  return [0, 1, 2].map((k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))]);
}

function simulatedBox(text: string) {
  const { table } = interpretProgram(text, { jobWorkOffset: 'G54' });
  const pts: number[][] = [];
  for (let i = 0; i < table.count; i++) {
    const k = table.kind[i];
    if (k === MoveKind.Feed || k === MoveKind.ArcCW || k === MoveKind.ArcCCW) pts.push([table.end[i * 3], table.end[i * 3 + 1], table.end[i * 3 + 2]]);
  }
  return [0, 1, 2].map((k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))]);
}

describe('posted G-code round trip', () => {
  for (const dialect of ['grbl', 'linuxcnc', 'fanuc'] as const) {
    for (const split of [false, true]) {
      it(`${dialect}${split ? ' split' : ''}: parses without errors and reproduces the toolpath`, () => {
        const { job, toolpaths } = camJob();
        const files = postProcess({ ...job, post: { ...defaultPostSettings(dialect), splitByTool: split } }, toolpaths, { date: 'd' });
        expect(files).toHaveLength(1); // all three operations use the same tool, so splitting still gives one file
        for (const f of files) expect(postedErrors(f.text, 'G54')).toEqual([]);
        const sim = simulatedBox(files.map((f) => f.text).join('\n'));
        const exp = expectedBox(toolpaths);
        for (let k = 0; k < 3; k++) {
          expect(sim[k][0]).toBeCloseTo(exp[k][0], 2);
          expect(sim[k][1]).toBeCloseTo(exp[k][1], 2);
        }
      });
    }
  }
});
```
All three operations in the round-trip job use `tool6`, so split-by-tool still gives a single file. `toBeCloseTo(…, 2)` allows the 3-decimal rounding.

The Milestone 2 interpreter accepts every word these posts emit, including `%`, `O` numbers, `M0`, M7/M8/M9, G98/G80, `G4 X`, and `G91 G28 Z0`. The only diagnostic is the `other-work-offset` warning on `G53 G0 Z0`. This was checked while writing this plan.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @sponcam/core exec vitest run test/post.test.ts test/post-roundtrip.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 3: Implement `post/format.ts`**

```ts
/** Rounds to `decimals`, strips trailing zeros, never writes −0; `trailingDot` keeps "40." (Fanuc). */
export function fmtNum(v: number, decimals: number, trailingDot = false): string {
  let s = (Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v).toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = trailingDot ? s : s.slice(0, -1);
  else if (trailingDot && !s.includes('.')) s += '.';
  return s;
}

/** A job name usable in file names. */
export function sanitizeName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'job';
}

/** Text safe inside ( ) comments. */
export const commentText = (text: string): string => text.replace(/\(/g, '[').replace(/\)/g, ']');
```

- [ ] **Step 4: Implement `post/dialects.ts`**

```ts
import type { DialectId } from './types';

export interface Dialect {
  id: DialectId;
  name: string;
  programNumber: boolean;
  upperCase: boolean;
  /** m6: T# M6 on every tool change (and the first tool); pause: M5 + M0 between tools; none: nothing. */
  toolChange: 'm6' | 'pause' | 'none';
  lengthOffset: boolean;
  cannedCycles: boolean;
  endRetract: 'clearance' | 'g53' | 'g28';
  programEnd: 'M30' | 'M2';
  fullCircleSplit: boolean;
  /** G4 dwell word: P (seconds) or X (seconds, Fanuc). */
  dwellWord: 'P' | 'X';
  /** G82 P in integer milliseconds (Fanuc). */
  g82DwellMs: boolean;
  trailingDot: boolean;
}

export const DIALECTS: Readonly<Record<DialectId, Dialect>> = {
  grbl: {
    id: 'grbl', name: 'GRBL / grblHAL / FluidNC', programNumber: false, upperCase: false, toolChange: 'pause', lengthOffset: false,
    cannedCycles: false, endRetract: 'clearance', programEnd: 'M30', fullCircleSplit: false, dwellWord: 'P', g82DwellMs: false, trailingDot: false,
  },
  linuxcnc: {
    id: 'linuxcnc', name: 'LinuxCNC / Mach', programNumber: false, upperCase: false, toolChange: 'm6', lengthOffset: true,
    cannedCycles: true, endRetract: 'g53', programEnd: 'M2', fullCircleSplit: false, dwellWord: 'P', g82DwellMs: false, trailingDot: false,
  },
  fanuc: {
    id: 'fanuc', name: 'Fanuc / Haas', programNumber: true, upperCase: true, toolChange: 'm6', lengthOffset: true,
    cannedCycles: true, endRetract: 'g28', programEnd: 'M30', fullCircleSplit: false, dwellWord: 'X', g82DwellMs: true, trailingDot: true,
  },
};
```

- [ ] **Step 5: Implement `post/engine.ts`**

```ts
import type { Move, Toolpath } from '../cam/types';
import { arcSweepBetween } from '../geometry/offset/pathOps';
import type { Vec3 } from '../geometry/vec3';
import type { Job } from '../job/types';
import { type Dialect, DIALECTS } from './dialects';
import { commentText, fmtNum, sanitizeName } from './format';
import type { PostSettings } from './types';

export interface PostSection { operationId: string; firstLine: number; lastLine: number }
export interface PostFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[] }
export interface PostOptions { date?: string }

type ArcMove = Extract<Move, { kind: 'arc' }>;
type CycleMove = Extract<Move, { kind: 'cycle' }>;
const CYCLE_CODE = { drill: 'G81', dwell: 'G82', peck: 'G83', chipbreak: 'G73' } as const;

class Lines {
  private out: string[] = [];
  private n = 0;
  constructor(private readonly s: PostSettings, private readonly d: Dialect) {}
  raw(text: string): void { this.out.push(text); }
  line(text: string): void {
    const t = this.d.upperCase ? text.toUpperCase() : text;
    if (this.s.lineNumbers) {
      this.n += this.s.lineNumberStep;
      this.out.push(`N${this.n} ${t}`);
    } else this.out.push(t);
  }
  comment(text: string): void { this.line(`(${commentText(text)})`); }
  get length(): number { return this.out.length; }
  text(): string { return `${this.out.join('\n')}\n`; }
}

export function postProcess(job: Job, toolpaths: readonly Toolpath[], opts: PostOptions = {}): PostFile[] {
  if (!toolpaths.length) return [];
  const s = job.post;
  const d = DIALECTS[s.dialect];
  const groups: Toolpath[][] = [];
  for (const tp of toolpaths) {
    const last = groups[groups.length - 1];
    if (last && (!s.splitByTool || last[0].toolId === tp.toolId)) last.push(tp);
    else groups.push([tp]);
  }
  const base = sanitizeName(job.name);
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const numberOf = (id: string) => job.tools.find((t) => t.id === id)?.number ?? 0;
  return groups.map((g, i) => {
    const tools = [...new Set(g.map((tp) => numberOf(tp.toolId)))];
    const name = s.splitByTool ? `${base}-${String(i + 1).padStart(2, '0')}-T${tools[0]}.${s.extension}` : `${base}.${s.extension}`;
    const { text, sections } = writeProgram(job, d, g, date);
    return { name, text, operationIds: g.map((tp) => tp.operationId), tools, sections };
  });
}

function writeProgram(job: Job, d: Dialect, group: readonly Toolpath[], date: string): { text: string; sections: PostSection[] } {
  const s = job.post;
  const inch = job.displayUnits === 'in';
  const k = inch ? 1 / 25.4 : 1;
  const dec = inch ? s.decimals + 1 : s.decimals;
  const num = (v: number) => fmtNum(v * k, dec, d.trailingDot);
  const feedNum = (v: number) => fmtNum(v * k, inch ? 2 : 1, d.trailingDot);
  const out = new Lines(s, d);
  const toolOf = (id: string) => job.tools.find((t) => t.id === id);

  if (d.programNumber) {
    out.raw('%');
    out.raw(`O${String(s.programNumber).padStart(4, '0')} (${commentText(job.name).toUpperCase()})`);
  }
  out.comment(job.name);
  out.comment(`Spon ${date}`);
  const listed = new Set<string>();
  for (const tp of group) {
    const t = toolOf(tp.toolId);
    if (!t || listed.has(t.id)) continue;
    listed.add(t.id);
    out.comment(`T${t.number} D=${fmtNum(t.diameter, 3)} ${t.type} - ${t.name}`);
  }
  out.line(`${inch ? 'G20' : 'G21'} G90 G17 G94`);
  if (s.safeStart.trim()) out.line(s.safeStart.trim());
  out.line(job.wcs.workOffset);

  let motion: string | null = null;
  let X: string | null = null, Y: string | null = null, Z: string | null = null, F: string | null = null;
  let cur: Vec3 | null = null;
  let cycleKey: string | null = null;
  let tool: number | null = null;
  let rpm: number | null = null;
  let coolant: string = 'off';
  const g = (code: string) => (motion === code ? '' : code);
  const emit = (words: (string | false)[]) => {
    const text = words.filter(Boolean).join(' ');
    if (text) out.line(text);
  };
  const endCycle = () => {
    if (cycleKey === null) return;
    out.line('G80');
    cycleKey = null;
    motion = null;
  };
  const rapidZ = (z: number) => {
    const zs = num(z);
    if (zs === Z) return;
    emit([g('G0'), `Z${zs}`]);
    motion = 'G0';
    Z = zs;
    if (cur) cur = { ...cur, z };
  };
  const rapid = (to: Vec3) => {
    const xs = num(to.x), ys = num(to.y), zs = num(to.z);
    const words = [xs !== X && `X${xs}`, ys !== Y && `Y${ys}`, zs !== Z && `Z${zs}`];
    if (words.some(Boolean)) {
      emit([g('G0'), ...words]);
      motion = 'G0';
    }
    X = xs; Y = ys; Z = zs; cur = to;
  };
  const linear = (to: Vec3, feed: number) => {
    const xs = num(to.x), ys = num(to.y), zs = num(to.z), fs = feedNum(feed);
    const words = [xs !== X && `X${xs}`, ys !== Y && `Y${ys}`, zs !== Z && `Z${zs}`];
    if (words.some(Boolean)) {
      emit([g('G1'), ...words, fs !== F && `F${fs}`]);
      motion = 'G1';
      F = fs;
    }
    X = xs; Y = ys; Z = zs; cur = to;
  };
  const arc = (m: ArcMove): void => {
    const start = cur ?? m.to;
    const full = Math.hypot(m.to.x - start.x, m.to.y - start.y) < 1e-9;
    if (full && d.fullCircleSplit) {
      const mid = { x: 2 * m.center.x - start.x, y: 2 * m.center.y - start.y, z: (start.z + m.to.z) / 2 };
      arc({ ...m, to: mid });
      arc(m);
      return;
    }
    const xs = num(m.to.x), ys = num(m.to.y), zs = num(m.to.z), fs = feedNum(m.feed);
    if (!full && xs === X && ys === Y) return linear(m.to, m.feed); // too short to be an arc at this resolution
    const code = m.ccw ? 'G3' : 'G2';
    const words = [code, `X${xs}`, `Y${ys}`];
    if (zs !== Z) words.push(`Z${zs}`);
    if (s.arcFormat === 'r' && !full) {
      const r = Math.hypot(start.x - m.center.x, start.y - m.center.y);
      const sweep = arcSweepBetween(
        Math.atan2(start.y - m.center.y, start.x - m.center.x), Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x), m.ccw,
      );
      words.push(`R${num(Math.abs(sweep) > Math.PI + 1e-9 ? -r : r)}`);
    } else words.push(`I${num(m.center.x - start.x)}`, `J${num(m.center.y - start.y)}`);
    if (fs !== F) words.push(`F${fs}`);
    out.line(words.join(' '));
    motion = code; X = xs; Y = ys; Z = zs; F = fs; cur = m.to;
  };
  const dwell = (seconds: number) => out.line(`G4 ${d.dwellWord}${fmtNum(seconds, 3, d.trailingDot)}`);
  const cycle = (c: CycleMove) => {
    if (d.cannedCycles) {
      const code = CYCLE_CODE[c.cycle];
      const xy = `X${num(c.at.x)} Y${num(c.at.y)}`;
      const key = JSON.stringify([code, c.bottom, c.r, c.peck, c.dwell, c.feed, c.retract]);
      if (key === cycleKey) out.line(xy);
      else {
        endCycle();
        const fs = feedNum(c.feed);
        const words = ['G98', code, xy, `Z${num(c.bottom)}`, `R${num(c.r)}`];
        if (c.cycle === 'peck' || c.cycle === 'chipbreak') words.push(`Q${num(c.peck)}`);
        if (c.cycle === 'dwell') words.push(d.g82DwellMs ? `P${Math.round(c.dwell * 1000)}` : `P${fmtNum(c.dwell, 3)}`);
        words.push(`F${fs}`);
        out.line(words.join(' '));
        cycleKey = key;
        F = fs;
      }
      X = num(c.at.x);
      Y = num(c.at.y);
      motion = null;
      cur = { x: c.at.x, y: c.at.y, z: cur ? cur.z : c.retract };
      return;
    }
    // expanded, with G98 semantics: return to the initial level (the retract height)
    rapid({ x: c.at.x, y: c.at.y, z: cur ? cur.z : c.retract });
    rapidZ(c.r);
    if (c.cycle === 'peck' || c.cycle === 'chipbreak') {
      let depth = c.top;
      while (depth > c.bottom + 1e-9) {
        const next = Math.max(c.bottom, depth - Math.max(c.peck, 0.01));
        linear({ x: c.at.x, y: c.at.y, z: next }, c.feed);
        depth = next;
        if (depth > c.bottom + 1e-9) {
          if (c.cycle === 'peck') {
            rapidZ(c.r);
            rapidZ(Math.min(c.r, depth + 0.5));
          } else rapidZ(depth + 0.5);
        }
      }
    } else {
      linear({ x: c.at.x, y: c.at.y, z: c.bottom }, c.feed);
      if (c.cycle === 'dwell') dwell(c.dwell);
    }
    rapidZ(c.retract);
  };

  let lastClearance = 0;
  const sections: PostSection[] = [];
  for (const tp of group) {
    endCycle();
    const firstLine = out.length;
    out.comment(tp.operationName);
    const t = toolOf(tp.toolId);
    const number = t?.number ?? 0;
    if (number !== tool) {
      if (s.coolant && coolant !== 'off') {
        out.line('M9');
        coolant = 'off';
      }
      if (d.toolChange === 'm6') {
        out.line(`T${number} M6`);
        if (d.lengthOffset) out.line(`G43 H${number}`);
      } else if (d.toolChange === 'pause' && tool !== null) {
        out.line('M5');
        out.line('M0');
        out.comment(`Change to T${number}: ${t?.name ?? ''}`);
      }
      tool = number;
      rpm = null;
      motion = null;
      X = Y = Z = null;
      cur = null;
    }
    if (tp.rpm !== rpm) {
      out.line(`S${Math.round(tp.rpm)} M3`);
      if (s.spindleDwell > 0) dwell(s.spindleDwell);
      rpm = tp.rpm;
    }
    const want = s.coolant ? tp.coolant : 'off';
    if (want !== coolant) {
      out.line(want === 'flood' ? 'M8' : want === 'mist' ? 'M7' : 'M9');
      coolant = want;
    }
    tp.moves.forEach((m, i) => {
      if (m.kind !== 'cycle') endCycle();
      if (m.kind === 'rapid') {
        if (i === 0) rapidZ(m.to.z);
        rapid(m.to);
      } else if (m.kind === 'line') linear(m.to, m.feed);
      else if (m.kind === 'arc') arc(m);
      else cycle(m);
    });
    lastClearance = tp.clearance;
    sections.push({ operationId: tp.operationId, firstLine, lastLine: out.length - 1 });
  }
  endCycle();
  if (s.coolant) out.line('M9');
  out.line('M5');
  if (d.endRetract === 'clearance') rapidZ(lastClearance);
  else if (d.endRetract === 'g53') out.line('G53 G0 Z0');
  else {
    out.line('G91 G28 Z0');
    out.line('G90');
  }
  out.line(d.programEnd);
  if (d.programNumber) out.raw('%');
  return { text: out.text(), sections };
}
```
In the GRBL-not-split pause test, the pause sequence is `M9` (coolant was flood), then `M5`, `M0`, and the change comment. The coolant `M9` comes first because the coolant check runs before the tool-change branch.

- [ ] **Step 6: Implement `post/check.ts`**

```ts
import { interpretProgram } from '../gcode/interpreter';
import type { Diagnostic } from '../gcode/types';
import type { WorkOffset } from '../job/types';

/** Interpreter errors in posted G-code; any error here is a post-processor bug. */
export function postedErrors(text: string, workOffset: WorkOffset): Diagnostic[] {
  return interpretProgram(text, { jobWorkOffset: workOffset }).diagnostics.filter((d) => d.severity === 'error');
}
```

`index.ts`: append
```ts
export * from './post/format';
export * from './post/dialects';
export * from './post/engine';
export * from './post/check';
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/post.test.ts test/post-roundtrip.test.ts && pnpm typecheck`
Expected: PASS.
- If a golden line differs, compare it with the traced sequence in Step 1: it was derived from exactly the code above.
- Any round-trip `postedErrors` failure is a real post bug. Read the message (for example `feed-spindle-off`) and fix the engine, not the test.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): declarative post-processor engine with GRBL, LinuxCNC and Fanuc dialects"
```

---

### Task 12: Tools — starter library, Spon library files, Fusion 360 import

**Files:**
- Create: `packages/core/src/tools/starterLibrary.ts`, `packages/core/src/tools/library.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/tools.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolPreset`, `ToolType`, `MATERIALS` (Task 1); `fflate` (`unzipSync`, `strFromU8`, `strToU8`, `zipSync`).
- Produces:
  - `starterLibrary(): Tool[]`
  - `class ToolLibraryError extends Error`
  - `validateTool(value: unknown): value is Tool`
  - `exportToolLibrary(tools: readonly Tool[]): string`
  - `importToolLibrary(text: string): Tool[]`
  - `interface FusionImportResult { tools: Tool[]; skipped: { name: string; reason: string }[] }`
  - `importFusionLibrary(bytes: Uint8Array, fileName: string): FusionImportResult`

- [ ] **Step 1: Write the failing test**

`packages/core/test/tools.test.ts`:
```ts
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportToolLibrary, importFusionLibrary, importToolLibrary, MATERIALS, starterLibrary, ToolLibraryError, validateTool } from '../src';

const fusion = {
  data: [
    {
      type: 'flat end mill', unit: 'millimeters', description: '6mm 2F upcut', vendor: 'Acme', 'product-id': 'A-6',
      geometry: { DC: 6, NOF: 2, LCF: 22, LB: 30, OAL: 50, RE: 0 }, 'post-process': { number: 5 },
      'start-values': { presets: [{ name: 'MDF', n: 18000, v_f: 2000, v_f_plunge: 500, stepdown: 3, stepover: 2.4, 'tool-coolant': 'disabled' }] },
    },
    {
      type: 'ball end mill', unit: 'inches', description: '1/4 ball', geometry: { DC: 0.25, NOF: 2, LCF: 0.75, OAL: 2, RE: 0.125 },
      'post-process': { number: 6 }, 'start-values': { presets: [{ name: 'Alu', n: 12000, v_f: 20, stepdown: 0.02, stepover: 0.025, 'tool-coolant': 'mist' }] },
    },
    { type: 'holder', description: 'BT30 holder' },
    { type: 'drill', unit: 'millimeters', description: '5mm drill', geometry: { DC: 5, SIG: 118, LCF: 30, OAL: 60 }, 'post-process': { number: 7 } },
  ],
};

describe('starter library', () => {
  it('has 10 valid tools with unique ids and numbers and a preset per material', () => {
    const tools = starterLibrary();
    expect(tools).toHaveLength(10);
    expect(new Set(tools.map((t) => t.id)).size).toBe(10);
    expect(new Set(tools.map((t) => t.number)).size).toBe(10);
    for (const t of tools) {
      expect(validateTool(t), t.name).toBe(true);
      expect(t.presets.map((p) => p.name)).toEqual([...MATERIALS]);
    }
    expect(tools.map((t) => `${t.type}:${t.diameter}`)).toEqual([
      'flat:3', 'flat:6', 'flat:8', 'ball:6', 'vbit:12', 'vbit:12', 'drill:3', 'drill:5', 'drill:6', 'drill:8',
    ]);
  });
});

describe('Spon tool library files', () => {
  it('round-trips and rejects broken files', () => {
    const tools = starterLibrary().slice(0, 2);
    expect(importToolLibrary(exportToolLibrary(tools))).toEqual(tools);
    expect(() => importToolLibrary('{')).toThrow(ToolLibraryError);
    expect(() => importToolLibrary('{"format":"other"}')).toThrow(/not a Spon tool library/);
    expect(() => importToolLibrary(JSON.stringify({ format: 'spon-tools', version: 1, tools: [{ id: 'x' }] }))).toThrow(/Tool 1 is invalid/);
  });
});

describe('Fusion 360 import', () => {
  it('maps tools, converts inches, keeps presets and skips unsupported types', () => {
    const r = importFusionLibrary(strToU8(JSON.stringify(fusion)), 'lib.json');
    expect(r.skipped).toEqual([{ name: 'BT30 holder', reason: 'Unsupported tool type "holder"' }]);
    expect(r.tools).toHaveLength(3);
    const [flat, ball, drill] = r.tools;
    expect(flat).toMatchObject({
      name: '6mm 2F upcut', type: 'flat', number: 5, diameter: 6, fluteLength: 22, stickout: 30, flutes: 2, vendor: 'Acme', productId: 'A-6',
      presets: [{ name: 'MDF', rpm: 18000, feed: 2000, plungeFeed: 500, stepdown: 3, stepoverPct: 40, coolant: 'off' }],
    });
    expect(ball.diameter).toBeCloseTo(6.35, 9);
    expect(ball.cornerRadius).toBeCloseTo(3.175, 9);
    expect(ball.presets[0]).toMatchObject({ rpm: 12000, coolant: 'mist', stepoverPct: 10 });
    expect(ball.presets[0].feed).toBeCloseTo(508, 9);
    expect(ball.presets[0].plungeFeed).toBeCloseTo(508, 9);
    expect(drill).toMatchObject({ type: 'drill', tipAngleDeg: 118, number: 7, presets: [] });
    for (const t of r.tools) expect(validateTool(t)).toBe(true);
  });

  it('reads zipped .tools files and rejects files without tools', () => {
    const zipped = zipSync({ 'tools.json': strToU8(JSON.stringify(fusion)) });
    expect(importFusionLibrary(zipped, 'lib.tools').tools).toHaveLength(3);
    expect(() => importFusionLibrary(strToU8('{"x":1}'), 'a.json')).toThrow(/not a Fusion 360 tool library/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/tools.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 3: Implement `tools/starterLibrary.ts`**

```ts
import { MATERIALS, type Tool, type ToolPreset, type ToolType } from './types';

type Row = [rpm: number, feed: number, plunge: number, stepdown: number, stepoverPct: number];
/** One row per material, in MATERIALS order; aluminium uses mist coolant. */
const presets = (rows: [Row, Row, Row, Row]): ToolPreset[] =>
  rows.map(([rpm, feed, plungeFeed, stepdown, stepoverPct], i) => ({
    name: MATERIALS[i], rpm, feed, plungeFeed, stepdown, stepoverPct, coolant: i === 3 ? 'mist' : 'off',
  }));

function tool(id: string, name: string, type: ToolType, number: number, diameter: number, geom: Partial<Tool>, rows: [Row, Row, Row, Row]): Tool {
  return {
    id, name, type, number, diameter, cornerRadius: 0, tipAngleDeg: 0, fluteLength: diameter * 3, stickout: diameter * 5, flutes: 2,
    ...geom, presets: presets(rows),
  };
}

/** Conservative defaults written for Spon; users tune them for their machine. */
export function starterLibrary(): Tool[] {
  const flat6: [Row, Row, Row, Row] = [[18000, 2000, 600, 3, 45], [18000, 1500, 450, 2, 40], [16000, 1500, 450, 2, 40], [16000, 700, 150, 0.6, 30]];
  const vbit: [Row, Row, Row, Row] = [[18000, 1500, 500, 1, 20], [18000, 1200, 400, 0.8, 20], [16000, 1200, 400, 0.8, 20], [18000, 600, 150, 0.2, 20]];
  const drill = (d: number): [Row, Row, Row, Row] => [[6000, 600, 300, d, 50], [5000, 450, 250, d * 0.75, 50], [4000, 400, 200, d * 0.75, 50], [3000, 250, 120, d * 0.5, 50]];
  return [
    tool('starter-flat-3', '3 mm flat end mill', 'flat', 1, 3, { fluteLength: 12, stickout: 20 },
      [[18000, 1200, 400, 1.5, 40], [18000, 900, 300, 1, 40], [16000, 900, 300, 1, 40], [18000, 400, 100, 0.3, 30]]),
    tool('starter-flat-6', '6 mm flat end mill', 'flat', 2, 6, { fluteLength: 22, stickout: 30 }, flat6),
    tool('starter-flat-8', '8 mm flat end mill', 'flat', 3, 8, { fluteLength: 25, stickout: 35 },
      [[16000, 2400, 700, 4, 45], [16000, 1800, 500, 2.5, 40], [14000, 1800, 500, 2.5, 40], [14000, 800, 150, 0.8, 30]]),
    tool('starter-ball-6', '6 mm ball end mill', 'ball', 4, 6, { cornerRadius: 3, fluteLength: 22, stickout: 30 },
      flat6.map(([a, b, c, d]) => [a, b, c, d, 15]) as [Row, Row, Row, Row]),
    tool('starter-vbit-60', '60° V-bit, 12 mm', 'vbit', 5, 12, { tipAngleDeg: 60, fluteLength: 10.4, stickout: 25 }, vbit),
    tool('starter-vbit-90', '90° V-bit, 12 mm', 'vbit', 6, 12, { tipAngleDeg: 90, fluteLength: 6, stickout: 25 }, vbit),
    ...[3, 5, 6, 8].map((d, i) =>
      tool(`starter-drill-${d}`, `${d} mm drill`, 'drill', 7 + i, d, { tipAngleDeg: 118, fluteLength: [20, 30, 35, 40][i], stickout: [30, 40, 45, 50][i] }, drill(d))),
  ];
}
```

- [ ] **Step 4: Implement `tools/library.ts`**

```ts
import { strFromU8, unzipSync } from 'fflate';
import { TOOL_TYPES, type Tool, type ToolPreset, type ToolType } from './types';

export class ToolLibraryError extends Error {
  override name = 'ToolLibraryError';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateTool(value: unknown): value is Tool {
  const t = value as Tool;
  return (
    typeof t === 'object' && t !== null && typeof t.id === 'string' && typeof t.name === 'string' && TOOL_TYPES.includes(t.type) &&
    Number.isInteger(t.number) && t.number >= 0 && isNum(t.diameter) && t.diameter > 0 && isNum(t.cornerRadius) && t.cornerRadius >= 0 &&
    isNum(t.tipAngleDeg) && isNum(t.fluteLength) && t.fluteLength > 0 && isNum(t.stickout) && isNum(t.flutes) && Array.isArray(t.presets) &&
    t.presets.every((p) =>
      typeof p.name === 'string' && isNum(p.rpm) && isNum(p.feed) && isNum(p.plungeFeed) && isNum(p.stepdown) && p.stepdown > 0 &&
      isNum(p.stepoverPct) && p.stepoverPct > 0 && p.stepoverPct <= 100 && ['off', 'flood', 'mist'].includes(p.coolant))
  );
}

export function exportToolLibrary(tools: readonly Tool[]): string {
  return JSON.stringify({ format: 'spon-tools', version: 1, tools }, null, 2);
}

export function importToolLibrary(text: string): Tool[] {
  let data: { format?: unknown; version?: unknown; tools?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new ToolLibraryError('The file is not valid JSON');
  }
  if (data?.format !== 'spon-tools' || !Array.isArray(data.tools)) throw new ToolLibraryError('This is not a Spon tool library');
  data.tools.forEach((t, i) => {
    if (!validateTool(t)) throw new ToolLibraryError(`Tool ${i + 1} is invalid`);
  });
  return data.tools as Tool[];
}

export interface FusionImportResult { tools: Tool[]; skipped: { name: string; reason: string }[] }

function fusionType(type: string): ToolType | null {
  const t = type.toLowerCase();
  if (t === 'flat end mill' || t === 'face mill') return 'flat';
  if (t === 'ball end mill') return 'ball';
  if (t === 'bull nose end mill') return 'bull';
  if (t === 'chamfer mill') return 'chamfer';
  if (t === 'drill' || t === 'spot drill' || t === 'center drill') return 'drill';
  if (t.includes('engrav')) return 'vbit';
  return null;
}

function coolantOf(value: unknown): ToolPreset['coolant'] {
  const v = String(value ?? 'disabled').toLowerCase();
  if (v === 'disabled' || v === 'off') return 'off';
  if (v === 'mist' || v === 'air') return 'mist';
  return 'flood';
}

type FusionEntry = Record<string, unknown> & { geometry?: Record<string, unknown> };

/** Fusion 360 tool library: `.json`, or `.tools` (a zip holding the same JSON). */
export function importFusionLibrary(bytes: Uint8Array, fileName: string): FusionImportResult {
  let text: string;
  if (fileName.toLowerCase().endsWith('.tools')) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new ToolLibraryError('The .tools file is not a valid archive');
    }
    const json = Object.keys(files).find((n) => n.toLowerCase().endsWith('.json'));
    if (!json) throw new ToolLibraryError('The .tools file contains no tool library');
    text = strFromU8(files[json]);
  } else text = strFromU8(bytes);
  let lib: { data?: unknown };
  try {
    lib = JSON.parse(text);
  } catch {
    throw new ToolLibraryError('The file is not valid JSON');
  }
  if (!Array.isArray(lib?.data)) throw new ToolLibraryError('This is not a Fusion 360 tool library');
  const out: FusionImportResult = { tools: [], skipped: [] };
  (lib.data as FusionEntry[]).forEach((e, index) => {
    const name = String(e.description || e['product-id'] || e.type || `Tool ${index + 1}`);
    const type = fusionType(String(e.type ?? ''));
    if (!type) return out.skipped.push({ name, reason: `Unsupported tool type "${String(e.type)}"` });
    const k = e.unit === 'inches' ? 25.4 : 1;
    const g = e.geometry ?? {};
    const n = (v: unknown) => (isNum(v) ? v : 0);
    const diameter = n(g.DC) * k;
    if (!(diameter > 0)) return out.skipped.push({ name, reason: 'No diameter' });
    const presetList = ((e['start-values'] as { presets?: Record<string, unknown>[] } | undefined)?.presets ?? []);
    const presets: ToolPreset[] = presetList.map((p) => {
      const feed = n(p.v_f) * k;
      const stepover = n(p.stepover) * k;
      return {
        name: String(p.name ?? 'Default'),
        rpm: n(p.n),
        feed,
        plungeFeed: (isNum(p.v_f_plunge) ? p.v_f_plunge * k : feed),
        stepdown: n(p.stepdown) * k || diameter / 2,
        stepoverPct: stepover > 0 ? Math.min(100, Math.max(1, (stepover / diameter) * 100)) : 40,
        coolant: coolantOf(p['tool-coolant']),
      };
    });
    const post = e['post-process'] as { number?: unknown } | undefined;
    const tool: Tool = {
      id: crypto.randomUUID(), name, type,
      number: Number.isInteger(post?.number) ? (post!.number as number) : index + 1,
      diameter, cornerRadius: n(g.RE) * k,
      tipAngleDeg: isNum(g.SIG) ? g.SIG : isNum(g.TA) ? 2 * g.TA : 0,
      fluteLength: n(g.LCF) * k || diameter * 3,
      stickout: (isNum(g.LB) ? g.LB : n(g.OAL)) * k || diameter * 5,
      flutes: n(g.NOF) || 2,
      presets,
      ...(e.vendor ? { vendor: String(e.vendor) } : {}),
      ...(e['product-id'] ? { productId: String(e['product-id']) } : {}),
    };
    out.tools.push(tool);
  });
  return out;
}
```

Check the ball tool from the fixture:
- The diameter is 0.25 in = 6.35 mm, and the corner radius is 0.125 in = 3.175 mm.
- The feed is 20 in/min = 508 mm/min, and with no `v_f_plunge` the plunge feed is also 508.
- The stepover is 0.025 in = 0.635 mm, which is 10 % of 6.35.
- The drill has no presets.

`index.ts`: append `export * from './tools/starterLibrary';` and `export * from './tools/library';`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/tools.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): starter tool library, Spon library files and Fusion 360 import"
```

---
### Task 13: Web — CAM worker API, generation pipeline, generated programs in the timeline

**Files:**
- Create: `packages/web/src/state/camTypes.ts` (types only; imported by the worker), `packages/web/src/state/cam.ts`, `packages/web/src/state/programList.ts`, `packages/web/src/state/cam.test.ts`, `packages/web/src/state/programList.test.ts`
- Modify:
  - `packages/web/src/state/store.ts`
  - `packages/web/src/workers/import.worker.ts`, `packages/web/src/workers/importClient.ts`
  - `packages/web/src/state/programs.ts` (`pruneBlobs`, `reanalyzeAll`)
  - `packages/web/src/gcode/playback.ts`, `packages/web/src/gcode/playbackLoop.ts`, `packages/web/src/hooks/useKeyboardShortcuts.ts`, `packages/web/src/dock/AnalysisView.tsx`, `packages/web/src/dock/GcodeList.tsx`, `packages/web/src/dock/BottomDock.tsx`, `packages/web/src/viewport/Toolpaths.tsx`, `packages/web/src/panels/ProgramsPanel.tsx`, `packages/web/src/App.tsx`

**Interfaces:**
- Consumes (core):
  - `generateJob`, `GenerationCache`, `postProcess`, `PostSection`, `parseProgram`, `parsedProgramTransferables`;
  - `describeGeometry`, `GeometryCatalog`;
  - `applyCommand`, `JobCommand`, `CommandError`;
  - `CamDiagnostic`, `ResolvedHeights`, `OpOverlays`, `ProgramRef`, `Diagnostic`.
- Consumes (web): `programContext`, `ProgramData`, `referencedBlobIds`, the Comlink `run()` helper.
- Produces:
  - `camTypes.ts`:
    ```ts
    export interface OperationSummary { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; overlays: OpOverlays; hasToolpath: boolean }
    export interface GeneratedFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[]; parsed: ParsedProgram; postErrors: Diagnostic[] }
    export interface CamRun { results: OperationSummary[]; files: GeneratedFile[]; catalog: GeometryCatalog | null }
    export interface CamFile { name: string; blobId: string; operationIds: string[]; sections: PostSection[]; postErrors: Diagnostic[] }
    export type CamPickTarget = 'geometry' | { height: HeightName };
    export type InspectorTab = 'geometry' | 'tool' | 'heights' | 'passes';
    ```
  - store state:
    - `generatedPrograms: ProgramRef[]`, `camFiles: CamFile[]`, `camResults: Record<string, OperationSummary>`, `catalog: GeometryCatalog | null`
    - `camStatus: 'idle' | 'generating'`, `selectedOperationId: string | null`
    - `camPick: { operationId: string; target: CamPickTarget } | null`, `inspectorTab: InspectorTab`
  - store actions:
    - `dispatch(command: JobCommand): void`: applies through `commit`; `CommandError` propagates to the caller.
    - `setCamOutput(output: CamOutput): void`, `setCamStatus(status)`
    - `selectOperation(id | null)`, `setCamPick(pick | null)`, `setInspectorTab(tab)`
  - `programList.ts`: `allPrograms(state): ProgramRef[]` (memoised, stable identity), `findProgram(state, id): ProgramRef | null`
  - `cam.ts`:
    - `interface CamOutput`, `toCamOutput(run: CamRun): CamOutput`, `regenerate(): Promise<void>`
    - `startCamPipeline(store, delayMs = 250): () => void`
    - `GEN_PREFIX = 'gen:'`
  - worker: `setCamModel(geometry: CamGeometry | null): void`, `generate(job: Job, ctx: ProgramContext): CamRun`
  - client: `setCamModelInWorker(geometry)`, `generateInWorker(job, ctx)`

Rules (plan clarifications 1, 8 and 9):
- **Generated programs.**
  - They get `id = blobId = 'gen:' + fileName`, `source: 'generated'`, `inTimeline: true`, and their `operationIds`.
  - They come first in `allPrograms` (`[...generatedPrograms, ...job.programs]`).
  - Their `ProgramData` is `{ status: 'ready', text, parsed, error: null }` under the same blobId.
- **`setCamOutput`:**
  - Replaces every `gen:` entry of `programData` and keeps imported entries.
  - Sets `generatedPrograms`, `camFiles`, `camResults` (keyed by operation id) and `catalog`, and sets `camStatus` to `'idle'`.
  - If `activeProgramId` no longer exists in `allPrograms`, it switches to the first program.
- **`loadDocument`** also clears `generatedPrograms`, `camFiles`, `camResults`, `catalog`, `selectedOperationId` and `camPick`.
- **Undo/redo:** `activeProgramIdFor` looks at `allPrograms`, not only `job.programs`.
- **Pipeline trigger:**
  - It regenerates 250 ms after any change to `job.operations`, `job.tools`, `job.post`, `job.tolerance`, `job.model`, `job.stock`, `job.wcs`, `job.machine`, `job.displayUnits`, `job.name`, or `geometry`.
  - It also runs once at start.
  - A generation counter discards stale runs.
  - With zero operations it clears the CAM output without calling the worker.
- **Model sync:** the model goes to the worker only when the `geometry` object changed since the last sync.
- **Analysis and pruning:** `reanalyzeAll` skips `gen:` blobs, because regeneration re-analyses them. `pruneBlobs` keeps the generated blob ids.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/state/programList.test.ts`:
```ts
import { addProgram, createJob, type ProgramRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { allPrograms, findProgram } from './programList';

const gen: ProgramRef = { id: 'gen:a.nc', name: 'a.nc', blobId: 'gen:a.nc', inTimeline: true, source: 'generated', operationIds: ['o1'] };

describe('allPrograms', () => {
  it('puts generated programs first and keeps a stable identity for unchanged inputs', () => {
    const job = addProgram(createJob(), { name: 'x.nc', blobId: 'p1' });
    const s = { job, generatedPrograms: [gen] };
    const a = allPrograms(s);
    expect(a.map((p) => p.id)).toEqual(['gen:a.nc', job.programs[0].id]);
    expect(allPrograms({ ...s })).toBe(a);
    expect(allPrograms({ job, generatedPrograms: [] })).not.toBe(a);
    expect(findProgram(s, 'gen:a.nc')).toBe(gen);
    expect(findProgram(s, 'nope')).toBeNull();
  });
});
```

`packages/web/src/state/cam.test.ts`: follow the mocking style of `programs-analysis.test.ts`, i.e. `vi.mock('../workers/importClient', …)` with controllable promises.
```ts
import { applyCommand, createJob, type JobCommand } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamRun } from './camTypes';

const worker = vi.hoisted(() => ({
  setCamModelInWorker: vi.fn(async () => {}),
  generateInWorker: vi.fn(),
}));
vi.mock('../workers/importClient', () => worker);

const { regenerate, toCamOutput } = await import('./cam');
const { appStore } = await import('./store');
const { allPrograms } = await import('./programList');

const parsed = { table: { count: 0 }, analysis: { summary: { totalSeconds: 3 }, diagnostics: [] }, interpretDiagnostics: [] } as never;
const run = (names: string[]): CamRun => ({
  results: [{ operationId: 'o1', diagnostics: [], heights: null, overlays: { tabs: [], laps: [], unmachined: [] }, hasToolpath: true }],
  files: names.map((name) => ({ name, text: `(${name})\n`, operationIds: ['o1'], tools: [1], sections: [{ operationId: 'o1', firstLine: 0, lastLine: 0 }], parsed, postErrors: [] })),
  catalog: null,
});
const withOp = () => applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'o1' } as JobCommand);

describe('CAM pipeline', () => {
  beforeEach(() => {
    worker.generateInWorker.mockReset();
    worker.setCamModelInWorker.mockClear();
    appStore.setState({ job: createJob(), programData: {}, generatedPrograms: [], camFiles: [], camResults: {}, activeProgramId: null });
  });

  it('maps a run to generated programs, program data and results', () => {
    const out = toCamOutput(run(['job.nc']));
    expect(out.programs).toEqual([{ id: 'gen:job.nc', name: 'job.nc', blobId: 'gen:job.nc', inTimeline: true, source: 'generated', operationIds: ['o1'] }]);
    expect(out.programData['gen:job.nc']).toMatchObject({ status: 'ready', text: '(job.nc)\n', error: null });
    expect(Object.keys(out.results)).toEqual(['o1']);
  });

  it('installs the newest run, activates it and drops stale runs', async () => {
    appStore.setState({ job: withOp() });
    let first!: (r: CamRun) => void;
    worker.generateInWorker.mockImplementationOnce(() => new Promise((res) => (first = res)));
    worker.generateInWorker.mockImplementationOnce(async () => run(['new.nc']));
    const a = regenerate();
    const b = regenerate();
    await b;
    first(run(['old.nc']));
    await a;
    const s = appStore.getState();
    expect(allPrograms(s).map((p) => p.id)).toEqual(['gen:new.nc']);
    expect(s.activeProgramId).toBe('gen:new.nc');
    expect(Object.keys(s.programData)).toEqual(['gen:new.nc']);
    expect(s.camStatus).toBe('idle');
  });

  it('clears the output without calling the worker when there are no operations', async () => {
    appStore.setState({ generatedPrograms: toCamOutput(run(['x.nc'])).programs, programData: toCamOutput(run(['x.nc'])).programData });
    await regenerate();
    expect(worker.generateInWorker).not.toHaveBeenCalled();
    expect(appStore.getState().generatedPrograms).toEqual([]);
    expect(appStore.getState().programData).toEqual({});
  });

  it('sends the model to the worker only when the geometry object changes', async () => {
    const geometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() } as never; // a fresh object
    appStore.setState({ job: withOp(), geometry });
    worker.generateInWorker.mockResolvedValue(run([]));
    await regenerate();
    await regenerate();
    expect(worker.setCamModelInWorker).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @sponcam/web exec vitest run src/state/programList.test.ts src/state/cam.test.ts`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `programList.ts`, `camTypes.ts` and the store changes**

`programList.ts`:
```ts
import type { ProgramRef } from '@sponcam/core';
import type { AppState } from './store';

type ProgramSources = Pick<AppState, 'job' | 'generatedPrograms'>;
const cache = new WeakMap<readonly ProgramRef[], WeakMap<readonly ProgramRef[], ProgramRef[]>>();

/** Generated programs first (machining order), then imported ones. Same inputs → same array (safe in selectors). */
export function allPrograms(s: ProgramSources): ProgramRef[] {
  let inner = cache.get(s.generatedPrograms);
  if (!inner) cache.set(s.generatedPrograms, (inner = new WeakMap()));
  let list = inner.get(s.job.programs);
  if (!list) inner.set(s.job.programs, (list = [...s.generatedPrograms, ...s.job.programs]));
  return list;
}

export function findProgram(s: ProgramSources, id: string | null): ProgramRef | null {
  return id === null ? null : (allPrograms(s).find((p) => p.id === id) ?? null);
}
```

`camTypes.ts`: exactly the interfaces listed under **Produces**. Import only types from `@sponcam/core`, so the worker bundle stays free of React.

`store.ts`:
- Add the state fields with their initial values (`[]`, `[]`, `{}`, `null`, `'idle'`, `null`, `null`, `'geometry'`).
- `dispatch(command)`: `get().commit((job) => applyCommand(job, command))`.
- `setCamOutput(out)`:
  ```ts
  setCamOutput(out) {
    const kept = Object.fromEntries(Object.entries(get().programData).filter(([id]) => !id.startsWith('gen:')));
    const next = { generatedPrograms: out.programs, camFiles: out.files, camResults: out.results, catalog: out.catalog, camStatus: 'idle' as const, programData: { ...kept, ...out.programData } };
    const programs = allPrograms({ job: get().job, generatedPrograms: out.programs });
    const active = get().activeProgramId;
    set({ ...next, activeProgramId: active !== null && programs.some((p) => p.id === active) ? active : (programs[0]?.id ?? null) });
  },
  ```
- `activeProgramIdFor(job, active)` becomes `activeProgramIdFor(programs: ProgramRef[], active)`. Undo and redo pass `allPrograms({ job: previous, generatedPrograms: get().generatedPrograms })`.
- `loadDocument` also resets the CAM fields.
- Add `setCamStatus`, `selectOperation` (which also sets `camPick: null` when the id changes), `setCamPick` and `setInspectorTab`.

- [ ] **Step 4: Implement the worker API and the client**

In `import.worker.ts` (keep the existing API members):
```ts
import {
  type CamGeometry, describeGeometry, GenerationCache, generateJob, type GeometryCatalog, type Job, parsedProgramTransferables,
  parseProgram, postProcess, type ProgramContext,
} from '@sponcam/core';
import type { CamRun } from '../state/camTypes';

let camGeometry: CamGeometry | null = null;
const camCache = new GenerationCache();
let catalogKey = '';
let catalog: GeometryCatalog | null = null;

// inside `api`:
  /** Keeps a copy of the loaded model for CAM (sent once per model load). */
  setCamModel(geometry: CamGeometry | null): void {
    camGeometry = geometry;
    catalogKey = '';
  },
  /** Generates, posts, parses and analyses every operation; returns summaries, files and the geometry catalog. */
  generate(job: Job, ctx: ProgramContext): CamRun {
    const results = generateJob(job, camGeometry, camCache);
    const toolpaths = results.flatMap((r) => (r.toolpath ? [r.toolpath] : []));
    const files = postProcess(job, toolpaths).map((f) => {
      const parsed = parseProgram(new TextEncoder().encode(f.text), ctx);
      return { ...f, parsed, postErrors: parsed.interpretDiagnostics.filter((d) => d.severity === 'error') };
    });
    const key = JSON.stringify([job.model, job.stock, job.wcs, job.tolerance]);
    if (key !== catalogKey) {
      catalog = camGeometry && job.model ? describeGeometry(job, camGeometry) : null;
      catalogKey = key;
    }
    const summaries = results.map(({ operationId, diagnostics, heights, overlays, toolpath }) => ({ operationId, diagnostics, heights, overlays, hasToolpath: toolpath !== null }));
    return Comlink.transfer({ results: summaries, files, catalog }, files.flatMap((f) => parsedProgramTransferables(f.parsed)));
  },
```
In `importClient.ts`:
```ts
/** Copies the model into the worker for CAM (the main thread keeps its own). */
export function setCamModelInWorker(geometry: CamGeometry | null): Promise<void> {
  return run((api) => api.setCamModel(geometry), 'Sending the model to the CAM worker timed out');
}
export function generateInWorker(job: Job, ctx: ProgramContext): Promise<CamRun> {
  return run((api) => api.generate(job, ctx), 'Generating toolpaths timed out');
}
```
The web `ModelGeometry` already has this shape. Its extra fields (for example `diagnostics`) are structured-cloned harmlessly.

- [ ] **Step 5: Implement `cam.ts`**

```ts
import type { ProgramRef } from '@sponcam/core';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand/vanilla';
import { generateInWorker, setCamModelInWorker } from '../workers/importClient';
import type { CamFile, CamRun, OperationSummary } from './camTypes';
import { programContext } from './programContext';
import { type AppState, appStore, type ModelGeometry, type ProgramData } from './store';

export const GEN_PREFIX = 'gen:';

export interface CamOutput {
  programs: ProgramRef[];
  files: CamFile[];
  results: Record<string, OperationSummary>;
  programData: Record<string, ProgramData>;
  catalog: CamRun['catalog'];
}

export const EMPTY_CAM_OUTPUT: CamOutput = { programs: [], files: [], results: {}, programData: {}, catalog: null };

export function toCamOutput(run: CamRun): CamOutput {
  const id = (name: string) => `${GEN_PREFIX}${name}`;
  return {
    programs: run.files.map((f) => ({ id: id(f.name), name: f.name, blobId: id(f.name), inTimeline: true, source: 'generated' as const, operationIds: f.operationIds })),
    files: run.files.map((f) => ({ name: f.name, blobId: id(f.name), operationIds: f.operationIds, sections: f.sections, postErrors: f.postErrors })),
    results: Object.fromEntries(run.results.map((r) => [r.operationId, r])),
    programData: Object.fromEntries(run.files.map((f) => [id(f.name), { status: 'ready' as const, text: f.text, parsed: f.parsed, error: null }])),
    catalog: run.catalog,
  };
}

let generation = 0;
let sentGeometry: ModelGeometry | null | undefined;

export async function regenerate(): Promise<void> {
  const gen = ++generation;
  const s = appStore.getState();
  if (!s.job.operations.length) {
    if (s.generatedPrograms.length || Object.keys(s.camResults).length) s.setCamOutput(EMPTY_CAM_OUTPUT);
    return;
  }
  s.setCamStatus('generating');
  try {
    if (s.geometry !== sentGeometry) {
      await setCamModelInWorker(s.geometry);
      sentGeometry = s.geometry;
    }
    const result = await generateInWorker(s.job, programContext(s.job, s.geometry));
    if (gen !== generation) return;
    appStore.getState().setCamOutput(toCamOutput(result));
  } catch (err) {
    if (gen !== generation) return;
    appStore.getState().setCamStatus('idle');
    toast.error(`Toolpath generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Regenerates `delayMs` after anything that affects toolpaths changes, and once at start. Returns a stop function. */
export function startCamPipeline(store: StoreApi<AppState>, delayMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void regenerate(), delayMs);
  };
  const unsubscribe = store.subscribe((s, prev) => {
    const a = s.job, b = prev.job;
    if (
      a.operations !== b.operations || a.tools !== b.tools || a.post !== b.post || a.tolerance !== b.tolerance || a.model !== b.model ||
      a.stock !== b.stock || a.wcs !== b.wcs || a.machine !== b.machine || a.displayUnits !== b.displayUnits || a.name !== b.name ||
      s.geometry !== prev.geometry
    ) schedule();
  });
  schedule();
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
```
`App.tsx`: start `startCamPipeline(appStore)` next to `startProgramAnalysis`, and stop it in the same cleanup. Base `isEmpty` on `allPrograms(s).length === 0` as well as the model.

- [ ] **Step 6: Switch the program-list consumers to `allPrograms`**

Replace every read of `s.job.programs` that is about *what to play or show* with `allPrograms(s)` or `findProgram(s, id)`:
- `gcode/playback.ts`: `useTimeline` and `playbackCursor` (pass the program list in), `movePlayhead`, `activateProgram`, `seekToLine`;
- `gcode/playbackLoop.ts`;
- `hooks/useKeyboardShortcuts.ts`;
- `dock/AnalysisView.tsx`, `dock/GcodeList.tsx`, `dock/BottomDock.tsx`;
- `viewport/Toolpaths.tsx`;
- `panels/ProgramsPanel.tsx`.

Selectors must return a stable value: use `useApp((s) => allPrograms(s))`, never an inline spread.

`ProgramsPanel`:
- Generated rows show a "generated" badge (`data-testid="program-generated"`). They have no checkbox, reorder or remove buttons.
- Imported rows keep their controls, acting on `job.programs` as before.

`state/programs.ts`:
- In `pruneBlobs`, keep `state().generatedPrograms.map((p) => p.blobId)` as well.
- In `reanalyzeAll`, skip blob ids that start with `GEN_PREFIX`.
- `documents.ts` is unchanged: it reads and writes `job.programs`, which only hold imported programs.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build && pnpm e2e`
Expected: all pass. The existing Milestone 1 and 2 e2e tests must stay green, because nothing changes when a job has no operations.

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(web): CAM generation pipeline in the worker; generated programs join the timeline"
```

---

### Task 14: Web — global tool library (IndexedDB) and the tool library dialog

**Files:**
- Create: `packages/web/src/state/toolLibrary.ts`, `packages/web/src/state/toolLibrary.test.ts`, `packages/web/src/tools/ToolLibraryDialog.tsx`, `packages/web/src/tools/ToolSketch.tsx`
- Modify: `packages/web/src/layout/TopBar.tsx` (a "Tools" button), `packages/web/src/App.tsx` (load the library at start)

**Interfaces:**
- Consumes (core): `starterLibrary`, `validateTool`, `exportToolLibrary`, `importToolLibrary`, `importFusionLibrary`, `ToolLibraryError`, `Tool`, `ToolPreset`, `TOOL_TYPES`, `MATERIALS`.
- Produces:
  - `toolLibraryStore` (a zustand vanilla store `{ tools: Tool[]; loaded: boolean }`) and `useToolLibrary(): Tool[]`
  - `loadToolLibrary(): Promise<void>`: seeds the starter library on first run
  - `saveLibraryTool(tool): Promise<void>`, `deleteLibraryTool(id): Promise<void>`, `resetStarterLibrary(): Promise<void>`
  - `importLibraryFile(file: File): Promise<{ imported: number; skipped: { name: string; reason: string }[] }>`: detects Fusion (`.tools`, or JSON with a `data` array) or Spon (`format: 'spon-tools'`)
  - `exportLibraryFile(): void`: downloads `spon-tools.json`
  - `defaultToolFor(type: OperationType, tools: readonly Tool[]): Tool | null`: profile and pocket use `starter-flat-6` if present, else the first flat, bull or ball tool; drill uses `starter-drill-6` if present, else the first drill
  - test ids:
    - `open-tool-library`, `tool-library`, `tool-search`, `tool-type-filter`, `library-tool-<id>`;
    - `tool-add`, `tool-edit-<id>`, `tool-delete-<id>`, `tool-import-input`, `tool-export`, `tool-reset`;
    - form: `tool-form`, `tool-field-<name|type|number|diameter|cornerRadius|tipAngleDeg|fluteLength|stickout|flutes>`, `preset-row-<i>`, `preset-add`, `tool-save`, `tool-cancel`

Storage: a separate IndexedDB database `spon-tools`, version 1, with stores `tools` (key = tool id) and `meta` (key `seeded` → `true`). A separate database keeps the autosave schema untouched. IndexedDB failures are logged and shown as a toast, never thrown into React.

- [ ] **Step 1: Write the failing test**

`packages/web/src/state/toolLibrary.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { exportToolLibrary, starterLibrary } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { defaultToolFor, deleteLibraryTool, importLibraryFile, loadToolLibrary, resetStarterLibrary, saveLibraryTool, toolLibraryStore } from './toolLibrary';

const tools = () => toolLibraryStore.getState().tools;

describe('tool library', () => {
  it('seeds the starter library once, then keeps user changes', async () => {
    await loadToolLibrary();
    expect(tools().map((t) => t.id)).toEqual(starterLibrary().map((t) => t.id));
    await deleteLibraryTool('starter-flat-3');
    await saveLibraryTool({ ...starterLibrary()[1], id: 'mine', name: 'My 6 mm', number: 20 });
    await loadToolLibrary();
    expect(tools().some((t) => t.id === 'starter-flat-3')).toBe(false);
    expect(tools().at(-1)?.id).toBe('mine'); // sorted by T number
    await resetStarterLibrary();
    expect(tools().some((t) => t.id === 'starter-flat-3')).toBe(true);
    expect(tools().some((t) => t.id === 'mine')).toBe(true);
  });

  it('imports Spon and Fusion files', async () => {
    await loadToolLibrary();
    const spon = new File([exportToolLibrary([{ ...starterLibrary()[0], id: 'imported', number: 30 }])], 'lib.json');
    expect(await importLibraryFile(spon)).toEqual({ imported: 1, skipped: [] });
    const fusion = new File([JSON.stringify({ data: [{ type: 'probe', description: 'Probe' }] })], 'f.json');
    expect(await importLibraryFile(fusion)).toEqual({ imported: 0, skipped: [{ name: 'Probe', reason: 'Unsupported tool type "probe"' }] });
  });

  it('picks default tools per operation type', () => {
    const lib = starterLibrary();
    expect(defaultToolFor('pocket', lib)?.id).toBe('starter-flat-6');
    expect(defaultToolFor('drill', lib)?.id).toBe('starter-drill-6');
    expect(defaultToolFor('drill', lib.filter((t) => t.type !== 'drill'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/web exec vitest run src/state/toolLibrary.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `state/toolLibrary.ts`**

```ts
import {
  exportToolLibrary, importFusionLibrary, importToolLibrary, type OperationType, starterLibrary, type Tool, validateTool,
} from '@sponcam/core';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface ToolDb extends DBSchema {
  tools: { key: string; value: Tool };
  meta: { key: string; value: boolean };
}

let connection: Promise<IDBPDatabase<ToolDb>> | null = null;
const db = () =>
  (connection ??= openDB<ToolDb>('spon-tools', 1, {
    upgrade(d) {
      d.createObjectStore('tools');
      d.createObjectStore('meta');
    },
  }));

export const toolLibraryStore = createStore<{ tools: Tool[]; loaded: boolean }>(() => ({ tools: [], loaded: false }));
export const useToolLibrary = (): Tool[] => useStore(toolLibraryStore, (s) => s.tools);

async function refresh(): Promise<void> {
  const all = await (await db()).getAll('tools');
  toolLibraryStore.setState({ tools: all.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name)), loaded: true });
}

export async function loadToolLibrary(): Promise<void> {
  const d = await db();
  if (!(await d.get('meta', 'seeded'))) {
    const tx = d.transaction(['tools', 'meta'], 'readwrite');
    for (const t of starterLibrary()) await tx.objectStore('tools').put(t, t.id);
    await tx.objectStore('meta').put(true, 'seeded');
    await tx.done;
  }
  await refresh();
}

export async function saveLibraryTool(tool: Tool): Promise<void> {
  if (!validateTool(tool)) throw new Error('The tool has invalid values');
  await (await db()).put('tools', tool, tool.id);
  await refresh();
}

export async function deleteLibraryTool(id: string): Promise<void> {
  await (await db()).delete('tools', id);
  await refresh();
}

/** Restores the starter tools (overwriting edits to them); user tools are kept. */
export async function resetStarterLibrary(): Promise<void> {
  const tx = (await db()).transaction('tools', 'readwrite');
  for (const t of starterLibrary()) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
}

export async function importLibraryFile(file: File): Promise<{ imported: number; skipped: { name: string; reason: string }[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const isSpon = !file.name.toLowerCase().endsWith('.tools') && text.includes('"spon-tools"');
  const result = isSpon ? { tools: importToolLibrary(text), skipped: [] } : importFusionLibrary(bytes, file.name);
  const tx = (await db()).transaction('tools', 'readwrite');
  for (const t of result.tools) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
  return { imported: result.tools.length, skipped: result.skipped };
}

export function exportLibraryFile(): void {
  const blob = new Blob([exportToolLibrary(toolLibraryStore.getState().tools)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spon-tools.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function defaultToolFor(type: OperationType, tools: readonly Tool[]): Tool | null {
  if (type === 'drill') return tools.find((t) => t.id === 'starter-drill-6') ?? tools.find((t) => t.type === 'drill') ?? null;
  return tools.find((t) => t.id === 'starter-flat-6') ?? tools.find((t) => t.type === 'flat' || t.type === 'bull' || t.type === 'ball') ?? null;
}
```

- [ ] **Step 4: Build `ToolLibraryDialog` and `ToolSketch`**

`ToolSketch.tsx`: an SVG (120 × 160 viewBox) of the tool's side profile, derived from its values:
- the shank above the flutes;
- for `flat`, a rectangle of width `diameter` and height `fluteLength`;
- for `ball`, the same with a semicircular end, and for `bull`, a rounded end of radius `cornerRadius`;
- for `vbit` and `chamfer`, a triangle from the diameter down to the tip at `tipAngleDeg`;
- for `drill`, a rectangle plus the 118° (or `tipAngleDeg`) point.

Scale the drawing to fit. Use `stroke="currentColor"`, with no fill colour beyond `fill-muted`.

`ToolLibraryDialog.tsx`, built on the existing `Dialog` component (`components/ui/dialog.tsx`):
- **Opening:** `open` state lives in the component, and the TopBar button `open-tool-library` (Wrench icon, label "Tools") opens it.
- **Header:** a search input, a type filter (a native `<select>` styled like `machine-preset`, options "All" plus `TOOL_TYPES`), and the buttons Add, Import (a hidden file input accepting `.json,.tools`), Export and Reset starter.
  - A successful import shows a `toast.success` like "Imported 12 tools; 2 skipped" (with the skip reasons in the description).
  - A failed import shows `toast.error` with the error message.
  - **Reset starter** asks for confirmation through a second small `Dialog`: "Restore the starter tools? Your own tools are kept."
- **Table:** one row per tool (`library-tool-<id>`) showing `T<number>`, name, type, `Ø` diameter (formatted with `formatLength` in the job's display units), and Edit / Delete buttons.
- **Form:** Add and Edit switch the dialog body to the form (`tool-form`):
  - `LengthField` / `NumericField` for the lengths and numbers, and a `<select>` for the type;
  - the `ToolSketch` updating live;
  - the presets table, one row per preset (`preset-row-<i>`): a name input, NumericFields for rpm, feed, plunge feed, stepdown and stepover %, a coolant `<select>`, and a remove button. `preset-add` appends a copy of the last row, or defaults: `{ name: MATERIALS[0], rpm: 18000, feed: 1000, plungeFeed: 300, stepdown: 1, stepoverPct: 40, coolant: 'off' }`.
  - **Save** calls `saveLibraryTool`. A new tool gets `crypto.randomUUID()` as its id and the next free T number. Invalid values show `toast.error('Check the tool values')` and keep the form open.
- **Library vs job tools:** editing a library tool never touches job tools (spec §3.2).

`App.tsx`: call `void loadToolLibrary().catch((e) => console.error('Could not load the tool library', e))` once, in the existing start effect.

- [ ] **Step 5: Run the tests, the typecheck and the build**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: PASS.

Manual check with `pnpm dev`:
1. Open Tools; the 10 starter tools are listed.
2. Edit the 6 mm flat's name and save; the row updates.
3. Delete a tool, then Reset starter; the tool is back.
4. Import a small Fusion JSON; the toast reports it.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): global tool library with starter tools, Fusion import and editor dialog"
```

---

### Task 15: Web — Operations panel, Post panel and operation keyboard shortcuts

**Files:**
- Create: `packages/web/src/panels/OperationsPanel.tsx`, `packages/web/src/panels/PostPanel.tsx`, `packages/web/src/state/camView.ts`, `packages/web/src/state/camView.test.ts`
- Modify: `packages/web/src/layout/LeftPanel.tsx`, `packages/web/src/hooks/useKeyboardShortcuts.ts`

**Interfaces:**
- Consumes: store `dispatch`, `selectOperation`, `setCamPick`, `setInspectorTab`, `camResults`, `camFiles`, `camStatus`, `programData`; `useToolLibrary`, `defaultToolFor`; core `OPERATION_LABELS`, `DIALECT_IDS`, `DIALECTS`, `defaultPostSettings`, `CommandError`; `formatDuration` (panels/format).
- Produces:
  - `camView.ts`:
    - `operationStatus(op, state): 'generating' | 'ok' | 'warning' | 'error' | 'disabled'`
    - `operationSeconds(opId, state): number | null`: the sum of row durations of the operation's section in its generated program
    - `addOperation(type: OperationType): void`: copies the default library tool into the job if missing, dispatches `addOperation`, selects the new operation, opens the Geometry tab and starts pick mode
    - `runCommand(command): boolean`: dispatches and shows a `CommandError` as a toast; returns success
  - test ids:
    - Operations panel: `operations-panel`, `add-op`, `add-op-profile|pocket|drill`, `op-row-<index>` (with `data-selected` and `data-status`), `op-enabled`, `op-name`, `op-tool`, `op-time`, `op-status`, `op-up`, `op-down`, `op-duplicate`, `op-delete`
    - Post panel: `post-dialect`, `post-split`, `post-decimals`, `post-arc`, `post-line-numbers`, `post-coolant`, `post-spindle-dwell`, `post-safe-start`, `post-program-number`, `post-extension`, `post-tolerance`

- [ ] **Step 1: Write the failing test**

`packages/web/src/state/camView.test.ts`:
```ts
import { applyCommand, createJob, type JobCommand, starterLibrary } from '@sponcam/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addOperation, operationSeconds, operationStatus, runCommand } from './camView';
import { appStore } from './store';
import { toolLibraryStore } from './toolLibrary';

describe('camView', () => {
  beforeEach(() => {
    appStore.setState({ job: createJob(), camResults: {}, camFiles: [], programData: {}, camStatus: 'idle', selectedOperationId: null, camPick: null, past: [], future: [] });
    toolLibraryStore.setState({ tools: starterLibrary(), loaded: true });
  });

  it('adds an operation with the default library tool copied into the job, selected and picking', () => {
    addOperation('pocket');
    const s = appStore.getState();
    expect(s.job.tools.map((t) => t.id)).toEqual(['starter-flat-6']);
    expect(s.job.operations[0]).toMatchObject({ type: 'pocket', toolId: 'starter-flat-6', name: 'Pocket 1' });
    expect(s.selectedOperationId).toBe(s.job.operations[0].id);
    expect(s.inspectorTab).toBe('geometry');
    expect(s.camPick).toEqual({ operationId: s.job.operations[0].id, target: 'geometry' });
    addOperation('profile');
    expect(appStore.getState().job.tools).toHaveLength(1); // the tool is already in the job
    expect(appStore.getState().past).toHaveLength(3); // addTool, addOperation, addOperation — each undoable
  });

  it('reports status from results and the pipeline state', () => {
    const job = applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' } as JobCommand);
    appStore.setState({ job });
    const op = job.operations[0];
    expect(operationStatus(op, appStore.getState())).toBe('ok');
    appStore.setState({ camResults: { d: { operationId: 'd', diagnostics: [{ operationId: 'd', severity: 'warning', code: 'tool-undersize', message: '' }], heights: null, overlays: { tabs: [], laps: [], unmachined: [] }, hasToolpath: true } } });
    expect(operationStatus(op, appStore.getState())).toBe('warning');
    appStore.setState({ camStatus: 'generating' });
    expect(operationStatus(op, appStore.getState())).toBe('generating');
    expect(operationStatus({ ...op, enabled: false }, appStore.getState())).toBe('disabled');
  });

  it('sums the row durations inside an operation section', () => {
    const table = { count: 3, line: new Uint32Array([1, 2, 5]), t: new Float64Array([1, 3, 10]) };
    appStore.setState({
      camFiles: [{ name: 'a.nc', blobId: 'gen:a.nc', operationIds: ['d'], sections: [{ operationId: 'd', firstLine: 0, lastLine: 2 }], postErrors: [] }],
      programData: { 'gen:a.nc': { status: 'ready', text: '', parsed: { table } as never, error: null } },
    });
    expect(operationSeconds('d', appStore.getState())).toBe(3); // rows on lines 1 and 2: 1 + 2 seconds
    expect(operationSeconds('other', appStore.getState())).toBeNull();
  });

  it('turns command errors into a false result instead of throwing', () => {
    expect(runCommand({ type: 'removeOperation', id: 'missing' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/web exec vitest run src/state/camView.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `state/camView.ts`**

```ts
import { CommandError, type JobCommand, type Operation, type OperationType } from '@sponcam/core';
import { toast } from 'sonner';
import { type AppState, appStore } from './store';
import { defaultToolFor, toolLibraryStore } from './toolLibrary';

export type OperationStatus = 'generating' | 'ok' | 'warning' | 'error' | 'disabled';

export function operationStatus(op: Operation, s: Pick<AppState, 'camResults' | 'camStatus'>): OperationStatus {
  if (!op.enabled) return 'disabled';
  if (s.camStatus === 'generating') return 'generating';
  const d = s.camResults[op.id]?.diagnostics ?? [];
  return d.some((x) => x.severity === 'error') ? 'error' : d.length ? 'warning' : 'ok';
}

/** Estimated seconds of an operation: sum of row durations whose source line lies in its section. */
export function operationSeconds(opId: string, s: Pick<AppState, 'camFiles' | 'programData'>): number | null {
  for (const f of s.camFiles) {
    const section = f.sections.find((x) => x.operationId === opId);
    const table = s.programData[f.blobId]?.parsed?.table;
    if (!section || !table) continue;
    let total = 0;
    for (let i = 0; i < table.count; i++) {
      const line = table.line[i];
      if (line >= section.firstLine && line <= section.lastLine) total += table.t[i] - (i > 0 ? table.t[i - 1] : 0);
    }
    return total;
  }
  return null;
}

export function runCommand(command: JobCommand): boolean {
  try {
    appStore.getState().dispatch(command);
    return true;
  } catch (err) {
    if (err instanceof CommandError) {
      toast.error(err.message);
      return false;
    }
    throw err;
  }
}

export function addOperation(type: OperationType): void {
  const s = appStore.getState();
  const lib = defaultToolFor(type, toolLibraryStore.getState().tools);
  const inJob = lib ? s.job.tools.find((t) => t.id === lib.id) : undefined;
  if (lib && !inJob && !runCommand({ type: 'addTool', tool: lib })) return;
  const id = crypto.randomUUID();
  if (!runCommand({ type: 'addOperation', opType: type, toolId: lib?.id ?? null, id })) return;
  const next = appStore.getState();
  next.selectOperation(id);
  next.setInspectorTab('geometry');
  next.setCamPick({ operationId: id, target: 'geometry' });
}
```

- [ ] **Step 4: Build `OperationsPanel` and `PostPanel`**

`OperationsPanel` is a `PanelSection` titled "Operations", with `defaultOpen`.

**Add button** (`add-op`, Plus icon): opens a `Popover` with three buttons (`add-op-profile`, `add-op-pocket`, `add-op-drill`), each calling `addOperation(type)`.

**Rows** (`op-row-<index>`, clickable, `data-selected` when it is `selectedOperationId`, `data-status` = `operationStatus`):
- a checkbox (`op-enabled`): `runCommand({ type: 'setOperationEnabled', … })`;
- a lucide icon per type: `Scissors` for profile, `SquareDashed` for pocket, `Circle` for drill;
- the name (`op-name`);
- the tool label (`op-tool`): `T<number> · <tool name>`, or "No tool" in the destructive colour;
- the time (`op-time`): `formatDuration(operationSeconds(...))`, or "–";
- the status badge (`op-status`):
  - generating: a spinning `Loader2`;
  - ok: `Check`, in green;
  - warning: `TriangleAlert`, in amber;
  - error: `CircleX`, in red;
  - disabled: a muted "off";
- buttons: `op-up` / `op-down` (moveOperation), `op-duplicate` (duplicateOperation with a new id, then select it), `op-delete` (removeOperation, then clear the selection).

Button clicks call `stopPropagation`, so they don't select the row.

`PostPanel` is a `PanelSection` titled "Post", closed by default. The rows follow `MachinePanel`'s layout:
- **Dialect** (`post-dialect`): a native select over `DIALECT_IDS` with `DIALECTS[id].name`. On change: `runCommand({ type: 'setPost', patch: { ...defaultPostSettings(id), programNumber: current.programNumber } })`.
- **Split by tool** (`post-split`): a checkbox.
- **Decimals** (`post-decimals`): a `NumericField`, integers 2–5.
- **Arc format** (`post-arc`): a `ToggleGroup type="single"` with `ij` / `r`.
- **Line numbers** (`post-line-numbers`) and **Coolant** (`post-coolant`): checkboxes.
- **Spindle dwell** (`post-spindle-dwell`): seconds, ≥ 0.
- **Safe start** (`post-safe-start`): an `Input`, committed on blur.
- **Program number** (`post-program-number`): integer 1–9999, shown only for Fanuc.
- **Extension** (`post-extension`): a select with nc, gcode or tap.
- **Tolerance** (`post-tolerance`): `LengthField` in mm; `runCommand({ type: 'setTolerance', … })`.

Under the dialect select, show a muted help line, e.g. "Fanuc G82 dwell is written in milliseconds; the time estimate treats it as seconds" (plan clarification 6).

`LeftPanel`: render `OperationsPanel` and `PostPanel` after `WcsPanel` and before `ProgramsPanel`. The order is Model, Orientation, Stock, WCS, Operations, Post, Programs, Machine.

`useKeyboardShortcuts` (not while typing; after the undo/redo branch):
- `Delete` with a selected operation: `runCommand({ type: 'removeOperation', id })`, then `selectOperation(null)`.
- `Ctrl/Cmd+D` with a selected operation: `preventDefault()`, `duplicateOperation`, then select the copy.
- `Escape`: if `camPick` is set, `setCamPick(null)`. Keep the existing lay-flat pick-mode handling.

- [ ] **Step 5: Run the tests, the typecheck and the build**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: PASS.

Manual check (`pnpm dev`, with `cam-part.dxf` opened):
1. Add a Profile: a row appears, selected, with "T2 · 6 mm flat end mill".
2. Reorder, duplicate, disable and delete work.
3. Ctrl+Z undoes each of those.
4. Changing the dialect changes the post settings.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): operations and post panels with undoable commands and shortcuts"
```

---
### Task 16: Web — operation inspector (Geometry, Tool, Heights, Passes & linking)

**Files:**
- Create:
  - `packages/web/src/inspector/Inspector.tsx`, `packages/web/src/inspector/GeometryTab.tsx`, `packages/web/src/inspector/ToolTab.tsx`, `packages/web/src/inspector/HeightsTab.tsx`, `packages/web/src/inspector/PassesTab.tsx`
  - `packages/web/src/inspector/geometryLabels.ts`, `packages/web/src/inspector/geometryLabels.test.ts`
- Modify: `packages/web/src/App.tsx` (render `<Inspector />` to the right of `<main>`)

**Interfaces:**
- Consumes: store (`selectedOperationId`, `inspectorTab`, `camPick`, `camResults`, `catalog`, `job`), `runCommand`, `useToolLibrary`; core `HEIGHT_FROM`, `HEIGHT_NAMES`, `GeometryRef`, `formatLength`, `parseLength`, `circleOf`; `NumericField`, `LengthField`, `ToggleGroup`, `Dialog`.
- Produces:
  - `geometryLabels.ts`:
    - `refLabel(ref: GeometryRef, catalog: GeometryCatalog | null, drawingLayers: string[] | null, units: LengthUnit): string`
    - `sameRef(a: GeometryRef, b: GeometryRef): boolean`
    - `toggleRef(list: GeometryRef[], ref: GeometryRef): GeometryRef[]`
  - test ids:
    - panel and tabs: `inspector`, `inspector-close`, `op-name-input`, `inspector-tab-geometry|tool|heights|passes`
    - Geometry tab: `geo-ref-<i>` (`data-status` ok|error), `geo-remove-<i>`, `pick-geometry` (`data-state` on/off), `catalog-list`, `catalog-contour-<layerName>-<path>`, `catalog-face-<i>`, `catalog-hole-<i>`, `drill-filter`, `drill-filter-min`, `drill-filter-max`
    - Tool tab: `op-tool-select`, `op-tool-library`, `op-preset`, `op-rpm`, `op-feed`, `op-plunge`, `op-coolant`
    - Heights tab: `height-<name>`, `height-<name>-from`, `height-<name>-offset`, `height-<name>-value`, `height-<name>-pick`
    - Passes tab: `pass-<field>` for each parameter: `pass-side`, `pass-direction`, `pass-stepdown`, `pass-stepover`, `pass-stock-radial`, `pass-stock-axial`, `pass-finish`, `pass-finish-walls`, `pass-finish-floor`, `pass-entry`, `pass-helix`, `pass-ramp`, `pass-leads`, `pass-lead-length`, `pass-tabs`, `pass-tab-shape`, `pass-tab-width`, `pass-tab-height`, `pass-tab-placement`, `pass-tab-count`, `pass-tab-spacing`, `pass-tab-reset`, `pass-cycle`, `pass-peck`, `pass-dwell`

Plan clarification 13: the Geometry tab has a **geometry list** built from `describeGeometry` (the `catalog` in the store) as well as viewport picking. It lists DXF contours by layer, up-facing faces with their Z, and round holes with Ø and depth. Ticking an entry adds or removes the reference, like a viewport click. This is the non-viewport picking of spec §8a, and it makes the e2e tests deterministic.

- [ ] **Step 1: Write the failing test**

`packages/web/src/inspector/geometryLabels.test.ts`:
```ts
import type { GeometryRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { refLabel, sameRef, toggleRef } from './geometryLabels';

const face = { kind: 'meshFace' as const, blobId: 'm', seed: 7, normal: { x: 0, y: 0, z: 1 }, point: { x: 0, y: 0, z: 0 } };
const catalog = {
  faces: [{ ref: face, z: -4, area: 600, loops: [{ index: 0, kind: 'outer' as const, length: 100, circle: null }, { index: 1, kind: 'hole' as const, length: 18.8, circle: { center: { x: 30, y: 30 }, diameter: 6 } }] }],
  contours: [], holes: [{ ref: { kind: 'meshHole' as const, face, loop: 1 }, center: { x: 30, y: 30 }, diameter: 6, top: -4, bottom: -7, through: false }],
};

describe('geometry labels', () => {
  it('describes references in the job units', () => {
    expect(refLabel({ kind: 'dxfPath', blobId: 'd', layer: 1, path: 3 }, null, ['OUTLINE', 'POCKET'], 'mm')).toBe('POCKET · path 4');
    expect(refLabel(face, catalog, null, 'mm')).toBe('Face at Z -4.000');
    expect(refLabel({ kind: 'meshHole', face, loop: 1 }, catalog, null, 'mm')).toBe('Hole Ø6.000 at (30.000, 30.000)');
    expect(refLabel({ kind: 'meshLoop', face, loop: 0 }, catalog, null, 'mm')).toBe('Edge loop 1 of face at Z -4.000');
    expect(refLabel({ ...face, seed: 99 }, catalog, null, 'mm')).toBe('Face (not found)');
  });

  it('compares and toggles references', () => {
    const a: GeometryRef = { kind: 'dxfPath', blobId: 'd', layer: 0, path: 0 };
    expect(sameRef(a, { ...a })).toBe(true);
    expect(sameRef({ kind: 'meshLoop', face, loop: 0 }, { kind: 'meshLoop', face: { ...face }, loop: 1 })).toBe(false);
    expect(toggleRef([a], { ...a })).toEqual([]);
    expect(toggleRef([], a)).toEqual([a]);
  });
});
```
Lengths use `formatLength(mm, units)`. For mm that is 3 decimals and no unit suffix; check `formatLength`'s current output, and keep the test aligned with it if it differs (for example trailing zeros).

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/web exec vitest run src/inspector/geometryLabels.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `geometryLabels.ts`**

```ts
import { formatLength, type GeometryCatalog, type GeometryRef, type LengthUnit, type MeshFaceRef } from '@sponcam/core';

const sameFace = (a: MeshFaceRef, b: MeshFaceRef) => a.blobId === b.blobId && a.seed === b.seed;

export function sameRef(a: GeometryRef, b: GeometryRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'dxfPath' && b.kind === 'dxfPath') return a.blobId === b.blobId && a.layer === b.layer && a.path === b.path;
  if (a.kind === 'meshFace' && b.kind === 'meshFace') return sameFace(a, b);
  if ((a.kind === 'meshLoop' || a.kind === 'meshHole') && (b.kind === 'meshLoop' || b.kind === 'meshHole')) return sameFace(a.face, b.face) && a.loop === b.loop;
  return false;
}

export function toggleRef(list: readonly GeometryRef[], ref: GeometryRef): GeometryRef[] {
  return list.some((r) => sameRef(r, ref)) ? list.filter((r) => !sameRef(r, ref)) : [...list, ref];
}

export function refLabel(ref: GeometryRef, catalog: GeometryCatalog | null, layers: string[] | null, units: LengthUnit): string {
  const L = (mm: number) => formatLength(mm, units);
  if (ref.kind === 'dxfPath') return `${layers?.[ref.layer] ?? `Layer ${ref.layer + 1}`} · path ${ref.path + 1}`;
  const faceRef = ref.kind === 'meshFace' ? ref : ref.face;
  const face = catalog?.faces.find((f) => sameFace(f.ref, faceRef));
  if (!face) return ref.kind === 'meshFace' ? 'Face (not found)' : ref.kind === 'meshHole' ? 'Hole (not found)' : 'Edge loop (not found)';
  if (ref.kind === 'meshFace') return `Face at Z ${L(face.z)}`;
  const circle = face.loops[ref.loop]?.circle;
  if (ref.kind === 'meshHole' && circle) return `Hole Ø${L(circle.diameter)} at (${L(circle.center.x)}, ${L(circle.center.y)})`;
  return `Edge loop ${ref.loop + 1} of face at Z ${L(face.z)}`;
}
```

- [ ] **Step 4: Build the inspector**

`Inspector.tsx`:
- A right-hand `<aside className="w-80 shrink-0 overflow-y-auto border-l">` (`data-testid="inspector"`), rendered only when `selectedOperationId` points to an existing operation.
- **Header:** the operation type icon and a name `Input` (`op-name-input`, committing `updateOperation { name }` on blur or Enter), plus a close button (`inspector-close` → `selectOperation(null)`).
- **Tabs:** a `ToggleGroup type="single"` (`inspector-tab-*`) bound to `inspectorTab`, followed by the active tab's component.
- **Errors:** below the tabs, the diagnostics of `camResults[op.id]` as a small list, error first. Each one shows its message. When it carries a `ref`, "(reference N)" is appended.

Every tab edits through `runCommand({ type: 'updateOperation', id, patch })`. Numeric fields use the existing `NumericField`/`LengthField`, so display units and rounding behave like the other panels.

`GeometryTab.tsx`:
- **Reference list:** each `op.geometry[i]` is a row (`geo-ref-<i>`) with `refLabel(...)`. It shows an error icon and `data-status="error"` when a `camResults` diagnostic has `ref === i` and severity error. `geo-remove-<i>` removes it.
- **Pick in viewport** (`pick-geometry`): a `Toggle` whose pressed state means `camPick?.target === 'geometry'` for this operation. It sets or clears `camPick`. A hint under it depends on the type:
  - profile: "Click paths or faces; Alt-click an edge loop";
  - pocket: "Click closed paths or pocket-floor faces";
  - drill: "Click circles, or a face to add all its holes; Alt-click one hole".
- **Geometry list** (`catalog-list`, collapsible, open by default, filtered by operation type):
  - **Drawings:** contours grouped by layer, as `catalog-contour-<layerName>-<path>` (the layer's name, then the path index within the layer), e.g. "OUTLINE · closed · 320.000". Drill operations show circles only.
  - **Meshes, profile and pocket:** faces, as `catalog-face-<i>` "Face at Z -4.000 · 600.000 mm²".
  - **Meshes, drill:** holes, as `catalog-hole-<i>` "Ø6.000 · blind to Z -7.000" or "Ø8.000 · through".
  - Each entry is a checkbox showing whether its reference is in `op.geometry` (`sameRef`). Toggling it dispatches `updateOperation { geometry: toggleRef(...) }`.
- **Diameter filter** (drill only): a checkbox `drill-filter` enables `diameterFilter`. Turning it on sets `{ min: 0, max: <largest catalog hole Ø> }`; turning it off sets `null`. Two `LengthField`s edit it: `drill-filter-min` and `drill-filter-max`.

`ToolTab.tsx`:
- **Tool select** (`op-tool-select`): a native select over `job.tools` (`T<n> · name · Ø`), plus a disabled "No tool" option when `toolId` is null. Changing the tool dispatches `updateOperation { toolId, feeds: preset0 }` using the new tool's first preset.
- **From library** (`op-tool-library`): a small `Dialog` listing library tools (search box, then rows). Picking one runs `addTool` if it isn't in the job yet, then the same update as above.
- **Preset** (`op-preset`): a select over the tool's preset names, plus "Custom". It copies rpm, feed, plunge feed and coolant into `feeds`, with `presetName` set.
- **Speeds:** `op-rpm`, `op-feed` and `op-plunge` are NumericFields. Feed fields are length per minute, formatted like `MachinePanel`'s rate fields. Editing any of them sets `presetName: null`.
- **Coolant** (`op-coolant`): off, flood or mist.

`HeightsTab.tsx`: for each `HEIGHT_NAMES` row (`height-<name>`):
- a label with a colour swatch: clearance `#f97316`, retract `#84cc16`, feed `#22c55e`, top `#38bdf8`, bottom `#1d4ed8`;
- a `From` select (`height-<name>-from`) over `HEIGHT_FROM[name]`, with readable labels:
  - "Stock top", "Stock bottom", "Model top", "Model bottom";
  - "Selected contour", "Picked face", "WCS origin (absolute)", "Hole bottom";
  - "Retract height", "Feed height", "Top height";
- an offset `LengthField` (`height-<name>-offset`);
- the resolved Z (`height-<name>-value`), read-only, from `camResults[op.id]?.heights?.[name]` formatted with `formatLength`, or "–".

When `from` is `'face'`, show a "Pick face" button (`height-<name>-pick`) that sets `camPick = { operationId, target: { height: name } }`, with the picked face's label next to it.

Changing `from` dispatches `updateOperation { heights: { [name]: { from, offset: current offset, face: current face (if any) } } }`.

`PassesTab.tsx` shows the parameters of spec §3.3 for the operation's type, using the test ids listed above:
- **Profile:**
  - side (`ToggleGroup`: outside, inside, on), direction (climb, conventional);
  - stepdown, radial and axial stock to leave, finish pass;
  - entry mode (a select), helix %, ramp angle;
  - leads mode (none, arc, line) and lead length;
  - tabs: enabled, shape, width, height, placement (count or spacing), count, spacing;
  - "Reset tab positions" (`pass-tab-reset`, sets `positions: null`), enabled only when `positions` isn't null.
- **Pocket:** direction, stepdown, stepover %, stock to leave, finish walls, finish floor, entry.
- **Drill:** cycle (a select with drill G81, dwell G82, peck G83, chip-break G73), peck (shown for peck and chip-break), dwell seconds (shown for dwell).

`App.tsx`: render `<Inspector />` right after `<main>`, inside the same flex row.

- [ ] **Step 5: Run the tests, the typecheck and the build**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: PASS.

Manual check with `cam-part.dxf`:
1. Add a Pocket and tick the five POCKET contours in the geometry list; the operation turns ok or warning, and the time appears.
2. Change the stepover; the toolpath regenerates.
3. The Heights tab shows the resolved Z values.
4. Undo reverts each edit.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): operation inspector with geometry list, tool, heights and passes tabs"
```

---

### Task 17: Web — viewport picking and CAM overlays

**Files:**
- Create: `packages/web/src/viewport/camPick.ts`, `packages/web/src/viewport/camPick.test.ts`, `packages/web/src/viewport/CamOverlays.tsx`
- Modify: `packages/web/src/viewport/ModelObject.tsx`, `packages/web/src/viewport/Viewport.tsx`, `packages/web/src/viewport/Toolpaths.tsx`

**Interfaces:**
- Consumes: core `camContext`, `resolveFaceRef`, `faceRefFromTriangle`, `nearestDxfPath`, `nearestS`, `circleOf`, `drawingPathToProgram`, `drawingPath`, `pathStart`, `pathEnd`, `flattenPath`; store `camPick`, `selectedOperationId`, `camResults`, `camFiles`, `inspectorTab`, `camStatus`; `toggleRef`, `sameRef`; `runCommand`.
- Produces:
  - `camPick.ts`:
    - `connectedDxfRefs(ctx, ref, hiddenLayers): DxfPathRef[]`: the clicked path plus every path joined to it end-to-end, transitively, within the tolerance
    - `pickDxf(op, ctx, q: Vec2, hidden): { refs: DxfPathRef[] } | { error: string }`:
      - drill: the nearest circle only;
      - profile and pocket: the connected chain;
      - nothing within 2 mm: "Nothing to pick here".
    - `pickMesh(op, ctx, tri: number, q: Vec2, alt: boolean): { refs: GeometryRef[] } | { error: string }`, following spec §8 and the table below
    - `applyPick(op, refs): GeometryRef[]`: if every ref is already present, remove them all; otherwise add the missing ones
  - test ids: `cam-pick-hint`, `heights-plane-<name>`, `tab-handle-<i>`

Picking rules (spec §8):

| Operation | DXF click | Mesh click | Mesh Alt-click |
|---|---|---|---|
| Profile | connected chain | `meshFace` (outer boundary) | `meshLoop`: the face loop nearest the click |
| Pocket | connected chain | `meshFace` | `meshFace` |
| Drill | the nearest circle | `meshFace` (all its holes) | `meshHole`: the nearest round loop |

- A mesh face must resolve (`resolveFaceRef` ok). Otherwise the pick returns the error message, e.g. "The face is not horizontal …", which is shown as a toast.
- A height pick (`camPick.target = { height }`) accepts only a mesh face. It sets `heights[name] = { from: 'face', offset: <current>, face: ref }` and ends pick mode.

- [ ] **Step 1: Write the failing test**

`packages/web/src/viewport/camPick.test.ts`: uses the core fixtures through relative paths. Read them from disk the way `packages/core/test/fixtures/camSetup.ts` does, or import `camPartSetup`/`plateSetup`/`faceAt` from `'../../../core/test/fixtures/camSetup'`.
```ts
import { applyCommand, camContext, type JobCommand, type Operation } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { camPartSetup, faceAt, plateSetup } from '../../../core/test/fixtures/camSetup';
import { applyPick, connectedDxfRefs, pickDxf, pickMesh } from './camPick';

const op = (job: Parameters<typeof applyCommand>[0], type: Operation['type']) =>
  applyCommand(job, { type: 'addOperation', opType: type, toolId: null, id: 'o' } as JobCommand).operations[0];

describe('DXF picking', () => {
  const { job, geometry, layer } = camPartSetup();
  const ctx = camContext(job, geometry);

  it('picks a whole connected chain for profiles and pockets', () => {
    const refs = connectedDxfRefs(ctx, { kind: 'dxfPath', blobId: 'd1', layer: layer('POCKET'), path: 0 }, new Set());
    expect(refs.map((r) => r.path).sort()).toEqual([0, 1, 2, 3]);
    const r = pickDxf(op(job, 'pocket'), ctx, { x: 55, y: 25.2 }, new Set()); // on the pocket's bottom edge
    expect('refs' in r && r.refs).toHaveLength(4);
  });

  it('picks only circles for drilling', () => {
    expect(pickDxf(op(job, 'drill'), ctx, { x: 18.1, y: 15 }, new Set())).toEqual({ refs: [{ kind: 'dxfPath', blobId: 'd1', layer: layer('HOLES'), path: 0 }] });
    expect(pickDxf(op(job, 'drill'), ctx, { x: 5.1, y: 30 }, new Set())).toEqual({ error: 'Only circles can be drilled' });
    expect(pickDxf(op(job, 'drill'), ctx, { x: 60, y: 60 }, new Set())).toEqual({ error: 'Nothing to pick here' });
  });
});

describe('mesh picking', () => {
  const { job, geometry } = plateSetup();
  const ctx = camContext(job, geometry);
  const top = faceAt(geometry as never, 5, 5, 10);

  it('adds faces, loops and holes by operation type', () => {
    expect(pickMesh(op(job, 'pocket'), ctx, top.seed, { x: 10, y: 10 }, false)).toEqual({ refs: [top] });
    const hole = pickMesh(op(job, 'drill'), ctx, top.seed, { x: 64, y: 20 }, true); // next to the through hole at (65, 20)
    expect('refs' in hole && hole.refs[0]).toMatchObject({ kind: 'meshHole', loop: expect.any(Number) });
    const loop = pickMesh(op(job, 'profile'), ctx, top.seed, { x: 5.2, y: 30 }, true); // on the outer edge
    expect('refs' in loop && loop.refs[0]).toMatchObject({ kind: 'meshLoop', loop: 0 });
  });

  it('toggles references', () => {
    const o = { ...op(job, 'pocket'), geometry: [top] };
    expect(applyPick(o, [top])).toEqual([]);
    expect(applyPick({ ...o, geometry: [] }, [top])).toEqual([top]);
  });
});
```
The core `test/` folder sits outside the web package's `src`, but Vitest resolves the relative import. If the web `tsconfig` excludes it, add `"../core/test/fixtures/camSetup.ts"` to the web test `include` rather than copying the fixtures.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/web exec vitest run src/viewport/camPick.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `viewport/camPick.ts`**

```ts
import {
  type CamContext, circleOf, drawingPath, drawingPathToProgram, type DxfPathRef, dist2, faceRefFromTriangle, type GeometryRef,
  nearestDxfPath, nearestS, type Operation, pathEnd, pathStart, resolveFaceRef, type Vec2,
} from '@sponcam/core';
import { sameRef } from '@/inspector/geometryLabels';

const PICK_DISTANCE = 2; // mm

export function connectedDxfRefs(ctx: CamContext, ref: DxfPathRef, hidden: ReadonlySet<string>): DxfPathRef[] {
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing') return [ref];
  const all: { ref: DxfPathRef; a: Vec2; b: Vec2 }[] = [];
  g.drawing.layers.forEach((l, layer) => {
    if (hidden.has(l.name)) return;
    l.paths.forEach((p, path) => {
      if (p.closed || !p.segments.length) return;
      const q = drawingPathToProgram(ctx, p);
      all.push({ ref: { kind: 'dxfPath', blobId: ref.blobId, layer, path }, a: pathStart(q), b: pathEnd(q) });
    });
  });
  const start = all.find((x) => sameRef(x.ref, ref));
  if (!start) return [ref];
  const tol = Math.max(ctx.tolerance, 1e-3);
  const chain = [start];
  for (let grown = true; grown; ) {
    grown = false;
    for (const x of all) {
      if (chain.includes(x)) continue;
      if (chain.some((c) => [c.a, c.b].some((p) => dist2(p, x.a) <= tol || dist2(p, x.b) <= tol))) {
        chain.push(x);
        grown = true;
      }
    }
  }
  return chain.map((c) => c.ref);
}

export function pickDxf(op: Operation, ctx: CamContext, q: Vec2, hidden: ReadonlySet<string>): { refs: DxfPathRef[] } | { error: string } {
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing') return { error: 'Nothing to pick here' };
  if (op.type === 'drill') {
    let best = null as DxfPathRef | null;
    let bestD = PICK_DISTANCE;
    g.drawing.layers.forEach((l, layer) => {
      if (hidden.has(l.name)) return;
      l.paths.forEach((p, path) => {
        const prog = drawingPathToProgram(ctx, p);
        if (!circleOf(prog)) return;
        const d = nearestS(prog, q).distance;
        if (d <= bestD) { bestD = d; best = { kind: 'dxfPath', blobId: ctx.job.model!.blobId, layer, path }; }
      });
    });
    if (best) return { refs: [best] };
    return nearestDxfPath(ctx, q, PICK_DISTANCE, hidden) ? { error: 'Only circles can be drilled' } : { error: 'Nothing to pick here' };
  }
  const ref = nearestDxfPath(ctx, q, PICK_DISTANCE, hidden);
  if (!ref) return { error: 'Nothing to pick here' };
  const raw = drawingPath(g.drawing, ref.layer, ref.path);
  return { refs: raw?.closed ? [ref] : connectedDxfRefs(ctx, ref, hidden) };
}

export function pickMesh(op: Operation, ctx: CamContext, tri: number, q: Vec2, alt: boolean): { refs: GeometryRef[] } | { error: string } {
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh' || !ctx.job.model) return { error: 'Nothing to pick here' };
  const face = faceRefFromTriangle(g.mesh, ctx.job.model.blobId, tri);
  const res = resolveFaceRef(ctx, face);
  if (!res.ok) return { error: res.message };
  if (!alt || op.type === 'pocket') return { refs: [face] };
  let best = -1;
  let bestD = Infinity;
  res.face.loops.forEach((loop, i) => {
    if (op.type === 'drill' && (i === 0 || !circleOf(loop))) return;
    const d = nearestS(loop, q).distance;
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0) return { error: 'This face has no round holes' };
  return { refs: [op.type === 'drill' ? { kind: 'meshHole', face, loop: best } : { kind: 'meshLoop', face, loop: best }] };
}

export function applyPick(op: Operation, refs: readonly GeometryRef[]): GeometryRef[] {
  const all = refs.every((r) => op.geometry.some((g) => sameRef(g, r)));
  return all ? op.geometry.filter((g) => !refs.some((r) => sameRef(g, r))) : [...op.geometry, ...refs.filter((r) => !op.geometry.some((g) => sameRef(g, r)))];
}
```
`best` is declared with `null as DxfPathRef | null`, so TypeScript doesn't narrow it to `null` across the `forEach` closure.

- [ ] **Step 4: Wire picking into the viewport**

`ModelObject.tsx`:
- **Raycasting:** the mesh raycasts while `pickMode !== 'none'` **or** `camPick !== null`.
- **Hover:** while `camPick` is set, hovering highlights the planar region, the same as lay-flat.
- **Click:** a click (with `e.delta ≤ 4`) runs the CAM pick:
  ```ts
  const ctx = camContext(job, geometry);                                   // core
  const world = e.point;                                                    // scene coordinates
  const q = { x: world.x - ctx.origin.x, y: world.y - ctx.origin.y };       // program XY
  const res = pickMesh(op, ctx, e.faceIndex, q, e.altKey);
  ```
- **Result:**
  - An error becomes `toast.error(res.error)`.
  - For a `target: 'geometry'` pick, `runCommand({ type: 'updateOperation', id: op.id, patch: { geometry: applyPick(op, res.refs) } })`. Pick mode stays on for more picks.
  - For a height pick, apply the face as described above and end pick mode.
- **Precedence:** the lay-flat pick mode wins if both are somehow active. Starting a CAM pick sets `pickMode: 'none'`, and starting lay-flat clears `camPick`. Enforce this in the store setters.

`Viewport.tsx`:
- **Drawings:** when `camPick` is set and the model is a drawing, render an invisible pick plane: a `mesh` with `planeGeometry` covering the stock footprint, at scene Z = 0, `visible={false}` but raycastable. It uses `pickDxf(op, ctx, q, new Set(hiddenLayers))` on click.
- **Hint:** show a hint (`cam-pick-hint`) like the lay-flat one: "Click geometry for <op name> · Alt-click for a single loop · Esc to finish".
- **Cursor:** `cursor-crosshair` while `camPick` is set.
- **Overlays:** render `<CamOverlays />` inside the `Canvas`.

`CamOverlays.tsx`: every object uses `raycast={noRaycast}` except the tab handles. All geometry is in program coordinates, so wrap everything in `<group position={[origin.x, origin.y, origin.z]}>` using `programOrigin(job, geometry)`. It draws:
- **Picked geometry of the selected operation:** each reference is resolved on the main thread with core helpers and drawn as a thick line (`drei` `Line`, width 3, colour `#f59e0b`) at its Z:
  - DXF paths: `drawingPathToProgram`, flattened with `flattenPath(…, 0.05)`;
  - face and loop references: the loops from `resolveFaceRef`;
  - holes: the circle.
- **Heights planes:** while `inspectorTab === 'heights'` and `camResults[op].heights` exists, five translucent planes (`heights-plane-<name>`, opacity 0.18, `depthWrite={false}`) over the stock footprint (`programContext(job, geometry).stock`), in the Task 16 colours, at each resolved Z.
- **Tab handles:** for the selected profile, `camResults[op].overlays.tabs` are drawn as small spheres (radius 1.5 mm, `tab-handle-<i>`) at `(point, laps z)`.
  - Dragging captures the pointer and intersects the ray with the plane Z = lap z. The point is projected onto the lap polyline (`overlays.laps` of the same `refIndex`, nearest point by arc length), and the handle moves live, in local state.
  - On pointer up, dispatch `updateOperation { tabs: { positions: <all tab positions, the dragged one replaced by { refIndex, t }> } }`.
- **Unmachined areas:** `overlays.unmachined` becomes red (`#ef4444`, opacity 0.35) filled shapes built with `THREE.ShapeGeometry` from each polygon, at the floor Z plus 0.01. Each also gets a red outline `Line`.

`Toolpaths.tsx`:
- **Generated programs:** when `selectedOperationId` is set, draw generated programs dimmed (opacity 0.3). Then draw the selected operation's rows again on top at full strength.
  - Find the section in `camFiles`. The rows are those whose `table.line` falls between `firstLine` and `lastLine`.
  - Their vertex range is `[rowVertexEnd[r0 − 1], rowVertexEnd[r1])`, from the existing `buildToolpathBuffers` result. Use a second `lineSegments` sharing the same buffers with its own `drawRange`, following Task 12's done/to-do pattern.
- **While regenerating:** while `camStatus === 'generating'`, generated programs use a `lineDashedMaterial` (call `computeLineDistances()` on the geometry once, when the dashed material is first needed).

- [ ] **Step 5: Run the tests, the typecheck and the build**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: PASS.

Manual check:
1. `cam-part.dxf` + Profile, pick mode: clicking one side of the pocket rectangle selects all four lines, and the orange outline appears. Clicking again removes them.
2. `plate-pocket.stl` + Pocket: clicking the pocket floor adds it. Rotating the model 90° about X (Orientation panel) turns the operation to error with "not horizontal".
3. A profile with tabs: drag a tab handle; the toolpath regenerates with the tab moved.
4. The Heights tab shows the 5 planes.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): viewport picking for operations, heights planes, draggable tabs and unmachined areas"
```

---

### Task 18: Web — G-code export, operation diagnostics in Analysis, Playwright tests

**Files:**
- Create: `packages/web/src/state/export.ts`, `packages/web/src/state/export.test.ts`, `packages/web/src/layout/ExportDialog.tsx`, `packages/web/e2e/cam.spec.ts`
- Modify: `packages/web/src/layout/TopBar.tsx`, `packages/web/src/dock/AnalysisView.tsx`, `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: store (`camResults`, `camFiles`, `programData`, `job`, `generatedPrograms`), `allDiagnostics` (core), `sanitizeName`, `fflate` (`zipSync`, `strToU8`).
- Produces:
  - `export.ts`:
    - `exportProblems(state): { errors: string[]; warnings: string[] }`
    - `exportFiles(state): { name: string; bytes: Uint8Array }`: one file as-is, several files zipped as `<job>.zip`
    - `downloadBytes(name, bytes)`
    - `exportGcode(confirm: (warnings: string[]) => Promise<boolean>): Promise<boolean>`
  - test ids: `export-gcode`, `export-dialog`, `export-warning`, `export-confirm`, `export-cancel`, `op-diagnostic` (`data-code`, `data-operation`)

Export rules (spec §8, plan clarification 11):
- **Errors block export:**
  - any operation diagnostic with severity error, as "<op name>: <message>";
  - any `postErrors` in a generated file, as "<file>: post-processor produced invalid G-code (<message>)";
  - no generated files at all, as "Nothing to export: add operations with geometry".
- **Warnings need confirmation:**
  - operation warnings;
  - Milestone 2 analysis diagnostics of generated programs, both errors and warnings (e.g. `below-stock-bottom` from a cut through the stock), as "<file> line N: <message>".
- **Files:** one generated file downloads as `<its name>`; several download as `<sanitizeName(job.name)>.zip`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/state/export.test.ts`:
```ts
import { createJob } from '@sponcam/core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportFiles, exportProblems } from './export';

const parsed = (diags: { line: number; severity: 'error' | 'warning'; code: string; message: string }[] = []) =>
  ({ interpretDiagnostics: [], analysis: { diagnostics: diags } }) as never;
const base = () => {
  const job = { ...createJob('My Part'), operations: [{ id: 'o', name: 'Pocket 1' }] as never };
  return {
    job,
    camResults: { o: { operationId: 'o', diagnostics: [], heights: null, overlays: { tabs: [], laps: [], unmachined: [] }, hasToolpath: true } },
    camFiles: [{ name: 'a.nc', blobId: 'gen:a.nc', operationIds: ['o'], sections: [], postErrors: [] }],
    programData: { 'gen:a.nc': { status: 'ready' as const, text: 'G0 X1\n', parsed: parsed(), error: null } },
  };
};

describe('export', () => {
  it('blocks on operation and post errors, warns on warnings and analysis findings', () => {
    const s = base();
    expect(exportProblems(s)).toEqual({ errors: [], warnings: [] });
    s.camResults.o.diagnostics = [{ operationId: 'o', severity: 'warning', code: 'unmachined-area', message: 'Corners' }] as never;
    s.programData['gen:a.nc'].parsed = parsed([{ line: 4, severity: 'error', code: 'below-stock-bottom', message: 'Too deep' }]);
    expect(exportProblems(s)).toEqual({ errors: [], warnings: ['Pocket 1: Corners', 'a.nc line 5: Too deep'] });
    s.camFiles[0].postErrors = [{ line: 0, severity: 'error', code: 'feed-no-f', message: 'No F' }] as never;
    s.camResults.o.diagnostics = [{ operationId: 'o', severity: 'error', code: 'no-tool', message: 'Choose a tool' }] as never;
    expect(exportProblems(s).errors).toEqual(['Pocket 1: Choose a tool', 'a.nc: post-processor produced invalid G-code (No F)']);
    expect(exportProblems({ ...base(), camFiles: [] }).errors).toEqual(['Nothing to export: add operations with geometry']);
  });

  it('downloads one file directly and several as a zip named after the job', () => {
    const one = exportFiles(base());
    expect(one.name).toBe('a.nc');
    expect(new TextDecoder().decode(one.bytes)).toBe('G0 X1\n');
    const s = base();
    s.camFiles.push({ name: 'b.nc', blobId: 'gen:b.nc', operationIds: ['o'], sections: [], postErrors: [] });
    s.programData['gen:b.nc'] = { status: 'ready', text: 'G0 X2\n', parsed: parsed(), error: null };
    const zip = exportFiles(s);
    expect(zip.name).toBe('My_Part.zip');
    const files = unzipSync(zip.bytes);
    expect(Object.keys(files)).toEqual(['a.nc', 'b.nc']);
    expect(strFromU8(files['b.nc'])).toBe('G0 X2\n');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @sponcam/web exec vitest run src/state/export.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `state/export.ts`**

```ts
import { sanitizeName } from '@sponcam/core';
import { strToU8, zipSync } from 'fflate';
import { toast } from 'sonner';
import { type AppState, appStore } from './store';

type ExportState = Pick<AppState, 'job' | 'camResults' | 'camFiles' | 'programData'>;

export function exportProblems(s: ExportState): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const op of s.job.operations) {
    for (const d of s.camResults[op.id]?.diagnostics ?? []) (d.severity === 'error' ? errors : warnings).push(`${op.name}: ${d.message}`);
  }
  for (const f of s.camFiles) {
    for (const d of f.postErrors) errors.push(`${f.name}: post-processor produced invalid G-code (${d.message})`);
    for (const d of s.programData[f.blobId]?.parsed?.analysis.diagnostics ?? []) warnings.push(`${f.name} line ${d.line + 1}: ${d.message}`);
  }
  if (!s.camFiles.length) errors.push('Nothing to export: add operations with geometry');
  return { errors, warnings };
}

export function exportFiles(s: ExportState): { name: string; bytes: Uint8Array } {
  const files = s.camFiles.map((f) => ({ name: f.name, text: s.programData[f.blobId]?.text ?? '' }));
  if (files.length === 1) return { name: files[0].name, bytes: strToU8(files[0].text) };
  return { name: `${sanitizeName(s.job.name)}.zip`, bytes: zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)]))) };
}

export function downloadBytes(name: string, bytes: Uint8Array): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Exports the generated G-code; errors block, warnings ask for confirmation. Resolves true when a download started. */
export async function exportGcode(confirm: (warnings: string[]) => Promise<boolean>): Promise<boolean> {
  const s = appStore.getState();
  if (s.camStatus === 'generating') {
    toast.info('Toolpaths are still being generated; try again in a moment');
    return false;
  }
  const { errors, warnings } = exportProblems(s);
  if (errors.length) {
    toast.error('Cannot export G-code', { description: errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n… and ${errors.length - 5} more` : '') });
    return false;
  }
  if (warnings.length && !(await confirm(warnings))) return false;
  const { name, bytes } = exportFiles(s);
  downloadBytes(name, bytes);
  return true;
}
```
The zip test expects `My_Part.zip`: `sanitizeName('My Part')` replaces the space with `_`.

- [ ] **Step 4: Build the UI**

`ExportDialog.tsx`:
- A `Dialog` (`export-dialog`) listing the warnings (`export-warning`, at most 20, then "… and N more"), with the buttons "Export anyway" (`export-confirm`) and "Cancel" (`export-cancel`).
- It exposes `useExportConfirm(): { confirm(warnings): Promise<boolean>; dialog: ReactNode }`. The hook keeps a resolver in a ref and resolves on either button or on close.

`TopBar.tsx`: add an "Export G-code" `ToolButton` (Download icon, `export-gcode`). It is enabled when the job has operations or generated programs, so errors can be reported, and disabled otherwise. It calls `exportGcode(confirm)`; render the `dialog` inside the header.

`AnalysisView.tsx`: add an "Operations" group above the program diagnostics.
- It lists every diagnostic of every operation (`op-diagnostic`, `data-code`, `data-operation`) with an icon by severity and the text "<op name>: <message>".
- Clicking one runs `selectOperation(op.id)` and opens the matching inspector tab:
  - `heights-invalid`, `no-stock` → heights;
  - `no-tool`, `tool-too-large`, `tool-undersize`, `feed-exceeds-machine`, `stepdown-exceeds-flute` → tool;
  - `ref-*`, `face-not-horizontal`, `open-contour`, `no-geometry`, `offset-collapsed` → geometry;
  - anything else → passes.
- The group shows even when no program is active, so the dock must render it before the "no program" early return.

- [ ] **Step 5: Write the Playwright tests**

`packages/web/e2e/cam.spec.ts`:
- Reuse `gcode.spec.ts`'s `beforeEach` (the `showOpenFilePicker` override) and its `openFixture` helper.
- Read `StockPanel.tsx` and `OrientationPanel.tsx` for the stock-thickness and rotate test ids.

```ts
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

async function addOp(page: Page, type: 'profile' | 'pocket' | 'drill') {
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
const lastRow = (page: Page) => page.locator('[data-testid^="op-row-"]').last();

test('DXF part: profile with tabs, pocket and drill generate, play and export', async ({ page }) => {
  await openFixture(page, 'cam-part.dxf');
  // 6 mm thick stock under the drawing (the auto-stock bottom margin; the drawing lies on the stock top)
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await addOp(page, 'profile');
  await page.getByTestId('catalog-contour-OUTLINE-0').click();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-tabs').click();
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);

  await addOp(page, 'pocket');
  for (let i = 0; i < 5; i++) await page.getByTestId(`catalog-contour-POCKET-${i}`).click(); // 4 lines + the island circle
  await expect(lastRow(page)).toHaveAttribute('data-status', 'warning'); // unmachined square corners

  await addOp(page, 'drill');
  for (let i = 0; i < 4; i++) await page.getByTestId(`catalog-contour-HOLES-${i}`).click();
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);

  // GRBL default: split by tool → the flat end mill file and the drill file
  const generated = page.getByTestId('program-generated');
  await expect(generated).toHaveCount(2);
  await expect(page.getByText(/-01-T2\.nc/)).toBeVisible();
  await expect(page.getByText(/-02-T9\.nc/)).toBeVisible();
  await expect(page.getByTestId('op-diagnostic').filter({ has: page.locator('[data-code="heights-invalid"]') })).toHaveCount(0);

  // plays
  await page.getByTestId('play').click();
  await expect(page.getByTestId('timeline-time')).not.toHaveText('0:00', { timeout: 5000 });
  await page.getByTestId('play').click();

  // LinuxCNC: a single file with canned cycles
  await page.getByRole('button', { name: 'Post' }).click();
  await page.getByTestId('post-dialect').selectOption('linuxcnc');
  await expect(generated).toHaveCount(1);
  await page.getByTestId('post-dialect').selectOption('grbl');
  await expect(generated).toHaveCount(2);

  // export: warnings → confirm → zip download
  const download = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-confirm').click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
});

test('errors block export; a face that is no longer horizontal breaks its operation', async ({ page }) => {
  await openFixture(page, 'plate-pocket.stl');
  await page.getByTestId('units-mm').click();
  await addOp(page, 'pocket');
  await page.getByTestId('catalog-face-1').click(); // the pocket floor (faces are listed top-down: top, floor, hole bottom)
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);

  await page.getByTestId('rotate-x-pos').click(); // +90° about X: the pocket floor is now vertical
  await expect(lastRow(page)).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('op-diagnostic').first()).toHaveAttribute('data-code', 'face-not-horizontal');
  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  await expect(page.getByText('Cannot export G-code')).toBeVisible();
});
```
The test ids come from the existing panels: `stock-margin-bottom` (StockPanel), `units-mm` (UnitsDialog), `rotate-x-pos` (OrientationPanel). NumericFields commit on Enter.
- **Tool numbers:** `T2` is the starter 6 mm flat and `T9` the starter 6 mm drill, from `starterLibrary`.
- **Library state:** the library is seeded in IndexedDB on first load. Playwright gives each test a fresh context, so the starter tools are always there.

- [ ] **Step 6: Run everything**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build && pnpm e2e`
Expected: all pass, including `smoke.spec.ts`, `gcode.spec.ts` and `cam.spec.ts`. Run `pnpm e2e` three times; there must be no flaky failures.

- [ ] **Step 7: Commit**

```bash
git add packages/web
git commit -m "feat(web): G-code export with checks, operation diagnostics, CAM end-to-end tests"
```

---

### Task 19: Final verification against the Milestone 3 acceptance criteria

**Files:**
- Modify: only what fixes require

- [ ] **Step 1: Full suite**

Run from the repo root:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm e2e
```
Expected: every command exits 0. Record the test counts.

- [ ] **Step 2: Performance check (spec §10)**

Write a throwaway Vitest file in `packages/core/test/tmp-perf.test.ts`, and delete it before committing. It times:
1. `generateJob` + `postProcess` + `parseProgram` for the CAM part job from `generate.test.ts`. The target is < 300 ms.
2. A pocket whose outer loop is a 1,000-segment polygon (for example a 1,000-gon star with radius 30 ± 3 mm) with a 6 mm tool at tolerance 0.002. The target is < 2 s.

Record the numbers in the report. If a target is missed, profile it (`console.time` around the offset, arc-fit and emit phases). Fix the dominant cost, typically `fitArcs` on long runs or `segmentInside` in linking, in a separate commit with a before/after number.

- [ ] **Step 3: Acceptance walk-through (spec §12)**

Walk through the eight criteria with `pnpm dev` or throwaway Playwright scripts, and note pass or fail for each:
1. **DXF part:** profile, pocket and drill operations picked in the viewport; toolpaths over the stock; the timeline plays with a time estimate.
2. **Plate STL:** pocket floor and hole loops picked, with depths from the model. Re-orienting, spinning the model and moving the WCS regenerate the toolpaths in the right place. A non-horizontal face gives a clear error.
3. **Tabs:** they appear, can be dragged, and the toolpath rises over them.
4. **Pocket:** it clears around islands, and unreachable corners show a warning and the red hatch.
5. **Dialects:** switching changes the output as in spec §7. Every output parses in Milestone 2 without errors.
6. **Tools:** the library has the starter tools, a Fusion JSON imports with presets, and job tools survive save, open, reload and library resets.
7. **Export:** it downloads the file or files; errors block it, and warnings need a confirmation.
8. **Undo and reload:** undo/redo cover all operation edits, and a reload restores operations, tools and post settings, with the generated programs rebuilt.

- [ ] **Step 4: Fix and commit anything found**

For each failure:
1. Write a failing test where practical.
2. Fix it.
3. Re-run Step 1.

Commit as `fix: address milestone 3 acceptance issues`, or skip the commit if nothing needed fixing.
