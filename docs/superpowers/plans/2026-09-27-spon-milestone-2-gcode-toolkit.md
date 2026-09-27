# Spon Milestone 2 (G-code Toolkit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load G-code programs into a Spon job, show their toolpaths at the job's work origin, play them back on a timeline synced to a G-code line list, and analyse them (run time from a machine profile, extents, diagnostics).

**Architecture:** `@sponcam/core` gains a `gcode/` module: a lexer and a modal interpreter that turn G-code into a column-oriented **motion table** of typed arrays, then timing (trapezoidal, per-axis limits) and analysis over that table. It runs in the existing Comlink worker. The job schema moves to v2 (machine profile + program list) with the first real migration, and `.spon` files store many blobs. `@sponcam/web` adds program state to the store, toolpath rendering, a Programs and a Machine panel, and a bottom dock with timeline, virtualised G-code list and analysis.

**Tech Stack:** unchanged from Milestone 1 (TypeScript strict, pnpm workspaces, Vite 8, React 19.3, react-three-fiber 9 / drei 10 / three 0.186, Zustand 5, Comlink, fflate, idb, Radix-based shadcn/ui + Tailwind 4, Vitest 5, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-27-gcode-toolkit-design.md` (Milestone 1 spec: `docs/superpowers/specs/2026-09-27-cam-foundation-import-setup-design.md`)

## Global Constraints

- Node ≥ 22, pnpm 9. Windows dev machine; commands must work in Git Bash and PowerShell.
- TypeScript `strict`, `verbatimModuleSyntax` (`import type` for type-only imports), `noUnusedLocals`, `noUnusedParameters`.
- `@sponcam/core` must not import React, three.js or DOM-only APIs (tsconfig lib `ES2022` + `WebWorker`).
- Stored lengths are mm, stored angles degrees; the motion table stores mm and seconds. Feeds and rapid rates are mm/min; accelerations mm/s².
- No GPL dependencies. No new runtime dependencies are needed in this milestone.
- Job schema version becomes **2**. `.spon` zip layout: `job.json`, `models/<blobId>.stl|.dxf`, `programs/<blobId>.nc`.
- Machine presets (exact values): **Hobby GRBL router** — rapid 5000/5000/1500 mm/min, accel 500/500/200 mm/s², maxFeed 5000, toolChangeSeconds 30 (default). **Generic VMC** — rapid 30000/30000/24000, accel 3000/3000/2500, maxFeed 12000, toolChangeSeconds 5. Editing any value renames the profile "Custom".
- Accepted program extensions: `.nc`, `.ngc`, `.gcode`, `.tap`, `.cnc`.
- Tolerances: arc end-radius mismatch 0.01 mm; G73 chip-break retract and G83 re-approach clearance 0.2 mm; display arc tessellation 0.01 mm with the capped `arcStepCount`.
- Commits end with a `Co-Authored-By: Claude … <noreply@anthropic.com>` trailer naming the model that wrote the commit.

## Clarifications to the spec (decided while planning)

1. **Row budget is 5 M rows, not 20 M.** 20 M rows of the motion table would need ~1 GB of typed arrays; 5 M (~250 MB) still covers the 2 M-line target with cycle expansion.
2. **Diagnostics come from two places.** Diagnostics that depend only on the program (arc radius, not simulated, no G43, other work offset, unknown axis, inch program, feed without F, feed with spindle off, too many moves) are produced by the interpreter; diagnostics that depend on the job (rapid into stock, below stock bottom) are produced by analysis and recomputed when stock or WCS changes. The UI shows both lists merged by line.
3. **Row flags.** The motion table gets one extra `flags: Uint8Array` column: bit 0 = generated inside a canned cycle (internal peck/retract rapids), bit 1 = started from an unknown position (first moves, after G28), bit 2 = G53 machine-coordinate move. Rapid-into-stock ignores cycle-internal rows, unknown-start rows, and pure upward moves (retracts).
4. **"Has error" line flag** from spec §3.2 is not stored; the G-code list derives error highlighting from the diagnostics.
5. **Unknown start position:** the tool starts at (0, 0, 0) with all axes unknown; moves while any axis is unknown get flag bit 1 (drawn, but excluded from stock checks); a *feed* move while an axis is still unknown raises `unknown-axis`.
6. **G4 dwell:** `P` and `X` are read as seconds.
7. **Cutter compensation G41/G42:** raises a `not-simulated` warning ("drawn without cutter compensation"); motion is still drawn.
8. **Diagnostic caps:** at most 200 diagnostics per code per program, then one summary line ("… and N more").
9. **Active program follows the playhead** while playing; clicking a program row activates it and, if it is in the timeline, seeks to its start.
10. **Orphan blob cleanup** keeps blobs referenced by the current job *and* by the undo/redo stacks, so undoing "add program" and redoing it never loses the program's bytes.
11. **Programs panel time** and the Analysis summary both use `formatDuration` (`m:ss`, or `h:mm:ss` from one hour).

## File Map

```
packages/core/src/
  job/machine.ts            MachineProfile, presets, machinePreset()
  job/programs.ts           addProgram/removeProgram/moveProgram/setProgramInTimeline/setMachineProfile/applyMachinePreset
  job/types.ts              (modify) Job v2, ProgramRef
  job/defaults.ts           (modify) createJob → v2
  io/migrations.ts          (modify) v1→v2 migration, CURRENT_SCHEMA_VERSION = 2
  io/spon.ts                (modify) BlobMap, programFilePath, jobBlobIds, multi-blob write/read
  gcode/types.ts            MoveKind, RowFlag, LineFlag, MotionTable, Diagnostic, summary types
  gcode/motion.ts           TableBuilder, rowStart()
  gcode/decode.ts           decodeProgramText()
  gcode/lexer.ts            computeLineStarts(), lexLine(), WordBuffer
  gcode/arcs.ts             arc centre/sweep/point/length/bounds per plane
  gcode/diagnostics.ts      DiagnosticSink (per-code cap)
  gcode/cycles.ts           expandCycle() for G81/G82/G83/G73
  gcode/interpreter.ts      interpretProgram()
  gcode/timing.ts           rowKinematics, trapezoid, computeTiming, positionAt, rowAtTime
  gcode/analysis.ts         analyzeTable()
  gcode/program.ts          parseProgram(), reanalyze(), allDiagnostics(), transferables
  index.ts                  (modify) exports
packages/core/test/
  job-programs.test.ts, gcode-lexer.test.ts, gcode-arcs.test.ts, gcode-interpreter.test.ts,
  gcode-cycles.test.ts, gcode-timing.test.ts, gcode-analysis.test.ts, gcode-program.test.ts
  fixtures/job-v1.json, fixtures/drill-arc.nc
packages/web/src/
  state/store.ts            (modify) program + playback view state
  state/autosave.ts         (modify) removeOrphanBlobs(keepIds[])
  state/programContext.ts   analysis context (stock in program coordinates)
  state/programs.ts         import/parse/re-analyse programs, blob persistence helpers
  state/documents.ts        (modify) program files, multi-blob save/open/restore, v1 autosave migration
  workers/import.worker.ts  (modify) parseProgram / analyze API
  workers/importClient.ts   (modify) parseProgramInWorker / analyzeInWorker
  gcode/timeline.ts         combined timeline, locate, seek helpers
  gcode/toolpath.ts         line-segment buffers + colours + row→vertex map
  gcode/playback.ts         usePlaybackCursor(), usePlaybackLoop()
  viewport/Toolpaths.tsx    per-program toolpath + tool marker
  viewport/Viewport.tsx     (modify) toolpaths, visibility toggles
  viewport/ModelObject.tsx, viewport/SceneObjects.tsx (modify) respect showModel/showStock
  panels/ProgramsPanel.tsx, panels/MachinePanel.tsx, panels/format.ts (modify: formatDuration)
  dock/BottomDock.tsx, dock/TimelineBar.tsx, dock/GcodeList.tsx, dock/AnalysisView.tsx
  layout/LeftPanel.tsx, layout/TopBar.tsx, layout/DropZone.tsx, App.tsx, hooks/useKeyboardShortcuts.ts (modify)
packages/web/e2e/gcode.spec.ts
```

---

### Task 1: Job schema v2 — machine profile, program list, migration

**Files:**
- Create: `packages/core/src/job/machine.ts`, `packages/core/src/job/programs.ts`, `packages/core/test/job-programs.test.ts`, `packages/core/test/fixtures/job-v1.json`
- Modify: `packages/core/src/job/types.ts`, `packages/core/src/job/defaults.ts`, `packages/core/src/io/migrations.ts`, `packages/core/src/index.ts`
- Modify tests: `packages/core/test/job-update.test.ts` (schemaVersion 1 → 2), `packages/core/test/spon.test.ts` ("newer schema" case uses 3)

**Interfaces:**
- Produces:
  - `interface AxisValues { x: number; y: number; z: number }`, `interface MachineProfile { name: string; rapid: AxisValues; accel: AxisValues; maxFeed: number; toolChangeSeconds: number }`
  - `type MachinePresetName = 'Hobby GRBL router' | 'Generic VMC'`, `MACHINE_PRESET_NAMES`, `DEFAULT_MACHINE_PRESET`, `machinePreset(name): MachineProfile` (fresh copy)
  - `interface ProgramRef { id: string; name: string; blobId: string; inTimeline: boolean }`; `Job.schemaVersion: 2`, `Job.machine`, `Job.programs`
  - `interface NewProgram { name: string; blobId: string }`, `interface MachinePatch { rapid?: Partial<AxisValues>; accel?: Partial<AxisValues>; maxFeed?: number; toolChangeSeconds?: number }`
  - `addProgram(job, p: NewProgram): Job`, `removeProgram(job, id)`, `moveProgram(job, id, delta: -1 | 1)`, `setProgramInTimeline(job, id, inTimeline)`, `setMachineProfile(job, patch: MachinePatch)`, `applyMachinePreset(job, name)` — each returns the same object when nothing changes
  - `CURRENT_SCHEMA_VERSION = 2`, `MIGRATIONS[1]`

- [ ] **Step 1: Write the v1 fixture and the failing tests**

`packages/core/test/fixtures/job-v1.json` (a real Milestone 1 job):
```json
{
  "schemaVersion": 1,
  "id": "0f8e2c1a-5b7d-4c3e-9a1f-2d6b8e4c7a90",
  "name": "Bracket",
  "displayUnits": "mm",
  "model": {
    "sourceName": "bracket.stl",
    "blobId": "b1",
    "kind": "mesh",
    "importUnits": "mm",
    "transform": { "base": { "x": 0, "y": 0, "z": 0, "w": 1 }, "zDeg": 0 }
  },
  "stock": { "mode": "auto", "margin": { "xy": 5, "zTop": 1, "zBottom": 0 } },
  "wcs": { "anchor": { "x": "min", "y": "min", "z": "top" }, "offset": { "x": 0, "y": 0, "z": 0 }, "workOffset": "G54" }
}
```

`packages/core/test/job-programs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import v1Job from './fixtures/job-v1.json';
import { migrateJob } from '../src/io/migrations';
import { createJob } from '../src/job/defaults';
import { DEFAULT_MACHINE_PRESET, MACHINE_PRESET_NAMES, machinePreset } from '../src/job/machine';
import {
  addProgram, applyMachinePreset, moveProgram, removeProgram, setMachineProfile, setProgramInTimeline,
} from '../src/job/programs';

const withPrograms = () => {
  let job = createJob();
  job = addProgram(job, { name: 'rough.nc', blobId: 'p1' });
  job = addProgram(job, { name: 'finish.nc', blobId: 'p2' });
  return job;
};

describe('machine presets', () => {
  it('has the two spec presets with exact values', () => {
    expect(MACHINE_PRESET_NAMES).toEqual(['Hobby GRBL router', 'Generic VMC']);
    expect(DEFAULT_MACHINE_PRESET).toBe('Hobby GRBL router');
    expect(machinePreset('Hobby GRBL router')).toEqual({
      name: 'Hobby GRBL router', rapid: { x: 5000, y: 5000, z: 1500 }, accel: { x: 500, y: 500, z: 200 }, maxFeed: 5000, toolChangeSeconds: 30,
    });
    expect(machinePreset('Generic VMC')).toEqual({
      name: 'Generic VMC', rapid: { x: 30000, y: 30000, z: 24000 }, accel: { x: 3000, y: 3000, z: 2500 }, maxFeed: 12000, toolChangeSeconds: 5,
    });
  });

  it('returns fresh copies', () => {
    const a = machinePreset('Generic VMC');
    a.rapid.x = 1;
    expect(machinePreset('Generic VMC').rapid.x).toBe(30000);
  });
});

describe('job v2', () => {
  it('creates jobs with the default machine and no programs', () => {
    const job = createJob();
    expect(job.schemaVersion).toBe(2);
    expect(job.machine).toEqual(machinePreset('Hobby GRBL router'));
    expect(job.programs).toEqual([]);
  });

  it('adds programs to the end of the timeline', () => {
    const job = withPrograms();
    expect(job.programs.map((p) => [p.name, p.blobId, p.inTimeline])).toEqual([['rough.nc', 'p1', true], ['finish.nc', 'p2', true]]);
    expect(job.programs[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.programs[0].id).not.toBe(job.programs[1].id);
  });

  it('removes, reorders and toggles programs', () => {
    const job = withPrograms();
    const [first, second] = job.programs;
    expect(removeProgram(job, first.id).programs.map((p) => p.name)).toEqual(['finish.nc']);
    expect(removeProgram(job, 'nope')).toBe(job);
    expect(moveProgram(job, second.id, -1).programs.map((p) => p.name)).toEqual(['finish.nc', 'rough.nc']);
    expect(moveProgram(job, first.id, -1)).toBe(job);
    expect(moveProgram(job, second.id, 1)).toBe(job);
    expect(setProgramInTimeline(job, first.id, false).programs[0].inTimeline).toBe(false);
    expect(setProgramInTimeline(job, first.id, true)).toBe(job);
  });

  it('edits the machine profile as Custom and applies presets', () => {
    const job = createJob();
    const edited = setMachineProfile(job, { rapid: { z: 2000 }, maxFeed: 6000 });
    expect(edited.machine).toEqual({ ...machinePreset('Hobby GRBL router'), name: 'Custom', rapid: { x: 5000, y: 5000, z: 2000 }, maxFeed: 6000 });
    expect(applyMachinePreset(edited, 'Generic VMC').machine).toEqual(machinePreset('Generic VMC'));
    expect(setMachineProfile(job, {})).toBe(job);
  });
});

describe('migration v1 → v2', () => {
  it('upgrades a Milestone 1 job', () => {
    const job = migrateJob(v1Job);
    expect(job.schemaVersion).toBe(2);
    expect(job.machine).toEqual(machinePreset('Hobby GRBL router'));
    expect(job.programs).toEqual([]);
    expect(job.model?.blobId).toBe('b1');
    expect(job.name).toBe('Bracket');
  });
});
```

In `packages/core/test/job-update.test.ts`, change the defaults expectation `schemaVersion: 1` to `schemaVersion: 2`. In `packages/core/test/spon.test.ts`, change `migrateJob({ ...createJob(), schemaVersion: 2 })` to `schemaVersion: 3` (a newer schema than the app now supports).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test job-programs`
Expected: FAIL — `../src/job/machine` cannot be resolved.

- [ ] **Step 3: Implement the machine profile and program updates**

`packages/core/src/job/machine.ts`:
```ts
export interface AxisValues {
  x: number;
  y: number;
  z: number;
}

/** Rapid rates and max feed in mm/min, accelerations in mm/s². */
export interface MachineProfile {
  name: string;
  rapid: AxisValues;
  accel: AxisValues;
  maxFeed: number;
  toolChangeSeconds: number;
}

export type MachinePresetName = 'Hobby GRBL router' | 'Generic VMC';
export const MACHINE_PRESET_NAMES: readonly MachinePresetName[] = ['Hobby GRBL router', 'Generic VMC'];
export const DEFAULT_MACHINE_PRESET: MachinePresetName = 'Hobby GRBL router';
export const CUSTOM_MACHINE_NAME = 'Custom';

const PRESETS: Record<MachinePresetName, MachineProfile> = {
  'Hobby GRBL router': {
    name: 'Hobby GRBL router', rapid: { x: 5000, y: 5000, z: 1500 }, accel: { x: 500, y: 500, z: 200 }, maxFeed: 5000, toolChangeSeconds: 30,
  },
  'Generic VMC': {
    name: 'Generic VMC', rapid: { x: 30000, y: 30000, z: 24000 }, accel: { x: 3000, y: 3000, z: 2500 }, maxFeed: 12000, toolChangeSeconds: 5,
  },
};

/** A fresh, mutable copy of a preset. */
export function machinePreset(name: MachinePresetName): MachineProfile {
  return structuredClone(PRESETS[name]);
}
```

In `packages/core/src/job/types.ts`, add at the top `import type { MachineProfile } from './machine';`, add the `ProgramRef` interface and extend `Job`:
```ts
export interface ProgramRef {
  id: string;
  /** Original file name. */
  name: string;
  /** Key of the program bytes (programs/<blobId>.nc in .spon, IndexedDB blobs). */
  blobId: string;
  /** Included in the combined back-to-back timeline. */
  inTimeline: boolean;
}

/** All lengths in mm, angles in degrees. */
export interface Job {
  schemaVersion: 2;
  id: string;
  name: string;
  displayUnits: LengthUnit;
  model: ModelRef | null;
  stock: Stock;
  wcs: Wcs;
  machine: MachineProfile;
  /** List order is playback order. */
  programs: ProgramRef[];
}
```

In `packages/core/src/job/defaults.ts`, import `{ DEFAULT_MACHINE_PRESET, machinePreset } from './machine'` and change `createJob` to return `schemaVersion: 2` plus `machine: machinePreset(DEFAULT_MACHINE_PRESET), programs: []`.

`packages/core/src/job/programs.ts`:
```ts
import { type AxisValues, CUSTOM_MACHINE_NAME, type MachinePresetName, machinePreset } from './machine';
import type { Job } from './types';

export interface NewProgram {
  name: string;
  blobId: string;
}

export interface MachinePatch {
  rapid?: Partial<AxisValues>;
  accel?: Partial<AxisValues>;
  maxFeed?: number;
  toolChangeSeconds?: number;
}

export function addProgram(job: Job, program: NewProgram): Job {
  return { ...job, programs: [...job.programs, { id: crypto.randomUUID(), name: program.name, blobId: program.blobId, inTimeline: true }] };
}

export function removeProgram(job: Job, id: string): Job {
  const programs = job.programs.filter((p) => p.id !== id);
  return programs.length === job.programs.length ? job : { ...job, programs };
}

export function moveProgram(job: Job, id: string, delta: -1 | 1): Job {
  const from = job.programs.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= job.programs.length) return job;
  const programs = [...job.programs];
  [programs[from], programs[to]] = [programs[to], programs[from]];
  return { ...job, programs };
}

export function setProgramInTimeline(job: Job, id: string, inTimeline: boolean): Job {
  const target = job.programs.find((p) => p.id === id);
  if (!target || target.inTimeline === inTimeline) return job;
  return { ...job, programs: job.programs.map((p) => (p.id === id ? { ...p, inTimeline } : p)) };
}

/** Any edit turns the profile into "Custom". */
export function setMachineProfile(job: Job, patch: MachinePatch): Job {
  if (Object.keys(patch).length === 0) return job;
  const m = job.machine;
  return {
    ...job,
    machine: {
      name: CUSTOM_MACHINE_NAME,
      rapid: { ...m.rapid, ...patch.rapid },
      accel: { ...m.accel, ...patch.accel },
      maxFeed: patch.maxFeed ?? m.maxFeed,
      toolChangeSeconds: patch.toolChangeSeconds ?? m.toolChangeSeconds,
    },
  };
}

export function applyMachinePreset(job: Job, name: MachinePresetName): Job {
  return { ...job, machine: machinePreset(name) };
}
```

- [ ] **Step 4: Add the migration**

In `packages/core/src/io/migrations.ts`:
- add `import { DEFAULT_MACHINE_PRESET, machinePreset } from '../job/machine';`
- set `export const CURRENT_SCHEMA_VERSION = 2;`
- replace the empty `MIGRATIONS` with:
```ts
/** MIGRATIONS[n] upgrades a schemaVersion-n job to n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v1 → v2 (Milestone 2): machine profile and program list
  1: (job) => ({ ...job, machine: machinePreset(DEFAULT_MACHINE_PRESET), programs: [] }),
};
```
- extend `assertJobShape`'s `ok` expression with `&& typeof job.machine === 'object' && job.machine !== null && Array.isArray(job.programs)`.

Append to `packages/core/src/index.ts`:
```ts
export * from './job/machine';
export * from './job/programs';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/web typecheck`
Expected: all core tests pass (including the two edited assertions); both packages typecheck (web code only reads Job fields that still exist). If JSON imports are rejected, `resolveJsonModule` is already on in `tsconfig.base.json`.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): job schema v2 with machine profile, program list and v1 migration" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 2: `.spon` files with many blobs

**Files:**
- Modify: `packages/core/src/io/spon.ts`, `packages/core/test/spon.test.ts` (rewrite), `packages/web/src/state/documents.ts` (adapt the two call sites)

**Interfaces:**
- Consumes: `Job`, `ProgramRef`, `ModelRef` (Task 1)
- Produces: `type BlobMap = Record<string, Uint8Array>`, `programFilePath(p: ProgramRef): string` (`programs/<blobId>.nc`), `jobBlobIds(job): string[]` (model first, then programs), `writeSpon(job, blobs: BlobMap): Uint8Array`, `readSpon(bytes): { job: Job; blobs: BlobMap }`

- [ ] **Step 1: Rewrite the failing `.spon` tests**

Replace `packages/core/test/spon.test.ts`:
```ts
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import v1Job from './fixtures/job-v1.json';
import { SponFileError } from '../src/io/errors';
import { migrateJob } from '../src/io/migrations';
import { jobBlobIds, modelFilePath, programFilePath, readSpon, writeSpon } from '../src/io/spon';
import { createJob } from '../src/job/defaults';
import { addProgram } from '../src/job/programs';
import { setModel, setZSpin } from '../src/job/update';

const MODEL = new Uint8Array([1, 2, 3, 4, 5]);
const P1 = new TextEncoder().encode('G0 X0\n');
const P2 = new TextEncoder().encode('G1 X1 F100\n');

function fullJob() {
  let job = setZSpin(setModel(createJob('Bracket'), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'in' }), 12.5);
  job = addProgram(job, { name: 'rough.nc', blobId: 'p1' });
  job = addProgram(job, { name: 'finish.nc', blobId: 'p2' });
  return job;
}

describe('.spon files', () => {
  it('round-trips a job with a model and several programs', () => {
    const job = fullJob();
    const bytes = writeSpon(job, { abc: MODEL, p1: P1, p2: P2, unused: new Uint8Array([9]) });
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['job.json', 'models/abc.stl', 'programs/p1.nc', 'programs/p2.nc']);
    const read = readSpon(bytes);
    expect(read.job).toEqual(job);
    expect(read.blobs).toEqual({ abc: MODEL, p1: P1, p2: P2 });
  });

  it('round-trips a job without model or programs', () => {
    const job = createJob();
    expect(readSpon(writeSpon(job, {}))).toEqual({ job, blobs: {} });
  });

  it('names blob files and lists referenced blob ids', () => {
    const job = fullJob();
    expect(modelFilePath(job.model!)).toBe('models/abc.stl');
    expect(programFilePath(job.programs[0])).toBe('programs/p1.nc');
    expect(jobBlobIds(job)).toEqual(['abc', 'p1', 'p2']);
    expect(jobBlobIds(createJob())).toEqual([]);
  });

  it('refuses to write a job whose blobs are missing', () => {
    expect(() => writeSpon(fullJob(), { abc: MODEL, p1: P1 })).toThrow('Missing data for programs/p2.nc');
  });

  it('opens Milestone 1 files and migrates them', () => {
    const bytes = zipSync({ 'job.json': strToU8(JSON.stringify(v1Job)), 'models/b1.stl': MODEL });
    const read = readSpon(bytes);
    expect(read.job.schemaVersion).toBe(2);
    expect(read.blobs).toEqual({ b1: MODEL });
  });

  it('rejects broken files with clear messages', () => {
    expect(() => readSpon(new Uint8Array([1, 2, 3]))).toThrow('Not a Spon job file (invalid zip)');
    expect(() => readSpon(zipSync({ 'other.txt': strToU8('x') }))).toThrow('Not a Spon job file (job.json missing)');
    expect(() => readSpon(zipSync({ 'job.json': strToU8('{oops') }))).toThrow('job.json is not valid JSON');
    const job = fullJob();
    const missing = zipSync({ 'job.json': strToU8(JSON.stringify(job)), 'models/abc.stl': MODEL, 'programs/p1.nc': P1 });
    expect(() => readSpon(missing)).toThrow('programs/p2.nc is missing from the job file');
  });
});

describe('migrateJob', () => {
  it('refuses jobs from a newer schema', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 3 })).toThrow(/newer version of Spon/);
  });

  it('rejects data without a valid schemaVersion or job shape', () => {
    expect(() => migrateJob(null)).toThrow(SponFileError);
    expect(() => migrateJob({ name: 'x' })).toThrow(/schemaVersion/);
    expect(() => migrateJob({ schemaVersion: 2, name: 'x' })).toThrow(/not a valid job/);
  });

  it('runs migrations in order up to the current version', () => {
    const current = createJob('Migrated');
    const { name, ...rest } = current;
    const v0 = { ...rest, schemaVersion: 0, title: name };
    const migrations = {
      0: (j: Record<string, unknown>) => {
        const { title, ...others } = j;
        return { ...others, name: title };
      },
    };
    expect(migrateJob(v0, migrations, 1)).toEqual({ ...current, schemaVersion: 1 });
  });

  it('fails when a migration step is missing', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 0 }, {}, 1)).toThrow('No migration from schema 0');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test spon`
Expected: FAIL — `programFilePath`/`jobBlobIds` are not exported and `readSpon` has no `blobs`.

- [ ] **Step 3: Implement multi-blob IO**

Replace the body of `packages/core/src/io/spon.ts` below the imports (keep `SPON_EXTENSION`, `SPON_MIME`, `modelFilePath`); change the type import to `import type { Job, ModelRef, ProgramRef } from '../job/types';`:
```ts
/** Blob bytes keyed by blobId. */
export type BlobMap = Record<string, Uint8Array>;

export function programFilePath(program: ProgramRef): string {
  return `programs/${program.blobId}.nc`;
}

/** Every blob the job references: the model (if any) first, then programs in list order. */
export function jobBlobIds(job: Job): string[] {
  return [...(job.model ? [job.model.blobId] : []), ...job.programs.map((p) => p.blobId)];
}

function blobPaths(job: Job): [blobId: string, path: string][] {
  return [
    ...(job.model ? [[job.model.blobId, modelFilePath(job.model)] as [string, string]] : []),
    ...job.programs.map((p): [string, string] => [p.blobId, programFilePath(p)]),
  ];
}

/** Zip with job.json plus the original bytes of the model and every program. Blobs the job doesn't reference are ignored. */
export function writeSpon(job: Job, blobs: BlobMap): Uint8Array {
  const files: Record<string, Uint8Array> = { 'job.json': strToU8(JSON.stringify(job, null, 2)) };
  for (const [blobId, path] of blobPaths(job)) {
    const bytes = blobs[blobId];
    if (!bytes) throw new SponFileError(`Missing data for ${path}`);
    files[path] = bytes;
  }
  return zipSync(files, { level: 6 });
}

export function readSpon(bytes: Uint8Array): { job: Job; blobs: BlobMap } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SponFileError('Not a Spon job file (invalid zip)');
  }
  const jobJson = files['job.json'];
  if (!jobJson) throw new SponFileError('Not a Spon job file (job.json missing)');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(jobJson));
  } catch {
    throw new SponFileError('job.json is not valid JSON');
  }
  const job = migrateJob(raw);
  const blobs: BlobMap = {};
  for (const [blobId, path] of blobPaths(job)) {
    const data = files[path];
    if (!data) throw new SponFileError(`${path} is missing from the job file`);
    blobs[blobId] = data;
  }
  return { job, blobs };
}
```
(`ModelRef` stays imported for `modelFilePath`.)

- [ ] **Step 4: Adapt the web call sites**

In `packages/web/src/state/documents.ts`:
- `openSponBytes`: replace
  `let modelBytes: Uint8Array | null;` / `({ job, modelBytes } = readSpon(bytes));`
  with
  ```ts
  let modelBytes: Uint8Array | null;
  try {
    const read = readSpon(bytes);
    job = read.job;
    modelBytes = job.model ? read.blobs[job.model.blobId] ?? null : null;
  } catch (err) {
  ```
  (keeping the existing `catch` body and the rest of the function).
- `saveDocument`: replace `const bytes = writeSpon(job, modelBytes);` with
  ```ts
  const blobs = job.model && modelBytes ? { [job.model.blobId]: modelBytes } : {};
  const bytes = writeSpon(job, blobs);
  ```
(Programs are wired into save/open in Task 9.)

- [ ] **Step 5: Run tests, typecheck and e2e sanity**

Run: `pnpm --filter @sponcam/core test && pnpm typecheck && pnpm --filter @sponcam/web test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core packages/web/src/state/documents.ts
git commit -m "feat(core): store model and program blobs in .spon files" -m "Co-Authored-By: <your model trailer>"
```

---
### Task 3: G-code types, text decoding and lexer

**Files:**
- Create: `packages/core/src/gcode/types.ts`, `packages/core/src/gcode/decode.ts`, `packages/core/src/gcode/lexer.ts`, `packages/core/test/gcode-lexer.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `MoveKind` (const object + type): `Rapid 0, Feed 1, ArcCW 2, ArcCCW 3, Dwell 4, ToolChange 5, Pause 6, Home 7`
  - `RowFlag`: `CycleInternal 1, UnknownStart 2, MachineCoords 4`; `LineFlag`: `NotSimulated 1, Macro 2`
  - `interface MotionTable { count; start: { x; y; z }; kind: Uint8Array; end: Float32Array; arc: Float32Array; plane: Uint8Array; feed: Float32Array; param: Float32Array; line: Uint32Array; tool: Uint16Array; flags: Uint8Array; t: Float64Array }` (`end`/`arc` hold 3 floats per row)
  - `type Severity`, `type DiagnosticCode` (11 codes: the 10 from the spec plus `too-many-moves`), `interface Diagnostic { line: number /* 0-based */; severity; code; message }`
  - `decodeProgramText(bytes): string`
  - `interface WordBuffer { letters: Uint8Array; values: Float64Array; count: number }`, `createWordBuffer(capacity = 32)`, `computeLineStarts(text): Uint32Array`, `lexLine(text, start, end, out): number` (returns `LineFlag` bits; `N`/`O` words are skipped; letters stored as upper-case char codes)

- [ ] **Step 1: Write the failing tests**

`packages/core/test/gcode-lexer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeProgramText } from '../src/gcode/decode';
import { computeLineStarts, createWordBuffer, lexLine } from '../src/gcode/lexer';
import { LineFlag } from '../src/gcode/types';

function lex(line: string) {
  const buf = createWordBuffer(2); // tiny on purpose: must grow
  const flags = lexLine(line, 0, line.length, buf);
  const words: string[] = [];
  for (let i = 0; i < buf.count; i++) words.push(`${String.fromCharCode(buf.letters[i])}${buf.values[i]}`);
  return { flags, words };
}

describe('lexLine', () => {
  it('reads packed, spaced and lower-case words', () => {
    expect(lex('G1X10Y-2.5').words).toEqual(['G1', 'X10', 'Y-2.5']);
    expect(lex('g 1 x 10.5  y+3').words).toEqual(['G1', 'X10.5', 'Y3']);
    expect(lex('X.5 Y-.25 Z0.').words).toEqual(['X0.5', 'Y-0.25', 'Z0']);
  });

  it('drops comments, line numbers, program numbers, % and checksums', () => {
    expect(lex('N10 G0 X1 (rapid) Y2 ; tail comment').words).toEqual(['G0', 'X1', 'Y2']);
    expect(lex('O1234 (PART)').words).toEqual([]);
    expect(lex('%').words).toEqual([]);
    expect(lex('N20 G1 X1*47').words).toEqual(['G1', 'X1']);
    expect(lex('/G1 X2').words).toEqual(['G1', 'X2']);
    expect(lex('  ').words).toEqual([]);
  });

  it('keeps decimal G codes', () => {
    expect(lex('G90.1 G91.1').words).toEqual(['G90.1', 'G91.1']);
  });

  it('flags macro syntax', () => {
    for (const line of ['#1=5', 'G1 X#1', 'IF [#1 GT 0] GOTO 10', 'WHILE [#2 LT 3] DO1', 'G1 X[1+2]']) {
      expect(lex(line).flags).toBe(LineFlag.Macro | LineFlag.NotSimulated);
    }
  });

  it('flags malformed words as not simulated', () => {
    expect(lex('G1 X').flags).toBe(LineFlag.NotSimulated);
    expect(lex('G1 X1 = 2').flags).toBe(LineFlag.NotSimulated);
    expect(lex('G1 X1').flags).toBe(0);
  });
});

describe('computeLineStarts', () => {
  it('finds the start of every line for LF and CRLF text', () => {
    expect(Array.from(computeLineStarts('a\nb\r\nc'))).toEqual([0, 2, 5]);
    expect(Array.from(computeLineStarts(''))).toEqual([0]);
    expect(Array.from(computeLineStarts('x\n'))).toEqual([0, 2]);
  });

  it('lets lexLine read CRLF lines', () => {
    const text = 'G0 X1\r\nG1 Y2\r\n';
    const starts = computeLineStarts(text);
    const buf = createWordBuffer();
    lexLine(text, starts[0], starts[1], buf);
    expect(buf.count).toBe(2);
    expect(buf.values[1]).toBe(1);
  });
});

describe('decodeProgramText', () => {
  it('decodes UTF-8 and falls back to Latin-1', () => {
    expect(decodeProgramText(new TextEncoder().encode('(Ø6 fres)\nG0'))).toBe('(Ø6 fres)\nG0');
    expect(decodeProgramText(new Uint8Array([0x28, 0xd8, 0x29]))).toBe('(Ø)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gcode-lexer`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement types, decoding and the lexer**

`packages/core/src/gcode/types.ts`:
```ts
export const MoveKind = {
  Rapid: 0,
  Feed: 1,
  ArcCW: 2,
  ArcCCW: 3,
  Dwell: 4,
  ToolChange: 5,
  Pause: 6,
  Home: 7,
} as const;
export type MoveKind = (typeof MoveKind)[keyof typeof MoveKind];

/** Per-row flags in MotionTable.flags. */
export const RowFlag = {
  /** Peck/retract rapids generated inside a canned cycle. */
  CycleInternal: 1,
  /** The row started while at least one axis position was unknown. */
  UnknownStart: 2,
  /** G53 machine-coordinate move (drawn relative to the program origin). */
  MachineCoords: 4,
} as const;

/** Per-line flags from the lexer/interpreter. */
export const LineFlag = {
  NotSimulated: 1,
  Macro: 2,
} as const;

/**
 * One row per move or event, column-oriented so it can be transferred between threads.
 * Row i starts where row i − 1 ended; row 0 starts at `start`. Lengths mm, feeds mm/min, times s.
 */
export interface MotionTable {
  count: number;
  start: { x: number; y: number; z: number };
  kind: Uint8Array;
  /** 3 floats per row: end point in program coordinates. */
  end: Float32Array;
  /** 3 floats per row: arc centre (arcs only). */
  arc: Float32Array;
  /** 17, 18 or 19 for arcs, 0 otherwise. */
  plane: Uint8Array;
  /** Effective feed (programmed F clamped later by timing); 0 for rapids and events. */
  feed: Float32Array;
  /** Dwell seconds for MoveKind.Dwell, else 0. */
  param: Float32Array;
  /** 0-based source line. */
  line: Uint32Array;
  tool: Uint16Array;
  flags: Uint8Array;
  /** Cumulative end time in seconds (filled by computeTiming). */
  t: Float64Array;
}

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'rapid-into-stock'
  | 'below-stock-bottom'
  | 'feed-spindle-off'
  | 'feed-no-f'
  | 'arc-radius'
  | 'not-simulated'
  | 'no-g43'
  | 'other-work-offset'
  | 'unknown-axis'
  | 'inch-program'
  | 'too-many-moves';

export interface Diagnostic {
  /** 0-based source line. */
  line: number;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
}
```

`packages/core/src/gcode/decode.ts`:
```ts
/** Program text: UTF-8 when valid (BOM stripped), otherwise Latin-1 (older posts). */
export function decodeProgramText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}
```

`packages/core/src/gcode/lexer.ts`:
```ts
import { LineFlag } from './types';

/** Reusable word storage: letters as upper-case char codes, values as numbers. */
export interface WordBuffer {
  letters: Uint8Array;
  values: Float64Array;
  count: number;
}

export function createWordBuffer(capacity = 32): WordBuffer {
  return { letters: new Uint8Array(capacity), values: new Float64Array(capacity), count: 0 };
}

function push(buf: WordBuffer, letter: number, value: number): void {
  if (buf.count === buf.letters.length) {
    const letters = new Uint8Array(buf.letters.length * 2);
    const values = new Float64Array(buf.values.length * 2);
    letters.set(buf.letters);
    values.set(buf.values);
    buf.letters = letters;
    buf.values = values;
  }
  buf.letters[buf.count] = letter;
  buf.values[buf.count] = value;
  buf.count++;
}

/** Offset of the first character of every line (split on \n; a trailing \r is ignored by lexLine). */
export function computeLineStarts(text: string): Uint32Array {
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  const starts = new Uint32Array(lines);
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts[n++] = i + 1;
  return starts;
}

const SPACE = 32, TAB = 9, CR = 13, LF = 10;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const upper = (c: number) => (c >= 97 ? c - 32 : c);

/**
 * Tokenises text[start, end) into `out` (cleared first). Returns LineFlag bits: Macro|NotSimulated for
 * macro syntax (#, [, keywords like IF/GOTO/WHILE), NotSimulated for any other malformed content.
 */
export function lexLine(text: string, start: number, end: number, out: WordBuffer): number {
  out.count = 0;
  let i = start;
  const skipSpace = () => {
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c !== SPACE && c !== TAB && c !== CR) break;
      i++;
    }
  };
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === SPACE || c === TAB || c === CR || c === LF || c === 37 /* % */ || c === 47 /* / */) {
      i++;
      continue;
    }
    if (c === 40 /* ( */) {
      while (i < end && text.charCodeAt(i) !== 41) i++;
      i++;
      continue;
    }
    if (c === 59 /* ; */ || c === 42 /* * */) break;
    if (c === 35 /* # */ || c === 91 /* [ */) return LineFlag.Macro | LineFlag.NotSimulated;
    if (!isLetter(c)) return LineFlag.NotSimulated;

    const letter = upper(c);
    i++;
    skipSpace();
    if (i >= end) return LineFlag.NotSimulated;
    const next = text.charCodeAt(i);
    if (isLetter(next) || next === 35 || next === 91) return LineFlag.Macro | LineFlag.NotSimulated;

    // number: [+-] digits [. digits]
    let sign = 1;
    if (next === 45 /* - */ || next === 43 /* + */) {
      if (next === 45) sign = -1;
      i++;
      skipSpace();
    }
    // accumulate every digit as an integer and divide once, so 0.25 and 90.1 are correctly rounded
    let mantissa = 0;
    let fractionDigits = 0;
    let digits = 0;
    while (i < end && isDigit(text.charCodeAt(i))) {
      mantissa = mantissa * 10 + (text.charCodeAt(i) - 48);
      i++;
      digits++;
    }
    if (i < end && text.charCodeAt(i) === 46 /* . */) {
      i++;
      while (i < end && isDigit(text.charCodeAt(i))) {
        mantissa = mantissa * 10 + (text.charCodeAt(i) - 48);
        fractionDigits++;
        i++;
        digits++;
      }
    }
    const value = fractionDigits ? mantissa / 10 ** fractionDigits : mantissa;
    if (digits === 0) {
      if (i < end && text.charCodeAt(i) === 35) return LineFlag.Macro | LineFlag.NotSimulated;
      return LineFlag.NotSimulated;
    }
    if (letter === 78 /* N */ || letter === 79 /* O */) continue;
    push(out, letter, sign * value);
  }
  return 0;
}
```
Note: the interpreter still rounds G codes to one decimal before comparing them (`G90.1`).

Append to `packages/core/src/index.ts`:
```ts
export * from './gcode/types';
export * from './gcode/decode';
export * from './gcode/lexer';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test gcode-lexer && pnpm --filter @sponcam/core typecheck`
Expected: all pass. The Latin-1 case: `0xD8` alone is invalid UTF-8 and decodes to `Ø` in windows-1252.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): G-code types, text decoding and allocation-light lexer" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 4: Motion-table builder, arc geometry and the diagnostic sink

**Files:**
- Create: `packages/core/src/gcode/motion.ts`, `packages/core/src/gcode/arcs.ts`, `packages/core/src/gcode/diagnostics.ts`, `packages/core/test/gcode-arcs.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `MotionTable`, `Diagnostic`, `DiagnosticCode`, `Severity` (Task 3)
- Produces:
  - `class TableBuilder { constructor(capacity = 1024); get count(); push(kind, x, y, z, cx, cy, cz, plane, feed, param, line, tool, flags): void; build(start: {x,y,z}): MotionTable }`
  - `rowStart(table, i, out: Float64Array | number[]): void` (writes x,y,z of the row's start into `out[0..2]`)
  - `type Plane = 17 | 18 | 19`, `planeAxes(plane): [a, b, n]` (axis indices; G17 [0,1,2], G18 [2,0,1], G19 [1,2,0])
  - `interface ArcGeometry { a; b; n; ca; cb; r; a0; sweep; dn; endRadius }`, `arcGeometry(start, end, centre, plane, cw): ArcGeometry` (start/end/centre are `ArrayLike<number>` of length 3; a closed arc — start = end in the plane — is a full circle)
  - `arcPointInto(g, start, fraction, out)`, `arcLength(g)`, `arcBoundsInto(g, start, end, min: number[], max: number[])` (grows min/max to include the arc exactly)
  - `centreFromRadius(start, end, plane, r, cw): [number, number, number] | null`
  - `class DiagnosticSink { constructor(capPerCode = 200); add(d: Diagnostic): void; list(): Diagnostic[] }` (summary line per capped code; `list()` sorted by line, stable)

- [ ] **Step 1: Write the failing tests**

`packages/core/test/gcode-arcs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { arcBoundsInto, arcGeometry, arcLength, arcPointInto, centreFromRadius } from '../src/gcode/arcs';
import { DiagnosticSink } from '../src/gcode/diagnostics';
import { rowStart, TableBuilder } from '../src/gcode/motion';
import { MoveKind } from '../src/gcode/types';

const pt = (g: ReturnType<typeof arcGeometry>, s: number[], f: number) => {
  const out = [0, 0, 0];
  arcPointInto(g, s, f, out);
  return out.map((v) => Math.round(v * 1e9) / 1e9);
};

describe('arcGeometry', () => {
  it('computes CCW and CW sweeps in G17', () => {
    const ccw = arcGeometry([10, 0, 0], [0, 10, 0], [0, 0, 0], 17, false);
    expect(ccw.r).toBeCloseTo(10, 12);
    expect(ccw.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(pt(ccw, [10, 0, 0], 0.5)).toEqual([7.071067812, 7.071067812, 0]);
    const cw = arcGeometry([10, 0, 0], [0, 10, 0], [0, 0, 0], 17, true);
    expect(cw.sweep).toBeCloseTo(-1.5 * Math.PI, 12);
  });

  it('treats a closed arc as a full circle and supports helices', () => {
    const full = arcGeometry([10, 0, 0], [10, 0, -3], [0, 0, 0], 17, false);
    expect(full.sweep).toBeCloseTo(2 * Math.PI, 12);
    expect(full.dn).toBe(-3);
    expect(arcLength(full)).toBeCloseTo(Math.hypot(20 * Math.PI, 3), 9);
    expect(pt(full, [10, 0, 0], 0.5)).toEqual([-10, 0, -1.5]);
  });

  it('uses (Z, X) in G18 and (Y, Z) in G19 with CCW seen from the positive normal', () => {
    // G18: from +Z to +X counter-clockwise about +Y
    const g18 = arcGeometry([0, 0, 10], [10, 0, 0], [0, 0, 0], 18, false);
    expect(g18.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(pt(g18, [0, 0, 10], 0.5)).toEqual([7.071067812, 0, 7.071067812]);
    // G19: from +Y to +Z counter-clockwise about +X
    const g19 = arcGeometry([0, 10, 0], [0, 0, 10], [0, 0, 0], 19, false);
    expect(g19.sweep).toBeCloseTo(Math.PI / 2, 12);
  });

  it('reports the end radius for mismatch checks', () => {
    expect(arcGeometry([10, 0, 0], [0, 10.5, 0], [0, 0, 0], 17, false).endRadius).toBeCloseTo(10.5, 12);
  });

  it('bounds an arc exactly, including crossed quadrant points', () => {
    const g = arcGeometry([10, 0, 0], [-10, 0, 0], [0, 0, 0], 17, false); // upper half circle
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    arcBoundsInto(g, [10, 0, 0], [-10, 0, 0], min, max);
    expect(min).toEqual([-10, 0, 0]);
    expect(max.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([10, 10, 0]);
  });
});

describe('centreFromRadius', () => {
  it('picks the shorter arc for +R and the longer for -R', () => {
    const ccwShort = centreFromRadius([0, 0, 0], [10, 0, 0], 17, 10, false)!;
    expect(ccwShort[0]).toBeCloseTo(5, 12);
    expect(ccwShort[1]).toBeCloseTo(Math.sqrt(75), 12); // left of the chord
    const g = arcGeometry([0, 0, 0], [10, 0, 0], ccwShort, 17, false);
    expect(Math.abs(g.sweep)).toBeLessThan(Math.PI);
    const ccwLong = centreFromRadius([0, 0, 0], [10, 0, 0], 17, -10, false)!;
    expect(ccwLong[1]).toBeCloseTo(-Math.sqrt(75), 12);
    expect(Math.abs(arcGeometry([0, 0, 0], [10, 0, 0], ccwLong, 17, false).sweep)).toBeGreaterThan(Math.PI);
    const cwShort = centreFromRadius([0, 0, 0], [10, 0, 0], 17, 10, true)!;
    expect(cwShort[1]).toBeCloseTo(-Math.sqrt(75), 12);
  });

  it('handles a half circle and rejects impossible radii', () => {
    const half = centreFromRadius([0, 0, 0], [10, 0, 0], 17, 5, false)!;
    expect(half[0]).toBeCloseTo(5, 12);
    expect(half[1]).toBeCloseTo(0, 6);
    expect(centreFromRadius([0, 0, 0], [10, 0, 0], 17, 4, false)).toBeNull();
    expect(centreFromRadius([0, 0, 0], [0, 0, 0], 17, 4, false)).toBeNull();
  });
});

describe('TableBuilder', () => {
  it('grows and builds a trimmed table', () => {
    const b = new TableBuilder(1);
    b.push(MoveKind.Rapid, 1, 2, 3, 0, 0, 0, 0, 0, 0, 4, 1, 0);
    b.push(MoveKind.Feed, 5, 6, 7, 0, 0, 0, 0, 300, 0, 5, 1, 2);
    const t = b.build({ x: 0, y: 0, z: 10 });
    expect(t.count).toBe(2);
    expect(Array.from(t.end)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(Array.from(t.feed)).toEqual([0, 300]);
    expect(Array.from(t.line)).toEqual([4, 5]);
    expect(t.flags[1]).toBe(2);
    expect(t.t.length).toBe(2);
    const out = [0, 0, 0];
    rowStart(t, 0, out);
    expect(out).toEqual([0, 0, 10]);
    rowStart(t, 1, out);
    expect(out).toEqual([1, 2, 3]);
  });
});

describe('DiagnosticSink', () => {
  it('caps each code and sorts by line', () => {
    const sink = new DiagnosticSink(2);
    for (const line of [5, 1, 3, 4]) sink.add({ line, severity: 'warning', code: 'arc-radius', message: `arc ${line}` });
    sink.add({ line: 0, severity: 'info', code: 'inch-program', message: 'inch' });
    const list = sink.list();
    expect(list.map((d) => d.line)).toEqual([0, 1, 4, 5]); // the summary sits at the last overflowed line
    expect(list[2].message).toBe('… and 2 more arc-radius diagnostics');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gcode-arcs`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement the builder, arcs and sink**

`packages/core/src/gcode/motion.ts`:
```ts
import type { MotionTable } from './types';

/** Growable column storage for the interpreter; `build` trims to the used length. */
export class TableBuilder {
  private n = 0;
  private kind: Uint8Array;
  private end: Float32Array;
  private arc: Float32Array;
  private plane: Uint8Array;
  private feed: Float32Array;
  private param: Float32Array;
  private line: Uint32Array;
  private tool: Uint16Array;
  private flags: Uint8Array;

  constructor(capacity = 1024) {
    const c = Math.max(1, capacity);
    this.kind = new Uint8Array(c);
    this.end = new Float32Array(c * 3);
    this.arc = new Float32Array(c * 3);
    this.plane = new Uint8Array(c);
    this.feed = new Float32Array(c);
    this.param = new Float32Array(c);
    this.line = new Uint32Array(c);
    this.tool = new Uint16Array(c);
    this.flags = new Uint8Array(c);
  }

  get count(): number {
    return this.n;
  }

  private grow(): void {
    const c = this.kind.length * 2;
    const g = <T extends Uint8Array | Uint16Array | Uint32Array | Float32Array>(a: T, size: number): T => {
      const next = new (a.constructor as new (n: number) => T)(size);
      next.set(a);
      return next;
    };
    this.kind = g(this.kind, c);
    this.end = g(this.end, c * 3);
    this.arc = g(this.arc, c * 3);
    this.plane = g(this.plane, c);
    this.feed = g(this.feed, c);
    this.param = g(this.param, c);
    this.line = g(this.line, c);
    this.tool = g(this.tool, c);
    this.flags = g(this.flags, c);
  }

  push(kind: number, x: number, y: number, z: number, cx: number, cy: number, cz: number, plane: number, feed: number, param: number, line: number, tool: number, flags: number): void {
    if (this.n === this.kind.length) this.grow();
    const i = this.n++;
    this.kind[i] = kind;
    this.end[i * 3] = x;
    this.end[i * 3 + 1] = y;
    this.end[i * 3 + 2] = z;
    this.arc[i * 3] = cx;
    this.arc[i * 3 + 1] = cy;
    this.arc[i * 3 + 2] = cz;
    this.plane[i] = plane;
    this.feed[i] = feed;
    this.param[i] = param;
    this.line[i] = line;
    this.tool[i] = tool;
    this.flags[i] = flags;
  }

  build(start: { x: number; y: number; z: number }): MotionTable {
    const n = this.n;
    return {
      count: n,
      start: { ...start },
      kind: this.kind.slice(0, n),
      end: this.end.slice(0, n * 3),
      arc: this.arc.slice(0, n * 3),
      plane: this.plane.slice(0, n),
      feed: this.feed.slice(0, n),
      param: this.param.slice(0, n),
      line: this.line.slice(0, n),
      tool: this.tool.slice(0, n),
      flags: this.flags.slice(0, n),
      t: new Float64Array(n),
    };
  }
}

/** Writes the start point of row i (the previous row's end, or table.start) into out[0..2]. */
export function rowStart(table: MotionTable, i: number, out: { [k: number]: number }): void {
  if (i === 0) {
    out[0] = table.start.x;
    out[1] = table.start.y;
    out[2] = table.start.z;
  } else {
    const j = (i - 1) * 3;
    out[0] = table.end[j];
    out[1] = table.end[j + 1];
    out[2] = table.end[j + 2];
  }
}
```

`packages/core/src/gcode/arcs.ts`:
```ts
const TAU = 2 * Math.PI;

export type Plane = 17 | 18 | 19;

/** [first in-plane axis, second in-plane axis, normal] — right-handed, so CCW = increasing angle seen from +normal. */
export function planeAxes(plane: Plane): [number, number, number] {
  return plane === 17 ? [0, 1, 2] : plane === 18 ? [2, 0, 1] : [1, 2, 0];
}

export interface ArcGeometry {
  a: number;
  b: number;
  n: number;
  /** Centre in plane coordinates. */
  ca: number;
  cb: number;
  /** Radius at the start point. */
  r: number;
  /** Start angle (radians). */
  a0: number;
  /** Signed sweep: positive CCW, |sweep| ∈ (0, 2π]. */
  sweep: number;
  /** Travel along the plane normal (helix). */
  dn: number;
  /** Distance from centre to the end point (for mismatch checks). */
  endRadius: number;
}

type P3 = ArrayLike<number>;

export function arcGeometry(start: P3, end: P3, centre: P3, plane: Plane, cw: boolean): ArcGeometry {
  const [a, b, n] = planeAxes(plane);
  const ca = centre[a], cb = centre[b];
  const sa = start[a] - ca, sb = start[b] - cb;
  const ea = end[a] - ca, eb = end[b] - cb;
  const a0 = Math.atan2(sb, sa);
  const a1 = Math.atan2(eb, ea);
  const closed = Math.hypot(end[a] - start[a], end[b] - start[b]) < 1e-9;
  let sweep: number;
  if (closed) sweep = cw ? -TAU : TAU;
  else if (cw) sweep = -((((a0 - a1) % TAU) + TAU) % TAU);
  else sweep = (((a1 - a0) % TAU) + TAU) % TAU;
  return { a, b, n, ca, cb, r: Math.hypot(sa, sb), a0, sweep, dn: end[n] - start[n], endRadius: Math.hypot(ea, eb) };
}

export function arcPointInto(g: ArcGeometry, start: P3, fraction: number, out: { [k: number]: number }): void {
  const angle = g.a0 + g.sweep * fraction;
  out[g.a] = g.ca + g.r * Math.cos(angle);
  out[g.b] = g.cb + g.r * Math.sin(angle);
  out[g.n] = start[g.n] + g.dn * fraction;
}

export function arcLength(g: ArcGeometry): number {
  return Math.hypot(g.r * Math.abs(g.sweep), g.dn);
}

/** Grows min/max (3 values each) to contain the arc: end points plus every quadrant point inside the sweep. */
export function arcBoundsInto(g: ArcGeometry, start: P3, end: P3, min: number[], max: number[]): void {
  const include = (p: P3) => {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  };
  include(start);
  include(end);
  const lo = Math.min(g.a0, g.a0 + g.sweep);
  const hi = Math.max(g.a0, g.a0 + g.sweep);
  const first = Math.ceil(lo / (Math.PI / 2));
  const p = [0, 0, 0];
  for (let k = first; k * (Math.PI / 2) <= hi; k++) {
    const angle = k * (Math.PI / 2);
    const fraction = (angle - g.a0) / g.sweep;
    arcPointInto(g, start, fraction, p);
    include(p);
  }
}

/**
 * Centre for an R-format arc: +R takes the shorter arc (≤ 180°), −R the longer one.
 * Returns null when start = end (R cannot describe a full circle) or |R| is too small for the chord.
 */
export function centreFromRadius(start: P3, end: P3, plane: Plane, r: number, cw: boolean): [number, number, number] | null {
  const [a, b] = planeAxes(plane);
  const da = end[a] - start[a], db = end[b] - start[b];
  const d = Math.hypot(da, db);
  if (d < 1e-9) return null;
  const radius = Math.abs(r);
  const h2 = radius * radius - (d / 2) * (d / 2);
  if (h2 < -1e-6 * Math.max(1, radius * radius)) return null;
  const h = Math.sqrt(Math.max(0, h2));
  const left = !cw === r > 0; // CCW short arc and CW long arc have the centre left of the chord
  const s = left ? 1 : -1;
  const centre: [number, number, number] = [start[0], start[1], start[2]];
  centre[a] = start[a] + da / 2 + (-db / d) * h * s;
  centre[b] = start[b] + db / 2 + (da / d) * h * s;
  return centre;
}
```

`packages/core/src/gcode/diagnostics.ts`:
```ts
import type { Diagnostic, DiagnosticCode } from './types';

/** Collects diagnostics, keeping at most `capPerCode` of each code plus one "… and N more" summary. */
export class DiagnosticSink {
  private items: Diagnostic[] = [];
  private counts = new Map<DiagnosticCode, number>();
  private lastOverflow = new Map<DiagnosticCode, Diagnostic>();

  constructor(private readonly capPerCode = 200) {}

  add(d: Diagnostic): void {
    const n = (this.counts.get(d.code) ?? 0) + 1;
    this.counts.set(d.code, n);
    if (n <= this.capPerCode) this.items.push(d);
    else this.lastOverflow.set(d.code, d);
  }

  list(): Diagnostic[] {
    const out = [...this.items];
    for (const [code, last] of this.lastOverflow) {
      const extra = (this.counts.get(code) ?? 0) - this.capPerCode;
      out.push({ line: last.line, severity: last.severity, code, message: `… and ${extra} more ${code} diagnostics` });
    }
    return out.sort((x, y) => x.line - y.line);
  }
}
```
(`Array.prototype.sort` is stable, so the summary stays after the kept item on the same line.)

Append to `packages/core/src/index.ts`:
```ts
export * from './gcode/motion';
export * from './gcode/arcs';
export * from './gcode/diagnostics';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test gcode-arcs && pnpm --filter @sponcam/core typecheck`
Expected: all pass. If the G18 expectation fails, re-check `planeAxes`: G18's in-plane axes are (Z, X) so that Z × X = +Y.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): motion table builder, per-plane arc geometry and capped diagnostics" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 5: Interpreter and canned cycles

**Files:**
- Create: `packages/core/src/gcode/cycles.ts`, `packages/core/src/gcode/interpreter.ts`, `packages/core/test/gcode-interpreter.test.ts`, `packages/core/test/gcode-cycles.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: lexer (Task 3), `TableBuilder`, arcs, `DiagnosticSink` (Task 4), `WorkOffset` (Milestone 1 job types)
- Produces:
  - `type CycleCode = 81 | 82 | 83 | 73`, `interface CycleParams { code; x; y; z; r; q; p; retract: 98 | 99; initialZ }`, `PECK_CLEARANCE = 0.2`, `expandCycle(from: {x,y,z}, c: CycleParams, emit: (kind: 'rapid' | 'feed' | 'dwell', x, y, z, internal: boolean, seconds?: number) => void): void`
  - `interface InterpretOptions { jobWorkOffset: WorkOffset; maxRows?: number /* default MAX_ROWS = 5_000_000 */ }`
  - `interface InterpretResult { table: MotionTable; lineStarts: Uint32Array; lineFlags: Uint8Array; firstMoveOfLine: Int32Array; diagnostics: Diagnostic[]; tools: number[]; usesInch: boolean }`
  - `interpretProgram(text: string, opts: InterpretOptions): InterpretResult`

- [ ] **Step 1: Write the failing cycle tests**

`packages/core/test/gcode-cycles.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { type CycleParams, expandCycle } from '../src/gcode/cycles';

function run(c: Partial<CycleParams> & Pick<CycleParams, 'code'>) {
  const params: CycleParams = { x: 10, y: 20, z: -3, r: 1, q: 0, p: 0, retract: 98, initialZ: 5, ...c };
  const out: string[] = [];
  expandCycle({ x: 0, y: 0, z: 5 }, params, (kind, x, y, z, internal, seconds) =>
    out.push(`${kind}${internal ? '*' : ''} ${x},${y},${Math.round(z * 1000) / 1000}${seconds ? ` ${seconds}s` : ''}`));
  return out;
}

describe('expandCycle', () => {
  it('G81: approach, drill, retract to the initial level', () => {
    expect(run({ code: 81 })).toEqual(['rapid 10,20,5', 'rapid 10,20,1', 'feed 10,20,-3', 'rapid* 10,20,5']);
  });

  it('G99 retracts to R', () => {
    expect(run({ code: 81, retract: 99 }).at(-1)).toBe('rapid* 10,20,1');
  });

  it('G82 dwells at the bottom', () => {
    expect(run({ code: 82, p: 0.5 })).toEqual(['rapid 10,20,5', 'rapid 10,20,1', 'feed 10,20,-3', 'dwell 10,20,-3 0.5s', 'rapid* 10,20,5']);
  });

  it('G83 pecks with full retract and a clearance re-approach', () => {
    expect(run({ code: 83, q: 2 })).toEqual([
      'rapid 10,20,5', 'rapid 10,20,1',
      'feed 10,20,-1', 'rapid* 10,20,1', 'rapid* 10,20,-0.8',
      'feed 10,20,-3',
      'rapid* 10,20,5',
    ]);
  });

  it('G73 pecks with a small chip-breaking retract', () => {
    expect(run({ code: 73, q: 2 })).toEqual([
      'rapid 10,20,5', 'rapid 10,20,1',
      'feed 10,20,-1', 'rapid* 10,20,-0.8',
      'feed 10,20,-3',
      'rapid* 10,20,5',
    ]);
  });

  it('drills a peck cycle in one pass when Q is missing', () => {
    expect(run({ code: 83, q: 0 })).toEqual(['rapid 10,20,5', 'rapid 10,20,1', 'feed 10,20,-3', 'rapid* 10,20,5']);
  });
});
```

- [ ] **Step 2: Implement `cycles.ts` and run the cycle tests**

`packages/core/src/gcode/cycles.ts`:
```ts
export type CycleCode = 81 | 82 | 83 | 73;

/** Absolute cycle parameters in mm (p in seconds). q ≤ 0 means "no pecking". */
export interface CycleParams {
  code: CycleCode;
  x: number;
  y: number;
  /** Hole bottom. */
  z: number;
  /** Retract (R) plane. */
  r: number;
  q: number;
  p: number;
  retract: 98 | 99;
  /** Z when the cycle mode started (G98 return level). */
  initialZ: number;
}

/** G83 re-approach clearance and G73 chip-break retract, mm. */
export const PECK_CLEARANCE = 0.2;

export type CycleEmit = (kind: 'rapid' | 'feed' | 'dwell', x: number, y: number, z: number, internal: boolean, seconds?: number) => void;

/** Expands one hole of a canned cycle into moves, starting from `from`. */
export function expandCycle(from: { x: number; y: number; z: number }, c: CycleParams, emit: CycleEmit): void {
  const { x, y } = c;
  emit('rapid', x, y, from.z, false);
  emit('rapid', x, y, c.r, false);
  const pecking = (c.code === 83 || c.code === 73) && c.q > 0;
  if (!pecking) {
    emit('feed', x, y, c.z, false);
  } else {
    let depth = c.r;
    let first = true;
    while (depth > c.z + 1e-9) {
      const next = Math.max(depth - c.q, c.z);
      if (!first) {
        if (c.code === 83) {
          emit('rapid', x, y, c.r, true);
          emit('rapid', x, y, depth + PECK_CLEARANCE, true);
        } else {
          emit('rapid', x, y, depth + PECK_CLEARANCE, true);
        }
      }
      emit('feed', x, y, next, false);
      depth = next;
      first = false;
    }
  }
  if (c.code === 82 && c.p > 0) emit('dwell', x, y, c.z, false, c.p);
  emit('rapid', x, y, c.retract === 98 ? Math.max(c.initialZ, c.r) : c.r, true);
}
```
Note: the G73 expectation in the test expects the chip-break rapid *after* the first peck — trace: first peck feeds 1 → −1; second iteration emits `rapid* −0.8` then `feed −3`. Matches.

Run: `pnpm --filter @sponcam/core test gcode-cycles`
Expected: PASS.

- [ ] **Step 3: Write the failing interpreter tests**

`packages/core/test/gcode-interpreter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { interpretProgram } from '../src/gcode/interpreter';
import { LineFlag, MoveKind, RowFlag } from '../src/gcode/types';

const run = (text: string, maxRows?: number) => interpretProgram(text, { jobWorkOffset: 'G54', maxRows });
const ends = (r: ReturnType<typeof run>) =>
  Array.from({ length: r.table.count }, (_, i) => Array.from(r.table.end.slice(i * 3, i * 3 + 3)).map((v) => Math.round(v * 1000) / 1000));
const kinds = (r: ReturnType<typeof run>) => Array.from(r.table.kind);
const codes = (r: ReturnType<typeof run>) => r.diagnostics.map((d) => `${d.code}@${d.line}`);

const HEADER = 'G21 G90 G17\nS1000 M3\n';

describe('interpretProgram: motion and modal state', () => {
  it('carries modal motion, feed and coordinates across lines', () => {
    const r = run(`${HEADER}G0 X1 Y2 Z3\nX4\nG1 Z0 F200\nY5\n`);
    expect(kinds(r)).toEqual([MoveKind.Rapid, MoveKind.Rapid, MoveKind.Feed, MoveKind.Feed]);
    expect(ends(r)).toEqual([[1, 2, 3], [4, 2, 3], [4, 2, 0], [4, 5, 0]]);
    expect(Array.from(r.table.feed)).toEqual([0, 0, 200, 200]);
    expect(Array.from(r.table.line)).toEqual([2, 3, 4, 5]);
    expect(Array.from(r.firstMoveOfLine)).toEqual([-1, -1, 0, 1, 2, 3, -1]);
  });

  it('converts inches and flags inch programs', () => {
    const r = run('G20 G90\nS1 M3\nG1 X1 Y0.5 Z0 F10\n');
    expect(ends(r)).toEqual([[25.4, 12.7, 0]]);
    expect(r.table.feed[0]).toBeCloseTo(254, 4);
    expect(r.usesInch).toBe(true);
    expect(codes(r)).toContain('inch-program@0');
  });

  it('handles incremental moves', () => {
    const r = run(`${HEADER}G0 X1 Y1 Z1\nG91\nG0 X2\nX2 Z-1\n`);
    expect(ends(r).slice(1)).toEqual([[3, 1, 1], [5, 1, 0]]);
  });

  it('builds arcs from I/J and from R, in every plane', () => {
    const r = run(`${HEADER}G0 X10 Y0 Z0\nG3 X0 Y10 I-10 J0 F100\nG2 X10 Y0 R10\nG18 G2 X15 Z5 I5 K0\nG19 G3 Y5 Z10 J0 K5\n`);
    expect(kinds(r).slice(1)).toEqual([MoveKind.ArcCCW, MoveKind.ArcCW, MoveKind.ArcCW, MoveKind.ArcCCW]);
    expect(Array.from(r.table.arc.slice(3, 6))).toEqual([0, 0, 0]);
    expect(Array.from(r.table.plane.slice(1))).toEqual([17, 17, 18, 19]);
    expect(Array.from(r.table.arc.slice(9, 12))).toEqual([15, 0, 0]); // G18 centre: X+I, Z+K from (10,0,0)
    expect(r.diagnostics.filter((d) => d.code === 'arc-radius')).toEqual([]);
  });

  it('reports arc end-radius mismatches over 0.01 mm', () => {
    const r = run(`${HEADER}G0 X10 Y0 Z0\nG3 X0 Y10.5 I-10 J0 F100\n`);
    expect(codes(r)).toContain('arc-radius@3');
  });

  it('records tool changes, dwells, pauses and spindle state', () => {
    const r = run('G21 G90\nT3 M6\nG4 P1.5\nM0\nG0 X1 Y1 Z1\nG1 X2 F100\n');
    expect(kinds(r)).toEqual([MoveKind.ToolChange, MoveKind.Dwell, MoveKind.Pause, MoveKind.Rapid, MoveKind.Feed]);
    expect(r.table.param[1]).toBe(1.5);
    expect(r.table.tool[4]).toBe(3);
    expect(r.tools).toEqual([3]);
    expect(codes(r)).toContain('feed-spindle-off@5');
  });

  it('flags feed moves without F', () => {
    expect(codes(run(`${HEADER}G0 X0 Y0 Z0\nG1 X5\n`))).toContain('feed-no-f@3');
  });

  it('marks unknown-start rows and warns about feed moves with unknown axes', () => {
    const r = run(`${HEADER}G0 Z5\nG0 X1 Y1\nG1 X2 F100\n`);
    expect(Array.from(r.table.flags)).toEqual([RowFlag.UnknownStart, RowFlag.UnknownStart, 0]);
    expect(r.diagnostics.filter((d) => d.code === 'unknown-axis')).toEqual([]);
    expect(codes(run(`${HEADER}G1 X5 F100\n`))).toContain('unknown-axis@2');
  });

  it('flags macros, unsupported codes and cutter compensation without stopping', () => {
    const r = run(`${HEADER}#1=5\nG93\nG41 D1\nG0 X1 Y1 Z1\nM98 P100\n`);
    expect(r.lineFlags[2]).toBe(LineFlag.Macro | LineFlag.NotSimulated);
    expect(r.lineFlags[3] & LineFlag.NotSimulated).toBeTruthy();
    expect(codes(r)).toEqual(expect.arrayContaining(['not-simulated@2', 'not-simulated@3', 'not-simulated@4', 'not-simulated@6']));
    expect(r.table.count).toBe(1);
  });

  it('warns about other work offsets and G53', () => {
    const r = run(`${HEADER}G55 G0 X1 Y1 Z1\nG53 G0 Z0\n`);
    expect(codes(r)).toEqual(expect.arrayContaining(['other-work-offset@2', 'other-work-offset@3']));
    expect(r.table.flags[1] & RowFlag.MachineCoords).toBeTruthy();
  });

  it('warns when a tool change is not followed by G43 in a program that uses G43', () => {
    const text = 'G21 G90\nT1 M6\nG43 H1\nS1 M3\nG0 X0 Y0 Z5\nT2 M6\nG0 Z10\nG43 H2\n';
    expect(codes(run(text)).filter((c) => c.startsWith('no-g43'))).toEqual(['no-g43@5']);
    expect(codes(run('G21 G90\nT1 M6\nG0 X0 Y0 Z5\n')).filter((c) => c.startsWith('no-g43'))).toEqual([]);
  });

  it('handles G28 as a home event with unknown position afterwards', () => {
    const r = run(`${HEADER}G0 X1 Y1 Z1\nG28 Z5\nG0 X2\n`);
    expect(kinds(r)).toEqual([MoveKind.Rapid, MoveKind.Rapid, MoveKind.Home, MoveKind.Rapid]);
    expect(r.table.flags[3] & RowFlag.UnknownStart).toBeTruthy();
  });

  it('expands canned cycles and repeats them on following XY lines', () => {
    const r = run(`${HEADER}G0 X0 Y0 Z5\nG81 X10 Y0 Z-2 R1 F100\nX20\nG80\nG0 Z5\n`);
    const cycleRows = Array.from(r.table.line).filter((l) => l === 3 || l === 4).length;
    expect(cycleRows).toBe(8);
    expect(ends(r)[4]).toEqual([10, 0, 5]); // G98 default: back to the initial level
    expect(r.table.flags[4] & RowFlag.CycleInternal).toBeTruthy();
  });

  it('refuses canned cycles in G91 or with L', () => {
    const r = run(`${HEADER}G0 X0 Y0 Z5\nG91 G81 X10 Z-2 R1 F100\n`);
    expect(codes(r)).toContain('not-simulated@3');
    expect(r.table.count).toBe(1);
  });

  it('stops at the row budget', () => {
    const r = run(`${HEADER}G0 X0 Y0 Z0\nX1\nX2\nX3\n`, 2);
    expect(r.table.count).toBe(2);
    expect(codes(r)).toContain('too-many-moves@4');
  });
});
```

- [ ] **Step 4: Run the interpreter tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gcode-interpreter`
Expected: FAIL — `../src/gcode/interpreter` cannot be resolved.

- [ ] **Step 5: Implement the interpreter**

`packages/core/src/gcode/interpreter.ts`:
```ts
import type { WorkOffset } from '../job/types';
import { centreFromRadius, arcGeometry, type Plane } from './arcs';
import { type CycleCode, type CycleParams, expandCycle } from './cycles';
import { DiagnosticSink } from './diagnostics';
import { computeLineStarts, createWordBuffer, lexLine } from './lexer';
import { TableBuilder } from './motion';
import { type Diagnostic, LineFlag, type MotionTable, MoveKind, RowFlag } from './types';

export const MAX_ROWS = 5_000_000;
const ARC_TOLERANCE = 0.01;

export interface InterpretOptions {
  jobWorkOffset: WorkOffset;
  maxRows?: number;
}

export interface InterpretResult {
  table: MotionTable;
  lineStarts: Uint32Array;
  lineFlags: Uint8Array;
  firstMoveOfLine: Int32Array;
  diagnostics: Diagnostic[];
  tools: number[];
  usesInch: boolean;
}

const L = (c: string) => c.charCodeAt(0);
const LETTER = { F: L('F'), G: L('G'), H: L('H'), I: L('I'), J: L('J'), K: L('K'), M: L('M'), P: L('P'), Q: L('Q'), R: L('R'), S: L('S'), T: L('T'), X: L('X'), Y: L('Y'), Z: L('Z'), D: L('D') };
const WORK_OFFSET_CODES: Record<string, WorkOffset> = { '54': 'G54', '55': 'G55', '56': 'G56', '57': 'G57', '58': 'G58', '59': 'G59' };
const IGNORED_G = new Set([40, 49, 61, 64, 94]);
const IGNORED_M = new Set([7, 8, 9, 2, 30, 1]);

class BudgetExceeded extends Error {}

export function interpretProgram(text: string, opts: InterpretOptions): InterpretResult {
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const lineStarts = computeLineStarts(text);
  const lineCount = lineStarts.length;
  const lineFlags = new Uint8Array(lineCount);
  const firstMoveOfLine = new Int32Array(lineCount).fill(-1);
  const builder = new TableBuilder(Math.min(Math.max(1024, lineCount), maxRows));
  const sink = new DiagnosticSink();
  const words = createWordBuffer();
  const tools = new Set<number>();

  // modal state
  let scale = 1;
  let absolute = true;
  let arcAbsolute = false;
  let plane: Plane = 17;
  let motion: number | null = 0; // 0,1,2,3 or a cycle code; null after G80
  let feed: number | null = null;
  let spindleOn = false;
  let tool = 0;
  let pendingTool = 0;
  let workOffset: WorkOffset = opts.jobWorkOffset;
  let retract: 98 | 99 = 98;
  let cycleR = NaN, cycleZ = NaN, cycleQ = 0, cycleP = 0, cycleInitialZ = NaN;
  let usesInch = false;
  let usesG43 = false;
  let pendingG43Line = -1; // tool change still waiting for G43 before a Z move
  const missingG43: number[] = [];
  const pos = [0, 0, 0];
  const known = [false, false, false];

  let line = 0;
  const addRow = (kind: number, x: number, y: number, z: number, cx: number, cy: number, cz: number, pl: number, f: number, param: number, flags: number) => {
    if (builder.count >= maxRows) throw new BudgetExceeded();
    if (firstMoveOfLine[line] < 0) firstMoveOfLine[line] = builder.count;
    builder.push(kind, x, y, z, cx, cy, cz, pl, f, param, line, tool, flags);
  };
  const diag = (code: Diagnostic['code'], severity: Diagnostic['severity'], message: string) => sink.add({ line, severity, code, message });
  const notSimulated = (message: string) => {
    lineFlags[line] |= LineFlag.NotSimulated;
    diag('not-simulated', 'warning', message);
  };
  const startFlags = () => (known[0] && known[1] && known[2] ? 0 : RowFlag.UnknownStart);
  const checkFeed = () => {
    if (feed === null) diag('feed-no-f', 'error', 'Feed move before any F word');
    if (!spindleOn) diag('feed-spindle-off', 'error', 'Feed move with the spindle stopped');
  };
  const noteZMove = (z: number) => {
    if (pendingG43Line >= 0 && Math.abs(z - pos[2]) > 1e-9) {
      missingG43.push(pendingG43Line);
      pendingG43Line = -1;
    }
  };

  try {
    for (line = 0; line < lineCount; line++) {
      const end = line + 1 < lineCount ? lineStarts[line + 1] : text.length;
      const lexFlags = lexLine(text, lineStarts[line], end, words);
      if (lexFlags) {
        lineFlags[line] = lexFlags;
        diag('not-simulated', 'warning', lexFlags & LineFlag.Macro ? 'Macro or variable syntax is not simulated' : 'Unrecognised characters; line not simulated');
        continue;
      }
      if (words.count === 0) continue;

      // gather words
      const g: number[] = [];
      const m: number[] = [];
      let x = NaN, y = NaN, z = NaN, i = NaN, j = NaN, k = NaN, r = NaN, f = NaN, p = NaN, q = NaN, t = NaN;
      let hasL = false;
      for (let w = 0; w < words.count; w++) {
        const letter = words.letters[w];
        const value = words.values[w];
        switch (letter) {
          case LETTER.G: g.push(Math.round(value * 10) / 10); break;
          case LETTER.M: m.push(Math.round(value)); break;
          case LETTER.X: x = value; break;
          case LETTER.Y: y = value; break;
          case LETTER.Z: z = value; break;
          case LETTER.I: i = value; break;
          case LETTER.J: j = value; break;
          case LETTER.K: k = value; break;
          case LETTER.R: r = value; break;
          case LETTER.F: f = value; break;
          case LETTER.P: p = value; break;
          case LETTER.Q: q = value; break;
          case LETTER.T: t = value; break;
          case LETTER.S: case LETTER.H: case LETTER.D: break;
          default: if (letter === L('L')) hasL = true; break;
        }
      }

      // units first, so F and coordinates on this line use them
      if (g.includes(20)) {
        scale = 25.4;
        if (!usesInch) diag('inch-program', 'info', 'Program uses inches (G20); values converted to mm');
        usesInch = true;
      }
      if (g.includes(21)) scale = 1;

      let machineCoords = false;
      let dwell = false;
      let home = false;
      let cycleCode: CycleCode | null = null;
      let skipMotion = false;
      for (const code of g) {
        if (code === 20 || code === 21) continue;
        if (code === 0 || code === 1 || code === 2 || code === 3) motion = code;
        else if (code === 81 || code === 82 || code === 83 || code === 73) cycleCode = code;
        else if (code === 80) motion = null;
        else if (code === 90) absolute = true;
        else if (code === 91) absolute = false;
        else if (code === 90.1) arcAbsolute = true;
        else if (code === 91.1) arcAbsolute = false;
        else if (code === 17 || code === 18 || code === 19) plane = code;
        else if (code === 4) dwell = true;
        else if (code === 28) home = true;
        else if (code === 53) machineCoords = true;
        else if (code === 43) {
          usesG43 = true;
          pendingG43Line = -1;
        } else if (code === 98 || code === 99) retract = code;
        else if (code === 41 || code === 42) notSimulated('Cutter compensation is not simulated; path drawn without it');
        else if (code === 93) {
          notSimulated('Inverse-time feed (G93) is not simulated');
          skipMotion = true;
        } else if (String(code) in WORK_OFFSET_CODES) {
          workOffset = WORK_OFFSET_CODES[String(code)];
          if (workOffset !== opts.jobWorkOffset) diag('other-work-offset', 'warning', `Program uses ${workOffset}; drawn at the job's ${opts.jobWorkOffset} origin`);
        } else if (code === 54.1) notSimulated('Extended work offsets (G54.1) are not simulated');
        else if (!IGNORED_G.has(code)) notSimulated(`G${code} is not simulated`);
      }
      if (!Number.isNaN(f)) feed = f * scale;
      if (!Number.isNaN(t)) pendingTool = Math.round(t);

      // M codes in execution order: tool change, spindle, pause
      for (const code of m) {
        if (code === 6) {
          tool = pendingTool;
          if (tool > 0) tools.add(tool);
          addRow(MoveKind.ToolChange, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, 0, 0);
          pendingG43Line = line;
        } else if (code === 3 || code === 4) spindleOn = true;
        else if (code === 5) spindleOn = false;
        else if (code === 0) addRow(MoveKind.Pause, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, 0, 0);
        else if (code === 98 || code === 99) notSimulated(`M${code} subprograms are not simulated`);
        else if (!IGNORED_M.has(code)) notSimulated(`M${code} is not simulated`);
      }
      if (skipMotion) continue;

      if (dwell) {
        const seconds = !Number.isNaN(p) ? p : !Number.isNaN(x) ? x : 0;
        addRow(MoveKind.Dwell, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, seconds, 0);
        continue;
      }

      // target from axis words
      const programmed = [!Number.isNaN(x), !Number.isNaN(y), !Number.isNaN(z)];
      const target = [pos[0], pos[1], pos[2]];
      [x, y, z].forEach((v, axis) => {
        if (!programmed[axis]) return;
        target[axis] = absolute || machineCoords || !known[axis] ? v * scale : pos[axis] + v * scale;
      });
      const anyAxis = programmed[0] || programmed[1] || programmed[2];

      if (home) {
        if (anyAxis) {
          noteZMove(target[2]);
          addRow(MoveKind.Rapid, target[0], target[1], target[2], 0, 0, 0, 0, 0, 0, startFlags());
          for (let a = 0; a < 3; a++) if (programmed[a]) { pos[a] = target[a]; known[a] = true; }
        }
        addRow(MoveKind.Home, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, 0, 0);
        known[0] = known[1] = known[2] = false;
        continue;
      }

      if (cycleCode !== null) {
        if (motion === null || motion < 4) cycleInitialZ = pos[2];
        motion = cycleCode;
      }
      if (motion !== null && motion >= 73 && (cycleCode !== null || programmed[0] || programmed[1])) {
        if (!Number.isNaN(r)) cycleR = r * scale;
        if (!Number.isNaN(z)) cycleZ = z * scale;
        if (!Number.isNaN(q)) cycleQ = q * scale;
        if (!Number.isNaN(p)) cycleP = p;
        if (!absolute || hasL) {
          notSimulated('Canned cycles in G91 or with an L repeat count are not simulated');
          continue;
        }
        if (Number.isNaN(cycleR) || Number.isNaN(cycleZ)) {
          notSimulated('Canned cycle without R or Z is not simulated');
          continue;
        }
        if ((motion === 83 || motion === 73) && !(cycleQ > 0)) diag('not-simulated', 'warning', `G${motion} without a positive Q; drilled in one pass`);
        checkFeed();
        const params: CycleParams = {
          code: motion as CycleCode, x: programmed[0] ? target[0] : pos[0], y: programmed[1] ? target[1] : pos[1],
          z: cycleZ, r: cycleR, q: cycleQ, p: cycleP, retract, initialZ: cycleInitialZ,
        };
        const from = { x: pos[0], y: pos[1], z: pos[2] };
        expandCycle(from, params, (kind, cx, cy, cz, internal, seconds) => {
          const flags = (internal ? RowFlag.CycleInternal : 0) | startFlags();
          noteZMove(cz);
          if (kind === 'dwell') addRow(MoveKind.Dwell, cx, cy, cz, 0, 0, 0, 0, 0, seconds ?? 0, flags);
          else addRow(kind === 'rapid' ? MoveKind.Rapid : MoveKind.Feed, cx, cy, cz, 0, 0, 0, 0, kind === 'feed' ? feed ?? 0 : 0, 0, flags);
          pos[0] = cx;
          pos[1] = cy;
          pos[2] = cz;
          known[0] = known[1] = known[2] = true;
        });
        continue;
      }

      if (!anyAxis || motion === null) continue;
      const flags = startFlags() | (machineCoords ? RowFlag.MachineCoords : 0);
      if (machineCoords) diag('other-work-offset', 'warning', 'G53 machine-coordinate move drawn relative to the program origin');
      noteZMove(target[2]);

      if (motion === 0) {
        addRow(MoveKind.Rapid, target[0], target[1], target[2], 0, 0, 0, 0, 0, 0, flags);
      } else if (motion === 1) {
        checkFeed();
        if (!programmed.every((pr, a) => pr || known[a])) diag('unknown-axis', 'warning', 'Feed move while an axis position is still unknown');
        addRow(MoveKind.Feed, target[0], target[1], target[2], 0, 0, 0, 0, feed ?? 0, 0, flags);
      } else {
        checkFeed();
        const cw = motion === 2;
        let centre: [number, number, number] | null;
        if (!Number.isNaN(r)) {
          centre = centreFromRadius(pos, target, plane, r * scale, cw);
          if (!centre) {
            notSimulated('R-format arc with an impossible radius or a full circle; drawn as a straight line');
            addRow(MoveKind.Feed, target[0], target[1], target[2], 0, 0, 0, 0, feed ?? 0, 0, flags);
            for (let a = 0; a < 3; a++) { pos[a] = target[a]; known[a] ||= programmed[a]; }
            continue;
          }
        } else {
          const off = [i, j, k].map((v) => (Number.isNaN(v) ? 0 : v * scale));
          centre = arcAbsolute
            ? [Number.isNaN(i) ? pos[0] : off[0], Number.isNaN(j) ? pos[1] : off[1], Number.isNaN(k) ? pos[2] : off[2]]
            : [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]];
        }
        const geometry = arcGeometry(pos, target, centre, plane, cw);
        if (Math.abs(geometry.endRadius - geometry.r) > ARC_TOLERANCE) {
          diag('arc-radius', 'warning', `Arc end radius differs from start radius by ${Math.abs(geometry.endRadius - geometry.r).toFixed(3)} mm`);
        }
        addRow(cw ? MoveKind.ArcCW : MoveKind.ArcCCW, target[0], target[1], target[2], centre[0], centre[1], centre[2], plane, feed ?? 0, 0, flags);
      }
      for (let a = 0; a < 3; a++) {
        pos[a] = target[a];
        known[a] ||= programmed[a];
      }
    }
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    sink.add({ line, severity: 'error', code: 'too-many-moves', message: `Program expands to more than ${maxRows} moves; simulation stopped here` });
  }

  if (usesG43) {
    for (const l of missingG43) sink.add({ line: l, severity: 'warning', code: 'no-g43', message: 'Tool change not followed by G43 before the next Z move' });
  }

  return {
    table: builder.build({ x: 0, y: 0, z: 0 }),
    lineStarts,
    lineFlags,
    firstMoveOfLine,
    diagnostics: sink.list(),
    tools: [...tools].sort((a, b) => a - b),
    usesInch,
  };
}
```
Notes for the implementer:
- `firstMoveOfLine` for the trailing empty line after the final newline stays −1 (hence the 7-entry expectation in the first test).
- A cycle line where both `cycleCode` and plain coordinates appear is handled once; a later XY-only line with `motion` still a cycle code repeats it.
- `noteZMove` runs before the row is added so a tool change followed by a Z move without G43 is caught; a G43 on a later line clears `pendingG43Line` only if it comes before that Z move.

Append to `packages/core/src/index.ts`:
```ts
export * from './gcode/cycles';
export * from './gcode/interpreter';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test gcode- && pnpm --filter @sponcam/core typecheck`
Expected: all G-code tests pass. If an expectation in the interpreter tests disagrees with the spec text, the spec wins — fix the code, not the test; if the test itself contradicts the spec, report it (DONE_WITH_CONCERNS) rather than weakening it.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): modal G-code interpreter with arcs, canned cycles and diagnostics" -m "Co-Authored-By: <your model trailer>"
```

---
### Task 6: Move timing and playback positions

**Files:**
- Create: `packages/core/src/gcode/timing.ts`, `packages/core/test/gcode-timing.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `MachineProfile` (Task 1), `MotionTable`, `rowStart`, arcs (Tasks 3–4), `interpretProgram` (Task 5, tests only)
- Produces:
  - `interface MoveKinematics { length: number /* mm */; v: number /* mm/s */; a: number /* mm/s² */; duration: number /* s */ }`
  - `trapezoidDuration(L, v, a)`, `trapezoidDistance(L, v, a, tau)`
  - `rowKinematics(table, i, profile): MoveKinematics` (dwell → `param`; tool change → `toolChangeSeconds`; pause/home → 0; F of 0 means `maxFeed`)
  - `computeTiming(table, profile): void` (fills `table.t`)
  - `rowStartTime(table, row): number`, `rowAtTime(table, time): number` (−1 for an empty table)
  - `positionAt(table, profile, row, tau, out: number[]): void` (tool position `tau` seconds into `row`, program coordinates)

- [ ] **Step 1: Write the failing tests**

`packages/core/test/gcode-timing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { interpretProgram } from '../src/gcode/interpreter';
import {
  computeTiming, positionAt, rowAtTime, rowKinematics, rowStartTime, trapezoidDistance, trapezoidDuration,
} from '../src/gcode/timing';
import { machinePreset } from '../src/job/machine';

const GRBL = machinePreset('Hobby GRBL router'); // rapid 5000/5000/1500 mm/min, accel 500/500/200 mm/s², maxFeed 5000
const table = (body: string) => interpretProgram(`G21 G90 G17\nS1000 M3\nG0 X0 Y0 Z0\n${body}`, { jobWorkOffset: 'G54' }).table;

describe('trapezoid', () => {
  it('cruises when the move is long enough, otherwise it is triangular', () => {
    expect(trapezoidDuration(100, 10, 100)).toBeCloseTo(10.1, 12);
    expect(trapezoidDuration(0.01, 10, 100)).toBeCloseTo(0.02, 12);
    expect(trapezoidDuration(0, 10, 100)).toBe(0);
  });

  it('covers the right distance over time, symmetric about the middle', () => {
    for (const [L, v, a] of [[100, 10, 100], [0.01, 10, 100]]) {
      const T = trapezoidDuration(L, v, a);
      expect(trapezoidDistance(L, v, a, 0)).toBe(0);
      expect(trapezoidDistance(L, v, a, T)).toBe(L);
      expect(trapezoidDistance(L, v, a, T / 2)).toBeCloseTo(L / 2, 9);
      expect(trapezoidDistance(L, v, a, T * 0.25) + trapezoidDistance(L, v, a, T * 0.75)).toBeCloseTo(L, 9);
    }
  });
});

describe('rowKinematics', () => {
  it('limits a rapid along X by the X rapid rate and acceleration', () => {
    const k = rowKinematics(table('G0 X100\n'), 1, GRBL);
    expect(k.length).toBe(100);
    expect(k.v).toBeCloseTo(5000 / 60, 9);
    expect(k.a).toBe(500);
    expect(k.duration).toBeCloseTo(100 / (5000 / 60) + 5000 / 60 / 500, 9);
  });

  it('uses the slowest axis on a diagonal', () => {
    const k = rowKinematics(table('G0 X100 Z100\n'), 1, GRBL);
    expect(k.v).toBeCloseTo((1500 / 60) * Math.SQRT2, 9);
    expect(k.a).toBeCloseTo(200 * Math.SQRT2, 9);
    expect(k.duration).toBeCloseTo(4.125, 9);
  });

  it('clamps feed to maxFeed and uses maxFeed when F is missing', () => {
    expect(rowKinematics(table('G1 X100 F10000\n'), 1, GRBL).v).toBeCloseTo(5000 / 60, 9);
    expect(rowKinematics(table('G1 X100 F600\n'), 1, GRBL).duration).toBeCloseTo(10.02, 9);
    expect(rowKinematics(table('G1 X100\n'), 1, GRBL).v).toBeCloseTo(5000 / 60, 9);
  });

  it('measures arcs along the curve', () => {
    const k = rowKinematics(table('G1 X10 F600\nG3 X-10 Y0 I-10 J0\n'), 2, GRBL);
    expect(k.length).toBeCloseTo(10 * Math.PI, 9);
  });

  it('times dwells and tool changes', () => {
    const t = table('G4 P1.5\nT2 M6\n');
    expect(rowKinematics(t, 1, GRBL).duration).toBe(1.5);
    expect(rowKinematics(t, 2, GRBL).duration).toBe(30);
  });
});

describe('computeTiming and playback helpers', () => {
  it('accumulates time and finds rows by time', () => {
    const t = table('G4 P2\nG1 X100 F600\n');
    computeTiming(t, GRBL);
    expect(t.t[0]).toBe(0);
    expect(t.t[1]).toBe(2);
    expect(t.t[2]).toBeCloseTo(12.02, 9);
    expect(rowStartTime(t, 2)).toBe(2);
    expect(rowAtTime(t, 0)).toBe(0);
    expect(rowAtTime(t, 1)).toBe(1);
    expect(rowAtTime(t, 5)).toBe(2);
    expect(rowAtTime(t, 999)).toBe(2);
  });

  it('interpolates the tool position with the same trapezoid', () => {
    const t = table('G1 X100 F600\nG3 X-100 Y0 I-100 J0\n');
    computeTiming(t, GRBL);
    const out = [0, 0, 0];
    const lineDuration = t.t[1] - t.t[0];
    positionAt(t, GRBL, 1, lineDuration / 2, out);
    expect(out[0]).toBeCloseTo(50, 9);
    const arcDuration = t.t[2] - t.t[1];
    positionAt(t, GRBL, 2, arcDuration / 2, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(100, 6);
    positionAt(t, GRBL, 2, arcDuration * 2, out);
    expect(out[0]).toBeCloseTo(-100, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gcode-timing`
Expected: FAIL — `../src/gcode/timing` cannot be resolved.

- [ ] **Step 3: Implement timing**

`packages/core/src/gcode/timing.ts`:
```ts
import type { MachineProfile } from '../job/machine';
import { arcGeometry, arcLength, arcPointInto, type Plane, planeAxes } from './arcs';
import { rowStart } from './motion';
import { type MotionTable, MoveKind } from './types';

export interface MoveKinematics {
  /** Path length, mm. */
  length: number;
  /** Cruise speed limit, mm/s. */
  v: number;
  /** Acceleration limit, mm/s². */
  a: number;
  /** Seconds, starting and ending at rest. */
  duration: number;
}

export function trapezoidDuration(L: number, v: number, a: number): number {
  if (L <= 0 || !(v > 0)) return 0;
  if (!(a > 0) || !Number.isFinite(a)) return L / v;
  return L >= (v * v) / a ? L / v + v / a : 2 * Math.sqrt(L / a);
}

/** Distance covered `tau` seconds into a rest-to-rest move of length L. */
export function trapezoidDistance(L: number, v: number, a: number, tau: number): number {
  const T = trapezoidDuration(L, v, a);
  if (tau <= 0 || T <= 0) return 0;
  if (tau >= T) return L;
  if (!(a > 0) || !Number.isFinite(a)) return v * tau;
  if (L >= (v * v) / a) {
    const ta = v / a;
    if (tau < ta) return 0.5 * a * tau * tau;
    if (tau <= T - ta) return 0.5 * a * ta * ta + v * (tau - ta);
  } else if (tau <= T / 2) {
    return 0.5 * a * tau * tau;
  }
  const rest = T - tau;
  return L - 0.5 * a * rest * rest;
}

const s = [0, 0, 0];
const e = [0, 0, 0];
const c = [0, 0, 0];
const d = [0, 0, 0];
const isArc = (kind: number) => kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW;

function loadRow(table: MotionTable, i: number): void {
  rowStart(table, i, s);
  for (let k = 0; k < 3; k++) {
    e[k] = table.end[i * 3 + k];
    c[k] = table.arc[i * 3 + k];
  }
}

export function rowKinematics(table: MotionTable, i: number, profile: MachineProfile): MoveKinematics {
  const kind = table.kind[i];
  if (kind === MoveKind.Dwell) return { length: 0, v: 0, a: 0, duration: table.param[i] };
  if (kind === MoveKind.ToolChange) return { length: 0, v: 0, a: 0, duration: profile.toolChangeSeconds };
  if (kind === MoveKind.Pause || kind === MoveKind.Home) return { length: 0, v: 0, a: 0, duration: 0 };

  loadRow(table, i);
  let length: number;
  const chord = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
  if (isArc(kind)) {
    const plane = table.plane[i] as Plane;
    length = arcLength(arcGeometry(s, e, c, plane, kind === MoveKind.ArcCW));
    if (chord < 1e-9) {
      // full circle: split the speed limit between the two in-plane axes
      const [a, b] = planeAxes(plane);
      d[0] = d[1] = d[2] = 0;
      d[a] = d[b] = Math.SQRT1_2;
    } else {
      for (let k = 0; k < 3; k++) d[k] = (e[k] - s[k]) / chord;
    }
  } else {
    length = chord;
    if (chord > 0) for (let k = 0; k < 3; k++) d[k] = (e[k] - s[k]) / chord;
  }
  if (!(length > 1e-12)) return { length: 0, v: 0, a: 0, duration: 0 };

  const rapid = [profile.rapid.x / 60, profile.rapid.y / 60, profile.rapid.z / 60];
  const accel = [profile.accel.x, profile.accel.y, profile.accel.z];
  const programmed = table.feed[i] > 0 ? table.feed[i] : profile.maxFeed;
  let v = kind === MoveKind.Rapid ? Infinity : Math.min(programmed, profile.maxFeed) / 60;
  let a = Infinity;
  for (let k = 0; k < 3; k++) {
    const dk = Math.abs(d[k]);
    if (dk < 1e-9) continue;
    v = Math.min(v, rapid[k] / dk);
    a = Math.min(a, accel[k] / dk);
  }
  return { length, v, a, duration: trapezoidDuration(length, v, a) };
}

/** Fills table.t with cumulative end times. */
export function computeTiming(table: MotionTable, profile: MachineProfile): void {
  let total = 0;
  for (let i = 0; i < table.count; i++) {
    total += rowKinematics(table, i, profile).duration;
    table.t[i] = total;
  }
}

export function rowStartTime(table: MotionTable, row: number): number {
  return row > 0 ? table.t[row - 1] : 0;
}

/** First row whose end time is ≥ time (clamped to the last row); −1 for an empty table. */
export function rowAtTime(table: MotionTable, time: number): number {
  const n = table.count;
  if (n === 0) return -1;
  if (time >= table.t[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table.t[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Tool position `tau` seconds into `row`, following the same trapezoid as the timing. */
export function positionAt(table: MotionTable, profile: MachineProfile, row: number, tau: number, out: number[]): void {
  const k = rowKinematics(table, row, profile);
  loadRow(table, row);
  if (k.length <= 0) {
    out[0] = s[0];
    out[1] = s[1];
    out[2] = s[2];
    return;
  }
  const fraction = trapezoidDistance(k.length, k.v, k.a, tau) / k.length;
  const kind = table.kind[row];
  if (isArc(kind)) {
    arcPointInto(arcGeometry(s, e, c, table.plane[row] as Plane, kind === MoveKind.ArcCW), s, fraction, out);
  } else {
    for (let j = 0; j < 3; j++) out[j] = s[j] + (e[j] - s[j]) * fraction;
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './gcode/timing';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test gcode-timing && pnpm --filter @sponcam/core typecheck`
Expected: all pass. The diagonal case: v = min(83.33/0.7071, 25/0.7071) = 35.36 mm/s, a = min(707, 282.8) = 282.8 mm/s², L = 141.42 → 4.0 + 0.125 = 4.125 s.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): trapezoidal move timing and playback positions from the machine profile" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 7: Program analysis (summary and stock checks)

**Files:**
- Create: `packages/core/src/gcode/analysis.ts`, `packages/core/test/gcode-analysis.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `rowKinematics` (Task 6), arcs, `DiagnosticSink`, types, `BBox` (Milestone 1)
- Produces:
  - `interface AnalysisContext { profile: MachineProfile; stock: BBox | null /* program coordinates */ }`
  - `interface ToolTime { tool: number; seconds: number }`
  - `interface ProgramSummary { totalSeconds; perTool: ToolTime[]; cutDistance; rapidDistance; plungeDistance; extents: BBox | null; feedRange: [number, number] | null; tools: number[]; lineCount; notSimulatedLines; moveCount }`
  - `interface AnalysisResult { summary: ProgramSummary; diagnostics: Diagnostic[] }`
  - `analyzeTable(table, lineFlags, ctx): AnalysisResult` (fills `table.t` as a side effect)
  - `segmentHitsBox(s, e, min, max): boolean`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/gcode-analysis.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { analyzeTable, segmentHitsBox } from '../src/gcode/analysis';
import { interpretProgram } from '../src/gcode/interpreter';
import { vec3 } from '../src/geometry/vec3';
import { machinePreset } from '../src/job/machine';

const profile = machinePreset('Hobby GRBL router');
// stock of the Milestone 1 box job, in program coordinates (WCS at the stock's min-X/min-Y/top corner)
const STOCK = { min: vec3(0, 0, -6), max: vec3(30, 20, 0) };
const PRE = 'G21 G90 G17 G54\nS10000 M3\nG0 X5 Y5 Z5\n'; // lines 0–2

function analyse(body: string, stock: typeof STOCK | null = STOCK) {
  const r = interpretProgram(PRE + body, { jobWorkOffset: 'G54' });
  return { r, a: analyzeTable(r.table, r.lineFlags, { profile, stock }) };
}
const codes = (x: ReturnType<typeof analyse>) => x.a.diagnostics.map((d) => `${d.code}@${d.line}`);

describe('segmentHitsBox', () => {
  it('clips segments against a box', () => {
    const min = [0, 0, -Infinity];
    const max = [10, 10, 0];
    expect(segmentHitsBox([5, 5, 5], [5, 5, -1], min, max)).toBe(true);
    expect(segmentHitsBox([-5, 5, -1], [-1, 5, -1], min, max)).toBe(false);
    expect(segmentHitsBox([-5, 5, -1], [15, 5, -1], min, max)).toBe(true);
    expect(segmentHitsBox([5, 5, 5], [5, 5, 1], min, max)).toBe(false);
  });
});

describe('analyzeTable: stock checks', () => {
  it('reports nothing for a clean program', () => {
    expect(analyse('G1 Z-1 F300\nG1 X10\nG0 Z5\nG0 X40 Y40\n').a.diagnostics).toEqual([]);
  });

  it('flags a rapid down into the stock', () => {
    expect(codes(analyse('G0 Z-2\nG0 Z5\n'))).toEqual(['rapid-into-stock@3']);
  });

  it('flags a level rapid below the stock top inside the footprint', () => {
    expect(codes(analyse('G1 Z-1 F300\nG0 X10\n'))).toEqual(['rapid-into-stock@4']);
  });

  it('ignores retracts, rapids outside the footprint and canned-cycle pecks', () => {
    expect(codes(analyse('G1 Z-1 F300\nG0 Z5\n'))).toEqual([]);
    expect(codes(analyse('G0 X-5 Y-5\nG0 Z-3\nG0 Z5\n'))).toEqual([]);
    expect(codes(analyse('G83 X10 Y10 Z-4 R1 Q1 F200\nG80\n'))).toEqual([]);
  });

  it('ignores moves from an unknown position', () => {
    const r = interpretProgram('G21 G90\nG0 X10 Y10\nG0 Z5\n', { jobWorkOffset: 'G54' });
    expect(analyzeTable(r.table, r.lineFlags, { profile, stock: STOCK }).diagnostics).toEqual([]);
  });

  it('flags moves below the stock bottom', () => {
    expect(codes(analyse('G1 Z-7 F300\nG0 Z5\n'))).toEqual(['below-stock-bottom@3']);
  });

  it('falls back to "below Z 0" without stock', () => {
    const x = analyse('G0 Z-1\nG0 Z5\n', null);
    expect(codes(x)).toEqual(['rapid-into-stock@3']);
    expect(x.a.diagnostics[0].message).toMatch(/below Z 0/);
  });
});

describe('analyzeTable: summary', () => {
  it('summarises time, distances, extents, feeds and tools', () => {
    const { r, a } = analyse('T4 M6\nG1 Z-1 F300\nG1 X15 F600\nG0 Z5\n#1=2\n');
    const s = a.summary;
    expect(s.totalSeconds).toBeCloseTo(r.table.t[r.table.count - 1], 9);
    expect(s.cutDistance).toBeCloseTo(16, 9);
    expect(s.plungeDistance).toBeCloseTo(6, 9);
    expect(s.rapidDistance).toBeCloseTo(6, 9); // the first rapid starts from an unknown position and is not counted
    expect(s.extents).toEqual({ min: vec3(5, 5, -1), max: vec3(15, 5, 5) });
    expect(s.feedRange).toEqual([300, 600]);
    expect(s.tools).toEqual([4]);
    expect(s.perTool.map((p) => p.tool)).toEqual([0, 4]);
    expect(s.perTool.reduce((sum, p) => sum + p.seconds, 0)).toBeCloseTo(s.totalSeconds, 9);
    expect(s.lineCount).toBe(9);
    expect(s.notSimulatedLines).toBe(1);
    expect(s.moveCount).toBe(4);
  });

  it('includes arc bulges in the extents', () => {
    const { a } = analyse('G1 Z0 F300\nG3 X-5 Y5 I-5 J0\n');
    expect(a.summary.extents?.max.y).toBeCloseTo(10, 9);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gcode-analysis`
Expected: FAIL — `../src/gcode/analysis` cannot be resolved.

- [ ] **Step 3: Implement analysis**

`packages/core/src/gcode/analysis.ts`:
```ts
import type { BBox } from '../geometry/bbox';
import { vec3 } from '../geometry/vec3';
import type { MachineProfile } from '../job/machine';
import { arcBoundsInto, arcGeometry, type Plane } from './arcs';
import { DiagnosticSink } from './diagnostics';
import { rowStart } from './motion';
import { rowKinematics } from './timing';
import { type Diagnostic, LineFlag, type MotionTable, MoveKind, RowFlag } from './types';

export interface AnalysisContext {
  profile: MachineProfile;
  /** Stock box in program coordinates, or null when the job has no stock. */
  stock: BBox | null;
}

export interface ToolTime {
  tool: number;
  seconds: number;
}

export interface ProgramSummary {
  totalSeconds: number;
  perTool: ToolTime[];
  cutDistance: number;
  rapidDistance: number;
  plungeDistance: number;
  extents: BBox | null;
  feedRange: [number, number] | null;
  tools: number[];
  lineCount: number;
  notSimulatedLines: number;
  moveCount: number;
}

export interface AnalysisResult {
  summary: ProgramSummary;
  diagnostics: Diagnostic[];
}

/** Liang–Barsky: does segment s→e touch the axis-aligned box [min, max]? */
export function segmentHitsBox(s: ArrayLike<number>, e: ArrayLike<number>, min: ArrayLike<number>, max: ArrayLike<number>): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = e[k] - s[k];
    if (Math.abs(d) < 1e-12) {
      if (s[k] < min[k] || s[k] > max[k]) return false;
      continue;
    }
    let ta = (min[k] - s[k]) / d;
    let tb = (max[k] - s[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

const EPS = 1e-6;

/** Times the table (fills table.t), summarises it and checks it against the stock. */
export function analyzeTable(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): AnalysisResult {
  const sink = new DiagnosticSink();
  const perTool = new Map<number, number>();
  const tools = new Set<number>();
  const s = [0, 0, 0];
  const e = [0, 0, 0];
  const c = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const rowMin = [0, 0, 0];
  const rowMax = [0, 0, 0];
  const stock = ctx.stock;
  const footMin = stock ? [stock.min.x, stock.min.y, -Infinity] : null;
  const footMax = stock ? [stock.max.x, stock.max.y, stock.max.z - EPS] : null;
  let total = 0;
  let cut = 0, rapid = 0, plunge = 0;
  let feedMin = Infinity, feedMax = -Infinity;
  let moves = 0;

  for (let i = 0; i < table.count; i++) {
    const kind = table.kind[i];
    const k = rowKinematics(table, i, ctx.profile);
    total += k.duration;
    table.t[i] = total;
    const tool = table.tool[i];
    perTool.set(tool, (perTool.get(tool) ?? 0) + k.duration);
    if (kind === MoveKind.ToolChange && tool > 0) tools.add(tool);
    if (kind > MoveKind.ArcCCW) continue; // events

    moves++;
    const flags = table.flags[i];
    const unknownStart = (flags & RowFlag.UnknownStart) !== 0;
    rowStart(table, i, s);
    for (let j = 0; j < 3; j++) {
      e[j] = table.end[i * 3 + j];
      c[j] = table.arc[i * 3 + j];
    }

    // bounds of this row (arcs exactly); unknown-start rows only contribute their end point
    for (let j = 0; j < 3; j++) {
      rowMin[j] = unknownStart ? e[j] : Math.min(s[j], e[j]);
      rowMax[j] = unknownStart ? e[j] : Math.max(s[j], e[j]);
    }
    if ((kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW) && !unknownStart) {
      arcBoundsInto(arcGeometry(s, e, c, table.plane[i] as Plane, kind === MoveKind.ArcCW), s, e, rowMin, rowMax);
    }
    for (let j = 0; j < 3; j++) {
      if (rowMin[j] < min[j]) min[j] = rowMin[j];
      if (rowMax[j] > max[j]) max[j] = rowMax[j];
    }

    if (unknownStart) continue;

    if (kind === MoveKind.Rapid) {
      rapid += k.length;
      const internal = (flags & RowFlag.CycleInternal) !== 0;
      const pureUp = e[2] > s[2] && Math.hypot(e[0] - s[0], e[1] - s[1]) < EPS;
      if (!internal && !pureUp) {
        if (footMin && footMax) {
          if (segmentHitsBox(s, e, footMin, footMax)) {
            sink.add({ line: table.line[i], severity: 'error', code: 'rapid-into-stock', message: 'Rapid move goes into the stock' });
          }
        } else if (e[2] < -EPS) {
          sink.add({ line: table.line[i], severity: 'error', code: 'rapid-into-stock', message: 'Rapid move below Z 0 (no stock defined)' });
        }
      }
    } else {
      cut += k.length;
      if (kind === MoveKind.Feed && e[2] < s[2] && Math.hypot(e[0] - s[0], e[1] - s[1]) < EPS) plunge += k.length;
      const f = table.feed[i];
      if (f > 0) {
        feedMin = Math.min(feedMin, f);
        feedMax = Math.max(feedMax, f);
      }
    }

    // the lowest point this move reaches (not where it started, so a retract from a too-deep cut is not reported twice)
    const lowest = kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW ? rowMin[2] : e[2];
    if (stock && lowest < stock.min.z - EPS) {
      sink.add({ line: table.line[i], severity: 'error', code: 'below-stock-bottom', message: 'Tool goes below the stock bottom' });
    }
  }

  let notSimulated = 0;
  for (let l = 0; l < lineFlags.length; l++) if (lineFlags[l] & LineFlag.NotSimulated) notSimulated++;

  return {
    summary: {
      totalSeconds: total,
      perTool: [...perTool].sort((x, y) => x[0] - y[0]).map(([tool, seconds]) => ({ tool, seconds })),
      cutDistance: cut,
      rapidDistance: rapid,
      plungeDistance: plunge,
      extents: min[0] <= max[0] ? { min: vec3(min[0], min[1], min[2]), max: vec3(max[0], max[1], max[2]) } : null,
      feedRange: feedMin <= feedMax ? [feedMin, feedMax] : null,
      tools: [...tools].sort((x, y) => x - y),
      lineCount: lineFlags.length,
      notSimulatedLines: notSimulated,
      moveCount: moves,
    },
    diagnostics: sink.list(),
  };
}
```
Summary test trace (so the implementer can check): lines 3 `T4 M6`, 4 `G1 Z-1` (plunge 6 mm from Z5), 5 `G1 X15` (10 mm), 6 `G0 Z5` (retract rapid 6 mm), 7 `#1=2`, 8 empty. Row 0 (`G0 X5 Y5 Z5`) starts unknown, so it is excluded from distances and only its end (5,5,5) enters the extents. Tool 0 runs row 0; tool 4 the rest.

Append to `packages/core/src/index.ts`:
```ts
export * from './gcode/analysis';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test gcode-analysis && pnpm --filter @sponcam/core typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): G-code analysis with run-time summary and stock collision checks" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 8: Program pipeline, fixture program and performance guard

**Files:**
- Create: `packages/core/src/gcode/program.ts`, `packages/core/test/gcode-program.test.ts`, `packages/core/test/fixtures/drill-arc.nc`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `decodeProgramText`, `interpretProgram`, `analyzeTable`, types (Tasks 3–7), `WorkOffset`
- Produces:
  - `interface ProgramContext extends AnalysisContext { jobWorkOffset: WorkOffset }`
  - `interface ParsedProgram { table: MotionTable; lineStarts: Uint32Array; lineFlags: Uint8Array; firstMoveOfLine: Int32Array; interpretDiagnostics: Diagnostic[]; tools: number[]; usesInch: boolean; analysis: AnalysisResult }`
  - `parseProgram(bytes: Uint8Array, ctx: ProgramContext): ParsedProgram`
  - `allDiagnostics(p: Pick<ParsedProgram, 'interpretDiagnostics' | 'analysis'>): Diagnostic[]` (merged, sorted by line, stable)
  - `motionTableTransferables(table): ArrayBuffer[]` (10 buffers), `parsedProgramTransferables(p): ArrayBuffer[]` (13 buffers)
  - Fixture `drill-arc.nc` (also used by Playwright in Task 15): exactly one diagnostic — `rapid-into-stock` on 0-based line 17 — against the Milestone 1 box job's stock

- [ ] **Step 1: Create the fixture program**

`packages/core/test/fixtures/drill-arc.nc` (exact content; line numbers in comments below are 0-based and must not shift):
```
%
(Spon fixture: arcs, a G83 peck cycle and one rapid into the stock)
G21 G90 G17 G54
T1 M6
G43 H1
S12000 M3
G0 Z5
G0 X5 Y5
G1 Z-1 F300
G2 X15 Y5 I5 J0 F800
G3 X5 Y5 R5
G0 Z5
G0 X25 Y15
G83 X25 Y15 Z-4 R1 Q1 F200
G80
G0 Z5
G0 X10 Y10
G0 Z-2 (deliberate error: rapid into the stock)
G0 Z5
M5
M30
%
```
(line 17 is `G0 Z-2 …`). End the file with a newline.

- [ ] **Step 2: Write the failing tests**

`packages/core/test/gcode-program.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allDiagnostics, motionTableTransferables, parsedProgramTransferables, parseProgram } from '../src/gcode/program';
import { vec3 } from '../src/geometry/vec3';
import { machinePreset } from '../src/job/machine';

const ctx = { profile: machinePreset('Hobby GRBL router'), stock: { min: vec3(0, 0, -6), max: vec3(30, 20, 0) }, jobWorkOffset: 'G54' as const };
const fixture = readFileSync(new URL('./fixtures/drill-arc.nc', import.meta.url));

describe('parseProgram', () => {
  it('parses the fixture program with exactly one diagnostic', () => {
    const p = parseProgram(new Uint8Array(fixture), ctx);
    expect(allDiagnostics(p).map((d) => `${d.code}@${d.line}`)).toEqual(['rapid-into-stock@17']);
    expect(p.tools).toEqual([1]);
    expect(p.analysis.summary.totalSeconds).toBeGreaterThan(30); // includes the 30 s tool change
    expect(p.lineStarts.length).toBe(p.lineFlags.length);
    expect(p.firstMoveOfLine[17]).toBeGreaterThan(0);
  });

  it('merges interpreter and analysis diagnostics by line', () => {
    const merged = allDiagnostics({
      interpretDiagnostics: [{ line: 5, severity: 'warning', code: 'arc-radius', message: 'a' }],
      analysis: { summary: {} as never, diagnostics: [{ line: 2, severity: 'error', code: 'rapid-into-stock', message: 'b' }] },
    });
    expect(merged.map((d) => d.line)).toEqual([2, 5]);
  });

  it('lists every typed-array buffer for zero-copy transfer', () => {
    const p = parseProgram(new Uint8Array(fixture), ctx);
    expect(motionTableTransferables(p.table)).toHaveLength(10);
    expect(new Set(parsedProgramTransferables(p)).size).toBe(13);
  });

  it('parses and times a 2 M-line program quickly', () => {
    const lines = ['G21 G90 G17', 'S10000 M3', 'G0 X0 Y0 Z1', 'G1 Z0 F1000'];
    for (let i = 0; i < 2_000_000; i++) lines.push(`X${(i % 1000) / 10} Y${Math.floor(i / 1000) / 10}`);
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const started = performance.now();
    const p = parseProgram(bytes, { ...ctx, stock: null });
    const ms = performance.now() - started;
    expect(p.table.count).toBe(2_000_002);
    // spec target ≈ 3 s; 5 s leaves headroom for slower machines while still catching per-line allocations
    expect(ms).toBeLessThan(5000);
  }, 60_000);
});
```
(`node:fs` works in tests because Vitest runs in Node; core's tsconfig has `@types/node` installed, but `"types": []` hides globals only — explicit `node:` imports still resolve. If TypeScript cannot resolve `node:fs` here, add `/// <reference types="node" />` as the first line of this test file.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gcode-program`
Expected: FAIL — `../src/gcode/program` cannot be resolved.

- [ ] **Step 4: Implement the pipeline**

`packages/core/src/gcode/program.ts`:
```ts
import type { WorkOffset } from '../job/types';
import { type AnalysisContext, type AnalysisResult, analyzeTable } from './analysis';
import { decodeProgramText } from './decode';
import { interpretProgram } from './interpreter';
import type { Diagnostic, MotionTable } from './types';

export interface ProgramContext extends AnalysisContext {
  jobWorkOffset: WorkOffset;
}

export interface ParsedProgram {
  table: MotionTable;
  lineStarts: Uint32Array;
  lineFlags: Uint8Array;
  firstMoveOfLine: Int32Array;
  /** Diagnostics that depend only on the program text. */
  interpretDiagnostics: Diagnostic[];
  tools: number[];
  usesInch: boolean;
  /** Timing, summary and job-dependent diagnostics; recomputed when the machine, stock or WCS change. */
  analysis: AnalysisResult;
}

export function parseProgram(bytes: Uint8Array, ctx: ProgramContext): ParsedProgram {
  const result = interpretProgram(decodeProgramText(bytes), { jobWorkOffset: ctx.jobWorkOffset });
  const analysis = analyzeTable(result.table, result.lineFlags, ctx);
  return {
    table: result.table,
    lineStarts: result.lineStarts,
    lineFlags: result.lineFlags,
    firstMoveOfLine: result.firstMoveOfLine,
    interpretDiagnostics: result.diagnostics,
    tools: result.tools,
    usesInch: result.usesInch,
    analysis,
  };
}

export function allDiagnostics(p: Pick<ParsedProgram, 'interpretDiagnostics' | 'analysis'>): Diagnostic[] {
  return [...p.interpretDiagnostics, ...p.analysis.diagnostics].sort((a, b) => a.line - b.line);
}

export function motionTableTransferables(table: MotionTable): ArrayBuffer[] {
  return [table.kind, table.end, table.arc, table.plane, table.feed, table.param, table.line, table.tool, table.flags, table.t]
    .map((a) => a.buffer as ArrayBuffer);
}

export function parsedProgramTransferables(p: ParsedProgram): ArrayBuffer[] {
  return [...motionTableTransferables(p.table), p.lineStarts.buffer as ArrayBuffer, p.lineFlags.buffer as ArrayBuffer, p.firstMoveOfLine.buffer as ArrayBuffer];
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './gcode/program';
```

- [ ] **Step 5: Run the full core suite and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all core tests pass (the performance test prints its duration if it fails). If the fixture test reports extra diagnostics, trace them against the fixture line by line before changing code — the fixture is designed so that every other check stays silent.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): G-code program pipeline, transfer helpers and fixture program" -m "Co-Authored-By: <your model trailer>"
```

---
### Task 9: Web program state, worker API and autosave blob sets

**Files:**
- Modify: `packages/web/src/state/store.ts`, `packages/web/src/state/store.test.ts`, `packages/web/src/state/autosave.ts`, `packages/web/src/state/autosave.test.ts`, `packages/web/src/workers/import.worker.ts`, `packages/web/src/workers/importClient.ts`, `packages/web/src/state/documents.ts` (callers of changed signatures only)
- Create: `packages/web/src/state/programContext.ts`, `packages/web/src/state/programContext.test.ts`

**Interfaces:**
- Consumes (core): `ParsedProgram`, `ProgramContext`, `AnalysisContext`, `AnalysisResult`, `MotionTable`, `parseProgram`, `analyzeTable`, `parsedProgramTransferables`, `stockBox`, `wcsPoint`, `v3sub`, `vec3`, `Job`, `Vec3`
- Produces:
  - Store: `interface ProgramData { status: 'parsing' | 'ready' | 'failed'; text: string; parsed: ParsedProgram | null; error: string | null }`, `type Visibility = 'rapids' | 'model' | 'stock'`, `type DockTab = 'gcode' | 'analysis'`; state `programBytes: Record<string, Uint8Array>`, `programData: Record<string, ProgramData>`, `activeProgramId: string | null`, `selectedLine: number | null`, `playhead: number`, `playing: boolean`, `speed: number`, `visibility: Record<Visibility, boolean>`, `dockTab: DockTab`; actions `setProgramBytes(blobId, bytes)`, `setProgramData(blobId, data)`, `setActiveProgram(id)`, `setSelectedLine(line)`, `setPlayhead(seconds)`, `setPlaying(playing)`, `setSpeed(speed)`, `toggleVisibility(v)`, `setDockTab(tab)`; `LoadedDocument.programBytes`
  - `removeOrphanBlobs(keepIds: readonly string[])`
  - `programContext(job, geometry): ProgramContext` (stock in program coordinates), `programOrigin(job, geometry): Vec3` (WCS point, or the origin without stock)
  - `parseProgramInWorker(bytes, ctx): Promise<ParsedProgram>`, `analyzeInWorker(table, lineFlags, ctx): Promise<{ analysis: AnalysisResult; t: Float64Array }>`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/state/programContext.test.ts`:
```ts
import { createJob, setModel, vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { programContext, programOrigin } from './programContext';
import type { ModelGeometry } from './store';

// only rawPoints matter for placement; the Milestone 1 20 × 10 × 5 box
const BOX = { kind: 'mesh', rawPoints: Float32Array.from([0, 0, 0, 20, 10, 5]) } as unknown as ModelGeometry;

describe('programContext', () => {
  it('expresses the stock in program coordinates (origin at the WCS point)', () => {
    const job = setModel(createJob(), { sourceName: 'box.stl', blobId: 'b', kind: 'mesh', importUnits: 'mm' });
    const ctx = programContext(job, BOX);
    expect(ctx.stock).toEqual({ min: vec3(0, 0, -6), max: vec3(30, 20, 0) });
    expect(ctx.profile).toBe(job.machine);
    expect(ctx.jobWorkOffset).toBe('G54');
    expect(programOrigin(job, BOX)).toEqual(vec3(-15, -10, 6));
  });

  it('has no stock and a zero origin without a model', () => {
    const job = createJob();
    expect(programContext(job, null).stock).toBeNull();
    expect(programOrigin(job, null)).toEqual(vec3(0, 0, 0));
  });
});
```

In `packages/web/src/state/store.test.ts`:
- add `programBytes: {}` to the existing `loadDocument({...})` call;
- append:
```ts
describe('program and playback state', () => {
  it('stores program bytes and data, and resets them when a document loads', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    s().setProgramBytes('p1', new Uint8Array([1]));
    s().setProgramData('p1', { status: 'parsing', text: 'G0', parsed: null, error: null });
    s().setActiveProgram('id1');
    s().setPlayhead(12);
    s().setPlaying(true);
    s().setSelectedLine(4);
    expect(s().programData.p1.status).toBe('parsing');
    s().loadDocument({ job: createJob('B'), geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: { p2: new Uint8Array([2]) } });
    expect(s().programBytes).toEqual({ p2: new Uint8Array([2]) });
    expect(s().programData).toEqual({});
    expect([s().activeProgramId, s().playhead, s().playing, s().selectedLine]).toEqual([null, 0, false, null]);
  });

  it('toggles visibility, speed and dock tab', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    expect(s().visibility).toEqual({ rapids: true, model: true, stock: true });
    s().toggleVisibility('rapids');
    expect(s().visibility.rapids).toBe(false);
    s().setSpeed(10);
    expect(s().speed).toBe(10);
    expect(s().dockTab).toBe('gcode');
    s().setDockTab('analysis');
    expect(s().dockTab).toBe('analysis');
  });
});
```

In `packages/web/src/state/autosave.test.ts`, change `removeOrphanBlobs('b')` to `removeOrphanBlobs(['b'])` and `removeOrphanBlobs(null)` to `removeOrphanBlobs([])`, and add inside that same test after the first prune:
```ts
    await putBlob('c', new Uint8Array([3]));
    await removeOrphanBlobs(['b', 'c']);
    expect(await getBlob('c')).toEqual(new Uint8Array([3]));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test`
Expected: FAIL — `./programContext` missing, store has no program actions, `removeOrphanBlobs` takes a string.

- [ ] **Step 3: Implement the store additions**

In `packages/web/src/state/store.ts`:
- extend the core import with `type ParsedProgram`;
- add after `PendingImport`:
```ts
export interface ProgramData {
  status: 'parsing' | 'ready' | 'failed';
  /** Decoded text, for the line list. */
  text: string;
  parsed: ParsedProgram | null;
  error: string | null;
}

export type Visibility = 'rapids' | 'model' | 'stock';
export type DockTab = 'gcode' | 'analysis';
```
- add `programBytes: Record<string, Uint8Array>;` to `LoadedDocument`;
- add to `AppState` (fields, then actions):
```ts
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

  setProgramBytes(blobId: string, bytes: Uint8Array): void;
  setProgramData(blobId: string, data: ProgramData): void;
  setActiveProgram(id: string | null): void;
  setSelectedLine(line: number | null): void;
  setPlayhead(seconds: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  toggleVisibility(v: Visibility): void;
  setDockTab(tab: DockTab): void;
```
- initial values in `createAppStore`: `programBytes: {}, programData: {}, activeProgramId: null, selectedLine: null, playhead: 0, playing: false, speed: 1, visibility: { rapids: true, model: true, stock: true }, dockTab: 'gcode',`
- `loadDocument(doc)` becomes:
```ts
    loadDocument(doc) {
      set({
        ...doc, past: [], future: [], pickMode: 'none', hiddenLayers: [], pendingImport: null,
        programData: {}, activeProgramId: doc.job.programs[0]?.id ?? null, selectedLine: null, playhead: 0, playing: false,
      });
    },
```
  (the store test above loads a job with no programs, so `activeProgramId` is `null`)
- new actions:
```ts
    setProgramBytes(blobId, bytes) {
      set({ programBytes: { ...get().programBytes, [blobId]: bytes } });
    },
    setProgramData(blobId, data) {
      set({ programData: { ...get().programData, [blobId]: data } });
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
```
- `newDocument` in `documents.ts` passes `programBytes: {}`; `openSponBytes` and `restoreAutosave` pass `programBytes: {}` for now (Task 10 fills them).

- [ ] **Step 4: Autosave keeps a set of blobs**

In `packages/web/src/state/autosave.ts` replace `removeOrphanBlobs`:
```ts
/** Deletes every stored blob whose id is not in `keepIds`. */
export async function removeOrphanBlobs(keepIds: readonly string[]): Promise<void> {
  const keep = new Set(keepIds);
  const tx = (await db()).transaction('blobs', 'readwrite');
  for (const key of await tx.store.getAllKeys()) {
    if (!keep.has(key)) await tx.store.delete(key);
  }
  await tx.done;
}
```
In `documents.ts`, `persistModelBlob` calls `removeOrphanBlobs(keepId ? [keepId] : [])` for now (Task 10 replaces it).

- [ ] **Step 5: Program context**

`packages/web/src/state/programContext.ts`:
```ts
import { type Job, type ProgramContext, stockBox, v3sub, type Vec3, vec3, wcsPoint } from '@sponcam/core';
import { placementFor } from './placement';
import type { ModelGeometry } from './store';

function stockAndOrigin(job: Job, geometry: ModelGeometry | null) {
  const placement = job.model && geometry ? placementFor(job.model, geometry) : null;
  const box = stockBox(job, placement);
  const origin = box ? wcsPoint(job.wcs, box) : null;
  return { box, origin };
}

/** Where program zero sits in the scene: the job's WCS point, or the machine origin without stock. */
export function programOrigin(job: Job, geometry: ModelGeometry | null): Vec3 {
  return stockAndOrigin(job, geometry).origin ?? vec3(0, 0, 0);
}

/** Analysis context: machine profile, job work offset, and the stock in program coordinates. */
export function programContext(job: Job, geometry: ModelGeometry | null): ProgramContext {
  const { box, origin } = stockAndOrigin(job, geometry);
  return {
    profile: job.machine,
    stock: box && origin ? { min: v3sub(box.min, origin), max: v3sub(box.max, origin) } : null,
    jobWorkOffset: job.wcs.workOffset,
  };
}
```

- [ ] **Step 6: Worker API**

Replace `packages/web/src/workers/import.worker.ts`:
```ts
import {
  type AnalysisContext, type AnalysisResult, analyzeTable, type ImportResult, importFile, importResultTransferables,
  type MotionTable, type ParsedProgram, parsedProgramTransferables, parseProgram, type ProgramContext,
} from '@sponcam/core';
import * as Comlink from 'comlink';

const api = {
  import(fileName: string, bytes: Uint8Array): ImportResult {
    const result = importFile(fileName, bytes);
    return Comlink.transfer(result, importResultTransferables(result));
  },
  parseProgram(bytes: Uint8Array, ctx: ProgramContext): ParsedProgram {
    const parsed = parseProgram(bytes, ctx);
    return Comlink.transfer(parsed, parsedProgramTransferables(parsed));
  },
  /** Receives a copy of the table (structured clone), re-times it and returns only the new times and analysis. */
  analyze(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): { analysis: AnalysisResult; t: Float64Array } {
    const analysis = analyzeTable(table, lineFlags, ctx);
    return Comlink.transfer({ analysis, t: table.t }, [table.t.buffer as ArrayBuffer]);
  },
};

export type ImportWorkerApi = typeof api;

Comlink.expose(api);
```

Replace the export section of `packages/web/src/workers/importClient.ts` (keep the `worker()` helper and `IMPORT_TIMEOUT_MS`):
```ts
/** Runs one worker call with the stuck-worker timeout; on timeout the worker is terminated and replaced. */
function run<T>(call: (api: Comlink.Remote<ImportWorkerApi>) => Promise<T>, message: string): Promise<T> {
  const { worker: current, api } = worker();
  const terminate = () => {
    current.terminate();
    if (instance === current) {
      instance = null;
      remote = null;
    }
  };
  return withTimeout<T>(call(api), IMPORT_TIMEOUT_MS, terminate, message);
}

/** Parses a model file off the main thread. Sends a copy of `bytes`, so the caller can keep using them. */
export function importInWorker(fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  const copy = bytes.slice();
  return run((api) => api.import(fileName, Comlink.transfer(copy, [copy.buffer])), 'Import timed out');
}

/** Parses and analyses a G-code program off the main thread (bytes are copied). */
export function parseProgramInWorker(bytes: Uint8Array, ctx: ProgramContext): Promise<ParsedProgram> {
  const copy = bytes.slice();
  return run((api) => api.parseProgram(Comlink.transfer(copy, [copy.buffer]), ctx), 'Parsing the program timed out');
}

/** Re-times and re-analyses a program; the table is copied to the worker, only the new times come back. */
export function analyzeInWorker(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): Promise<{ analysis: AnalysisResult; t: Float64Array }> {
  return run((api) => api.analyze(table, lineFlags, ctx), 'Analysing the program timed out');
}
```
and extend its core type import to `import type { AnalysisContext, AnalysisResult, ImportResult, MotionTable, ParsedProgram, ProgramContext } from '@sponcam/core';`.

- [ ] **Step 7: Run tests, typecheck and build**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(web): program and playback state, program worker API and blob sets" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 10: Loading, saving and restoring programs

**Files:**
- Create: `packages/web/src/state/programs.ts`, `packages/web/src/state/programs.test.ts`
- Modify: `packages/web/src/state/documents.ts`, `packages/web/src/layout/TopBar.tsx` (accept list), `packages/web/src/layout/DropZone.tsx` (overlay text), `packages/web/src/App.tsx` (empty-state text, start re-analysis)

**Interfaces:**
- Consumes: store (Task 9), `parseProgramInWorker`, `analyzeInWorker`, `programContext` (Task 9), core `addProgram`, `jobBlobIds`, `decodeProgramText`, `migrateJob`, `readSpon`/`writeSpon` (Task 2)
- Produces (`state/programs.ts`):
  - `PROGRAM_EXTENSIONS`, `isProgramFile(name): boolean`
  - `referencedBlobIds(job, past, future): string[]` (unique ids referenced by any of them)
  - `storeBlob(id, bytes): Promise<void>`, `pruneBlobs(): Promise<void>` (both log and swallow IndexedDB errors)
  - `importProgramBytes(name, bytes): Promise<void>`, `loadPrograms(): Promise<void>` (parse every program of the current job whose bytes are present), `reanalyzeAll(): Promise<void>`, `startProgramAnalysis(store, delayMs = 300): () => void`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/state/programs.test.ts`:
```ts
import { addProgram, createJob, setModel } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { isProgramFile, referencedBlobIds } from './programs';

describe('isProgramFile', () => {
  it('accepts the spec extensions case-insensitively', () => {
    for (const name of ['a.nc', 'b.NGC', 'c.gcode', 'd.tap', 'e.cnc']) expect(isProgramFile(name)).toBe(true);
    for (const name of ['a.stl', 'b.spon', 'nc', 'x.txt']) expect(isProgramFile(name)).toBe(false);
  });
});

describe('referencedBlobIds', () => {
  it('collects blobs from the job and the undo/redo stacks without duplicates', () => {
    const base = setModel(createJob(), { sourceName: 'm.stl', blobId: 'm', kind: 'mesh', importUnits: 'mm' });
    const withP1 = addProgram(base, { name: 'a.nc', blobId: 'p1' });
    const withP2 = addProgram(withP1, { name: 'b.nc', blobId: 'p2' });
    expect(referencedBlobIds(withP1, [base], [withP2]).sort()).toEqual(['m', 'p1', 'p2']);
  });
});
```

Run: `pnpm --filter @sponcam/web test programs`
Expected: FAIL — `./programs` cannot be resolved.

- [ ] **Step 2: Implement program flows**

`packages/web/src/state/programs.ts`:
```ts
import { addProgram, decodeProgramText, type Job, jobBlobIds } from '@sponcam/core';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand/vanilla';
import { analyzeInWorker, parseProgramInWorker } from '../workers/importClient';
import { putBlob, removeOrphanBlobs } from './autosave';
import { programContext } from './programContext';
import { type AppState, appStore } from './store';

export const PROGRAM_EXTENSIONS = ['.nc', '.ngc', '.gcode', '.tap', '.cnc'] as const;

const state = () => appStore.getState();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function isProgramFile(name: string): boolean {
  const lower = name.toLowerCase();
  return PROGRAM_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Blobs referenced by the job or by any undo/redo state, so undo/redo never loses bytes. */
export function referencedBlobIds(job: Job, past: readonly Job[], future: readonly Job[]): string[] {
  const ids = new Set<string>();
  for (const j of [job, ...past, ...future]) for (const id of jobBlobIds(j)) ids.add(id);
  return [...ids];
}

/** IndexedDB write for autosave; failures (quota, private browsing) are logged, never thrown. */
export async function storeBlob(id: string, bytes: Uint8Array): Promise<void> {
  try {
    await putBlob(id, bytes);
  } catch (err) {
    console.error('Could not store data for autosave', err);
  }
}

export async function pruneBlobs(): Promise<void> {
  const { job, past, future } = state();
  try {
    await removeOrphanBlobs(referencedBlobIds(job, past, future));
  } catch (err) {
    console.error('Could not clean up autosave data', err);
  }
}

async function parseBlob(blobId: string): Promise<void> {
  const bytes = state().programBytes[blobId];
  if (!bytes) return;
  const text = state().programData[blobId]?.text ?? decodeProgramText(bytes);
  state().setProgramData(blobId, { status: 'parsing', text, parsed: null, error: null });
  try {
    const parsed = await parseProgramInWorker(bytes, programContext(state().job, state().geometry));
    if (!state().programData[blobId]) return; // a different document was loaded meanwhile
    state().setProgramData(blobId, { status: 'ready', text, parsed, error: null });
  } catch (err) {
    if (!state().programData[blobId]) return;
    state().setProgramData(blobId, { status: 'failed', text, parsed: null, error: message(err) });
    toast.error(`Could not parse program: ${message(err)}`);
  }
}

/** Adds a G-code file to the job's program list (never replaces anything). */
export async function importProgramBytes(name: string, bytes: Uint8Array): Promise<void> {
  const blobId = crypto.randomUUID();
  state().setProgramBytes(blobId, bytes);
  state().setProgramData(blobId, { status: 'parsing', text: decodeProgramText(bytes), parsed: null, error: null });
  state().commit((job) => addProgram(job, { name, blobId }));
  const added = state().job.programs.at(-1);
  if (added) state().setActiveProgram(added.id);
  await storeBlob(blobId, bytes);
  await pruneBlobs();
  await parseBlob(blobId);
}

/** Parses every program of the current job (after open/restore). */
export async function loadPrograms(): Promise<void> {
  for (const program of state().job.programs) await parseBlob(program.blobId);
}

/** Re-times and re-analyses every parsed program for the current machine, stock and WCS. */
export async function reanalyzeAll(): Promise<void> {
  const ctx = programContext(state().job, state().geometry);
  for (const [blobId, data] of Object.entries(state().programData)) {
    if (data.status !== 'ready' || !data.parsed) continue;
    try {
      const { analysis, t } = await analyzeInWorker(data.parsed.table, data.parsed.lineFlags, ctx);
      const current = state().programData[blobId];
      if (current?.parsed !== data.parsed) continue; // replaced meanwhile
      state().setProgramData(blobId, { ...current, parsed: { ...data.parsed, table: { ...data.parsed.table, t }, analysis } });
    } catch (err) {
      console.error('Re-analysis failed', err);
    }
  }
}

/** Re-analyses programs `delayMs` after the machine, stock, WCS or model changes. Returns a stop function. */
export function startProgramAnalysis(store: StoreApi<AppState>, delayMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((s, prev) => {
    const changed =
      s.job.machine !== prev.job.machine || s.job.stock !== prev.job.stock || s.job.wcs !== prev.job.wcs ||
      s.job.model !== prev.job.model || s.geometry !== prev.geometry;
    if (!changed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void reanalyzeAll(), delayMs);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
```

- [ ] **Step 3: Wire programs into the document flows**

In `packages/web/src/state/documents.ts`:
- imports: add `migrateJob`, `type BlobMap` from `@sponcam/core`; add `import { importProgramBytes, isProgramFile, loadPrograms, pruneBlobs, storeBlob } from './programs';`; drop `putBlob`/`removeOrphanBlobs` from the autosave import (keep `getBlob`, `loadCurrentJob`).
- replace `persistModelBlob` with:
```ts
/** Stores the model blob (if any) for autosave and drops blobs nothing references any more. */
async function persistModelBlob(keepId: string | null, bytes: Uint8Array | null): Promise<void> {
  if (keepId && bytes) await storeBlob(keepId, bytes);
  await pruneBlobs();
}
```
- add a helper:
```ts
function programBytesFrom(job: Job, blobs: BlobMap): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const p of job.programs) if (blobs[p.blobId]) out[p.blobId] = blobs[p.blobId];
  return out;
}
```
- `openFile`: at the top, before the model/job checks, add:
```ts
  if (isProgramFile(file.name)) {
    if (file.size > MAX_SOFT_IMPORT_BYTES && !window.confirm(`${file.name} is ${Math.round(file.size / 1048576)} MB and may take a while to load. Continue?`)) return;
    await importProgramBytes(file.name, new Uint8Array(await file.arrayBuffer()));
    return;
  }
```
  and change the unsupported-type toast to `Unsupported file type: ${file.name} (open .spon, .stl, .dxf or G-code)`.
- `openSponBytes`: keep the whole `readSpon` result:
```ts
  let job: Job;
  let blobs: BlobMap;
  try {
    ({ job, blobs } = readSpon(bytes));
  } catch (err) {
    toast.error(message(err));
    return;
  }
  const modelBytes = job.model ? blobs[job.model.blobId] ?? null : null;
```
  pass `programBytes: programBytesFrom(job, blobs)` to `loadDocument`, then replace the final `persistModelBlob(...)` with:
```ts
  for (const [id, data] of Object.entries(blobs)) await storeBlob(id, data);
  await pruneBlobs();
  await loadPrograms();
```
- `saveDocument`: build the blob map from the model and every program:
```ts
    const { programBytes } = state();
    const blobs: BlobMap = { ...programBytes };
    if (job.model && modelBytes) blobs[job.model.blobId] = modelBytes;
    const bytes = writeSpon(job, blobs);
```
- `restoreAutosave`: migrate the stored job first, and restore program bytes:
```ts
  let job: Job;
  try {
    job = migrateJob(saved.job);
  } catch (err) {
    toast.error(`Could not restore the autosaved job: ${message(err)}`);
    return;
  }
```
  (replacing `let job = saved.job;`), then after the model block:
```ts
  const programBytes: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  for (const p of job.programs) {
    try {
      const data = await getBlob(p.blobId);
      if (data) programBytes[p.blobId] = data;
      else missing.push(p.id);
    } catch {
      missing.push(p.id);
    }
  }
  if (missing.length) {
    toast.warning(`${missing.length} autosaved program(s) could not be found and were removed from the job`);
    job = { ...job, programs: job.programs.filter((p) => !missing.includes(p.id)) };
  }
```
  pass `programBytes` to `loadDocument`, and after `requestView('fit')` add `await loadPrograms();`.

- [ ] **Step 4: Accept and advertise program files**

- `packages/web/src/layout/TopBar.tsx`: `accept=".spon,.stl,.dxf,.nc,.ngc,.gcode,.tap,.cnc"`.
- `packages/web/src/layout/DropZone.tsx`: overlay text `Drop an STL, DXF, G-code or .spon file`.
- `packages/web/src/App.tsx`: the empty-state text becomes `Drop an STL, DXF or G-code file here, or use Open`, shown when there is neither a model nor a program (`const isEmpty = useApp((s) => s.job.model === null && s.job.programs.length === 0);`, replacing `hasModel`); and start re-analysis next to autosave:
```tsx
  useEffect(() => {
    void restoreAutosave();
    const stopAutosave = startAutosave(appStore);
    const stopAnalysis = startProgramAnalysis(appStore);
    return () => {
      stopAutosave();
      stopAnalysis();
    };
  }, []);
```
  (import `startProgramAnalysis` from `@/state/programs`).

- [ ] **Step 5: Run tests, typecheck, build and the Milestone 1 e2e suite**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build && pnpm e2e`
Expected: all pass — the existing Playwright tests confirm model import, save state and autosave restore still work with the v2 job.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): import, save, open and restore G-code programs with the job" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 11: Timeline, toolpath buffers and duration formatting

**Files:**
- Create: `packages/web/src/gcode/timeline.ts`, `packages/web/src/gcode/timeline.test.ts`, `packages/web/src/gcode/toolpath.ts`, `packages/web/src/gcode/toolpath.test.ts`
- Modify: `packages/web/src/panels/format.ts`, `packages/web/src/panels/format.test.ts`

**Interfaces:**
- Consumes: `ProgramRef`, `MotionTable`, `ParsedProgram`, `MoveKind`, `rowAtTime`, `rowStartTime`, `arcGeometry`, `arcPointInto`, `arcStepCount`, `interpretProgram` (tests) from core; `ProgramData` (Task 9)
- Produces:
  - `interface TimelineEntry { programId: string; blobId: string; start: number; duration: number }`, `interface Timeline { entries: TimelineEntry[]; total: number }`
  - `buildTimeline(programs, data): Timeline` (only `inTimeline` programs whose data is `ready`, in list order)
  - `locate(tl, time): { entry: TimelineEntry; index: number; local: number } | null` (time clamped to `[0, total]`)
  - `timeOfLine(parsed, line): number | null` (start time of the first move at or after `line`)
  - `stepTime(tl, data, time, direction: 1 | -1): number` (start of the next/previous move)
  - `TOOLPATH_COLORS`, `interface ToolpathBuffers { positions: Float32Array; colors: Float32Array; rowVertexEnd: Uint32Array }`, `buildToolpathBuffers(table, { showRapids, chordTol = 0.01 }): ToolpathBuffers`
  - `formatDuration(seconds): string` (`m:ss`, or `h:mm:ss` from one hour)

- [ ] **Step 1: Write the failing tests**

`packages/web/src/gcode/timeline.test.ts`:
```ts
import { computeTiming, interpretProgram, machinePreset, type ParsedProgram, type ProgramRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { ProgramData } from '../state/store';
import { buildTimeline, locate, stepTime, timeOfLine } from './timeline';

const profile = machinePreset('Hobby GRBL router');

function data(text: string): ProgramData {
  const r = interpretProgram(text, { jobWorkOffset: 'G54' });
  computeTiming(r.table, profile);
  const parsed = {
    table: r.table, lineStarts: r.lineStarts, lineFlags: r.lineFlags, firstMoveOfLine: r.firstMoveOfLine,
    interpretDiagnostics: r.diagnostics, tools: r.tools, usesInch: r.usesInch,
    analysis: { summary: { totalSeconds: r.table.t[r.table.count - 1] } as never, diagnostics: [] },
  } satisfies ParsedProgram;
  return { status: 'ready', text, parsed, error: null };
}

const prog = (id: string, blobId: string, inTimeline = true): ProgramRef => ({ id, name: `${id}.nc`, blobId, inTimeline });

describe('timeline', () => {
  const a = data('G4 P2\nG4 P3\n'); // 5 s, dwell rows on lines 0 and 1
  const b = data('G4 P10\n'); // 10 s
  const programs = [prog('A', 'a'), prog('X', 'x', false), prog('B', 'b')];
  const all = { a, b, x: data('G4 P99\n') };

  it('chains included, ready programs back to back', () => {
    const tl = buildTimeline(programs, all);
    expect(tl.entries.map((e) => [e.programId, e.start, e.duration])).toEqual([['A', 0, 5], ['B', 5, 10]]);
    expect(tl.total).toBe(15);
    expect(buildTimeline(programs, { a }).entries.map((e) => e.programId)).toEqual(['A']);
  });

  it('locates a global time and clamps it', () => {
    const tl = buildTimeline(programs, all);
    expect(locate(tl, 7)).toMatchObject({ index: 1, local: 2 });
    expect(locate(tl, -3)).toMatchObject({ index: 0, local: 0 });
    expect(locate(tl, 99)).toMatchObject({ index: 1, local: 10 });
    expect(locate(buildTimeline([], {}), 1)).toBeNull();
  });

  it('finds the start time of a line and steps between moves', () => {
    expect(timeOfLine(a.parsed!, 1)).toBe(2);
    expect(timeOfLine(a.parsed!, 2)).toBeNull();
    const tl = buildTimeline(programs, all);
    expect(stepTime(tl, all, 0, 1)).toBe(2);
    expect(stepTime(tl, all, 2.5, 1)).toBe(5);
    expect(stepTime(tl, all, 6, -1)).toBe(5);
    expect(stepTime(tl, all, 3, -1)).toBe(2);
  });
});
```

`packages/web/src/gcode/toolpath.test.ts`:
```ts
import { interpretProgram } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { buildToolpathBuffers, TOOLPATH_COLORS } from './toolpath';

const table = interpretProgram('G21 G90 G17\nS1 M3\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 X10\nG3 X-10 Y0 I-10 J0\nG4 P1\n', { jobWorkOffset: 'G54' }).table;

describe('buildToolpathBuffers', () => {
  it('emits one segment per line move and several per arc, coloured by move type', () => {
    const b = buildToolpathBuffers(table, { showRapids: true });
    const perRow = Array.from(b.rowVertexEnd).map((v, i, all) => v - (i ? all[i - 1] : 0));
    expect(perRow.slice(0, 3)).toEqual([2, 2, 2]);
    expect(perRow[3]).toBeGreaterThan(20);
    expect(perRow[4]).toBe(0); // dwell draws nothing
    expect(b.positions.length).toBe(b.rowVertexEnd[4] * 3);
    expect(Array.from(b.colors.slice(0, 3))).toEqual(TOOLPATH_COLORS.rapid);
    expect(Array.from(b.colors.slice(6, 9))).toEqual(TOOLPATH_COLORS.plunge);
    expect(Array.from(b.colors.slice(12, 15))).toEqual(TOOLPATH_COLORS.feed);
    expect(Array.from(b.positions.slice(12, 18))).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('can leave rapids out while keeping the row map monotonic', () => {
    const b = buildToolpathBuffers(table, { showRapids: false });
    expect(b.rowVertexEnd[0]).toBe(0);
    expect(b.rowVertexEnd[1]).toBe(2);
  });
});
```
(`TOOLPATH_COLORS` values are exact binary fractions so Float32 comparisons are exact.)

In `packages/web/src/panels/format.test.ts` add:
```ts
import { formatDuration } from './format';

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
```
(merge the import into the existing import line from `./format`.)

Run: `pnpm --filter @sponcam/web test`
Expected: FAIL — the new modules and `formatDuration` do not exist.

- [ ] **Step 2: Implement the helpers**

`packages/web/src/panels/format.ts` — append:
```ts
/** m:ss, or h:mm:ss from one hour; rounded to whole seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
```

`packages/web/src/gcode/timeline.ts`:
```ts
import { type ParsedProgram, type ProgramRef, rowAtTime, rowStartTime } from '@sponcam/core';
import type { ProgramData } from '../state/store';

export interface TimelineEntry {
  programId: string;
  blobId: string;
  /** Global start time, seconds. */
  start: number;
  duration: number;
}

export interface Timeline {
  entries: TimelineEntry[];
  total: number;
}

/** Programs that are in the timeline and parsed, back to back in list order. */
export function buildTimeline(programs: readonly ProgramRef[], data: Readonly<Record<string, ProgramData>>): Timeline {
  const entries: TimelineEntry[] = [];
  let start = 0;
  for (const p of programs) {
    const parsed = data[p.blobId]?.parsed;
    if (!p.inTimeline || data[p.blobId]?.status !== 'ready' || !parsed) continue;
    const duration = parsed.analysis.summary.totalSeconds;
    entries.push({ programId: p.id, blobId: p.blobId, start, duration });
    start += duration;
  }
  return { entries, total: start };
}

export function locate(tl: Timeline, time: number): { entry: TimelineEntry; index: number; local: number } | null {
  if (tl.entries.length === 0) return null;
  const clamped = Math.min(Math.max(time, 0), tl.total);
  let index = 0;
  for (let i = 0; i < tl.entries.length; i++) if (tl.entries[i].start <= clamped) index = i;
  const entry = tl.entries[index];
  return { entry, index, local: Math.min(clamped - entry.start, entry.duration) };
}

/** Start time (program-local) of the first move on `line` or on the nearest following line that has one. */
export function timeOfLine(parsed: ParsedProgram, line: number): number | null {
  for (let l = line; l < parsed.firstMoveOfLine.length; l++) {
    const row = parsed.firstMoveOfLine[l];
    if (row >= 0) return rowStartTime(parsed.table, row);
  }
  return null;
}

/** Global time of the start of the next (1) or previous (−1) move. */
export function stepTime(tl: Timeline, data: Readonly<Record<string, ProgramData>>, time: number, direction: 1 | -1): number {
  const at = locate(tl, time);
  if (!at) return 0;
  const table = data[at.entry.blobId]?.parsed?.table;
  if (!table || table.count === 0) return at.entry.start;
  const row = rowAtTime(table, at.local);
  const rowStart = rowStartTime(table, row);
  if (direction === 1) return at.entry.start + table.t[row]; // start of the next move = end of this one
  if (at.local - rowStart > 1e-9) return at.entry.start + rowStart; // inside a move: back to its start
  return at.entry.start + (row > 0 ? rowStartTime(table, row - 1) : 0);
}
```
Check against the test: program A has rows with t = [2, 5]. `stepTime(0, +1)` → row 0, returns t[0] = 2. `stepTime(2.5, +1)` → row 1, returns 5. `stepTime(6, −1)` → B, local 1, row 0, inside → B start 5. `stepTime(3, −1)` → A row 1 starts at 2, local 3 is inside → 2.

`packages/web/src/gcode/toolpath.ts`:
```ts
import { arcGeometry, arcPointInto, arcStepCount, type MotionTable, MoveKind, type Plane, rowStart } from '@sponcam/core';

/** RGB 0–1: rapids orange, feeds blue, plunges magenta (exact binary fractions). */
export const TOOLPATH_COLORS = {
  rapid: [1, 0.625, 0.125],
  feed: [0.25, 0.5, 1],
  plunge: [0.875, 0.25, 0.875],
} as const;

export interface ToolpathBuffers {
  /** Line-segment vertex pairs, program coordinates. */
  positions: Float32Array;
  colors: Float32Array;
  /** Cumulative vertex count after each row (for draw-range splitting). */
  rowVertexEnd: Uint32Array;
}

const isArc = (kind: number) => kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW;

export function buildToolpathBuffers(table: MotionTable, opts: { showRapids: boolean; chordTol?: number }): ToolpathBuffers {
  const tol = opts.chordTol ?? 0.01;
  const s = [0, 0, 0];
  const e = [0, 0, 0];
  const c = [0, 0, 0];
  const steps = new Uint32Array(table.count); // segments per row
  const rowVertexEnd = new Uint32Array(table.count);
  let vertices = 0;
  for (let i = 0; i < table.count; i++) {
    const kind = table.kind[i];
    let n = 0;
    if (kind === MoveKind.Rapid) n = opts.showRapids ? 1 : 0;
    else if (kind === MoveKind.Feed) n = 1;
    else if (isArc(kind)) {
      rowStart(table, i, s);
      for (let k = 0; k < 3; k++) {
        e[k] = table.end[i * 3 + k];
        c[k] = table.arc[i * 3 + k];
      }
      const g = arcGeometry(s, e, c, table.plane[i] as Plane, kind === MoveKind.ArcCW);
      n = arcStepCount(g.r, Math.abs(g.sweep), tol);
    }
    steps[i] = n;
    vertices += n * 2;
    rowVertexEnd[i] = vertices;
  }

  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  let v = 0;
  const put = (p: number[], rgb: readonly number[]) => {
    positions[v * 3] = p[0];
    positions[v * 3 + 1] = p[1];
    positions[v * 3 + 2] = p[2];
    colors[v * 3] = rgb[0];
    colors[v * 3 + 1] = rgb[1];
    colors[v * 3 + 2] = rgb[2];
    v++;
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (let i = 0; i < table.count; i++) {
    const n = steps[i];
    if (n === 0) continue;
    const kind = table.kind[i];
    rowStart(table, i, s);
    for (let k = 0; k < 3; k++) {
      e[k] = table.end[i * 3 + k];
      c[k] = table.arc[i * 3 + k];
    }
    if (!isArc(kind)) {
      const plungeMove = kind === MoveKind.Feed && e[2] < s[2] && Math.hypot(e[0] - s[0], e[1] - s[1]) < 1e-6;
      const rgb = kind === MoveKind.Rapid ? TOOLPATH_COLORS.rapid : plungeMove ? TOOLPATH_COLORS.plunge : TOOLPATH_COLORS.feed;
      put(s, rgb);
      put(e, rgb);
      continue;
    }
    const g = arcGeometry(s, e, c, table.plane[i] as Plane, kind === MoveKind.ArcCW);
    arcPointInto(g, s, 0, a);
    for (let k = 1; k <= n; k++) {
      arcPointInto(g, s, k / n, b);
      put(a, TOOLPATH_COLORS.feed);
      put(b, TOOLPATH_COLORS.feed);
      a[0] = b[0];
      a[1] = b[1];
      a[2] = b[2];
    }
  }
  return { positions, colors, rowVertexEnd };
}
```
Trace for the toolpath test: rows 0 rapid (0,0,0)→(0,0,5) → rapid colour; row 1 `G1 Z0` is a plunge (vertices 2–3, colours at index 6); row 2 `G1 X10` feed (vertices 4–5, colours at index 12; positions 12–18 are (0,0,0)(10,0,0)); row 3 the half-circle arc; row 4 the dwell.

- [ ] **Step 3: Run tests and typecheck**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web typecheck`
Expected: all pass. (`satisfies ParsedProgram` in the timeline test requires TS ≥ 4.9 — available.)

- [ ] **Step 4: Commit**

```bash
git add packages/web
git commit -m "feat(web): combined timeline, toolpath buffers and duration formatting" -m "Co-Authored-By: <your model trailer>"
```

---
### Task 12: Playback cursor, toolpaths and visibility toggles in the viewport

**Files:**
- Create: `packages/web/src/gcode/playback.ts`, `packages/web/src/gcode/playback.test.ts`, `packages/web/src/viewport/Toolpaths.tsx`
- Modify: `packages/web/src/viewport/Viewport.tsx`, `packages/web/src/viewport/ModelObject.tsx`, `packages/web/src/viewport/SceneObjects.tsx`

**Interfaces:**
- Consumes: `buildTimeline`, `locate`, `timeOfLine`, `buildToolpathBuffers` (Task 11), store (Task 9), `programOrigin` (Task 9), core `positionAt`, `rowAtTime`, `rowStartTime`
- Produces (`gcode/playback.ts`):
  - `interface PlaybackCursor { entry: TimelineEntry; program: ProgramRef; parsed: ParsedProgram; row: number; line: number; kind: number; feed: number; position: [number, number, number] }`
  - `playbackCursor(job, data, tl, time): PlaybackCursor | null` (pure)
  - `splitVertex(entry: TimelineEntry | undefined, playhead, table, rowVertexEnd): number` (pure: vertices already played)
  - hooks `useTimeline(): Timeline`, `usePlaybackCursor(): PlaybackCursor | null`
  - actions `activateProgram(programId)`, `seekToLine(programId, line)`
- Test ids: `toggle-rapids`, `toggle-model`, `toggle-stock`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/gcode/playback.test.ts`:
```ts
import { addProgram, computeTiming, createJob, interpretProgram, type ParsedProgram } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { ProgramData } from '../state/store';
import { playbackCursor, splitVertex } from './playback';
import { buildTimeline } from './timeline';
import { buildToolpathBuffers } from './toolpath';

function ready(text: string, job: ReturnType<typeof createJob>): ProgramData {
  const r = interpretProgram(text, { jobWorkOffset: 'G54' });
  computeTiming(r.table, job.machine);
  const parsed = {
    table: r.table, lineStarts: r.lineStarts, lineFlags: r.lineFlags, firstMoveOfLine: r.firstMoveOfLine,
    interpretDiagnostics: r.diagnostics, tools: r.tools, usesInch: r.usesInch,
    analysis: { summary: { totalSeconds: r.table.t[r.table.count - 1] } as never, diagnostics: [] },
  } satisfies ParsedProgram;
  return { status: 'ready', text, parsed, error: null };
}

describe('playback', () => {
  const job = addProgram(createJob(), { name: 'a.nc', blobId: 'a' });
  const data = { a: ready('G21 G90\nS1 M3\nG0 X0 Y0 Z0\nG1 X100 F600\nG4 P2\n', job) };
  const tl = buildTimeline(job.programs, data);

  it('finds the current row, line and interpolated position', () => {
    const t = data.a.parsed!.table;
    const halfway = (t.t[1] - t.t[0]) / 2 + t.t[0];
    const c = playbackCursor(job, data, tl, halfway)!;
    expect(c.row).toBe(1);
    expect(c.line).toBe(3);
    expect(c.position[0]).toBeCloseTo(50, 6);
    expect(c.feed).toBe(600);
    expect(playbackCursor(job, data, tl, tl.total)!.row).toBe(2);
    expect(playbackCursor(job, {}, buildTimeline(job.programs, {}), 1)).toBeNull();
  });

  it('splits the drawn path at the playhead', () => {
    const t = data.a.parsed!.table;
    const buffers = buildToolpathBuffers(t, { showRapids: true });
    const entry = tl.entries[0];
    expect(splitVertex(entry, 0, t, buffers.rowVertexEnd)).toBe(0);
    expect(splitVertex(entry, t.t[1] - 0.001, t, buffers.rowVertexEnd)).toBe(buffers.rowVertexEnd[0]);
    expect(splitVertex(entry, tl.total + 1, t, buffers.rowVertexEnd)).toBe(buffers.rowVertexEnd[t.count - 1]);
    expect(splitVertex(undefined, 5, t, buffers.rowVertexEnd)).toBe(0);
  });
});
```

Run: `pnpm --filter @sponcam/web test playback`
Expected: FAIL — `./playback` cannot be resolved.

- [ ] **Step 2: Implement the playback helpers**

`packages/web/src/gcode/playback.ts`:
```ts
import { type Job, type MotionTable, type ParsedProgram, positionAt, type ProgramRef, rowAtTime, rowStartTime } from '@sponcam/core';
import { useMemo } from 'react';
import { appStore, type ProgramData, useApp } from '../state/store';
import { buildTimeline, locate, type Timeline, type TimelineEntry, timeOfLine } from './timeline';

export interface PlaybackCursor {
  entry: TimelineEntry;
  program: ProgramRef;
  parsed: ParsedProgram;
  row: number;
  line: number;
  kind: number;
  feed: number;
  /** Tool tip, program coordinates. */
  position: [number, number, number];
}

export function playbackCursor(job: Job, data: Readonly<Record<string, ProgramData>>, tl: Timeline, time: number): PlaybackCursor | null {
  const at = locate(tl, time);
  if (!at) return null;
  const program = job.programs.find((p) => p.id === at.entry.programId);
  const parsed = data[at.entry.blobId]?.parsed;
  if (!program || !parsed || parsed.table.count === 0) return null;
  const table = parsed.table;
  const row = rowAtTime(table, at.local);
  const position: [number, number, number] = [0, 0, 0];
  positionAt(table, job.machine, row, at.local - rowStartTime(table, row), position);
  return { entry: at.entry, program, parsed, row, line: table.line[row], kind: table.kind[row], feed: table.feed[row], position };
}

/** Number of vertices of a program's toolpath that lie before the playhead. */
export function splitVertex(entry: TimelineEntry | undefined, playhead: number, table: MotionTable, rowVertexEnd: Uint32Array): number {
  if (!entry || table.count === 0 || playhead <= entry.start) return 0;
  if (playhead >= entry.start + entry.duration) return rowVertexEnd[table.count - 1];
  const row = rowAtTime(table, playhead - entry.start);
  return row > 0 ? rowVertexEnd[row - 1] : 0;
}

export function useTimeline(): Timeline {
  const programs = useApp((s) => s.job.programs);
  const data = useApp((s) => s.programData);
  return useMemo(() => buildTimeline(programs, data), [programs, data]);
}

export function usePlaybackCursor(): PlaybackCursor | null {
  const job = useApp((s) => s.job);
  const data = useApp((s) => s.programData);
  const playhead = useApp((s) => s.playhead);
  const tl = useTimeline();
  return useMemo(() => playbackCursor(job, data, tl, playhead), [job, data, tl, playhead]);
}

/** Makes a program active; if it is in the timeline, the playhead jumps to its start. */
export function activateProgram(programId: string): void {
  const s = appStore.getState();
  s.setActiveProgram(programId);
  const entry = buildTimeline(s.job.programs, s.programData).entries.find((e) => e.programId === programId);
  if (entry) {
    s.setPlaying(false);
    s.setPlayhead(entry.start);
  }
}

/** Activates a program, selects a line and moves the playhead to that line's first move (when it has one). */
export function seekToLine(programId: string, line: number): void {
  const s = appStore.getState();
  if (s.activeProgramId !== programId) s.setActiveProgram(programId);
  s.setSelectedLine(line);
  const program = s.job.programs.find((p) => p.id === programId);
  const parsed = program ? s.programData[program.blobId]?.parsed : null;
  const entry = buildTimeline(s.job.programs, s.programData).entries.find((e) => e.programId === programId);
  const local = parsed ? timeOfLine(parsed, line) : null;
  if (entry && local !== null) {
    s.setPlaying(false);
    s.setPlayhead(entry.start + local);
  }
}
```

- [ ] **Step 3: Toolpaths and the tool marker**

`packages/web/src/viewport/Toolpaths.tsx`:
```tsx
import { bboxSize, type ParsedProgram, type ProgramRef } from '@sponcam/core';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { splitVertex, usePlaybackCursor, useTimeline } from '@/gcode/playback';
import { buildToolpathBuffers } from '@/gcode/toolpath';
import { programOrigin } from '@/state/programContext';
import { useStockBox } from '@/state/selectors';
import { useApp } from '@/state/store';
import { noRaycast } from './SceneObjects';

export function Toolpaths() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const data = useApp((s) => s.programData);
  const showRapids = useApp((s) => s.visibility.rapids);
  const origin = useMemo(() => programOrigin(job, geometry), [job, geometry]);
  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {job.programs.map((p) => {
        const parsed = data[p.blobId]?.parsed;
        return parsed ? <ProgramToolpath key={p.id} program={p} parsed={parsed} showRapids={showRapids} /> : null;
      })}
      <ToolMarker />
    </group>
  );
}

function ProgramToolpath({ program, parsed, showRapids }: { program: ProgramRef; parsed: ParsedProgram; showRapids: boolean }) {
  const buffers = useMemo(() => buildToolpathBuffers(parsed.table, { showRapids }), [parsed.table, showRapids]);
  // two geometries share the same attributes (one GPU upload); each has its own draw range
  const [done, todo] = useMemo(() => {
    const position = new THREE.BufferAttribute(buffers.positions, 3);
    const color = new THREE.BufferAttribute(buffers.colors, 3);
    const make = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('color', color);
      g.computeBoundingSphere();
      return g;
    };
    return [make(), make()];
  }, [buffers]);
  // both are disposed together, so the shared attributes are released exactly when neither is drawn any more
  useEffect(() => () => {
    done.dispose();
    todo.dispose();
  }, [done, todo]);

  const tl = useTimeline();
  const entry = tl.entries.find((e) => e.programId === program.id);
  const split = useApp((s) => splitVertex(entry, s.playhead, parsed.table, buffers.rowVertexEnd));
  done.setDrawRange(0, split);
  todo.setDrawRange(split, Infinity);

  return (
    <>
      <lineSegments geometry={done} raycast={noRaycast}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      <lineSegments geometry={todo} raycast={noRaycast}>
        <lineBasicMaterial vertexColors transparent opacity={program.inTimeline ? 0.35 : 0.15} depthWrite={false} />
      </lineSegments>
    </>
  );
}

function ToolMarker() {
  const cursor = usePlaybackCursor();
  const stock = useStockBox();
  if (!cursor) return null;
  const size = stock ? Math.max(4, 0.08 * Math.max(...Object.values(bboxSize(stock)))) : 6;
  const [x, y, z] = cursor.position;
  return (
    // cones point up (+Y) by default; rotate so the tip points down and sits on the tool position
    <mesh position={[x, y, z + size / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={3}>
      <coneGeometry args={[size / 4, size, 20]} />
      <meshStandardMaterial color="#f5f5f4" emissive="#57534e" />
    </mesh>
  );
}
```

- [ ] **Step 4: Visibility toggles**

- `ModelObject.tsx`: first line of `ModelObject()` becomes `const visible = useApp((s) => s.visibility.model);`, and the early return becomes `if (!visible || !geometry || !model || !placement) return null;`.
- `SceneObjects.tsx` `StockBox()`: add `const visible = useApp((s) => s.visibility.stock);` before `useStockBox()` and return `null` when `!visible || !box`.
- `Viewport.tsx`: import `Toolpaths` and `{ Toggle } from '@/components/ui/toggle'`; add `<Toolpaths />` after `<ModelObject />` inside the Canvas; add a top-left overlay:
```tsx
const TOGGLES: { key: Visibility; label: string }[] = [
  { key: 'rapids', label: 'Rapids' },
  { key: 'model', label: 'Model' },
  { key: 'stock', label: 'Stock' },
];
```
```tsx
      <div className="absolute left-3 top-3 flex gap-1">
        {TOGGLES.map(({ key, label }) => (
          <Toggle
            key={key} size="sm" variant="outline" data-testid={`toggle-${key}`}
            pressed={visibility[key]} onPressedChange={() => appStore.getState().toggleVisibility(key)}
            className="bg-background/80"
          >
            {label}
          </Toggle>
        ))}
      </div>
```
  with `const visibility = useApp((s) => s.visibility);` and `type Visibility` imported from the store.

- [ ] **Step 5: Test and build**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: pass. Then `pnpm dev`, open the app, drop `packages/core/test/fixtures/box-20x10x5.stl` (mm) and `packages/core/test/fixtures/drill-arc.nc`: the toolpath appears dimmed over the stock with its origin at the stock's front-left top corner; the three toggles hide rapids/model/stock. (Record this as a manual check in the report; the dock arrives in Task 14.)

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): draw program toolpaths with a playhead split and a tool marker" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 13: Programs and Machine panels

**Files:**
- Create: `packages/web/src/panels/ProgramsPanel.tsx`, `packages/web/src/panels/MachinePanel.tsx`
- Modify: `packages/web/src/layout/LeftPanel.tsx`

**Interfaces:**
- Consumes: `activateProgram` (Task 12), `pruneBlobs` (Task 10), `formatDuration` (Task 11), `NumericField`, `PanelSection` (Milestone 1), core `allDiagnostics`, `moveProgram`, `removeProgram`, `setProgramInTimeline`, `setMachineProfile`, `applyMachinePreset`, `MACHINE_PRESET_NAMES`, `formatLength`, `parseLength`
- Produces: test ids `program-<name>` (row; `data-active="true"` when active), `program-in-timeline`, `program-time`, `program-up`, `program-down`, `program-remove` (inside each row), `machine-preset`, `machine-rapid-x|y|z`, `machine-accel-x|y|z`, `machine-max-feed`, `machine-tool-change`

- [ ] **Step 1: Implement the Programs panel**

`packages/web/src/panels/ProgramsPanel.tsx`:
```tsx
import { allDiagnostics, moveProgram, removeProgram, setProgramInTimeline } from '@sponcam/core';
import { ArrowDown, ArrowUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { activateProgram } from '@/gcode/playback';
import { cn } from '@/lib/utils';
import { pruneBlobs } from '@/state/programs';
import { appStore, useApp } from '@/state/store';
import { formatDuration } from './format';
import { PanelSection } from './PanelSection';

export function ProgramsPanel() {
  const programs = useApp((s) => s.job.programs);
  const data = useApp((s) => s.programData);
  const activeId = useApp((s) => s.activeProgramId);
  const { commit } = appStore.getState();

  const remove = (id: string) => {
    commit((j) => removeProgram(j, id));
    const s = appStore.getState();
    if (s.activeProgramId === id) s.setActiveProgram(s.job.programs[0]?.id ?? null);
    void pruneBlobs();
  };

  return (
    <PanelSection title="Programs">
      {programs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No programs. Open or drop a G-code file (.nc, .ngc, .gcode, .tap, .cnc).</p>
      ) : (
        <ul className="space-y-1">
          {programs.map((p, index) => {
            const d = data[p.blobId];
            const diags = d?.parsed ? allDiagnostics(d.parsed) : [];
            const errors = diags.filter((x) => x.severity === 'error').length;
            const warnings = diags.filter((x) => x.severity === 'warning').length;
            return (
              <li
                key={p.id} data-testid={`program-${p.name}`} data-active={p.id === activeId}
                onClick={() => activateProgram(p.id)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm', p.id === activeId ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
              >
                <input
                  type="checkbox" data-testid="program-in-timeline" checked={p.inTimeline} className="accent-primary" title="Include in timeline"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => commit((j) => setProgramInTimeline(j, p.id, e.target.checked))}
                />
                <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                {d?.status === 'parsing' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                {d?.status === 'failed' && <span className="text-xs text-destructive">failed</span>}
                {d?.parsed && (
                  <>
                    <span className="font-mono text-xs" data-testid="program-time">{formatDuration(d.parsed.analysis.summary.totalSeconds)}</span>
                    {errors > 0 && <span className="rounded bg-destructive/20 px-1 text-xs text-destructive">{errors}</span>}
                    {warnings > 0 && <span className="rounded bg-amber-500/20 px-1 text-xs text-amber-500">{warnings}</span>}
                  </>
                )}
                <span className="flex" onClick={(e) => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" className="size-6" data-testid="program-up" disabled={index === 0} title="Move up" onClick={() => commit((j) => moveProgram(j, p.id, -1))}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-6" data-testid="program-down" disabled={index === programs.length - 1} title="Move down" onClick={() => commit((j) => moveProgram(j, p.id, 1))}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-6" data-testid="program-remove" title="Remove" onClick={() => remove(p.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}
```
(If the Radix-based shadcn `Button` has no `icon` size in this project, use `size="sm"` with `className="size-6 p-0"` and note the deviation.)

- [ ] **Step 2: Implement the Machine panel**

`packages/web/src/panels/MachinePanel.tsx`:
```tsx
import {
  type AxisValues, applyMachinePreset, formatLength, MACHINE_PRESET_NAMES, type MachinePresetName, parseLength, setMachineProfile,
} from '@sponcam/core';
import { appStore, useApp } from '@/state/store';
import { NumericField } from './NumericField';
import { PanelSection } from './PanelSection';

const AXES = ['x', 'y', 'z'] as const;

export function MachinePanel() {
  const machine = useApp((s) => s.job.machine);
  const units = useApp((s) => s.job.displayUnits);
  const { commit } = appStore.getState();
  const isPreset = (MACHINE_PRESET_NAMES as readonly string[]).includes(machine.name);
  // rates and accelerations are lengths per time: convert the length part only
  const lengthField = (value: number, suffix: string, testId: string, onCommit: (v: number) => void, label: string) => (
    <NumericField
      key={testId} label={label} value={value} suffix={suffix} testId={testId}
      format={(v) => formatLength(v, units)}
      parse={(t) => {
        const mm = parseLength(t, units);
        return mm !== null && mm > 0 ? mm : null;
      }}
      onCommit={onCommit}
    />
  );
  const axisPatch = (group: 'rapid' | 'accel', axis: keyof AxisValues, v: number) => commit((j) => setMachineProfile(j, { [group]: { [axis]: v } }));

  return (
    <PanelSection title="Machine" defaultOpen={false}>
      <label className="mb-3 grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Profile</span>
        <select
          data-testid="machine-preset" value={isPreset ? machine.name : 'Custom'} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => commit((j) => applyMachinePreset(j, e.target.value as MachinePresetName))}
        >
          {MACHINE_PRESET_NAMES.map((n) => <option key={n} value={n} className="bg-background">{n}</option>)}
          <option value="Custom" disabled className="bg-background">Custom</option>
        </select>
      </label>
      <div className="space-y-2">
        {AXES.map((a) => lengthField(machine.rapid[a], `${units}/min`, `machine-rapid-${a}`, (v) => axisPatch('rapid', a, v), `Rapid ${a.toUpperCase()}`))}
        {AXES.map((a) => lengthField(machine.accel[a], `${units}/s²`, `machine-accel-${a}`, (v) => axisPatch('accel', a, v), `Accel ${a.toUpperCase()}`))}
        {lengthField(machine.maxFeed, `${units}/min`, 'machine-max-feed', (v) => commit((j) => setMachineProfile(j, { maxFeed: v })), 'Max feed')}
        <NumericField
          label="Tool change" value={machine.toolChangeSeconds} suffix="s" testId="machine-tool-change"
          format={(v) => v.toFixed(0)}
          parse={(t) => {
            const n = Number(t.trim().replace(',', '.'));
            return t.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
          }}
          onCommit={(v) => commit((j) => setMachineProfile(j, { toolChangeSeconds: v }))}
        />
      </div>
    </PanelSection>
  );
}
```

- [ ] **Step 3: Add the panels**

`packages/web/src/layout/LeftPanel.tsx` renders, in order: `ModelPanel`, `OrientationPanel`, `StockPanel`, `WcsPanel`, `ProgramsPanel`, `MachinePanel`.

- [ ] **Step 4: Test, typecheck, build and check by hand**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: pass. Manual (record in the report): with the box STL and `drill-arc.nc` loaded, the Programs row shows a time and one red error badge; switching the Machine preset to "Generic VMC" shortens the time after ~0.3 s (re-analysis); editing Rapid X renames the preset to Custom; Ctrl+Z restores it.

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): Programs and Machine panels" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 14: Bottom dock — timeline, G-code list, analysis, playback loop and keys

**Files:**
- Create: `packages/web/src/dock/BottomDock.tsx`, `packages/web/src/dock/TimelineBar.tsx`, `packages/web/src/dock/GcodeList.tsx`, `packages/web/src/dock/AnalysisView.tsx`, `packages/web/src/gcode/playbackLoop.ts`
- Modify: `packages/web/src/App.tsx`, `packages/web/src/hooks/useKeyboardShortcuts.ts`

**Interfaces:**
- Consumes: playback helpers (Task 12), timeline helpers (Task 11), store (Task 9), `formatDuration`, `formatSize`, `formatPoint` (panels/format), core `allDiagnostics`, `bboxSize`, `formatLength`, `LineFlag`, `MoveKind`
- Produces: `usePlaybackLoop()`; test ids `bottom-dock`, `play`, `speed`, `timeline-scrubber` (range 0–1000), `timeline-time`, `timeline-move`, `dock-tab-gcode`, `dock-tab-analysis`, `gcode-line` (with `data-line` 0-based, `data-current`, `data-selected`), `analysis-total-time`, `diagnostic` (with `data-code`)

- [ ] **Step 1: Playback loop**

`packages/web/src/gcode/playbackLoop.ts`:
```ts
import { useEffect } from 'react';
import { appStore, useApp } from '../state/store';
import { buildTimeline, locate } from './timeline';

/** Advances the playhead while playing; the active program follows the playhead. */
export function usePlaybackLoop(): void {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = appStore.getState();
      const tl = buildTimeline(s.job.programs, s.programData);
      const next = s.playhead + ((now - last) / 1000) * s.speed;
      last = now;
      if (tl.total <= 0 || next >= tl.total) {
        s.setPlayhead(tl.total);
        s.setPlaying(false);
        return;
      }
      s.setPlayhead(next);
      const at = locate(tl, next);
      if (at && at.entry.programId !== s.activeProgramId) s.setActiveProgram(at.entry.programId);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
```

- [ ] **Step 2: Timeline bar**

`packages/web/src/dock/TimelineBar.tsx`:
```tsx
import { formatLength } from '@sponcam/core';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaybackCursor, useTimeline } from '@/gcode/playback';
import { formatDuration } from '@/panels/format';
import { appStore, useApp } from '@/state/store';

const SPEEDS = [1, 2, 5, 10, 25, 50, 100];
const KIND_LABEL = ['Rapid', 'Feed', 'Arc CW', 'Arc CCW', 'Dwell', 'Tool change', 'Pause', 'Home'];

export function TimelineBar() {
  const tl = useTimeline();
  const playhead = useApp((s) => s.playhead);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const units = useApp((s) => s.job.displayUnits);
  const cursor = usePlaybackCursor();
  const value = tl.total > 0 ? Math.round((Math.min(playhead, tl.total) / tl.total) * 1000) : 0;

  const togglePlay = () => {
    const s = appStore.getState();
    if (!s.playing && s.playhead >= tl.total) s.setPlayhead(0);
    s.setPlaying(!s.playing);
  };

  return (
    <div className="flex items-center gap-3 border-b px-3 py-1.5 text-xs">
      <Button size="sm" variant="secondary" data-testid="play" disabled={tl.total <= 0} onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <select
        data-testid="speed" value={speed} className="h-7 rounded-md border bg-transparent px-1"
        onChange={(e) => appStore.getState().setSpeed(Number(e.target.value))}
      >
        {SPEEDS.map((v) => <option key={v} value={v} className="bg-background">{v}×</option>)}
      </select>
      <div className="relative flex-1">
        <input
          type="range" min={0} max={1000} step={1} value={value} data-testid="timeline-scrubber" className="w-full accent-primary"
          disabled={tl.total <= 0}
          onChange={(e) => {
            const s = appStore.getState();
            s.setPlaying(false);
            s.setPlayhead((Number(e.target.value) / 1000) * tl.total);
          }}
        />
        {tl.entries.slice(1).map((e) => (
          <div key={e.programId} className="pointer-events-none absolute top-0 h-full w-px bg-amber-400" style={{ left: `${(e.start / tl.total) * 100}%` }} />
        ))}
      </div>
      <span className="w-28 text-right font-mono" data-testid="timeline-time">
        {formatDuration(Math.min(playhead, tl.total))} / {formatDuration(tl.total)}
      </span>
      <span className="w-72 truncate text-muted-foreground" data-testid="timeline-move">
        {cursor
          ? `${KIND_LABEL[cursor.kind] ?? '?'}${cursor.feed > 0 ? ` · F ${formatLength(cursor.feed, units)} ${units}/min` : ''} · line ${cursor.line + 1}`
          : '—'}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Virtualised G-code list**

`packages/web/src/dock/GcodeList.tsx`:
```tsx
import { allDiagnostics, LineFlag } from '@sponcam/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { seekToLine, usePlaybackCursor } from '@/gcode/playback';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/store';

const ROW = 20;
const OVERSCAN = 10;

export function GcodeList() {
  const activeId = useApp((s) => s.activeProgramId);
  const program = useApp((s) => s.job.programs.find((p) => p.id === s.activeProgramId) ?? null);
  const data = useApp((s) => (program ? s.programData[program.blobId] : undefined));
  const selectedLine = useApp((s) => s.selectedLine);
  const cursor = usePlaybackCursor();
  const currentLine = cursor && cursor.program.id === activeId ? cursor.line : null;
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const parsed = data?.parsed ?? null;
  const messages = useMemo(() => {
    const map = new Map<number, string>();
    if (parsed) for (const d of allDiagnostics(parsed)) map.set(d.line, map.has(d.line) ? `${map.get(d.line)}\n${d.message}` : d.message);
    return map;
  }, [parsed]);
  const errorLines = useMemo(() => new Set(parsed ? allDiagnostics(parsed).filter((d) => d.severity === 'error').map((d) => d.line) : []), [parsed]);

  // keep the selected (or, while playing, the current) line in view
  const follow = selectedLine ?? currentLine;
  useEffect(() => {
    const el = ref.current;
    if (!el || follow === null) return;
    const top = follow * ROW;
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }, [follow]);

  if (!program) return <p className="p-3 text-sm text-muted-foreground">Select a program.</p>;
  if (!data || data.status === 'parsing') return <p className="p-3 text-sm text-muted-foreground">Parsing {program.name}…</p>;
  if (!parsed) return <p className="p-3 text-sm text-destructive">{data.error ?? 'Could not parse the program'}</p>;

  const { lineStarts, lineFlags } = parsed;
  const text = data.text;
  const count = lineStarts.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(count, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const rows = [];
  for (let i = first; i < last; i++) {
    const end = i + 1 < count ? lineStarts[i + 1] : text.length;
    const content = text.slice(lineStarts[i], end).replace(/\r?\n$/, '');
    const notSimulated = (lineFlags[i] & LineFlag.NotSimulated) !== 0;
    rows.push(
      <div
        key={i} data-testid="gcode-line" data-line={i} data-current={i === currentLine} data-selected={i === selectedLine}
        title={messages.get(i) ?? (notSimulated ? 'Not simulated' : undefined)}
        onClick={() => seekToLine(program.id, i)}
        className={cn(
          'absolute left-0 right-0 flex cursor-pointer gap-3 px-2 leading-5 hover:bg-accent/50',
          i === currentLine && 'bg-primary/20',
          i === selectedLine && 'outline outline-1 outline-primary',
          errorLines.has(i) && 'text-destructive',
          notSimulated && 'text-muted-foreground line-through',
        )}
        style={{ top: i * ROW, height: ROW }}
      >
        <span className="w-12 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
        <span className="whitespace-pre">{content}</span>
      </div>,
    );
  }

  return (
    <div ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="h-full overflow-auto font-mono text-xs">
      <div className="relative" style={{ height: count * ROW }}>{rows}</div>
    </div>
  );
}
```

- [ ] **Step 4: Analysis view**

`packages/web/src/dock/AnalysisView.tsx`:
```tsx
import { allDiagnostics, bboxSize, formatLength, type Diagnostic } from '@sponcam/core';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { seekToLine, useTimeline } from '@/gcode/playback';
import { formatDuration, formatPoint, formatSize } from '@/panels/format';
import { appStore, useApp } from '@/state/store';

const ICON = { error: CircleX, warning: TriangleAlert, info: Info } as const;
const COLOR = { error: 'text-destructive', warning: 'text-amber-500', info: 'text-sky-400' } as const;

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono" data-testid={testId}>{children}</dd>
    </>
  );
}

export function AnalysisView() {
  const program = useApp((s) => s.job.programs.find((p) => p.id === s.activeProgramId) ?? null);
  const data = useApp((s) => (program ? s.programData[program.blobId] : undefined));
  const units = useApp((s) => s.job.displayUnits);
  const tl = useTimeline();
  const parsed = data?.parsed;
  if (!program || !parsed) return <p className="p-3 text-sm text-muted-foreground">{program ? 'Parsing…' : 'Select a program.'}</p>;

  const s = parsed.analysis.summary;
  const diagnostics = allDiagnostics(parsed);
  const len = (mm: number) => `${formatLength(mm, units)} ${units}`;
  const open = (d: Diagnostic) => {
    seekToLine(program.id, d.line);
    appStore.getState().setDockTab('gcode');
  };

  return (
    <div className="grid h-full grid-cols-[minmax(18rem,1fr)_2fr] gap-4 overflow-auto p-3 text-xs">
      <dl className="grid grid-cols-[8rem_1fr] content-start gap-x-2 gap-y-1">
        <Row label="Run time" testId="analysis-total-time">{formatDuration(s.totalSeconds)}</Row>
        {tl.entries.length > 1 && <Row label="All programs">{formatDuration(tl.total)}</Row>}
        {s.perTool.filter((p) => p.tool > 0).map((p) => <Row key={p.tool} label={`Tool T${p.tool}`}>{formatDuration(p.seconds)}</Row>)}
        <Row label="Cutting">{len(s.cutDistance)}</Row>
        <Row label="Plunging">{len(s.plungeDistance)}</Row>
        <Row label="Rapids">{len(s.rapidDistance)}</Row>
        {s.extents && <Row label="Extents">{formatSize(bboxSize(s.extents), units)}</Row>}
        {s.extents && <Row label="Min / max">{formatPoint(s.extents.min, units)}<br />{formatPoint(s.extents.max, units)}</Row>}
        {s.feedRange && <Row label="Feed">{formatLength(s.feedRange[0], units)}–{formatLength(s.feedRange[1], units)} {units}/min</Row>}
        <Row label="Tools">{s.tools.length ? s.tools.map((t) => `T${t}`).join(', ') : '—'}</Row>
        <Row label="Lines">{s.lineCount} ({s.notSimulatedLines} not simulated)</Row>
      </dl>
      <div>
        <div className="mb-1 font-medium">Diagnostics ({diagnostics.length})</div>
        {diagnostics.length === 0 ? (
          <p className="text-muted-foreground">No problems found.</p>
        ) : (
          <ul className="space-y-0.5">
            {diagnostics.map((d, i) => {
              const Icon = ICON[d.severity];
              return (
                <li key={`${d.line}-${d.code}-${i}`}>
                  <button type="button" data-testid="diagnostic" data-code={d.code} onClick={() => open(d)} className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-accent/50">
                    <Icon className={`mt-0.5 size-3.5 shrink-0 ${COLOR[d.severity]}`} />
                    <span className="w-14 shrink-0 font-mono text-muted-foreground">Line {d.line + 1}</span>
                    <span>{d.message}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: The dock and layout**

`packages/web/src/dock/BottomDock.tsx`:
```tsx
import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { appStore, type DockTab, useApp } from '@/state/store';
import { AnalysisView } from './AnalysisView';
import { GcodeList } from './GcodeList';
import { TimelineBar } from './TimelineBar';

const KEY = 'spon.dockHeight';

function initialHeight(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    if (stored >= 120) return stored;
  } catch {
    // storage unavailable (private mode): use the default
  }
  return 260;
}

export function BottomDock() {
  const hasPrograms = useApp((s) => s.job.programs.length > 0);
  const tab = useApp((s) => s.dockTab);
  const [height, setHeight] = useState(initialHeight);
  if (!hasPrograms) return null;

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const startHeight = height;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let latest = startHeight;
    const move = (ev: PointerEvent) => {
      latest = Math.min(Math.max(120, startHeight + (startY - ev.clientY)), window.innerHeight * 0.7);
      setHeight(latest);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(KEY, String(Math.round(latest)));
      } catch {
        // not persisted; fine
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <section data-testid="bottom-dock" className="flex shrink-0 flex-col border-t bg-background" style={{ height }}>
      <div className="h-1.5 shrink-0 cursor-row-resize bg-border/40 hover:bg-primary/40" onPointerDown={startResize} title="Drag to resize" />
      <TimelineBar />
      <div className="flex items-center gap-2 border-b px-3 py-1">
        <ToggleGroup type="single" size="sm" variant="outline" value={tab} onValueChange={(v) => v && appStore.getState().setDockTab(v as DockTab)}>
          <ToggleGroupItem value="gcode" data-testid="dock-tab-gcode">G-code</ToggleGroupItem>
          <ToggleGroupItem value="analysis" data-testid="dock-tab-analysis">Analysis</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="min-h-0 flex-1">{tab === 'gcode' ? <GcodeList /> : <AnalysisView />}</div>
    </section>
  );
}
```
(`React.PointerEvent` needs `import type React from 'react'`, or import `type PointerEvent as ReactPointerEvent` from 'react' — use whichever keeps `verbatimModuleSyntax` happy.)

`packages/web/src/App.tsx`:
- call `usePlaybackLoop();` next to the other hooks;
- change the `<main>` so the viewport and the dock stack vertically:
```tsx
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <DropZone>
              <Viewport />
              {isEmpty && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Drop an STL, DXF or G-code file here, or use Open
                </div>
              )}
            </DropZone>
          </div>
          <BottomDock />
        </main>
```
  (`isEmpty` is the Task 10 selector.)

- [ ] **Step 6: Playback keys**

In `packages/web/src/hooks/useKeyboardShortcuts.ts`, import `{ buildTimeline, stepTime } from '@/gcode/timeline'`, extend the doc comment with "Space play/pause, ←/→ step one move, Home/End jump", and add right after the `if (isTyping(e.target)) return;` line:
```ts
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
```

- [ ] **Step 7: Test, build and check by hand**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck && pnpm --filter @sponcam/web build`
Expected: pass. Manual (record in the report): load the box STL and `drill-arc.nc`; the dock appears; Play animates the cone along the path with the current G-code line highlighted; the scrubber seeks; ←/→ step moves; the Analysis tab lists one `rapid-into-stock` diagnostic and clicking it jumps to line 18 in the G-code tab.

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(web): bottom dock with timeline, virtualised G-code list, analysis and playback keys" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 15: Playwright tests for the G-code toolkit

**Files:**
- Create: `packages/web/e2e/gcode.spec.ts`

**Interfaces:**
- Consumes: fixtures `box-20x10x5.stl` (Milestone 1) and `drill-arc.nc` (Task 8); test ids from Tasks 12–14

- [ ] **Step 1: Write the tests**

`packages/web/e2e/gcode.spec.ts`:
```ts
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

test('G-code: load over a job, analyse, jump to the diagnostic, scrub, and restore after reload', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'box-20x10x5.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  await openFixture(page, 'drill-arc.nc');
  const row = page.getByTestId('program-drill-arc.nc');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('program-time')).toHaveText(/^\d+:\d{2}$/);

  // analysis: exactly one error, the deliberate rapid into the stock on line 18 (0-based 17)
  await page.getByTestId('dock-tab-analysis').click();
  const diagnostics = page.getByTestId('diagnostic');
  await expect(diagnostics).toHaveCount(1);
  await expect(diagnostics.first()).toHaveAttribute('data-code', 'rapid-into-stock');
  const total = await page.getByTestId('analysis-total-time').textContent();
  expect(total).toMatch(/^\d+:\d{2}$/);
  expect(total).not.toBe('0:00');
  await expect(row.getByTestId('program-time')).toHaveText(total!);

  // clicking the diagnostic shows and selects its line
  await diagnostics.first().click();
  await expect(page.locator('[data-testid="gcode-line"][data-selected="true"]')).toHaveAttribute('data-line', '17');

  // scrubbing to 90% moves the current line past the 30 s tool change (line 4 = index 3)
  await page.getByTestId('timeline-scrubber').fill('900');
  const current = page.locator('[data-testid="gcode-line"][data-current="true"]');
  await expect(current).toHaveCount(1);
  expect(Number(await current.getAttribute('data-line'))).toBeGreaterThan(3);

  // autosave restores the program and its analysis
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId('program-drill-arc.nc')).toBeVisible();
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('diagnostic')).toHaveCount(1);
});

test('G-code without a model: rapids below Z 0 are reported and the machine profile changes the time', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'drill-arc.nc');
  const time = page.getByTestId('program-drill-arc.nc').getByTestId('program-time');
  await expect(time).toHaveText(/^\d+:\d{2}$/);
  const before = await time.textContent();

  // no stock: the deliberate rapid is reported as "below Z 0"
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('diagnostic')).toHaveCount(1);

  await page.getByRole('button', { name: 'Machine' }).click(); // expand the collapsed panel
  await page.getByTestId('machine-preset').selectOption('Generic VMC');
  await expect(time).not.toHaveText(before!); // 5 s tool change instead of 30 s
});
```
Note: spec §8 describes scrubbing to 50%; the fixture's 30 s tool change fills the first ~70% of its run time, so 90% is used to land on a later line. This is a test-data choice, not a behaviour change.

- [ ] **Step 2: Run the Playwright suite**

Run: `pnpm e2e`
Expected: the two Milestone 1 tests and the two new tests pass (4 passed). If a test fails because the app is wrong, fix the app minimally in its own `fix(web): …` commit with the root cause in the report; never weaken an assertion.

- [ ] **Step 3: Commit**

```bash
git add packages/web/e2e/gcode.spec.ts
git commit -m "test(web): Playwright tests for G-code loading, analysis, scrubbing and restore" -m "Co-Authored-By: <your model trailer>"
```

---

### Task 16: Final verification against the Milestone 2 acceptance criteria

**Files:**
- Modify: only what fixes require

- [ ] **Step 1: Full suite**

Run from the repo root:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm e2e
```
Expected: every command exits 0; record the test counts.

- [ ] **Step 2: Acceptance walk-through (spec §9) — note pass/fail for each**

1. Load two programs into a job with a model; reorder them, untick one → the timeline total and program boundaries change; toolpaths sit at the WCS over model and stock.
2. Play: the cone moves at estimated speed, the G-code list follows, speed changes work, scrubbing and Space/←/→/Home/End work.
3. Analysis shows per-program, per-tool and combined times, extents and diagnostics that jump to their lines.
4. Changing the machine preset, the stock or the WCS updates times/diagnostics within a second.
5. Reload restores programs and the machine profile; Save → New → Open `.spon` restores them; a Milestone 1 `.spon` opens.
6. Generate a large program (e.g. with a short Node script writing 2 M `G1 X… Y…` lines to a scratch file) and open it: the UI stays responsive while parsing, and playback runs.

- [ ] **Step 3: Fix and commit anything found**

For each failure: a failing test where practical, then the fix, then re-run Step 1. Commit `fix: address milestone 2 acceptance issues` (skip if nothing needed fixing).
